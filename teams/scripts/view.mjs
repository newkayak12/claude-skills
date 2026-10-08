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
//     --port <n>          HTTP port, 0 (the default) picks a free one
//     --once              print a text tree to stdout and exit; no server
//
// Both the HTML page's /state.json and --once's text tree come from ONE collect() function
// (teams/scripts/lib/view-collect.mjs) - this file only renders it two ways.
import { createServer } from 'node:http';
import { readFileSync, existsSync, openSync, readSync, fstatSync, closeSync, statSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tasksRoot } from '../mcp/taskmanager.mjs';
import { collectTask, listTasks } from './lib/view-collect.mjs';
import { renderText, renderIndexText, renderTicketsText, renderResourcesText } from './lib/view-render-text.mjs';
import { notableEvents, statusLine } from './lib/view-events.mjs';
import { summarize } from './lib/view-summary.mjs';
import { reportPayload } from './lib/view-report.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

// --view picks which of the three renderers --once prints for a single task; the HTML page (the
// non---once path) always ships the full model and lets the browser switch between all three
// with no extra request - see view-page.html's own view-tabs. Default 'pipeline': the surface
// this file has always shown, unchanged for anyone not passing the flag.
const VIEWS = { pipeline: renderText, tickets: renderTicketsText, resources: renderResourcesText };

function parseArgs(argv) {
  const a = { port: 0, view: 'pipeline' };
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
    else if (arg === '--help'|| arg === '-h') a.help = true;
  }
  return a;
}

function usage() {
  return 'usage: node view.mjs [--tasks-dir <dir>] [--task <id>] [--port <n>] [--once] [--view pipeline|tickets|resources] [--once --format status|events|summary [--since <ts>] [--cwd <dir>]] [--once --format report --task <id> [--cwd <dir>]]\n';
}

// ---------- --once --format status|events (the teams-live mod's data) ----------

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

// Running tasks, decided by collectTask(): state 'running' (a dead daemon reads 'stalled'). A
// task.json-less dir is never listed, and an unreadable one carries `error`, so unknown = not running.
// Same directory through different paths (/var -> /private/var, any symlink) must match. A path
// that no longer exists (a deleted temp repo) falls back to resolve().
function samePath(p) {
  try { return realpathSync(p); } catch { return resolve(p); }
}

function runningModels(tasksDir, cwd) {
  const want = cwd ? samePath(cwd) : null;
  const out = [];
  for (const row of listTasks(tasksDir)) {
    const m = collectTask(tasksDir, row.task_id);
    if (m.error || m.state !== 'running') continue;
    if (want && (!m.cwd || samePath(m.cwd) !== want)) continue;
    out.push(m);
  }
  return out;
}

function statusOutput(tasksDir, cwd) {
  const models = runningModels(tasksDir, cwd);
  const rows = models.map((m) => {
    const c = m.counts || {};
    const total = Object.values(c).reduce((s, n) => s + (Number(n) || 0), 0);
    const cur = (m.manager_stages || []).find((n) => n.state === 'running')
      || (m.packages || []).find((p) => p.state === 'running');
    return { id: 'E-' + String(m.task_id).replace(/^E-/, '').slice(0, 8), state: m.state, done: c.done || 0, total, current: cur ? (cur.node_id || cur.id || '') : '' };
  });
  // waiting = nodes in state waiting_human, counted from task.json (no ledger records that event).
  const waiting = models.reduce((s, m) => s + ((m.counts && m.counts.waiting_human) || 0), 0);
  const newest = models.reduce((a, m) => (!a || (m.created_at || 0) > (a.created_at || 0) ? m : a), null);
  return JSON.stringify({ line: statusLine(rows), waiting, latest: newest ? newest.task_id : null }) + '\n';
}

