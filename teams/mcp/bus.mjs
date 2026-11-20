// teams/mcp/bus.mjs - the engine-side message bus of one teams task (EPIC): card 126, package P1.
// THE shared contract: the sibling packages (wake, view-bus, the mod, the driver prompt) import from
// here and never re-type a shape. A leaf module: it imports only store.mjs, taskstate.mjs and
// storyask.mjs, and nothing in it imports taskmanager-tools.mjs.
//
// Storage: <task dir>/bus.jsonl, one JSON line per message, append-only, written ONLY by post()
// below - under the task lock (mutateTask), through store.mjs appendLedger, so a refused or throwing
// post writes no line. Each post also appends a body-less ledger event
//   { event: 'bus_message', ts, from, to, topic }
// (the body lives on the bus only).
//
// Message record - exactly six keys:
//   { ts, from, to, topic, body, reply_to }
//   ts        the message id: strictly increasing per task, max(Date.now(), task.bus_last_ts + 1),
//             and task.bus_last_ts moves in the same commit. A cursor is the last ts a reader saw.
//   from      'teamleader' | 'person' | a STORY key `E-<task8>/<pkg>`
//   to        the same, or 'all' (broadcast; only the teamleader and the person post to it)
//   topic     `E-<task8>/Pn`, or `E-<task8>/all`. The sub-topic is the recipient STORY, or the
//             sender STORY when `to` is 'teamleader'; `all` for a broadcast and for a
//             teamleader<->person message, which involves no STORY (default - revisit)
//   body      a non-empty string of at most BODY_MAX (8192) characters (UTF-16 units, as .length)
//   reply_to  null, or the ts of an existing message on this bus
//
// Exports for sibling packages:
//   post(task, input, env)        append one message inside an open task transaction; input is
//                                 {from, to, body, reply_to?}; returns {task_id, ts, topic};
//                                 throws Error('tm_post refused: <reason>') and changes nothing
//   postMessage(taskId, input, env)  the same, under mutateTask(taskId) (a resolved run id)
//   readMessages(task, {reader, cursor = 0, limit = 50})  pure read, no state change:
//                                 {messages, cursor, more}. Only ts > cursor, ascending, at most
//                                 READ_LIMIT. A STORY reader sees to=self, from=self and to='all';
//                                 teamleader and person see everything. A trailing line with no
//                                 newline is left for the next read and the cursor stays before it;
//                                 a complete line that does not parse is skipped.
//   readMarked(task, opts)        readMessages + the read mark, inside an open task transaction -
//                                 what tm_read runs; opts.env (default process.env) is the driver check
//   readBus(taskId, opts)         readMarked under mutateTask
//   unreadFor(task, key)          count of messages with to === key and ts > task.bus_reads[key]
//                                 ('all' broadcasts never count: they never wake). tm_read moves
//                                 the mark to the highest ts it returned (never lowered). COVERS
//                                 STORY AND TEAMLEADER READERS ONLY. The person's unread count is
//                                 NOT this: it is derived in view-bus.mjs from the person's last
//                                 post or tm_submit, nothing stored (decision U12), so a person's
//                                 tm_read does not clear it.
//   topicFor(task, from, to)      the topic spelling above
//   PERMISSIONS                   the who-may-post-to-whom table (data, one row per role pair)
//   BODY_MAX = 8192, READ_LIMIT = 50, BUS_FILE = 'bus.jsonl'
//
// Identity is trusted the way storyask.mjs validateAsk trusts it (decision U1): a STORY sender is
// accepted only as a running STORY of this EPIC. A call whose env has TEAMS_ASK_TASK_ID set is a
// driver and may not post as 'teamleader' or 'person' (nor read as them: default - revisit).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { appendLedger, mutateTask } from './store.mjs';
import { record, taskDir } from './taskstate.mjs';
import { validateAsk } from './storyask.mjs';

export const BODY_MAX = 8192;
export const READ_LIMIT = 50;
export const BUS_FILE = 'bus.jsonl';

