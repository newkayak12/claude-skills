# teams (team) v0.12.0 / v0.12.1 — 기획/QA를 EPIC 흐름에 편입, 결함 STORY, 기획 크로스 검수

> Produced by write:writing-plans. Owner for execution routing: planning:executing-plans.
> Steps use checkbox (`- [ ]`) syntax. 설계 근거: `2026-09-17-teams-team.md` §2·§3·§5·§5b·§6·§7c·§9·§11·§14,
> `2026-09-17-teams-roadmap-sizing.md` §2.2–2.4·§4.1·§5.
>
> **이 파일 하나가 두 단계를 담는다, 크기는 따로 센다.** v0.12.0(아래 §1-§2, Task 1-7) **단독
> 7–8 task-unit** — 사이징 문서 §4.1 그대로, 넘기지 않는다. v0.12.1(파일 하단의 별도 절, Task 1-3)
> **단독 5 task-unit** — 결함 STORY(2) + 기획 크로스 검수(2) + 릴리스(1). **합계 12–13.** 왜 한
> 릴리스가 아니라 둘로 나눴는지, 그리고 12–13이 늘어난 범위가 아니라 릴리스를 두 번 하는 대가
> 1 unit뿐임을 보이는 산수는 §0.2와 v0.12.1 절 맨 앞에 있다 — 팀 리더 확인(2026-09-17): §4.1의
> 경계를 조용히 넘기지 않고, `taskmanager.mjs` 파일 충돌 때문에 어차피 병렬로 못 내는 일을 굳이
> 한 릴리스로 묶어 직렬 11–12 unit짜리로 만들지 않기로 했다.

**Goal (v0.12.0):** 지금 EPIC 흐름은 `size → shape → critique → [dispatch→accept]×P → integrate →
gate:goal → report`뿐이고, `planning`/`qa`는 `teams:plan`/`teams:qa` entry 스킬로 **독립 실행**될
때만 존재한다(v0.10.1). 이 단계는 그 두 kind를 **EPIC 흐름 자체에** 편입한다 —
`team.json.roles.planning`이 켜지면 shape **앞**에 기획 단계가, `roles.qa`가 켜지면 통합 **뒤**에
QA 단계가 생긴다. 결함 STORY 발행과 기획 크로스 검수는 **여기 넣지 않는다** — v0.12.1이 그 자리다.

**전제: A-1은 분기 B로 결정됐다** — `docs/plans/2026-09-17-teams-roadmap-sizing.md` §2.4의 추천을
그대로 받는다. shape 출력에 `role`은 **영원히 생기지 않는다**. planning/qa는 STORY(package)가 아니라
**EPIC의 phase에 붙는 Team**이다.

## 0. 이 계획이 내리는 해석 — 설계 문서가 못 박지 않은 것

### 0.1 phase-Team이 실제로 어떤 노드 모양으로 뜨는가 (결정됨)

설계 문서 §2는 "기획 Team = TaskLeader의 plan/setgoal 단계를 위임받은 팀"이라고만 하고, §9 변경
지점 표에도 그 노드가 없다. **팀 리더 확인(2026-09-17)**: 이 계획이 아래에서 구체화한 읽기로
진행한다 — §14 결정 기록 `5·7·8·C`("애매 → 제안한 기본값으로 진행, 실측 뒤 재론")가 정확히 이런
경우를 위한 규칙이고, 이 읽기는 임의 추측이 아니라 `packageOf`가 실제로 `task.spec.packages`만
본다는 사실에 근거를 댔다. 재론은 실측 뒤로 미룬다 — 이 계획을 쓰는 시점에 다시 열지 않는다.

사이징 문서 §2.3 말미가 이미 이 공백을 지적하며 "패키지 dispatch와 같은 모양의 노드를 스펙에 없는
합성 id로 여는 것"을 가장 싼 읽기로 추천했다. 엔진을 읽고 그 읽기를 구체화한다:

- `openChild(task, n)`(`taskmanager.mjs:1038`)는 `packageOf(task, n.subgoal_id)`
  (`taskmanager.mjs:637`)로 패키지를 찾는데, `packageOf`는 **`task.spec.packages`만** 본다. shape의
  출력 계약에는 `role`이 없으므로(위 전제), phase-Team용 패키지 항목은 shape가 낼 수 없다 —
  **TaskLeader 자신이 합성해 `task.spec.packages`에 밀어 넣어야 한다.**
- 이 패턴은 이미 출시돼 있다. `openRepair`(`taskmanager.mjs:420`)가 정확히 이 일을 한다: shape를
  거치지 않고 `{id: 'R1', repair: true, integration_of, brief, acceptance, touches, deps}`를
  `packages` 배열에 직접 push하고, `pushChain(task, PACKAGE_CHAIN, id, 1, …)`으로 dispatch/accept를
  연다. `openChild`는 `pkg.repair`를 보고 워크트리를 새로 파지 않고 통합 워크트리를 그대로 준다
  (`taskmanager.mjs:1049-1053`). **phase-Team(planning/qa)도 같은 패턴을 쓴다**: `pkg.repair` 자리에
  `pkg.phase: 'planning' | 'qa' | 'planning-audit'`를 놓고, `flow`를 `'plan'`/`'qa'`(둘 다
  `graph.mjs:148-155`의 `FLOWS`에 이미 있다)로 고정한다.
- **이것이 결정 기록 #1을 어기지 않는 이유**: 결정 기록 #1과 §5가 금지하는 것은 **shape가 `role`을
  내는 것**(사용자·planning이 나눈 STORY에 역할이 붙는 것)이다. TaskLeader가 자기 내부 스케줄링을
  위해 `task.spec.packages`에 합성 항목을 얹는 것은 `repair: true`가 이미 그렇게 하고 있고, 사이징
  문서 §2.2 스스로가 "QA/결함 STORY의 기계 절반은 이미 존재한다"고 확인한 바로 그 메커니즘이다.
  `epicBoardRows`(`tickets.mjs:215`)의 `role` 컬럼(보드에 보이는 필드, shape 계약과는 다른 층)은
  `pkg.phase`가 있으면 `'planning'`/`'qa'`를, 없으면(develop STORY) 여전히 `'develop'`을 반환하도록
  바뀐다 — **shape 출력 계약과 보드 렌더링 필드는 다른 층**이라는 점을 §7c도 이미 구분해서 쓴다
  (보드의 `role`은 `epicBoardRows`가 렌더하는 값이지 shape가 반환하는 값이 아니다).
- 다른 읽기(전용 노드 kind를 신설)를 택하면 사이징 문서 §2.3 말미가 말한 대로 +1 unit. 이 계획은
  **패키지-모양 합성 항목** 읽기로 비용을 냈다 — `repairWorktree`/`openChild`/`foldChild`/
  `packageOf`를 그대로 재사용할 수 있어 가장 싸고, `pkg.repair`가 이미 증명한 패턴이기 때문이다.

### 0.2 무엇을 v0.12.0에 넣고 무엇을 v0.12.1로 미루는가 — 수치 논증 (팀 리더 확인, 2026-09-17)

`2026-09-17-teams-roadmap-sizing.md` §5가 "결정은 됐는데 단계가 없는" 넷을 지목했다. 그 넷을
하나씩 대조한다 — **이번에는 "이 단계에 접느냐"가 아니라 "이 릴리스에 넣느냐, v0.12.1로
미루느냐"**다.

