# teams — 한국어

[English](README.md) · **한국어**

`teams`는 독립된 플러그인입니다: 브로커가 이끄는 노드-그래프 엔진에, 중·대규모 요청을 패키지로
쪼개 각자의 워크트리에서 자기만의 graph 런으로 돌리는 두 번째 MCP 서버 `task-manager`를 더한
구성입니다. [`graph`](../graph/KOR.md), [`harness`](../harness/KOR.md)와 형제 관계인 플러그인으로
— `graph`와 같은 브로커/graph 엔진 계보를 공유하고 `harness`의 런타임 게이트 프로토콜에 (다른
프로젝트와 마찬가지로) 연동하지만, 어느 쪽의 베타도 아닙니다: 자기만의 MCP 서버, 자기만의 런
디렉터리, 자기만의 릴리스 라인을 갖습니다.

같은 브로커, 같은 핵심 도구 여섯 개, `graph`와 같은 스킬 구조 — 차이는 이것뿐입니다:

| | `graph` | `teams` |
|---|---|---|
| MCP 서버 | `graph-engineering` (`graph_*` 도구) | `teams-engineering` (`team_*`) + `task-manager` (`tm_*`) |
| 런 파일 | `.harness-run/broker/` | `.teams_output/broker/` |
| 스킬 | `graph:install`, `graph:orchestrate` | `teams:install`, `teams:remove`, `teams:patch`, `teams:orchestrate`, `teams:develop`, `teams:document`, `teams:plan`, `teams:qa`, `teams:board`, `teams:ticket`, `teams:inbox`, `teams:take`, `teams:submit` |
| 버전 | 1.x | 0.x |

두 플러그인은 한 프로젝트에 함께 켜도 됩니다: 도구 접두사가 다르고(`graph_*` vs.
`team_*`/`tm_*`) 런 디렉터리도 서로 다르므로, 어느 쪽도 상대의 상태를 자기 것으로 착각하지
않습니다.

## teams가 존재하는 이유

`graph`는 한 가지 모양의 일에 맞춰져 있습니다: 요청이 서브골이 되고, 서브골마다 **파일을 바꾸고**,
git 워크트리에 대해 **명령을 실행해** 검증합니다. 코드엔 맞는 모양이고, 설계 문서·조사 정리·여러
워크트리에 걸쳐 여러 런으로 나눠야 할 만큼 큰 요청엔 틀린 모양입니다 — 그리고 다른 런을 관리하는
런이라는 개념이 없습니다. `teams`는 같은 엔진 계보 위에 바로 그것을 더합니다.

이 플러그인이 더하는 세 가지를 이 순서로, 각각 앞 단계의 테스트 뒤에서 추가합니다:

1. **kind.** 서브골이 어떤 종류의 일인지 선언하고, kind가 어떤 노드 체인으로 펼쳐질지 정합니다.
   `subgoal`(코드)은 지금 그대로 `implement → test → gate`. `document`는 `draft → review → gate`:
   저자 ≠ 리뷰어, 루브릭 기반, 워크트리 변경이 없어도 실패가 아님. 한 스펙에 kind를 섞을 수
   있습니다 — "기능 구현하고 설계 문서 갱신"이 런 하나입니다.
2. **flow별 진입.** `teams:orchestrate`는 아무것도 고르지 않는 진입점으로 남습니다: `plan`이
   크기를 재고 flow를 정합니다. `teams:develop`과 `teams:document`는 얇은 수동 진입 —
   트리거 단어, `flow` 기본값, 페르소나 집합 — 이고 같은 루프에 넘깁니다. 루프는 복제되지
   않습니다.
3. **TaskManager.** 중·대규모 요청용으로 이 플러그인 안의 두 번째 MCP 서버 `task-manager`.
   크기를 재고, `touches[]`와 의존성을 가진 패키지로 나누고, 패키지마다 자식 graph 런을 자기
   워크트리에 엽니다 — **여는 주체는 브로커이고 노드가 아닙니다** — 그리고 자식의 판정을 수용하고
   워크트리를 통합하고 보고합니다. `mcp/graph.mjs`를 라이브러리로 재사용하며(DAG, 간선 타입,
   재시도, 확정 실패) 자식 런 파일은 읽기만 하고 쓰지 않습니다. 작은 요청은 이 층을 통째로
   건너뜁니다.

설계와 단계 목록: [`docs/plans/2026-09-11-teams-taskmanager.md`](../docs/plans/2026-09-11-teams-taskmanager.md).

