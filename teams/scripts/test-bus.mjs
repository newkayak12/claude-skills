#!/usr/bin/env node
// test-bus.mjs - card 126 package P1: the engine-side message bus (teams/mcp/bus.mjs) and its two
// tools, tm_post and tm_read. Publish (six keys, body-less ledger event, strictly increasing ts),
// cursor reads and paging, one case per row of the permission table, identity and recipient
// checks, the read mark behind unreadFor, and the engine being the only writer of bus.jsonl.
//
//   env -u TEAMS_WIKI_OFF -u HARNESS_NODE node --test teams/scripts/test-bus.mjs

process.env.TEAMS_RUNS_DIR ??= 'off';
process.env.HARNESS_TEST_NO_DAEMON = '1';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, appendFileSync, rmSync, existsSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as bus from '../mcp/bus.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = mkdtempSync(join(tmpdir(), 'bus-root-'));
process.env.HARNESS_TASKS_DIR = ROOT;
// A test run by a package driver inherits this; the bus reads it as "a driver is calling".
delete process.env.TEAMS_ASK_TASK_ID;
process.on('exit', () => { try { rmSync(ROOT, { recursive: true, force: true }); } catch { /* best-effort */ } });

const graph = await import(join(HERE, '..', 'mcp', 'graph.mjs'));
const { taskPath, taskDir } = await import(join(HERE, '..', 'mcp', 'taskstate.mjs'));
const { callTool, TOOLS } = await import(join(HERE, '..', 'mcp', 'taskmanager-tools.mjs'));
const { post, postMessage, readMessages, readBus, unreadFor, topicFor, PERMISSIONS, BODY_MAX, READ_LIMIT, BUS_FILE } = bus;

const NO_DRIVER = {};
const DRIVER = { TEAMS_ASK_TASK_ID: 'x' };
let seq = 0;

// A size-L task with STORYs P1 and P2 running, P3 declared but not dispatched, P4 done, P5 failed.
function seed({ cancelled = false } = {}) {
  const run_id = `7b3c${String(++seq).padStart(4, '0')}-1111-2222-3333-444444444444`;
  const path = taskPath(run_id);
  mkdirSync(dirname(path), { recursive: true });
  const disp = (id, state) => graph.node(`dispatch:${id}:1`, 'dispatch', [], { subgoal_id: id, state });
  writeFileSync(path, JSON.stringify({
    run_id, kind: 'task', store_path: path, cwd: ROOT, request: 'r', created_at: Date.now(), size: 'L',
    spec: { acceptance: ['a'], packages: ['P1', 'P2', 'P3', 'P4', 'P5'].map((id) => ({ id, title: id, flow: 'develop', brief: 'b', acceptance: ['a'], touches: [], deps: [] })) },
    nodes: [disp('P1', 'running'), disp('P2', 'running'), disp('P4', 'done'), disp('P5', 'failed')],
    ...(cancelled ? { cancelled: true } : {}),
  }, null, 2));
  const e = `E-${run_id.slice(0, 8)}`;
  return { id: run_id, e, P1: `${e}/P1`, P2: `${e}/P2`, P3: `${e}/P3`, P4: `${e}/P4`, P5: `${e}/P5` };
}

const load = (id) => JSON.parse(readFileSync(taskPath(id), 'utf8'));
const busFile = (id) => join(taskDir(id), BUS_FILE);
const lines = (file) => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const busLines = (id) => lines(busFile(id));
const ledger = (id) => lines(join(taskDir(id), 'ledger.jsonl'));
const snapshot = (id) => ({
  bus: existsSync(busFile(id)) ? readFileSync(busFile(id), 'utf8') : '',
  ledger: existsSync(join(taskDir(id), 'ledger.jsonl')) ? readFileSync(join(taskDir(id), 'ledger.jsonl'), 'utf8') : '',
  task: readFileSync(taskPath(id), 'utf8'),
});
const say = (t, from, to, body = 'hello', extra = {}) => postMessage(t.id, { from, to, body, ...extra }, NO_DRIVER);

