# teams — sub-EPIC: 패키지가 다시 task가 되는 재귀 중첩 (검토용 초안)

> 상태: **폐기 (2026-09-28)**. 애자일에 sub-EPIC은 없다 — 한 Sprint에 안 끝나는 일은 다음 Sprint로 이월한다.
> 대체: `2026-09-28-teams-sprint-not-sub-epic.md`. 아래는 기록용으로만 남긴다.
>
> (원래 상태: 검토용. 코드 변경 없음. 2026-09-28.)
> 선행: `2026-09-17-teams-team.md` §2 프랙탈 규칙, §7 재개 표의 sub-EPIC 행, §8b 판정표("아직 설계 부족")와
> v0.14.0 행의 **narrowed(2026-09-28)** 판정, `2026-09-17-teams-roadmap-sizing.md` §3·§4.4(§8b 결정 2개 대기),
> `2026-09-21-teams-server-owns-the-loop.md` §3(자식 런은 체인만)·§10 논점 3(`parent_shaped`),
> `2026-09-28-teams-light-plan.md` §6(`task.decisions`, 형제 에이전트가 구현 중).
> 대상: 09-17 §8b가 미뤄 둔 두 결정 — **자식 EPIC의 워크트리 기준점**, **자식 report가 부모 accept로 접히는 형식** — 을 닫고,
> 그 위에 감지·깊이·예산·결정 전파·사람 대기·티켓 키·Initiative를 한 번에 정한다.

## 0. 왜 — `max_depth`라는 이름표는 있는데, 그 이름이 가리키던 것은 없다

09-17 설계의 프랙탈 규칙은 "STORY를 L로 재면 자기 STORY 아래에 sub-EPIC을 연다(`tm_open`을 자식이 호출, `parent: {task_id, package_id}` 기록), 깊이 캡 `max_depth` 기본 2"였다(`2026-09-17-teams-team.md:88-91`). v0.14.0으로 실제 나간 것은 그보다 좁다 — 같은 문서 v0.14.0 행 아래 narrowed 판정(`:684-697`)이 이미 적어 둔 대로, **패키지의 자식은 여전히 graph.mjs 런 하나**이고, `split: true`/`size: 'L'`은 그 런 하나가 plan/setgoal/critique 껍데기를 켜고 **한 워크트리 안에서** 서브골로 쪼개는 것뿐이다. 워크트리가 여럿 필요하고 그 사이를 integrate해야 하는 패키지 — 즉 "이 STORY 자체가 작은 EPIC" — 는 지금 표현할 길이 없다.

그 결과 두 가지 실패 모양이 남는다:

- **shape가 억지로 평평하게 편다.** CONTRACT.shape는 "Every package must be size S on its own - if one still needs splitting, the shape is wrong"(`taskmanager.mjs:327`)이라 말한다. 두 소유 경계를 가진 덩어리는 부모 레벨에서 4~6개 패키지로 펼쳐지고, 그 사이의 내부 seam(덩어리 안쪽의 계약)이 부모의 integrate·critique에 섞여 부모 판정이 무거워진다.
- **아니면 `split: true`로 한 워크트리에 몰아넣는다.** 그러면 그 안의 서브골 둘이 같은 트리에 쓰고, 소유가 겹치면 자식의 `reduce`가 `collisions`로 신고하는 것(`taskmanager.mjs:2806-2823`, foldChild의 `set_findings`)이 최선이다 — integrate의 머지 충돌처럼 **사실로 관찰**되는 게 아니라 판정으로 추정된다.

로드맵 사이징 문서는 이 단계를 "§8b 결정 2개가 답해지기 전에는 v0.14.0의 어떤 숫자도 짐작"(`2026-09-17-teams-roadmap-sizing.md:105`)이라 적고 멈췄다. 이 문서는 그 두 결정을 코드가 이미 가진 부품으로 답한다 — 새 메커니즘은 최소로.

## 1. 진단 (코드에서 확인한 사실)

