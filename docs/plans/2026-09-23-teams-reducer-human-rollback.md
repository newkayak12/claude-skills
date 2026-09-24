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

### 0.2 human 노드는 제안을 내고 사람이 고른다 — 그리고 그 요청은 메인 세션으로 갈 수밖에 없다 (결정됨 → **구현됨 0.28.0**)

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
| **D1** | **reducer** — `foldChild`/`integrate`는 있고 런 안 병렬 층은 규약. `idol-plan-2` 실런이 findings 파일명 5종을 제각각 낸 것이 증거 | **✅ 0.27.0 / 0.27.1** | Task 1·2 완료 |
| **D2** | **time travel** — `waiting_human`이 설계만 있고 미구현, 롤백 개념 없음 | **1단계 ✅ 0.27.3** 사람이 카드를 가져간다 / **2단계 ✅ 0.28.0, 실런 검증 0.28.7** 사람이 **고른다** — `investigate.unknowns[].options[]`, `ask:<서브골>:<시도>` 노드, `interactive` 스위치, `tm_inbox`가 선택지를 건네고 `tm_submit({key, payload:{decisions}})`가 답한다. 남음: `gate:human`, 롤백 | Task 3 ✅, Task 4·5 |
| **D3** | **멱등성 / 체크포인트 롤백** — 재시도가 at-least-once인데 멱등 키가 없고, "다시 하면 같은 자리에 얹힌다"는 가정으로 때우고 있다 | **✅ 구현 완료, 릴리스 대기** (버전 번호 없음 — 이 세션은 patch.mjs를 돌리지 않았다, `teams/<topic>` 브랜치에 커밋) | §4가 선행 측정. 멱등 키 `{run_id, node_id, attempt}` (`node_id`가 이미 대부분의 스테이지에서 attempt를 포함) — `team_submit`/`tm_submit` 모두 중복 제출을 저장된 결과를 돌려주는 no-op으로 처리(`idempotentSubmit`, broker.mjs/taskmanager.mjs). 체크포인트: `broker.mjs`가 서브골의 author 스테이지(`implement`/`draft`/`cases`/`audit`) 시도 시작 전 워크트리 HEAD+stash를 노드에 기록(`recordCheckpoint`); `retry_policy: "continue"\|"rollback"`(teamconfig.mjs, 기본 continue) — rollback은 노드 레벨(`retrySubgoal`, 서브골 하나뿐인 런으로 가드)과 패키지 레벨(`retryPackage`, 마지막 승인 커밋 또는 base로) 둘 다 구현. 테스트: test-broker.mjs·test-taskmanager.mjs에 duplicate-submit no-op, rollback resets+keeps gaps, continue unchanged, multi-subgoal fallback. |

그 밖에:

- **선행 측정** — `flow: develop` 실런 한 판으로 0.24.0 계약 3규칙의 효과를 잰다. 성공 기준은
  report가 아니라 **critique의 B·C 유형 건수가 줄어드는가**(§0.3). D1과 병렬로 갈 수 있다.
  **idol-pm-3 (2026-09-23) — 측정 전에 죽었다.** 기획 자식 런의 `setgoal`이 `PLAN` 시도 두 번 모두에서
  3회씩 spec 거절: 1·3회차는 `PLANNING_SETGOAL`의 "document subgoal" 표현대로 kind `document`
  (plan 흐름 `mixed=false`는 `planning`만 허용), 2회차는 같은 프롬프트의 "files[]에 조사자가 열 것을
  적어라"대로 `.claude/team.json`을 넣어 문서 경로 규칙에 걸림. 0.25.0/0.26.0이 들여온 프롬프트가
  검사기와 두 군데서 모순이었고, 0.26.0 이후 기획 런은 한 번도 shape에 닿지 못하는 상태였다.
  0.26.4(78b2d28)에서 수정 — kind 명시, 읽을 것은 `sources[]`. 런은 세 번째 PLAN 시도 중에 중단했다.
  **idol-pm-4 (2026-09-23, 0.26.4) — 결과: shape이 처음으로 critique를 통과했다(이전 0/4).**

  | 회차 | 판정 | blocking | A | B | C |
  |---|---|---|---|---|---|
  | idol-pm-1/2 (4회) | 4전 4패 | 9 | 4 | 3 | 2 |
  | pm-4 critique | 거절 | 2 | 1 (P6 acceptance가 P1 소유 `package.json`에 걸림) | 1 (HTTP 라우트 소유자 없음) | 0 |
  | pm-4 shape:2 | critique 전 `validateShape`가 거절 | — | — | — | — |
  | pm-4 critique:3 | **통과** (sound, problems 11) | 0 | 0 | 0 | 0 |

  읽는 법: 0.24.0 규칙 1이 먹혔다 — P1이 조립 루트·공유 계약·입장 처리를 명시적으로 소유했고, 이전
  판정에서 B로 잡히던 항목들이 사라졌다. C는 0: 목표 기준과 패키지의 모순(G7 대 P6)이 이번엔
  blocking이 아니라 problems로 내려갔다. §0.3b의 "C 고정 전달"은 이 한 판으로는 필요가 보이지 않는다.

  측정 중 드러난 우리 쪽 결함 둘, 둘 다 수정:
  - **0.27.1** — `touches` 겹침을 문자열 동치로만 봤다. P1 `src/identity/module.ts` 대 P2
    `src/identity/**`가 통과. 포함 관계로 검사.
  - **0.27.2** — 규칙 1(기반 패키지 소유)과 커버리지 검사(스토리 없는 패키지 금지)가 서로 모순. shape 1·3은
    P1에 US-7을 붙이는 거짓으로 통과했고, 사실대로 쓴 shape:2는 검사기에 거절당했다. `enables[]` 추가.

  **끝 (2026-09-23, `blocked`)**: P1·P4 수용, P2·P5는 `accept:true`·gaps 0건인데 88%로 떨어졌고,
  P3는 자기 gate 74%로 예산 소진, P6는 판정자가 gap을 명시해 떨어졌다(정상). 기획 경로가 critique를
  넘어 패키지 여섯을 실제로 빌드한 첫 런이다. 여기서 드러난 결함은 전부 우리 쪽이었다 — 0.28.1:
  - accept의 90% 하한이 판정자가 막지 않는다고 한 약점 몫까지 거절로 바꿨다. 이제 accept는 gap을
    명시했을 때만 하한에 걸린다(gate:goal은 그대로).
  - 매니저 상태 8개 파일이 P1의 제품 브랜치에 커밋됐다. macOS `/var`↔`/private/var` 표기 차이로
    `harnessPathsUnder`가 tasks 루트를 트리 밖으로 봤다. realpath로 비교.
- **critique 유형별 처리** — 선행 측정 결과를 보고 C·B 중 남은 쪽만 손댄다.

### 0.2b 실런 검증 — idol-beta-ask1 (2026-09-24)

`ask`를 실모델로 처음 돌린 판입니다. `TEAM_JSON='{"roles":{"planning":true},"interactive":true}'`,
`beta/idol` 픽스처. **경로 전체가 닫혔습니다:**

| 관문 | 결과 |
|---|---|
| `interactive`가 team.json → task → 자식 런까지 전파 | ✅ `CHILD dispatch:PLAN:1 interactive=True flow=plan` |
| `setgoal`이 기획 서브골을 펼치고 `reduce`가 함께 섬 | ✅ U1~U4 + `reduce` (0.26.0 investigate와 0.27.0 fold가 한 실런에 처음 공존) |
| **`investigate`가 실모델에서 `options[]`를 채움** | ✅ 7문항, 각 3후보, 후보마다 결과 문장, 문항마다 소유자 |
| 런이 `waiting_human`으로 멈춤 | ✅ `ask:U1:1=waiting_human`, 대기 중 컴퓨트 0 |
| `tm_inbox`가 메인 세션에 카드를 건넴 | ✅ questions·options·owner·briefing_path |
| `tm_submit({key, payload:{decisions}})` | ✅ `state: done` |
| **답이 `draft` 브리핑에 확정 규칙으로 도착** | ✅ "Decided by a person — these are settled, write them as rules, not as open questions" |

질문 내용도 허수가 아니었습니다 — 1인 구매 상한, 환불 스케줄, 결제 홀드 시간, 선예매 등급 구조,
200k/s가 실제 RPS인지, SLA, 안티봇. **idol-pm-2가 지어내거나 Non-Goals로 밀어냈던 바로 그 규칙들입니다.**

**드러난 결함 하나 (0.28.7에서 수정)**: 문항 7개의 소유자가 5종(PO / 용량 리드 / Legal·Finance /
SRE / Security)인데 전부 한 카드에, 첫 번째 사람 앞으로 갔습니다. 그 카드는 한 사람이 답할 수
없습니다 — §0'가 **일치**로 적어 둔 원칙("명명된 소유자를 갖는 재개 가능 단계로 다루지 않으면
승인자가 잠든 첫날 패턴이 무너진다")을 우리가 어기고 있었던 것이고, 실런 없이는 보이지 않았습니다.
`openAsk`가 소유자별로 카드를 쪼개고 `draft`가 전부를 기다립니다.

