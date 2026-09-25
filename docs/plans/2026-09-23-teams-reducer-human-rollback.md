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
`openAsk`가 소유자별로 카드를 쪼개고 `draft`가 전부를 기다립니다. U2·U3·U4 카드에서도 같은
모양이 반복됐습니다 — 각각 5문항/5명, 7문항/5명, 6문항/5명. **네 장 전부 잘못 배송돼 있었습니다.**

**드러난 결함 둘 (미수정)**: 형제 서브골이 **같은 질문을 각자 묻습니다.** 팬클럽 등급 구조가 U2·U3에,
구매 한도의 식별 단위가 U2·U3에, SLA/용량이 U1·U4에 중복으로 올라왔습니다. 각 `investigate`가
독립적으로 조사하므로 당연한 결과인데, 사람 입장에서는 **같은 결정을 두세 번 요구받습니다.**
`reduce`는 산출물 층의 fold이고 질문 층에는 fold가 없습니다. 선택지 셋:

1. 형제 investigate가 끝난 뒤 `ask`를 한 번만 열고 질문을 그때 합친다 — 지금 구조(investigate 제출
   시점에 여는 것)를 바꿔야 하고, 첫 서브골이 형제를 기다리게 되어 병렬성을 잃는다.
2. 새 카드를 열 때 **이미 열렸거나 답해진 질문과 겹치는 것을 떨어뜨린다** — 겹침 판정이 문자열이
   아니라 의미 수준이라 엔진이 판정할 수 없다. 모델 호출이 필요하다.
3. 그대로 두고, 답한 결정이 형제의 briefing에 실리는 것에 의존한다. 실제로 U3는 U1의 결정을
   **읽고** "이미 정해진 2–4 범위 안에서 정확한 수"를 물었다 — 중복이 아니라 **좁히기**였다.
   나머지(등급 구조)는 진짜 중복이다.

3번이 부분적으로 이미 동작하고 있다는 것이 이 런의 관찰이다. 어느 쪽인지는 카드 수를 세어
판정한다 — 0.28.7의 소유자 분할이 카드 수를 ~4배로 늘리므로, 중복 비율이 그 위에서 얼마나
아픈지 먼저 잰다.

### 0.2c 멈춘 런을 뚫으며 나온 것 (2026-09-25)

`idol-beta-ask1`의 U2·U3·U4 카드를 답하면서 나온 두 가지. **하나는 제 오진이었고 기록해 둡니다.**

**오진 — `mergeOnto` 경합이 아니었다.** 답 셋이 `done`을 반환받았는데 디스크에는 `waiting_human`으로
남아 있었습니다. `mergeOnto`가 `pending`만 보호하고 `waiting_human`은 보호 목록에 없으니 드라이버의
낡은 복사본이 답을 덮었다고 판단하고 `NOT_ADVANCED` 집합으로 고쳤습니다. **틀렸습니다.** 0.28.4가
이미 더 근본적으로 고쳐 두었습니다 — 매니저는 자식 런 파일을 아예 쓰지 않고 handoff 큐에 넣고,
브로커가 정상 제출 경로(`computeSubmitResult` + `finishNode`)로 적용합니다. 그쪽 주석이 이것을
"the 0.27.3 bug this replaces"라고 부릅니다. 제 변경은 되돌렸습니다. 교훈은 익숙한 것이었습니다 —
증상이 아는 버그와 닮았다고 원인이 같은 것은 아니고, 이 저장소는 병렬 세션이 같은 파일을 고치고 있어
**내 마지막 기억이 아니라 현재 코드를 먼저 읽어야 한다.**

**진짜 구멍 (0.29.1에서 수정).** 큐를 비우는 것은 브로커이고, 브로커는 드라이버 안에서만 돌고,
`tm_submit`의 드라이버 되살리기는 **큐에 넣는 그 호출에서만** 발동하며(`alreadyQueued`가 같은 카드의
재제출을 옳게 거부한다), `serviceDeadDriver`는 런이 `waiting_human`이면 일찍 빠져나간다. 넷을 겹치면:
드라이버가 드레인 전에 죽는 순간 **접수된 답이 적용될 경로가 남지 않는다.** "멈춘 런에 드라이버가 있을
이유가 없다"는 적용 대기 중인 답이 생기기 전까지만 참이다. 수정은 한 조건:

```js
if (cs.state === 'waiting_human') {
  if (!peekHumanActions(child.cwd, child.run_id).length) return false;  // 대기 중 컴퓨트 0은 유지
} else if (cs.state !== 'running') return false;
```

멈춰 있던 그 런에서 검증했다 — 새 드라이버의 첫 폴에서 큐가 비고, 카드 4장이 `done`, draft가 그 결정
위에서 돌았다.

**남은 것**: 0.28.7의 소유자 분할은 유닛 테스트만이다. 이 런은 그 이전 코드로 돌았으므로
(카드 4장 전부 소유자 5종씩) 분할 자체는 다음 실런이 검증한다.

