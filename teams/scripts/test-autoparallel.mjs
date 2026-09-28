#!/usr/bin/env node
// Regression suite for max_parallel_teams: 'auto' - the AIMD controller that replaced the
// hardcoded PROVISIONAL_MAX_PARALLEL_TEAMS default (teamconfig.mjs, taskmanager.mjs's
// ensureAutoParallel/updateAutoParallel). Exercised as a pure library, the same way
// test-diagram.mjs/test-routing.mjs unit-test one function out of a larger MCP server: no
// worktree, no driver process, no MCP transport - just task-shaped plain objects and the exported
// functions themselves.
//
//   node --test teams/scripts/test-autoparallel.mjs

// updateAutoParallel calls record(task, ...), which appends to
// ~/.harness/tasks/<run_id>/ledger.jsonl unless this is set - the same reason
// test-taskmanager.mjs sets TEAMS_RUNS_DIR before importing anything.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir, availableParallelism } from 'node:os';
import { join } from 'node:path';

const SCRATCH = mkdtempSync(join(tmpdir(), 'autoparallel-'));
process.env.HARNESS_TASKS_DIR = SCRATCH;

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ensureAutoParallel, updateAutoParallel } from '../mcp/taskmanager.mjs';

test.after(() => rmSync(SCRATCH, { recursive: true, force: true }));

let seq = 0;
// A minimal dispatch-shaped task: one develop STORY package (P1, no `phase`, so it is an
// ordinary STORY - not exempt), 'auto' unless overridden. Each call gets a fresh run_id so the
// ledger writes from different tests never collide on the same file.
function makeTask(teamOpts = {}, packages = [{ id: 'P1' }]) {
  seq += 1;
  return {
    run_id: `test-autoparallel-${seq}`,
    team: { opts: { max_parallel_teams: 'auto', ...teamOpts } },
    spec: { packages },
    nodes: [],
  };
}

function dispatchNode(nodeId, subgoalId, child = null) {
  return { node_id: nodeId, stage: 'dispatch', subgoal_id: subgoalId, child };
}

function driverWithLog(text) {
  const log = join(SCRATCH, `${Math.random().toString(36).slice(2)}.stream.jsonl`);
  writeFileSync(log, text);
  return { pid: 1, log };
}

// ---------- ensureAutoParallel: bootstrap and the ceiling formula ----------

test('ensureAutoParallel starts at 2, no streak, ceiling from max_parallel_ceiling when pinned', () => {
  const task = makeTask({ max_parallel_ceiling: 5 });
  const state = ensureAutoParallel(task);
  assert.equal(state.current, 2);
  assert.equal(state.streak, 0);
  assert.equal(state.ceiling, 5);
  assert.equal(task.auto_parallel, state, 'the state is stored on task.auto_parallel, not recomputed each call');
});

test('ensureAutoParallel is idempotent: a second call returns the SAME object, not a fresh bootstrap', () => {
  const task = makeTask();
  const first = ensureAutoParallel(task);
  first.current = 4; // simulate a prior adjustment already persisted on task.json
  const second = ensureAutoParallel(task);
  assert.equal(second, first);
  assert.equal(second.current, 4, 'a second call must not reset an already-initialized state back to AIMD_START');
});

test('ensureAutoParallel derives an unset ceiling from the host: min(cores/2, 6), floor 2 (AIMD_START)', () => {
  const task = makeTask(); // max_parallel_ceiling left at its default (null)
  const state = ensureAutoParallel(task);
  let cores = 4;
  try { cores = availableParallelism(); } catch { /* mirror the production fallback */ }
  const expected = Math.max(2, Math.min(Math.floor(cores / 2) || 1, 6));
  assert.equal(state.ceiling, expected);
});

// ---------- numeric override: back-compat, auto is fully bypassed ----------

test('numeric max_parallel_teams: updateAutoParallel is a no-op, task.auto_parallel is never created', () => {
  const task = makeTask({ max_parallel_teams: 3 });
  const n = dispatchNode('dispatch:P1:1', 'P1', { driver: driverWithLog('rate_limit_error: slow down') });
  updateAutoParallel(task, n, { stage_ok: true });
  assert.equal(task.auto_parallel, undefined, 'a fixed number must bypass the controller entirely, even with pushback text present');
});

