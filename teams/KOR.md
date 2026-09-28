# teams — 한국어

[English](README.md) · **한국어**

`teams`는 요청을 작은 개발팀처럼 처리합니다. 한 번에 끝내기 어려운 요청이면 크기를 재고,
기획하고, **패키지**(작업 단위 하나) 여러 개로 나눈 뒤, 패키지마다 전담 워커를 붙여 각자의 git
워크트리에서 돌립니다. 결과는 모두 심사를 거쳐야 받아들여지고, 받아들여진 브랜치들은 하나의
통합 트리로 합쳐집니다. 그 위에서 QA가 실제로 써 보고, 마지막 목표 게이트가 원래 요청을 정말
충족했는지 판정합니다. 결과가 어떻든 보고서는 남습니다. 작은 요청은 분할을 건너뛰고 graph 런
하나로 끝나지만, 그 전에 기획은 거칩니다. 크기와 상관없이 모든 태스크에 PRD와 유저 스토리가
남습니다.

작업이 여러 조각으로 나뉘거나, 코드만이 아니거나(설계 문서, PRD, QA 패스), 세션을 닫은 뒤에도
계속 돌아야 한다면 `teams`를 쓰세요. 한 세션에서 직접 이끌어 가는 코드 변경 하나라면
[`graph`](../graph/KOR.md)가 맞습니다.

| | `graph` | `teams` |
|---|---|---|
| 잘 맞는 일 | 코드 요청 하나, 런 하나 | 크기를 재고 쪼개야 하는 요청, 문서, PRD, QA, 백로그 |
| MCP 서버 | `graph-engineering` (`graph_*`) | `teams-engineering` (`team_*`) + `task-manager` (`tm_*`) |
| 누가 이끄나 | 내 세션 | 백그라운드 데몬 (세션은 지켜보기만 함) |
| 런 파일 | `.harness-run/broker/` | `.teams_output/broker/` (런), `~/.harness/tasks/` (태스크) |
| 버전 | 1.x | 0.x |

두 플러그인을 한 프로젝트에 함께 켜도 됩니다. 도구 접두사와 런 디렉터리가 서로 다릅니다.

## 전체 구조

```mermaid
flowchart TB
  U["You, in a Claude Code session"] --> SK["Entry skill: orchestrate, develop, document, plan, qa, sprint"]
  SK -->|"tm_open / tm_run"| TM["task-manager MCP server, tm_* tools"]
  CLI["scripts/run.mjs, headless"] -->|"same open and wait"| TM
  TM -->|"spawns, detached"| DM["Task daemon"]
  DM <--> TJ[("task.json and ledger in ~/.harness/tasks")]
  DM -->|"one claude -p call per judging step"| J["Judge: size, areas, accept, plan-integrate, shape, critique, integrate, gate, report"]
  DM -->|"per package: worktree + driver"| P1
  DM -->|"per package: worktree + driver"| P2
  subgraph P1["Package P1: own worktree and branch"]
    D1["claude -p driver"] -->|"team_* tools"| B1["teams-engineering broker"]
    B1 --> R1["child graph run"]
  end
  subgraph P2["Package P2: own worktree and branch"]
    D2["claude -p driver"] -->|"team_* tools"| B2["teams-engineering broker"]
    B2 --> R2["child graph run"]
  end
  P1 -->|"accepted branch"| IT["Integration worktree"]
  P2 -->|"accepted branch"| IT
  IT --> RP["Report, retro.json, phase docs"]
```

- **task-manager**(`mcp/taskmanager.mjs`)는 *태스크*를 관리합니다. 노드 그래프, 패키지,
  워크트리, 판정이 모두 여기 있습니다. 실제 작업은 하지 않고, 자식 런 파일은 읽기만 할 뿐 절대
  쓰지 않습니다.
- **데몬**(`mcp/daemon.mjs`)은 `tm_open`이 띄우며 세션이 끝나도 살아 있습니다. 태스크를 앞으로
  진행시키고, 판단이 필요한 단계마다 일회성 `claude -p` 심사를 호출하고, 죽거나 멈춘 드라이버를
  다시 띄웁니다.
