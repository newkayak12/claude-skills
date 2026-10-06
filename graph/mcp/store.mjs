// store.mjs - graph's own transactional run store.
//
// Every run mutation is one transaction: take the lock, read the run fresh from disk,
// apply fn to it, write tmp + rename, release. A writer never holds a snapshot across
// an await and writes it back later - that is what let a slow broker's stale copy erase
// a node another broker had finished.
//
// graph and teams are separate plugins. teams owns a store with the same API names; this
// one is graph's, written and tested independently. Neither imports the other.

import { mkdirSync, readFileSync, writeFileSync, renameSync, rmSync, statSync, unlinkSync, linkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

// An ownerless lock (a process killed between mkdir and writing owner.json, or a lock
// from a broker that predates owner records) is broken once it is this old; so is a steal
// lock with no readable owner record.
const LOCK_STALE_MS = 30 * 1000;
const SPIN_MS = 5;

export class LockTimeoutError extends Error {
  constructor(path, ms, owner) {
    super(`run store lock ${path} still held${owner ? ` by pid ${owner.pid}` : ''} after ${ms} ms`);
    this.name = 'LockTimeoutError';
    this.code = 'ELOCKTIMEOUT';
  }
}

export function runFilePath(cwd, runId) {
  return join(cwd, '.harness-run', 'broker', 'runs', runId + '.json');
}

function lockTimeoutMs() {
  const v = Number(process.env.GRAPH_LOCK_TIMEOUT_MS);
  return v > 0 ? v : 5000;
}

// Same host only: the lock lives next to the run file, and a run is driven from one machine.
export function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM'; // exists, owned by someone else
  }
}

const sleepCell = new Int32Array(new SharedArrayBuffer(4));
function sleepSync(ms) {
  Atomics.wait(sleepCell, 0, 0, ms);
}

function readOwner(lockDir) {
  try {
    return JSON.parse(readFileSync(join(lockDir, 'owner.json'), 'utf8'));
  } catch {
    return null;
  }
}

// 'gone' (vanished), 'held' (a live owner, or an ownerless lock young enough to be an
// acquirer between its mkdir and its owner write), or 'dead'.
function judge(dir, owner) {
  if (owner) return pidAlive(owner.pid) ? 'held' : 'dead';
  try {
    return Date.now() - statSync(dir).mtimeMs > LOCK_STALE_MS ? 'dead' : 'held';
  } catch {
    return 'gone';
  }
}

function sameOwner(a, b) {
  if (!a || !b) return !a && !b;
  return a.token === b.token && a.pid === b.pid;
}

// Break a lock only when its holder is provably gone; a live owner pid is never stolen
// from, however long it has held the lock. Breaking is serialized by a steal lock, and
// under it the main lock is re-read: it is removed only if it still is the very lock that
// was judged dead (same owner token). Without that, a waiter that judged the dead lock a
// moment ago removes the live lock another process has just acquired after breaking it -
// two holders, and a lost update. Ordinary acquirers only ever mkdir, which cannot succeed
// while the dead lock exists, so only the steal-lock holder removes a lock it does not own.
//
// That re-check is only as good as the steal lock's exclusivity, so the steal lock must
// never have two live holders - and a dead holder's steal lock is never removed by name to
// free it (a breaker that judged it dead a moment ago would remove the live one taken
// meanwhile, and a third breaker then overlaps the second). Instead:
//
//   `<lock>.steal` is a FILE carrying its owner record from the moment it exists (written
//   to a tmp file, then link()ed into place; link fails EEXIST). A dead holder (dead pid,
//   or no readable record and an mtime past LOCK_STALE_MS: crash or hand damage) is
//   succeeded: the next breaker links `<lock>.steal.<dead holder's key>`, a name only that
//   dead holder produces, so exactly one link() wins it; a dead successor is succeeded the
//   same way (a chain, one link per dead breaker). The winner re-checks that the file it
//   succeeded is still that same dead file. Only the live holder removes the chain, after
//   its critical section, oldest link first, each after an identity check. So a successful
//   link whose predecessor is still present means no holder of that name ever reached
//   cleanup - it is the only one; a vanished predecessor means the chain was finished and
//   this link is spurious, so it is dropped.
//
// Nothing waits on the steal lock: a busy one returns null and the acquire loop retries
// under its own deadline. An old-format steal directory (owner.json inside) is judged the
// same way and removed recursively by the chain's holder.
const STEAL_CHAIN_MAX = 32;

function readRecord(file) {
  try {
    const o = JSON.parse(readFileSync(file, 'utf8'));
    return o && typeof o === 'object' ? o : null;
  } catch {
    return null;
  }
}

// Who holds a steal-chain entry: {token, ino, dir, key (names its successor), alive}; null = gone.
function stealHolder(path) {
  let st;
  try { st = statSync(path); } catch { return null; }
  const dir = st.isDirectory();
  const o = dir ? readOwner(path) : readRecord(path);
  if (o && o.pid && o.token) {
    const key = String(o.token).replace(/[^\w-]/g, '').slice(0, 40) || `i${st.ino}`;
    return { token: String(o.token), ino: st.ino, dir, key, alive: pidAlive(o.pid) };
  }
  return { token: null, ino: st.ino, dir, key: `i${st.ino}-${Math.floor(st.mtimeMs)}`, alive: Date.now() - st.mtimeMs <= LOCK_STALE_MS };
}

