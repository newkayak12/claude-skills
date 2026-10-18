// teams/mcp/livecap.mjs - the one place the machine-wide cap on live teams-spawned `claude -p`
// processes (drivers and judges) is counted and reserved (team.json max_live_drivers, default 4).
//
// Every driver and judge spawn site goes through reserveSlot()/peek() here: taskmanager.mjs's
// reserveSpawn/applySpawn (every respawn, the size-S harness driver), openChild (a package's first
// driver) and advanceDispatches (the pre-claim peek), and daemon.mjs's judge pass. At or over the
// spawning task's own cap a site does not spawn: the node stays ready, noteWaiting() records one
// `waiting_cap` ledger event for the wait, and the daemon re-checks on its next poll (<= 15 s).
// There is no timeout.
//
// What counts: the pids recorded in every task.json under tasksRoot() (a package or size-S
// driver, and a judge's pid on n.judging.proc) plus a registry of reservations kept beside them
// (<root>/.livecap/registry.json) for the window between a spawn and the task.json write that
// records it. A pid is pruned when it is dead OR when it is alive but is not the process that was
// recorded (it started after the record was made, or its command line does not match): a reused
// pid must not hold a slot forever. The daemon and node-adapter processes are never counted; an
// interactive session is not in any task.json. Count and reserve run under one lock (a directory
// under the tasks root) so two daemons cannot both take the last slot; a lock older than
// LOCK_STALE_MS is stolen, and a lock that cannot be had at all fails OPEN (the cap is a safety
// valve, not an integrity rule).

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { pidAlive } from './proc.mjs';
import { tasksRoot, record } from './taskstate.mjs';

const RESERVE_TTL_MS = 5 * 60 * 1000; // a reservation with no pid yet (worktree + run creation run inside it)
const START_SLACK_MS = 3000; // ps reports whole seconds
const LOCK_STALE_MS = 10 * 1000;
const LOCK_WAIT_MS = 12 * 1000;

