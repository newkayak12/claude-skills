#!/usr/bin/env node
// stateserver.mjs - the engine's state socket: ONE per tasks root, answering what the teams mod asks
// (`view.mjs --once --format status|events|summary|teams|board|report|decisions`) over HTTP on a Unix
// socket. The answers come from the same function as the CLI (scripts/lib/view-once.mjs), so a served
// answer equals `--once` for the same root and cwd.
//
//   node stateserver.mjs --tasks-dir <dir>            serve <dir>/.state.sock from a new session, then exit 0
//                                                     (a second start exits 0); --foreground stays in the process
//   node stateserver.mjs --sock-path --tasks-dir <dir>  print the socket path and exit 0
//
// Socket: <tasksDir>/.state.sock, or <os.tmpdir()>/teams-state-<sha1(tasksDir)[0:12]>.sock when that is
// over 103 bytes (sun_path); the lock <tasksDir>/.state.lock always sits in the root. No plugin version in
// either: every installed version meets the same server, and PROTO says whether they can talk.
//
// Idle: TEAMS_STATE_IDLE_MS (default 5 min) without a 200 answer ends the server and removes its files.
// The mod asks every 3 s while a session is open, so only closed sessions let it lapse.
//
// Log: <tasksDir>/.state.log, append-only, one `<ISO ts> <pid> <event>` line for start, listening <sock>,
// error <code>, idle-exit, SIGTERM, SIGINT; renamed to .state.log.1 (one generation) at 1 MiB; never a task.
//
// A task is rebuilt in full (task.json parsed, whole ledger, driver-stream costs, live-process count) only
// when its task.json or ledger.jsonl changed. Between changes a `running` task, and a `stalled` one with files
// under 24 h old, is built again (from the parsed task.json) only when its volatileKey changed: a pid it checks
// (`kill(pid, 0)`), a stream mtime or its side of STALL_MS/MOVING_MS, a run file; checked once per answer window
// (2 s), plus a safety net build every 60 s. Every other task is not built at all. The clock fields (elapsed_ms,
// waiting_elapsed_ms, elapsed_minutes, timebox_pct, flow_metrics) of every cached task are moved to now at each
// get() from facts in the model, so they lag by at most one answer window (2 s) plus the poll gap. A quiet stream
// crossing a threshold flips the task at the first get() past the window (lag <= ANSWER_MS + the poll gap).
// What lags until the next task.json/ledger change (or the 60 s safety net): driver-stream cost, board.jsonl is
// read when it changes, git facts (cleared every 10 min), the root-wide live-driver count, a harness run found
// by scanning the cwd, and nested `.harness-tasks`.
// A finished task, a ledger finish older than an hour, and a dir with no task.json untouched for an hour are
// checked for a rewrite once per 30 s (lib/view-index.mjs); a task created over a day ago that the status
// floor did not list is offered to it again once per 30 s (lib/view-once.mjs).
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { connect as netConnect } from 'node:net';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, openSync, writeSync, closeSync, readFileSync, readdirSync, renameSync, unlinkSync, existsSync, statSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tasksRoot } from './taskstate.mjs';
import { pidAlive } from './proc.mjs';
import { loadRunAt } from './graph.mjs';
import { liveProcesses } from './livecap.mjs';
import { collectTaskCosts } from './drivercost.mjs';
import { collectFromRaw, captureClock, readJsonl, readJsonRetry, stallMsOf, MOVING_MS } from '../scripts/lib/view-collect.mjs';
import { statSig, statOf, tickMemo, withTickStats } from '../scripts/lib/view-index.mjs';
import { pruneTails } from '../scripts/lib/view-floor-fs.mjs';
import { clearGitFacts } from '../scripts/lib/view-repo.mjs';
import { createLedgerStore } from '../scripts/lib/view-ledger-store.mjs';
import { VIEWS, onceOutput } from '../scripts/lib/view-once.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

// The wire protocol. Bump it when the shape of any answer changes: a client sends `proto=<n>`, and a
// server of another PROTO refuses it with 409 rather than answer in a shape the client cannot read.
export const PROTO = 1;

