// taskstate.mjs - where a task lives on disk, its ledger, and the read-side judgements over a
// task (driver liveness, restart budget, the size-S harness run's state, unfinished work).
// A leaf: it imports no taskmanager.mjs, so docs.mjs and daemon.mjs can read a task without
// pulling in the server (and without the docs <-> taskmanager import cycle).

import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { appendLedger, inTransaction } from './store.mjs';
import { pidAlive } from './proc.mjs';
import { TEAM_DEFAULTS } from './teamconfig.mjs';
import { readPointer, ownsRun, findTaggedRun, harnessVerdict, taskTag } from './harnessrun.mjs';
import { livePlanningPkgs, qaPkgs } from './tickets.mjs';

export function tasksRoot() {
  return process.env.HARNESS_TASKS_DIR ? resolve(process.env.HARNESS_TASKS_DIR) : join(homedir(), '.harness', 'tasks');
}
export function taskDir(taskId) {
  return join(tasksRoot(), taskId);
}
export function taskPath(taskId) {
  return join(taskDir(taskId), 'task.json');
}

// Through store.mjs appendLedger: inside a mutateTask transaction the line is buffered and written
// only after task.json commits, so a write that aborts leaves no phantom event (2026-10-02 review -
// toolSubmit recorded tm_submit and then threw on a dispatch payload).
export function record(task, entry) {
  // An open's effect (openChild, outside any transaction) holds its lines until its apply lands:
  // an open that is claim_lost never shows a dispatch the node did not get (goal repair 1).
  if (effectLedger && !inTransaction()) { effectLedger.push({ ts: Date.now(), ...entry }); return; }
  try {
    appendLedger(join(taskDir(task.run_id), 'ledger.jsonl'), JSON.stringify({ ts: Date.now(), ...entry }) + '\n');
  } catch {
    /* the ledger is evidence, not a dependency */
  }
}

// Set by runClaimed while an open effect runs; see record().
let effectLedger = null;

// The seam runClaimed uses: begin before an open effect runs, take (and clear) after it.
export function beginEffectLedger() {
  effectLedger = [];
}
export function takeEffectLedger() {
  const held = effectLedger;
  effectLedger = null;
  return held;
}

// ---------- sleep/wake (../teams-mac-sleep/finding.md) ----------
//
// A laptop that sleeps stops every process, and on wake each wall-clock judgement (stall, timebox,
// ask deadline) reads the sleep as idle time. Wall time jumps across a suspend; the monotonic
// clock (performance.now) does not, so the difference between the two deltas since this process
// last looked is the suspend. The clock is a seam so tests inject a suspend instead of sleeping.
export const __clock = { wall: () => Date.now(), mono: () => performance.now(), platform: () => process.platform };
export const SUSPEND_GAP_MS = 60000;
export const WAKE_WINDOW_MS = 10 * 60000;
const MAX_SUSPENDS = 50;

// Per process: the last {wall, mono} looked at, and every suspend this process has detected.
// One MCP server serves many tasks, so a gap is kept and applied to each task it services, not
// only to the one whose call happened to notice it.
const detector = { base: null, detected: [] };
export function __resetSuspendDetector() { detector.base = null; detector.detected = []; }

// The forward wall-clock time the monotonic clock did not see, when it is a suspend; else 0
// (a backward wall step is negative and reads as 0).
export function suspendGap(prev, cur) {
  const gap = (cur.wall - prev.wall) - (cur.mono - prev.mono);
  return gap >= SUSPEND_GAP_MS ? gap : 0;
}

// Looks at the clock; returns every suspend this process has detected so far.
export function detectSuspends() {
  const cur = { wall: __clock.wall(), mono: __clock.mono() };
  if (detector.base) {
    const gap = suspendGap(detector.base, cur);
    if (gap) detector.detected.push({ at: cur.wall, gap_ms: gap });
  }
  detector.base = cur;
  return detector.detected;
}

