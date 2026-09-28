# teams — 가벼운 PLAN 모드 (검토용 초안)

> 상태: **검토용**. 코드 변경 없음. 2026-09-28.
> 선행: `2026-09-21-teams-server-owns-the-loop.md` §8g~8i (PLAN 하네스 도입, investigate 스테이지 신설),
> `2026-09-23-teams-reducer-human-rollback.md` (ask 경로, reducer, 이 문서가 다시 쓰는 `human_scope`).
> 대상: `roles.planning`이 이미 기본 켬인 지금, PLAN이 **필요 없는 게 아니라 무겁게 필요한** 경우를 가른다.

## 0. 왜 — PLAN은 동작하지만, 이미 완성된 백로그에도 전액을 청구한다

PLAN 하네스는 idol-pm 4판을 거쳐 실제로 report까지 완주하는 것이 검증됐다(09-21 문서 §8g~8i). 그런데 그 검증은 전부 "무엇을 지을지 모르는" 요청(그린필드 도메인 설계)이었다. `teams:sprint`가 다루는 다른 절반 — **이미 acceptance criteria를 든 백로그**(리팩터·버그수정·"이 스킬을 저 스킬 수준으로 맞춰라" 같은 항목별 요청) — 에도 같은 4단 체인(`investigate → draft → revise → gate`)이 무조건 걸린다. `teams/skills/sprint/SKILL.md` 1단계(커밋 `77462db`)가 이미 이 문제를 알아 사용자에게 `roles: {planning: false}`를 권하는 것으로 넘어갔다 — 그러나 그건 전부-아니면-전무 스위치이고, 끄면 PLAN이 잡던 것(오전제, 기준 불균등)도 같이 잃는다.

### 실측 — `teams-log-portfolio-refresh-80ec931a`

요청: `portfolio/skills/*` 8개를 `portfolio-feedback`(1.13-1.14) 수준으로 맞추는 스프린트. `request.txt`가 이미 8항목 백로그 + 항목마다 동일하게 적용되는 공유 "Acceptance for every item:" 블록(6개 규칙)을 명시했다.

| 노드 | 시간 |
|---|---|
| plan | 2m00 |
| setgoal | 56s |
| critique | 1m21 |
| **investigate** | **4m03** |
| **draft** | **2m22** |
| **revise** | **1m49** |
| gate | 49s |
| gate:goal | 2m01 |
| report | 30s |
| **합계** | **16.9분 / 전체 70분, $3.39** |

노드별 시간은 `dispatch_PLAN_1.stream.jsonl`(`raw/task/drivers/`)의 `result` 라인에서 확인(`total_cost_usd: 3.3905032`, `duration_api_ms: 564936` — 위 표와 정합). investigate+draft+revise가 시간의 약 49%다.

**PLAN이 실제로 값을 냈다는 증거도 같은 판에 있다** — `archive/nodes/root/0bfa5553.../report.df30472c.json`의 `result.handoff`:
- 공유 규칙 R1-R9를 항목마다 분해해 각자 사이트 적용 여부를 적었다(예: `[확정]` 원장은 다회성 세션이 있는 스킬 셋에만, 경계값 규칙은 `portfolio-pattern`에만 — `jd`/`company`는 N/A로 명시).
- 요청문의 전제 2건을 정정했다: "5/8은 08-30 이후 미개정"이라는 요청 전제와 달리 `portfolio-rewrite`(08-31)·`portfolio-pattern`(09-01)은 그 직전이고, `portfolio-jd`(09-10)는 이미 부분 개정 상태였다.
- Open Questions 15건, 전부 소유자와 함께.

즉 두 개의 다른 백로그를 하나의 체인으로 처리하고 있다: **조사가 필요한 백로그**(그린필드, idol 케이스)와 **이미 완성된 acceptance criteria를 배분·검증만 하면 되는 백로그**(portfolio-refresh 케이스). 후자에 `draft`(자유 작성)와 `revise`(퇴고)를 온전히 태우는 것은, 이미 있는 문장을 R1-R9로 분해해 다시 쓰는 데 4m11(투자시간의 25%)을 쓰는 것이다.

## 1. 진단

