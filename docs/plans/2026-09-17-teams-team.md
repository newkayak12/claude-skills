# teams (team) — Team / TeamLeader / Task / TaskLeader 구체화 (검토용 초안)

> 상태: **검토용**. 코드 변경 없음. 2026-09-17.
> 대상: `teams` 0.9.0 위에 얹는 다음 라운드.

## 0. 계보

```
harness → graph → teams   (계보. graph는 harness + MULTI_AI_VENDOR, teams는 그 다음 라인이었다)
```

- **계보이지 종속이 아니다.** harness → graph → teams는 세 플러그인이 어디서 갈라져 나왔는지를
  보여줄 뿐, 지금 코드에서 teams가 graph 위에서 도는 게 아니다. `graph-beta` → `teams` 리네임
  (`graph_*` 도구도 `team_*`로)과 함께 셋은 **완전히 독립된 형제 플러그인**이 됐다 — teams는
  더 이상 "graph의 beta 라인"이 아니고, 자기 엔진(`teams/mcp/graph.mjs`)·자기 도구 이름공간
  (`team_*`)·자기 실행 경로(`.teams_output/broker/`, `~/.harness/tasks/`)를 그대로 갖되 graph를
  런타임에 불러오거나 의존하지 않는다. 설치 시 상호배제도 이 독립성 위에서 다시 봐야 한다(§14
  결정 기록 참고).
- **graph 엔진은 그대로 둔다.** 노드 체인, 라우팅, 게이트, 리페어 전부 손대지 않는다 — teams는
  자기 사본 위에서 같은 원칙을 지킨다는 뜻이다.
- **task-manager는 MCP 서버로 운용한다.** 지금처럼 `task-manager` 서버 하나. 이번 라운드는 그 위에
  *역할(Role)*, *티켓 워크플로*, *TaskLeader 프로세스*, *가시성 도구* 네 가지를 얹는다.

## 1. 가이드 11항목 ↔ 현재 상태 델타

| # | 가이드 | 현재 (0.9.0) | 필요한 일 |
|---|---|---|---|
| 1 | develop 편중 → 기획 / develop / QA 분리 | `KINDS = {subgoal, document}`. document(draft→review→gate)가 기획의 반쪽 | `planning` kind (draft→**revise**→gate), `qa` kind (**cases→execute**→gate). `test` 노드 없음 |
| 2 | 역할별 페르소나·스킬·MCP 적극 사용 | `KINDS.skills`, `GRAPH_STAGE_SKILLS`, `GRAPH_STAGE_MOUNTS` 메커니즘 있음. develop/document만 채워짐 | 역할별 persona/skills/mounts 테이블 채우기 (§3) |
| 3 | 엔진 유지 + taskmanager | 있음. `size→shape→critique→[dispatch→accept]×P→integrate→gate:goal→report` | 유지 |
| 4 | JIRA식 워크플로·상태 관리 | 노드 상태(pending/running/done/failed/…)만 있음. 티켓 개념 없음 | **Ticket 레이어** — 엔진 상태에서 *파생*되는 워크플로 상태 (§4) |
| 5 | task 순서 수립·할당 | `shape`가 `deps[]`, `touches[]` 산출. 우선순위·역할·동시성 캡 없음 | shape 출력에 `role`, `priority` 추가, `max_parallel_teams` (§5) |
| 6 | 팀이 역할 받아 orchestration MCP 사용 | 자식 run = 독립 워크트리 + headless driver. mounts는 stage 기준만 | 역할 기준 mounts 테이블 (§3) |
| 7 | main 컨텍스트 사용 안 함, 분할마다 subagent | 노드는 fresh agent, 패키지는 driver 프로세스. **단 main이 `tm_next` 폴링 루프를 돈다** | **TaskLeader는 항상 별도 프로세스, main은 절대 leader가 아님.** inline 옵션 제거. main은 `tm_open` + 읽기 + inbox 요청만 (§6) |
| 8 | plan/setgoal/impl/qualitygate → EPIC/STORY/TASK | 매니저 노드가 이미 그 4단계. 이름·계층 개념만 없음 | 노드 추가 없이 **phase 라벨 + 티켓 키** 매핑 (§4, §6) |
| 9 | 할당 AGENT가 보고 받고 검수 | `accept:Pn` + `integrate` + `gate:goal` (2인 합의, attacks[]) | 유지. 반려 = 티켓 REJECTED→READY 전이로 노출 |
| 10 | AI DRIVEN | — | 위 전부의 결과 |
| 11 | TaskLeader가 사용자에게 질문, flag 없으면 자동 | 없음 | **사용자 = `vendor: human` 노드**, 항상 그래프에 있음. flag 없으면 SKIPPED(default 적용, 기록 남음, 보드에 보임). flag 있으면 멈춤 (§7) |

핵심 판단: **새 엔진이 아니라 새 어휘와 새 창(窓)이다.** 노드 그래프는 그대로 두고, 그 위에
티켓·역할·질문·보드를 얹는다.

## 2. 용어와 프랙탈 구조

```
사용자 명령
  └─ EPIC        = tm task (한 요청)            소유: TaskLeader
       ├─ STORY  = package Pn (역할 1개, 워크트리 1개)   소유: Team (TeamLeader가 드라이브)
       │    ├─ TASK = subgoal Un (자식 graph run의 서브골)  실행: worker 노드 (vendor/model)
       │    └─ TASK
       └─ STORY  …
```

| 개념 | 정체 | 실행 형태 | 프로토콜 |
|---|---|---|---|
| **TaskLeader** | EPIC 1개의 매니저 | headless driver 프로세스 1개 (`tm_open`이 spawn) | plan → setgoal → impl(할당) → qualitygate(검수) |
| **Team** | 역할(planning/develop/qa) + STORY 1개 | 자식 graph run + 전용 워크트리 | 같은 4단계를 graph 엔진이 수행 (plan→setgoal→critique→체인→gate:goal→report) |
| **TeamLeader** | 그 자식 run의 driver | headless driver 프로세스 (지금의 package driver) | TASK 분할(=setgoal), 할당(=routing), 검수(=gate) |
| **worker** | 노드 1개 | fresh agent (claude / codex) | 자기 stage 하나 |

### EPIC 흐름 (결정 2026-09-17 — 논점 1 = B안 + 기획 분할 + 크로스 검수)

한 보드 안에서, Team 사이에 선후가 있다. 1순위는 TaskLeader의 **사용자 프롬프트 분해·분배**이고,
그 안에서 기획이 정리·분할하고, 개발이 만들고, QA가 검증하고, 기획이 다시 대조한다.

```
TaskLeader  size → decompose        사용자 프롬프트 → 이 EPIC에 어떤 Team이 어떤 순서로 필요한지 (coarse)
planning    draft → revise → gate   PRD + 기능 단위 분할(user stories)          ─┐ 40-stories에 STORY 초안 생성
human       gate:human:spec         사람 승인 (없으면 SKIP·기록)                  │
TaskLeader  shape → critique        user stories → develop STORY (touches·deps·acceptance) — 기술 소유권 기준
develop     [dispatch → accept] × Pn   각자 워크트리                                │
TaskLeader  integrate                                                              │
qa          cases → execute → gate  통합 트리에서. 결함 → 결함 STORY 발행(§5b) → 개발로 ┘ (qa_rounds 캡)
planning    audit → gate            크로스 검수: PRD ↔ 결과물 대조. 미충족 → STORY 발행(reporter: planning)
TaskLeader  gate:goal → report
```

- **분할은 두 번, 기준이 다르다.** 기획은 *기능*으로 나눈다(사용자에게 무엇이 되어야 하나).
  shape는 그것을 *소유권*으로 묶는다(어느 트리·어느 팀이 건드리나). 기획 story 하나가 develop STORY
  둘로 갈라지거나, 둘이 하나로 합쳐질 수 있다 — 매핑은 20-shape.md에 표로 남는다.
- **STORY 발행자는 셋**: shape(초기 분할), qa(결함), planning(크로스 검수 미충족). 모두 같은
  EPIC, 같은 보드, `reporter` 컬럼만 다르다.
- planning Team은 EPIC 안에서 **두 번** 돈다. 두 번째는 저작 체인이 아니라 `audit → gate` 체인 —
  읽고 판정만, 파일 변경 없음. 같은 Team 정체성(페르소나·스킬)이지만 run은 새로 연다.
- `team.json.roles`로 planning/qa를 끄면 그 단계가 생기지 않는다. 둘 다 끄면 지금의 0.9.0 흐름과
  같다 — 하위 호환.