- **드라이버**는 헤드리스 `claude -p` 세션입니다. `teams-engineering` 브로커(`mcp/broker.mjs`,
  `team_*` 도구)를 통해 패키지 하나의 자식 런을 끝까지 몰고 갑니다. 브로커는 `graph`와 같은 엔진
  계보입니다.
- **통합**은 받아들여진 패키지 브랜치들을 별도의 통합 워크트리에 합칩니다. teams는 내 브랜치에
  절대 머지하지 않으므로, 완성된 결과물은 그 통합 트리에 있습니다.

## 태스크 하나의 흐름

```mermaid
flowchart TD
  OPEN["tm_open"] --> SIZE{"size"}
  SIZE -->|"S"| SPLAN["one planning card: PRD section and user stories"]
  SPLAN --> SPI{"plan-integrate"}
  SPI -->|"accepted"| SRUN["one graph run in the project directory, built from the PRD"]
  SRUN --> SREP["that run's report"]
  SIZE -->|"L"| BS["brainstorm"]
  BS --> AREAS["areas: split the request by feature"]
  AREAS --> PCARDS["planning cards PLAN-F1, PLAN-F2, ...<br/>one per feature area, full run each, in parallel"]
  PCARDS --> PACC{"accept, per card"}
  PACC -->|"rejected"| PCARDS
  PACC -->|"all accepted"| PI{"plan-integrate: merge into 10-prd.md and judge"}
  PI -->|"id collision, contradiction, missing feature"| PCARDS
  PI -->|"accepted"| SHAPE["shape: split the stories by ownership into packages"]
  SHAPE --> CRIT{"critique"}
  CRIT -->|"unsound"| SHAPE
  CRIT -->|"sound"| DISP["develop: each package runs the full harness in its own worktree<br/>plan → setgoal → critique → implement → test → gate → gate:goal → report<br/>in parallel where deps allow"]
  DISP --> ACC{"accept, per package"}
  ACC -->|"rejected"| DISP
  ACC -->|"all accepted"| INT{"integrate"}
  INT -->|"not verified"| REPAIR["repair package on the merged tree"]
  REPAIR --> INT
  INT -->|"verified"| QA{"QA cards QA-F1, QA-F2, ...<br/>one per feature area, in parallel"}
  QA -->|"defects found"| FIX["fix STORYs, dispatched like packages"]
  FIX --> INT
  QA -->|"clean"| AUDIT{"planning audit"}
  AUDIT -->|"unmet user stories"| FIX
  AUDIT -->|"all met"| GOAL{"gate:goal"}
  GOAL --> REPORT["report"]
```

단계별로 하는 일:

| 단계 | 하는 일 | 스위치 |
|---|---|---|
| `size` | 심사자가 S(런 하나로 충분)인지 L(쪼개야 함)인지 정합니다. `size` 인자로 고정할 수도 있습니다. | — |
| `brainstorm` | 의도, 범위, 접근을 다시 정리합니다. `interactive`일 때만 사람에게 묻습니다. 세션에서 이미 `decisions`를 넘겼다면 건너뜁니다. | `brainstorm` |
| `areas` | EPIC의 plan 단계가 요청을 **기능** 기준으로 나눕니다. 사용자가 무엇을 할 수 있어야 하는지를 기능 영역으로 묶고, 영역마다 기획 카드가 하나씩 생깁니다. 크기 S 태스크는 분할 없이 카드 하나를 받습니다. | — |
| 기획 카드 | 기능 영역마다 STORY 카드 하나(`PLAN-F1`, `PLAN-F2`, ...). 카드마다 자기 워크트리에서 전체 런을 돌고, 서로 병렬로 돕니다. 카드는 자기 PRD 섹션(목표, 범위와 비목표, 인수 기준이 달린 유저 스토리 - id는 영역 접두사를 붙인 `F1-US-1` -, 미해결 질문)을 쓰고 유저 스토리를 돌려줍니다. 유저 스토리가 없는 카드는 반려되고, 반려된 카드는 사유를 달아 다시 돕니다. 요청에 인수 기준이 이미 적혀 있으면 카드마다 가벼운 체인으로 돕니다. | `roles.planning` (`true`, `"light"`, `"auto"`; `false`는 거부) |
| `plan-integrate` | 카드들의 섹션을 `10-prd.md` 하나로 합친 뒤 심사자가 검사합니다. 스토리 id 충돌, 영역 사이의 모순, 요청에 있는데 어느 카드도 다루지 않은 기능. 반려되면 문제가 된 카드를 부족분과 함께 되돌려 보냅니다(빠진 기능은 새 카드를 엽니다). | `max_retries` |
| `shape` → `critique` | `shape`가 합쳐진 유저 스토리를 이번에는 **소유권** 기준으로 다시 나눠 `touches[]`와 `deps`가 달린 패키지로 만듭니다. 모든 스토리는 어느 패키지든 구현해야 합니다. `critique`가 그 분할을 검토하고, 부실하면 다시 나눕니다. | — |
| 개발 (dispatch) | 실제 개발 단계입니다. 패키지마다 git 워크트리와 드라이버 세션이 붙어 그 패키지의 자식 런을 전체 하네스로 돌립니다: `plan → setgoal → critique → implement → test → gate → gate:goal → report`. 여기서 `plan`은 다시 쪼개는 일이 아니라 그 패키지 하나를 만드는 개발 계획(파일, 인터페이스, 작업 순서, 테스트 계획, 위험)이고, `setgoal`은 패키지의 acceptance를 그대로 옮기며 `critique`가 계획을 그 기준으로 검토합니다. 문서 패키지는 `implement → test → gate` 대신 `draft → review → gate`를 씁니다. `deps`가 풀린 패키지끼리는 병렬로 돕니다. [패키지 하나의 내부](#패키지-하나의-내부) 참고. | `max_parallel_teams`, `vendor` |
| accept | 패키지 런이 끝나면 심사자가 결과를 받아들이거나 반려합니다. 반려되면 사유를 달아 그 패키지를 다시 돌립니다. | `max_retries` |
| `integrate` | 받아들여진 브랜치를 합치고 검사를 돌립니다. 어느 패키지 혼자서는 보이지 않는 이음새 문제는 합쳐진 트리 위에서 일하는 repair 패키지가 맡습니다. | — |
| QA | 기능 영역마다 QA 카드 하나(`QA-F1`, `QA-F2`, ...). 카드마다 합쳐진 트리 위에서 전체 런을 돌며 자기 영역의 유저 스토리를 병렬로 검증합니다. 한 라운드의 카드가 모두 끝나면 결함을 한꺼번에 수정 STORY로 등록하고, 다시 통합한 뒤 모든 QA 카드를 다시 엽니다. | `roles.qa`, `qa_rounds` |
| audit | 기획 팀이 합쳐진 결과를 합쳐진 PRD와 대조합니다. 충족 못 한 스토리는 QA 결함처럼 등록됩니다. | `roles.audit` |
| `gate:goal` | 결과 전체를 원래 요청에 비춰 판정합니다(`goal_threshold`, 기본 90%). | `goal_threshold` |
| `report` | 목표 게이트가 끝나면 통과든 실패든 항상 돕니다. 다음 스프린트를 위한 `retro.json`도 씁니다. 여기에 끝내지 못한 유저 스토리도 들어갑니다. sub-EPIC은 없으므로 남은 일은 다음 스프린트로 이월됩니다(`tm_open({context_from})`이 `carryover_candidates`로 돌려줌). | — |

모든 반복에는 예산이 있습니다(`max_retries`, `qa_rounds`, `upstream_fix_rounds`). 예산이 바닥나면
그 실패는 *확정(settled)*됩니다. 거기에 기대던 노드는 도달 불가로 표시되고, 태스크는 멈춰 있지
않고 보고서로 넘어갑니다. 비용 한도나 타임박스에 걸렸을 때도 같습니다. 새 패키지는 더 내보내지
않고, 받아들여진 패키지만 통합한 뒤, 나머지는 "Next backlog"로 넘깁니다.

도식에서 뺀 반복이 두 가지 더 있습니다. 통합 *충돌*(두 패키지가 같은 것을 고친 경우)은
`tm_retry({repackage})`로 풀어야 하고, 어떤 패키지가 자신이 의존하는 패키지의 버그를 찾으면
그쪽에 **업스트림 수정**을 등록하고 그 수정을 기다립니다(`upstream_fix_rounds`).

## 패키지 하나의 내부

모든 패키지는 자기 자식 런 안에서 전체 하네스를 돕니다. 태스크가 바깥에서 도는 네 단계(계획,
목표 설정, 검토, 구현과 심사)를 패키지 안에서도 똑같이 돕니다. 기획 카드(`PLAN-F1`, ...), QA 카드(`QA-F1`, ...), audit,
repair 패키지, 크기 S 태스크의 단일 런도 같은 모양입니다:

```mermaid
flowchart LR
  PLN["plan"] --> SG["setgoal"] --> CR["critique"] --> CH["one chain per subgoal"] --> RD["reduce, if more than one subgoal"] --> GG["gate:goal"] --> RE["report"]
```

develop 패키지라면 `shape`가 이미 EPIC을 패키지로 나눴고 `critique`가 그 분할을 검토했으므로,
패키지 자신의 `plan`은 이 패키지를 어떻게 만들지에 대한 **개발 계획**입니다: 건드릴 파일과 모듈,
인터페이스와 데이터 형태, 작업 순서, 테스트 계획, 위험. EPIC을 다시 쪼개지 않습니다. `setgoal`은
대개 서브골 하나를 두고 패키지의 acceptance를 스펙에 글자 그대로 옮기며, `critique`는 계획과
스펙을 패키지의 브리프와 acceptance에 비춰 심사합니다. 매니저의 `accept`는 이 패키지의
`gate:goal` 판정과 `report` 인계를 읽습니다. STORY에 건 사람 지정(`tm_assign`, 또는 shape의
`assignee`)은 패키지의 `setgoal`이 만든 모든 서브골에 적용됩니다.

서브골은 그 서브골의 **kind**에 맞는 노드 체인으로 펼쳐집니다(`mcp/graph.mjs`의 `KINDS`).
한 단계를 쓴 쪽이 그 단계를 심사하는 일은 없습니다.

```mermaid
flowchart LR
  subgraph code["subgoal: code"]
    C1["implement"] --> C2["test"] --> C3["gate"]
  end
  subgraph doc["document"]
    D1["draft"] --> D2["review"] --> D3["gate"]
  end
  subgraph pl["planning"]
    P1["investigate"] --> P2["draft"] --> P3["revise"] --> P4["gate"]
  end
  subgraph pll["planning-light"]
    L1["investigate"] --> L2["template-fill"] --> L3["gate"]
  end
  subgraph qa["qa"]
    Q1["cases"] --> Q2["execute"] --> Q3["gate"]
  end
  subgraph au["planning-audit"]
    A1["audit"] --> A2["gate"]
  end
```

`gate`가 반려하면 그 게이트가 짚은 부족분을 피드백으로 달아 서브골을 다시 돌립니다. interactive
기획 런은 `investigate` 다음에 `ask` 카드를 띄우고 사람을 기다릴 수 있습니다.

어떤 체인을 쓸지는 런의 **flow**가 정합니다. `develop` → code, `document` → document,
`plan` → planning(또는 planning-light), `qa` → qa, 그리고 QA 뒤의 audit → planning-audit입니다.

기획과 QA도 카드로 돌고, 카드는 모두 위와 같은 전체 런입니다. 기획 카드(`PLAN-F1`, ...)는 자기
워크트리에서, QA 카드(`QA-F1`, ...)는 통합 트리에서 돕니다. 태스크 자신도 카드들을 둘러싸고 같은
여섯 단계를 돕니다. `areas`가 태스크의 plan이고, `plan-integrate`, `accept`, `gate:goal`이 게이트입니다.
그래서 어떤 팀도 앞에 계획 없이, 뒤에 게이트 없이 체인만 돌지 않습니다(설계:
[`docs/plans/2026-09-28-teams-cards-everywhere.md`](../docs/plans/2026-09-28-teams-cards-everywhere.md)).

## 태스크가 끝나는 방식

```mermaid
stateDiagram-v2
  [*] --> running: tm_open
  running --> waiting_human: a card needs a person
  waiting_human --> running: tm_submit or ask_timeout
  running --> blocked: stopped with work left and nothing runnable
  blocked --> running: tm_retry or resume-on-limit
  running --> complete: report written, everything delivered
  running --> partial: report written, something missing
  complete --> [*]
  partial --> [*]
```

| 상태 | 뜻 |
|---|---|
| `running` | 데몬이 작업 중입니다. |
| `waiting_human` | 사람이 처리할 카드가 있습니다. `ask` 질문, `teams:take`로 가져간 단계, `human_gates` 판정 중 하나입니다. `teams:inbox`에서 확인하세요. |
| `blocked` | 할 일이 남았는데 스스로 돌릴 수 있는 것이 없어 멈췄습니다. 재시도 예산 소진, 계속 죽는 드라이버, 사용량 한도 같은 경우입니다. `tm_retry`로 새 시도를 엽니다. |
| `complete` | 보고서가 쓰였고 모든 것이 전달됐습니다. |
| `partial` | **신규.** 보고서는 쓰였지만 전달되지 않은 것이 있습니다. 받아들여지지 않았거나 아예 내보내지 못한 패키지, 실패한 integrate, 판정 없이 끝난 QA나 audit, 통과하지 못한 `gate:goal`, 확정 실패·도달 불가 노드 등입니다. 무엇이 빠졌는지는 `partial_reasons: [...]`에 있습니다. |

## 빠른 시작

**설치.** `teams@newkayak12-claude-skills`를 설치하면 두 MCP 서버가 등록됩니다(`tm_*`/`team_*`
도구가 안 보이면 Claude Code를 다시 불러오세요). `teams:install`은 선택입니다. 프로젝트 기본값을
`.claude/team.json`에 고정하고, 디스패치 게이트와 `.claude/conventions/`를 추가합니다. 설치하지
않으면 내장 기본값으로 돕니다. 자세한 내용:
[docs/configuration.KOR.md#설치](docs/configuration.KOR.md#설치).

**실행.** 작업에 맞는 진입 스킬을 고르세요. 어느 것이든 같은 종류의 태스크를 엽니다.

| 스킬 | 쓰는 경우 |
|---|---|
| `teams:orchestrate` | 무엇이든. flow는 엔진이 고릅니다. |
| `teams:develop` | 코드. |
| `teams:document` | 설계 문서, 가이드 같은 글 산출물. |
| `teams:plan` | PRD. |
| `teams:qa` | 기존 결과물에 대한 테스트 케이스 작성과 실행. |
| `teams:sprint` | 우선순위가 매겨진 백로그를 예산이나 타임박스 안에서 돌리고 회고로 마무리. |

관리용 스킬: `teams:install`, `teams:remove`(프로젝트 설정), `teams:patch`(이 저장소 소스의
릴리스 버전 올리기).

**지켜보기.** 직접 몰 필요는 없습니다. 이렇게 지켜보면 됩니다:

| 보고 싶은 것 | 쓰는 것 |
|---|---|
| 전체 EPIC, 또는 EPIC 하나의 STORY 보드 | `teams:board` (`tm_board`) |
| 티켓 하나 (`E-xxxxxxxx`, `E-xxxxxxxx/P2`) | `teams:ticket` (`tm_ticket`) |
| 티켓이 지금 무엇을 하는지 | `teams:log` (`tm_log`) |
| 나를 기다리는 것 | `teams:inbox`, 답은 `teams:submit`, 카드 가져오기는 `teams:take` |
| 브라우저의 실시간 페이지 | `node teams/scripts/view.mjs` (pipeline, tickets, resources 뷰, `--once`는 텍스트 출력) |

티켓은 `Initiative(선택) > EPIC > STORY > TASK` 구조입니다. `I-<slug>`, `E-xxxxxxxx`(태스크),
`E-xxxxxxxx/Pn`(패키지. 기획 카드는 `E-xxxxxxxx/PLAN-F1`, QA 카드는 `E-xxxxxxxx/QA-F1`),
`E-xxxxxxxx/Pn/<subgoal>`(노드 체인).

**헤드리스 / CI.** `scripts/run.mjs`는 세션 없이 태스크를 열고 끝날 때까지 기다립니다:

```
node teams/scripts/run.mjs "<request>" [--kind auto|develop|document] [--size S|L]
  [--budget-usd <n>] [--timebox-minutes <n>] [--json] [--resume-on-limit]
node teams/scripts/run.mjs --resume <task_id>
```

| 종료 코드 | 뜻 |
|---|---|
| `0` | `complete` |
| `3` | `partial`: 보고서는 쓰였으나 전부 전달되지는 않음 |
| `2` | `waiting_human`: 질문이 출력됩니다. `tm_submit`으로 답한 뒤 `--resume` |
| `1` | 그 밖에 멈춘 경우 (`blocked`, 기다려도 풀지 못한 사용량 한도) |
| `64` | 잘못된 인자 |
| `130` | Ctrl-C: 태스크는 데몬에서 계속 돌고, CLI만 지켜보기를 멈춤 |

전체 플래그, `--resume-on-limit` 동작, `--json` 이벤트 스트림:
[docs/configuration.KOR.md#헤드리스](docs/configuration.KOR.md#헤드리스).

## 설정

프로젝트 기본값은 `.claude/team.json`에 둡니다. 우선순위는 내장 기본값 < `team.json` <
`tm_open`/`team_open`에 준 같은 이름의 인자입니다. 모르는 키나 잘못된 값은 무시되고
`tm_status`에 기록됩니다. 스키마는 `mcp/teamconfig.mjs`의 `TEAM_DEFAULTS`입니다. 키별 전체 설명은
[docs/configuration.KOR.md](docs/configuration.KOR.md#설정)에 있습니다.

| 키 | 기본값 | 하는 일 |
|---|---|---|
| `vendor` | `"auto"` | 노드를 돌릴 모델 벤더. |
| `allocation` | `"ordered"` | 노드를 벤더에 배분하는 방식(`"ordered"` 또는 `"balanced"`). |
| `goal_threshold` | `90` | 목표 게이트가 통과시키는 최소 일치율(%). |
| `max_retries` | `2` | 패키지, shape, 서브골별 재시도 횟수. 넘으면 실패가 확정됩니다. |
| `retry_policy` | `"continue"` | 재시도가 실패한 시도의 워크트리 위에서 이어갈지, 먼저 되돌릴지. |
| `roles` | `{planning:"auto", qa:true, audit:true}` | 기획 카드가 어떤 체인을 도는지(`true` 전체, `"light"`, `"auto"`는 인수 기준이 적혀 있으면 가벼운 체인), 그리고 QA 카드와 audit을 돌지. `planning: false`는 거부되고 노트로 남습니다. 기획은 항상 돕니다. |
| `brainstorm` | `true` | `decisions`가 없을 때 엔진이 직접 brainstorm 단계를 돕니다. |
| `interactive` | `false` | 질문, 지정, 사람 게이트가 사람을 기다릴지, 기본값으로 결정할지. |
| `human_gates` | `[]` | 모델 대신 사람이 판정할 심사 단계(`"critique"`, `"accept"`, `"gate:goal"` 등). |
| `ask_timeout` | `null` | 답 없는 `ask` 카드가 기본 답을 택하기까지의 밀리초. `null`이면 무한정 기다립니다. |
| `max_parallel_teams` | `"auto"` | 동시에 돌리는 develop 패키지 수. `"auto"`는 사용량 제한과 크래시에 맞춰 조절합니다. |
| `max_parallel_ceiling` | `null` | `"auto"` 조절기의 상한. `null`이면 CPU 수에서 계산합니다. |
| `driver_restarts` | `2` | 죽은 드라이버를 다시 띄우는 횟수. 넘으면 그 디스패치는 blocked가 됩니다. |
| `restart_period_minutes` | `0` | `driver_restarts`를 이 분 단위 슬라이딩 윈도로 셉니다. `0`이면 전체 기간을 셉니다. |
| `stall_minutes` | `20` | 이만큼 진척 없는 드라이버는 표시하고, 3배가 지나면 죽인 뒤 다시 띄웁니다. `0`이면 끕니다. |
| `budget_usd` | `null` | 태스크 전체 비용 한도. 100%에 이르면 새 작업을 내보내지 않고 보고서로 마무리합니다. |
| `timebox_minutes` | `null` | 같은 멈춤을 `tm_open` 이후 경과 분으로 잽니다. |
| `budget_grace_usd` | `null` | 멈춘 뒤 돌고 있던 디스패치가 죽기 전까지 더 쓸 수 있는 비용(미설정 시 `budget_usd`의 10%). |
| `budget_grace_minutes` | `5` | 멈춘 뒤 돌고 있던 디스패치가 죽기 전까지 더 쓸 수 있는 시간. |
| `qa_rounds` | `2` | QA나 audit 라운드가 수정 STORY를 낼 수 있는 횟수. 넘으면 `unresolved_defects`로 갑니다. |
| `upstream_fix_rounds` | `2` | 패키지 하나에 등록할 수 있는 업스트림 수정 횟수. |
| `docs_dir` | `.teams_output/team` | 페이즈 문서(`INDEX.md`, STORY별 페이지, 보고서)를 쓰는 곳. |
| `plugin_dirs` | `[]` | 모든 드라이버와 심사 세션에 더 넘길 `--plugin-dir` 경로. |
| `initiative` | `null` | 여러 EPIC을 보드에서 묶는 라벨. 표시용일 뿐입니다. |

`goal_judges`와 `auto_reassign`은 호출 인자로만 줄 수 있고 `team.json` 키가 아닙니다.

## 더 보기

- [CHANGELOG.KOR.md](CHANGELOG.KOR.md): 모든 릴리스, 최신순.
- [docs/configuration.KOR.md](docs/configuration.KOR.md): 키별 전체 설명, 스프린트 동작
  (`requests`, 인수 기준, 예산, `retro.json`, `context_from`), `view.mjs` 뷰, 헤드리스 세부 사항.
- [`docs/plans/`](../docs/plans/)의 설계 문서:
  [`2026-09-11-teams-taskmanager.md`](../docs/plans/2026-09-11-teams-taskmanager.md)와
  [`2026-09-21-teams-server-owns-the-loop.md`](../docs/plans/2026-09-21-teams-server-owns-the-loop.md)부터
  읽으세요. 지금의 원칙은
  [`2026-09-28-teams-cards-everywhere.md`](../docs/plans/2026-09-28-teams-cards-everywhere.md)에 있습니다.
- [`graph/KOR.md`](../graph/KOR.md): 공유하는 브로커 내부(도구, 라우팅, 판정, 벤더, 용량 복구,
  원장). 이 엔진의 수정은 두 플러그인 사이에 옮겨 적용됩니다. teams는
  [`harness`](../harness/KOR.md)의 런타임 게이트 프로토콜에 다른 프로젝트와 똑같이 연동하며, 두
  플러그인 어느 쪽의 베타도 아닙니다.

## 변경 이력

모든 릴리스를 최신순으로: [CHANGELOG.KOR.md](CHANGELOG.KOR.md).