| 미배치 일감 | 어디로 | 근거 |
|---|---|---|
| **결함 STORY 발행** | **v0.12.1.** | §2.2가 이미 확인한 사실: "통합 이후에, shape를 거치지 않고 생기는 패키지 + 그 뒤의 새 통합"은 **QA phase-Team을 여는 것과 정확히 같은 기계**(repair 패턴의 일반화)고, v0.12.0이 그 기계를 일반화한다(§0.1). 그래서 v0.12.1에서 이 항목은 QA-in-tree 인프라를 이중 계산하지 않고 "STORY 생성 + reporter 컬럼 + `qa_rounds` 캡을 지키는 재순회"만 남아 원 산정(2–3)의 하한 **2**로 잡는다. v0.12.0 자체에는 넣지 않는다 — 사이징 문서 §4.1이 이 경계("QA는 한 번 돌고 결과는 보고서로")를 명시적으로 그었고, 그 경계를 지키는 편이 더 이상 확인이 필요 없다. |
| **기획 크로스 검수** | **v0.12.1.** | 결함 STORY와 같은 이유: planning phase-Team(v0.12.0의 핵심)이 이미 있어야 그 **두 번째 run**(설계 문서 §2: "같은 Team 정체성이지만 run은 새로 연다")이 의미가 있다. STORY 발행 경로는 v0.12.1 안에서 결함 STORY 작업(Task 1)이 이미 만든 것을 재사용하므로 원 산정 2에서 할인은 없다 — `planning-audit`은 `graph.mjs`의 `KINDS`에 없는 **새 kind**라 새 체인·새 프롬프트가 그대로 필요하다. |
| **역할별 마운트 키잉** | **어느 쪽에도 넣지 않는다(여전히 미배치).** | `mounts.mjs:44-47`의 주석이 스스로 인정하는 충돌(`document`와 `planning` 둘 다 `draft` 스테이지를 쓰고 같은 mount를 받음)은 v0.12 라인이 만드는 충돌이 아니다 — `teams:plan` entry 스킬이 v0.10.1부터 이미 독립 실행으로 이 경로를 열어 왔다. 새로 만드는 위험이 아니므로 v0.12.0·v0.12.1 어느 쪽도 강제로 닫지 않는다. |
| **EPIC 정리 도구(`tm_clean`)** | **어느 쪽에도 넣지 않는다(여전히 미배치).** | EPIC DONE 뒤 워크트리·브랜치 정리는 이 릴리스 라인이 바꾸는 EPIC **흐름의 모양**과 의존 관계가 없다. |

**두 릴리스의 산수, 그리고 왜 합계가 늘지 않았는지.**

```
v0.12.0 (§4.1 그대로)                                7–8
v0.12.1 = 결함 STORY(2) + 기획 크로스 검수(2) + 릴리스(1)   5
──────────────────────────────────────────────────
합계                                                12–13
```

**§5의 미배치 5–7 중 결함 STORY(2–3)+기획 크로스 검수(2) = 4–5가 정확히 v0.12.1의 앞 두 항목이다
— 이것은 새로 생긴 일이 아니라 자리를 찾은 일이다.** `tm_clean`(0.5)·마운트 키잉(1)은 여전히
어느 릴리스에도 없으므로 §5의 5–7 중 나머지 ~1.5는 그대로 미배치로 남는다. **12–13과, 이 계획을
한 릴리스로 냈을 때의 원래 산정(11–12) 사이의 차이 1은 순수하게 릴리스를 두 번 하는 기계적 비용
(patch 범프 + README/KOR + `validate_plugins` + push, 사이징 문서 §1의 규칙대로 매 단계 예외 없이
1)이다** — 기능 범위가 늘어난 게 아니라, 한 번 낼 릴리스를 두 번 내기로 한 대가를 숨기지 않고
더한 것뿐이다.

**쪼갠 이유** (팀 리더 지시, 이 계획의 판단이 아님):
1. 사이징 문서 §4.1의 "QA는 한 번 돌고 결과는 보고서로"라는 경계는 의도적으로 그어진 것이었다 —
   그 경계를 넘는 것은 눈에 보이는 결정이어야지, 계획서 한 장 안에서 조용히 접혀 들어가면 안
   된다.
2. Task 1-5·6·7(원래 8·9) 중 7/9가 `taskmanager.mjs`를 건드리는 것과 달리(자기 검토 참고), 결함
   STORY·크로스 검수까지 얹으면 9/11이 같은 파일을 건드려 **완전히 직렬인 11–12 unit 릴리스**가
   된다 — 이 저장소에서는 작은 릴리스가 꾸준히 나갔지, 이만한 크기를 직렬로 한 번에 내 본 적이
   없다.

### 0.3 코드를 읽고 확인한 사실 (전제)

- `finish(task, n, result)`(`taskmanager.mjs:1429`)가 매니저 노드 전이의 **단일 지점**이다:
  `shape` 완료 시 `task.spec`을 채우고 `expandPackages()`를 호출하는 것(1463-1471)이 지금 유일한
  분기 로직 — phase-Team 삽입은 여기(shape 앞은 `createTask`의 초기 `nodes` 배열, QA/audit 뒤는
  `expandPackages` 안)에 건다.
- `expandPackages(task, packages)`(`taskmanager.mjs:286`)는 `critique` 완료를 기다리는 dispatch들과
  `integrate`/`gate:goal`/`report`를 **한 번에** 만든다 — QA/audit phase-Team 노드를 끼워 넣으려면
  `gate:goal`의 dep을 `integrateId`에서 QA(있으면)·audit(있으면)의 마지막 노드로 바꿔야 한다.
- `PACKAGE_CHAIN = ['dispatch', 'accept']`(`taskmanager.mjs:87`)는 **STORY 레벨** 체인(관리자 노드
  이름)이고, 그 안에서 열리는 자식 run의 **subgoal 레벨** 체인이 `graph.mjs`의 `KINDS[kind].chain`
  (구현/테스트/게이트, 초안/퇴고/게이트, 케이스/실행/게이트)이다 — 이 둘은 다른 층이라 phase-Team도
  여전히 `dispatch:PLAN:1`/`accept:PLAN:1` 같은 관리자 노드를 갖고, 그 안의 자식 run이 `flow: 'plan'`
  이라 `planning` kind로 도는 것뿐이다.
- `graph.mjs`의 `KINDS`(56-98행)에는 `subgoal`/`document`/`planning`/`qa` 넷뿐이다 —
  **`planning-audit`은 없다.** 설계 문서 §3이 이미 설계해 둔 `audit → gate` 체인을 v0.12.1의
  Task 2가 처음 코드로 넣는다(발견 1, 아래).
- `teamconfig.mjs`의 `roles`/`qa_rounds`/`max_parallel_teams`(12-26행)는 `taskmanager.mjs`·
  `graph.mjs` 어디에서도 소비되지 않는다(`grep -n "roles\b\|qa_rounds\|max_parallel_teams"` 무응답,
  확인함) — `roles.planning`/`roles.qa`/`max_parallel_teams`는 v0.12.0이, `qa_rounds`는 v0.12.1이
  처음 소비를 만든다.
- `mounts.mjs:44-47`의 코드 주석이 §3 요구(`{role}:{stage}` 키잉)를 스스로 "단계 키뿐"이라고 인정
  한다 — 위 §0.2에서 v0.12 라인이 그것을 고치지 않기로 한 이유를 밝혔다.
- `docs.mjs`는 지금 8종(`INDEX`/`request`/`shape`/`critique`/STORY별/`integrate`/`goal-gate`/
  `report`)만 렌더한다(`renderAll`, `docs.mjs:144`). §7c의 13종 중 남은 5종
  (`10-planning`/`10-prd`/`15-spec-gate`/`60-qa`/`65-audit`)은 planning/qa Team이 EPIC 흐름에
  없어서 미뤄졌다(v0.11.0 계획서 자기 진술). **v0.12.0은 그중 3종을 닫는다**: `10-planning.md`,
  `10-prd.md`, `60-qa.md` (8/13 → 11/13). `65-audit.md`는 v0.12.1이 닫는다(11/13 → 12/13).
  `15-spec-gate.md`는 human 게이트(v0.13.0)의 산출물이라 그대로 남는다 — v0.12 라인이 끝나면
  13종 중 12종, v0.13.0에 하나만 남는다.

### 0.4 발견 — 팀 리더에게 보고, 해결하지 않고 진행