**프랙탈 규칙**: 모든 레벨이 *plan → setgoal → impl → qualitygate*를 반복한다. TeamLeader가
STORY를 `plan`에서 **L**로 측정하면, 자기 STORY 아래에 **sub-EPIC**을 연다(`tm_open`을 자식이
호출, `parent: {task_id, package_id}` 기록). 깊이 캡 `max_depth` 기본 **2** — 0.8.0에서 컨텍스트
중계로 죽은 교훈: 재귀는 프로세스 트리로만, 컨텍스트로는 절대 올리지 않는다.

**어휘 충돌 주의**: 현재 코드에서 "task" = tm task(요청 전체)인데 JIRA에서 TASK = 최소 단위.
문서·도구 이름에서는 **EPIC / STORY / TASK**를 쓰고, `task_id`는 EPIC의 id로 유지한다
(호환 유지, 리네임 안 함).

## 3. 역할(Role) = kind 확장

`graph.mjs`의 `KINDS`에 두 항목 추가. 엔진은 `kind`를 읽어 체인을 펼칠 뿐이라 로직 변경 없음.

| role / kind | chain | reasoning 단계 | 무엇이 "완료"인가 |
|---|---|---|---|
| `subgoal` (develop) | implement → test → gate | — | 파일 변경 + 명령 검증 (현행) |
| `planning` (기획) | draft → **revise** → gate | revise | 문서 산출물. revise는 *다른 정체성*이 퇴고 — 독자 관점으로 다시 쓰기, 주장→근거 확인. review(판정)와 다르게 **수정 권한 있음** |
| `qa` | **cases → execute** → gate | — | cases: 시나리오/케이스 명세(md). execute: 통합 트리에서 실행, 결함 리포트. `test` 노드 없음 — execute 자체가 테스트 |
| `planning-audit` (기획 크로스 검수) | **audit** → gate | audit | QA 뒤. PRD·user stories ↔ 통합 결과물·QA 리포트 대조. 산출물은 verdict + 미충족 항목 → STORY 발행. 파일 변경 없음 |

### 페르소나 · 스킬 · MCP

| role | setgoal 페르소나 (3인) | 단계 스킬 | 단계 MCP mounts |
|---|---|---|---|
| planning | PO(가치·범위), 도메인 전문가(용어·규칙), 구현 리드(실현 가능성 독자) | draft: `pm:prd-development`, `pm:user-story`, `write:doc-coauthoring` / revise: `write:writer-verification`, `think:devils-advocate` / gate: `think:devils-advocate` | plan: sequential-thinking / draft: think-tool / gate: mcp-reasoner |
| develop | 구현자, 불신하는 테스트 엔지니어, 내년의 유지보수자 (현행) | 현행 (`develop:clean-code`, `develop:testing-workflow`, `completion:verification-before-completion`) | 현행 |
| qa | 사용자 대변 QA, 릴리스 매니저(리스크), 악의적 입력자 | cases: `develop:test-master`, `develop:scenario-director` / execute: `develop:scenario-actor`, `completion:verification-before-completion` / gate: `think:devils-advocate` | cases: sequential-thinking / execute: 없음(실행) / gate: mcp-reasoner |

- 스킬 부재 시 규칙은 현행 유지: "조용히 건너뜀, `skills_used: ["none"]`".
- `qa` STORY는 **항상 develop STORY에 `deps`** 를 갖고, 워크트리는 자기 것이 아니라
  **통합 워크트리**(repair 패키지와 같은 방식). 자기 트리에서 QA하면 통합 결함(seam)을 못 본다.
  `src/` 쓰기 금지, `test/`·리포트만 쓰기 — 위반은 `changed_files_verified`가 잡는다.
- `planning` STORY 산출물은 다음 STORY의 컨텍스트로 전달(현행 "dependency reports as context").

### Entry 스킬

`orchestrate`(자동) / `develop` / `document` 에 **`plan`(기획)**, **`qa`** 추가. 각각 `flow` 핀만
다르다. `document`는 유지 — 기획이 아닌 일반 문서(설계노트·가이드).

## 4. Ticket 레이어 — JIRA식 워크플로

**원칙: 티켓 상태는 엔진 상태의 순수 함수.** 두 번째 진실 원천을 만들지 않는다.
`board.jsonl`은 전이 *이벤트 로그*(append-only)이고, `tm_board`는 엔진 파일을 읽어 파생한다.

### 키

```
E-<task8>            EPIC   (tm task)
E-<task8>/P1         STORY  (package)
E-<task8>/P1/U2      TASK   (자식 run의 subgoal)
E-<task8>/P1/E-<sub8> sub-EPIC (프랙탈)
```

### 워크플로 상태

```
BACKLOG ─→ READY ─→ IN_PROGRESS ─→ IN_REVIEW ─→ DONE
              ↑          │             │
              │          ├→ WAITING_USER      (human 노드 ready, §7 — v0.13.0 전까지 도달 불가, 아래 참고)
              │          ├→ WAITING_CAPACITY  (쿼터)
              │          └→ BLOCKED           (driver 사망·예산 소진)
              └── REJECTED ←──────────┘        (검수 반려, 피드백 동봉 → READY)
CANCELLED / UNREACHABLE                        (상류 실패로 도달 불가)
```

### 엔진 상태 → 티켓 상태 매핑 (파생 함수)

| 레벨 | 엔진 근거 | 티켓 상태 |
|---|---|---|
| STORY | `dispatch:Pn` 존재(§주1), `unmetDeps()` 비어있지 않음 | BACKLOG |
| STORY | `dispatch:Pn` 존재, `unmetDeps()` 빈 배열 (아직 `pending`) | READY |
| STORY | `dispatch:Pn` running, driver.alive | IN_PROGRESS |
| STORY | 자식 run complete, `accept:Pn` pending/running | IN_REVIEW |
| STORY | `accept:Pn` done, accept:true | DONE |
| STORY | `accept:Pn` failed → `tm_retry` 전 | REJECTED (gaps 동봉) |
| STORY | `waiting_capacity` | WAITING_CAPACITY |
| STORY | driver 사망, 재시작 예산 소진 | BLOCKED |
| STORY | 최신 attempt(`dispatch`/`accept`)가 `skipped`(재구성으로 대체됨) | CANCELLED |
| STORY | 최신 attempt(`dispatch`/`accept`)가 `unreachable`(상류 실패로 도달 불가, `settleFailure`) | UNREACHABLE |
| STORY / EPIC | ready인 `vendor: human` 노드가 있음 (`waiting_human`) | WAITING_USER — 티켓 담당 "you" (§주2: 이번 라운드의 코드 경로엔 없음, v0.13.0에서 human 노드가 생기면 도달) |
| TASK | 자식 run 노드 상태 그대로 | implement/draft/cases running → IN_PROGRESS, test/revise/execute → IN_REVIEW, gate done → DONE |
| TASK | 자식 run 노드가 `skipped` | CANCELLED |
| TASK | 자식 run 노드가 `unreachable` | UNREACHABLE |
| EPIC | shape 전 → READY / dispatch 진행 → IN_PROGRESS / integrate·gate:goal → IN_REVIEW / report → DONE | — |
| EPIC | `runState(task).state === 'blocked'`(재시도 예산 소진 등) | BLOCKED |

전이마다 `board.jsonl`에 `{ts, key, from, to, by, reason}` 한 줄. `by`는 노드 id
(`accept:P2:1`) 또는 `user`.

- **§주1**: `dispatch:Pn` 노드는 shape가 성공하는 순간 `expandPackages`가 모든 package에 대해
  한 번에 만든다(deps 있는 패키지도 포함) — "dispatch 미생성"은 이 코드에서 일어나지 않는다.
  BACKLOG/READY는 노드 존재 여부가 아니라 `unmetDeps()`(이미 `graph.mjs`가 내보냄)로 갈린다.
  deps 없거나 전부 done인 패키지는 즉시 READY로 보이고(다음 `tm_next` 폴링에서 바로 `dispatch`가
  열려 IN_PROGRESS로 넘어가므로 실제로는 매우 짧게 관측되는 창), deps 남은 패키지는 BACKLOG.
- **§주2**: `WAITING_USER`는 human 실행자(`ask`, `gate:human`, `waiting_human`, v0.13.0)가 있어야
  만들어지는 상태다. 그 전까지는 존재하지 않는 기능의 자리를 비워두지 않고, 이 상태를 반환하는
  코드 경로 자체가 없다.
