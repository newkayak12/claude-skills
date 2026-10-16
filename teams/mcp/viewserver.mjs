// teams/mcp/viewserver.mjs - one human window per tasks root, started when a task opens.
//
// scripts/view.mjs is the human surface (a browser page and a text tree). It was something you
// had to remember to start, which meant in practice nobody did: a task ran headless for twenty
// minutes and the only way to see it was to already know the command. This starts it for you
// the moment tm_open/tm_run creates a task, and hands the URL back in the tool reply.
//
// ONE viewer per tasks root, not one per task. The page already indexes every task under the
// root and serves one task at /E-<first 8 of its id> (the old /?task=<id> link still works), so a
// second server would be a second port for the same data. The running one is recorded in
// <tasksRoot>/.view.json ({pid, port, started_at}).
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
//   TEAMS_VIEW_PORT=<n>   pin the port instead of the default 7431 (DEFAULT_VIEW_PORT); when
//                         7431 is taken a free port is used and recorded
import { pidAlive } from './proc.mjs';
import { spawn } from 'node:child_process';
import { get as httpGet } from 'node:http';
import { createServer } from 'node:net';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
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

// Spawns the viewer on a chosen port and waits for it to answer. A child that exits first lost
// the race for the port (another viewer took it between the bind probe and the child's own
// listen) - the caller picks again. Returns {child, port} or null.
async function spawnViewer(tasksDir) {
  const port = await choosePort();
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
  return { child, port };
}

// Returns {url, port, pid, started} or null. `started` false means an already-running viewer
// was reused - the caller can say "watch it here" either way, and should not say "started".
export async function ensureViewer(tasksDir, taskId) {
  if (viewDisabled()) return null;
  const existing = readViewRecord(tasksDir);
  if (existing && await answers(existing.port, REUSE_PROBE_MS)) {
    return { url: viewUrl(existing.port, taskId), port: existing.port, pid: existing.pid, started: false };
  }
  try {
    let spawned = await spawnViewer(tasksDir);
    if (spawned && !spawned.child) spawned = await spawnViewer(tasksDir);
    if (!spawned || !spawned.child) return null;
    const { child, port } = spawned;
    try {
      writeFileSync(viewRecordPath(tasksDir), `${JSON.stringify({ pid: child.pid, port, started_at: Date.now() }, null, 2)}\n`);
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
