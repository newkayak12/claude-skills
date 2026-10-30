// teams/mcp/viewserver.mjs - one human window per tasks root, started when a task opens.
//
// scripts/view.mjs is the human surface (a browser page and a text tree). It was something you
// had to remember to start, which meant in practice nobody did: a task ran headless for twenty
// minutes and the only way to see it was to already know the command. This starts it for you
// the moment tm_open/tm_run creates a task, and hands the URL back in the tool reply.
//
// ONE viewer per port, not one per task or per root. The page indexes every task of every root the
// viewer holds and serves one task at /E-<first 8 of its id> or /<slug>, so a second server would be
// a second port for the same data. A second tasks root joins the viewer already on the preferred
// port (POST /register) and its record says so: <tasksRoot>/.view.json ({pid, port, started_at},
// plus shared: true when joined). A viewer that lost a bind race is joined the same way.
//
// A record is reused only when its pid is alive AND its port answers an HTTP GET of /state.json
// (retried for about 2s): a live pid alone proves nothing, because the OS recycles pids and the
// fixed port can be taken by anything. A record that does not answer is replaced - a new viewer
// is spawned and .view.json rewritten. Only ensureViewer (tm_open/tm_run) makes that check;
// readViewRecord stays pid-only and tm_status, which uses it and never spawns, hands out the
// recorded link without probing the port.
//
// Nothing here may break tm_open. Every failure path - a port that will not bind, a spawn that
// throws, an unreadable or corrupt .view.json, a node binary that is not there - returns null
// and leaves the task untouched. A task that runs without a window is a smaller problem than a
// task that could not open because its window would not start.
//
//   TEAMS_VIEW=0          do not start a viewer at all (and do not reuse one)
//   TEAMS_VIEW_PORT=<n>   pin the port instead of the default 7431 (DEFAULT_VIEW_PORT); a teams
//                         viewer there is joined, anything else there gives null. Unpinned, only a
//                         non-teams holder of 7431 moves the viewer to a free port, which is recorded
import { pidAlive } from './proc.mjs';
import { spawn } from 'node:child_process';
import { get as httpGet, request as httpRequest } from 'node:http';
import { createServer } from 'node:net';
import { readFileSync, writeFileSync, unlinkSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const VIEW_SCRIPT = join(HERE, '..', 'scripts', 'view.mjs');

export function viewRecordPath(tasksDir) { return join(tasksDir, '.view.json'); }

export function viewDisabled() { return process.env.TEAMS_VIEW === '0'; }

function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  return pidAlive(pid);
}

// The record is advisory, never authoritative: it is written by a process that may have been
// killed without cleaning up, so a pid that is gone - or one the OS has since handed to an
// unrelated process that happens to be alive - is the normal case, not an error. The worst a
// wrong-but-alive pid costs is a URL that serves nothing, which the page shows as unreachable.
export function readViewRecord(tasksDir) {
  try {
    const r = JSON.parse(readFileSync(viewRecordPath(tasksDir), 'utf8'));
    if (!Number.isInteger(r.port) || r.port <= 0) return null;
    return alive(r.pid) ? r : null;
  } catch { return null; }
}

// The fixed default: a link to the viewer stays the same across tasks, tasks roots and restarts.
export const DEFAULT_VIEW_PORT = 7431;

// A port that was free a moment ago: `port` itself when it can be bound, else an OS-chosen one
// (0 when even that fails). Binding is probed, not assumed, so a taken default falls back
// instead of handing a viewer a port it cannot listen on.
function bindProbe(port) {
  return new Promise((resolve) => {
    const s = createServer();
    s.on('error', () => resolve(0));
    s.listen(port, '127.0.0.1', () => {
      const p = s.address() && s.address().port;
      s.close(() => resolve(Number.isInteger(p) ? p : 0));
    });
  });
}