// The spawning task's own cap: createTask resolves max_live_drivers (default TEAM_DEFAULTS) onto
// every task it opens. A task.json written before the key existed carries none and is not held
// back by it - the default applies when a task is opened, not retroactively to one already on
// disk. Its processes still count against everyone else's cap.
export function capOf(task) {
  const v = task && task.team && task.team.opts && task.team.opts.max_live_drivers;
  return Number.isInteger(v) && v >= 1 ? v : Number.POSITIVE_INFINITY;
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// {zombie, start: epoch ms | null, command: string | null} of a pid, or null when ps cannot say.
// A killed child that nobody has reaped yet still answers a signal probe; its ps state is Z.
export function procInfo(pid) {
  try {
    const out = execFileSync('ps', ['-ww', '-o', 'stat=,lstart=,command=', '-p', String(pid)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).replace(/^\s+/, '').split('\n')[0];
    if (!out) return null;
    const stat = out.split(/\s+/)[0];
    const rest = out.slice(stat.length).replace(/^\s+/, '');
    const start = Date.parse(rest.slice(0, 24));
    return { zombie: stat.startsWith('Z'), start: Number.isFinite(start) ? start : null, command: rest.slice(24).trim() || null };
  } catch {
    return null;
  }
}

// Alive and not a zombie.
export function liveProc(pid) {
  if (!pidAlive(pid)) return false;
  const info = procInfo(pid);
  return !(info && info.zombie);
}

// A recorded {pid, started_at, command} still names the live process it was written for.
export function sameProcess(entry) {
  if (!entry || !entry.pid || !pidAlive(entry.pid)) return false;
  const info = procInfo(entry.pid);
  if (!info) return true; // cannot tell: trust the signal probe
  if (info.zombie) return false;
  if (Number.isFinite(entry.started_at) && info.start !== null && info.start > entry.started_at + START_SLACK_MS) return false;
  if (entry.command && info.command) {
    const bin = basename(String(entry.command).split(' ')[0]);
    if (bin && !info.command.includes(bin)) return false;
  }
  return true;
}

// ---------- the lock ----------

function dirs(root) {
  const base = join(root, '.livecap');
  return { base, lock: join(base, 'lock'), registry: join(base, 'registry.json') };
}

function withLock(root, fn) {
  const { base, lock } = dirs(root);
  mkdirSync(base, { recursive: true });
  const deadline = Date.now() + LOCK_WAIT_MS;
  let held = false;
  for (;;) {
    try { mkdirSync(lock); held = true; break; } catch (e) {
      if (!e || e.code !== 'EEXIST') break;
    }
    try {
      if (Date.now() - statSync(lock).mtimeMs > LOCK_STALE_MS) {
        try { renameSync(lock, `${lock}.stale.${randomUUID()}`); } catch { /* another stealer won */ }
        continue;
      }
    } catch { continue; } // released between the mkdir and the stat
    if (Date.now() > deadline) break;
    sleepSync(15);
  }
  try {
    return fn(held);
  } finally {
    if (held) { try { rmSync(lock, { recursive: true, force: true }); } catch { /* best-effort */ } }
  }
}

function readRegistry(root) {
  try {
    const r = JSON.parse(readFileSync(dirs(root).registry, 'utf8'));
    return Array.isArray(r.entries) ? r.entries : [];
  } catch {
    return [];
  }
}

function writeRegistry(root, entries) {
  const { registry } = dirs(root);
  const tmp = `${registry}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(tmp, JSON.stringify({ entries }));
  renameSync(tmp, registry);
}

// ---------- counting ----------

// The driver and judge processes one task.json records.
export function recordedProcesses(task) {
  const out = [];
  const add = (d, where) => { if (d && Number.isInteger(d.pid)) out.push({ pid: d.pid, started_at: d.started_at, command: d.command, where, task_id: task.run_id }); };
  for (const n of task.nodes || []) {
    add(n.child && n.child.driver, n.node_id);
    add(n.judging && n.judging.proc, `judge:${n.node_id}`);
  }
  add(task.harness_run && task.harness_run.driver, 'S');
  add(task.s_run && task.s_run.driver, 'S');
  return out;
}

function taskIds(root) {
  try { return readdirSync(root).filter((id) => !id.startsWith('.')); } catch { return []; }
}

// Live processes under `root`, one per pid. Prunes dead and mismatched registry entries when
// `prune` (the caller holds the lock).
export function liveProcesses(root = tasksRoot(), { prune = false } = {}) {
  const byPid = new Map();
  const now = Date.now();
  const entries = readRegistry(root);
  const keep = [];
  for (const e of entries) {
    const live = e.pid ? sameProcess(e) : (pidAlive(e.owner) && now - e.at < RESERVE_TTL_MS);
    if (!live) continue;
    keep.push(e);
    byPid.set(e.pid || `reservation:${e.token}`, { pid: e.pid || null, where: e.label || 'reservation', task_id: e.task_id || null, source: 'registry' });
  }
  if (prune && keep.length !== entries.length) { try { writeRegistry(root, keep); } catch { /* best-effort */ } }
  for (const id of taskIds(root)) {
    let task;
    try { task = JSON.parse(readFileSync(join(root, id, 'task.json'), 'utf8')); } catch { continue; }
    for (const p of recordedProcesses(task)) {
      if (byPid.has(p.pid)) continue;
      if (sameProcess(p)) byPid.set(p.pid, { pid: p.pid, where: p.where, task_id: p.task_id, source: 'task' });
    }
  }
  return [...byPid.values()];
}

// The registry's processes for one task: a spawn that has a pid but may not be on task.json yet.
export function registryProcesses(taskId, root = tasksRoot()) {
  return readRegistry(root).filter((e) => e.pid && e.task_id === taskId)
    .map((e) => ({ pid: e.pid, started_at: e.started_at, command: e.command, where: e.label || 'reservation' }));
}

// Count only, no reservation: a pre-claim look. {ok, live, cap}; `extra` is what the caller has
// already decided to start in this pass.
export function peek(task, { root = tasksRoot(), extra = 0 } = {}) {
  const cap = capOf(task);
  const live = liveProcesses(root).length + extra;
  return { ok: live < cap, live, cap };
}

// Take one slot. {ok: true, live, cap, slot} or {ok: false, live, cap}. slot.attach(rec) records
// the spawned process (rec.pid/started_at/command) so it keeps counting until it is recorded in
// a task.json and after; slot.release() drops a reservation that never got a pid. Call release in
// a finally.
export function reserveSlot(task, { root = tasksRoot(), label = '' } = {}) {
  const cap = capOf(task);
  return withLock(root, (held) => {
    const live = liveProcesses(root, { prune: held }).length;
    if (live >= cap) return { ok: false, live, cap };
    const entry = { token: randomUUID(), owner: process.pid, at: Date.now(), task_id: task.run_id || null, label };
    if (held) writeRegistry(root, [...readRegistry(root), entry]);
    const update = (fn) => withLock(root, (h) => {
      if (!h) return;
      writeRegistry(root, readRegistry(root).flatMap((e) => (e.token === entry.token ? fn(e) : [e])));
    });
    return {
      ok: true, live, cap,
      slot: {
        token: entry.token,
        attach(rec) {
          if (!rec) return;
          update((e) => [{ ...e, pid: Number.isInteger(rec.pid) ? rec.pid : undefined, started_at: rec.started_at, command: rec.command }]);
        },
        // A reservation holding a pid stays as registry evidence until that pid dies; one with
        // none (the spawn failed or never ran) is dropped.
        release() { update((e) => (e.pid ? [e] : [])); },
      },
    };
  });
}

// ---------- waiting ----------

// One `waiting_cap` event per wait. The mark lives on the holder (the pending node, a child, the
// harness run) so another process sees it; the in-process set covers a holder whose write does
// not survive (a snapshot).
const announced = new Set();

export function noteWaiting(task, holder, key, info) {
  const k = `${task.run_id}:${key}`;
  if ((holder && holder.waiting_cap) || announced.has(k)) {
    announced.add(k);
    return false;
  }
  announced.add(k);
  if (holder) holder.waiting_cap = { since: Date.now(), live: info.live, cap: info.cap };
  record(task, { event: 'waiting_cap', task_id: task.run_id, node_id: key, live: info.live, cap: info.cap });
  return true;
}

export function clearWaiting(task, holder, key) {
  announced.delete(`${task.run_id}:${key}`);
  if (holder && holder.waiting_cap) { delete holder.waiting_cap; return true; }
  return false;
}
