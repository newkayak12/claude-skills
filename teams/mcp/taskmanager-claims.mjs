// taskmanager-claims.mjs - claims, spawns out of the transaction and open intents (tm_next, tm_submit); split out of taskmanager.mjs (card 128 step 1), moved verbatim.
import { afterCommit, inTransaction, mutateRun, mutateTask, writeAtomic } from './store.mjs';
import { applySuspends, beginEffectLedger, driverAlive, record, takeEffectLedger, taskDir, taskPath } from './taskstate.mjs';
import { authorStage, autoPassHumanGateResult, currentAttempt, getNode, humanGateResultFromPayload, kindOf, loadRun, loadRunAt, peekHumanActions, promoteHumanGates, queueHumanAction, readyNodes, runState, saveRun } from './graph.mjs';
import { clearWaiting, noteWaiting, peek as capPeek, reserveSlot } from './livecap.mjs';
import { computeSubmitResult } from './broker.mjs';
import { dirname, join } from 'node:path';
import { epicKey, latestBySubgoal, parseTicketKey, taskKey } from './tickets.mjs';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
// The same driver-stream reader view.mjs's RESOURCE view already uses (see drivercost.mjs's own
// header comment) - reused here, not re-parsed, so tm_status/tm_board/the report briefing can
// never disagree with what the view surface already shows for the same task.
import { pidAlive } from './proc.mjs';
import { randomUUID } from 'node:crypto';
import { touchMarker } from './engage.mjs';
import { AIMD_START, closeFailedPlanning, enforceBudget, ensureAutoParallel, recordAutoParallelTick, updateAutoParallel } from './taskmanager-budget.mjs';
import { answerText, finish, verdict } from './taskmanager-finish.mjs';
import { briefingPath, composeTaskPrompt, writeManagerBriefing } from './taskmanager-prompts.mjs';
import { daemonExhaustedNext, killDriver, serviceDeadDriver, serviceStalledDriver } from './taskmanager-drivers.mjs';
import { delegateIfSmall, requireRunnable, withHarnessFields } from './taskmanager-handlers.mjs';
import { foldChild, openChild, prepareIntegration } from './taskmanager-children.mjs';
import { noDriver, packageOf, worktreeGoneStop } from './taskmanager-worktree.mjs';
import { preparePlanIntegration } from './taskmanager-plan.mjs';
import { resumeParkedDriver, storyAnswerText, storyAskAnswered } from './taskmanager-asks.mjs';
import { toolNextHarness, toolNextSRun } from './taskmanager-harness.mjs';
import { withTask } from './taskmanager-stages.mjs';

// ---------- claims: a node is taken in a transaction before any side effect (2026-10-02, U3) ----------
//
// openChild (git worktree add, createRun, a driver spawn), prepareIntegration (worktree, merges,
// npm test), preparePlanIntegration and foldChild (git commit) used to run on whatever snapshot
// the caller held, guarded only by readyNodes() on that snapshot - so the daemon and a tm_next (or
// a tm_submit) could both open, prepare or fold the same node (v0.26.3 double fold: only the
// index.lock retry was ever fixed). Now: a claim transaction re-reads task.json and stamps
// n.claim = {pid, token, op, attempt, at} on a node still eligible; the effect runs outside the
// lock on a fresh copy; an apply transaction writes the effect's node fields back only if the node
// still holds that token, at the same attempt and state - else claim_lost, nothing applied. An
// effect that throws releases the claim (claim_failed) so the node is runnable again.
//
// Dispatch open moves the node to `running` in the claim transaction (readyNodes stops offering
// it at once); until the apply it is a running dispatch with no `child` - readers say "opening".
// integrate / plan-integrate stay `pending` with a claim, so readyToJudge (daemon judge pass,
// tm_next's ready list) skips a node with a live claim or with no preparation yet (critique N1).

// Tokens this process holds right now. A claim stamped with our pid but a token not in here is a
// previous incarnation of this pid (pid reuse after a crash): stale, not ours.
const heldClaims = new Set();

// Test seam: called once (then cleared) between a claim transaction and its effect, outside any
// transaction - the window a second caller arrives in. Never set outside tests.
export const __storeHooks = { afterClaim: null, afterEffect: null, afterReserve: null };

export function liveClaim(claim) {
  if (!claim || !claim.token) return false;
  if (claim.pid === process.pid) return heldClaims.has(claim.token);
  return pidAlive(claim.pid);
}

// Inside a transaction on `task`: stamp a claim on n, or null if another live owner holds one. A
// dead owner's claim is reclaimed (claim_reclaimed).
export function claimNode(task, n, op) {
  if (n.claim) {
    if (liveClaim(n.claim)) return null;
    record(task, { event: 'claim_reclaimed', task_id: task.run_id, node_id: n.node_id, op: n.claim.op, pid: n.claim.pid, token: n.claim.token });
    delete n.claim;
  }
  const claim = { pid: process.pid, token: randomUUID(), op, attempt: n.attempt || 1, at: Date.now() };
  n.claim = claim;
  return claim;
}

function taskIdOf(t) { return typeof t === 'string' ? t : t.run_id; }

// ---------- spawns out of the transaction (C3b) ----------
//
// A driver or the daemon spawned inside mutateTask outlived a transaction that then threw: a live
// process nothing recorded. A site now stamps a reservation on the holder - a child ref's
// `spawning`, or task.daemon.spawning - {pid, token, attempt, reason, restarts}, judged by
// liveClaim like a node claim, and queues applySpawn with store.mjs afterCommit. applySpawn spawns
// outside the lock, then writes the driver back only if the holder still carries that token;
// otherwise it kills the new process (spawn_lost). A live reservation is a spawn already under way:
// the caller spawns nothing (the one-daemon guarantee). A stale one - a dead pid, or this pid with a
// token this process does not hold - is reclaimed (spawn_reclaimed). Neither a reclaim nor a
// spawn_lost spends a driver_restarts unit: a restart is counted only when applySpawn writes it.

// The holder a reservation lives on, found again in a fresh read: 'daemon', 'S' (the size-S run),
// or a dispatch node id (its child).
function spawnHolder(task, slot) {
  if (slot === 'daemon') return task.daemon || null;
  if (slot === 'S') return task.harness_run || task.s_run || null;
  const n = getNode(task, slot);
  return (n && n.child) || null;
}

function spawning(holder) {
  return !!(holder && holder.spawning && liveClaim(holder.spawning));
}