// TEAMS_VIEW_PORT pins the port as is; otherwise `preferred` (the default) if it is free, else
// any free port. The caller records whatever comes back.
export async function choosePort(preferred = DEFAULT_VIEW_PORT) {
  const pinned = Number(process.env.TEAMS_VIEW_PORT);
  if (Number.isInteger(pinned) && pinned > 0) return pinned;
  return (await bindProbe(preferred)) || bindProbe(0);
}

// The path key of a task: E-<first 8 of the id>. An id that already starts with E- is not
// prefixed twice, and one shorter than 8 keeps what it has.
export function viewKey(taskId) {
  return `E-${String(taskId).replace(/^E-/, '').slice(0, 8)}`;
}

export function viewUrl(port, taskId) {
  return `http://127.0.0.1:${port}/${taskId ? viewKey(taskId) : ''}`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function probeOnce(port, timeout) {
  return new Promise((resolve) => {
    const req = httpGet({ host: '127.0.0.1', port, path: '/state.json', timeout }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  });
}

// Does something on `port` answer GET /state.json with 200 within `deadlineMs` in total?
// `gone()`, when given, ends the wait early (the viewer being waited for has already exited).
async function answers(port, deadlineMs, gone) {
  const end = Date.now() + deadlineMs;
  while (true) {
    if (gone && gone()) return false;
    const left = end - Date.now();
    if (left <= 0) return false;
    if (await probeOnce(port, Math.min(500, left))) return true;
    await sleep(100);
  }
}

const REUSE_PROBE_MS = 2000;
const SPAWN_WAIT_MS = 5000;
const ADOPT_PROBE_MS = 1000;
const ADOPT_WAIT_MS = 3000;

function httpJson(port, path, timeout, method = 'GET', body = null) {
  return new Promise((resolve) => {
    const headers = body === null ? {} : { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) };
    const req = httpRequest({ host: '127.0.0.1', port, path, method, headers, timeout }, (res) => {
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { buf += d; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, json: JSON.parse(buf) }); } catch { resolve({ status: res.statusCode, json: null }); }
      });
    });
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
    req.end(body);
  });
}

// Is a teams viewer listening on `port`? {pid, roots} from GET /teams-view.json. An older viewer
// has no such route and answers only /state.json: {pid: null, roots: [its tasks_dir], legacy: true}
// (it cannot be registered into). null when the port is closed or something else holds it.
export async function viewerAt(port, deadlineMs) {
  const id = await httpJson(port, '/teams-view.json', deadlineMs);
  if (id && id.status === 200 && id.json && id.json.teams_view === 1) return { pid: id.json.pid, roots: id.json.roots };
  if (!id) return null;
  const st = await httpJson(port, '/state.json', deadlineMs);
  if (st && st.status === 200 && st.json && typeof st.json.tasks_dir === 'string' && st.json.mode) return { pid: null, roots: [st.json.tasks_dir], legacy: true };
  return null;
}

// POST /register: the roots the viewer now serves, or null when it refused or is not there.
export async function registerRoot(port, tasksDir) {
  const r = await httpJson(port, '/register', ADOPT_PROBE_MS, 'POST', JSON.stringify({ tasks_dir: resolve(tasksDir) }));
  return r && r.status === 200 && r.json && r.json.ok && Array.isArray(r.json.roots) ? r.json.roots : null;
}

function real(p) {
  try { return realpathSync(p); } catch { return resolve(p); }
}

function writeRecord(tasksDir, rec) {
  writeFileSync(viewRecordPath(tasksDir), `${JSON.stringify(rec, null, 2)}\n`);
}

// Joins the teams viewer on `port`, if there is one: this root is already among its roots or
// registers into it. The record points at it ({shared: true}); nothing is started.
async function adopt(tasksDir, taskId, port) {
  const v = await viewerAt(port, ADOPT_PROBE_MS);
  if (!v || v.legacy || !Number.isInteger(v.pid)) return null;
  if (!v.roots.some((r) => real(r) === real(tasksDir)) && !(await registerRoot(port, tasksDir))) return null;
  writeRecord(tasksDir, { pid: v.pid, port, started_at: Date.now(), shared: true });
  return { url: viewUrl(port, taskId), port, pid: v.pid, started: false };
}

