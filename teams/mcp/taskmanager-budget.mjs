// taskmanager-budget.mjs - budget / timebox and the max_parallel_teams AIMD controller; split out of taskmanager.mjs (card 128 step 1), moved verbatim.
import { applySuspends, record, taskDir } from './taskstate.mjs';
import { availableParallelism } from 'node:os';
import { taskFigure } from './drivercost.mjs';
import { existsSync, readFileSync } from 'node:fs';
import { livePlanningPkgs, phaseOfId, planningPkgs } from './tickets.mjs';
import { node, readyNodes, runState } from './graph.mjs';
import { driverStderrTail, killDriver } from './taskmanager-drivers.mjs';
import { packageOf } from './taskmanager-worktree.mjs';
import { pendingRejudgeAt, reintegrateBehind } from './taskmanager-repair.mjs';
import { shapeAnalysis } from './taskmanager-plan.mjs';

// ---------- budget / timebox (the Sprint's missing box - no prior stop condition bounded
// either cost or time; a task ran until its graph naturally finished or someone intervened) ----

// The task's total spend across every driver it has ever spawned - a size-L task's package
// drivers AND a size-S task's own single s_run driver both write under the same drivers/
// directory (spawnChildDriver's nodeIdLabel is "S" for the latter), so one glob covers both.
// Reuses collectDriverCosts (drivercost.mjs) - the SAME driver-stream reader tm_status/tm_board/
// view.mjs's RESOURCE view already read this task's cost through - rather than a second parser
// that walks drivers/*.stream.jsonl itself: that would not only duplicate the "last result
// event wins" parsing rule, it would also drop the dedup collectDriverCosts does by (task_id,
// driver filename) for a driver stream a worktree checked out a copy of, silently double-
// counting spend budgetStatus/enforceBudget rely on to stop a run at 100%.
export function taskSpend(task) {
  return taskFigure(taskDir(task.run_id), task).spend;
}

export function taskElapsedMinutes(task) {
  // Time the machine slept is not time the run spent.
  return (Date.now() - (task.created_at || Date.now()) - (task.suspended_ms || 0)) / 60000;
}

// {pct, over, warn, spend, elapsed_minutes}. Neither budget_usd nor timebox_minutes set:
// unlimited, today's behaviour exactly (pct 0, never over). Either set: pct is the WORSE
// (larger) of the two fractions spent, since a dollar figure and a clock both cap the same run
// and either alone is a real stop condition - not "both must be exhausted". A limit of exactly
// 0 with any spend/elapsed at all reads as already over (Infinity), rather than a division that
// hides a misconfigured "stop immediately" as 0/0.
export function budgetStatus(task) {
  const opts = (task.team && task.team.opts) || {};
  const budget = Number.isFinite(opts.budget_usd) ? opts.budget_usd : null;
  const timebox = Number.isFinite(opts.timebox_minutes) ? opts.timebox_minutes : null;
  const elapsed = taskElapsedMinutes(task);
  if (budget == null && timebox == null) return { pct: 0, over: false, warn: false, spend: 0, elapsed_minutes: elapsed };
  const fig = taskFigure(taskDir(task.run_id), task);
  const spend = fig.spend;
  const frac = (used, limit) => (limit == null ? 0 : (limit > 0 ? used / limit : (used > 0 ? Infinity : 0)));
  const pct = Math.max(frac(spend, budget), frac(elapsed, timebox));
  return {
    pct, over: pct >= 1, warn: pct >= 0.8, spend, estimated: fig.estimated, elapsed_minutes: elapsed,
    ...(budget != null ? { budget_usd: budget } : {}), ...(timebox != null ? { timebox_minutes: timebox } : {}),
  };
}

