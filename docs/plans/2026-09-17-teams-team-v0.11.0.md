# teams (team) v0.11.0 — tickets.mjs 파생 + board.jsonl + docs.mjs phase md + tm_board/tm_ticket/tm_docs + 명령 스킬 구현 계획

> Produced by write:writing-plans. Owner for execution routing: planning:executing-plans.
> Steps use checkbox (`- [ ]`) syntax. 설계 근거: `2026-09-17-teams-team.md` §4·§5b·§6·§7b·§7c·§8·§9·§11.

**Goal:** 엔진 상태(`task.json`)에서 파생되는 **티켓 레이어**를 만든다. 세 조각이다.

1. `mcp/tickets.mjs` — EPIC/STORY/TASK 티켓 상태를 `task.json`(과 자식 run 파일)에서 계산하는
   순수 함수. 두 번째 진실 원천을 만들지 않는다(§4).
2. `board.jsonl` — 티켓 전이 이벤트 로그. append-only, 읽기 근거 아님(§4, §7b). `task.json` 쓰기와
   같은 전이에서, `tickets.mjs`의 파생 스냅샷을 **전/후로 diff**해서 바뀐 키만 한 줄씩 남긴다.
3. `mcp/docs.mjs` — §7c의 phase md를 `task.json`에서 렌더하는 순수 함수 + 쓰기 한 곳(`writeDocs`).
   엔진은 md를 절대 읽지 않는다. `tm_docs({rebuild:true})`가 전부 다시 만들어도 같은 파일이 나와야
   한다(멱등 렌더).

그 위에 `tm_board`/`tm_ticket`/`tm_docs` 세 도구(§8, §11의 v0.11.0 행이 실제로 요구하는 신규 도구는
이 셋뿐 — `tm_events`는 v0.10.0에서 이미 나갔다)와 명령 스킬 둘(`/teams:board`,
`/teams:ticket`)을 얹는다.

