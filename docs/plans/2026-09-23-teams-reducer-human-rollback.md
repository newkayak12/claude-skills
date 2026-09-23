# teams — reducer / human 노드 / 체크포인트 롤백 (검토용 초안)

2026-09-23. 외부 이론 대조(§1)에서 나온 세 갈래를 계획으로 옮긴다. 셋 다 **이미 코드에 있는 것을
선언되게 만드는 일**이지, 새 메커니즘을 들여오는 일이 아니다 — 이 문서가 확인한 첫 번째 사실이다.

선행 문서:
- `2026-09-17-teams-team-v0.13.0.md` — human 실행자 설계. **미구현**, 버전 번호만 다른 작업에 재사용됨.
- `2026-09-21-teams-server-owns-the-loop.md` §8h~8i — shape/critique 수렴 실패, 조사 스테이지 도입.

## 0'. 외부 이론 대조표 (2026-09-23)

아래 세 갈래는 이 대조에서 나왔다. 대조 자체를 여기 남긴다 — 다음 사람이 같은 검색을 다시 하지
않도록, 그리고 "우리가 독립적으로 도달한 것"과 "업계가 이미 정리해 둔 것"을 구분할 수 있도록.

| 외부 개념 | 출처 | 우리 쪽 대응 | 판정 |
|---|---|---|---|
| DAG 스케줄러 모델 — dependency resolution / readiness / termination / failure handling을 형식화 | Hu Wei, *From Agent Loops to Structured Graphs: A Scheduler-Theoretic Framework for LLM Agent Execution* (arXiv 2604.11378) | `readyNodes()` · `unmetDeps()` · `runState()` | **일치.** 논문이 형식화한 넷을 코드로 먼저 갖고 있었다 |
| Durable execution — append-only event history, 크래시 후 replay로 재개 | Temporal (vs Airflow 비교: zenml.io/blog/temporal-vs-airflow) | `ledger.jsonl` + `saveRun` write-then-rename + 데몬 재기동 복구(0.13.2) | **일치** |
| exactly-once workflow / at-least-once activity, 멱등성은 호출자 책임 | 같은 출처 | 노드 재시도는 at-least-once. 멱등 키 없음 | **차이.** 우리는 재시도가 작업을 다시 하는 것으로 때운다 |
| Supervisor 패턴 — 오케스트레이터 하나가 워커 서브그래프에 배분 (network=혼돈, hierarchical=대개 과함) | LangGraph supervisor 패턴 정리 (callsphere.ai/blog/langgraph-supervisor-multi-agent-orchestration-2026) | 매니저 그래프 → 자식 런 | **일치**, 단 우리는 매니저→패키지→서브골 3층(hierarchical) — 그쪽 기준으로는 과한 쪽 |
| Reducer — 병렬 노드 출력을 상태 스키마가 병합(`Annotated[list, add]`), 덮어쓰기가 기본이 아님 | LangGraph 상태 스키마 | `foldChild`/`integrate`는 있고, **런 안 병렬 서브골 층은 규약** | **차이 → §0.1** |
| Interrupt가 일급 상태 + 체크포인트 = time travel(임의 시점 롤백 후 다른 결정으로 재개) | LangGraph interrupts (docs.langchain.com/oss/python/langgraph/interrupts) | `waiting_human`은 설계만 있고 미구현. time travel 없음 | **차이 → §0.2, §0.3** |
| 진짜 suspension의 세 조건: ① 대기 중 컴퓨트 0 ② 내구성 있는 체크포인트 ③ 이벤트 기반 재개 | Render, *Human in the Loop, Without the Hacks* (render.com/articles/human-in-the-loop-without-the-hacks-...) | v0.13.0 Task 5(드라이버 종료·`tm_answer` 재기동), run store, `tm_answer` | **셋 다 일치.** 설계가 업계 합의와 독립적으로 같은 결론에 도달했다 |
| "각 체크포인트를 **명명된 소유자와 SLA**를 가진 재개 가능 단계로 다루지 않으면, 승인자가 잠든 첫날 패턴이 무너진다" | 같은 출처 | `ask_timeout`(v0.13.0) + `investigate.unknowns[]`의 소유자 필드(0.26.0) | **일치** |