// A refused post: the exact message, and nothing on disk moved (bus, ledger, task.json).
function refused(t, input, reason, env = NO_DRIVER) {
  const before = snapshot(t.id);
  assert.throws(() => postMessage(t.id, input, env), (e) => {
    assert.match(e.message, /^tm_post refused: /);
    if (reason instanceof RegExp) assert.match(e.message, reason); else assert.equal(e.message, `tm_post refused: ${reason}`);
    return true;
  });
  assert.deepEqual(snapshot(t.id), before, 'a refusal leaves bus.jsonl, the ledger and task.json as they were');
}

test('exports: the contract the sibling packages build on', () => {
  for (const k of ['post', 'readMessages', 'postMessage', 'readBus', 'unreadFor', 'topicFor']) assert.equal(typeof bus[k], 'function', k);
  assert.equal(BODY_MAX, 8192);
  assert.equal(READ_LIMIT, 50);
  assert.equal(BUS_FILE, 'bus.jsonl');
  assert.ok(Array.isArray(PERMISSIONS) && PERMISSIONS.every((r) => typeof r.allow === 'boolean' && r.reason && r.from && r.to));
});

test('publish: one line of exactly six keys, a body-less bus_message ledger event', () => {
  const t = seed();
  const r = say(t, 'teamleader', t.P1, 'use cents', { reply_to: undefined });
  const [m] = busLines(t.id);
  assert.deepEqual(Object.keys(m).sort(), ['body', 'from', 'reply_to', 'to', 'topic', 'ts']);
  assert.deepEqual(m, { ts: r.ts, from: 'teamleader', to: t.P1, topic: `${t.e}/P1`, body: 'use cents', reply_to: null });
  assert.equal(r.topic, m.topic);
  const ev = ledger(t.id).filter((x) => x.event === 'bus_message');
  assert.equal(ev.length, 1);
  assert.deepEqual(ev[0], { event: 'bus_message', ts: m.ts, from: 'teamleader', to: t.P1, topic: `${t.e}/P1` });
  assert.ok(!('body' in ev[0]));
  assert.equal(load(t.id).bus_last_ts, m.ts);
});

test('ts: two posts in one millisecond get distinct, increasing ids', () => {
  const t = seed();
  const real = Date.now;
  Date.now = () => 4_000_000_000_000;
  let a; let b; let c;
  try { a = say(t, 'person', 'all'); b = say(t, 'person', 'all'); c = say(t, 'person', 'all'); } finally { Date.now = real; }
  assert.deepEqual([a.ts, b.ts, c.ts], [4_000_000_000_000, 4_000_000_000_001, 4_000_000_000_002]);
  // and a clock that runs backwards never lowers the id
  Date.now = () => 1_000;
  let d;
  try { d = say(t, 'person', 'all'); } finally { Date.now = real; }
  assert.equal(d.ts, 4_000_000_000_003);
  assert.deepEqual(busLines(t.id).map((m) => m.ts), [a.ts, b.ts, c.ts, d.ts]);
});

test('topic: the recipient STORY, the sender STORY toward the teamleader, all, and teamleader<->person', () => {
  const t = seed();
  const task = load(t.id);
  assert.equal(topicFor(task, t.P1, t.P2), `${t.e}/P2`);
  assert.equal(topicFor(task, 'teamleader', t.P2), `${t.e}/P2`);
  assert.equal(topicFor(task, t.P1, 'teamleader'), `${t.e}/P1`);
  assert.equal(topicFor(task, 'person', 'all'), `${t.e}/all`);
  assert.equal(topicFor(task, 'teamleader', 'all'), `${t.e}/all`);
  assert.equal(topicFor(task, 'teamleader', 'person'), `${t.e}/all`);
  assert.equal(topicFor(task, 'person', 'teamleader'), `${t.e}/all`);
});

test('cursor: 3 posts, read from 0 gives 3, the returned cursor gives 0, one more gives exactly that one', () => {
  const t = seed();
  for (const n of [1, 2, 3]) say(t, 'person', 'all', `m${n}`);
  const first = readMessages(load(t.id), { reader: 'teamleader', cursor: 0 });
  assert.equal(first.messages.length, 3);
  assert.equal(first.more, false);
  assert.equal(first.cursor, first.messages[2].ts);
  const none = readMessages(load(t.id), { reader: 'teamleader', cursor: first.cursor });
  assert.deepEqual(none, { messages: [], cursor: first.cursor, more: false });
  say(t, 'person', 'all', 'm4');
  const one = readMessages(load(t.id), { reader: 'teamleader', cursor: first.cursor });
  assert.deepEqual(one.messages.map((m) => m.body), ['m4']);
  assert.equal(one.cursor, one.messages[0].ts);
});