1. **깊이는 배선돼 있으나 한 번도 0이 아닌 적이 없다.** `createTask`는 `a.depth`를 받고(`taskmanager.mjs:450`), 주석이 "Nothing in this codebase opens a nested tm_open yet"라고 인정한다(`:476-481`). 자식 graph 런에는 `child_opts.depth: depth + 1`(`:537`) → `createRun`의 `run.depth`(`graph.mjs:652`). `openChild`는 `depthForced = task.depth >= max_depth`(`taskmanager.mjs:2655-2657`)로 `split` 탈출구를 막는다. `TEAM_DEFAULTS.max_depth: 2`(`teamconfig.mjs:47`)와 그 주석(`:40-46`)도 같은 얘기. README는 아직 "recorded-but-inert … nothing enforces it yet"(`teams/README.md:657`)이라 적는데, 정확히는 **강제 코드는 있고 트리거(depth>0인 task)가 없다.**
2. **`split`/`size:'L'`은 "껍데기를 켠 graph 런"이지 task가 아니다.** `needsSplit = pkg.split === true || pkg.size === 'L'`, `parentShaped = !isPhaseTeam && (depthForced || !needsSplit)`(`taskmanager.mjs:2653-2658`) → 어느 쪽이든 `createRun`(`:2659`)이고 `n.child = { cwd, run_id, branch, flow, based_on }`(`:2688`). 워크트리는 `ensureWorktree(task, pkg.id, …)` 하나(`:2590`).
3. **task.json은 그 자체로 run이다.** `runState`는 `.nodes`만 있으면 task에도 그대로 돌고(`graph.mjs:1618`, 주석 `:1678-1680`), task 레벨에서도 `waiting_human`을 돌려준다(`graph.mjs:1682-1684`). `openAsk`/`answeredDecisions`도 task에 그대로 쓰인다(`taskmanager.mjs:3787-3798`). 즉 **"자식이 task인 dispatch"의 상태 판독은 대부분 기존 함수로 된다.**
4. **워크트리 기준점을 바꾸는 손잡이가 이미 있다.** `task.base_ref`(`taskmanager.mjs:471-472`)는 패키지 워크트리(`openChild`의 `task.base_ref || 'HEAD'`, `:2590`)와 integration 워크트리(`prepareIntegration`, `:3002`) 양쪽의 출발점이다. 지금은 `priorRetroContext`(`:394-432`)만 채운다.
5. **브랜치 이름이 task id로 네임스페이스돼 있다.** `harness/${shortId(task.run_id)}/${name}`(`taskmanager.mjs:1694`) — 자식 task의 패키지 브랜치 `harness/<c8>/P1`은 부모의 `harness/<p8>/P2`와 충돌하지 않는다. 같은 저장소(`git worktree add`를 `task.cwd`에서, `:1704-1707`)면 추가 격리가 필요 없다.
6. **비용은 task 디렉터리 단위로만 합산된다.** `taskSpend = collectTaskCosts(taskDir(task.run_id), task).cost_usd`(`taskmanager.mjs:4795-4797`) → `collectDriverCosts(taskDir)` + `taskRunDirs(task)`가 `n.child.{cwd,run_id}`로 찾은 broker 디렉터리(`scripts/bench/lib/drivercost.mjs:170-176, 203-218`). **자식 task의 driver·노드 비용은 부모 합계에 들어가지 않는다** — 그대로 두면 부모의 `budgetStatus`(`:4809`)/`enforceBudget`(`:4948`)이 자식 지출을 못 본다.
7. **사람 카드 수집은 한 층만 내려간다.** `toolInbox`는 task 자신의 노드 + 각 패키지의 최신 dispatch가 가리키는 **graph 런** 하나만 읽는다(`taskmanager.mjs:4539-4568`, `loadRun(dispatch.child.cwd, dispatch.child.run_id)`). `task_id` 없이 부르면 tasksRoot 전체를 돌기 때문에 자식 task의 카드가 **최상위 EPIC 카드처럼** 따로 보이게 된다.
8. **보드·Initiative는 모든 task를 평평한 EPIC 목록으로 본다.** `toolBoard`(`taskmanager.mjs:4238-4260`)와 `ticketForInitiative`(`:4316-4328`)는 tasksRoot의 모든 task.json을 EPIC 행으로 만든다 — 자식 task가 생기면 부모 밑이 아니라 옆에 뜨고, initiative를 물려받으면 비용이 이중 집계된다.
9. **티켓 키 파서가 중첩을 우연히 삼킨다.** `parseTicketKey`의 세 번째 그룹이 `(.+)`(`tickets.mjs:46`)라 `E-p8/P2/E-c8/P1`은 `subgoalId = "E-c8/P1"`로 파싱된다 — 에러도 해석도 없이.
10. **`task.decisions`는 아직 코드에 없다.** `grep task.decisions` 0건, 형제 브랜치 `teams/decisions-brainstorm`도 현재 main 대비 teams 변경 0건. 이 문서는 light-plan §6.2/§6.5의 **명세**(`{question, chose, owner, decided_in, source}`, `tm_open({decisions})`)에 맞춘다.

> 곁가지(형제 작업자용): light-plan 문서가 인용한 줄 번호 일부가 이후 커밋으로 밀렸다 — `childContext` 1955→**2016**, `openChild` 2504→**2565**(`context:` 2663), PLAN 게이팅 `nodes: T.roles.planning ?` ~544-551→**586-592**, 매니저 질문의 `task.unasked` 3719-3740→**3787-3798**. `graph.mjs` 쪽 인용(1052/1069/1085/1843/1851)은 그대로 맞다.

## 2. 결정

### 2.1 무엇이 sub-EPIC이 되나 — 선언은 shape가, 판정은 구조 검사가

`size`의 두 값이 지금은 한 동작(`needsSplit`)의 별칭이다. 이걸 가른다:

| shape가 쓴 것 | 의미 | 자식 |
|---|---|---|
| (없음) | 평범한 STORY | `parent_shaped` 체인 런 (현행) |
| `split: true` | **한 워크트리**, 서브골 여럿 | 껍데기 켠 graph 런 (현행 그대로) |
| `size: 'L'` | **소유 경계가 둘 이상**, 워크트리 여럿 + integrate 필요 | **sub-EPIC 후보** → 아래 검사 통과 시 자식 task |

`size: 'L'`은 선언일 뿐이다(모델 판단 — 매니저의 `size` 노드가 그렇듯). 엔진은 다음 **결정론적 검사**를 전부 통과할 때만 자식 task를 연다(`openChild`의 `parentShaped` 계산 바로 앞, `:2653` 부근). 하나라도 실패하면 **`split: true`로 강등**하고 `sub_epic_demoted {package_id, reason}` 이벤트를 남긴다 — 강등된 결과는 오늘의 `size:'L'` 동작과 바이트 단위로 같다(하위호환이 곧 안전한 실패 방향).

