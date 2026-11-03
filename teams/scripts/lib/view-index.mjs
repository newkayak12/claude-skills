// A small index of finished tasks under the tasks dir (<tasksDir>/.view-index.json), so the status
// reads do not re-open and re-collect every task ever run. Keyed by task dir name plus the mtime and
// size of task.json and ledger.jsonl: a finished task whose files are unchanged is never re-read, any
// other task is always re-read. A long-lived reader (the --serve-once-socket server) also keeps the
// parsed index between calls, valid while the index file's own mtime and size are.
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
const statOf = (p) => { try { const s = statSync(p); return { mtime: s.mtimeMs, size: s.size }; } catch { return null; } };

// "<mtimeMs>:<size>" of a file, null when it is absent: the key a cache entry holds for that file.
export function statSig(p) {
  const s = statOf(p);
  return s ? `${s.mtime}:${s.size}` : null;
}

// The parsed index of one tasks dir, kept while the index file's mtime and size are unchanged.
const loaded = new Map();
// task.json as last parsed for a 'ledger' finish, per `<tasksDir>\0<id>`.
const keptRaw = new Map();

function loadIndex(tasksDir) {
  const path = join(tasksDir, INDEX);
  const sig = statSig(path);
  const hit = loaded.get(tasksDir);
  if (hit && hit.sig === sig) return hit.tasks;
  const idx = readJson(path);
  const tasks = idx && typeof idx === 'object' && idx.tasks && typeof idx.tasks === 'object' ? idx.tasks : {};
  if (sig !== null) loaded.set(tasksDir, { sig, tasks }); else loaded.delete(tasksDir);
  return tasks;
}

function saveIndex(tasksDir, tasks) {
  const tmp = join(tasksDir, `${INDEX}.${process.pid}.tmp`);
  try {
    writeFileSync(tmp, JSON.stringify({ tasks }));
    renameSync(tmp, join(tasksDir, INDEX));
    loaded.set(tasksDir, { sig: statSig(join(tasksDir, INDEX)), tasks });
  } catch { /* unwritable: the next call reads in full */ }
}

function entryOf(tasksDir, id, raw, t, l) {
  if (!raw || typeof raw !== 'object') return null;
  const facts = { mtime: t.mtime, size: t.size, lmtime: l && l.mtime, lsize: l && l.size, cwd: raw.cwd || null, opener: (raw.opener && raw.opener.session_id) || null };
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
    const t = statOf(join(tasksDir, id, 'task.json'));
    const hit = known[id];
    // A 'task' finish is decided from task.json alone, so its ledger is not even stat'd.
    if (hit && hit.kind === 'task' && t && hit.mtime === t.mtime && hit.size === t.size) { next[id] = hit; continue; }
    const l = statOf(join(tasksDir, id, 'ledger.jsonl'));
    const fresh = hit && t && hit.mtime === t.mtime && hit.size === t.size
      && (l ? hit.lmtime === l.mtime && hit.lsize === l.size : hit.lmtime === null);
    if (fresh && running) { next[id] = hit; continue; }
    // A 'ledger' finish is still listed for readers that are not `running`, so they get its task.json:
    // the parsed copy from the last call stands while the file's mtime and size do.
    const kept = fresh ? keptRaw.get(`${tasksDir}\0${id}`) : null;
    const raw = kept && kept.mtime === t.mtime && kept.size === t.size ? kept.raw : (t === null ? null : readJson(join(tasksDir, id, 'task.json')));
    const entry = fresh ? hit : entryOf(tasksDir, id, raw, t, l);
    if (entry) next[id] = entry;
    if (entry && entry.kind === 'ledger') keptRaw.set(`${tasksDir}\0${id}`, { mtime: t.mtime, size: t.size, raw });
    if (!entry || (entry.kind === 'ledger' && !running)) out.push({ id, raw });
  }
  for (const k of keptRaw.keys()) if (k.startsWith(`${tasksDir}\0`) && !(k.slice(tasksDir.length + 1) in next)) keptRaw.delete(k);
  const ids = Object.keys(next);
  if (ids.length !== Object.keys(known).length || ids.some((id) => known[id] !== next[id])) saveIndex(tasksDir, next);
  return out;
}
