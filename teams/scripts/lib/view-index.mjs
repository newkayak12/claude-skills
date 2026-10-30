// A small index of finished tasks under the tasks dir (<tasksDir>/.view-index.json), so the status
// reads do not re-open and re-collect every task ever run. Keyed by task dir name plus mtimes:
// a finished task whose mtimes are unchanged is never re-read, any other task is always re-read.
//
// Two kinds of finished, both stored with state, cwd and opener:
//   'task'   decided from task.json alone (cancelled, or a report node done with no s_run /
//            harness_run, whose state lives in files outside the task dir). Final for every reader.
//   'ledger' the ledger's last line is daemon_done or clean. Such a task is not running, but a card
//            parked on a person can still be listed, so only `running: true` readers skip it.
// Written atomically; a missing, corrupt or unwritable index means a full read and never throws.
// Nothing under the tasks dir is deleted or moved.
import { readFileSync, readdirSync, statSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { epicTicketState } from '../../mcp/tickets.mjs';
import { readLogTail } from '../../mcp/tasklog.mjs';

const INDEX = '.view-index.json';
const TERMINAL = new Set(['DONE', 'SETTLED', 'CANCELLED']);
const LEDGER_END = new Set(['daemon_done', 'clean']);

const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const mtimeOf = (p) => { try { return statSync(p).mtimeMs; } catch { return null; } };

function loadIndex(tasksDir) {
  const idx = readJson(join(tasksDir, INDEX));
  return idx && typeof idx === 'object' && idx.tasks && typeof idx.tasks === 'object' ? idx.tasks : {};
}

function saveIndex(tasksDir, tasks) {
  const tmp = join(tasksDir, `${INDEX}.${process.pid}.tmp`);
  try {
    writeFileSync(tmp, JSON.stringify({ tasks }));
    renameSync(tmp, join(tasksDir, INDEX));
  } catch { /* unwritable: the next call reads in full */ }
}

function entryOf(tasksDir, id, raw, mtime, lmtime) {
  if (!raw || typeof raw !== 'object') return null;
  const facts = { mtime, lmtime, cwd: raw.cwd || null, opener: (raw.opener && raw.opener.session_id) || null };
  if (raw.cancelled || !(raw.s_run || raw.harness_run || raw.worktree_gone)) {
    let state = null;
    try { state = epicTicketState(raw); } catch { /* torn: not decided from task.json */ }
    if (TERMINAL.has(state)) return { ...facts, kind: 'task', state };
  }
  const last = readLogTail(join(tasksDir, id, 'ledger.jsonl'), 1).lines.pop();
  let ev = null;
  try { ev = JSON.parse(last).event; } catch { /* no readable last line */ }
  return LEDGER_END.has(ev) ? { ...facts, kind: 'ledger', state: ev } : null;
}

// [{ id, raw }] for every task dir that is not a known-finished one: raw is task.json parsed (null when
// absent or unreadable, as a plain listing would give). `running: true` also skips 'ledger' finishes.
export function openTasks(tasksDir, { running = false } = {}) {
  let dirs;
  try { dirs = readdirSync(tasksDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); } catch { return []; }
  const known = loadIndex(tasksDir);
  const next = {};
  const out = [];
  for (const id of dirs) {
    const mtime = mtimeOf(join(tasksDir, id, 'task.json'));
    const lmtime = mtimeOf(join(tasksDir, id, 'ledger.jsonl'));
    const hit = known[id];
    const fresh = hit && mtime !== null && hit.mtime === mtime && (hit.kind === 'task' || hit.lmtime === lmtime);
    if (fresh && (hit.kind === 'task' || running)) { next[id] = hit; continue; }
    const raw = mtime === null ? null : readJson(join(tasksDir, id, 'task.json'));
    const entry = fresh ? hit : entryOf(tasksDir, id, raw, mtime, lmtime);
    if (entry) next[id] = entry;
    if (!entry || (entry.kind === 'ledger' && !running)) out.push({ id, raw });
  }
  const ids = Object.keys(next);
  if (ids.length !== Object.keys(known).length || ids.some((id) => known[id] !== next[id])) saveIndex(tasksDir, next);
  return out;
}