- **(a) 기능 스위치.** `team.opts.sub_epic`(신설, §2.9)이 켜져 있음.
- **(b) 소유 경계 ≥ 2.** 패키지의 `touches[]`를 `touchScope`로 정규화했을 때 서로 `scopesOverlap`하지 않는 스코프가 둘 이상(`taskmanager.mjs:647-655`, shape 검증이 이미 쓰는 바로 그 두 함수). 스코프 하나짜리는 여러 워크트리로 나눌 소유선이 없으므로 sub-EPIC이 의미 없다 — `split`이 맞다.
- **(c) 깊이.** `task.depth + 1 < max_depth`. 기본 `max_depth: 2`에서 **루트(0) 아래 한 층(1)만** 열린다. 층 1의 패키지는 여전히 `split`은 쓸 수 있다(`depthForced`는 `1 >= 2` 거짓) — 기존 `depthForced` 의미는 건드리지 않고, sub-EPIC만 한 단계 더 보수적으로 막는다. §5-1 참고.
- **(d) 종류.** phase-Team(PLAN/QA/AUDIT)·repair 패키지는 절대 안 됨 — `isPhaseTeam`(`:2653`)과 같은 조건.
- **(e) 예산 여유.** 박스(`budget_usd`/`timebox_minutes`)가 있으면 §2.4의 자식 배정액이 하한(`sub_epic_min_usd`, 기본 = 부모 예산의 15%) 이상일 것. 못 미치면 강등 — 자식 task의 고정비(size 없음, shape+critique+integrate+gate:goal+report 5 판정)가 배정액을 먹어 버리는 걸 막는다.

**재측정 없음.** 자식 task는 `size_pinned: 'L'`, `size_pin_source: 'parent'`(`createTask`의 기존 필드, `:484-485`)로 열린다 — (b)가 이미 L의 구조 전제를 확인했다. 자식의 shape가 그래도 패키지 하나를 내면 `validateShape`가 "size S" 문제로 거부하고(`:666`), 재시도가 다하면 자식은 blocked → 부모 accept 실패 → **부모의 다음 시도는 그 패키지를 `split`으로 강등해서 연다**(`n.sub_epic_demoted`를 재시도 노드에 복사). 모델 판단이 틀렸을 때의 비용은 자식 1회분이고, 두 번 틀리지는 않는다.

**CONTRACT 수정(둘).** shape의 `split` 문장(`:327`)을 위 표로 바꾸고 "`size: 'L'`은 touches[]가 서로 독립된 소유 경계 둘 이상을 가질 때만"을 명시. critique의 "a package too large to be one run" 공격(`:331-332`)에 "선언된 `size:'L'`이 (b)를 통과했으면 크기 자체는 결함이 아니다 — 경계가 진짜인지를 보라"를 덧붙인다.

### 2.2 자식 task를 여는 법 — `tm_open`이 아니라 `createTask` 직접 호출

자식은 **도구 호출이 아니라 함수 호출로** 연다(`openChild` 안에서 `createTask({...})`). 09-17 §2는 "`tm_open`을 자식이 호출"이라 했지만, 09-21 §2(서버가 루프를 소유)가 그 뒤 모든 개설을 서버로 옮겼다 — 자식 모델이 도구로 task를 여는 경로는 만들지 않는다. "재귀는 프로세스 트리로만, 컨텍스트로는 절대 올리지 않는다"(`2026-09-17-teams-team.md:91`)는 그대로: 자식 task는 **자기 daemon**(`spawnDaemon`, `:2475`)을 가진다.

자식 task.json의 신설/고정 필드:

```js
parent: { task_id, package_id, node_id, key: 'E-<p8>/P2' },   // 09-17 §7 재개 표의 `parent`
depth: parent.depth + 1,
cwd: parent.cwd,                    // 프로젝트 루트 — 워크트리 아님 (§2.3)
base_ref: <부모 패키지 브랜치>,     // harness/<p8>/P2
request: pkg.brief, context: <childContext(부모, pkg) + 부모 PRD 경로 + implements[]>,
size_pinned: 'L', size_pin_source: 'parent',
roles: { planning: false, qa: false, audit: false },   // phase-Team은 루트만 (§2.6)
initiative: null,                   // §2.8
decisions: <부모 task.decisions 스냅샷>,               // §2.5
team.opts: <부모의 해석된 opts 복사 + 예산 배정 (§2.4)>  // team.json을 다시 읽지 않는다
```

부모 dispatch 노드에는 `n.child = { kind: 'task', task_id, cwd: <부모 패키지 워크트리>, branch: <부모 패키지 브랜치>, based_on }` — **`run_id` 필드를 두지 않는다.** `taskRunDirs`(`drivercost.mjs:172`)가 `run_id` 있는 child만 broker 디렉터리로 읽으므로, 자식 task id를 거기 넣으면 존재하지 않는 경로를 조용히 읽는다. `kind: 'task'`가 모든 분기(`dispatchSettled`, `foldChild`, `serviceRunningDispatches`, `toolInbox`, 비용)의 스위치다.

### 2.3 워크트리·브랜치 소유와 integrate 순서 (§8b 결정 1)

**기준점 = 부모 STORY 브랜치.** 09-17 §8b가 괄호로 적어 둔 답("부모 STORY 브랜치")을 그대로 택하고, 기존 `base_ref`로 구현한다:

```
부모 openChild(P2):  ensureWorktree(부모, 'P2', deps 브랜치 || base_ref || HEAD)   ← 현행 그대로
                     → harness/<p8>/P2   (부모 deps의 결과가 이미 머지된 상태)
자식 createTask:     base_ref = harness/<p8>/P2, cwd = 부모.cwd
  자식 P1..Pk:       ensureWorktree(자식, 'Pi', … || base_ref)  → harness/<c8>/Pi
  자식 integrate:    ensureWorktree(자식, 'integration', base_ref) → harness/<c8>/integration
부모 fold(P2):       부모 P2 워크트리에서 git merge --ff-only harness/<c8>/integration
                     → commitWorktree (현행 :2937) — 커밋할 게 없으면 ok+null (:1775)
부모 integrate:      dependencyOrder대로 harness/<p8>/P2를 머지 (현행 그대로)
```