**Architecture:** `tickets.mjs`는 파일을 쓰지 않는다(§9: "순수 함수, 파일 안 씀") — 유일한 예외는
자식 패키지의 진행률을 보려고 자식 run 파일을 **읽는** 것뿐이고, 이는 taskmanager.mjs가 이미
따르는 규칙("READS child run files and never writes them")과 같다. `docs.mjs`는 렌더 함수는
순수하고, 쓰기는 `writeDocs` 한 곳뿐이다(§9: "JSON → md 순수 함수 + leader가 전이마다 호출하는
쓰기 한 곳"). `board.jsonl`을 쓰는 코드는 (파일 I/O이므로) `tickets.mjs`에 두지 않고
`taskmanager.mjs`에 둔다 — `tm_open`/`tm_next`/`tm_submit`/`tm_retry` 네 곳의 실제 변이 지점을
감싸는 하나의 diff 래퍼로, 호출 전 스냅샷과 호출 후 스냅샷을 비교해 바뀐 티켓 키만 기록한다. 이
전/후 diff 방식이 중요한 이유는 셋이다: (a) `tickets.mjs`가 순수하게 유지되고, (b) 어떤 전이가
실제로 티켓 상태를 바꿨는지 taskmanager.mjs의 스무 곳 넘는 개별 변이 지점(`finish`, `retryShape`,
`retryPackage`, `openRepair`, `openChild`, `serviceDeadDriver`, …) 하나하나에 쓰기 코드를 심지
않고도 잡아낸다, (c) 논-리더 프로세스의 호출이 inbox로 큐잉될 때(`queueToInbox`)는 이 래퍼에 도달하기
전에 조기 반환되므로 — 아무것도 안 바뀌었으니 — 자동으로 아무 이벤트도 안 남는다(별도 분기 불필요).

**Tech Stack:** Node 18+ ESM, `node:test`, 런타임 의존성 0. 테스트는
`node --test teams/scripts/test-*.mjs`.

**이번 라운드에 들어가는 것:** `mcp/tickets.mjs`(신설), `mcp/docs.mjs`(신설),
`mcp/taskmanager.mjs`의 board.jsonl diff 래퍼 + `tm_board`/`tm_ticket`/`tm_docs` 세 도구,
`scripts/test-tickets.mjs`(신설, 매핑 표 테이블 테스트), `scripts/test-docs.mjs`(신설, golden 파일
비교 + rebuild 동일 출력), `scripts/test-taskmanager.mjs` 확장, `skills/board`·`skills/ticket`
SKILL.md 둘, golden 픽스처 파일들.

**범위 밖과 그 이유 (팀 리더의 경계 확인):**
- **EPIC 흐름에 planning/qa Team을 실제로 꽂는 것(§2), shape의 `role`/`priority`(§5).** 이 라운드가
  "가능하게" 하는 것이지 "켜는" 것이 아니다 — v0.12.0. 그래서 이번 라운드의 STORY는 여전히 전부
  `develop` 하나뿐이고, `epicBoardRows`의 `role` 컬럼은 항상 `'develop'`을 반환한다(코드에 그렇게
  주석을 남긴다). 결함 STORY(§5b, `tm_file`)도 QA Team이 있어야 발행되므로 같은 이유로 범위 밖.
- **human 실행자(`ask`, `gate:human`, `waiting_human`, `tm_answer`/`tm_assign`/`tm_inbox`).** v0.13.0.
  §4의 `WAITING_USER` 티켓 상태는 그래서 이번 라운드 코드 경로 어디서도 만들어지지 않는다(아래
  발견 1) — 존재하지 않는 기능을 위해 빈 자리를 만들지 않는다.
- **`tm_log`.** §8의 도구 표에는 있지만 §11의 v0.11.0 행에는 없다(팀 리더의 지시도 동일: "명령
  스킬" 목록에 log는 없다). driver stderr/log 경로는 이미 `tm_status`/`tm_next`의 `children[]`가
  주고 있어 이번 라운드가 주는 가시성에 필수가 아니다 — v0.12/v0.13 어느 쪽이든 필요해지면 그때.
- **sub-EPIC(`parent`, `child_task_id`).** v0.14.0.
- **§7c의 `10-planning.md`/`10-prd.md`/`15-spec-gate.md`/`60-qa.md`/`65-audit.md`.** 전부 EPIC 레벨
  planning/qa Team의 산출물이고, 그 Team이 존재하지 않으므로(위 첫 항목) 이번 라운드는 이 다섯
  파일을 렌더하지 않는다 — `docs.mjs`의 `renderAll`이 `task.spec`/해당 노드가 존재할 때만 각 파일을
  추가하는 것과 같은 원칙: 데이터가 없는 곳에 빈 md를 만들지 않는다.

**전제 사실 (조사로 확인):**
- `taskmanager.mjs`는 이미 범용 이벤트 로그(`ledger.jsonl`, `record()`)를 갖고 있고 `tm_events`가
  그걸 tail한다(v0.10.0). `board.jsonl`은 그것과 다른, **티켓 전이만** 담는 별도 파일이다 — 팀
  리더의 지시가 `tm_events`를 이번 스코프에서 뺀 것과 일치한다(이미 있다).
- `task.json`(과 자식 run 파일)의 저장은 `graph.mjs`의 `saveRun`/`loadRunAt`이 맡는다 — `mkdirSync`
  락 파일 + `mergeOnto`(다른 브로커가 먼저 쓴 노드를 보존)로, §7b가 말하는 "tmp+rename"과는 다른
  메커니즘이다(실제로는 락 파일 + 직접 `writeFileSync`, 임시파일 이름 바꾸기 없음) — **설계 문서
  §7b의 서술과 실제 코드가 다르다**(발견 5). `taskmanager.mjs`가 `task.json`에 대해 이 메커니즘을
  그대로 재사용하므로(`store_path`를 채운 같은 `saveRun`), 티켓 레이어가 이 위에서 순수하게 도는
  것 자체는 문제 없다 — 다만 §7b를 그대로 인용하지 않는다.
- `dispatch:Pn`/`accept:Pn` 노드는 shape가 성공하는 **순간 전부 함께** 만들어진다
  (`expandPackages`가 모든 package에 대해 `pushChain(PACKAGE_CHAIN, …)`을 한 번에 돈다). §4의
  STORY BACKLOG 행("`dispatch:Pn` 미생성")은 문자 그대로는 이 코드에서 일어나지 않는다 — dispatch
  노드는 shape 성공 즉시 `pending` 상태로 항상 존재한다. **발견 2**: BACKLOG과 READY를 "노드
  존재 여부"가 아니라 "존재하는 dispatch 노드의 `unmetDeps()`가 비었는가"로 다시 정의했다
  (`graph.mjs`가 이미 내보내는 `unmetDeps`를 그대로 쓴다) — deps 있는 패키지는 BACKLOG로,
  deps 없거나 전부 done인 패키지는 즉시 READY로 보인다(그리고 다음 `tm_next` 폴링에서 바로
  `dispatch`가 열려 IN_PROGRESS로 넘어가므로, READY는 실제로는 매우 짧게 관측되는 창이다 — 그래도
  파생 함수 자체는 옳고 단위 테스트로 그 창을 고정해서 본다).
- 저장소에 "golden 파일 비교" 관례가 이미 있는 테스트는 없다(`grep -r golden` 무응답) — 이번
  라운드가 이 패턴을 새로 연다. golden 파일은 `teams/scripts/fixtures/docs-golden/`에 둔다.
- `.claude/team.json`의 `docs_dir` 기본값(`.harness-run/team`)은 이미 v0.10.0의
  `teamconfig.mjs`(`TEAM_DEFAULTS.docs_dir`)에 있고 모든 `task.team.opts.docs_dir`에 이미 채워져
  있다 — §7c가 요구하는 위치 규칙을 위해 새 배관이 필요 없다.
- `graph.mjs`가 내보내는 `nodeKind(run, n)`/`KINDS`/`authorStage`는 자식 run의 subgoal이 어떤
  kind(`subgoal`/`document`/`planning`/`qa`, v0.10.1)인지, 그 chain이 무엇인지 이미 알려준다 —
  TASK 티켓 상태(§4의 세 번째 행)가 kind에 무관하게 일반화되는 이유다.
- `task.json`에는 리비전 카운터가 없다. §7c frontmatter의 `source: task.json@<rev>`를 위해
  `task.nodes.filter(n => n.result).length`(지금까지 결과가 난 노드 수)를 값싼 단조 증가 대용으로
  쓴다 — 진짜 버전 카운터를 `task.json`에 추가하는 것은 이번 라운드 범위 밖(발견 6).
- **팀 리더 지시**: 이 파일 하나만 내가 소유한다. `harness-beta` 플러그인 은퇴는 다른 agent가 병행
  중이므로 이 계획은 `deprecated/`, `harness-beta/`, `.claude-plugin/marketplace.json`(harness-beta
  관련 부분)을 건드리지 않는다 — Task 6의 매니페스트 변경은 teams 항목에 한정한다.

**§4/§7c 대비 발견한 불일치·추가 (팀 리더에게 보고):**
1. §4의 STORY/EPIC 행에 있는 `WAITING_USER`는 human 실행자(v0.13.0)가 있어야 만들어지는 상태다.
   이번 라운드의 `storyTicketState`/`epicTicketState`는 그 상태를 **반환하는 코드 경로가 없다** —
   존재하지 않는 기능의 자리를 비워두지 않고, 그냥 그 값을 넣지 않았다. v0.13.0에서 human 노드가
   생기면 그 파생 조건을 추가한다.
2. 위 "전제 사실"에 적은 대로, BACKLOG의 정의를 "노드 미생성"에서 "존재하는 dispatch의 unmetDeps
   비어있지 않음"으로 정정했다 — 코드가 실제로 그렇게 동작하기 때문이다.
3. §4에는 EPIC 레벨 BLOCKED가 없지만(표는 STORY에만 BLOCKED를 적었다), `runState(task).state ===
   'blocked'`(재시도 예산 소진 등)인 EPIC을 READY/IN_PROGRESS로 보여주면 보드가 정확히 반대의
   인상 — "아직 멀쩡히 진행 중" — 을 준다. `epicTicketState`에 BLOCKED를 추가했다(§4를 좁히는 게
   아니라 넓히는 추가 — 아래 자기 검토에도 다시 적는다).
4. §4는 STORY/TASK 각각 상태 몇 개만 명시했지만(BACKLOG/READY/IN_PROGRESS/IN_REVIEW/DONE/REJECTED/
   WAITING_CAPACITY/BLOCKED가 STORY, IN_PROGRESS/IN_REVIEW/DONE만 TASK), 실제 노드 상태
   (`skipped`/`unreachable`)는 재구성(reshape)·정착된 실패(settleFailure) 양쪽에서 이미 일어난다.
   CANCELLED(재구성으로 폐기)·UNREACHABLE(상류 실패로 도달 불가)를 STORY·TASK 둘 다에 일관되게
   추가했다 — §4 자체가 워크플로 다이어그램에는 이 둘을 이미 그려 두고("CANCELLED / UNREACHABLE")
   매핑 표에만 옮기지 않은 누락으로 읽었다.
5. §7b "쓰기 원자성: 현행 tmp+rename 유지"는 실제 코드(`graph.mjs`의 `acquire`/`release`/
   `mergeOnto` — mkdir 락 + 직접 쓰기, 임시파일 없음)와 다르다. 이 계획은 실제 메커니즘 위에서
   동작하도록 짰고, §7b 문구 자체를 고치는 건 이 계획의 파일 목록(설계 문서는 다른 라운드가
   갱신 중일 수 있어 건드리지 않음, 위 "팀 리더 지시")에 없어 여기 기록만 남긴다.
6. `task.json@<rev>`의 `rev`는 코드에 없는 개념이라 "결과가 난 노드 수"로 대신했다 — 위 전제
   사실에 적은 대로.
7. **일정 규모 판단**: 이 라운드는 한 번에 병렬로 낼 수 있는 크기다(아래 태스크 그룹 참고) —
   `tickets.mjs`(순수 함수 하나)가 유일한 공통 의존이고, 그 위의 `docs.mjs`와
   `taskmanager.mjs`(보드 도구 둘)가 서로 파일이 겹치지 않아 동시에 갈 수 있다. 두 라운드로
   쪼갤 필요는 못 봤다 — 굳이 쪼갠다면 `tm_docs`(md 렌더 배선, Task 4)를 다음 라운드로 미루고
   `tm_board`/`tm_ticket`(Task 1·3)만 먼저 내는 안이 가능하지만, `doc_path`가 그때도 항상 반환되게
   설계해서(파일이 아직 안 만들어졌어도 결정적 경로 문자열은 항상 계산된다) 그 분리가 강제되지는
   않는다. 한 라운드로 진행을 추천한다.

---

## 태스크 그룹과 의존 관계

```
Task 1  tickets.mjs (+ test-tickets.mjs)              — 기초, 먼저 끝나야 함
   ├── Task 2  docs.mjs (+ test-docs.mjs + golden)      ─┐  Task 1에만 의존, 파일이 겹치지 않아 병렬
   └── Task 3  taskmanager.mjs: board.jsonl + tm_board/tm_ticket ┘
                                                     Task 2 · Task 3 둘 다 끝난 뒤
Task 4  taskmanager.mjs: tm_docs 배선 (Task 3과 같은 파일 — 직렬)
Task 5  skills/board, skills/ticket                    — 코드 의존 없음, 처음부터 다른 모두와 병렬
Task 6  릴리스 0.11.0                                   — 전부의 위
```

- **파일 충돌**: Task 3과 Task 4만 `teams/mcp/taskmanager.mjs`(+`scripts/test-taskmanager.mjs`)를
  같이 건드린다 — 그래서 Task 4는 Task 3 뒤에 직렬로 온다. Task 1·2·5는 서로 파일이 하나도
  겹치지 않아 Task 1가 끝나는 즉시(Task 5는 처음부터) 3-way 병렬이 가능하다.
- **1라운드/2라운드 판단**: 1라운드. 근거는 위 발견 7.

---

### Task 1: `mcp/tickets.mjs` — 엔진 상태 → 티켓 상태 파생 함수 (순수)
**Files:** create `teams/mcp/tickets.mjs`, create `teams/scripts/test-tickets.mjs`
**Interfaces:** produces `epicKey`, `storyKey`, `docPaths`, `latestBySubgoal`, `storyTicketState`,
`epicTicketState`, `taskTicketState`, `epicPhase`, `storyTaskProgress`, `epicBoardRows`,
`ticketSnapshot` — Task 2(`docs.mjs`)·Task 3(`taskmanager.mjs`의 보드 도구)가 소비. `graph.mjs`의
`unmetDeps`/`runState`/`nodeKind`/`KINDS`/`loadRun`만 가져다 쓰고, `taskmanager.mjs`는 전혀
가져오지 않는다(순환 임포트 방지 — `taskmanager.mjs`가 `tickets.mjs`를 가져오는 방향만 있다).
**Pass bar:** `node --test teams/scripts/test-tickets.mjs` 전부 통과.

- [ ] 1: 실패하는 테스트를 쓴다
```js
// teams/scripts/test-tickets.mjs - table test over the design doc's §4 mapping (engine
// state -> ticket state), plus the derived states §4 only sketches (CANCELLED/UNREACHABLE at
// every level, BLOCKED at EPIC level - see the plan's 발견 3/4). Every fixture is a plain object
// shaped exactly like a real task.json/child run.json - no server, no filesystem.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { node } from '../mcp/graph.mjs';
import {
  epicKey, storyKey, docPaths, latestBySubgoal, storyTicketState, epicTicketState,
  taskTicketState, epicPhase, storyTaskProgress, epicBoardRows, ticketSnapshot,
} from '../mcp/tickets.mjs';

const TASK_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

function baseTask(nodes, extra) {
  return { run_id: TASK_ID, cwd: '/proj', request: 'do the thing', created_at: 1,
    team: { opts: { docs_dir: '.harness-run/team' } }, spec: null, nodes, ...extra };
}

function dispatchNode(pkgId, patch) {
  return node(`dispatch:${pkgId}:1`, 'dispatch', patch && patch.deps || [], { subgoal_id: pkgId, ...patch });
}
function acceptNode(pkgId, patch) {
  return node(`accept:${pkgId}:1`, 'accept', [`dispatch:${pkgId}:1`], { subgoal_id: pkgId, ...patch });
}

// ---------- key/path builders ----------

test('epicKey takes the task id\'s first 8 hex chars; storyKey/docPaths compose on it', () => {
  assert.equal(epicKey(TASK_ID), 'E-aaaaaaaa');
  assert.equal(storyKey(TASK_ID, 'P1'), 'E-aaaaaaaa/P1');
  const paths = docPaths(baseTask([]));
  assert.equal(paths.index, '/proj/.harness-run/team/E-aaaaaaaa/INDEX.md');
  assert.equal(paths.story('P2'), '/proj/.harness-run/team/E-aaaaaaaa/40-stories/P2.md');
});

test('docPaths honors team.json\'s docs_dir override', () => {
  const t = baseTask([], { team: { opts: { docs_dir: 'docs/epics' } } });
  assert.equal(docPaths(t).index, '/proj/docs/epics/E-aaaaaaaa/INDEX.md');
});

// ---------- §4 STORY mapping table ----------

const STORY_ROWS = [
  ['dispatch not yet ready (deps unmet)', [dispatchNode('P1', { deps: ['dispatch:P0:1'] })], 'BACKLOG'],
  ['dispatch pending, deps satisfied', [dispatchNode('P1')], 'READY'],
  ['dispatch running, driver alive', [dispatchNode('P1', { state: 'running', child: { driver: { pid: 1 } } })], 'IN_PROGRESS'],
  ['dispatch running, no driver info yet', [dispatchNode('P1', { state: 'running', child: {} })], 'IN_PROGRESS'],
  ['dispatch running, waiting on capacity', [dispatchNode('P1', { state: 'running', child: { waiting_capacity: { reason: 'r' } } })], 'WAITING_CAPACITY'],
  ['dispatch running, driver dead', [dispatchNode('P1', { state: 'running', child: { driver: { pid: 2 } } })], 'BLOCKED'],
  ['dispatch failed (worktree/merge failure, no accept ever ran)', [dispatchNode('P1', { state: 'failed', result: { stage_ok: false } })], 'BLOCKED'],
  ['dispatch done, accept pending', [dispatchNode('P1', { state: 'done', result: {} }), acceptNode('P1')], 'IN_REVIEW'],
  ['dispatch done, accept running', [dispatchNode('P1', { state: 'done', result: {} }), acceptNode('P1', { state: 'running' })], 'IN_REVIEW'],
  ['dispatch done, accept done + accept:true', [dispatchNode('P1', { state: 'done', result: {} }), acceptNode('P1', { state: 'done', result: { accept: true, match_pct: 94 } })], 'DONE'],
  ['dispatch done, accept done + accept:false', [dispatchNode('P1', { state: 'done', result: {} }), acceptNode('P1', { state: 'done', result: { accept: false } })], 'REJECTED'],
  ['dispatch done, accept failed (no-evidence guard tripped)', [dispatchNode('P1', { state: 'done', result: {} }), acceptNode('P1', { state: 'failed', result: { stage_ok: false } })], 'REJECTED'],
  ['dispatch skipped (superseded by a reshape)', [dispatchNode('P1', { state: 'skipped' })], 'CANCELLED'],
  ['dispatch unreachable (settled failure upstream)', [dispatchNode('P1', { state: 'unreachable' })], 'UNREACHABLE'],
];

test('STORY ticket state: the §4 mapping table, row by row', () => {
  const alive = (pid) => pid === 1;
  for (const [label, nodes, expected] of STORY_ROWS) {
    const t = baseTask(nodes, { spec: { packages: [{ id: 'P1', title: 't' }] } });
    assert.equal(storyTicketState(t, 'P1', { alive }), expected, label);
  }
});

test('a retried STORY is read from its LATEST attempt, not the failed prior one', () => {
  const nodes = [
    dispatchNode('P1', { state: 'done', result: {} }),
    acceptNode('P1', { state: 'failed', result: { stage_ok: false, reason: 'r' } }),
    node('dispatch:P1:2', 'dispatch', ['dispatch:P1:1'], { subgoal_id: 'P1', attempt: 2, state: 'running', child: { driver: { pid: 1 } } }),
  ];
  const t = baseTask(nodes, { spec: { packages: [{ id: 'P1', title: 't' }] } });
  assert.equal(storyTicketState(t, 'P1', { alive: () => true }), 'IN_PROGRESS');
});

test('a package with no dispatch node at all reads BACKLOG (defensive - not reachable via expandPackages today)', () => {
  const t = baseTask([], { spec: { packages: [{ id: 'P9', title: 't' }] } });
  assert.equal(storyTicketState(t, 'P9'), 'BACKLOG');
});

// ---------- §4 EPIC mapping ----------

test('EPIC ticket state: before shape -> READY, packages exist -> IN_PROGRESS, integrate/gate:goal exists -> IN_REVIEW, report done -> DONE', () => {
  assert.equal(epicTicketState(baseTask([node('size', 'size', [])])), 'READY');
  assert.equal(epicTicketState(baseTask(
    [dispatchNode('P1', { state: 'running', child: { driver: { pid: 1 } } })],
    { spec: { packages: [{ id: 'P1' }] } },
  )), 'IN_PROGRESS');
  assert.equal(epicTicketState(baseTask(
    [node('integrate:1', 'integrate', [])],
    { spec: { packages: [{ id: 'P1' }] } },
  )), 'IN_REVIEW');
  assert.equal(epicTicketState(baseTask([node('report', 'report', [], { state: 'done', result: {} })])), 'DONE');
});

test('EPIC ticket state adds BLOCKED beyond §4\'s table: runState says blocked (retry budget spent), never shown as READY/IN_PROGRESS', () => {
  const t = baseTask([
    node('size', 'size', [], { state: 'done', result: { size: 'L' } }),
    node('shape', 'shape', ['size'], { state: 'failed', result: { stage_ok: false } }),
    node('critique', 'critique', ['shape'], { state: 'skipped' }),
  ]);
  assert.equal(epicTicketState(t), 'BLOCKED');
});

// ---------- §4 TASK mapping (child-run subgoal, generic over kind) ----------

function childRun(subgoalKind, subgoalNodes) {
  return { cwd: '/pkg', run_id: 'child-1', spec: { subgoals: [{ id: 'U1', kind: subgoalKind }] }, nodes: subgoalNodes };
}

test('TASK ticket state for a subgoal (implement/test/gate): author running -> IN_PROGRESS, mid stage reached -> IN_REVIEW, gate done -> DONE', () => {
  assert.equal(taskTicketState(childRun('subgoal', [node('implement:U1:1', 'implement', [], { subgoal_id: 'U1', state: 'running' })]), 'U1'), 'IN_PROGRESS');
  assert.equal(taskTicketState(childRun('subgoal', [
    node('implement:U1:1', 'implement', [], { subgoal_id: 'U1', state: 'done', result: {} }),
    node('test:U1:1', 'test', ['implement:U1:1'], { subgoal_id: 'U1', state: 'running' }),
  ]), 'U1'), 'IN_REVIEW');
  assert.equal(taskTicketState(childRun('subgoal', [
    node('implement:U1:1', 'implement', [], { subgoal_id: 'U1', state: 'done', result: {} }),
    node('test:U1:1', 'test', ['implement:U1:1'], { subgoal_id: 'U1', state: 'done', result: { verified: true } }),
    node('gate:U1:1', 'gate', ['test:U1:1'], { subgoal_id: 'U1', state: 'done', result: { accept: true } }),
  ]), 'U1'), 'DONE');
});

test('TASK ticket state generalizes to the planning kind (draft/revise/gate) with no special-casing', () => {
  assert.equal(taskTicketState(childRun('planning', [node('draft:U1:1', 'draft', [], { subgoal_id: 'U1', state: 'running' })]), 'U1'), 'IN_PROGRESS');
  assert.equal(taskTicketState(childRun('planning', [
    node('draft:U1:1', 'draft', [], { subgoal_id: 'U1', state: 'done', result: {} }),
    node('revise:U1:1', 'revise', ['draft:U1:1'], { subgoal_id: 'U1', state: 'running' }),
  ]), 'U1'), 'IN_REVIEW');
  assert.equal(taskTicketState(childRun('planning', [
    node('draft:U1:1', 'draft', [], { subgoal_id: 'U1', state: 'done', result: {} }),
    node('revise:U1:1', 'revise', ['draft:U1:1'], { subgoal_id: 'U1', state: 'done', result: {} }),
    node('gate:U1:1', 'gate', ['revise:U1:1'], { subgoal_id: 'U1', state: 'failed', result: { stage_ok: false } }),
  ]), 'U1'), 'REJECTED');
});

// ---------- helpers used by tm_board/tm_ticket/docs.mjs ----------

test('epicPhase follows §6\'s phase table: plan/setgoal before shape, impl while only dispatch exists, qualitygate once integrate/gate:goal exists, null once done', () => {
  assert.equal(epicPhase(baseTask([node('size', 'size', [])])), 'plan');
  assert.equal(epicPhase(baseTask([
    node('size', 'size', [], { state: 'done', result: {} }),
    node('shape', 'shape', ['size'], { state: 'done', result: {} }),
    node('critique', 'critique', ['shape'], { state: 'running' }),
  ])), 'setgoal');
  assert.equal(epicPhase(baseTask(
    [dispatchNode('P1', { state: 'running' })],
    { spec: { packages: [{ id: 'P1' }] } },
  )), 'impl');
  assert.equal(epicPhase(baseTask(
    [node('integrate:1', 'integrate', [])],
    { spec: { packages: [{ id: 'P1' }] } },
  )), 'qualitygate');
  assert.equal(epicPhase(baseTask([node('report', 'report', [], { state: 'done', result: {} })])), null);
});

test('latestBySubgoal picks the highest-attempt node for a stage, or null', () => {
  const nodes = [dispatchNode('P1', { state: 'done', result: {} }), node('dispatch:P1:2', 'dispatch', [], { subgoal_id: 'P1', attempt: 2, state: 'running' })];
  assert.equal(latestBySubgoal(baseTask(nodes), 'P1', 'dispatch').node_id, 'dispatch:P1:2');
  assert.equal(latestBySubgoal(baseTask([]), 'P1', 'accept'), null);
});

test('epicBoardRows renders one row per package with role always "develop" - no other Team reaches the EPIC flow until v0.12', () => {
  const t = baseTask(
    [dispatchNode('P1', { state: 'done', result: {} }), acceptNode('P1', { state: 'done', result: { accept: true, match_pct: 91 } })],
    { spec: { packages: [{ id: 'P1', title: 'module a' }] } },
  );
  const rows = epicBoardRows(t);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], { key: 'E-aaaaaaaa/P1', id: 'P1', title: 'module a', role: 'develop', state: 'DONE', tasks: null, last_verdict: 'accept 91', reporter: 'shape' });
});

test('ticketSnapshot maps every known key (EPIC + each STORY) to its current state - the input a board.jsonl diff is taken over', () => {
  const t = baseTask(
    [dispatchNode('P1', { state: 'running', child: { driver: { pid: 1 } } })],
    { spec: { packages: [{ id: 'P1' }] } },
  );
  assert.deepEqual(ticketSnapshot(t, { alive: () => true }), { 'E-aaaaaaaa': 'IN_PROGRESS', 'E-aaaaaaaa/P1': 'IN_PROGRESS' });
});
```
- [ ] 2: `node --test teams/scripts/test-tickets.mjs` → import 대상이 없어 전부 fail 확인
- [ ] 3: `teams/mcp/tickets.mjs`를 만든다
```js
// tickets.mjs - derives JIRA-style ticket state from task.json (and, for a TASK, its child
// run's own file). Pure: no writes, ever - the design doc's §4 principle that ticket state is a
// function of engine state, never a second source of truth. The one impure-looking thing here is
// reading a child run's file (`loadRun`), which taskmanager.mjs already does for the same reason
// (its own header: "READS child run files and never writes them") - a read is not a write.
//
// "alive" (whether a dispatch's driver process is still running) is the one input this module
// cannot derive from task.json alone - task.json never stores it, only a pid. Every function that
// needs it takes an injectable `{ alive }` predicate defaulting to a real process.kill(pid, 0)
// check, so a unit test can fix it without a real pid and the module stays otherwise pure.
import { join } from 'node:path';
import { loadRun, unmetDeps, runState, nodeKind, KINDS } from './graph.mjs';

export function epicKey(taskId) {
  return `E-${String(taskId).slice(0, 8)}`;
}
export function storyKey(taskId, pkgId) {
  return `${epicKey(taskId)}/${pkgId}`;
}
export function taskKey(taskId, pkgId, subgoalId) {
  return `${storyKey(taskId, pkgId)}/${subgoalId}`;
}

// §7c: the project's own docs_dir (team.json, default .harness-run/team - already resolved onto
// every task by teamconfig.mjs) holds one directory per EPIC. story() is a function because a
// STORY's file lives one level deeper, under 40-stories/.
export function docPaths(task) {
  const docsDir = (task.team && task.team.opts && task.team.opts.docs_dir) || join('.harness-run', 'team');
  const base = join(task.cwd, docsDir, epicKey(task.run_id));
  return {
    dir: base,
    index: join(base, 'INDEX.md'),
    request: join(base, '00-request.md'),
    shape: join(base, '20-shape.md'),
    critique: join(base, '30-critique.md'),
    story: (pkgId) => join(base, '40-stories', `${pkgId}.md`),
    integrate: join(base, '50-integrate.md'),
    goalGate: join(base, '70-goal-gate.md'),
    report: join(base, '80-report.md'),
  };
}

function processAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return !!(e && e.code === 'EPERM'); }
}

// The highest-attempt node for a package/stage pair, or null. A retried STORY always has to be
// read from its latest attempt - the failed prior one is kept around as evidence, not as current.
export function latestBySubgoal(task, pkgId, stage) {
  const list = task.nodes.filter((n) => n.subgoal_id === String(pkgId) && n.stage === stage);
  return list.length ? list[list.length - 1] : null;
}

// §4's STORY row, plus CANCELLED/UNREACHABLE (the workflow diagram already draws these; the
// mapping table just did not spell them out - see the plan's 발견 4) and no WAITING_USER (no
// human executor exists yet to produce it - 발견 1).
export function storyTicketState(task, pkgId, opts = {}) {
  const alive = opts.alive || processAlive;
  const dispatch = latestBySubgoal(task, pkgId, 'dispatch');
  if (!dispatch) return 'BACKLOG'; // defensive: expandPackages always creates one alongside the spec entry
  if (dispatch.state === 'skipped') return 'CANCELLED';
  if (dispatch.state === 'unreachable') return 'UNREACHABLE';
  if (dispatch.state === 'pending') return unmetDeps(task, dispatch).length ? 'BACKLOG' : 'READY';
  if (dispatch.state === 'running') {
    if (dispatch.child && dispatch.child.waiting_capacity) return 'WAITING_CAPACITY';
    const driver = dispatch.child && dispatch.child.driver;
    if (driver && !alive(driver.pid)) return 'BLOCKED';
    return 'IN_PROGRESS';
  }
  // dispatch 'failed': either the worktree/merge step itself failed (openChild), or its driver
  // died with the restart budget spent (foldChild) - neither is a judged rejection, both are an
  // infrastructural stop. Same ticket state either way (发見 in the plan's 전제 사실).
  if (dispatch.state === 'failed') return 'BLOCKED';
  // dispatch done: the STORY's outcome is now the manager's own judgement of it, accept.
  const accept = latestBySubgoal(task, pkgId, 'accept');
  if (!accept) return 'IN_REVIEW'; // pushChain always creates dispatch+accept together; kept for safety
  if (accept.state === 'pending' || accept.state === 'running') return 'IN_REVIEW';
  if (accept.state === 'skipped') return 'CANCELLED';
  if (accept.state === 'unreachable') return 'UNREACHABLE';
  if (accept.state === 'done') return accept.result && accept.result.accept === true ? 'DONE' : 'REJECTED';
  return 'REJECTED'; // accept 'failed' (e.g. the no-evidence guard) is still a rejection, no evidence of its own needed
}

// §4's EPIC row (shape 전 -> READY / dispatch 진행 -> IN_PROGRESS / integrate·gate:goal ->
// IN_REVIEW / report -> DONE), plus BLOCKED - not in §4's table, added because runState() already
// knows when nothing can proceed and showing READY/IN_PROGRESS for a stuck EPIC would defeat the
// board's own point (see the plan's 발견 3).
export function epicTicketState(task) {
  if (task.nodes.some((n) => n.stage === 'report' && n.state === 'done')) return 'DONE';
  if (runState(task).state === 'blocked') return 'BLOCKED';
  if (!task.spec) return 'READY';
  const goalLevel = task.nodes.some((n) => n.stage === 'integrate' || (n.stage === 'gate' && n.subgoal_id === null));
  return goalLevel ? 'IN_REVIEW' : 'IN_PROGRESS';
}

// §6's phase table: plan (size, shape) / setgoal (critique) / impl (dispatch:Pn) / qualitygate
// (accept:Pn, integrate, gate:goal, report). null once the report is done - there is no phase
// left to name.
export function epicPhase(task) {
  if (task.nodes.some((n) => n.stage === 'report' && n.state === 'done')) return null;
  if (!task.spec) {
    const critique = task.nodes.find((n) => n.node_id === 'critique' || n.stage === 'critique');
    return critique && critique.state !== 'pending' ? 'setgoal' : 'plan';
  }
  const goalLevel = task.nodes.some((n) => n.stage === 'integrate' || (n.stage === 'gate' && n.subgoal_id === null));
  return goalLevel ? 'qualitygate' : 'impl';
}

// §4's TASK row ("자식 run 노드 상태 그대로"), generalized over kind (subgoal/document/planning/
// qa, whichever v0.10.1 chain the subgoal is) rather than hardcoded to implement/test/gate - the
// same genericness graph.mjs's own engine already has. Extended with CANCELLED/UNREACHABLE/
// BACKLOG/READY/REJECTED for the same reason STORY was: §4's own diagram already has them.
export function taskTicketState(childRun, subgoalId) {
  const kind = nodeKind(childRun, { subgoal_id: subgoalId }) || 'subgoal';
  const chain = (KINDS[kind] || KINDS.subgoal).chain; // e.g. [implement,test,gate] or [draft,revise,gate]
  const [authorStage, midStage, gateStage] = chain;
  const byStage = (stage) => {
    const list = childRun.nodes.filter((n) => n.subgoal_id === String(subgoalId) && n.stage === stage);
    return list.length ? list[list.length - 1] : null;
  };
  const gate = byStage(gateStage);
  if (gate) {
    if (gate.state === 'done') return 'DONE';
    if (gate.state === 'failed') return 'REJECTED';
    if (gate.state === 'skipped') return 'CANCELLED';
    if (gate.state === 'unreachable') return 'UNREACHABLE';
    return 'IN_REVIEW'; // gate exists but has not judged yet: the mid stage already handed off
  }
  const mid = byStage(midStage);
  if (mid) return 'IN_REVIEW'; // running, done or failed - once the mid stage exists the TASK reads "in review"
  const author = byStage(authorStage);
  if (!author) return 'BACKLOG';
  if (author.state === 'running') return 'IN_PROGRESS';
  if (author.state === 'pending') return unmetDeps(childRun, author).length ? 'BACKLOG' : 'READY';
  if (author.state === 'skipped') return 'CANCELLED';
  if (author.state === 'unreachable') return 'UNREACHABLE';
  return 'IN_PROGRESS'; // author done, mid stage not yet pushed - a brief window, still "moving"
}

// A STORY's "x/y" tasks column: how many of its child run's subgoals have a DONE task ticket.
// null (not 0/0) before the child run exists at all - "no tasks yet" reads differently from
// "zero of zero tasks done".
export function storyTaskProgress(task, pkgId) {
  const dispatch = latestBySubgoal(task, pkgId, 'dispatch');
  if (!dispatch || !dispatch.child) return null;
  const child = loadRun(dispatch.child.cwd, dispatch.child.run_id);
  if (!child || !child.spec) return null;
  const ids = (child.spec.subgoals || []).map((s) => String(s.id));
  const done = ids.filter((id) => taskTicketState(child, id) === 'DONE').length;
  return `${done}/${ids.length}`;
}

// One row per package, for tm_board's STORY table. role is always 'develop': no other Team
// (planning/qa) reaches the EPIC flow's shape output until v0.12.0 wires it in (§2 is not this
// round's job - see the plan's head).
export function epicBoardRows(task) {
  const packages = (task.spec && task.spec.packages) || [];
  return packages.map((p) => {
    const id = String(p.id);
    const accept = latestBySubgoal(task, id, 'accept');
    const r = accept && accept.result;
    const last = !r ? '—'
      : r.accept === true ? `accept ${r.match_pct == null ? '?' : r.match_pct}`
      : String(r.reason || 'rejected').slice(0, 60);
    return {
      key: storyKey(task.run_id, id), id, title: p.title || '',
      role: 'develop',
      state: storyTicketState(task, id),
      tasks: storyTaskProgress(task, id),
      last_verdict: last,
      reporter: p.repair ? 'repair' : 'shape',
    };
  });
}

// The snapshot a board.jsonl diff is taken over: EPIC key plus every STORY key this task
// currently has a shape for. Called before AND after a mutating tool call; only the keys whose
// value actually changed become a board.jsonl line (taskmanager.mjs's job, not this module's -
// this module never writes).
export function ticketSnapshot(task, opts = {}) {
  const snap = { [epicKey(task.run_id)]: epicTicketState(task) };
  for (const p of (task.spec && task.spec.packages) || []) {
    snap[storyKey(task.run_id, p.id)] = storyTicketState(task, String(p.id), opts);
  }
  return snap;
}
```
- [ ] 4: `node --test teams/scripts/test-tickets.mjs` 전부 통과 확인
- [ ] 5: `git add teams/mcp/tickets.mjs teams/scripts/test-tickets.mjs && git commit -m "feat(teams): tickets.mjs - EPIC/STORY/TASK ticket state as a pure function of task.json (§4)"`

---

### Task 2: `mcp/docs.mjs` — phase md 렌더러 (순수 함수 + 쓰기 한 곳)
**Files:** create `teams/mcp/docs.mjs`, create `teams/scripts/test-docs.mjs`, create
golden fixtures under `teams/scripts/fixtures/docs-golden/E-aaaaaaaa/`
**Interfaces:** consumes Task 1(`tickets.mjs`)의 전부. produces `renderIndex`, `renderRequest`,
`renderShape`, `renderCritique`, `renderStory`, `renderIntegrate`, `renderGoalGate`, `renderReport`,
`renderAll`, `writeDocs` — Task 4(`taskmanager.mjs`의 `tm_docs`)가 `writeDocs`만 소비. Task 1에만
의존하고 `taskmanager.mjs`를 전혀 건드리지 않으므로 Task 3과 완전히 병행 가능.
**Pass bar:** `node --test teams/scripts/test-docs.mjs` 전부 통과 — golden 파일 바이트 비교
포함, `writeDocs({rebuild:true})`가 첫 출력과 동일한 파일을 만드는지 확인.

- [ ] 1: `teams/mcp/docs.mjs`를 만든다
```js
// docs.mjs - §7c's phase markdown, rendered from task.json. Pure render functions plus exactly
// one impure function (writeDocs) that writes them - the engine never reads any of this back
// (md is a rendered view, never a second source of truth, same principle as tickets.mjs's §4).
//
// Scoped to the phases that exist without a planning/qa Team (v0.12+ wires those in - see the
// plan's head): INDEX, the request, the shape, the critique, one page per STORY, the integrate
// round, the goal gate, and the report. 10-planning/10-prd/15-spec-gate/60-qa/65-audit are not
// rendered - there is no data behind them yet, and an empty file would claim a feature that does
// not exist.
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  epicKey, storyKey, docPaths, latestBySubgoal, epicTicketState, epicPhase,
  storyTicketState, storyTaskProgress, epicBoardRows,
} from './tickets.mjs';

function bullets(list) {
  return (list || []).map((x) => `- ${x}`).join('\n') || '- (none)';
}
// A cheap monotonic stand-in for a real revision counter - task.json has none (see the plan's
// 발견 6). Grows every time a node finishes, which is exactly when a re-render would differ.
function rev(task) {
  return task.nodes.filter((n) => n.result).length;
}
function frontmatter(key, state, task, now) {
  return ['---', `key: ${key}`, `state: ${state}`, `updated: ${new Date(now).toISOString()}`, `source: task.json@${rev(task)}`, '---', ''].join('\n');
}

export function renderIndex(task, now = Date.now()) {
  const key = epicKey(task.run_id);
  const state = epicTicketState(task);
  const phase = epicPhase(task);
  const rows = epicBoardRows(task);
  const L = [frontmatter(key, state, task, now), `# ${key} — ${String(task.request).slice(0, 60)}`, ''];
  L.push(`state: ${state} · phase: ${phase || '(done)'} · leader: ${task.leader ? `pid ${task.leader.pid}` : '—'}`, '');
  L.push('| key | role | state | tasks | last verdict |', '|---|---|---|---|---|');
  for (const r of rows) L.push(`| ${r.id} | ${r.role} | ${r.state} | ${r.tasks || '—'} | ${r.last_verdict} |`);
  L.push('', '## Sections', '', '- [Request](./00-request.md)');
  if (task.spec) {
    L.push('- [Shape](./20-shape.md)');
    if (task.nodes.some((n) => n.stage === 'critique' && n.result)) L.push('- [Critique](./30-critique.md)');
    for (const p of task.spec.packages) L.push(`- [${p.id}](./40-stories/${p.id}.md)`);
  }
  if (task.nodes.some((n) => n.stage === 'integrate' && n.result)) L.push('- [Integrate](./50-integrate.md)');
  if (task.nodes.some((n) => n.stage === 'gate' && n.subgoal_id === null && n.result)) L.push('- [Goal gate](./70-goal-gate.md)');
  if (task.nodes.some((n) => n.stage === 'report' && n.state === 'done')) L.push('- [Report](./80-report.md)');
  return L.join('\n') + '\n';
}

export function renderRequest(task, now = Date.now()) {
  const key = epicKey(task.run_id);
  const T = (task.team && task.team.opts) || {};
  const L = [frontmatter(key, epicTicketState(task), task, now), '# Request', '', String(task.request), ''];
  L.push('## Context', task.context ? String(task.context) : '(none)', '');
  L.push('## Team snapshot');
  L.push(`- interactive: ${T.interactive === true}`);
  L.push(`- max_parallel_teams: ${T.max_parallel_teams == null ? '—' : T.max_parallel_teams}`);
  L.push(`- roles: planning=${(T.roles && T.roles.planning) === true}, qa=${(T.roles && T.roles.qa) === true}`);
  L.push(`- goal_threshold: ${T.goal_threshold == null ? '—' : T.goal_threshold}`, '');
  L.push('## Size', `- pinned: ${task.size_pinned || '(not pinned)'}`, `- measured: ${task.size || '(pending)'}`);
  L.push(`- flow: ${task.flow !== 'auto' ? task.flow : (task.flow_chosen || 'auto')}`);
  return L.join('\n') + '\n';
}

export function renderShape(task, now = Date.now()) {
  const key = epicKey(task.run_id);
  const L = [frontmatter(key, epicTicketState(task), task, now), '# Shape', ''];
  L.push('Acceptance:', bullets(task.spec.acceptance), '');
  L.push('| id | title | flow | deps | touches |', '|---|---|---|---|---|');
  for (const p of task.spec.packages) {
    L.push(`| ${p.id} | ${p.title || ''} | ${p.flow || 'auto'} | ${(p.deps || []).join(', ') || '—'} | ${(p.touches || []).join(', ') || '—'} |`);
  }
  return L.join('\n') + '\n';
}

export function renderCritique(task, now = Date.now()) {
  const critique = task.nodes.filter((n) => n.stage === 'critique' && n.result).pop();
  const r = critique.result;
  const key = epicKey(task.run_id);
  const L = [frontmatter(key, epicTicketState(task), task, now), '# Critique', ''];
  L.push(`sound: ${r.sound === true}`, '');
  L.push('Blocking:', bullets(r.blocking), '', 'Problems:', bullets(r.problems));
  return L.join('\n') + '\n';
}

export function renderStory(task, pkgId, now = Date.now()) {
  const pkg = (task.spec.packages || []).find((p) => String(p.id) === String(pkgId));
  const key = storyKey(task.run_id, pkgId);
  const state = storyTicketState(task, pkgId);
  const dispatch = latestBySubgoal(task, pkgId, 'dispatch');
  const accept = latestBySubgoal(task, pkgId, 'accept');
  const r = accept && accept.result;
  const L = [frontmatter(key, state, task, now), `# ${pkgId} — ${(pkg && pkg.title) || ''}`, ''];
  L.push(`state: ${state} · tasks: ${storyTaskProgress(task, pkgId) || '—'} · reporter: ${pkg && pkg.repair ? 'repair' : 'shape'}`, '');
  if (dispatch && dispatch.child) L.push(`worktree: ${dispatch.child.cwd} on branch ${dispatch.child.branch}`, '');
  L.push('## Last verdict');
  if (r) {
    L.push(`accept: ${r.accept === true} · match_pct: ${r.match_pct == null ? '—' : r.match_pct}`, '');
    L.push('Checks:', bullets(r.checks), '', 'Gaps:', bullets(r.gaps));
  } else {
    L.push('(not judged yet)');
  }
  if (dispatch && dispatch.child && dispatch.child.driver) L.push('', '## Driver', `log: ${dispatch.child.driver.log}`);
  return L.join('\n') + '\n';
}

export function renderIntegrate(task, now = Date.now()) {
  const n = task.nodes.filter((x) => x.stage === 'integrate' && x.result).pop();
  const r = n.result;
  const key = epicKey(task.run_id);
  const L = [frontmatter(key, epicTicketState(task), task, now), `# Integrate (${n.node_id})`, ''];
  L.push(`verified: ${r.verified === true}`, '');
  if (n.integration) L.push(`branch: ${n.integration.branch}`, 'Merged:', bullets((n.integration.merged || []).map((m) => `${m.package}: ${m.branch} -> ${m.commit}`)), '');
  L.push('Checks:', bullets(r.checks), '', 'Conflicts:', bullets(r.conflicts));
  return L.join('\n') + '\n';
}

export function renderGoalGate(task, now = Date.now()) {
  const n = task.nodes.filter((x) => x.stage === 'gate' && x.subgoal_id === null && x.result).pop();
  const r = n.result;
  const key = epicKey(task.run_id);
  const L = [frontmatter(key, epicTicketState(task), task, now), `# Goal gate (${n.node_id})`, ''];
  L.push(`accept: ${r.accept === true} · match_pct: ${r.match_pct == null ? '—' : r.match_pct}`, '');
  L.push('Checks:', bullets(r.checks), '', 'Gaps:', bullets(r.gaps), '', 'Spec drift:', bullets(r.spec_drift));
  return L.join('\n') + '\n';
}

export function renderReport(task, now = Date.now()) {
  const n = task.nodes.find((x) => x.stage === 'report' && x.state === 'done');
  const key = epicKey(task.run_id);
  const L = [frontmatter(key, 'DONE', task, now), '# Report', ''];
  L.push(String((n.result && n.result.handoff) || ''));
  return L.join('\n') + '\n';
}

// Every file this task currently has data for, keyed by its full path. A shape not yet done
// means only INDEX + request exist; a fresh gate:goal round adds the goal-gate file; and so on -
// nothing is ever rendered ahead of the data that would back it.
export function renderAll(task, now = Date.now()) {
  const paths = docPaths(task);
  const files = { [paths.index]: renderIndex(task, now), [paths.request]: renderRequest(task, now) };
  if (task.spec) {
    files[paths.shape] = renderShape(task, now);
    if (task.nodes.some((n) => n.stage === 'critique' && n.result)) files[paths.critique] = renderCritique(task, now);
    for (const p of task.spec.packages) files[paths.story(p.id)] = renderStory(task, String(p.id), now);
  }
  if (task.nodes.some((n) => n.stage === 'integrate' && n.result)) files[paths.integrate] = renderIntegrate(task, now);
  if (task.nodes.some((n) => n.stage === 'gate' && n.subgoal_id === null && n.result)) files[paths.goalGate] = renderGoalGate(task, now);
  if (task.nodes.some((n) => n.stage === 'report' && n.state === 'done')) files[paths.report] = renderReport(task, now);
  return files;
}

// The one write site. rebuild:true deletes the EPIC's whole docs directory first, so a stale
// file from a superseded package (a reshape that dropped it) cannot linger - every remaining
// call writes fresh files over whatever is there.
export function writeDocs(task, opts = {}) {
  const files = renderAll(task, opts.now);
  if (opts.rebuild) {
    try { rmSync(docPaths(task).dir, { recursive: true, force: true }); } catch { /* nothing to remove */ }
  }
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
  return Object.keys(files);
}
```
- [ ] 2: `teams/scripts/test-docs.mjs`를 만든다 — 먼저 golden 파일이 없는 채로 실행해 실패를 확인한다
```js
// teams/scripts/test-docs.mjs - golden-file comparison for docs.mjs's renderers, plus a
// rebuild-produces-identical-output check. The golden fixtures under
// teams/scripts/fixtures/docs-golden/E-aaaaaaaa/ are generated once (step 3b below) by
// running the real renderer and are then locked in - the usual way a golden test is bootstrapped.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { node } from '../mcp/graph.mjs';
import { renderAll, writeDocs } from '../mcp/docs.mjs';
import { docPaths } from '../mcp/tickets.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const GOLDEN = join(HERE, 'fixtures', 'docs-golden');
const NOW = 1758000000000; // fixed clock: every render in this file must be byte-identical run to run

// A task well past goal-gate, with a rejected-then-retried P1 and an accepted P2 - exercises
// every renderer renderAll would reach for a task this far along.
function fixtureTask(cwd) {
  return {
    run_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    cwd,
    request: 'change a.txt and b.txt together',
    context: 'from the requester: keep both in sync',
    team: { opts: { docs_dir: '.harness-run/team', interactive: false, max_parallel_teams: 2, roles: { planning: false, qa: false }, goal_threshold: 90 } },
    size: 'L', size_pinned: null, flow: 'develop', flow_chosen: 'develop',
    leader: { pid: 4242 },
    spec: {
      acceptance: ['both modules build together'],
      packages: [
        { id: 'P1', title: 'module a', flow: 'develop', deps: [], touches: ['a.txt'] },
        { id: 'P2', title: 'module b', flow: 'develop', deps: ['P1'], touches: ['b.txt'] },
      ],
    },
    nodes: [
      node('size', 'size', [], { state: 'done', result: { stage_ok: true, size: 'L' } }),
      node('shape', 'shape', ['size'], { state: 'done', result: { stage_ok: true } }),
      node('critique', 'critique', ['shape'], { state: 'done', result: { stage_ok: true, sound: true, blocking: [], problems: ['P1 and P2 could be one package'] } }),
      node('dispatch:P1:1', 'dispatch', ['critique'], { subgoal_id: 'P1', attempt: 1, state: 'done', result: { stage_ok: true }, child: { cwd: '/wt/P1', run_id: 'c1', branch: 'harness/aaaaaaaa/P1', driver: { pid: 1, log: '/log/P1.jsonl' } } }),
      node('accept:P1:1', 'accept', ['dispatch:P1:1'], { subgoal_id: 'P1', attempt: 1, state: 'failed', result: { stage_ok: true, accept: false, match_pct: 60, checks: ['built -> missing tests'], gaps: ['no test coverage'], reason: 'no test coverage' } }),
      node('dispatch:P1:2', 'dispatch', ['dispatch:P1:1'], { subgoal_id: 'P1', attempt: 2, state: 'done', result: { stage_ok: true }, child: { cwd: '/wt/P1', run_id: 'c1b', branch: 'harness/aaaaaaaa/P1', driver: { pid: 2, log: '/log/P1.restart1.jsonl' } } }),
      node('accept:P1:2', 'accept', ['dispatch:P1:2'], { subgoal_id: 'P1', attempt: 2, state: 'done', result: { stage_ok: true, accept: true, match_pct: 92, checks: ['built -> tests pass'], gaps: [] } }),
      node('dispatch:P2:1', 'dispatch', ['accept:P1:2'], { subgoal_id: 'P2', attempt: 1, state: 'done', result: { stage_ok: true }, child: { cwd: '/wt/P2', run_id: 'c2', branch: 'harness/aaaaaaaa/P2', driver: { pid: 3, log: '/log/P2.jsonl' } } }),
      node('accept:P2:1', 'accept', ['dispatch:P2:1'], { subgoal_id: 'P2', attempt: 1, state: 'done', result: { stage_ok: true, accept: true, match_pct: 95, checks: ['built -> ok'], gaps: [] } }),
      node('integrate:1', 'integrate', ['accept:P1:2', 'accept:P2:1'], {
        subgoal_id: null, state: 'done',
        result: { stage_ok: true, verified: true, checks: ['build -> ok'], conflicts: [] },
        integration: { cwd: '/wt/integration', branch: 'harness/aaaaaaaa/integration', merged: [{ package: 'P1', branch: 'harness/aaaaaaaa/P1', commit: 'c0ffee1' }, { package: 'P2', branch: 'harness/aaaaaaaa/P2', commit: 'c0ffee2' }] },
      }),
      node('gate:goal:1', 'gate', ['integrate:1'], { subgoal_id: null, state: 'done', result: { stage_ok: true, accept: true, match_pct: 96, checks: ['reread the request -> matches'], gaps: [], spec_drift: [] } }),
      node('report', 'report', [], { after: ['gate:goal:1'], state: 'done', result: { stage_ok: true, handoff: 'Both modules delivered and integrated; goal gate accepted at 96%.' } }),
    ],
  };
}

function goldenPath(name) { return join(GOLDEN, name); }
function readGolden(name) { return readFileSync(goldenPath(name), 'utf8'); }

test('renderAll produces exactly the files this fixture has data for, matching the golden fixtures byte for byte', () => {
  const task = fixtureTask('/proj');
  const files = renderAll(task, NOW);
  const expectedNames = ['INDEX.md', '00-request.md', '20-shape.md', '30-critique.md', '40-stories/P1.md', '40-stories/P2.md', '50-integrate.md', '70-goal-gate.md', '80-report.md'];
  const paths = docPaths(task);
  const expectedPaths = new Set([paths.index, paths.request, paths.shape, paths.critique, paths.story('P1'), paths.story('P2'), paths.integrate, paths.goalGate, paths.report]);
  assert.deepEqual(new Set(Object.keys(files)), expectedPaths);
  for (const name of expectedNames) {
    assert.equal(files[join(paths.dir, name)], readGolden(name), `${name} did not match its golden file`);
  }
});

test('writeDocs({rebuild:true}) reproduces byte-identical files - the property that matters, not any one file\'s content', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'docs-rebuild-'));
  try {
    const task = fixtureTask(cwd);
    const first = writeDocs(task, { rebuild: true, now: NOW });
    const firstBytes = Object.fromEntries(first.map((p) => [p, readFileSync(p, 'utf8')]));
    const second = writeDocs(task, { rebuild: true, now: NOW });
    assert.deepEqual(second.sort(), first.sort(), 'rebuild wrote the same set of files');
    for (const p of second) assert.equal(readFileSync(p, 'utf8'), firstBytes[p], `${p} changed on rebuild`);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('writeDocs without rebuild leaves a stale file from a dropped package - rebuild:true is what clears it', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'docs-stale-'));
  try {
    const task = fixtureTask(cwd);
    writeDocs(task, { rebuild: true, now: NOW });
    const paths = docPaths(task);
    task.spec.packages = task.spec.packages.filter((p) => p.id !== 'P2'); // P2 dropped by a reshape
    const withoutRebuild = writeDocs(task, { now: NOW });
    assert.ok(readdirSync(join(paths.dir, '40-stories')).includes('P2.md'), 'stale file survives a non-rebuild write');
    assert.ok(!withoutRebuild.includes(paths.story('P2')), 'but renderAll itself no longer names it');
    writeDocs(task, { rebuild: true, now: NOW });
    assert.ok(!readdirSync(join(paths.dir, '40-stories')).includes('P2.md'), 'rebuild:true removes it');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
```
- [ ] 3: `node --test teams/scripts/test-docs.mjs` → golden 파일이 없어 첫 테스트가 fail 확인
- [ ] 3b: golden 픽스처를 생성한다 — 실제 렌더러를 한 번 돌려 그 출력을 그대로 저장한다(golden 테스트를
  부트스트랩하는 통상 방법: 손으로 마크다운을 옮겨 적지 않고, 코드가 낸 출력을 사람이 읽어 확인한 뒤
  고정한다):
```bash
node -e "
import('./teams/mcp/docs.mjs').then(({ renderAll }) => {
  import('./teams/mcp/graph.mjs').then(() => {}); // ensure ESM resolution order
  const NOW = 1758000000000;
  const task = /* the exact fixtureTask('/proj') object from test-docs.mjs, pasted here verbatim */ null;
});
"
```
  (실무 절차: `test-docs.mjs`의 `fixtureTask('/proj')`를 그대로 복사한 작은 일회성 스크립트로
  `renderAll(task, NOW)`를 호출해 각 경로→내용 맵을 얻고, `teams/scripts/fixtures/docs-golden/`
  아래 `INDEX.md`, `00-request.md`, `20-shape.md`, `30-critique.md`, `40-stories/P1.md`,
  `40-stories/P2.md`, `50-integrate.md`, `70-goal-gate.md`, `80-report.md` 아홉 파일로 저장한다.
  저장 전에 각 파일을 사람이 읽어 §7c의 형식과 어긋나지 않는지 확인한다.)
- [ ] 4: `node --test teams/scripts/test-docs.mjs` 전부 통과 확인
- [ ] 5: `git add teams/mcp/docs.mjs teams/scripts/test-docs.mjs teams/scripts/fixtures/docs-golden && git commit -m "feat(teams): docs.mjs - §7c phase markdown rendered from task.json, golden-file tested"`

---

### Task 3: `taskmanager.mjs` — board.jsonl diff 배선 + `tm_board`/`tm_ticket`
**Files:** modify `teams/mcp/taskmanager.mjs`, modify `teams/scripts/test-taskmanager.mjs`
**Interfaces:** consumes Task 1(`tickets.mjs`)의 `ticketSnapshot`/`epicKey`/`storyKey`/`docPaths`/
`epicTicketState`/`epicPhase`/`epicBoardRows`/`latestBySubgoal`/`storyTicketState`/
`storyTaskProgress`. `docs.mjs`(Task 2)는 가져오지 않는다 — `doc_path`는 결정적 경로 문자열일 뿐,
파일이 실제로 있는지는 확인하지 않는다(Task 4가 `tm_docs`로 그 파일을 만든다). Task 2와 파일이
겹치지 않아 완전히 병행 가능.
**Pass bar:** `node --test teams/scripts/test-taskmanager.mjs` 전체 통과(회귀 0), 새로 추가한
것 포함, `tools/list`가 `tm_board`/`tm_ticket`을 포함(여덟 개).

- [ ] 1: 실패하는 테스트를 `test-taskmanager.mjs`에 추가한다(기존 `withTask`/`throughCritique`/
  `toIntegrate`/`toManagerGoalGate`/`completeChild`/`ok`/`SHAPE` 헬퍼를 그대로 쓴다):
```js
// ---------- tm_board / tm_ticket / board.jsonl ----------

test('serves the MCP handshake and the eight manager tools', async () => {
  const c = await new Client(TM).init();
  try {
    const r = await c.send('tools/list', {});
    assert.deepEqual(r.result.tools.map((t) => t.name).sort(), ['tm_board', 'tm_events', 'tm_next', 'tm_open', 'tm_retry', 'tm_status', 'tm_submit', 'tm_ticket']);
  } finally {
    c.close();
  }
});

test('tm_board with no task_id lists every EPIC, ticket-shaped; with task_id it gives the STORY kanban and a doc_path', async () => {
  await withTask(async ({ tm, task_id }) => {
    const list = await tm.call('tm_board', {});
    assert.ok(list.epics.some((e) => e.task_id === task_id && e.state === 'READY' && e.phase === 'plan'));

    await throughCritique(tm, task_id);
    const board = await tm.call('tm_board', { task_id });
    assert.equal(board.key, `E-${task_id.slice(0, 8)}`);
    assert.equal(board.phase, 'impl');
    assert.equal(board.stories.length, 2);
    assert.deepEqual(board.stories.map((s) => s.id), ['P1', 'P2']);
    assert.equal(board.stories[0].state, 'READY', 'P1 has no deps: ready at once');
    assert.equal(board.stories[1].state, 'BACKLOG', 'P2 depends on P1');
    assert.match(board.doc_path, /INDEX\.md$/);
  });
});

test('tm_ticket reads an EPIC key or a STORY key, and always returns a doc_path even before tm_docs has written anything', async () => {
  await withTask(async ({ tm, task_id }) => {
    await throughCritique(tm, task_id);
    const epic = await tm.call('tm_ticket', { key: `E-${task_id.slice(0, 8)}` });
    assert.equal(epic.kind, 'EPIC');
    assert.equal(epic.state, 'IN_PROGRESS');
    const story = await tm.call('tm_ticket', { key: `E-${task_id.slice(0, 8)}/P1` });
    assert.equal(story.kind, 'STORY');
    assert.equal(story.state, 'READY');
    assert.match(story.doc_path, /40-stories\/P1\.md$/);
    assert.ok(!existsSync(story.doc_path), 'tm_ticket never writes the file itself');
  });
});

test('tm_ticket refuses an unknown EPIC prefix or a package not in the shape', async () => {
  await withTask(async ({ tm, task_id }) => {
    await throughCritique(tm, task_id);
    const bad = await tm.call('tm_ticket', { key: 'E-ffffffff' });
    assert.match(bad.error, /no EPIC starting with ffffffff/);
    const badPkg = await tm.call('tm_ticket', { key: `E-${task_id.slice(0, 8)}/P9` });
    assert.match(badPkg.error, /no package P9/);
  });
});

test('board.jsonl gets one line per ticket key that actually changed - never a line for a key that did not move', async () => {
  await withTask(async ({ tm, g, task_id, root }) => {
    const boardPath = join(root, task_id, 'board.jsonl');
    await throughCritique(tm, task_id);
    const afterCritique = readFileSync(boardPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    const epicKey = `E-${task_id.slice(0, 8)}`;
    assert.ok(afterCritique.some((e) => e.key === epicKey && e.to === 'IN_PROGRESS'));
    assert.ok(afterCritique.some((e) => e.key === `${epicKey}/P1` && e.to === 'READY'));
    assert.ok(afterCritique.some((e) => e.key === `${epicKey}/P2` && e.to === 'BACKLOG'));

    const nx = await tm.call('tm_next', { task_id });
    await completeChild(g, nx.children[0]);
    await tm.call('tm_submit', { task_id, node_id: 'dispatch:P1:1' });
    const events = readFileSync(boardPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.ok(events.some((e) => e.key === `${epicKey}/P1` && e.from === 'READY' && e.to === 'IN_PROGRESS'));
    assert.ok(events.some((e) => e.key === `${epicKey}/P1` && e.to === 'IN_REVIEW'), 'dispatch folded done, accept is pending');
    // P2 never moved in this stretch - unmet deps the whole time - so it gets no new line at all.
    assert.equal(events.filter((e) => e.key === `${epicKey}/P2`).length, 1, 'only the original BACKLOG line from shape');
  });
});

test('a non-leader call that gets queued to the inbox writes no board.jsonl line - nothing on disk changed yet', async () => {
  const cwd = repo();
  const root = mkdtempSync(join(tmpdir(), 'tm-root-'));
  const main = await new Client(TM, { HARNESS_TASKS_DIR: root, HARNESS_CHILD_DRIVER: 'node -e setTimeout(()=>{},30000)' }).init();
  let leader;
  try {
    const open = await main.call('tm_open', { request: 'r', cwd, vendor: 'self' });
    leader = await new Client(TM, { HARNESS_TASKS_DIR: root, HARNESS_LEADER_OF: open.task_id }).init();
    await main.call('tm_submit', { task_id: open.task_id, node_id: 'size', payload: ok({ size: 'L', flow: 'develop' }) });
    const boardPath = join(root, open.task_id, 'board.jsonl');
    const before = existsSync(boardPath) ? readFileSync(boardPath, 'utf8') : '';
    const q = await main.call('tm_submit', { task_id: open.task_id, node_id: 'shape', payload: ok({ ...SHAPE, handoff: 's' }) });
    assert.equal(q.queued, true, JSON.stringify(q));
    const after = existsSync(boardPath) ? readFileSync(boardPath, 'utf8') : '';
    assert.equal(after, before, 'queued, not applied: no ticket actually moved');
  } finally {
    main.close();
    if (leader) leader.close();
    rmSync(cwd, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});
```
- [ ] 2: `node --test teams/scripts/test-taskmanager.mjs` → 위 새 테스트 6개가 fail 확인(기존은
  회귀 없이 통과)
- [ ] 3: `teams/mcp/taskmanager.mjs`를 고친다. 임포트 블록(`import { touchMarker } from
  './engage.mjs';` 다음 줄)에 추가:
```js
import {
  epicKey, storyKey, docPaths, latestBySubgoal, epicTicketState, epicPhase,
  storyTicketState, storyTaskProgress, epicBoardRows, ticketSnapshot,
} from './tickets.mjs';
```
  `TOOLS` 배열의 `tm_events` 항목과 닫는 `];` 사이에 두 항목을 추가:
```js
  {
    name: 'tm_board',
    description: 'Ticket-shaped board (§4/§8 of the design doc). Omit task_id for every EPIC this manager knows (key, state, phase). With task_id: the EPIC header plus its STORY kanban - one row per package, its state derived from task.json the same way tm_status is, never a second source of truth - and a doc_path to the human-readable INDEX.md (which may not exist on disk yet; see tm_docs). Read-only.',
    inputSchema: { type: 'object', properties: { task_id: { type: 'string' } } },
    outputSchema: { type: 'object' },
  },
  {
    name: 'tm_ticket',
    description: 'One ticket by key: E-xxxxxxxx for the EPIC, E-xxxxxxxx/Pn for a STORY. State, worktree/branch, task progress (x/y) and the last accept verdict, plus a doc_path. Read-only; a doc_path is always returned, even before tm_docs has written anything there.',
    inputSchema: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] },
    outputSchema: { type: 'object' },
  },
```
  `toolEvents` 함수 바로 뒤에 새 함수 셋을 추가:
```js
// board.jsonl - ticket TRANSITIONS only, append-only, never read as ground truth. tickets.mjs's
// pure functions over task.json are the ground truth; this is the JIRA-style history a human
// reads (§4, §7b). Written by diffing a before/after snapshot around the four tools that can
// actually move a ticket - never by instrumenting taskmanager.mjs's dozen individual mutation
// sites one at a time.
const BOARD_TOOLS = new Set(['tm_open', 'tm_next', 'tm_submit', 'tm_retry']);

function appendBoardTransitions(task, before, by) {
  const after = ticketSnapshot(task);
  const path = join(taskDir(task.run_id), 'board.jsonl');
  for (const [key, to] of Object.entries(after)) {
    const from = before[key] || null;
    if (from === to) continue;
    try {
      mkdirSync(taskDir(task.run_id), { recursive: true });
      appendFileSync(path, JSON.stringify({ ts: Date.now(), key, from, to, by: String(by || 'tm') }) + '\n');
    } catch { /* the board is evidence, not a dependency - same rule as record() */ }
  }
}

function toolBoard(a) {
  if (!a.task_id) {
    let ids = [];
    try { ids = readdirSync(tasksRoot()); } catch { ids = []; }
    const epics = ids.map((id) => loadRunAt(taskPath(id))).filter(Boolean)
      .sort((x, y) => (y.created_at || 0) - (x.created_at || 0))
      .map((t) => ({ key: epicKey(t.run_id), task_id: t.run_id, title: String(t.request).slice(0, 60), state: epicTicketState(t), phase: epicPhase(t) }));
    return { epics };
  }
  const task = mustFindTask(a);
  return {
    key: epicKey(task.run_id),
    task_id: task.run_id,
    title: String(task.request).slice(0, 80),
    state: epicTicketState(task),
    phase: epicPhase(task),
    leader: task.leader ? { pid: task.leader.pid, alive: leaderAlive(task) } : null,
    stories: epicBoardRows(task),
    doc_path: docPaths(task).index,
  };
}

function toolTicket(a) {
  const key = String(a.key || '');
  const m = /^E-([0-9a-f]{8})(?:\/(.+))?$/.exec(key);
  if (!m) throw new Error(`unrecognized ticket key "${key}": expected E-xxxxxxxx or E-xxxxxxxx/Pn`);
  const [, epic8, pkgId] = m;
  let ids = [];
  try { ids = readdirSync(tasksRoot()); } catch { ids = []; }
  const found = ids.find((id) => id.startsWith(epic8));
  if (!found) throw new Error(`no EPIC starting with ${epic8}`);
  const task = mustFindTask({ task_id: found });
  if (!pkgId) {
    return {
      key: epicKey(task.run_id), task_id: task.run_id, kind: 'EPIC',
      title: String(task.request).slice(0, 160),
      state: epicTicketState(task), phase: epicPhase(task),
      leader: task.leader ? { pid: task.leader.pid, alive: leaderAlive(task) } : null,
      doc_path: docPaths(task).index,
    };
  }
  const pkg = packageOf(task, pkgId);
  if (!pkg) throw new Error(`no package ${pkgId} in ${epicKey(task.run_id)} (packages: ${((task.spec && task.spec.packages) || []).map((p) => p.id).join(', ') || 'none yet'})`);
  const dispatch = latestBySubgoal(task, pkgId, 'dispatch');
  const accept = latestBySubgoal(task, pkgId, 'accept');
  return {
    key: storyKey(task.run_id, pkgId), task_id: task.run_id, kind: 'STORY',
    title: pkg.title,
    state: storyTicketState(task, pkgId),
    tasks: storyTaskProgress(task, pkgId),
    worktree: dispatch && dispatch.child ? { cwd: dispatch.child.cwd, branch: dispatch.child.branch } : null,
    last_verdict: accept && accept.result ? { accept: accept.result.accept, match_pct: accept.result.match_pct, gaps: accept.result.gaps || [] } : null,
    reporter: pkg.repair ? 'repair' : 'shape',
    doc_path: docPaths(task).story(pkgId),
  };
}
```
  `callTool`/`switch` 정의를 통째로 바꾼다(기존 함수 전체를 아래로 교체 — `switch`는
  `dispatch()`라는 이름의 내부 함수로 옮기고, 보드 diff는 그걸 감싸는 래퍼가 진다):
```js
function dispatch(name, a) {
  switch (name) {
    case 'tm_open': return toolOpen(a);
    case 'tm_next': return { ...toolNext(a), inbox_applied: a.__inbox_applied || 0 };
    case 'tm_submit': return toolSubmit(a);
    case 'tm_retry': return toolRetry(a);
    case 'tm_status': return toolStatus(a);
    case 'tm_events': return toolEvents(a);
    case 'tm_board': return toolBoard(a);
    case 'tm_ticket': return toolTicket(a);
    default: throw new Error('unknown tool: ' + name);
  }
}

function callTool(name, args) {
  const a = args || {};
  // The TaskLeader gate: runs before every tool but tm_open (there is no task yet to gate).
  // Any dead leader is serviced here so it is respawned (or reported exhausted) on any tm_* call,
  // not just tm_next. While a leader is alive and this call is not from the leader process itself,
  // a mutating tool is queued to the inbox instead of applied, and tm_next reports the leader's
  // state instead of driving; the leader drains the inbox at the top of its OWN tm_next below.
  if (a.task_id && name !== 'tm_open') {
    const task = mustFindTask(a);
    serviceLeader(task);
    const watcher = !noLeader() && !isLeaderProcess(task) && task.leader && leaderAlive(task);
    if (watcher && MUTATING_TOOLS.has(name)) return queueToInbox(task, name, a);
    if (watcher && name === 'tm_next') {
      const st = runState(task);
      return {
        task_id: task.run_id, state: st.state, counts: st.counts, driven_by: 'leader',
        leader: { pid: task.leader.pid, alive: true, log: task.leader.log, restarts: task.leader.restarts },
        hint: 'the TaskLeader driver runs the loop; watch tm_status({task_id}) and tm_events({task_id})',
      };
    }
    if (name === 'tm_next' && (isLeaderProcess(task) || noDriver())) { const n = drainInbox(task); if (n) a.__inbox_applied = n; }
  }
  // board.jsonl: taken as a before/after diff of the four tools that can move a ticket. A call
  // that got queued above (return already happened) never reaches here - nothing moved, so
  // nothing is logged, with no special-casing needed. A recursive call from drainInbox reaches
  // here too, exactly like a direct one, and is diffed the same way.
  if (!BOARD_TOOLS.has(name)) return dispatch(name, a);
  const before = a.task_id ? ticketSnapshot(mustFindTask(a)) : {};
  const out = dispatch(name, a);
  const taskId = (out && out.task_id) || a.task_id;
  if (taskId) {
    try { appendBoardTransitions(mustFindTask({ task_id: taskId }), before, a.node_id || name); } catch { /* best-effort, like record() */ }
  }
  return out;
}
```
- [ ] 4: `node --test teams/scripts/test-taskmanager.mjs` 전체 통과 확인(회귀 0)
- [ ] 5: `git add teams/mcp/taskmanager.mjs teams/scripts/test-taskmanager.mjs && git commit -m "feat(teams): board.jsonl ticket-transition log + tm_board/tm_ticket, derived from task.json (§4/§8)"`

---

### Task 4: `taskmanager.mjs` — `tm_docs` 배선
**Files:** modify `teams/mcp/taskmanager.mjs`, modify `teams/scripts/test-taskmanager.mjs`
**Interfaces:** consumes Task 2(`docs.mjs`의 `writeDocs`)와 Task 3(같은 파일의 `dispatch`/`TOOLS`).
Task 3이 끝난 뒤에만 의미 있게 시작할 수 있다(같은 파일, 직렬).
**Pass bar:** `node --test teams/scripts/test-taskmanager.mjs` 전체 통과(회귀 0), `tools/list`
아홉 개(`tm_docs` 포함).

- [ ] 1: 실패하는 테스트를 추가한다:
```js
test('serves the MCP handshake and the nine manager tools', async () => {
  const c = await new Client(TM).init();
  try {
    const r = await c.send('tools/list', {});
    assert.deepEqual(r.result.tools.map((t) => t.name).sort(), ['tm_board', 'tm_docs', 'tm_events', 'tm_next', 'tm_open', 'tm_retry', 'tm_status', 'tm_submit', 'tm_ticket']);
  } finally {
    c.close();
  }
});

test('tm_docs writes the phase md tm_board/tm_ticket already pointed at, and rebuild reproduces the same files', async () => {
  await withTask(async ({ tm, g, task_id }) => {
    await throughCritique(tm, task_id);
    const board = await tm.call('tm_board', { task_id });
    const first = await tm.call('tm_docs', { task_id });
    assert.ok(first.written.includes(board.doc_path));
    assert.equal(readFileSync(board.doc_path, 'utf8').includes(`E-${task_id.slice(0, 8)}`), true);

    const nx = await tm.call('tm_next', { task_id });
    await completeChild(g, nx.children[0]);
    await tm.call('tm_submit', { task_id, node_id: 'dispatch:P1:1' });
    await tm.call('tm_submit', { task_id, node_id: 'accept:P1:1', payload: ok({ accept: true, match_pct: 90 }) });

    const before = readFileSync(board.doc_path, 'utf8');
    const rebuilt = await tm.call('tm_docs', { task_id, rebuild: true });
    assert.notEqual(readFileSync(board.doc_path, 'utf8'), before, 'P1 moved to DONE since the first render');
    const again = await tm.call('tm_docs', { task_id, rebuild: true });
    assert.deepEqual(again.written.sort(), rebuilt.written.sort());
    for (const p of again.written) assert.equal(readFileSync(p, 'utf8'), readFileSync(p, 'utf8'), p);
  });
});
```
- [ ] 2: `node --test teams/scripts/test-taskmanager.mjs` → 위 두 테스트 fail 확인
- [ ] 3: `teams/mcp/taskmanager.mjs`를 고친다. 임포트 블록 끝에 추가:
```js
import { writeDocs } from './docs.mjs';
```
  `TOOLS` 배열의 `tm_ticket` 항목 뒤, 닫는 `];` 앞에 추가:
```js
  {
    name: 'tm_docs',
    description: '(Re)render the phase markdown under <docs_dir>/E-<task8>/ from task.json - INDEX, request, shape, critique, one page per STORY, integrate, goal gate and report, whichever already have data (§7c). rebuild:true deletes the directory first and writes every file fresh; without it, existing files are simply overwritten and a stale file from a dropped package survives. The engine never reads these back - md is a rendered view, not a second source of truth.',
    inputSchema: { type: 'object', properties: { task_id: { type: 'string' }, rebuild: { type: 'boolean' } }, required: ['task_id'] },
    outputSchema: { type: 'object', properties: { task_id: { type: 'string' }, rebuild: { type: 'boolean' }, written: { type: 'array', items: { type: 'string' } } } },
  },
```
  `toolTicket` 함수 바로 뒤에 추가:
```js
function toolDocs(a) {
  const task = mustFindTask(a);
  const written = writeDocs(task, { rebuild: a.rebuild === true });
  return { task_id: task.run_id, rebuild: a.rebuild === true, written };
}
```
  `dispatch()`의 `case 'tm_ticket': return toolTicket(a);` 다음 줄에 추가:
```js
    case 'tm_docs': return toolDocs(a);
```
- [ ] 4: `node --test teams/scripts/test-taskmanager.mjs` 전체 통과 확인(회귀 0)
- [ ] 5: `git add teams/mcp/taskmanager.mjs teams/scripts/test-taskmanager.mjs && git commit -m "feat(teams): tm_docs - render §7c phase markdown on demand, rebuild reproduces the same files"`

---

### Task 5: 명령 스킬 — `teams:board`, `teams:ticket`
**Files:** create `teams/skills/board/SKILL.md`, create `teams/skills/ticket/SKILL.md`
**Interfaces:** consumes 없음(정적 문서) — `tm_board`/`tm_ticket`을 이름으로만 참조. 어떤 소스
파일과도 import 관계가 없어 Task 1-4 전부와 완전히 병행 가능(실제로 유용해지는 건 Task 3 이후지만,
파일 자체는 먼저 만들어도 충돌이 없다).
**Pass bar:** `python3 scripts/validate_plugins.py` teams 관련 ERROR 0.

- [ ] 1: `teams/skills/board/SKILL.md`
```markdown
---
name: board
description: >-
  Use when the user wants to see the state of a teams task without opening task.json or
  polling tm_status - "보드 보여줘", "지금 어떻게 돼가?", "show me the board", "what's the state of
  this task". Calls tm_board and renders its ticket table. Not for opening a new task (use
  orchestrate/develop/document/plan/qa) and not for one ticket's detail (use ticket).
