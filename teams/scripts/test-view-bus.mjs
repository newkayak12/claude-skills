// `view.mjs --once` and the bus (card 126, package P3): a task's bus.jsonl as `threads` per sub-topic, the
// person's derived unread count and its band row. The contract is the block comment of lib/view-bus.mjs.
//
//   node --test teams/scripts/test-view-bus.mjs
process.env.TEAMS_RUNS_DIR ??= 'off';
process.env.TZ = 'UTC';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, readFileSync, readdirSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { node } from '../mcp/graph.mjs';
import { BUS_FILE } from '../mcp/bus.mjs';
import { busMessages, busView, threadsOf, unreadOf } from './lib/view-bus.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const VIEW = join(HERE, 'view.mjs');
const write = (p, s) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, s); };
const E = 'E-aaaaaaaa';
const P1 = `${E}/P1`;
const P2 = `${E}/P2`;
// 2026-11-20 09:05:00, 09:06:30, 09:07:45, 09:08:10 UTC
const T = [Date.UTC(2026, 10, 20, 9, 5, 0), Date.UTC(2026, 10, 20, 9, 6, 30), Date.UTC(2026, 10, 20, 9, 7, 45), Date.UTC(2026, 10, 20, 9, 8, 10)];
const msg = (ts, from, to, topic, body, reply_to = null) => JSON.stringify({ ts, from, to, topic, body, reply_to }) + '\n';

const MESSAGES = {
  pkgToPkg: msg(T[0], P1, P2, P2, 'P2: the parser exports parseLine, use it'),
  pkgToLeader: msg(T[1], P1, 'teamleader', P1, 'P1: blocked on the schema, which file owns it?'),
  leaderToPerson: msg(T[2], 'teamleader', 'person', `${E}/all`, 'The schema owner is P2; I told P1. Anything you want changed?'),
  broadcast: msg(T[3], 'teamleader', 'all', `${E}/all`, 'Freeze the public API until the gate'),
};

// A live task (one running STORY P1, a pending P2) opened by session s-1, with the given bus lines and ledger lines.
function fixture({ bus = [], ledger = [] } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'view-bus-'));
  const tasks = join(root, 'tasks');
  const id = 'aaaaaaaa-0001';
  const dir = join(tasks, id);
  const cwd = join(root, 'proj');
  const cdir = join(root, 'wt');
  mkdirSync(cwd, { recursive: true });
  write(join(cdir, '.teams_output', 'broker', 'runs', 'c-P1.json'), JSON.stringify({
    run_id: 'c-P1', flow: 'develop', max_retries: 2, spec: { subgoals: [{ id: 'U1', title: 'unit' }] },
    nodes: [node('plan', 'plan', [], { state: 'done' }), node('implement:U1:1', 'implement', ['plan'], { state: 'running', subgoal_id: 'U1', executor: 'claude', model: 'opus' })],
  }));
  const log = join(dir, 'drivers', 'dispatch_P1_1.stream.jsonl');
  write(log, '');
  const child = { run_id: 'c-P1', cwd: cdir, driver: { pid: process.pid, log, restarts: [] } };
  write(join(dir, 'task.json'), JSON.stringify({
    run_id: id, kind: 'task', cwd, request: 'r', created_at: Date.now(), store_path: join(dir, 'task.json'),
    opener: { session_id: 's-1', entrypoint: 'cli' },
    spec: { packages: [{ id: 'P1', title: 'story P1', deps: [] }, { id: 'P2', title: 'story P2', deps: [] }] },
    nodes: [node('size', 'size', [], { state: 'done' }), node('shape', 'shape', ['size'], { state: 'done' }), node('critique', 'critique', ['shape'], { state: 'done' }),
      node('dispatch:P1:1', 'dispatch', ['critique'], { subgoal_id: 'P1', state: 'running', child }),
      node('accept:P1:1', 'accept', ['dispatch:P1:1'], { subgoal_id: 'P1', state: 'pending' }),
      node('dispatch:P2:1', 'dispatch', ['critique'], { subgoal_id: 'P2', state: 'pending' }),
      node('accept:P2:1', 'accept', ['dispatch:P2:1'], { subgoal_id: 'P2', state: 'pending' })],
  }));
  write(join(dir, 'ledger.jsonl'), [{ ts: Date.now(), event: 'task_open' }, ...ledger].map((e) => JSON.stringify(e)).join('\n') + '\n');
  if (bus.length) write(join(dir, BUS_FILE), bus.join(''));
  return { root, tasks, id, dir, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

const run = (f, ...args) => {
  const r = spawnSync(process.execPath, [VIEW, '--once', '--tasks-dir', f.tasks, ...args], { encoding: 'utf8', env: { ...process.env, TZ: 'UTC' } });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr, '');
  return r.stdout;
};
const summary = (f, ...more) => JSON.parse(run(f, '--format', 'summary', '--task', f.id, ...more));
const story = (f, pkg, ...more) => run(f, '--format', 'story', '--task', f.id, '--story', pkg, ...more);