// Called every daemon tick (daemon.mjs's stepOnceInner) and by tm_next's own toolNext - the same
// two call sites advanceDispatches/autoRepair/autoRetryPackages/autoReshape already share, so a
// hand-driven test and the daemon can never disagree about when the stop trips. Records the 80%
// warning once (task.budget_warned); at 100% sets task.budget_stopped once, which
// advanceDispatches itself checks at its own top to refuse opening another package - checked
// there, not duplicated here, the same way every other "is this allowed" question in this file
// lives at its one call site. "Finishes in-flight" is exactly what NOT killing a running dispatch
// means: this function only ever settles a package whose dispatch node is still 'pending',
// meaning no driver was ever spawned for it. Once nothing is left running, the pending packages
// still blocking the current integrate are marked 'skipped' (an established terminal state -
// see VERDICT_SCHEMA's own state enum) and a fresh integrate opens over just the accepted set,
// reusing reintegrateBehind - the exact mechanism a filed defect or a repair already opens a
// fresh integrate with, just handed the accepted subset instead of the full one.
// The last resort of a stopped box, tried only once the package sweep below has nothing left to
// do - run first, it closed a task whose ready dispatch the sweep was about to settle.
function closeStoppedToReport(task) {
  // Stopped, nothing left running, and the graph blocked short of its report (code-sprint-S5:
  // integrate:2 over the kept packages refused, a repair would need a dispatch the box forbids).
  // A stopped Sprint still owes its review and retro: settle every pending node but the report,
  // so the report's own `after` edge is satisfied and it runs. A pending re-judge is left to run.
  // Not only 'blocked': code-sprint-P2 (roles.planning) stopped after shape, and the goal gate
  // waited on accept:AUDIT:1 - a node the audit phase-Team would create only by dispatching, which
  // the box forbids. Pending nodes, none ready, nothing running: the task read 'running' and the
  // daemon waited forever. Stuck is stuck, whatever runState calls it.
  // A ready dispatch is as stuck as a waiting one here: advanceDispatches opens nothing once the
  // box is stopped (P2's dispatch:AUDIT:1 sat ready for 25 minutes).
  const stuck = !readyNodes(task).some((n) => n.stage !== 'report' && n.stage !== 'dispatch') && !task.nodes.some((n) => n.state === 'waiting_human');
  if (!task.nodes.some((n) => n.state === 'running') && pendingRejudgeAt(task) === null
      && (runState(task).state === 'blocked' || stuck)) {
    // A goal gate behind a verification pass (AUDIT, QA) that will not finish still has a done
    // integrate to judge: put it back there instead of skipping it. code-sprint-P5 built all four
    // packages and integrated them, AUDIT:1 failed after the stop, and the closer skipped the goal
    // gate - a 9/9 Sprint read "not delivered".
    const goal = task.nodes.filter((n) => n.stage === 'gate' && n.subgoal_id == null && n.state === 'pending').pop();
    // The goal gate may wait on a whole round of QA cards (C7) or on the audit: every pass among
    // its deps that has no verdict is named, and the gate is put back on the integrate they judge.
    const passOf = (d) => { const x = task.nodes.find((y) => y.node_id === d); const ph = x && x.stage === 'accept' ? phaseOfId(task, x.subgoal_id) : null; return (ph === 'qa' || ph === 'audit') ? { dep: x, pkg: packageOf(task, x.subgoal_id) } : null; };
    const passes = goal ? goal.deps.map(passOf) : [];
    if (goal && passes.length && passes.every(Boolean) && passes.some((p) => p.dep.state !== 'done')) {
      const integ = passes.map((p) => task.nodes.find((x) => x.node_id === p.pkg.integration_of && x.state === 'done')).find(Boolean);
      if (integ) {
        goal.deps = [integ.node_id];
        // The rewire routes the goal gate past a QA/AUDIT pass that was dispatched but never
        // finished - not the "never dispatched" case skipped_packages already tracks below
        // (portfolio-refresh-80ec931a: QA:1 failed on a malformed adapter reply, QA:2 was still
        // running when the box stopped and ended blocked - the goal gate accepted at 92% with no
        // QA verdict at all, and nothing had told it QA was missing). Record the fact here so
        // composeTaskPrompt can put it in front of the goal gate and the report explicitly,
        // instead of relying on a judge to notice a failed dispatch buried in "every node".
        for (const { dep } of passes.filter((p) => p.dep.state !== 'done')) {
          const passName = dep.subgoal_id;
          const lastAttempt = task.nodes.filter((x) => x.stage === 'dispatch' && x.subgoal_id === passName).pop();
          const why = (lastAttempt && lastAttempt.result && lastAttempt.result.reason) || 'budget/timebox stopped the Sprint before it could be retried';
          task.budget_stopped.qa_not_run = [
            ...(task.budget_stopped.qa_not_run || []),
            { pass: passName, node_id: dep.node_id, reason: why },
          ];
          record(task, { event: 'budget_goal_rewired', task_id: task.run_id, node_id: goal.node_id, from: dep.node_id, to: integ.node_id, pass: passName });
        }
        return true;
      }
    }
    const report = task.nodes.filter((n) => n.stage === 'report' && n.state === 'pending').pop();
    if (report) {
      const settledIds = [];
      for (const n of task.nodes) {
        if (n === report || n.state !== 'pending') continue;
        n.state = 'skipped';
        n.final = true;
        n.result = { stage_ok: false, reason: 'skipped: budget/timebox exhausted - the Sprint closes on what it has' };
        settledIds.push(n.node_id);
      }
      for (const n of task.nodes) if (n.state === 'failed' && !n.final) n.final = true;
      record(task, { event: 'budget_closed', task_id: task.run_id, skipped: settledIds });
      return true;
    }
  }
  return false;
}

