#!/usr/bin/env node
// ask-message.mjs - the node side of the ask hand-off (the teams mod only runs these and sends/receives).
//
//   --send-plan --self <id>     stdout: JSON [{ to, text, key }] the driver `self` should send (env
//                               TEAMS_OPENER_SESSION_ID + TEAMS_TASK_ID); `[]` when env is missing or nothing may be sent
//   --sent <key> --ok | --error <msg>   append a sent / send_failed row to the task's asks.jsonl (silent)
//   --received --session <id>   stdin: a peer message; a teams ask appends a `received` row and prints its key,
//                               anything else prints nothing; exit 0 either way
// Rows: <tasksDir>/<task_id>/asks.jsonl. Sessions: TEAMS_SESSIONS_DIR, else ~/.claude/sessions.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { tasksRoot } from '../mcp/taskmanager.mjs';
import { floorTasks } from './lib/view-floor-fs.mjs';
import { asksFor } from './lib/view-asks.mjs';
import { askMessage, parseAskMessage, asksToSend } from './lib/ask-message.mjs';
import { readRows, appendRow } from './lib/ask-log.mjs';

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return !!e && e.code === 'EPERM'; }
}

function readSessions() {
  const dir = process.env.TEAMS_SESSIONS_DIR || join(homedir(), '.claude', 'sessions');
  const out = [];
  let names = [];
  try { names = readdirSync(dir).filter((n) => n.endsWith('.json')); } catch { return out; }
  for (const n of names) {
    try { const r = JSON.parse(readFileSync(join(dir, n), 'utf8')); if (r && typeof r === 'object') out.push(r); } catch { /* skip */ }
  }
  return out;
}

// this driver's open task's asks addressed to its opener
function currentAsks(tasksDir, opener, taskId) {
  const entries = floorTasks({ tasksDir, opener, now: Date.now() }).filter((x) => x.id === taskId);
  return asksFor(entries, opener);
}

function arg(argv, name) { const i = argv.indexOf(name); return i < 0 ? undefined : argv[i + 1]; }

async function main(argv) {
  const tasksDir = tasksRoot();
  const opener = process.env.TEAMS_OPENER_SESSION_ID;
  const taskId = process.env.TEAMS_TASK_ID;
  if (argv.includes('--send-plan')) {
    if (!opener || !taskId) { process.stdout.write('[]\n'); return; }
    const sent = readRows(tasksDir, taskId).filter((r) => r.event === 'sent');
    const plan = asksToSend({ opener, self: arg(argv, '--self'), asks: currentAsks(tasksDir, opener, taskId), sessions: readSessions(), sent, alive });
    process.stdout.write(JSON.stringify(plan.map((a) => ({ to: opener, text: askMessage(a), key: a.key }))) + '\n');
  } else if (argv.includes('--sent')) {
    const key = arg(argv, '--sent');
    if (!key || !opener || !taskId) return;
    const hit = currentAsks(tasksDir, opener, taskId).find((a) => a.key === key);
    const ok = argv.includes('--ok');
    appendRow(tasksDir, taskId, { event: ok ? 'sent' : 'send_failed', key, to: opener, since: hit ? hit.since : null, ...(ok ? {} : { error: arg(argv, '--error') || '' }), at: Date.now() });
  } else if (argv.includes('--received')) {
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