## 상태
- v0.31.3 — **상자 아래의 기획 경로**: code-sprint-P2(`roles.planning`, $15 상자, 0.31.2)는 PLAN이 수렴한 첫 기획 런입니다 — 모든 기획 gate가 첫 시도에 통과했습니다(93, 92, ...). code-sprint-S2는 93~95점으로 세 번 거절됐던 곳입니다. 대신 $15 중 약 $14.5를 기획에 썼고, 상자는 shape 직후 패키지 하나 돌리지 못한 채 멈췄습니다. 그 경로에서 결함 둘: 수락된 패키지가 0개인 integrate가 열려 판정받았고(이제: 수락된 게 없으면 report를 뺀 대기 노드를 정리), goal gate가 `accept:AUDIT:1`을 기다렸는데 그 노드는 멈춘 상자가 금지한 dispatch로만 생깁니다 — 대기 노드는 있고 실행 가능한 건 없어 데몬이 25분을 기다렸습니다. `closeStoppedToReport`가 이를 교착으로 보고(멈춘 뒤의 준비된 dispatch도 교착), 패키지 정리가 할 일이 없을 때만 돕니다. 실제 P2 태스크는 데몬 재시작으로 풀려 report로 닫혔고, 백로그 네 항목이 모두 다음으로 넘어갔습니다.
- v0.31.2 — **도는 세션의 비용이 보이고, codex는 명령을 돌릴 수 있음을 증명해야 한다**: (1) 아직 도는 드라이버 세션에는 result 이벤트가 없어 끝날 때까지 $0으로 읽혔습니다 — code-sprint-P1의 PLAN 세션은 42분째 $15 상자 중 약 $8.83을 쓰고도 $0.00이었습니다. `collectDriverCosts`가 이제 assistant 메시지의 토큰 사용량(입력 1, 캐시 쓰기 1.25, 캐시 읽기 0.1, 출력 5)에 같은 태스크의 끝난 같은 종류 세션의 단가를 곱해 추정합니다 — dispatch 세션 단가는 5.2~5.7e-6으로 측정됐고, result 이벤트를 지운 세션은 실제 $1.46에 대해 $1.47로 추정됐습니다. 끝난 세션이 없으면 claude-opus-5-5의 측정 단가로 대체합니다(`uncalibrated`). 상태와 뷰어는 `(~$x running, estimated)`로 보여주고 상자도 이를 셉니다. (2) codex 준비 점검은 CODEX_READY라고 답하게만 해서, read-only 샌드박스가 뜨지 못하는(bubblewrap) 이 머신에서 판정 단계를 받았고, 명령을 못 돌린 gate가 0점으로 거절했습니다. 이제 점검이 무작위 토큰이 든 파일을 `cat`하게 합니다 — 실제 CLI로 확인(`reachable: false`). (3) 비대화형 작성 단계에 작성 중 발견한 결정도 기본값으로 정하고 미결 질문으로 남기지 말라고 알립니다(PLAN draft가 새 미결 질문 9개를 만들었습니다).
- v0.31.1 — **다음 Sprint는 지난 Sprint 위에 짓는다**: teams는 통합 브랜치를 프로젝트 브랜치에 합치지 않습니다. 그래서 code-sprint-S8의 후속 스프린트(`context_from`)가 P1/P2 결과 없이 `seed` 위에서 열렸습니다. 이제 `retro.json`이 `integration_branch`를 기록하고, `80-report.md`가 아직 합쳐지지 않았다고 알리며, `context_from`으로 연 태스크는 이전 통합 브랜치가 HEAD에 없으면 `base_ref`를 받아 패키지·통합 워크트리를 그 브랜치에서 분기합니다(합쳐진 뒤에는 다시 HEAD). `context_from` 자체는 실런에서 동작했습니다 — 후속 스프린트의 `requests`가 출하되지 않은 두 항목과 정확히 같았습니다. retro 잡음: reshape나 새 시도로 대체된 노드는 더 이상 실패로 나열하지 않고, `blocking`/`gaps`/`problems`/`unowned`로 논증한 거절도 사유로 읽습니다. `UPDATE_GOLDEN=1`이 docs 골든을 다시 만듭니다.
- v0.31.0 — **이전 실런 훑기에서 남은 것**: (1) 통과한 critique의 `problems[]` 중 패키지를 지목한 것이 그 패키지의 자식 컨텍스트와 accept 판정에 전달됩니다(`critiqueNotesFor`) — idol-beta-ask1의 "P4를 10,000으로 올려라"는 아무도 읽지 않았습니다. (2) 사람의 결정은 서브골 하나가 아니라 런 전체의 것입니다: `openAsk`의 필터와 모든 브리핑의 `prior_decisions`가 런 전체의 답을 싣고 `decided_for`로 표시합니다(팬클럽 등급을 U1에서 답했는데 U2·U3에서 다시 묻고 반대로 답함). (3) report 전에 막힌 태스크도 `80-report.md`(state BLOCKED)를 남깁니다 — 막는 노드와 사유, 움직일 `tm_retry` 호출, 그리고 `retro.json`. (4) 어댑터 이벤트 스트림에만 있는 공급자 사용량 한도(codex 형태)도 allocation과 무관하게 다른 공급자로의 fallback입니다 — code-sprint-S2의 두 번째 PLAN 런은 codex "You've hit your usage limit" 종료로 재시도를 다 썼습니다. (5) 비대화형 런은 `unasked` 질문을 draft/revise/implement에 **기본값으로 결정됨**(추천안, "default - revisit" 표시)으로 넘깁니다 — code-sprint-S2의 PLAN gate가 93~95점으로 세 번 거절한 이유는 문서가 그 질문을 열어둔 채 검증 표가 답을 단정했기 때문입니다.
- v0.30.3 — **멈춘 Sprint의 goal gate**: code-sprint-S6(예산 $5)는 네 패키지 중 셋을 출하하고 다시 통합했습니다(`integrate:3` 통과). 그런데 goal gate가 `accept: true`, 72점을 주고도 전체 목표 기준 90에 걸려 실패했고, report 없이 blocked로 끝났습니다. 두 가지를 고쳤습니다. 패키지를 건너뛴 정리 뒤에는 goal gate의 하한을 면제합니다(`goal_floor_waived`에 이유를 남기고, 거절은 여전히 거절). 그리고 데몬이 `daemon_done` 전에 `enforceBudget`을 한 번 더 돌립니다 — 한 바퀴 끝에서 실패한 노드는 다음 바퀴 첫머리의 정리가 보기 전에 태스크를 blocked로 만들었습니다.
- v0.30.2 — **멈춘 Sprint는 리뷰로 닫힌다**: code-sprint-S5(예산 $5)는 정확히 멈춰야 할 곳에서 멈췄습니다 — P2 수락 뒤 108%, P3/P4 정리, P1+P2로 `integrate:2`. 그리고 report 없이 `blocked`로 끝났습니다. 네 가지를 고쳤습니다. (1) 0.30.0의 "사유 없는 거절" 검사가 reason/gaps만 봐서, integrate가 `unowned`/`evidence`에 쓴 논거를 사유 없음으로 읽었습니다 — 이제 계약이 사유를 담는 모든 필드를 셉니다(제가 만든 회귀, 실런이 찾음). (2) 재판정이 예약된 채로 데몬이 `daemon_done`을 기록했습니다(`pendingRejudgeAt` — 이제 기다립니다). (3) 정지 뒤의 integrate와 goal gate에 건너뛴 패키지는 설계상 범위 밖이라고 알리고, 남은 집합으로 판정하게 합니다. (4) 멈춘 뒤에는 repair·reshape를 열지 않고(재시도는 이미 막혀 있었음), report 앞에서 막힌 그래프는 report를 뺀 대기 노드를 정리해(`budget_closed`) Sprint가 항상 `80-report.md`와 `retro.json`으로 끝납니다. 참고: code-sprint-S4(예산 $10, 0.30.1 probe가 실행 단계를 self로 보냄)는 네 패키지를 전부 첫 시도에 넘겼습니다 — 9/9, $8.88, 21분.
- v0.30.1 — **명령을 못 돌리는 claude 노드는 준비된 것이 아니다**: code-sprint-S3(`vendor: auto`)가 13분 만에 P1을 세 번 실패했습니다. claude 어댑터 노드마다 `node --test`에 "This command requires approval"이 떴습니다 — `workspace-write`는 `--permission-mode acceptEdits`로 도는데, Write는 통과시키고 Bash는 프로젝트 설정에 맡기며, 헤드리스에서는 거부됩니다. 준비 점검은 Write만 시켰으니 ready라고 답했습니다. 이제 점검이 세션에게 `node`를 실행해 실행해야만 나오는 sha256을 쓰게 합니다. Bash에 승인이 필요한 곳에서는 not ready("could not run a command in this profile")가 되고 `auto`는 다음으로 넘어갑니다. 이 머신의 실제 CLI로 확인했습니다. 이전 벤치 런은 `vendor: self`라 이 길을 밟지 않았습니다.
- v0.30.0 — **실런으로 잰 Sprint의 상자**: 첫 스프린트 벤치(`bench.sh sprint code`, 2026-09-26)와 이전 실런 다섯 개를 읽기 전용으로 훑은 결과입니다. (1) **상자가 자기가 가두는 것을 보지 못했습니다** — 비용이 패키지 드라이버만 셌고, 매니저 판정 호출(이제 `drivers/judge_<node>.stream.jsonl`)과 `vendor: auto`에서 노드마다 뜨는 어댑터 세션(`.teams_output/broker/<run>/<node>/…/events.jsonl`)이 빠졌습니다. code-sprint-S2는 실제 $3.95를 쓰고 $0.88로 읽었습니다. `collectTaskCosts`가 예산·리포트·`tm_status`/`tm_board`(`drivers_usd`/`nodes_usd`)·뷰어·score에 들어갑니다. `vendor: self` 런은 원래 온전했고, codex 노드는 여전히 비용을 보고하지 않습니다. (2) **상자가 걸린 백로그는 L로 고정**(`size_pin_source: boxed-backlog`) — S 태스크에는 상자가 남겨둘 패키지가 없습니다. (3) **shape 전에 예산이 바닥나면** 대기 그래프를 건너뛰고 report를 엽니다. 상자가 멈춘 뒤에는 재시도를 열지 않습니다. `retro.json`에 `next_backlog.unshipped_requests`가 생기고(shape가 패키지마다 `backlog: [N]`을 선언), `context_from`이 이를 넘깁니다. 아무것도 못 찾은 `context_from`은 그렇다고 말합니다(`context_from_unresolved`). (4) **생존 판정**: 좀비 pid는 죽은 것(`mcp/proc.mjs`), 긴 대기 뒤 다시 뜬 드라이버는 낡은 진행 시각이 아니라 자기 시작 시각부터 잽니다, "resets 3pm"을 읽습니다, 재시작 예산을 다 쓴 죽은 드라이버의 dispatch는 `running`으로 남지 않고 접힙니다(idol P6, 16시간+), `CLAUDE_PLUGIN_ROOT`가 없으면 teams 플러그인 경로를 모듈 위치에서 얻습니다. (5) **설명 없는 거절·재시도 없음**: 사유·gap 없는 거절은 재판정, `daemon_retry_opened.reason`에 피드백이 실립니다. (6) 뷰어가 상자(`budget $x/$y (n%)`, WARN/STOPPED)와 shape 전 PLAN 팀을 보여줍니다. 훑기에서 남은 것: 뒤집히고 PRD에 반영되지 않는 결정, 사라지는 critique 지적, 사람에게 올라가지 않는 막힌 기획.
- v0.29.2 — **같은 결정을 두 번 묻는다**: idol-beta-ask1을 계속 돌려 셋을 더 찾았습니다. 전부 추측이 아니라 측정입니다. (1) **0.28.7의 소유자 분할이 실모델에 닿았습니다** — U4의 3회차 조사가 `ask:U4:3`~`ask:U4:3e`, 한 스테이지에서 소유자별 5장을 열었습니다. (2) **재시도가 이미 정해진 것을 다시 물었습니다.** U4의 draft가 두 번 실패하고 3회차 조사가 6문항을 냈는데 2건이 `ask:U4:1`에서 답한 것과 **글자까지 동일**했습니다 — 재시도가 그 노드를 폐기했으니 아래쪽은 알 방법이 없었습니다. 나머지 4건은 같은 결정의 재표현이라 문자열 필터로는 잡히지 않습니다. 양쪽을 다 고쳤습니다: `openAsk`가 같은 소유자의 이전 시도에서 답해진 질문을 떨어뜨리고(엔진이 직접 저장한 문자열의 정확 일치), `nodeBriefing`이 `prior_decisions`를 새 시도의 **모든** 스테이지에 "Already decided by a person — settled, do not raise these again"으로 실어 보내며, `CONTRACT.investigate`에 그런 결정은 finding이고 **재표현해서도 다시 묻지 말라**고 적었습니다. 카드에 `ask_owner`를 달아 시도 간·매니저 층에서도 일치가 성립합니다. (3) **카드 5장에 티켓 키 1개.** 소유자 분할이 서브골 키를 모호하게 만들었고, `tm_submit`은 마지막 대기 카드를 골라 해결했습니다 — 한 소유자의 답이 다른 소유자의 질문에 조용히 적용됩니다. 이제 `tm_inbox`가 `ask` 카드를 자기 node id로 키잉하고(키 3번째 칸이 이미 node id를 받습니다), 핀된 저작 카드는 서브골 키를 유지하며, 모호한 키는 추측으로 풀지 않고 **쓸 수 있는 키들을 알려주며 거부**합니다. 테스트 4개 추가.
- v0.29.1 — **큐에 든 답을 적용할 드라이버가 없다**: 0.28.4의 handoff 큐가 매니저를 자식 런 파일에서 완전히 떼어냈습니다 — `tm_submit`은 큐에 넣고 브로커가 적용합니다. idol-beta-ask1(2026-09-25)이 그것이 남긴 구멍을 찾았습니다. 카드 3장에 답했고 셋 다 큐에 들어갔고 `tm_submit`이 각각 `done`을 반환했는데, 그 뒤 자식 드라이버가 드레인 전에 죽었습니다. 아무도 되살리지 않았습니다 — 큐는 브로커가 비우고, 브로커는 드라이버 안에서만 돌고, `tm_submit`의 되살리기는 **큐에 넣는 그 호출에서만** 발동하며(`alreadyQueued`가 같은 카드의 재제출을 옳게 거부합니다), `serviceDeadDriver`는 런을 `waiting_human`으로 읽고 일찍 빠져나갔습니다 — 멈춘 런에 드라이버가 있을 이유가 없다는 것은 **적용 대기 중인 답이 생기기 전까지만** 참입니다. 접수된 답 셋이 적용되지 않은 채, 적용될 경로도 없이 남았습니다. 이제 `serviceDeadDriver`는 handoff 큐가 비어 있지 않은 멈춘 자식을 재기동하고, 큐가 빈 자식은 그대로 둡니다 — "대기 중 컴퓨트 0"은 그대로입니다. 멈춰 있던 그 런에서 검증했습니다: 새 드라이버의 첫 폴에서 큐가 비고, 카드 4장이 모두 `done`이 되고, draft가 그 결정 위에서 돌았습니다. 테스트 1개 추가.
- v0.29.0 — Reducer 레지스트리, 체크포인트 되돌리기와 멱등 제출, 모든 판정 단계의 사람 질의와 human_gates, 판정자 독립성 보완, Sprint(예산·타임박스, retro.json, requests[] 백로그, sprint 스킬), 앞 패키지 결함 fix STORY, 목표 판정 하한 여유 구간, 기획 audit 보고서 수정, 비용·턴 집계와 뷰 수정.
- v0.28.9 — critique가 파운데이션 패키지 비대화와 완전 직렬 구조를 사실 정보로 확인하고(강제 차단 아님), tm_status에도 노출
- v0.28.8 — match 하한 아래에서 결함을 기록한 accept:QA가 이제 done으로 끝나 결함을 fix STORY로 넘깁니다. 결함을 버리고 같은 트리에 QA를 다시 돌리지 않습니다.
- v0.28.7 — **카드는 소유자 한 명에게 간다**: 첫 실제 interactive 런(idol-beta-ask1, 2026-09-24)이 `ask` 경로를 끝까지 증명했습니다 — 실모델이 `options[]`를 그 도메인의 실제 미결 규칙으로 채웠고(1인 구매 상한, 환불 스케줄, 결제 홀드, 선예매 등급, 용량 가정, SLA, 안티봇), 런이 멈췄고, `tm_inbox`가 카드를 올렸고, `tm_submit({key, payload:{decisions}})`가 답했고, draft 브리핑이 답 전부를 "Decided by a person — 확정이니 열린 질문이 아니라 규칙으로 쓰라" 아래에 실어 왔습니다. 동시에 결함도 드러냈습니다: 문항 7개에 **소유자가 5종**인데 전부 한 카드에, 첫 번째 사람 앞으로. 그 카드는 아무도 답할 수 없습니다. 이제 `openAsk`가 소유자별로 묶어 카드를 하나씩 엽니다(`ask:U1:1`, `ask:U1:1b`, `ask:U1:1c` — 형제 목표 게이트 판정자가 이미 쓰는 접미사), draft는 **전부**에 의존하므로 한 소유자가 아직 정하는 중에 문서가 쓰이지 않고, 소유자 없는 질문은 남의 카드가 아니라 자기 카드를 받습니다. 소유자가 하나면 카드 id는 전과 똑같이 `ask:<서브골>:<시도>` 하나입니다. `bench.sh`에 `TEAM_JSON` 추가 — `.claude/team.json`을 그대로 씁니다. `interactive`가 벤치에서 닿지 않았고, 이것은 `TEAM_ROLES`가 막으려던 것과 같은 구멍입니다. 테스트 2개 추가.
- v0.28.6 — QA execute가 결함을 발견해도 성공으로 처리되어 동일한 코드로 재시도하지 않고, 결함이 dispatch 결과와 브리핑을 통해 accept:QA와 fileDefects로 흐르며, 결함을 기록한 채 실패한 QA dispatch는 무조건 재시도 대신 결함으로 파일링됩니다
- v0.28.5 — 칸반 이론 기반 티켓 개선: blocked_reason(미해결 의존성/용량 대기/재시작 소진/사람 대기), 대기 경과시간, board.jsonl 기반 플로우 지표(WIP/처리량/사이클·리드타임), 오래된 중첩 태스크 복사본이 live로 표시되던 문제 수정
- v0.28.4 — 드라이버 liveness에 진행 신호가 추가되고(stall_minutes가 진행 없는 드라이버를 먼저 플래그한 뒤 죽임) driver_restarts가 평평한 영원 카운터 대신 슬라이딩 윈도우(restart_period_minutes)가 될 수 있습니다
- v0.28.3 — board/ticket의 WAITING_HUMAN 드리프트와 human_assignments 누락을 고치고, 사람이 waiting_human 카드를 집어들 진입점(inbox/take/submit, tm_inbox/tm_assign/tm_submit)을 새로 추가
- v0.28.2 — **reshape 뒤의 재시도가 끝나지 않을 노드를 기다렸다**: idol-pm-4(2026-09-23)는 예산이 남은 패키지 재시도 넷을 pending으로 둔 채 `blocked`로 끝났습니다. `retryPackage`가 그 패키지의 첫 dispatch에서 deps를 복사했는데, reshape 두 번 뒤의 첫 dispatch는 버려진 회차의 것이라 deps가 둘 다 skipped인 `critique`와 `accept:P1:1`이었습니다. 재시도는 ready가 될 수 없었고 daemon은 할 일이 없다고 봤습니다. 이제 deps는 현재 shape 회차의 dispatch(살아 있는 critique를 기다리는 것)에서 가져옵니다. 재시도 예산도 그 회차 안에서 셉니다. 지금까지 넣은 accept를 전부 세면 reshape 한 번마다 모든 패키지의 재시도가 하나씩 사라졌기 때문입니다. 벤치: `idol` 케이스는 이름 때문에 문서 체크리스트로 채점되던 것을 전용 기준(기획 문서·스토리·critique 통과·패키지 dispatch와 수용·통합·통합 트리 테스트)으로 채점합니다. 새 `awake` 케이스(Claude Code가 일하는 동안에만 맥을 깨워 두는 SwiftPM 메뉴바 앱)가 다음 레퍼런스 실행입니다. `drive.sh`는 자기가 살아 있는 동안만 `caffeinate -i -w $`를 걸고 실제 시각 기준으로 잡니다. idol-pm-4가 잠든 노트북에 5시간을 잃었기 때문입니다. 테스트 1개 추가.
- v0.28.1 — **사람이 가져간 카드도 엔진 규칙을 그대로 따르고, 실런 결함 둘이 사라졌다**. 0.27.3을 설계와 대조한 리뷰, 그리고 처음으로 패키지를 빌드한 기획 런 idol-pm-4(2026-09-23)에서 나온 변경 넷입니다. (1) 매니저가 자식 런 파일에 쓰지 않습니다. README는 자식 런을 읽기만 하고 쓰지 않는다고 적는데, 0.27.3의 `tm_assign`·`tm_submit({key})`가 직접 썼습니다. 이제 사람의 핀·제출·`ask` 답은 자식 broker 디렉터리 아래 handoff 파일(run 파일과 같은 락)에 쌓이고, 자식 broker가 다음 호출 때 `team_submit`과 같은 코드로 비웁니다. `broker.mjs`는 import해도 안전해졌습니다. (2) 사람의 `changed_files`도 AI와 같은 워크트리 대조를 거칩니다(설계 §7). 바뀌지 않은 파일을 바꿨다고 하면 잡힙니다. (3) 무조건 사람을 기다리는 것은 사용자가 직접 한 `tm_assign`뿐입니다. shape나 setgoal 모델이 적은 `assignee`는 `interactive`가 켜져 있을 때만 기다리고, 아니면 AI에게 가면서 노드에 `auto_decided_pin`을 남기며 `tm_inbox`의 `decided`에 뜹니다. (4) `view.mjs`에 TICKET 뷰(STORY 카드를 상태 열로, TASK 자식·담당자·사람 대기 표시)와 RESOURCE 뷰(TaskLeader → Team → worker: pid·생존·재시작·비용·턴)가 생겼습니다. 페이지 탭이나 `--once --view tickets|resources`로 봅니다. idol-pm-4에서 나온 것: `accept`의 90% 하한(0.24.0)이 판정자가 막지 않는 약점에 깎은 점수까지 거절로 바꿨습니다. P2·P5는 gap 없이 88%로 수용됐는데 처음부터 다시 빌드됐습니다. 이제 하한 미달 accept는 gap을 명시했을 때만 떨어집니다(`gate:goal`은 그대로). 그리고 `.harness-tasks` 파일 8개가 P1의 제품 브랜치에 커밋됐습니다. 패키지 cwd는 `/private/var/...`, tasks 루트는 `/var/...`로 들어와 `harnessPathsUnder`가 한 트리의 두 표기를 비교했습니다. 이제 양쪽을 realpath로 봅니다.
- v0.28.0 — **사람이 내리는 결정을, 노드로**: 0.26.0의 `investigate`는 어떤 출처도 답하지 못한 것을 이름 붙여 내놓지만, 그것들은 전부 문서의 열린 질문으로 들어갔고 런은 **아무에게도 묻지 않은 채** 끝났습니다 — 신중해 보이지만 실은 기본값으로 결정한 것입니다. 이제 unknown은 `options[]`를 답니다: 후보 2~4개, 권고안이 첫 번째, 각각 그것을 고르면 따라오는 결과와 함께. 후보를 나열하는 것은 여전히 조사이지 결정이 아닙니다 — 결정권자에게 필요한 건 백지가 아니라 선택지입니다. `interactive: true`로 연 런(`tm_open`/`team_open` 인자, 또는 `.claude/team.json`의 `interactive`)에서는 그런 unknown이 `investigate`와 `draft` 사이에 `ask` 카드를 엽니다. `draft`의 데이터 엣지가 그리로 옮겨가므로 **선택이 존재하기 전에는 아무것도 쓰이지 않습니다.** 새 기계장치는 필요 없었습니다 — 카드는 0.27.3이 들여온 사람 핀을 달고 태어나 `waiting_human`에 멈추고, `tm_inbox`가 질문·선택지·조사가 지목한 담당자와 함께 목록에 올리며, `tm_submit({task_id, key, payload: {decisions}})`가 답합니다. 부수적으로 둘을 고쳤습니다: `tm_submit({key})`가 노드를 `authorStage`로 계산해서 kind의 체인에 없는 스테이지는 애초에 지목할 수 없었고(이제 실제로 기다리고 있는 노드를 지목합니다), `taskTicketState`가 WAITING_HUMAN을 이름 붙은 스테이지에서만 읽어 `ask` 카드가 떠 있는데 READY로 보였습니다. 답은 열린 질문이 아니라 **확정된 규칙**으로 `draft`에 닿습니다. 끄면(기본값입니다 — 아무도 안 보는 런도 끝나야 하니까) 질문은 `run.unasked`에 기록되어 보고서가 무엇이 기본값으로 결정됐는지 보일 수 있습니다. 테스트 13개 추가.
- v0.27.4 — **findings 경로는 배정되는 것이지 고르는 것이 아니다**: 0.26.0은 각 `investigate`에게 "형제가 서로 덮어쓰지 않도록 이 서브골 이름을 따서" findings 파일명을 지으라고 했습니다 — 규약이고, 같은 지시를 받은 형제 다섯이 `U1-investigate.md`, `U3-1-investigate-notes.md`, `investigate-U4-findings.md`, `investigate-U2-findings.md`, `decisions/investigate_U5_1-findings.md`를 냈으며, 하나가 재시도하면서 새 이름을 골라 고아까지 남겼습니다. 이제 경로는 파생됩니다: 서브골 자신의 출력 경로에서 확장자를 떼고 `-findings.md`를 붙입니다. `files[]`에는 넣지 않습니다 — 0.26.4가 그것을 "서브골이 쓰는 경로 하나"로 엄격히 좁히고 스펙 검사로 다른 경로를 거부하게 했습니다 — 대신 `reduce`에게 그 파생 이름은 예상된 것이고 **다른 이름의 findings 파일이야말로 잡아야 할 미선언 사례**라고 알려줍니다. D1의 후반부와 D3의 일부(재시도가 같은 산출물에 두 번째 이름을 붙이지 못함)가 이것으로 닫힙니다. 테스트 1개 추가.
- v0.27.3 — **사람이 카드를 가져간다**: 보드의 모든 카드는 지금까지 모델만 할 수 있는 일이었습니다. `tm_assign({task_id, key, to: "human", who})`가 STORY(패키지)나 TASK(서브골 하나)를 사람에게 붙이고 — dispatch 전이든 후든 — `to: "auto"`가 되돌립니다. 같은 핀을 shape의 패키지에 `assignee: "human"`으로 적을 수도 있습니다. 사람에게 가는 것은 쓰는 단계(implement / draft / cases)뿐이고, test·review·gate는 자동으로 남아 누구도 자기 일을 스스로 판정하지 않습니다. 핀된 노드는 드라이버로 가지 않고 새 노드 상태 `waiting_human`에서 멈춥니다 — 재시도 예산도 컴퓨트도 쓰지 않고, `dispatchSettled`는 그것을 죽은 것으로 읽지 않으며, 티켓은 `WAITING_HUMAN`을 보입니다. 헤드리스 드라이버는 사람에게 닿을 수 없으므로 메인 세션이 `tm_inbox`(key, 제목, acceptance, briefing 경로, 담당자, 대기 시작)로 일을 찾고 `tm_submit({task_id, key, payload})`로 제출합니다. 그 뒤 흐름은 드라이버가 제출한 것과 똑같이 이어지고, gate가 거절하면 다음 시도는 모델이 아니라 같은 사람에게 다시 열립니다. 제출 후 드라이버는 그 자식 런을 돌리는 드라이버가 없을 때만 재기동합니다. 아직 아닌 것: 질문(`ask`), `gate:human`, 롤백. 테스트 29개 추가.
- v0.27.2 — **shape 계약이 요구한 패키지를 커버리지 검사가 금지했다**: `CONTRACT.shape` 규칙 1(0.24.0)은 조립 루트와 패키지 간 계약을 정확히 한 패키지가 소유하라고 하고, 같은 버전의 커버리지 검사는 `implements[]`가 빈 패키지를 거절했다. 기반만 소유하는 패키지는 스스로 전달하는 스토리가 없으니, 둘을 동시에 만족하려면 거짓말을 해야 했다. idol-pm-4(2026-09-23)가 1회차에 정확히 그렇게 했고(기반 패키지 P1에 US-7을 붙임), 사실대로 쓴 2회차는 P1·P7에 스토리가 없다는 이유로 `validateShape`에 거절당했다. 이제 그런 패키지는 자기가 가능하게 하는 스토리를 `enables[]`에 적고, 계약은 커버리지를 넘기려고 `implements[]`에 스토리를 적지 말라고 한다. `enables[]`는 실제 스토리여야 하며 전달로 치지 않는다. 테스트 1개 추가.
- v0.27.1 — **파일 하나에 주인이 둘인데 shape가 통과했다**: `validateShape`가 `touches`를 문자열로만 비교해서, idol-pm-4(2026-09-23)는 P1이 `src/identity/module.ts`를, P2가 `src/identity/**`를 소유한 채 critique까지 갔다. 컨텍스트 폴더마다 같았다 — P1이 각 `src/<context>/module.ts`를, 그 컨텍스트 패키지가 폴더 전체를 주장했다. 이제 포함 관계를 센다: 끝의 `/**`·`/*`는 디렉터리를, 맨 디렉터리는 그 아래를 주장하며, 겹치면 두 표기를 다 적고 하나를 좁히라고 말한다. 그 밖의 와일드카드(`src/*.test.ts`)는 여전히 자기 자신만 맞는다 — 무엇을 덮는지 추측하면 멀쩡한 shape를 떨어뜨린다. 테스트 1개 추가.
- v0.27.0 — **런에 빠져 있던 취합**: 매니저 층에는 병렬 작업이 합류하는 자리가 늘 둘 있었습니다 — `accept`가 자식 하나를 접고(`foldChild`), `integrate`가 브랜치 전부를 머지합니다. 런에는 0개였습니다. 서브골 게이트들이 목표 게이트로 모이는데 그건 판정 노드라 아무것도 쓰지 않으므로, **산출물을 집합으로 본 노드가 한 번도 없었습니다.** 그 자리를 규약이 버티고 있었습니다 — setgoal 계약이 한 파일을 공유하는 서브골들에게 각자 소유한 heading을 밝히라고 말하는 것. `idol-plan-2`(2026-09-23)가 규약이 조용히 깨지는 모습입니다 — 형제 `investigate` 5개가 전부 "서브골 이름을 따서 findings 파일명을 지으라"는 같은 지시를 받고 `U1-investigate.md`, `U3-1-investigate-notes.md`, `investigate-U4-findings.md`, `investigate-U2-findings.md`, `decisions/investigate_U5_1-findings.md`를 냈고, 재시도가 `investigate_U5_2`를 1회차 파일 옆에 고아로 남겼습니다. `reduce`는 런 층의 leader입니다: 서브골이 둘 이상이면 삽입되고, 디스크에 실제로 있는 것을 각 서브골의 선언된 `files[]`와 대조해 넷을 보고합니다 — 없는 선언 경로, 아무도 선언 안 한 파일, 두 서브골이 같이 쓴 경로, 폐기된 시도가 남긴 산출물. **보고하되 고치지 않습니다.** 그래서 reasoning 스테이지입니다 — 결정은 한 층 위의 일이고, 여기서 고치면 봐야 할 게이트에게서 결함을 숨깁니다. `foldChild`가 그 결과를 `set_findings`로 올려 매니저가 그 "위층"이 됩니다. 변경이 드러낸 것 셋: 목표 게이트의 데이터 엣지는 `reduce`로 옮기되 **시야는 좁아지면 안 되므로** 서브골 게이트들이 순서 전용 `after`로 남습니다(안 그러면 보여준 적 없는 작업을 판정합니다). 목표 게이트 재판정이 `deps`만 보고 낡은 라운드를 찾아서, `reduce`가 끼자 재시도한 서브골이 트리를 다시 만들어도 아무도 재판정하지 않았습니다. 그리고 이미 돈 fold는 재시도 때 `reopened`를 올려 다시 열어야 합니다 — `mergeOnto`가 한 broker가 다른 broker의 진행을 되돌리지 못하게 `done → pending`을 거부하므로, 안 올리면 리셋이 조용히 병합돼 사라지고 낡은 fold가 그대로 섭니다. 테스트 6개 추가.
- v0.26.4 — **기획 프롬프트가 spec 검사와 두 군데서 어긋나 기획 런이 시작조차 못 했다**: idol-pm-3(2026-09-23)이 `setgoal`에서 세 번 죽었다. 1·3회차는 `PLANNING_SETGOAL`의 "document subgoal" 표현을 따라 전부 kind `document`로 냈고, `plan` 흐름의 `mixed=false`는 `planning`만 허용한다. 2회차는 kind는 맞췄지만 같은 프롬프트가 `files[]`에 조사자가 열어볼 것을 적으라고 해서 `.claude/team.json`을 넣었고, 문서 경로 규칙이 이를 거절했다. 이제 프롬프트가 kind를 명시하고, `files[]`는 쓰는 markdown 경로뿐이라고 말하며, 읽을 것은 별도 필드 `sources[]`에 적게 한다 — `investigate` 브리핑에만 "Sources to open first"로 들어간다. `validateSpec`과 `reduce`는 그대로. 테스트 1개 추가.
- v0.26.3 — **테스트 스위트가 진짜 데몬을 띄우고 있었다**: kill-and-restart 테스트의 두 번째 매니저에 테스트 seam이 없어서, 첫 호출에 진짜 `daemon.mjs`가 떠 `dispatch:P1:1`을 테스트의 `tm_submit`과 동시에 fold했습니다 - 한 워크트리에 `git add` 둘, 진 쪽이 `index.lock`을 보고 통과한 패키지를 실패로 기록(15회 중 4회, 직렬·병렬 무관) - 그리고 이어서 `accept:P1:1`을 진짜 `claude -p`로 판정하러 갔습니다. `node --test` 안에서요. 두 매니저 모두 `HARNESS_TEST_NO_DRIVER`를 받고, `commitWorktree`는 일시적 `index.lock`을 기다립니다(8 x 150ms, 상한 있음): daemon.mjs 헤더가 직접 `tm_submit`이 fold 루프와 경합해도 된다고 했으니 git 단계도 그 경합을 견뎌야 합니다. 테스트 2건 추가, 이후 15회 중 flake 0.
- v0.26.2 — **끝난 런과 배달한 런은 다르다**: 아무것도 못 내놓은 런 위에서 두 표면이 여전히 성공이라고 읽고 있었습니다. `epicTicketState`는 `unreachable` 노드가 남았느냐로 SETTLED를 판정했는데 — 그건 실패가 우연히 남긴 잔해이지 물어야 할 질문이 아닙니다 — 그래서 다른 경로로 아무것도 못 받아들인 채 `report`에 도달한 런은 다시 DONE으로 읽혔습니다. 이제 직접 묻습니다: shape이 선언한 패키지 중 받아들여진 게 하나라도 있나? 패키지를 선언한 적 없는 태스크는 배달할 것이 없었으므로 이 규칙 대상이 아닙니다. 그리고 `runState`는 settleFailure 위에 쓰인 report에 맨 `complete`를 돌려줬는데, 이제 `settled: true`를 함께 싣습니다. 상태 문자열은 일부러 그대로입니다 — 모든 호출부가 `running`/`complete` 외의 것을 `blocked`로 접으므로 새 상태를 넣으면 세 군데에서 동작이 뒤집힙니다 — 대신 기계 판독 표면이 성공이라고 말하기를 멈춥니다. 두 수정 모두 idol-pm-1(2026-09-22)의 이름을 딴 것입니다: 세 번의 shaping 시도, 패키지 0개 디스패치, 그리고 산문은 정직했으나 그 위의 표면은 전부 DONE이라고 말한 보고서. 테스트 2개 추가.
- v0.26.1 — **P1/Q1 라운드를 끝장낸 채점기**: `score.mjs`가 태스크 디렉터리를 `JSON.parse(read(...))`로 읽는데, `read()`는 없는 파일에 `null`을 돌려주고 `JSON.parse(null)`은 던지지 않고 `null`을 돌려줍니다 — `try/catch`가 한 번도 작동하지 않고 다음 속성 접근에서 채점기 전체가 죽었습니다. `task.json`이 아직 안 쓰인 태스크 디렉터리 하나면 충분했고(모든 런의 첫 순간이 그렇습니다), 그것이 첫 기획/QA 역할 벤치를 죽였습니다(`drive-P1Q1.log`: score.mjs:211에서 `TypeError: Cannot read properties of null (reading 'nodes')`). 그래서 §8g의 Q1 — QA phase-Team의 유일하게 예정됐던 실벤더 측정 — 은 런 자체가 나오지 않았고, QA는 여전히 실런 증거가 0입니다. `JSON.parse(read(...))` 다섯 군데 전부 가드.
- v0.26.0 — **기획에는 무언가를 읽는 스테이지가 없었다**: `planning` 체인은 `draft → revise → gate`였습니다. draft는 요청만 보고 쓰고, revise는 draft가 쓴 것을 고치고, gate는 그것을 채점합니다. 다른 종류는 전부 어딘가에서 현실과 부딪힙니다 — `subgoal`의 `test`는 명령을 돌리고 `qa`의 `execute`는 케이스 세트를 실행합니다 — 그런데 기획만 그 접점이 0이라, 도메인의 실제 규칙(선예매가 누구 것인지, 취소 기한이 며칠인지, 1인 한도가 몇 장인지)은 지어내거나 빠뜨리는 것 외에 방법이 없었습니다. 0.25.0은 입력이 0인 스테이지에 계약 문구를 더 써서 답했고, 이번에는 입력을 줍니다. 체인이 `investigate → draft → revise → gate`가 됩니다. `investigate`는 브리핑 바깥을 읽는 유일한 스테이지입니다 — 프로젝트 트리, 요청이 지목하거나 첨부한 자료, 이전 문서, 그리고 검색 도구가 실제로 닿는 경우 도메인의 공개 출처 — 그리고 일부러 분리된 두 목록을 돌려줍니다: `findings`는 각각 그렇게 말하는 출처와 함께, `unknowns`는 닿은 어떤 출처도 답하지 못한 결정을 소유자와 함께. "존재한다고 가정"은 findings의 옷을 입은 unknown입니다. `draft`는 findings에서 쓰고, 모든 unknown을 소유자가 붙은 Open question으로 문서에 들고 갑니다 — 권고는 하되 아무것도 없는 데서 답하지는 않습니다. 대부분 unknown으로 돌아온 스테이지는 성공한 것입니다. 그 unknown들이 작성자가 지어내지 못하게 막는 것이고, 목록을 부풀리는 것만이 이 스테이지가 숨길 수 있는 유일한 실패입니다. 방법론은 `develop:domain-driven-design` + `cognition:assumption-extractor`이고, `setgoal`에는 각 문서의 조사자가 열어야 할 것을 `files[]`에 적으라고 — 쓸 경로만이 아니라 — 말했습니다. 구조 버그 둘이 같이 드러났습니다. `authorStage`가 `chain[0]`이라 revise가 작성자가 아니라 조사자를 상대로 독립성을 검사하게 되고, 결국 작성자가 자기 초안을 퇴고할 수 있었습니다 — 이제 종류가 `author`를 명시합니다. 그리고 `taskTicketState`가 모든 체인을 [author, mid, gate] 3단으로 분해하고 있어서 4단 체인은 `revise`가 gate 자리에 들어갔습니다: 기획 TASK가 revise가 끝나는 순간 DONE으로 보고되고 실패한 gate는 REJECTED가 될 수 없었습니다 — 이제 위치로 유도하며, 작성자 앞 스테이지는 IN_PROGRESS, 작성자와 gate 사이는 IN_REVIEW입니다. 테스트 5개 추가.
- v0.25.0 — **문서 하나로 내라고 한 사람은 아무도 없다**: 실런 두 판 모두 PRD 한 장을 섹션으로 쪼개 썼고, 그 도메인의 규칙들은 결정되는 대신 처리(filed)됐습니다. idol-pm-2의 588줄 PRD는 팬클럽 선예매를 "비즈니스 요구로 존재한다고 가정"만 하고 유저 스토리를 주지 않았습니다. 취소·환불, 양도·재판매, 좌석·가격 카탈로그는 전부 Non-Goals로 배제됐습니다. idol-pm-1의 PRD에는 `fan-club`/`presale`이 0회입니다. 대신 담긴 것은 깊습니다 — 대기열, 홀드, 결제, 안티봇, 즉 요청이 직접 말한 기술적 난점. 그러니 기획 하네스는 PRD 생성기가 아니라 **요청에 적힌 난점의 스펙 생성기**였습니다. 원인 둘, 모두 우리 쪽입니다. `setgoal`은 문서 **세트**를 정하는 게 자기 일이라는 말을 들은 적이 없어서 일반 `document` 종류 하나만 보고 파일 한 개를 섹션으로 나눴습니다 — 신규 `PLANNING_SETGOAL`, `plan` 플로우의 `plan`/`setgoal`에만 주입됩니다: PRD는 바닥이고, 독자가 이름으로 찾아갈 것은 별도 문서로(도메인 모델과 용어집, 정책 결정, 규모 가정, 결정 기록), **이 요청에** 필요한 것을 고르되 문장이 넷을 나열했다고 넷을 만들지 말 것. 그리고 `PRD_CONTRACT`의 도메인 조항은 탈출구로 끝나고 있었습니다 — "안 만들기로 한 관행은 Out of scope에 적어라" — 두 런이 정확히 그 길로 갔습니다. 이제 Out of scope는 **만들지 않기로 한 기능**의 자리이지, 유저 스토리가 딛고 선 규칙의 자리가 아닙니다. 그런 규칙은 세트 중 그것을 소유한 문서에서 결정되거나, 소유자 이름이 붙은 Open question으로 섭니다("결정이 뒤에 없고 스토리가 위에 없는 가정은 제목을 쓴 누락일 뿐이다"). `missingPrdSections`는 이미 보고된 파일 전체를 읽고 있었으므로, 7개 섹션이 여러 문서에 흩어져 있어도 됩니다. 기획 phase-Team 브리핑과 `plan` 스킬 문서도 같은 말을 하게 고쳤고, 0.20.0에서 없앤 `pm:prd-development` 템플릿 언급이 스킬 문서에 남아 있던 것도 제거했습니다. 테스트 4개 추가.
- v0.24.0 — **게이트가 양방향으로 틀어져 있었고, shape은 자기가 떨어지는 규칙을 들은 적이 없다**: 실런 두 건에서 나온 critique 4회가 전부 `sound=false`였고, 전부 같은 클래스에서 막혔습니다 — *소유자 없는 공유 원시요소*: composition root, 패키지 간 입장 토큰, 통합 단계가 검사할 수 없는 goal 기준, 형제 패키지의 결과가 있어야만 충족되는 인수기준. critique는 오작동이 아니었습니다. `CONTRACT.shape`가 그 규칙을 하나도 말하지 않아서, shape은 시험 범위를 모른 채 시험을 봤습니다. 세 규칙 모두 critique가 거부하는 표현 그대로 계약에 들어갔습니다. 반대 방향: `succeeded()`가 `goal_threshold`를 `gate`에만 적용해서 모든 `accept` 노드의 `match_pct`는 장식이었습니다 — idol-pm-1의 PRD는 "이 도메인 고유 요소가 아무것도 없다"는 gap을 달고 88%로 통과했습니다. 이제 `accept`도 같은 바닥을 받고, 그러자 뒤에 있던 구멍이 드러났습니다: `autoRetryPackages`가 `task.spec.packages`만 돌아서 거부된 `accept:PLAN`/`QA`/`AUDIT`에는 앞으로 갈 길이 아예 없었습니다 — phase-Team 패키지들이 이제 그 목록에 들어갑니다. `autoReshape`는 판정하지 못한 judge에 shape 예산을 쓰지 않습니다: autoRejudge의 예산이 남아 있는 동안 `judge_failed` 노드를 건너뜁니다(autoRejudge는 재개 전 1분을 기다리고 autoReshape는 같은 데몬 스텝의 뒤에서 돌기 때문에, 그 대기 창이 공짜 reshape였고 "judge process did not finish within 45m"가 critique 행세를 했습니다 — idol-pm-1은 247분 동안 이 타임아웃을 두 번 맞았습니다). 스토리 커버리지는 더 이상 합집합 세기가 아닙니다: 모든 스토리를 주장하는 패키지도, 아무것도 주장하지 않는 패키지도 shape 결함입니다(idol-pm-2는 P1과 P6이 각각 4개 전부를 주장한 채 통과했습니다). 그리고 정산된 실패 위에 쓰인 report는 `DONE`이 아니라 `SETTLED`로 읽힙니다 — idol-pm-1은 스토리 7개 중 6개가 UNREACHABLE, 디스패치된 패키지 0인 채로 "구현된 것은 없다"로 시작하는 보고서 위에서 EPIC 행이 DONE이었습니다. 테스트 7개 추가. 닫지 않은 것: critique의 blocking을 shape 전체 폐기가 아니라 소유 패키지로 라우팅하는 것, 그리고 아직 어떤 PM 런도 패키지 디스패치에 도달한 적이 없다는 사실.
- v0.23.0 — **말로 적힌 구조 요구를 아무도 검사하지 않았다**: `PRD_CONTRACT`는 PRD가 담아야 할 7개 섹션을 `## ` 제목으로, 순서대로 명시합니다. idol-pm-2(2026-09-22)는 그중 둘을 개명하고 **Solution overview**를 통째로 빠뜨렸는데 `gate:goal`이 95%로 통과시켰습니다. 판정자는 이런 걸 안정적으로 검사하지 않고, 그럴 필요도 없습니다 — grep이면 됩니다. 이제 `missingPrdSections()`가 기획 런이 썼다고 보고한 파일을 읽고, 독자가 받아들일 만한 어떤 이름으로도(`Goals (measurable)` = 성공 기준, `Non-Goals` = 비목표 등, 제목 레벨 무관) 찾을 수 없는 필수 섹션이 있으면 fold를 거부합니다. 실제 런 둘로 교정했습니다 — idol-pm-1의 PRD는 통과하고, idol-pm-2는 진짜로 없는 한 섹션만 지적받습니다. 읽을 수 없거나 없는 PRD는 여기서 문제 삼지 않습니다(빈 경우는 스토리 0개 검사가 이미 담당). 이번 런에서 함께 확인됨: `prd_paths`가 엔진에 의해 처음으로 계산됐습니다(`["docs/PRD.md"]`) — v0.21.0의 수정 중 손으로만 검증돼 있던 마지막 하나가 닫혔습니다.
- v0.22.1 — **7섹션 PRD가 81분 걸린 이유는 섹션이 체인으로 묶였기 때문**: `setgoal`이 PRD 섹션들에 `U1 -> U3 -> U2 -> U4 -> U6` 의존을 선언했는데, 그건 제품의 스토리가 그렇게 의존하기 때문이었습니다 — 섹션 U4를 **쓰는 데** 섹션 U2가 존재할 필요는 없습니다. 이제 `deps` 계약이 의존의 뜻을 명시합니다: 이 서브골의 작업이 저것이 끝나기 전에는 **시작**될 수 없다는 뜻이지, 제품이 만들어지는 순서도 독자가 읽는 순서도 아닙니다. 한 문서의 섹션들은 그것들이 기술하는 대상이 서로 의존하더라도 쓰는 것은 거의 항상 독립입니다. 의존을 없애도 안전하도록 짝이 되는 규칙도 함께: 독립 서브골 여럿이 한 파일을 쓸 때는 각자 소유할 섹션을 제목으로 지정하고 다른 섹션은 건드리지 않는다고 acceptance[]에 적습니다. `critique`는 이미 가짜 의존을 거부하므로 이제 이 건에 대해 행동할 수 있습니다.
- v0.22.0 — **PM 경로의 구멍 4개, 실제로 돌려서 발견**: (1) `critique` 실패가 태스크를 완전히 멈췄습니다. 거절 판정을 다음 시도에 실어 보내는 `retryShape`가 `tm_retry`에서만 닿을 수 있었고, v0.16.0부터 데몬이 루프를 소유하면서 critique가 shape의 실제 결함 3개를 짚고도 고칠 방법을 손에 쥔 채 blocked로 앉아 있었습니다. `autoReshape()` 신설, `autoRepair`/`autoRetryPackages`와 같은 예산 관리. (2) **유저 스토리 0개**인 기획 fold가 통과했습니다 — goal-code-beta-R1이 93%로 받았고 런은 요청문만 보고 만들었습니다. 자식 런의 게이트는 이걸 못 잡습니다(자기 문서를 심사하지, 매니저가 필요로 하는 것을 심사하지 않음). 이제 fold가 거부하고 이유를 말합니다. (3) **통과시키면서** 적은 gaps가 아무에게도 안 갔습니다 — gaps는 거절할 때만 이동했고, `accept:PLAN`이 PRD를 "제목만 아이돌인 일반 고수요 티켓팅 PRD"라 불러도 만들어지는 것은 그대로였습니다. 이제 shape 브리핑이 "이 gaps를 안은 채 통과됨"으로 gaps와 observations를 함께 싣습니다. (4) `.claude/conventions/**` — 프로젝트 자기 규칙 — 이 기획에도 매니저에도 안 닿았습니다. PRD는 트리 전체를 규율하므로 서브골이 건드리는 경로로 규약을 고르는 건 잘못된 필터입니다(`matchesFiles`는 확장자·디렉터리명을 부분 문자열로 대조해서, 도메인 규칙이 PRD에 닿는지가 운에 달려 있었습니다). 이제 `planning` 단계는 모든 규약을 전문으로 받고, `revise`도 배선되며, `shape`/`critique`/`accept`/`integrate`/`gate`는 그 규칙에 비추어 판단하라고 지시받습니다. 추가로 `PRD_CONTRACT`에 도메인 절: 이 도메인 고유의 것을 이름 붙이고 그 도메인의 어휘로 쓰되, 안 만들기로 한 관행은 언급 없이 넘어가지 말고 비목표에 적을 것. 테스트 9개 추가.
- v0.21.1 — **같은 객체-문자열 버그, 한 페이지 뒤에**: `10-prd.md`가 유저 스토리를 전부 `[object Object]`로 출력했습니다. v0.21.0이 커버리지 검사와 shape 브리핑은 고쳤지만 `docs.mjs`의 `renderPrd`를 놓쳤고, 거기서 객체가 그대로 `bullets()`로 들어갔습니다. 테스트가 아니라 실제 런이 만든 페이지를 읽다가 발견했습니다 — 그래서 이제 테스트가 있습니다.
- v0.21.0 — **기획을 켜면 개발 워크플로가 아예 설 수 없었고, 티켓은 장식이었다**: 실제 유저 스토리를 만들어낸 첫 기획 런(idol-pm-1 — 초당 20만 예약 아이돌 공연 예매 PRD)이 곧바로 `shape`에서 `user stories not implemented by any package: [object Object], [object Object], ...`로 실패했습니다. 한 자리에 결함 4개, 전부 스토리가 존재하기 전에는 보이지 않던 것들입니다. `validateShape`가 스토리를 `String()`으로 비교했는데 gate:goal 계약은 스토리를 `{id, title, acceptance}` 객체로 반환합니다 — 어떤 스토리도 `implements[]`와 매칭될 수 없어 shape은 구조적으로 통과 불가였습니다(→ `storyId()`/`storyLabel()`). shape 브리핑에도 같은 `[object Object]`가 나열돼 무엇을 커버해야 하는지 볼 수 없었습니다(→ `US-n - 제목`). `implements`는 shape의 Required output에 아예 없는 필드였는데 그걸로 심사했습니다(→ 스키마에 추가, 다음 판정에서 shape이 스토리 7개를 패키지 6개에 정확히 배정). 브리핑이 가리킨 `10-prd.md`는 tm_docs가 report 때 렌더하는 링크 페이지라 PRD 본문을 담지 않습니다(→ 기획 런이 실제로 쓴 경로를 `prd_paths`로 자식 런에서 꺼내 전달). **티켓 표면**: 티켓은 상태(tickets.mjs가 task.json에서 계산) · 이력(board.jsonl) · 본문(docs.mjs 페이지) 세 가지인데 맞는 건 첫 번째뿐이었습니다 — 나머지 둘이 MCP 툴 호출에 매달려 있었고, v0.16.0부터 루프를 소유한 데몬은 그 툴을 부르지 않습니다. idol-pm-1은 81분·25노드를 도는 동안 PLAN 스토리가 보드에서 READY였고 페이지는 한 장도 없었습니다. 이제 `syncTickets()`가 세 층을 함께 움직이며, 두 호출자가 모두 지나가는 단 한 곳인 `finish()`에서 실행됩니다. finish와 데몬 스텝이 같은 이동을 두 번 관측하므로 보드 기록은 이미 기록된 상태 기준으로 중복 제거합니다. 프로젝트 아래 `.teams_output`을 금지하던 테스트가 페이지 생성을 통째로 막고 있었습니다 — 이제 매니저 *상태*만 금지하고 산출물은 허용합니다. `inspect.mjs --tickets` 신규 — 티켓별 상태와 전이 전체를 출력합니다. 테스트 6개 추가.
- v0.20.0 — **PRD method가 마운트될 수 없는 플러그인을 가리키고 있었다**: `KINDS.planning.skills.draft`가 `pm:prd-development`를 지정했는데 `pm`은 `marketplace.json`에 등재되지 않은 플러그인이라 참조가 조용히 버려졌고, 기획 draft 노드는 **PRD method가 0개인 상태**로 돌았습니다. 실측 결과(`goal-code-beta-R1`, 286줄)는 모듈 수준 설계서였습니다 — 패키지 분할, 데이터 셰이프, import 규칙. "Product goal"은 요청문 재진술 한 문단이고 유저 스토리 0개, 문제 정의·페르소나·성공 지표·비목표 섹션은 아예 없었습니다. 이제 method를 엔진 안에 `prompts.mjs`의 `PRD_CONTRACT`로 넣었고, 플러그인 없이도 살아남도록 **페르소나 + 필수 섹션** 형태로 썼습니다: PRD는 설계서가 아니고, 모듈 계약과 패키지 분할은 shape 단계의 일이며, 문서는 문제 정의 / 대상 사용자 / 솔루션 개요 / 성공 기준 / 유저 스토리(`## User stories`, US-n) / 비목표 / 미해결 질문을 반드시 담아야 하고, 채울 수 없는 섹션은 빼거나 요청문으로 부풀리지 말고 공백을 명시해야 합니다. 신규 `test-skillrefs.mjs`가 이 부류를 봉쇄합니다 — 엔진의 어느 테이블이든 이름 부르는 스킬은 등재된 플러그인이어야 하고 디스크에 존재해야 하며, `pm:`은 다시 나타날 수 없습니다. 기존 테스트 4개가 깨진 참조를 기대하고 있어 함께 고쳤습니다. 테스트 6개 추가.
- v0.19.0 — **인스펙터 — 엔진이 블랙박스였다**: 런이 만든 것(노드별 프롬프트, 결과 JSON, 로드하라고 지시받은 method, 실제로 로드했다고 보고한 것, 쓴 파일)은 전부 이미 디스크에 기록되고 있었는데 그걸 보여주는 통로가 하나도 없었습니다. `node scripts/inspect.mjs <워크스페이스|tasks 디렉터리|task 디렉터리>`가 매니저 체인과 모든 자식 런을 노드별로 `method[지시 -> 실제]`, 쓴 파일 수, 판정, gap과 함께 출력합니다. `--node <id>`는 그 노드의 프롬프트 전문과 결과 경로까지, `--skills`는 0.18.0 버그를 찾아낸 감사(스킬별 지시 횟수 대 실제 로드 횟수, 한 번도 로드되지 않은 목록), `--docs`는 phase 문서 트리, `--json`은 같은 모델의 기계용 출력입니다. 읽기 전용이고, 아직 돌고 있는 태스크에도 쓸 수 있으며, 워크스페이스를 옮겨 노드가 기록한 cwd가 사라져도 자식 런을 찾아냅니다. 첫 사용에서 두 번째 결함을 찾았습니다: 기획 서브골의 `files[]`가 `packages/queue/src/index.mjs`와 `packages/cli/src/index.mjs`였고 draft 노드가 PRD 섹션을 그 소스 파일 안에 써넣었습니다 — 기획 런은 자기 worktree가 없어서 그게 실제 트리에 남습니다. 이제 `validateSpec`이 `planning`/`planning-audit` 서브골의 비문서 경로를 거부하고, draft 계약이 그 이유를 말로 설명합니다. 테스트 10개 추가.
- v0.18.0 — **어떤 노드도 스킬을 한 번도 로드한 적이 없었다**: 이 플러그인의 모든 method 표가 스킬을 `plugin:skill`로 지목하지만(graph.mjs의 `KINDS`, mounts.mjs의 `GRAPH_STAGE_SKILLS`, taskmanager.mjs의 `STAGE_SKILLS`, spec 자신의 `sg.skills`), 자식 드라이버와 심판 세션은 `--setting-sources project`(사용자가 설치한 플러그인을 가림)에 `--plugin-dir`은 teams 플러그인 하나만 받고 뜹니다. 그래서 지목된 스킬은 런타임에 전부 부재했고, 프롬프트 자신의 규칙("설치되지 않은 스킬은 말없이 건너뛴다")이 그걸 침묵으로 만들었습니다 — `trap` T2 런과 첫 `P1` 기획 런 전수 확인 결과, 모든 자식 런의 모든 노드가 `skills_used` null, 매니저 노드는 전부 `["none"]`이었고, shape 노드 하나는 로드했을 리 없는 스킬 둘을 보고했습니다. 새 `mcp/pluginroots.mjs`가 지목된 플러그인을 teams 루트 옆에서 두 배치 모두(개발 체크아웃의 형제 디렉터리, 설치된 마켓플레이스의 `<plugin>/<최신 버전>`) 찾아내고 `driverArgv`/`judgeArgv`가 전부 전달합니다. 그 밖의 경로는 `.claude/team.json`의 `plugin_dirs`로 지정합니다. graph 단계 프롬프트도 이제 `skills_used`를 요구합니다 — 매니저 단계에만 있어서 자식 런에서는 부재가 보이지 않았습니다. `daemon.mjs`는 import해도 종료되지 않도록 CLI 진입부를 실행 주체 판정으로 감쌌습니다(`judgeArgv` 직접 테스트용). 테스트 8개 추가, 전체 331개, 회귀 0.
- v0.17.1 — **기획 런이 PRD 대신 코드를 만들었다** (첫 실제 벤더 기획 런, `trap` P1, 2026-09-22): 모든 패키지의 자식 런이 `mixed:true`로 열려서, PLAN 런의 plan 노드가 "구현하라…"는 요청을 그대로 읽고 기획 단계 안에서 develop 서브골(`implement:U1 → test:U1 → gate:U1`, README `draft:U3`)로 분해했습니다. phase-Team 런(PLAN/QA/AUDIT)은 이제 `mixed:false`로 열려 자기 flow의 kind에 고정되고, 기획 런의 context가 요청은 계획할 대상이지 수행할 대상이 아님을 말로 명시합니다(`Change no source files`). 회귀 테스트 추가, P1 런은 처음부터 다시 시작.
- v0.17.0 — **기획·QA 기본 ON**: `roles` 기본값을 `{planning:true, qa:true}`로 뒤집었습니다(`teamconfig.mjs`). 이제 develop EPIC은 `.claude/team.json`으로 켜지 않아도 PLAN phase-Team(PRD draft → revise → gate, user story는 shape의 `implements[]`로 전달), QA phase-Team(cases → execute → gate, 결함은 STORY로 발행), planning-audit pass를 거칩니다. team.json에 `{"roles": {"qa": false}}`로 하나를 끌 수 있습니다. 동기: 이 플러그인이 만들라고 요구된 네 가지(기획 하네스, QA 하네스, 그 오케스트레이션, 태스크 관리)를 점검한 결과 앞의 둘은 구현·단위 테스트(planning 8, qa 5, audit 4)는 있으나 실제 벤더로는 한 번도 돈 적이 없었습니다 — 모든 벤치 런이 옛 기본값(off)이었기 때문입니다. 의도적으로 남긴 알려진 공백: size S 태스크(`delegateIfSmall`)는 pending 매니저 노드를 PLAN까지 전부 건너뛰고 QA도 연결하지 않습니다 — S 경로에 자체 PLAN/QA 래핑이 생기기 전까지 기획/QA는 size L에서만 돕니다. 벤치: `trap`에 `TEAM_ROLES='{"planning":true,"qa":false}'`와 `'{"planning":false,"qa":true}'`로 각 역할 단독 첫 실측 — 결과는 `docs/plans/2026-09-21-teams-server-owns-the-loop.md` §8g.
- v0.16.0 — `trap` 케이스가 드러낸 데몬/broker 결함 다섯, 각각 회귀 테스트 포함: blocked로 접힌 자식이 "재시도 없음" 한 줄 대신 자기 실패 판정(reason·match·gaps)을 재시도 brief로 전달; authoring 노드의 사유·실패검사 없는 `stage_ok:false`는 더 이상 노드를 실패시키지 않음(test·gate가 판정, 자기보고는 `self_reported_stage_ok`로 보존); 판정 못 한 심판(프로세스 종료·타임아웃·JSON 아님·사용 한도)은 `judge_failed`로 표시 후 데몬이 명시된 리셋 시각 뒤 재판정 — 반려로 읽어 repair·패키지 재시도를 열지 않음; 제공자의 "resets H:MM (Zone)"에 주차된 드라이버는 그 시각 몇 분 뒤 자동 재개(`autoResumeCapacity`/`capacityResetAt`, `tm_retry({reset_capacity})`와 공유); 사후 감사 프롬프트가 실패할 수 없는 테스트(쓰기 구간에 kill이 안 떨어지는 원자성 테스트, 한쪽만 보는 경계 테스트)를 결함으로 보고. 첫 완주 `trap` 채점 14/14, 함정 8개 전부.
- v0.15.3 — autoRetryPackages: 실패한 패키지의 다음 시도를 데몬이 스스로 연다(blocked로 접힌 dispatch 또는 반려된 accept; 마지막 판정의 reason과 gaps가 피드백으로 전달; max_retries 예산 그대로; 머지 충돌 실패·repair 패키지·이미 다음 시도가 있는 패키지는 건너뜀) - trap-beta-T1이 자식의 gate 3회 시도 뒤 P1을 실패로 접고 패키지 예산을 하나도 안 쓴 채 daemon_done을 남겼던 것; 회귀 테스트는 기본 auto_reassign 자식이 실제로 blocked에 이르는 경로로 검증(91/91)
- v0.15.2 — 벤치 trap_f가 `status` 출력에 잡 id를 요구하지 않음(요청문은 "현재 상태를 출력"만 명시; trap-none-T0는 네 호출 모두 `queued`를 동일하게 출력했는데 채점기 취향으로 실패 처리됨) - 오프라인 재채점: plain T0 14/14
- v0.15.1 — 벤치 케이스 `trap`(`fixtures/trap-mono` + `requests/trap.txt`): 속도 제한 잡 스케줄러 CLI. 티켓에 읽기로는 멀쩡하고 실행해야 실패하는 동작 8개를 심음(상한-vs-속도제한 우선순위, 반개구간 10초 경계, 멱등 재실행, 우선순위+안정 tie-break, SIGKILL 하의 원자적 상태 쓰기, 호출 불변성, DST 되감기 구간의 UTC 시계, 경고+성공 종료코드); `score.mjs`가 `trap_a..h`로 각각 실행 검증, `requests/trap.expected.md`는 관리자용 정답지로 어느 arm에도 보이지 않음. `scope_match` 심판은 요청이 침묵한 결정을 더는 요구 안 된 범위로 세지 않음; 감사 프롬프트의 일반 경계 목록에 멱등성·우선순위·크래시 원자성·시계 주입 추가. 이전 케이스는 전부 두 arm 결함 0이었고, 이것이 변별을 위해 만든 첫 케이스.
- v0.15.0 — **사후 적대적 감사**(`scripts/bench/audit.mjs`): 적대적 검증 flow의 1차 품질 수치는 납품물에 살아남은 결함 수이므로, 독립 심사관 하나(arm을 모름, 실행으로 검증: 테스트 스위트·경계 입력·호출 매트릭스·요청의 모든 명시 규칙)가 채점 뒤 두 arm의 트리에 똑같이 돌아 `<ws>.audit.json`(`defects_shipped`, 심각도별)을 씀. `seam-silent` 첫 측정: plain E0 결함 0(검사 23), teams E2 결함 0(검사 26) — 이 과제에서 teams의 gate는 자기 구현자의 잘못된 시도 둘을 잡았지만 plain은 잡을 결함을 남기지 않았음. `lib/tree.mjs`가 채점기·심사관 공용 트리 위치 로직. drive.sh가 최종 채점 뒤 감사를 실행(`GRAPH_BENCH_AUDIT=0`로 끔); `GRAPH_BENCH_AUDIT_MODEL` 기본 sonnet.
- v0.14.2 — 벤치 채점기: parser_names_match_codes가 헬퍼 호출(fail(X, msg))과 프로퍼티 참조(EXIT_CODES.X)도 인식 - code: 리터럴만 보던 정규식 때문에 모든 plain 런과 S1이 11/12로 찍혔던 채점기 거짓 음성(납품 결함으로 오독됨); 오프라인 재채점 결과 plain seam 런은 12/12
- v0.14.1 — 반려된 gate와 autoReassign이 여는 재시도 체인을 saveRun 한 번에 저장(broker.mjs가 둘을 따로 저장했고, 첫 rename에 fs.watch로 깨어난 데몬이 blocked 상태의 자식을 읽어 드라이버가 이미 2차 시도 중인 dispatch를 실패로 접음: seam-silent-beta-E1이 P1을 그렇게 잃음); dispatchSettled는 드라이버가 살아 있는 blocked 자식을 미정착으로 취급 - 정착 신호는 드라이버 종료; 회귀 테스트 추가(90/90)
- v0.14.0 — **자식 런은 체인만 돈다**: 실측 결과, 서브골이 하나뿐인 STORY 패키지의 자식 런이 전체 하네스 그래프를 돌고 있었습니다 — `plan → setgoal → critique → <체인> → gate:goal → report`, 서브골 하나짜리 `develop` 자식 런에 8노드 — 이는 부모 태스크 자신의 `shape`/`critique`가 이미 끝낸 일을 반복하고, 같은 서브골을 두 번 판정하는 것이었습니다(`gate:U1` 바로 뒤에 `gate:goal`이 서브골 하나를 놓고 또 판정). 이제 `createRun({parent_shaped: true, goal, acceptance, ...})`가 자식의 KINDS 체인을 곧바로 만듭니다 — `plan`/`setgoal`/`critique`/`gate:goal`/`report` 노드는 skipped로도 생성되지 않습니다 — 런 자신의 `spec`은 패키지의 `acceptance`/브리프로 채워져서 `gate:U1`이 판정할 대상이 생깁니다. `openChild`(taskmanager.mjs)는 shape가 만든 평범한 STORY마다 이걸 기본으로 켭니다. 패키지가 정말 자기 몫의 shape/dispatch 사이클이 필요하면 `split: true`(또는 `size: 'L'`, size 노드 자신이 쓰는 그 글자)로 빠질 수 있고, `max_depth`(v0.10.1부터 선언만 되어 있던 것을 이제 실제로 적용)는 패키지가 `depth`만큼 깊이 열렸을 때 그 탈출구를 덮어씁니다 — `task.depth`/`child_opts.depth`가 이어져 있지만, 아직 이 코드베이스에는 그걸 건드릴 만큼 중첩해서 태스크를 여는 곳이 없습니다. phase-Team 패키지(PLAN/QA/AUDIT)는 그대로 전체 그래프를 돕니다: 이들은 이 태스크 자신의 shape/critique **뒤가 아니라 앞에서(또는 그 결과를 가로질러)** 열리므로, 미리 끝나 있는 게 아무것도 없습니다. `runState`, `retrySubgoal`, `foldChild`는 이제 `parent_shaped` 런에서 한 번도 생기지 않는 goal gate 대신 그 런의 체인 종료 게이트를, 한 번도 생기지 않는 report 대신 체인의 마지막 작성 노드의 `handoff`를 읽습니다. `retrySpec`(스펙 단위 반려 — 여기엔 다시 쓸 `setgoal`이 없습니다)은 그 런의 서브골 하나에 대한 `retrySubgoal`로 대신합니다. 서브골 하나짜리 `develop` 자식 런: 8노드 → 3노드(`implement:U1:1`, `test:U1:1`, `gate:U1:1`). `docs/plans/2026-09-21-teams-server-owns-the-loop.md` §3 참고. 같은 릴리스에: `scripts/view.mjs`(실행 중인 태스크를 읽기 전용으로 보는 로컬 HTML/텍스트 뷰어 — 파이프라인, 패키지 카드와 각 자식 런의 체인, 이벤트 꼬리), `seam-silent` 벤치 케이스(`seam` 요청문이 정답을 적어 놓아 두 arm이 같은 점수였음), 명세 주도 벤치 메타데이터(`spec_present`, `spec_user_stories`, `spec_traceability`, `scope_match`의 `unrequested[]`/`missing[]`; `review_yield`는 격하 — 명세가 코드에 앞서면 반려 수는 품질 점수가 아님), planning 계약에 `## User stories`(`US-1..n`) 필수 — audit이 볼 것이 생김.
- v0.13.3 — autoRepair: integrate가 검사에서 반려하면 데몬이 repair 패키지를 스스로 연다(integrateToRepair -> openRepair, max_retries 예산 그대로) - blocked 그래프에 daemon_done만 남기고 종료하지 않음; seam-beta-D2가 3패키지 accept 상태에서 repair 하나 부족으로 멈췄던 것; 회귀 테스트 추가(85/85)
- v0.13.2 — saveRun을 쓰고-이름바꾸기로 원자화, dispatchSettled는 파싱 불가한 자식 런 파일을 쓰기 진행 중으로 취급(파일 없음만 fold), 아직 돌고 있는 자식에 대한 foldChild 예외는 daemon_fold_deferred로 기록하고 데몬을 죽이지 않음 - seam-beta-D2가 이 찢긴 읽기로 데몬 재시작 1/2를 소모; 회귀 테스트 추가(84/84)
- v0.13.1 — 데몬이 대기 중에 죽지 않음: waitForProgress의 fallback 타이머를 ref 상태로 유지(unref 타이머 + 비영속 fs.watch만 남으면 Node가 await 도중 code 0으로 종료 - seam-beta-D1이 P1 dispatch 1초 뒤, 재시작 2번 모두 그렇게 죽어 자식은 다 끝났는데 fold할 주체가 없었음); task.json 찢긴 읽기는 종료 대신 재시도; 회귀 테스트 추가
- v0.13.0 — **루프를 서버가 소유한다, 릴레이 세션이 아니라**: 실측 결과 한 런에 $45.92가 들었는데, 그중 $14.19는 파일 하나 안 쓰고 결정 하나 안 내린 `claude -p` 세션 둘이었습니다(매니저는 144턴 중 125턴이 순수 `tm_next` 폴링, TaskLeader는 91턴 중 23턴 순수 폴링 + 13턴 그대로 릴레이) — 페이로드가 도착하면 실제 해석은 전부 `finish()`가 했고, 세션은 그걸 거기까지 나르기만 했습니다. `tm_open`이 이제 TaskLeader 대신 `node mcp/daemon.mjs --task <id>`를 spawn합니다 — 같은 detached + `unref()` 프로세스, 사용자 세션이 끝나도 살아남는 것도 같고, 드라이버/exit 파일 기록 방식도 같습니다 — 그 평범한 루프가 매니저 노드를 직접 돕니다: `advanceDispatches`/`serviceRunningDispatches`/`prepareReadyIntegrations`(테스트처럼 수동으로 그래프를 돌리는 호출자와 daemon이 "준비됨"의 정의에서 절대 어긋나지 않도록 `tm_next`와 공유), settled된 dispatch에는 `foldChild`+`finish`, 판단 노드마다 단발 `claude -p` 호출(`judge()` — 릴레이된 fresh agent가 받던 것과 같은 브리핑, 같은 Required-output 계약). 실제 이벤트를 기다립니다 — 드라이버 자신의 exit 파일 기록, 자식 런 디렉터리의 `fs.watch` — 놓친 이벤트에 대한 문서화된 안전망으로만 15초 폴백을 두고, busy loop는 없습니다. leader의 inbox/watcher 게이트도 함께 사라졌습니다: 이제 단일 writer이고, 어느 프로세스에서 온 `tm_submit`/`tm_retry`든 즉시 적용되며 daemon과 나란히 안전합니다(`saveRun`의 락, 그리고 모든 노드 변경 전 디스크를 새로 읽는 것이 노드를 두 번 끝내는 경합을 막습니다). 신규: `tm_run`(열고 daemon만 spawn — 스스로 돌지 않고 `{task_id, run_id, docs_dir}`만 반환), `tm_wait`(cursor 이후 노드 전이만 돌려주는 bounded long-poll, `tm_next({wait_ms})`를 대체). `integrate`의 Required-output에 이제 제품 소유자 질문(누락/중복/총량)이 `roles.planning`의 audit 없이도 무조건 들어갑니다. `references/orchestrate/manager.md`는 삭제되었고, entry 스킬 다섯 개는 릴레이된 태스크가 아니라 daemon이 돌리는 태스크를 전제로 읽습니다. `docs/plans/2026-09-21-teams-server-owns-the-loop.md` 참고.
- v0.12.3 — **v0.12.3 — 실벤더 런으로 두 번 측정**: 헤드리스 세션은 잠들 수 없어서 `tm_next({task_id, wait_ms})`가 이제 서버에서 블로킹합니다 — 그런 세션을 붙잡아 두는 건 반환되지 않은 툴 콜뿐인데, 그게 없으니 main은 셸 sleep을 걸고 턴을 끝내 아직 돌고 있는 빌드를 버렸습니다. 그리고 같은 호스트 모델이 쓴 draft의 `review`가 데드락이었습니다: `team_submit`은 저자와 같은 정체성이라 거부하고 `team_run`은 self 라우팅이라 거부해서, 런이 같은 노드를 영원히 내놓았습니다. 이제 호스트가 모델을 둘 이상 선언하면 모델 축으로 독립성을 잡고, 없으면 `unverifiable-same-host`로 기록합니다. 벤치 `betas code-flat`: **2분 2/9 not-delivered → 28분 9/9 $1.33**, 런은 드라이버·leader 재시작 없이 20/20으로 닫힙니다.
- v0.12.2 — **v0.12.2 — 첫 실벤더 런의 진짜 원인: 거짓 `blocked`**: size S 태스크는 `size`가 풀리는 순간 매니저 그래프가 이미 settled라서, `toolNext()` 앞에서 리턴하는 TaskLeader 게이트의 watcher 분기가 살아 있는 태스크를 세 노드만 보고 `blocked`으로 보고했습니다. 스킬의 standing mandate가 "blocked는 결과다 — 보고하고 멈춰라"이므로 main은 2분 만에 그대로 멈췄고, 벤치는 드라이버가 아직 돌고 있는 워크스페이스를 채점했습니다. `watcherState()`가 `toolNextSRun`과 같은 방식으로 자식 런을 읽도록(쓰기 없음) 고쳤고, entry 스킬 5개도 leader 게이트가 불가능하게 만드는 `task_state` 응답을 더 이상 약속하지 않습니다(main의 size 제출은 `queued: true`로 돌아옵니다).
- v0.12.1 — **v0.12.1 — 발행되는 STORY: QA 결함, 기획 크로스 검수, tm_file**: QA phase-Team이 낸 결함이 이제 develop STORY로 발행되고 EPIC은 새 integrate를 거쳐 되돌아옵니다(`qa_rounds`로 상한). `roles.planning`에 두 번째 pass인 `planning-audit` phase-Team이 붙어, 통합 결과와 (있다면) QA 리포트를 자신이 쓴 PRD에 대조하고 아직 미충족인 user story마다 STORY를 발행합니다. `tm_file`로 사람이 같은 경로로 직접 STORY를 발행할 수도 있습니다(상한 없음). 보드와 phase 문서는 `reporter`(`shape`/`repair`/`qa`/`planning-audit`/`you`)로 출처를 구분하고 `65-audit.md`가 렌더됩니다 — §7c의 13개 문서 중 `15-spec-gate.md` 하나만 남았습니다.