test('paging: 120 posts take three reads of 50, 50, 20 with more true, true, false and no message twice', () => {
  const t = seed();
  for (let i = 0; i < 120; i++) say(t, 'person', 'all', `n${i}`);
  const seen = [];
  const mores = [];
  const sizes = [];
  let cursor = 0;
  for (let i = 0; i < 3; i++) {
    const r = readBus(t.id, { reader: 'teamleader', cursor });
    sizes.push(r.messages.length);
    mores.push(r.more);
    seen.push(...r.messages.map((m) => m.ts));
    cursor = r.cursor;
  }
  assert.deepEqual(sizes, [50, 50, 20]);
  assert.deepEqual(mores, [true, true, false]);
  assert.equal(new Set(seen).size, 120);
  assert.deepEqual(seen, [...seen].sort((a, b) => a - b));
  assert.equal(readMessages(load(t.id), { reader: 'teamleader', cursor }).messages.length, 0);
});

test('visibility: a STORY sees to it, from it and to all (earlier all included); teamleader and person see everything', () => {
  const t = seed();
  say(t, 'person', 'all', 'before');
  say(t, 'teamleader', t.P2, 'to p2');
  say(t, t.P1, t.P2, 'p1 to p2');
  say(t, t.P2, 'teamleader', 'p2 to tl');
  say(t, 'teamleader', t.P1, 'to p1');
  say(t, 'teamleader', 'person', 'to person');
  const task = load(t.id);
  const bodies = (reader) => readMessages(task, { reader, cursor: 0 }).messages.map((m) => m.body);
  assert.deepEqual(bodies(t.P1), ['before', 'p1 to p2', 'to p1']);
  assert.deepEqual(bodies(t.P2), ['before', 'to p2', 'p1 to p2', 'p2 to tl']);
  assert.equal(bodies('teamleader').length, 6);
  assert.equal(bodies('person').length, 6);
  // P3 is not dispatched yet: it still sees the broadcast and what was stored for it
  say(t, 'teamleader', t.P3, 'for p3');
  assert.deepEqual(readMessages(load(t.id), { reader: t.P3, cursor: 0 }).messages.map((m) => m.body), ['before', 'for p3']);
});

test('partial last line: not returned, the cursor stays before it, and it is returned once complete', () => {
  const t = seed();
  const a = say(t, 'person', 'all', 'whole');
  const half = JSON.stringify({ ts: a.ts + 5, from: 'person', to: 'all', topic: `${t.e}/all`, body: 'torn', reply_to: null });
  appendFileSync(busFile(t.id), half.slice(0, 30));
  const r = readMessages(load(t.id), { reader: 'teamleader', cursor: 0 });
  assert.deepEqual(r.messages.map((m) => m.body), ['whole']);
  assert.equal(r.cursor, a.ts);
  assert.equal(unreadFor(load(t.id), 'teamleader'), 0);
  appendFileSync(busFile(t.id), `${half.slice(30)}\n`);
  assert.deepEqual(readMessages(load(t.id), { reader: 'teamleader', cursor: r.cursor }).messages.map((m) => m.body), ['torn']);
});

// ---- the permission table, one case per row ----

const ROWS = {
  'story->story': (t) => ({ from: t.P1, to: t.P2 }),
  'story->teamleader': (t) => ({ from: t.P1, to: 'teamleader' }),
  'story->person': (t) => ({ from: t.P1, to: 'person' }),
  'story->all': (t) => ({ from: t.P1, to: 'all' }),
  'story->self': (t) => ({ from: t.P1, to: t.P1 }),
  'teamleader->story': (t) => ({ from: 'teamleader', to: t.P1 }),
  'teamleader->all': () => ({ from: 'teamleader', to: 'all' }),
  'teamleader->person': () => ({ from: 'teamleader', to: 'person' }),
  'teamleader->teamleader': () => ({ from: 'teamleader', to: 'teamleader' }),
  'person->story': (t) => ({ from: 'person', to: t.P1 }),
  'person->all': () => ({ from: 'person', to: 'all' }),
  'person->teamleader': () => ({ from: 'person', to: 'teamleader' }),
  'person->person': () => ({ from: 'person', to: 'person' }),
};

