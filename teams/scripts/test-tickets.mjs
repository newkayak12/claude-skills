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

test('TASK ticket state: author skipped/unreachable and no author node at all (BACKLOG/READY boundary too)', () => {
  assert.equal(taskTicketState(childRun('subgoal', [node('implement:U1:1', 'implement', [], { subgoal_id: 'U1', state: 'skipped' })]), 'U1'), 'CANCELLED');
  assert.equal(taskTicketState(childRun('subgoal', [node('implement:U1:1', 'implement', [], { subgoal_id: 'U1', state: 'unreachable' })]), 'U1'), 'UNREACHABLE');
  assert.equal(taskTicketState(childRun('subgoal', []), 'U1'), 'BACKLOG');
  assert.equal(taskTicketState(childRun('subgoal', [node('implement:U1:1', 'implement', ['implement:U0:1'], { subgoal_id: 'U1' })]), 'U1'), 'BACKLOG');
  assert.equal(taskTicketState(childRun('subgoal', [node('implement:U1:1', 'implement', [], { subgoal_id: 'U1' })]), 'U1'), 'READY');
});

test('TASK ticket state: gate skipped/unreachable read CANCELLED/UNREACHABLE too, not just author', () => {
  assert.equal(taskTicketState(childRun('subgoal', [
    node('implement:U1:1', 'implement', [], { subgoal_id: 'U1', state: 'done', result: {} }),
    node('test:U1:1', 'test', ['implement:U1:1'], { subgoal_id: 'U1', state: 'done', result: {} }),
    node('gate:U1:1', 'gate', ['test:U1:1'], { subgoal_id: 'U1', state: 'skipped' }),
  ]), 'U1'), 'CANCELLED');
  assert.equal(taskTicketState(childRun('subgoal', [
    node('implement:U1:1', 'implement', [], { subgoal_id: 'U1', state: 'done', result: {} }),
    node('test:U1:1', 'test', ['implement:U1:1'], { subgoal_id: 'U1', state: 'done', result: {} }),
    node('gate:U1:1', 'gate', ['test:U1:1'], { subgoal_id: 'U1', state: 'unreachable' }),
  ]), 'U1'), 'UNREACHABLE');
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
