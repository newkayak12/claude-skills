# graph-beta (team) v0.10.0 — install / remove / patch + team.json + 공존 + engagement 마커 구현 계획

> Produced by write:writing-plans. Owner for execution routing: planning:executing-plans.
> Steps use checkbox (`- [ ]`) syntax. 설계 근거: `2026-09-17-graph-beta-team.md` §6·§7b·§12·§13.

**Goal:** graph-beta에 harness와 같은 두께의 `install`/`remove`/`patch`를 두고, `tm_open`이 프로젝트의
`.claude/team.json`을 기본값으로 읽게 하며, harness와 같은 프로젝트에서 서로의 게이트를 막지 않게 한다.

**Architecture:** 세 스크립트는 harness의 `install.mjs`/`remove.mjs`/`patch.mjs`를 그대로 본뜬 결정적·멱등
파일 연산이고 판단은 SKILL.md가 한다. `team.json`은 새 모듈 `mcp/teamconfig.mjs`가 읽어 `createTask`에
기본값으로 흘린다. 공존은 **harness가 이미 쓰는** `.claude/.harness-markers/` 디렉터리를 공유해 푼다 —
team이 워크트리와 S-run cwd에 `team-<task8>` 마커를 쓰고 폴링마다 갱신하면 harness `goal-gate.mjs`의
`anyRecentMarker`가 그대로 통과시키고, `dispatch-gate.mjs`가 같은 디렉터리의 최근 마커를 읽으면 harness
쪽 세션의 쓰기도 통과한다. **harness 코드 변경 0.** 설계 문서 §13의 `~/.harness/active/`는 이 방식으로
대체한다(Task 9에서 문서 갱신).

**Tech Stack:** Node 18+ ESM, `node:test`, 런타임 의존성 0. 테스트는 `node --test graph-beta/scripts/test-*.mjs`.

**이번 라운드에 들어가는 것 (결정 2026-09-17):** install/remove/patch, team.json, 공존 마커, **inline 제거**,
**TaskLeader driver + inbox + 최소 가시성(`tm_events`, `tm_status.leader`, 세션 간 알림)**.

**범위 밖과 그 이유:**
- **보드·티켓·phase md → v0.11.** 이번 가시성은 이미 있는 `ledger.jsonl`을 `tm_events`로 읽고, `tm_status`가
  leader 상태를 보이고, leader가 세션 간 메시지로 한 줄씩 알리는 것까지. 보드는 그 위에 렌더만 얹는다.
- **`team.json`의 일부 키는 기록만.** 그 키가 켜는 기능이 아직 없다: `roles`(planning/qa kind, v0.10.1),
  `docs_dir`(docs.mjs, v0.11), `max_parallel_teams`(스케줄러 캡, v0.12), `interactive`·`human_gates`(human
  executor, v0.13). 키를 지금 다 쓰는 이유 하나: install을 한 번만 하면 되게. 기능이 나올 때 키를 추가하면
  그때마다 `refresh`를 돌려야 한다.
- **leader의 usage-limit 감지(`waiting_capacity`) → v0.13.** 이번에는 재시작 예산만. 자식 driver는 이미 있다.

**전제 사실 (조사로 확인):**
- 패키지 워크트리는 프로젝트 안이 아니라 `~/.harness/tasks/<id>/worktrees/<Pn>`에 있다. harness 훅은
  세션 cwd(=워크트리)에서 `.claude/harness-gate.json`(커밋됨)과 `.claude/.harness-markers/`(gitignore,
  워크트리에 없음)를 읽는다. 그래서 마커는 **워크트리 안에** 써야 한다.
- harness `goal-gate.mjs`: transcript에 harness 흔적이 없고 `.claude/.harness-markers/*`에 `window_hours`
  (기본 2h) 이내 타임스탬프 파일이 하나라도 있으면 통과. 마커 내용은 `String(Date.now())`.
- `graph-beta/.claude-plugin/plugin.json`은 0.6.4, marketplace는 0.9.0 — 불일치. patch 스크립트가 거부하므로
  먼저 맞춘다.
- `taskmanager.mjs`는 export가 없다. 테스트는 stdio JSON-RPC `Client`(test-taskmanager.mjs)로 한다.
- harness 템플릿은 `harness/skills/install/templates/{claude-md-section.md, conventions/*.md}`에 있다.

---

### Task 0: 버전 정합
**Files:** modify `graph-beta/.claude-plugin/plugin.json`
**Interfaces:** produces — 이후 patch 스크립트가 통과하는 전제.
**Pass bar:** `python3 scripts/validate_plugins.py` 출력에 graph-beta 버전 불일치 ERROR가 없다.

- [ ] 1: `python3 scripts/validate_plugins.py 2>&1 | grep -i "graph-beta" | grep -i version` 로 불일치를 확인한다
- [ ] 2: `plugin.json`의 `"version": "0.6.4"` → `"0.9.0"`
- [ ] 3: 1의 명령을 다시 실행해 출력이 비었음을 확인한다
- [ ] 4: `git commit -am "chore(graph-beta): sync plugin.json version to 0.9.0"`

---

### Task 1: `mcp/teamconfig.mjs` — team.json 읽기와 우선순위 해석
**Files:** create `graph-beta/mcp/teamconfig.mjs`, create `graph-beta/scripts/test-teamconfig.mjs`
**Interfaces:** produces `TEAM_DEFAULTS`, `TEAM_FILE`, `readTeamConfig(cwd) → {config, path, status}`,
`resolveTeamOptions(args, fileConfig) → {opts, sources, notes}`. 우선순위: 내장 기본값 < team.json < 명시 인자.
**Pass bar:** `node --test graph-beta/scripts/test-teamconfig.mjs` 6개 통과.

- [ ] 1: 실패하는 테스트를 쓴다
```js
// graph-beta/scripts/test-teamconfig.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TEAM_DEFAULTS, TEAM_FILE, readTeamConfig, resolveTeamOptions } from '../mcp/teamconfig.mjs';

function project(json) {
  const dir = mkdtempSync(join(tmpdir(), 'teamconfig-'));
  if (json !== undefined) {
    mkdirSync(join(dir, '.claude'), { recursive: true });
    writeFileSync(join(dir, TEAM_FILE), typeof json === 'string' ? json : JSON.stringify(json));
  }
  return dir;
}

test('no file: status absent, config empty', () => {
  const dir = project();
  try {
    const r = readTeamConfig(dir);
    assert.equal(r.status, 'absent');
    assert.deepEqual(r.config, {});
    assert.equal(r.path, join(dir, TEAM_FILE));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('malformed file: status parse-error, config empty, never throws', () => {
  const dir = project('{not json');
  try {
    const r = readTeamConfig(dir);
    assert.equal(r.status, 'parse-error');
    assert.deepEqual(r.config, {});
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('defaults alone: every key sourced "default"', () => {
  const { opts, sources } = resolveTeamOptions({}, {});
  assert.deepEqual(opts, TEAM_DEFAULTS);
  for (const k of Object.keys(TEAM_DEFAULTS)) assert.equal(sources[k], 'default', k);
});

test('team.json overrides defaults, explicit args override team.json', () => {
  const { opts, sources } = resolveTeamOptions(
    { goal_threshold: 80 },
    { goal_threshold: 95, max_retries: 5, roles: { qa: true } },
  );
  assert.equal(opts.goal_threshold, 80);
  assert.equal(sources.goal_threshold, 'args');
  assert.equal(opts.max_retries, 5);
  assert.equal(sources.max_retries, 'team.json');
  assert.deepEqual(opts.roles, { planning: false, qa: true }, 'roles merge key by key');
  assert.equal(sources.roles, 'team.json');
});

test('a wrongly typed key is ignored with a note, not applied', () => {
  const { opts, notes } = resolveTeamOptions({}, { goal_threshold: 'ninety', human_gates: 'spec' });
  assert.equal(opts.goal_threshold, TEAM_DEFAULTS.goal_threshold);
  assert.deepEqual(opts.human_gates, []);
  assert.equal(notes.length, 2);
  assert.match(notes[0], /goal_threshold/);
});

test('unknown keys are reported, not merged', () => {
  const { opts, notes } = resolveTeamOptions({}, { colour: 'blue' });
  assert.equal('colour' in opts, false);
  assert.match(notes[0], /unknown key "colour"/);
});
```
- [ ] 2: `node --test graph-beta/scripts/test-teamconfig.mjs` → import 실패로 6개 모두 fail 확인
- [ ] 3: 모듈을 쓴다
```js
// graph-beta/mcp/teamconfig.mjs - project defaults for tm_open, read from .claude/team.json.
//
// Precedence is built-in defaults < team.json < explicit tm_open arguments. Every resolved key
// carries where it came from so tm_status can show it. Keys that no code acts on yet
// (interactive, human_gates, roles, ...) are still resolved and recorded: the file is the
// contract, the rounds after 0.10 fill in the behaviour.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const TEAM_FILE = join('.claude', 'team.json');

export const TEAM_DEFAULTS = Object.freeze({
  interactive: false,
  human_gates: [],
  human_scope: 'leader',
  max_parallel_teams: 2,
  max_depth: 2,
  qa_rounds: 2,
  roles: { planning: false, qa: false },
  goal_threshold: 90,
  max_retries: 2,
  driver_restarts: 2,
  vendor: 'auto',
  allocation: 'ordered',
  docs_dir: join('.harness-run', 'team'),
});

// One validator per key. A value that fails is ignored (the lower layer's value stays) and
// the caller gets a note; nothing here ever throws.
const CHECK = {
  interactive: (v) => typeof v === 'boolean',
  human_gates: (v) => Array.isArray(v) && v.every((x) => typeof x === 'string'),
  human_scope: (v) => v === 'leader' || v === 'all',
  max_parallel_teams: (v) => Number.isInteger(v) && v >= 1,
  max_depth: (v) => Number.isInteger(v) && v >= 0,
  qa_rounds: (v) => Number.isInteger(v) && v >= 0,
  roles: (v) => v && typeof v === 'object' && !Array.isArray(v)
    && Object.entries(v).every(([k, b]) => k in TEAM_DEFAULTS.roles && typeof b === 'boolean'),
  goal_threshold: (v) => Number.isInteger(v) && v >= 0 && v <= 100,
  max_retries: (v) => Number.isInteger(v) && v >= 0,
  driver_restarts: (v) => Number.isInteger(v) && v >= 0,
  vendor: (v) => typeof v === 'string' && v.length > 0,
  allocation: (v) => typeof v === 'string' && v.length > 0,
  docs_dir: (v) => typeof v === 'string' && v.length > 0,
};

export function readTeamConfig(cwd) {
  const path = join(cwd, TEAM_FILE);
  if (!existsSync(path)) return { config: {}, path, status: 'absent' };
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { config: {}, path, status: 'parse-error' };
    return { config: parsed, path, status: 'ok' };
  } catch {
    return { config: {}, path, status: 'parse-error' };
  }
}

function applyLayer(opts, sources, notes, layer, name) {
  for (const [k, v] of Object.entries(layer || {})) {
    if (!(k in CHECK)) { notes.push(`${name}: unknown key "${k}" ignored`); continue; }
    if (!CHECK[k](v)) { notes.push(`${name}: "${k}" has the wrong type or range, ignored`); continue; }
    opts[k] = k === 'roles' ? { ...opts.roles, ...v } : (Array.isArray(v) ? v.slice() : v);
    sources[k] = name;
  }
}

// `args` is the raw tm_open argument object; only keys named in TEAM_DEFAULTS are considered,
// so tm_open's other arguments (request, cwd, size, ...) pass through untouched.
export function resolveTeamOptions(args, fileConfig) {
  const opts = { ...TEAM_DEFAULTS, roles: { ...TEAM_DEFAULTS.roles }, human_gates: [] };
  const sources = Object.fromEntries(Object.keys(TEAM_DEFAULTS).map((k) => [k, 'default']));
  const notes = [];
  applyLayer(opts, sources, notes, fileConfig, 'team.json');
  const fromArgs = Object.fromEntries(Object.entries(args || {}).filter(([k]) => k in TEAM_DEFAULTS));
  applyLayer(opts, sources, notes, fromArgs, 'args');
  return { opts, sources, notes };
}
```
- [ ] 4: 테스트 6개 통과 확인
- [ ] 5: `git add graph-beta/mcp/teamconfig.mjs graph-beta/scripts/test-teamconfig.mjs && git commit -m "feat(graph-beta): teamconfig - .claude/team.json defaults with precedence and sources"`

