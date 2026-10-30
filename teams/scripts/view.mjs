#!/usr/bin/env node
// view.mjs - a human-readable window onto a task-manager task (teams/mcp/taskmanager.mjs).
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
// (teams/scripts/lib/view-collect.mjs) - this file only renders it two ways.
import { createServer } from 'node:http';
import { readFileSync, readdirSync, existsSync, openSync, readSync, fstatSync, closeSync, statSync } from 'node:fs';
import { dirname, join, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tasksRoot } from '../mcp/taskmanager.mjs';
import { DEFAULT_VIEW_PORT, viewKey, viewerAt, registerRoot as registerAt } from '../mcp/viewserver.mjs';
import { collectTask, listTasks } from './lib/view-collect.mjs';
import { renderText, renderIndexText, renderTicketsText, renderResourcesText } from './lib/view-render-text.mjs';
import { notableEvents, statusLine, HOLD_MS } from './lib/view-events.mjs';
import { summarize, waitingCount } from './lib/view-summary.mjs';
import { floorTasks, floorEntry, samePath, scanRaws, liveCounter } from './lib/view-floor-fs.mjs';
import { repoMatcher } from './lib/view-repo.mjs';
import { reportPayload } from './lib/view-report.mjs';
import { teamsView, decisionsView } from './lib/view-status.mjs';
import { dashboardModel, dashboardSvg, dashboardAlt, dashboardText } from './lib/view-dashboard.mjs';
import { asksFor } from './lib/view-asks.mjs';
import { receivedRows } from './lib/ask-log.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

// --view picks which of the three renderers --once prints for a single task; the HTML page (the
// non---once path) always ships the full model and lets the browser switch between all three
// with no extra request - see view-page.html's own view-tabs. Default 'pipeline': the surface
// this file has always shown, unchanged for anyone not passing the flag.
const VIEWS = { pipeline: renderText, tickets: renderTicketsText, resources: renderResourcesText };

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

// ---------- --once --format status|events|summary|teams|decisions (the teams-status mod's data) ----------

const TAIL_BYTES = 256 * 1024;

