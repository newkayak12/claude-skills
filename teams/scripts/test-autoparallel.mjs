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

// ---------- real-run false positives: routine claude -p telemetry must not misread as pushback ----------
//
// Verified against $TMPDIR/pr-log/teams-log-portfolio-refresh-80ec931a (0.34.0, fixed cap 2, so
// the controller never actually ran against this data - these are the real driver logs replayed
// through 'auto' after the fact). Every one of that run's 9 real STORY dispatch folds
// (dispatch_P1_1 .. dispatch_P8_1, dispatch_P2_2) matched the PRE-FIX PUSHBACK_RE on TWO
// completely healthy, unrelated grounds: a `rate_limit_event` usage-telemetry line the CLI emits
// on every session (status "allowed" - capacity is fine), and an `"api_error_status":null` field
// the CLI's own `result` event carries on every run (null - no error). Unfixed, 'auto' would have
// halved on its very first real fold and stayed floored forever against any real claude driver.
test('no false decrease: a routine rate_limit_event ping with status "allowed" is not pushback', () => {
  const task = makeTask({ max_parallel_ceiling: 6 });
  ensureAutoParallel(task).current = 4;
  // A trimmed but structurally real line, same shape as every dispatch_P*.stream.jsonl in the
  // portfolio-refresh run.
  const log = '{"type":"assistant","message":{"content":[{"type":"text","text":"working"}]}}\n'
    + '{"type":"rate_limit_event","rate_limit_info":{"status":"allowed","resetsAt":1790571000,'
    + '"rateLimitType":"five_hour","unifiedWindows":{"five_hour":{"utilization":0.22}}}}\n';
  const n = dispatchNode('dispatch:P1:1', 'P1', { driver: driverWithLog(log) });
  updateAutoParallel(task, n, { stage_ok: true });
  assert.equal(task.auto_parallel.current, 4, 'status:"allowed" is capacity being fine, not pushback - must not halve');
  assert.equal(task.auto_parallel.streak, 1, 'and it still counts as a clean fold toward growth');
});

test('decrease still fires: a rate_limit_event whose status is NOT "allowed" is real pushback', () => {
  const task = makeTask({ max_parallel_ceiling: 6 });
  ensureAutoParallel(task).current = 4;
  const log = '{"type":"rate_limit_event","rate_limit_info":{"status":"rejected","rateLimitType":"five_hour"}}\n';
  const n = dispatchNode('dispatch:P1:1', 'P1', { driver: driverWithLog(log) });
  updateAutoParallel(task, n, { stage_ok: false });
  assert.equal(task.auto_parallel.current, 2, 'a non-"allowed" status is the vendor actually throttling - still halves');
});

test('no false decrease: the routine "api_error_status":null field on every result event is not pushback', () => {
  const task = makeTask({ max_parallel_ceiling: 6 });
  ensureAutoParallel(task).current = 4;
  // The exact tail shape of every real dispatch_P*.stream.jsonl's final line in that run.
  const log = '{"type":"result","subtype":"success","is_error":false,"num_turns":14,'
    + '"api_error_status":null,"result":"## resume-tailorer SKILL.md rewrite (package P1)"}\n';
  const n = dispatchNode('dispatch:P1:1', 'P1', { driver: driverWithLog(log) });
  updateAutoParallel(task, n, { stage_ok: true });
  assert.equal(task.auto_parallel.current, 4, '"api_error_status":null is the FIELD NAME, not a real api_error - must not halve');
});

test('decrease still fires: a non-null api_error_status is a real API error', () => {
  const task = makeTask({ max_parallel_ceiling: 6 });
  ensureAutoParallel(task).current = 4;
  const log = '{"type":"result","subtype":"error","is_error":true,"api_error_status":"overloaded_error"}\n';
  const n = dispatchNode('dispatch:P1:1', 'P1', { driver: driverWithLog(log) });
  updateAutoParallel(task, n, { stage_ok: false });
  assert.equal(task.auto_parallel.current, 2, 'a non-null api_error_status is the vendor actually erroring - still halves');
});