effort: low
scenarios:
  - "Show me the board for this task - what's done, what's in progress, what's waiting"
  - "그래프 태스크 지금 상태 좀 보여줘"
compatibility:
  required:
    - teams-engineering
related:
  - ticket
  - orchestrate
---

# board — the ticket-shaped view of a task

Calls `tm_board` and nothing else. With no `E-xxxxxxxx` given, list every EPIC this machine's
`~/.harness/tasks/` knows (key, one-line title, state, phase) and ask which one, unless the user
already named one or only one exists.

With a key, render exactly what `tm_board({task_id})` returns: the EPIC line (key, title, state,
phase, leader pid/alive), then the STORY table (id, role, state, tasks x/y, last verdict), then
`doc_path`. Do not re-derive or embellish any of it - `tm_board` already computed the ticket state
from `task.json` the same way `tm_status` would; this skill is the terminal-table view, not a
second computation of it.

Never read `doc_path` into the conversation. Say it is there and that a human can open it in an
editor - the same "no payload in main" rule that applies to a node's own payload applies to the
rendered markdown too (§7c of the design doc). If it looks stale, say `tm_docs({task_id})` refreshes
it; do not call `tm_docs` yourself unless asked to.

## What the current AI does

Calls `tm_board`, prints its table, names the `doc_path` without opening it.