// Test seam: called once (then cleared) after the reserving transaction committed and before the
// spawn - the window a second caller arrives in.
function fireAfterReserve(info) {
  const h = __storeHooks.afterReserve;
  if (!h) return;
  __storeHooks.afterReserve = null;
  h(info);
}

// r: {attempt, reason, restarts, spawn(task, holder) -> process record, apply(task, holder, rec)}.
// Returns false when a live reservation already stands (nothing reserved).
function reserveSpawn(task, slot, holder, r) {
  // Nothing spawns for a cancelled task, or into a directory that is gone (the daemon's own cwd
  // included): the stop is recorded instead (worktreeGoneStop). The scan in advanceDispatches and
  // the daemon step finds the usual cases first; this is the backstop at the one spawn gate.
  if (task.cancelled || task.worktree_gone) return false;
  const dir = slot === 'daemon' ? task.cwd : holder.cwd;
  if (dir && !existsSync(dir)) {
    const n = slot === 'daemon' || slot === 'S' ? null : getNode(task, slot);
    worktreeGoneStop(task, {
      kind: slot === 'daemon' ? 'task_cwd' : 'package', node_id: n ? n.node_id : null, subgoal_id: n ? n.subgoal_id : null,
      key: n ? null : `${epicKey(task.run_id)}${slot === 'S' ? '/S' : ''}`, path: dir,
    });
    return false;
  }
  if (holder.spawning) {
    if (liveClaim(holder.spawning)) return false;
    record(task, { event: 'spawn_reclaimed', task_id: task.run_id, node_id: slot, pid: holder.spawning.pid, token: holder.spawning.token });
    delete holder.spawning;
  }
  // No transaction on this task (foldChild's dead-driver respawn on foldDispatch's snapshot, which
  // its apply copies back): no lock to leave, so spawn in place.
  if (!inTransaction(task.run_id)) {
    let reservation = null;
    if (capped(slot)) {
      const got = reserveSlot(task, { label: slot });
      if (!got.ok) { noteWaiting(task, holder, slot, got); return false; }
      reservation = got.slot;
    }
    try {
      const rec = r.spawn(task, holder);
      if (reservation) reservation.attach(rec);
      clearWaiting(task, holder, slot);
      r.apply(task, holder, rec);
    } finally {
      if (reservation) reservation.release();
    }
    return true;
  }
  const token = randomUUID();
  holder.spawning = { pid: process.pid, token, attempt: r.attempt, reason: r.reason, restarts: r.restarts };
  heldClaims.add(token);
  afterCommit(() => applySpawn(task.run_id, slot, token, r), () => heldClaims.delete(token));
  return true;
}

// The daemon is not a driver: only `claude -p` drivers (a child run, the size-S harness run) count
// against max_live_drivers. A test that spawns nothing (noDriver) has no driver to count.
function capped(slot) {
  return slot !== 'daemon' && !noDriver();
}

function applySpawn(taskId, slot, token, r) {
  let rec = null;
  let kept = false;
  let reservation = null;
  let atCap = null;
  try {
    fireAfterReserve({ task_id: taskId, slot, token });
    const snap = loadRunAt(taskPath(taskId));
    const h = snap && spawnHolder(snap, slot);
    // Lost before the spawn (taken over or cleared in the window): start nothing.
    if (h && h.spawning && h.spawning.token === token) {
      if (capped(slot)) {
        const got = reserveSlot(snap, { label: slot });
        if (got.ok) reservation = got.slot; else atCap = got;
      }
      if (!atCap) {
        rec = r.spawn(snap, h);
        if (reservation) reservation.attach(rec);
      }
    }
    kept = mutateTask(taskId, (fresh) => {
      const holder = spawnHolder(fresh, slot);
      const holds = !!(holder && holder.spawning && holder.spawning.token === token);
      // At the cap: nothing was spawned, the reservation is dropped and the wait is recorded once;
      // whoever services this holder next (the daemon tick, a tm_next) asks again.
      if (holds && atCap) {
        delete holder.spawning;
        noteWaiting(fresh, holder, slot, atCap);
        return false;
      }
      if (!holds || !rec) {
        record(fresh, { event: 'spawn_lost', task_id: taskId, node_id: slot, token, pid: rec ? rec.pid : null, holder: holder && holder.spawning ? holder.spawning.token : null });
        if (holds) delete holder.spawning;
        return false;
      }
      delete holder.spawning;
      clearWaiting(fresh, holder, slot);
      r.apply(fresh, holder, rec);
      return true;
    });
  } finally {
    // Not written (lost, or the apply threw): nothing tracks this process, so it does not run.
    if (!kept && rec) killDriver(rec);
    // A reservation that holds the spawned pid stays as registry evidence until the pid dies.
    if (reservation) reservation.release();
    heldClaims.delete(token);
  }
}

// A package or size-S driver respawn: the new driver carries `restarts` and `event` is recorded
// with its pid.
function respawnDriver(task, slot, holder, { attempt, reason, restarts, spawn, event }) {
  return reserveSpawn(task, slot, holder, {
    attempt, reason, restarts, spawn,
    apply: (t, h, fresh) => {
      fresh.restarts = restarts;
      h.driver = fresh;
      delete h.stalled_since; // a fresh driver has made no progress yet, but it has also not stalled
      record(t, event(t, fresh));
    },
  });
}

// Test seam: called once (then cleared) after an open's effect returned and its intent was noted,
// before the apply transaction - the window a crash or a lost apply lands in.
function fireAfterEffect(info) {
  const h = __storeHooks.afterEffect;
  if (!h) return;
  __storeHooks.afterEffect = null;
  h(info);
}

// ---------- open intents (goal repair 1) ----------
//
// openChild's effect is real the moment it happens: a child run file, a detached driver. Its apply
// can still be claim_lost, throw (ELOCKTIMEOUT), or never run (the process died). The intent file
// opening/<token>.json, written before the effect and added to as it goes (the child run, the
// driver, then the finished node fields and the held ledger lines), is how that effect is found
// again: a lost apply undoes it, and the reclaim of a stale open adopts it when it finished, else
// undoes it - so a worktree never gets a second driver beside an orphaned first.
function intentPath(taskId, token) { return join(taskDir(taskId), 'opening', `${token}.json`); }
function readIntent(taskId, token) {
  try { return JSON.parse(readFileSync(intentPath(taskId, token), 'utf8')); } catch { return null; }
}
function noteIntent(taskId, token, patch) {
  writeAtomic(intentPath(taskId, token), { ...(readIntent(taskId, token) || {}), ...patch });
}
function dropIntent(taskId, token) {
  try { rmSync(intentPath(taskId, token), { force: true }); } catch { /* a leftover intent of an applied open is never read */ }
}