### 0.2d 같은 런을 끝까지 밀며 나온 것 (2026-09-25, 0.29.2)

`idol-beta-ask1`은 멈출 때마다 결함을 하나씩 냈습니다. **셋 다 추측이 아니라 측정입니다.**

**1. 0.28.7 소유자 분할이 실모델에 닿았다 (검증 완료).** U4의 draft가 두 번 실패해 3회차 조사가
돌았고, `ask:U4:3 / 3b / 3c / 3d / 3e` — 한 스테이지에서 소유자별 5장이 열렸습니다. 유닛 테스트만
있던 항목이 이것으로 실런 검증됐습니다.

**2. 재시도가 이미 정해진 것을 다시 물었다.** `ask:U4:1`에서 6문항을 답했는데, 3회차 조사가 낸
6문항 중 **2건이 글자까지 동일**했습니다. 나머지 4건은 같은 결정의 재표현이었습니다
(`...(seats or GA capacity)` vs `...(seats or general-admission capacity)`). 원인: 재시도는 체인을
새 deps로 다시 세우므로 폐기된 `ask` 노드가 `upstream` 범위 밖이고, 새 시도의 investigate는 무엇이
정해졌는지 알 방법이 **구조적으로** 없었습니다. 고칠 곳이 둘이었던 이유가 여기 있습니다 —
문자열 필터는 2/6만 잡고, 재표현은 **질문을 쓰는 스테이지가 알아야** 막힙니다:

- `openAsk`: 같은 `ask_owner`의 이전 시도에서 답해진 질문을 떨어뜨린다(정확 일치. 엔진이 직접 저장한
  문자열끼리라 판단이 필요 없다).
- `nodeBriefing`: `prior_decisions`를 새 시도의 **모든** 스테이지에 싣고, `CONTRACT.investigate`가
  "그것은 finding이다, 재표현해서도 다시 묻지 말라"고 말한다.

**3. 카드 5장에 티켓 키 1개.** 소유자 분할의 부작용입니다. 서브골 키가 모호해졌고 `tm_submit`은
`waiting[waiting.length - 1]`로 **마지막 대기 카드를 골라** 해결했습니다 — 한 소유자의 답이 다른
소유자의 질문에 조용히 적용됩니다. 주소 체계는 이미 있었습니다(키 3번째 칸이 node id를 받습니다);
없던 것은 **모호하지 않은 키**였습니다. `tm_inbox`가 `ask` 카드를 node id로 키잉하고, 핀된 저작
카드는 서브골 키를 유지하고(서브골당 하나뿐이므로), 모호한 키는 쓸 수 있는 키들을 알려주며 거부합니다.

**이 런이 낸 결함 총계: 5건** (§0.2b 1건, §0.2c 1건, 여기 3건 중 2·3). 전부 유닛 테스트 통과
상태에서 나왔습니다. `ask` 경로는 0.28.0에서 테스트 13개로 "동작한다"고 판정됐는데, 실런 한 판이
그 위에서 **네 개를 더** 찾았습니다.

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