// every file under a dir with its size, mtime and bytes: what a read must leave as it was
function snapshot(dir) {
  const out = {};
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      const st = statSync(p);
      if (st.isDirectory()) walk(p); else out[p] = `${st.size}:${st.mtimeMs}:${readFileSync(p, 'utf8')}`;
    }
  };
  walk(dir);
  return out;
}

const THREE = [MESSAGES.pkgToPkg, MESSAGES.pkgToLeader, MESSAGES.leaderToPerson];
const EXPECT_THREADS = [
  { topic: P2, story: 'P2', messages: [{ from: P1, to: P2, body: 'P2: the parser exports parseLine, use it', ts: T[0], time: '2026-11-20 09:05' }] },
  { topic: P1, story: 'P1', messages: [{ from: P1, to: 'teamleader', body: 'P1: blocked on the schema, which file owns it?', ts: T[1], time: '2026-11-20 09:06' }] },
  { topic: `${E}/all`, story: 'all', messages: [{ from: 'teamleader', to: 'person', body: 'The schema owner is P2; I told P1. Anything you want changed?', ts: T[2], time: '2026-11-20 09:07' }] },
];

test('--once text: three threads, one message per line as from -> to, body, time; JSON carries the same three', () => {
  const f = fixture({ bus: THREE });
  try {
    const out = run(f, '--task', f.id);
    const lines = out.split('\n');
    const at = lines.indexOf('threads:');
    assert.ok(at > 0, out);
    assert.deepEqual(lines.slice(at, at + 7), [
      'threads:',
      `  ${P2}`,
      `    ${P1} -> ${P2}  P2: the parser exports parseLine, use it  2026-11-20 09:05`,
      `  ${P1}`,
      `    ${P1} -> teamleader  P1: blocked on the schema, which file owns it?  2026-11-20 09:06`,
      `  ${E}/all`,
      '    teamleader -> person  The schema owner is P2; I told P1. Anything you want changed?  2026-11-20 09:07',
    ]);
    assert.equal(summary(f).task.threads.length, 3);
    assert.deepEqual(summary(f).task.threads, EXPECT_THREADS);
    // with no --task, a tasks dir of one task prints the same tree
    assert.ok(run(f).includes(lines.slice(at, at + 7).join('\n')));
  } finally { f.cleanup(); }
});

test('the teams format carries threads and unread on its task too', () => {
  const f = fixture({ bus: THREE });
  try {
    const t = JSON.parse(run(f, '--format', 'teams', '--task', f.id)).task;
    assert.deepEqual(t.threads, EXPECT_THREADS);
    assert.equal(t.unread.count, 1);
  } finally { f.cleanup(); }
});