// Stop the intent's driver and mark its child run retired. `task` is the transaction's task when
// called inside one (the ledger line rides that commit), else a {run_id} for a direct write.
function undoOpen(task, intent, reason) {
  const driver = intent.driver || null;
  const killed = killDriver(driver);
  let retired = false;
  if (intent.child_run_id && intent.cwd) {
    try {
      mutateRun(join(intent.cwd, '.teams_output', 'broker', 'runs', `${intent.child_run_id}.json`), (r) => {
        r.retired = { by: 'teams', node_id: intent.node_id, reason, at: Date.now() };
      });
      retired = true;
    } catch { /* no run file yet (the effect stopped before createRun wrote it), or unreadable */ }
  }
  record(task, {
    event: 'open_undone', task_id: task.run_id, node_id: intent.node_id, token: intent.token, reason,
    child_run_id: intent.child_run_id || null, pid: driver ? driver.pid : null, killed, retired,
  });
}

function fireAfterClaim(info) {
  const h = __storeHooks.afterClaim;
  if (!h) return;
  __storeHooks.afterClaim = null;
  h(info);
}

// The apply transaction: fn(fresh, node) runs only if the node still holds this claim at the same
// attempt and in `expectState`. Otherwise claim_lost, and nothing from the effect is written (only
// our own claim marker is dropped, if it is still there).
export function applyClaim(taskId, nodeId, claim, expectState, fn) {
  try {
    return mutateTask(taskId, (fresh) => {
      const f = getNode(fresh, nodeId);
      const holds = f && f.claim && f.claim.token === claim.token;
      if (!holds || (f.attempt || 1) !== claim.attempt || f.state !== expectState) {
        record(fresh, {
          event: 'claim_lost', task_id: fresh.run_id, node_id: nodeId, op: claim.op, token: claim.token,
          state: f ? f.state : null, attempt: f ? (f.attempt || 1) : null, holder: f && f.claim ? f.claim.token : null,
        });
        if (holds) delete f.claim;
        return { lost: true };
      }
      delete f.claim;
      return { lost: false, value: fn(fresh, f) };
    });
  } finally {
    heldClaims.delete(claim.token);
  }
}

// The effect threw (or never ran): drop the claim so the node is runnable again. A dispatch that
// was moved to running by its open claim goes back to pending. Never masks the original error.
function releaseClaim(taskId, nodeId, claim, err) {
  try {
    mutateTask(taskId, (fresh) => {
      const f = getNode(fresh, nodeId);
      if (!f || !f.claim || f.claim.token !== claim.token) return;
      delete f.claim;
      if (claim.op === 'open' && f.state === 'running' && !f.child) f.state = 'pending';
      record(fresh, { event: 'claim_failed', task_id: fresh.run_id, node_id: nodeId, op: claim.op, token: claim.token, error: String((err && err.message) || err).slice(0, 300) });
    });
  } catch { /* the claim stays; its owner pid's death (or this token leaving heldClaims) frees it */ }
  heldClaims.delete(claim.token);
}

// Node fields each effect writes (and nothing else): what the apply copies back.
const CLAIM_EFFECTS = {
  open: { state: 'running', fields: ['state', 'result', 'started_at', 'child', 'base_commit', 'waiting_cap'], run: (task, n, progress) => openChild(task, n, progress) },
  integrate: { state: 'pending', fields: ['state', 'result', 'integration'], run: (task, n) => prepareIntegration(task, n) },
  'plan-integrate': { state: 'pending', fields: ['prd', 'state', 'result'], run: (task, n) => preparePlanIntegration(task, n) },
};

// claims: [{node_id, claim}] from one claim transaction. Effects run one by one, each on a fresh
// read of task.json (so a later one sees what an earlier apply wrote), outside the lock. Returns
// how many were applied.
function runClaimed(taskId, claims) {
  for (const c of claims) heldClaims.add(c.claim.token);
  const open = new Set(claims);
  let applied = 0;
  try {
    fireAfterClaim({ op: claims[0].claim.op, task_id: taskId, node_ids: claims.map((c) => c.node_id) });
    for (const c of claims) {
      const eff = CLAIM_EFFECTS[c.claim.op];
      const snap = loadRunAt(taskPath(taskId));
      const n = snap && getNode(snap, c.node_id);
      if (!n || !n.claim || n.claim.token !== c.claim.token) {
        // Lost before the effect ran (a tm_submit took the node meanwhile): no effect at all.
        open.delete(c);
        applyClaim(taskId, c.node_id, c.claim, eff.state, () => null);
        continue;
      }
      const isOpen = c.claim.op === 'open';
      let held = [];
      if (isOpen) {
        noteIntent(taskId, c.claim.token, { node_id: c.node_id, token: c.claim.token, attempt: c.claim.attempt });
        beginEffectLedger();
        try {
          eff.run(snap, n, (p) => noteIntent(taskId, c.claim.token, p));
        } catch (e) {
          held = takeEffectLedger();
          for (const l of held) record({ run_id: taskId }, l); // evidence of how far it got
          undoOpen({ run_id: taskId }, readIntent(taskId, c.claim.token) || { node_id: c.node_id, token: c.claim.token }, `open threw: ${String((e && e.message) || e).slice(0, 200)}`);
          dropIntent(taskId, c.claim.token);
          throw e;
        }
        held = takeEffectLedger();
        noteIntent(taskId, c.claim.token, { fields: pickFields(n, eff.fields), ledger: held });
        open.delete(c);
        fireAfterEffect({ op: c.claim.op, task_id: taskId, node_id: c.node_id, node: n });
      } else {
        eff.run(snap, n);
        open.delete(c);
      }
      // A throw here (ELOCKTIMEOUT) leaves the intent: the node keeps a claim this process no
      // longer holds, and the next reclaim adopts the open from it.
      const out = applyClaim(taskId, c.node_id, c.claim, eff.state, (fresh, f) => {
        for (const k of eff.fields) {
          if (k in n) f[k] = n[k];
          else delete f[k];
        }
        for (const l of held) record(fresh, l);
      });
      if (isOpen) {
        if (out.lost) undoOpen({ run_id: taskId }, readIntent(taskId, c.claim.token), 'claim_lost: the node moved while it was being opened');
        dropIntent(taskId, c.claim.token);
      }
      if (!out.lost) applied++;
    }
  } catch (e) {
    for (const c of open) releaseClaim(taskId, c.node_id, c.claim, e);
    throw e;
  }
  return applied;
}