test('permission table: the rows are exactly the ones this file covers', () => {
  assert.deepEqual(PERMISSIONS.map((r) => `${r.from}->${r.to}`).sort(), Object.keys(ROWS).sort());
  const allowed = PERMISSIONS.filter((r) => r.allow).map((r) => `${r.from}->${r.to}`).sort();
  assert.deepEqual(allowed, ['person->all', 'person->story', 'person->teamleader', 'story->story', 'story->teamleader', 'teamleader->all', 'teamleader->person', 'teamleader->story']);
});

for (const row of PERMISSIONS) {
  const name = `${row.from}->${row.to}`;
  test(`permission row ${name}: ${row.allow ? 'allowed' : 'refused with its reason'}`, () => {
    const t = seed();
    const input = { ...ROWS[name](t), body: 'x' };
    if (row.allow) {
      const r = postMessage(t.id, input, NO_DRIVER);
      assert.equal(busLines(t.id).length, 1);
      assert.equal(busLines(t.id)[0].ts, r.ts);
    } else {
      refused(t, input, row.reason);
    }
  });
}

test('permission: the person is told to use tm_ask; the reason names it', () => {
  assert.match(PERMISSIONS.find((r) => r.from === 'story' && r.to === 'person').reason, /tm_ask/);
});

test('identity: a sender or recipient of another EPIC, an unknown STORY or a malformed key is refused', () => {
  const t = seed();
  const other = 'E-deadbeef/P1';
  refused(t, { from: other, to: t.P2, body: 'x' }, `from ${other} is not a STORY of this task`);
  refused(t, { from: t.P1, to: other, body: 'x' }, `to ${other} is not a STORY of this task`);
  refused(t, { from: t.P1, to: `${t.e}/P9`, body: 'x' }, 'no STORY P9 in this task');
  refused(t, { from: `${t.e}/P9`, to: 'teamleader', body: 'x' }, 'no STORY P9 in this task');
  refused(t, { from: 'somebody', to: 'teamleader', body: 'x' }, /^tm_post refused: from must be/);
  refused(t, { from: 'teamleader', to: 'nobody', body: 'x' }, /^tm_post refused: to must be/);
  refused(t, { from: 'all', to: 'teamleader', body: 'x' }, /^tm_post refused: from may not be all/);
  refused(t, { to: 'all', body: 'x' }, /^tm_post refused: from must be/);
});

test('identity: a STORY that is not running cannot post (not dispatched, done, failed)', () => {
  const t = seed();
  refused(t, { from: t.P3, to: 'teamleader', body: 'x' }, 'no STORY P3 in this task');
  refused(t, { from: t.P4, to: 'teamleader', body: 'x' }, 'STORY P4 is not running (done)');
  refused(t, { from: t.P5, to: t.P1, body: 'x' }, 'STORY P5 is not running (failed)');
});

test('identity: TEAMS_ASK_TASK_ID set - posting as teamleader or person is refused, a STORY still posts as itself', () => {
  const t = seed();
  refused(t, { from: 'teamleader', to: t.P1, body: 'x' }, 'a driver may not post as teamleader', DRIVER);
  refused(t, { from: 'person', to: 'all', body: 'x' }, 'a driver may not post as person', DRIVER);
  const r = postMessage(t.id, { from: t.P1, to: 'teamleader', body: 'x' }, DRIVER);
  assert.equal(busLines(t.id).length, 1);
  assert.equal(busLines(t.id)[0].ts, r.ts);
});

test('recipient state: undispatched is stored and delivered at its first read; done and failed are refused', () => {
  const t = seed();
  say(t, 'teamleader', t.P3, 'wait for me');
  assert.equal(busLines(t.id).length, 1);
  assert.equal(busLines(t.id)[0].topic, `${t.e}/P3`);
  refused(t, { from: 'teamleader', to: t.P4, body: 'x' }, 'STORY P4 is done');
  refused(t, { from: t.P1, to: t.P5, body: 'x' }, 'STORY P5 is failed');
  // a pending dispatch node reads as undispatched too
  const task = load(t.id);
  task.nodes.push(graph.node('dispatch:P3:1', 'dispatch', [], { subgoal_id: 'P3', state: 'pending' }));
  writeFileSync(taskPath(t.id), JSON.stringify(task));
  say(t, 'person', t.P3, 'still stored');
  assert.deepEqual(readBus(t.id, { reader: t.P3 }).messages.map((m) => m.body), ['wait for me', 'still stored']);
});