// A task whose planning (or shaping) failed for good, before shape produced a package, still owes
// a person its report and the next Sprint its retro (_repo/docs/plans/2026-09-28-teams-adversarial-
// fixes.md M2). Nothing downstream of a spent areas split, planning card, planning integrate,
// shape or critique can run - settleFailure marked it unreachable - and the report node does not
// exist yet (expandPackages opens it). Once nothing is running, nothing is ready and no re-judge
// is pending: every pending/unreachable node is skipped and a report opens with no deps, the way
// a budget stop before shape closes (enforceBudget). The PRD any accepted card wrote is still
// rendered (docs.mjs's renderPrd), and the retro carries the whole backlog forward.
const PRE_SHAPE_STAGES = new Set(['areas', 'areas-critique', 'plan-integrate', 'shape', 'critique']);
export function closeFailedPlanning(task) {
  if (task.s_run || task.harness_run || task.budget_stopped) return false;
  if (task.spec && Array.isArray(task.spec.packages)) return false;
  if (task.nodes.some((n) => n.stage === 'report')) return false;
  if (task.nodes.some((n) => n.state === 'running')) return false;
  if (readyNodes(task).length || pendingRejudgeAt(task) !== null) return false;
  // A planning integrate that asked for a re-split is final by design (resplitPlanning), and a
  // retired card's nodes are history - neither is planning that failed.
  const dead = task.nodes.find((n) => n.state === 'failed' && n.final && !n.resplit
    && (PRE_SHAPE_STAGES.has(n.stage) || (phaseOfId(task, n.subgoal_id) === 'planning'
      && livePlanningPkgs(task).some((p) => String(p.id) === String(n.subgoal_id)))));
  if (!dead) return false;
  const skipped = [];
  for (const n of task.nodes) {
    if (n.state !== 'pending' && n.state !== 'unreachable') continue;
    n.state = 'skipped';
    n.final = true;
    n.result = { stage_ok: false, reason: `skipped: planning stopped at ${dead.node_id} with no retry left` };
    skipped.push(n.node_id);
  }
  const accepted = planningPkgs(task).some((p) => task.nodes.some((x) => x.stage === 'accept' && x.subgoal_id === String(p.id) && x.state === 'done'));
  task.planning_failed = { node_id: dead.node_id, stage: dead.stage, reason: whyFailed(dead), prd: accepted };
  task.nodes.push(node('report', 'report', [], { subgoal_id: null }));
  record(task, { event: 'planning_closed', task_id: task.run_id, node_id: dead.node_id, skipped, prd: accepted });
  return true;
}

function whyFailed(n) {
  const r = n.result || {};
  return String(r.reason || (Array.isArray(r.gaps) && r.gaps.join('; ')) || (Array.isArray(r.blocking) && r.blocking.join('; ')) || (Array.isArray(r.problems) && r.problems.join('; ')) || 'no reason recorded');
}

