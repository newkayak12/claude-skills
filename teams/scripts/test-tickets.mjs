// teams/scripts/test-tickets.mjs - table test over the design doc's §4 mapping (engine
// state -> ticket state), plus the derived states §4 only sketches (CANCELLED/UNREACHABLE at
// every level, BLOCKED at EPIC level - see the plan's 발견 3/4). Every fixture is a plain object
// shaped exactly like a real task.json/child run.json - no server, no filesystem.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { node, pushChain, KINDS } from '../mcp/graph.mjs';
import {
  epicKey, storyKey, docPaths, latestBySubgoal, storyTicketState, epicTicketState,
  taskTicketState, epicPhase, storyTaskProgress, epicBoardRows, ticketSnapshot,
} from '../mcp/tickets.mjs';

const TASK_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

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

test('TASK ticket state generalizes to the planning kind (draft/revise/gate) with no special-casing', () => {
  const running = childRun('planning', 'U1');
  stageNode(running, 'U1', 'draft').state = 'running';
  assert.equal(taskTicketState(running, 'U1'), 'IN_PROGRESS');

  const inReview = childRun('planning', 'U1');
  finish(inReview, 'U1', 'draft');
  stageNode(inReview, 'U1', 'revise').state = 'running';
  assert.equal(taskTicketState(inReview, 'U1'), 'IN_REVIEW');

  const rejected = childRun('planning', 'U1');
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