대조에서 확인된 것 하나 더: 우리가 "정해야 할 셋"으로 꼽았던 것(만료 / 도달 경로 / 무인 지속)이
v0.13.0 설계 안에 전부 있고, 그 설계의 `interactive: false` 기본값(자동 결정 + **무엇을 물으려
했는지까지 기록**)은 이 문서가 앞서 제안했던 "만료되면 unanswered로 닫기"보다 낫다 — 조사가 못
채운 칸이 보고서에 드러나기 때문이다.

## 0. 외부 이론과의 대조에서 확정된 것

### 0.1 우리에게 없는 것은 reducer가 아니라 reducer의 **선언**이다 (확인됨)

LangGraph는 병렬 노드의 출력을 상태 스키마의 reducer(`Annotated[list, add]`)로 병합한다 — 덮어쓰기가
기본값이 아니고, 병합 방식이 타입에 붙어 있어 노드가 어길 수 없다. 우리 쪽을 코드로 대조하면 병합하는
자리는 이미 둘 있다:

- `foldChild()` (`taskmanager.mjs:1730`) — 자식 런 하나를 매니저의 `accept` 결과로 접는다.
  `changed_files`를 `[...new Set(child.nodes.flatMap(...))]`로 합치고, `goal_verdict`를 라운드
  합의로 덮어쓴다. **이것이 reduce다.** 다만 병합 규칙이 이 함수 안에 하드코딩돼 있고 kind별로
  다르지 않다.
- `integrate` — 패키지 브랜치들을 git 머지로 합친다. 파일 레벨 reduce이고, 충돌은 git이 판정한다.

없는 것은 **런 안에서 병렬 서브골이 같은 산출물에 쓸 때의 reduce**다. 지금 그 자리는 규약이다 —
`CONTRACT.setgoal`이 "여러 서브골이 한 파일을 쓰면 각자 소유한 heading을 title과 acceptance에
명시하고, 다른 절은 건드리지 않는다고 acceptance에 적어라"라고 말한다. 규약은 어기면 조용히 깨지고,
아무도 검사하지 않는다. 0.26.0의 `investigate`가 형제끼리 findings 파일을 덮어쓰지 않도록 "서브골
이름을 따서 파일명을 지으라"고 한 것도 같은 문제를 같은 방식(이름 규칙)으로 피한 것이다.

**결정**: leader 노드가 reducer가 된다. 사용자의 표현("TeamLeader가 Reducer가 될 것 같다")이 맞다 —
다만 현재 코드에 `TeamLeader`라는 실체는 없다(데몬이 대체했다). 실체는 `accept`(패키지 하나의 fold)와
`integrate`(전체의 fold)이고, 런 안에는 그 층이 **비어 있다**. 채울 자리는 `gate:goal` 직전이다.

### 0.2 human 노드는 제안을 내고 사람이 고른다 — 그리고 그 요청은 메인 세션으로 갈 수밖에 없다 (결정됨)

v0.13.0 §0.2가 `ask:N`을 "질문"으로만 설계했다. 이 계획은 거기에 두 가지를 더한다:

1. **질문은 선택지를 동반한다.** 자유 서술 답변을 기다리는 대신, 물어야 할 결정마다 후보와 각
   후보의 결과를 함께 낸다(권고안을 첫 번째로). 근거: 조사가 못 채운 칸은 대개 "모른다"가 아니라
   "정하는 사람이 따로 있다"이고, 그 사람에게 필요한 것은 백지가 아니라 선택지다. 0.26.0의
   `investigate`가 내는 `unknowns[]`는 이미 소유자를 달고 나오므로 후보만 더하면 된다.
2. **묻는 경로는 메인 세션뿐이다.** 자식 런의 드라이버는 헤드리스 `claude -p`이고, 그 프롬프트는
   `taskmanager.mjs:2129`가 "nobody is reading this but the machine that called you, so ask no
   questions"라고 명시적으로 금지한다. 헤드리스 세션에는 사람에게 도달할 표면이 없다 — 따라서
   `waiting_human`은 드라이버가 처리하는 상태가 아니라 **메인 세션이 `tm_inbox`로 집어 가는
   상태**다. v0.13.0 Task 5의 "드라이버는 깨끗이 종료하고 `tm_answer`가 재기동한다"가 이 구조를
   이미 전제하고 있다.

### 0.3 `retryShape`를 체크포인트 롤백으로 바꾼다 (검토 필요)

