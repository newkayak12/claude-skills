# teams — 설정·운영 레퍼런스

[English](configuration.md) · **한국어** · [README로 돌아가기](../KOR.md)

`.claude/team.json` 키별 전체 설명과 스프린트·지켜보기·헤드리스 세부 사항입니다. 예전 KOR.md에서 그대로 옮겨 왔고, README에는 각각 한 줄 요약만 남겼습니다.

> **참고 (2026-09-28):** 아래 표의 `qa_rounds` 행은 코드보다 오래됐습니다. `qa_rounds`는 QA / planning-audit 라운드가 수정 STORY를 낼 수 있는 횟수를 제한합니다(넘으면 `unresolved_defects`로 갑니다). `budget_grace_usd` / `budget_grace_minutes`는 `TEAM_DEFAULTS`에 있지만 표에 행이 없습니다 — `tm_open` 인자 설명을 보세요.

## 설치

`teams@newkayak12-claude-skills`를 설치하는 것만이 유일하게 선택이 아닌 단계입니다 —
`teams-engineering`과 `task-manager` MCP 서버를 등록하기 때문입니다. 이후 `tm_*`/`team_*`
도구가 보이지 않으면 Claude Code를 재시작하세요. 마켓플레이스 플러그인 대신 소스
체크아웃을 쓴다면, 프로젝트 `.mcp.json`에 `mcp/broker.mjs`를 `teams-engineering`으로,
`mcp/taskmanager.mjs`를 `task-manager`로 등록합니다 — `skills/install/SKILL.md`의 "Install
modes" 절이 두 항목을 모두 보여줍니다.

그 다음 `teams:install`을 실행하는 것은 선택이며, 태스크를 돌리기 위한 전제조건이 아닙니다 —
모든 실행 스킬(`orchestrate`/`develop`/`document`/`plan`/`qa`)은 두 MCP 서버만으로 팀을
돌리고, `.claude/team.json`이 전혀 없으면 `TEAM_DEFAULTS`(아래)로 대체합니다. 프로젝트가
플러그인의 내장 기본값 대신 자신만의 기본값, dispatch 게이트, `.claude/conventions/`를
갖추기로 한 시점에 `teams:install`을 실행하세요 — 무엇이 추가되는지는
[`skills/install/SKILL.md`](../skills/install/SKILL.md), 설치 없이 도는 기본 경로는
[`skills/orchestrate/SKILL.md`](../skills/orchestrate/SKILL.md)의 "Running without install" 절을
참고하세요.

## 설정

`.claude/team.json`은 `tm_open`과 `team_open` 양쪽 모두에 프로젝트 기본값을 공급합니다 —
브로커의 직접 진입점인 `team_open`도 이제 TaskManager와 같은 방식으로 이 파일을 읽습니다.
우선순위는 내장 기본값 < `team.json` < 런을 연 도구의 같은 이름 명시적 인자입니다
(`teamconfig.mjs`의 `resolveTeamOptions`); 알 수 없는 키나 검증기를 통과하지 못한 값은
적용되지 않고 무시되며, 기록됩니다 — `tm_open` 경로에서는 `tm_status`의 `team.notes`,
`team_open` 경로에서는 `team_status`의 `config_notes`(노트가 하나라도 있을 때만 나타나며,
`resolveTeamOptions`의 노트를 런에 영구 저장해둔 사본입니다 — 실시간 재검사가 아닙니다).
스키마는 [`mcp/teamconfig.mjs`](../mcp/teamconfig.mjs)의
`TEAM_DEFAULTS`/`CHECK`입니다 — 21개 키 중 실제로 동작에 반영되는 건 열아홉이고, 각 키가
`tm_open`, `team_open`, 또는 둘 다에 닿는지 보여주는 리더 열이 추가되었습니다. `team_open`의
`inputSchema`는 애초에 `TEAM_DEFAULTS` 이름 중 일부만 인자로 받습니다 — 인자로조차 받지 않는
키는 `resolveTeamOptions`가 무엇을 계산해내든 그 경로에서는 `team.json`으로 닿을 수 없습니다.