function pickFields(n, fields) {
  const out = {};
  for (const k of fields) if (k in n) out[k] = n[k];
  return out;
}

// A dispatch moved to running by an open claim whose owner died (or whose apply threw) before the
// apply. Its intent says how far the effect got: finished with a child -> adopted (the node takes
// the child and its live driver, and the held dispatch lines are written now); otherwise its driver
// is stopped and its child run retired, and the node goes back to pending for the claim pass below.
// Returns the intent tokens to drop once this transaction commits.
function reclaimOrphanedOpens(task) {
  const settled = [];
  for (const n of task.nodes) {
    if (n.stage !== 'dispatch' || n.state !== 'running' || n.child || !n.claim || liveClaim(n.claim)) continue;
    const claim = n.claim;
    record(task, { event: 'claim_reclaimed', task_id: task.run_id, node_id: n.node_id, op: claim.op, pid: claim.pid, token: claim.token });
    delete n.claim;
    const intent = claim.op === 'open' ? readIntent(task.run_id, claim.token) : null;
    if (intent) settled.push(claim.token);
    if (intent && intent.fields && intent.fields.child && intent.attempt === (n.attempt || 1)) {
      for (const k of CLAIM_EFFECTS.open.fields) {
        if (k in intent.fields) n[k] = intent.fields[k];
        else delete n[k];
      }
      for (const l of intent.ledger || []) record(task, l);
      record(task, { event: 'open_adopted', task_id: task.run_id, node_id: n.node_id, token: claim.token, child_run_id: intent.fields.child.run_id, pid: intent.fields.child.driver ? intent.fields.child.driver.pid : null });
      continue;
    }
    if (intent) undoOpen(task, intent, `reclaimed: the open by pid ${claim.pid} never applied`);
    n.state = 'pending';
  }
  return settled;
}

// readyNodes minus what nobody may judge or hand out yet: a node another caller holds a live claim
// on, and an integrate / plan-integrate whose preparation (merges, tests, merged PRD) has not been
// applied. The daemon's judge pass and tm_next's ready list both read this (critique N1).
export function readyToJudge(task) {
  return readyNodes(task).filter((n) => {
    if (n.claim && liveClaim(n.claim)) return false;
    if (n.stage === 'integrate' && !n.integration) return false;
    if (n.stage === 'plan-integrate' && !n.prd) return false;
    return true;
  });
}

// Re-read task.json into the caller's object in place. A caller that holds a task object across a
// claim-owning call (advanceDispatches, prepareReadyIntegrations, foldDispatch) refreshes after
// it, so a later legacy saveRun of that object cannot carry the pre-claim node back.
export function refreshTask(task) {
  const fresh = loadRunAt(taskPath(task.run_id));
  if (!fresh) return task;
  for (const k of Object.keys(task)) if (!(k in fresh)) delete task[k];
  Object.assign(task, fresh);
  return task;
}

// Opens every ready dispatch node this poll is allowed to - the phase-Team exemption and
// max_parallel_teams for ordinary STORY packages - and returns how many it opened. Shared by
// tm_next (a caller driving the graph by hand, chiefly tests) and the daemon's own loop, so the
// two can never disagree about which dispatch is allowed to open when. Owns its transactions
// (claim -> openChild outside the lock -> apply): takes the task id, not a snapshot.
export function advanceDispatches(taskRef) {
  const taskId = taskIdOf(taskRef);
  let settledIntents = [];
  const claims = mutateTask(taskId, (task) => {
    settledIntents = reclaimOrphanedOpens(task);
    // A cancelled task opens nothing; a gone worktree (or task cwd) stops the task before any
    // driver is spawned into it (worktreeGoneStop).
    if (task.cancelled) return [];
    worktreeGoneStop(task);
    if (task.worktree_gone) return [];
    // budget/timebox stop: no NEW package opens once the task is over budget - a running one
    // (this check never sees, since it never touches state 'running') still finishes.
    if (task.budget_stopped) return [];
    // max_parallel_teams caps how many develop STORY dispatches run at once - phase-Team
    // packages (planning cards, QA cards, AUDIT) are exempt, both from the count and from the cap
    // itself. They never run beside a develop STORY (planning precedes shape; a QA round starts only
    // once its integrate has every package done, and its defects are filed only once the whole
    // round has settled - settleQaRound), and the cards of one phase are meant to run in parallel
    // where their deps allow (_repo/docs/plans/2026-09-28-teams-cards-everywhere.md principle 5).
    const out = [];
    const take = (n) => {
      // max_live_drivers: a pre-claim look, counting what this pass already took. openChild takes
      // the slot for real (livecap.mjs); this keeps a full machine from claim churn every poll.
      if (!noDriver()) {
        const look = capPeek(task, { extra: out.length });
        if (!look.ok) { noteWaiting(task, n, n.node_id, look); return false; }
        clearWaiting(task, n, n.node_id);
      }
      const claim = claimNode(task, n, 'open');
      if (!claim) return false;
      n.state = 'running';
      out.push({ node_id: n.node_id, claim });
      return true;
    };
    const isPhaseTeam = (n) => { const pkg = packageOf(task, n.subgoal_id); return !!(pkg && (pkg.phase === 'planning' || pkg.phase === 'qa' || pkg.phase === 'audit')); };
    const readyDispatch = readyNodes(task).filter((n) => n.stage === 'dispatch');
    for (const n of readyDispatch) {
      if (!isPhaseTeam(n)) continue;
      take(n);
    }
    // A fixed number (team.json, a tm_open argument, or - pre-0.36.0 - the only default there ever
    // was) is used exactly as given, unconditionally: numeric max_parallel_teams is a promise to the
    // caller, not a suggestion this controller is free to override. Anything else - 'auto' (the
    // default now), or a task.json written before task.team existed at all (createTask has set
    // task.team on every task since taskmanager.mjs:187, so only a pre-existing file on disk still
    // reaches this) - falls through to the AIMD controller above, which self-initializes from the
    // shape's widest round once spec.packages exists (AIMD_START, the number this cap used to be
    // pinned at forever, until then or when the shape has no width).
    const configuredMax = task.team && task.team.opts && task.team.opts.max_parallel_teams;
    const autoState = Number.isInteger(configuredMax) ? null : ensureAutoParallel(task);
    // (test-defaults.mjs pins the last arm's exact text, so the null case is its own arm above it.)
    const maxParallel = Number.isInteger(configuredMax) ? configuredMax
      : !autoState ? AIMD_START
        : ensureAutoParallel(task).current;
    // A STORY still opening (claimed, no child yet) is running and holds its slot.
    const runningStories = task.nodes.filter((n) => n.stage === 'dispatch' && n.state === 'running' && !isPhaseTeam(n)).length;
    let slots = Math.max(0, maxParallel - runningStories);
    const storyReady = readyDispatch.filter((n) => !isPhaseTeam(n))
      .sort((a, b) => {
        const pa = packageOf(task, a.subgoal_id);
        const pb = packageOf(task, b.subgoal_id);
        return (Number.isInteger(pa && pa.priority) ? pa.priority : 0) - (Number.isInteger(pb && pb.priority) ? pb.priority : 0);
      });
    for (const n of storyReady) {
      if (slots <= 0) break;
      if (take(n)) slots--;
    }
    if (autoState) {
      recordAutoParallelTick(task, autoState, {
        running: task.nodes.filter((n) => n.stage === 'dispatch' && n.state === 'running' && !isPhaseTeam(n)).length,
        ready_waiting: storyReady.filter((n) => n.state !== 'running').length,
      });
    }
    return out;
  });
  for (const t of settledIntents) dropIntent(taskId, t);
  if (!claims.length) return 0;
  return runClaimed(taskId, claims);
}