test('the person has 1 unread with the band row; a later tm_submit, tm_submit_human or person post clears it; nothing is written', () => {
  const f = fixture({ bus: THREE });
  try {
    const before = snapshot(f.root);
    const s = summary(f, '--session', 's-1');
    assert.equal(s.task.unread.count, 1);
    const notice = { task_id: f.id, kind: 'message', from: 'teamleader', who: 'teamleader', body: 'The schema owner is P2; I told P1. Anything you want changed?', ts: T[2], text: '✉ teamleader -> you: The schema owner is P2; I told P1. Anything you want changed?' };
    assert.deepEqual(s.task.unread.notice, notice);
    assert.deepEqual(s.status.notices, [notice]);
    assert.deepEqual(s.status.asks, []);
    // another session has no band row, the task's own count does not depend on a session
    const other = summary(f, '--session', 's-2');
    assert.equal(other.status.notices, undefined);
    assert.equal(other.task.unread.count, 1);
    // the status format carries the same row
    assert.deepEqual(JSON.parse(run(f, '--format', 'status', '--session', 's-1')).notices, [notice]);
    // opening the pane (every read above) clears nothing, and wrote nothing
    assert.equal(summary(f, '--session', 's-1').task.unread.count, 1);
    assert.deepEqual(snapshot(f.root), before);

    // a submission earlier than the message does not clear it; a later one does
    appendFileSync(join(f.dir, 'ledger.jsonl'), JSON.stringify({ ts: T[2] - 1, event: 'tm_submit', node_id: 'x' }) + '\n');
    assert.equal(summary(f, '--session', 's-1').task.unread.count, 1);
    appendFileSync(join(f.dir, 'ledger.jsonl'), JSON.stringify({ ts: T[2] + 1, event: 'tm_submit', node_id: 'x' }) + '\n');
    const cleared = summary(f, '--session', 's-1');
    assert.equal(cleared.task.unread.count, 0);
    assert.equal(cleared.task.unread.notice, null);
    assert.equal(cleared.status.notices, undefined);
  } finally { f.cleanup(); }

  const h = fixture({ bus: THREE, ledger: [{ ts: T[2] + 5, event: 'tm_submit_human', key: 'E-aaaaaaaa/P1', node_id: 'ask:P1:1' }] });
  try { assert.equal(summary(h, '--session', 's-1').task.unread.count, 0); } finally { h.cleanup(); }

  const p = fixture({ bus: [...THREE, msg(T[3], 'person', 'teamleader', `${E}/all`, 'keep going')] });
  try { assert.equal(summary(p, '--session', 's-1').task.unread.count, 0); } finally { p.cleanup(); }

  // a message newer than the person's post is unread again; the count is derived, not stored
  const q = fixture({ bus: [msg(T[0], 'person', 'teamleader', `${E}/all`, 'hi'), MESSAGES.leaderToPerson, msg(T[3], 'teamleader', 'person', `${E}/all`, 'one more')] });
  try {
    const s = summary(q, '--session', 's-1');
    assert.equal(s.task.unread.count, 2);
    assert.equal(s.task.unread.notice.ts, T[3]);
    assert.equal(s.task.unread.notice.text, '✉ teamleader -> you: one more');
  } finally { q.cleanup(); }
});

test('a package-sent message to the person-side is named by its package in the band row', () => {
  // bus.mjs refuses story -> person today; the view still names a STORY sender by its package id if one is on the file
  const u = unreadOf('/nonexistent', 'aaaaaaaa-0001', [{ ts: T[1], from: P2, to: 'person', topic: P2, body: 'P2 asks: ship it?', reply_to: null }]);
  assert.equal(u.notice.text, '✉ P2 -> you: P2 asks: ship it?');
});

test('a body longer than the band is clipped with … in the band row and kept whole in threads', () => {
  const body = `start ${'x'.repeat(300)} end`;
  const f = fixture({ bus: [msg(T[0], 'teamleader', 'person', `${E}/all`, body)] });
  try {
    const s = summary(f, '--session', 's-1');
    const row = s.status.notices[0];
    assert.equal(row.body.length, 120);
    assert.ok(row.body.endsWith('…'));
    assert.equal(row.text, `✉ teamleader -> you: ${row.body}`);
    assert.equal(s.task.unread.notice.text, row.text);
    assert.equal(s.task.threads[0].messages[0].body, body);
    // a body of exactly 120 characters is not clipped
    assert.equal(unreadOf('/x', 'aaaaaaaa-0001', [{ ts: 1, from: 'teamleader', to: 'person', topic: `${E}/all`, body: 'y'.repeat(120) }]).notice.body, 'y'.repeat(120));
  } finally { f.cleanup(); }
});

test('no bus.jsonl: text, summary, teams and story formats exit 0 with no error; story carries threads [] and unread 0, the others omit the keys', () => {
  const f = fixture();
  try {
    assert.ok(!run(f, '--task', f.id).includes('threads:'));
    // absent keys mean [] / { count: 0, notice: null } (the contract in lib/view-bus.mjs); the goldens stay byte-equal
    const s = summary(f, '--session', 's-1');
    assert.deepEqual([s.task.threads, s.task.unread, s.status.notices], [undefined, undefined, undefined]);
    const t = JSON.parse(run(f, '--format', 'teams', '--task', f.id)).task;
    assert.deepEqual([t.threads, t.unread], [undefined, undefined]);
    const p = JSON.parse(story(f, 'P1'));
    assert.deepEqual([p.threads, p.unread], [[], { count: 0, notice: null }]);
    assert.ok(!story(f, 'P1', '--text').includes('threads:'));
  } finally { f.cleanup(); }
});