// One row per (from role, to role). Roles: story (a STORY key), self (the sender's own key),
// teamleader, person, all. `allow: false` rows carry the refusal reason verbatim. Rows beyond the
// card's table - story->self, teamleader->teamleader, person->person - refuse a message to oneself
// (default - revisit).
export const PERMISSIONS = [
  { from: 'story', to: 'story', allow: true, reason: 'a package posts to a sibling package of the same EPIC' },
  { from: 'story', to: 'teamleader', allow: true, reason: 'a package posts to its TeamLeader' },
  { from: 'story', to: 'person', allow: false, reason: 'a package may not post to the person; ask with tm_ask, which forwards to the person as an ask card' },
  { from: 'story', to: 'all', allow: false, reason: 'only the teamleader and the person post to all' },
  { from: 'story', to: 'self', allow: false, reason: 'a package may not post to itself' },
  { from: 'teamleader', to: 'story', allow: true, reason: 'the TeamLeader posts to a package' },
  { from: 'teamleader', to: 'all', allow: true, reason: 'the TeamLeader broadcasts to every package' },
  { from: 'teamleader', to: 'person', allow: true, reason: 'the TeamLeader posts to the person' },
  { from: 'teamleader', to: 'teamleader', allow: false, reason: 'the teamleader may not post to itself' },
  { from: 'person', to: 'story', allow: true, reason: 'the person posts to a package' },
  { from: 'person', to: 'all', allow: true, reason: 'the person broadcasts to every package' },
  { from: 'person', to: 'teamleader', allow: true, reason: 'the person posts to the TeamLeader' },
  { from: 'person', to: 'person', allow: false, reason: 'the person may not post to themselves' },
];

const STORY_KEY = /^E-([0-9a-f]{8})\/([^/]+)$/;
const REFUSED = (reason) => new Error(`tm_post refused: ${reason}`);
const REFUSED_READ = (reason) => new Error(`tm_read refused: ${reason}`);
const task8 = (task) => String(task.run_id || task.id).slice(0, 8);
const busPath = (task) => join(taskDir(task.run_id), BUS_FILE);

// `from` and `to` are 'teamleader', 'person', 'all' (to only) or a STORY key. Returns
// {role, pkgId?} or {error}.
function roleOf(task, id, side) {
  if (id === 'teamleader' || id === 'person') return { role: id };
  if (id === 'all') return side === 'to' ? { role: 'all' } : { error: `from may not be all; ${side} is teamleader, person or a STORY key` };
  const m = typeof id === 'string' ? STORY_KEY.exec(id) : null;
  if (!m) return { error: `${side} must be teamleader, person${side === 'to' ? ', all' : ''} or a STORY key (E-xxxxxxxx/<package>)` };
  if (m[1] !== task8(task)) return { error: `${side} ${id} is not a STORY of this task` };
  return { role: 'story', pkgId: m[2] };
}

const declared = (task, pkgId) => (task.spec && Array.isArray(task.spec.packages) ? task.spec.packages : []).some((p) => p.id === pkgId);

// 'running' | 'undispatched' | a settled state, or null when the task has no such STORY.
function storyState(task, pkgId) {
  const list = (Array.isArray(task.nodes) ? task.nodes : []).filter((n) => n.subgoal_id === pkgId && n.stage === 'dispatch');
  const dispatch = list.length ? list[list.length - 1] : null;
  if (!dispatch) return declared(task, pkgId) ? 'undispatched' : null;
  return dispatch.state === 'pending' ? 'undispatched' : dispatch.state;
}
const SETTLED = new Set(['done', 'failed', 'skipped', 'unreachable']);

// Every complete line, parsed; the trailing segment with no newline is left out, and so is a
// complete line that does not parse (nothing can complete it).
function allMessages(path) {
  if (!existsSync(path)) return [];
  const text = readFileSync(path, 'utf8');
  const cut = text.lastIndexOf('\n');
  if (cut < 0) return [];
  const out = [];
  for (const line of text.slice(0, cut).split('\n')) {
    if (!line.trim()) continue;
    try {
      const m = JSON.parse(line);
      if (m && typeof m === 'object' && Number.isFinite(m.ts)) out.push(m);
    } catch { /* skipped */ }
  }
  return out;
}

// The topic of a message from `from` to `to` (both already valid keys or role names).
export function topicFor(task, from, to) {
  const e = `E-${task8(task)}`;
  if (to === 'all') return `${e}/all`;
  const story = STORY_KEY.exec(to) || (to === 'teamleader' ? STORY_KEY.exec(from) : null);
  return story ? `${e}/${story[2]}` : `${e}/all`;
}