- **소유의 중첩은 구조로 강제한다.** 자식의 `validateShape`에 한 규칙을 더한다: 자식 패키지의 모든 `touches[]` 스코프는 부모 패키지 `touches[]` 중 하나에 포함돼야 한다(같은 `touchScope`/`scopesOverlap`의 포함 방향). 위반은 shape 문제 — 자식이 부모의 형제 패키지 영역을 쓰는 것을 dispatch 전에 막는다. 자식의 repair 패키지는 현행대로 자식 integration 트리 전체를 소유하되, 그 트리 자체가 부모 P2의 범위다.
- **ff-only인 이유.** 자식 integration 브랜치는 `base_ref`(= 부모 P2 브랜치)에서 갈라졌고 그동안 P2 워크트리에는 아무도 쓰지 않는다(부모 dispatch가 running인 동안 P2 워크트리의 작성자는 자식 task뿐). 그러므로 ff가 항상 가능해야 하고, **ff가 안 되면 그 자체가 불변식 위반**이다 — 머지 커밋으로 덮지 않고 fold를 `stage_ok:false, reason: 'sub-EPIC integration branch is not a descendant of P2'`로 실패시킨다.
- **"자식의 결과 브랜치"의 정의.** 자식의 마지막 `gate:goal`이 settled accept인 라운드의 `integrate` 노드의 `n.integration.branch`(repair 라운드면 `integration-N`). `priorRetroContext`가 이미 "마지막 done integrate의 integration.branch"를 읽는 것(`:415-420`)과 같은 규칙.
- **integrate 순서.** 자식의 integrate → 자식 gate:goal → 자식 report → 부모 fold(ff) → 부모 `accept:P2` → (P2에 deps를 건 부모 패키지들 dispatch) → 부모 integrate. 부모의 `dependencyOrder`와 `accept:<dep>` 간선은 손대지 않는다 — 자식 task 전체가 부모 그래프에선 여전히 `dispatch:P2` 노드 **하나**다.
- **정리.** `tm_clean`(`cleanTask`, `:1848`)은 부모에서 자식으로 캐스케이드한다: 자식 패키지 워크트리는 자식 integration 브랜치에 도달 가능할 때, 자식 integration 워크트리는 부모 P2 브랜치에 도달 가능할 때만(`branchReachableFrom`, `:1834`와 같은 판정) 지운다.

### 2.4 깊이와 비용 — 예산은 물려받고, 초과는 위에서 아래로 죽인다

- **합산은 재귀.** `taskSpend(task)` = 자기 `collectTaskCosts` + Σ `taskSpend(자식 task)` (dispatch 노드 중 `child.kind === 'task'`, 모든 시도). `budgetStatus`/`enforceBudget`/`tm_board`의 `cost`/`ticketForInitiative`의 비용이 전부 이걸 통해 자식을 본다. 새 파서는 없다 — 같은 함수를 자식 task 디렉터리에 다시 부를 뿐.
- **배정은 개설 시점 스냅샷.** 자식의 `budget_usd = (부모 budget_usd − 부모 taskSpend) × (1 − sub_epic_reserve)`, `timebox_minutes`도 같은 식(남은 분). `sub_epic_reserve` 기본 0.2 — 부모가 자식 뒤에 아직 치러야 할 fold·accept·integrate·gate:goal·report 몫. 부모에 박스가 없으면 자식도 없음(현행 무제한과 동일).
- **킬은 위에서 아래로.** 부모 `enforceBudget`이 `budget_stopped`를 세우는 그 자리에서, running인 모든 자식 task에 `budget_stopped = { …, cascaded_from: <부모 key> }`를 같이 쓰고 저장한다. 자식 daemon은 다음 틱의 `enforceBudget`(`daemon.mjs:323`)에서 이를 보고 **자기 레벨의 기존 규칙 그대로**(새 dispatch 금지, in-flight 완료, 수락된 것만 재통합, `closeStoppedToReport`로 report) 수렴한다. 새 정지 의미론은 없다 — 기존 정지를 한 층 아래에 복사할 뿐.
- **자식이 먼저 자기 배정을 다 쓰면** 자식만 정지한다(부모는 계속). 자식의 부분 결과가 부모 fold로 올라오고, 부모 accept가 판정한다.
- **동시성은 루트가 소유.** 부모의 `runningStories`(`:5234`)는 sub-EPIC dispatch를 1로 세지 않고 **자식이 지금 돌리는 STORY 수(재귀)**로 센다. 자식은 개설 시 `max_parallel_teams = max(1, 부모 상한 − 부모의 다른 running STORY 수)`를 **숫자로 고정**해 받는다(숫자는 AIMD가 덮지 않는다, `:5227-5233` 주석). 이걸로 트리 전체 동시 driver 수가 루트 상한을 넘지 않는다 — v1은 스냅샷, 동적 재배분은 §6-3.

### 2.5 `task.decisions`의 전파 — 아래로는 스냅샷, 위로는 fold 시점 병합

light-plan §6과 같은 두 원칙(참조가 아니라 스냅샷, 한 번 정한 건 계속 정한 것)을 한 층 더 적용한다.

