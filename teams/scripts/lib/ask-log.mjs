// asks.jsonl: <tasksDir>/<task_id>/asks.jsonl, one JSON row per line, appended by ask-message.mjs
// ({event:'sent'|'send_failed'|'received', key, ...}) and read by view.mjs. Missing/garbled = no rows.
import { readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export function readRows(tasksDir, taskId) {
  let text;
  try { text = readFileSync(join(tasksDir, taskId, 'asks.jsonl'), 'utf8'); } catch { return []; }
  const out = [];
  for (const l of text.split('\n')) {
    if (!l.trim()) continue;
    try { const r = JSON.parse(l); if (r && typeof r === 'object') out.push(r); } catch { /* skip */ }
  }
  return out;
}

export function appendRow(tasksDir, taskId, row) {
  mkdirSync(join(tasksDir, taskId), { recursive: true });
  appendFileSync(join(tasksDir, taskId, 'asks.jsonl'), JSON.stringify(row) + '\n');
}

// [{ key, session }] of every 'received' row of the given tasks
export function receivedRows(tasksDir, taskIds) {
  return taskIds.flatMap((id) => readRows(tasksDir, id)).filter((r) => r.event === 'received').map((r) => ({ key: r.key, session: r.session }));
}