test('cancelled task: refused with the cancelled wording, nothing changes', () => {
  const t = seed({ cancelled: true });
  refused(t, { from: 'person', to: 'all', body: 'x' }, 'task cancelled: tm_cancel stopped it, nothing more is posted to it');
});

test('body: empty, blank, non-string and 8193 characters are refused with the limit; 8192 is stored', () => {
  const t = seed();
  const reason = /^tm_post refused: .*8192/;
  refused(t, { from: 'person', to: 'all', body: 'x'.repeat(8193) }, reason);
  refused(t, { from: 'person', to: 'all', body: '' }, reason);
  refused(t, { from: 'person', to: 'all', body: '   ' }, reason);
  refused(t, { from: 'person', to: 'all', body: 7 }, reason);
  refused(t, { from: 'person', to: 'all' }, reason);
  // checked before identity: a STORY that is not running still hears about the limit
  refused(t, { from: t.P4, to: 'teamleader', body: '' }, reason);
  say(t, 'person', 'all', 'y'.repeat(8192));
  assert.equal(busLines(t.id)[0].body.length, 8192);
});

test('reply_to: null by default, the ts of an existing message, anything else refused', () => {
  const t = seed();
  const a = say(t, 'person', 'all', 'question');
  const b = say(t, 'teamleader', 'person', 'answer', { reply_to: a.ts });
  assert.equal(busLines(t.id)[0].reply_to, null);
  assert.equal(busLines(t.id)[1].reply_to, a.ts);
  assert.ok(b.ts > a.ts);
  refused(t, { from: 'person', to: 'all', body: 'x', reply_to: a.ts + 1000 }, 'reply_to is not the ts of a message on this bus');
  refused(t, { from: 'person', to: 'all', body: 'x', reply_to: 'abc' }, 'reply_to is not the ts of a message on this bus');
});

test('post inside a transaction that throws writes no line and does not move bus_last_ts', async () => {
  const { mutateTask } = await import(join(HERE, '..', 'mcp', 'store.mjs'));
  const t = seed();
  assert.throws(() => mutateTask(t.id, (task) => { post(task, { from: 'person', to: 'all', body: 'x' }, NO_DRIVER); throw new Error('later failure'); }), /later failure/);
  assert.equal(busLines(t.id).length, 0);
  assert.equal(load(t.id).bus_last_ts, undefined);
  assert.equal(ledger(t.id).filter((e) => e.event === 'bus_message').length, 0);
});

test('read: a bad cursor, an unknown STORY key and a non-reader are refused', () => {
  const t = seed();
  const task = load(t.id);
  assert.throws(() => readMessages(task, { reader: 'teamleader', cursor: -1 }), /^Error: tm_read refused: cursor/);
  assert.throws(() => readMessages(task, { reader: 'teamleader', cursor: 'abc' }), /^Error: tm_read refused: cursor/);
  assert.throws(() => readMessages(task, { reader: `${t.e}/P9` }), /^Error: tm_read refused: no STORY P9/);
  assert.throws(() => readMessages(task, { reader: 'E-deadbeef/P1' }), /^Error: tm_read refused: /);
  assert.throws(() => readMessages(task, { reader: 'all' }), /^Error: tm_read refused: /);
  assert.throws(() => readMessages(task, {}), /^Error: tm_read refused: /);
});