- CANCELLED(재구성으로 폐기)·UNREACHABLE(상류 실패로 도달 불가)는 이 장의 워크플로 다이어그램에
  이미 그려져 있던 상태다 — reshape(`retryShape` 등)와 정착된 실패(`settleFailure`)가 실제로
  `skipped`/`unreachable` 노드 상태를 만들며, STORY·TASK 레벨 둘 다에서 관측된다.

## 5. 순서 수립과 할당

`shape`의 **입력**이 바뀐다: 요청 원문 + **PRD의 user stories**(planning이 켜져 있으면). 출력은
develop STORY만이고 각 STORY가 어느 user story를 구현하는지 매핑을 남긴다:

```jsonc
{ "packages": [
  { "id": "P1", "priority": 1, "touches": ["src/payment/**"], "deps": [],     "implements": ["US-1", "US-2"] },
  { "id": "P2", "priority": 2, "touches": ["src/refund/**"],  "deps": ["P1"], "implements": ["US-3"] }
]}
```

- `role` 필드는 없다 — shape가 내는 것은 전부 develop. planning/qa는 단계다(§2 흐름).
- `implements[]` 필수(planning 켜짐 시). 모든 user story가 어느 STORY에든 속해야 하고, 빠진 것은
  validateShape가 거부한다 — 기획이 나눈 것을 shape가 흘리지 않게.
- 스케줄: `deps` 전부 DONE인 STORY 중 `priority` 오름차순으로, **`max_parallel_teams`**(기본 2)
  까지 dispatch. 0.8.0 관찰 — 패키지 세션 여럿이 동시에 쿼터를 치는 모드 — 에 대한 캡.
- 할당(vendor/model)은 현행 라우팅. TeamLeader가 TASK 할당을 바꾸는 건 `team_next`의 몫.

## 6. TaskLeader — main 컨텍스트 0

현행: `tm_next`를 **main 세션이** 폴링하고, 매니저 노드(shape/critique/accept/…)에 fresh agent를
붙인다. 노드 자체는 main에 안 올라오지만 루프는 main이 돈다.

변경: `tm_open`이 **TaskLeader driver**를 spawn한다 (package driver와 같은 `claude-exec-adapter`).
TaskLeader가 `tm_next`/`tm_submit`을 돌리고 매니저 노드에 fresh agent를 붙인다.
main은 다음만 한다:

```
tm_open({request, cwd, interactive, ...})   -> {task_id, leader: {pid}}
tm_board({task_id})                          -> 표 (§8)
tm_answer({task_id, question_id, answer})    -> 질문 응답
tm_status / tm_retry                         -> 현행
```

**규칙 (결정 2026-09-17): main 세션은 절대 TaskLeader가 되지 않는다.** `leader_driver: "inline"`
같은 옵션은 두지 않는다 — 옵션이 있으면 언젠가 켜지고, 켜지면 0.8.0의 507k 토큰이 돌아온다.
같은 이유로 team 라인의 `tm_open`은 `s_driver: "inline"`, `child_driver: "inline"`도 받지 않는다
(넘기면 거부). main이 노드를 하나라도 직접 드라이브하는 경로는 없다. 벤치에서 "main이 도는"
비교군이 필요하면 stable `graph` 라인을 쓴다.

main 세션이 할 수 있는 일의 전부:

| 호출 | 성격 |
|---|---|
| `tm_open` | EPIC 열기 → leader 프로세스 spawn → `task_id` 받고 끝 |
| `tm_board` `tm_ticket` `tm_inbox` `tm_events` `tm_log` `tm_status` `tm_docs` | 읽기 |
| `tm_answer` `tm_assign` `tm_file` `tm_retry` | inbox에 요청 파일 하나 떨어뜨림 (§7b). 적용은 leader |
| `tm_clean` | EPIC DONE 뒤 정리 |

leader가 죽어 있으면 main 쪽 **어느 `tm_*` 호출이든** pid 검사 후 같은 task_id로 respawn한다 —
main이 대신 도는 것이 아니라 leader를 다시 세우는 것. `orchestrate`/`develop`/`document`/`plan`/`qa`
entry 스킬의 본문은 그래서 짧아진다: `tm_open` 한 번, 그 뒤는 `/teams:board`.

**phase 라벨**: 매니저 노드에 `phase`를 붙여 보드에 노출.

| phase | 매니저 노드 | 티켓 동작 |
|---|---|---|
| plan | size, shape | EPIC 생성, STORY BACKLOG 생성 |
| setgoal | critique (+ shape의 acceptance) | STORY별 수용 기준 확정 |
| impl | dispatch:Pn | STORY → IN_PROGRESS, Team 배정 |
| qualitygate | accept:Pn, integrate, gate:goal, report | STORY 검수·반려, EPIC DONE |

## 7. 사용자 = 그래프 노드 (`vendor: "human"`)

질문 채널을 따로 만들지 않는다. **사용자는 executor 하나다** — `claude` / `codex` / `self` 옆에
`human`. 질문, 승인, 수동 작업이 전부 같은 메커니즘(노드 → briefing → payload 제출)으로 흐르고,
보드에는 "담당: you"인 티켓으로 보인다. 런 파일에 이력이 남고, 몇 시간 뒤에 답해도 재개된다.

### human이 앉는 자리

| 노드 | 언제 생기나 | briefing | payload |
|---|---|---|---|
| `ask:N` | `interactive: true`일 때 `size`/`shape`/`critique`가 `questions[]`를 내면 TaskLeader가 삽입. 하류 노드가 이 노드에 deps | 질문 배치 + 각 `default` | `{answers: {Q1: "전액만", …}}` |
| `gate:human:<point>` | `human_gates: ["spec", "release"]` 옵션. `spec` = critique 뒤(수용 기준 승인), `release` = integrate 뒤(배포 승인) | 스펙 요약 또는 통합 verdict + 열린 gaps | `{decision: "accept" \| "reject" \| "redirect", note}` |
| `implement` / `draft` / `cases` | 사용자가 "이건 내가 한다"고 shape에서 `assignee: "human"`으로 핀, 또는 `tm_assign({key, vendor: "human"})` | 다른 worker와 같은 briefing | 다른 worker와 같은 handoff. `changed_files`는 워크트리 대조로 똑같이 검증 |
| `revise` (planning) | `human_review: true` — 기획 문서를 사용자가 직접 퇴고 | 초안 + 루브릭 | 수정 파일 목록 + 메모 |

### 실행 규칙

- **human 노드는 플래그와 무관하게 항상 그래프에 있다.** 플래그는 노드가 *막는지*만 정한다.
  - `interactive: false`(기본) → human 노드가 ready가 되는 순간 **SKIPPED**로 즉시 결정된다.
    `ask`는 `default`로, `gate:human`은 pass-through로, `assignee: human` TASK는 라우팅이 AI에게
    재배정. 런 파일에 `{state: "skipped", by: "auto", default_applied, question}`이 남는다.
  - `interactive: true` → 그 노드에서 멈추고 사람을 기다린다.
  - **사람은 늘 안다.** SKIP된 노드도 보드의 `inbox(you)`에 "대신 결정됨" 섹션으로 뜨고,
    `tm_ticket`에 무엇을 물으려 했고 무엇으로 정했는지가 남는다. 사후에 `tm_answer`로 다른 답을
    주면 `redirect`로 처리 — setgoal부터 재개, 이미 한 작업은 gaps로 전달. 보고서(`report`)에도
    "자동 결정 N건" 절이 붙는다.
  - 즉 플래그 없는 실행은 "질문 없는 실행"이 아니라 "질문에 default로 답한 실행"이다. 차이는
    기록에 있다.
- **human 노드가 ready** → driver는 그 노드를 실행할 수 없으므로 **`waiting_human`으로 park**하고,
  deps가 없는 형제 노드는 계속 돈다. 전부 human 대기면 driver는 **깨끗이 종료**(살아서 기다리지
  않음). `tm_answer`/`tm_submit`이 payload를 기록하면 `tm_next`가 같은 run_id로 driver를
  respawn — `reset_capacity`와 같은 경로, 재시작 예산 소모 없음.
- `tm_answer({key, payload})`는 `tm_submit`/`team_submit`의 human 전용 설탕. 새 진실 원천 없음.
- **크로스벤더 규칙 그대로**: human이 `implement`하면 `test`는 non-human(`AUTHOR_OF.test`).
  human이 `draft`하면 `revise`/`review`는 AI.