| 키 | 기본값 | 동작에 반영? | 리더 | 하는 일 |
|---|---|---|---|---|
| `vendor` | `"auto"` | 예 | `tm_open` + `team_open` | 벤더 선택: `tm_open`에서는 모든 자식 런(`child_opts.vendor`), `team_open`에서는 런 자신(`run.vendor`). |
| `allocation` | `"ordered"` | 예 | `tm_open` + `team_open` | `"ordered"` vs `"balanced"` 라우팅: `tm_open`에서는 모든 자식 런(`child_opts.allocation`), `team_open`에서는 런 자신(`run.allocation`); `"balanced"`가 무엇을 바꾸는지는 `graph`의 상태 로그 참고. |
| `goal_threshold` | `90` | 예 | `tm_open` + `team_open` | goal-gate 바닥값. `tm_open`: 매니저 자신의 바닥값, 그리고 — 커밋 `f765c03` 이후 — 모든 자식 런이 자기 goal gate를 여는 바닥값(`child_opts.goal_threshold`); 그 커밋 전에는 프로젝트가 고정한 값이 모든 패키지에서 조용히 버려져 `team.json`이 뭐라 하든 모든 자식은 하드코딩된 90으로 돌았습니다. `team_open`: 런 자신의 goal-gate 바닥값(`run.goal_threshold`) — 같은 부류의 버그를, 같은 방식으로, 한 라운드 늦게 고쳤습니다. |
| `max_retries` | `2` | 예 | `tm_open` + `team_open` | 재시도 예산. `tm_open`: 매니저 자신의 subgoal/패키지 예산, 그리고 — `f765c03` 이후 — 모든 자식 런이 여는 예산(`child_opts.max_retries`), `goal_threshold`와 같은 `f765c03` 이전 문제를 겪었습니다. `team_open`: 런 자신의 재시도 예산(`run.max_retries`) — `TEAM_DEFAULTS.max_retries`(2)가 이미 `createRun`의 기본값과 같았기 때문에, `team.json`이 없는 프로젝트는 이 배선으로 동작이 전혀 바뀌지 않았습니다. |
| `driver_restarts` | `2` | 예 | `tm_open`만 | 죽은 패키지 또는 size-S 드라이버가 같은 run_id로 몇 번 재기동되는지 — 그 다음엔 dispatch가 `blocked`로 접힙니다. `team_open`의 인자가 아닙니다 — `team_open`은 드라이버 재기동 개념이 없는 단일 그래프 런을 열 뿐이라, `team.json` 고정값이 그 경로에는 닿을 수 없습니다. |
| `stall_minutes` | `20` | 예 | `tm_open`만 | 드라이버가 살아있어도(pid가 `process.kill(pid,0)`에 응답해도) 진행이 없을 수 있습니다 — 멈춰버린 모델, 에러 없는 provider hang, 끝나지 않는 tool call. `serviceStalledDriver`(`taskmanager.mjs`)는 이 값을 `daemon.mjs`의 `waitForProgress`가 그 자식에 대해 이미 지켜보는 것과 같은 파일들(브로커 런 파일과 그 ledger)의 mtime에 대조해 읽습니다. 이만큼 idle이면 dispatch를 한 번 플래그하고(`stalled_since`, `child_driver_stalled`로 기록, 진행이 재개되는 순간 `child_driver_progress_resumed`로 해제), 3배만큼 idle이면 드라이버를 죽이고(`child_driver_killed`, `reason: 'stalled'`) 재기동은 기존 dead-driver 경로(`serviceDeadDriver`)에 맡깁니다 — 이 경로는 크래시 때와 똑같이 재시작 예산을 소비합니다. 첫 번째 임계값은 그 자체로는 절대 죽이지 않습니다 — idol-pm-4는 런 도중 정당하게 16분짜리 tool-call 간격을 가진 적이 있습니다. `0`이면 이 검사 전체가 꺼집니다. `team_open`의 인자가 아닙니다 — `driver_restarts`와 같은 이유로 `team_open`에는 드라이버 재기동 개념 자체가 없습니다. |
| `restart_period_minutes` | `0` | 예 | `tm_open`만 | `driver_restarts`는 기본적으로 평평한, 영원한 카운터입니다(여기 `0` — 오늘의 동작: 이 런이 겪은 모든 죽음이 예산에 반영됩니다). `0`보다 크면 분 단위의 OTP 스타일 슬라이딩 윈도우가 됩니다 — `serviceDeadDriver`는 자신의 타임스탬프(`driver.restarts[].at`, 모든 죽음마다 이미 기록됨)가 최근 `restart_period_minutes` 안에 드는 재기동만 셉니다. 그래서 매주 한 시간에 한 번씩 죽는 패키지가 "연속으로 몇 번 죽었는가"를 재려고 만든 예산을 결코 소진하지 않습니다. `driver_restarts`와 같은 이유로 `team_open`의 인자가 아닙니다. |
| `docs_dir` | `.teams_output/team` | 예 | `tm_open`만 | `tm_docs`/`tickets.mjs`가 phase 문서 트리(`INDEX.md` 등)를 렌더링하는 위치. `team_open`의 인자도 개념도 아닙니다 — `team_open`은 phase 문서 트리를 쓰지 않습니다. |
| `plugin_dirs` | `[]` | 예 | `tm_open`만 | 모든 자식 드라이버와 judge 세션에 추가로 주어지는 `--plugin-dir` 경로들(`driverArgv`/`judgeArgv`) — 메서드 테이블이 이름을 붙인 스킬을 위해 `pluginroots.mjs`가 이미 찾아낸 경로 위에 더해집니다(v0.18.0). `team_open`의 인자가 아닙니다 — `team_open`은 호출자 자신의 세션 안에서만 돌아가며, plugin dir을 건네줄 자식 드라이버나 judge 프로세스가 아예 없습니다. |
| `max_parallel_teams` | `"auto"` | 예 | `tm_open`만 | `advanceDispatches`(`taskmanager.mjs`, `tm_next`와 데몬 루프가 공유)가 한 번에 여는 develop STORY dispatch 수를 제한합니다 — phase-Team 패키지(PLAN/QA/audit)는 개수 집계와 상한 양쪽 모두에서 예외입니다. `"auto"`(고정값 `2` 추측을 대체한 측정 기반 컨트롤러의 기본값)는 이 숫자를 AIMD 컨트롤러에 맡깁니다 — `taskmanager.mjs`의 `ensureAutoParallel`/`updateAutoParallel`, 상태는 `task.auto_parallel`에 저장: `2`에서 시작해, 용량 신호 없이 develop STORY dispatch 폴드가 `AIMD_WINDOW`(2)번 연속 정상 종료할 때마다 상한(`max_parallel_ceiling` 참고)까지 `+1`; 신호가 오면 즉시 절반으로(최소 `1`) — dispatch 자신의 드라이버 로그/stderr에 rate-limit/429/529/overloaded/quota 에러 문구가 있거나(`PUSHBACK_RE`, `driverUsageLimitText`가 이미 드라이버 스트림을 읽는 방식 그대로 재사용), 서로 다른 두 패키지의 드라이버 재시작이 5분 이내에 몰려 있으면(`crashesClustered`, 각자의 `driver_restarts` 예산은 다 쓰지 않았어도) 신호로 간주합니다. 조정마다 태스크 원장에 기록되고(`auto_parallel_increased`/`auto_parallel_decreased`), 현재 상한과 이유는 `tm_status`의 `auto_parallel` 필드에 나타납니다. 정수를 고정하면 이 컨트롤러가 있기 전과 똑같이 그 값에 상한이 고정됩니다 — 이때 `updateAutoParallel`은 아무 일도 하지 않습니다. `team_open`의 인자가 아닙니다. |
| `max_parallel_ceiling` | `null` | 예 | `tm_open`만 | 위 `max_parallel_teams: "auto"` 컨트롤러만 참고하며, 값이 있을 때만 그 상한을 고정합니다 — 없으면 호스트에서 유도합니다(`min(os.availableParallelism()/2, 6)`, 최소 `2`, `taskmanager.mjs`의 `autoParallelCeiling`). `team_open`의 인자가 아닙니다. |
| `roles` | `{planning:"auto", qa:true, audit:true}` | 예 | `tm_open`만 | 기획은 항상, 카드로 돕니다(docs/plans/2026-09-28-teams-cards-everywhere.md). plan 단계(`areas`)가 요청을 기능 기준으로 나누고, 영역마다 기획 카드(`PLAN-F1`, ...)가 그 영역의 PRD 섹션을 쓰며, `plan-integrate`가 이를 `10-prd.md` 하나로 합쳐 `shape` 전에 심사합니다. `planning`은 카드가 어떤 체인을 도는지 고릅니다. `true`는 full 체인(investigate → draft → revise → gate), `"light"`는 light 체인(investigate → template-fill → gate), `"auto"`(기본값)는 백로그가 acceptance를 이미 선언했으면(`hasDeclaredAcceptance`) light, 아니면 full. `false`는 거부됩니다. 아래 계층의 값이 그대로 남고 노트가 남습니다(C5). size S 태스크도 단일 런 전에 기획 카드 하나를 거칩니다(C6). `qa`는 `integrate`와 `gate:goal` 사이에 기능 영역마다 QA 카드(`QA-F1`, ...; 각각 cases → execute → gate)를 열고, 라운드가 모두 끝나면 결함을 한꺼번에 등록합니다. `audit`은 planning-audit phase-Team(합쳐진 PRD를 읽는 기획의 두 번째 패스) 스위치입니다. 기본 ON이고, `{"roles": {"audit": false}}`로 통합 후 재검토 없이 PRD만 유지할 수 있습니다. QA와 audit은 size L 태스크에서만 돕니다. `team_open`의 인자가 아닙니다. |
| `interactive` | `false` | 예 | `tm_open` + `team_open` | 이 런이 사람을 기다리며 멈출지, 아니면 기본값으로 결정하고 무엇을 물었을지 기록만 할지. 세 가지를 통제합니다: 판정/결정 스테이지 어디서든 낼 수 있는 `questions[]`(0.29.0, investigate의 `unknowns[]`를 일반화 — `graph.mjs`의 `openAsk`), MODEL이 직접 쓴 `assignee` 핀(shape 패키지 자신의 필드 — `tm_open`에서는 `subgoal_assignee`로 자식 런에 전달됩니다 — 또는 setgoal subgoal 자신의 필드, 양쪽 경로 모두 — 0.27.3 리뷰 이후로), 그리고 `human_gates`(아래). `true`면 핀이 걸린 노드가 `waiting_human`에 멈춥니다; `false`(기본값)면 대신 자동으로 결정됩니다 — 노드는 아무것도 쓰이지 않은 것처럼 AI에게 그대로 디스패치되거나(`human_gates`는 자동 승인), 걸렸을 핀은 노드에 기록되어(`auto_decided_pin`) `tm_inbox`의 `decided` 섹션에 나타납니다. 사람이 직접 부른 `tm_assign` 핀은 출처가 다르고(`{by: 'user'}`로 표시, `graph.mjs`의 `applyHumanPin`) 이 키와 무관하게 항상 멈춥니다 — 사람은 정의상 이미 그 자리에 있으니까요. |
| `brainstorm` | `true` | 예 | `tm_open`만 | `tm_open`에 `decisions[]`가 없으면 `size` 뒤(PLAN/shape 앞)에 `brainstorm` 노드를 열고, 그 결과를 `task.decisions`(source `self-brainstorm`)로 씁니다. `false`면 생략, `decisions[]` 인자가 있으면 항상 생략. (구현된 적 없는 `human_scope`는 deprecated no-op으로 받고 노트만 남깁니다.) |
| `human_gates` | `[]` | 예 | `tm_open` + `team_open` | 어떤 판정 스테이지를 모델 대신 사람이 accept/reject해야 하는지 — 스테이지 이름 목록(`"critique"`, `"gate"`, `"gate:goal"`, 매니저 층에서는 `"accept"`/`"integrate"`/`"areas-critique"`/`"plan-integrate"`도 - `plan-integrate`를 거절하는 사람은 `resplit: true`를 붙여 기능 분할을 다시 하게 할 수 있습니다; `"shape"`처럼 판정이 아닌 스테이지를 적어도 오류는 아니지만 아무 효과가 없습니다 — verdict 필드가 있는 스테이지만 게이트됩니다, `graph.mjs`의 `humanGateVerdictField`). `interactive`와 같은 방식으로 전달됩니다: `tm_open`의 `task.human_gates`와 `child_opts.human_gates`가 모든 패키지의 자식 런까지 닿고, `team_open`은 `createRun`에 바로 전달합니다. 여기 이름 붙은 스테이지의 노드는 드라이버에 절대 가지 않습니다(`graph.mjs`의 `promoteHumanGates`, `promoteWaitingHuman`과 같은 자리에서 호출): `interactive`면 `waiting_human`에 멈춰 `tm_inbox`/`tm_submit({key, payload:{accept, reason?, gaps?}})`로 답합니다 — 핀이 걸린 author 스테이지나 `ask` 카드와 똑같은 경로입니다. 사람의 accept/reject가 그 노드의 결과가 되므로, 거절의 `gaps[]`는 모델 게이트의 거절과 똑같이 재시도로 흘러갑니다. `false`(기본값)면 대신 자동 승인하고(`autoPassHumanGateResult`) 노드에 기록해(`auto_decided_pin`) `tm_inbox`의 `decided`에 띄웁니다 — 아무도 보지 않는 런도 끝나야 하고, 답할 사람이 없는 게이트는 영원히 막는 대신 통과가 기본입니다. |
| `ask_timeout` | `null` | 예 | `tm_open` 전용 | interactive `ask` 카드가 사람을 기다리는 최대 시간(밀리초). 만료되면 엔진이 각 질문의 `default`(없으면 첫 번째 = 권고 선택지 — 비interactive 런과 같은 선택)로 대신 답하고, 결과와 각 결정에 `by: "timeout"`을 기록하며 `tm_inbox`의 `decided`에 올립니다. `null`이면 무기한 대기. 시계는 매니저입니다(멈춘 자식 런에는 드라이버가 없음): 태스크 데몬이 틱마다 확인하고, 할 일이 없어도 종료하지 않고 가장 이른 마감까지 잠들며, 그 태스크를 지목한 `tm_*` 호출도 확인합니다. `ask` 카드만 만료됩니다 — 핀이 걸린 author 스테이지나 `human_gates` 카드에는 default가 없습니다. |
| `retry_policy` | `"continue"` | 예 | `tm_open` + `team_open` | 재시도가 실패한 시도가 남긴 워크트리를 어떻게 다룰지. `"continue"`(기본값, 이 키가 생기기 전까지 유일했던 동작)는 그 위에 다음 시도를 이어 붙입니다 — `ensureWorktree`/`retrySubgoal`은 이미 시도 전체에 걸쳐 같은 트리를 유지해 왔고, 이 키는 그것을 규약으로 선언할 뿐입니다. `"rollback"`은 먼저 워크트리를 되돌린 뒤, `"continue"`와 똑같이 실패한 gate의 gaps를 피드백으로 넘겨 다시 돌립니다: 노드 레벨(`team_open`, 그리고 `tm_open`이 여는 모든 자식 런 — `child_opts.retry_policy`)에서는 `retrySubgoal`이 서브골의 `implement`/`draft`/`cases`/`audit`를 그 서브골의 **첫** 시도가 손대기 전에 `broker.mjs`가 기록한 체크포인트로 되돌립니다 — 런에 서브골이 정확히 하나일 때만입니다(다른 서브골이 아직 같은 워크트리에서 작업 중이면 그쪽 진행 상황까지 지우지 않고는 되돌릴 수 없으므로, 이 가드에 걸리면 `team_retry`의 응답이 `rollback: {skipped: true, reason}`으로 왜 `"continue"`로 대신했는지 알려줍니다). 패키지 레벨(`tm_open`만, `retryPackage`)에서는 반려된 패키지 재시도가 마지막으로 **승인된** 커밋으로 되돌립니다(`commitWorktree`는 `accept:true`일 때만 커밋합니다) — 그 패키지의 어떤 시도도 통과한 적이 없다면 워크트리 자신의 base 커밋으로. `docs/plans/2026-09-23-teams-reducer-human-rollback.md` §5가 기본값을 정하기 전에 실제 런 둘을 측정했습니다: 둘 다 재시도된 `implement`가 같은 실수를 반복하는 대신 자기 gate의 피드백에 **수렴**하는 것을 보여줬고(52%→60%→78%, 74%→78%), 그래서 시도가 만든 작업을 버리는 쪽이 더 낫다는 근거는 아직 없습니다. |
| `budget_usd` | `null` | 예 | `tm_open`만 | 기본은 무제한. 이 태스크가 띄운 모든 세션에서 매 데몬 tick마다 지출을 합산합니다(`collectTaskCosts`): 패키지/S 드라이버와 매니저 판정 호출(`drivers/*.stream.jsonl`, 재기동 포함), 그리고 자식 런의 노드 어댑터 세션(`.teams_output/broker/<run>/<node>/<attempt>/events.jsonl`). 각 세션의 마지막 `result` 이벤트의 `total_cost_usd`를 읽으므로 아직 도는 세션은 끝나야 잡히고, codex 노드는 비용을 보고하지 않습니다. `requests`가 2개 이상이고 상자가 있으면 size L로 고정됩니다. shape 전에 멈추면 대기 그래프를 건너뛰고 report는 그대로 돕니다. 80% 지점에서 `enforceBudget`(`taskmanager.mjs`)이 경고를 한 번 기록하고(`tm_status`의 `budget.warn`), 100% 지점에서는 새 패키지를 더 이상 디스패치하지 않습니다 — 이미 돌고 있는 패키지는 끝까지 돕니다 — 그리고 더 이상 돌고 있는 게 없으면, 수락된 패키지만으로 새 `integrate`를 엽니다(`reintegrateBehind` — 결함 신고나 repair가 이미 쓰는 것과 같은 메커니즘), 나머지는 조용히 버리는 대신 리포트의 "Next backlog"에 이름을 남깁니다. `budget_usd`/`timebox_minutes` 중 자기 한도에 더 가까운 쪽이 정지를 결정합니다 — 둘 중 하나만 있어도 실제 정지 조건입니다. `team_open`의 인자가 아닙니다 — `team_open`은 이걸 묶어줄 패키지/드라이버 개념이 없는 단일 graph 런을 엽니다. |
| `timebox_minutes` | `null` | 예 | `tm_open`만 | `budget_usd`와 같은 정지 조건을, 금액 대신 시계로 — `tm_open` 이후 경과 분. 80%/100%가 정확히 무엇을 하는지는 `budget_usd` 행 참고. `budget_usd`와 같은 이유로 `team_open`의 인자가 아닙니다. |
| `max_depth` | — | — | — | 2026-09-28 폐기: 중첩 태스크(sub-EPIC)는 없습니다. 한 EPIC에 안 끝나는 일은 다음 Sprint로 이월합니다(`carryover_candidates`). 아직 이 키가 있는 team.json은 폐기 안내 메모를 받습니다. |
| `qa_rounds` | `2` | 아니요 | `tm_open`만 | 기록만 되고 아직 무동작 — 어디서도 읽지 않습니다. `team_open`의 인자가 아닙니다. |
| `upstream_fix_rounds` | `2` | 예 | `tm_open`만 | 다운스트림 패키지 자신의 fix-forward 루프에 상한을 겁니다(§upstream_defects, `taskmanager.mjs`의 `fileUpstreamDefects`): 패키지의 implement/test/gate, 또는 그것을 판정하는 매니저 자신의 `accept`가 자기 `touches[]` 바깥, 즉 자신이 `deps`로 의존하는 패키지 안에서 결함을 신고할 수 있습니다 — `awake-beta-ref2`(2026-09-25): P3는 커널 `comm` 문자열로 Claude Code를 식별하도록 승인되었지만 P4 자신의 호스트에서는 그 가정이 성립하지 않았고, P4는 어떤 재시도로도 고칠 수 없는 시도를 실패시키는 것 말고는 경로가 없었습니다. (QA가 낸 결함이 이미 거치는 것과 같은 메커니즘인) `fileDefects`/`reintegrateBehind`를 재사용해 UPSTREAM 패키지 자신의 스코프로 귀속되는 fix STORY를 발행하고(그 패키지의 `touches`/`deps`, `reporter`는 그것을 찾은 다운스트림 패키지 자신의 id, `origin: "upstream"`, `link: {type:"blocks", target:<upstream 패키지 id>}`), 그다음 DOWNSTREAM 패키지 자신의 다음 시도를 열어 `accept:<upstream>:N` 의존을 그 fix의 accept로 다시 연결합니다 — 그래서 같은 고장난 upstream에 맹목적으로 재시도하는 대신 fix를 기다렸다가 그 위에서 다시 돕니다. `qa_rounds`가 `dispatch:QA` 노드 수를 세는 것과 같은 방식으로, 해당 upstream 패키지에 이미 발행된 모든 fix STORY 수(어느 다운스트림 패키지가 다음 것을 찾았는지와 무관하게)로 셉니다; 상한을 넘으면 발행 대신 `task.unresolved_defects`에 기록되고, 다운스트림 패키지는 평소의 재시도/settle 경로로 돌아갑니다. `team_open`의 인자가 아닙니다 — `team_open`은 패키지/`deps`/upstream 개념이 없는 단일 graph 런을 엽니다. |
| `initiative` | `null` | 예 (표시/그룹핑 전용) | `tm_open`만 | EPIC 위에 놓는 선택적 라벨입니다(`Initiative(선택) > Epic > Story > Sub-task`) — 하나의 결과를 향한 여러 EPIC. 슬러그로 정규화되어(`teamconfig.mjs`의 `normalizeInitiative`: 소문자화, 영숫자가 아닌 연속 문자를 `-` 하나로 뭉침) `I-<slug>` 키가 됩니다. `tm_board`(task_id 없이)는 같은 tasks root의 어느 태스크든 하나라도 이 값을 가지면 모든 EPIC을 이걸로 묶습니다 — `groups: [{initiative, key, epics}]` 배열이며, initiative가 없는 EPIC도 빠지지 않도록 `null` 그룹에 담깁니다; 아무도 설정하지 않았다면 지금까지와 정확히 같은 평평한 `{epics}` 목록을 그대로 반환합니다. `tm_ticket("I-<slug>")`는 그 그룹의 EPIC들을 상태와 비용과 함께 나열합니다. 표시/그룹핑 전용입니다 — 스케줄링이나 실행에는 절대 관여하지 않고, 한 태스크를 다른 태스크 안에 중첩시키지도 않습니다. `team_open`의 인자가 아닙니다 — `team_open`은 EPIC/그룹핑 개념이 없는 단일 graph 런을 엽니다. |