// { status, task }: status is exactly --format status; task is the human summary of --task, else of
// status.latest, else null (nothing running, or the task file is unreadable).
function summaryOutput(tasksDir, cwd, taskId) {
  const status = JSON.parse(statusOutput(tasksDir, cwd));
  const id = taskId || status.latest;
  const m = id ? collectTask(tasksDir, id) : null;
  return JSON.stringify({ status, task: m && !m.error ? summarize(m) : null }) + '\n';
}

// Ledgers whose file changed after `since` (mtime, ms), whatever the task's state: daemon_done and
// daemon_exhausted are written after a task stops running, so a running-only filter would never
// deliver them. A task.json-less dir is not listed and an unreadable one carries `error`; both skipped.
function eventsOutput(tasksDir, cwd, since) {
  const want = cwd ? samePath(cwd) : null;
  const out = [];
  for (const row of listTasks(tasksDir)) {
    if (row.error) continue;
    const ledger = join(tasksDir, row.task_id, 'ledger.jsonl');
    try { if (statSync(ledger).mtimeMs <= since) continue; } catch { continue; }
    if (want) {
      const m = collectTask(tasksDir, row.task_id);
      if (m.error || !m.cwd || samePath(m.cwd) !== want) continue;
    }
    out.push(...notableEvents(tailLines(ledger), since));
  }
  out.sort((a, b) => a.ts - b.ts);
  return out.map((e) => JSON.stringify(e) + '\n').join('');
}

// One ReportPayload line for --task (the teams-live Report tab and end-of-run card). A task that is
// unknown or unreadable still gets a payload, with report and retro null.
function reportOutput(tasksDir, taskId) {
  const m = taskId ? collectTask(tasksDir, taskId) : null;
  let raw = null;
  if (m && !m.error) {
    try { raw = JSON.parse(readFileSync(join(tasksDir, taskId, 'task.json'), 'utf8')); } catch { raw = null; }
  }
  const p = reportPayload(raw || { run_id: taskId || '' });
  if (raw) p.verdict = m.state === 'complete' ? 'finished' : m.state === 'running' ? 'running' : 'blocked';
  return JSON.stringify(p) + '\n';
}

// ---------- HTML page (inline CSS/JS, no CDN; polls /state.json) ----------

function pageHtml() {
  return readFileSync(join(HERE, 'lib', 'view-page.html'), 'utf8');
}

function stateJson(tasksDir, taskId) {
  if (taskId) {
    return JSON.stringify({ mode: 'task', tasks_dir: tasksDir, model: collectTask(tasksDir, taskId) });
  }
  const rows = listTasks(tasksDir);
  if (rows.length === 1) {
    return JSON.stringify({ mode: 'task', tasks_dir: tasksDir, model: collectTask(tasksDir, rows[0].task_id) });
  }
  return JSON.stringify({ mode: 'index', tasks_dir: tasksDir, tasks: rows });
}

function startServer(tasksDir, taskId, port) {
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/state.json') {
      const effectiveTask = taskId || url.searchParams.get('task') || null;
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(stateJson(tasksDir, effectiveTask));
      return;
    }
    // The task's own package map (shape's diagram, or the dependency map). The path comes from
    // the task file, never from the query, so this serves nothing but that one drawing.
    if (url.pathname === '/package-map') {
      const id = taskId || url.searchParams.get('task') || (listTasks(tasksDir)[0] || {}).task_id;
      const m = id ? collectTask(tasksDir, id) : null;
      const p = m && m.package_map && m.package_map.path;
      if (!p || !existsSync(p)) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('no package map yet - it is drawn when shape finishes'); return; }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(readFileSync(p));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(pageHtml());
  });
  server.listen(port, '127.0.0.1', () => {
    const addr = server.address();
    console.log(`teams view listening on http://127.0.0.1:${addr.port}${taskId ? `/?task=${taskId}` : ''}`);
    console.log(`tasks dir: ${tasksDir}`);
  });
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
    if (args.format === 'status') { process.stdout.write(statusOutput(tasksDir, args.cwd)); return; }
    if (args.format === 'summary') { process.stdout.write(summaryOutput(tasksDir, args.cwd, args.task)); return; }
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