- ~~`reduce`가 새 스테이지인가, 아니면 `gate:goal`이 그 일을 겸하는가?~~ **결정됨 (2026-09-24
  reducer-registry 세션).** 코드를 다시 읽으니 이 질문은 이미 답이 나 있었다: `expandSubgoals`
  (`graph.mjs`)의 `if (subgoals.length > 1)` 분기는 kind를 전혀 보지 않는다 — `reduce`는 서브골이
  둘 이상이면 code(`subgoal`)든 document든 무조건 삽입되고, `gate:goal`은 항상 별도 노드(`gate`
  스테이지, `subgoal_id: null`)로 남아 판정과 병합이 한 번도 섞인 적이 없다. `test-broker.mjs`의
  기존 코드 픽스처(`implement:U1:2`/`implement:U2:2`와 나란히 `reduce:2`가 있는 회귀 테스트, "an
  exhausted critique retry budget…")가 이미 이것을 검증하고 있었다 — 이 세션이 찾아낸 게 아니라
  진작부터 참이었던 사실이다. 이 세션이 감사에서 "graph.mjs reduce node ~1082 for document runs"라고
  적은 것은 과소평가였다: `reduce`의 주석과 예시가 document(특히 `investigate` findings 파일)
  위주라 그렇게 읽혔을 뿐, 게이팅 조건 자체는 늘 kind에 무관했다. **결정: 새 스테이지 쪽을 그대로
  유지한다 — 이미 그렇게 동작하고 있고, "판정 노드는 쓰지 않는다" 규칙을 어긴 적이 없다.** 이번
  세션은 이 자리(서브골이 둘 이상인 모든 run의 `reduce` 노드)에 결정론적 sibling write-scope 검사
  (item 2 — 아래)를 얹었다: code kind가 index/registry/README 같은 공유 산출물에 부딪히는 경우도
  document가 heading을 공유하는 경우와 같은 자리, 같은 코드 경로에서 잡힌다. 별도의 code 전용 분기는
  두지 않았다 — 이미 하나의 자리였다.
- ~~선택지를 누가 만드는가?~~ **0.28.0에서 `investigate`로 정했다.** 0.26.0이 그은 선("권고는 하되
  답하지 말라")과 모순되지 않는다: 고를 수 있는 것을 **나열하는 것**은 여전히 조사이고, 계약에도
  그렇게 적었다("naming what could be chosen is still research"). 답하는 것은 카드를 받은 사람이다.
  0.26.0이 이미 unknown에 소유자를 달게 해 두었으므로, 후보만 더하면 그 사람에게 필요한 형태가 된다.

## 5. 이 세션이 구현한 것 (2026-09-24, reducer-registry)

D1("reducer는 있지만 선언되지 않았다")을 마저 닫는다. §0.1이 지적한 세 자리 — `foldChild`의 인라인
`changed_files` 합집합, 런의 `goal_verdict` AND-consensus, 그리고 §1이 "이 계획에 들어가는 것"으로
적어 둔 "kind별 병합 규칙 선언" — 를 `teams/mcp/reducers.mjs` 하나로 옮겼다.

- **선언된 reducer 레지스트리** (`reducers.mjs`): 계획이 이름댄 여섯 병합(`union`,
  `concat-dedup`, `and-consensus`, `min`, `max`, `last-by-attempt`) 각각이 순수 함수이고, 전부
  `applyMerge`를 통해서만 불린다 — 입력을 `(node_id, attempt)`로 dedupe하고 정렬한 뒤에야 병합
  함수에 넘기므로, 어느 병합이든 개별적으로 조심하지 않아도 순서 무관·재입력 멱등을 공짜로 얻는다.
  `test-reducers.mjs`의 property 테스트(셔플 + 이중 폴드 → 동일 결과)가 이것을 검증한다. kind별
  테이블(`REGISTRY`)은 `subgoal`/`document`/`planning`/`qa`/`planning-audit` 다섯을 공유
  기본값(`DEFAULT_FIELDS`) 위에 선언한다.
- **재사용**: `graph.mjs`의 `goalConsensus`(라운드 내 형제 판정자 간 합의)와
  `taskmanager.mjs`의 `foldChild`(자식 런의 `changed_files` 합집합)가 이 레지스트리를 통하도록
  바뀌었다 — 인라인 `Set`/`Math.min` 리터럴이 사라졌다.
- **sibling write-scope 검사** (item 2, `writeScopeFindings` + `computeWriteScope`): 서브골의
  선언(`files[]`, `title`/`acceptance[]`의 heading 언급)과 실제 산출물(각 서브골의 author 스테이지
  결과 `changed_files`)을 대조하는 결정론적 함수. `reduce` 노드가 `done`으로 끝나는 순간
  (`broker.mjs`의 `finishNode`) 그 결과에 `write_scope`로 기록되고, `foldChild`가 `set_findings`로
  끌어올리며, `nodeBriefing`이 `reduce`와 `gate:goal` 양쪽 브리핑에 노출한다 — LLM `reduce` 패스가
  같은 것을 놓쳐도 디스크에 남는다.
- **매니저 층 reduce** (item 4, `foldPackageHistory`): 패키지 하나가 연 모든 `dispatch` 시도를
  같은 레지스트리로 접는다. `accept` 필드만은 레지스트리 기본값(형제 합의용 and-consensus) 대신
  `last-by-attempt`로 명시적으로 덮어쓴다 — 패키지의 재시도 이력은 형제가 아니라 순차 이력이므로,
  1회차의 거절이 3회차의 수용을 무효로 만들면 안 된다는 것이 이 세션이 명시적으로 갈라 둔 지점이다.
  `integrate` 노드가 `done`이 되는 순간 `n.result.package_fold`에 기록되고, `gate:goal`/`report`
  브리핑의 "## Packages" 절이 각 패키지 옆에 접힌 이력을 보여준다.
- **비용(cost) 필드**: 어느 계약도 아직 코드 노드별 비용을 보고하지 않는다 — 레지스트리에는
  `last-by-attempt`로 이름만 올려 두었다("있으면"이라는 item 4의 표현대로). 실제로 리포트하는
  계약이 생기면 레지스트리 변경 없이 그대로 접힌다.
- **미룬 것**: heading 소유권은 여전히 `title`/`acceptance[]`의 자유 텍스트에서 정규식으로 추출한다
  — 구조화된 `owns` 필드는 spec 스키마 변경이라 이번 세션 범위 밖으로 남겨 두었다. 멱등 키
  자체(D3, 노드 재시도의 at-least-once 재현) 역시 원래 계획대로 범위 밖이다.

테스트: `teams/scripts/test-reducers.mjs`(신규, 27개) + `test-graph.mjs`/`test-broker.mjs`/
`test-taskmanager.mjs`에 추가한 통합 테스트. 전체 `node --test teams/scripts/test-*.mjs`
652개 통과, `python3 scripts/validate_plugins.py` 통과.
