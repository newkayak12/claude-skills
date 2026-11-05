// A small index of finished tasks under the tasks dir (<tasksDir>/.view-index.json), so the status
// reads do not re-open and re-collect every task ever run. Keyed by task dir name plus the mtime and
// size of task.json and ledger.jsonl: a finished task whose files are unchanged is never re-read, any
// other task is always re-read. A long-lived reader (the engine's state server) also keeps the
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
// throwIfNoEntry: false, because a missing file is the common case here (a task with no ledger, a dir with no
// task.json) and a thrown ENOENT costs far more than the stat itself on a root of thousands of tasks.
const statNow = (p) => { try { const s = statSync(p, { throwIfNoEntry: false }); return s ? { mtime: s.mtimeMs, size: s.size } : null; } catch { return null; } };

// The shared server renders every call of one tick (2 s) inside withTickStats(map, fn): a path is stat'd once
// per tick, whoever asks (this file, the task cache, the events sweep), so the tick reads one snapshot of the root.
let tickStats = null;
export function withTickStats(map, fn) {
  const prev = tickStats;
  tickStats = map;
  try { return fn(); } finally { tickStats = prev; }
}
// fn() once per tick (and every time outside one): a fact several tasks of the tick ask for.
export function tickMemo(key, fn) {
  if (!tickStats) return fn();
  if (tickStats.has(key)) return tickStats.get(key);
  const v = fn();
  tickStats.set(key, v);
  return v;
}

// The names of the directories under a tasks dir (null when it cannot be read), read once per tick likewise.
export function listDirs(tasksDir) {
  const key = `dirs\0${tasksDir}`;
  if (tickStats && tickStats.has(key)) return tickStats.get(key);
  let names = null;
  try { names = readdirSync(tasksDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); } catch { /* unreadable */ }
  if (tickStats) tickStats.set(key, names);
  return names;
}
export function statOf(p) {
  if (!tickStats) return statNow(p);
  if (tickStats.has(p)) return tickStats.get(p);
  const s = statNow(p);
  tickStats.set(p, s);
  return s;
}

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
    const written = statNow(join(tasksDir, INDEX));
    if (tickStats) tickStats.set(join(tasksDir, INDEX), written);
    loaded.set(tasksDir, { sig: written ? `${written.mtime}:${written.size}` : null, tasks });
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
//
// `settledMs` (a long-lived reader): a 'task' finish is checked against its task.json at most once per
// settledMs, not on every call, so a root of thousands of finished tasks costs a readdir between full checks.
// A finished task that is rewritten is found at the next check. The same holds, between checks, for a
// 'ledger' finish whose ledger was last written over an hour ago and for a dir with no task.json (a ledger
// and nothing else) that nothing has touched for a minute. A dir with no task.json is otherwise kept by its
// own mtime: a task.json created in it moves that mtime, so one stat of the dir replaces the stats of both
// files and the existence check; an mtime under BARE_QUIET_MS old is not trusted (a coarse file-system clock).
// Such an entry comes back as { id, raw: null, absent: true }.
const sweptAt = new Map();
const bareDirs = new Map();
const QUIET_MS = 60 * 60 * 1000;
const BARE_QUIET_MS = 2000;
const BARE_SETTLED_MS = 60 * 1000;

export function openTasks(tasksDir, { running = false, settledMs = 0 } = {}) {
  const dirs = listDirs(tasksDir);
  if (!dirs) return [];
  const known = loadIndex(tasksDir);
  const next = {};
  const out = [];
  const nowMs = Date.now();
  const settled = settledMs > 0 && nowMs - (sweptAt.get(tasksDir) || 0) < settledMs;
  if (!settled) sweptAt.set(tasksDir, nowMs);
  const bare = bareDirs.get(tasksDir) || new Map();
  const nextBare = new Map();
  bareDirs.set(tasksDir, nextBare);
  for (const id of dirs) {
    const hit = known[id];
    if (settled && hit && hit.kind === 'task') { next[id] = hit; continue; }
    if (settled && hit && hit.kind === 'ledger' && hit.lmtime && nowMs - hit.lmtime > QUIET_MS) {
      const kept = running ? null : keptRaw.get(`${tasksDir}\0${id}`);
      if (running || kept) { next[id] = hit; if (kept) out.push({ id, raw: kept.raw }); continue; }
    }
    const was = bare.get(id);
    if (was) {
      const d = settled && nowMs - was > BARE_SETTLED_MS ? { mtime: was } : statOf(join(tasksDir, id));
      if (d && d.mtime === was) { nextBare.set(id, was); out.push({ id, raw: null, absent: true }); continue; }
    }
    const t = statOf(join(tasksDir, id, 'task.json'));
    if (t === null && !hit) {
      const d = statOf(join(tasksDir, id));
      if (d && nowMs - d.mtime > BARE_QUIET_MS) nextBare.set(id, d.mtime);
    }
    // A 'task' finish is decided from task.json alone, so its ledger is not even stat'd.
    if (hit && hit.kind === 'task' && t && hit.mtime === t.mtime && hit.size === t.size) { next[id] = hit; continue; }
    const l = statOf(join(tasksDir, id, 'ledger.jsonl'));
    const fresh = hit && t && hit.mtime === t.mtime && hit.size === t.size
      && (l ? hit.lmtime === l.mtime && hit.lsize === l.size : hit.lmtime === null);
    if (fresh && running) { next[id] = hit; continue; }
    // A task still listed (an open one, or a 'ledger' finish for readers that are not `running`) hands out
    // its task.json: the parsed copy from the last call stands while the file's mtime and size do, so a
    // long-lived reader does not parse a running task's file again on every call.
    const kept = t ? keptRaw.get(`${tasksDir}\0${id}`) : null;
    const raw = kept && kept.mtime === t.mtime && kept.size === t.size ? kept.raw : (t === null ? null : readJson(join(tasksDir, id, 'task.json')));
    // A task found not finished stays so while both files' mtime and size do (`open`): its ledger tail is not read again.
    const lsig = l ? `${l.mtime}:${l.size}` : '';
    const same = kept && t && kept.mtime === t.mtime && kept.size === t.size;
    const entry = fresh ? hit : (same && kept.open === lsig ? null : entryOf(tasksDir, id, raw, t, l));
    if (entry) next[id] = entry;
    if (raw && t) keptRaw.set(`${tasksDir}\0${id}`, { mtime: t.mtime, size: t.size, raw, open: entry ? null : lsig });
    if (!entry || (entry.kind === 'ledger' && !running)) out.push(nextBare.has(id) ? { id, raw, absent: true } : { id, raw });
  }
  const present = new Set(dirs);
  for (const k of keptRaw.keys()) {
    if (!k.startsWith(`${tasksDir}\0`)) continue;
    const id = k.slice(tasksDir.length + 1);
    if (!present.has(id) || (next[id] && next[id].kind === 'task')) keptRaw.delete(k);
  }
  const ids = Object.keys(next);
  if (ids.length !== Object.keys(known).length || ids.some((id) => known[id] !== next[id])) saveIndex(tasksDir, next);
  return out;
}