`goal_judges`(goal gate의 독립 판정자 수)와 `auto_reassign`(거부된 판정의 자동 재시도)는
실재하는 런 단위 옵션입니다 — `tm_open`/`team_open` 자신의 인자 설명 참고 — 하지만 이 스키마에는
없습니다: 이 글을 쓰는 시점 기준으로는 호출마다 명시 인자로만 줄 수 있고, `.claude/team.json`에
고정할 수는 없습니다. `team_open`은 프로젝트의 `team.json`에 무엇이 있든 자신의 `goal_judges`
기본값 2를 그대로 유지합니다 — 그 파일 안의 `goal_judges` 키는 다른 미지의 키와 마찬가지로
그냥 무시됩니다.

## 스프린트: 백로그, 예산/타임박스, 회고

`sprint` 스킬은 `tm_open`과 아래 조각들을 하나의 스크럼 형태 런으로 묶습니다 — 백로그를 위한
`requests`, 박스를 위한 `budget_usd`/`timebox_minutes`, 데일리를 위한 기존
`tm_board`/뷰어, 리뷰를 위한 리포트, 회고를 위한 `retro.json`과 `context_from`. `tm_open`
자체 밖에 새로운 메커니즘은 없습니다 — 이 절은 각 조각이 무엇을 하는지 설명할 뿐입니다.