---

### Task 2: `createTask`가 team.json을 읽고, `tm_status`가 출처를 보인다
**Files:** modify `graph-beta/mcp/taskmanager.mjs` (`createTask`, `toolStatus`), modify `graph-beta/scripts/test-taskmanager.mjs`
**Interfaces:** consumes Task 1의 `readTeamConfig`, `resolveTeamOptions` / produces `task.team = {opts, sources, notes, file_status}`,
`tm_status({task_id}).team`.
**Pass bar:** 새 테스트 2개 통과 + 기존 test-taskmanager 전부 통과(회귀 0).

- [ ] 1: test-taskmanager.mjs 끝에 추가 (파일 상단의 `Client`, `repo()`를 그대로 쓴다)
```js
test('tm_open reads .claude/team.json as defaults and an explicit argument still wins', async () => {
  const dir = repo();
  const tasks = mkdtempSync(join(tmpdir(), 'tm-tasks-'));
  mkdirSync(join(dir, '.claude'), { recursive: true });
  writeFileSync(join(dir, '.claude', 'team.json'), JSON.stringify({ goal_threshold: 95, max_retries: 4, roles: { qa: true } }));
  const tm = await new Client(TM, { HARNESS_TASKS_DIR: tasks }).init();
  try {
    const a = await tm.call('tm_open', { request: 'split me', cwd: dir, size: 'L' });
    const sa = await tm.call('tm_status', { task_id: a.task_id });
    assert.equal(sa.team.opts.goal_threshold, 95);
    assert.equal(sa.team.sources.goal_threshold, 'team.json');
    assert.equal(sa.team.opts.max_retries, 4);
    assert.deepEqual(sa.team.opts.roles, { planning: false, qa: true });
    assert.equal(sa.team.file_status, 'ok');
    const taskFile = JSON.parse(readFileSync(join(tasks, a.task_id, 'task.json'), 'utf8'));
    assert.equal(taskFile.goal_threshold, 95, 'the value the manager actually gates with');
    assert.equal(taskFile.max_retries, 4);

    const b = await tm.call('tm_open', { request: 'split me', cwd: dir, size: 'L', goal_threshold: 80 });
    const sb = await tm.call('tm_status', { task_id: b.task_id });
    assert.equal(sb.team.opts.goal_threshold, 80);
    assert.equal(sb.team.sources.goal_threshold, 'args');
  } finally { tm.close(); rmSync(dir, { recursive: true, force: true }); rmSync(tasks, { recursive: true, force: true }); }
});

test('a malformed team.json is reported on the task and the defaults apply', async () => {
  const dir = repo();
  const tasks = mkdtempSync(join(tmpdir(), 'tm-tasks-'));
  mkdirSync(join(dir, '.claude'), { recursive: true });
  writeFileSync(join(dir, '.claude', 'team.json'), '{oops');
  const tm = await new Client(TM, { HARNESS_TASKS_DIR: tasks }).init();
  try {
    const a = await tm.call('tm_open', { request: 'split me', cwd: dir, size: 'L' });
    const s = await tm.call('tm_status', { task_id: a.task_id });
    assert.equal(s.team.file_status, 'parse-error');
    assert.equal(s.team.opts.goal_threshold, 90);
  } finally { tm.close(); rmSync(dir, { recursive: true, force: true }); rmSync(tasks, { recursive: true, force: true }); }
});
```
`mkdirSync`가 test 파일 import에 없으면 `node:fs` import 줄에 추가한다.
- [ ] 2: `node --test graph-beta/scripts/test-taskmanager.mjs` → 새 2개만 fail (`sa.team` undefined) 확인
- [ ] 3: `taskmanager.mjs` 수정
  - import 추가: `import { readTeamConfig, resolveTeamOptions } from './teamconfig.mjs';`
  - `createTask(a)` 첫 줄 `const cwd = resolve(String(a.cwd));` 바로 뒤에:
```js
  const teamFile = readTeamConfig(cwd);
  const team = resolveTeamOptions(a, teamFile.config);
  const T = team.opts;
```
  - 같은 함수 안에서 아래 다섯 줄을 바꾼다(다른 줄은 그대로):
```js
    max_retries: T.max_retries,
    driver_restarts: T.driver_restarts,
    goal_threshold: T.goal_threshold,
    child_opts: {
      vendor: T.vendor,
      allocation: T.allocation,
```
  (`child_opts`의 나머지 키는 기존 그대로 둔다.)
  - `task` 객체 리터럴에 필드 추가: `team: { opts: T, sources: team.sources, notes: team.notes, file_status: teamFile.status },`
  - `toolStatus(a)`에서 단일 task를 돌려주는 객체(`task_id`가 있을 때)에 `team: task.team || null` 을 추가한다.
    `full: true` 경로는 task 파일 전체를 돌려주므로 이미 포함된다.
- [ ] 4: 테스트 전체 통과 확인 (`node --test graph-beta/scripts/test-taskmanager.mjs`)
- [ ] 5: `git commit -am "feat(graph-beta): tm_open takes .claude/team.json as project defaults; tm_status shows sources"`

---

### Task 3: `mcp/engage.mjs` — 공유 engagement 마커 (harness 훅과 호환)
**Files:** create `graph-beta/mcp/engage.mjs`, create `graph-beta/scripts/test-engage.mjs`, modify `graph-beta/mcp/taskmanager.mjs` (`ensureWorktree`, `openSRun`, `toolNext`)
**Interfaces:** produces `markerPath(cwd, taskId)`, `touchMarker(cwd, taskId) → boolean`, `clearMarker(cwd, taskId)`,
`MARKER_WINDOW_MS`. consumes harness `hooks/goal-gate.mjs`(변경 없이, 검증용).
**Pass bar:** `node --test graph-beta/scripts/test-engage.mjs` 통과 — 특히 "harness goal-gate가 마커 없으면 deny, 있으면 통과".

- [ ] 1: 실패하는 테스트
```js
// graph-beta/scripts/test-engage.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { markerPath, touchMarker, clearMarker } from '../mcp/engage.mjs';

const HARNESS_GATE = fileURLToPath(new URL('../../harness/hooks/goal-gate.mjs', import.meta.url));

function worktreeLike() {
  const dir = mkdtempSync(join(tmpdir(), 'engage-'));
  mkdirSync(join(dir, '.claude'), { recursive: true });
  writeFileSync(join(dir, '.claude', 'harness-gate.json'), JSON.stringify({ patterns: ['src/.*\\.kt$'] }));
  writeFileSync(join(dir, 'transcript.jsonl'), '{"type":"user","text":"hello"}\n'); // no harness trace
  return dir;
}

function harnessGate(cwd) {
  const r = spawnSync(process.execPath, [HARNESS_GATE], {
    input: JSON.stringify({
      cwd, session_id: 'sess-1', tool_name: 'Write',
      tool_input: { file_path: join(cwd, 'src', 'A.kt'), content: 'x' },
      transcript_path: join(cwd, 'transcript.jsonl'),
    }),
    encoding: 'utf8',
  });
  return { status: r.status, stdout: r.stdout };
}

test('touchMarker writes a Date.now() string under .claude/.harness-markers/team-<task8>', () => {
  const dir = worktreeLike();
  try {
    const before = Date.now();
    assert.equal(touchMarker(dir, '0123456789abcdef'), true);
    const p = markerPath(dir, '0123456789abcdef');
    assert.equal(p, join(dir, '.claude', '.harness-markers', 'team-01234567'));
    const ts = parseInt(readFileSync(p, 'utf8'), 10);
    assert.ok(ts >= before && ts <= Date.now());
    clearMarker(dir, '0123456789abcdef');
    assert.equal(existsSync(p), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('touchMarker never throws on an unwritable cwd', () => {
  assert.equal(touchMarker('/nonexistent/definitely/not/here', 'abc'), false);
});

test('harness goal-gate denies a gated write in a fresh worktree, and passes once the team marker exists', () => {
  const dir = worktreeLike();
  try {
    const denied = harnessGate(dir);
    assert.equal(denied.status, 0, 'the harness hook always exits 0');
    assert.match(denied.stdout, /"permissionDecision":\s*"deny"/, 'without a marker the harness gate blocks the worker');
    touchMarker(dir, 'task-xyz');
    const passed = harnessGate(dir);
    assert.equal(passed.stdout.trim(), '', 'a recent marker in the shared dir lets the write through');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a stale marker (older than the 2h window) does not count', () => {
  const dir = worktreeLike();
  try {
    mkdirSync(join(dir, '.claude', '.harness-markers'), { recursive: true });
    writeFileSync(join(dir, '.claude', '.harness-markers', 'team-old'), String(Date.now() - 3 * 60 * 60 * 1000));
    assert.match(harnessGate(dir).stdout, /"permissionDecision":\s*"deny"/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
```
- [ ] 2: 실행 → import 실패 확인
- [ ] 3: 모듈
```js
// graph-beta/mcp/engage.mjs - the shared "an engine is engaged here" marker.
//
// harness's goal-gate.mjs (a PreToolUse hook copied into projects) refuses gated edits unless
// the session's transcript shows the harness or .claude/.harness-markers/ holds a file whose
// content is a recent Date.now(). A team worker session edits inside a package worktree under
// ~/.harness/tasks/<id>/worktrees/<Pn>, where the committed gate config and hook exist but the
// gitignored markers dir does not - so the harness gate would deny every node write. The
// manager therefore writes a marker of its own into each worktree it opens and refreshes it on
// every poll. No harness change is needed: this is the same file shape harness already reads,
// and dispatch-gate.mjs reads it back for the reverse direction.
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const MARKER_WINDOW_MS = 2 * 60 * 60 * 1000; // harness's default window_hours

export function markerPath(cwd, taskId) {
  return join(cwd, '.claude', '.harness-markers', `team-${String(taskId).slice(0, 8)}`);
}

// Best-effort: a marker the manager could not write is a gate the worker may hit, which the
// worker's own driver log will show. Never a reason to fail the open.
export function touchMarker(cwd, taskId) {
  try {
    const p = markerPath(cwd, taskId);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, String(Date.now()));
    return true;
  } catch {
    return false;
  }
}

export function clearMarker(cwd, taskId) {
  try {
    const p = markerPath(cwd, taskId);
    if (existsSync(p)) rmSync(p);
  } catch {
    /* best-effort */
  }
}
```
- [ ] 4: 테스트 4개 통과 확인
- [ ] 5: `taskmanager.mjs` 배선
  - import: `import { touchMarker } from './engage.mjs';`
  - `ensureWorktree(task, name, base)`: 워크트리를 만든 뒤 `{ ok: true, path, branch, created: true }`를 돌려주는 곳 직전과,
    이미 있어 `created: false`를 돌려주는 곳 직전에 각각 `touchMarker(path, task.run_id);` 한 줄.
  - `openSRun(task)`: `task.s_run = { cwd: task.cwd, run_id: child.run_id };` 다음 줄에 `touchMarker(task.cwd, task.run_id);`
  - `toolNext(a)`: `const task = mustFindTask(a);` 다음에
```js
  // Refresh the shared engagement marker in every tree a live driver is working in, so the
  // harness gate's 2h window never closes on a long package (see engage.mjs).
  for (const n of task.nodes) {
    if (n.child && n.child.cwd && n.state === 'running') touchMarker(n.child.cwd, task.run_id);
  }
  if (task.s_run && task.s_run.cwd) touchMarker(task.s_run.cwd, task.run_id);
```
    `toolNextSRun`은 `toolNext`가 호출하므로 별도 배선 없음. `toolNext`가 S-run을 앞에서 분기해 돌려보낸다면 그 분기 **앞에** 위 블록을 둔다.
- [ ] 6: test-taskmanager.mjs에 회귀 검사 1개 추가 — 기존 "dispatch가 워크트리를 만든다" 계열 테스트 중 첫 번째의 마지막 assert 뒤에:
```js
    assert.ok(existsSync(join(child.cwd, '.claude', '.harness-markers', `team-${a.task_id.slice(0, 8)}`)), 'worktree carries the shared engagement marker');
```
  (`child`는 그 테스트가 이미 `tm_next`의 `children[0]`으로 읽는 변수명에 맞춘다.)
