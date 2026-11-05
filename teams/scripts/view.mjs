#!/usr/bin/env node
// view.mjs - a human-readable window onto a teams task (teams/mcp/taskmanager.mjs).
//
// The MCP tools (tm_status, tm_board, ...) return machine-shaped JSON for a driving session.
// This is the separate human surface the repo's convention asks for: point a browser at a
// running or finished task and watch size -> shape -> critique -> dispatch(es) -> integrate ->
// gate:goal -> report move, or dump the same thing as a plain-text tree for a terminal / CI log.
//
// Read-only. It never writes task.json, a child run file, or anything else under the tasks
// root - it only reads, and tolerates whatever it finds half-written or missing.
//
//   node view.mjs [--tasks-dir <dir>] [--task <id>] [--port 0] [--once]
//
//     --tasks-dir <dir>   defaults to tasksRoot() (HARNESS_TASKS_DIR env, else ~/.harness/tasks)
//     --task <id>         a specific task id; omitted shows an index of every task found
//     --port <n>          HTTP port; 0 picks a free one. Without it: TEAMS_VIEW_PORT, else the fixed
//                         default 7431 (a free port when 7431 is taken - the URL printed is the
//                         one that bound). TEAMS_VIEW_DEFAULT_PORT replaces 7431 as that default
//                         (a test override, not a user knob)
//     --once              print a text tree to stdout and exit; no server
//
// The page for a task is /E-<first 8 of its id> or /<slug>; the older /?task=<id> link resolves too.
// An E-key that is a prefix of several ids serves the newest, and one that matches nothing serves the
// index. One server holds many tasks roots (POST /register adds one); / is always the index.
//
// Both the HTML page's /state.json and --once's text tree come from ONE collect() function
// (teams/scripts/lib/view-collect.mjs) - this file only renders it two ways. The --once answers
// themselves live in lib/view-once.mjs, which the engine's state server (mcp/stateserver.mjs) also serves.
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
// tasksRoot is taskmanager.mjs's own re-export of this one; taskmanager.mjs pulls in the whole task layer, ~50 ms to load on every call.
import { tasksRoot } from '../mcp/taskstate.mjs';
import { DEFAULT_VIEW_PORT, viewKey, viewerAt, registerRoot as registerAt } from '../mcp/viewserver.mjs';
import { collectTask, listTasks } from './lib/view-collect.mjs';
import { samePath } from './lib/view-floor-fs.mjs';
import { VIEWS, onceOutput } from './lib/view-once.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const a = { view: 'pipeline' };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--tasks-dir') a.tasksDir = argv[++i];
    else if (arg === '--task') a.task = argv[++i];
    else if (arg === '--port') a.port = Number(argv[++i]) || 0;
    else if (arg === '--once') a.once = true;
    else if (arg === '--view') a.view = argv[++i];
    else if (arg === '--format') a.format = argv[++i];
    else if (arg === '--since') a.since = Number(argv[++i]) || 0;
    else if (arg === '--cwd') a.cwd = argv[++i];
    else if (arg === '--session') a.session = argv[++i];
    else if (arg === '--card') a.card = argv[++i];
    else if (arg === '--help'|| arg === '-h') a.help = true;
  }
  return a;
}

function usage() {
  return 'usage: node view.mjs [--tasks-dir <dir>] [--task <id>] [--port <n> (default: TEAMS_VIEW_PORT, else 7431, else a free port; TEAMS_VIEW_DEFAULT_PORT replaces 7431, test override)] [--once] [--view pipeline|tickets|resources] [--once --format status|events|summary|teams|board [--since <ts>] [--cwd <dir>] [--session <id>]] [--once --format report --task <id> [--cwd <dir>]] [--once --format decisions --task <id> [--card <id>]]\n';
}

// ---------- HTML page (inline CSS/JS, no CDN; polls /state.json) ----------

function pageHtml() {
  return readFileSync(join(HERE, 'lib', 'view-page.html'), 'utf8');
}