- **아래로(개설 시).** 자식 `createTask`에 부모의 `task.decisions` 전체를 §6.5-2의 `tm_open({decisions})` 입력 경로 그대로 넘긴다. 각 항목은 원래 `source`/`decided_in`을 보존하고 `inherited_from: 'E-<p8>'`만 붙인다. **sub-EPIC은 §6.5-2 경로의 첫 번째 비-사람 호출자**가 될 뿐이라 새 배선이 없다. 자식의 패키지 런은 §6.2-2대로 자식 `task.decisions`를 받으므로 부모 결정이 손자까지 닿는다.
- **자식에서 brainstorm은 절대 열지 않는다.** §6.5-3은 "`decisions[]`가 이미 오면 열지 않는다"인데, 부모 결정이 비어 있을 수도 있으므로 조건을 **`parent`가 있으면 열지 않는다**로 명시한다. 자식의 요청은 부모 shape가 쓴 brief이지 사람의 프롬프트가 아니다.
- **자식의 PLAN은 꺼져 있으므로**(§2.6) §6.2-1의 "accept:PLAN 시점 기록"은 자식에서 발생하지 않는다. 자식에서 새로 생기는 결정은 실행 단계 결정뿐이다 — §6.2-3대로 기본값 채택 + 기록.
- **위로(fold 시).** 부모 `foldChild`가 자식 task를 접을 때, 자식 `task.decisions` 중 `inherited_from`이 없는 항목(자식이 새로 정한 것)을 `decided_in: 'E-<c8>'`로 부모 `task.decisions`에 덧붙인다(질문 문자열 정확 일치로 중복 제거). 아직 dispatch 안 된 부모 형제 패키지는 이걸 받고, 이미 돌고 있는 형제는 받지 않는다 — §6.2-2의 스냅샷 규칙과 같다.
- **모순은 구조로만.** 자식 investigate가 `contradicts_decision`(§6.2-3a)으로 **상속된** 결정과의 충돌을 신고하면 blocking이다 — 부모가 정한 것을 자식이 조용히 뒤집을 수 없다.

### 2.6 자식 task의 형태 — 판정 노드는 전부, phase-Team은 없음

자식은 `size`(pinned) → `shape` → `critique` → `dispatch/accept × k` → `integrate` → `gate:goal` → `report`. **PLAN/QA/AUDIT는 끈다**: PRD는 부모가 이미 썼고(자식 context에 PRD 경로와 패키지의 `implements[]` 스토리만 넣는다), QA와 audit은 부모의 integration 트리에서 sub-EPIC 결과를 포함해 한 번 돈다(`expandPackages`의 QA 삽입, `:808-820`). 자식 레벨에서 또 돌리면 같은 트리 부분집합을 두 번 검사하는 것이다. `human_gates`/`interactive`/`retry_policy`/`goal_threshold`는 부모 해석값을 그대로 물려받는다.

### 2.7 자식 결과를 부모 accept로 접는 형식 (§8b 결정 2)

`foldChild`에 `child.kind === 'task'` 분기를 둔다. 반환 모양은 **기존 `base`와 같은 키**(`:2864-2875`)를 채워 `composeTaskPrompt`의 "What the child run delivered"(`:3323` 이하)가 수정 없이 읽게 하고, 추가 정보는 `sub_epic` 한 필드에 모은다:

| 기존 키 | sub-EPIC에서의 값 |
|---|---|
| `child_run_id` | 자식 task id (브리핑 문구 호환용; `sub_epic.key`가 정식) |
| `child_state` / `child_counts` | `taskState(자식)` — `runState` 그대로 |
| `accept` / `match_pct` / `gaps` / `spec_drift` | 자식 `runState(task).goal_verdict` — 자식 gate:goal의 합의(판정자 여럿이어도, `:2793-2805`와 같은 이유) |
| `changed_files` | `git diff --name-only <base_ref>..<자식 결과 브랜치>` — 노드 결과를 재귀로 긁지 않고 git이 사실로 답한다 |
| `report` | 자식 report 노드의 `handoff` |
| `upstream_defects` | 자식 accept들이 모은 것 중 **부모 형제 패키지**를 가리키는 것만(자식 내부 패키지를 가리키는 건 자식 안에서 이미 처리됨) |
| `commit` | ff 후 `commitWorktree` 결과 |

```js
sub_epic: {
  key: 'E-<c8>', depth, packages: [{ id, accepted, match_pct, attempts }],
  integrate: { branch, verified, unowned, duplication },   // 자식 integrate의 판정 요약
  spend_usd, budget_stopped: bool, decisions_added: n,
}
```

**accept 규칙.** 자식 `complete`이고 goal_verdict accept → ff + 커밋 → `accept: true` 후보(부모 `accept:P2` 판정자가 최종). `complete` + `settled: true`(unreachable>0) 또는 `blocked` → `accept: false`, `gaps`에 자식이 수락 못 한 패키지 목록, `reason`에 자식 report 요약. 부모 accept 판정자에게는 `ACCEPT_EXTRA.sub_epic`(`:363`과 같은 방식) 한 문장: "아래 sub-EPIC 표의 패키지별 결과는 자식 gate:goal이 이미 판정했다 — 이 패키지의 acceptance와의 차이만 판정하라, 자식 내부를 다시 판정하지 마라."

**재시도.** 부모 `retryPackage`가 sub-EPIC 패키지를 다시 열 때 자식 task를 되살리지 않고 **새 자식 task**를 연다: `context_from: <이전 자식 task id>`(`priorRetroContext`가 retro.json을 context로 접는다, `:394`). `retry_policy: 'continue'`면 새 자식의 `base_ref`를 이전 자식의 결과 브랜치로, `'rollback'`이면 부모 P2 브랜치로. §2.1의 "두 번째 시도는 split으로 강등"은 이전 자식이 **shape 단계에서** 막혔을 때만 적용한다(패키지 단계에서 막혔으면 경계 선언은 맞았던 것).

### 2.8 사람 대기(ask / waiting_human)의 버블링