§8h가 기록한 사실: `retryShape`는 부분 수정이 아니라 **패키지 그래프 전체 폐기 후 재작성**이라,
잘 잡힌 분할까지 버리고 매 회차 새 결함을 만든다. critique는 4/4 거부했고 shape은 한 번도 통과하지
못했다.

외부 대조에서 나온 것: LangGraph는 `interrupt()`를 예외가 아니라 상태로 두고, 체크포인트와 결합해
임의 시점으로 롤백한 뒤 **다른 결정으로 재개**한다(time travel). 우리에게 그 자리는 비어 있고,
`retryShape`가 "전부 버리고 처음부터"로 때우고 있다.

**이 계획의 제안**: critique의 `blocking[]`은 이미 어느 패키지에 대한 지적인지 말한다. 지적된 패키지만
무효화하고 나머지 분할은 유지한 채 shape을 다시 돌린다 — 전체 폐기가 아니라 부분 롤백. §8h의 선택지
1(critique를 종착역에서 내린다)보다 되돌리기 쉽고, 선택지 3(재측정)과 배타적이지 않다.

**선행 확인 완료 (2026-09-23), 그리고 이 제안은 접는다.** idol-pm-1/2의 critique 노드 4건에서
`blocking[]` 9항목을 읽었다. 패키지 특정은 통과한다 — "P5's acceptance is not satisfiable from P5's
dependency set"처럼 어느 패키지에 대한 지적인지 정확히 말한다. 그런데 유형을 나누면 부분 롤백이
닿지 않는 쪽이 더 많다:

| 유형 | 건수 | 예시 | 부분 롤백 |
|---|---|---|---|
| A. 특정 패키지의 결함 | 4 | "P6's first acceptance criterion … is unsatisfiable", "P5's acceptance is not satisfiable from P5's dependency set" | 가능 |
| B. 소유자 없는 공유물 | 3 | "**No package owns** the composition root / final assembly", "The shared admission token has no owner" | 불가 — 패키지를 **추가**하는 일 |
| C. 목표 기준 자체의 결함 | 2 | "Goal-level criterion 1 and P6's acceptance **contradict each other**", "Goal-level criterion 2 asks for something no integration step can check" | 불가 — 패키지 층이 아님 |

B는 무효화가 아니라 추가를 요구하고, C는 애초에 패키지에 대한 지적이 아니다. 부분 롤백은 9건 중
4건만 건드린다. 비용 대비 효과가 §8h의 다른 선택지보다 낫다고 말할 근거가 없다.

### 0.3b 대신 확인된 것 — 매 회차가 같은 조건에서 같은 실수를 다시 한다 (가설, 측정 필요)

`retryShape()` (`taskmanager.mjs:430`)를 읽으면 `task.spec = null`로 스펙을 통째로 버리고
`shape:N`/`critique:N`을 새로 민다. `size`만 건너뛰고 나머지 pending/failed는 전부 skipped다.
**목표 기준(goal acceptance)도 `task.spec` 안에 있으므로 같이 버려지고, 같은 요청·같은 shape
프롬프트에서 다시 만들어진다.** 다음 시도로 전달되는 것은 `feedback` 문자열 하나뿐이다.

C 유형(목표 기준 모순/검증 불가)은 그래서 회차마다 **새로 생성될 수 있다**. idol-pm-1이 3회 시도를
모두 같은 부류로 실패한 것과 정합한다. 비수렴의 원인이 "부분을 못 살려서"가 아니라 "매번 처음부터
다시, 같은 조건에서"일 가능성이 이쪽이 더 크다.

**대체 제안 — critique 지적을 유형별로 다르게 처리한다:**

- **C** → 목표 기준을 재작성 대상에서 빼고, 지적된 기준만 고쳐 다음 시도에 **고정 전달**한다.
  새로 만들어지지 않게 하는 것이 요점이다.
- **B** → "이 패키지를 추가하라"는 지시로 변환해 다음 shape에 싣는다. 0.24.0이 `CONTRACT.shape`에
  넣은 3규칙(공유 산출물 소유 / 목표 기준 검증가능성 / 패키지 acceptance 자족성)이 정확히 B와 C를
  막으려던 것인데 **아직 한 번도 측정되지 않았다**.
- **A** → 부분 롤백이 의미 있는 유일한 유형. 다만 4/9이므로 단독으로는 수렴을 바꾸지 못한다.