// Every running dispatch whose driver is no longer alive gets serviced here: respawned on the
// same run_id, or parked on capacity, before anyone ever sees it as something to fold. Only a
// spent restart budget leaves it dead. Returns how many it touched.
export function serviceRunningDispatches(task) {
  applySuspends(task);
  if (task.cancelled) return 0;
  worktreeGoneStop(task);
  if (task.worktree_gone) return 0;
  let serviced = 0;
  for (const n of task.nodes) {
    if (n.stage !== 'dispatch' || n.state !== 'running' || !n.child || !n.child.driver) continue;
    if (serviceDeadDriver(task, n.child, n.node_id)) serviced++;
    else if (serviceStalledDriver(task, n.child, n.node_id)) serviced++;
  }
  return serviced;
}

// Integration is mechanical up to the checks: the worktree and the merges are done here, in
// dependency order, so a conflict is a fact the manager saw and not a claim a node made. Only
// after this does an integrate node's own judging (composeTaskPrompt's CONTRACT.integrate) run.
// Claimed like a dispatch open (the merges and npm test run outside the lock); the node stays
// pending with its claim, and readyToJudge keeps it from a judge until the apply lands.
export function prepareReadyIntegrations(taskRef) {
  const taskId = taskIdOf(taskRef);
  const claims = mutateTask(taskId, (task) => {
    const out = [];
    for (const n of readyNodes(task)) {
      // The planning integrate (C4) is prepared the same way: its merge is the manager's, made
      // before its judge is called, so the judge reads a 10-prd.md that exists.
      const op = n.stage === 'plan-integrate' && !n.prd ? 'plan-integrate'
        : n.stage === 'integrate' && !n.integration ? 'integrate'
          : null;
      if (!op) continue;
      const claim = claimNode(task, n, op);
      if (claim) out.push({ node_id: n.node_id, claim });
    }
    return out;
  });
  if (!claims.length) return 0;
  return runClaimed(taskId, claims);
}

// One dispatch's fold - foldChild (which commits an accepted package's worktree) then
// updateAutoParallel + finish - shared by the daemon's fold loop and tm_submit, under a fold
// claim: a second caller arriving while the first holds it gets {busy}, one arriving after gets
// the stored verdict ({idempotent: true}). foldChild runs outside the lock on a fresh copy;
// finish runs inside the apply transaction on the fresh task. A child still running comes back
// {deferred, reason} (the dead-driver respawn foldChild may have made is applied first).
// Returns finish's output, or {busy|deferred|lost|idempotent|opening}.
export function foldDispatch(taskRef, nodeId, caller = 'tm_submit') {
  const taskId = taskIdOf(taskRef);
  const got = mutateTask(taskId, (task) => {
    const n = getNode(task, String(nodeId));
    if (!n) throw new Error(`unknown node ${nodeId}`);
    if (n.stage !== 'dispatch') throw new Error(`${n.node_id} is not a dispatch node`);
    if (n.state !== 'running') {
      if (n.state !== 'pending' && n.result) {
        return { done: { ...verdict(task, n), idempotent: true, note: `node ${n.node_id} already ${n.state}; returning the stored result, no work repeated` } };
      }
      throw new Error(`dispatch ${n.node_id} is ${n.state}; only a running dispatch can be folded`);
    }
    if (!n.child) return { opening: n.claim || {} };
    if (n.claim && liveClaim(n.claim)) return { busy: n.claim };
    return { claim: claimNode(task, n, 'fold') };
  });
  if (got.done) return got.done;
  if (got.opening) {
    return { opening: true, reason: `dispatch ${nodeId} is still opening: its child run is being created${got.opening.pid ? ` by pid ${got.opening.pid}` : ''}; poll tm_next and submit it once it is running` };
  }
  if (got.busy) {
    return { busy: true, reason: `dispatch ${nodeId} is already being folded (${got.busy.op} claim by pid ${got.busy.pid}); poll tm_status for its verdict` };
  }
  const claim = got.claim;
  heldClaims.add(claim.token);
  let n;
  let result;
  let childBefore;
  try {
    fireAfterClaim({ op: 'fold', task_id: taskId, node_ids: [String(nodeId)], caller });
    const snap = loadRunAt(taskPath(taskId));
    n = snap && getNode(snap, String(nodeId));
    if (!n || !n.claim || n.claim.token !== claim.token) {
      applyClaim(taskId, String(nodeId), claim, 'running', () => null);
      return { lost: true, reason: `dispatch ${nodeId}: fold claim lost before the fold ran` };
    }
    childBefore = JSON.stringify(n.child);
    result = foldChild(snap, n);
  } catch (e) {
    releaseClaim(taskId, String(nodeId), claim, e);
    throw e;
  }
  const childChanged = JSON.stringify(n.child) !== childBefore;
  const out = applyClaim(taskId, String(nodeId), claim, 'running', (fresh, f) => {
    if (childChanged) f.child = n.child;
    if (result && result.deferred) return { deferred: true, reason: result.reason };
    updateAutoParallel(fresh, f, result);
    return finish(fresh, f, result);
  });
  if (out.lost) return { lost: true, reason: `dispatch ${nodeId}: the node moved while it was being folded (claim_lost); nothing applied` };
  return out.value;
}