// Records one suspend [at - gap, at] on the task, clipped to the part after the task existed.
// Idempotent: intervals that overlap are merged and suspended_ms counts their union, so two
// processes (the daemon, an MCP server) that saw the same sleep count it once. Returns true when
// the task changed. Past the cap, suspends_floor is the end of the newest interval dropped from
// the list: anything before it is already counted, so a process re-applying its old detections
// adds nothing.
export function noteSuspend(task, at, gapMs) {
  const from = Math.max(at - gapMs, Number.isFinite(task.created_at) ? task.created_at : -Infinity,
    Number.isFinite(task.suspends_floor) ? task.suspends_floor : -Infinity);
  if (!(at > from)) return false;
  const list = (task.suspends || []).map((s) => [s.at - s.gap_ms, s.at]);
  const before = list.reduce((sum, [a, b]) => sum + (b - a), 0);
  let lo = from;
  let hi = at;
  let merged = false;
  const keep = [];
  for (const [a, b] of list) {
    if (a <= hi && b >= lo) { lo = Math.min(lo, a); hi = Math.max(hi, b); merged = true; } else keep.push([a, b]);
  }
  keep.push([lo, hi]);
  keep.sort((x, y) => x[1] - y[1]);
  const added = keep.reduce((sum, [a, b]) => sum + (b - a), 0) - before;
  if (added <= 0) return false;
  if (keep.length > MAX_SUSPENDS) task.suspends_floor = keep[keep.length - MAX_SUSPENDS - 1][1];
  task.suspends = keep.slice(-MAX_SUSPENDS).map(([a, b]) => ({ at: b, gap_ms: b - a }));
  task.suspended_ms = (task.suspended_ms || 0) + added;
  task.resumed_at = Math.max(task.resumed_at || 0, at);
  // A stall flagged before the sleep was the sleep.
  for (const n of task.nodes || []) {
    if (n.stage === 'dispatch' && n.state === 'running' && n.child) delete n.child.stalled_since;
  }
  if (task.harness_run) delete task.harness_run.stalled_since;
  if (!merged) record(task, { event: 'suspend_detected', task_id: task.run_id, gap_ms: at - from, resumed_at: at });
  return true;
}

// Before any time judgement on this task: look at the clock, then apply every suspend this
// process has seen that the task has not yet recorded.
export function applySuspends(task) {
  let changed = false;
  for (const s of detectSuspends()) if (noteSuspend(task, s.at, s.gap_ms)) changed = true;
  return changed;
}

// Suspended time after `since` (an ask's waiting_since).
export function suspendedSince(task, since) {
  let ms = 0;
  for (const s of task.suspends || []) ms += Math.max(0, s.at - Math.max(s.at - s.gap_ms, since));
  return ms;
}

// The wake window of each suspend buys at most ONE free restart per driver: the restart stamped
// after_wake for it, else the first one inside [at - gap, at + WAKE_WINDOW_MS]. Map: index into
// restarts -> the suspend's at.
export function freeRestarts(task, restarts) {
  const free = new Map();
  for (const s of task.suspends || []) {
    const i = restarts.findIndex((r, k) => !free.has(k) && Number.isFinite(r.at)
      && (r.after_wake === s.at || (r.at >= s.at - s.gap_ms && r.at <= s.at + WAKE_WINDOW_MS)));
    if (i >= 0) free.set(i, s.at);
  }
  return free;
}

// Stamps a new restart entry after_wake when it is that driver's free restart for a suspend.
export function stampAfterWake(task, prior, entry) {
  const at = freeRestarts(task, [...prior, entry]).get(prior.length);
  return at === undefined ? entry : { ...entry, after_wake: at };
}

export function driverAlive(driver) {
  return !!(driver && driver.pid) && pidAlive(driver.pid);
}

// The restart budget and the restarts that count against it (the sliding window when
// restart_period_minutes > 0 - see serviceDeadDriver). Shared with dispatchSettled, which has to
// know when a dead driver will never be respawned so the dispatch can fold instead of sitting
// 'running' forever: idol-beta-ask1's P6 spent its budget and then stayed running 16h+, because
// dispatchSettled only ever read the child run's own state, which a dead driver never advances.
export function restartBudget(task) {
  return Number.isInteger(task.driver_restarts) ? task.driver_restarts : 2;
}

// OTP-style restart intensity: driver_restarts is a flat, forever counter by default
// (restart_period_minutes 0, teamconfig.mjs) - every death this run has ever had counts
// against the budget. >0 makes it a sliding window: only the restarts whose own `at` falls
// inside the last restart_period_minutes count, so a package that dies once an hour for a week
// never exhausts a budget sized for "how many deaths in a row".
export function countedDriverRestarts(task, driver) {
  const all = (driver && driver.restarts) || [];
  const free = freeRestarts(task, all);
  const prior = free.size ? all.filter((_, i) => !free.has(i)) : all;
  const periodMinutes = Number.isInteger(task.restart_period_minutes) ? task.restart_period_minutes : TEAM_DEFAULTS.restart_period_minutes;
  return periodMinutes > 0
    ? prior.filter((r) => Number.isInteger(r.at) && Date.now() - r.at <= periodMinutes * 60000)
    : prior;
}