// A dispatch already running when the box trips is not all equally worth paying for.
// closeStoppedToReport's own goal-gate rewire (passOf: AUDIT/QA) means a phase-Team pass's
// accept is never read again once the box is over - portfolio-refresh-80ec931a (2026-09-28,
// ledger.jsonl) paid for dispatch:QA:2 to keep running 12 more minutes after budget_stopped,
// then budget_closed skipped accept:QA:2 anyway. That dispatch is killed here immediately, no
// grace - the same killDriver retryPackage's superseded-attempt cleanup and
// serviceStalledDriver's stall-kill already use, not a new process control. A package (or
// PLAN/S) dispatch IS still read by integrate/goal-gate, so it is let finish - but bounded: past
// budget_grace_usd more spend since the stop, or budget_grace_minutes elapsed, whichever first,
// it is killed the same way and its accept is skipped exactly like a package the box never let
// dispatch at all (see the neverRan handling below). Settling the node directly here (state,
// result, final) rather than going through dispatchSettled/serviceDeadDriver mirrors every other
// budget-path sweep in this function - none of them wait for the ordinary fold/retry machinery
// either, since a killed driver here is never meant to respawn.
// Returns true when it changed anything, same contract as the rest of this file's `progressed`.
function settleRunningDispatchesAtStop(task, status) {
  const opts = (task.team && task.team.opts) || {};
  const graceMinutes = Number.isFinite(opts.budget_grace_minutes) ? opts.budget_grace_minutes : 5;
  const graceUsd = Number.isFinite(opts.budget_grace_usd) ? opts.budget_grace_usd
    : (Number.isFinite(status.budget_usd) ? status.budget_usd * 0.10 : null);
  const stoppedAt = task.budget_stopped.at;
  const elapsedMinutes = (Date.now() - stoppedAt) / 60000;
  const spendSinceStop = Math.max(0, (status.spend || 0) - (task.budget_stopped.spend || 0));
  const graceSpent = elapsedMinutes >= graceMinutes || (graceUsd != null && spendSinceStop >= graceUsd);
  let changed = false;
  for (const n of task.nodes) {
    if (n.stage !== 'dispatch' || n.state !== 'running') continue;
    const bypassed = ['qa', 'audit'].includes(phaseOfId(task, n.subgoal_id));
    // A driver parked on a provider's usage limit is not running and, the box stopped, is never
    // respawned (autoResumeCapacity): no grace can buy it anything, so it settles now.
    const parked = !!(n.child && n.child.waiting_capacity);
    if (!bypassed && !parked && !graceSpent) continue;
    const reason = bypassed
      ? 'skipped: bypassed by the close path - a phase-Team pass whose accept the goal-gate rewire never reads once the box is over'
      : parked ? `skipped: parked on provider capacity (${String(n.child.waiting_capacity.reason || '').slice(0, 120)}) when budget/timebox stopped - a stopped box resumes nothing`
      : `skipped: budget grace exhausted (${Math.round(elapsedMinutes)}m / ${graceMinutes}m, $${spendSinceStop.toFixed(2)}${graceUsd != null ? ` / $${graceUsd.toFixed(2)}` : ''} since budget_stopped)`;
    const killed = !!(n.child && killDriver(n.child.driver));
    record(task, {
      event: 'budget_killed', task_id: task.run_id, node_id: n.node_id, reason,
      spend_at_kill: status.spend, killed_driver: killed, pid: (n.child && n.child.driver && n.child.driver.pid) || null,
    });
    n.state = 'skipped';
    n.final = true;
    n.result = { stage_ok: false, reason };
    const an = task.nodes.find((x) => x.node_id === n.node_id.replace(/^dispatch:/, 'accept:'));
    if (an && an.state !== 'done' && !an.final) { an.state = 'skipped'; an.final = true; an.result = { stage_ok: false, reason }; }
    changed = true;
  }
  return changed;
}