**선행 측정**: 위 어느 것도 코드로 옮기기 전에, 0.24.0의 계약 3규칙이 B·C를 얼마나 줄이는지
`flow: develop` 실런 한 판으로 잰다. 이미 들어가 있는 변경의 효과를 모른 채 그 위에 더 쌓는 것이
0.24.0~0.26.0에서 반복한 실수다(§8i).

## 1. 이 계획에 들어가는 것

- `reduce` 스테이지: 병렬 서브골의 산출물을 하나로 접는 leader 노드. kind별 병합 규칙 선언.
- `ask:N`의 선택지 필드(`options[]`), `investigate.unknowns[]`를 두 번째 삽입 원천으로 추가.
- `waiting_human` 상태와 메인 세션 경로(`tm_inbox` / `tm_answer`) — v0.13.0 Task 1·5·6의 범위.
- critique 지적의 유형별 처리(C: 목표 기준 고정 전달 / B: 패키지 추가 지시) — 선행 측정 결과에 따라.

## 2. 이 계획이 하지 않는 것

- v0.13.0의 `gate:human:spec`, `tm_assign`, `tm_log`, `15-spec-gate.md`. 그쪽 계획이 이미 소유한다.
- reducer를 handoff(노드 간 문자열 전달)에까지 적용하는 것. 지금 `HANDOFF_CAP`이 자르는 방식은
  병합이 아니라 절단이고, 이것을 reduce로 바꾸는 것은 별개 사안이다.
- time travel 일반화, 그리고 `retryShape`의 부분 롤백 — §0.3에서 접었다.

## 3. 순서 / TODO

외부 대조가 낸 **차이 셋**이 이 계획의 TODO다. 나머지 다섯 항목은 일치였으므로 할 일이 없다.

| # | 차이 | 상태 | 태스크 |
|---|---|---|---|
| **D1** | **reducer** — `foldChild`/`integrate`는 있고 런 안 병렬 층은 규약. `idol-plan-2` 실런이 findings 파일명 5종을 제각각 낸 것이 증거 | **진행 중 (2026-09-23)** | Task 1, Task 2 |
| **D2** | **time travel** — `waiting_human`이 설계만 있고 미구현, 롤백 개념 없음 | TODO | Task 3, 4, 5 |
| **D3** | **멱등성** — 재시도가 at-least-once인데 멱등 키가 없고, "다시 하면 같은 자리에 얹힌다"는 가정으로 때우고 있다 | TODO (부분 완화만 이 계획에서) | Task 2가 경로 고정으로 한 구멍을 막는다. 멱등 키 자체는 범위 밖 |

그 밖에:

- **선행 측정** — `flow: develop` 실런 한 판으로 0.24.0 계약 3규칙의 효과를 잰다. 성공 기준은
  report가 아니라 **critique의 B·C 유형 건수가 줄어드는가**(§0.3). D1과 병렬로 갈 수 있다.
  **진행 중 (2026-09-23, idol-pm-3)** — 로컬 세션이 잡았다. `bench.sh beta idol pm3`에
  `TEAM_ROLES='{"planning":true}'`, 기준 커밋 e1aa56f(0.26.3 + D1 wip). 새 bench 케이스 `idol`
  (`fixtures/empty` + `requests/idol.txt`)은 idol-pm-1/2의 요청을 한 줄로 고정한 것이다. 결과는
  critique 노드마다 `blocking[]`을 A/B/C로 분류해 §0.3 표와 나란히 여기에 적는다.
- **critique 유형별 처리** — 선행 측정 결과를 보고 C·B 중 남은 쪽만 손댄다.

## 4. 열린 논점

- `reduce`가 새 스테이지인가, 아니면 `gate:goal`이 그 일을 겸하는가? 겸하면 판정과 병합이 한 노드에
  섞인다 — 엔진이 그동안 지켜온 "판정 노드는 쓰지 않는다" 규칙에 어긋난다. 새 스테이지 쪽이 맞아
  보이나, 모든 kind가 reduce를 필요로 하지는 않는다(서브골 하나짜리 런에는 접을 것이 없다).
- 선택지를 누가 만드는가? `investigate`가 unknown을 낼 때 함께 내는 편이 자연스럽지만, 그러면
  조사 스테이지가 결정 권고까지 하게 된다 — 0.26.0이 "권고는 하되 답하지 말라"고 그은 선과의 거리를
  재봐야 한다.