- **범위**: 기본 `human_scope: "leader"` — TaskLeader 레벨 노드만 human 가능. Team 내부 질문은
  handoff의 `open_questions[]`로 위로 올라오고 TaskLeader가 EPIC 컨텍스트로 답하거나 `ask`로
  승격. `"all"`이면 TeamLeader도 human 노드를 열 수 있다 — 질문 폭주 주의.
- `ask_timeout`(기본 없음) 만료 시 `default`로 자동 제출, `by: "timeout"`으로 기록 — SKIPPED와
  같은 모양, `by`만 다르다.
- `tm_inbox`는 두 절을 낸다: **대기 중**(내가 답해야 진행) / **대신 결정됨**(SKIPPED, 이의 있으면
  `tm_answer`). 전자가 비고 후자만 있으면 그래프는 멈추지 않았다는 뜻이다.

### 가드레일 — human은 게이트 우회 통로가 아니다

- **UserFirst (결정 2026-09-17).** 소유자는 최종 결정권자다. `gate:human` payload에 `override`가
  있다: `gate:goal`이 reject한 것을 human이 `override: {accept: true, reason}`로 통과시킬 수 있다.
  대신 **크게 기록한다** — 노드에 `overridden_by: human`, 보고서에 "사용자 오버라이드 N건 + 각
  reason + 무시된 gaps", 보드 티켓에 ⚑. 벤치 스코어러는 `overrides`를 따로 센다.
  "게이트 우회 제안 금지" 규칙은 **AI와 driver에게** 적용되는 규칙이다 — driver가 사용자에게
  override를 *권하는 것*은 여전히 금지, 사용자가 스스로 하는 것은 권리.
- `reject`(피드백 동봉 → REJECTED)와 `redirect`(critique부터 재개, 제약 추가)는 그대로.
- `ask`는 **setgoal 이전**에만 삽입된다. impl/qualitygate 단계에서는 가정 기록만.
- human 노드 payload도 verbatim 규칙: driver가 다듬거나 요약하지 않는다.
- 벤치 스코어러는 `human_nodes`, `human_wait_ms`를 따로 센다 — 비용이 아니라 지연으로.

## 7b. 영속성과 RESUME — 모든 단계는 파일로 내려간다

**불변식: 프로세스는 어느 두 쓰기 사이에서든 죽을 수 있고, 상태는 디스크에 있는 것이 전부다.**
main 세션·TaskLeader·TeamLeader·worker 어느 것도 메모리에만 있는 상태를 갖지 않는다. 재개는
언제나 "파일 읽기 → `tm_next`/`team_next`"이고, 그 호출은 멱등이다.

### 무엇이 언제 쓰이나

| 레벨 | 파일 | 쓰는 시점 | 재개 방법 |
|---|---|---|---|
| worker(노드) | 자식 run 파일의 노드 항목 + `detail_path` handoff | `team_submit` 직후, 다음 `team_next` 전 | 현행. done 노드는 다시 안 돈다 |
| TeamLeader(자식 run) | `.teams_output/broker/<run_id>.json` (워크트리 안) | 노드 전이마다 | 현행 v0.9: driver 사망 → 같은 run_id로 respawn, "resume, not redo" |
| TaskLeader(EPIC) | `~/.harness/tasks/<task_id>/task.json` | 매니저 노드 전이, dispatch, fold, retry마다 | **신설**: leader driver 사망 → `tm_next`가 같은 task_id로 respawn. main이 죽어도 EPIC은 산다 |
| 티켓 이벤트 | `~/.harness/tasks/<task_id>/board.jsonl` | task.json 쓰기와 **같은 전이에서**, task.json 다음에 append | 읽기 근거 아님. 유실돼도 `tm_board`는 task.json에서 파생 — 이력만 빈다 |
| Phase md (§7c) | `.teams_output/team/<E>/…md` | board.jsonl 다음, 같은 전이에서 렌더 | 읽기 근거 아님. `tm_docs({rebuild})`로 전부 재생성 |
| human 노드 | 노드 항목 `{state: waiting_human \| skipped \| done, by, default_applied, answer}` | ready 시점(대기·SKIP 기록), `tm_answer` 시점 | driver가 종료된 상태에서 답이 와도 `tm_next`가 respawn |
| sub-EPIC | 자식 task.json에 `parent`, 부모 task.json의 STORY에 `child_task_id` | 개설 시 양쪽 | 부모 재개 시 `child_task_id`로 자식 `tm_status` 읽기. 자식은 자기 driver로 따로 재개 |
| 워크트리·브랜치 | git (`harness/<task8>/<Pn>`) + task.json의 `child.cwd/branch` | 개설·fold 커밋 시 | 현행. 워크트리는 attempt 간 유지 |

### 재개 프로토콜 (레벨 무관, 같은 모양)

```
1. 파일 읽기            task.json / run.json — 어떤 노드가 done인지, 어떤 driver가 살아있는지(pid 검사)
2. 죽은 driver 정리     alive:false → respawn(예산 내) | waiting_human → 그대로 | waiting_capacity → 그대로
3. tm_next / team_next  ready인 것만 돌려준다. 메모리 상태 없음
```

- `tm_next`는 언제 몇 번 불려도 같은 답이다. main 세션이 `/clear` 되거나 다른 세션에서
  `tm_board({task_id})`를 쳐도 이어진다 — task 파일이 프로젝트 `cwd` 밖(`~/.harness/tasks/`)에
  있는 이유이기도 하다.
- **쓰기 순서**: 노드 payload → task.json/run.json → board.jsonl → phase md → (있으면) git 커밋. 뒤에서 죽으면
  앞은 유효하고 뒤는 재개 시 다시 만들어진다(커밋은 fold 재실행이 재시도, 이벤트는 파생으로 복구).
- **쓰기 원자성**: 실제 메커니즘은 tmp+rename이 아니라 **mkdir 락 + merge-on-save**다
  (`graph.mjs`의 `acquire`/`release`/`mergeOnto`/`saveRun`): `<path>.lock` 디렉터리를 `mkdirSync`로
  잡고(실패하면 짧게 스핀·5초 데드라인, stale lock은 mtime으로 판정해 강제 해제), 디스크에 있는
  판을 읽어(`loadRunAt`) 이번 프로세스가 들고 있는 판과 `mergeOnto`로 합친 뒤(다른 브로커가 먼저
  끝낸 노드는 보존) `writeFileSync`로 그 자리에 바로 쓴다 — 임시 파일도 rename도 없다. 소유권은
  하나 — run.json은 그 run의 driver만, board.jsonl은 leader만, worker는 자기 handoff 파일만.
- **task.json은 예외다 — 쓰는 프로세스가 둘이다.** leader driver의 MCP 서버 인스턴스와, main
  세션의 서버 인스턴스(`tm_answer`, `tm_retry`, `tm_assign`)는 서로 다른 프로세스다. 지금은 main
  하나만 task.json을 써서 문제가 없었다. 해법은 둘 중 하나, **후자 권장**:
  - (a) `task.json.lock` — `O_EXCL`+pid, stale 판정 후 강제 해제. 작지만 모든 쓰기 경로가 잠가야 한다.
  - (b) **drop-file inbox** — main 쪽 도구는 `~/.harness/tasks/<id>/inbox/<seq>-<tool>.json`에 요청만
    떨어뜨리고, leader의 `tm_next`가 순서대로 적용한 뒤 삭제한다. task.json 쓰기는 leader 한 곳.
    재개 시 미적용 inbox는 그대로 남아 있으니 유실이 없다. leader가 죽어 있으면 main 쪽 호출이
    inbox를 쓴 뒤 leader를 respawn하고, 새 leader가 첫 `tm_next`에서 적용한다. — 단일 쓰기자
    원칙이 그대로 유지된다.
    구현(v0.10.0): `HARNESS_LEADER_OF`로 leader 프로세스를 식별(`isLeaderProcess`), 큐 경로는
    `<taskDir>/inbox/<ts>-<seq>-<tool>.json`, 대상은 `tm_submit`/`tm_retry` 등 `MUTATING_TOOLS`뿐
    — `tm_next`는 non-leader 호출에서 큐잉되지 않고 leader 상태만 돌려준다.
- 재개 시 **다시 하지 않는 것**: done 노드, fold된 STORY, 이미 답한 human 노드, 이미 SKIPPED로
  기록된 human 노드(플래그가 이후에 켜져도 소급 안 함 — 바꾸려면 `tm_answer` → redirect).
