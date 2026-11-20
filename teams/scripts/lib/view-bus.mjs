// The bus as the views show it (card 126, package P3): <tasksDir>/<task id>/bus.jsonl turned into `threads`
// and the person's derived unread state. THE contract the mod package renders; read-only, never writes.
//
// JSON shape (view-once.mjs puts it on the task summary of --format summary|teams as `threads` and
// `unread`; --format story carries both too, its threads limited to the STORY).
// A task with no message has no bus.jsonl content to show: its summary/teams task and the status
// `notices` then OMIT the keys (the byte-for-byte goldens of test-view-once-perf.mjs, which this package
// may not regenerate, have none), so a reader treats absent as `threads: []`, `unread: { count: 0,
// notice: null }` and `notices: []`. The --format story payload always carries both keys. (default - revisit:
// always emit the keys once those goldens are regenerated)
//
//   threads: [{ topic, story, messages: [{ from, to, body, ts, time }] }]
//     One entry per sub-topic that holds a message: `E-xxxxxxxx/Pn` (a STORY's thread) and
//     `E-xxxxxxxx/all` (broadcasts and teamleader<->person messages). `story` is the part after the
//     slash ('Pn' or 'all'). Messages are newest last, threads are ordered by their newest message
//     (newest thread last). `from` and `to` are the bus keys as stored ('teamleader', 'person', 'all' or
//     `E-xxxxxxxx/Pn`); `body` is kept whole; `ts` is the bus message id (ms); `time` is that ts in the
//     process's local time as `YYYY-MM-DD HH:MM` (the tests run with TZ=UTC).
//     In --format story a STORY's threads are the messages bus.mjs lets that STORY read: to === the STORY,
//     from === the STORY, or to === 'all', grouped by their topic. So a message the STORY sent to a sibling
//     sits in the sibling's sub-topic, and a teamleader<->person message (topic E-xxxxxxxx/all) is never
//     in a STORY's threads. A task with no bus.jsonl gives `threads: []`.
//
//   unread: { count, notice }
//     The person's unread messages are the bus messages with to === 'person' whose ts is greater than the
//     person's mark. The mark is the largest ts over bus messages with from === 'person' and the ledger's
//     tm_submit / tm_submit_human events (default - revisit: tm_submit is written for a node's submission
//     and tm_submit_human for a person's answer; both count as the person acting on the task). The mark is
//     never stored and opening the pane clears nothing (decision U12): the count goes down only when
//     the person posts or submits later than the message. This is NOT bus.mjs's unreadFor, which is for
//     STORY and teamleader readers.
//     notice is null (count 0) or the newest unread message as a band row:
//       { task_id, kind: 'message', from, who, body, ts, text }
//     `who` is the sender's package id ('P2') or its role name; `body` is the message clipped to BAND_CLIP
//     characters with a trailing '…' (whitespace collapsed to one line); `text` is the band row
//     '✉ <who> -> you: <body>'. view-once.mjs's `status.notices` lists these rows, one per live open task of
//     the session, next to `status.asks`.
//
// Text (threadsLines): `threads:` then, per thread, its topic and one line per message,
// `from -> to  body  time` (body whole, on one line).
//
// The file is read as bus.mjs reads it: only complete lines (a trailing line with no newline is left out),
// a complete line that does not parse is skipped. The path is <tasksDir>/<task id>/BUS_FILE from the
// tasks dir the view was given, not from HARNESS_TASKS_DIR. Nothing here writes a file.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BUS_FILE } from '../../mcp/bus.mjs';

export const BAND_CLIP = 120;

