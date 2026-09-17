# teams (team) v0.13.0 — 사용자가 executor가 된다 (자동 결정 쪽)

> Produced by write:writing-plans. Owner for execution routing: planning:executing-plans.
> Steps use checkbox (`- [ ]`) syntax. 설계 근거: `2026-09-17-teams-team.md` §4·§6·§7·§7b·§7c·§9·§11·§14,
> `2026-09-17-teams-roadmap-sizing.md` §4.2·§6.
>
> **크기: 11 task-unit** — 사이징 문서 §4.2의 경계(11–12) **안**이다. §4.2의 표는 10행을 세면서도
> "8×1 + 6번(2) + 8번(1–2) = 11–12"라고 적었다 — 즉 8번(명령 스킬)을 1로 읽으면 11, 2로 읽으면
> 12다. 이 계획은 8번을 **1**로 확정한다(아래 §0.4의 근거) — 아래 Task 1–10을 그대로 더하면 11이다.
> §4.2가 예고한 위험(runState 확장이 드라이버 루프 조건까지 번지면 12 이상) — 이 계획은 그 확산을
> Task 1(파생)과 Task 5(루프 조건)로 명시적으로 나눠 각각 1로 묶었다(§0.1). 넘기지 않았다.

**Goal:** 그래프에 사람이 앉는 자리(`ask`, `gate:human`, `assignee: human` 핀)가 생기고, 그 자리는
`interactive` 플래그와 무관하게 **항상** 존재한다. 플래그가 꺼져 있으면(기본) 그 자리는 ready가 되는
순간 default로 자동 결정되고 기록된다 — 이 단계가 만드는 것은 그 **자동 결정되는 쪽과 그 기록**이다.
실제로 멈춰 서서 사람을 기다리는 경로(`interactive: true`)는 v0.13.1이 만든다. 사람을 기다리는 상태
자체는 이 단계에서도 도달 가능해야 한다 — 플래그가 꺼져도 SKIP 직전에 `waiting_human`으로 park되는
순간은 있고(그 다음 즉시 SKIP), 그 순간이 상태 어휘·보드·티켓에 제대로 보이는지가 이 단계의 검증
대상이다.

## 0. 이 계획이 내리는 해석 — 설계 문서가 못 박지 않은 것

### 0.1 `waiting_human`은 노드 상태 값이고, `runState()`가 그것을 `blocked`와 구분해야 한다 (결정됨)

설계 문서 §4의 STORY/EPIC 행("ready인 `vendor: human` 노드가 있음 (`waiting_human`)")과 §7b의 human
노드 행("`{state: waiting_human | skipped | done, ...}`")이 이미 `waiting_human`을 **노드 상태 값**
으로 적어 뒀다. 엔진을 읽고 그 자리를 확인한다:

- `graph.mjs:919`의 `runState()`는 `counts = { pending, running, done, failed, skipped,
  unreachable }` 여섯 값으로 고정돼 있고, `taskmanager.mjs:1619`의 `VERDICT_SCHEMA.state` enum도
  같은 여섯 값이다. `waiting_human`은 이 여섯에 **더해지는 일곱 번째 값**이다.
- `runState()`(`graph.mjs:945-949`)는 지금 `!readyNodes(run).length && !counts.running` 하나로
  `blocked`를 판정한다. `readyNodes()`(`graph.mjs:907-909`)는 `state === 'pending'`이고 deps가 만족된
  노드를 돌려준다 — 사람 노드가 ready가 된 순간 그 노드의 `state`를 `pending`에 그대로 두면
  `readyNodes().length`가 0이 아니게 돼 `blocked`로도 안 떨어지고, 그렇다고 아무것도 돌지 않으니
  `running`으로도 거짓 신호를 낸다. 반대로 `state`를 `waiting_human`으로 옮겨(더 이상 `pending`이
  아니므로 `readyNodes()`에서 빠짐) 두면, 지금 코드는 그 상황을 `blocked`로 오판한다 — 사이징 문서
  §4.2가 지적한 바로 그 문제. **고치는 지점은 하나**: `runState()`에 `blocked` 체크보다 먼저
  `run.nodes.some(n => n.state === 'waiting_human')`이면 `{ state: 'waiting_human', counts }`를
  반환하는 분기를 추가한다.
- 이 함수 하나가 두 레벨에서 재사용된다는 것을 코드로 확인했다: `tickets.mjs:122`의
  `epicTicketState`가 `runState(task).state === 'blocked'`를 그대로 읽고, `taskmanager.mjs:1059`의
  `serviceLeader`도 `runState(task).state`를 읽는다 — **`task.json` 자체가 `.nodes` 배열을 가진
  "run"으로 취급되어 `runState()`에 그대로 넘어간다**(둘 다 같은 함수, 다른 데이터). `runState()`
  하나를 고치면 EPIC 레벨과 (자식 run을 도는) TASK 레벨 양쪽이 동시에 옳아진다 — 사이징 문서가
  "이 파생을 고치면 상태·보드·티켓·양쪽 드라이버가 전부 따라 움직인다"고 쓴 것이 정확히 이 재사용
  구조 때문이다.
- **이 계획이 Task 1과 Task 5를 나누는 경계는 여기다.** Task 1은 위 파생(`runState`,
  `epicTicketState`, `storyTicketState`, `taskTicketState`)만 고친다 — 순수 함수, 합성 노드 상태를
  주입하는 표 테스트로 검증 가능하고 드라이버를 실제로 띄울 필요가 없다. **드라이버가 실제로 그
  상태를 만들고(park) 빠져나가고(clean exit) 답이 오면 되살아나는 것**은 Task 5다. 사이징 문서
  §4.2의 경고("양쪽 드라이버의 루프 조건까지 손대야 하면 1번 행 자체가 늘어나 12 이상으로 올라간다")
  는 이 계획에서도 유효한 위험이다 — 이 계획은 그 비용을 Task 1이 아니라 **Task 5의 몫으로 명시적
  으로 예산했다**(아래 Task 5), 조용히 Task 1에 묻지 않았다.

### 0.2 `ask`/`gate:human`은 phase-Team이 아니라 TaskLeader 관리 노드다 — `graph.mjs`는 상태 값만, 구성은 `taskmanager.mjs`가 한다 (결정됨)

v0.12.0 계획(`2026-09-17-teams-team-v0.12.0.md` §0.1)은 planning/qa phase-Team을
`task.spec.packages`에 합류하는 **합성 패키지**로 읽었다 — `packageOf`가 `task.spec.packages`만
보기 때문이었다. `ask`/`gate:human`은 다른 모양이다:

- 설계 문서 §7의 표를 보면 `ask:N`은 "TaskLeader가 삽입"하고 `gate:human:<point>`도 EPIC 레벨
  게이트다 — 패키지(STORY)가 아니라 **`size`/`shape`/`critique`/`integrate` 같은 TaskLeader 관리
  노드와 같은 층**이다. `createTask`(`taskmanager.mjs:143-241`)가 `roles.planning`에 따라
  `task.nodes`에 다른 배열을 넣는 것과 같은 자리 — `PACKAGE_CHAIN`/`pushChain`(STORY 체인)이 아니라
  `task.nodes`에 직접 노드를 미는 패턴이다.
  - `person이 implement/draft/cases를 맡는 것`(`assignee: "human"` 핀)은 다른 층이다 — 이건
    **child run 안의 subgoal 노드**이고, 지금 라우팅이 하는 일(`broker.mjs:427`의
    `node.assignment` 우선 반환)을 그대로 타므로 새 노드 종류가 필요 없다. 새로 필요한 것은 그
    `node.assignment`을 사람 쪽으로 **직접 채우는 경로**뿐(Task 2).
- `mcp/graph.mjs` 변경은 그래서 좁다: `waiting_human` 상태 값(Task 1이 이미 다룸)과, `runState()`가
  그 값을 판별하는 로직뿐이다. **`ask`/`gate:human` 노드의 생성·필드 구성은
  `taskmanager.mjs`(`finish()`, `1429`)의 일이다** — `graph.mjs`의 `KINDS`/`FLOWS`에는 아무것도
  추가하지 않는다(설계 문서 §9의 "`mcp/graph.mjs` | `ask`, `gate:human` 노드 타입"이라는 문구는 상태
  값 쪽을 가리킨 것으로 읽는다 — 다른 읽기(child-run 레벨에도 `ask` kind를 만든다)를 택하는 사람은
  §7의 표에 `ask`가 "TaskLeader가 삽입"이라고만 쓰여 있고 child run 레벨의 `ask` 사용처가 설계 문서
  어디에도 없음을 먼저 반박해야 한다).
- 삽입 지점: `finish(task, n, result)`가 `size`/`shape`/`critique`의 결과에 `questions`(비어있지
  않은 배열)가 있으면 그 직후 `ask:N` 노드를 `deps: [n.node_id]`로 밀어 넣고, 그 노드에 **의존하던
  다음 관리 노드의 deps를 그 `ask:N`으로 재배선**한다(§7 "ask는 setgoal 이전에만 삽입된다" — 여기서
  "setgoal 이전"은 관리 노드 기준으로 `size`/`shape`/`critique` 세 곳까지이고, `dispatch` 이후에는
  질문 삽입 자체가 없다는 뜻으로 읽는다). `gate:human:spec`은 `critique` 완료 직후, `T.human_gates`
  에 `'spec'`이 있을 때만 삽입되고 `dispatch`들의 선행 노드가 된다(`critique`가 열던 자리를 그대로
  대체).

### 0.3 human 실행자는 라우팅 풀에 절대 들어가지 않는다 — 핀 경로만 있다 (확인됨)

`broker.mjs:427`(`route()`)가 `node.assignment`가 이미 있으면 `rankCandidates`/`AUTO_CANDIDATES`
전체를 건너뛰고 그것을 그대로 돌려준다. 이 계획은 이 사실 위에서 human 배선을 두 갈래로 확정한다:

- **자동 후보 풀에는 절대 안 들어간다.** `broker.mjs:432-437`의 `order`(auto 후보 목록)를 구성할 때
  `'human'`을 걸러낸다 — 사용자가 실수로 `tm_open({candidates: ['human', 'claude']})`을 넘겨도
  `rankCandidates`의 스코어링(활성 개수·완료 개수·에러 개수)이 사람에게 의미가 없으므로 방어적으로
  제외한다(Task 3, `routing.mjs`는 94줄로 가장 작다는 사이징 문서의 관찰과 일치 — 실제 고치는
  파일은 `broker.mjs`가 크고 `routing.mjs`는 `AUTO_CANDIDATES`류 상수 근처 한두 줄).
- **핀 경로로만 들어간다.** `assignee: "human"`(shape가 낸 subgoal 필드) 또는
  `tm_assign({key, vendor: 'human'})`(Task 6)이 `node.assignment = {executor: 'human', vendor:
  'human'}`을 직접 쓴다 — `route()`의 얼리 리턴이 그것을 그대로 존중한다. 새 로직이 아니라 있는
  경로를 사람 쪽으로 채우는 것뿐이다.
- **교차 벤더 규칙은 이미 성립한다, 확인만.** `routing.mjs:67`의 `other(v) = v === 'claude' ? 'codex'
  : 'claude'`는 `v`가 `'human'`이어도 `'claude'`를 반환한다 — 즉 human이 `implement`를 맡았을 때
  `test`의 선호 벤더 계산(`other(implVendor)`, `routing.mjs:68-69`)이 우연히도 항상 AI 쪽으로
  떨어진다. 이것은 고쳐야 할 버그가 아니라 **이미 맞는 동작**이다(둘뿐인 이진 분기가 human을
  자동으로 비-human 쪽으로 밀어낸다) — 이 계획은 여기 아무 코드도 건드리지 않는다. 확인한 사실을
  기록해 다음 사람이 다시 세지 않게 하는 것이 §0.3의 역할이다.

### 0.4 발견 — 팀 리더에게 보고, 해결하지 않고 진행

1. **`ask_timeout`이 `teamconfig.mjs`의 `TEAM_DEFAULTS`에 없다** — 확인함
   (`teams/mcp/teamconfig.mjs:12-26`에 없음). 설계 문서 §7이 "`ask_timeout`(기본 없음) 만료 시
   `default`로 자동 제출"이라고 쓴 값이 지금 코드 어디에도 해석되지 않는다. **팀 리더 확인 필요
   없음, 이 계획이 채운다**: `TEAM_DEFAULTS.ask_timeout: null`(기본 없음 = 타임아웃 없음),
   `CHECK.ask_timeout: (v) => v === null || (Number.isInteger(v) && v > 0)`(밀리초). Task 4가
   구현한다.