## 4. D3 선행 측정 (2026-09-24) — continue의 실제 패턴은 "같은 실수 반복"이 아니라 수렴이었다

§0.3b의 가설("매 회차가 같은 조건에서 같은 실수를 다시 한다")은 `retryShape`(패키지 그래프 전체 폐기)를
근거로 세운 것이었다. 그런데 D3가 다루는 것은 그보다 좁은 재시도 - 한 서브골의 `implement`가 자기
gate에 거부당해 같은 워크트리 위에서 다시 도는 것(`retrySubgoal`, continue가 이미 기본이자 유일한
정책) - 이고, 이 재시도가 실제로 같은 실수를 반복하는지는 측정된 적이 없었다. 두 실런의 워크트리를
읽었다(읽기 전용 - `.harness-tasks/*/worktrees/*/.teams_output/broker/runs/*.json`).

**awake-beta-ref1, P1 (`implement:U1`)** - gate가 3회 모두 다른 이유로 거부/승인했고 숫자가 매 회
올랐다: 52%(1차, "표면적으로만 통과") → 60%(2차, "swift test/build 통과하지만 여전히 부족") →
78%(3차, **accept**, "명시된 모든 acceptance bullet을 직접 증거로 확인"). 세 번의 implement가 같은
워크트리 위에 이어 붙었고(continue), gate의 피드백을 실제로 반영해 수렴했다.

**idol-beta-pm4, P3 (`implement:U1`)** - 74%(1차) → 78%(2차, 개선) → 3차는 gate가 아니라 **implement
자체가 실패**(`test:U1:3`/`gate:U1:3`는 unreachable, "구현 자체가 재시도 예산 없이 실패")해서 budget
소진으로 끝났다. 같은 실수의 반복이 아니라, 개선 중이던 시도가 (이유가 기록에 없는) implement 단계의
실패로 끊긴 것이다.

**읽는 법**: 표본 둘 다 "같은 조건에서 같은 실수"가 아니라 **점진적 수렴**을 보였다 - gate의 피드백이
`feedback` 문자열로 다음 시도에 전달되고(`retrySubgoal`), 모델이 그걸 실제로 반영했다. P3가 예산을
다 쓴 것은 반복된 실수가 아니라 개선 중이던 흐름이 별개 원인(구현 단계 자체 실패)으로 끊긴 것이라 -
rollback이 있었어도 74%/78%를 만든 작업을 지우고 처음부터 다시 시키는 것이 더 나았을 근거가 없다.

같은 태스크 레벨에서 다른 실패 모드 하나도 보인다: `dispatch:QA:1`이 gate 거부가 아니라 **구조적
붕괴**(`reduce is unreachable`, 7 failed/10 unreachable)로 끝났다 - 이런 경우는 "이어 붙이기"가 무엇을
이어 붙이는지조차 불분명해서, rollback이 의미를 가질 수 있는 쪽은 오히려 이런 붕괴 케이스일 가능성이
있다 - 이번 표본에 없어서 측정하지 못했다.

**결정과 근거**: `retry_policy` 기본값은 **`continue`** (지금 동작 그대로). 두 표본 모두 continue가
실제로 수렴하는 것을 보여줬고, rollback이 우월하다는 근거가 없다 - 있지도 않은 문제를 기본값으로
고치는 것은 §8i가 반복하지 말라고 적어 둔 실수다. `rollback`은 옵션으로 넣는다: 붕괴형 실패(구조적
unreachable, 반복된 동일 gap)를 겪는 팀이 켜서 쓸 자리이고, 다음 측정이 그 경우를 표본에 넣을 때
기본값을 재검토한다.

## 5. 열린 논점

- `reduce`가 새 스테이지인가, 아니면 `gate:goal`이 그 일을 겸하는가? 겸하면 판정과 병합이 한 노드에
  섞인다 — 엔진이 그동안 지켜온 "판정 노드는 쓰지 않는다" 규칙에 어긋난다. 새 스테이지 쪽이 맞아
  보이나, 모든 kind가 reduce를 필요로 하지는 않는다(서브골 하나짜리 런에는 접을 것이 없다).
- ~~선택지를 누가 만드는가?~~ **0.28.0에서 `investigate`로 정했다.** 0.26.0이 그은 선("권고는 하되
  답하지 말라")과 모순되지 않는다: 고를 수 있는 것을 **나열하는 것**은 여전히 조사이고, 계약에도
  그렇게 적었다("naming what could be chosen is still research"). 답하는 것은 카드를 받은 사람이다.
  0.26.0이 이미 unknown에 소유자를 달게 해 두었으므로, 후보만 더하면 그 사람에게 필요한 형태가 된다.