- **`requests: [...]`** — `tm_open`은 `request`(문자열 하나) 또는 `requests`(문자열 배열,
  우선순위 = 배열 순서, 0번이 최우선) 중 하나만 받습니다 — 둘 다 주거나 둘 다 안 주면 거부됩니다.
  `requests`는 size/shape/PLAN이 이미 읽는 태스크의 단일 합성 `request` 텍스트("[backlog
  priority N] ...")가 되고, 원본 배열은 shape의 브리핑과 회고를 위해 `task.requests`에 그대로
  남습니다. `shape`는 각 패키지의 기존 `priority` 필드를 백로그 순서에 맞춰 설정하라는 지시를
  받습니다 — 낮은 우선순위 항목만 담당하는 패키지는 나중에 디스패치되어야, 예산/타임박스가
  먼저 바닥나더라도 디스패치되지 못한 채 남는 쪽이 되기 때문입니다(`advanceDispatches`는 이미
  `priority` 오름차순으로 먼저 디스패치합니다). 단일 `request`는 그대로입니다 — 이 경로 전체는
  `requests`가 실제로 주어졌을 때만 돕니다.
- **acceptance** — 항목을 `{request, acceptance: [...]}`로 줄 수 있고, `shared_acceptance: [...]`는
  모든 항목(또는 단일 `request`)에 적용됩니다. 둘 다 요청 텍스트에 `Acceptance:` 블록으로 들어갑니다.
  acceptance가 선언돼 있으면 - 이 필드들, 또는 번호 매긴 백로그 + `Acceptance for every item:`
  헤딩과 불릿 - 기본값 `roles.planning: "auto"`가 가벼운 PLAN 체인을 돌립니다(위 `roles` 참고).
