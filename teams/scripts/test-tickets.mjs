// teams/scripts/test-tickets.mjs - table test over the design doc's §4 mapping (engine
// state -> ticket state), plus the derived states §4 only sketches (CANCELLED/UNREACHABLE at
// every level, BLOCKED at EPIC level - see the plan's 발견 3/4). Every fixture is a plain object
// shaped exactly like a real task.json/child run.json - no server, no filesystem - except the
// size-S EPIC fixtures below, which need one real run file on disk: epicTicketState/epicPhase's
// S-run branch reads task.s_run's own file (tickets.mjs's loadSRun), the same as taskState()
// (taskmanager.mjs) always has, and there is nothing to inject it with.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { node, pushChain, KINDS, saveRun } from '../mcp/graph.mjs';
import {
  epicKey, storyKey, docPaths, latestBySubgoal, storyTicketState, epicTicketState,
  taskTicketState, epicPhase, storyTaskProgress, epicBoardRows, ticketSnapshot, storyLinks,
} from '../mcp/tickets.mjs';

const TASK_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

// A size-S task's own manager graph never carries the work - task.s_run points at the one
// real graph run that does (openSRun, taskmanager.mjs). Builds that run's file on disk under a
// fresh temp cwd and returns a task object wired to it exactly the way taskmanager leaves
// task.s_run: {cwd, run_id}. Caller must rmSync the returned cwd when done.
// `taskNodes` fakes the size-S manager graph itself (task.nodes/task.spec never exist for real
// on a size-S task once delegateIfSmall runs, so any fixed choice here is already fiction) -
// picked per test, in each case, to be a value the PRE-FIX code (which reads task.nodes/
// task.spec straight, never task.s_run) would turn into an answer DIFFERENT from what this
// fixture's real child run should produce. That is deliberate: a fixed default here would make
// the pre-fix code answer the same constant for every fixture, and whichever test happened to
// expect that same constant would keep "passing" with the defect back in - see the three
// FAKE_MANAGER_SAYS_* constants below and pick whichever is not the expected answer.
const FAKE_MANAGER_SAYS_DONE = [node('report', 'report', [], { state: 'done', result: {} })];
const FAKE_MANAGER_SAYS_BLOCKED = []; // runState([]): nothing ready, nothing running -> blocked
const FAKE_MANAGER_SAYS_READY = [node('size', 'size', [])]; // pending+ready, no task.spec -> READY

function sRunTask(nodes, extra, taskNodes) {
  const cwd = mkdtempSync(join(tmpdir(), 'tickets-srun-'));
  const run_id = `srun-${Math.random().toString(16).slice(2)}`;
  saveRun({ run_id, cwd, spec: null, nodes, ...(extra || {}) });
  return { cwd, task: { run_id: TASK_ID, cwd: '/proj', nodes: taskNodes, s_run: { cwd, run_id } } };
}

function baseTask(nodes, extra) {
  return { run_id: TASK_ID, cwd: '/proj', request: 'do the thing', created_at: 1,
    team: { opts: { docs_dir: '.teams_output/team' } }, spec: null, nodes, ...extra };
}

function dispatchNode(pkgId, patch) {
  return node(`dispatch:${pkgId}:1`, 'dispatch', (patch && patch.deps) || [], { subgoal_id: pkgId, ...patch });
}
function acceptNode(pkgId, patch) {
  return node(`accept:${pkgId}:1`, 'accept', [`dispatch:${pkgId}:1`], { subgoal_id: pkgId, ...patch });
}

// ---------- key/path builders ----------

test('epicKey takes the task id\'s first 8 hex chars; storyKey/docPaths compose on it', () => {
  assert.equal(epicKey(TASK_ID), 'E-aaaaaaaa');
  assert.equal(storyKey(TASK_ID, 'P1'), 'E-aaaaaaaa/P1');
  const paths = docPaths(baseTask([]));
  assert.equal(paths.index, '/proj/.teams_output/team/E-aaaaaaaa/INDEX.md');
  assert.equal(paths.story('P2'), '/proj/.teams_output/team/E-aaaaaaaa/40-stories/P2.md');
});

test('docPaths honors team.json\'s docs_dir override', () => {
  const t = baseTask([], { team: { opts: { docs_dir: 'docs/epics' } } });
  assert.equal(docPaths(t).index, '/proj/docs/epics/E-aaaaaaaa/INDEX.md');
});

