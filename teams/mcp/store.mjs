// store.mjs - the one transactional writer of a task's task.json (2026-10-02 architecture review).
//
// Before this file every writer held its own snapshot of the task, saved it whenever it liked, and
// graph.mjs saveRun merged it onto disk with {...fresh, ...mine}: a node rule kept a finished node
// from being reverted, but every top-level field (spec.packages, decisions, budget_stopped, ...) was
// whatever the STALEST writer held. The daemon judges for minutes (daemon.mjs `await judge`) and then
// saved the snapshot it loaded before the await. The class has a history of local patches:
// seam-beta-D2 torn read in foldChild (0.13.2, write-then-rename), seam-silent-beta-E1 daemon read
// intermediate child state, v0.26.3 daemon + tm_submit double-folded one dispatch (only the git
// index.lock retry was fixed, not the double fold). And the lock itself fell through to an
// UNLOCKED write after 5 s (graph.mjs acquire, `return null; // fall through unlocked`).
//
// mutateTask(id | path, fn): acquire the lock -> read the file fresh -> fn(fresh) -> write tmp +
// rename -> flush the ledger lines fn recorded -> release, all inside one lock.
//
//   - Lock timeout THROWS (code ELOCKTIMEOUT, TEAMS_LOCK_TIMEOUT_MS, default 5000). Never an
//     unlocked write.
//   - A lock is never stolen from a live owner: the lock dir holds owner.json {pid, at, token}; it is
//     stolen only when that pid is dead. mtime counts only when no owner is recorded at all, and
//     only after LOCK_GRACE_MS - the window between mkdir and the owner.json write is not "no owner".
//     The old 30 s mtime steal let a second writer into a slow (SIGSTOPped, suspended) transaction.
//     Stealers serialise on `<lock>.steal` and remove only the lock they judged (see steal()).
//   - fn is synchronous. A thenable return throws before anything is written: an `await` inside the
//     lock is exactly the minutes-long snapshot this store exists to end.
//   - fn throwing aborts: nothing written, nothing recorded, the error rethrown.
//   - record() calls made inside a transaction (taskmanager.mjs record -> appendLedger) are buffered
//     and appended only after the OUTERMOST transaction commits, so an aborted write (inner or
//     outer) leaves no phantom event for tm_wait's nodeTransitionsSince to report.
//   - A transaction that left the object deep-equal to what it read does not rewrite the file
//     (tm_status and every tm_wait poll would otherwise churn task.json's mtime and the lock).
//   - Nested mutateTask on the same path in the same process joins the outer transaction.
//   - afterCommit(fn) queues a side effect (a process spawn) on the outermost transaction: it runs
//     after the write and the lock release, in queue order, and never if the transaction (or the
//     nested frame that queued it) throws. A spawn made inside fn outlived an aborted write as an
//     untracked live process (C3b, teams 0.40.0).
//
// graph.mjs saveRun is transaction-aware rather than rewritten at its 44 call sites: inside an active
// transaction on the same path it accepts only the transaction's own object (identity) and does no
// I/O - any other object for that path throws, since its changes would silently vanish at commit.
// Outside a transaction a saveRun of a task (store_path) always throws /outside mutateTask/ - there
// is no flag and no env escape; every task.json writer goes through mutateTask. A child run (no
// store_path; teams broker.mjs) is saved through mutateRun too, merging the caller's run onto the
// fresh disk copy inside the transaction (C3c, teams 0.40.0).

