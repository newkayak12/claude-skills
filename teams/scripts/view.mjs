#!/usr/bin/env node
// view.mjs - a human-readable text window onto a teams task (teams/mcp/taskmanager.mjs).
//
// The MCP tools (tm_status, tm_board, ...) return machine-shaped JSON for a driving session.
// This is the separate human surface the repo's convention asks for: dump a running or finished
// task (size -> shape -> critique -> dispatch(es) -> integrate -> gate:goal -> report) as a
// plain-text tree for a terminal / CI log. It serves nothing and starts no process.
//
// Read-only. It never writes task.json, a child run file, or anything else under the tasks
// root - it only reads, and tolerates whatever it finds half-written or missing.
//
//   node view.mjs --once [--tasks-dir <dir>] [--task <id>]
//
//     --tasks-dir <dir>   defaults to tasksRoot() (HARNESS_TASKS_DIR env, else ~/.harness/tasks)
//     --task <id>         a specific task id; omitted shows an index of every task found
//     --once              print a text tree to stdout and exit; required (without it: usage, exit 1)
//
// --once's text tree comes from ONE collect() function (teams/scripts/lib/view-collect.mjs) - this
// file only parses flags. The --once answers themselves live in lib/view-once.mjs, which the
// engine's state server (mcp/stateserver.mjs) also serves.
// tasksRoot is taskmanager.mjs's own re-export of this one; taskmanager.mjs pulls in the whole task layer, ~50 ms to load on every call.
import { tasksRoot } from '../mcp/taskstate.mjs';
import { VIEWS, onceOutput } from './lib/view-once.mjs';

function parseArgs(argv) {
  const a = { view: 'pipeline' };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--tasks-dir') a.tasksDir = argv[++i];
    else if (arg === '--task') a.task = argv[++i];
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
  return 'usage: node view.mjs --once [--tasks-dir <dir>] [--task <id>] [--view pipeline|tickets|resources] [--format status|events|summary|teams|board [--since <ts>] [--cwd <dir>] [--session <id>]] [--format report --task <id> [--cwd <dir>]] [--format decisions --task <id> [--card <id>]]\n';
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

  if (!args.once) {
    process.stderr.write(usage());
    process.exitCode = 1;
    return;
  }
  process.stdout.write(onceOutput(args, tasksDir, render));
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