1. **감지가 없다.** `roles.planning`은 `true`/`false` 둘뿐이고 무엇이 켜는가는 사람이 판단해 스프린트 호출 시점에 정한다(`sprint/SKILL.md` 1단계). 백로그가 어떤 종류인지 엔진은 보지 않는다.
2. **체인이 이분법이다.** 켜면 4단 전부, 끄면 0단. "criteria는 있는데 오전제·불균등 여부는 확인해야 한다"는 중간 지대가 없다.
3. **investigate는 버릴 수 없다.** idol 케이스가 증명한 것(09-21 §8i) — draft/revise/gate만 있는 3단 체인은 브리핑 밖을 전혀 못 본다. investigate가 없으면 오전제 정정도, "사람만 아는 결정"을 ask로 올리는 것도 사라진다. 아래 §3(전용 절)에서 다루듯, **PLAN이 사람에게 묻는 유일한 자리이기도 하다** — 가벼워져도 여기는 지킨다.
4. **draft+revise가 겹치는 작업을 한다.** 이미 acceptance criteria가 있는 백로그에서 draft는 "쓰기"가 아니라 "배분"이고, revise는 "고치기"가 아니라 "검증"이다 — 둘 다 gate가 이미 하는 일과 겹친다.

## 2. 결정

### 2.1 감지 규칙 — 모델 판단이 아니라 구조 검사

"백로그가 이미 acceptance criteria를 들었다"를 다음 결정론적 검사로 정의한다(둘 중 하나면 참):

- **(a) 구조화 입력.** `tm_open`이 `requests[]`의 각 항목에 `acceptance: string[]`(비어있지 않음) 필드를 받거나, 백로그 전체에 적용되는 `shared_acceptance: string[]`을 받는다. 전부 채워져 있으면 `has_declared_acceptance = true`. 이것이 유일한 신뢰 가능한 경로다 — 앞으로 `tm_open` 호출자(스킬·CLI)가 이 필드를 채우도록 유도한다.
- **(b) 회귀 파서(현행 호환).** 지금처럼 자유 텍스트 `request`로 들어오는 백로그(이번 실측 판이 그 예)를 위해, `request` 문자열에 번호 매긴 백로그 목록과 그 아래 `/^Acceptance( for every item)?:?/im` 헤딩 + 불릿 목록이 함께 있으면 참으로 본다. 이건 자연어 이해가 아니라 고정 정규식 구조 매칭이다 — `boxedBacklog` 판정(`taskmanager.mjs:445-446`)이 이미 "`requests[].length > 1` + box 존재"라는 구조 신호만으로 size를 pin하는 것과 같은 성격의 검사다.

두 경로 다 실패하면(백로그 항목에 criteria가 없거나 항목마다 다르게 적혀 파서가 못 미더우면) `has_declared_acceptance = false` — 전체(full) 체인으로 간다. **애매하면 무거운 쪽.**

### 2.2 light 모드가 도는 것 — investigate는 그대로, draft+revise만 접는다

§1-3, §3(아래 신설 절)의 요구대로 investigate를 없앨 수 없으므로, 검토했던 두 후보 중 **두 번째를 택한다**: `plan → gate`만 도는 안(investigate째 제거)은 기각. 대신:

```
KINDS.planning        (현행, full)  investigate → draft        → revise       → gate
KINDS.planning-light   (신설, light) investigate → template-fill →              gate
```

- **investigate — 그대로, 전체 계약 유지.** 소스를 읽고 findings/unknowns/checks를 낸다(`prompts.mjs:124`). `unknowns[]`가 `ask`로 올라가는 유일한 경로이므로(그래프상 `openAsk`는 investigate가 낸 `questions`/`unknowns`만 소비) 손대지 않는다.
- **template-fill (신설, 결정론적 조립 + 짧은 모델 호출 1회) — draft+revise 대체.** 백로그 원문의 항목별(또는 공유) acceptance criteria를 `requests[]` 순서대로 그대로 문서 절로 옮기고, investigate의 findings를 각 항목 옆에 인용으로 붙이고, unknowns를 Open Questions로 그대로 넣는다. "새로 쓰기"가 아니라 "이미 있는 문장을 옮겨 붙이고 출처를 단다"이므로 draft의 창작 권한도 revise의 퇴고 권한도 필요 없다 — 한 번의 모델 호출로 조립과 자체 점검(§2.3 항목 누락·중복 여부)까지 같이 시킨다.
- **gate — 그대로, 계약 확장.** 기존 gate 계약(`match_pct`, `gaps`)에 light 전용 요구 두 개를 얹는다: 매핑 완전성(백로그의 모든 항목이 문서에 나타나는가, R-번호가 항목마다 실제로 적용됐는가)과 investigate의 unknowns 유실 여부(조사가 낸 unknown이 문서의 Open Questions에서 사라지지 않았는가).