// ---------- increase: additive, windowed, capped at the ceiling ----------

test('increase: current climbs by 1 after AIMD_WINDOW (2) consecutive clean develop-STORY folds', () => {
  const task = makeTask({ max_parallel_ceiling: 6 });
  ensureAutoParallel(task);
  updateAutoParallel(task, dispatchNode('dispatch:P1:1', 'P1'), { stage_ok: true });
  assert.equal(task.auto_parallel.current, 2, 'one clean fold alone is not a full window yet');
  assert.equal(task.auto_parallel.streak, 1);
  updateAutoParallel(task, dispatchNode('dispatch:P1:2', 'P1'), { stage_ok: true });
  assert.equal(task.auto_parallel.current, 3, 'a second clean fold completes the window: +1');
  assert.equal(task.auto_parallel.streak, 0, 'the streak resets once it has spent itself on an increase');
});

test('increase: a rejected-but-not-pushed-back dispatch (stage_ok:false, an ordinary gate rejection) still counts toward the clean streak', () => {
  // The design asks for "finished without a capacity signal" - not "finished successfully".
  // A ordinary accept:false is the package's own outcome, not the vendor pushing back, and must
  // not stall the probe-up the way a real capacity signal does.
  const task = makeTask({ max_parallel_ceiling: 6 });
  updateAutoParallel(task, dispatchNode('dispatch:P1:1', 'P1'), { stage_ok: false, reason: 'accept rejected: gaps remain' });
  updateAutoParallel(task, dispatchNode('dispatch:P1:2', 'P1'), { stage_ok: false, reason: 'accept rejected again' });
  assert.equal(task.auto_parallel.current, 3, 'a plain rejection is not a capacity signal - the window still completes');
});

test('increase: never exceeds the ceiling, even with many more clean windows than it takes to reach it', () => {
  const task = makeTask({ max_parallel_ceiling: 3 });
  for (let i = 0; i < 10; i++) updateAutoParallel(task, dispatchNode(`dispatch:P1:${i}`, 'P1'), { stage_ok: true });
  assert.equal(task.auto_parallel.current, 3, 'capped at the ceiling regardless of how many more clean folds arrive');
});

// ---------- decrease: multiplicative, immediate, on a pushback or driver-crash-cluster signal ----------

for (const [label, text] of [
  ['a bare 429', 'HTTP 429 Too Many Requests'],
  ['a bare 529', 'upstream error 529'],
  ['"overloaded" with no usage-limit wording', 'the model is currently overloaded_error, please retry'],
  ['rate_limit wording', 'rate_limit_error: please slow down'],
]) {
  test(`decrease on ${label}: halves current immediately, no window needed, and resets the streak`, () => {
    const task = makeTask({ max_parallel_ceiling: 6 });
    const state = ensureAutoParallel(task);
    state.current = 4;
    state.streak = 1; // mid-window when the pushback arrives
    const n = dispatchNode('dispatch:P1:3', 'P1', { driver: driverWithLog(`{"type":"result","result":"${text}"}`) });
    updateAutoParallel(task, n, { stage_ok: false });
    assert.equal(task.auto_parallel.current, 2, 'halved from 4');
    assert.equal(task.auto_parallel.streak, 0, 'a pushback resets whatever streak was building toward an increase');
  });
}

test('decrease: pushback text in stderr alone (no log, driver SIGKILLed before its stream closed) is still caught', () => {
  const task = makeTask({ max_parallel_ceiling: 6 });
  ensureAutoParallel(task).current = 4;
  const stderr = join(SCRATCH, 'p1.stderr');
  writeFileSync(stderr, 'fetch failed: 429 rate limited by the provider');
  const n = dispatchNode('dispatch:P1:4', 'P1', { driver: { pid: 1, stderr } });
  updateAutoParallel(task, n, { stage_ok: false });
  assert.equal(task.auto_parallel.current, 2);
});