- **`budget_usd` / `timebox_minutes`** — 위 설정 표 참고. `tm_status`의 `budget` 필드(둘 중
  하나라도 설정됐을 때만 존재)가 `{pct, over, warn, spend, elapsed_minutes}`를 실시간으로
  담습니다.
- **회고 다리** — `report`가 완료되면 `docs.mjs`의 `renderRetro`가 `80-report.md` 옆에(같은
  `docs_dir`) `retro.json`을 씁니다: `retrospective`(무엇이 왜 실패했는지, 재시도, 남은 결함)와
  `next_backlog`(수락되지 못한 패키지, 미해결 결함, 아무도 답하지 않은 열린 질문 — 디스패치된
  각 패키지 자신의 자식 런이 가진 `unasked[]`에서 best-effort로 읽습니다). `80-report.md`도
  같은 두 절을 산문으로 담습니다. `tm_open({context_from: "<이전 task_id 또는
  E-xxxxxxxx>"})`는 그 이전 태스크의 `retro.json`을 읽어 새 태스크의 `context`에 접어 넣습니다
  (`priorRetroContext`, `taskmanager.mjs`) — best-effort입니다: 아직 리포트가 없는 이전
  태스크나 풀리지 않는 참조는 `tm_open`을 실패시키는 대신 `context`를 그대로 둡니다. 새
  태스크의 `requests`는 여전히 호출자 자신의 말로 써야 합니다 — `context_from`은 무슨 일이
  있었는지를 건네줄 뿐, 완성된 백로그를 건네주지 않습니다.