const oneLine = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
export const clipBody = (s, n = BAND_CLIP) => { const t = oneLine(s); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

const pad = (n) => String(n).padStart(2, '0');
export function timeOf(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const task8 = (taskId) => String(taskId).replace(/^E-/, '').slice(0, 8);
const STORY_KEY = /^E-[0-9a-f]{8}\/([^/]+)$/;
const str = (v) => typeof v === 'string';

// Every complete, parseable line of a task's bus.jsonl as a bus record, oldest first; [] when the file is absent.
export function busMessages(tasksDir, taskId) {
  let text;
  try { text = readFileSync(join(tasksDir, String(taskId), BUS_FILE), 'utf8'); } catch { return []; }
  const cut = text.lastIndexOf('\n');
  if (cut < 0) return [];
  const out = [];
  for (const line of text.slice(0, cut).split('\n')) {
    if (!line.trim()) continue;
    try {
      const m = JSON.parse(line);
      if (m && typeof m === 'object' && Number.isFinite(m.ts) && str(m.from) && str(m.to) && str(m.topic) && str(m.body)) out.push(m);
    } catch { /* skipped, as bus.mjs does */ }
  }
  return out.sort((a, b) => a.ts - b.ts);
}

// The threads array. `story` ('P2') limits it to what that STORY may read (bus.mjs's visibility rule).
export function threadsOf(messages, taskId, { story } = {}) {
  const self = story ? `E-${task8(taskId)}/${story}` : null;
  const visible = self ? messages.filter((m) => m.to === self || m.from === self || m.to === 'all') : messages;
  const by = new Map();
  for (const m of visible) {
    if (!by.has(m.topic)) by.set(m.topic, { topic: m.topic, story: m.topic.slice(m.topic.indexOf('/') + 1), messages: [] });
    by.get(m.topic).messages.push({ from: m.from, to: m.to, body: m.body, ts: m.ts, time: timeOf(m.ts) });
  }
  const last = (t) => t.messages[t.messages.length - 1].ts;
  return [...by.values()].sort((a, b) => last(a) - last(b));
}

// The ledger's tm_submit / tm_submit_human timestamps; read only when a person-addressed message is waiting.
function submitMark(tasksDir, taskId) {
  let text = '';
  try { text = readFileSync(join(tasksDir, String(taskId), 'ledger.jsonl'), 'utf8'); } catch { return 0; }
  let mark = 0;
  for (const line of text.split('\n')) {
    if (!line.includes('"tm_submit')) continue;
    try {
      const e = JSON.parse(line);
      if ((e.event === 'tm_submit' || e.event === 'tm_submit_human') && Number.isFinite(e.ts)) mark = Math.max(mark, e.ts);
    } catch { /* a torn line */ }
  }
  return mark;
}

// { count, notice } of the person's unread messages, derived (never stored).
export function unreadOf(tasksDir, taskId, messages = busMessages(tasksDir, taskId)) {
  const mine = messages.filter((m) => m.to === 'person');
  if (!mine.length) return { count: 0, notice: null };
  let mark = messages.reduce((a, m) => (m.from === 'person' ? Math.max(a, m.ts) : a), 0);
  if (mine.some((m) => m.ts > mark)) mark = Math.max(mark, submitMark(tasksDir, taskId));
  const unread = mine.filter((m) => m.ts > mark);
  if (!unread.length) return { count: 0, notice: null };
  const m = unread[unread.length - 1];
  const hit = STORY_KEY.exec(m.from);
  const who = hit ? hit[1] : m.from;
  const body = clipBody(m.body);
  return { count: unread.length, notice: { task_id: String(taskId), kind: 'message', from: m.from, who, body, ts: m.ts, text: `✉ ${who} -> you: ${body}` } };
}

// { threads, unread } of one task; `story` limits the threads to one STORY's.
export function busView(tasksDir, taskId, { story } = {}) {
  const messages = busMessages(tasksDir, taskId);
  return { threads: threadsOf(messages, taskId, { story }), unread: unreadOf(tasksDir, taskId, messages) };
}

// busView's fields for a task summary: nothing (the keys omitted) for a task with no message.
export function busFields(tasksDir, taskId) {
  const v = busView(tasksDir, taskId);
  return v.threads.length ? v : {};
}

// The threads as text lines (none for no threads), one message per line: `from -> to  body  time`.
export function threadsLines(threads) {
  if (!threads || !threads.length) return [];
  const L = ['threads:'];
  for (const t of threads) {
    L.push(`  ${t.topic}`);
    for (const m of t.messages) L.push(`    ${m.from} -> ${m.to}  ${oneLine(m.body)}  ${m.time}`);
  }
  return L;
}