2. **`tm_answer`가 오면 리더를 즉시 재기동해야 하는데, `serviceLeader`의 얼리 리턴 조건
   (`taskmanager.mjs:1060`, `if (st === 'complete' || st === 'blocked') return false;`)을
   `waiting_human`도 막는 쪽으로 넓히면 *어떤* 폴링(`tm_board`, `tm_status`)도 리더를 깨우지 않게
   된다 — 그런데 그건 맞는 동작이다: 사람이 아직 안 답했으면 아무 폴링도 리더를 깨우면 안 된다(살려
   둬 봤자 할 일이 없다). **팀 리더 확인(2026-09-17으로 가정, §14 결정 기록 `5·7·8·C`의 "애매하면
   제안된 기본값" 원칙 적용): `tm_answer`(신설, Task 6)의 핸들러는 payload를 기록한 직후
   `serviceLeader`의 일반 게이트를 거치지 않고 **직접** `spawnLeader(task, {resume: true})`를
   호출한다** — `reset_capacity`가 `tm_retry`에서 이미 쓰는 것과 같은 모양(`taskmanager.mjs:2068-
   2090` 부근, "clears it and respawns a driver on the same run_id, spending no restart"라는
   기존 설명과 대구를 이룬다). `serviceLeader` 자체의 게이트 조건은 `waiting_human`을 `complete`/
   `blocked`와 같은 "자동 재기동 안 함" 취급으로 넓히기만 하면 된다 — `tm_answer`는 그 게이트를
   우회하는 별도 호출이므로 모순이 없다.
3. **`human_scope: "all"`(Team 내부 질문이 `ask`로 승격되는 것 말고, TeamLeader 자신이 human 노드를
   여는 것)까지 이 단계가 완전히 검증하는가.** 설계 문서 §7의 "`"all"`이면 TeamLeader도 human 노드를
   열 수 있다 — 질문 폭주 주의"는 기본값이 아니다(`teamconfig.mjs`의 기본은 `human_scope: 'leader'`).
   **이 계획은 `human_scope: 'leader'`(기본값) 경로만 Task 9의 가짜 드라이버 테스트로 끝까지
   검증한다.** `'all'`은 구조적으로 막지 않는다(같은 `waiting_human` 상태 값, 같은 park 메커니즘이
   child run에도 그대로 적용된다 — `runState()`가 범용이므로) — 다만 "child run의 TeamLeader가
   `ask`를 여는" 구체적인 삽입 로직(`broker.mjs`의 child-run 매니저 루프에 같은 종류의 분기 추가)은
   이 계획의 태스크 목록에 별도 항목으로 없다. **팀 리더에게 보고할 것**: `human_scope: 'all'`을
   이 라운드에 완전히 지원하려면 +1 unit 후보다(`broker.mjs`의 child-run 매니저 루프에
   `ask`/`gate:human` 삽입을 별도로 구현). 사이징 문서 §4.2가 이미 경고한 "12 이상" 위험의 가장
   그럴듯한 원인이 이것이라고 본다 — 이 계획은 `'leader'` 스코프만으로 §4.2의 11–12 경계를 지키는
   쪽을 택했다.
4. **명령 스킬 개수 — §4.2 표의 자기 모순.** 6번 행은 "도구 3–4개 배선(답변·담당·내 할 일·로그)"라고
   4개를 세지만 8번 행은 "명령 스킬 셋(내 할 일·답변·take)"이라고 3개만 이름을 댄다(`/teams:log`가
   빠져 있다). 설계 문서 §8의 슬래시 명령 표에는 `/teams:log`가 분명히 있다("**미구현** — `tm_log`
   자체가 없다"). **이 계획은 4개로 확정한다**(`/teams:answer`, `/teams:take`, `/teams:inbox`,
   `/teams:log`) — 도구가 있는데 명령이 없으면 사람이 MCP를 직접 호출해야 하고, 그건 §8의 "얇은
   명령 스킬" 원칙과 어긋난다. `/teams:watch`는 설계 문서 §14 C-10에서 이미 "선택 사항"으로 미뤄
   뒀으므로 이 계획도 만들지 않는다. Task 8은 그래서 4개 스킬(1 unit, "얇은 명령 스킬은 2개에 1"
   규칙이면 4개는 2가 나오지만, `board`/`ticket` 대비 이 넷은 인자 하나 받아 도구 하나 부르는
   **더 얇은** 스킬이라 1로 잡는다 — 근거는 Task 8 자체에).

---

## 1. v0.13.0에 들어가는 것 (요약)

- 그래프에 사람이 앉는 자리 셋: `ask:N`(질문), `gate:human:spec`(스펙 승인 게이트, 기본 켬),
  `assignee: "human"` 핀(TASK를 사람이 맡음). 셋 다 **플래그와 무관하게 항상 존재**한다.
- `interactive: false`(기본)면 이 자리들이 ready가 되는 순간 `waiting_human`으로 짧게 park됐다가
  즉시 default/pass-through/재배정으로 **SKIPPED** 결정되고, 무엇을 물으려 했고 무엇으로 정했는지가
  노드에 기록된다.
- `ask_timeout`이 `team.json`에서 처음으로 해석·소비된다.
- 사람이 `implement`/`draft`/`cases`를 맡으면 라우팅이 상대 스테이지(`test`/`review`/…)를 non-human
  으로 보낸다 — 이미 성립하는 동작을 이 단계가 실제로 도달 가능하게 만든다.
- 사람이 대기 중이면(플래그가 켜져 다음 단계 v0.13.1이 실제로 멈추는 것과 무관하게, 이 단계에서도
  `waiting_human`으로 park되는 그 순간에는) TaskLeader 드라이버가 **깨끗이 종료**하고, `tm_answer`가
  payload를 기록하면 같은 `run_id`로 재기동한다 — 재시작 예산을 쓰지 않는다.
- `tm_answer`, `tm_assign`, `tm_inbox`, `tm_log` 네 도구와 그 위의 얇은 명령 스킬 넷이 생긴다.
- `15-spec-gate.md` 렌더러와 `80-report.md`의 "자동 결정 N건" 절이 생긴다 — §7c의 13종 문서 중
  마지막 한 종(v0.12 라인이 12/13까지 닫아 뒀다).
- 티켓의 `WAITING_USER` 상태가 **처음으로 도달 가능**해진다.
- 가짜 드라이버 테스트(0.8.0 방식)로 "사람 대기 → park → 답변 → 재기동" 왕복을 검증한다.

## 2. v0.13.0이 하지 않는 것

- **`interactive: true`로 실제로 멈춰 서서 사람을 기다리는 경로.** v0.13.1. 이 단계가 만드는 것은
  자동 결정되는 쪽과 그 기록뿐이다 — `waiting_human` park는 SKIP 직전의 찰나로만 관측된다
  (Task 9의 테스트가 그 찰나를 표로 확인한다).
- **`human_scope: "all"`의 완전한 배선.** §0.4 발견 3 — 구조적으로 막지 않지만 이 계획의 태스크로
  별도 구현·검증하지 않는다.
- **사용자 오버라이드가 보고서·보드에 크게 드러나는 형식 확정.** `gate:human` payload의 `override`
  필드는 결정 기록 #4가 이미 정했지만, 이 단계는 `gate:human:spec`만 배선한다 — `release` 게이트와
  `override`의 판정 로직(`gate:goal`이 reject한 것을 override로 통과시키는 경로)은 이 단계 범위
  밖이다(`T.human_gates`가 `'release'`를 담아도 이 단계는 그 값을 소비하지 않는다 — 기본값
  `["spec"]`만 실제로 동작).
- **결함 STORY·기획 크로스 검수와의 상호작용.** v0.12.1이 만드는 결함 루프 중에 human 게이트가 끼는
  경우(예: 결함 STORY의 `accept`에도 `gate:human`을 붙일지)는 설계 문서 어디에도 없다 — 다루지
  않는다.
- **sub-EPIC.** v0.14.0.
- **`tm_clean`, 역할별 mounts 키잉.** v0.12 라인이 이미 미배치로 남긴 것 그대로.

---

## 태스크 그룹과 의존 관계

```
Task 1  runState() — waiting_human 상태 값 + 파생(tickets.mjs) 갱신        ─┐
Task 2  ask:N / gate:human:spec 노드 삽입 + assignee:"human" 핀 경로        │ taskmanager.mjs
Task 4  interactive:false = 자동 결정 + 기록 + ask_timeout                 │ 공유 — Task 1이
Task 5  human 대기 시 드라이버 종료·tm_answer 시 재기동                    │ 먼저, 2·4·5는
Task 6  도구 4개(tm_answer/tm_assign/tm_inbox/tm_log)                     ┘ 순서대로 직렬

Task 3  routing — human을 자동 후보 풀에서 제외                            — broker.mjs/routing.mjs,
                                                                             taskmanager.mjs와 안 겹침

Task 7  docs.mjs — 15-spec-gate.md + report의 "자동 결정 N건" 절           — Task 1·2·4 뒤
Task 8  명령 스킬 4개(answer/take/inbox/log)                              — Task 6 뒤 (도구 이름 확정)
Task 9  가짜 드라이버 테스트 — 사람 대기/재개 왕복                         — Task 1·2·4·5·6 전부 뒤
Task 10 릴리스                                                            — 전부의 위
```

- **파일 충돌**: Task 1·2·4·5·6 다섯이 `teams/mcp/taskmanager.mjs`를 건드린다 — v0.12.0의 5/7과
  같은 비율이다. 순서는 상태 어휘(1) → 노드가 생기는 자리(2) → 그 자리가 플래그 꺼짐에서 어떻게
  결정되는지(4) → 드라이버가 그 상태에서 어떻게 움직이는지(5) → 그 상태를 사람이 도구로 조작하는
  경로(6) — 각 태스크가 앞 태스크가 만든 상태·노드 모양을 전제하므로 이 순서를 벗어나면 테스트를
  먼저 쓸 수 없다.
- Task 3은 `broker.mjs`/`routing.mjs`만 건드리므로 위 다섯과 **파일이 안 겹쳐 병렬 가능**하다 —
  v0.12.0에 없던 여유다. 언제 끝내도 Task 9 전에만 들어오면 된다.
- Task 7(`docs.mjs`)은 파일은 안 겹치지만 Task 1·2·4가 만드는 노드 필드(`waiting_human` 상태,
  `ask`/`gate:human` 노드의 `result` 모양)를 읽으므로 순서상 뒤에 온다 — v0.12.0의 Task 6과 같은
  이유.
- Task 8(스킬)은 코드는 안 건드리지만 도구 스키마(`TOOLS` 배열의 인자 이름)가 확정돼야 정확한 예시를
  쓸 수 있어 Task 6 뒤에 둔다.
- Task 9는 이 단계 전체의 통합 시험이라 나머지 태스크 전부에 의존한다 — 병렬로 당길 수 없다.
- **1라운드/2라운드 판단**: 1라운드. Task 3만 앞쪽 어디든 끼워 넣을 수 있고, 나머지는 위 순서를
  지키면 파일 충돌 없이 순차 진행 가능하다.

---

### Task 1: `runState()` — `waiting_human` 상태 값 + 파생 갱신
**Files:** modify `teams/mcp/graph.mjs` (`runState:918-949`), modify `teams/mcp/tickets.mjs`
(`epicTicketState:120-125`, `storyTicketState:89-114`, `taskTicketState:169-200`), modify
`teams/mcp/taskmanager.mjs` (`VERDICT_SCHEMA.state` enum, `taskmanager.mjs:1619`), modify
`teams/scripts/test-graph.mjs`, `teams/scripts/test-tickets.mjs`
**Interfaces:** `runState(run)`에 `run.nodes.some(n => n.state === 'waiting_human')`이면
`blocked` 체크보다 먼저 `{ state: 'waiting_human', counts }`를 반환하는 분기 추가(카운트 객체에
`waiting_human` 키도 추가). `epicTicketState`/`storyTicketState`/`taskTicketState`는 각자의
`blocked`/`BLOCKED` 분기 **바로 앞에** `waiting_human`/`WAITING_USER` 분기를 추가한다 — 순서가
중요하다(먼저 있는 분기가 이긴다). 이 태스크는 노드를 실제로 `waiting_human`으로 만드는 코드는
**아직 쓰지 않는다** — 합성 노드(`{state: 'waiting_human'}`)를 픽스처에 직접 주입해 파생만 검증한다.
**Pass bar:** 표 테스트 — `run.nodes`에 `waiting_human` 노드 하나를 심고 나머지가 `pending`(ready
없음)이어도 `runState(run).state === 'waiting_human'`(과거라면 `blocked`)임을 확인. 같은 합성 상태를
`task.nodes`/자식 `run.nodes` 양쪽에 심어 `epicTicketState`가 `WAITING_USER`, `storyTicketState`도
동일 상황에서 `WAITING_USER`, `taskTicketState`도 동일 상황에서 `WAITING_USER`를 반환함을 확인.
`waiting_human` 노드가 없는 기존 픽스처 전부가 여전히 이전과 같은 상태를 반환함을 회귀로 확인
(`blocked`/`BLOCKED`가 `waiting_human`에 잡아먹히지 않아야 한다).

- [ ] 1: 실패하는 표 테스트 작성(위 네 가지 케이스 + 회귀).
- [ ] 2: `runState()`에 분기 추가, `VERDICT_SCHEMA.state` enum에 `'waiting_human'` 추가,
  `epicTicketState`/`storyTicketState`/`taskTicketState`에 분기 추가.
- [ ] 3: 테스트 통과 확인.
- [ ] 4: `git add teams/mcp/graph.mjs teams/mcp/tickets.mjs teams/mcp/taskmanager.mjs teams/scripts/test-graph.mjs teams/scripts/test-tickets.mjs && git commit -m
  "feat(teams): runState/ticket derivation gain waiting_human, distinct from blocked (§4, §7b)"`

---

### Task 2: `ask:N` / `gate:human:spec` 노드 삽입 + `assignee: "human"` 핀 경로
**Files:** modify `teams/mcp/taskmanager.mjs` (`finish:1429`, `createTask:143-241`,
`validateShape` 근방 — `assignee` 필드 통과), modify `teams/mcp/broker.mjs` (`route`가 subgoal spec의
`assignee`를 읽어 `node.assignment`를 직접 채우는 지점, `route:426` 근방), modify
`teams/scripts/test-taskmanager.mjs`, `teams/scripts/test-broker.mjs`
**Interfaces:** `finish()`가 `size`/`shape`/`critique` 완료 직후 `result.questions`(문자열 배열,
각 항목에 `default` 동봉하는 구조는 이 계획이 `{text, default}` 객체로 확정한다 — 설계 문서는 구조를
못 박지 않았다)가 비어있지 않으면 `ask:N` 노드를 `deps: [n.node_id]`로 밀고, 그 원래 다음 관리 노드의
`deps`를 `ask:N`으로 재배선한다. `T.human_gates.includes('spec')`이면 `critique` 완료 직후
`gate:human:spec` 노드를 `deps: ['critique']`로 밀고 모든 `dispatch:Pn:1`의 `deps`(planning이
꺼졌으면 `['shape']`에서 파생, 켜졌으면 `['accept:PLAN:1']`에서 파생하던 것)를 이 노드로 재배선한다.
`assignee: "human"`은 shape 출력 스키마의 새 필드(패키지가 아니라 **subgoal** 레벨,
`validateShape`가 통과만 시키고 검증은 최소한: 값이 있으면 문자열 `"human"`이어야 함)로,
`broker.mjs`의 child-run 노드 생성 시(`expandSubgoals` 부근) 그 subgoal의 `implement`/`draft`/
`cases`(authorStage) 노드에 `node.spec_assignee = 'human'`을 얹고, `route()`가 이 필드를 보면
`rankCandidates`를 부르지 않고 `node.assignment = {executor: 'human', vendor: 'human'}`을 직접
쓴다.
**Pass bar:** `shape`가 `questions: [{text: '...', default: '...'}]`를 내면 `ask:1` 노드가
`deps: ['shape']`로 생기고, 원래 `shape`에 의존하던 노드의 `deps`가 `ask:1`로 바뀜을 확인.
`human_gates: ['spec']`이면 `critique` 뒤 `gate:human:spec`이 생기고 모든 dispatch가 그것에
의존함을 확인. `human_gates: []`(기본 아닌 값)면 생기지 않음을 회귀로 확인. subgoal에
`assignee: 'human'`이 있으면 그 subgoal의 authorStage 노드가 `route()` 뒤 `assignment.executor ===
'human'`임을 확인, 라우팅 풀(候補)에 `'human'`이 후보로조차 나타나지 않았음을(로그·`attempts`
배열 검사로) 확인.

- [ ] 1: 실패하는 테스트 작성(질문 삽입, 게이트 삽입, 재배선, 핀 경로, 회귀).
- [ ] 2: `finish()`에 `ask`/`gate:human:spec` 삽입·재배선 로직 추가, `validateShape`에 `assignee`
  통과 허용, `broker.mjs`에 `spec_assignee` 전달 + `route()`의 human 핀 분기 추가.
- [ ] 3: 테스트 통과 확인.
- [ ] 4: `git add teams/mcp/taskmanager.mjs teams/mcp/broker.mjs teams/scripts/test-taskmanager.mjs teams/scripts/test-broker.mjs && git commit -m
  "feat(teams): ask/gate:human:spec nodes and the assignee:human pin - the seats humans sit in the graph (§7)"`

---

### Task 3: 라우팅 — human을 자동 후보 풀에서 제외
**Files:** modify `teams/mcp/broker.mjs` (`route:426-437`의 `order` 구성), modify
`teams/mcp/routing.mjs` (`AUTO_CANDIDATES` 근방, 있다면), modify `teams/scripts/test-routing.mjs`,
`teams/scripts/test-broker.mjs`
**Interfaces:** `order`를 만드는 지점(`pol.candidates || (balanced ? ['claude','codex'] :
AUTO_CANDIDATES(run.host_vendor))`)에서 그 결과 배열을 `.filter(v => v !== 'human')`으로 한 번 더
거른다 — `pol.candidates`가 사용자 인자(`tm_open({candidates})`)로 온 경우가 유일한 실제 위험이므로
그 값을 신뢰하지 않는다.
**Pass bar:** `tm_open({candidates: ['human', 'claude']})`로 연 태스크의 `implement` 노드가
`route()` 뒤 `'human'`으로 배정되지 않음(claude로 떨어짐)을 확인. `assignee: 'human'` 핀이 있는
노드는(Task 2가 만든 경로) 이 필터와 무관하게 여전히 human으로 배정됨을 회귀로 확인(핀은 `order`를
아예 거치지 않으므로 안 깨진다는 것을 명시적으로 보인다).

- [ ] 1: 실패하는 테스트 작성.
- [ ] 2: `order` 구성 지점에 필터 추가.
- [ ] 3: 테스트 통과 확인.
- [ ] 4: `git add teams/mcp/broker.mjs teams/mcp/routing.mjs teams/scripts/test-routing.mjs teams/scripts/test-broker.mjs && git commit -m
  "feat(teams): human is never auto-selected as a routing candidate, only pinned (§7, §9)"`

---

### Task 4: `interactive: false` = 자동 결정 + 기록 + `ask_timeout`
**Files:** modify `teams/mcp/teamconfig.mjs` (`TEAM_DEFAULTS`, `CHECK` — `ask_timeout` 추가),
modify `teams/mcp/taskmanager.mjs` (Task 2가 만든 `ask`/`gate:human:spec`/핀 노드가 ready가 되는
지점, `tm_next`가 다음 ready 노드를 돌려주기 직전), modify `teams/scripts/test-teamconfig.mjs`,
`teams/scripts/test-taskmanager.mjs`
**Interfaces:** ready가 된 `ask`/`gate:human`/`assignee:human` 노드를 만났을 때(Task 1의
`waiting_human` 상태를 거쳐) `T.interactive`가 false면 **그 자리에서 바로** SKIP으로 결정한다:
`ask`는 각 질문의 `default`를 `answers`로 채워 `state: 'skipped', by: 'auto', default_applied:
true, question: {...}`를 기록, `gate:human:spec`은 pass-through(`state: 'skipped', by: 'auto',
decision: 'accept'`)로 다음 노드(dispatch들)를 즉시 열어 준다, `assignee: 'human'` TASK는
`route()`가 그 핀을 무시하고 일반 라우팅으로 재배정한다(Task 2가 심은 `spec_assignee` 필드 자체는
남기되, 실제 배정은 AI로). `ask_timeout`이 설정돼 있고 `interactive: true`(v0.13.1이 실제로 쓰는
값이지만 이 필드 자체는 이 태스크가 만든다)여도 만료 시 같은 `default` 경로를 타되 `by: 'timeout'`
으로 기록한다.
**Pass bar:** `interactive: false`(기본)로 `ask`가 ready가 되자마자 `state: 'skipped'`,
`by: 'auto'`, `default_applied: true`로 즉시 전이함을 확인 — `waiting_human`으로 관측되는 창은 그
찰나뿐임을 두 번의 연속 `tm_next` 호출(중간에 아무 제출 없이)로 확인. `gate:human:spec`도 같은
방식으로 즉시 pass-through됨을 확인. `assignee: 'human'`인 TASK가 `interactive: false`에서 AI로
재배정됨을 확인(Task 3의 교차 벤더 규칙과 결합해 `test`가 non-human으로 가는지까지 한 번에 확인).
`ask_timeout: 100`을 준 픽스처에서(가짜 시계 또는 sleep) 만료 후 `by: 'timeout'`으로 기록됨을 확인.

- [ ] 1: `teamconfig.mjs`에 `ask_timeout` 실패 테스트, `taskmanager.mjs`에 위 네 가지 케이스의
  실패 테스트 작성.
- [ ] 2: `TEAM_DEFAULTS.ask_timeout: null` + `CHECK.ask_timeout` 추가. 자동 결정 로직 구현.
- [ ] 3: 테스트 통과 확인.
- [ ] 4: `git add teams/mcp/teamconfig.mjs teams/mcp/taskmanager.mjs teams/scripts/test-teamconfig.mjs teams/scripts/test-taskmanager.mjs && git commit -m
  "feat(teams): interactive:false auto-decides human seats on default and records it, ask_timeout resolved (§7)"`

---

### Task 5: 사람 대기 시 드라이버 종료 · `tm_answer` 시 재기동
**Files:** modify `teams/mcp/taskmanager.mjs` (`serviceLeader:1056-1072`, `leaderPrompt:1036-1045`),
modify `teams/scripts/test-taskmanager.mjs`
**Interfaces:** `interactive: true`(v0.13.1이 실제로 여는 값이지만, 이 태스크는 그 플래그 아래에서
드라이버가 어떻게 움직이는지의 **기계**를 만든다 — v0.13.1은 플래그를 켜는 것 자체만 추가한다)에서
사람 노드만 ready로 남으면, TaskLeader의 `manager.md` 루프는 `tm_next`가 그 노드를 `ready` 배열에
내주지 않으므로(Task 4가 SKIP 대신 진짜로 기다리게 두는 경로 — `waiting_human`으로 두고 SKIP하지
않음) 더 이상 할 일이 없어 스스로 종료한다 — `leaderPrompt`의 종료 조건 문구("until tm_status
reports complete or blocked")에 `waiting_human`을 추가한다. `serviceLeader`의 얼리 리턴 조건
(`taskmanager.mjs:1060`)에 `waiting_human`을 더해(`complete`/`blocked`/`waiting_human` 모두 자동
재기동 안 함) 일반 폴링(`tm_board`, `tm_status`)이 리더를 깨우지 않게 한다. **`tm_answer`(Task 6이
도구로 노출)의 핸들러만은 이 게이트를 우회한다**: payload를 park된 노드에 기록한 직후
`spawnLeader(task, {resume: true})`를 직접 호출한다(§0.4 발견 2) — `reset_capacity`가
`taskmanager.mjs:2068-2090`에서 이미 쓰는 것과 같은 모양(예산 소모 없는 즉시 재기동).
**Pass bar:** 가짜 드라이버로 `ask:1`이 ready가 됐을 때(`interactive: true`) 드라이버가 자연 종료
(exit code 0, `driver.alive === false`)함을 확인 — 살아서 대기하지 않는다(프로세스 목록에 없음).
그 상태에서 `tm_board`/`tm_status`를 두 번 호출해도 새 리더가 뜨지 않음을 확인(pid 불변). `tm_answer`
를 호출한 직후에는 새 리더 pid가 생김을 확인 — 재시작 예산(`task.leader.restarts`)이 소모되지
않았음을 확인(이것이 `reset_capacity`와 같은 "무료 재기동"임을 증명).

- [ ] 1: 실패하는 테스트 작성(위 세 가지 왕복 + 예산 미소모 확인). 이 태스크의 테스트는 실제 가짜
  드라이버 프로세스를 스폰해야 하므로 Task 9와 픽스처 구성을 공유할 수 있다 — 미리 만든다.
- [ ] 2: `leaderPrompt` 문구 수정, `serviceLeader` 게이트 확장, `tm_answer` 핸들러의 명시적
  `spawnLeader` 호출(Task 6과 함께 구현 — 이 태스크는 그 호출 지점을 만들고, Task 6이 도구 스키마와
  payload 기록 쪽을 채운다).
- [ ] 3: 테스트 통과 확인.
- [ ] 4: `git add teams/mcp/taskmanager.mjs teams/scripts/test-taskmanager.mjs && git commit -m
  "feat(teams): leader exits cleanly while only human nodes are ready, tm_answer respawns it for free (§7, §7b)"`

---

### Task 6: 도구 4개 — `tm_answer` / `tm_assign` / `tm_inbox` / `tm_log`
**Files:** modify `teams/mcp/taskmanager.mjs` (`TOOLS:1632`, `dispatch:2211`, `MUTATING_TOOLS:1076`,
새 핸들러 함수들), modify `teams/scripts/test-taskmanager.mjs`
**Interfaces:**
- `tm_answer({task_id, key, payload})` — Task 5가 만든 재기동 호출부에 payload 기록 로직을 채운다:
  `key`가 가리키는 `ask`/`gate:human`/human-TASK 노드에 `{state: 'done', by: 'user', answer:
  payload}`를 쓰고(SKIPPED로 이미 자동 결정된 노드를 다시 답하는 경우는 §7의 `redirect` — 이 단계
  범위 밖, 미구현으로 명시적으로 거부), `MUTATING_TOOLS`에 추가해 리더가 아닌 프로세스의 호출은
  inbox로 큐잉(`queueToInbox:1078`)되고 리더가 자기 `tm_next`에서 `drainInbox:1086`로 적용하게
  한다 — 단, Task 5의 명시적 `spawnLeader` 호출은 큐잉 여부와 무관하게 항상 일어난다(리더가 죽어
  있으면 respawn 자체가 곧 drain을 트리거한다).
- `tm_assign({task_id, key, vendor})` — `assignee` 필드를 사후에 바꾼다(shape가 이미 낸 TASK에).
  `MUTATING_TOOLS`에 추가.
- `tm_inbox({task_id})` — 읽기 전용. §7의 두 절("대기 중" / "대신 결정됨")을 반환: 전자는
  `waiting_human` 상태인 노드 목록, 후자는 `by: 'auto'` 또는 `by: 'timeout'`으로 SKIPPED된 노드
  목록(§4 §주2가 지금까지 "코드 경로 자체가 없다"고 적어 둔 자리를 여기서 처음 채운다).
- `tm_log({key, tail?})` — 읽기 전용. `key`가 가리키는 dispatch의 `child.driver.log`(이미 있는
  필드, `docs.mjs`의 `renderStory`가 이미 읽는 것과 같은 자리, `docs.mjs:158`) 파일의 꼬리
  `tail`줄(기본 50)을 반환 — §11이 "§8이 약속했지만 §11의 어느 행에도 없는 드라이버 로그 꼬리
  도구"라고 부른 자리.
**Pass bar:** `tm_answer` 왕복 테스트(park된 `ask`에 답하면 `done`으로 전이하고 다음 노드가 열림),
non-leader 프로세스에서 호출 시 inbox에 큐잉됨을 파일 존재로 확인. `tm_assign`이 TASK의 `assignee`를
바꾸고 다음 라우팅에 반영됨을 확인. `tm_inbox`가 "대기 중"/"대신 결정됨" 두 절을 올바르게 채움을
표 테스트로 확인(Task 4가 만든 SKIPPED 노드들로). `tm_log`가 실제 로그 파일의 마지막 N줄만 반환함을
확인(전체를 올리지 않음 — "payload를 main에 올리지 않는다" 원칙의 로그 버전).

- [ ] 1: 실패하는 테스트 작성(네 도구 각각 + inbox 큐잉 왕복).
- [ ] 2: 네 핸들러 구현, `TOOLS`/`dispatch()`/`MUTATING_TOOLS`에 등록.
- [ ] 3: 테스트 통과 확인.
- [ ] 4: `git add teams/mcp/taskmanager.mjs teams/scripts/test-taskmanager.mjs && git commit -m
  "feat(teams): tm_answer/tm_assign/tm_inbox/tm_log - the tools a human executor needs (§6, §8)"`

---

### Task 7: `docs.mjs` — `15-spec-gate.md` + report의 "자동 결정 N건" 절
**Files:** modify `teams/mcp/tickets.mjs` (`docPaths:27-44`에 `specGate` 키 추가), modify
`teams/mcp/docs.mjs` (새 `renderSpecGate`, `renderReport:183-189` 확장, `renderAll:194` 확장),
modify `teams/scripts/test-docs.mjs` + golden 픽스처 확장
**Interfaces:** `docPaths(task).specGate = join(base, '15-spec-gate.md')`. `renderSpecGate`는
`gate:human:spec` 노드가 있을 때만(없으면 `renderAll`이 이 파일을 만들지 않는다 — 기존 원칙) 누가
(`by: 'user' | 'auto'`) 언제 무엇을(critique 요약 링크) 승인·반려했는지를 렌더한다.
`renderReport`는 `task.nodes.filter(n => n.by === 'auto' || n.by === 'timeout')`의 개수를 세어
"자동 결정 N건" 절을 report 본문 뒤에 덧붙인다(§7c "보고서(`report`)에도 '자동 결정 N건' 절이
붙는다"를 처음 구현).
**Pass bar:** golden 파일 비교 — `gate:human:spec`이 SKIPPED로 자동 결정된 픽스처에서
`15-spec-gate.md`가 렌더되고 "auto"로 표시됨을 확인, `tm_docs({rebuild:true})`가 동일 바이트를
재생산함을 확인(v0.11.0부터 이어진 불변식). `ask`가 둘 자동 결정된 픽스처에서 `80-report.md`에
"자동 결정 2건" 절이 나타남을 확인. `gate:human:spec`이 없는(human_gates 꺼짐) 픽스처에서
`15-spec-gate.md`가 만들어지지 않음을 회귀로 확인 — §7c의 13종 문서가 이 태스크로 **13/13** 전부
자리를 갖는다(v0.12 라인이 12/13까지 닫아 뒀던 마지막 한 종).

- [ ] 1: `test-docs.mjs`에 `15-spec-gate.md` golden 실패 테스트, report의 "자동 결정" 절 실패
  테스트 작성.
- [ ] 2: `docPaths`에 `specGate` 추가, `renderSpecGate` 구현, `renderReport` 확장, `renderAll`에
  조건부 추가.
- [ ] 3: golden 파일 생성 후 §7c 형식과 어긋나지 않는지 확인(v0.12.0 Task 6과 같은 절차).
- [ ] 4: 테스트 통과 확인.
- [ ] 5: `git add teams/mcp/tickets.mjs teams/mcp/docs.mjs teams/scripts/test-docs.mjs teams/scripts/fixtures/docs-golden && git commit -m
  "feat(teams): 15-spec-gate.md and the report's decided-for-you section - §7c's last document (§7, §7c)"`

---

### Task 8: 명령 스킬 4개 — `answer` / `take` / `inbox` / `log`
**Files:** create `teams/skills/answer/SKILL.md`, `teams/skills/take/SKILL.md`,
`teams/skills/inbox/SKILL.md`, `teams/skills/log/SKILL.md`
**Interfaces:** `board`/`ticket`(`teams/skills/board/SKILL.md`)과 같은 두께 — frontmatter
(name/description/scenarios/compatibility/related) + Process(인자 하나 받아 도구 하나 호출) +
Output Template(도구가 실제로 반환하는 필드만) + What Claude Does / What You Do + Related Skills.
`/teams:answer E-xxx/ask:1 '{...}'` → `tm_answer`, `/teams:take E-xxx/P2/U1` → `tm_assign({vendor:
'human'})`(자기 자신을 담당으로 지정하는 것도 `tm_assign`의 특수 케이스로 문서화 — 새 도구 아님),
`/teams:inbox` → `tm_inbox`, `/teams:log E-xxx/P2` → `tm_log`.
**Pass bar:** 스킬 `SKILL.md`의 Output Template이 Task 6의 실제 도구 반환 필드와 일치함을 수작업
대조(스킬은 자동 테스트 대상이 아니다 — `board`/`ticket`도 그렇다). 4개 스킬 각각이 `related`에
`board`/`ticket`을 상호 참조함을 확인.

- [ ] 1: `answer`/`take`/`inbox`/`log` 네 `SKILL.md` 작성 — `board`의 frontmatter·절 구조를 그대로
  따른다.
- [ ] 2: Task 6의 실제 도구 스키마와 대조해 Output Template 필드를 맞춘다.
- [ ] 3: `git add teams/skills/answer teams/skills/take teams/skills/inbox teams/skills/log && git commit -m
  "feat(teams): answer/take/inbox/log command skills, thin like board and ticket (§8)"`

---

### Task 9: 가짜 드라이버 테스트 — 사람 대기/재개
**Files:** modify `teams/scripts/test-taskmanager.mjs` (Task 5가 마련한 가짜 드라이버 픽스처
확장)
**Interfaces:** §11이 이 단계의 검증 방식으로 스스로 지정한 것 — 0.8.0 방식의 실제 자식 프로세스
스폰(문자열로 하드코딩한 스크립트가 아니라 `teams/scripts/test-taskmanager.mjs:1304-1361` 근방의
기존 fake-driver 패턴 재사용)으로 "사람 대기 → park → 답변 → 재기동" 전체 왕복을 엔드투엔드로
검증한다. Task 1–6 각각의 표 테스트는 단위 검증이고, 이 태스크는 그것들이 실제 프로세스 경계를
넘어도 맞물리는지 보는 통합 시험이다.
**Pass bar:** 표 — (1) `ask`가 ready → 가짜 드라이버가 그것을 만나 아무것도 못 하고 종료(exit 0) →
`tm_status`가 `waiting_human` 보고 → `tm_answer` 호출 → 새 드라이버 pid 생성 → 그 드라이버가
`shape`까지 진행. (2) `gate:human:spec`도 같은 왕복. (3) `interactive: false`에서는 이 전체가
관측 가능한 찰나(연속 두 `tm_next` 사이)로 줄어들고 드라이버가 아예 안 죽고 이어감(SKIP이 즉시
적용되므로) — 이 세 번째 행이 Task 4·5의 경계가 맞물리는지 보는 회귀다.

- [ ] 1: 위 표의 세 행을 각각 실패하는 통합 테스트로 작성.
- [ ] 2: 필요하면 Task 1–6에서 놓친 이음매를 고친다(이 태스크 자체는 새 프로덕션 코드를 목표하지
  않지만, 통합 시험이 처음으로 드러내는 결함은 흔하다 — v0.11.0 자기 검토가 그런 결함 2건을 여기서
  잡았던 전례를 따른다).
- [ ] 3: `node --test teams/scripts/test-*.mjs` 전부 통과 확인.
- [ ] 4: `git add teams/scripts/test-taskmanager.mjs && git commit -m
  "test(teams): fake-driver table test for the human wait/resume round trip (§11)"`

---

### Task 10: 릴리스 0.13.0
**Files:** modify `teams/.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`(teams
항목만), `teams/README.md`, `teams/KOR.md`
**Interfaces:** consumes Task 1-9 전부.
**Pass bar:** `node --test teams/scripts/test-*.mjs` 전부 통과(회귀 0), `python3
scripts/validate_plugins.py` ERROR 0, 두 매니페스트 0.13.0 일치, README·KOR Status 첫 항목이
v0.13.0.

- [ ] 1: `git fetch skills main && git status -sb` — origin이 앞서 있으면 rebase.
- [ ] 2: `node --test teams/scripts/test-*.mjs 2>&1 | tail -8` → `# fail 0` 확인.
- [ ] 3: patch 범프: teams 현재 버전 → `0.13.0`; marketplace description에 "Adds human as a graph
  executor - ask/gate:human:spec nodes and assignee:human pins always exist; with interactive
  off (default) they auto-decide on default and record it. tm_answer/tm_assign/tm_inbox/tm_log
  land, and WAITING_USER becomes reachable. Stopping to actually wait on a person ships in
  v0.13.1." 추가.
- [ ] 4: README/KOR `## Status` 맨 위에 한 줄 prepend(기존 내용은 그대로 아래에 둔다).
- [ ] 5: 설계 문서(`docs/plans/2026-09-17-teams-team.md`) §11의 v0.13.0 행을 "완료"로 표시하는
  것은 이 계획 파일 소유가 아니다 — 팀 리더나 그 갱신을 맡은 agent의 몫.
- [ ] 6: `python3 scripts/validate_plugins.py` ERROR 0 확인.
- [ ] 7: `git add teams/.claude-plugin/plugin.json .claude-plugin/marketplace.json teams/README.md teams/KOR.md && git commit -m
  "feat(teams): 0.13.0 - human as an executor (auto-decide side): ask/gate:human/assignee seats, tm_answer/tm_assign/tm_inbox/tm_log, WAITING_USER"`
- [ ] 8: `git push skills main`(실패하면 1번으로 돌아가 fetch·rebase 후 재시도).

---

## 자기 검토

- **§0.1의 Task 1/Task 5 분리가 이 계획 전체의 위험 관리 축이다.** 사이징 문서 §4.2가 경고한 "12
  이상으로 번질 위험"은 실제로 존재한다 — 이 계획은 그 확산을 Task 5 하나에 몰아넣고 나머지 아홉
  태스크를 순수 파생/구성/도구로 좁게 유지하는 전략을 택했다. Task 5가 예상보다 커지면(예: 드라이버가
  여러 인스턴스에서 동시에 종료·재기동 경쟁 상태에 놓이는 경우가 발견되면) 이 계획의 11이 12로 넘어갈
  첫 후보는 Task 5다.
- **§0.4 발견 3(`human_scope: 'all'` 미완주)은 팀 리더가 다르게 볼 수 있는 판단이다.** 이 계획은
  "leader 스코프만 완전히 검증"을 택해 11 unit을 지켰지만, 사용자가 애초에 `human_scope: 'all'`을
  기대하고 있었다면 이 계획은 그 기대를 충족하지 못한 채 릴리스한다 — v0.13.1이나 별도 패치로
  미뤄야 한다는 뜻이고, 이 계획은 그 미룸을 §2("v0.13.0이 하지 않는 것")에 명시했다.
  `'all'`이더라도 구조(`waiting_human` 상태, `runState` 파생)는 이미 범용이라 나중에 얹기가
  `role` 필드를 나중에 빼는 것 같은 어려운 일은 아니다 — 되돌리기는 쉬운 쪽이다.
- **§0.4 발견 2(`tm_answer`의 즉시 재기동)는 이 계획이 새로 설계한 다리다.** `reset_capacity`와
  "같은 모양"이라고 주장했지만, `reset_capacity`는 `tm_retry`라는 이미 있는 도구의 옵션이고
  `tm_answer`는 이 계획이 신설하는 도구다 — 유사성은 코드 재사용이 아니라 설계 유추다. 다른 사람이
  이 지점을 다르게(예: `tm_answer`도 폴링을 기다리는 쪽으로) 구현하면 Task 5·6·9 셋 다 다시 써야
  한다.
- **`ask`/`gate:human`이 "TaskLeader 관리 노드"라는 §0.2의 해석은 phase-Team(합성 패키지) 패턴과
  의도적으로 다르다** — 다른 읽기(child-run에도 `ask` kind를 만든다)를 택하면 `graph.mjs`의
  `KINDS`/`FLOWS`에 새 항목이 필요해지고 Task 2가 최소 +1 unit 커진다. 이 계획은 설계 문서 §7의
  표가 "TaskLeader가 삽입"이라고 명시한 것 하나만 근거로 좁게 읽었다 — 옅은 근거다, 팀 리더가
  다르게 볼 여지를 남긴다.
- **파일 충돌이 v0.12.0과 비슷한 비율이다**: 10개 태스크 중 5개가 `teams/mcp/taskmanager.mjs`를
  건드린다. Task 3만 완전히 독립적으로 병렬 가능 — v0.12.0보다 나은 점은 이 하나뿐이다.
- **Task 8(명령 스킬)의 "1"은 `board`/`ticket`(2개에 1)보다 낮은 비용으로 4개를 처리한다는
  전제 위에 있다** — 근거는 "인자 하나 받아 도구 하나 부르는 더 얇은 스킬"이라는 주장인데, 실제로
  `SKILL.md`를 써 보면 `tm_inbox`의 "대기 중/대신 결정됨" 두 절 렌더링처럼 `board`보다 서술이 많이
  필요한 스킬이 섞여 있을 수 있다 — 이 하나가 이 계획에서 가장 근거가 약한 사이징이다. 넘치면
  Task 8을 2로 올리고 합계가 12가 된다(여전히 §4.2 경계 안).