### 2.3 gate가 여전히 잡아야 하는 것

- **오전제.** investigate가 그대로 있으므로 여기서는 안 잃는다 — light 모드가 잃을 위험은 이게 아니라 아래.
- **기준 불균등.** template-fill이 "옮겨 붙이기"이므로, 항목 하나가 공유 기준 중 일부를 빠뜨리고 옮기는 실수(사람이 손으로 복붙해도 나는 실수)를 gate가 항목별 R-번호 커버리지 표로 확인한다 — 이번 실측 판의 `report.df30472c.json`이 이미 "individually verified (not via OR-alternation grep)"라고 적어 둔 검사를 gate 계약에 명문화하는 것뿐이다.
- **draft가 잡던 창작 오류는 애초에 없다.** template-fill은 창작하지 않으므로 revise가 잡던 부류(09-25 §0.2d의 "재표현" 문제 등)가 구조적으로 발생하지 않는다 — 새로 잃는 안전판이 아니라 필요 없어진 안전판이다.

### 2.4 측정

같은 백로그를 두 번 돌린다(full 강제 vs light 강제, `roles.planning: true` vs `roles.planning: 'light'`):
- **벽시계/비용** — 이번 실측 기준 기대치는 draft+revise 4m11(≈25%) 절감. investigate를 지키는 대가로 §8g~8i가 준 49%(investigate+draft+revise)가 아니라 그 중 draft+revise 몫만 접힌다는 것을 그대로 보고한다 — 부풀리지 않는다.
- **하류 판정 동일성** — 같은 백로그로 연 패키지들의 `accept:Pn`/`gate:goal` 판정(accept 여부, match_pct, gaps)이 두 arm에서 갈리는지. 갈리면 light가 실제로 뭔가를 놓친 것이므로 그 gap을 §2.3 항목으로 승격한다.
- **성공 기준** — 하류 판정이 동일하면서 시간·비용만 줄면 light 승인. 하나라도 하류 판정이 달라지면(특히 accept가 light에서만 통과) light를 보류하고 원인을 gate 계약 추가 항목으로 흡수될 수 있는지부터 본다.

### 2.5 설정 표면

```
roles.planning: true | false | 'light' | 'auto'   (기본값 변경: true → 'auto')
```

