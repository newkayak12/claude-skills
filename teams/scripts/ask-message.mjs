#!/usr/bin/env node
// ask-message.mjs - the node side of the ask hand-off (the teams mod only runs it and receives).
//
//   --received --session <id>   stdin: a peer message; a teams ask appends a `received` row and prints its key,
//                               anything else prints nothing; exit 0 either way
// Rows: <tasksDir>/<task_id>/asks.jsonl. The poll delivers an ask to its opener; this only records a received one.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tasksRoot } from '../mcp/taskmanager.mjs';
import { parseAskMessage } from './lib/ask-message.mjs';
import { appendRow } from './lib/ask-log.mjs';

function arg(argv, name) { const i = argv.indexOf(name); return i < 0 ? undefined : argv[i + 1]; }

async function main(argv) {
  const tasksDir = tasksRoot();
  if (argv.includes('--received')) {
    let text = '';
    for await (const c of process.stdin) text += c;
    const n = parseAskMessage(text.replace(/\n$/, ''));
    const session = arg(argv, '--session');
    if (!n || !session || !/^[A-Za-z0-9-]+$/.test(String(n.task_id || '')) || !existsSync(join(tasksDir, n.task_id, 'task.json'))) return;
    appendRow(tasksDir, n.task_id, { event: 'received', key: n.key, session, at: Date.now() });
    process.stdout.write(n.key + '\n');
  }
}

main(process.argv.slice(2)).catch(() => { process.exitCode = 0; });