test('floor: never drops below 1, even on repeated pushback', () => {
  const task = makeTask({ max_parallel_ceiling: 6 });
  ensureAutoParallel(task).current = 2;
  const pushback = () => dispatchNode('dispatch:P1:x', 'P1', { driver: driverWithLog('overloaded_error') });
  updateAutoParallel(task, pushback(), { stage_ok: false });
  assert.equal(task.auto_parallel.current, 1, '2 halves to 1');
  updateAutoParallel(task, pushback(), { stage_ok: false });
  assert.equal(task.auto_parallel.current, 1, 'floor(1/2)=0 is clamped back up to the floor, 1');
});

test('decrease: ordinary text (any rejection reason with no vendor pushback wording) never triggers a decrease', () => {
  const task = makeTask({ max_parallel_ceiling: 6 });
  ensureAutoParallel(task).current = 4;
  const n = dispatchNode('dispatch:P1:5', 'P1', { driver: driverWithLog('{"type":"result","result":"tests failed: 3 assertions did not pass"}') });
  updateAutoParallel(task, n, { stage_ok: false });
  assert.equal(task.auto_parallel.current, 4, 'a plain test failure is not a capacity signal - current is untouched');
});

// ---------- driver-crash clustering: the non-textual capacity signal ----------

test('decrease: two DIFFERENT packages\' driver restarts clustered within 5 minutes count as a capacity signal, even though neither alone spent its own restart budget', () => {
  const task = makeTask({ max_parallel_ceiling: 6 });
  ensureAutoParallel(task).current = 4;
  const now = Date.now();
  // Two other, already-running dispatch nodes, each with exactly one restart of their own - not
  // enough to spend either one's individual restart budget (restartBudget defaults to 2), but the
  // two restarts landed 90s apart, well inside CLUSTER_WINDOW_MS (5 minutes).
  task.nodes.push(dispatchNode('dispatch:P2:1', 'P2', { driver: { pid: 2, restarts: [{ at: now - 90000 }] } }));
  task.nodes.push(dispatchNode('dispatch:P3:1', 'P3', { driver: { pid: 3, restarts: [{ at: now }] } }));
  // The dispatch actually being folded has no pushback text of its own and no restarts at all.
  const n = dispatchNode('dispatch:P1:1', 'P1', { driver: { pid: 1 } });
  updateAutoParallel(task, n, { stage_ok: true });
  assert.equal(task.auto_parallel.current, 2, 'clustered crashes elsewhere in the task still halve the cap');
});

test('no decrease: two restarts far apart (outside the cluster window) read as unrelated, ordinary deaths', () => {
  const task = makeTask({ max_parallel_ceiling: 6 });
  ensureAutoParallel(task).current = 4;
  const now = Date.now();
  task.nodes.push(dispatchNode('dispatch:P2:1', 'P2', { driver: { pid: 2, restarts: [{ at: now - 20 * 60000 }] } }));
  task.nodes.push(dispatchNode('dispatch:P3:1', 'P3', { driver: { pid: 3, restarts: [{ at: now }] } }));
  const n = dispatchNode('dispatch:P1:1', 'P1', { driver: { pid: 1 } });
  updateAutoParallel(task, n, { stage_ok: true });
  assert.equal(task.auto_parallel.current, 4, '20 minutes apart is not a cluster - no signal, streak just advances');
  assert.equal(task.auto_parallel.streak, 1);
});

// ---------- phase-Team exemption ----------

for (const phase of ['planning', 'qa', 'audit']) {
  test(`phase-Team exemption: a ${phase} package's dispatch fold never touches the controller, clean or pushed back`, () => {
    const task = makeTask({ max_parallel_ceiling: 6 }, [{ id: 'P1' }, { id: phase.toUpperCase(), phase }]);
    ensureAutoParallel(task).current = 2;
    const cleanBefore = { ...task.auto_parallel };
    updateAutoParallel(task, dispatchNode(`dispatch:${phase.toUpperCase()}:1`, phase.toUpperCase()), { stage_ok: true });
    assert.deepEqual(task.auto_parallel, cleanBefore, 'a clean phase-Team fold must not advance the streak or the cap');
    const n = dispatchNode(`dispatch:${phase.toUpperCase()}:2`, phase.toUpperCase(), { driver: driverWithLog('overloaded_error') });
    updateAutoParallel(task, n, { stage_ok: false });
    assert.deepEqual(task.auto_parallel, cleanBefore, 'a pushed-back phase-Team fold must not halve the cap either');
  });
}