- **v0.12.0 — planning/QA를 동등한 STORY가 아니라 EPIC phase-Team으로**: `.claude/team.json`의
  `roles.planning`/`roles.qa` 스위치는 v0.10.1부터 기록만 되고 아무 동작도 하지 않았는데, 이제
  실제로 동작합니다. `roles.planning`은 `shape` 앞에 planning phase-Team을 끼워 넣습니다 — 그
  PRD와 `user_stories[]`가 `shape` 자신의 입력으로 흘러들고, `shape`의 계약은 `priority`와, 그
  user story들에 대한 `implements[]` 완전성 검사를 얻습니다 — planning이 지목한 스토리가 두
  단계 사이 틈으로 조용히 빠지지 않도록. `roles.qa`는 `integrate`와 `gate:goal` 사이에 QA
  phase-Team을 끼워 넣습니다. QA의 트리가 곧 통합 트리이므로 새 워크트리가 아니라 repair
  워크트리를 재사용하며 — 이번 릴리스에서는 EPIC당 한 번만 돌고 찾은 것을 보고할 뿐, 아직 그에
  따라 행동하지는 않습니다. `max_parallel_teams`(기본값 2, `team.json` 키)는 동시에 도는 develop
  STORY dispatch 수를 priority 순으로 제한합니다 — phase-Team은 설계상 한 번에 하나뿐이므로 이
  카운트와 상한 모두에서 예외입니다. `tickets.mjs`/`docs.mjs`는 두 phase-Team을 모두 압니다:
  `tm_board`의 STORY 행이 `role: 'planning'|'qa'|'develop'`을 갖고(이전에는 항상 `'develop'`),
  `10-planning.md`/`10-prd.md`/`60-qa.md`가 v0.11.0이 이미 렌더링하던 8개 phase 문서 옆에
  더해집니다 — §7c의 13개 중 11개가 이제 렌더링되고, 남은 둘은 `65-audit.md`(v0.12.1의 기획
  크로스 검수)와 `15-spec-gate.md`(v0.13.0)입니다. 문서 작업을 마무리하며 실제 버그 두 개가
  드러났습니다: `team_open`이 잘못된 `.claude/team.json` 키를 호출자에게 전혀 알리지 않고
  있었고(이제 `team_status`의 `config_notes`), `tickets.mjs`의 `docPaths`가 `docs_dir`의
  `.teams_output/team` 리터럴을 `TEAM_DEFAULTS`에서 읽는 대신 다시 타이핑해두고 있었습니다 —
  정확히 be83bbc의 그 모양인데, 그동안은 한 번도 걸리지 않았을 뿐입니다. 전체 스위트: 모든
  `test-*.mjs`에서 344/344, 회귀 0. 아직 미측정: 위 내용 전부 실제 벤더로 돌려본 적이 없습니다
  — 전부 단위 테스트뿐이며, v0.10.1과 v0.11.0이 세운 기준과 같습니다. 아직 안 된 것: QA가 찾은
  결함이 아직 develop STORY(결함 STORY)로 EPIC을 재오픈하지 않고(`tm_file`도, 자동
  dispatch→accept→integrate→qa 루프도 없음), planning이 아직 크로스 검수로 두 번째 도는 일도
  없습니다 — 둘 다 v0.12.1이며, 이미 이 릴리스 위에 준비되어 있습니다.