// Check and append one message. Call inside a task transaction (withTask / mutateTask): every
// check runs before the first write, and a throw leaves task.json, bus.jsonl and the ledger as
// they were.
export function post(task, input, env = process.env) {
  const { from, to, body, reply_to } = input || {};
  if (task.cancelled) throw REFUSED('task cancelled: tm_cancel stopped it, nothing more is posted to it');
  // The body first: an empty or oversized body names the limit whoever sends it.
  if (typeof body !== 'string' || body.trim() === '' || body.length > BODY_MAX) {
    throw REFUSED(`body must be a non-empty string of at most ${BODY_MAX} characters`);
  }
  const f = roleOf(task, from, 'from');
  if (f.error) throw REFUSED(f.error);
  const t = roleOf(task, to, 'to');
  if (t.error) throw REFUSED(t.error);
  if ((f.role === 'teamleader' || f.role === 'person') && env && env.TEAMS_ASK_TASK_ID) {
    throw REFUSED(`a driver may not post as ${f.role}`);
  }
  const toRole = f.role === 'story' && t.role === 'story' && from === to ? 'self' : t.role;
  const row = PERMISSIONS.find((r) => r.from === f.role && r.to === toRole);
  if (!row || !row.allow) throw REFUSED(row ? row.reason : `no rule lets ${f.role} post to ${toRole}`);
  if (f.role === 'story') {
    const v = validateAsk({ task, key: from, question: body });
    if (!v.ok) throw REFUSED(v.reason);
  }
  if (t.role === 'story') {
    const state = storyState(task, t.pkgId);
    if (state === null) throw REFUSED(`no STORY ${t.pkgId} in this task`);
    if (SETTLED.has(state)) throw REFUSED(`STORY ${t.pkgId} is ${state}`);
  }
  const path = busPath(task);
  if (reply_to !== undefined && reply_to !== null && !allMessages(path).some((m) => m.ts === reply_to)) {
    throw REFUSED('reply_to is not the ts of a message on this bus');
  }
  const ts = Math.max(Date.now(), (Number.isFinite(task.bus_last_ts) ? task.bus_last_ts : 0) + 1);
  const topic = topicFor(task, from, to);
  const message = { ts, from, to, topic, body, reply_to: reply_to === undefined ? null : reply_to };
  task.bus_last_ts = ts;
  appendLedger(path, JSON.stringify(message) + '\n');
  record(task, { event: 'bus_message', ts, from, to, topic });
  return { task_id: task.run_id, ts, topic };
}

export function postMessage(taskId, input, env = process.env) {
  return mutateTask(taskId, (task) => post(task, input, env));
}

// {messages, cursor, more} for `reader`; changes nothing.
export function readMessages(task, opts = {}) {
  const { reader } = opts;
  const r = roleOf(task, reader, 'from');
  if (r.error || r.role === 'all') throw REFUSED_READ('key must be teamleader, person or a STORY key (E-xxxxxxxx/<package>) of this task');
  if (r.role === 'story' && storyState(task, r.pkgId) === null) throw REFUSED_READ(`no STORY ${r.pkgId} in this task`);
  const raw = opts.cursor === undefined || opts.cursor === null ? 0 : Number(opts.cursor);
  if (!Number.isFinite(raw) || raw < 0) throw REFUSED_READ('cursor must be a non-negative number');
  const limit = Math.min(READ_LIMIT, Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : READ_LIMIT);
  const visible = allMessages(busPath(task)).filter((m) => m.ts > raw
    && (r.role !== 'story' || m.to === reader || m.from === reader || m.to === 'all'));
  const messages = visible.slice(0, limit);
  return { messages, cursor: messages.length ? messages[messages.length - 1].ts : raw, more: visible.length > messages.length };
}

// What tm_read runs: the read, and the reader's mark moved to the highest ts it returned.
export function readMarked(task, opts = {}) {
  const env = opts.env || process.env;
  if ((opts.reader === 'teamleader' || opts.reader === 'person') && env.TEAMS_ASK_TASK_ID) {
    throw REFUSED_READ(`a driver may not read as ${opts.reader}`);
  }
  const out = readMessages(task, opts);
  if (out.messages.length) {
    const reads = task.bus_reads || (task.bus_reads = {});
    reads[opts.reader] = Math.max(reads[opts.reader] || 0, out.cursor);
  }
  return out;
}

export function readBus(taskId, opts = {}) {
  return mutateTask(taskId, (task) => readMarked(task, opts));
}

// STORY and teamleader readers only: the person's count is derived in view-bus.mjs (U12).
export function unreadFor(task, key) {
  const mark = (task.bus_reads && task.bus_reads[key]) || 0;
  return allMessages(busPath(task)).filter((m) => m.to === key && m.ts > mark).length;
}