## What you do

Say which task, or which key on it if you have several open.

## Related skills

- `ticket` — the same idea for one STORY or the EPIC itself, with more detail
- `orchestrate` — opens a task in the first place
```
- [ ] 2: `teams/skills/ticket/SKILL.md`
```markdown
---
name: ticket
description: >-
  Use when the user wants one ticket's detail, not the whole board - a specific STORY or the EPIC
  itself, by its key - "E-xxxxxxxx/P2 상태 보여줘", "what's the state of P2", "show me that ticket".
  Calls tm_ticket. Not for the whole task's table (use board).
effort: low
scenarios:
  - "What's the state of E-a1b2c3d4/P2 - is it done, and what did accept say?"
  - "이 티켓 지금 어떤 상태인지, 워크트리는 어디 있는지 보여줘"
compatibility:
  required:
    - teams-engineering
related:
  - board
  - orchestrate
---

# ticket — one ticket's detail

Calls `tm_ticket({key})` and nothing else. A key is `E-xxxxxxxx` for the EPIC or
`E-xxxxxxxx/Pn` for a STORY - ask for one if the user named neither. `tm_ticket` refuses an
unknown EPIC prefix or a package not in the shape; relay that refusal rather than guessing at a
key.

Render exactly what it returns: state, (for a STORY) worktree/branch, task progress, and the last
accept verdict (accept/match_pct/gaps), plus `doc_path`. Same rule as `board`: name the doc path,
never read it into the conversation.