test('phase-Team exemption + real QA:1 text: a malformed-JSON adapter failure never reaches the controller', () => {
  // The real shape of dispatch_QA_1.stream.jsonl's failure: driver exit 0 (empty stderr), but
  // the CHILD run's own `plan` node reports adapter exit 1 on malformed JSON, alongside the same
  // routine rate_limit_event/api_error_status noise every log carries. QA is phase-exempt, so
  // none of this - real failure text included - should ever reach PUSHBACK_RE.
  const task = makeTask({ max_parallel_ceiling: 6 }, [{ id: 'P1' }, { id: 'QA', phase: 'qa' }]);
  ensureAutoParallel(task).current = 4;
  const log = '{"type":"tool_result","content":"{\\"run_id\\":\\"1eef1fc5\\",\\"node_id\\":\\"plan\\",'
    + '\\"stage\\":\\"plan\\",\\"state\\":\\"failed\\",\\"stage_ok\\":false,\\"reason\\":\\"adapter exit 1\\"}"}\n'
    + '{"type":"rate_limit_event","rate_limit_info":{"status":"allowed"}}\n'
    + '{"type":"result","is_error":false,"api_error_status":null}\n';
  const n = dispatchNode('dispatch:QA:1', 'QA', { driver: driverWithLog(log) });
  updateAutoParallel(task, n, { stage_ok: false });
  assert.equal(task.auto_parallel.current, 4, 'a phase-Team fold is exempt before PUSHBACK_RE ever runs over its text');
});

// ---------- budget_warned freezes growth, never triggers a decrease ----------

test('growth freezes once task.budget_warned is set: streak still advances, current does not', () => {
  const task = makeTask({ max_parallel_ceiling: 6 });
  ensureAutoParallel(task).current = 3;
  task.budget_warned = true;
  updateAutoParallel(task, dispatchNode('dispatch:P1:1', 'P1'), { stage_ok: true });
  updateAutoParallel(task, dispatchNode('dispatch:P1:2', 'P1'), { stage_ok: true });
  assert.equal(task.auto_parallel.streak, 2, 'the window still completes - a clean fold is still a clean fold');
  assert.equal(task.auto_parallel.current, 3, 'but budget_warned holds it at 3: more parallelism only burns the box faster');
});

test('growth resumes once budget_warned is cleared: the streak already earned is spent on the very next clean fold', () => {
  const task = makeTask({ max_parallel_ceiling: 6 });
  ensureAutoParallel(task).current = 3;
  task.budget_warned = true;
  updateAutoParallel(task, dispatchNode('dispatch:P1:1', 'P1'), { stage_ok: true });
  updateAutoParallel(task, dispatchNode('dispatch:P1:2', 'P1'), { stage_ok: true });
  assert.equal(task.auto_parallel.streak, 2, 'a full window already accrued while frozen');
  assert.equal(task.auto_parallel.current, 3, 'but spending it was blocked by budget_warned');
  task.budget_warned = false;
  updateAutoParallel(task, dispatchNode('dispatch:P1:3', 'P1'), { stage_ok: true });
  assert.equal(task.auto_parallel.current, 4, 'the streak (now 3, still >= AIMD_WINDOW) is a debt this fold pays off the moment it is unblocked');
  assert.equal(task.auto_parallel.streak, 0, 'and it resets exactly as any other increase would');
});

test('a pushback still halves even while budget_warned is set - capacity signals are never frozen out', () => {
  const task = makeTask({ max_parallel_ceiling: 6 });
  ensureAutoParallel(task).current = 4;
  task.budget_warned = true;
  const n = dispatchNode('dispatch:P1:1', 'P1', { driver: driverWithLog('overloaded_error') });
  updateAutoParallel(task, n, { stage_ok: false });
  assert.equal(task.auto_parallel.current, 2, 'budget_warned freezes growth, never the emergency brake');
});

// ---------- replay: the portfolio-refresh run's real fold sequence, in real fold order ----------
//
// Extracted from $TMPDIR/pr-log/teams-log-portfolio-refresh-80ec931a/raw/task/ledger.jsonl: every
// `node_finish` with stage "dispatch" (a develop-STORY fold), ordered by when it actually folded
// (that run used a fixed cap of 2, so this is the real interleaving two-at-a-time produced - PLAN
// and QA are omitted, both phase-exempt). All 9 folds were clean in that run (every dispatch's
// child completed; none crashed) - confirmed above that their real driver-log text, routine
// telemetry included, does not read as pushback once the false positives are fixed. budget_warning
// fired at +44.72m (task.budget_warned flips true there, mid-sequence, before P6:1 and P8:1 fold).
const REAL_FOLD_SEQUENCE = [
  { node_id: 'dispatch:P2:1', pkg: 'P2', end_min: 25.59, duration_min: 5.33 },
  { node_id: 'dispatch:P1:1', pkg: 'P1', end_min: 26.43, duration_min: 6.17 },
  { node_id: 'dispatch:P3:1', pkg: 'P3', end_min: 30.75, duration_min: 3.79 },
  { node_id: 'dispatch:P2:2', pkg: 'P2', end_min: 32.90, duration_min: 6.68 },
  { node_id: 'dispatch:P5:1', pkg: 'P5', end_min: 37.93, duration_min: 4.55 },
  { node_id: 'dispatch:P4:1', pkg: 'P4', end_min: 39.86, duration_min: 8.63 },
  { node_id: 'dispatch:P7:1', pkg: 'P7', end_min: 44.14, duration_min: 3.86 },
  // --- budget_warning at +44.72m: task.budget_warned flips true before these two fold ---
  { node_id: 'dispatch:P6:1', pkg: 'P6', end_min: 49.27, duration_min: 10.90 },
  { node_id: 'dispatch:P8:1', pkg: 'P8', end_min: 50.00, duration_min: 5.28 },
];
const BUDGET_WARNING_AT_MIN = 44.72;