export function enforceBudget(task) {
  applySuspends(task);
  const status = budgetStatus(task);
  let progressed = false;
  if (status.warn && !task.budget_warned) {
    task.budget_warned = true;
    record(task, { event: 'budget_warning', task_id: task.run_id, pct: Math.round(status.pct * 100), spend: status.spend, ...(status.estimated ? { estimated: true } : {}), elapsed_minutes: Math.round(status.elapsed_minutes) });
    progressed = true;
  }
  if (!status.over) return progressed;
  if (!task.budget_stopped) {
    task.budget_stopped = {
      at: Date.now(), spend: status.spend, elapsed_minutes: Math.round(status.elapsed_minutes),
      budget_usd: status.budget_usd == null ? null : status.budget_usd,
      timebox_minutes: status.timebox_minutes == null ? null : status.timebox_minutes,
      skipped_packages: [],
    };
    record(task, { event: 'budget_stopped', task_id: task.run_id, ...task.budget_stopped, ...(status.estimated ? { estimated: true } : {}) });
    progressed = true;
  }
  // Stopped before shape ever produced packages (code-sprint-S2, 2026-09-26: the whole $6 went
  // on a PLAN team whose gate never passed). There is nothing to leave undispatched and no
  // integrate to reopen, and the report node does not exist yet - so without this the task sat
  // with a retry nobody would dispatch, no report and no retro.json, and the next Sprint had
  // nothing to continue from. Once nothing is running: every pending node is skipped and a
  // report opens on its own, which writes the retro with the whole backlog carried forward.
  // A size-S task's QA cards (m4) are phase passes: the stop settles them (no grace) and the S
  // report closes on what the run delivered - there is no manager report node to open.
  if (task.s_run || task.harness_run) return settleRunningDispatchesAtStop(task, status) || progressed;
  if (!task.spec || !Array.isArray(task.spec.packages)) {
    // A planning card still running when the box trips is let finish within the same grace a
    // package gets, then settled - not waited on forever (m2).
    if (task.nodes.some((n) => n.stage === 'dispatch' && n.state === 'running')) progressed = settleRunningDispatchesAtStop(task, status) || progressed;
    if (task.nodes.some((n) => n.state === 'running')) return progressed;
    if (task.nodes.some((n) => n.stage === 'report')) return progressed;
    const skipped = [];
    for (const n of task.nodes) {
      if (n.state !== 'pending') continue;
      n.state = 'skipped';
      n.final = true;
      n.result = { stage_ok: false, reason: 'skipped: budget/timebox exhausted before shape' };
      skipped.push(n.node_id);
    }
    task.nodes.push(node('report', 'report', [], { subgoal_id: null }));
    task.budget_stopped.before_shape = true;
    record(task, { event: 'budget_swept', task_id: task.run_id, skipped, before_shape: true });
    return true;
  }
  // Nothing to sweep while a dispatch this task already opened is still running - except
  // whatever settleRunningDispatchesAtStop itself just decided to stop (a bypassed phase-Team
  // pass, or a needed one past its grace): those are settled above, not waited on here.
  if (task.nodes.some((n) => n.stage === 'dispatch' && n.state === 'running')) {
    progressed = settleRunningDispatchesAtStop(task, status) || progressed;
    if (task.nodes.some((n) => n.stage === 'dispatch' && n.state === 'running')) return progressed;
  }
  // A superseded integrate is never current: portfolio-consolidate-8518d5dd left integrate:1
  // pending under the sweep's integrate:2, and the moment integrate:2 finished this found
  // integrate:1 again - P3's dead accept still under it - and swept it into integrate:3, :4, :5,
  // :6 over the same two accepts (five judge sessions, $8.88). A stopped box integrates what it
  // accepted once; budget_stopped.reintegrated is that once.
  const superseded = (id) => task.nodes.some((x) => x.supersedes === id);
  const currentIntegrate = task.nodes.filter((n) => n.stage === 'integrate' && n.state !== 'done' && !n.final && !superseded(n.node_id)).pop();
  if (!currentIntegrate) return closeStoppedToReport(task) || progressed; // no integrate left pending on a never-run package
  if (task.budget_stopped.reintegrated) return closeStoppedToReport(task) || progressed;
  const neverRan = task.nodes.filter((n) => n.stage === 'dispatch' && n.state === 'pending'
    && currentIntegrate.deps.some((d) => d.startsWith(`accept:${n.subgoal_id}:`)));
  // An accept that will never be done - its dispatch failed, and a stopped box retries nothing -
  // leaves the integrate waiting forever just like a never-run package does. code-sprint-P3's
  // P2 (and a two-package Sprint where it is the only one left) went to closeStoppedToReport,
  // which skipped the integrate and the goal gate: P1, accepted, was never integrated.
  const deadAccept = (d) => { const x = task.nodes.find((y) => y.node_id === d); return x && x.state !== 'done'
    && !task.nodes.some((y) => y.node_id === d.replace(/^accept:/, 'dispatch:') && (y.state === 'running' || y.state === 'pending')); };
  if (!neverRan.length && !currentIntegrate.deps.some(deadAccept)) return closeStoppedToReport(task) || progressed;
  const skipped = [];
  for (const dn of neverRan) {
    dn.state = 'skipped';
    dn.final = true;
    dn.result = { stage_ok: false, reason: 'skipped: budget/timebox exhausted before this package could dispatch' };
    const an = task.nodes.find((x) => x.node_id === dn.node_id.replace(/^dispatch:/, 'accept:'));
    if (an) { an.state = 'skipped'; an.final = true; an.result = { stage_ok: false, reason: 'skipped: budget/timebox exhausted' }; }
    skipped.push(dn.subgoal_id);
  }
  const keptAccepts = currentIntegrate.deps.filter((d) => { const x = task.nodes.find((y) => y.node_id === d); return x && x.state === 'done'; });
  task.budget_stopped.skipped_packages = [...new Set([...(task.budget_stopped.skipped_packages || []), ...skipped])];
  if (!keptAccepts.length) {
    // Nothing accepted: an integrate over zero packages merges nothing and its judge (and the
    // goal gate after it) is paid to look at an empty tree - code-sprint-P2 stopped right after
    // shape and opened integrate:2 with merged 0. Settle the rest and let the report run.
    for (const x of task.nodes) {
      if (x.state !== 'pending' || x.stage === 'report') continue;
      x.state = 'skipped';
      x.final = true;
      x.result = { stage_ok: false, reason: 'skipped: budget/timebox exhausted with no package accepted - nothing to integrate' };
    }
    record(task, { event: 'budget_swept', task_id: task.run_id, skipped, nothing_accepted: true });
    return true;
  }
  // Not done is every package this integrate drops, not only the swept ones: one that failed as
  // the box ran out is dropped too, and code-sprint-P3's note named P3 and P4 but not P2.
  const notDone = [...new Set(currentIntegrate.deps.filter((d) => !keptAccepts.includes(d)).map((d) => d.split(':')[1]))];
  const fresh = reintegrateBehind(task, currentIntegrate.node_id, keptAccepts, `budget/timebox exhausted; not done: ${notDone.join(', ')}`);
  // The integrate it replaces waits on accepts that will never be done: settle it, so nothing
  // (this sweep's next tick, closeStoppedToReport, runState) reads it as work still owed.
  if (currentIntegrate.state === 'pending') {
    currentIntegrate.state = 'skipped';
    currentIntegrate.result = { stage_ok: false, reason: `superseded by ${fresh}: budget/timebox exhausted - integrating only the accepted packages` };
  }
  currentIntegrate.final = true;
  task.budget_stopped.reintegrated = fresh;
  record(task, { event: 'budget_swept', task_id: task.run_id, skipped, integrate: fresh });
  return true;
}