## What the current AI does

Calls `tm_ticket`, prints its fields, names the `doc_path` without opening it.

## What you do

Say which ticket - the key, or enough to find it (task + package id).

## Related skills

- `board` — the whole task's kanban table, one row per STORY
- `orchestrate` — opens a task in the first place
```
- [ ] 3: `python3 scripts/validate_plugins.py 2>&1 | grep -i teams` — ERROR 없음 확인
- [ ] 4: `grep -c '^name: board$' teams/skills/board/SKILL.md` → 1, `grep -c '^name: ticket$' teams/skills/ticket/SKILL.md` → 1 확인
- [ ] 5: `git add teams/skills/board/SKILL.md teams/skills/ticket/SKILL.md && git commit -m "docs(teams): board/ticket entry skills - thin wrappers over tm_board/tm_ticket"`

---

### Task 6: 릴리스 0.11.0 — 버전, Status, 설계 문서 §11, 전체 검증
**Files:** modify `teams/.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`
(teams 항목만), `teams/README.md`, `teams/KOR.md`
**Interfaces:** consumes Task 1-5 전부.
**Pass bar:** `node --test teams/scripts/test-*.mjs` 전부 통과(회귀 0), `python3
scripts/validate_plugins.py` ERROR 0, 두 매니페스트 0.11.0 일치, README·KOR Status 첫 항목이
v0.11.0.

- [ ] 1: `git fetch skills main && git status -sb` — origin이 앞서 있으면 rebase(다른 agent가
  병행 중인 `harness-beta` 은퇴 커밋이 먼저 들어와 있을 수 있다 — 그 변경과는 파일이 겹치지 않는다)
- [ ] 2: `node --test teams/scripts/test-*.mjs 2>&1 | tail -8` → `# fail 0` 확인
- [ ] 3: patch 범프: `teams/.claude-plugin/plugin.json`과 `.claude-plugin/marketplace.json`의
  teams `"version": "0.10.1"` → `"0.11.0"`; marketplace description 끝에 " Adds a ticket
  layer derived from task.json (tickets.mjs), an append-only board.jsonl transition log, §7c phase
  markdown (docs.mjs), and tm_board/tm_ticket/tm_docs with two entry skills." 추가