test('docPaths falls back to .teams_output/team (teamconfig.mjs\'s TEAM_DEFAULTS.docs_dir) when team.opts carries none', () => {
  const t = baseTask([], { team: {} });
  assert.equal(docPaths(t).index, '/proj/.teams_output/team/E-aaaaaaaa/INDEX.md');
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

// idol-pm-1 (2026-09-22): three shaping attempts spent, zero packages dispatched, six of seven
// STORYs released as unreachable - and a report written over that settled failure. The report's
// own prose said "구현된 것은 없다"; this row said DONE, and so did every surface built on it.
test('EPIC ticket state: a report written over a settled failure is SETTLED, not DONE', () => {
  const settled = baseTask(
    [
      node('report:2', 'report', [], { state: 'done', result: {} }),
      dispatchNode('P1', { state: 'unreachable' }),
      acceptNode('P1', { state: 'unreachable' }),
    ],
    { spec: { packages: [{ id: 'P1' }] } },
  );
  assert.equal(epicTicketState(settled), 'SETTLED');
  // A task that delivered and then reported is untouched: DONE still means DONE.
  const delivered = baseTask(
    [
      node('report', 'report', [], { state: 'done', result: {} }),
      dispatchNode('P1', { state: 'done', result: { accept: true } }),
      acceptNode('P1', { state: 'done', result: { accept: true, match_pct: 95 } }),
    ],
    { spec: { packages: [{ id: 'P1' }] } },
  );
  assert.equal(epicTicketState(delivered), 'DONE');
});

// expandPackages (taskmanager.mjs) pushes integrate/gate:goal/report onto task.nodes in the
// same call that opens every package's dispatch/accept chain - a task shaped exactly the way it
// actually leaves one, not the dispatch-only or integrate-only fixtures above which never let
// dispatch/accept and integrate co-exist and so cannot see this. Before the old `goalLevel`
// predicate (integrate node merely existing) was replaced with unmetDeps() on it (every
// package's accept actually reaching 'done'), the first case here read IN_REVIEW/qualitygate
// instead of IN_PROGRESS/impl.
function expandedTask(packageNodes, { deps = ['accept:P1:1', 'accept:P2:1'] } = {}) {
  return baseTask(
    [
      ...packageNodes,
      node('integrate:1', 'integrate', deps, { subgoal_id: null }),
      node('gate:goal:1', 'gate', ['integrate:1'], { subgoal_id: null }),
      node('report', 'report', [], { after: ['gate:goal:1'] }),
    ],
    { spec: { packages: [{ id: 'P1' }, { id: 'P2' }] } },
  );
}

test('EPIC ticket state/phase: integrate/gate:goal/report exist but no package is accepted yet -> IN_PROGRESS/impl, not IN_REVIEW/qualitygate', () => {
  const t = expandedTask([
    dispatchNode('P1', { state: 'done', result: {} }), acceptNode('P1'),
    dispatchNode('P2', { state: 'running', child: { driver: { pid: 1 } } }),
  ]);
  assert.equal(epicTicketState(t), 'IN_PROGRESS');
  assert.equal(epicPhase(t), 'impl');
});

test('EPIC ticket state/phase: same shape, every package accepted -> IN_REVIEW/qualitygate', () => {
  const t = expandedTask([
    dispatchNode('P1', { state: 'done', result: {} }), acceptNode('P1', { state: 'done', result: { accept: true, match_pct: 90 } }),
    dispatchNode('P2', { state: 'done', result: {} }), acceptNode('P2', { state: 'done', result: { accept: false } }),
  ]);
  assert.equal(epicTicketState(t), 'IN_REVIEW');
  assert.equal(epicPhase(t), 'qualitygate');
});

test('EPIC ticket state adds BLOCKED beyond §4\'s table: runState says blocked (retry budget spent), never shown as READY/IN_PROGRESS', () => {
  const t = baseTask([
    node('size', 'size', [], { state: 'done', result: { size: 'L' } }),
    node('shape', 'shape', ['size'], { state: 'failed', result: { stage_ok: false } }),
    node('critique', 'critique', ['shape'], { state: 'skipped' }),
  ]);
  assert.equal(epicTicketState(t), 'BLOCKED');
});

// ---------- §4/§6 EPIC mapping for a size-S task (task.s_run, no task.spec) ----------
//
// Defect 1: epicTicketState()/epicPhase() gated on task.spec alone, which a size-S task never
// sets (delegateIfSmall skips shape/critique outright - see taskmanager.mjs). Live repro
// through tm_open+tm_board on a size-S task, driven to a real report through the taskmanager
// and broker MCP servers: a COMPLETED S run's task.nodes is frozen at
// [size:done, shape:skipped, critique:skipped] forever, so runState(task) reads 'blocked' (no
// node ready, none running) - epicTicketState returned BLOCKED and epicPhase returned 'setgoal'
// on a run that had actually finished and reported. Fixed by reading task.s_run's own child run
// (tickets.mjs's loadSRun/sRunTicketState/sRunPhase) instead of the manager's frozen 3 nodes.

test('EPIC ticket state/phase for a size-S task: before the child run has a spec (still in plan/setgoal/critique) -> READY, plan or setgoal by whether critique has started', () => {
  let s = sRunTask([
    node('plan', 'plan', []),
    node('setgoal', 'setgoal', ['plan']),
    node('critique', 'critique', ['setgoal']),
  ], null, FAKE_MANAGER_SAYS_DONE);
  try {
    assert.equal(epicTicketState(s.task), 'READY');
    assert.equal(epicPhase(s.task), 'plan');
  } finally { rmSync(s.cwd, { recursive: true, force: true }); }

  s = sRunTask([
    node('plan', 'plan', [], { state: 'done', result: {} }),
    node('setgoal', 'setgoal', ['plan'], { state: 'done', result: {} }),
    node('critique', 'critique', ['setgoal'], { state: 'running' }),
  ], null, FAKE_MANAGER_SAYS_BLOCKED);
  try {
    assert.equal(epicTicketState(s.task), 'READY');
    assert.equal(epicPhase(s.task), 'setgoal');
  } finally { rmSync(s.cwd, { recursive: true, force: true }); }
});

test('EPIC ticket state/phase for a size-S task: spec set, subgoal chain running, goal gate not reached -> IN_PROGRESS/impl', () => {
  const s = sRunTask(
    [
      node('plan', 'plan', [], { state: 'done', result: {} }),
      node('setgoal', 'setgoal', ['plan'], { state: 'done', result: {} }),
      node('critique', 'critique', ['setgoal'], { state: 'done', result: {} }),
      node('implement:U1:1', 'implement', ['critique'], { subgoal_id: 'U1', state: 'running' }),
    ],
    { spec: { subgoals: [{ id: 'U1' }] } },
    FAKE_MANAGER_SAYS_DONE,
  );
  try {
    assert.equal(epicTicketState(s.task), 'IN_PROGRESS');
    assert.equal(epicPhase(s.task), 'impl');
  } finally { rmSync(s.cwd, { recursive: true, force: true }); }
});

test('EPIC ticket state/phase for a size-S task: every subgoal gate done and the goal-level gate reached (ready, still pending) -> IN_REVIEW/qualitygate', () => {
  const s = sRunTask(
    [
      node('plan', 'plan', [], { state: 'done', result: {} }),
      node('setgoal', 'setgoal', ['plan'], { state: 'done', result: {} }),
      node('critique', 'critique', ['setgoal'], { state: 'done', result: {} }),
      node('implement:U1:1', 'implement', ['critique'], { subgoal_id: 'U1', state: 'done', result: {} }),
      node('test:U1:1', 'test', ['implement:U1:1'], { subgoal_id: 'U1', state: 'done', result: {} }),
      node('gate:U1:1', 'gate', ['test:U1:1'], { subgoal_id: 'U1', state: 'done', result: { accept: true } }),
      node('gate:goal:1', 'gate', ['gate:U1:1'], { subgoal_id: null }),
    ],
    { spec: { subgoals: [{ id: 'U1' }] } },
    FAKE_MANAGER_SAYS_BLOCKED,
  );
  try {
    assert.equal(epicTicketState(s.task), 'IN_REVIEW');
    assert.equal(epicPhase(s.task), 'qualitygate');
  } finally { rmSync(s.cwd, { recursive: true, force: true }); }
});

test('EPIC ticket state/phase for a size-S task: report done -> DONE/null (the live tm_board repro this defect was found through)', () => {
  const s = sRunTask(
    [node('report', 'report', [], { state: 'done', result: {} })],
    { spec: { subgoals: [{ id: 'U1' }] } },
    FAKE_MANAGER_SAYS_READY,
  );
  try {
    assert.equal(epicTicketState(s.task), 'DONE');
    assert.equal(epicPhase(s.task), null);
  } finally { rmSync(s.cwd, { recursive: true, force: true }); }
});

test('EPIC ticket state for a size-S task: runState blocked (nothing ready, nothing running) -> BLOCKED, checked before spec so a stuck run is never shown READY', () => {
  const s = sRunTask([
    node('plan', 'plan', [], { state: 'failed', result: { stage_ok: false } }),
    node('setgoal', 'setgoal', ['plan'], { state: 'skipped' }),
    node('critique', 'critique', ['setgoal'], { state: 'skipped' }),
  ], null, FAKE_MANAGER_SAYS_READY);
  try {
    assert.equal(epicTicketState(s.task), 'BLOCKED');
  } finally { rmSync(s.cwd, { recursive: true, force: true }); }
});

test('EPIC ticket state/phase for a size-S task whose child run file cannot be read (race right after openSRun) -> BLOCKED/plan, never a crash', () => {
  const task = { run_id: TASK_ID, cwd: '/proj', nodes: FAKE_MANAGER_SAYS_READY, s_run: { cwd: '/definitely/does/not/exist', run_id: 'missing' } };
  assert.equal(epicTicketState(task), 'BLOCKED');
  assert.equal(epicPhase(task), 'plan');
});

// ---------- §4 TASK mapping (child-run subgoal, generic over kind) ----------

// A child run's subgoal chain - implement/test/gate, draft/revise/gate, draft/review/gate,
// cases/execute/gate - exactly as expandSubgoals (graph.mjs) leaves it: ONE pushChain call
// creates every stage together, all starting 'pending', well before the author stage even
// runs. This file used to build these fixtures one hand-picked node at a time, leaving the
// later stages out entirely - describing a shape the real engine never produces. That is
// exactly how the taskTicketState bug (existence of the gate/mid node, not its actual
// progress, driving IN_REVIEW) went uncaught: a fixture with only an `implement` node can
// never exercise the branch a real, co-created gate node short-circuits into.
function childRun(kind, subgoalId, headDeps = []) {
  const run = { cwd: '/pkg', run_id: 'child-1', spec: { subgoals: [{ id: subgoalId, kind }] }, nodes: [] };
  pushChain(run, KINDS[kind].chain, subgoalId, 1, headDeps, [], {});
  return run;
}
function stageNode(run, subgoalId, stage) {
  return run.nodes.find((n) => n.subgoal_id === subgoalId && n.stage === stage);
}
// Drives a stage to 'done' the way the engine would (a result object present), optionally
// overridden - e.g. a gate's own verdict.
function finish(run, subgoalId, stage, patch) {
  Object.assign(stageNode(run, subgoalId, stage), { state: 'done', result: {} }, patch);
}

test('TASK ticket state: a freshly-expanded chain (author/mid/gate ALL pending at once, exactly what expandSubgoals leaves) reads BACKLOG/READY off the author stage, never IN_REVIEW off the gate merely existing', () => {
  // This is the bug's core regression: before the fix, the gate node's mere presence -
  // true from the instant the chain above is created - made this read IN_REVIEW regardless
  // of author/mid ever having run.
  assert.equal(taskTicketState(childRun('subgoal', 'U1', ['implement:U0:1']), 'U1'), 'BACKLOG');
  assert.equal(taskTicketState(childRun('subgoal', 'U1'), 'U1'), 'READY');
});

test('TASK ticket state: author stage - running, skipped, unreachable, failed-but-not-yet-settled', () => {
  const running = childRun('subgoal', 'U1');
  stageNode(running, 'U1', 'implement').state = 'running';
  assert.equal(taskTicketState(running, 'U1'), 'IN_PROGRESS');

  const skipped = childRun('subgoal', 'U1');
  stageNode(skipped, 'U1', 'implement').state = 'skipped';
  assert.equal(taskTicketState(skipped, 'U1'), 'CANCELLED');

  const unreachable = childRun('subgoal', 'U1');
  stageNode(unreachable, 'U1', 'implement').state = 'unreachable';
  assert.equal(taskTicketState(unreachable, 'U1'), 'UNREACHABLE');

  const failed = childRun('subgoal', 'U1');
  Object.assign(stageNode(failed, 'U1', 'implement'), { state: 'failed', result: { stage_ok: false } });
  assert.equal(taskTicketState(failed, 'U1'), 'IN_PROGRESS'); // not yet retried or settled - still "moving"
});

// pushChain always creates the whole chain together - a subgoal with genuinely no nodes at
// all cannot happen via the engine (unlike storyTicketState's analogous defensive case,
// which guards a package that predates expandPackages ever running). Kept anyway, and
// labeled synthetic, because taskTicketState is called generically and must not throw.
test('TASK ticket state: no nodes at all for the subgoal reads BACKLOG (defensive; not reachable via expandSubgoals today)', () => {
  const empty = { cwd: '/pkg', run_id: 'child-1', spec: { subgoals: [{ id: 'U1', kind: 'subgoal' }] }, nodes: [] };
  assert.equal(taskTicketState(empty, 'U1'), 'BACKLOG');
});

test('TASK ticket state: mid stage (test/revise/execute) reads IN_REVIEW once the author has handed off - running, pending-but-ready, skipped, unreachable', () => {
  const running = childRun('subgoal', 'U1');
  finish(running, 'U1', 'implement');
  stageNode(running, 'U1', 'test').state = 'running';
  assert.equal(taskTicketState(running, 'U1'), 'IN_REVIEW');

  const readyNotStarted = childRun('subgoal', 'U1');
  finish(readyNotStarted, 'U1', 'implement');
  assert.equal(taskTicketState(readyNotStarted, 'U1'), 'IN_REVIEW'); // test is pending, but its own dep (implement) is met

  const skipped = childRun('subgoal', 'U1');
  finish(skipped, 'U1', 'implement');
  stageNode(skipped, 'U1', 'test').state = 'skipped';
  assert.equal(taskTicketState(skipped, 'U1'), 'CANCELLED');

  const unreachable = childRun('subgoal', 'U1');
  finish(unreachable, 'U1', 'implement');
  stageNode(unreachable, 'U1', 'test').state = 'unreachable';
  assert.equal(taskTicketState(unreachable, 'U1'), 'UNREACHABLE');
});

test('TASK ticket state: gate stage - pending-but-ready/running -> IN_REVIEW, done -> DONE, failed -> REJECTED, skipped -> CANCELLED, unreachable -> UNREACHABLE, once mid has handed off', () => {
  const readyNotJudged = childRun('subgoal', 'U1');
  finish(readyNotJudged, 'U1', 'implement');
  finish(readyNotJudged, 'U1', 'test');
  assert.equal(taskTicketState(readyNotJudged, 'U1'), 'IN_REVIEW');

  const judging = childRun('subgoal', 'U1');
  finish(judging, 'U1', 'implement');
  finish(judging, 'U1', 'test');
  stageNode(judging, 'U1', 'gate').state = 'running';
  assert.equal(taskTicketState(judging, 'U1'), 'IN_REVIEW');

  const done = childRun('subgoal', 'U1');
  finish(done, 'U1', 'implement');
  finish(done, 'U1', 'test');
  finish(done, 'U1', 'gate', { result: { accept: true } });
  assert.equal(taskTicketState(done, 'U1'), 'DONE');

  const rejected = childRun('subgoal', 'U1');
  finish(rejected, 'U1', 'implement');
  finish(rejected, 'U1', 'test');
  Object.assign(stageNode(rejected, 'U1', 'gate'), { state: 'failed', result: { stage_ok: false } });
  assert.equal(taskTicketState(rejected, 'U1'), 'REJECTED');

  const cancelled = childRun('subgoal', 'U1');
  finish(cancelled, 'U1', 'implement');
  finish(cancelled, 'U1', 'test');
  stageNode(cancelled, 'U1', 'gate').state = 'skipped';
  assert.equal(taskTicketState(cancelled, 'U1'), 'CANCELLED');

  const unreachable = childRun('subgoal', 'U1');
  finish(unreachable, 'U1', 'implement');
  finish(unreachable, 'U1', 'test');
  stageNode(unreachable, 'U1', 'gate').state = 'unreachable';
  assert.equal(taskTicketState(unreachable, 'U1'), 'UNREACHABLE');
});

test('a four-stage chain does not read its gate slot off the wrong stage: revise done, gate still pending, is IN_REVIEW not DONE', () => {
  // The bug this guards: taskTicketState destructured the chain as a fixed [author, mid, gate]
  // triple, so planning's four-stage chain put `revise` in the gate slot - a finished revise
  // reported the TASK DONE and a failed gate could never be REJECTED.
  const midway = childRun('planning', 'U1');
  finish(midway, 'U1', 'investigate');
  finish(midway, 'U1', 'draft');
  finish(midway, 'U1', 'revise');
  assert.equal(stageNode(midway, 'U1', 'gate').state, 'pending');
  assert.equal(taskTicketState(midway, 'U1'), 'IN_REVIEW');

  // And the stage before the author is still authoring, not reviewing: investigate running is
  // IN_PROGRESS, and a draft merely waiting its turn behind a finished investigate is too.
  const researching = childRun('planning', 'U1');
  stageNode(researching, 'U1', 'investigate').state = 'running';
  assert.equal(taskTicketState(researching, 'U1'), 'IN_PROGRESS');

  const drafting = childRun('planning', 'U1');
  finish(drafting, 'U1', 'investigate');
  assert.equal(taskTicketState(drafting, 'U1'), 'IN_PROGRESS');
});

test('TASK ticket state generalizes to the planning kind (investigate/draft/revise/gate) with no special-casing', () => {
  const running = childRun('planning', 'U1');
  stageNode(running, 'U1', 'investigate').state = 'running';
  assert.equal(taskTicketState(running, 'U1'), 'IN_PROGRESS');

  const inReview = childRun('planning', 'U1');
  finish(inReview, 'U1', 'investigate');
  finish(inReview, 'U1', 'draft');
  stageNode(inReview, 'U1', 'revise').state = 'running';
  assert.equal(taskTicketState(inReview, 'U1'), 'IN_REVIEW');

  const rejected = childRun('planning', 'U1');
  finish(rejected, 'U1', 'investigate');
  finish(rejected, 'U1', 'draft');
  finish(rejected, 'U1', 'revise');
  Object.assign(stageNode(rejected, 'U1', 'gate'), { state: 'failed', result: { stage_ok: false } });
  assert.equal(taskTicketState(rejected, 'U1'), 'REJECTED');
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

test('storyTaskProgress is null before the child run exists, and null if the child has no spec yet', () => {
  assert.equal(storyTaskProgress(baseTask([dispatchNode('P1')]), 'P1'), null);
  assert.equal(storyTaskProgress(baseTask([dispatchNode('P1', { state: 'running', child: { cwd: '/nope', run_id: 'missing' } })]), 'P1'), null);
});

test('epicBoardRows renders one row per develop package with role "develop" when no planning/qa phase-Team exists', () => {
  const t = baseTask(
    [dispatchNode('P1', { state: 'done', result: {} }), acceptNode('P1', { state: 'done', result: { accept: true, match_pct: 91 } })],
    { spec: { packages: [{ id: 'P1', title: 'module a' }] } },
  );
  const rows = epicBoardRows(t);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
    key: 'E-aaaaaaaa/P1', id: 'P1', title: 'module a', role: 'develop', state: 'DONE', tasks: null,
    last_verdict: 'accept 91', reporter: 'shape',
    links: { blocked_by: [], blocks: [], implements: [], filed_by: null },
  });
});

// v0.12.1 Task 1: fileDefects (taskmanager.mjs) sets p.reporter on a filed defect STORY instead
// of p.repair - epicBoardRows must expose it (and keep falling back to 'repair'/'shape' for
// packages fileDefects never touched, the byte-for-byte compat case).
test('epicBoardRows exposes p.reporter for a filed defect STORY (\'qa\'/\'you\'), and still falls back to \'repair\'/\'shape\' otherwise', () => {
  const t = baseTask(
    [
      dispatchNode('P1', { state: 'done', result: {} }), acceptNode('P1', { state: 'done', result: { accept: true, match_pct: 91 } }),
      dispatchNode('R1', { state: 'done', result: {} }), acceptNode('R1', { state: 'done', result: { accept: true, match_pct: 90 } }),
      dispatchNode('D1', { state: 'done', result: {} }), acceptNode('D1', { state: 'done', result: { accept: true, match_pct: 92 } }),
      dispatchNode('D2', { state: 'done', result: {} }), acceptNode('D2', { state: 'done', result: { accept: true, match_pct: 88 } }),
    ],
    {
      spec: { packages: [
        { id: 'P1', title: 'module a' },
        { id: 'R1', title: 'repair: integration 1', repair: true },
        { id: 'D1', title: 'checkout crashes', reporter: 'qa' },
        { id: 'D2', title: 'add a missing edge case', reporter: 'you' },
      ] },
    },
  );
  const rows = epicBoardRows(t);
  assert.deepEqual(rows.map((r) => [r.id, r.reporter]), [['P1', 'shape'], ['R1', 'repair'], ['D1', 'qa'], ['D2', 'you']]);
});

// v0.12.0 wires planning/qa into the EPIC flow as phase-Teams: role becomes p.phase || 'develop',
// and epicBoardRows now also renders a row for task.planning_pkg (first, ahead of shape) and
// task.qa_pkg (last, after every develop package) when those fields are present.
test('epicBoardRows puts the planning phase-Team row first and the qa phase-Team row last, with role set from p.phase', () => {
  const t = baseTask(
    [
      dispatchNode('PLAN', { state: 'done', result: {} }), acceptNode('PLAN', { state: 'done', result: { accept: true, match_pct: 95 } }),
      dispatchNode('P1', { state: 'done', result: {} }), acceptNode('P1', { state: 'done', result: { accept: true, match_pct: 91 } }),
      dispatchNode('QA', { state: 'done', result: {} }), acceptNode('QA', { state: 'done', result: { accept: true, match_pct: 93 } }),
    ],
    {
      spec: { packages: [{ id: 'P1', title: 'module a' }] },
      planning_pkg: { id: 'PLAN', phase: 'planning', title: 'PRD' },
      qa_pkg: { id: 'QA', phase: 'qa', title: 'QA' },
    },
  );
  const rows = epicBoardRows(t);
  assert.deepEqual(rows.map((r) => [r.id, r.role]), [['PLAN', 'planning'], ['P1', 'develop'], ['QA', 'qa']]);
  assert.deepEqual(rows[1], {
    key: 'E-aaaaaaaa/P1', id: 'P1', title: 'module a', role: 'develop', state: 'DONE', tasks: null,
    last_verdict: 'accept 91', reporter: 'shape',
    links: { blocked_by: [], blocks: [], implements: [], filed_by: null },
  });
});

// v0.12.1 Task 2 adds a third phase-Team, the audit - planning's own second pass, opened after
// integration (and after QA when it is on). It sits last of all: the audit is the final judgement
// before the goal gate, and a STORY it files is an ordinary develop row in the middle.
test('epicBoardRows renders the audit phase-Team last, with role "audit", and every phase-Team package reports "engine" (never "shape", never its own phase name)', () => {
  const t = baseTask(
    [
      dispatchNode('PLAN', { state: 'done', result: {} }), acceptNode('PLAN', { state: 'done', result: { accept: true, match_pct: 95 } }),
      dispatchNode('P1', { state: 'done', result: {} }), acceptNode('P1', { state: 'done', result: { accept: true, match_pct: 91 } }),
      dispatchNode('QA', { state: 'done', result: {} }), acceptNode('QA', { state: 'done', result: { accept: true, match_pct: 93 } }),
      dispatchNode('AUDIT', { state: 'done', result: {} }), acceptNode('AUDIT', { state: 'done', result: { accept: true, match_pct: 90 } }),
    ],
    {
      spec: { packages: [{ id: 'P1', title: 'module a' }, { id: 'D1', title: 'US-2 never wired', reporter: 'planning-audit' }] },
      planning_pkg: { id: 'PLAN', phase: 'planning', title: 'PRD' },
      qa_pkg: { id: 'QA', phase: 'qa', title: 'QA' },
      audit_pkg: { id: 'AUDIT', phase: 'audit', title: 'planning audit' },
    },
  );
  const rows = epicBoardRows(t);
  assert.deepEqual(rows.map((r) => [r.id, r.role]), [['PLAN', 'planning'], ['P1', 'develop'], ['D1', 'develop'], ['QA', 'qa'], ['AUDIT', 'audit']]);
  // 'engine' for every phase-Team row - never its own phase name (that would still collide with
  // a QA-filed defect's reporter 'qa'; see the reporter-collision test below), never 'shape'
  // (that row never ran through shape at all). D1's own reporter ('planning-audit') is unaffected
  // - it is a develop STORY the audit filed, not a phase-Team row.
  assert.deepEqual(rows.map((r) => [r.id, r.reporter]), [['PLAN', 'engine'], ['P1', 'shape'], ['D1', 'planning-audit'], ['QA', 'engine'], ['AUDIT', 'engine']]);
});

// Since d24b9bb, epicBoardRows gave the QA phase-Team's own row (role: qa) and a develop STORY
// QA filed (role: develop) the identical reporter string 'qa' - a person reading `reporter`
// alone (as tm_ticket's own STORY card invites, see toolTicket/tm_ticket) could not tell "the QA
// run itself" from "a defect QA found" apart. Fixed above by reporting 'engine' for every
// phase-Team row regardless of which phase; pinned here so the two rows are provably distinct.
test('a phase-Team row and a filed defect STORY never share a reporter token, even when the phase is "qa"', () => {
  const t = baseTask(
    [
      dispatchNode('QA', { state: 'done', result: {} }), acceptNode('QA', { state: 'done', result: { accept: true, match_pct: 93 } }),
      dispatchNode('D1', { state: 'done', result: {} }), acceptNode('D1', { state: 'done', result: { accept: true, match_pct: 92 } }),
    ],
    {
      spec: { packages: [{ id: 'D1', title: 'checkout crashes', reporter: 'qa' }] },
      qa_pkg: { id: 'QA', phase: 'qa', title: 'QA' },
    },
  );
  const rows = epicBoardRows(t);
  const qaRow = rows.find((r) => r.id === 'QA');
  const d1Row = rows.find((r) => r.id === 'D1');
  assert.equal(qaRow.role, 'qa');
  assert.equal(d1Row.role, 'develop');
  assert.equal(d1Row.reporter, 'qa', 'a QA-filed defect STORY still reports \'qa\' - FILED_REPORTERS is load-bearing elsewhere (view-collect.mjs, docs, tests)');
  assert.notEqual(qaRow.reporter, d1Row.reporter, 'the QA phase-Team row must not share reporter \'qa\' with a STORY QA filed');
  assert.equal(qaRow.reporter, 'engine');
});

// ---------- storyLinks: blocked by / blocks / implements / filed by ----------

// "blocked by" reads a package's own p.deps (shape's own field), each resolved to that
// sibling's CURRENT storyTicketState - not merely that a dep was declared. "blocks" is the
// inverse, computed by scanning every OTHER package for a dep naming this one - never stored.
test('storyLinks: blocked_by/blocks resolve to the sibling\'s own current storyTicketState, and blocks is the computed inverse of blocked_by', () => {
  const t = baseTask(
    [
      dispatchNode('P1', { state: 'done', result: {} }), acceptNode('P1', { state: 'done', result: { accept: true, match_pct: 91 } }),
      dispatchNode('P2', { deps: ['accept:P1:1'] }),
    ],
    { spec: { packages: [{ id: 'P1', title: 'module a' }, { id: 'P2', title: 'module b', deps: ['P1'] }] } },
  );
  assert.deepEqual(storyLinks(t, 'P1'), {
    blocked_by: [],
    blocks: [{ key: 'E-aaaaaaaa/P2', id: 'P2', state: 'READY' }],
    implements: [],
    filed_by: null,
  });
  assert.deepEqual(storyLinks(t, 'P2'), {
    blocked_by: [{ key: 'E-aaaaaaaa/P1', id: 'P1', state: 'DONE' }],
    blocks: [],
    implements: [],
    filed_by: null,
  });
});

// A dep that has NOT cleared yet must still show up in blocked_by/blocks - the whole point of
// naming the relation is showing what a BACKLOG STORY is waiting on, not only a cleared one.
test('storyLinks: an unmet dep still appears in blocked_by/blocks, with the sibling\'s own (not-yet-DONE) state', () => {
  const t = baseTask(
    [dispatchNode('P1', { state: 'running' }), dispatchNode('P2', { deps: ['accept:P1:1'] })],
    { spec: { packages: [{ id: 'P1', title: 'module a' }, { id: 'P2', title: 'module b', deps: ['P1'] }] } },
  );
  assert.deepEqual(storyLinks(t, 'P2').blocked_by, [{ key: 'E-aaaaaaaa/P1', id: 'P1', state: 'IN_PROGRESS' }]);
  assert.deepEqual(storyLinks(t, 'P1').blocks, [{ key: 'E-aaaaaaaa/P2', id: 'P2', state: 'BACKLOG' }]);
});

test('storyLinks: implements is p.implements verbatim (planning\'s PRD user-story ids), [] when shape declared none', () => {
  const t = baseTask(
    [dispatchNode('P1', { state: 'done', result: {} }), acceptNode('P1', { state: 'done', result: { accept: true, match_pct: 91 } })],
    { spec: { packages: [{ id: 'P1', title: 'module a', implements: ['US-1', 'US-2'] }] } },
  );
  assert.deepEqual(storyLinks(t, 'P1').implements, ['US-1', 'US-2']);
  const t2 = baseTask(
    [dispatchNode('P1', { state: 'done', result: {} }), acceptNode('P1', { state: 'done', result: { accept: true, match_pct: 91 } })],
    { spec: { packages: [{ id: 'P1', title: 'module a' }] } },
  );
  assert.deepEqual(storyLinks(t2, 'P1').implements, []);
});

test('storyLinks: filed_by is p.reporter (\'qa\'/\'you\'/\'planning-audit\'), null for a package shape declared itself', () => {
  const t = baseTask(
    [
      dispatchNode('P1', { state: 'done', result: {} }), acceptNode('P1', { state: 'done', result: { accept: true, match_pct: 91 } }),
      dispatchNode('D1', { state: 'done', result: {} }), acceptNode('D1', { state: 'done', result: { accept: true, match_pct: 92 } }),
    ],
    { spec: { packages: [{ id: 'P1', title: 'module a' }, { id: 'D1', title: 'checkout crashes', reporter: 'qa' }] } },
  );
  assert.equal(storyLinks(t, 'P1').filed_by, null);
  assert.equal(storyLinks(t, 'D1').filed_by, 'qa');
});

// epicBoardRows must expose storyLinks as `links` on every row it renders - one source of truth
// both tm_board and view.mjs read, not two computations that could drift apart.
test('epicBoardRows exposes storyLinks() as `links` on every row, matching storyLinks() called directly', () => {
  const t = baseTask(
    [
      dispatchNode('P1', { state: 'done', result: {} }), acceptNode('P1', { state: 'done', result: { accept: true, match_pct: 91 } }),
      dispatchNode('P2', { deps: ['accept:P1:1'] }),
    ],
    { spec: { packages: [{ id: 'P1', title: 'module a' }, { id: 'P2', title: 'module b', deps: ['P1'], implements: ['US-1'] }] } },
  );
  const rows = epicBoardRows(t);
  assert.deepEqual(rows.find((r) => r.id === 'P1').links, storyLinks(t, 'P1'));
  assert.deepEqual(rows.find((r) => r.id === 'P2').links, storyLinks(t, 'P2'));
  assert.deepEqual(rows.find((r) => r.id === 'P2').links, {
    blocked_by: [{ key: 'E-aaaaaaaa/P1', id: 'P1', state: 'DONE' }], blocks: [], implements: ['US-1'], filed_by: null,
  });
});

test('ticketSnapshot maps every known key (EPIC + each STORY) to its current state - the input a board.jsonl diff is taken over', () => {
  const t = baseTask(
    [dispatchNode('P1', { state: 'running', child: { driver: { pid: 1 } } })],
    { spec: { packages: [{ id: 'P1' }] } },
  );
  assert.deepEqual(ticketSnapshot(t, { alive: () => true }), { 'E-aaaaaaaa': 'IN_PROGRESS', 'E-aaaaaaaa/P1': 'IN_PROGRESS' });
});

// taskmanager.mjs's appendBoardTransitions diffs two ticketSnapshot() calls and logs one
// board.jsonl line per key whose value changed - reproduced here (not imported: this module
// owns no filesystem writes) so the assertion is over the events a board.jsonl reader actually
// sees, not merely over ticketSnapshot's key set.
function boardEvents(before, after) {
  const events = [];
  for (const [key, to] of Object.entries(after)) {
    const from = before[key] || null;
    if (from !== to) events.push({ key, from, to });
  }
  return events;
}

// v0.12.0 taught epicBoardRows to render task.planning_pkg/task.qa_pkg rows but left
// ticketSnapshot reading task.spec.packages alone, so a board.jsonl diff over a phase-Team
// package produced zero events - the board showed the row, but no transition was ever logged
// for it. Fixed by having both read the same boardPackages() list.
test('a board.jsonl diff over a planning/qa phase-Team package logs its transitions, not just develop packages', () => {
  const before = ticketSnapshot(baseTask(
    [dispatchNode('PLAN'), dispatchNode('QA', { deps: ['integrate:1'] })],
    { planning_pkg: { id: 'PLAN', phase: 'planning' }, qa_pkg: { id: 'QA', phase: 'qa' } },
  ));
  const after = ticketSnapshot(baseTask(
    [dispatchNode('PLAN', { state: 'running', child: { driver: { pid: 1 } } }), dispatchNode('QA', { deps: ['integrate:1'] })],
    { planning_pkg: { id: 'PLAN', phase: 'planning' }, qa_pkg: { id: 'QA', phase: 'qa' } },
  ), { alive: () => true });
  assert.equal(after['E-aaaaaaaa/QA'], 'BACKLOG'); // tracked (unmet dep on integrate:1), just unchanged - not merely absent
  const events = boardEvents(before, after);
  assert.deepEqual(events, [{ key: 'E-aaaaaaaa/PLAN', from: 'READY', to: 'IN_PROGRESS' }]);
});