const SUN_PATH_MAX = 103;
const ANSWER_MS = 2000;
const IDLE_DEFAULT_MS = 5 * 60 * 1000;
const LOCK_FRESH_MS = 10 * 1000;
const GIT_CLEAR_MS = 10 * 60 * 1000;
const STALLED_LISTED_MS = 24 * 60 * 60 * 1000;
const FORGET_MS = 10 * 60 * 1000;
// An open task whose volatileKey holds is still built again every OPEN_RECHECK answer windows (60 s).
const OPEN_RECHECK = 30;
// A finished task's files (and an old ledger's mtime) are checked for a rewrite this often, not every tick.
const SETTLED_MS = 30 * 1000;

export function statePaths(tasksDir) {
  const root = resolve(tasksDir);
  let sock = join(root, '.state.sock');
  if (Buffer.byteLength(sock) > SUN_PATH_MAX) sock = join(tmpdir(), `teams-state-${createHash('sha1').update(root).digest('hex').slice(0, 12)}.sock`);
  return { sock, lock: join(root, '.state.lock') };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// <tasksDir>/.state.log: one `<ISO ts> <pid> <event>` line per start, listening <sock>, error <code>, idle-exit,
// SIGTERM and SIGINT. Append-only; a log of 1 MiB or more is renamed to .state.log.1 (one generation, overwritten)
// before the next line, so it stays under 1 MiB plus one line. A file, dot-prefixed: never listed as a task.
// Logging never throws.
const LOG_MAX = 1024 * 1024;
function logLine(tasksDir, event) {
  try {
    const path = join(tasksDir, '.state.log');
    try { if (statSync(path).size >= LOG_MAX) renameSync(path, `${path}.1`); } catch { /* no log yet */ }
    appendFileSync(path, `${new Date().toISOString()} ${process.pid} ${event}\n`);
  } catch { /* the log is best effort */ }
}

function probe(path) {
  return new Promise((done) => {
    const c = netConnect(path);
    const t = setTimeout(() => { c.destroy(); done(false); }, 1000);
    c.once('connect', () => { clearTimeout(t); c.destroy(); done(true); });
    c.once('error', () => { clearTimeout(t); done(false); });
  });
}

// ---------- the per-task cache ----------

// The newer of the two mtimes in a "<mtime>:<size>|<mtime>:<size>" signature (null parts read as 0).
const mtimeOfSig = (sig) => { const p = String(sig).split(/[:|]/); return Math.max(Number(p[0]) || 0, Number(p[2]) || 0); };

// The facts a model of an open task reads that no task.json/ledger.jsonl change announces: whether each pid
// it checks (the daemon's and every driver's) is alive, the mtime of each driver stream and which side of
// STALL_MS and MOVING_MS it is on, the files read through `files` (run files, ledger, board), a harness run's
// own files, and, for a task with no recorded driver, its drivers/ streams. One string; a change of it is the
// only reason to build a task that did not change on disk. Not covered (lag until the next task.json or
// ledger change): a tagged harness run found by scanning the cwd before one is recorded.
// The stat signature of every driver stream a task's cost reads: its drivers/ files and each recorded driver log.
function streamsSig(dir, raw) {
  const logs = [];
  const h = raw && raw.harness_run;
  if (h && h.driver && h.driver.log) logs.push(h.driver.log);
  if (raw && raw.s_run && raw.s_run.driver && raw.s_run.driver.log) logs.push(raw.s_run.driver.log);
  for (const n of Array.isArray(raw && raw.nodes) ? raw.nodes : []) if (n && n.child && n.child.driver && n.child.driver.log) logs.push(n.child.driver.log);
  let names = [];
  try { names = readdirSync(join(dir, 'drivers')).filter((f) => f.endsWith('.stream.jsonl')).map((f) => join(dir, 'drivers', f)); } catch { /* no drivers dir */ }
  return [...new Set([...logs, ...names])].sort().map((p) => statSig(p)).join('|');
}

function volatileKey(tasksDir, id, raw, files, t, listing) {
  const dir = join(tasksDir, id);
  const limit = stallMsOf(raw); // the task's own threshold, the one the verdict uses
  const side = (path) => {
    const s = statOf(path);
    return s ? `${s.mtime}:${t - s.mtime > limit ? 1 : 0}${t - s.mtime <= MOVING_MS ? 1 : 0}` : 'x';
  };
  const alive = (pid) => tickMemo(`pid\0${pid}`, () => pidAlive(pid));
  const parts = [];
  const h = raw.harness_run;
  const drivers = [];
  if (h && h.driver) drivers.push({ ...h.driver, log: h.driver.log || join(dir, 'drivers', 'S.stream.jsonl') });
  if (raw.s_run && raw.s_run.driver) drivers.push(raw.s_run.driver);
  for (const n of Array.isArray(raw.nodes) ? raw.nodes : []) if (n && n.child && n.child.driver) drivers.push(n.child.driver);
  for (const d of drivers) parts.push(`${d.pid}:${alive(d.pid) ? 1 : 0}:${d.log ? side(d.log) : '-'}`);
  if (raw.daemon) parts.push(`daemon ${alive(raw.daemon.pid) ? 1 : 0}`);
  if (!drivers.length) parts.push(`ledger ${side(join(dir, 'ledger.jsonl'))}`);
  {
    // every drivers/ stream counts: one no recorded driver owns keeps the task running (the verdict's stream scan)
    // the listing of drivers/ is kept while the dir's own mtime stands (a new stream moves it)
    const dsig = statSig(join(dir, 'drivers'));
    if (!listing.names || listing.sig !== dsig) {
      listing.sig = dsig;
      listing.names = [];
      try { listing.names = readdirSync(join(dir, 'drivers')).filter((f) => f.endsWith('.stream.jsonl')); } catch { /* no drivers dir */ }
    }
    for (const f of listing.names) parts.push(side(join(dir, 'drivers', f)));
  }
  for (const path of files.keys()) parts.push(statSig(path));
  const run = h && h.run && h.run.run_dir;
  if (h) parts.push(statSig(String(h.pointer || '')), run ? [statSig(run), statSig(join(run, '04-goal-gate.json')), statSig(join(run, '05-report.md'))].join(',') : '-');
  return parts.join('|');
}

// get(tasksDir, id) is collectTask's answer, rebuilt in full only when the task's task.json|ledger.jsonl
// signature changed (stats.collects, byId). A `running` task, or a `stalled` one with files under 24 h old, is
// otherwise built again (stats.rebuilds, also counted in stats.refreshes) only when its volatileKey changed,
// checked at most once per `refreshMs`, or every OPEN_RECHECK windows as a safety net. Builds go through readers
// that keep each file by its own stat (stats.reads: what was actually read from disk). Between builds the clock
// fields of every task are moved to now from facts in the model (captureClock), with no file read.
export function createTaskCache({ build = collectFromRaw, now = Date.now, refreshMs = ANSWER_MS } = {}) {
  const entries = new Map();
  const stats = { collects: 0, refreshes: 0, rebuilds: 0, byId: {}, reads: { ledger: 0, costs: 0, runs: 0, live: 0 } };

  function ioOf(e) {
    const kept = (path, read) => {
      const sig = statSig(path);
      const hit = e.files.get(path);
      if (hit && hit.sig === sig) return hit.value;
      const value = read();
      e.files.set(path, { sig, value });
      return value;
    };
    return {
      loadRun: (p) => kept(p, () => { stats.reads.runs += 1; return loadRunAt(p); }),
      jsonl: (p) => kept(p, () => { stats.reads.ledger += 1; return readJsonl(p); }),
      // kept while the driver streams' stat signature stands: a stream that grows (no task.json or ledger change) is read again
      costs: (dir, task) => {
        const sig = streamsSig(dir, e.raw);
        if (e.costs === undefined || e.costsSig !== sig) { stats.reads.costs += 1; e.costs = collectTaskCosts(dir, task); e.costsSig = sig; }
        return e.costs;
      },
      live: (root) => (e.live ??= (stats.reads.live += 1, liveProcesses(root).length)),
    };
  }

  function get(tasksDir, id) {
    const key = `${tasksDir}\0${id}`;
    const sig = `${statSig(join(tasksDir, id, 'task.json'))}|${statSig(join(tasksDir, id, 'ledger.jsonl'))}`;
    const t = now();
    let e = entries.get(key);
    let rebuild = false;
    if (!e || e.sig !== sig) {
      const read = readJsonRetry(join(tasksDir, id, 'task.json'));
      if (!read.ok) { entries.delete(key); return { task_id: id, tasks_dir: tasksDir, error: `could not read task.json: ${read.error}` }; }
      e = { sig, raw: read.value, files: new Map(), costs: undefined, live: undefined, m: null, at: 0, built: t, seen: t, vkey: null, clock: [], listing: {} };
      entries.set(key, e);
      stats.collects += 1;
      stats.byId[id] = (stats.byId[id] || 0) + 1;
      rebuild = true;
    } else if (t - e.at >= refreshMs && (e.m.state === 'running' || (e.m.state === 'stalled' && t - mtimeOfSig(sig) < STALLED_LISTED_MS))) {
      // the key, or a safety net for what it cannot see (a harness run found by scanning the cwd, a nested task)
      if (volatileKey(tasksDir, id, e.raw, e.files, t, e.listing) !== e.vkey || t - e.built >= refreshMs * OPEN_RECHECK) { stats.refreshes += 1; stats.rebuilds += 1; rebuild = true; } else e.at = t;
    }
    e.seen = t;
    if (rebuild) {
      const built = captureClock(() => build(tasksDir, id, e.raw, ioOf(e)));
      e.m = built.value; e.clock = built.clock; e.at = t; e.built = t;
      e.vkey = e.m && (e.m.state === 'running' || e.m.state === 'stalled') ? volatileKey(tasksDir, id, e.raw, e.files, t, e.listing) : null;
    } else for (const move of e.clock) move(t);
    return e.m;
  }

  // What floorEntry may reuse for a task: its parsed task.json and its signature.
  const floorOpts = (tasksDir, id) => {
    const e = entries.get(`${tasksDir}\0${id}`);
    return e ? { raw: e.raw, sig: e.sig } : {};
  };

  const forget = () => { const t = now(); for (const [k, e] of entries) if (t - e.seen > FORGET_MS) entries.delete(k); };

  return { get, floorOpts, forget, stats };
}

// ---------- the lock ----------

const readLock = (path) => { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; } };
const unlinkQuiet = (p) => { try { unlinkSync(p); } catch { /* already gone */ } };
const lockMtime = (p) => { try { return statSync(p).mtimeMs; } catch { return 0; } };