- [ ] 4: README `## Status` 맨 위, KOR `## 상태` 맨 위에 한 줄씩 prepend(기존 항목은 그 아래 그대로
  둔다):
  - README: `- **v0.11.0 — ticket layer**: EPIC/STORY/TASK ticket state derived from task.json as a
    pure function (tickets.mjs, §4) - never a second source of truth. board.jsonl logs only the
    transitions a diff actually found, around the four tools that can move one. docs.mjs renders
    §7c's phase markdown (INDEX, request, shape, critique, one page per STORY, integrate, goal
    gate, report) from the same task.json; the engine never reads it back, and tm_docs({rebuild})
    reproduces byte-identical files. teams:board and teams:ticket are thin terminal-table
    wrappers. Not yet: planning/qa wired into the EPIC flow itself, shape's role/priority, defect
    STORYs, or human executors - those are v0.12.0+.`
  - KOR: 같은 내용을 한국어로.
- [ ] 5: 설계 문서(`docs/plans/2026-09-17-teams-team.md`)는 이 계획 파일 소유가 아니므로
  건드리지 않는다 — §11의 v0.11.0 행을 "완료"로 표시하는 것은 팀 리더나 그 갱신을 맡은 agent의 몫.
- [ ] 6: `python3 scripts/validate_plugins.py` ERROR 0 확인
- [ ] 7: `git add teams/.claude-plugin/plugin.json .claude-plugin/marketplace.json teams/README.md teams/KOR.md && git commit -m "feat(teams): 0.11.0 - ticket layer (tickets.mjs, board.jsonl, docs.mjs), tm_board/tm_ticket/tm_docs, board/ticket entry skills"`
- [ ] 8: `git push skills main`(저장소 규칙. 실패하면 1번으로 돌아가 fetch·rebase 후 재시도)