- **정지는 이미 맞다.** 자식 task가 `waiting_human`이면 `runState`가 그렇게 말하고(`graph.mjs:1682-1684`), 부모 `dispatchSettled`는 `waiting_human`을 settled로 보지 않는다(`taskmanager.mjs:2726`) — 사람의 응답 시간을 패키지 실패로 세지 않는 현행 규칙이 그대로 적용된다. 필요한 건 **보이게** 하는 것뿐이다.
- **inbox는 재귀.** `toolInbox`(`:4539`)가 `dispatch.child.kind === 'task'`를 만나면 자식 task에 대해 자기 자신을 부르고, 돌려받은 카드의 `key`를 부모 경로로 접두한다(§2.9). `task_id` 없는 전체 호출에서는 `parent`가 있는 task를 최상위 순회에서 건너뛴다 — 같은 카드가 두 번 뜨지 않게.
- **답은 어디로 가도 같은 노드로.** `tm_submit({key})`는 중첩 키를 자식 task의 노드로 해석한다(§2.9 파서). 답은 자식 `task.decisions`에 쓰이고, §2.5의 fold 병합보다 **먼저** 즉시 루트까지 위로 복사한다(`decided_in: 'E-<c8>'`) — 사람이 한 번 답한 것을 부모의 아직 안 열린 형제가 다시 묻지 않도록. 이것이 §6.2-4 "blocking은 EPIC에서 한 번만"의 재귀판이다: 카드는 그 결정을 소유한 가장 가까운 EPIC(자식)에 서지만, 효력은 루트까지 간다.
- **상태 표면.** 부모의 `tm_status`/`tm_wait` 델타에 `waiting_human_below: ['E-<p8>/P2/E-<c8>/...']`를 싣는다. 부모 자신의 state 문자열은 `running`으로 둔다(부모 그래프에서 그 dispatch는 실제로 running이다) — 상태 의미를 바꾸지 않고 정보만 더한다.
- **비대화형이면** 현행과 같다: 자식에서도 기본값 + `unasked` 기록, 루트 report의 "엔진이 스스로 정한 것" 목록(§6.5-3)에 자식분이 `E-<c8>` 태그로 합류한다.

### 2.9 보드·티켓 키

09-17 §4가 정한 키를 쓴다: **`E-<p8>/P2/E-<c8>`**가 sub-EPIC, 그 아래는 `E-<p8>/P2/E-<c8>/P1`, `…/P1/U2`.

- **파서.** `parseTicketKey`(`tickets.mjs:42-49`)에서 세 번째 세그먼트가 `^E-[0-9a-f]{8}(/|$)`로 시작하면, 앞의 `E-<p8>/P2`를 `via`로 기억하고 나머지를 재귀 파싱한다. 해석 결과는 자식 키(`E-<c8>/P1/U2`)와 같은 대상 + `via` 체인. `via`의 각 단계가 실제로 `parent` 관계인지 검증하고 아니면 에러(엉뚱한 경로 별칭 방지).
- **정식 키는 짧은 쪽.** `E-<c8>/…`만으로도 어디서나 해석된다(`findEpicByPrefix`는 tasksRoot 전체의 8-hex 접두 매칭, `:4282-4288`). 긴 경로 키는 표시·탐색용 별칭. 보드 행은 긴 키로 **표시**하고 둘 다 받는다.
- **보드.** `tm_board()`(전체)는 `parent` 있는 task를 최상위 행에서 뺀다. `tm_board({task_id: 부모})`의 STORY 행에서 sub-EPIC 패키지는 `sub_epic: 'E-<c8>'`, 자식의 `epicTicketState`/`epicPhase`, 재귀 비용을 싣는다. 부모 STORY md는 자식의 `INDEX.md`로 링크한다(09-17 §7c `:442`의 결정 그대로). 자식 문서는 `docPaths(자식)` = `<부모.cwd>/<docs_dir>/E-<c8>/`에 부모 문서와 나란히 생긴다(cwd를 프로젝트 루트로 둔 이유 중 하나).

### 2.10 Initiative와의 관계 — 위로의 그룹핑과 아래로의 재귀는 직교한다

Initiative(`1cad2a0`)는 **실행이 읽지 않는 표시 전용 그룹**이다(`teamconfig.mjs:163-170`, `createTask`의 주석 `:462-466`). sub-EPIC은 **실행 재귀**다. 섞지 않는다:

- 자식 task는 `initiative: null`로 연다. `tm_open`/`createTask`에 `parent`와 `initiative`가 같이 오면 `initiative`를 버리고 `team.notes`에 남긴다(조용히 무시하지 않는다 — v0.13.0 `human_scope` 강등과 같은 태도).
- 계층은 `Initiative (optional) > Epic > Story | sub-Epic > Story > Sub-task`. `ticketForInitiative`(`:4316`)는 `parent` 없는 EPIC만 모으고(자식은 `initiative`가 null이라 자연히 빠진다), 각 EPIC의 비용은 §2.4의 재귀 합계 — 이중 집계 없음.
- **Initiative를 "EPIC들의 부모 task"로 승격하지 않는다.** Initiative 아래 EPIC들은 서로 다른 `tm_open` 호출이고 공유 integrate가 없다. 그 사이를 이어 주는 건 이미 `context_from`/`base_ref`(`:394-432`)다. sub-EPIC이 생겼다고 Initiative를 실행 계층으로 끌어올리면 두 번째 재귀가 생긴다.

### 2.11 설정 표면

```
team.json / tm_open:
  sub_epic:          false | 'auto'     (v1 기본 false — §3 측정 전까지)
  max_depth:         2                  (의미 명확화: sub-EPIC은 depth+1 < max_depth일 때만)
  sub_epic_reserve:  0.2                (부모 잔액 중 자식에게 주지 않는 몫)
  sub_epic_min_usd:  null → 부모 budget_usd × 0.15
```

`sub_epic: false`면 `size:'L'`은 오늘처럼 `split`과 같다 — 기존 테스트 전부 무수정 통과가 v1의 조건.

## 3. 단계