## 태스크 지켜보기

`tm_status`/`tm_board`/`tm_events`는 구동 세션을 위한 기계 형태 JSON을 돌려줍니다 — 사람이
들여다볼 물건이 아닙니다. `scripts/view.mjs`가 그 별도의 사람용 표면입니다: 의존성 없이
동작하는, 읽기 전용 CLI로 task-manager 태스크(실행 중이든 끝났든)를 페이지나 텍스트 트리로
그려줍니다 — 이 도구들이 이미 읽는 것과 같은 `task.json`과 자식 런 파일에서 만들어집니다.

```
node teams/scripts/view.mjs [--tasks-dir <dir>] [--task <id>] [--port <n>] [--once] [--view pipeline|tickets|resources]
```

`--once` 없이 실행하면 `127.0.0.1`에 로컬 HTTP 서버를 띄우고 URL을 출력합니다: 열어보면
~3초마다 폴링하는 실시간 화면을 볼 수 있고, 뷰가 세 개입니다 (탭으로 즉시 전환되며, 추가
요청 없이 같은 폴링 결과를 그대로 씁니다):

- **pipeline**(기본값) — request, size/flow/state, 지금까지의 비용과 턴 수, 매니저 파이프라인
  (size → shape → critique → 디스패치된 패키지마다 카드 하나 → integrate → gate:goal →
  report)이며 각 패키지 카드는 펼치면 그 자식 런의 노드 체인(그리고 패키지 워크트리 안에
  중첩된 태스크가 있다면 재귀적으로 그것까지)을 보여줍니다. 원장 이벤트 최근 50개도 함께
  표시됩니다.