- [ ] 7: `node --test graph-beta/scripts/test-taskmanager.mjs graph-beta/scripts/test-engage.mjs` 전체 통과
- [ ] 8: `git add -A graph-beta && git commit -m "feat(graph-beta): shared engagement marker in worktrees and S-run cwd so the harness gate passes node writes"`

---

### Task 4: `dispatch-gate.mjs`가 harness 마커를 인정한다 (역방향 공존)
**Files:** modify `graph-beta/hooks/dispatch-gate.mjs`, modify `graph-beta/scripts/test-dispatch-gate.mjs`
**Interfaces:** 훅은 자급자족(import 없음) — `engage.mjs`를 import하지 않고 같은 규칙을 인라인한다.
**Pass bar:** test-dispatch-gate 기존 7개 + 새 2개 통과.

- [ ] 1: 테스트 추가
```js
test('a recent harness marker means another engine is engaged, so the write passes', () => {
  const dir = project({ paths: ['src/**'] });
  try {
    mkdirSync(join(dir, '.claude', '.harness-markers'), { recursive: true });
    writeFileSync(join(dir, '.claude', '.harness-markers', 'sess-1'), String(Date.now()));
    assert.equal(run(dir, { file_path: join(dir, 'src/a.mjs'), content: 'x'.repeat(5000) }).status, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a stale harness marker does not open the gate', () => {
  const dir = project({ paths: ['src/**'] });
  try {
    mkdirSync(join(dir, '.claude', '.harness-markers'), { recursive: true });
    writeFileSync(join(dir, '.claude', '.harness-markers', 'sess-1'), String(Date.now() - 3 * 60 * 60 * 1000));
    assert.equal(run(dir, { file_path: join(dir, 'src/a.mjs'), content: 'x'.repeat(5000) }).status, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
```
- [ ] 2: 실행 → 첫 새 테스트 fail(status 2) 확인
- [ ] 3: `harnessEngaged(cwd)` 끝의 `return false;` 앞에 삽입
```js
  // The harness plugin's own gate writes .claude/.harness-markers/<session> (content Date.now())
  // while it is engaged; a recent one means its nodes are the ones writing here.
  try {
    const dir = join(cwd, '.claude', '.harness-markers');
    const now = Date.now();
    for (const f of readdirSync(dir)) {
      const ts = parseInt(readFileSync(join(dir, f), 'utf8'), 10) || 0;
      if (now - ts <= 2 * 60 * 60 * 1000) return true;
    }
  } catch {
    /* no markers dir: not engaged this way */
  }
```
- [ ] 4: 9개 통과 확인
- [ ] 5: `git commit -am "feat(graph-beta): dispatch-gate honours a recent harness engagement marker"`

---

### Task 5: `skills/install/install.mjs` + 템플릿
**Files:** create `graph-beta/skills/install/install.mjs`, create `graph-beta/skills/install/templates/claude-md-section.md`,
create `graph-beta/skills/install/templates/conventions/{coding,verification,boundaries}.md` (harness의 것을 byte-identical 복사),
create `graph-beta/scripts/test-install.mjs`
**Interfaces:** consumes Task 1의 `TEAM_DEFAULTS`, `TEAM_FILE` / produces CLI `node install.mjs '<json>'` → JSON report,
exit 0 정상, 2 잘못된 입력, **3 공존 충돌**(`force: true`면 0).
**Pass bar:** `node --test graph-beta/scripts/test-install.mjs` 7개 통과.

- [ ] 1: 템플릿 두 종류를 만든다
  - `cp harness/skills/install/templates/conventions/{coding,verification,boundaries}.md graph-beta/skills/install/templates/conventions/`
  - `graph-beta/skills/install/templates/claude-md-section.md`:
```markdown
<!-- graph-beta:begin v1 -->
## graph-beta (team)

This project runs substantial work through the graph-beta task manager.

- **Open before you write.** Paths in `.claude/graph-beta-dispatch.json` are denied to the driving
  session until a task is open: call `tm_open({request, cwd})` and let a node do the writing.
- **Defaults live in `.claude/team.json`**; a `tm_open` argument overrides a key for one task.
- **Conventions are law:** `.claude/conventions/**` feeds plan, setgoal and implement.
- **Watch, do not drive:** `tm_status({task_id})` (and, from 0.11, `/graph-beta:board`).
- Trivial edits (typos, single-line fixes, docs) do not need a task.
<!-- graph-beta:end -->
```
- [ ] 2: 실패하는 테스트
```js
// graph-beta/scripts/test-install.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const INSTALL = fileURLToPath(new URL('../skills/install/install.mjs', import.meta.url));
const HARNESS_CONV = fileURLToPath(new URL('../../harness/skills/install/templates/conventions/', import.meta.url));
const OUR_CONV = fileURLToPath(new URL('../skills/install/templates/conventions/', import.meta.url));

function fresh() {
  const home = mkdtempSync(join(tmpdir(), 'install-home-'));
  const dir = mkdtempSync(join(tmpdir(), 'install-proj-'));
  return { home, dir, cleanup: () => { rmSync(home, { recursive: true, force: true }); rmSync(dir, { recursive: true, force: true }); } };
}
function run(dir, home, args) {
  const r = spawnSync(process.execPath, [INSTALL, JSON.stringify({ projectDir: dir, ...args })], { encoding: 'utf8', env: { ...process.env, HOME: home } });
  return { status: r.status, report: r.stdout ? JSON.parse(r.stdout) : null, stderr: r.stderr };
}

test('first install creates team.json (defaults), CLAUDE.md block, conventions, gitignore lines; no dispatch without patterns', () => {
  const { home, dir, cleanup } = fresh();
  try {
    const { status, report } = run(dir, home, {});
    assert.equal(status, 0);
    assert.equal(report.actions.team, 'created');
    const team = JSON.parse(readFileSync(join(dir, '.claude', 'team.json'), 'utf8'));
    assert.equal(team.goal_threshold, 90);
    assert.deepEqual(team.roles, { planning: false, qa: false });
    assert.equal(report.actions.dispatch, 'skipped');
    assert.equal(report.actions.claudeMd, 'created');
    assert.match(readFileSync(join(dir, 'CLAUDE.md'), 'utf8'), /<!-- graph-beta:begin/);
    assert.deepEqual(report.actions.conventions, { 'coding.md': 'created', 'verification.md': 'created', 'boundaries.md': 'created' });
    const gi = readFileSync(join(dir, '.gitignore'), 'utf8');
    assert.match(gi, /^\.harness-run\/$/m);
    assert.match(gi, /^\.claude\/\.harness-markers\/$/m);
  } finally { cleanup(); }
});

test('second run is idempotent: everything kept/present, nothing rewritten', () => {
  const { home, dir, cleanup } = fresh();
  try {
    run(dir, home, {});
    writeFileSync(join(dir, '.claude', 'conventions', 'coding.md'), '# mine\n');
    const { report } = run(dir, home, {});
    assert.equal(report.actions.team, 'kept');
    assert.equal(report.actions.claudeMd, 'present');
    assert.equal(report.actions.conventions['coding.md'], 'kept');
    assert.equal(readFileSync(join(dir, '.claude', 'conventions', 'coding.md'), 'utf8'), '# mine\n');
    assert.equal(report.actions.gitignore, 'present');
  } finally { cleanup(); }
});

test('dispatch patterns write graph-beta-dispatch.json once; team overrides land in team.json', () => {
  const { home, dir, cleanup } = fresh();
  try {
    const { report } = run(dir, home, { dispatch: { paths: ['src/**'], min_chars: 400 }, team: { goal_threshold: 95, roles: { qa: true } } });
    assert.equal(report.actions.dispatch, 'created');
    assert.deepEqual(JSON.parse(readFileSync(join(dir, '.claude', 'graph-beta-dispatch.json'), 'utf8')), { paths: ['src/**'], min_chars: 400 });
    const team = JSON.parse(readFileSync(join(dir, '.claude', 'team.json'), 'utf8'));
    assert.equal(team.goal_threshold, 95);
    assert.deepEqual(team.roles, { planning: false, qa: true });
    assert.equal(run(dir, home, { dispatch: { paths: ['lib/**'] } }).report.actions.dispatch, 'kept');
  } finally { cleanup(); }
});

test('refresh adds keys a newer plugin introduced to team.json without touching existing values', () => {
  const { home, dir, cleanup } = fresh();
  try {
    mkdirSync(join(dir, '.claude'), { recursive: true });
    writeFileSync(join(dir, '.claude', 'team.json'), JSON.stringify({ goal_threshold: 77 }));
    const { report } = run(dir, home, { refresh: true });
    assert.equal(report.actions.team, 'refreshed');
    const team = JSON.parse(readFileSync(join(dir, '.claude', 'team.json'), 'utf8'));
    assert.equal(team.goal_threshold, 77);
    assert.equal(team.max_retries, 2);
    assert.equal(run(dir, home, { refresh: true }).report.actions.team, 'unchanged');
  } finally { cleanup(); }
});

test('the stable graph plugin in the same project is a conflict: exit 3, nothing written, force overrides', () => {
  const { home, dir, cleanup } = fresh();
  try {
    writeFileSync(join(dir, '.mcp.json'), JSON.stringify({ mcpServers: { 'graph-engineering': { command: 'node', args: ['x'] } } }));
    const r = run(dir, home, {});
    assert.equal(r.status, 3);
    assert.deepEqual(r.report.conflicts, ['.mcp.json registers graph-engineering (stable graph)']);
    assert.equal(existsSync(join(dir, '.claude', 'team.json')), false);
    assert.equal(run(dir, home, { force: true }).status, 0);
  } finally { cleanup(); }
});

test('graph enabled in the user settings is also a conflict; harness enabled is not', () => {
  const { home, dir, cleanup } = fresh();
  try {
    mkdirSync(join(home, '.claude'), { recursive: true });
    writeFileSync(join(home, '.claude', 'settings.json'), JSON.stringify({ enabledPlugins: { 'graph@newkayak12-claude-skills': true, 'harness@newkayak12-claude-skills': true } }));
    const r = run(dir, home, {});
    assert.equal(r.status, 3);
    assert.match(r.report.conflicts[0], /graph@newkayak12-claude-skills/);
    writeFileSync(join(home, '.claude', 'settings.json'), JSON.stringify({ enabledPlugins: { 'harness@newkayak12-claude-skills': true } }));
    assert.equal(run(dir, home, {}).status, 0);
  } finally { cleanup(); }
});

test('shipped convention templates are byte-identical to the harness ones (drift guard)', () => {
  for (const f of ['coding.md', 'verification.md', 'boundaries.md']) {
    assert.equal(readFileSync(join(OUR_CONV, f), 'utf8'), readFileSync(join(HARNESS_CONV, f), 'utf8'), f);
  }
});
```
- [ ] 3: 실행 → install.mjs 부재로 fail 확인 (drift guard 1개만 통과)
- [ ] 4: 스크립트
```js
#!/usr/bin/env node
// Deterministic file ops for the graph-beta `install` skill. The SKILL keeps the judgment
// (dispatch patterns, which roles to switch on, whether a conflict is real); this runs the
// confirmed values the same way every time. Idempotent and non-destructive: an existing file is
// 'kept'. With "refresh": true, team.json gains keys a newer plugin introduced - existing values
// are never changed. Hooks are NOT installed here: the plugin's hooks.json registers them.
//
// Usage: node install.mjs '{
//   "projectDir": "/abs/path",                       // default: cwd
//   "refresh": false,
//   "dispatch": { "paths": ["src/**"], "min_chars": 400, "allow": [] },   // omit → no dispatch gate
//   "team": { "goal_threshold": 95, "roles": { "qa": true } },            // overrides on first write
//   "force": false                                   // write despite a coexistence conflict
// }'
// Exit 0 ok · 2 bad input · 3 coexistence conflict (report.conflicts lists them, nothing written).
import { existsSync, readFileSync, writeFileSync, mkdirSync, cpSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { TEAM_DEFAULTS, TEAM_FILE } from '../../mcp/teamconfig.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CONVENTIONS = ['coding.md', 'verification.md', 'boundaries.md'];
const GITIGNORE_LINES = ['.harness-run/', '.claude/.harness-markers/'];

function parseArgs() {
  const raw = process.argv[2];
  if (!raw) return {};
  try { return JSON.parse(raw); } catch (e) {
    process.stderr.write(`install.mjs: argv[1] is not valid JSON: ${e.message}\n`);
    process.exit(2);
  }
}
function readJsonOr(path, fallback) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return fallback; }
}
function ensureDir(d) { mkdirSync(d, { recursive: true }); }

// Two servers exposing graph_* tools make routing ambiguous (README). Harness is fine.
function findConflicts(projectDir) {
  const out = [];
  const mcp = readJsonOr(join(projectDir, '.mcp.json'), null);
  if (mcp && mcp.mcpServers && mcp.mcpServers['graph-engineering']) out.push('.mcp.json registers graph-engineering (stable graph)');
  for (const p of [join(homedir(), '.claude', 'settings.json'), join(projectDir, '.claude', 'settings.json'), join(projectDir, '.claude', 'settings.local.json')]) {
    const s = readJsonOr(p, null);
    const enabled = s && s.enabledPlugins ? Object.keys(s.enabledPlugins).filter((k) => /^graph@/.test(k) && s.enabledPlugins[k]) : [];
    for (const k of enabled) out.push(`${p} enables ${k} (stable graph)`);
  }
  return out;
}

function deepMergeDefaults(target, defaults) {
  let changed = false;
  for (const [k, v] of Object.entries(defaults)) {
    if (!(k in target)) { target[k] = Array.isArray(v) ? v.slice() : (v && typeof v === 'object' ? { ...v } : v); changed = true; }
    else if (v && typeof v === 'object' && !Array.isArray(v) && target[k] && typeof target[k] === 'object') {
      if (deepMergeDefaults(target[k], v)) changed = true;
    }
  }
  return changed;
}

function writeTeam(claudeDir, projectDir, overrides, refresh) {
  const path = join(projectDir, TEAM_FILE);
  if (existsSync(path)) {
    if (!refresh) return 'kept';
    const cur = readJsonOr(path, null);
    if (!cur || typeof cur !== 'object') return 'parse-error';
    const changed = deepMergeDefaults(cur, TEAM_DEFAULTS);
    if (!changed) return 'unchanged';
    writeFileSync(path, JSON.stringify(cur, null, 2) + '\n');
    return 'refreshed';
  }
  const team = { ...TEAM_DEFAULTS, roles: { ...TEAM_DEFAULTS.roles }, human_gates: [] };
  for (const [k, v] of Object.entries(overrides || {})) {
    if (!(k in TEAM_DEFAULTS)) continue;
    team[k] = k === 'roles' && v && typeof v === 'object' ? { ...team.roles, ...v } : v;
  }
  ensureDir(claudeDir);
  writeFileSync(path, JSON.stringify(team, null, 2) + '\n');
  return 'created';
}

function writeDispatch(claudeDir, dispatch) {
  if (!dispatch || !Array.isArray(dispatch.paths) || !dispatch.paths.length) return 'skipped';
  const path = join(claudeDir, 'graph-beta-dispatch.json');
  if (existsSync(path)) return 'kept';
  const cfg = { paths: dispatch.paths };
  if (Number.isFinite(dispatch.min_chars)) cfg.min_chars = dispatch.min_chars;
  if (Array.isArray(dispatch.allow) && dispatch.allow.length) cfg.allow = dispatch.allow;
  ensureDir(claudeDir);
  writeFileSync(path, JSON.stringify(cfg, null, 2) + '\n');
  return 'created';
}

function copyConventions(claudeDir) {
  const out = {};
  for (const f of CONVENTIONS) {
    const src = join(HERE, 'templates', 'conventions', f);
    const dest = join(claudeDir, 'conventions', f);
    if (!existsSync(src)) { out[f] = 'missing-src'; continue; }
    if (existsSync(dest)) { out[f] = 'kept'; continue; }
    ensureDir(dirname(dest));
    cpSync(src, dest);
    out[f] = 'created';
  }
  return out;
}

function writeClaudeMd(projectDir) {
  const path = join(projectDir, 'CLAUDE.md');
  const block = readFileSync(join(HERE, 'templates', 'claude-md-section.md'), 'utf8');
  if (!existsSync(path)) { writeFileSync(path, block); return 'created'; }
  const cur = readFileSync(path, 'utf8');
  if (cur.includes('<!-- graph-beta:begin')) return 'present';
  writeFileSync(path, cur + (cur.endsWith('\n') ? '' : '\n') + '\n' + block);
  return 'appended';
}

function writeGitignore(projectDir) {
  const path = join(projectDir, '.gitignore');
  if (!existsSync(path)) { writeFileSync(path, GITIGNORE_LINES.join('\n') + '\n'); return 'created'; }
  const cur = readFileSync(path, 'utf8');
  const have = new Set(cur.split(/\r?\n/).map((l) => l.trim()));
  const missing = GITIGNORE_LINES.filter((l) => !have.has(l));
  if (!missing.length) return 'present';
  writeFileSync(path, cur + (cur.endsWith('\n') ? '' : '\n') + missing.join('\n') + '\n');
  return 'appended';
}

function main() {
  const args = parseArgs();
  const projectDir = args.projectDir ? resolve(args.projectDir) : process.cwd();
  const claudeDir = join(projectDir, '.claude');
  const refresh = args.refresh === true;
  const report = { projectDir, refresh, conflicts: findConflicts(projectDir), actions: {}, notes: [] };

  if (report.conflicts.length && args.force !== true) {
    report.notes.push('coexistence: the stable graph plugin exposes the same graph_* tools; disable one line per project, or pass "force": true');
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    process.exit(3);
  }

  report.actions.team = writeTeam(claudeDir, projectDir, args.team, refresh);
  report.actions.dispatch = writeDispatch(claudeDir, args.dispatch);
  if (report.actions.dispatch === 'skipped') report.notes.push('dispatch: no paths provided - .claude/graph-beta-dispatch.json not written (gate stays inactive)');
  report.actions.conventions = copyConventions(claudeDir);
  report.actions.claudeMd = writeClaudeMd(projectDir);
  report.actions.gitignore = writeGitignore(projectDir);
  report.notes.push('hooks: registered by the plugin manifest; nothing copied into the project. Embedded (plugin-less) mode is not offered by this plugin.');
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
}

main();
```
- [ ] 5: 7개 통과 확인
- [ ] 6: `git add -A graph-beta/skills/install graph-beta/scripts/test-install.mjs && git commit -m "feat(graph-beta): install.mjs - team.json, dispatch gate, conventions, CLAUDE.md block, coexistence check"`

---

### Task 6: `skills/remove/remove.mjs`
**Files:** create `graph-beta/skills/remove/remove.mjs`, create `graph-beta/scripts/test-remove.mjs`
**Interfaces:** consumes Task 5가 만든 파일 이름들 / produces CLI `node remove.mjs '{projectDir, purgeConventions, purgeRuns, purgeTasks}'` → JSON report.
**Pass bar:** `node --test graph-beta/scripts/test-remove.mjs` 5개 통과.

- [ ] 1: 테스트
```js
// graph-beta/scripts/test-remove.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const INSTALL = fileURLToPath(new URL('../skills/install/install.mjs', import.meta.url));
const REMOVE = fileURLToPath(new URL('../skills/remove/remove.mjs', import.meta.url));

function installed() {
  const home = mkdtempSync(join(tmpdir(), 'remove-home-'));
  const dir = mkdtempSync(join(tmpdir(), 'remove-proj-'));
  const tasks = mkdtempSync(join(tmpdir(), 'remove-tasks-'));
  writeFileSync(join(dir, 'CLAUDE.md'), '# Project\n\nkeep me\n');
  writeFileSync(join(dir, '.gitignore'), 'node_modules/\n');
  spawnSync(process.execPath, [INSTALL, JSON.stringify({ projectDir: dir, dispatch: { paths: ['src/**'] } })], { env: { ...process.env, HOME: home } });
  return { home, dir, tasks, cleanup: () => [home, dir, tasks].forEach((d) => rmSync(d, { recursive: true, force: true })) };
}
function run(dir, tasks, args) {
  const r = spawnSync(process.execPath, [REMOVE, JSON.stringify({ projectDir: dir, ...args })], { encoding: 'utf8', env: { ...process.env, HARNESS_TASKS_DIR: tasks } });
  return { status: r.status, report: r.stdout ? JSON.parse(r.stdout) : null, stderr: r.stderr };
}

test('remove deletes install artifacts, keeps conventions and unrelated content', () => {
  const { dir, tasks, cleanup } = installed();
  try {
    const { status, report } = run(dir, tasks, {});
    assert.equal(status, 0);
    assert.equal(report.actions.team, 'removed');
    assert.equal(report.actions.dispatch, 'removed');
    assert.equal(report.actions.claudeMd, 'removed-block');
    assert.equal(readFileSync(join(dir, 'CLAUDE.md'), 'utf8'), '# Project\n\nkeep me\n');
    assert.equal(readFileSync(join(dir, '.gitignore'), 'utf8'), 'node_modules/\n');
    assert.equal(report.actions.conventions, 'kept');
    assert.ok(existsSync(join(dir, '.claude', 'conventions', 'coding.md')));
  } finally { cleanup(); }
});

test('second run reports absent everywhere', () => {
  const { dir, tasks, cleanup } = installed();
  try {
    run(dir, tasks, {});
    const { report } = run(dir, tasks, {});
    assert.equal(report.actions.team, 'absent');
    assert.equal(report.actions.dispatch, 'absent');
    assert.equal(report.actions.claudeMd, 'absent');
    assert.equal(report.actions.gitignore, 'absent');
  } finally { cleanup(); }
});

test('purgeConventions and purgeRuns are opt-in', () => {
  const { dir, tasks, cleanup } = installed();
  try {
    mkdirSync(join(dir, '.harness-run', 'broker-beta'), { recursive: true });
    const { report } = run(dir, tasks, { purgeConventions: true, purgeRuns: true });
    assert.equal(report.actions.conventions, 'removed');
    assert.equal(report.actions.runs, 'removed');
    assert.equal(existsSync(join(dir, '.harness-run')), false);
  } finally { cleanup(); }
});

test('purgeTasks removes only tasks of this project, and refuses one whose driver is alive', () => {
  const { dir, tasks, cleanup } = installed();
  try {
    mkdirSync(join(tasks, 'mine-dead'), { recursive: true });
    writeFileSync(join(tasks, 'mine-dead', 'task.json'), JSON.stringify({ cwd: dir, nodes: [{ child: { driver: { pid: 999999999 } } }] }));
    mkdirSync(join(tasks, 'mine-alive'), { recursive: true });
    writeFileSync(join(tasks, 'mine-alive', 'task.json'), JSON.stringify({ cwd: dir, nodes: [{ child: { driver: { pid: process.pid } } }] }));
    mkdirSync(join(tasks, 'other'), { recursive: true });
    writeFileSync(join(tasks, 'other', 'task.json'), JSON.stringify({ cwd: '/somewhere/else', nodes: [] }));
    const { report } = run(dir, tasks, { purgeTasks: true });
    assert.deepEqual(report.actions.tasks, { 'mine-dead': 'removed', 'mine-alive': 'refused-alive' });
    assert.equal(existsSync(join(tasks, 'other')), true);
    assert.equal(existsSync(join(tasks, 'mine-alive')), true);
  } finally { cleanup(); }
});

test('unmatched CLAUDE.md markers are left alone and reported', () => {
  const { dir, tasks, cleanup } = installed();
  try {
    writeFileSync(join(dir, 'CLAUDE.md'), '<!-- graph-beta:begin v1 -->\nno end\n');
    const { report } = run(dir, tasks, {});
    assert.equal(report.actions.claudeMd, 'marker-error');
    assert.match(readFileSync(join(dir, 'CLAUDE.md'), 'utf8'), /no end/);
  } finally { cleanup(); }
});
```
- [ ] 2: 실행 → remove.mjs 부재로 fail 확인
- [ ] 3: 스크립트
```js
#!/usr/bin/env node
// Deterministically remove what graph-beta install.mjs wrote. Conventions, run history and task
// history are kept unless asked for by name; a task whose driver is still alive is never removed.
// Usage: node remove.mjs '{"projectDir":"/abs","purgeConventions":false,"purgeRuns":false,"purgeTasks":false}'
import { existsSync, readFileSync, writeFileSync, rmSync, rmdirSync, readdirSync, statSync } from 'node:fs';
import { join, parse, resolve } from 'node:path';
import { homedir } from 'node:os';

const GITIGNORE_LINES = new Set(['.harness-run/', '.claude/.harness-markers/']);

function fail(m) { process.stderr.write(`remove.mjs: ${m}\n`); process.exit(2); }
function parseArgs() {
  const raw = process.argv[2];
  if (!raw) return {};
  try { return JSON.parse(raw); } catch (e) { fail(`argv[1] is not valid JSON: ${e.message}`); }
}
function removeKnownPath(p) {
  if (!existsSync(p)) return 'absent';
  rmSync(p, { recursive: true, force: true });
  return 'removed';
}
function removeClaudeBlock(path, notes) {
  if (!existsSync(path)) return 'absent';
  const cur = readFileSync(path, 'utf8');
  const begins = (cur.match(/<!-- graph-beta:begin\b/g) || []).length;
  const ends = (cur.match(/<!-- graph-beta:end -->/g) || []).length;
  if (!begins && !ends) return 'absent';
  if (begins !== ends) { notes.push('CLAUDE.md has unmatched graph-beta markers - left untouched'); return 'marker-error'; }
  const lines = cur.split(/\r?\n/);
  const kept = [];
  let inside = false;
  let justClosed = false;
  for (const line of lines) {
    if (/^\s*<!-- graph-beta:begin\b[^>]*-->\s*$/.test(line)) { inside = true; continue; }
    if (inside) { if (/^\s*<!-- graph-beta:end -->\s*$/.test(line)) { inside = false; justClosed = true; } continue; }
    if (justClosed && !line.trim() && kept.at(-1)?.trim() === '') { justClosed = false; continue; }
    justClosed = false;
    kept.push(line);
  }
  const next = kept.join('\n').replace(/\n+$/, '');
  if (!next.trim()) { rmSync(path); return 'removed-file'; }
  writeFileSync(path, next + '\n');
  return 'removed-block';
}
function removeGitignoreLines(path) {
  if (!existsSync(path)) return 'absent';
  const lines = readFileSync(path, 'utf8').split(/\r?\n/);
  const kept = lines.filter((l) => !GITIGNORE_LINES.has(l.trim()));
  if (kept.length === lines.length) return 'absent';
  while (kept.length && kept.at(-1) === '') kept.pop();
  if (!kept.some((l) => l.trim())) { rmSync(path); return 'removed-file'; }
  writeFileSync(path, kept.join('\n') + '\n');
  return 'removed-lines';
}
function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}
function driverPids(task) {
  const pids = [];
  for (const n of task.nodes || []) if (n.child && n.child.driver && n.child.driver.pid) pids.push(n.child.driver.pid);
  if (task.s_run && task.s_run.driver && task.s_run.driver.pid) pids.push(task.s_run.driver.pid);
  if (task.leader && task.leader.pid) pids.push(task.leader.pid);
  return pids;
}
function purgeTasks(projectDir, notes) {
  const root = process.env.HARNESS_TASKS_DIR ? resolve(process.env.HARNESS_TASKS_DIR) : join(homedir(), '.harness', 'tasks');
  const out = {};
  if (!existsSync(root)) return out;
  for (const id of readdirSync(root)) {
    const file = join(root, id, 'task.json');
    let task;
    try { task = JSON.parse(readFileSync(file, 'utf8')); } catch { continue; }
    if (resolve(String(task.cwd || '')) !== projectDir) continue;
    if (driverPids(task).some(alive)) { out[id] = 'refused-alive'; notes.push(`task ${id}: a driver is still running - stop it first`); continue; }
    rmSync(join(root, id), { recursive: true, force: true });
    out[id] = 'removed';
  }
  return out;
}
function removeEmptyDir(p, cleaned) {
  if (!existsSync(p)) return;
  try { rmdirSync(p); cleaned.push(p); } catch (e) { if (e.code !== 'ENOTEMPTY') throw e; }
}

function main() {
  const args = parseArgs();
  const projectDir = resolve(args.projectDir || process.cwd());
  if (projectDir === parse(projectDir).root) fail('refusing to target a filesystem root');
  if (!existsSync(projectDir) || !statSync(projectDir).isDirectory()) fail(`projectDir is not a directory: ${projectDir}`);
  const claudeDir = join(projectDir, '.claude');
  const notes = [];
  const actions = {};
  actions.team = removeKnownPath(join(claudeDir, 'team.json'));
  actions.dispatch = removeKnownPath(join(claudeDir, 'graph-beta-dispatch.json'));
  actions.claudeMd = removeClaudeBlock(join(projectDir, 'CLAUDE.md'), notes);
  actions.gitignore = removeGitignoreLines(join(projectDir, '.gitignore'));
  actions.markers = removeKnownPath(join(claudeDir, '.harness-markers'));
  if (args.purgeConventions === true) actions.conventions = removeKnownPath(join(claudeDir, 'conventions'));
  else { actions.conventions = existsSync(join(claudeDir, 'conventions')) ? 'kept' : 'absent'; if (actions.conventions === 'kept') notes.push('conventions preserved (shared with harness; projects own them) - purgeConventions=true removes them'); }
  if (args.purgeRuns === true) actions.runs = removeKnownPath(join(projectDir, '.harness-run'));
  else actions.runs = existsSync(join(projectDir, '.harness-run')) ? 'kept' : 'absent';
  if (args.purgeTasks === true) actions.tasks = purgeTasks(projectDir, notes);
  else actions.tasks = 'kept';
  const cleanedDirs = [];
  removeEmptyDir(claudeDir, cleanedDirs);
  actions.cleanedDirs = cleanedDirs;
  process.stdout.write(JSON.stringify({ projectDir, actions, notes }, null, 2) + '\n');
}

main();
```
  주의: `actions.markers`는 harness의 세션 마커도 같은 디렉터리에 있으므로 harness가 설치된 프로젝트에서는 **지우지 않는다** —
  `existsSync(join(claudeDir,'harness-gate.json'))`이면 `'kept-harness'`로 보고하고 건너뛴다. 이 분기를 `actions.markers` 줄에 넣는다:
```js
  actions.markers = existsSync(join(claudeDir, 'harness-gate.json')) ? 'kept-harness' : removeKnownPath(join(claudeDir, '.harness-markers'));
```
- [ ] 4: 5개 통과 확인
- [ ] 5: `git add -A graph-beta/skills/remove graph-beta/scripts/test-remove.mjs && git commit -m "feat(graph-beta): remove.mjs - idempotent uninstall, opt-in purges, refuses live drivers"`

---

### Task 7: `skills/patch/patch.mjs` — 두 매니페스트 + README·KOR Status
**Files:** create `graph-beta/skills/patch/patch.mjs`, create `graph-beta/scripts/test-patch.mjs`
**Interfaces:** produces CLI `node patch.mjs '{plugin?="graph-beta", repoRoot, summary, summary_ko, dryRun}'` → JSON report.
harness `patch.mjs`와 같은 규칙에 `summary_ko`/`KOR.md`가 더해진 것. harness 것은 이번에 건드리지 않는다(후속에서 이 스크립트로 이전 가능 — `plugin` 인자가 그 목적).
**Pass bar:** `node --test graph-beta/scripts/test-patch.mjs` 4개 통과.

- [ ] 1: 테스트
```js
// graph-beta/scripts/test-patch.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PATCH = fileURLToPath(new URL('../skills/patch/patch.mjs', import.meta.url));

function repo(version = '0.9.0', mkVersion = version) {
  const root = mkdtempSync(join(tmpdir(), 'patch-repo-'));
  mkdirSync(join(root, '.claude-plugin'), { recursive: true });
  mkdirSync(join(root, 'graph-beta', '.claude-plugin'), { recursive: true });
  writeFileSync(join(root, '.claude-plugin', 'marketplace.json'), JSON.stringify({ plugins: [{ name: 'graph-beta', version: mkVersion }, { name: 'harness', version: '1.2.3' }] }, null, 2) + '\n');
  writeFileSync(join(root, 'graph-beta', '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'graph-beta', version }, null, 2) + '\n');
  writeFileSync(join(root, 'graph-beta', 'README.md'), '# graph-beta\n\n## Status\n\n- v0.9.0 — old\n');
  writeFileSync(join(root, 'graph-beta', 'KOR.md'), '# graph-beta\n\n## 상태\n\n- v0.9.0 — 이전\n');
  return root;
}
function run(root, args) {
  const r = spawnSync(process.execPath, [PATCH, JSON.stringify({ repoRoot: root, ...args })], { encoding: 'utf8' });
  return { status: r.status, report: r.stdout ? JSON.parse(r.stdout) : null, stderr: r.stderr };
}

test('dry run reports next version and touches nothing', () => {
  const root = repo();
  try {
    const { status, report } = run(root, { summary: 'fix a', summary_ko: 'a 수정', dryRun: true });
    assert.equal(status, 0);
    assert.equal(report.previousVersion, '0.9.0');
    assert.equal(report.version, '0.9.1');
    assert.equal(JSON.parse(readFileSync(join(root, 'graph-beta', '.claude-plugin', 'plugin.json'), 'utf8')).version, '0.9.0');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('real run bumps both manifests and prepends both status logs', () => {
  const root = repo();
  try {
    assert.equal(run(root, { summary: 'fix a', summary_ko: 'a 수정' }).status, 0);
    assert.equal(JSON.parse(readFileSync(join(root, 'graph-beta', '.claude-plugin', 'plugin.json'), 'utf8')).version, '0.9.1');
    const mk = JSON.parse(readFileSync(join(root, '.claude-plugin', 'marketplace.json'), 'utf8'));
    assert.equal(mk.plugins.find((p) => p.name === 'graph-beta').version, '0.9.1');
    assert.equal(mk.plugins.find((p) => p.name === 'harness').version, '1.2.3');
    assert.match(readFileSync(join(root, 'graph-beta', 'README.md'), 'utf8'), /## Status\n- v0\.9\.1 — fix a\n/);
    assert.match(readFileSync(join(root, 'graph-beta', 'KOR.md'), 'utf8'), /## 상태\n- v0\.9\.1 — a 수정\n/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('refuses without summary_ko, and on a version mismatch', () => {
  const a = repo();
  const b = repo('0.9.0', '0.8.0');
  try {
    assert.equal(run(a, { summary: 'x' }).status, 2);
    assert.match(run(a, { summary: 'x' }).stderr, /summary_ko/);
    assert.equal(run(b, { summary: 'x', summary_ko: 'y' }).status, 2);
    assert.match(run(b, { summary: 'x', summary_ko: 'y' }).stderr, /version mismatch/);
  } finally { rmSync(a, { recursive: true, force: true }); rmSync(b, { recursive: true, force: true }); }
});

test('the plugin argument selects another plugin directory', () => {
  const root = repo();
  try {
    const r = run(root, { plugin: 'harness', summary: 'x', summary_ko: 'y', dryRun: true });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /plugin\.json not found/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
```
- [ ] 2: 실행 → fail 확인
- [ ] 3: 스크립트
```js
#!/usr/bin/env node
// Prepare a patch release for a plugin in this marketplace: bump x.y.Z in plugin.json and the
// marketplace entry, and prepend one status line to README (## Status) AND KOR.md (## 상태) -
// this repository moves the two together. For a source checkout only.
// Usage: node patch.mjs '{"plugin":"graph-beta","repoRoot":"/abs","summary":"...","summary_ko":"...","dryRun":true}'
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO_ROOT = resolve(HERE, '..', '..', '..');

function fail(m) { process.stderr.write(`patch.mjs: ${m}\n`); process.exit(2); }
function parseArgs() {
  const raw = process.argv[2];
  if (!raw) return {};
  try { return JSON.parse(raw); } catch (e) { fail(`argv[1] is not valid JSON: ${e.message}`); }
}
function readJson(path, label) {
  if (!existsSync(path)) fail(`${label} not found: ${path}`);
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch (e) { fail(`${label} is not valid JSON: ${e.message}`); }
}
function nextPatch(v) {
  const m = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(v);
  if (!m) fail(`plugin version is not plain semver: ${v}`);
  return `${m[1]}.${m[2]}.${Number(m[3]) + 1}`;
}
function oneLine(v, name) {
  const s = String(v || '').trim();
  if (!s) fail(`${name} is required so the status logs stay in sync`);
  if (/\r|\n/.test(s)) fail(`${name} must be a single line`);
  return s;
}
function prepend(text, heading, line, label) {
  if (!text.includes(`${heading}\n`)) fail(`${label} has no "${heading}" heading`);
  if (text.includes(line)) fail(`${label} already has this status entry`);
  return text.replace(`${heading}\n`, `${heading}\n${line}\n`);
}

function main() {
  const args = parseArgs();
  const plugin = String(args.plugin || 'graph-beta');
  const summary = oneLine(args.summary, 'summary');
  const summaryKo = oneLine(args.summary_ko, 'summary_ko');
  const repoRoot = resolve(args.repoRoot || DEFAULT_REPO_ROOT);
  const pluginRoot = join(repoRoot, plugin);
  const pluginPath = join(pluginRoot, '.claude-plugin', 'plugin.json');
  const marketplacePath = join(repoRoot, '.claude-plugin', 'marketplace.json');
  const readmePath = join(pluginRoot, 'README.md');
  const korPath = join(pluginRoot, 'KOR.md');
  const pluginJson = readJson(pluginPath, `${plugin} plugin.json`);
  const marketplace = readJson(marketplacePath, 'marketplace.json');
  if (!existsSync(readmePath)) fail(`README not found: ${readmePath}`);
  if (!existsSync(korPath)) fail(`KOR.md not found: ${korPath}`);
  if (pluginJson.name !== plugin) fail(`expected plugin "${plugin}", found: ${pluginJson.name || '<unnamed>'}`);
  const entry = (marketplace.plugins || []).find((p) => p.name === plugin);
  if (!entry) fail(`marketplace has no ${plugin} entry`);
  if (entry.version !== pluginJson.version) fail(`version mismatch: plugin.json=${pluginJson.version}, marketplace.json=${entry.version}`);

  const previousVersion = pluginJson.version;
  const version = nextPatch(previousVersion);
  const nextReadme = prepend(readFileSync(readmePath, 'utf8'), '## Status', `- v${version} — ${summary}`, 'README');
  const nextKor = prepend(readFileSync(korPath, 'utf8'), '## 상태', `- v${version} — ${summaryKo}`, 'KOR.md');
  pluginJson.version = version;
  entry.version = version;

  const report = { plugin, repoRoot, previousVersion, version, summary, summary_ko: summaryKo, dryRun: args.dryRun === true, files: [pluginPath, marketplacePath, readmePath, korPath] };
  if (!report.dryRun) {
    writeFileSync(pluginPath, JSON.stringify(pluginJson, null, 2) + '\n');
    writeFileSync(marketplacePath, JSON.stringify(marketplace, null, 2) + '\n');
    writeFileSync(readmePath, nextReadme);
    writeFileSync(korPath, nextKor);
  }
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
}

main();
```
- [ ] 4: 4개 통과 확인
- [ ] 5: `git add -A graph-beta/skills/patch graph-beta/scripts/test-patch.mjs && git commit -m "feat(graph-beta): patch.mjs - synchronized patch release incl. KOR.md status"`

---

### Task 8: SKILL.md 셋 (install 재작성, remove·patch 신설)
**Files:** modify `graph-beta/skills/install/SKILL.md`, create `graph-beta/skills/remove/SKILL.md`, create `graph-beta/skills/patch/SKILL.md`
**Interfaces:** consumes Task 5·6·7의 CLI 인자·리포트 필드 이름 그대로.
**Pass bar:** `python3 scripts/validate_plugins.py`에 graph-beta 관련 ERROR 0. 세 SKILL 모두 `description`이 `Use when`으로 시작, `scenarios` EN+KR, `compatibility`, Process → What Claude does → What you do → Related 구조.

- [ ] 1: `install/SKILL.md` 본문을 아래 구조로 다시 쓴다 (frontmatter의 `name: install`, `compatibility.required: [node-18+]` 유지; description은 "Use when installing graph-beta into a project: team.json defaults, the dispatch gate, conventions, and the coexistence check against the stable graph plugin. Not for running a task; use graph-beta:orchestrate.")
  - **Process**: (1) 판단 — dispatch 패턴 제안·확인(프로젝트 언어 보고), 켤 roles 물음(0.10에서는 기록만 됨을 말한다), harness가 있으면 "conventions는 공유, 마커 디렉터리 공유"를 말한다; (2) `node "<plugin>/skills/install/install.mjs" '{...}'` 실행 — exit 3이면 `report.conflicts`를 읽어 사용자에게 stable graph를 끄거나 `force`를 고르게 한다, **절대 스스로 force하지 않는다**; (3) 리포트 JSON을 진실로 삼아 created/kept/present를 보고; (4) 도구 발견 — `graph_*` 6 + `tm_*` (tm_open tm_next tm_submit tm_retry tm_status tm_settle tm_repackage tm_repair tm_reset_capacity), 없으면 reload 안내; (5) `refresh: true`는 버전 업 뒤 team.json에 새 키를 채우는 용도임을 적는다.
  - 기존 "Install modes"의 marketplace 우선 원칙과 "project-local `.mcp.json`" 절, "Dispatch gate" 절은 유지하되 dispatch json 쓰기는 이제 `install.mjs`가 한다고 바꾼다.
  - **What Claude does / What you do / Related** (`orchestrate`, `remove`, `patch`, `harness:install`).
  - 도구 발견 목록에 `tm_events` 추가; "main은 tm_open 뒤 tm_status/tm_events로 지켜본다"를 한 줄로.
- [ ] 2: `remove/SKILL.md` — frontmatter `name: remove`, description "Use when removing graph-beta from a project: team.json, the dispatch gate, the CLAUDE.md block and gitignore lines. Keeps conventions, run and task history unless asked by name. Refuses to purge a task whose driver is alive.", scenarios EN 2 + KR 2 ("graph-beta 이 프로젝트에서 제거해줘", "team.json이랑 dispatch 게이트 지워줘"), `compatibility.optional: []`. Process: 대상 나열 → `purgeConventions`/`purgeRuns`/`purgeTasks`는 각각 **명시 확인 후에만** → 실행 → 리포트에서 `refused-alive`·`marker-error`·`kept-harness`를 그대로 보고. Related: install, patch, harness:remove.
- [ ] 3: `patch/SKILL.md` — `name: patch`, description "Use when preparing a patch release of the graph-beta plugin source: bumps x.y.Z in plugin.json and marketplace.json and prepends the same entry to README Status and KOR.md 상태. Not for project installs.", scenarios EN 2 + KR 2 ("graph-beta 패치 버전 올려줘", "0.10.x 릴리스 준비"). Process: diff에서 한 줄 요약 EN·KO 도출 → minor/major면 중단하고 손으로 → `dryRun: true` → 확인 → 실행 → `python3 scripts/validate_plugins.py` → git diff 보고, "published"라 말하지 않기. Related: install, remove, harness:patch.
- [ ] 4: `python3 scripts/validate_plugins.py` 실행, graph-beta ERROR 0 확인 (WARN은 허용)
- [ ] 5: `git add -A graph-beta/skills && git commit -m "docs(graph-beta): install/remove/patch skills"`

---

### Task 9: 릴리스 0.10.0 — 버전, Status, 설계 문서 §13, 전체 검증
**Files:** modify `graph-beta/.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` (graph-beta 항목 version + description),
`graph-beta/README.md`, `graph-beta/KOR.md`, `docs/plans/2026-09-17-graph-beta-team.md` (§13)
**Interfaces:** consumes 모든 이전 Task.
**Pass bar:** `node --test graph-beta/scripts/test-*.mjs` 전부 통과(회귀 0), `python3 scripts/validate_plugins.py` ERROR 0, 두 매니페스트 0.10.0 일치, README·KOR Status 첫 항목이 v0.10.0.

- [ ] 1: 메모리 규칙대로 `git fetch skills main && git status -sb`로 origin이 앞서 있는지 확인, 앞서 있으면 rebase
- [ ] 2: `node --test graph-beta/scripts/test-*.mjs 2>&1 | tail -8` → `# fail 0` 확인
- [ ] 3: minor 범프는 손으로: plugin.json과 marketplace의 graph-beta `version` → `0.10.0`; marketplace description 끝에 " Ships graph-beta:install/remove/patch, .claude/team.json project defaults, and a shared engagement marker so it coexists with the harness plugin." 추가
- [ ] 4: README `## Status` 첫 항목과 KOR `## 상태` 첫 항목에 v0.10.0 — install/remove/patch, team.json(우선순위·출처), 공유 마커(harness 변경 0, 워크트리 위치가 이유), dispatch-gate 역방향, patch가 KOR 포함, **inline 제거(breaking: `child_driver`/`s_driver` 인자 에러)**, **TaskLeader driver + inbox + `tm_events`**, 테스트 파일 수/개수(실행 결과 숫자를 그대로), **미측정 항목**: 실제 harness+team 프로젝트에서의 런 1회, leader 세션의 SendMessage 알림이 실제로 도착하는지
- [ ] 5: 설계 문서 갱신 — §14 결정 기록의 "inline 옵션 셋 제거"를 v0.10.0 완료로, §6의 main 허용 호출 표에 `tm_events`를,
  §7b의 inbox 문단에 "구현: `HARNESS_LEADER_OF`로 leader 프로세스 식별, `<taskDir>/inbox/`"를 한 줄 추가. 그리고 §13의 "harness + team" 행을 이 계획의 Architecture 문단대로 고친다 — `~/.harness/active/` 삭제, `.claude/.harness-markers/team-<task8>` 공유, "harness 훅 한 줄 변경"을 "harness 변경 0"으로. §12 install 표의 "훅 쓰지 않음" 유지. §11 단계 표의 v0.10.0 행을 "완료" 표시
- [ ] 6: `python3 scripts/validate_plugins.py` ERROR 0 확인
- [ ] 7: `git add -A && git commit -m "feat(graph-beta): 0.10.0 - install/remove/patch, team.json defaults, shared engagement marker for harness coexistence"`
- [ ] 8: `git push skills main` (저장소 규칙. 실패하면 1번으로 돌아가 fetch·rebase 후 재시도)

---

### Task 10: inline 제거 — main은 어떤 노드도 드라이브하지 않는다
**Files:** modify `graph-beta/mcp/taskmanager.mjs`, modify `graph-beta/scripts/test-taskmanager.mjs`,
modify `graph-beta/skills/{orchestrate,develop,document,install}/SKILL.md`, `graph-beta/skills/orchestrate/references/{manager,loop}.md`
**Interfaces:** `tm_open`에서 `child_driver`·`s_driver` 인자 **제거**(넘기면 에러). 내부 spawn 생략은 **테스트 전용 env**
`HARNESS_TEST_NO_DRIVER=1`로만 — 사용자에게 노출되는 옵션이 아니다. produces `noDriver()`.
**Pass bar:** test-taskmanager 전체 통과(기존 inline 테스트는 env 방식으로 전환, delegate 테스트는 삭제), 스킬 문서에 `inline` 0회
(`grep -rn inline graph-beta/skills | grep -v "doing it inline"` 이 비어야 한다 — install/SKILL.md 46행의 일반 영어 표현은 예외).

- [ ] 1: 테스트 전환 — `withTask`의 `tm_open` 호출에서 `child_driver: 'inline'`을 지우고 TM Client env에 `HARNESS_TEST_NO_DRIVER: '1'` 추가:
```js
  const tm = await new Client(TM, { HARNESS_TASKS_DIR: root, HARNESS_TEST_NO_DRIVER: '1' }).init();
  // ...
    const open = await tm.call('tm_open', { request: 'big request', cwd, vendor: 'self', ...extra });
```
  같은 파일에서 `s_driver: 'inline'`을 넘기던 테스트(177, 195, 222, 1270, 1289행 근방)는: (a) "delegates to graph_open and leaves
  nothing on disk"와 "the pre-existing delegate shape" 두 개는 **삭제**; (b) 나머지는 `s_driver` 인자를 지우고, S로 측정된 뒤
  `tm_status({task_id}).s_run.run_id`를 읽어 broker Client `g`로 `graph_next/graph_submit({cwd: task.cwd, run_id})`를 부르는
  형태로 바꾼다(env 덕에 driver는 뜨지 않는다). (c) 1177행 "child_driver inline spawns nothing"은 제목과 본문을
  `HARNESS_TEST_NO_DRIVER spawns nothing` 으로 바꾸고 `tm_status().child_driver` assert를 지운다.
  새 테스트 추가:
```js
test('child_driver and s_driver are gone: passing either is an error that names the reason', async () => {
  const cwd = repo();
  const root = mkdtempSync(join(tmpdir(), 'tm-root-'));
  const tm = await new Client(TM, { HARNESS_TASKS_DIR: root, HARNESS_TEST_NO_DRIVER: '1' }).init();
  try {
    for (const bad of [{ child_driver: 'inline' }, { s_driver: 'process' }]) {
      const r = await tm.call('tm_open', { request: 'r', cwd, vendor: 'self', ...bad });
      assert.match(r.error, /removed in 0\.10\.0/);
      assert.match(r.error, /never drives/);
    }
    assert.deepEqual(readdirSync(root), [], 'a refused open leaves no task behind');
  } finally { tm.close(); rmSync(cwd, { recursive: true, force: true }); rmSync(root, { recursive: true, force: true }); }
});
```
- [ ] 2: `node --test graph-beta/scripts/test-taskmanager.mjs` → 전환한 테스트와 새 테스트가 fail 확인
- [ ] 3: `taskmanager.mjs`
  - 헬퍼 추가(파일 상단 helpers 근처):
```js
// Test seam only. The driving session never drives a child or the manager loop; a test that
// wants to submit nodes by hand through the broker sets this and spawns nothing.
function noDriver() { return process.env.HARNESS_TEST_NO_DRIVER === '1'; }
```
  - `createTask` 첫 줄 앞에:
```js
  if (a.child_driver !== undefined || a.s_driver !== undefined) {
    throw new Error('child_driver and s_driver were removed in 0.10.0: the driving session never drives a child run or the manager loop. Open the task and watch tm_status / tm_events; the TaskLeader driver does the rest.');
  }
```
    `child_driver:` / `s_driver:` 두 필드 삭제(주석 포함).
  - `delegateIfSmall`: `if (task.s_driver === 'inline') { ... return {...delegate} }` 블록 전체 삭제.
  - `openSRun` 1437행, dispatch 909행, 1622행, 1636행의 `task.s_driver !== 'inline'` / `task.child_driver !== 'inline'` → `!noDriver()`.
  - TOOLS의 `tm_open.inputSchema.properties`에서 `child_driver`, `s_driver` 항목 삭제; `tm_next` description의 "unless the task was opened with child_driver \"inline\"" 구절 삭제.
  - `toolStatus`의 `s_driver:`·`child_driver:` 필드 삭제.
  - `toolNext`/`toolNextSRun`의 `.next` 문구 중 inline을 언급하는 것은 "the driver" 기준으로 고친다.
- [ ] 4: 전체 통과 확인
- [ ] 5: 스킬 문서 — orchestrate/develop/document SKILL.md의 Entry 블록에서 `delegate present -> ...` 줄과 "Pass `s_driver: \"inline\"` only when..." 문장, "Run references/loop.md yourself only for a delegated ..." 문장을 지우고 Entry를 이렇게 바꾼다(세 파일 동일 구조, `flow` 핀만 다름):
```
tm_open({request, cwd, isolated, flow: ..., vendor: "auto", allocation: "balanced", host_vendor, host_model, native_models})
    -> task_id, leader: {pid, log}
The TaskLeader driver now runs the manager loop in its own session. You never call tm_next/tm_submit.
Watch: tm_status({task_id}) for state and leader; tm_events({task_id}) for what happened; the leader posts a
one-line message to this session on each state change when session messaging is available.
```
  manager.md: 24행 "no driver at all -> child_driver inline" 줄과 79행 문단 삭제, 파일 머리에 "이 파일은 TaskLeader driver 세션이 읽는다" 한 줄. loop.md 12행의 "Only in an inline task..." 문장 삭제. README 101행은 Status 이력이므로 그대로.
- [ ] 6: `grep -rn "inline" graph-beta/skills | grep -v "doing it inline"` 출력이 빈 것을 확인
- [ ] 7: `git add -A graph-beta && git commit -m "feat(graph-beta)!: remove child_driver/s_driver inline - the driving session never drives; HARNESS_TEST_NO_DRIVER is the test seam"`

---

### Task 11: TaskLeader driver — `tm_open`이 leader를 띄우고, main은 보기만 한다
**Files:** modify `graph-beta/mcp/taskmanager.mjs`, modify `graph-beta/scripts/test-taskmanager.mjs`
**Interfaces:** consumes Task 10 `noDriver()`, 기존 `spawnChildDriver`/`driverAlive`/`driverStderrTail`/`record`/`nextSpawnAttempt`.
produces `task.leader = {pid, started_at, log, stderr, exit, command, spawn_count, restarts}`, `leaderPrompt(task)`, `isLeaderProcess(task)`,
inbox(`<taskDir>/inbox/<ts>-<seq>-<tool>.json`), `drainInbox(task)`, `serviceLeader(task)`, 새 도구 `tm_events`,
`tm_status.leader`, `tm_open` 응답의 `leader`. 세션 간 알림은 leader 프롬프트의 지시(best-effort).
**Pass bar:** 새 테스트 5개 통과 + 기존 전체 회귀 0. `tools/list`가 `tm_events`를 포함한다(기존 "five manager tools" 테스트의 기대 목록에 추가).

- [ ] 1: 테스트 (파일의 `FAKE_DRIVER` 문자열과 `writeFileSync`로 만든 fake 스크립트 경로를 그대로 재사용한다; fake는 argv 마지막(프롬프트)을 `FAKE_DRIVER_OUT`에 쓴다 — 아니면 그렇게 고친다)
```js
test('tm_open spawns a TaskLeader driver whose prompt names the task and manager.md, and records it', async () => {
  const cwd = repo();
  const root = mkdtempSync(join(tmpdir(), 'tm-root-'));
  const fake = join(root, 'fake-leader.mjs');
  writeFileSync(fake, FAKE_DRIVER);
  const out = join(root, 'leader.out');
  const tm = await new Client(TM, { HARNESS_TASKS_DIR: root, HARNESS_CHILD_DRIVER: `node ${fake}`, FAKE_DRIVER_OUT: out }).init();
  try {
    const open = await tm.call('tm_open', { request: 'lead me', cwd, vendor: 'self', size: 'L' });
    assert.ok(open.leader && open.leader.pid, 'a leader pid comes back');
    assert.ok(open.leader.log.endsWith('leader.stream.jsonl'));
    await new Promise((r) => setTimeout(r, 400));
    const prompt = readFileSync(out, 'utf8');
    assert.match(prompt, new RegExp(open.task_id));
    assert.match(prompt, /references\/manager\.md/);
    assert.match(prompt, /Do not call tm_open/);
    assert.match(prompt, /never do a node's work/i);
    assert.match(prompt, /SendMessage/);
    const ledger = readFileSync(join(root, open.task_id, 'ledger.jsonl'), 'utf8');
    assert.match(ledger, /"event":"leader_spawned"/);
    const s = await tm.call('tm_status', { task_id: open.task_id });
    assert.equal(typeof s.leader.alive, 'boolean');
    assert.equal(s.leader.spawn_count, 1);
  } finally { tm.close(); rmSync(cwd, { recursive: true, force: true }); rmSync(root, { recursive: true, force: true }); }
});

test('a mutating call from a non-leader process is queued to the inbox; the leader process drains it on tm_next', async () => {
  const cwd = repo();
  const root = mkdtempSync(join(tmpdir(), 'tm-root-'));
  const main = await new Client(TM, { HARNESS_TASKS_DIR: root, HARNESS_CHILD_DRIVER: 'node -e setTimeout(()=>{},30000)' }).init();
  let leader;
  let pid;
  try {
    const open = await main.call('tm_open', { request: 'lead me', cwd, vendor: 'self', size: 'L' });
    pid = open.leader.pid;
    const q = await main.call('tm_submit', { task_id: open.task_id, node_id: 'shape', payload: { stage_ok: true } });
    assert.equal(q.queued, true);
    assert.match(q.inbox_path, /inbox\/\d+-\d+-tm_submit\.json$/);
    assert.ok(existsSync(q.inbox_path));
    const before = JSON.parse(readFileSync(join(root, open.task_id, 'task.json'), 'utf8'));
    assert.equal(before.nodes.find((n) => n.node_id === 'shape').state, 'pending', 'main did not write task.json');

    leader = await new Client(TM, { HARNESS_TASKS_DIR: root, HARNESS_LEADER_OF: open.task_id }).init();
    const n = await leader.call('tm_next', { task_id: open.task_id });
    assert.equal(existsSync(q.inbox_path), false, 'drained');
    assert.ok(n.inbox_applied >= 1);
    const ledger = readFileSync(join(root, open.task_id, 'ledger.jsonl'), 'utf8');
    assert.match(ledger, /"event":"inbox_applied"/);
    // shape depended on size; the queued submit was applied and failed the same way a direct one would.
    assert.match(ledger, /"tool":"tm_submit"/);
  } finally {
    try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ }
    main.close(); if (leader) leader.close();
    rmSync(cwd, { recursive: true, force: true }); rmSync(root, { recursive: true, force: true });
  }
});

test('tm_next from a non-leader process does not drive: it returns leader state and a hint', async () => {
  const cwd = repo();
  const root = mkdtempSync(join(tmpdir(), 'tm-root-'));
  const main = await new Client(TM, { HARNESS_TASKS_DIR: root, HARNESS_CHILD_DRIVER: 'node -e setTimeout(()=>{},30000)' }).init();
  let pid;
  try {
    const open = await main.call('tm_open', { request: 'lead me', cwd, vendor: 'self', size: 'L' });
    pid = open.leader.pid;
    const n = await main.call('tm_next', { task_id: open.task_id });
    assert.equal(n.driven_by, 'leader');
    assert.equal(n.leader.alive, true);
    assert.match(n.hint, /tm_status|tm_events/);
    assert.equal(n.ready, undefined, 'no briefing paths are handed to the watcher');
  } finally { try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ } main.close(); rmSync(cwd, { recursive: true, force: true }); rmSync(root, { recursive: true, force: true }); }
});

test('a dead leader is respawned on any tm_* call up to driver_restarts, then reported exhausted', async () => {
  const cwd = repo();
  const root = mkdtempSync(join(tmpdir(), 'tm-root-'));
  const fake = join(root, 'fake-leader.mjs');
  writeFileSync(fake, FAKE_DRIVER); // exits at once
  const tm = await new Client(TM, { HARNESS_TASKS_DIR: root, HARNESS_CHILD_DRIVER: `node ${fake}`, FAKE_DRIVER_OUT: join(root, 'o') }).init();
  try {
    const open = await tm.call('tm_open', { request: 'lead me', cwd, vendor: 'self', size: 'L', driver_restarts: 1 });
    await new Promise((r) => setTimeout(r, 400));
    let s = await tm.call('tm_status', { task_id: open.task_id });
    assert.equal(s.leader.restarts, 1, 'first dead leader respawned');
    await new Promise((r) => setTimeout(r, 400));
    s = await tm.call('tm_status', { task_id: open.task_id });
    assert.equal(s.leader.restarts, 1);
    assert.equal(s.leader.exhausted, true);
    assert.ok(s.leader.stderr_tail.length > 0);
    const ledger = readFileSync(join(root, open.task_id, 'ledger.jsonl'), 'utf8');
    assert.match(ledger, /"event":"leader_restarted"/);
    assert.match(ledger, /"event":"leader_exhausted"/);
  } finally { tm.close(); rmSync(cwd, { recursive: true, force: true }); rmSync(root, { recursive: true, force: true }); }
});

test('tm_events tails the ledger, newest last, filtered by since', async () => {
  await withTask(async ({ tm, task_id, root }) => {
    const all = await tm.call('tm_events', { task_id });
    assert.ok(all.events.length >= 1);
    assert.equal(all.events[0].event, 'tm_open');
    const last = all.events.at(-1).ts;
    await tm.call('tm_submit', { task_id, node_id: 'size', payload: { stage_ok: true, size: 'L', handoff: 'h', evidence: 'e' } });
    const since = await tm.call('tm_events', { task_id, since: last });
    assert.ok(since.events.every((e) => e.ts > last));
    assert.ok(since.events.some((e) => e.event === 'tm_submit' || e.event === 'node_done' || /submit|done/.test(e.event)));
    const two = await tm.call('tm_events', { task_id, limit: 2 });
    assert.equal(two.events.length, 2);
  });
});
```
  "serves the MCP handshake and the five manager tools" 테스트의 기대 배열에 `'tm_events'` 추가(정렬 유지).
  `tm_submit`이 ledger에 남는지는 `record` 호출 유무에 따라 다르다 — 없으면 `toolSubmit` 진입에 `record(task, {event:'tm_submit', node_id})` 한 줄을 추가한다(step 3).
- [ ] 2: 실행 → 새 5개 fail 확인
- [ ] 3: `taskmanager.mjs`
  - `spawnChildDriver(task, nodeIdLabel, child, opts)`에 두 가지 확장: `opts.prompt`가 있으면 `driverPrompt(...)` 대신 그것을 마지막 인자로; `opts.env`가 있으면 `Object.assign(env, opts.env)`. 기존 호출은 변경 없음.
  - leader 프롬프트:
```js
function leaderPrompt(task, opts = {}) {
  return [
    `You are the TaskLeader of graph-beta task ${task.run_id} at cwd ${task.cwd}. The task is already open: Do not call tm_open.`,
    `Use the graph-beta:orchestrate skill and read references/manager.md; run its loop with tm_next / tm_submit / tm_retry on this task_id`,
    `until tm_status reports complete or blocked, or the report node has run. A fresh agent for every ready manager node, its JSON relayed verbatim.`,
    `You never do a node's work yourself, never edit project files, never open a child run by hand.`,
    opts.resume ? `A previous leader for this task died; call tm_status first and resume from what is already done - do not redo a done node.` : '',
    task.notify ? `On every state change, if ListAgents lists "${task.notify}", SendMessage it one line: task_id, phase, state, and what changed. If the tool or the name is missing, skip silently and never wait for it.`
                : `On every state change, if the session that opened this task is listed by ListAgents, SendMessage it one line: task_id, phase, state, and what changed. If session messaging is unavailable, skip silently and never wait for it.`,
    `End with the skill's output template.`,
  ].filter(Boolean).join(' ');
}
function isLeaderProcess(task) { return process.env.HARNESS_LEADER_OF === task.run_id; }
function leaderAlive(task) { return !!(task.leader && driverAlive(task.leader)); }
```
  - `createTask`: `notify: typeof a.notify === 'string' && a.notify ? a.notify : null,` 필드 추가(tm_open 스키마에 `notify: {type:'string', description:'agent/session name for one-line progress messages, best-effort'}`).
  - spawn/respawn:
```js
function spawnLeader(task, opts = {}) {
  const attempt = task.leader ? (task.leader.spawn_count || 0) : 0;
  const d = spawnChildDriver(task, 'leader', { cwd: task.cwd, run_id: task.run_id }, { attempt, prompt: leaderPrompt(task, opts), env: { HARNESS_LEADER_OF: task.run_id } });
  task.leader = { ...d, spawn_count: attempt + 1, restarts: task.leader ? (task.leader.restarts || 0) + (opts.resume ? 1 : 0) : 0, exhausted: false };
  record(task, { event: opts.resume ? 'leader_restarted' : 'leader_spawned', task_id: task.run_id, pid: d.pid, log: d.log, ...(d.error ? { error: d.error } : {}) });
}
// Called at the top of every tm_* entry. The main session never drives; it re-raises the leader.
function serviceLeader(task) {
  if (noDriver() || !task.leader || isLeaderProcess(task)) return false;
  const st = runState(task).state;
  if (st === 'complete' || st === 'blocked') return false;
  if (driverAlive(task.leader)) return false;
  if (task.leader.exhausted) return false;
  if ((task.leader.restarts || 0) >= task.driver_restarts) {
    task.leader.exhausted = true;
    record(task, { event: 'leader_exhausted', task_id: task.run_id, restarts: task.leader.restarts, stderr: driverStderrTail(task.leader) });
    saveRun(task);
    return true;
  }
  spawnLeader(task, { resume: true });
  saveRun(task);
  return true;
}
```
  - `toolOpen`: `createTask` 뒤, `size_pinned` 처리와 `saveRun` 다음에 `if (!noDriver()) { spawnLeader(task); saveRun(task); }`; 반환 객체에 `leader: task.leader ? { pid: task.leader.pid, log: task.leader.log } : null` 을 얹는다(`toolNext(...)` 결과에 spread).
  - inbox:
```js
const MUTATING = new Set(['tm_submit', 'tm_retry', 'tm_settle', 'tm_repackage', 'tm_repair', 'tm_reset_capacity']);
let inboxSeq = 0;
function queueToInbox(task, tool, args) {
  const dir = join(taskDir(task.run_id), 'inbox');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${Date.now()}-${String(++inboxSeq).padStart(4, '0')}-${tool}.json`);
  writeFileSync(path, JSON.stringify({ tool, args, ts: Date.now(), from_pid: process.pid }) + '\n');
  record(task, { event: 'inbox_queued', task_id: task.run_id, tool, path });
  return { queued: true, task_id: task.run_id, tool, inbox_path: path, applied_by: 'the leader on its next tm_next', leader: { pid: task.leader.pid, alive: leaderAlive(task) } };
}
function drainInbox(task) {
  const dir = join(taskDir(task.run_id), 'inbox');
  let files = [];
  try { files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort(); } catch { return 0; }
  let applied = 0;
  for (const f of files) {
    const path = join(dir, f);
    let req;
    try { req = JSON.parse(readFileSync(path, 'utf8')); } catch { mkdirSync(join(dir, 'failed'), { recursive: true }); try { writeFileSync(join(dir, 'failed', f), readFileSync(path)); rmSync(path); } catch { /* best-effort */ } continue; }
    try {
      dispatchTool(req.tool, { ...req.args, task_id: task.run_id });
      record(task, { event: 'inbox_applied', task_id: task.run_id, tool: req.tool, path });
      applied++;
    } catch (e) {
      record(task, { event: 'inbox_failed', task_id: task.run_id, tool: req.tool, path, error: String((e && e.message) || e) });
      mkdirSync(join(dir, 'failed'), { recursive: true });
      try { writeFileSync(join(dir, 'failed', f), readFileSync(path)); } catch { /* best-effort */ }
    }
    try { rmSync(path); } catch { /* best-effort */ }
  }
  return applied;
}
```
  - `dispatchTool(name, a)` (1755행 switch를 감싼 함수 이름이 다르면 그 이름으로): switch 앞에
```js
  if (a.task_id && name !== 'tm_open') {
    const task = mustFindTask(a);
    serviceLeader(task);
    const watcher = !noDriver() && !isLeaderProcess(task) && task.leader && leaderAlive(task);
    if (watcher && MUTATING.has(name)) return queueToInbox(task, name, a);
    if (watcher && name === 'tm_next') {
      const st = runState(task);
      return { task_id: task.run_id, state: st.state, counts: st.counts, driven_by: 'leader',
        leader: { pid: task.leader.pid, alive: true, log: task.leader.log, restarts: task.leader.restarts },
        hint: 'the TaskLeader driver runs the loop; watch tm_status({task_id}) and tm_events({task_id})' };
    }
    if (name === 'tm_next' && (isLeaderProcess(task) || noDriver())) { const n = drainInbox(task); if (n) a.__inbox_applied = n; }
  }