// ---------- max_parallel_teams: 'auto' - an AIMD controller over develop-STORY concurrency ----------
//
// A fixed max_parallel_teams was a guess (teamconfig.mjs's own header), not a measurement. 'auto'
// (the default since 2026-09-28) replaces the guess with additive-increase/multiplicative-decrease,
// the same shape TCP congestion control uses for the same reason: probe up slowly while nothing
// complains, back off hard the moment something does. State lives on task.auto_parallel - a plain
// top-level field, exactly like task.driver_restarts/task.budget_stopped, that mutateTask
// (store.mjs) writes with the rest of the task object - no hand-picked field list.
const AIMD_START = 2; // the same number max_parallel_teams used to be pinned at forever
const AIMD_FLOOR = 1;
const AIMD_WINDOW = 2; // this many consecutive clean develop-STORY settles before +1

// min(cores/2, 6) unless team.opts.max_parallel_ceiling pins one: half the host's own reported
// parallelism leaves room for the daemon, judge calls and whatever else runs beside the packages
// themselves, and 6 is a cap on top of that for a very large host, where the vendor's own rate
// limit - not local cores - is almost certainly the binding constraint anyway.
function autoParallelCeiling(task) {
  const pinned = task.team && task.team.opts && task.team.opts.max_parallel_ceiling;
  if (Number.isInteger(pinned) && pinned >= 1) return pinned;
  let cores = 4;
  try { cores = availableParallelism(); } catch { /* an older Node, or a sandboxed host that refuses it - keep the fallback */ }
  return Math.max(AIMD_START, Math.min(Math.floor(cores / 2) || 1, 6));
}

// Lazily initializes task.auto_parallel the first time anything asks for it once spec.packages
// exists - before that there is no shape to size the start width from, so it returns null and every
// caller treats that as "no controller state yet". The start width is the DAG's own widest round
// (shapeAnalysis.max_parallel_width) capped by the ceiling; a missing shape or width 0 falls back to
// AIMD_START. `max` is the most the width may grow to again (min(shape width, ceiling), or the
// ceiling alone with no shape width). A stored state is kept; only its `max` follows the packages
// when tm_file adds some that widen the DAG (never shrinks it, never moves `current`).
export function ensureAutoParallel(task) {
  const packages = task.spec && task.spec.packages;
  const stored = task.auto_parallel;
  if (stored && Number.isInteger(stored.current)) {
    if (Array.isArray(packages) && Number.isInteger(stored.max)) {
      const w = shapeAnalysis(packages).max_parallel_width;
      if (w > 0) stored.max = Math.max(stored.max, Math.min(w, stored.ceiling));
    }
    return stored;
  }
  if (!Array.isArray(packages)) return null;
  const ceiling = autoParallelCeiling(task);
  const shapeWidth = shapeAnalysis(packages).max_parallel_width;
  const max = shapeWidth > 0 ? Math.min(shapeWidth, ceiling) : ceiling;
  const current = shapeWidth > 0 ? max : Math.min(AIMD_START, ceiling);
  task.auto_parallel = { current, streak: 0, ceiling, max, updated_at: Date.now() };
  return task.auto_parallel;
}

// The same words driverUsageLimitText already looks for (a spent usage quota) plus the vendor/
// host's own pushback codes that function does not name: a bare 429/529 or "overloaded" carries
// no "usage limit" wording, so nothing parks the package on waiting_capacity for it (reset_capacity
// would have nothing to reset), but it is still the vendor saying "slow down" - exactly what
// max_parallel_teams: auto exists to hear. Kept as one regex, not a second one per caller, so a
// wording either reader should catch never has to be taught to just one of them.
const PUSHBACK_RE = /rate[_ -]?limit|\b429\b|\b529\b|overloaded|api_error|insufficient_quota|usage_limit_reached|quota (?:exceeded|exhausted)|hit your (?:usage )?limit|exceeded your current quota/i;