import { mkdirSync, readFileSync, writeFileSync, renameSync, rmSync, statSync, appendFileSync, unlinkSync, linkSync } from 'node:fs';
import { join, dirname, resolve, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { pidAlive } from './proc.mjs';

// No owner.json yet and the lock dir is younger than this: a writer that just won mkdir. Older and
// still no owner: a writer killed between mkdir and the owner write, or a pre-store lock - stealable.
const LOCK_GRACE_MS = 10 * 1000;

function lockTimeoutMs() {
  const v = Number(process.env.TEAMS_LOCK_TIMEOUT_MS);
  return Number.isFinite(v) && v > 0 ? v : 5000;
}

// Mirrors taskmanager.mjs tasksRoot/taskPath (asserted equal in test-store.mjs). Not imported:
// taskmanager.mjs imports graph.mjs, which imports this file.
function taskFile(taskId) {
  const root = process.env.HARNESS_TASKS_DIR ? resolve(process.env.HARNESS_TASKS_DIR) : join(homedir(), '.harness', 'tasks');
  return join(root, taskId, 'task.json');
}

function resolveTaskPath(idOrPath) {
  const s = String(idOrPath);
  return isAbsolute(s) || s.endsWith('.json') ? resolve(s) : taskFile(s);
}

// ---------- lock ----------

export class LockTimeoutError extends Error {
  constructor(path, owner, waitedMs) {
    super(`lock timeout after ${waitedMs} ms on ${path}`
      + (owner && owner.pid ? ` (held by pid ${owner.pid}${pidAlive(owner.pid) ? ', alive' : ''})` : ''));
    this.name = 'LockTimeoutError';
    this.code = 'ELOCKTIMEOUT';
    this.path = path;
    this.owner = owner || null;
  }
}

function readOwner(lockDir) {
  try {
    const o = JSON.parse(readFileSync(join(lockDir, 'owner.json'), 'utf8'));
    return o && typeof o === 'object' ? o : null;
  } catch {
    return null;
  }
}

const sleeper = new Int32Array(new SharedArrayBuffer(4));
function sleepMs(ms) { Atomics.wait(sleeper, 0, 0, ms); }

// Stealing is serialised through a steal lock, `<lock>.steal` - a FILE whose owner record exists
// from the moment it exists (written to a tmp file, then link()ed into place: link is atomic and
// fails EEXIST), so it has no owner-less window.
//
// Why: a waiter decides "dead" from an owner read made earlier. If it then moves or removes the
// lock path by NAME it can hit a lock another waiter has meanwhile stolen and re-taken (live); with
// that path gone a third waiter mkdirs it too, and two holders lose an update (U1 test-1: 2/105
// rounds). Inside the steal lock the main lock's owner is re-read and the lock removed only if it
// still carries the judged dead token (or, owner-less, is still past the grace). That re-check is
// only as good as the steal lock's exclusivity: two stealers that both judged token X could both
// pass it, one removes X and re-takes the path (Y), the other then removes Y. So the steal lock
// must never have two live holders - and a dead holder is never removed by name to free it:
//
//   A dead (or unreadable and older than LOCK_GRACE_MS: a crash or power loss mid-write, judged by
//   mtime like an owner-less main lock) holder of `<lock>.steal` is succeeded, not removed: the
//   next stealer links `<lock>.steal.<dead holder's token>`, a name only that dead holder can
//   produce, so exactly one link() wins it (and a dead successor is succeeded the same way - a
//   chain, one link per dead stealer). The winner then re-checks that the link it succeeded is
//   still that same dead file. The chain is removed only by its live holder after its critical
//   section, oldest link first, each unlink after an identity check. Hence a successful link whose
//   predecessor is still present means no holder of that name ever reached cleanup: it is the only
//   one; predecessor gone means the chain was finished and this link is spurious - dropped.
//
// Nothing waits on the steal lock: a busy one makes tryStealLock return null and the caller's
// acquire loop retries (its own deadline applies).
function readFileOwner(file) {
  try {
    const o = JSON.parse(readFileSync(file, 'utf8'));
    return o && typeof o === 'object' ? o : null;
  } catch {
    return null;
  }
}

const STEAL_CHAIN_MAX = 32;

// Who holds a steal-chain file: {token, ino, key (names its successor), alive}; null = vanished.
function stealHolder(file) {
  let st;
  try { st = statSync(file); } catch { return null; }
  const o = readFileOwner(file);
  if (o && o.pid && o.token) {
    const key = String(o.token).replace(/[^\w-]/g, '').slice(0, 40) || `i${st.ino}`;
    return { token: String(o.token), ino: st.ino, key, alive: pidAlive(o.pid) };
  }
  // Empty / unparsable / no pid: never written that way (tmp + link), so a crash or hand damage.
  return { token: null, ino: st.ino, key: `i${st.ino}-${Math.floor(st.mtimeMs)}`, alive: Date.now() - st.mtimeMs <= LOCK_GRACE_MS };
}

function sameHolder(file, h) {
  const now = stealHolder(file);
  return !!now && now.ino === h.ino && now.token === h.token;
}

function tryStealLock(lockDir) {
  const token = randomUUID();
  const tmp = `${lockDir}.stealtmp.${process.pid}.${token.slice(0, 8)}`;
  try { writeFileSync(tmp, JSON.stringify({ pid: process.pid, at: Date.now(), token })); } catch { return null; }
  try {
    const dead = []; // [{path, holder}] the dead links walked, oldest first
    let path = lockDir + '.steal';
    for (let i = 0; i < STEAL_CHAIN_MAX; i++) {
      try {
        linkSync(tmp, path);
      } catch (e) {
        if (!e || e.code !== 'EEXIST') return null;
        const holder = stealHolder(path);
        if (!holder || holder.alive) return null; // vanished (retry) or held by a live stealer
        dead.push({ path, holder });
        path = `${lockDir}.steal.${holder.key}`;
        continue;
      }
      const h = { stealPath: path, token, dead };
      const parent = dead[dead.length - 1];
      if (parent && !sameHolder(parent.path, parent.holder)) { releaseStealLock({ stealPath: path, token, dead: [] }); return null; }
      return h;
    }
    return null;
  } finally {
    try { unlinkSync(tmp); } catch { /* already gone */ }
  }
}

function stillHoldsSteal(h) {
  const o = readFileOwner(h.stealPath);
  return !!o && o.token === h.token;
}

// Oldest dead link first, own link last (see above: a predecessor present => chain not finished).
function releaseStealLock(h) {
  for (const { path, holder } of h.dead) {
    if (sameHolder(path, holder)) { try { unlinkSync(path); } catch { /* best-effort */ } }
  }
  if (stillHoldsSteal(h)) { try { unlinkSync(h.stealPath); } catch { /* best-effort */ } }
}

// Remove the main lock if, re-read under the steal lock, it is still the one judged abandoned.
// `judged` is the owner read at decision time (null = owner-less by mtime).
// Returns true when the lock was removed (retry mkdir at once); false = wait as for a live owner.
function steal(lockDir, judged) {
  const h = tryStealLock(lockDir);
  if (!h) return false;
  try {
    const now = readOwner(lockDir);
    let ageMs = 0;
    try { ageMs = Date.now() - statSync(lockDir).mtimeMs; } catch { return true; } // already gone
    const same = judged
      ? !!now && now.token === judged.token && now.pid === judged.pid && !pidAlive(now.pid)
      : !now && ageMs > LOCK_GRACE_MS;
    if (same && stillHoldsSteal(h)) { rmSync(lockDir, { recursive: true, force: true }); return true; }
    return false;
  } catch { return false; /* best-effort: the acquire loop retries */ } finally {
    releaseStealLock(h);
  }
}

// Returns a handle for releaseLock. Throws LockTimeoutError; never returns without the lock.
export function acquireLock(path) {
  const lockDir = path + '.lock';
  mkdirSync(dirname(path), { recursive: true });
  const waitMs = lockTimeoutMs();
  // Monotonic: a wall-clock jump (a sleep mid-wait, an NTP step) must not end the wait at once.
  // The stale-lock age checks below stay on mtimes, which are wall clock.
  const deadline = performance.now() + waitMs;
  const token = randomUUID();
  for (;;) {
    try {
      mkdirSync(lockDir);
      try { writeFileSync(join(lockDir, 'owner.json'), JSON.stringify({ pid: process.pid, at: Date.now(), token })); } catch { /* grace covers it */ }
      return { lockDir, token };
    } catch (e) {
      if (e && e.code !== 'EEXIST') throw e;
    }
    const owner = readOwner(lockDir);
    if (owner && owner.pid) {
      if (!pidAlive(owner.pid) && steal(lockDir, owner)) continue;
    } else {
      let ageMs = 0;
      try { ageMs = Date.now() - statSync(lockDir).mtimeMs; } catch { continue; } // vanished: retry
      if (ageMs > LOCK_GRACE_MS && steal(lockDir, null)) continue;
    }
    if (performance.now() > deadline) throw new LockTimeoutError(path, owner, waitMs);
    sleepMs(2 + Math.floor(Math.random() * 6));
  }
}

// Removes the lock only if it is still ours (a lock stolen from us by mistake is not ours to drop).
export function releaseLock(handle) {
  if (!handle) return;
  const owner = readOwner(handle.lockDir);
  if (owner && owner.token !== handle.token) return;
  try { rmSync(handle.lockDir, { recursive: true, force: true }); } catch { /* best-effort */ }
}

// ---------- atomic write ----------

// Write-then-rename: a reader in another process never sees a truncated file (seam-beta-D2, 0.13.2).
export function writeAtomic(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n';
  const tmp = `${path}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
  try {
    writeFileSync(tmp, text);
    renameSync(tmp, path);
  } catch (e) {
    try { unlinkSync(tmp); } catch { /* never created */ }
    throw e;
  }
}

// ---------- transactions ----------

// Innermost last. Synchronous fns mean only this one stack exists per process at any moment.
const frames = [];

function frameFor(path) {
  for (let i = frames.length - 1; i >= 0; i--) if (frames[i].path === path) return frames[i];
  return null;
}

// inTransaction() - is any transaction open in this process; inTransaction(path) - on that file.
export function inTransaction(path) {
  if (path === undefined) return frames.length > 0;
  return !!frameFor(resolveTaskPath(path));
}

// The object the open transaction on `path` holds, or null.
export function transactionObject(path) {
  const f = frameFor(resolve(path));
  return f ? f.obj : null;
}

// Ledger append that respects the open transaction: buffered on the innermost frame. When that
// frame commits its lines pass to the enclosing frame (a nested transaction on another file), and
// only the outermost commit appends them: an outer abort drops every line recorded under it, even
// one whose inner transaction already committed its own file. Any abort drops the frame's lines.
// Outside a transaction it appends at once.
export function appendLedger(file, line) {
  const f = frames[frames.length - 1];
  if (f) { f.ledger.push([file, line]); return; }
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, line);
}

// Queue fn to run once the outermost open transaction has committed and released its lock; outside
// a transaction it runs at once. onDiscard (optional) runs instead of fn when the transaction that
// queued it aborts - for undoing in-memory bookkeeping made alongside the queueing.
export function afterCommit(fn, onDiscard = null) {
  if (!frames.length) { fn(); return; }
  frames[0].after.push({ fn, onDiscard });
}

// Drop what was queued since `mark` (an aborted frame's share), running each onDiscard.
function discardAfter(mark) {
  if (!frames.length) return;
  for (const { onDiscard } of frames[0].after.splice(mark)) {
    if (onDiscard) { try { onDiscard(); } catch { /* bookkeeping only */ } }
  }
}

function isThenable(v) { return v && (typeof v === 'object' || typeof v === 'function') && typeof v.then === 'function'; }

function runSync(fn, obj) {
  if (fn && fn.constructor && fn.constructor.name === 'AsyncFunction') {
    throw new TypeError('mutateTask fn must be synchronous: an await inside the lock is the stale snapshot this store ends');
  }
  const out = fn(obj);
  if (isThenable(out)) {
    out.then(null, () => {}); // never an unhandled rejection from a refused fn
    throw new TypeError('mutateTask fn must be synchronous: it returned a thenable; nothing was written');
  }
  return out;
}

// mutateRun(path, fn, {create}) - the generic form. create: a missing file starts as {} (fn fills it).
export function mutateRun(path, fn, opts = {}) {
  const file = resolve(path);
  const joined = frameFor(file);
  if (joined) {
    // Same transaction - but a joined fn that throws (and is caught by the outer fn) keeps none of
    // the lines it recorded.
    const mark = frames[frames.length - 1].ledger.length;
    const afterMark = frames[0].after.length;
    try { return runSync(fn, joined.obj); } catch (e) { frames[frames.length - 1].ledger.length = mark; discardAfter(afterMark); throw e; }
  }
  const lock = acquireLock(file);
  const frame = { path: file, obj: null, ledger: [], after: [] };
  const afterMark = frames.length ? frames[0].after.length : 0;
  let after = null; // the outermost frame's queue, set once it committed
  try {
    let raw = null;
    try { raw = readFileSync(file, 'utf8'); } catch (e) {
      if (!(e && e.code === 'ENOENT' && opts.create)) {
        if (e && e.code === 'ENOENT') { const err = new Error(`no such run file: ${file}`); err.code = 'ENOENT'; throw err; }
        throw e;
      }
    }
    // A file that does not parse is not overwritten: write-then-rename means it was never torn by
    // us, so it is someone's hand edit or a disk fault - stop rather than replace it.
    frame.obj = raw === null ? {} : JSON.parse(raw);
    const before = raw === null ? null : JSON.stringify(frame.obj);
    frames.push(frame);
    let out;
    try {
      out = runSync(fn, frame.obj);
      if (before === null || JSON.stringify(frame.obj) !== before) writeAtomic(file, frame.obj);
    } catch (e) {
      discardAfter(afterMark);
      throw e;
    } finally { frames.splice(frames.indexOf(frame), 1); }
    const parent = frames[frames.length - 1];
    if (parent) { parent.ledger.push(...frame.ledger); return out; }
    for (const [ledgerFile, line] of frame.ledger) {
      try { mkdirSync(dirname(ledgerFile), { recursive: true }); appendFileSync(ledgerFile, line); } catch { /* the ledger is evidence, not a dependency */ }
    }
    after = frame.after;
    return out;
  } finally {
    releaseLock(lock);
    // After the release: an afterCommit fn may open its own transaction on this same file.
    if (after) runAfter(after);
  }
}

// Every fn runs even if an earlier one threw; the first error is rethrown after the last.
function runAfter(queue) {
  let first = null;
  for (const { fn } of queue) {
    try { fn(); } catch (e) { if (!first) first = e; }
  }
  if (first) throw first;
}

// mutateTask(taskId | task.json path, fn, opts) - see the header.
export function mutateTask(idOrPath, fn, opts = {}) {
  return mutateRun(resolveTaskPath(idOrPath), fn, opts);
}