// gate:human (D2 Task 4): a manager-graph judging node (shape/critique/accept/integrate/gate/
// gate:goal) named in human_gates never reaches a driver - see graph.mjs's promoteHumanGates
// for why this is safe to call on task.json unmodified (it is itself a run). Interactive parks
// it for tm_inbox/tm_submit; non-interactive auto-passes it through the same finish() a
// driver's own submission would take. Exported and called from both tm_next (toolNext, a
// caller driving the graph by hand) and the daemon's own loop (daemon.mjs's stepOnceInner,
// right before it judges every ready reasoning node) - same reason advanceDispatches/
// prepareReadyIntegrations are shared rather than each caller deciding readiness on its own:
// the daemon judges every ready node directly, with no tool boundary in between, so a hook
// that only lived in toolNext would never fire on an autonomous run.
export function promoteManagerHumanGates(task) {
  const { parked, autoPass } = promoteHumanGates(task);
  for (const n of autoPass) finish(task, n, autoPassHumanGateResult(n));
  if (parked.length) {
    for (const n of parked) writeManagerBriefing(task, n);
    saveRun(task);
  }
  return { parked, autoPass };
}

function toolNext(a) {
  const first = withTask(a, (task) => {
    if (task.cancelled) return { out: { task_id: task.run_id, state: 'cancelled', counts: {}, flow: task.flow !== 'auto' ? task.flow : (task.flow_chosen || 'auto'), ready: [], children: [], next: 'this task was cancelled with tm_cancel: nothing more runs' } };
    // Refresh the shared engagement marker in every tree a live driver is working in, so the
    // harness gate's 2h window never closes on a long package (see engage.mjs).
    for (const n of task.nodes) {
      if (n.child && n.child.cwd && n.state === 'running') touchMarker(n.child.cwd, task.run_id);
    }
    if (task.harness_run) {
      touchMarker(task.harness_run.cwd, task.run_id);
      return { out: toolNextHarness(task) };
    }
    if (task.s_run) return { out: toolNextSRun(task) };
    // Dispatch nodes run here, the moment they are ready. Doing it in tm_next rather than in
    // a separate call means a caller driving the graph by hand cannot forget to, and cannot do it
    // twice - the same three steps the daemon's own loop runs, shared through the exports above so
    // the two never diverge on what "ready" means.
    enforceBudget(task);
    closeFailedPlanning(task);
    return { id: task.run_id };
  });
  if (first.out) return first.out;
  // Both own their transactions (claim -> effect outside the lock -> apply), so they run between
  // this handler's transactions, never inside one; each phase below starts from a fresh read.
  advanceDispatches(first.id);
  withTask({ task_id: first.id }, (task) => { serviceRunningDispatches(task); });
  prepareReadyIntegrations(first.id);
  const task = withTask({ task_id: first.id }, (fresh) => { promoteManagerHumanGates(fresh); return fresh; });
  const state = runState(task);
  const ready = readyToJudge(task).map((n) => {
    const p = briefingPath(task, n);
    try { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, composeTaskPrompt(task, n)); } catch { /* status full is the fallback */ }
    return { node_id: n.node_id, stage: n.stage, briefing_path: p, next: 'dispatch briefing_path to a fresh native agent, then tm_submit' };
  });
  const budget = Number.isInteger(task.driver_restarts) ? task.driver_restarts : 2;
  // A dispatch claimed by another caller and not yet applied: running, no child run yet.
  const opening = task.nodes.filter((n) => n.stage === 'dispatch' && n.state === 'running' && !n.child).map((n) => ({
    node_id: n.node_id, package_id: n.subgoal_id, opening: true,
    next: `its child run is being opened${n.claim && n.claim.pid ? ` (claimed by pid ${n.claim.pid})` : ''}; poll tm_next`,
  }));
  const children = task.nodes.filter((n) => n.stage === 'dispatch' && n.state === 'running' && n.child).map((n) => {
    const child = loadRun(n.child.cwd, n.child.run_id);
    const childState = child ? runState(child).state : 'missing';
    const driver = n.child.driver || null;
    const alive = driverAlive(driver);
    const waiting = n.child.waiting_capacity || null;
    const stalled = n.child.stalled_since || null;
    const restarts = (driver && driver.restarts) || [];
    const fold = `tm_submit({task_id, node_id: "${n.node_id}"})`;
    let next;
    if (childState !== 'running') next = fold;
    else if (!driver) next = `team_next({run_id: "${n.child.run_id}", cwd: "${n.child.cwd}"}) and drive it; tm_submit this node when complete`;
    else if (waiting) next = `waiting on provider capacity (${waiting.reason.slice(0, 160)}); tell the user the reset time and stop. tm_retry({task_id, package_id: "${n.subgoal_id}", reset_capacity:true}) resumes it`;
    else if (alive && stalled) next = `its driver process (pid ${driver.pid}) is alive but has made no progress since ${new Date(stalled).toISOString()} (stall_minutes); poll tm_next - past 3x stall_minutes it is killed and respawned on its own`;
    else if (alive) next = `its driver process (pid ${driver.pid}) is running this child: wait; poll tm_next; do not drive this child yourself`;
    else next = `driver died and the restart budget (${budget}) is spent: ${fold} folds it as blocked with every attempt's stderr, then tm_retry({package_id: "${n.subgoal_id}"}) reopens it (or reopen the task with child_driver "inline" to drive children yourself)`;
    return {
      node_id: n.node_id,
      package_id: n.subgoal_id,
      cwd: n.child.cwd,
      run_id: n.child.run_id,
      branch: n.child.branch,
      child_state: childState,
      ...(driver ? { driver: { pid: driver.pid, alive, log: driver.log, ...(restarts.length ? { restarts: restarts.length } : {}) } } : {}),
      ...(waiting ? { waiting_capacity: waiting } : {}),
      ...(stalled ? { stalled_since: stalled } : {}),
      next,
    };
  });
  return {
    task_id: task.run_id,
    state: state.state,
    counts: state.counts,
    ...(task.size ? { size: task.size } : {}),
    flow: task.flow !== 'auto' ? task.flow : (task.flow_chosen || 'auto'),
    ready,
    children: [...children, ...opening],
    ...(daemonExhaustedNext(task) ? { next: daemonExhaustedNext(task) } : {}),
  };
}

