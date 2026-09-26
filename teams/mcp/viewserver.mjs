// teams/mcp/viewserver.mjs - one human window per tasks root, started when a task opens.
//
// scripts/view.mjs is the human surface (a browser page and a text tree). It was something you
// had to remember to start, which meant in practice nobody did: a task ran headless for twenty
// minutes and the only way to see it was to already know the command. This starts it for you
// the moment tm_open/tm_run creates a task, and hands the URL back in the tool reply.
//
// ONE viewer per tasks root, not one per task. The page already indexes every task under the
// root and takes ?task=<id>, so a second server would be a second port for the same data. The
// running one is recorded in <tasksRoot>/.view.json ({pid, port, started_at}); a later tm_open
// finds it alive and reuses its port, and only a dead or missing record spawns a new one.
//
// Nothing here may break tm_open. Every failure path - a port that will not bind, a spawn that
// throws, an unreadable or corrupt .view.json, a node binary that is not there - returns null
// and leaves the task untouched. A task that runs without a window is a smaller problem than a
// task that could not open because its window would not start.
//
//   TEAMS_VIEW=0          do not start a viewer at all (and do not reuse one)
//   TEAMS_VIEW_PORT=<n>   pin the port instead of taking a free one
import { pidAlive } from './proc.mjs';
import { spawn } from 'node:child_process';
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

function freePort() {
  const pinned = Number(process.env.TEAMS_VIEW_PORT);
  if (Number.isInteger(pinned) && pinned > 0) return Promise.resolve(pinned);
  return new Promise((resolve) => {
    const s = createServer();
    s.on('error', () => resolve(0));
    s.listen(0, '127.0.0.1', () => {
      const p = s.address() && s.address().port;
      s.close(() => resolve(Number.isInteger(p) ? p : 0));
    });
  });
}

export function viewUrl(port, taskId) {
  return `http://127.0.0.1:${port}/${taskId ? `?task=${taskId}` : ''}`;
}

// Returns {url, port, pid, started} or null. `started` false means an already-running viewer
// was reused - the caller can say "watch it here" either way, and should not say "started".
export async function ensureViewer(tasksDir, taskId) {
  if (viewDisabled()) return null;
  const existing = readViewRecord(tasksDir);
  if (existing) return { url: viewUrl(existing.port, taskId), port: existing.port, pid: existing.pid, started: false };
  try {
    const port = await freePort();
    if (!port) return null;
    // Detached with every stdio ignored: the viewer has to outlive whichever short-lived MCP
    // server process happened to answer this tm_open, and an inherited pipe nobody drains is
    // how a detached child blocks on a full buffer and dies silently.
    const child = spawn(process.execPath, [VIEW_SCRIPT, '--tasks-dir', tasksDir, '--port', String(port)],
      { detached: true, stdio: 'ignore' });
    child.unref();
    if (!child.pid) return null;
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