1. **판독 계층(부작용 없음).** `n.child.kind === 'task'`를 읽는 쪽부터: `dispatchSettled`, `taskSpend` 재귀, `parseTicketKey` 중첩, `toolBoard`/`ticketForInitiative`의 `parent` 필터, `toolInbox` 재귀. 이 단계는 자식 task를 여는 코드 없이 손으로 만든 task.json 픽스처 두 개로 전부 테스트된다.
2. **감지.** §2.1 (a)–(e) 순수 함수 `subEpicEligibility(task, pkg) → {ok, reason}` + `openChild` 분기 + `sub_epic_demoted` 이벤트. `sub_epic: false` 기본.
3. **개설.** `createTask`에 `parent`/`base_ref`/`decisions`/opts 상속 인자(§2.2), 자식 `validateShape`의 touches 포함 규칙(§2.3), 자식 daemon spawn, 부모 `serviceRunningDispatches`에서 자식 daemon `serviceDaemon` 호출(죽은 자식 daemon 재기동).
4. **fold.** `foldChild` task 분기(§2.7): 결과 브랜치 결정, ff-only 머지, `sub_epic` 요약, `ACCEPT_EXTRA.sub_epic`, 결정 위로 병합(§2.5).
5. **예산.** 배정 스냅샷, 캐스케이드 정지, 루트 소유 동시성(§2.4).
6. **재시도·정리.** 새 자식 task + `context_from`, shape 단계 실패 시 split 강등, `tm_clean` 캐스케이드.
7. **CONTRACT 문구**(shape의 split/size 문장, critique의 크기 공격) — 2와 같은 커밋이어야 한다(모델이 `size:'L'`을 새 의미로 쓰기 시작하는 시점과 엔진이 그걸 해석하는 시점이 같아야 하므로).
8. **측정**(§3.1) 후 `sub_epic` 기본값을 `'auto'`로 올릴지 별도 결정 기록.

`task.decisions` 배선(light-plan §6)이 먼저 머지되면 §2.5는 그 필드를 쓰기만 하면 된다. 나중에 머지되면 2–6은 `task.decisions`가 없는 상태로 돌고(상속할 게 없음), §2.5만 그 뒤에 얹는다 — 서로 막지 않는다.

### 3.1 테스트 계획 (`teams/scripts/test-taskmanager.mjs`, `HARNESS_TEST_NO_DRIVER=1` + `noDaemon`)

| # | 무엇 | 확인 |
|---|---|---|
| T1 | 감지 표 | `size:'L'`+스코프2 → task / `size:'L'`+스코프1 → split(강등 이유 `single-scope`) / `split:true` → graph 껍데기 / depth 한계 → 강등 / PLAN·QA·repair → 절대 아님 / 박스 잔액 < 하한 → 강등 / `sub_epic:false` → 현행 |
| T2 | 개설 | 자식 task.json의 `parent`·`depth`·`base_ref = harness/<p8>/P2`·`size_pinned 'L'`/`'parent'`·`roles` 전부 false·`initiative null`·`decisions` 상속(`inherited_from`)·예산 배정식 |
| T3 | 소유 중첩 | 자식 shape가 부모 P2 밖 경로를 touches에 넣으면 `validateShape` 문제 |
| T4 | 깊이 2 픽스처(09-17 v0.14.0 행의 약속) | `max_depth: 3`에서 E0→E1→E2, E2의 패키지는 `split`을 요청해도 chain-only(`depthForced`), E2의 `size:'L'`은 강등 |
| T5 | fold 성공 | 자식을 손으로 report까지 몰고 → 부모 P2 브랜치가 자식 integration 브랜치를 포함(ff), `changed_files` = git diff, `sub_epic.packages` 표 |
| T6 | fold 실패 | 자식 blocked → `accept:false` + 자식 미수락 패키지가 gaps에; ff 불가(P2 워크트리에 누가 씀) → `stage_ok:false` 불변식 위반 |
| T7 | 재시도 | shape 단계에서 막힌 자식 → 다음 시도는 split; 패키지 단계에서 막힌 자식 → 새 자식 task + `context_from` |
| T8 | 예산 | 드라이버 stream 픽스처로 자식 지출 → 부모 `taskSpend`에 합산; 부모 over → 자식 `budget_stopped.cascaded_from` → 자식이 자기 규칙으로 report까지 |
| T9 | 사람 대기 | 자식 매니저 `ask` → 부모 `dispatchSettled` false, `tm_inbox({task_id: 부모})`에 긴 키 카드 1장, 전체 `tm_inbox()`에 중복 없음, 긴 키로 `tm_submit` → 자식 노드 해소 + 루트 `task.decisions`에 즉시 복사 |
| T10 | 결정 전파 | 부모 결정 → 자식 패키지 런의 `openAsk` 필터에 포함; 자식 신규 결정 → fold 후 부모의 **미개설** 형제에만 도달 |
| T11 | 키·보드·Initiative | `parseTicketKey('E-p8/P2/E-c8/P1/U2')`, 틀린 `via` 거부; `tm_board()` 최상위에 자식 없음; initiative 그룹에 자식 없음 + 부모 비용에 자식 포함 |
| T12 | kill-and-resume(09-17 v0.13.1 표 테스트의 재귀판) | 자식이 running인 동안 부모·자식 daemon 각각 kill → `tm_next(부모)` 한 번으로 둘 다 재기동, 결과 동일 |
| T13 | 회귀 | `sub_epic` 미설정으로 기존 스위트 전체 무수정 통과 |

**실측 1회**(09-17 "측정 전 비용 주장 금지" 유지): 경계 둘을 가진 패키지가 자연히 나오는 요청(예: monorepo의 "CLI + 그 CLI가 쓰는 라이브러리 둘" 규모)으로 `sub_epic: false` 대 `'auto'` 두 arm. 잴 것 — 총비용·벽시계, 부모 integrate 충돌 수, 부모 critique blocking 수, 최종 gate:goal의 match_pct/gaps. 성공 기준: 비용 +25% 이내에서 부모 integrate 충돌 또는 critique blocking이 줄 것. 늘기만 하면 `'auto'`로 올리지 않는다.

## 4. 반론과 리스크