| 값 | 동작 | 비고 |
|---|---|---|
| `true` | 현행 full 체인 그대로(하위호환 별칭) | 명시적으로 설정한 기존 `team.json`은 그대로 동작 |
| `false` | PLAN 생략, `shape`가 원문을 직접 읽음(현행) | 안전판을 통째로 포기하는 명시적 선택으로 유지 — auto가 자동으로 고르지 않는다 |
| `'light'` | §2.2의 축소 체인 강제 | 사람이 백로그가 가볍다는 걸 이미 아는 경우 |
| `'auto'` (신 기본값) | §2.1 감지 결과로 `'light'` 또는 `true`(full) 중 선택 | **`false`는 절대 자동 선택하지 않는다** — 안전판 제거는 항상 명시적 결정이어야 한다(§14 결정 기록 #3 "기획 뒤 `gate:human:spec` 기본 켬"과 같은 원칙: 자동화가 검증 단계 자체를 지우지는 않는다) |

## 3. 단계

1. `tm_open`에 `requests[].acceptance`/`shared_acceptance` 구조화 필드 추가(§2.1a). 없으면 회귀 파서(§2.1b)로 폴백.
2. `graph.mjs`의 `KINDS`에 `planning-light`(또는 `planning` kind에 `chain` 분기) 추가 — §2.2.
3. `taskmanager.mjs` PLAN 게이팅(현재 `roles.planning` 진위값 하나로 `nodes: T.roles.planning ? [...] : [...]` 분기, ~`taskmanager.mjs:544-551`)을 문자열/유니온 값으로 확장하고 `'auto'` 판정 로직을 그 자리에 건다.
4. `CONTRACT.gate`(planning kind 전용)에 §2.3 두 항목 추가.
5. `teamconfig.mjs`의 `TEAM_DEFAULTS.roles.planning` 기본값을 `true`→`'auto'`로(§2.5) — 이건 무설정 호출자의 실제 동작을 바꾸므로 별도 결정 기록에 남긴다.
6. §2.4 측정 — 같은 백로그 두 arm. 이 실측 판(portfolio-refresh-80ec931a)을 그대로 재실행하는 것이 가장 싼 첫 표본이다(이미 결정론적 감지 규칙이 §2.1b로 이 판을 `has_declared_acceptance=true`로 잡는다는 것부터 확인).
7. §4(아래 신설 절)의 `task.decisions` — light/full 어느 쪽이든 PLAN이 낸 결정을 실행 단계로 넘기는 배선은 공유한다. 1-6과 독립적으로 진행 가능.

## 4. 반론과 리스크

- **"파서가 실제 백로그 포맷 변주를 못 따라간다."** 그래서 §2.1의 우선순위가 (a) 구조화 입력이다 — 회귀 파서(b)는 호환용이지 권장 경로가 아니다. 파서가 놓치면 `has_declared_acceptance=false`로 떨어져 full로 가므로, 실패 방향이 안전 쪽(더 무거운 체인)이다.
- **"template-fill의 '한 번의 모델 호출'도 결국 모델이 빠뜨릴 수 있다."** 맞다 — 그래서 gate가 여전히 전체 판정권을 갖는다(§2.2). light가 접는 것은 draft/revise라는 *별도 스테이지*지, gate라는 *검증*이 아니다.
- **"25%는 크지 않다. 왜 이 복잡도를 들이나."** 이번 표본 하나로는 크지 않다. 값은 스프린트당 반복되는 백로그 케이던스에서 나온다 — `teams:sprint`가 반복 호출되는 워크플로우라는 전제(같은 SKILL.md가 "매 스프린트 이 결정을") 위에서, 매번 25%를 아끼는 것과 매번 사람이 `roles.planning:false`를 판단해 안전판 전체를 끄는 것 중 하나를 택하는 문제다.
- **"'auto'가 오판하면(가벼운 백로그를 full로, 또는 무거운 백로그를 light로 보내면) 어떻게 아나."** 오판의 두 방향이 다르다 — light인데 full로 보내는 오판은 비용만 낭비(안전), full이 필요한데 light로 보내는 오판이 진짜 리스크다. §2.1의 감지가 "애매하면 무거운 쪽"으로 설계된 이유가 이것이다.

## 5. 열린 논점

1. §2.1b 회귀 파서의 정확한 정규식·구조 규칙 — 이 문서는 방향만 정한다. 구현 시 실제 백로그 표본 여러 개(idol류·portfolio류·code-sprint류)로 오탐/누락률을 재야 한다.
2. `'light'` kind 이름을 `KINDS.planning`의 새 필드(`chain_light`)로 할지 별도 kind(`planning-light`)로 할지 — reducer 레지스트리(`reducers.mjs`)가 kind 문자열로 병합 규칙을 찾으므로(09-23 문서 §5) 이름 선택이 그쪽에도 영향을 준다. 구현 세션에서 결정.
3. §2.4 측정에서 하류 판정이 갈리는 사례가 나오면 light를 얼마나 더 보수적으로 만들지(예: template-fill 뒤에 draft 없는 추가 검증 스테이지를 하나 더 넣을지) — 측정 전에는 답할 수 없다.

## 6. 기획에서 묻고, 실행은 묻지 않는다 — 결정을 앞으로 당긴다

### 6.1 확인한 사실 (코드)

- `answeredDecisions(run, owner)`(`graph.mjs:1052`)는 **`run.nodes`만** 순회한다 — `run`은 그래프 하나(=자식 런 하나)의 인메모리 상태다. PLAN도 P1..Pn도 각자 자기 `openChild`(`taskmanager.mjs:2504`)로 열린 **별개의 자식 런**이고, 따라서 별개의 `run` 객체다.
- `openAsk`(`graph.mjs:1069`)는 같은 owner의 "이미 답한 질문"을 걸러낼 때 `answeredDecisions(run)`만 쓴다(`graph.mjs:1085`) — 같은 런 안에서만 걸러진다. idol-beta-ask1(09-23 문서 §0.2d)이 실측한 바로 그 버그(재시도가 폐기한 `ask` 노드는 `upstream` 범위 밖이라 무엇이 정해졌는지 새 시도가 알 방법이 없었다)의 **런-간 버전**이 지금 구조에 그대로 남아 있다 — 그때는 같은 런 안의 "시도 간"이었고, 지금 문제는 "런 간"(PLAN과 P1..Pn)이다.
- `nodeBriefing`의 `prior_decisions`(`graph.mjs:1747-1748, 1843`)과 `default_decisions`(`graph.mjs:1851-1855`, 기반은 `run.unasked` — `broker.mjs:1287/1312`가 채운다)도 전부 같은 `run` 스코프.
- `childContext(task, pkg)`(`taskmanager.mjs:1955`)가 패키지 자식 런에 넘기는 컨텍스트를 다 읽었다 — PLAN의 PRD 산출물(문서 프로즈), package acceptance(shape가 한 번 파생), critique 메모는 있지만, **PLAN의 ask 노드가 답한 결정을 구조화된 "이미 정해짐" 목록으로 넘기는 자리는 없다.** 패키지의 investigate는 그 결정을 findings로 우연히 다시 발견하거나, 못 찾으면 다시 묻는다 — idol-beta-ask1이 한 런 안에서 겪은 실패(형제 서브골이 같은 질문을 각자 물음)가 런 경계에서는 구조적으로 항상 일어난다.
- 대조로, **매니저(EPIC) 레벨 판정 노드**(`shape`/`critique`/`accept`/`integrate`/`gate`/`gate:goal`)가 낸 `questions[]`는 이미 `task.unasked`(`taskmanager.mjs:3719-3740`)로 쌓인다 — 그러나 이건 그 노드들 자신의 질문이지, PLAN이라는 *자식 런 내부*의 질문이 아니다. 즉 지금 있는 것은 "매니저 노드 질문의 task-레벨 회수"이지 "자식 런 질문의 task-레벨 회수"가 아니다. 이 문서가 추가하는 것은 후자다.
- `human_scope`는 여전히 설계뿐이다(`teamconfig.mjs:15`: "`human_scope` remains only design").

### 6.2 결정

1. **`task.decisions[]` 신설.** PLAN 패키지의 `accept:PLAN`이 끝나는 시점(`foldChild`가 이미 PLAN 자식 런의 완결된 `run.nodes`를 쥐고 있는 바로 그 지점)에, PLAN 자식 런 자신의 `answeredDecisions(planRun, undefined)`(모든 owner) + `planRun.unasked`(비대화형이면 기본값으로 결정된 것들)를 합쳐 `{question, chose, owner, decided_in: 'PLAN', source: 'ask'|'default'}` 형태로 정규화해 `task.decisions`에 쓴다. 한 번만 쓴다 — PLAN은 accept 이후 다시 열리지 않는다.
2. **모든 패키지 자식 런이 `task.decisions`를 받는다.** `childContext`(`taskmanager.mjs:1955`)에 새 블록을 추가한다: "Decided already — settled, write as rules, not open questions"(0.28.0의 `ask` 답변이 draft 브리핑에 도착하던 문구와 같은 어조, §0.2b). 배선은 `openChild`(`taskmanager.mjs:2504`, `context: childContext(...)` at 2602)가 `run.task_decisions`(가칭)로 자식 런 객체에 심고, `openAsk`(`graph.mjs:1085`)의 걸러내기 집합을 `answeredDecisions(run) ∪ (run.task_decisions || [])`로 넓힌다 — `graph.mjs` 자신은 `task`를 모르므로 이 필드는 자식 런 생성 시점에 값으로 주입해야 한다(참조가 아니라 스냅샷 — PLAN이 그 뒤 다시 안 열리므로 스냅샷으로 충분하다).
3. **실행 단계의 새 질문은, `interactive: true`여도, 기본적으로 막지 않는다.** 패키지의 investigate가 `task.decisions`에 없는 새 질문을 내면 — 지금의 비대화형 기본 결정 경로(`decide_by_default`, `graph.mjs:1850`)와 같은 방식으로 기본값 채택 + `run.unasked`에 기록(`decided`)한다. 예외: **blocking**으로 표시된 질문. blocking의 정의(구조 검사, 모델 판단에 기대지 않음):
   - (a) 그 질문의 investigate 계약 응답에 `contradicts_decision: "<task.decisions의 question 텍스트>"`가 채워져 있음 — 즉 investigate 스스로 "이건 이미 정해진 것과 충돌한다"고 구조화된 필드로 신고한 경우만 인정한다(자유 서술 안에서 눈치채는 것에 기대지 않는다).
   - (b) `openAsk`가 이미 쓰는 것과 같은 필터(`graph.mjs:1072`)를 **뒤집어** 씀 — `options.length`가 1 이하이고 `default`도 없는, 즉 안전하게 기본값을 고를 수 없는 질문. (지금은 이 경우 `openAsk`가 조용히 버린다(`qs.filter(...)` 뒤 빈 배열이면 `return []`, `graph.mjs:1073`) — 실행 단계에서는 버리는 대신 승격한다.)
4. **blocking 질문은 패키지가 아니라 EPIC에서 한 번만 선다.** owner를 패키지의 subgoal_id가 아니라 task 자신의 판정 노드처럼 다룬다 — `openAsk`가 subgoal 없는 노드에 이미 쓰는 fallback(노드 자신의 id를 owner로, `graph.mjs:1040-1041`)과 같은 패턴을, 패키지 layer가 아니라 task layer의 `openAsk(task, ...)`(이미 매니저 질문에 쓰는 바로 그 함수, `taskmanager.mjs:3731`)로 올린다. 카드 하나가 여러 패키지의 같은 질문을 대표하도록 후속 패키지의 같은 blocking 질문은 §2.1 스타일 정확 일치로 억제한다.

**§14 결정 기록에 추가할 제안 행(이 문서는 §14를 직접 고치지 않는다 — 다음에 그 문서를 여는 사람이 옮겨 적을 텍스트만 여기 남긴다):**

> | 18(제안) | **PLAN의 ask 결정이 실행 패키지로 전파된다.** `task.decisions[]`(PLAN accept 시점에 1회 기록) → 모든 패키지 자식 런의 `openAsk` 걸러내기 집합에 합류. 실행 단계의 새 질문은 `interactive`와 무관하게 기본값으로 결정되고 기록되며, `task.decisions`와 구조적으로 모순되거나(`contradicts_decision` 필드) 안전한 기본값이 없는 경우만 EPIC 레벨에 1회 park한다. **`human_scope`(`leader`/`all`, 미구현)를 대체한다** — 사람이 언제 불려가는지는 이제 "리더냐 전부냐"가 아니라 "PLAN이냐 실행이냐 + blocking이냐"로 갈린다 | §4 childContext, graph.mjs openAsk, taskmanager.mjs task.decisions |

### 6.3 light 모드와의 상호작용

§2.2가 정한 light 체인(`investigate → template-fill → gate`)은 §6.2를 그대로 지지한다 — investigate를 보존하는 이유가 애초에 "이 문서가 PLAN을 사람에게 묻는 유일한 자리로 쓴다"는 것이었다. light가 draft/revise만 접고 investigate를 지키므로, `unknowns[]`→`ask`→`task.decisions` 경로는 light든 full이든 동일하게 작동한다. 즉 §2.5의 `'light'`/`true`(full) 선택은 §6의 배선과 직교한다 — 어느 쪽이든 PLAN의 ask는 그대로 일어나고, 그대로 task.decisions로 접힌다.

### 6.4 측정

- **ask 카드 수 — 전(현행) 대 후(§6.2 적용).** 전: PLAN 카드 + 각 패키지가 독립적으로 내는 카드(같은 질문 중복 포함, idol-beta-ask1이 U2·U3·U4에서 실측한 중복 패턴, 09-23 문서 §0.2b). 후: PLAN 카드(불변) + 패키지 카드는 `task.decisions`와 정확히 겹치는 것만큼 감소 — 목표는 패키지 카드 0에 근접, 남는 것은 진짜 blocking뿐.
- **패키지 간 모순 건수.** 산출 문서·리포트에서 같은 질문에 다른 값을 쓴 쌍이 있는지(09-23 문서 §0.2e가 사후에 `gate:goal`+`repair`로 잡은 것과 같은 부류 — U1의 결정을 U2-U4가 뒤집었는데 PRD가 재작성되지 않아 문서 간 불일치가 난 사례). §6.2 적용 후 이 건수가 0에 가까워야 배선이 값을 한 것이다 — 0이 안 되면 `contradicts_decision` 신고가 놓친 사례이므로 (a) 검사를 다시 본다.

### 6.5 사람이 들어가는 1차 시점은 PLAN이 아니라 `tm_open` 전의 brainstorming이다 (2026-09-28 사용자 정정)

§6.2는 PLAN의 `ask`를 사람이 불리는 자리로 두었다. 그런데 PLAN은 detached daemon 안에서 돈다 — 그 순간 사람이 있는지 엔진은 모른다(그래서 `interactive: false`가 기본이고, 없으면 기본값으로 넘어가거나 `waiting_human`에 선다). **사람이 있다고 확실한 유일한 순간은 진입 스킬(`teams:develop` / `teams:plan` / `teams:sprint`)이 사용자 세션 안에서 `tm_open`을 부르기 직전이다** — 사용자의 `tm_assign`이 `interactive`와 무관하게 항상 park하는 것(`graph.mjs`의 `applyHumanPin`, `{by:'user'}`)과 같은 근거. 지금 세 진입 스킬은 모두 곧장 `tm_open`을 부르고, 그 앞에 사용자와 합의하는 단계가 없다(확인: `teams/skills/*/SKILL.md`에 brainstorming/clarify 단계 0건).

결정:
1. **진입 스킬에 brainstorming 단계를 둔다.** 프로젝트 맥락을 먼저 읽고(사람에게 사실을 묻지 않기 위해), 의도·범위·선택지를 한 번에 하나씩 묻고, 선택지마다 추천을 붙인다. 묻는 대상은 **사람만 답할 수 있는 것**(무엇을 원하나, 무엇을 빼나, A/B 중 어느 쪽)이다 — 근거로 풀리는 사실 빈칸은 PLAN의 investigate 몫이다.
2. **`tm_open({decisions: [{question, chose, because?}]})`** — 합의한 결정을 인자로 받아 `task.decisions`의 **첫 항목들**로 쓴다(`source: 'brainstorm'`, `decided_in: 'session'`). §6.2-1의 PLAN 결정은 그 뒤에 덧붙는다. PLAN의 investigate·draft도 이 목록을 `prior_decisions`로 받는다 — 즉 전파 경로는 §6.2-2 그대로이고, 시작점만 PLAN accept에서 `tm_open`으로 당겨진다.
3. **PLAN 안의 `ask`는 예외로 격하한다.** investigate의 `unknowns[]`는 기본값 + 기록이 기본이고, §6.2-3의 blocking(brainstorming/PLAN 결정과 `contradicts_decision`으로 충돌하거나 안전한 기본값이 없음)만 EPIC 레벨에 1회 park한다. 결과적으로 사람이 불리는 시점은 **세션(brainstorming) 1회 + blocking 예외**로 줄어든다.
4. **brainstorming 생략 조건 = light PLAN 감지 조건(§2.1)과 같다.** 백로그와 인수조건이 이미 구조로 주어진 요청(portfolio-refresh-80ec931a가 그랬다)은 brainstorming이 확인 1~2문항으로 끝나거나 생략된다 — 같은 감지 함수를 쓴다, 두 번 정의하지 않는다.

측정(§6.4에 추가): 런당 사람에게 간 질문 수를 **세션 질문 / 실행 중 park**로 나눠 센다. 목표는 실행 중 park ≈ 0, 세션 질문은 요청의 모호함에 비례.

§14 제안 행 18의 마지막 문장을 이렇게 바꾼다: "사람이 언제 불려가는지는 이제 '리더냐 전부냐'가 아니라 **'`tm_open` 전 brainstorming(1차) → blocking 예외(EPIC에서 1회)'**로 갈린다."

## 7. 한 줄

> 사람은 `tm_open` 전 brainstorming에서 한 번 부르고, 그 답을 태스크 전체가 정해진 것으로 쓴다(§6.5). PLAN을 끄고 켜는 스위치 하나로는 안 된다 — 이미 답이 있는 백로그엔 절반만 켜고(§2), PLAN이 낸 답은 실행이 다시 묻지 않게 한 번 정한 걸 계속 정한 걸로 취급해야 한다(§6). 둘 다 investigate 하나를 축으로 돈다.