// rate_limit_event statuses that are routine telemetry: "allowed_warning" is the near-limit notice
// the CLI emits while capacity is still granted (454 of them against 27 "rejected" in real logs).
const RATE_LIMIT_OK_STATUS = new Set(['allowed', 'allowed_warning']);

// Pushback is read from error-shaped fields of PARSED stream-json events, never from a regex over
// the raw log. A claude -p stream carries routine telemetry on every session - a rate_limit_event
// with status "allowed", `"api_error_status":null` on every result, and usage counters such as
// `"cache_creation_input_tokens":429` (which a \b429\b match once read as a 429 and halved the
// width in E-eb3d399f). What counts: a result event with is_error true, a non-null
// api_error_status, a rate_limit_event whose status is not "allowed" or "allowed_warning".
// Returns a short reason, or ''.
function pushbackFromEvent(e) {
  if (!e || typeof e !== 'object' || Array.isArray(e)) return '';
  if (e.type === 'rate_limit_event') {
    const status = e.rate_limit_info && e.rate_limit_info.status;
    return typeof status === 'string' && !RATE_LIMIT_OK_STATUS.has(status) ? `rate_limit_event status ${status}` : '';
  }
  if (e.api_error_status != null) return `api_error_status ${JSON.stringify(e.api_error_status)}`;
  if (e.type === 'result' && e.is_error === true) return `result is_error${typeof e.result === 'string' ? `: ${e.result.slice(0, 200)}` : ''}`;
  return '';
}

// Drops JSON-style usage counters (`"cache_creation_input_tokens":429`) so a bare number in one
// is never read as an HTTP status.
function stripUsageCounters(text) {
  return text.replace(/\\?"[A-Za-z0-9_]*_tokens\\?"\s*:\s*\d+/g, '');
}