```
    그리고 `case 'tm_next'`의 결과에 `inbox_applied: a.__inbox_applied || 0`을 spread한다. `mustFindTask`가 task를 다시 읽으므로 `drainInbox` 안의 `dispatchTool` 재진입은 파일 기준으로 일관된다(leader 프로세스이므로 큐로 되돌아가지 않는다).
  - `tm_events`:
```js
function toolEvents(a) {
  const task = mustFindTask(a);
  const since = Number(a.since) || 0;
  const limit = Number.isInteger(a.limit) && a.limit > 0 ? a.limit : 50;
  let lines = [];
  try { lines = readFileSync(join(taskDir(task.run_id), 'ledger.jsonl'), 'utf8').split('\n').filter(Boolean); } catch { lines = []; }
  const events = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter((e) => e && e.ts > since);
  return { task_id: task.run_id, count: events.length, events: events.slice(-limit) };
}
```
    TOOLS에 `{ name: 'tm_events', description: 'Tail the task ledger: what the manager and its drivers did, newest last. since: a ts to start after; limit: default 50. Read-only; safe from any session.', inputSchema: { type: 'object', properties: { task_id: { type: 'string' }, since: { type: 'number' }, limit: { type: 'integer' } }, required: ['task_id'] } }` 추가, switch에 `case 'tm_events': return toolEvents(a);`.
  - `toolStatus`: 두 반환 분기 모두에 `leader: task.leader ? { pid: task.leader.pid, alive: leaderAlive(task), log: task.leader.log, stderr: task.leader.stderr, spawn_count: task.leader.spawn_count, restarts: task.leader.restarts || 0, exhausted: !!task.leader.exhausted, stderr_tail: driverStderrTail(task.leader) } : null,` 추가.
  - `toolSubmit` 진입에 `record(task, { event: 'tm_submit', task_id: task.run_id, node_id: String(a.node_id) });` (없다면).
- [ ] 4: 전체 통과 확인 (`node --test graph-beta/scripts/test-taskmanager.mjs`)
- [ ] 5: `git commit -am "feat(graph-beta): TaskLeader driver - tm_open spawns the manager loop; inbox for non-leader mutations; respawn; tm_events"`

---

## 자기 검토

- 소비/생산 연결: Task 5는 Task 1의 `TEAM_DEFAULTS`를 import — Task 1이 앞. Task 6 테스트는 Task 5의 install.mjs를 실행 — Task 5가 앞. Task 3 테스트는 harness 훅을 **읽기만** — harness 변경 없음. Task 9는 Task 0의 버전 정합 위에서 0.10.0으로 올림.
- 이름 일관성: `team.json` 필드명은 Task 1의 `TEAM_DEFAULTS` 키가 유일한 정의이고 Task 5·8이 그대로 쓴다. 마커 파일명 `team-<task8>`은 Task 3의 `markerPath`가 유일한 정의.
- 모호 지점 해소: (a) team.json vs 인자 우선순위 = 인자가 이김(Task 1 테스트로 고정). (b) `actions.markers`는 harness 설치 프로젝트에서 건너뜀(Task 6). (c) 워크트리 위치 `~/.harness/tasks/<id>/worktrees/`이므로 마커는 프로젝트가 아니라 워크트리에(Task 3). (d) inline 옵션 거부는 범위 밖(v0.13.1).
- Task 10↔11 순서: 11의 `noDriver()`·`serviceLeader`는 10의 헬퍼와 인자 제거 위에 선다. 10을 먼저.
- 위험(Task 11): `dispatchTool` 재진입 — `drainInbox`가 `dispatchTool`을 부르고 그 안에서 다시 `mustFindTask`가 파일을 읽는다.
  leader 프로세스에서만 일어나므로 큐로 되돌아가지 않지만, 재진입 시 `a.task_id`가 있어 `serviceLeader`가 다시 돌 수 있다 — `isLeaderProcess`가 true라 즉시 반환한다. 테스트 2가 이 경로를 통과시킨다.
- 위험(Task 11): fake driver `node -e setTimeout(()=>{},30000)` 은 프롬프트를 argv로 받아 무시한다. 테스트 finally에서 반드시 kill.
- 위험: `toolNext`가 매 폴링마다 마커 파일을 쓴다 — 워크트리 하나당 write 1회, 폴링 주기 기준 무시할 크기. `toolStatus`의 단일-task 반환 객체 위치는 구현자가 함수 본문에서 찾아야 한다(Task 2 step 3에 명시).