---

## 자기 검토

- **소비/생산 연결**: Task 2·3은 둘 다 Task 1의 `tickets.mjs` exports에만 의존하고 서로는 의존하지
  않는다(Task 2는 `docs.mjs`를 새로 만들 뿐 `taskmanager.mjs`를 안 건드리고, Task 3은 `docs.mjs`를
  가져오지 않는다) — 그래서 둘이 완전히 병행된다. Task 4는 Task 2(`writeDocs`)와 Task 3(같은
  `taskmanager.mjs`의 `dispatch`/`TOOLS`)이 **둘 다** 끝난 뒤에만 의미 있게 시작할 수 있다. Task 5는
  코드 의존이 전혀 없어 언제든 갈 수 있다. Task 6은 전부의 위.
- **파일 충돌**: `teams/mcp/taskmanager.mjs`(+`scripts/test-taskmanager.mjs`)를 건드리는 건
  Task 3과 Task 4뿐이고, 이 둘은 이미 직렬로 배치했다. 나머지 넷(1·2·5·6)은 서로 파일이 하나도
  겹치지 않는다.
- **`doc_path`가 항상 반환된다는 설계가 Task 3/4 분리를 실제로 가능하게 한다**: `docPaths()`(Task 1)
  는 파일이 있는지 확인하지 않고 결정적 경로 문자열만 계산하므로, `tm_board`/`tm_ticket`(Task 3)이
  `tm_docs`(Task 4) 없이도 완결된 도구로 동작한다 — 두 태스크를 별도 라운드로도 쪼갤 수 있다는
  뜻이고(발견 7), 이번엔 한 라운드로 간다.