- **tickets** — 그 태스크의 JIRA식 보드입니다: EPIC 헤더(키, 제목, 티켓 상태, phase —
  `tm_board`/`tm_ticket`과 같은 어휘), 그리고 패키지마다 STORY 카드 하나씩을 상태 컬럼으로
  묶어 보여줍니다(빈 컬럼은 생략). 카드마다 키, role, reporter/filed-by, `implements[]`/
  `enables[]`, deps, 시도 횟수, 그 TASK 자식들(`E-xxxxxxxx/Pn/Un`)의 상태, 그리고 사람이
  잡고 있거나 핀이 걸린 카드에는 뚜렷한 표시가 붙습니다. 전체 티켓 계층은
  `Initiative(선택) > Epic > Story > Sub-task`입니다 — `E-xxxxxxxx` 위에 `I-<slug>`
  (`tm_open({initiative})`, 표시/그룹핑 전용: `tm_board`의 전체 EPIC 목록과
  `tm_ticket("I-<slug>")`가 이걸로 묶습니다 — Configuration의 `initiative` 행 참고), 그다음
  STORY용 `E-xxxxxxxx/Pn`과 그 TASK 자식용 `E-xxxxxxxx/Pn/subgoalId`. STORY 자신의 `reporter`는
  발행한 TEAM을 가리키고(`planning`/`qa`/`audit`/`user`/upstream fix라면 develop 패키지 id),
  `origin`은 그것을 만들어낸 STAGE(`shape`/`repair`/`phase`/`qa`/`planning-audit`/`upstream`/
  `tm_file`)를, `link`(upstream fix에만)은 그것이 겨냥하는 대상을 가리킵니다. 이 태스크별
  tickets 뷰 자체는 initiative 그룹핑으로 바뀌지 않습니다 — 그것은 태스크를 가로지르는
  개념이라 전체 EPIC 인덱스 쪽에 표시됩니다(`--once`의 텍스트 인덱스와 페이지 자신의 EPIC
  카드 모두에 행마다 `initiative` 태그로).
- **resources** — 지금 실제로 배정된 팀 계층입니다: TaskLeader(그 태스크의 daemon — pid,
  생존 여부, 시작 시각) → STORY마다 Team 하나(워크트리, 브랜치, TeamLeader = 그 자식 런의
  driver — pid, 생존 여부, 재시작 횟수, 비용/턴, `waiting_capacity`가 있으면 그것까지) →
  TASK 노드마다 worker(stage, executor/model, 상태, 소요 시간, 사람이 잡고 있다면 누구인지),
  패키지 워크트리 안에 중첩된 태스크는 자기 자신의 하위 트리로 나타납니다.