1. **§3의 `planning-audit` kind가 코드에 없다** (위 §0.3) — **팀 리더 확인(2026-09-17): 이 계획이
   메운 빈칸으로 확정, 재론하지 않는다.** 설계는 이미 이 kind의 체인(`audit → gate`)을 §3에 적어
   뒀지만, §3의 페르소나·스킬 표는 `planning`/`develop`/`qa` 셋만 채워져 있고 `planning-audit`의
   setgoal 페르소나·스테이지 스킬 칸이 비어 있었다 — **결정 기록 #1이 기획 크로스 검수를 흐름에
   못박아 둔 이상 이 kind는 존재해야 하고, §3의 표에 그 행만 없었을 뿐**이다. 이 계획은 그 빈칸을
   `planning`과 같은 페르소나(PO·도메인 전문가·구현 리드)를 재사용하고 스킬은
   `think:devils-advocate`(gate와 동일, 판정 성격이 강하므로)로 채워 닫는다 — 다음 읽는 사람이
   "빈칸을 추측했다"가 아니라 "빈칸을 의도적으로 메웠다"로 읽도록 여기 남긴다.
2. **§5의 `implements[]` 완전성 검사가 요구하는 "user story 목록"이 구조화돼 있지 않다** — **팀
   리더 확인(2026-09-17): 아래 다리로 확정.** PRD 본문(`10-prd.md`)은 §14 결정 3b에 의해
   **verbatim 자유 텍스트**(`pm/skills/prd-development/template.md`의 10절 스켈레톤)다.
   `validateShape`(`taskmanager.mjs:235`)가 "모든 user story가 어느 STORY에든 속해야 한다"를
   기계적으로 검사하려면 user story ID 목록(`US-1`, `US-2`, …)이 **구조화된 필드로** 어딘가에
   있어야 하는데, 설계 문서 어디에도 이 필드의 자리가 없다. 이 계획은 `planning` 체인의 `gate` 노드
   결과에 `result.user_stories: string[]`(ID 목록만, 본문은 여전히 PRD가 verbatim으로 들고 있음)를
   추가해 shape 프롬프트와 `validateShape`가 그 배열만 대조한다. **이것은 결정 3b를 어기지 않는다**:
   3b가 정한 것은 PRD **본문**이 있을 자리와 그것이 verbatim이어야 한다는 것이지, planning이 구조화된
   출력을 **전혀** 낼 수 없다는 것이 아니다. `gate` 노드 결과에서 ID 목록만 뽑는 것은 PRD 본문을
   파싱하는 것과 다르다 — 이 계획은 PRD 파일을 열어 읽지 않는다.