test('replay: the real fold sequence drives current 2 -> 3 -> 4 -> 5, then freezes at budget_warning', () => {
  const task = makeTask({ max_parallel_ceiling: 6 });
  const trajectory = [];
  for (const fold of REAL_FOLD_SEQUENCE) {
    if (fold.end_min >= BUDGET_WARNING_AT_MIN) task.budget_warned = true;
    updateAutoParallel(task, dispatchNode(fold.node_id, fold.pkg), { stage_ok: true });
    trajectory.push(task.auto_parallel.current);
  }
  assert.deepEqual(
    trajectory,
    [2, 3, 3, 4, 4, 5, 5, 5, 5],
    'current after each of the 9 real folds, in real fold order',
  );
  assert.equal(task.auto_parallel.streak, 3, 'two more clean folds accrued past the last increase, frozen by budget_warned');
});

// ---------- wall-time: a rough estimate, auto vs fixed 2, from the real per-package durations ----------
//
// A simple greedy list-scheduling simulation, not a re-run of the real dispatcher: `limit` fixed
// slots (fixed policy) or a limit that grows the same way updateAutoParallel's AIMD_WINDOW=2 does
// (auto policy, starting at AIMD_START=2), assigning P1..P8 in priority order to the
// earliest-available slot. P2's own two attempts (real reject-at-accept, real redispatch) are one
// back-to-back duration (5.33+6.68=12.01) since the real ledger shows ~0 gap between accept:P2:1's
// rejection and dispatch:P2:2 opening - a package retry occupies one continuous slot, not two
// arrivals. This is "rough" by design (item 1 of the task): real capacity growth depends on the
// very fold order this simulates, so the two are coupled - good enough for an order-of-magnitude
// wall-time comparison, not a claim of exact minutes.
const PACKAGE_DURATIONS_MIN = { P1: 6.17, P2: 5.33 + 6.68, P3: 3.79, P4: 8.63, P5: 4.55, P6: 10.90, P7: 3.86, P8: 5.28 };
const PRIORITY_ORDER = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8'];

function simulateMakespan({ startLimit, growWindow = null, ceiling = 6 }) {
  const queue = [...PRIORITY_ORDER];
  let limit = startLimit;
  let streak = 0;
  // Event-driven loop tracking absolute time: assign up to `limit` packages (priority order) at
  // time 0, then repeatedly jump to the next completion, grow `limit` if growWindow applies, and
  // backfill any now-open slots from the queue.
  let now = 0;
  const active = [];
  const assign = () => {
    while (active.length < limit && queue.length) {
      const pkg = queue.shift();
      active.push({ pkg, end: now + PACKAGE_DURATIONS_MIN[pkg] });
    }
  };
  assign();
  let makespan = 0;
  while (active.length) {
    active.sort((a, b) => a.end - b.end);
    const next = active.shift();
    now = next.end;
    makespan = Math.max(makespan, now);
    if (growWindow) {
      streak += 1;
      if (streak % growWindow === 0 && limit < ceiling) limit += 1;
    }
    assign();
  }
  return +makespan.toFixed(2);
}

test('rough wall-time: auto (growing from 2) finishes the same 8 packages faster than a fixed cap of 2', () => {
  const fixed = simulateMakespan({ startLimit: 2, growWindow: null });
  const auto = simulateMakespan({ startLimit: 2, growWindow: 2, ceiling: 6 });
  assert.equal(fixed, 27.73, 'fixed cap 2, greedy list scheduling over the real durations');
  assert.equal(auto, 22.91, 'auto, growing +1 every 2 clean completions, same durations and priority order');
  assert.ok(auto < fixed, 'auto must not be slower than the fixed cap it replaces');
  // Real observed wall time for this phase (dispatch:P1:1's start to dispatch:P8:1's fold) was
  // 50.00 - 20.26 = 29.74 minutes - this simulation's fixed-2 estimate (27.73) is in the same
  // ballpark, the gap being real dispatch-open/accept overhead this model does not simulate.
  const realObservedMin = 50.00 - 20.26;
  assert.ok(Math.abs(fixed - realObservedMin) < 3, 'the simulated fixed-cap makespan should track the real observed wall time reasonably closely');
});