// adopt, retried for a while: the viewer that won a bind race may not answer yet.
async function adoptWithin(tasksDir, taskId, port, ms) {
  const end = Date.now() + ms;
  while (true) {
    const a = await adopt(tasksDir, taskId, port);
    if (a || Date.now() >= end) return a;
    await sleep(100);
  }
}

// Spawns the viewer on a chosen port and waits for it to answer. A child that exits first lost
// the race for the port (another viewer took it between the bind probe and the child's own
// listen) - the caller adopts the winner or picks again. Returns {child, port} or null.
async function spawnViewer(tasksDir, preferred) {
  const port = await choosePort(preferred);
  if (!port) return null;
  // Detached with every stdio ignored: the viewer has to outlive whichever short-lived MCP
  // server process happened to answer this tm_open, and an inherited pipe nobody drains is
  // how a detached child blocks on a full buffer and dies silently.
  const child = spawn(process.execPath, [VIEW_SCRIPT, '--tasks-dir', tasksDir, '--port', String(port)],
    { detached: true, stdio: 'ignore' });
  child.unref();
  if (!child.pid) return null;
  let exited = false;
  child.on('exit', () => { exited = true; });
  child.on('error', () => { exited = true; });
  const up = await answers(port, SPAWN_WAIT_MS, () => exited);
  // Not answering after the wait but still running: a slow start, recorded as before.
  if (!up && exited) return { child: null, port };
  // The port answering is not proof it is this child: the winner of a bind race answers too.
  const at = up ? await viewerAt(port, ADOPT_PROBE_MS) : null;
  if (at && Number.isInteger(at.pid) && at.pid !== child.pid) {
    try { process.kill(child.pid, 'SIGKILL'); } catch { /* already gone */ }
    return { child: null, port };
  }
  return { child, port };
}

// Returns {url, port, pid, started} or null. `started` false means an already-running viewer
// was reused or joined - the caller can say "watch it here" either way, and should not say "started".
export async function ensureViewer(tasksDir, taskId, { preferred } = {}) {
  if (viewDisabled()) return null;
  const existing = readViewRecord(tasksDir);
  if (existing && await answers(existing.port, REUSE_PROBE_MS)) {
    return { url: viewUrl(existing.port, taskId), port: existing.port, pid: existing.pid, started: false };
  }
  try {
    const pin = Number(process.env.TEAMS_VIEW_PORT);
    const pinned = Number.isInteger(pin) && pin > 0;
    const want = preferred || (pinned ? pin : DEFAULT_VIEW_PORT);
    const joined = await adopt(tasksDir, taskId, want);
    if (joined) return joined;
    let spawned = await spawnViewer(tasksDir, want);
    if (spawned && !spawned.child) {
      // Lost the bind race: the winner is a teams viewer to join; anything else on a pinned port is final.
      const won = await adoptWithin(tasksDir, taskId, want, ADOPT_WAIT_MS);
      if (won) return won;
      if (pinned) return null;
      spawned = await spawnViewer(tasksDir, want);
    }
    if (!spawned || !spawned.child) return null;
    const { child, port } = spawned;
    try {
      writeRecord(tasksDir, { pid: child.pid, port, started_at: Date.now() });
    } catch (e) {
      // An unrecordable viewer is worse than none: nothing can find it to reuse it, and nothing
      // can find it to stop it, so it holds a port until the machine reboots. Take it down.
      try { process.kill(child.pid, 'SIGKILL'); } catch { /* it never got far enough to run */ }
      throw e;
    }
    return { url: viewUrl(port, taskId), port, pid: child.pid, started: true };
  } catch { return null; }
}

export function clearViewRecord(tasksDir) {
  try { unlinkSync(viewRecordPath(tasksDir)); return true; } catch { return false; }
}