// What a finished task left undone, or null when it delivered everything it set out to.
// portfolio-consolidate-8518d5dd closed `complete` with integrate:6 refused, P3 unaccepted, P4
// never dispatched and QA and gate:goal skipped - every machine-readable surface said success,
// and a settled retry budget (idol-pm-1) read the same. One rule, whatever stopped it (budget,
// timebox, a spent retry budget): a written report over any of these is `partial`, not `complete`.
export function unfinishedWork(task) {
  if (!task || !Array.isArray(task.nodes)) return null;
  // Size S on the development harness: what its own goal gate said, or why its driver stopped.
  if (task.harness_run) {
    const st = harnessState(task);
    if (st.partial_reasons) return { partial: true, partial_reasons: st.partial_reasons };
    return st.state === 'blocked' ? { partial: true, partial_reasons: [st.reason] } : null;
  }
  const reasons = [];
  const last = (pred) => task.nodes.filter(pred).pop();
  if (task.planning_failed) {
    const f = task.planning_failed;
    reasons.push(`planning stopped at ${f.node_id} with no retry left: ${String(f.reason || '').slice(0, 300)}${f.prd ? '' : ' - no planning card was accepted, so there is no PRD'}`);
  }
  const skippedPkgs = (task.budget_stopped && task.budget_stopped.skipped_packages) || [];
  for (const p of ((task.spec && task.spec.packages) || [])) {
    const id = String(p.id);
    if (last((n) => n.stage === 'accept' && n.subgoal_id === id && n.state === 'done')) continue;
    const d = last((n) => n.stage === 'dispatch' && n.subgoal_id === id);
    reasons.push(skippedPkgs.includes(id) || !d || d.state === 'pending'
      ? `${id}: never dispatched (budget/timebox)`
      : `${id}: not accepted (${d.node_id} ${d.state})`);
  }
  const integ = last((n) => n.stage === 'integrate' && n.state !== 'skipped');
  if (!integ) reasons.push('no integrate ran');
  else if (integ.state !== 'done') reasons.push(`${integ.node_id} ${integ.state}${integ.result && integ.result.verified === false ? ' (verified=false)' : ''}`);
  // Every card of every pass: a planning card that never got accepted, and each QA card (C7),
  // each named on its own - "QA-F2: no verdict" says which area went unexercised.
  for (const pkg of [...livePlanningPkgs(task), ...qaPkgs(task), task.audit_pkg].filter(Boolean)) {
    const pass = String(pkg.id);
    const a = last((n) => n.stage === 'accept' && n.subgoal_id === pass);
    if (a && a.state === 'done') continue;
    reasons.push(`${pass}: no verdict (${a ? `${a.node_id} ${a.state}` : 'never opened'})`);
  }
  const goal = last((n) => n.stage === 'gate' && n.subgoal_id == null && String(n.node_id).startsWith('gate:goal'));
  if (goal && goal.state !== 'done') reasons.push(`${goal.node_id} ${goal.state}`);
  const unreachable = task.nodes.filter((n) => n.state === 'unreachable').length;
  if (unreachable && !reasons.length) reasons.push(`${unreachable} node(s) unreachable after a spent retry budget`);
  return reasons.length ? { partial: true, partial_reasons: reasons } : null;
}

// The run this task's harness driver opened: the pointer, when the run it names carries this
// task's tag and was created after the open; else the tagged run found on disk. A pointer that
// fails the check is refused (recorded once) - the driver's word is not the run.
export function resolveHarnessRun(task) {
  const h = task.harness_run;
  if (!h) return null;
  if (h.run && ownsRun(h.run, task.run_id, h.opened_at)) return h.run;
  const p = readPointer(h.pointer, h.cwd);
  let run = null;
  if (p && ownsRun(p, task.run_id, h.opened_at)) run = p;
  else if (p && JSON.stringify(p) !== JSON.stringify(h.refused_pointer || null)) {
    h.refused_pointer = p;
    record(task, { event: 'harness_pointer_refused', task_id: task.run_id, pointer: p, reason: `the run is not tagged ${taskTag(task.run_id)} or predates the open` });
  }
  if (!run) run = findTaggedRun(h.cwd, task.run_id, h.opened_at);
  if (run) {
    h.run = run;
    h.route = run.route;
  }
  return run;
}

// S1a: running while the driver lives or will be respawned; complete/partial once the run's own
// report is written, by its own goal gate; blocked when the driver died past its budget unfinished.
export function harnessState(task) {
  const h = task.harness_run;
  const run = resolveHarnessRun(task);
  const v = run ? harnessVerdict(run) : null;
  if (v && v.finished) {
    if (v.accept) return { state: 'complete', counts: {} };
    const why = `the harness goal gate did not accept${v.match_pct != null ? ` (match ${v.match_pct})` : ''}${v.gaps.length ? `: ${v.gaps.slice(0, 3).join('; ')}` : ''}`;
    return { state: 'partial', partial: true, partial_reasons: [why], counts: {} };
  }
  if (h.waiting_capacity || !h.driver || driverAlive(h.driver)) return { state: 'running', counts: {} };
  if (countedDriverRestarts(task, h.driver).length >= restartBudget(task)) {
    return { state: 'blocked', counts: {}, reason: 'the harness driver died past its restart budget with its run unfinished' };
  }
  return { state: 'running', counts: {} };
}