- **"재귀 폭발."**(09-17 §10-2) 세 겹으로 막는다 — 기본 깊이 한 층(§2.1c), 부모 잔액의 80%만 자식에게(§2.4), 루트 소유 동시성(§2.4). 가장 나쁜 경우의 비용은 "부모 박스 하나"를 넘지 않는다. 박스가 없으면 현행과 마찬가지로 상한이 없다 — 이건 sub-EPIC이 만든 위험이 아니라 무제한 설정의 위험이다.
- **"모델이 `size:'L'`을 남발한다."** 구조 검사(b)가 스코프 하나짜리를 거르고, 자식 shape의 "패키지 1개 = S" 거부가 둘째 그물이며, 두 번째 시도는 강등된다. 남발의 대가는 자식 판정 5회분 × 1회. 그래도 측정에서 남발이 보이면 critique에 "`size:'L'` 패키지의 경계가 진짜인가"를 blocking 항목으로 올린다.
- **"자식 판정 노드 5개는 고정비다."** 맞다 — 그래서 sub-EPIC은 오늘 부모 shape가 이미 4~6개 패키지로 펼치고 있는 덩어리에서만 이득이다. 평평하게 펼 때 부모 critique·integrate가 떠안는 내부 seam 판정이 자식으로 내려가는 것이 이득의 원천이고, 그게 실측으로 안 보이면 `'auto'`는 없다(§3.1 성공 기준).
- **"ff-only가 너무 엄격하다."** 부모 P2 워크트리를 자식 말고 누가 쓰는가? 현행 코드에서 dispatch가 running인 패키지 워크트리에 쓰는 경로는 없다(repair·QA는 integration 트리를 쓴다, `openChild` `:2586-2590`). 엄격함은 불변식 검사이지 운영 제약이 아니다. 걸리면 버그다.
- **"자식 PLAN을 끄면 자식이 PRD 없이 모호한 brief로 shape한다."** brief는 부모 shape가 PRD를 읽고 쓴 것이고, 자식 context에 PRD 경로와 `implements[]`가 들어간다. 자식이 PRD를 다시 쓰면 문서 둘이 서로 모순될 기회만 생긴다(09-23 §0.2e의 U1/U2-U4 불일치와 같은 부류).
- **"`task.decisions`를 위로 즉시 복사하면 부모 파일에 자식 프로세스가 쓴다."** 쓰기는 자식 daemon이 아니라 `tm_submit` 핸들러(사람 답을 받는 자리)와 부모 `foldChild`(부모 daemon)만 한다. `saveRun`의 write-then-rename + `mergeOnto`(`graph.mjs`)가 이미 동시 쓰기를 다루는 방식 위에 있고, 그래도 경합 테스트(T9)를 둔다.

## 5. 열린 논점

1. **`max_depth` 의미.** 이 문서는 "sub-EPIC은 `depth + 1 < max_depth`"로 기존 `depthForced`(`depth >= max_depth`)보다 한 단계 보수적으로 정했다 — 기본 2에서 한 층. 둘을 하나의 비교로 통일할지(그러면 기본값을 3으로 올려야 같은 동작), 별도 키(`max_task_depth`)로 뺄지. README `:657`의 "inert" 문구는 어느 쪽이든 고쳐야 한다.
2. **배정 공식.** `잔액 × (1 − reserve)` 한 번 스냅샷은 sub-EPIC이 둘일 때 먼저 연 쪽이 거의 다 가져간다. 대안: 미수락 develop 패키지 수로 나눈 공정 몫, 또는 shape가 패키지에 `weight`를 선언. 측정 전에는 가장 단순한 것.
3. **동시성 재배분.** v1은 자식 개설 시 숫자 고정. 부모의 다른 STORY가 끝나면 자식이 슬롯을 더 받아야 하나 — 받으려면 자식 `advanceDispatches`가 루트를 읽어야 하고, 그건 task 간 읽기 경로를 하나 더 만든다.
4. **`human_gates` 상속.** 부모가 `accept`에 사람 게이트를 걸었으면 자식의 `accept`마다도 걸리는가, 아니면 루트 레벨만인가. 지금 `child_opts.human_gates`는 graph 런에 그대로 내려가는(`:552`) 선례가 있어 "상속"으로 적었지만, 사람 카드 수가 깊이에 비례해 는다.
5. **자식의 QA 끄기가 맞나.** 자식 내부 seam(자식 P1↔P2)은 부모 QA가 부모 integration 트리에서 보긴 하지만, 결함이 발견되면 부모의 `fileDefects`가 STORY를 **부모 레벨**에 발행한다 — 그 결함의 소유자가 자식 패키지일 때, 부모 repair로 고칠지 sub-EPIC 패키지 재시도로 보낼지. 지금 안은 "부모 repair(모든 경로 소유)"로 두지만, 재시도가 자식 전체를 다시 여는 비용과 비교해 봐야 한다.
6. **`teams:sprint` 백로그와의 관계.** `requests[]` 항목 하나가 자체로 여러 항목 백로그일 때(중첩 백로그), 그걸 sub-EPIC의 구조 신호(§2.1b 외 추가 경로)로 볼지. light-plan §2.1a의 `requests[].acceptance`가 들어온 뒤에 판단.

## 6. 한 줄

> 패키지가 다시 EPIC이 되는 건 **새 엔진이 아니라 `createTask`를 한 번 더 부르는 것**이다: 부모 STORY 브랜치를 `base_ref`로 주고, 끝나면 ff로 되돌려 받고, 예산·결정·사람 카드는 그 한 줄의 `parent`를 따라 위아래로 흐른다. 언제 여는지는 모델이 `size:'L'`로 말하고 `touches[]`의 소유 경계가 확인한다 — 애매하면 오늘의 `split`으로.