// stderr is the vendor/host error channel, so PUSHBACK_RE runs over its tail as plain text (a
// driver SIGKILLed before its stream closed leaves its evidence only there). Usage counters in
// that tail are removed before matching (card 101 / E-eb3d399f: a driver printing a usage object
// to stderr halved the width on `"cache_creation_input_tokens":429`); the original tail is what
// is returned. The stream log is walked line by line and only a line that parses as a JSON event
// is judged, by pushbackFromEvent; plain text in the stream log (a tool result that mentions
// "overloaded_error") is intentionally not pushback.
function dispatchPushbackText(driver) {
  if (!driver) return '';
  const tail = driverStderrTail(driver, 2000);
  if (PUSHBACK_RE.test(stripUsageCounters(tail))) return tail;
  if (!driver.log) return '';
  try {
    if (!existsSync(driver.log)) return '';
    for (const line of readFileSync(driver.log, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      let e;
      try { e = JSON.parse(line.replace(/^\uFEFF/, '')); } catch { continue; }
      const reason = pushbackFromEvent(e);
      if (reason) return reason;
    }
    return '';
  } catch {
    return '';
  }
}

// The other half of "capacity signal" the design asks for: not a named error at all, just several
// develop-STORY dispatches' drivers dying close together - the same evidence serviceDeadDriver
// already records onto each child's OWN driver.restarts (task-wide here, across every dispatch
// node, not just the one being folded: two DIFFERENT packages each restarting once around the
// same time is the host pushing back on concurrency, even though neither alone spent its own
// restart budget - see restartBudget/countedDriverRestarts, which cap a single package's retries,
// not this).
const CLUSTER_WINDOW_MS = 5 * 60000;
function crashesClustered(task) {
  const restarts = task.nodes
    .filter((n) => n.stage === 'dispatch' && n.child && n.child.driver && Array.isArray(n.child.driver.restarts))
    .flatMap((n) => n.child.driver.restarts)
    .map((r) => r && r.at)
    .filter(Number.isInteger)
    .sort((a, b) => a - b);
  for (let i = 1; i < restarts.length; i++) if (restarts[i] - restarts[i - 1] <= CLUSTER_WINDOW_MS) return true;
  return false;
}

// One entry per advanceDispatches pass (the daemon's tick, or a tm_next poll) in a fixed-length
// list on task.auto_parallel_ticks, so tm_status can show what width the scheduler ran at, how many
// STORYs held a slot and how many were ready but waiting. The ledger gets an event only when the
// width or ready_waiting differs from the previous tick's - not one line per tick. The first tick
// (no previous one) writes one when packages already wait.
const AIMD_TICKS_KEEP = 30;
function recordAutoParallelTick(task, state, { running, ready_waiting }) {
  const ticks = Array.isArray(task.auto_parallel_ticks) ? task.auto_parallel_ticks : [];
  const prev = ticks.length ? ticks[ticks.length - 1] : null;
  ticks.push({ ts: Date.now(), width: state.current, running, ready_waiting });
  task.auto_parallel_ticks = ticks.slice(-AIMD_TICKS_KEEP);
  if (prev ? (prev.width !== state.current || prev.ready_waiting !== ready_waiting) : ready_waiting > 0) {
    record(task, { event: 'parallel_width_changed', task_id: task.run_id, from: prev ? prev.width : null, to: state.current, from_ready_waiting: prev ? prev.ready_waiting : null, running, ready_waiting });
  }
}

// Called once per develop-STORY dispatch fold - both toolSubmit and the daemon's own loop call
// this right before finish() (whose own saveRun then persists whatever this changed) - never for
// a phase-Team (PLAN/QA/audit) package, which advanceDispatches already exempts from the cap
// itself and so has nothing to teach this controller about ordinary STORY concurrency. A no-op
// whenever max_parallel_teams is a fixed number: auto is opt-in, and a project that pins a number
// gets exactly that number, unconditionally, exactly as before this existed.
//
// `result` (foldChild's own output - stage_ok, accept, reason, ...) is deliberately never read
// here: an accept:false is a quality verdict a LATER node (`accept:<pkg>:<n>`, judged through the
// readyNodes loop, see daemon.mjs) reaches, never through this function at all (grep confirms:
// only the `dispatch` stage's own fold calls updateAutoParallel). The portfolio-refresh run's
// real accept:P2:1 rejection is the worked example: dispatch:P2:1 folded clean (its child
// completed, no pushback) and counted toward the streak exactly as any other clean fold would;
// the SEPARATE accept:P2:1 node that rejected the package afterward never touched auto_parallel
// at all, and the resulting redispatch (dispatch:P2:2) got its own, independent clean-or-pushback
// read when IT folded. A rejection is real evidence about the package, not about whether the
// concurrency level the run is probing is too high - counting the fold that produced it (but
// never the verdict itself) is the intended split, not an oversight, and is exactly why this
// parameter has no `result.accept` check anywhere below.
export function updateAutoParallel(task, n, result) {
  const opts = task.team && task.team.opts;
  if (!opts || opts.max_parallel_teams !== 'auto') return;
  const pkg = packageOf(task, n.subgoal_id);
  if (pkg && (pkg.phase === 'planning' || pkg.phase === 'qa' || pkg.phase === 'audit')) return;
  const state = ensureAutoParallel(task);
  if (!state) return; // no spec.packages yet - nothing to size a width from
  const pushback = dispatchPushbackText(n.child && n.child.driver) || (crashesClustered(task) ? '(clustered driver restarts across dispatches)' : '');
  if (pushback) {
    const before = state.current;
    state.current = Math.max(AIMD_FLOOR, Math.floor(state.current / 2));
    state.streak = 0;
    state.updated_at = Date.now();
    state.reason = pushback.slice(0, 300);
    if (state.current !== before) record(task, { event: 'auto_parallel_decreased', task_id: task.run_id, node_id: n.node_id, from: before, to: state.current, reason: state.reason });
    return;
  }
  state.streak = (state.streak || 0) + 1;
  // budget_warned (enforceBudget, task.budget_warned - the same top-level flag task.auto_parallel
  // itself follows the pattern of) means the run already crossed its own warn threshold: growing
  // concurrency from here on spends whatever budget is left faster for a payoff (finishing
  // sooner) the run may never get to keep, since budget_stopped can close the task out from under
  // it at any following fold. The streak still advances - so a fold folded the moment budget_warned
  // flips does not lose a clean window it already earned - it is only ever spent on a +1 while
  // budget_warned is NOT set. Growth resumes on its own if a future run clears the flag (it never
  // does today; enforceBudget sets it once and it stays), never needs its own decrease/reset.
  const cap = Number.isInteger(state.max) ? state.max : state.ceiling; // a state stored before `max` existed grows to its ceiling
  if (state.streak >= AIMD_WINDOW && state.current < cap && !task.budget_warned) {
    const before = state.current;
    state.current = Math.min(cap, state.current + 1);
    state.streak = 0;
    state.updated_at = Date.now();
    state.reason = `${AIMD_WINDOW} clean dispatches since the last change`;
    record(task, { event: 'auto_parallel_increased', task_id: task.run_id, node_id: n.node_id, from: before, to: state.current });
  }
}

export { AIMD_START, recordAutoParallelTick };