`--tasks-dir`은 기본으로 `tasksRoot()`(`HARNESS_TASKS_DIR`, 없으면 `~/.harness/tasks`)를
쓰고, `--task`를 생략했는데 디스크에 태스크가 여러 개 있으면 인덱스 화면을 대신 보여줍니다.
`--once`는 서버 없이 뷰 하나를 평문 텍스트 트리/보드로 출력합니다 — 터미널이나 CI 로그용이며,
`--view`로 어느 것을 고를지 정합니다(기본 `pipeline`) — `tickets`/`resources`는 태스크 하나로
좁혀지지 않으면 같은 태스크 인덱스로 대신합니다.

세션 안에서 티켓 하나를 따라가려면 `tm_log({key, tail?, since?})`(얇은 스킬 `teams:log`,
`/teams:log E-xxxxxxxx/P2`)가 그 키가 이미 가리키는 로그의 꼬리를 읽기 쉬운 줄로 돌려줍니다:
STORY 키는 최신 dispatch의 드라이버 스트림(`child.driver.log`, 스트림 이벤트 하나당 한 줄 —
assistant 텍스트, `-> 도구 대상`, `<- 결과`, turns/cost가 붙은 마지막 `result`)을, EPIC 키는
태스크 ledger(`HH:MM:SS event k=v`)를 읽습니다. 파일 끝에서부터 마지막 `tail`줄(기본 50,
최대 500)만 읽고 스트림 전체는 읽지 않습니다. 응답의 `cursor`를 `since`로 다시 넘기면 그 뒤에
덧붙은 줄만 돌아옵니다.

## 헤드리스

`scripts/run.mjs`는 대기 모델 C입니다(`docs/plans/2026-09-21-teams-server-owns-the-loop.md`
§4): `tm_run`이 여는 방식 그대로 태스크를 열고, `tm_wait`가 기다리는 방식 그대로 완료까지
기다립니다 — 둘 다 재구현이 아니라 재사용이며, 세션이 루프에 없고 기다리는 동안 컨텍스트
비용도 없습니다. 헤드리스로 teams를 공정하게 재는 방법이 이것입니다. 벤치의
`scripts/bench/drive.sh`도 이제 teams arm(`beta`/`betas`/`skills`)을 `claude -p` 세션을
지켜보는 대신 이 CLI로 돌립니다(`DRIVE_VIA=session`이면 예전 방식). CI나, 태스크 하나가
끝나기만 하면 되는 셸 스크립트에도 이 CLI가 맞는 진입점입니다.

```
node teams/scripts/run.mjs "<request>" [--kind auto|develop|document] [--cwd <path>]
  [--budget-usd <n>] [--timebox-minutes <n>] [--vendor <v>] [--allocation ordered|balanced]
  [--size S|L] [--context <text>] [--poll-ms <n>] [--json] [--resume-on-limit] [--max-resumes <n>]
node teams/scripts/run.mjs --resume <task_id> [--json] [--resume-on-limit] [--max-resumes <n>]
```

`--resume-on-limit`(opt-in)은 drive.sh가 세션 바깥에서 하던 사용 한도 대기를 옮겨온 것입니다.
태스크가 사용 한도 때문에 `blocked`로 끝나면(용량 대기로 주차된 size-S 런, 한도로 실패한
패키지) 한도 메시지의 리셋 시각("resets 11:50pm (Asia/Seoul)", 없으면 30분 뒤)을 데몬과 같은
`capacityResetAt`로 읽어 3분 유예까지 1분 단위로 자고, `tm_retry({reset_capacity})`(주차된
드라이버) 또는 `tm_retry({package_id})`(실패한 패키지)로 재개한 뒤 계속 기다립니다. 최대
`--max-resumes`회(기본 6). 재개 경로가 없는 한도(재판정을 다 쓴 manager judge)나 아무것도
재개되지 않으면 포기하고 `1`로 끝납니다. `--json`에는 `limit`/`limit_resumed`/`limit_gave_up`
이벤트가 찍힙니다.

노드 전이마다 한 줄, `tm_wait`가 새 소식 없이 타임아웃되면 하트비트 한 줄을 찍고, 마지막에
리포트 경로를 담은 줄을 찍습니다. 종료 코드: `0` 완료; `2` `waiting_human`(헤드리스는 카드에
답할 수 없으니 무한정 멈춰있지 않습니다 — 대기 중인 질문을 출력합니다; 세션에서 `tm_submit`로
답한 뒤 `--resume`하세요); `1` 완료하지 못하고 멈춘 그 외 전부(`blocked` 등); `64` 잘못된
인자. SIGINT는 런을 멈추지 않습니다 — 이 호출이 띄운(또는 `--resume`이 찾아낸) 데몬은 어차피
detached + `unref()` 프로세스이므로, CLI는 지켜보기만 멈춥니다: 태스크 id와 `--resume`/조회
방법을 출력하고 `130`으로 종료합니다. `--json`은 산문 대신 줄마다 JSON 객체 하나를 출력하고,
`exit_code`와 `report`를 실은 `event: "final"` 줄로 끝납니다.