// 'mine' (names this server), 'foreign' (another live server's), 'stale' (missing, unreadable, or a dead pid's)
function lockStanding(path, token) {
  const l = readLock(path);
  if (!l) return 'stale';
  if (l.token === token) return 'mine';
  return l.pid && pidAlive(l.pid) ? 'foreign' : 'stale';
}

// 'held' (this process owns the lock), or 'answering' (a server already serves the socket).
//
// A lock is created with `wx`. A stale one (its holder dead, or alive but not answering for LOCK_FRESH_MS)
// is replaced by one starter at a time: rename is not a compare-and-swap, so the replacement runs under a
// second `wx` file (<lock>.take), and everything is re-checked inside it. A starter that loses the race
// finds a live, young lock naming another pid, waits, and sees that server answer.
async function acquire(paths, token) {
  const mine = () => JSON.stringify({ pid: process.pid, token, at: Date.now() });
  const take = `${paths.lock}.take`;
  const deadline = Date.now() + LOCK_FRESH_MS + 2000;
  // 'young': a live owner that is still starting
  const standing = () => {
    const holder = readLock(paths.lock);
    // a lock file just created and not yet written reads as empty: its owner is starting, not gone
    if (!holder) return Date.now() - lockMtime(paths.lock) < 1000 ? 'young' : 'stale';
    const alive = holder.pid && pidAlive(holder.pid);
    return alive && Date.now() - (holder.at || 0) < LOCK_FRESH_MS && Date.now() < deadline ? 'young' : 'stale';
  };
  while (true) {
    if (await probe(paths.sock)) return 'answering';
    try {
      const fd = openSync(paths.lock, 'wx');
      writeSync(fd, mine());
      closeSync(fd);
      return 'held';
    } catch (e) {
      if (!e || e.code !== 'EEXIST') throw e;
    }
    if (standing() === 'young') { await sleep(100); continue; }
    try { closeSync(openSync(take, 'wx')); } catch {
      if (Date.now() - lockMtime(take) > LOCK_FRESH_MS) unlinkQuiet(take); // a starter died inside the takeover
      await sleep(50);
      continue;
    }
    try {
      if (await probe(paths.sock)) return 'answering';
      if (standing() === 'young') continue;
      const tmp = `${paths.lock}.${process.pid}.tmp`;
      const fd = openSync(tmp, 'w');
      writeSync(fd, mine());
      closeSync(fd);
      renameSync(tmp, paths.lock);
      return 'held';
    } finally { unlinkQuiet(take); }
  }
}