- **v0.11.0 — 티켓 레이어, board.jsonl, phase 문서**: `tickets.mjs`가 `task.json`만 보고
  EPIC/STORY/TASK 티켓 상태와 `epicPhase`를 순수 함수로 파생합니다 — 그 자체가 진실의 원천이
  아니라 어디까지나 파생값입니다. `tm_board`(전체 EPIC 목록, 또는 EPIC 하나의 STORY 칸반)와
  `tm_ticket`(키 하나 — `E-xxxxxxxx` 또는 `E-xxxxxxxx/Pn` — 로 티켓 하나)가 이를 읽습니다 —
  `task_id`를 받는 도구는 전부 전체 run id든 그 `E-xxxxxxxx` 키든 같은 방식으로 풀어냅니다(§8);
  `tm_board`만 특별 취급되는 게 아니라, 이 항목이 그 예로 든 것일 뿐입니다.
  `board.jsonl`은 티켓을 실제로 움직일 수 있는 네 도구(`tm_open`/`tm_next`/`tm_submit`/
  `tm_retry`) 주변에서 before/after diff가 실제로 찾아낸 전환만 기록합니다 — JIRA 스타일 이력이며
  그 자체를 진실의 원천으로 다시 읽지 않습니다. `docs.mjs`는 같은 `task.json`으로부터 §7c의 13개
  문서 중 8개 — INDEX, request, shape, critique, STORY별 한 페이지, integrate, goal gate,
  report — 를 렌더링하고, `tm_docs({rebuild})`로 연결되어 두 번째 렌더가 바이트 단위로 동일함을
  테스트로 증명합니다; 나머지 5개(planning, PRD, spec-gate, qa, audit)는 v0.12+ 전까지 없는 Team
  배선이 필요해서, 비워서 렌더링하는 대신 아예 빼두었습니다. `teams:board`/`teams:ticket`은 이 두
  읽기 도구 위의 얇은 터미널 테이블 래퍼입니다. 이번에 실제 버그 두 개가 드러났습니다: EPIC 티켓
  상태/phase가 integrate/report 노드가 단지 *존재*하는지로 게이트되고 있었는데,
  `expandPackages`가 패키지 dispatch/accept 체인을 여는 바로 그 호출에서 그 노드들을 함께
  만들어버려서 — 패키지가 하나도 dispatch되기 전에 shape가 성공하는 순간 EPIC이 곧바로
  IN_REVIEW로 뛰었습니다; TASK 티켓 상태도 implement/test/gate 전체에서 같은
  존재-대-도달 버그를 갖고 있었습니다. 이제 둘 다 노드 자신의 `unmetDeps()`/스테이지가 실제로
  도달했는지로 게이트합니다. 역시 이번 라운드: TaskLeader의 best-effort `SendMessage` 진행
  알림을 없앴습니다 — 검증도, 재시도도, ack도 없었고, 도착하지 않은 메시지는 아무 변화도 없었던
  것과 구분할 수 없습니다; `tm_board`/`tm_ticket`/`tm_events`가 그 자리를 대신하는 내구성 있는
  pull 기반 경로입니다. 전체 스위트: 모든 `test-*.mjs`에서 301/301, 회귀 0. 아직 미측정: 위
  내용 전부 실제 벤더로 돌려본 적이 없습니다 — 전부 단위 테스트뿐이며, v0.10.1이 세운 기준과
  같습니다. 아직 안 된 것: `planning`/`qa`는 여전히 EPIC 흐름에 연결되지 않았고, shape의
  role/priority, defect STORY, human executor는 여전히 v0.12.0+ 몫입니다 — 위에서 뺀 문서 5종도
  같은 라운드에서 채워집니다.