- 재개 시 **다시 하는 것**: running이었던 노드(worker가 죽었으니), 커밋 안 된 fold.

## 7c. Phase 문서 — 모든 단계는 사람이 읽는 md로도 남는다

§7b의 JSON은 **기계의 재개용**이다. 사람이 보는 것은 **항상 md**다. 플래그와 무관하게, 모든 EPIC,
모든 phase, 모든 STORY가 md 한 장을 갖는다. JIRA에서 티켓 페이지와 코멘트를 읽듯이.

### 원칙

- **md는 JSON에서 렌더된 파생물이다.** 같은 전이에서, 같은 쓰기자(leader)가, task.json 다음에 쓴다.
  엔진은 md를 절대 읽지 않는다 — 두 번째 진실 원천 금지(§4와 같은 원칙). 유실되면 `tm_docs
  ({task_id, rebuild: true})`가 JSON에서 전부 다시 만든다.
- 예외 하나: **노드가 직접 쓴 산출물**(PRD, 케이스 명세, report 노드의 본문)은 렌더가 아니라
  원문이다. md는 그것을 **링크·인용**하고 다듬지 않는다(verbatim 규칙).
- 위치: 기본 프로젝트 안 `.teams_output/team/<E-task8>/` (gitignore). `team.json.docs_dir`로
  `docs/epics/`처럼 커밋되는 경로로 돌릴 수 있다. PRD 본문(`10-prd.md`)도 이 디렉터리 안에 있다 —
  planning STORY의 changed file이 아니라 위 예외(노드가 직접 쓴 산출물, verbatim)로 다루는 문서이고,
  `docs_dir`을 옮기지 않으면 EPIC 정리 후 git 이력에 남지 않는다.

### 파일 구성

```
.teams_output/team/E-a1b2c3d4/
  INDEX.md              보드 스냅샷 — 전이마다 다시 렌더. 아래 파일들로 링크
  00-request.md         사용자 요청 원문, size verdict, 핀된 플래그, team.json 스냅샷
  10-planning.md        planning Team 요약 + PRD 링크 + 물었거나 SKIP한 질문과 적용된 default
  10-prd.md              PRD 본문 — planning 체인(draft→revise→gate)이 직접 쓴 원문(verbatim). 10-planning.md가 링크·인용
  15-spec-gate.md       gate:human:spec — 누가(you/auto) 언제 무엇을 승인·반려·override 했나
  20-shape.md           STORY 표: id, 제목, touches, deps, acceptance — JIRA의 스토리 설명
  30-critique.md        critique verdict, sound 여부, 재저작 이력
  40-stories/
    P1.md               티켓 페이지: 상태 타임라인, TASK 목록과 각 노드 verdict, handoff 요약(캡),
                        gaps, 재시도, 워크트리·브랜치, reporter/assignee, driver 로그 경로
    P2.md
    P5-defect.md        결함 STORY — QA의 재현 절차와 evidence가 본문
  50-integrate.md       머지 순서, 커밋, conflicts, 통합 checks
  60-qa.md              cases 링크, execute 결과, 발행한 결함 STORY 링크, round 수
  65-audit.md           planning 크로스 검수: user story별 충족/미충족, 발행한 STORY 링크
  70-goal-gate.md       judges 각각의 점수·checks·attacks, 합의 결과, override 여부
  80-report.md          report 노드의 본문 그대로 + "자동 결정 N건 / 오버라이드 N건 / 미해결 결함" 절
```

- 각 md 머리에 `key`, `state`, `updated`, `source: task.json@<rev>` 4줄 frontmatter — 어느 JSON
  상태에서 렌더됐는지 추적. `task.json`에는 리비전 카운터가 없다 — `<rev>`는
  `task.nodes.filter(n => n.result).length`(지금까지 결과가 난 노드 수)를 값싼 단조 증가
  대용으로 쓴다는 뜻이다. 진짜 버전 카운터를 추가하는 것은 이 문서가 다루는 범위 밖이고,
  이 표기는 어디까지나 대용(stand-in)임을 명시한다.
- STORY md의 "코멘트" 절은 `board.jsonl`의 그 키 이벤트를 시간순으로 푼 것이다. human이 `tm_answer`로
  준 답도 한 코멘트로 들어간다.
- sub-EPIC은 자기 디렉터리를 갖고, 부모 STORY md가 그 INDEX.md로 링크한다.

### 도구·명령과의 관계

- `tm_board`/`tm_ticket`은 터미널 표를 돌려주면서 `doc_path`를 함께 준다. 긴 것은 md로 가서 읽는다.
- `/teams:board`는 표, `/teams:ticket`은 표 + doc_path. md를 세션 컨텍스트로 통째로
  읽어 들이지 않는다 — "payload를 main에 올리지 않는다" 규칙은 md에도 적용된다. 사람은 편집기로 연다.
- `tm_docs({task_id, rebuild})` 하나만 추가.

## 8. 가시성

### MCP 도구 (task-manager에 추가)

| 도구 | 반환 |
|---|---|
| `tm_board({task_id?})` | task_id 없으면 EPIC 목록. 있으면 STORY 칸반 표 + 각 STORY의 TASK 진행률 |
| `tm_ticket({key})` | 티켓 1개: 상태, role, 담당(vendor/model), 워크트리·브랜치, 전이 이력, 마지막 verdict, 열린 질문, 가정 |
| `tm_log({key, tail?})` | 그 티켓 driver의 stream 마지막 N줄 (파일 경로도 반환) |
| `tm_answer({key, payload})` | human 노드에 payload 제출 = `tm_submit` 설탕. WAITING_USER 해제, driver respawn |
| `tm_assign({key, vendor})` | STORY/TASK를 `human`(또는 특정 vendor)에 핀 |
| `tm_inbox({task_id?})` | 지금 나(human)에게 ready인 노드 목록 + briefing_path — "내 할 일" |
| `tm_events({task_id, since?})` | `board.jsonl` 꼬리 — 무슨 일이 있었는지 시간순 |

### 슬래시 명령 (스킬, 얇게)

| 명령 | 하는 일 |
|---|---|
| `/teams:board [E-xxx]` | `tm_board` → 아래 표 |
| `/teams:ticket E-xxx/P2` | `tm_ticket` → 한 티켓 |
| `/teams:log E-xxx/P2` | `tm_log` 꼬리 20줄 |
| `/teams:inbox` | `tm_inbox` — 내가 답하거나 해야 할 노드 |
| `/teams:answer E-xxx/ask:1 '{...}'` | `tm_answer` |
| `/teams:take E-xxx/P2/U1` | `tm_assign(vendor: human)` — 이 TASK는 내가 한다 |
| `/teams:watch E-xxx` | `tm_board`를 `/loop`로 폴링 (선택) |

### 보드 출력 템플릿

```
## E-a1b2c3d4  결제 취소 기능              state: IN_PROGRESS   phase: impl   leader: pid 4121 alive
interactive: yes   inbox(you): 1 (ask:1 → P3)   decided-for-you: 2   human_gates: spec ✓, release

| key | role     | state           | team (vendor/model)   | tasks    | last verdict          |
|-----|----------|-----------------|-----------------------|----------|-----------------------|
| P1  | planning | DONE            | claude/opus           | 3/3      | accept 94             |
| P2  | develop  | IN_PROGRESS     | codex                 | 2/5      | —                     |
| P3  | qa       | WAITING_USER    | **you** (ask:1)       | 0/0      | Q2: 부분취소 포함?      |
| P4  | develop  | BACKLOG (←P2)   | —                     | —        | —                     |

integrate: pending   gate:goal: pending   report: pending
```

`tm_ticket`은 여기에 전이 이력·gaps·attacks[]·워크트리 경로를 붙인다. `team_status({full})`
금지 규칙은 그대로 — 티켓은 verdict와 카운트만, payload는 절대 안 올린다.

## 8b. 구현 가능성 판정

**지금 이 문서는 "설계"이고 "구현 계획"은 아니다.** 절마다 상태가 다르다.