// A task reference from the URL - a full task id (the old /?task=<uuid> link), an E-<prefix> key
// (/E-xxxxxxxx) or a task's slug (/<slug>) - to { root, id } across every registered root, or null.
// Tiers in order: a full id, an exact slug, an id starting with the key; inside a tier the newest
// created_at wins. Read-only: it only lists the tasks roots.
function findTask(roots, ref) {
  if (!ref || /[\\/]/.test(ref) || ref.includes('..')) return null;
  const bare = ref.replace(/^E-/, '');
  if (!bare) return null;
  const rows = roots.flatMap((root) => listTasks(root).map((r) => ({ ...r, root })));
  const tiers = [
    (r) => r.task_id === ref || r.task_id === bare,
    (r) => r.slug === ref,
    (r) => String(r.task_id).replace(/^E-/, '').startsWith(bare),
  ];
  for (const is of tiers) {
    const hits = rows.filter(is);
    if (hits.length) {
      const top = hits.reduce((x, y) => ((y.created_at || 0) > (x.created_at || 0) ? y : x));
      return { root: top.root, id: top.task_id };
    }
  }
  return null;
}

// The index over every root, newest first, each row naming its tasks_dir; `tasks_dir` stays the first root.
function indexJson(roots) {
  const tasks = roots.flatMap((root) => listTasks(root).map((r) => ({ ...r, tasks_dir: root })));
  tasks.sort((x, y) => (y.created_at || 0) - (x.created_at || 0));
  return JSON.stringify({ mode: 'index', tasks_dir: roots[0], tasks_dirs: roots, tasks });
}

// A pinned task, else the task `ref` names, else (no ref, or one that is not there) the index: the
// lone-task shortcut is --once's only.
function stateJson(roots, taskId, ref) {
  if (taskId) return JSON.stringify({ mode: 'task', tasks_dir: roots[0], model: collectTask(roots[0], taskId) });
  const hit = ref ? findTask(roots, ref) : null;
  if (hit) return JSON.stringify({ mode: 'task', tasks_dir: hit.root, model: collectTask(hit.root, hit.id) });
  return indexJson(roots);
}

// POST /register { tasks_dir }: adds a tasks root. JSON only (a cross-site form cannot send it, and
// application/json forces a preflight nobody answers), at most 4 KB, an absolute existing directory.
function registerRoot(req, res, roots) {
  const reply = (code, ok) => {
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ ok, roots }));
  };
  if (!/^application\/json(;|$)/i.test(req.headers['content-type'] || '')) { reply(400, false); req.resume(); return; }
  const chunks = [];
  let size = 0;
  let over = false;
  req.on('data', (c) => {
    size += c.length;
    if (size > 4096) { if (!over) reply(400, false); over = true; return; }
    chunks.push(c);
  });
  req.on('end', () => {
    if (over) return;
    try {
      const dir = JSON.parse(Buffer.concat(chunks).toString('utf8')).tasks_dir;
      if (typeof dir !== 'string' || !isAbsolute(dir) || !statSync(dir).isDirectory()) throw new Error('not a directory');
      const root = samePath(dir);
      if (!roots.includes(root)) roots.push(root);
      reply(200, true);
    } catch { reply(400, false); }
  });
}

// Binds `port` (explicit, TEAMS_VIEW_PORT, or the default). Only the default gives way: if it is
// taken the server listens on a free port instead, and the printed URL is the one that bound.
// A teams viewer holding the default is joined, not dodged: this root is registered into it and
// this process exits 0. Only a non-teams holder (or an older viewer with no /register) moves it.
function listenOn(server, port, fixed, tasksDir, onListening) {
  const fail = (e) => {
    process.stderr.write(`teams view: cannot listen on 127.0.0.1:${port}: ${(e && (e.code || e.message)) || e}\n`);
    process.exit(1);
  };
  server.once('error', async (e) => {
    if (!fixed && e && e.code === 'EADDRINUSE') {
      const v = await viewerAt(port, 1000);
      if (v && !v.legacy && await registerAt(port, tasksDir)) {
        console.log(`teams view already running on http://127.0.0.1:${port}/`);
        process.exit(0);
      }
      server.once('error', fail);
      server.listen(0, '127.0.0.1', onListening);
      return;
    }
    fail(e);
  });
  server.listen(port, '127.0.0.1', onListening);
}

function defaultPort() {
  const pinned = Number(process.env.TEAMS_VIEW_PORT);
  if (Number.isInteger(pinned) && pinned > 0) return { port: pinned, fixed: true };
  const def = Number(process.env.TEAMS_VIEW_DEFAULT_PORT); // test override of the default, still unfixed (join/fallback)
  return { port: Number.isInteger(def) && def > 0 ? def : DEFAULT_VIEW_PORT, fixed: false };
}