3. **모순 후보 — QA phase-Team의 워크트리 소유권과 `qa_rounds` 재순회.** §3은 "QA STORY는 통합
   워크트리를 쓴다, `src/` 쓰기 금지"라고 하는데, 결함 STORY가 발행되면 develop이 **같은** 통합
   워크트리가 아니라 **자기 워크트리**에서 고친 뒤 새 통합이 열린다(§5b: "보통의 dispatch →
   accept → integrate:N+1"). 즉 QA는 매 라운드 **다른** integrate가 만든 **새** 통합 워크트리를
   봐야 한다 — `repairWorktree`(`taskmanager.mjs:645`)처럼 "가장 최근 integrate의 워크트리"를 찾는
   함수가 QA에도 필요하고, 이는 `repairWorktree`와 로직이 사실상 같다(재사용 가능, 새로 만들 필요
   없음 — 모순이 아니라 재확인). **팀 리더에게 보고할 것은 사실 확인 결과이지 모순이 아니다**: 이미
   있는 함수로 충분하다.

---

## 1. v0.12.0에 들어가는 것 (요약)

- `team.json.roles.planning`/`roles.qa` 스위치가 실제로 EPIC 노드 그래프를 바꾼다.
- planning phase-Team이 shape **앞**에서 돈다: 자기 `draft→revise→gate` 체인으로 PRD
  (`10-prd.md`)를 쓰고, 구조화된 `user_stories[]`를 gate 결과에 남겨 shape에 넘긴다.
- shape 계약에 `priority`, `implements[]`가 생기고 완전성 검사가 붙는다(`role`은 여전히 없다).
- QA phase-Team이 통합 **뒤**, `gate:goal` **앞**에서 통합 워크트리 위에 **한 번** 돈다(재순회는
  v0.12.1 — 아래 §2).
- 스케줄러가 `priority` 오름차순 + `max_parallel_teams` 상한으로 dispatch를 연다(지금은 무제한
  동시 개방).
- 보드·phase 문서가 위 전부를 안다: `role` 컬럼이 `develop`/`planning`/`qa`를 구분하고,
  `10-planning.md`/`10-prd.md`/`60-qa.md`가 렌더된다.

## 2. v0.12.0이 하지 않는 것

- **shape 출력의 `role` 필드.** 분기 B에서는 영원히 만들지 않는다(§5, 위 전제).
- **결함 STORY 발행(`tm_file`, `qa_rounds` 재순회).** → **v0.12.1**(결정 기록 #2). QA는 이 단계에서
  **한 번만** 돌고 결과는 보고서로 나간다 — 사이징 문서 §4.1의 원래 경계 그대로.
- **기획 크로스 검수(`planning-audit` kind).** → **v0.12.1**(결정 기록 #1의 마지막 패스).
- **human이 스펙을 승인하는 게이트(`gate:human:spec`).** v0.13.0. 이 단계는 `interactive`/
  `human_gates`를 여전히 읽고 기록만 한다 — 소비하지 않는다(`teamconfig.mjs` 그대로).
- **역할별 mounts 키잉(`{role}:{stage}`).** §0.2에서 어느 릴리스에도 넣지 않기로 했다 —
  `mounts.mjs`는 v0.12 라인 전체에서 손대지 않는다.
- **`tm_clean`(EPIC 정리 도구).** §0.2에서 어느 릴리스에도 넣지 않기로 했다.
- **sub-EPIC.** v0.14.0.
- **`15-spec-gate.md`, `65-audit.md`.** 전자는 human 게이트(v0.13.0)의 산출물, 후자는 v0.12.1의
  기획 크로스 검수 산출물이다(§0.3).
- **planning/qa phase-Team이 여러 개 병렬로 뜨는 것.** 사이징 문서 §2.4가 분기 B를 추천한 근거 3번
  그대로: 설계 문서 어디에도 기획·QA가 여러 개 필요하다는 요구가 없다. 한 EPIC에 planning
  phase-Team은 v0.12.0에서 최대 하나(초안), QA phase-Team도 최대 하나(v0.12.1에서 `qa_rounds`
  개까지, 순차).

---

## 태스크 그룹과 의존 관계 (v0.12.0)

```
Task 1  createTask: 역할 스위치 → planning phase-Team 노드 삽입 (shape 앞)         ─┐
Task 2  planning phase-Team 자식 run 열기 + PRD/user_stories → shape 입력           │ taskmanager.mjs를
Task 3  shape 계약(priority, implements[]) + validateShape 완전성 검사             │ 공유 — 직렬
Task 4  expandPackages: QA phase-Team 노드 삽입 (통합 뒤, gate:goal 앞)             │ (Task 1이 먼저,
Task 5  스케줄러 상한(max_parallel_teams) + priority 정렬                          ┘  2·3·4·5는 순서가
                                                                                       크게 안 중요하나
                                                                                       같은 파일이라 직렬)
Task 6  tickets.mjs + docs.mjs — role, 10-planning/10-prd/60-qa                    — Task 1-5 뒤
Task 7  릴리스 0.12.0                                                              — 전부의 위
```

- **파일 충돌**: Task 1·2·3·4·5 **전부**가 `teams/mcp/taskmanager.mjs`를 건드린다 — v0.11.0과 달리
  이번 릴리스는 "서로 겹치지 않아 병렬"인 조합이 거의 없다. 순서는 위 그래프대로: 노드 그래프
  모양을 바꾸는 순서(planning 삽입 → PRD 배선 → shape 계약 → QA 삽입 → 스케줄러)를 따라야 각
  태스크가 그 앞 태스크가 만든 노드를 전제로 검증을 쓸 수 있다. Task 6은 `tickets.mjs`/`docs.mjs`만
  건드리므로 파일은 안 겹치지만, Task 1-5가 만드는 노드 모양(phase-Team의 `stage`/`subgoal_id`
  규칙)이 확정돼야 그 위의 파생 함수를 쓸 수 있어 순서상 뒤에 온다.
- **1라운드/2라운드 판단**: 1라운드. 위 순서를 지키는 한 파일 충돌 없이 순차 진행 가능하다.
- 결함 STORY·기획 크로스 검수는 이 절이 아니라 파일 하단의 **v0.12.1** 절에 있다 — 왜 별도
  릴리스인지는 §0.2에 이미 적었다.

---

### Task 1: `createTask` — 역할 스위치에 따른 planning phase-Team 삽입 (shape 앞)
**Files:** modify `teams/mcp/taskmanager.mjs` (`createTask`, `taskmanager.mjs:143-220`), modify
`teams/scripts/test-taskmanager.mjs`
**Interfaces:** `createTask`가 `T.roles.planning`(이미 `teamconfig.mjs`가 해석해 놓은
`task.team.opts.roles.planning`)을 읽어 초기 `nodes` 배열을 바꾼다. planning이 꺼져 있으면 지금과
바이트 단위로 같은 배열 — 하위 호환.
**Pass bar:** `node --test teams/scripts/test-taskmanager.mjs` 전부 통과.

- [ ] 1: 실패하는 테스트를 쓴다 — `roles.planning: true`로 `tm_open`(또는 `createTask` 직접 호출하는
  하네스 픽스처)을 열면 `task.nodes`에 `dispatch:PLAN:1`이 있고 `deps`가 `['size']`이며, `shape`
  노드의 `deps`가 `['size']`가 아니라 `['accept:PLAN:1']`(또는 이 계획이 채택한 명칭 —
  아래 구현과 일치)임을 확인한다. `roles.planning: false`(기본값)일 때는 지금과 같은 3-노드
  배열(`size`/`shape`/`critique`)임을 확인하는 회귀 테스트도 같은 파일에 남긴다.
- [ ] 2: `createTask`를 고친다: `T.roles.planning`이 true면 합성 패키지
  `{ id: 'PLAN', phase: 'planning', flow: 'plan', title: 'PRD', brief: task.request,
  acceptance: ['PRD covers the request'], deps: [], touches: [] }`를 **아직 없는**
  `task.spec.packages`가 아니라 `task.planning_pkg`(shape 전이라 `task.spec`이 아직 null이므로
  별도 필드에 둔다) 자리에 준비하고, `pushChain(task, PACKAGE_CHAIN, 'PLAN', 1, ['size'], [],
  {})`로 `dispatch:PLAN:1`/`accept:PLAN:1`을 만든다. `shape` 노드의 `deps`를
  `['accept:PLAN:1']`로, `critique`는 그대로 `['shape']`로 둔다.
- [ ] 3: `node --test teams/scripts/test-taskmanager.mjs` 통과 확인.
- [ ] 4: `git add teams/mcp/taskmanager.mjs teams/scripts/test-taskmanager.mjs && git commit -m
  "feat(teams): roles.planning inserts a planning phase-Team before shape (§2)"`

> **사후 정정 (2026-09-17, board.jsonl 비대칭 수정 작업 중 발견).** 위 2번 항목은 원래
> "shape 성공 시 `expandPackages`가 `task.spec.packages`를 만들 때 `task.planning_pkg`를
> 선두에 합류시킨다"고 적었으나, **실제 구현은 그렇게 하지 않는다** — 좋은 이유가 있다:
> `pushChain`이 이미 이 단계(`createTask`)에서 `dispatch:PLAN:1`/`accept:PLAN:1`을 직접 열어
> 두는데, `expandPackages`가 도는 `task.spec.packages` 배열에 `PLAN`을 다시 넣으면 같은
> `subgoal_id`로 **두 번째, 충돌하는 체인**을 또 여는 꼴이 된다. 실제 코드는 `task.planning_pkg`를
> `task.spec.packages`에 합류시키지 않고 끝까지 별도 필드로 남겨 두며, `epicBoardRows`/
> `ticketSnapshot`(`tickets.mjs`)과 문서 렌더러(`docs.mjs`)가 `task.planning_pkg`/`task.qa_pkg`를
> 직접 읽어 들인다. 이 계획은 역사를 다시 쓰지 않는다 — 원래 의도가 틀렸다는 사실 자체를
> 지우지 않고 남긴다. Task 4(QA phase-Team)의 원문은 애초에 "합류"를 주장한 적이 없어 정정이
> 필요 없다. v0.12.1 Task 2(audit phase-Team)도 확인했고, `task.spec.packages`에 합류시킨다는
> 주장이 없어 같은 실수를 물려받지 않았다.

---

### Task 2: planning phase-Team 자식 run — PRD/`user_stories[]` → shape 입력
**Files:** modify `teams/mcp/taskmanager.mjs` (`openChild:1038`, `foldChild:1108`,
`childContext:688`, `composeTaskPrompt:1243`), modify `teams/scripts/test-taskmanager.mjs`
**Interfaces:** `openChild`가 `pkg.phase === 'planning'`일 때 워크트리를 **새로 파지 않고**
(PRD는 파일 산출물이 아니라 노드 결과이므로 격리된 워크트리가 필요 없다 — 프로젝트 `cwd` 그대로
넘긴다), `flow: 'plan'`을 고정한다. `foldChild`가 그 자식 run의 `gate` 결과에서 `user_stories`를
읽어 `dispatch:PLAN:1`의 `result`에 얹는다. `shape`를 여는 프롬프트(`composeTaskPrompt`)가 PRD의
**링크**(`10-prd.md` 경로)와 `user_stories[]`를 컨텍스트로 받는다 — 본문을 통째로 올리지 않는다
(§7c "payload를 main에 올리지 않는다" 원칙, `docPaths(task).dir`에 이미 있는 규칙 재사용).
**Pass bar:** `node --test teams/scripts/test-taskmanager.mjs` 전부 통과, `shape`의 briefing에 PRD
경로 문자열이 있고 본문 텍스트가 없음을 문자열 검사로 확인.

- [ ] 1: 실패하는 테스트 — 가짜 driver로 `dispatch:PLAN:1`을 `{sound:true, user_stories:['US-1',
  'US-2']}`로 submit한 뒤, `shape`가 ready가 됐을 때 그 briefing에 `user_stories`가 그대로 나열되고
  `10-prd.md`의 경로 문자열은 있지만 PRD 본문 텍스트("Executive Summary" 같은 템플릿 절 이름)는
  없음을 확인.
- [ ] 2: `openChild`에 `pkg.phase === 'planning'` 분기 추가(워크트리 미생성, `cwd: task.cwd`),
  `foldChild`에 `pkg.phase === 'planning'`이면 자식 run의 `planning` kind gate 결과에서
  `user_stories`를 뽑아 `n.result.user_stories`에 싣는 분기 추가. `composeTaskPrompt`의 shape 절에
  `docPaths(task).dir`(PRD 링크)과 `user_stories`를 붙인다.
- [ ] 3: 테스트 통과 확인.
- [ ] 4: `git add teams/mcp/taskmanager.mjs teams/scripts/test-taskmanager.mjs && git commit -m
  "feat(teams): planning phase-Team's PRD and user_stories flow into shape's input, verbatim body never leaves the child run"`

---

### Task 3: shape 계약 — `priority`, `implements[]`, 완전성 검사
**Files:** modify `teams/mcp/taskmanager.mjs` (`validateShape:235-284`), modify
`teams/scripts/test-taskmanager.mjs`
**Interfaces:** `validateShape(spec)`가 `p.priority`(정수, 없으면 배열 순서를 기본값으로 채움)와,
`task.planning_pkg`가 있던 태스크(즉 planning이 켜졌던 태스크)에 한해 `p.implements`(문자열 배열,
Task 2가 넘긴 `user_stories`의 부분집합)를 검사한다. 모든 `user_stories`가 어느 패키지의
`implements`에도 없으면 거부.
**Pass bar:** 표 기반 테스트 — `user_stories: ['US-1','US-2']`인데 패키지들의 `implements`가
`US-1`만 덮으면 `unusable shape`로 거부되고 `shape_problems`에 `US-2`가 이름으로 등장함을 확인.
planning이 꺼진 태스크는 `implements` 검사를 건너뜀을 별도 테스트로 확인(회귀 방지).

- [ ] 1: 실패하는 표 테스트 작성(완전성 통과/실패 양쪽, planning 꺼짐일 때 미검사 케이스 포함).
- [ ] 2: `validateShape`에 `priority` 기본값 채우기(부작용: `spec.packages`를 직접 변형하지 않고
  `finish()`가 `task.spec`을 만들 때 정렬용 값을 채운다 — `validateShape`는 여전히 problems만
  반환하는 순수 검사 함수로 남긴다), `implements[]` 완전성 검사 추가(`task.__user_stories`처럼
  `finish()`가 Task 2의 `dispatch:PLAN:1` 결과에서 미리 뽑아 `validateShape`에 두 번째 인자로
  넘긴다 — 순수성 유지).
- [ ] 3: 테스트 통과 확인.
- [ ] 4: `git add teams/mcp/taskmanager.mjs teams/scripts/test-taskmanager.mjs && git commit -m
  "feat(teams): shape contract gains priority + implements[] completeness against planning's user_stories (§5)"`

---

### Task 4: `expandPackages` — QA phase-Team 삽입 (통합 뒤, `gate:goal` 앞)
**Files:** modify `teams/mcp/taskmanager.mjs` (`expandPackages:286-303`, `openChild:1038`,
`repairWorktree:645`), modify `teams/scripts/test-taskmanager.mjs`
**Interfaces:** `T.roles.qa`가 true면 `expandPackages`가 `integrateId` 완료 뒤 합성 패키지
`{id: 'QA', phase: 'qa', flow: 'qa', repair_style_worktree: true, deps: [], touches: []}`를
만들어 `dispatch:QA:1`/`accept:QA:1`을 `integrateId`에 의존시키고, `gate:goal`의 dep을
`integrateId`에서 `accept:QA:1`로 바꾼다. `openChild`가 `pkg.phase === 'qa'`일 때
`repairWorktree`(이미 있는, "가장 최근 integrate의 워크트리 재사용" 로직)를 그대로 호출한다 —
새 함수를 만들지 않는다(§0.3 발견 3에서 확인한 재사용 가능성).
**Pass bar:** `qa` 꺼짐일 때 지금과 바이트 단위로 같은 노드 그래프(회귀), 켜짐일 때
`gate:goal`이 `accept:QA:1`에 의존하고 `dispatch:QA:1`의 워크트리가 `integrate:1`과 같은 cwd임을
확인.

- [ ] 1: 실패하는 테스트 작성.
- [ ] 2: `expandPackages` 수정, `openChild`에 `pkg.phase === 'qa'` 분기(`repairWorktree` 재사용,
  `src/`가 아니라 `test/`·리포트만 쓰라는 §3 규칙은 브리핑 문구로 전달 — 강제 검증(`changed_files_
  verified` 확장)은 이 계획 범위 밖: v0.12.0은 QA를 한 번만 돌리고 결과를 보고서에 싣는 데까지라
  결함 STORY의 재순회 자체가 없다. 위반 강제는 v0.12.1이 결함 루프를 만들 때 재검토할 항목이다).
- [ ] 3: 테스트 통과 확인.
- [ ] 4: `git add teams/mcp/taskmanager.mjs teams/scripts/test-taskmanager.mjs && git commit -m
  "feat(teams): roles.qa inserts a QA phase-Team between integrate and gate:goal, reusing the repair worktree (§2, §3)"`

---

### Task 5: 스케줄러 상한(`max_parallel_teams`) + `priority` 정렬
**Files:** modify `teams/mcp/taskmanager.mjs` (`toolNext`/`toolNextSRun`이 ready dispatch를 여는
지점 — `taskmanager.mjs:1792-1914` 구간에서 dispatch를 실행 상태로 넘기는 루프), modify
`teams/scripts/test-taskmanager.mjs`
**Interfaces:** 지금은 ready인 dispatch를 **전부** 한 번에 연다(설계 문서·사이징 문서 둘 다 확인한
사실). `max_parallel_teams`개까지만, 그것도 `priority` 오름차순으로 골라 연다 — 나머지는 ready라도
이번 폴링에서 열리지 않고 다음 폴링을 기다린다(티켓 상태는 여전히 READY, BACKLOG이 아님 — `unmetDeps`
기준은 그대로).
**Pass bar:** `max_parallel_teams: 1`로 열고 서로 독립인 패키지 3개를 shape가 냈을 때, 한 번의
`tm_next` 호출 뒤 `running` dispatch가 정확히 1개(가장 낮은 `priority`)이고 나머지 둘은 `pending`
그대로임을 확인. 상한을 다 채우지 않은 상태(현재 실행 중 0개, 상한 2)에서는 즉시 2개까지 열림을
확인(회귀: 상한보다 적으면 지금처럼 즉시 연다).

- [ ] 1: 실패하는 테스트 작성.
- [ ] 2: dispatch를 여는 루프에 "현재 `running` 상태 dispatch 개수"를 세고 상한에서 뺀 만큼만,
  `priority` 오름차순으로 열도록 필터 추가. phase-Team(`PLAN`/`QA`) 패키지는 이 상한 계산에서
  제외한다 — 동시에 도는 develop STORY 수를 캡하는 것이 목적이고, phase-Team은 애초에 한 번에
  하나만 존재하도록 설계돼 있다(위 §2 "v0.12.0이 하지 않는 것").
- [ ] 3: 테스트 통과 확인.
- [ ] 4: `git add teams/mcp/taskmanager.mjs teams/scripts/test-taskmanager.mjs && git commit -m
  "feat(teams): max_parallel_teams caps concurrent STORY dispatch, priority-ordered (§5)"`

---

### Task 6: `tickets.mjs` + `docs.mjs` — role, 3개 렌더러
**Files:** modify `teams/mcp/tickets.mjs` (`epicBoardRows:215`), modify `teams/mcp/docs.mjs`
(새 `renderPlanning`, `renderPrd`(링크·인용, verbatim 본문 자체는 아님), `renderQa`, `renderAll`
확장), modify `teams/scripts/test-tickets.mjs`, `teams/scripts/test-docs.mjs` + golden 픽스처 확장
**Interfaces:** `epicBoardRows`의 `role`이 `p.phase || 'develop'`을 반환(`'planning'`/`'qa'` 그대로,
새 값 도입 없음 — phase 문자열을 그대로 role로 쓴다). `reporter`는 이 단계에서 여전히
`p.repair ? 'repair' : 'shape'` 그대로다(`'qa'`/`'you'`/`'planning-audit'`는 v0.12.1이 추가). 3개
새 렌더러는 Task 1·2(`10-planning.md`/`10-prd.md`), Task 4(`60-qa.md`)가 만든 노드·결과 필드를
읽는다 — `renderAll`은 해당 phase-Team 패키지가 `task.spec.packages`에 있을 때만 그 파일을
만든다(기존 원칙: 데이터 없는 곳에 빈 md 없음).
**Pass bar:** golden 파일 비교(`test-docs.mjs`가 이미 갖고 있는 패턴) — planning+qa가 둘 다 뜬
픽스처 태스크로 11/13 문서(`15-spec-gate.md`·`65-audit.md` 제외 전부)가 렌더됨을 확인, `tm_docs
({rebuild:true})`가 동일 바이트를 재생산함을 확인(기존 v0.11.0 테스트가 이미 검증하는 불변식의
연장).

- [ ] 1: `test-tickets.mjs`에 `role`이 `'planning'`/`'qa'`를 반환하는 표 행 추가, `test-docs.mjs`에
  새 golden 파일 3개를 위한 실패 테스트(파일 없음 확인) 작성.
- [ ] 2: `epicBoardRows` 확장, `renderPlanning`/`renderPrd`/`renderQa` 구현(`renderPrd`는 PRD
  본문을 **인용하지 않고 링크만** 건다 — verbatim 규칙, §7c), `renderAll`에 조건부 추가.
- [ ] 3: golden 파일 생성(`writeDocs`를 실제로 실행해 저장, v0.11.0과 같은 부트스트랩 절차) 후
  사람이 §7c 형식과 어긋나지 않는지 확인.
- [ ] 4: `node --test teams/scripts/test-tickets.mjs teams/scripts/test-docs.mjs` 전부 통과 확인.
- [ ] 5: `git add teams/mcp/tickets.mjs teams/mcp/docs.mjs teams/scripts/test-tickets.mjs teams/scripts/test-docs.mjs teams/scripts/fixtures/docs-golden && git commit -m
  "feat(teams): board/docs know planning and qa phase-Teams - role column, 10-planning/10-prd/60-qa renderers (§7c)"`

---

### Task 7: 릴리스 0.12.0
**Files:** modify `teams/.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`(teams
항목만), `teams/README.md`, `teams/KOR.md`
**Interfaces:** consumes Task 1-6 전부.
**Pass bar:** `node --test teams/scripts/test-*.mjs` 전부 통과(회귀 0), `python3
scripts/validate_plugins.py` ERROR 0, 두 매니페스트 0.12.0 일치, README·KOR Status 첫 항목이
v0.12.0.

- [ ] 1: `git fetch skills main && git status -sb` — origin이 앞서 있으면 rebase.
- [ ] 2: `node --test teams/scripts/test-*.mjs 2>&1 | tail -8` → `# fail 0` 확인.
- [ ] 3: patch 범프: teams `"version": "0.11.0"` → `"0.12.0"`; marketplace description에 "Wires
  planning/QA into the EPIC flow as phase-Teams (not peer STORYs), adds shape priority/implements[]
  and a max_parallel_teams cap. QA runs once per EPIC in this release; defect STORYs and the
  planning cross-review pass land in v0.12.1." 추가.
- [ ] 4: README/KOR `## Status` 맨 위에 한 줄 prepend(v0.11.0 항목 등 기존 내용은 그대로 아래에
  둔다) — 이 단계가 실제로 닫은 것(위 §1)과 여전히 안 닫은 것(§2, v0.12.1 포함)을 요약.
- [ ] 5: 설계 문서(`docs/plans/2026-09-17-teams-team.md`) §11의 v0.12.0 행을 "완료"로 표시하는
  것은 이 계획 파일 소유가 아니다 — 팀 리더나 그 갱신을 맡은 agent의 몫. 이 계획은 건드리지 않는다.
- [ ] 6: `python3 scripts/validate_plugins.py` ERROR 0 확인.
- [ ] 7: `git add teams/.claude-plugin/plugin.json .claude-plugin/marketplace.json teams/README.md teams/KOR.md && git commit -m
  "feat(teams): 0.12.0 - planning/QA as EPIC phase-Teams, shape priority/implements[], scheduler cap"`
- [ ] 8: `git push skills main`(실패하면 1번으로 돌아가 fetch·rebase 후 재시도).

---

## 자기 검토 (v0.12.0)

- **§0.1의 해석(phase-Team = 합성 패키지)이 이 계획 전체의 기초다** (v0.12.0과 v0.12.1 둘 다).
  다른 읽기(전용 노드 kind)를 택하면 Task 1·2·4의 구현 세부(어떤 함수가 무엇을 재사용하는지)가
  바뀐다 — 팀 리더가 §14 결정 기록 `5·7·8·C` 아래 확정했으므로(§0.1) 이 계획을 쓰는 시점에는
  다시 열지 않는다.
- **발견 2(user_stories 구조화 필드)는 설계 문서에 없는 스키마를 이 계획이 새로 만든 것**이다 —
  PRD verbatim 규칙을 지키면서 기계 검사를 가능하게 하는 가장 작은 다리다. 팀 리더가 확정했으므로
  (§0.4) 다시 열지 않지만, 다른 다리를 원하게 되면(예: PRD 템플릿 자체에 `## User Stories`를 파싱
  가능한 형식으로 강제) Task 2·3만 다시 쓰면 된다 — 나머지 태스크는 영향받지 않는다.
- **파일 충돌이 v0.11.0보다 심하다**: 7개 태스크 중 5개가 `teams/mcp/taskmanager.mjs`를 건드린다.
  이 릴리스는 v0.11.0처럼 "3-way 병렬"을 낼 수 없다 — 위 태스크 그룹 절이 이미 그렇게 표시했다.
  결함 STORY·크로스 검수까지 얹으면 이 비율이 9/11까지 나빠졌을 것 — 이것이 §0.2가 v0.12.1로
  쪼갠 두 번째 이유다.
- **위험**: `max_parallel_teams`(Task 5)가 phase-Team을 상한 계산에서 빼는 판단은 이 계획의
  것이다 — phase-Team은 설계상 한 번에 하나뿐이므로 상한과 무관해야 한다고 봤지만, 사용자가
  "총 동시 실행 Team 수"로 상한을 이해하고 있었다면 이 판단은 틀렸다. 작은 변경(필터 조건 한 줄)
  이라 되돌리기 쉽다.
- **위험**: Task 6의 golden 픽스처는 planning+qa가 뜬 태스크 하나로 11/13 문서를 확인한다 —
  v0.12.1이 같은 태스크에 결함 루프·audit을 더 얹었을 때 이 골든이 깨지는 방식(단순 추가 vs 기존
  파일 내용 변경)은 v0.12.1의 몫이지 이 계획이 지금 예측할 것은 아니다.

---

# v0.12.1 — 결함 STORY, 기획 크로스 검수

**전제**: v0.12.0(위)이 릴리스됐다 — `teams` `"version": "0.12.0"`, Task 7이 그 커밋·태그·푸시를
마친 상태. 이 절은 그 위에 얹는다.

**왜 별도 릴리스인가 (팀 리더 지시, 2026-09-17).** 원래 이 계획의 초안은 결함 STORY·기획 크로스
검수를 v0.12.0 안에 접어 넣었다(§0.2가 그 논증을 그대로 갖고 있다 — 접는 근거 자체는 여전히
유효하다: 둘 다 v0.12.0이 만드는 QA-in-tree/기획 phase-Team 기계를 재사용한다). 두 가지 이유로
쪼갰다:
1. 사이징 문서 §4.1이 그은 "QA는 한 번 돌고 결과는 보고서로"라는 경계는 의도적이었다 — 그 경계를
   넘는 것이 계획서 한 장 안에서 조용히 접혀 들어가면 안 된다는 것.
2. v0.12.0의 Task 1-6 중 5개가 이미 `taskmanager.mjs`를 공유해 직렬인데, 결함 STORY·크로스 검수까지
   더하면 9/11 태스크가 같은 파일을 건드리는 **완전히 직렬인 11–12 unit 릴리스**가 된다 — 이
   저장소는 작은 릴리스를 꾸준히 내 왔지 이 크기를 한 번에 낸 전례가 없다.

**총 작업량은 늘지 않았다.** 아래 Task 1·2는 원래 계획의 Task 6·7과 **기능적으로 동일**하고
(팀 리더 결정 #4만 Task 2의 게이트 조건에 반영돼 있다 — 아래), `2026-09-17-teams-roadmap-sizing.md`
§5의 미배치 5–7 중 결함 STORY(2–3)+기획 크로스 검수(2)가 정확히 이 두 Task다. §0.2가 이미 밝혔듯
v0.12.0(7–8) + v0.12.1(5, 아래) = 12–13이고, 한 릴리스로 냈을 때의 11–12와의 차이 1은 릴리스를
두 번 하는 기계적 비용(패치 범프+README/KOR+검증+push, 매 단계 예외 없는 릴리스 1 unit)이다 —
기능 범위가 는 게 아니다.

## v0.12.1에 들어가는 것

- QA phase-Team의 `gate`가 결함을 내면 develop STORY(결함 STORY)가 자동 발행되고, EPIC이
  dispatch→accept→integrate→qa로 돌아간다. `qa_rounds` 캡을 넘기면 보고서의 "미해결 결함" 절로
  넘어간다.
- 사용자도 `tm_file`로 같은 경로에 직접 STORY를 발행할 수 있다.
- planning phase-Team이 EPIC 안에서 **두 번째로** 돈다(크로스 검수, `planning-audit` kind,
  `audit → gate`) — `roles.planning`이 켜져 있으면 항상, `roles.qa`가 켜져 있으면 QA 리포트도
  같이 대조한다(팀 리더 결정 #4, 아래 Task 2).
- 보드·phase 문서가 위 전부를 안다: `reporter` 컬럼이 `shape`/`qa`/`you`/`planning-audit`을
  구분하고, `65-audit.md`가 렌더된다(§7c의 13종 중 마지막 하나, `15-spec-gate.md`만 v0.13.0에
  남는다).

## v0.12.1이 하지 않는 것

- v0.12.0이 이미 하지 않기로 한 것 전부(§2) — `role` 필드, human 게이트, 마운트 키잉, `tm_clean`,
  sub-EPIC, `15-spec-gate.md`.
- 결함 STORY의 blame 판정을 별도 노드로 분리하는 것 — §14 A-2가 여전히 열려 있고, 이 계획은 QA의
  `gate` 노드가 직접 `defects`를 내는 더 싼 쪽으로 진행한다(A-2를 다시 열지 않음, §14의 "애매하면
  제안된 기본값" 원칙 적용).
- 결함 STORY·크로스 검수 STORY가 여러 라운드 동시에 쌓이는 것에 대한 UI적 정리 — 보드는 있는
  그대로(수퍼시드된 노드는 안 보임) 보여줄 뿐, 별도 "결함 이력" 뷰는 만들지 않는다.

---

## 태스크 그룹과 의존 관계 (v0.12.1)

```
Task 1  결함 STORY — tm_file + qa_rounds 재순회 + reporter 확장('qa'/'you')   ─┐ taskmanager.mjs
Task 2  기획 크로스 검수 — planning-audit kind(graph.mjs) + audit phase-Team    │ 공유, STORY 발행
        삽입 + reporter 확장('planning-audit') + 65-audit.md                   ┘ 경로 재사용 — 직렬
Task 3  릴리스 0.12.1                                                          — 전부의 위
```

- **파일 충돌**: Task 1·2 둘 다 `teams/mcp/taskmanager.mjs`를 건드리고, Task 2는 Task 1이 만드는
  STORY 발행 헬퍼(`fileDefects`)를 재사용하므로 순서가 고정이다 — 직렬.
- Task 2는 `teams/mcp/graph.mjs`(새 kind)도 건드리지만 다른 태스크와 겹치지 않는다.

---

### Task 1: 결함 STORY — `tm_file`, `qa_rounds` 재순회, `reporter` 컬럼 확장
**Files:** modify `teams/mcp/taskmanager.mjs` (새 함수 `fileDefects`, `TOOLS` 배열, `dispatch()`,
QA의 `accept:QA:1` 판정 이후 훅), modify `teams/mcp/tickets.mjs` (`epicBoardRows`의 `reporter`
필드), modify `teams/scripts/test-taskmanager.mjs`, `teams/scripts/test-tickets.mjs`
**Interfaces:** QA phase-Team의 `gate` 결과가 결함 목록(`result.defects: [{title, touches, deps,
evidence, severity}]`, §5b 그대로)을 내면, `accept:QA:1`이 판정된 직후 `fileDefects(task,
defects)`가 각 결함을 `openRepair`와 같은 모양으로(단 `repair: true` 대신 `reporter: 'qa'`,
새 develop 패키지) `task.spec.packages`에 push하고 `pushChain`으로 dispatch/accept를 열고, 새
`integrate:N+1`을 열고 `gate:goal`의 dep을 그리로 재배선한다(`openRepair`의 재배선 루프,
`taskmanager.mjs:459-463`, 그대로 재사용). **`qa_rounds` 캡**: 이미 발행된 QA 라운드 수(`QA`
패키지의 attempt 수)가 `T.qa_rounds`를 넘으면 결함을 새 STORY로 만들지 않고 `report`의 "미해결
결함" 절 데이터로만 `task.unresolved_defects`에 쌓는다. `tm_file({task_id, stories: [...]})` 도구를
새로 추가해 **사용자**도 같은 경로로 STORY를 직접 발행할 수 있게 한다(§14 결정 기록 C-9 계열,
`reporter: 'you'`) — §11이 `tm_file`을 "어느 단계에도 아직 배정 안 됐다"고 적어 둔 자리를 여기서
채운다. `epicBoardRows`의 `reporter`를 `p.reporter || (p.repair ? 'repair' : 'shape')`로
확장한다 — v0.12.0의 Task 6이 이미 만든 STORY 페이지 렌더러(`renderStory`, 패키지 단위)가 이
필드를 그대로 노출하므로 새 문서 렌더러는 필요 없다.
**Pass bar:** 표 테스트 — QA gate가 결함 1건을 내면 새 develop 패키지가 생기고 새
`integrate:2`가 `gate:goal`의 dep이 됨을 확인. `qa_rounds: 1`로 두 번째 결함이 나오면 새 패키지가
**생기지 않고** `task.unresolved_defects`에 쌓임을 확인. `tm_file` 도구 호출로 STORY가
`reporter: 'you'`로 생기는 왕복 테스트. `epicBoardRows`의 표 테스트에 `reporter: 'qa'`/`'you'` 행
추가.

- [ ] 1: 실패하는 테스트 작성(위 세 가지 케이스 + `epicBoardRows` 표 행).
- [ ] 2: `fileDefects` 구현(내부적으로 `openRepair`의 재배선 로직을 공유 헬퍼로 뽑아 `openRepair`와
  `fileDefects` 둘 다 호출 — 코드 중복 없이), `qa_rounds` 카운트·캡, `tm_file` 도구
  (`TOOLS`/`dispatch()`) 추가, `epicBoardRows`의 `reporter` 확장.
- [ ] 3: 테스트 통과 확인.
- [ ] 4: `git add teams/mcp/taskmanager.mjs teams/mcp/tickets.mjs teams/scripts/test-taskmanager.mjs teams/scripts/test-tickets.mjs && git commit -m
  "feat(teams): QA-found defects file a develop STORY and loop the EPIC back through integrate, capped by qa_rounds (§5b, decision #2)"`

---

### Task 2: 기획 크로스 검수 — `planning-audit` kind + audit phase-Team
**Files:** modify `teams/mcp/graph.mjs` (`KINDS`, `56-98`행 근방에 새 항목), modify
`teams/mcp/prompts.mjs`(audit 스테이지 프롬프트), modify `teams/mcp/taskmanager.mjs`
(QA 완료 또는 `integrate` 완료 훅에 audit phase-Team 삽입, Task 1의 `fileDefects` 재사용), modify
`teams/mcp/docs.mjs`(새 `renderAudit`, `renderAll` 확장), modify `teams/scripts/test-tickets.mjs`,
`teams/scripts/test-taskmanager.mjs`, `teams/scripts/test-docs.mjs` + golden 픽스처 확장
**Interfaces:** `graph.mjs`의 `KINDS.planning-audit = { chain: ['audit', 'gate'], reasoning: [],
skills: { audit: [...], gate: ['think:devils-advocate'] } }`(§0.4 발견 1이 채운 빈칸, `FLOWS`에도
`'audit'` 항목 추가, `kind: 'planning-audit'`). **게이트 조건은 `T.roles.planning` 하나뿐이다 —
`T.roles.qa`와 묶지 않는다(팀 리더 결정 #4, 2026-09-17).** 기획 크로스 검수는 결정 기록 #1이
그리는 흐름에서 **planning 자신의 두 번째 pass**다(§2: "planning Team은 EPIC 안에서 두 번 돈다
… 같은 Team 정체성이지만 run은 새로 연다") — QA라는 다른 역할의 스위치에 이 pass를 묶으면,
사용자가 QA만 끄고 싶었을 때 사용자가 요청하지도 않은 기획 단계까지 조용히 사라진다. 대신 **QA
리포트는 있으면 소비하고 없으면 생략한다**: audit의 briefing은 PRD·user_stories·통합 결과물은
항상 포함하고, `accept:QA:*` 노드가 존재하면(=`roles.qa`가 켜져 있었으면) 그 결과(`defects`,
`gate` 판정)를 추가로 얹는다 — 없으면 그 절만 빠진다. 삽입 시점은 `roles.qa`가 켜져 있으면 마지막
`accept:QA:N` 완료 뒤, 꺼져 있으면 `integrate` 완료 뒤(QA가 없으니 기다릴 QA 노드가 없다). 결과
STORY 발행은 Task 1의 `fileDefects`를 `reporter: 'planning-audit'`로 재사용한다. `gate:goal`의
dep을 `accept:AUDIT:1`로 재배선. `65-audit.md`(`renderAudit`)는 audit의 gate 결과(user story별
충족/미충족, 발행한 STORY 링크)를 렌더한다.
**Pass bar:** `planning`만 켜지고 `qa`는 꺼진 EPIC에서 `integrate` 완료 뒤 `dispatch:AUDIT:1`이
열리고 그 briefing에 QA 관련 절이 없음을 확인. `planning`+`qa` 둘 다 켜진 EPIC에서는 QA 완료 뒤
`dispatch:AUDIT:1`이 열리고 그 briefing에 QA 결과 절이 포함됨을 확인, audit gate가 미충족 user
story 1건을 내면 새 develop STORY가 `reporter: 'planning-audit'`로 생기고 `65-audit.md`에 그 링크가
나타남을 확인. `planning`이 꺼진 경우 audit phase-Team이 생기지 않음을 회귀로 확인. golden 파일
비교로 12/13 문서(`15-spec-gate.md` 제외 전부)가 렌더됨을 확인.

- [ ] 1: `graph.mjs`에 실패하는 kind 테스트(`KINDS['planning-audit']`의 체인·스킬 모양)와
  `taskmanager.mjs`에 위 세 케이스(qa 없이 audit, qa와 함께 audit, planning 꺼짐)의 실패 테스트,
  `test-docs.mjs`에 `65-audit.md` golden 파일 실패 테스트 작성.
- [ ] 2: `graph.mjs`의 `KINDS`/`FLOWS`에 항목 추가, `prompts.mjs`에 audit 스테이지 프롬프트
  (§0.4 발견 1이 채운 페르소나 재사용 + "판정만, 파일 변경 없음" 문구 명시 — planning의 `revise`와
  달리 audit은 수정 권한이 없다는 §2의 구분을 프롬프트에 못박는다), `taskmanager.mjs`에 audit
  phase-Team 삽입 로직 + `fileDefects` 재사용, `docs.mjs`의 `renderAudit`.
- [ ] 3: golden 파일 갱신(v0.12.0의 Task 6이 만든 픽스처에 audit 결과를 더한 버전) 확인.
- [ ] 4: 테스트 통과 확인.
- [ ] 5: `git add teams/mcp/graph.mjs teams/mcp/prompts.mjs teams/mcp/taskmanager.mjs teams/mcp/docs.mjs teams/scripts/test-tickets.mjs teams/scripts/test-taskmanager.mjs teams/scripts/test-docs.mjs teams/scripts/fixtures/docs-golden && git commit -m
  "feat(teams): planning-audit kind - a second planning pass cross-checks PRD/user stories against the integrated result and QA report, files STORYs on gaps (§2, §3, decision #1)"`

---

### Task 3: 릴리스 0.12.1
**Files:** modify `teams/.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`(teams
항목만), `teams/README.md`, `teams/KOR.md`
**Interfaces:** consumes Task 1-2 전부.
**Pass bar:** `node --test teams/scripts/test-*.mjs` 전부 통과(회귀 0), `python3
scripts/validate_plugins.py` ERROR 0, 두 매니페스트 0.12.1 일치, README·KOR Status 첫 항목이
v0.12.1.

- [ ] 1: `git fetch skills main && git status -sb` — origin이 앞서 있으면 rebase.
- [ ] 2: `node --test teams/scripts/test-*.mjs 2>&1 | tail -8` → `# fail 0` 확인.
- [ ] 3: patch 범프: teams `"version": "0.12.0"` → `"0.12.1"`; marketplace description에
  "QA-found defects file a develop STORY and loop the EPIC back through integrate (capped by
  qa_rounds); a second planning pass cross-checks the integrated result and QA report against
  the PRD and files STORYs on gaps." 추가.
- [ ] 4: README/KOR `## Status` 맨 위에 한 줄 prepend(v0.12.0 항목 등 기존 내용은 그대로 아래에
  둔다).
- [ ] 5: 설계 문서(`docs/plans/2026-09-17-teams-team.md`) §11의 v0.12.1 행을 "완료"로 표시하는
  것은 이 계획 파일 소유가 아니다 — 팀 리더나 그 갱신을 맡은 agent의 몫.
- [ ] 6: `python3 scripts/validate_plugins.py` ERROR 0 확인.
- [ ] 7: `git add teams/.claude-plugin/plugin.json .claude-plugin/marketplace.json teams/README.md teams/KOR.md && git commit -m
  "feat(teams): 0.12.1 - defect STORYs (tm_file, qa_rounds loop) and planning cross-review (planning-audit kind)"`
- [ ] 8: `git push skills main`(실패하면 1번으로 돌아가 fetch·rebase 후 재시도).

---

## 자기 검토 (v0.12.1)

- **이 절의 Task 1·2는 원래 단일 릴리스 초안의 Task 6·7과 기능적으로 동일하다** — 쪼갠 것은
  일정·릴리스 경계이지 설계가 아니다. 유일한 실질 변경은 Task 2의 게이트 조건(팀 리더 결정 #4:
  `roles.planning`만, `roles.qa`는 소비만).
- **v0.12.0이 먼저 릴리스돼 있어야 한다.** 이 절의 모든 Task는 `pkg.phase`/`packageOf` 합성 패턴,
  `expandPackages`의 QA 삽입 지점, `docs.mjs`의 `renderStory`/`renderQa` 등 v0.12.0의 산출물을
  전제한다 — v0.12.0 없이 이 절만 코딩할 수 없다.
- **위험**: Task 1(결함 STORY)과 Task 2(크로스 검수) 둘 다 같은 `fileDefects` 헬퍼로 STORY를
  발행한다 — 한 EPIC에서 결함 STORY 재순회 도중에 크로스 검수가 겹쳐 걸리면(둘 다 `integrate`를
  다시 열려는 시점이 겹치면) 어느 쪽 `gate:goal` 재배선이 이기는지 명시적으로 정하지 않았다. 이
  계획은 audit을 "QA의 마지막 attempt 완료 뒤"로 고정해 순서를 강제하지만, `qa_rounds` 캡에 걸려
  QA가 끝나지 않은 채로 audit이 열리는 경계 조건은 Task 2의 테스트가 명시적으로 그려봐야 한다 —
  코드를 실행하지 않고 예측하는 것보다 이 편이 맞다(v0.11.0과 같은 이유).
- **위험**: `tm_file`(사용자 직접 STORY 발행)이 `qa_rounds` 캡과 상호작용하는지는 이 계획이
  명시하지 않았다 — 사용자가 직접 STORY를 발행하는 것은 QA 라운드가 아니므로 캡에서 제외했지만,
  이것도 이 계획의 판단이라 팀 리더가 다르게 볼 수 있다.