| 절 | 상태 | 코딩 전에 남은 결정 |
|---|---|---|
| §3 역할 kind 2개 | **바로 코딩 가능** — `KINDS` 항목 + 프롬프트 + 페르소나 문자열. 엔진 로직 변경 없음 | revise/cases/execute 프롬프트 본문 (prompts.mjs의 현행 draft/review 톤을 따르면 됨) |
| §4 tickets.mjs 파생 | **바로 코딩 가능** — 순수 함수 + 매핑 표가 곧 테이블 테스트 | 없음 |
| §5 shape 스키마 | **바로 코딩 가능** — `validateShape` 확장(`implements[]` 완전성) | qa는 단계라 워크트리 문제 없음(통합 트리에서 돈다). planning이 꺼진 EPIC에서 `implements[]`는 선택 |
| §8 읽기 도구 4개 | **바로 코딩 가능** — 파일 읽기만 | 보드 렌더 폭·컬럼 확정 |
| §7 human executor | **스펙 한 단락 더 필요** | (1) `ask` 노드가 shape 출력의 어느 필드에서 생기는가 → `shape.questions[]`로 통일. (2) `gate:human` payload 스키마와 `redirect`가 재개하는 정확한 노드(critique? setgoal?) → **critique부터** (spec 재저작 경로가 이미 있음). (3) routing.mjs에서 `human`은 `rankCandidates` 후보에서 제외, `assignee` 핀으로만 |
| §6 TaskLeader driver | **코딩 가능** — inbox 결정, respawn 규칙 결정, inline 옵션 제거로 남은 결정 없음 | leader의 세션 프롬프트(manager.md를 driver용으로 다시 씀), `claude-exec-adapter` 재사용 |
| §2 sub-EPIC | **아직 설계 부족** — 마지막 단계로 미룸 | 자식 EPIC의 worktree 기준점(부모 STORY 브랜치), 자식 report가 부모 accept로 접히는 형식 |
| §12 install/remove/patch | 아래에 정의 — harness의 `install.mjs`/`remove.mjs`/`patch.mjs` 패턴 그대로 | 공존 규칙(§13) 확정 |

판정: **v0.10~v0.12(§3·§4·§5·§8)는 지금 상태로 계획서를 쓸 수 있다.** v0.13(human, leader
driver)은 위 표의 결정 4개를 문서에 박은 뒤. v0.14(sub-EPIC)는 v0.13 실측 뒤에 설계.

## 12. install / remove / patch — harness와 같은 두께로

지금 teams에는 `install`만 있고, 그것도 "MCP 연결 확인"에 그친다. harness처럼 **결정적
스크립트 + 판단하는 스킬** 쌍으로 셋을 둔다. 스크립트는 멱등·비파괴, JSON 리포트가 진실.

### `install` — `skills/install/install.mjs`

| 쓰는 것 | 소유 | 내용 |
|---|---|---|
| `.claude/teams-dispatch.json` | user | dispatch gate 켬. 패턴은 프로젝트를 보고 제안·확인(harness의 gate 패턴 절차 재사용) |
| `.claude/team.json` | user | **프로젝트 기본값 — `tm_open`이 인자보다 먼저 읽는다.** 이것이 "강제"의 실체다: `{interactive, human_gates, max_parallel_teams, max_depth, roles: {planning, develop, qa}, leader_driver, s_driver}` |
| `.claude/conventions/**` | user | harness와 **같은 디렉터리** — 이미 `conventions.mjs`가 읽는다. 없으면 harness 템플릿 복사, 있으면 유지 |
| `CLAUDE.md` 펜스 블록 `<!-- teams:team -->` | user | "쓰기 전에 `tm_open`", 보드 명령 목록 3줄 |
| `.gitignore` | user | `.teams_output/` |
| `.claude/hooks/*` | — | **쓰지 않는다.** 훅은 플러그인 `hooks.json`이 이미 등록. 임베딩 모드는 이 라운드에서 제공하지 않음(엔진이 MCP 서버라 harness식 임베딩과 모양이 다름 — 명시적으로 미지원 선언) |

검증(스킬 쪽 판단): node 18+, git 저장소, **§13 공존 검사**, 도구 발견 — `team_*` 6 + `tm_*` 기존 5
+ 신규(`tm_board tm_ticket tm_log tm_answer tm_assign tm_inbox tm_events`). `"refresh": true`는
plugin-owned 파일이 없으므로 `team.json`에 새 키만 추가(기존 값 유지)하는 역할.

### `remove` — `skills/remove/remove.mjs`

- 지운다: `teams-dispatch.json`, `team.json`, CLAUDE.md 블록, `.gitignore` 줄.
- 남긴다: `.claude/conventions/` (harness와 공유, `purgeConventions` 명시 시만), **`~/.harness/tasks/`**
  (이력. `purgeTasks: true` + 확인 시만, 그리고 **살아 있는 driver pid가 있으면 거부**), `.teams_output/`
  (프로젝트 안 run 이력, `purgeRuns` 별도).
- 멱등: 두 번째 실행은 `absent`.

### `patch` — `skills/patch/patch.mjs`

harness `patch.mjs`와 같은 규칙: `x.y.Z`만, plugin.json + marketplace 항목 + README Status 첫 항목.
**차이 하나**: 이 저장소 규칙은 README와 KOR.md가 함께 움직여야 하므로 **KOR.md Status도 같은
항목을 받는다**(`summary_ko` 필수, 없으면 거부). 두 플러그인이 같은 스크립트를 쓰도록
`scripts/patch-plugin.mjs`로 올리고 `plugin` 인자만 다르게 — harness의 것도 거기로 옮긴다.

## 13. 공존 — harness · graph · teams(team)

| 조합 | 판정 | 근거·방법 |
|---|---|---|
| harness + team | **허용, 기본** (v0.10.0 완료) | 훅이 둘(`goal-gate.mjs`, `dispatch-gate.mjs`) 다 PreToolUse. 충돌 지점은 **harness gate가 team의 worker 쓰기를 막는 것** — 워크트리 경로가 프로젝트 상대 패턴에 걸린다. 실제로 나간 해법은 `~/.harness/active/`가 아니라 **트리 안의 공유 마커** `.claude/.harness-markers/team-<task8>`(engage.mjs) — harness gate가 이미 읽던 바로 그 디렉터리·파일 모양이라 **harness 쪽 변경은 0**이다. `tm_open`/`tm_next`가 매 폴링마다 워크트리에 쓰고, `excludeMarkers()`가 그 경로를 저장소의 `info/exclude`(git-common-dir, 워크트리 전체에 공유)에 등록해 마커가 git에 잡히지 않게 하며, `commitWorktree`의 fold 커밋도 그 경로를 `git rm --cached`로 언스테이지한다 — 이게 없으면 마커가 매 패키지 브랜치에 커밋되고 모든 integrate가 타임스탬프 충돌로 깨진다. dispatch-gate.mjs는 반대 방향(team → harness 경로 보호)으로 같은 마커를 읽는다. 두 훅 모두 지금도 fail-open이니 마커 읽기 실패는 통과 |
| graph + team | **허용** (install 상호배제 검사 없음, commit `0ff8a2f`) | 리네임(§14 결정 6b)으로 두 서버가 더는 이름을 공유하지 않는다 — graph는 `graph-engineering`/`graph_*`, teams는 `teams-engineering`/`team_*`. install의 `findConflicts`는 제거됐고, `test-install.mjs`가 graph 플러그인이 켜져 있고 `graph-engineering` `.mcp.json` 항목이 있어도 install이 성공(status 0)함을 검증한다 |
| harness + graph | 현행 | 변경 없음 |
| 셋 다 | **허용** | 위 두 행이 독립적으로 성립 — harness+team, graph+team 어느 쪽도 서로 겹치는 리소스를 막지 않는다 |

- `conventions/`는 셋이 공유한다. 형식이 이미 같다(`conventions.mjs`가 harness 템플릿을 읽음).
- `~/.harness/tasks/`는 team 소유(task.json), `.claude/.harness-markers/`(프로젝트/워크트리 안)는
  harness·team 공유 마커. 이름 충돌 없음.
- team의 `report`가 harness의 `.claude/harness-gate.json` window를 갱신할 필요는 없다 — 마커가
  대신하고, harness 쪽은 한 줄도 바뀌지 않았다(위 표).

## 9. 변경 지점