// The viewer is spawned detached (mcp/viewserver.mjs), so nothing else ever stops it. It ends itself:
// every DIR_CHECK_MS each registered root whose dir is gone is dropped; it ends when no registered root
// is left (a root missing at startup counts at the first check, no grace), or once the idle window has
// passed since a live task was last seen in any remaining root (since the start when none ever was).
// HTTP requests, GET /state.json included, do not extend it: the viewer is shared per tasks root, and a
// browser tab left open must not keep it alive. Live is
// the set view-floor-fs.mjs calls OPEN (not exported there); BLOCKED, stalled, unknown and error rows
// are not live. The record <root>/.view.json is left as it is - a dead pid already reads as no record.
const DIR_CHECK_MS = 2000;
const IDLE_DEFAULT_MS = 5 * 60 * 1000;
const EXIT_GRACE_MS = 1000;
const LIVE = new Set(['READY', 'IN_PROGRESS', 'IN_REVIEW']);

// TEAMS_VIEW_IDLE_MS; unset, non-numeric or non-positive falls back to the default.
function idleMs() {
  const n = Number(process.env.TEAMS_VIEW_IDLE_MS);
  return Number.isFinite(n) && n > 0 ? n : IDLE_DEFAULT_MS;
}

function newest(roots) {
  const rows = roots.flatMap((root) => listTasks(root).map((r) => ({ root, id: r.task_id, at: r.created_at || 0 })));
  return rows.length ? rows.reduce((x, y) => (y.at > x.at ? y : x)) : null;
}

function startServer(tasksDir, taskId, port) {
  const roots = [samePath(tasksDir)];
  let lastLive = Date.now(); // the last check that saw a live task, or the start; HTTP requests never move it
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/state.json') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(stateJson(roots, taskId, url.searchParams.get('task')));
      return;
    }
    if (url.pathname === '/teams-view.json') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ teams_view: 1, pid: process.pid, roots }));
      return;
    }
    if (url.pathname === '/register' && req.method === 'POST') { registerRoot(req, res, roots); return; }
    // The task's own package map (shape's diagram, or the dependency map). The path comes from
    // the task file, never from the query, so this serves nothing but that one drawing.
    if (url.pathname === '/package-map') {
      const ref = url.searchParams.get('task');
      const hit = taskId ? { root: roots[0], id: taskId } : ref ? findTask(roots, ref) : newest(roots);
      const m = hit ? collectTask(hit.root, hit.id) : null;
      const p = m && m.package_map && m.package_map.path;
      if (!p || !existsSync(p)) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('no package map yet - it is drawn when shape finishes'); return; }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(readFileSync(p));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(pageHtml());
  });
  const chosen = port === undefined ? defaultPort() : { port, fixed: true };
  listenOn(server, chosen.port, chosen.fixed, tasksDir, () => {
    const addr = server.address();
    console.log(`teams view listening on http://127.0.0.1:${addr.port}${taskId ? `/${viewKey(taskId)}` : ''}`);
    console.log(`tasks dir: ${tasksDir}`);
  });

  let ending = false;
  const end = () => {
    if (ending) return;
    ending = true;
    clearInterval(watch);
    // The timer is not unref'd: a close that never completes (a held connection) still ends the process.
    setTimeout(() => process.exit(0), EXIT_GRACE_MS);
    server.close();
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  };
  const watch = setInterval(() => {
    for (let i = roots.length - 1; i >= 0; i--) if (!existsSync(roots[i])) roots.splice(i, 1);
    if (!roots.length) { end(); return; }
    let rows;
    try { rows = roots.flatMap((root) => listTasks(root)); } catch { return; }
    if (rows.some((r) => LIVE.has(r.state))) { lastLive = Date.now(); return; }
    if (Date.now() - lastLive >= idleMs()) end();
  }, DIR_CHECK_MS);
  watch.unref();
  return server;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { process.stdout.write(usage()); return; }
  const render = VIEWS[args.view];
  if (!render) {
    process.stderr.write(`unknown --view '${args.view}' (expected one of: ${Object.keys(VIEWS).join(', ')})\n`);
    process.exitCode = 1;
    return;
  }
  const tasksDir = args.tasksDir ? args.tasksDir : tasksRoot();

  if (args.once) {
    process.stdout.write(onceOutput(args, tasksDir, render));
    return;
  }

  startServer(tasksDir, args.task || null, args.port);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