- **v0.10.1 — planning/qa kind, 그리고 워크트리 게이트 가시성 수정**: 새 `KINDS` 두 개,
  `planning`(draft→revise→gate)과 `qa`(cases→execute→gate)가 각자의 페르소나·스테이지별 스킬·
  MCP 마운트(§3, advisory `draft`/`cases` 마운트)를 갖고 `CONTRACT.revise/cases/execute`에
  도달합니다(이번 라운드 전에는 이 두 스테이지가 조용히 `CONTRACT.implement`로 폴백해 벤더에게
  문서나 테스트 대신 구현 형태 산출물을 지시했을 것입니다) — 그리고 `broker.mjs`의 리뷰어 독립성
  가드: `revise`도 이제 draft를 쓴 정체성으로 라우팅되면 `review`와 같은 방식으로 거부됩니다.
  새 엔트리 스킬 둘, `teams:plan`과 `teams:qa`가 `develop`/`document`처럼 흐름을
  고정합니다. 별도로 `ensureWorktree`가 이제, 워크트리가 harness 게이트 설정을 커밋되지 않은 채로
  물려받을 때 태스크 원장에 `gate_uncommitted` 이벤트(`tm_events`)를 기록합니다 — git 워크트리는
  커밋된 파일만 물려받으므로 `.claude/harness-gate.json`과 훅을 커밋하지 않고 열면 사용자는
  게이트가 보호하고 있다고 믿지만 워커의 쓰기는 조용히 무방비 상태가 됩니다; 이 이벤트는 경고
  전용·best-effort이며 절대 막지 않습니다. 아직 안 된 것: `planning`/`qa`는 EPIC 흐름에
  연결되지 않았습니다 — planning이 shape 전에 자동으로 돌지 않고 qa가 integrate 뒤에 자동으로
  돌지 않으며 `team.json.roles`는 기록만 되고 아직 무동작입니다 — 지금은
  `tm_open({flow: "plan"|"qa"})`나 두 엔트리 스킬로만 도달합니다; 그 연결에는 티켓 레이어가
  필요합니다, v0.11.0+. 전체 스위트: 모든 `test-*.mjs`에서 258/258, 회귀 0. 아직 미측정: 두
  kind는 실제 벤더로 돌려본 적이 없습니다 — `plan-flat`/`qa-flat` 벤치 요청 파일은 있지만 이번
  라운드에 벤치 자체는 돌리지 않았습니다(실제 모델 프로세스를 스폰하기 때문); 지금까지의 증거는
  전부 단위 테스트입니다. PRD 경로 `.teams_output/team/E-<task8>/10-prd.md`는 문서화되어 있고
  테스트에서 왕복 확인되지만, 그 경로를 자동으로 계산하는 코드는 아직 없습니다 — 스펙이
  `subgoal.files[]`에 직접 이름을 붙여야 합니다.