| 파일 | 변경 |
|---|---|
| `mcp/graph.mjs` | `KINDS.planning`, `KINDS.qa` (+ `BASE_REASONING`에 revise) |
| `mcp/prompts.mjs` | role별 setgoal 페르소나 세트, revise/cases/execute 프롬프트 |
| `mcp/mounts.mjs` | role 키 추가 (`{role}:{stage}` 우선, 없으면 stage) |
| `mcp/routing.mjs` | executor `human` 추가. `rankCandidates`가 human을 자동 선택하지는 않음 — 핀(`assignee`)이나 `ask`/`gate:human` 노드 타입으로만 |
| `mcp/graph.mjs` | `ask`, `gate:human` 노드 타입. human 노드 ready → run `waiting_human`; `AUTHOR_OF` 규칙에 human 포함 |
| `mcp/taskmanager.mjs` | shape 스키마(`role`,`priority`,`worktree`,`assignee`), 스케줄러 캡, `ask` 삽입(`interactive`), `human_gates`, `assumptions` 기록, human 대기 시 driver 종료·`tm_answer` 후 respawn, TaskLeader driver spawn, `board.jsonl` append, `tm_board/tm_ticket/tm_log/tm_answer/tm_assign/tm_inbox/tm_events`, sub-EPIC(`parent`, `max_depth`) |
| `mcp/tickets.mjs` (신설) | 엔진 상태 → 티켓 상태 파생 함수, 키 생성, 보드 렌더 — 순수 함수, 파일 안 씀 |
| `mcp/docs.mjs` (신설) | §7c md 렌더러. JSON → md 순수 함수 + leader가 전이마다 호출하는 쓰기 한 곳. `tm_docs` |
| `skills/plan`, `skills/qa` | entry 스킬 2개 (`develop`과 같은 두께) |
| `skills/board`, `ticket`, `log`, `inbox`, `answer`, `take` | 얇은 명령 스킬 |
| `skills/orchestrate/SKILL.md` | 엔트리 후 "TaskLeader가 돈다, 당신은 board를 본다"로 축소 |
| `scripts/test-tickets.mjs` | 파생 매핑 표 전부를 테이블 테스트로 |
| `skills/install/{SKILL.md,install.mjs}`, `skills/remove/{SKILL.md,remove.mjs}`, `skills/patch/SKILL.md` | §12. `team.json`, dispatch json, CLAUDE.md 블록, 공존 검사 |
| `scripts/patch-plugin.mjs` (저장소 루트) | harness·teams 공용 패치 스크립트, KOR.md Status 포함 |
| `hooks/dispatch-gate.mjs`, `harness/hooks/goal-gate.mjs` | §13 공유 engagement 마커 읽기 |
| `mcp/taskmanager.mjs` (추가) | `team.json` 읽어 `tm_open` 기본값, engagement 마커 쓰기/지우기, inbox 적용 |

## 10. 반론과 리스크

1. **상태 이중화.** JIRA식 상태를 별도 저장하면 엔진과 어긋난다. → §4의 "파생 함수" 원칙으로
   막는다. `board.jsonl`은 로그일 뿐 읽기 근거가 아니다.
2. **재귀 폭발.** sub-EPIC이 sub-EPIC을 열면 비용·쿼터가 지수로 는다. → `max_depth 2`,
   `max_parallel_teams`, 그리고 sub-EPIC 개설은 `plan`이 L을 측정한 경우만.
3. **기획 게이트의 근거 부족.** 코드는 명령 실행이 근거인데 기획은 루브릭뿐. → revise를 판정이
   아닌 *수정 권한 있는 퇴고*로 두고, gate는 현행 document와 같이 "checks 없는 accept 거부"를
   루브릭 항목 단위로 요구.
4. **QA가 잘못된 트리를 본다.** 자기 워크트리에서 QA하면 seam을 못 잡는다. → `worktree:
   "integration"` 강제. 대신 QA STORY는 통합 후에만 시작되어 크리티컬 패스가 길어진다.
5. **human 노드가 게이트 우회 통로가 된다.** → `gate:human`은 AI 게이트 옆에만, reject/redirect만
   강하고 accept는 이미 통과한 것에만. `ask`는 setgoal 이전으로 한정.
   추가: **human 대기가 EPIC을 무한히 잡는다** → driver는 종료하고 상태만 남긴다(프로세스·쿼터
   소모 0). `ask_timeout`은 선택.
6b. **새 층이 메모리 상태를 만든다.** 티켓·human·leader 중 하나라도 파일 밖에 상태를 두면 재개가
   깨진다. → §7b 불변식. 테스트는 "각 전이 직후 프로세스 kill → 재개 → 같은 결과"를 표로 돈다.
6. **main이 루프에서 빠지면 관측이 늦다.** → 보드 명령 + `/loop` watch. driver의 stream 파일은
   지금도 있다(`driver.log`).
7. **어휘.** Team/TeamLeader/Task/TaskLeader 넷 중 "Task"가 코드의 tm task와 충돌. → 외부 어휘는
   EPIC/STORY/TASK, 내부 식별자는 유지.

## 11. 단계 (제안)

| 단계 | 내용 | 검증 |
|---|---|---|
| v0.10.0 | **완료.** install/remove/patch 셋 + `team.json` + 공존 검사 + engagement 마커(harness 변경 0) + inline 옵션 셋 제거 + TaskLeader driver·inbox·`tm_events` | install→remove 멱등 테스트, harness+team 동시 설치 픽스처에서 worker 쓰기 통과, `node --test teams/scripts/test-*.mjs` 241/241 |
| v0.10.1 | **완료.** `planning`(draft→revise→gate)/`qa`(cases→execute→gate) kind + 페르소나·per-stage 스킬·advisory mounts(§3) + entry 스킬 2개(`teams:plan`/`teams:qa`) + `broker.mjs`의 revise 정체성-분리 가드 + `ensureWorktree`의 `gate_uncommitted` 이벤트(계획에 없던 안전 수정) | `node --test teams/scripts/test-*.mjs` 258/258, 회귀 0. 벤치 요청 파일(`plan-flat`/`qa-flat`)만 추가, 벤치 자체는 미실행 — 실제 벤더 실행 증거 없음, 전부 단위 테스트 |
| v0.11.0 | `tickets.mjs` 파생 + `board.jsonl` + **`docs.mjs` phase md** + `tm_board/tm_ticket/tm_events/tm_docs` + 명령 스킬 | 매핑 표 테이블 테스트. md는 golden 파일 비교, `rebuild`가 동일 출력 |
| v0.12.0 | shape `role/priority/worktree`, 스케줄러 캡, QA=통합 트리 | seam 픽스처에 qa STORY 추가 |
| v0.13.0 | executor `human`: `ask`, `gate:human`, `assignee`, `waiting_human` park/respawn, `tm_answer/tm_assign/tm_inbox` | fake driver 테스트 (0.8.0 방식), human이 implement한 TASK의 test가 non-human으로 가는지 |
| v0.13.1 | `interactive` 플래그 (사용자 질문 모드) | 실측 1회, main 컨텍스트 토큰 비교. **kill-and-resume 표 테스트**: 매니저 노드 전이마다 leader kill → `tm_next` → 동일 결과 |
| v0.14.0 | sub-EPIC (`parent`, `max_depth`) | 깊이 2 픽스처 |

각 단계 끝에 실측 1회 — "측정 전 비용 주장 금지" 규칙 유지.

## 14. 열린 논점 — 코드 전에 결정할 것

### A. 구조 (이게 바뀌면 §3·§5가 바뀐다)

1. **역할 셋은 대등한 STORY가 아니다.** 기획은 shape *이전*에 필요하고(PRD가 없으면 develop STORY를
   나눌 수 없다), QA는 integrate *이후*에만 의미가 있다(통합 트리). 지금 §5처럼 셋을 다 package로
   두면 기획 STORY가 끝난 뒤 reshape가 필요하고, QA STORY는 첫 integrate까지 놀고 있다.
   **대안**: 역할 = **EPIC의 phase에 붙는 Team**. planning Team = TaskLeader의 plan/setgoal 단계를
   위임받은 팀(자기 체인 draft→revise→gate로 PRD 산출 → 그 PRD가 shape의 입력). qa Team =
   qualitygate 단계에 붙어 integrate 뒤 1회. develop만 package. 프랙탈은 그대로 — 각 Team이
   자기 안에서 4단계를 돈다. `team.json`의 `roles.planning: true/false`로 켠다.
   → 추천: 대안. shape 출력에 `role`이 사라지고 대신 EPIC 흐름이
   `size → [planning Team] → shape → critique → [dispatch→accept]×P → integrate → [qa Team] → gate:goal → report`.
2. **QA가 결함을 찾으면 어디로 반려하나.** qa report의 결함 → 어느 STORY의 gaps로 가는가. integrate의
   "checks blame" 판정을 재사용해 TaskLeader가 package_id를 고르고 `tm_retry({package_id})`, 못 고르면
   seam → `repair`. 결정 필요: blame 판정을 qa gate 노드가 하나(payload에 `blame: [Pn]`), TaskLeader의
   별도 노드가 하나.