- **§4/§7c 대비 다섯 가지 불일치·추가**(위 "발견" 절): (1) `WAITING_USER`는 이번 라운드 코드
  경로에서 만들어지지 않음(human 없음), (2) STORY BACKLOG의 정의를 "노드 미생성"에서 "존재하는
  dispatch의 unmetDeps"로 정정, (3) EPIC 레벨 BLOCKED를 §4의 표에 없던 상태로 추가, (4) STORY·TASK
  둘 다에 CANCELLED/UNREACHABLE을 §4의 다이어그램에는 있지만 표에는 없던 상태로 추가, (5) §7b의
  "tmp+rename" 서술이 실제 `graph.mjs`의 락+병합 메커니즘과 다름(이 계획은 실제 메커니즘 위에서
  동작). (6) `task.json`에 리비전 카운터가 없어 "결과 난 노드 수"로 대신함.
- **위험**: golden 파일은 손으로 옮겨 적지 않고 실제 렌더러의 출력을 저장해 잠근다(Task 2 스텝
  3b) — 코드를 실행하지 않고 마크다운 바이트를 손으로 예측하는 것보다 이 편이 실제로 맞다. 대신
  스텝 3b는 "실행해서 저장"이라는 절차이지, 결과물을 미리 문자 그대로 못박은 것은 아니다 — 실행하는
  사람(구현 태스크를 맡는 agent)이 §7c의 형식과 어긋나지 않는지 사람이 한 번 읽고 확인해야 한다.
- **위험**: `board.jsonl` diff 래퍼는 `tm_next`도 감싼다 — 매 폴링마다 스냅샷을 두 번(전/후) 계산한다.
  이미 존재하는 다른 폴링 비용(driver 생존 확인, 자식 run 파일 읽기)에 비하면 작지만, 태스크가
  아주 커지면(패키지 수십 개) `ticketSnapshot`이 매 폴링 O(패키지 수)로 도는 비용이 쌓인다 — 지금
  규모(2-6 패키지, §5)에서는 무시할 만하고, 실측은 v0.10.0 이후의 관례대로 이 라운드가 끝난 뒤
  1회.