test('unreadFor: counts messages to the key past its read mark; tm_read moves it to 0; a later post raises it to 1', () => {
  const t = seed();
  say(t, 'teamleader', t.P1, 'one');
  say(t, 'teamleader', t.P1, 'two');
  say(t, 'teamleader', t.P2, 'not mine');
  say(t, 'person', 'all', 'broadcast');
  assert.equal(unreadFor(load(t.id), t.P1), 2);
  assert.equal(unreadFor(load(t.id), t.P2), 1);
  assert.equal(unreadFor(load(t.id), 'teamleader'), 0);
  // a pure read changes nothing
  readMessages(load(t.id), { reader: t.P1 });
  assert.equal(unreadFor(load(t.id), t.P1), 2);
  const r = readBus(t.id, { reader: t.P1 });
  assert.equal(r.messages.length, 3, 'one, two and the broadcast');
  assert.equal(unreadFor(load(t.id), t.P1), 0);
  assert.equal(unreadFor(load(t.id), t.P2), 1, 'P1 reading does not clear P2');
  const hw = load(t.id).bus_reads[t.P1];
  say(t, 'teamleader', t.P1, 'three');
  assert.equal(unreadFor(load(t.id), t.P1), 1);
  // the mark is never lowered, even by a read from an older cursor
  readBus(t.id, { reader: t.P1, cursor: 0 });
  assert.ok(load(t.id).bus_reads[t.P1] > hw);
  assert.equal(unreadFor(load(t.id), t.P1), 0);
  say(t, t.P1, 'teamleader', 'to tl');
  assert.equal(unreadFor(load(t.id), 'teamleader'), 1);
  readBus(t.id, { reader: 'teamleader' });
  assert.equal(unreadFor(load(t.id), 'teamleader'), 0);
  const mark = load(t.id).bus_reads.teamleader;
  readBus(t.id, { reader: 'teamleader', cursor: mark });
  assert.equal(load(t.id).bus_reads.teamleader, mark);
});

test('tools: tm_post and tm_read are declared and dispatch through callTool', async () => {
  const names = TOOLS.map((x) => x.name);
  assert.ok(names.includes('tm_post') && names.includes('tm_read'));
  const post_ = TOOLS.find((x) => x.name === 'tm_post').inputSchema;
  assert.deepEqual(post_.required, ['task_id', 'from', 'to', 'body']);
  assert.ok(post_.properties.reply_to);
  assert.deepEqual(TOOLS.find((x) => x.name === 'tm_read').inputSchema.required, ['task_id', 'key']);
  const t = seed();
  const sent = await callTool('tm_post', { task_id: t.e, from: 'person', to: t.P1, body: 'via the tool' });
  assert.equal(sent.task_id, t.id);
  assert.equal(sent.topic, `${t.e}/P1`);
  const got = await callTool('tm_read', { task_id: t.id, key: t.P1 });
  assert.equal(got.task_id, t.id);
  assert.equal(got.key, t.P1);
  assert.deepEqual(got.messages.map((m) => m.body), ['via the tool']);
  assert.equal(got.more, false);
  assert.equal(unreadFor(load(t.id), t.P1), 0);
  const again = await callTool('tm_read', { task_id: t.id, key: t.P1, cursor: got.cursor });
  assert.deepEqual(again.messages, []);
  await assert.rejects(() => callTool('tm_post', { task_id: t.id, from: t.P1, to: 'person', body: 'x' }), /^Error: tm_post refused: .*tm_ask/);
  await assert.rejects(() => callTool('tm_read', { task_id: t.id, key: 'nobody' }), /^Error: tm_read refused: /);
  process.env.TEAMS_ASK_TASK_ID = t.id;
  try {
    await assert.rejects(() => callTool('tm_post', { task_id: t.id, from: 'teamleader', to: 'all', body: 'x' }), /a driver may not post as teamleader/);
    await assert.rejects(() => callTool('tm_read', { task_id: t.id, key: 'teamleader' }), /a driver may not read as teamleader/);
    const own = await callTool('tm_post', { task_id: t.id, from: t.P1, to: 'teamleader', body: 'from a driver' });
    assert.equal(own.topic, `${t.e}/P1`);
  } finally { delete process.env.TEAMS_ASK_TASK_ID; }
});

test('the engine is the only writer: nothing under teams/hooks or view.mjs touches bus.jsonl', () => {
  const root = join(HERE, '..');
  const files = [join(root, 'scripts', 'view.mjs')];
  const walk = (dir) => { for (const n of readdirSync(dir)) { const p = join(dir, n); if (statSync(p).isDirectory()) walk(p); else files.push(p); } };
  walk(join(root, 'hooks'));
  const WRITE = /(appendFileSync|writeFileSync|createWriteStream|appendFile|writeFile)[^\n]*bus\.jsonl/;
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    assert.doesNotMatch(text, WRITE, f);
    if (f.includes(`${join(root, 'hooks')}`)) assert.ok(!text.includes('bus.jsonl'), f);
  }
});