function sameHolder(path, h) {
  const now = stealHolder(path);
  return !!now && now.ino === h.ino && now.token === h.token;
}

function takeSteal(lock) {
  const token = randomUUID();
  const tmp = `${lock}.stealtmp.${process.pid}.${token.slice(0, 8)}`;
  try { writeFileSync(tmp, JSON.stringify({ pid: process.pid, at: Date.now(), token })); } catch { return null; }
  try {
    const dead = []; // [{path, holder}] oldest first
    let path = lock + '.steal';
    for (let i = 0; i < STEAL_CHAIN_MAX; i++) {
      try {
        linkSync(tmp, path);
      } catch (e) {
        if (e.code !== 'EEXIST') return null;
        const holder = stealHolder(path);
        if (!holder || holder.alive) return null; // vanished (retry) or a live breaker
        dead.push({ path, holder });
        path = `${lock}.steal.${holder.key}`;
        continue;
      }
      const h = { path, token, dead };
      const parent = dead[dead.length - 1];
      if (parent && !sameHolder(parent.path, parent.holder)) {
        releaseSteal({ path, token, dead: [] });
        return null;
      }
      return h;
    }
    return null;
  } finally {
    try { unlinkSync(tmp); } catch { /* already gone */ }
  }
}

function holdsSteal(h) {
  const o = readRecord(h.path);
  return !!o && o.token === h.token;
}

// Oldest dead link first, own link last: while any link of the chain exists, no second
// breaker can link the same successor name.
function releaseSteal(h) {
  for (const { path, holder } of h.dead) {
    if (!sameHolder(path, holder)) continue;
    try {
      if (holder.dir) rmSync(path, { recursive: true, force: true });
      else unlinkSync(path);
    } catch { /* best-effort */ }
  }
  if (holdsSteal(h)) { try { unlinkSync(h.path); } catch { /* best-effort */ } }
}

// Returns true when the caller should retry its mkdir at once, false to wait.
function tryBreak(lock) {
  const owner = readOwner(lock);
  const verdict = judge(lock, owner);
  if (verdict === 'gone') return true;
  if (verdict === 'held') return false;

  const h = takeSteal(lock);
  if (!h) return false;
  try {
    const now = readOwner(lock);
    const v = judge(lock, now);
    if (v === 'gone') return true;
    if (v === 'dead' && sameOwner(now, owner) && holdsSteal(h)) {
      rmSync(lock, { recursive: true, force: true });
      return true;
    }
    return false;
  } finally {
    releaseSteal(h);
  }
}

export function acquireLock(path) {
  const lock = path + '.lock';
  mkdirSync(dirname(path), { recursive: true });
  const timeout = lockTimeoutMs();
  // Monotonic: a wall-clock jump (wake from sleep, NTP step) must not expire the wait.
  const deadline = performance.now() + timeout;
  const token = randomUUID();
  for (;;) {
    try {
      mkdirSync(lock);
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      if (tryBreak(lock)) continue;
      if (performance.now() > deadline) throw new LockTimeoutError(path, timeout, readOwner(lock));
      sleepSync(SPIN_MS);
      continue;
    }
    try {
      writeFileSync(join(lock, 'owner.json'), JSON.stringify({ pid: process.pid, at: Date.now(), token }));
    } catch (e) {
      rmSync(lock, { recursive: true, force: true });
      throw e;
    }
    return { lock, token };
  }
}

export function releaseLock(handle) {
  if (!handle) return;
  const owner = readOwner(handle.lock);
  // Only remove a lock that is still ours.
  if (owner && owner.token !== handle.token) return;
  try {
    rmSync(handle.lock, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
}

// A reader must never see a half-written file: write a sibling tmp, then rename over.
export function writeAtomic(path, obj) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(tmp, typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2) + '\n');
    renameSync(tmp, path);
  } catch (e) {
    try { unlinkSync(tmp); } catch { /* already gone */ }
    throw e;
  }
}

// path -> the document of the transaction this process has open on it.
const open = new Map();

export function activeTransaction(path) {
  const tx = open.get(path);
  return tx ? tx.doc : null;
}

function apply(fn, doc) {
  const out = fn(doc);
  if (out && typeof out.then === 'function') {
    out.then(() => {}, () => {});
    throw new TypeError('mutateRun fn must be synchronous: a transaction cannot span an await');
  }
  return out;
}

// mutateRun(cwd, runId, fn) or mutateRun(path, fn). fn mutates the fresh run in place and
// its return value is returned. fn throwing aborts: nothing is written. A transaction
// that changes nothing writes nothing. A nested call on the same path joins the outer
// transaction.
export function mutateRun(a, b, c) {
  const [path, fn] = typeof b === 'function' ? [a, b] : [runFilePath(a, b), c];
  if (typeof fn !== 'function') throw new TypeError('mutateRun needs a function');
  const outer = open.get(path);
  if (outer) return apply(fn, outer.doc);

  const handle = acquireLock(path);
  try {
    let raw;
    try {
      raw = readFileSync(path, 'utf8');
    } catch (e) {
      if (e.code === 'ENOENT') throw new Error(`no run file at ${path}`);
      throw e;
    }
    const doc = JSON.parse(raw);
    const before = JSON.stringify(doc);
    open.set(path, { doc });
    let out;
    try {
      out = apply(fn, doc);
    } finally {
      open.delete(path);
    }
    if (JSON.stringify(doc) !== before) writeAtomic(path, doc);
    return out;
  } finally {
    releaseLock(handle);
  }
}