test('a trailing line with no newline is skipped, a complete line that does not parse is skipped, nothing throws', () => {
  const full = JSON.stringify(JSON.parse(MESSAGES.leaderToPerson));
  const f = fixture({ bus: [MESSAGES.pkgToLeader, 'not json\n', '{"ts":5}\n', full] });
  try {
    assert.deepEqual(busMessages(f.tasks, f.id).map((m) => m.ts), [T[1]]);
    const s = summary(f, '--session', 's-1');
    assert.deepEqual(s.task.threads.map((t) => t.topic), [P1]);
    assert.equal(s.task.unread.count, 0);
    // once the line is complete it counts
    appendFileSync(join(f.dir, BUS_FILE), '\n');
    assert.equal(summary(f, '--session', 's-1').task.unread.count, 1);
  } finally { f.cleanup(); }
  const g = fixture({ bus: ['{"ts":1,"from":"x"'] });
  try { assert.deepEqual(busMessages(g.tasks, g.id), []); } finally { g.cleanup(); }
});

test('--format story: a STORY sees its own sub-topic, the broadcast sub-topic and what it sent, newest last', () => {
  const f = fixture({ bus: [...THREE, MESSAGES.broadcast, msg(T[3] + 1000, 'teamleader', P2, P2, 'P2: go')] });
  try {
    const p2 = JSON.parse(story(f, 'P2'));
    assert.deepEqual(p2.threads.map((t) => t.topic), [`${E}/all`, P2]);
    assert.deepEqual(p2.threads[1].messages.map((m) => m.ts), [T[0], T[3] + 1000]);
    assert.deepEqual(p2.threads[0].messages.map((m) => m.body), ['Freeze the public API until the gate']);
    // never the teamleader <-> person message
    assert.ok(!JSON.stringify(p2.threads).includes('Anything you want changed'));
    // P1 sent one to P2 and one to the teamleader: those sub-topics, plus the broadcast
    const p1 = JSON.parse(story(f, 'P1'));
    assert.deepEqual(p1.threads.map((t) => t.topic), [P2, P1, `${E}/all`]);
    const text = story(f, 'P2', '--text');
    assert.ok(text.includes(`threads:\n  ${E}/all\n    teamleader -> all  Freeze the public API until the gate  2026-11-20 09:08\n  ${P2}\n    ${P1} -> ${P2}  P2: the parser exports parseLine, use it  2026-11-20 09:05\n`), text);
    assert.ok(!text.includes('Anything you want changed'));
  } finally { f.cleanup(); }
});

test('view.mjs writes nothing under the tasks root, whatever the format', () => {
  const f = fixture({ bus: [...THREE, MESSAGES.broadcast] });
  try {
    const before = snapshot(f.root);
    run(f, '--task', f.id);
    run(f);
    for (const fmt of ['summary', 'teams', 'status', 'board', 'report']) run(f, '--format', fmt, '--task', f.id, '--session', 's-1');
    story(f, 'P1');
    story(f, 'P2', '--text');
    assert.deepEqual(snapshot(f.root), before);
  } finally { f.cleanup(); }
});

test('view-bus.mjs reads BUS_FILE from the given tasks dir and never writes', () => {
  const src = readFileSync(join(HERE, 'lib', 'view-bus.mjs'), 'utf8');
  assert.ok(!/writeFileSync|appendFileSync|createWriteStream|renameSync|mkdirSync/.test(src));
  assert.match(src, /import \{ BUS_FILE \} from '\.\.\/\.\.\/mcp\/bus\.mjs'/);
  assert.ok(!/process\.env/.test(src), 'the path comes from the --tasks-dir, never from HARNESS_TASKS_DIR');
});

test('threadsOf and busView: grouping, order and the story scope over plain records', () => {
  const recs = [
    { ts: 3, from: 'teamleader', to: 'all', topic: `${E}/all`, body: 'c', reply_to: null },
    { ts: 1, from: P1, to: P2, topic: P2, body: 'a', reply_to: null },
    { ts: 2, from: P2, to: 'teamleader', topic: P2, body: 'b', reply_to: null },
  ];
  const all = threadsOf(recs.slice().sort((a, b) => a.ts - b.ts), 'aaaaaaaa-0001');
  assert.deepEqual(all.map((t) => [t.topic, t.story, t.messages.map((m) => m.body)]), [[P2, 'P2', ['a', 'b']], [`${E}/all`, 'all', ['c']]]);
  assert.deepEqual(threadsOf(recs.slice().sort((a, b) => a.ts - b.ts), 'aaaaaaaa-0001', { story: 'P1' }).map((t) => t.topic), [P2, `${E}/all`]);
  assert.deepEqual(busView('/nonexistent-tasks-dir', 'aaaaaaaa-0001'), { threads: [], unread: { count: 0, notice: null } });
});
