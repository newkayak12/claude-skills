// graph-runfile.mjs - where a run lives on disk, and the human-action handoff queue (cut from graph.mjs).
//
// Runs live at <cwd>/.teams_output/broker/runs/<run_id>.json. Every read, write, lock and merge of
// a run file, and the queue a manager writes into a child run it does not own, is here. It reads
// no spec and builds no node: it has no import from another graph-*.mjs module.

import { mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync, renameSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { acquireLock as acquire, releaseLock as release, transactionObject, mutateRun } from './store.mjs';

function runsDir(cwd) {
  return join(cwd, '.teams_output', 'broker', 'runs');
}

function runPath(cwd, runId) {
  return join(runsDir(cwd), runId + '.json');
}

// A human's pin (tm_assign) or card answer (tm_submit({key})) crosses from the TaskManager's
// process into a child run it does not own. This directory is NOT runsDir - queueHumanAction
// never touches a run file - so the manager can record the human's intent without being the
// one who writes the child's graph (README: "a child graph run is written only by its own
// broker... the broker opens it, never a node"). The broker drains it (broker.mjs's
// ingestHandoff, called from mustFindRun) and applies each action for real, through the exact
// functions - applyPinAction above, computeSubmitResult+finishNode in broker.mjs - the
// manager's own preview already ran read-only. Before 0.27.4 this queue did not exist:
// taskmanager.mjs loadRun+saveRun'd the child directly, because broker.mjs bound process.stdin
// at module scope and could not be imported for its real logic at all (2026-09-24 review
// against this file's own header and design §7's "changed_files는 워크트리 대조로 똑같이 검증").
function handoffDir(cwd) {
  return join(cwd, '.teams_output', 'broker', 'handoffs');
}

function handoffPath(cwd, runId) {
  return join(handoffDir(cwd), runId + '.json');
}

function readHandoffQueue(cwd, runId) {
  try {
    const queue = JSON.parse(readFileSync(handoffPath(cwd, runId), 'utf8'));
    return Array.isArray(queue) ? queue : [];
  } catch {
    return [];
  }
}

// The manager's own write - appends, never touches runPath. Write-then-rename for the same
// torn-read reason saveRun uses it: a broker mid-drainHumanActions must never see a half-written
// queue.
export function queueHumanAction(cwd, runId, action) {
  const path = handoffPath(cwd, runId);
  mkdirSync(dirname(path), { recursive: true });
  // Under the same lock the drain takes. Unlocked, a drain landing between this read and this
  // rename either lost the action pushed here or applied the one it had just drained twice.
  const lock = acquire(path);
  try {
    const queue = readHandoffQueue(cwd, runId);
    queue.push(action);
    const tmp = `${path}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
    writeFileSync(tmp, JSON.stringify(queue));
    renameSync(tmp, path);
  } finally {
    release(lock);
  }
}

// The manager's own read of what it has queued but the broker has not drained yet, so a second
// tm_assign/tm_submit in the same tick previews against its own prior call instead of the stale
// on-disk child - peekHumanActions never deletes; only drainHumanActions (the broker's read) does.
export function peekHumanActions(cwd, runId) {
  return readHandoffQueue(cwd, runId);
}

// The broker's own read: drains (reads, then removes) so the same action is never applied
// twice. Only ever called from mustFindRun (broker.mjs) - see the header comment above.
export function drainHumanActions(cwd, runId) {
  const path = handoffPath(cwd, runId);
  if (!existsSync(path)) return [];
  const lock = acquire(path);
  try {
    const queue = readHandoffQueue(cwd, runId);
    if (queue.length) {
      try { rmSync(path, { force: true }); } catch { /* already gone */ }
    }
    return queue;
  } finally {
    release(lock);
  }
}

// A run file is read-modify-written by every mutation, and a node can be held open for
// minutes while a vendor works. Two brokers on one run therefore raced: the slow one's
// stale snapshot overwrote a node the fast one had already finished and reported `done`
// to its client. The work had happened; only the record vanished.
//
// The lock is store.mjs's (mkdir + owner.json): it throws ELOCKTIMEOUT instead of the old
// "fall through unlocked rather than hang" after 5 s, and never steals from a live owner pid
// (2026-10-02 review). A busy lock now surfaces as an error, not as a silent unlocked write.

// Where this run's file is. The broker's runs live under their project; a run that manages
// other runs (the TaskManager's) lives outside any project and says so with `store_path`.
// Everything else - lock, merge, save, load - keys off this one function.
export function pathOf(run) {
  return run.store_path || runPath(run.cwd, run.run_id);
}

// Apply this process's view of the run onto whatever is currently on disk, instead of
// replacing it. Nodes another broker finished while we were working are kept. Child runs only
// (the broker's): a task (store_path) is written by store.mjs mutateTask and never reaches here.
function mergeOnto(fresh, mine) {
  if (!fresh) return mine;
  const byId = new Map(fresh.nodes.map((n) => [n.node_id, n]));
  for (const n of mine.nodes) {
    const cur = byId.get(n.node_id);
    // A terminal state on disk that we never saw belongs to another broker: keep it.
    const recoveringOwnExecution = cur?.state === 'running' && cur.ticket
      && n.recovery?.from_ticket === cur.ticket;
    // A deliberate reopen (the daemon re-judging a node whose judge never judged - autoRejudge)
    // carries a higher `reopened` count than the disk copy; that is the one legitimate way back
    // from a terminal state to pending.
    const reopenedOnPurpose = n.state === 'pending' && (n.reopened || 0) > ((cur && cur.reopened) || 0);
    if (cur && cur.state !== 'pending' && n.state === 'pending' && !recoveringOwnExecution && !reopenedOnPurpose) continue;
    byId.set(n.node_id, n);
  }
  const freshEpoch = fresh.capacity_epoch || 0;
  const mineEpoch = mine.capacity_epoch || 0;
  const unavailable = freshEpoch > mineEpoch ? fresh.unavailable_vendors
    : mineEpoch > freshEpoch ? mine.unavailable_vendors
      : { ...(fresh.unavailable_vendors || {}), ...(mine.unavailable_vendors || {}) };
  return { ...fresh, ...mine, nodes: [...byId.values()],
    capacity_epoch: Math.max(freshEpoch, mineEpoch), unavailable_vendors: unavailable || {} };
}

export function saveRun(run) {
  const path = pathOf(run);
  // Inside mutateTask/mutateRun on this file: the transaction owns the write. Only its own object
  // is accepted - a second object for the same path (a helper that re-read via loadRunAt, a handler
  // still holding its own `task`) would have its changes vanish at commit with no error.
  const held = transactionObject(path);
  if (held) {
    if (held !== run) throw new Error(`saveRun inside mutateTask on ${path} got a different object than the transaction holds - its changes would be lost; mutate the transaction's object`);
    return run;
  }
  // A task (store_path) is written only through mutateTask - always; there is no flag or env escape.
  // A child run (no store_path; teams broker.mjs) is merged onto the fresh disk copy inside a
  // mutateRun transaction: the broker holds its run across awaits, so it cannot be the fn itself.
  if (run.store_path) {
    throw new Error(`saveRun of task ${run.run_id || path} outside mutateTask - task.json is written only through store.mjs mutateTask`);
  }
  // mutateRun writes then renames (seam-beta-D2: a reader must never see a torn child run) and
  // skips the write when the merge left the file as it was.
  const merged = mutateRun(path, (disk) => {
    const out = mergeOnto(Array.isArray(disk.nodes) ? disk : null, run);
    for (const k of Object.keys(disk)) delete disk[k];
    Object.assign(disk, out);
    return out;
  }, { create: true });
  // Keep the caller's object consistent with what was written.
  run.nodes = merged.nodes;
  run.capacity_epoch = merged.capacity_epoch || 0;
  run.unavailable_vendors = merged.unavailable_vendors || {};
  return run;
}

export function loadRunAt(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

export function loadRun(cwd, runId) {
  return loadRunAt(runPath(cwd, runId));
}

// A run id alone is enough to find the run when the caller did not pass a cwd,
// as long as some cwd is known to this process.
export function findRun(runId, cwds) {
  for (const c of cwds) {
    if (!c) continue;
    const r = loadRun(c, runId);
    if (r) return r;
  }
  return null;
}

export function listRuns(cwd) {
  try {
    return readdirSync(runsDir(cwd))
      .filter((f) => f.endsWith('.json'))
      .map((f) => loadRun(cwd, f.slice(0, -5)))
      .filter(Boolean);
  } catch {
    return [];
  }
}