// ---------- the server ----------

function pluginVersion() {
  try { return String(JSON.parse(readFileSync(join(HERE, '..', '.claude-plugin', 'plugin.json'), 'utf8')).version || 'unknown'); } catch { return 'unknown'; }
}

function idleDefault() {
  const n = Number(process.env.TEAMS_STATE_IDLE_MS);
  return Number.isFinite(n) && n > 0 ? n : IDLE_DEFAULT_MS;
}

// Resolves { ok: true, stop() } once listening, or { ok: false, reason } ('answering': another server of this
// root is up; 'lost': the lock went to another server while this one was starting; 'error').
export async function startStateServer({ tasksDir, idleMs = idleDefault(), exit = (code) => process.exit(code) } = {}) {
  tasksDir = resolve(tasksDir);
  mkdirSync(tasksDir, { recursive: true });
  const paths = statePaths(tasksDir);
  const token = randomBytes(8).toString('hex');
  if (await acquire(paths, token) === 'answering') return { ok: false, reason: 'answering' };
  // only the lock holder removes a socket, and only one nobody answers on
  if (await probe(paths.sock)) { if (lockStanding(paths.lock, token) === 'mine') unlinkQuiet(paths.lock); return { ok: false, reason: 'answering' }; }
  if (existsSync(paths.sock)) unlinkQuiet(paths.sock);
  logLine(tasksDir, 'start');

  const version = pluginVersion();
  const cache = createTaskCache();
  const store = createLedgerStore();
  const answers = new Map();
  let tick = { at: 0, ctx: null };
  let gitClearedAt = Date.now();
  const newTick = () => {
    const m = new Map();
    return { at: Date.now(), stats: new Map(), ctx: {
      memo: (k, fn) => { if (!m.has(k)) m.set(k, fn()); return m.get(k); },
      settledMs: SETTLED_MS,
      collect: (dir, id) => cache.get(dir, id),
      floorOpts: (dir, id) => cache.floorOpts(dir, id),
    } };
  };
  let lastOk = Date.now();

  const server = createServer((req, res) => {
    try {
      const q = new URL(req.url, 'http://localhost').searchParams;
      const proto = q.has('proto') && q.get('proto') !== '' && Number.isFinite(Number(q.get('proto'))) ? Number(q.get('proto')) : null;
      if (proto !== PROTO) {
        res.writeHead(409, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-teams-state-proto': String(PROTO), 'x-teams-version': version });
        res.end(JSON.stringify({ error: 'protocol', server: PROTO, client: proto }) + '\n');
        return;
      }
      const args = { view: q.get('view') || 'pipeline' };
      for (const k of ['format', 'cwd', 'task', 'session', 'card']) if (q.has(k)) args[k] = q.get(k);
      if (q.has('since')) args.since = Number(q.get('since')) || 0;
      const render = VIEWS[args.view];
      if (!render) throw new Error('unknown view');
      const key = JSON.stringify([tasksDir, args.view, args.format, args.cwd, args.task, args.session, args.since, args.card]);
      let hit = answers.get(key);
      if (!hit || Date.now() - hit.at >= ANSWER_MS) {
        if (Date.now() - tick.at >= ANSWER_MS) {
          if (Date.now() - gitClearedAt >= GIT_CLEAR_MS) { clearGitFacts(); gitClearedAt = Date.now(); }
          cache.forget();
          pruneTails(FORGET_MS);
          tick = newTick();
        }
        hit = { at: Date.now(), body: withTickStats(tick.stats, () => onceOutput(args, tasksDir, render, { store, ctx: tick.ctx })) };
        answers.set(key, hit);
        for (const [k, v] of answers) if (Date.now() - v.at >= ANSWER_MS) answers.delete(k);
      }
      lastOk = Date.now();
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-teams-state-proto': String(PROTO), 'x-teams-version': version, 'x-teams-state-collects': String(cache.stats.collects) });
      res.end(hit.body);
    } catch {
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end('render failed');
    }
  });

  let ending = false;
  // the socket and the lock are removed only while the lock is this server's (or a dead one's)
  const end = (code = 0) => {
    if (ending) return;
    ending = true;
    clearInterval(watch);
    if (lockStanding(paths.lock, token) !== 'foreign') { unlinkQuiet(paths.sock); unlinkQuiet(paths.lock); }
    exit(code);
  };
  const lost = new Promise((resolveLost) => {
    server.once('error', (e) => {
      logLine(tasksDir, `error ${(e && (e.code || e.message)) || e}`);
      process.stderr.write(`teams state: cannot listen on ${paths.sock}: ${(e && (e.code || e.message)) || e}\n`);
      resolveLost('error');
    });
  });
  const listening = new Promise((resolveListen) => server.listen(paths.sock, () => resolveListen('listening')));
  const first = await Promise.race([listening, lost]);
  if (first === 'listening') logLine(tasksDir, `listening ${paths.sock}`);
  if (first === 'error') { if (lockStanding(paths.lock, token) === 'mine') unlinkQuiet(paths.lock); return { ok: false, reason: 'error' }; }
  // listening: if the lock went to another live server meanwhile, leave its socket and lock alone
  if (lockStanding(paths.lock, token) === 'foreign') { ending = true; exit(0); return { ok: false, reason: 'lost' }; }

  const watch = setInterval(() => {
    if (lockStanding(paths.lock, token) === 'foreign') { ending = true; clearInterval(watch); exit(0); return; }
    if (Date.now() - lastOk >= idleMs) { logLine(tasksDir, 'idle-exit'); end(); }
  }, Math.max(50, Math.min(1000, Math.floor(idleMs / 4))));
  watch.unref();
  process.on('SIGTERM', () => { logLine(tasksDir, 'SIGTERM'); end(); });
  process.on('SIGINT', () => { logLine(tasksDir, 'SIGINT'); end(); });
  process.on('SIGHUP', () => {}); // Node resets an inherited SIG_IGN: a closing terminal must not end the server
  return { ok: true, stop: end, server, cache, paths };
}

async function main() {
  const argv = process.argv.slice(2);
  const at = argv.indexOf('--tasks-dir');
  const tasksDir = at >= 0 && argv[at + 1] ? argv[at + 1] : tasksRoot();
  if (argv.includes('--sock-path')) { process.stdout.write(statePaths(tasksDir).sock + '\n'); return; }
  if (!argv.includes('--foreground')) {
    // leave the starter's session and process group (setsid), so closing its terminal or pane does not end
    // the server shared by the other sessions; --foreground runs in this process (tests, measuring)
    spawn(process.execPath, [fileURLToPath(import.meta.url), ...argv, '--foreground'], { detached: true, stdio: 'ignore', env: process.env }).unref();
    return;
  }
  const r = await startStateServer({ tasksDir });
  if (!r.ok) process.exit(r.reason === 'error' ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