// At-least-once delivery, this layer's own copy of broker.mjs's idempotentSubmit (same reasoning:
// _repo/docs/plans/2026-09-23-teams-reducer-human-rollback.md §5). Matters more here than at the
// node layer - a dispatch node's fold (foldChild) commits the package's worktree on accept
// (taskmanager.mjs's commitWorktree), and finish() runs shape validation, QA/audit defect
// filing and much else besides; none of it is safe to run twice on the same node. node_id
// already carries the round/attempt for every stage that retries (dispatch:P1:2, shape:2,
// gate:goal:3), so {task_id, node_id} is the key in the common case; `attempt` is one more check.
function idempotentSubmit(task, n, a) {
  if (!n || n.state === 'pending' || n.state === 'running' || !n.result) return null;
  if (a.attempt != null && Number(a.attempt) !== (n.attempt || 1)) return null;
  return { ...verdict(task, n), idempotent: true, note: `node ${n.node_id} already ${n.state}; returning the stored result, no work repeated` };
}

function toolSubmit(a) {
  // The idempotency check, the finish and delegateIfSmall all run on one fresh read in one
  // transaction; a throw anywhere in it (a refused payload) leaves neither the node nor the
  // tm_submit ledger line behind.
  const r = withTask(a, (task) => {
    if (task.cancelled) throw new Error('task cancelled: tm_cancel stopped it, nothing more is submitted to it');
    if (a.key) return { out: toolSubmitHuman(task, a) };
    const already = idempotentSubmit(task, getNode(task, String(a.node_id)), a);
    if (already) return { out: already };
    const n = requireRunnable(task, String(a.node_id));
    if (n.stage === 'dispatch' && a.payload && Object.keys(a.payload).length) throw new Error('a dispatch node takes no payload: the manager reads the child run itself');
    record(task, { event: 'tm_submit', task_id: task.run_id, node_id: String(a.node_id) });
    if (n.stage === 'dispatch') return { fold: { taskId: task.run_id, nodeId: n.node_id } };
    const payload = a.payload || {};
    const result = { ...payload, stage_ok: payload.stage_ok !== false };
    const out = finish(task, n, result);
    return { out: delegateIfSmall(task, n, out) || out };
  });
  if (!r.fold) return withHarnessFields(r.out, a.task_id);
  // The same claimed fold the daemon makes (foldDispatch): the two can no longer both fold it.
  // It owns its transactions (the fold commits git outside the lock), so it runs after ours.
  const out = foldDispatch(r.fold.taskId, r.fold.nodeId, 'tm_submit');
  if (out.opening || out.busy || out.deferred || out.lost) throw new Error(out.reason);
  return out;
}

// tm_submit({task_id, key, payload}): the human's own answer for a waiting_human card. Through
// 0.27.2 this was the one write this file ever made to a child run, and 0.27.3 kept it that way
// (loadRun+saveRun'd the child directly) - a violation of this file's own header, rule 2, and of
// design §7 (a human's implement/draft/cases is supposed to get "changed_files는 워크트리 대조로
// 똑같이 검증", the same worktree cross-check an AI's report gets; 0.27.3 took stage_ok at face
// value instead, no cross-check at all). Caught by the 2026-09-24 review. Fixed the same way
// tm_assign above is: computeSubmitResult (broker.mjs, imported - see this file's header, rule 3)
// runs the real cross-check and verdict logic read-only, against a loadRun'd copy of the child
// that is never saved, so this call can still answer synchronously and correctly without writing
// anything; queueHumanAction leaves the actual payload as a manager-owned handoff, and the broker
// applies it for real - through that SAME function, plus finishNode - the next time anything
// calls mustFindRun for this run. Everything downstream of a real "done" (test, review, gate, and
// a rejection's own retry back to waiting_human - graph.mjs's applyHumanPin, called again by
// retrySubgoal) still runs through the real broker once the child's driver resumes, exactly as it
// always has; only WHO performs the verdict on THIS node's own payload changed.
// A human_gate card's payload is {accept, reason?, gaps?}, not driver-shaped JSON - converted
// here, once, into the stage's own result shape (graph.mjs's humanGateResultFromPayload) before
// it goes anywhere a driver's own submission would (computeSubmitResult/finish), so every
// downstream reader sees the same shape regardless of who judged the node.
function humanSubmitPayload(n, rawPayload) {
  if (!n.human_gate) return rawPayload || {};
  if (typeof (rawPayload || {}).accept !== 'boolean') {
    throw new Error(`${n.node_id} is a human gate (gate:human): payload needs {accept: true|false, reason?, gaps?}`);
  }
  return humanGateResultFromPayload(n, rawPayload);
}

// The manager-graph twin of the child-run branch below: pkgId 'TASK' addresses task.nodes
// directly (a run/task-level card - setgoal/plan/critique/gate:goal generalized questions, or
// gate:human on shape/critique/accept/integrate/gate/gate:goal). task.json is this file's own
// to write (unlike a child run, rule 2's "READS child run files and never writes them" does not
// apply here), so this calls finish() directly instead of queueing through the broker - there
// is no driver to resume, the manager graph has none of its own.
function toolSubmitHumanManager(task, key, nodeId, rawPayload) {
  const n = getNode(task, nodeId);
  if (!n || n.state !== 'waiting_human') {
    throw new Error(n ? `${key}'s card (${nodeId}) is ${n.state}, not waiting_human - nothing to submit` : `${key} has no card waiting on a human`);
  }
  if (n.stage === 'ask' && !Array.isArray((rawPayload || {}).decisions)) {
    throw new Error(`${key}'s card (${nodeId}) is a decision: payload needs decisions[], one {question, chose} per question in tm_inbox`);
  }
  // A STORY's forwarded question (tm_ask): the person's answer is the text they chose, and it is
  // checked before anything is written - an answer with no text would resume the driver on nothing.
  const story = n.stage === 'ask' && n.ask_id ? (task.story_asks || []).find((x) => x.ask_id === n.ask_id) : null;
  const storyAnswer = story ? storyAnswerText(rawPayload) : null;
  if (story && !storyAnswer) throw new Error(`${key}'s card is a STORY's question: its answer needs text (decisions[].chose)`);
  const shaped = humanSubmitPayload(n, rawPayload);
  // finish() (unlike broker.mjs's computeSubmitResult) does not default stage_ok on a raw
  // submission - a driver's own JSON always states it, but a person answering a decisions[]
  // card typically does not. Same default computeSubmitResult gives the child-run path: absent
  // means true, only an explicit false means false.
  const payload = { ...shaped, stage_ok: shaped.stage_ok !== false };
  n.vendor = 'human';
  delete n.model;
  const verdictOut = finish(task, n, payload);
  record(task, { event: 'tm_submit_human', task_id: task.run_id, key, node_id: nodeId, ...(n.ask_id ? { ask_id: n.ask_id } : {}), stage_ok: verdictOut.stage_ok === true, answer: answerText(rawPayload) });
  if (story && story.state === 'forwarded') storyAskAnswered(task, story, { answer: storyAnswer, by: 'person', route: 'forward' });
  return { task_id: task.run_id, key, node_id: nodeId, state: n.state, result: n.result };
}