3. **기획 산출물의 자리와 형식 (결정 2026-09-17).** PRD 본문은 `.teams_output/team/E-<task8>/10-prd.md` —
   planning Team의 draft→revise→gate 체인이 직접 쓴 원문이며, §7c의 verbatim 규칙(노드가 직접 쓴
   산출물은 렌더가 아니라 원문) 적용 대상이다. 템플릿은 `pm/skills/prd-development/template.md`
   — 실재하는 10절 fill-in 스켈레톤(Executive Summary, Problem Statement, Target Users & Personas,
   Strategic Context, Solution Overview, Success Metrics, User Stories & Requirements, Out of
   Scope, Dependencies & Risks, Open Questions). 같은 플러그인의 `user-story-*` 템플릿은 PRD가
   아니므로 대체하지 않는다. 커밋되는 자리에 남기고 싶으면 `team.json.docs_dir`로 팀 문서
   디렉터리 전체를 옮긴다(§7c에 이미 있는 장치). 기본은 `.teams_output/` 아래이고 gitignore이므로,
   EPIC 정리 후 PRD는 git 이력에 남지 않는다. 기획 뒤 `gate:human:spec` 기본 켬은 결정 기록 #3 참조.

### B. 권한·정책 (사용자의 값)

4. **human accept가 AI reject를 못 뒤집는다** — 소유자가 최종 결정권이 없는 셈. 유지하되 `redirect`로
   수용 기준을 바꾸고 재게이트하는 길만 열어두는 것이 지금 안. 뒤집기를 허용하려면 `override`
   결정을 추가하고 보고서에 "사용자 오버라이드 N건"을 박는다. → 추천: 유지.
5. **기본값**: `interactive: false`, `human_scope: leader`, `human_gates: []`, `max_parallel_teams: 2`,
   `max_depth: 2`. 전부 `team.json`. 계정 쿼터에 따라 다르니 사용자 값.
6. **graph ↔ team 상호배제** vs `gb_*` 이름공간. → 추천: 상호배제(졸업 라인).
7. **임베딩(에어갭) 미지원 선언**. harness는 있다. team은 MCP 서버라 모양이 다르다. 나중에 하려면
   `node mcp/taskmanager.mjs`를 프로젝트에 복사하는 수준이라 어렵진 않다. → 추천: 이 라운드 미지원.
8. **어휘**: 문서·도구는 EPIC/STORY/TASK, 개념 설명은 Team/TeamLeader/TaskLeader. 코드 식별자에
   Team*을 넣을지(예: `leader_driver` → `task_leader`). → 추천: 옵션 이름은 역할어(`task_leader`,
   `team_driver`)로, 파일·id는 현행.

### C. 확인만 (기본값 제안됨, 반대 없으면 진행)

9. task.json 쓰기자 → drop-file inbox (§7b).
10. 보드 매체 → 터미널 표 먼저. HTML 대시보드·statusline은 v0.11 뒤 별도.
11. STORY DONE 뒤 워크트리·브랜치 정리 → 현행(유지) 그대로, EPIC DONE 시 `tm_clean({task_id})` 하나만 추가.
12. v0.10.0을 install/remove/patch로 먼저.

### 결정 기록 (2026-09-17)

| # | 결정 | 반영 |
|---|---|---|
| 2 | QA가 결함을 찾으면 blame·retry가 아니라 **결함 STORY를 새로 발행**한다. EPIC 아래 STORY, `role: develop`, `reporter: qa TeamLeader`, `assignee: develop Team`. JIRA의 Bug 티켓과 같다 | §5b 신설. `tm_file` 도구. EPIC은 impl 단계로 되돌아가 dispatch→accept→integrate→qa를 다시 돈다. 반복 캡 `qa_rounds`(기본 2) |
| 3 | 기획 뒤 `gate:human:spec`은 **기본 켬**. 단 사람이 개입 못하는 상황이 있으니 `interactive: false`면 SKIPPED(자동 승인, 기록) — §7 규칙 그대로 | `team.json` 기본 `human_gates: ["spec"]` |
| 4 | **UserFirst.** human은 AI reject를 `override`로 뒤집을 수 있다. 크게 기록 | §7 가드레일 재작성 |
| 6 | graph ↔ team 상호배제, install이 검사 | §13 그대로 |
| 1 | **B안 + 보강**: 한 보드. 1순위 TaskLeader의 프롬프트 분해·분배 → 기획이 정리·기능 분할 → shape가 소유권으로 묶어 개발 → 통합 → QA → **기획 크로스 검수** → goal gate. Team 간 선후 있음 | §2 EPIC 흐름, §3 `planning-audit`, §5 `implements[]`, 7c `65-audit.md` |
| 5·7·8·C | 애매 → 제안한 기본값으로 진행, 실측 뒤 재론 | — |
| 3b | 기획 산출물(PRD)의 자리·형식. 본문은 `.teams_output/team/E-<task8>/10-prd.md`(§7c verbatim, planning 체인이 직접 씀), 템플릿은 `pm/skills/prd-development/template.md`(10절 스켈레톤; 같은 플러그인의 `user-story-*`는 대체 아님). `team.json.docs_dir`로 커밋 경로로 이동 가능 — 기본은 gitignore라 EPIC 정리 후 git 이력에 안 남음 | §7c 파일 구성에 `10-prd.md`, §14 A.3 |
| 6b | **리네임 + 독립화** (0.10.2로 출시). plugin `graph-beta` → `teams`, 도구 접두어 `graph_*` → `team_*`(`teams/mcp/broker.mjs`의 서버 이름도 `teams-engineering`). #6이 상호배제 근거로 든 "두 서버가 같은 `graph_*` 이름을 낸다"는 이제 사실이 아니다 — graph는 `graph-engineering`/`graph_*`를 그대로 쓰고, teams만 `teams-engineering`/`team_*`로 옮겨 갔다. harness·graph·teams 세 플러그인은 이제 서로의 코드를 참조하지 않는 독립된 형제다(§0 재서술) | §0 계보 재서술. **확인됨** (commit `0ff8a2f`): `teams/skills/install/install.mjs`에서 `findConflicts`가 제거되어 install-time 상호배제 검사가 더는 없다. `teams/scripts/test-install.mjs`에 graph 플러그인이 활성화되고 `graph-engineering` `.mcp.json` 항목이 있어도 install이 성공(status 0)함을 검증하는 테스트가 추가됐다 — 팀 리더는 이름만 바로잡는 대신 상호배제 자체를 걷어내는 쪽을 택했다. §13 표도 이에 맞춰 갱신 |
| 추가 | **main 세션은 절대 TaskLeader가 아니다.** inline 옵션 셋(`leader_driver`/`s_driver`/`child_driver`) team 라인에서 제거·거부 | §6 재작성, 7b inbox 문구, entry 스킬 축소. **v0.10.0 완료**: `child_driver`/`s_driver`는 넘기면 `tm_open`이 에러(commit 20306ec, breaking); `leader_driver: "inline"`은 애초에 만들지 않고 대신 TaskLeader driver를 항상 spawn(commit 6ecd744) |

## 5b. 결함 STORY — QA가 발행하는 티켓

```
qa Team의 gate가 결함 리포트를 낸다
  → qa TeamLeader가 tm_file({task_id, stories: [{title, role: "develop", touches, deps: [], evidence, severity}]})
  → TaskLeader가 STORY Pn+1 생성 (reporter: "qa:<run_id>", kind: subgoal), 티켓 BACKLOG→READY
  → 보통의 dispatch → accept → integrate:N+1 → qa round 2 → 결함 0이면 gate:goal
```

- 결함 STORY는 shape를 거치지 않는다 — shape는 "요청을 나누는" 노드고 결함은 이미 나뉜 단위다.
  대신 `validateShape`의 겹침 검사(touches)만 같이 통과해야 한다.
- 결함 STORY의 acceptance = 결함 리포트의 재현 절차가 통과하지 않는 것(`checks`에 그대로 들어간다).
  QA가 쓴 재현 케이스가 develop의 test 노드 입력이 된다 — 작성자와 검증자가 자연히 갈린다.
- `qa_rounds` 초과 시 남은 결함은 `report`의 "미해결 결함" 절로 — 무한 루프 방지.
- 보드에서 `reporter` 컬럼이 생긴다: shape가 낸 STORY는 `shape`, 결함은 `qa`, 사용자가 `/take`나
  `tm_file`로 직접 낸 것은 `you`.