- **v0.10.0 — install/remove/patch, 그리고 main은 이제 아무것도 드라이브하지 않는다**: 두 갈래가
  함께 끝났습니다. 첫째, teams가 harness와 같은 운영 셸을 갖습니다 — 결정적 스크립트 기반의
  install/remove/patch 스킬. `install.mjs`가 `.claude/team.json`을 씁니다 — `tm_open`이 인자보다
  먼저 읽는 프로젝트 기본값이라, 매 호출마다 `goal_threshold`/`allocation` 등을 반복할 필요가
  없습니다(그래도 명시적 인자가 team.json을, team.json이 하드코딩 기본값을 이깁니다).
  `remove.mjs`는 멱등하게 되돌립니다. `patch.mjs`는 두 매니페스트의 `x.y.Z`를 올리고 README
  `## Status`와 KOR.md `## 상태`에 한 줄씩 같은 호출에서 prepend합니다 — `summary`와 `summary_ko`
  둘 다 없으면 거부합니다, 이 저장소는 두 언어를 같이 움직이기 때문입니다. 둘째, 드라이빙 세션은
  더 이상 노드를 드라이브하지 않습니다. `tm_open`은 `child_driver`나 `s_driver`를 넘기면 이제
  에러를 던집니다(**breaking**: 둘 중 하나를 고정해 두던 스크립트는 "removed in 0.10.0: the
  driving session never drives..."를 받습니다); `HARNESS_TEST_NO_DRIVER`가 그 자리를 대신하는
  내부 테스트 전용 시임입니다. 대신 `tm_open`이 **TaskLeader driver**를 spawn합니다 — 매니저 루프
  (tm_next/tm_submit/tm_retry)를 스스로 도는 헤드리스 세션. main은 `tm_status`와 신설
  `tm_events`(원장을 tail, `since`/`limit`, 어느 세션에서든 안전한 읽기 전용)만 보고, leader가
  소유한 태스크를 mutate하려 하면 inbox(`<taskDir>/inbox/<ts>-<seq>-<tool>.json`)에 큐잉되어
  leader가 다음 `tm_next`에서 적용합니다. 죽은 leader는 패키지 드라이버처럼 `driver_restarts`까지
  재기동되고, 그 뒤엔 exhausted로 보고됩니다. harness와의 공존에는 조각 하나가 더 필요했습니다:
  `tm_next`가 건드리는 모든 워크트리에 쓰는 `.claude/.harness-markers/team-<task8>` — harness
  게이트가 이미 읽던 것과 **같은 파일 모양**이라 harness 쪽 코드 변경은 0이고, `dispatch-gate.mjs`가
  반대 방향으로 그것을 읽어 harness가 관여 중인 세션이 team의 dispatch 게이트에 막히지도 않습니다.
  `excludeMarkers()`가 그 경로를 git에서 뺍니다(`info/exclude`), fold 커밋도 언스테이지합니다 —
  안 그러면 모든 패키지 브랜치가 타임스탬프로 충돌합니다. 전체 스위트: 13개 파일 241/241, 회귀
  0. 아직 미측정: 실제 harness+team 프로젝트에서의 런 1회, leader의 SendMessage 진행 알림이
  실제로 여는 세션에 도달하는지.
- **v0.9.0 — 정확도 라운드**: "What the rewrite dropped" 표를 상대로 다섯 가지를 병렬로 만들었습니다.
  전부 판정과 증거를 늘리는 쪽이고, 비용을 줄이는 쪽은 없습니다. (1) `.claude/conventions/**`가 다시
  plan·setgoal·implement·draft에 도달합니다(`mcp/conventions.mjs`); plan은 단위별 의존·결정적 검증·
  컨벤션을 조사하고, setgoal은 리포 전체 상태나 희망치 기준을 쓰는 것이 이름으로 금지되며, 구조적으로
  거부된 스펙은 재시도 때 "페이로드를 줄였다"는 진단을 받고, 프롬프트에 접히는 모든 upstream handoff는
  1500자로 캡됩니다(`HANDOFF_CAP`). (2) 그래프 엔진이 매니저처럼 스테이지 스킬을 마운트합니다 — plan →
  `agents:agent-task-decomposer`, critique/gate/review → `think:devils-advocate`, test →
  `completion:verification-before-completion` — 그리고 권고형 MCP 마운트(sequential-thinking,
  think-tool, mcp-reasoner); `team_open({skills, mounts})`로 덮어쓰거나 끕니다. `sound:false`
  critique는 이제 스스로 스펙을 재작성하고(subgoal 재시도와 같은 예산), `vendor:"auto"`는 `self` 전에
  실제로 claude→codex를 시도합니다. (3) goal gate는 정체가 다른 판정자 둘(`goal_judges`, 기본 2);
  전원이 `goal_threshold` 이상으로 accept해야 통과; 각 판정자는 `attacks[]` — 트리 밖에서, 요청자가
  부를 방식으로 부른 호출 — 를 적어야 하고 비어 있으면 빈 `checks[]`처럼 거부됩니다. 거부된 라운드는
  조립된 결과 위에서 교차 벤더 `repair` 스테이지를 열고(Step 9) 다시 판정; 같은 거부가 두 번이면
  stall로 부분 결과 보고; `team_retry({repair:true})`로 강제. (4) 죽은 패키지 드라이버는 같은
  run_id로 `driver_restarts`(기본 2)까지 resume; usage-limit 사망은 `waiting_capacity`로 보류하고
  `tm_retry({reset_capacity:true})`로 재개; S 사이즈도 L 패키지와 같은 단일 드라이버 프로세스 위임
  (`s_driver`, 기본 `process`). (5) 벤치: 두 반쪽이 각자는 통과하고 공유 exit-code 표를 통해서만 만나는
  `seam` fixture(기준 12개, seam 5개, 그중 둘이 0.8.1의 `/var` 결함을 재현); 하네스가 이름 대는 플러그인을
  마운트하는 `skills` arm; judge 지표(`seam_detected`, `gate_rejections`, `judges_with_checks`,
  `repairs`); 채점기 오독 6건 수정과 `bench/lib/claims.mjs`로 헬퍼 분리. 이 라운드 전에 0.8.1
  all-Claude(코덱스 off)로 측정: `betas code-flat` **9/9**, 21분, $6.54, 전 게이트 checks 기록, 재채점 후
  거짓 주장 0 — 0.7.3의 8/9, 44분, $11.88 대비. 테스트 9파일 219개. 미측정: 이 라운드 자체, `seam`
  케이스, 코덱스 포함 전부.
- **v0.8.1 — test는 구현하지 않은 쪽이 맡음**: 매니저 런의 6/9가 한 줄로 추적됐습니다. 통합된 CLI는
  트리 안에서 실행하면 맞고, `/var` 심링크로 부르면 아무것도 안 찍습니다 — "내가 main인가" 가드가
  `import.meta.url`을 resolve 안 된 `process.argv[1]`과 비교하기 때문입니다. peer(codex)가 썼고, peer의
  test 노드는 그 불일치가 숨는 유일한 경로로 호출해 17/17을 보고했고, 호스트 게이트 셋이 `checks: []`로
  92~95에 통과시켰습니다. 맨 세션의 CLI에는 그런 가드가 없어서 9/9. 이건 "다른 벤더를 못 믿는다"가
  아닙니다 — 같은 런의 codex 노드 17개 전부 파일 주장이 검증됐고 `npm test`는 85/85 — 작성자와 검증자가
  벤더를 공유해서 맹점도 공유한 것이고, `CROSS_VENDOR_STAGES`가 둘 다 peer로 보내며 그걸 보장했습니다.
  `rankCandidates`는 이제 `test`에 대해 해당 subgoal을 구현하지 **않은** 벤더를 선호합니다
  (`AUTHOR_OF.test = 'implement'`), 구현자가 호스트로 fallback한 경우 포함. 지금까지의 다른 점수 손실은
  전부 all-Claude 런의 spec drift거나 엔진 버그였습니다. 분석은 `scripts/bench/README.md`. 테스트 161개.

- **v0.8.0 — 재귀가 프로세스 트리로 옮겨가고, 스코어러가 하네스의 존재 이유를 세기 시작**: 진단 하나에서
  나온 변경 넷을 병렬로 만들었습니다. 매니저가 자식 런의 모든 노드 브리핑과 결과를 자기 컨텍스트로 중계하고
  있었습니다 — 자식 런 5개에 걸친 54노드, 507k 토큰, 331턴, $42 런의 ~55%, resume 6번 뒤 리밋에 사망.
  (1) ready된 `dispatch:Pn`이 이제 패키지 워크트리에서 헤드리스 세션 하나를 띄워 자식 런을 끝까지 돌립니다.
  매니저는 `tm_next`를 폴링해 `driver: {pid, alive}`를 보고 fold만 합니다. 죽은 드라이버는 stderr를 들고
  blocked로 fold되고 `tm_retry({package_id})`가 다시 띄웁니다. `child_driver: "inline"`이 비교용으로
  옛 루프를 남깁니다. (2) 판정이 호스트 티어를 떠납니다: `critique`와 목표 게이트만 `host_model`을
  물려받고 나머지 판정 단계는 벤더 기본값(측정된 40%). `checks[]`가 빈 채 `accept: true`를 말하는 게이트는
  거부됩니다 — 증거 없는 판단은 추측입니다 — 실패는 작업이 아니라 게이트에 남습니다. 매니저 자신의
  `gate:goal`도 자식들이 이미 갖고 있던 `goal_threshold` 바닥(기본 90)을 갖게 됐습니다. `goal_threshold`가
  `child_opts`에도 전달되지 않고 있었다는 게 함께 드러났습니다. (3) seam — 어떤 패키지도 자기 워크트리에서
  볼 수 없는 integrate 실패 — 에 수리 경로가 생겼습니다: `tm_retry({repair: true})`가 패키지 `R1`을
  **integration 워크트리 안에서**, 합쳐진 트리 위에, 모든 패키지의 touches를 범위로 열고, 다음 `integrate`는
  HEAD에서 다시 머지하지 않고 그 브랜치를 기반으로 삼습니다. 문서화돼 있던 졸업 차단 사유였습니다.
  (4) `score.mjs`가 런이나 맨 세션이 하는 모든 주장 — 변경 파일, `cmd -> shown` 형태의 `checks`,
  `verified`/`accept` 플래그, handoff와 세션 산문 속 테스트 개수, README 셸 예제 — 을 추출해 트리에 대고
  검증합니다: 안전하고 멱등한 것만 재실행, 명시된 `exit=N`은 정확 비교, 자리표시자(`<good.csv>`)와 산문
  체크는 false가 아닌 `unverifiable`. 행에 `false N/M`이 붙습니다. 이번 라운드 워크스페이스 셋을 재채점하면
  **107·92·193 주장 중 거짓 0** — 초안은 16이라 했는데 전부 스코어러 오독이었습니다(`# fail 0`을 실패로,
  `exit=1` 무시, 모듈별 개수를 트리 총합에 대고). **위의 비용 주장은 아직 하나도 측정되지 않았습니다** —
  유닛 테스트 160개가 통과하고 드라이버 경로는 가짜에 대해서만 검증됐습니다. 첫 실제 spawn은 벤치 런이
  될 것이고, 거기서 이겨야 하는 숫자는 $42/143분, 새로 지켜볼 실패 모드는 패키지 세션 여럿이 동시에 리밋을
  치는 것입니다.

- **v0.7.4 — 벤더 간 귀속이 주장에서 측정으로**: 코드 변경 없음. 0.6.9부터 0.7.3까지 만든 것이 실제
  런에 나타나는지 보려고 0.7.3에서 세 런을 동시에 돌렸습니다. `betas code-flat` 8/9 · 44분 · $11.88,
  `betas docs-flat` 9/9 · 63분 · $21.79, 매니저 경로 `beta code-flat` 6/9 · 143분 · $42.50 — 마지막
  런은 뭔가 실패해서가 아니라 세션 리밋이 끝나서 `integrate`에서 멈췄습니다. 스스로 `size`를 **L**로
  재고 **패키지 4개**로 나눴고 넷 다 통과시켰습니다: P1·P2는 95, P4는 정확히 바닥값 90, 그리고 **P3는
  `accept: false`로 거부된 뒤 새 자식 런으로 재시도해 94로 통과** — `tm_retry`가 실전 매니저 루프에서
  하는 일이 그래프 안의 `autoReassign`과 같다는 뜻입니다. 중요한 칸은 이것입니다: 자식 런 다섯 개의
  실행자 분포는 claude 32 / codex 22였고, 그중 **17개 노드가
  `('codex', 'isolated', changed_files_verified: true)`** 를 `contradicted_files` 빈 채로 들고
  있습니다. 이번 라운드 전까지 디스크에 있던 isolated 귀속 49건은 전부 Claude에서 나온 것이어서 벤더
  간 긍정 귀속은 메커니즘에 대한 논증이었는데, 이제 데이터입니다. 자식 런 다섯 개 전부
  `isolated: true, goal_threshold: 90, auto_reassign: true`를 들고 있어 `child_opts` 배선도 실재합니다.
  다시 발견하지 않도록 기록해 두는 비발견 하나: 매니저 모든 단계가 `skills_used: ["none"]`을 보고했는데
  이건 맞습니다 — 벤치 arm은 `--plugin-dir teams` 하나만 로드해서 스킬 플러그인이 실제로 없고,
  브리핑의 "설치 안 된 스킬은 말없이 건너뛴다"가 발동한 것입니다. 여전히 미측정: 패키지 4개가 살아 있는
  채로 어떤 런도 도달하지 못한 `integrate`와 매니저 자신의 `gate:goal`, 그리고 그 게이트에는 임계값이
  아예 없습니다. 숫자는 `scripts/bench/README.md`에 있습니다.

- **v0.7.3 — 재할당된 subgoal이 죽은 세대의 의존을 물려받지 않음**: 0.7.2의 첫 실전 런이 새 작업을
  확인해주고 — `implement`에 persona가 있고 `gate`에는 없음, kind에서 `develop:clean-code` /
  `develop:testing-workflow`+`completion:verification-before-completion` / `think:devils-advocate`가
  도착, 실행 노드 6개 전부 codex·기획과 판단 노드 7개 전부 호스트 — 그리고 유닛 테스트로는 볼 수 없는
  버그에 3/9으로 막혔습니다. `test:U3:2`가 거부되자 엔진이 의도대로 U3를 스스로 재할당했는데, 새로
  태어난 `implement:U3:3`의 의존이 `["critique", "gate:U1:1", "gate:U2:1"]` — spec 재시도가 이미
  superseded로 skip한 attempt-1 노드들이었습니다. 영영 ready가 되지 못해 subgoal 둘과 목표 게이트에
  도달하지 못한 채 blocked로 끝났습니다. `retrySubgoal`이 subgoal의 **가장 이른** head 노드에서 상류를
  읽고 있었는데, 그건 spec 재시도가 그 아래 subgoal들을 다시 전개하기 전까지만 옳은 노드입니다. 이제
  superseded되지 않은 가장 최근 head에서 읽습니다 — 한 세대 안의 모든 시도는 같은 기반 의존을 복사하므로
  같은 상류이고, 다만 실제로 살아 있는 세대의 것입니다.

- **v0.7.2 — 방법론은 kind에서 온다, 물어보는 방식이 실패했으므로**: 0.7.1의 첫 실전 런들이 모든
  subgoal에 `skills: []`, 모든 패키지에 `skills` 필드 자체 없음으로 돌아왔습니다. 같은 자리에서 요구한
  `persona`는 매번, 그것도 잘 채워졌는데도요("코드에서 설계 이력을 복원하는 편집자-아키비스트"). 차이는
  후보였습니다 — flow는 setgoal에 고를 persona 목록을 쥐여주는데, skills 계약은 형식만 주고 고를 것을
  주지 않았습니다. 무엇이 설치돼 있는지 볼 수 없는 에이전트는 플러그인 이름을 지어내지 않고, `[]`가
  정직한 답이었습니다. 그래서 목록을 `KINDS`로, 단계별로 옮겼습니다: `subgoal`은 implement에
  `develop:clean-code`, test에 `develop:testing-workflow`와 `completion:verification-before-completion`,
  `document`는 draft에 `write:doc-coauthoring`, review에 `write:writer-verification`, 그리고 양쪽 gate에
  `think:devils-advocate` — 이 재작성판이 대체한 세대가 하던 방식 그대로(런타임 선택이 아니라 프롬프트에
  박힌 이름). spec이 스스로 지정하면 작성 단계에서는 그쪽이 이깁니다(setgoal은 이 구체적 작업을 알고,
  kind는 작업의 형태만 아니까). 판단 단계는 언제나 family 것을 지킵니다 — 심판의 방법론은 작성자가
  고를 것이 아니므로.

- **v0.7.1 —같은 반론이 두 번이면 재시도가 아니라 재설계, 그리고 심판이 작성자의 정체를 넘겨받지
  않음**: 같은 서명(reason + 정렬된 gaps)으로 두 번 거부된 subgoal은 세 번째 시도를 열지 않고
  `setgoal`·`critique`로 **에스컬레이션**합니다 — 답을 실제로 바꿀 수 있는 라인으로, 계속 실패한
  내용을 싣고서. `goal-docs`가 그 사례입니다: 패키지 README가 "이 저장소엔 다른 문서가 없다"고
  정직하게 썼고 그건 합친 뒤에만 거짓이 되므로, 그 패키지 안의 어떤 시도로도 고칠 수 없었는데 예산은
  그 사실을 세 번 배우는 데 쓰였습니다. 목표 게이트에 하한선 `goal_threshold`가 생겼습니다(기본 90,
  런마다 지정 가능, 0이면 판정만으로 수락) — 70%에 accept하던 게이트는 부분 결과를 통과로 보고하던
  것입니다. spec에 `persona`와 나란히 subgoal별 `skills`가 들어가고, 패키지도 자기 것을 자식 run에
  넘깁니다. 그리고 대조가 찾아낸 버그: persona와 method가 체인의 모든 단계가 공유하는 브리핑 블록에
  있어서, 게이트가 "당신은 심판이지 행위자가 아니다" 두 줄 위에서 "이 모듈을 소유한 구현자로 행동하라"를
  지시받고 있었습니다. 이제 둘 다 작성 단계에만 갑니다.

  이번 것 대부분은 이 재작성판을 그것이 대체한 세대(`harness/engine/pipeline.js`)와 대조해서 나왔고,
  계획서에 그 표를 넣어 나머지를 값비싼 벤치 런으로 하나씩 재발견하지 않게 했습니다. 내용은 자랑스럽지
  않습니다 — 자동 재시도 루프, 정체 감지, 단계별 스킬 마운트, 목표 임계값이 전부 예전에 있었고
  인프로세스 루프에서 외부 세션이 모는 MCP 서버로 옮기며 사라졌습니다. 아직 남아 적어둔 것: 엔진에서
  `.claude/conventions/**`가 통째로 사라졌고, 매니저 자신의 `gate:goal`에는 임계값이 없으며,
  `sound: false` critique에는 여전히 자동 경로가 없고, 목표 게이트 repair 패스는 구현이 아니라
  Step 9 제안 상태입니다.

- **v0.7.0 — 품질 게이트가 거부하면 오케스트레이션이 스스로 재할당**: `gate`·`review`·`test`가 부정
  판정을 내면 노드를 실패시키고 런을 `blocked`로 둔 채 호출자가 `team_retry`를 부르기를 기다렸습니다.
  그래서 거부가 권고에 그쳤습니다 — 세션이 안 부르면 거기서 끝이고, 게이트가 찾아낸 gap은 아무 데도
  가지 않았습니다. 이제 엔진이 거부 시점에 다음 시도를 직접 열고, `team_retry`가 실었을 피드백을 그대로
  싣습니다(마지막 판단 노드의 reason·gaps·실패한 checks, 그리고 거부한 목표 게이트의 문구). 예산이
  소진되면 이전과 똑같이 `unreachable`로 정산합니다. submit 응답에 `reassigned`가 실려 호출자가 확인할
  수 있습니다. 재할당은 라우팅에도 걸립니다 — 같은 단계의 앞선 시도가 거부된 identity에 페널티를 줍니다.
  `goal-docs`가 예산 전부를 같은 작성자에게 같은 워크트리에서 같은 결론을 내게 하며 태웠기 때문입니다.
  판정만 재할당하고(아예 실행되지 못한 노드는 기존 경로 유지), 목표 게이트는 제외합니다(그 거부는 한
  subgoal이 아니라 통합 결과를 탓하므로). `team_open({auto_reassign: false})`로 옛 동작 복원 가능하며,
  매니저가 자식 run 전부에 설정을 전달합니다.

- **v0.6.9 — 구동 세션이 직접 일하지 않고 던지게 만드는 hook**: 플러그인이 `PreToolUse` 게이트를
  함께 배포합니다(별도 등록 불필요). 프로젝트가 `.claude/teams-dispatch.json`으로 opt-in하기
  전까지는 아무것도 하지 않고, 파일이 있으면 **task나 run이 하나도 열려 있지 않은 동안** 게이트 대상
  경로의 쓰기를 거부하면서 호출해야 할 것(`tm_open`)과 빠져나가는 법(파일 삭제, 또는 `allow`에 경로
  추가)을 함께 알려줍니다. 하네스가 관여 중이면 모든 쓰기를 통과시킵니다 — 노드는 써야 하고, 노드의
  fresh agent에게 쓰지 말라고 하면 런이 죽습니다. 이건 벤치가 이미 측정한 모양을 강제하는 것입니다:
  하네스를 잘 모는 세션은 `top-level edits 0`이고, 프로젝트를 직접 고치기 시작한 세션은 오케스트레이션을
  그만둔 것이며 — 그게 매니저의 존재 이유를 건너뛰는 경로이자 구동 세션 컨텍스트가 붓는 경로입니다
  (331턴에 507k 토큰, 작업 총비용의 약 55%). `paths`·`min_chars`·`allow`는 모두 선택이고, 하네스
  자신의 상태는 절대 게이트하지 않으며, 모든 오류에서 fail-open합니다 — 자기 파싱 실패로 세션을 막는
  hook은 없는 것만 못합니다.

- **v0.6.8 — 다른 벤더에서 노드가 실행됐고, 분담이 저절로 지켜짐**: Codex 로그인 상태에서
  `betas code-flat`이 실행 노드 7개(`draft`·`implement`·`test`)를 전부 `gpt-5.6-sol`에 보내고
  `critique`·`review`·`gate`는 전부 구동 호스트에 남겼습니다 — 누가 지시하지 않았는데 subgoal 4개에서
  **작성자와 리뷰어의 벤더가 갈렸습니다**. Codex는 7번 중 7번 유효한 단계 계약을 반환했고, 런은
  23/23 노드를 끝내 8/9 · $11.88(같은 arm을 전부 Claude로 돌린 $13.20 대비)이었으며, 도중에 Codex
  용량이 소진되자 `unavailable_vendors`에 기록하고 이유를 노드 `attempts`에 남긴 채 남은 작업을
  Claude로 넘겨 중단 없이 완주했습니다. 7건 모두 `changed_files_verified`가 `null`이고 모순 파일은
  0건 — 공유 워크트리 경로이고, 거기서 긍정 귀속은 설계상 성립하지 않습니다. 매니저는 자식 run을
  전부 `isolated`로 열고 쓰기 노드를 하나씩만 내주며, 이미 디스크에 있는 매니저 경로 런들의 집계는
  **49노드 전부 `('isolated', true)`** 입니다 — 남은 미측정은 메커니즘이 아니라 "executor가 Codex인
  isolated 노드" 하나로 좁혀집니다.

- **v0.6.7 — 매니저 단계에 방법론을 주고, 무엇을 썼는지 말하게 함**: 판단·기획 단계가 작업 전에
  로드할 스킬을 지정합니다 — `shape`는 `develop:domain-driven-design`과 `architecture-designer`
  (계약문이 이미 "단계가 아니라 소유권으로 쪼개라"고 합니다), `critique`는
  `think:devils-advocate`와 `cognition:assumption-extractor`(계약문의 단어가 "공격하라"),
  `accept`는 주장 대 증거를 가리는 `cognition:epistemic-reasoner`, `integrate`는 합쳤을 때만
  깨지는 것을 보는 `cognition:second-order-thinker`, `gate:goal`은
  `cognition:critical-thinking-workflow`. `size`는 의도적으로 없음 — 측정이고, 유일한 실패 모드가
  명령 대신 방법론에 손대는 것입니다. 사람을 위해 쓰인 스킬에는 headless 노드가 따를 수 없는 것이
  둘 있습니다(자기 출력 템플릿, 그리고 사람 파트너에게 말하는 "what you do" 절) — 그래서 브리핑이
  단계 계약이 둘 다 이긴다는 것, 설치돼 있지 않은 스킬은 말없이 건너뛴다는 것, 어떤 노드도 질문해서는
  안 된다는 것을 명시합니다. 모든 계약이 `skills_used`를 반환합니다 — 사용 여부를 관찰할 수 없는
  방법론은 평가할 수 없기 때문입니다. 단계별 교체는 `tm_open({skills: {...}})`, 계약문만으로 돌리려면
  `skills: false`. **아직 미측정**: 비용값을 하는지. 기준선은 `goal-code` 7/7 · 130분 · $44.74이고,
  심판 노드는 이미 작업 총비용의 약 40%입니다.

- **v0.6.6 — 점수가 하네스 자신의 판정과 모순될 수 없게**: `goal-docs`는 `integrate` 2회 실패,
  패키지 blocked, `unreachable` 3개로 끝났는데(정산 경로, 설계대로) 벤치 채점기는 integrate가
  거부한 바로 그 통합 워크트리에 **8/8**을 줬습니다 — LLM accuracy 심판까지 통과. `task.json`에
  state 필드가 없어 채점기가 판정 자리에 `-`를 찍고 있었고, 이제 노드에서 판정을 유도해
  (`delivered` / `settled-failure` / `incomplete` / `not-delivered`) 점수 옆에 출력합니다.
  드라이버 결함 2건 동반: 한도 메시지가 `hit your **weekly** limit`인데 정규식이 `session|usage`만
  알아서 작업 중인 job을 done 처리했고, 같은 워크스페이스를 두 번째 드라이버가 집으면서 resume
  번호를 0부터 다시 세어 첫 드라이버의 스트림을 덮어썼습니다(그 세션의 비용·턴이 이후 모든 합계에서
  소실 — $53.38이 $22.89로). `goal-docs`가 실패로 증명한 것: **seam 결함은 패키지를 격리해
  재시도해서는 고칠 수 없다** — `tm_retry({package_id})`는 그 문장이 여전히 참인 워크트리로 작업을
  돌려보냅니다. 수리 경로가 없고, 이건 졸업을 막는 항목입니다.

- **v0.6.5 — 벤치 드라이버가 죽은 세션을 끝난 세션으로 오인하지 않고, 동일 위상 비교가 완성**:
  외부에서 죽은 세션(메모리 부족 kill, SIGKILL)은 `result` 이벤트를 남기지 않는데 `drive.sh`가
  그 빈 텍스트를 "정상 종료"로 읽어, 두 런이 죽는 순간 done으로 표시됐습니다. 이제 `result`
  이벤트가 없는 스트림은 kill로 보고 곧바로 resume하며, 세션을 열지 못한 resume은 재시도 예산을
  순식간에 소진하는 대신 해당 job을 중단합니다. `resume.sh`는 워크스페이스 이름
  `<case>-<arm>-<label>`을 왼쪽부터 파싱해 `goal-code-beta-g1`이 case `goal`이 되었고, 모든
  한-줄-목표 resume이 없는 요청 파일에서 죽었습니다 — 이제 오른쪽부터 파싱합니다. graph 1.7.1에서
  고친 `$TMPDIR`/`private/var` 단언이 여기엔 남아 있어 함께 수정. `betas docs`가 들어오면서
  (9/9 · 68분 · $21.79 · 31 agents) 두 동일 위상 쌍이 모두 측정됐습니다: stable의 9/9 · $18.10
  대비 beta는 20% 더 쓰고, 그 20%를 실제 `document` flow에 씁니다 — `draft` 9 · `review` 9 ·
  `gate` 10, `implement`은 0. stable은 document kind가 없어 같은 요청을 implement/test로
  돌렸습니다. 엔진 오버헤드는 엔진의 것이고, 라운드 1의 34배는 beta가 아니라 매니저 위상의 것입니다.

- **v0.6.4 — shape 계약문이 브랜치에 대해 사실을 말하고, 벤치가 매니저의 존재 이유인 층을
  측정**: 첫 한-줄-목표 런의 critique 노드가 shape 계약문이 여전히 모든 패키지가 "현재 HEAD에서
  갈라진다"고 말하는 것을 잡았습니다 — 의존 패키지는 0.6.0부터 의존 대상의 전달 브랜치에서
  갈라지는데, 낡은 문장 때문에 critique가 사실은 핵심이던 의존을 반대했습니다. 수정. 벤치에
  `betas` arm(size를 측정에 맡긴 teams: 단일 런, stable과 같은 위상 — `code`에서 8/9 ·
  $13.20 vs stable 9/9 · $13.27)과 `goal-code`/`goal-docs` 케이스(한 줄 목표만 주고 분할·계약·
  문서 세트를 하네스에 맡김)가 생겼고, 채점기는 목표 대비 결과와 매니저 분할의 자체 타당성을
  판정합니다. 첫 관찰: shape가 한 줄 목표를 사람이 상세 케이스에 써둔 것과 같은 패키지 넷으로
  나눴습니다. 어느 라운드에도 아직 측정 안 된 것: 교차 벤더 dispatch — 벤치 머신에 codex
  로그인이 없어 모든 노드가 Claude로 돌았습니다; 가정하지 않고 다음 라운드로 기록.
- **v0.6.3 — 처음으로 완주한 매니저 런, 그리고 가는 길에 깨진 것들**: size L 태스크 둘이 `report`까지
  끝까지 돌았습니다(`scripts/bench/README.md`, Results). 거기까지 가며 매니저 결함 셋을 더 찾아 각각
  테스트와 함께 고쳤습니다: fold의 `git add -A -- . ':!.teams_output'`은 프로젝트 `.gitignore`에
  `.teams_output/`이 있으면(보통의 경우이고, 이제 모든 테스트 리포도 그렇습니다) exit 1 — 수용된
  자식 둘을 커밋하지 못했습니다; 이제 전부 스테이지한 뒤 `.teams_output`을 빼냅니다.
  `tm_retry({package_id})`는 shape에 없는 id를 받아 유령 패키지를 열었습니다; 이제 목록과 함께
  거부합니다. 그리고 검사에 실패한 `integrate`는 탓한 패키지가 재시도·수용된 뒤에도 failed로
  남았고 — 목표 게이트는 그 뒤에서 영원히 대기, 그래프 엔진의 거부된 `gate:goal`과 같은 막힘 —
  이제 패키지 재시도가 같은 accept들 위에 새 `integrate:N`을 열고 목표 게이트를 그 뒤로 옮깁니다.
  같은 릴리스: `resume.sh`와 `drive.sh`가 중단된 워크스페이스를 새 세션에서 이어가고 사용 한도
  리셋을 넘어 잠들었다 깨어납니다; 채점기는 워크스페이스를 구동한 모든 세션을 합산하고, 벽시계
  시간은 러너의 스탬프에서, 구동 세션의 도구 호출은 fresh agent의 것과 분리해 셉니다. 측정:
  매니저는 두 케이스 모두 plain 세션과 같은 9/9를 비용 34× / 12×로 냈습니다. 돈이 어디로 갔고
  무엇을 할지는 플랜 문서(Step 7). 스스로 L로 측정되는 요청이 매니저를 통과하기 전까지 매니저는
  experimental입니다.
- **v0.6.2 — 모델 티어는 호스트가 선언한 목록에 맞춰 해석, size는 핀 가능**: 두 번째 e2e
  라운드는 `plan`을 넘었지만 `implement`/`draft` 노드가 전부 막혔습니다 — 실패 노드 0개인 채로.
  실행 단계 기본값은 티어 이름(`sonnet`), 세션은 정식 ID(`claude-sonnet-5`)를 선언했고, 검사는
  문자열을 비교했습니다. 구동 세션의 유일한 출구는 두 번째 `team_open`이었고 — 고아 런과
  스펙 재작업이 두 번. 이제 `resolveNativeModel`이 티어를 선언 목록에 대응시키고(`sonnet` ~
  `claude-sonnet-5`), 선언되지 않은 티어는 호스트 모델로 돌되 라우팅 이유에 치환을 적습니다 —
  보이게, 조용히 말고, 이름 문제로 런이 죽는 일 없이. `loop.md`는 `vendor-failure` 막다른 길을
  명명하고 두 번째 open을 금지합니다. 같은 라운드에서 monorepo 픽스처 둘도 타당한 이유로 S로
  측정됐습니다(테스트 스크립트 하나, 커밋 하나, 소유 경계 없음): `size`는 패키지 수가 아니라
  build unit을 읽고, 매니저 경로엔 도달하지 못했습니다. `tm_open({size: "L"|"S"})`가 `flow`처럼
  size를 핀합니다 — 사용자가 직접 나누라고 말한 경우 — size 노드는 `pinned`로 기록됩니다. 벤치의
  beta arm은 이제 그 말을 싣고, 없이 돈 런은 위임 경로 데이터로 남깁니다.
- **v0.6.1 — 호스트 자신의 모델은 항상 선택 가능, 그리고 벤치**: 첫 e2e 라운드에서 구동
  세션이 자신을 `claude-opus-5[1m]`(fresh agent 선택기에 없는 컨텍스트 변형)로 보고했고,
  `team_open`이 `plan`에서 `native host cannot select model`로 막혔습니다 — 그 순간 호스트가
  실제로 돌고 있던 모델에 대한 vendor failure. 이제 검사는 `host_model`을 무조건 통과시킵니다:
  모델 지정 없는 fresh native agent는 그 모델을 상속합니다. 같은 라운드에서 flat 요청 둘이 모두
  S로 측정됐습니다 — 빈 단일 패키지 리포에는 `size`가 볼 build unit이 없습니다 — 그래서
  `scripts/bench/`에 L로 측정되는 monorepo 픽스처 둘(`code`: 워크스페이스 패키지 넷, `docs`:
  문서화할 패키지 셋), 위임 경로용 flat 픽스처, 한 arm(`beta`, `stable` graph 1.x, `none`)을
  headless 세션으로 돌리는 러너, 채점기(정적+실행 기준, docs용 LLM 판정 정확성 검사 하나, 최상위
  transcript에서 뽑는 세션 비용과 스킬 준수 카운트)를 넣었습니다. 픽스처 메모: 첫 라운드의
  `npm test` = `node --test test/`는 Node 22에서 실패합니다(디렉터리 인자); 이제 `node --test`.
  결과는 라운드가 끝날 때마다 `scripts/bench/README.md`에 적습니다.
- **v0.6.0 — integrate와 repackage**: git 작업은 매니저의 것이라, 충돌은 노드의 주장이 아니라
  매니저가 본 사실입니다. 수용된 자식을 접을 때 워크트리를 패키지 브랜치에 커밋합니다(런 상태
  디렉터리는 제외). `deps`가 있는 패키지는 첫 의존 패키지의 브랜치에서 갈라지고 나머지는 머지되어
  들어옵니다 — 머지 시점에 다시 발견하는 대신 전달된 작업 위에서 시작하고, 의존 둘이 서로
  충돌하면 자식을 열기 전에 그 dispatch가 실패합니다. `integrate`가 준비되면 `tm_next`가 모든
  패키지 브랜치를 의존 순서로 통합 워크트리에 머지하고 머지 커밋을 기록합니다. `integrate`
  에이전트는 합쳐진 트리에서 목표 수준 검사만 돕니다. 머지 충돌은 노드를 `conflicts`와
  `conflicting_packages`(머지되던 것, 그다음 선언된 `touches`로 본 소유자)로 실패시키고,
  `tm_retry({repackage: [...]})` — 미결이었던 질문의 답 — 이 그 패키지들을 하나로 합치거나 서로
  의존하게 하라는 지시와 함께 reshape합니다. 유지된 id는 워크트리를 재사용합니다. 같은 내용의
  편집은 git 규칙상 조용히 머지된다는 걸 테스트가 배워야 했습니다. 매니저 13건; 세 스위트 합계
  112개 통과.
- **v0.5.0 — 모든 진입에 size 게이트**: `teams:orchestrate`·`develop`·`document`가 모두
  `tm_open`으로 열고, 새 에이전트 하나가 `size`를 돕니다. `delegate`가 있으면 태스크는 이미
  사라졌고 스킬은 `team_open(delegate.args)`와 단일 런 루프로 이어갑니다. 없으면 새
  `orchestrate/references/manager.md` 루프: `tm_next`의 children을 자식 워크트리에서 평소의
  `team_*` 루프로 돌리고, payload 없는 `tm_submit`으로 접고, 패키지별 `tm_retry` 또는 reshape.
  고정된 진입 flow는 사이징을 통과해도 유지되고(`size`가 뭐라 해도 진입이 이김),
  `delegate.args`는 `team_open`에 그대로 들어갑니다 — 두 서버를 가로질러 끝까지 테스트.
  110개 통과.
- **v0.4.0 — TaskManager 서버, 자식 런은 읽기만**: `mcp/taskmanager.mjs`를 브로커 옆에
  `task-manager`로 등록. `tm_open`은 `size → shape → critique`를 `~/.harness/tasks/<task_id>/`
  아래에(프로젝트 밖) 만듭니다. `size`가 S면 태스크를 지우고 `delegate: {tool: "team_open", args}`를
  돌려줍니다 — S 요청은 매니저 상태를 남기지 않습니다. L이면 `shape`(패키지: `brief`, `acceptance`,
  `touches[]`, `deps[]`; 겹치는 touches·없는 dep·사이클·패키지 하나짜리를 검증) → 패키지마다
  `[dispatch → accept]` → `integrate` → `gate:goal` → `report`. 준비된 `dispatch`는 `tm_next`에서
  서버가 직접 실행합니다: 프로젝트 HEAD에서 `git worktree add`, 그 안에 `graph.mjs`의 `createRun`을
  라이브러리로 불러 격리된 자식 graph 런을 열고, 패키지 brief를 request로, 패키지 계약(과 의존
  패키지의 보고서)을 context로 넘깁니다. 세션은 평소의 `team_*` 도구로 자식을 돌리고, dispatch에
  `tm_submit`하면 자식 파일을 읽어 goal-gate 판정과 보고서를 접어 넣습니다 — 파일은 바이트 하나
  안 바뀝니다(테스트로 확인). 재시도는 같은 워크트리에 gaps를 실은 새 자식을 열고, 예산 소진은
  하류를 확정해 report를 풉니다. 서버를 재시작해도 파일에서 이어가며 진행 중인 dispatch를
  회수하지 않습니다. 진행 중 graph 엔진 자체의 버그 발견: 거부된 `gate:goal`이 서브골 재시도 뒤
  다시 판정되지 않아 수정이 들어간 채 런이 멈췄습니다 — 이제 살아있는 서브골 gate들 위에 새
  `gate:goal:N`이 열리고 report가 그 뒤로 옮겨집니다. 매니저 10건 + 엔진 1건; 세 스위트 합계
  109개 통과.
- **v0.3.0 — flow와 진입 스킬**: `team_open({flow, mixed})`. `flow: "auto"`(`teams:orchestrate`
  기본값)는 선택을 `plan`에 맡기고, plan 계약은 이제 `flow`(develop | document), `size`(S | L),
  그리고 측정에 쓴 명령을 반환합니다. 아무 말 없는 plan은 develop으로 떨어지되 런에
  `flow_source: "default"`로 기록되어 결정인 척하지 않습니다. `teams:develop`과
  `teams:document`는 얇은 수동 진입 — 트리거 단어, 고정된 `flow`, 페르소나 집합 — 이고
  하나의 루프(`orchestrate/references/loop.md`로 이동)에 넘깁니다. flow는 서브골이 이름 붙이지
  않은 kind를 공급하고, `mixed: false`면 다른 kind는 setgoal에서 스펙 결함이 됩니다.
  `team_next`/`team_status`가 `flow`와 `size`를 보고합니다. 신규 3건, 98개 통과. `size: L`은
  기록만 되고 아직 행동하지 않습니다.
- **v0.2.0 — `document` kind**: 서브골이 `kind: "document"`를 선언하면 implement/test/gate
  대신 `draft → review → gate`로 펼쳐지고, 한 스펙에 kind를 섞을 수 있습니다. `draft`는 산출물을
  쓰고 implement와 같은 워크트리 교차검증을 받되, 빈 파일 목록은 모순이 아니라
  `changed_files_verified: null`(`document-unchanged`)입니다 — 핸드오프에 담긴 노트는 git이
  아니라 리뷰어가 판정합니다. `review`는 추론 노드: 읽기 전용 샌드박스, 수용 항목마다 근거
  문장을 인용하거나 빠진 것을 명시, 판정은 `verified`. 저자 ≠ 리뷰어는 브로커가 신원을 볼 수
  있는 곳에서 강제됩니다: draft를 쓴 vendor+model로 라우팅된 review는 거부되고 pending으로
  남습니다(판정에 `reviewer_independence: distinct-identity | unverifiable-self`). balanced
  할당에선 자동으로 만족 — draft는 peer로, review는 host에 남습니다. review나 test가 실패한
  뒤의 재시도는 gate의 gaps만이 아니라 그 노드의 checks를 피드백으로 가져갑니다. 신규 5건,
  95개 통과.

- **v0.1.0 — 포크 + kind 테이블**: graph 1.7.0(간선 타입, 확정 실패)에서 복사. `expandSubgoals`와
  `retrySubgoal`이 서브골의 노드 체인을 하드코딩된 implement/test/gate 대신 `KINDS` 테이블에서
  만들고, `subgoal.kind`를 그 테이블로 검증합니다. kind는 아직 `subgoal` 하나이고 89개 회귀
  테스트가 그대로 통과합니다 — 이 단계의 목적이 그것입니다: 이음새는 생겼고 동작은 움직이지
  않았습니다. 새 케이스 하나: 알 수 없는 `kind`는 다른 스펙 결함처럼 setgoal에서 실패합니다.

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
[`skills/install/SKILL.md`](skills/install/SKILL.md), 설치 없이 도는 기본 경로는
[`skills/orchestrate/SKILL.md`](skills/orchestrate/SKILL.md)의 "Running without install" 절을
참고하세요.

## 설정

`.claude/team.json`은 `tm_open`과 `team_open` 양쪽 모두에 프로젝트 기본값을 공급합니다 —
브로커의 직접 진입점인 `team_open`도 이제 TaskManager와 같은 방식으로 이 파일을 읽습니다.
우선순위는 내장 기본값 < `team.json` < 런을 연 도구의 같은 이름 명시적 인자입니다
(`teamconfig.mjs`의 `resolveTeamOptions`); 알 수 없는 키나 검증기를 통과하지 못한 값은
적용되지 않고 무시되며, 기록됩니다 — `tm_open` 경로에서는 `tm_status`의 `team.notes`,
`team_open` 경로에서는 `team_status`의 `config_notes`(노트가 하나라도 있을 때만 나타나며,
`resolveTeamOptions`의 노트를 런에 영구 저장해둔 사본입니다 — 실시간 재검사가 아닙니다).
스키마는 [`mcp/teamconfig.mjs`](mcp/teamconfig.mjs)의
`TEAM_DEFAULTS`/`CHECK`입니다 — 19개 키 중 실제로 동작에 반영되는 건 열일곱이고, 각 키가
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
| `max_parallel_teams` | `2` | 예 | `tm_open`만 | `tm_next`(`taskmanager.mjs`의 `toolNext`, ~2256/2268행)가 한 번에 여는 develop STORY dispatch 수를 제한합니다 — phase-Team 패키지(PLAN/QA/audit)는 예외입니다. `2`는 측정값이 아니라 잠정 기본값입니다 — `teamconfig.mjs`의 `PROVISIONAL_MAX_PARALLEL_TEAMS` 참고. `team_open`의 인자가 아닙니다. |
| `roles` | `{planning:true, qa:true, audit:true}` | 예 | `tm_open`만 | 0.17.0부터 `planning`/`qa` 기본 ON. `planning`은 `shape` 앞에 PLAN phase-Team(draft → revise → gate)을 엽니다. `qa`는 `integrate`와 `gate:goal` 사이에 QA phase-Team(cases → execute → gate)을 엽니다. `audit`(신규)은 이전까지 `roles.planning` 하나에 완전히 얹혀 있던 planning-audit phase-Team의 독립 스위치입니다 — 여전히 기본 ON이고 여전히 `roles.planning`도 함께 켜져 있어야 하지만(audit은 planning 자신의 두 번째 패스이므로 planning 없이는 결코 돌 수 없습니다), 이제 `{"roles": {"audit": false}}`로 통합 후 재검토 없이 PRD만 유지할 수 있습니다. 세 가지 모두 size L 태스크에서만 돕니다 — size S 태스크는 단일 graph 런에 위임하며 셋 다 건너뜁니다(알려진 공백, v0.17.0 참고). `team_open`의 인자가 아닙니다. |
| `interactive` | `false` | 예 | `tm_open` + `team_open` | 이 런이 사람을 기다리며 멈출지, 아니면 기본값으로 결정하고 무엇을 물었을지 기록만 할지. 세 가지를 통제합니다: 판정/결정 스테이지 어디서든 낼 수 있는 `questions[]`(0.29.0, investigate의 `unknowns[]`를 일반화 — `graph.mjs`의 `openAsk`), MODEL이 직접 쓴 `assignee` 핀(shape 패키지 자신의 필드 — `tm_open`에서는 `subgoal_assignee`로 자식 런에 전달됩니다 — 또는 setgoal subgoal 자신의 필드, 양쪽 경로 모두 — 0.27.3 리뷰 이후로), 그리고 `human_gates`(아래). `true`면 핀이 걸린 노드가 `waiting_human`에 멈춥니다; `false`(기본값)면 대신 자동으로 결정됩니다 — 노드는 아무것도 쓰이지 않은 것처럼 AI에게 그대로 디스패치되거나(`human_gates`는 자동 승인), 걸렸을 핀은 노드에 기록되어(`auto_decided_pin`) `tm_inbox`의 `decided` 섹션에 나타납니다. 사람이 직접 부른 `tm_assign` 핀은 출처가 다르고(`{by: 'user'}`로 표시, `graph.mjs`의 `applyHumanPin`) 이 키와 무관하게 항상 멈춥니다 — 사람은 정의상 이미 그 자리에 있으니까요. |
| `human_gates` | `[]` | 예 | `tm_open` + `team_open` | 어떤 판정 스테이지를 모델 대신 사람이 accept/reject해야 하는지 — 스테이지 이름 목록(`"critique"`, `"gate"`, `"gate:goal"`, 매니저 층에서는 `"accept"`/`"integrate"`도; `"shape"`처럼 판정이 아닌 스테이지를 적어도 오류는 아니지만 아무 효과가 없습니다 — verdict 필드가 있는 스테이지만 게이트됩니다, `graph.mjs`의 `humanGateVerdictField`). `interactive`와 같은 방식으로 전달됩니다: `tm_open`의 `task.human_gates`와 `child_opts.human_gates`가 모든 패키지의 자식 런까지 닿고, `team_open`은 `createRun`에 바로 전달합니다. 여기 이름 붙은 스테이지의 노드는 드라이버에 절대 가지 않습니다(`graph.mjs`의 `promoteHumanGates`, `promoteWaitingHuman`과 같은 자리에서 호출): `interactive`면 `waiting_human`에 멈춰 `tm_inbox`/`tm_submit({key, payload:{accept, reason?, gaps?}})`로 답합니다 — 핀이 걸린 author 스테이지나 `ask` 카드와 똑같은 경로입니다. 사람의 accept/reject가 그 노드의 결과가 되므로, 거절의 `gaps[]`는 모델 게이트의 거절과 똑같이 재시도로 흘러갑니다. `false`(기본값)면 대신 자동 승인하고(`autoPassHumanGateResult`) 노드에 기록해(`auto_decided_pin`) `tm_inbox`의 `decided`에 띄웁니다 — 아무도 보지 않는 런도 끝나야 하고, 답할 사람이 없는 게이트는 영원히 막는 대신 통과가 기본입니다. |
| `retry_policy` | `"continue"` | 예 | `tm_open` + `team_open` | 재시도가 실패한 시도가 남긴 워크트리를 어떻게 다룰지. `"continue"`(기본값, 이 키가 생기기 전까지 유일했던 동작)는 그 위에 다음 시도를 이어 붙입니다 — `ensureWorktree`/`retrySubgoal`은 이미 시도 전체에 걸쳐 같은 트리를 유지해 왔고, 이 키는 그것을 규약으로 선언할 뿐입니다. `"rollback"`은 먼저 워크트리를 되돌린 뒤, `"continue"`와 똑같이 실패한 gate의 gaps를 피드백으로 넘겨 다시 돌립니다: 노드 레벨(`team_open`, 그리고 `tm_open`이 여는 모든 자식 런 — `child_opts.retry_policy`)에서는 `retrySubgoal`이 서브골의 `implement`/`draft`/`cases`/`audit`를 그 서브골의 **첫** 시도가 손대기 전에 `broker.mjs`가 기록한 체크포인트로 되돌립니다 — 런에 서브골이 정확히 하나일 때만입니다(다른 서브골이 아직 같은 워크트리에서 작업 중이면 그쪽 진행 상황까지 지우지 않고는 되돌릴 수 없으므로, 이 가드에 걸리면 `team_retry`의 응답이 `rollback: {skipped: true, reason}`으로 왜 `"continue"`로 대신했는지 알려줍니다). 패키지 레벨(`tm_open`만, `retryPackage`)에서는 반려된 패키지 재시도가 마지막으로 **승인된** 커밋으로 되돌립니다(`commitWorktree`는 `accept:true`일 때만 커밋합니다) — 그 패키지의 어떤 시도도 통과한 적이 없다면 워크트리 자신의 base 커밋으로. `docs/plans/2026-09-23-teams-reducer-human-rollback.md` §5가 기본값을 정하기 전에 실제 런 둘을 측정했습니다: 둘 다 재시도된 `implement`가 같은 실수를 반복하는 대신 자기 gate의 피드백에 **수렴**하는 것을 보여줬고(52%→60%→78%, 74%→78%), 그래서 시도가 만든 작업을 버리는 쪽이 더 낫다는 근거는 아직 없습니다. |
| `budget_usd` | `null` | 예 | `tm_open`만 | 기본은 무제한. 이 태스크가 띄운 모든 세션에서 매 데몬 tick마다 지출을 합산합니다(`collectTaskCosts`): 패키지/S 드라이버와 매니저 판정 호출(`drivers/*.stream.jsonl`, 재기동 포함), 그리고 자식 런의 노드 어댑터 세션(`.teams_output/broker/<run>/<node>/<attempt>/events.jsonl`). 각 세션의 마지막 `result` 이벤트의 `total_cost_usd`를 읽으므로 아직 도는 세션은 끝나야 잡히고, codex 노드는 비용을 보고하지 않습니다. `requests`가 2개 이상이고 상자가 있으면 size L로 고정됩니다. shape 전에 멈추면 대기 그래프를 건너뛰고 report는 그대로 돕니다. 80% 지점에서 `enforceBudget`(`taskmanager.mjs`)이 경고를 한 번 기록하고(`tm_status`의 `budget.warn`), 100% 지점에서는 새 패키지를 더 이상 디스패치하지 않습니다 — 이미 돌고 있는 패키지는 끝까지 돕니다 — 그리고 더 이상 돌고 있는 게 없으면, 수락된 패키지만으로 새 `integrate`를 엽니다(`reintegrateBehind` — 결함 신고나 repair가 이미 쓰는 것과 같은 메커니즘), 나머지는 조용히 버리는 대신 리포트의 "Next backlog"에 이름을 남깁니다. `budget_usd`/`timebox_minutes` 중 자기 한도에 더 가까운 쪽이 정지를 결정합니다 — 둘 중 하나만 있어도 실제 정지 조건입니다. `team_open`의 인자가 아닙니다 — `team_open`은 이걸 묶어줄 패키지/드라이버 개념이 없는 단일 graph 런을 엽니다. |
| `timebox_minutes` | `null` | 예 | `tm_open`만 | `budget_usd`와 같은 정지 조건을, 금액 대신 시계로 — `tm_open` 이후 경과 분. 80%/100%가 정확히 무엇을 하는지는 `budget_usd` 행 참고. `budget_usd`와 같은 이유로 `team_open`의 인자가 아닙니다. |
| `max_depth` | `2` | 아니요 | `tm_open`만 | 기록만 되고 아직 무동작 — 선언되고 검증만 될 뿐 아무것도 강제하지 않습니다. 자식 런이 스스로 다시 쪼갤 때의 깊이 캡이 될 자리입니다 — `docs/plans/2026-09-21-teams-server-owns-the-loop.md` §3 참고. `team_open`의 인자가 아닙니다. |
| `qa_rounds` | `2` | 아니요 | `tm_open`만 | 기록만 되고 아직 무동작 — 어디서도 읽지 않습니다. `team_open`의 인자가 아닙니다. |
| `upstream_fix_rounds` | `2` | 예 | `tm_open`만 | 다운스트림 패키지 자신의 fix-forward 루프에 상한을 겁니다(§upstream_defects, `taskmanager.mjs`의 `fileUpstreamDefects`): 패키지의 implement/test/gate, 또는 그것을 판정하는 매니저 자신의 `accept`가 자기 `touches[]` 바깥, 즉 자신이 `deps`로 의존하는 패키지 안에서 결함을 신고할 수 있습니다 — `awake-beta-ref2`(2026-09-25): P3는 커널 `comm` 문자열로 Claude Code를 식별하도록 승인되었지만 P4 자신의 호스트에서는 그 가정이 성립하지 않았고, P4는 어떤 재시도로도 고칠 수 없는 시도를 실패시키는 것 말고는 경로가 없었습니다. (QA가 낸 결함이 이미 거치는 것과 같은 메커니즘인) `fileDefects`/`reintegrateBehind`를 재사용해 UPSTREAM 패키지 자신의 스코프로 귀속되는 fix STORY를 발행하고(그 패키지의 `touches`/`deps`, `reporter: "upstream"`), 그다음 DOWNSTREAM 패키지 자신의 다음 시도를 열어 `accept:<upstream>:N` 의존을 그 fix의 accept로 다시 연결합니다 — 그래서 같은 고장난 upstream에 맹목적으로 재시도하는 대신 fix를 기다렸다가 그 위에서 다시 돕니다. `qa_rounds`가 `dispatch:QA` 노드 수를 세는 것과 같은 방식으로, 해당 upstream 패키지에 이미 발행된 모든 fix STORY 수(어느 다운스트림 패키지가 다음 것을 찾았는지와 무관하게)로 셉니다; 상한을 넘으면 발행 대신 `task.unresolved_defects`(`reporter: "upstream"`)에 기록되고, 다운스트림 패키지는 평소의 재시도/settle 경로로 돌아갑니다. `team_open`의 인자가 아닙니다 — `team_open`은 패키지/`deps`/upstream 개념이 없는 단일 graph 런을 엽니다. |

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
  잡고 있거나 핀이 걸린 카드에는 뚜렷한 표시가 붙습니다.
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

## 나머지 전부

도구, 라우팅, 판정, 벤더, 용량 복구, 원장은 `graph`와 같은 브로커 메커니즘입니다 —
공유 내부 구조는 [`graph/KOR.md`](../graph/KOR.md)를 읽으세요. 그 공유 엔진에 대한 수정은
두 플러그인 사이에서 서로 포트되고, `teams`만의 kind·진입 스킬·TaskManager는 여기 남습니다.