function toolSubmitHuman(task, a) {
  const key = String(a.key);
  const parsed = parseTicketKey(key);
  if (!parsed || !parsed.pkgId || !parsed.subgoalId) throw new Error(`tm_submit({key}) needs a TASK key (E-xxxxxxxx/Pn/subgoalId), got "${key}"`);
  const { pkgId, subgoalId } = parsed;
  // 'TASK' is not a real package id (STORY keys are 'P1', 'P2', ... - shape's own package.id) -
  // it is the pseudo-package this module's own toolInbox/inboxEntry key a manager-level node
  // under, since such a node has no package to belong to at all.
  if (pkgId === 'TASK') return toolSubmitHumanManager(task, key, subgoalId, a.payload || {});
  const dispatch = latestBySubgoal(task, pkgId, 'dispatch');
  if (!dispatch || !dispatch.child) throw new Error(`${key} has no child run yet`);
  const child = loadRun(dispatch.child.cwd, dispatch.child.run_id);
  if (!child) throw new Error(`${key}'s child run file is missing`);
  const sg = child.spec && (child.spec.subgoals || []).find((s) => String(s.id) === subgoalId);
  // A card this same task already queued an answer for (this tick's own earlier tm_submit, not
  // yet drained by the broker) is not `waiting_human` on disk yet either - queueHumanAction below
  // never flips it. Without this, a second submission of the same card would see the same stale
  // waiting_human node the first call did and be accepted twice.
  const alreadyQueued = new Set(peekHumanActions(dispatch.child.cwd, dispatch.child.run_id)
    .filter((x) => x.kind === 'submit').map((x) => x.node_id));
  let n;
  if (sg) {
    // The waiting node, not the predicted one. authorStage answered this while a pinned author
    // stage was the only thing that could park here; an `ask` node (graph.mjs's openAsk) is not
    // in the kind's chain at all, so computing its id was never possible. A subgoal has at most
    // one card open at a time by construction - ask sits on draft's dep edge, so the two can
    // never be waiting together - and authorStage stays as the name used to explain an empty
    // inbox for this key.
    const attempt = currentAttempt(child, subgoalId);
    const waiting = child.nodes.filter((x) => String(x.subgoal_id) === subgoalId && x.state === 'waiting_human' && !alreadyQueued.has(x.node_id));
    if (!waiting.length) {
      const predicted = `${authorStage(kindOf(sg))}:${subgoalId}:${attempt}`;
      const n0 = getNode(child, predicted);
      throw new Error(n0
        ? `${key}'s card (${predicted}) is ${alreadyQueued.has(predicted) ? 'submitted, awaiting the broker' : n0.state}, not waiting_human - nothing to submit`
        : `${key} has no card waiting on a human`);
    }
    // Ambiguity is refused, not resolved by picking. Answers belong to the card that asked for
    // them; applying one owner's decisions to another owner's questions would be silent and wrong.
    if (waiting.length > 1) {
      throw new Error(`${key} has ${waiting.length} cards waiting (${waiting.map((x) => x.node_id).join(', ')}) - name one: ${waiting.map((x) => taskKey(task.run_id, pkgId, x.node_id)).join(' | ')}`);
    }
    n = waiting[0];
  } else {
    // No subgoal by that id: the key's third segment is a run-level node's own node_id instead
    // (setgoal/plan/critique/gate:goal - subgoal_id null, generalized questions or gate:human -
    // see inboxEntry's key scheme, taskmanager.mjs). Same card machinery either way from here.
    const n0 = getNode(child, subgoalId);
    if (!n0 || n0.state !== 'waiting_human' || alreadyQueued.has(n0.node_id)) {
      throw new Error(n0
        ? `${key}'s card (${n0.node_id}) is ${alreadyQueued.has(n0.node_id) ? 'submitted, awaiting the broker' : n0.state}, not waiting_human - nothing to submit`
        : `no subgoal or node ${subgoalId} in ${key}'s child run`);
    }
    n = n0;
  }
  const nodeId = n.node_id;
  if (n.stage === 'ask' && !Array.isArray((a.payload || {}).decisions)) {
    throw new Error(`${key}'s card (${nodeId}) is a decision: payload needs decisions[], one {question, chose} per question in tm_inbox`);
  }

  const payload = humanSubmitPayload(n, a.payload || {});
  const { result, done } = computeSubmitResult(child, n, payload, 'human');
  const answeredAt = Date.now();
  queueHumanAction(dispatch.child.cwd, dispatch.child.run_id, { kind: 'submit', node_id: nodeId, payload, answered_at: answeredAt });
  record(task, { event: 'tm_submit_human', task_id: task.run_id, key, node_id: nodeId, stage_ok: result.stage_ok, answer: answerText(a.payload) });

  // The driver already exited the moment nothing was left ready for it (zero compute while
  // waiting - graph.mjs's promoteWaitingHuman). Resume it now, the same shape clearCapacity
  // already uses for its own "not a crash, don't spend a restart" respawn: restarts carries
  // over untouched, because this is exactly what the driver was always going to do next, not a
  // failure it is recovering from. This is task.json's own dispatch node, this file's to write
  // either way (rule 2 is about the CHILD run, not the task's own).
  // Only when nothing is driving the run: a sibling subgoal still in flight keeps its driver
  // alive, and that driver picks the answered node up on its next team_next. A second driver on
  // the same run would dispatch the same ready nodes twice.
  resumeParkedDriver(task, dispatch.node_id, dispatch.child, 'human_submitted'); // inside toolSubmit's transaction
  return { task_id: task.run_id, key, node_id: nodeId, state: done ? 'done' : 'failed', result };
}

export { readIntent, reserveSpawn, respawnDriver, spawning, toolNext, toolSubmit };
