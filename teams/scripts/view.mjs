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
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tasksRoot } from '../mcp/taskmanager.mjs';
import { collectTask, listTasks } from './lib/view-collect.mjs';
import { renderText, renderIndexText, renderTicketsText, renderResourcesText } from './lib/view-render-text.mjs';

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
    else if (arg === '--help' || arg === '-h') a.help = true;
  }
  return a;
}

function usage() {
  return 'usage: node view.mjs [--tasks-dir <dir>] [--task <id>] [--port <n>] [--once] [--view pipeline|tickets|resources]\n';
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