// Last 256 KiB of a ledger as lines, read from the end so a huge ledger costs the same. When the
// read starts mid-file its first line is a fragment and is dropped.
function tailLines(path) {
  let fd;
  try {
    fd = openSync(path, 'r');
    const size = fstatSync(fd).size;
    const start = Math.max(0, size - TAIL_BYTES);
    const buf = Buffer.alloc(size - start);
    readSync(fd, buf, 0, buf.length, start);
    const lines = buf.toString('utf8').split('\n');
    if (start > 0) lines.shift();
    return lines.filter((l) => l.trim());
  } catch {
    return [];
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

// The single `task` object names its worktree only when it is another checkout (the `tasks` rows
// always carry the field, null for the cwd's own).
const marked = (worktree) => (worktree ? { worktree } : {});

// The ⚑ count reads every live open task (a card parked in a child run counts though no task runs),
// the same rule summaryOutput applies, so --format status and summary.status always agree.
function statusOutput(tasksDir, cwd, session) {
  const raws = scanRaws(tasksDir);
  const listed = floorTasks({ tasksDir, cwd, now: Date.now(), raws, collect: collectNoLive });
  const status = JSON.parse(statusFrom(listed.filter((x) => x.live && x.m.state === 'running')));
  status.waiting = listed.filter((x) => x.live).reduce((s, x) => s + waitingCount(x.m), 0);
  status.asks = asksOf(tasksDir, session, raws);
  return JSON.stringify(status) + '\n';
}

// The questions waiting on one session, over every open task whatever its cwd (floorTasks filters on the
// raw task.json opener before collecting); [] without a session. `via` is 'send' once a received row exists.
function asksOf(tasksDir, session, raws) {
  if (!session) return [];
  const entries = floorTasks({ tasksDir, opener: session, now: Date.now(), raws, collect: collectNoLive });
  return asksFor(entries, session, receivedRows(tasksDir, entries.map((x) => x.id)));
}

// What a row prints from collectTask never includes the live-driver count (livecap.peek: every task.json
// again plus ps), so a caller that does not print it skips it.
const collectNoLive = (dir, id) => collectTask(dir, id, { live: false });

function statusFrom(entries) {
  const models = entries.map((x) => x.m);
  const rows = entries.map(({ m, worktree }) => {
    const c = m.counts || {};
    const total = Object.values(c).reduce((s, n) => s + (Number(n) || 0), 0);
    const cur = (m.manager_stages || []).find((n) => n.state === 'running')
      || (m.packages || []).find((p) => p.state === 'running');
    return { id: 'E-' + String(m.task_id).replace(/^E-/, '').slice(0, 8), state: m.state, done: c.done || 0, total, current: cur ? (cur.node_id || cur.id || '') : '', worktree };
  });
  // waiting = nodes in state waiting_human, counted from task.json (no ledger records that event).
  const waiting = models.reduce((s, m) => s + ((m.counts && m.counts.waiting_human) || 0), 0);
  const newest = models.reduce((a, m) => (!a || (m.created_at || 0) > (a.created_at || 0) ? m : a), null);
  return JSON.stringify({ line: statusLine(rows), waiting, latest: newest ? newest.task_id : null }) + '\n';
}

// { status, tasks, task }: status is exactly --format status; tasks is every open task of the cwd
// (floorTasks: live newest created first, then stalled under 24 h with age_ms), each the human summary
// plus items, workers and handoffs; task is the human summary of --task, else of status.latest, else
// null (nothing running, or the task file is unreadable).
function summaryParts(tasksDir, cwd, taskId, session) {
  const now = Date.now();
  const raws = scanRaws(tasksDir);
  const live = liveCounter(tasksDir, raws);
  const listed = floorTasks({ tasksDir, cwd, now, raws, collect: (dir, id) => collectTask(dir, id, { live }) });
  const status = JSON.parse(statusFrom(listed.filter((x) => x.live && x.m.state === 'running')));
  // the ⚑ count reads the collected model, so a card parked in a child run (its driver gone on purpose) counts
  status.waiting = listed.filter((x) => x.live).reduce((s, x) => s + waitingCount(x.m), 0);
  status.asks = asksOf(tasksDir, session, raws);
  const id = taskId || status.latest;
  const hit = id ? listed.find((x) => x.m.task_id === id) : null;
  const m = hit ? hit.m : (id ? collectTask(tasksDir, id, { live }) : null);
  const tasks = listed.map((x) => floorEntry(x, tasksDir, { now }));
  return { status, tasks, m, task: m && !m.error ? { ...summarize(m), ...marked(hit && hit.worktree) } : null };
}

function summaryOutput(tasksDir, cwd, taskId, session) {
  const { status, tasks, task } = summaryParts(tasksDir, cwd, taskId, session);
  return JSON.stringify({ status, tasks, task }) + '\n';
}

// summaryOutput (status, tasks) plus the per-team rows and Now lines of --task (the /teams-status pane while it is open).
function teamsOutput(tasksDir, cwd, taskId, session) {
  const { status, tasks, m, task } = summaryParts(tasksDir, cwd, taskId, session);
  const ok = m && !m.error;
  const model = dashboardModel(task);
  const dash = model ? { model, svg: dashboardSvg(model), alt: dashboardAlt(model) } : null;
  return JSON.stringify({ status, tasks, task, teams: ok ? teamsView(m) : null, dash }) + '\n';
}

const DAY_MS = 24 * 60 * 60 * 1000;

// The board as plain lines (/teams-status's answer where no pane is drawn); with no task, the status line.
function boardOutput(tasksDir, cwd, taskId, session) {
  const base = JSON.parse(summaryOutput(tasksDir, cwd, taskId, session));
  // nothing running: the newest EPIC of this cwd opened in the last day, whatever its end
  let task = base.task || (base.tasks[0] || null);
  if (!task && cwd) {
    const recent = listTasks(tasksDir).filter((r) => Date.now() - (r.created_at || 0) < DAY_MS);
    const repo = repoMatcher(cwd);
    let worktree = null;
    const hit = recent.find((r) => {
      try {
        const at = repo(JSON.parse(readFileSync(join(tasksDir, r.task_id, 'task.json'), 'utf8')).cwd);
        worktree = at.worktree;
        return at.match;
      } catch { return false; }
    });
    const m = hit ? collectTask(tasksDir, hit.task_id) : null;
    task = m && !m.error ? { ...summarize(m), ...marked(worktree) } : null;
  }
  return dashboardText(dashboardModel(task)) || `${base.status.line || 'teams: no task running'}\n`;
}

// The decision timeline of --task (one card's with --card), from task.json and the ledger tail.
function decisionsOutput(tasksDir, taskId, card) {
  let raw = null;
  try { raw = taskId ? JSON.parse(readFileSync(join(tasksDir, taskId, 'task.json'), 'utf8')) : null; } catch { raw = null; }
  const ledger = raw ? tailLines(join(tasksDir, taskId, 'ledger.jsonl')).map((l) => { try { return JSON.parse(l); } catch { return null; } }) : [];
  return JSON.stringify(decisionsView(raw, ledger, { card: card || null })) + '\n';
}

// What notableEvents reads from task.json: max_retries and each node's result.reason. An unreadable
// task.json leaves them out and the events fall back to the defaults.
function taskFacts(raw) {
  const reasons = {};
  for (const n of Array.isArray(raw.nodes) ? raw.nodes : []) {
    if (n && n.node_id && n.result && typeof n.result.reason === 'string') reasons[n.node_id] = n.result.reason;
  }
  return { reasons, ...(Number.isInteger(raw.max_retries) ? { maxRetries: raw.max_retries } : {}) };
}

// Ledgers whose file changed after `since` (mtime, ms), whatever the task's state: daemon_done and
// daemon_exhausted are written after a task stops running, so a running-only filter would never
// deliver them. A task.json-less dir is not listed and an unreadable one carries `error`; both skipped.
//
// A failed node_finish is told with its reason and next step, and held up to HOLD_MS for the event
// that says what happens next, so an event with ts > since can sit in a ledger last written up to
// HOLD_MS before `since`: the mtime skip is widened by that. Its reason is the latest verdict in the
// 256 KiB tail; a verdict older than the tail is not seen and the reason is task.json's
// result.reason for the node, else `no reason recorded`.
//
// Per dir, cheapest check first: ledger mtime, raw task.json, the notable events after `since`, and only
// a dir with such an event reaches repo() (git), so git runs for no task that has nothing to tell, and
// once per distinct cwd at most (repoMatcher memoises). A dir with a notable event pays its 256 KiB tail
// whatever its cwd. Dirs are visited newest raw created_at first (ties keep directory order), which is the
// order of equal-ts events after the stable ts sort. A task.json torn by a writer is skipped for that poll.
function eventsOutput(tasksDir, cwd, since) {
  const repo = repoMatcher(cwd);
  const found = [];
  let dirs;
  try { dirs = readdirSync(tasksDir, { withFileTypes: true }).filter((e) => e.isDirectory()); } catch { dirs = []; }
  for (const e of dirs) {
    const ledger = join(tasksDir, e.name, 'ledger.jsonl');
    try { if (statSync(ledger).mtimeMs <= Math.max(0, since - HOLD_MS)) continue; } catch { continue; }
    let raw;
    try { raw = JSON.parse(readFileSync(join(tasksDir, e.name, 'task.json'), 'utf8')); } catch { continue; }
    if (!raw || typeof raw !== 'object') continue;
    const events = notableEvents(tailLines(ledger), since, { now: Date.now(), ...taskFacts(raw) });
    if (!events.length) continue;
    // a cwd that no longer exists and is not the session's cannot match: no git for it
    if (cwd && !(raw.cwd && (existsSync(raw.cwd) || resolve(raw.cwd) === resolve(cwd)) && repo(raw.cwd).match)) continue;
    found.push({ created: raw.created_at || 0, events });
  }
  found.sort((a, b) => b.created - a.created);
  const out = found.flatMap((f) => f.events);
  out.sort((a, b) => a.ts - b.ts);
  return out.map((e) => JSON.stringify(e) + '\n').join('');
}

// One ReportPayload line for --task (the teams-status Report tab and end-of-run card). A task that is
// unknown or unreadable still gets a payload, with report and retro null.
function reportOutput(tasksDir, taskId) {
  const m = taskId ? collectTask(tasksDir, taskId) : null;
  let raw = null;
  if (m && !m.error) {
    try { raw = JSON.parse(readFileSync(join(tasksDir, taskId, 'task.json'), 'utf8')); } catch { raw = null; }
  }
  const verdict = raw ? (m.state === 'complete' ? 'finished' : m.state === 'running' ? 'running' : 'blocked') : undefined;
  return JSON.stringify(reportPayload(raw || { run_id: taskId || '' }, { verdict })) + '\n';
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
// is left (a root missing at startup counts at the first check, no grace), or once IDLE_MS has passed
// with no HTTP request (GET /state.json included) and no live task in any remaining root. Live is
// the set view-floor-fs.mjs calls OPEN (not exported there); BLOCKED, stalled, unknown and error rows
// are not live. The record <root>/.view.json is left as it is - a dead pid already reads as no record.
const DIR_CHECK_MS = 2000;
const IDLE_DEFAULT_MS = 30 * 60 * 1000;
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
  let lastRequest = Date.now();
  const server = createServer((req, res) => {
    lastRequest = Date.now();
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
    if (Date.now() - lastRequest < idleMs()) return;
    let rows;
    try { rows = roots.flatMap((root) => listTasks(root)); } catch { return; }
    if (!rows.some((r) => LIVE.has(r.state))) end();
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
    if (args.format === 'status') { process.stdout.write(statusOutput(tasksDir, args.cwd, args.session)); return; }
    if (args.format === 'summary') { process.stdout.write(summaryOutput(tasksDir, args.cwd, args.task, args.session)); return; }
    if (args.format === 'board') { process.stdout.write(boardOutput(tasksDir, args.cwd, args.task, args.session)); return; }
    if (args.format === 'teams') { process.stdout.write(teamsOutput(tasksDir, args.cwd, args.task, args.session)); return; }
    if (args.format === 'decisions') { process.stdout.write(decisionsOutput(tasksDir, args.task, args.card)); return; }
    if (args.format === 'report') { process.stdout.write(reportOutput(tasksDir, args.task)); return; }
    if (args.format === 'events') { process.stdout.write(eventsOutput(tasksDir, args.cwd, args.since || 0)); return; }
    if (args.task) {
      process.stdout.write(render(collectTask(tasksDir, args.task)));
      return;
    }
    const rows = listTasks(tasksDir);
    if (rows.length === 1) {
      process.stdout.write(render(collectTask(tasksDir, rows[0].task_id)));
      return;
    }
    // tickets/resources need one specific task to draw a board/tree for - an index of several
    // tasks falls back to the same plain task list every --view does, rather than a board with
    // nothing on it.
    process.stdout.write(renderIndexText(rows, tasksDir));
    return;
  }

  startServer(tasksDir, args.task || null, args.port);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
