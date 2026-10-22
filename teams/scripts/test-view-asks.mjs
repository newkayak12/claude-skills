// asksFor(): the questions waiting on one session, from floorTasks-style rows. Pure, no fs: the
// rows are hand-built models with one card parked on a person.
//
//   node --test teams/scripts/test-view-asks.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { asksFor } from './lib/view-asks.mjs';

const card = (id, question, since, title = `story ${id}`) => ({
  id, title, ticket_key: `E-aaaaaaaa/${id}`,
  dispatch: { state: 'waiting_human', waiting_since: since, questions: question == null ? [] : [question] },
});
const row = (cards, { opener = { session_id: 's-1', entrypoint: 'cli' }, live = true, task_id = 'aaaaaaaa-0001', ...extra } = {}) =>
  ({ live, m: { task_id, opener, ticket: { key: 'E-aaaaaaaa' }, packages: cards, ...extra } });

test('addressed: one notice with who, question, since', () => {
  const out = asksFor([row([card('P2', 'Keep the legacy PDF route?', 1000)])], 's-1');
  assert.deepEqual(out, [{ task_id: 'aaaaaaaa-0001', key: 'E-aaaaaaaa/P2', who: 'P2', question: 'Keep the legacy PDF route?', since: 1000, via: 'poll' }]);
});

test('other session id -> []', () => {
  assert.deepEqual(asksFor([row([card('P2', 'q', 1)])], 's-2'), []);
});

test('opener null or absent -> [] and nothing throws', () => {
  assert.deepEqual(asksFor([row([card('P2', 'q', 1)], { opener: null })], 's-1'), []);
  const r = row([card('P2', 'q', 1)]);
  delete r.m.opener;
  assert.deepEqual(asksFor([r], 's-1'), []);
});

test('opener entrypoint sdk-cli is still matched by id (no entrypoint filter)', () => {
  const out = asksFor([row([card('P2', 'q', 1)], { opener: { session_id: 's-1', entrypoint: 'sdk-cli' } })], 's-1');
  assert.equal(out.length, 1);
});

test('empty sessionId -> []', () => {
  assert.deepEqual(asksFor([row([card('P2', 'q', 1)], { opener: { session_id: '', entrypoint: 'cli' } })], ''), []);
  assert.deepEqual(asksFor([row([card('P2', 'q', 1)])], undefined), []);
});

test('a task that is not live is skipped', () => {
  assert.deepEqual(asksFor([row([card('P2', 'q', 1)], { live: false })], 's-1'), []);
});

test('no question -> the card title', () => {
  assert.equal(asksFor([row([card('P2', null, 1, 'Pick a route')])], 's-1')[0].question, 'Pick a route');
});

test('question over 120 chars is clipped to 120 ending in an ellipsis', () => {
  const q = asksFor([row([card('P2', 'x'.repeat(200), 1)])], 's-1')[0].question;
  assert.equal(q.length, 120);
  assert.ok(q.endsWith('…'));
  assert.equal(asksFor([row([card('P2', 'y'.repeat(120), 1)])], 's-1')[0].question, 'y'.repeat(120));
});

test('two asks come newest first, across tasks', () => {
  const out = asksFor([row([card('P1', 'old', 1000)]), row([card('P2', 'new', 5000)], { task_id: 'bbbbbbbb-0002' })], 's-1');
  assert.deepEqual(out.map((a) => a.question), ['new', 'old']);
});

test('EPIC-level ask: who is the EPIC key', () => {
  const r = row([], { manager_stages: [{ node_id: 'shape', state: 'waiting_human', waiting_since: 7, questions: ['Which flow?'] }] });
  const out = asksFor([r], 's-1');
  assert.equal(out.length, 1);
  assert.equal(out[0].who, 'E-aaaaaaaa');
  assert.equal(out[0].key, 'E-aaaaaaaa');
  assert.equal(out[0].since, 7);
});

test('via is send when received holds {key, session}, else poll', () => {
  const rows = [row([card('P2', 'q', 1)])];
  assert.equal(asksFor(rows, 's-1', [{ key: 'E-aaaaaaaa/P2', session: 's-1' }])[0].via, 'send');
  assert.equal(asksFor(rows, 's-1', [{ key: 'E-aaaaaaaa/P2', session: 's-9' }])[0].via, 'poll');
  assert.equal(asksFor(rows, 's-1', [{ key: 'E-aaaaaaaa/P3', session: 's-1' }])[0].via, 'poll');
});

// ---------- CLI cases: view.mjs --session and ask-message.mjs over a tmp tasks dir ----------
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { node } from '../mcp/graph.mjs';
import { floorTasks } from './lib/view-floor-fs.mjs';
import { collectTask } from './lib/view-collect.mjs';
import { askMessage, parseAskMessage } from './lib/ask-message.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const VIEW = join(HERE, 'view.mjs');
const ASKMSG = join(HERE, 'ask-message.mjs');
const Q = 'Keep the legacy PDF route?';

function world() {
  const root = mkdtempSync(join(tmpdir(), 'view-asks-'));
  const w = { root, tasks: join(root, 'tasks'), sessions: join(root, 'sessions'), cleanup: () => rmSync(root, { recursive: true, force: true }) };
  mkdirSync(w.tasks, { recursive: true });
  mkdirSync(w.sessions, { recursive: true });
  return w;
}

// a task of cwd `cwd` with one STORY P2 parked on a person, opener as given (undefined = field absent)
function task(w, { id = 'aaaaaaaa-0001', cwd = '/a', opener = { session_id: 's-1', entrypoint: 'cli' } } = {}) {
  if (opener === 'none') opener = undefined;
  const dir = join(w.tasks, id);
  const cdir = join(w.root, `wt-${id}`);
  mkdirSync(join(dir, 'drivers'), { recursive: true });
  mkdirSync(join(cdir, '.teams_output', 'broker', 'runs'), { recursive: true });
  writeFileSync(join(cdir, '.teams_output', 'broker', 'runs', 'c-P2.json'), JSON.stringify({
    run_id: 'c-P2', flow: 'develop', max_retries: 2, spec: { subgoals: [{ id: 'U1', title: 'unit' }] },
    nodes: [node('ask:U1:1', 'ask', [], { state: 'waiting_human', subgoal_id: 'U1', waiting_since: 4242, questions: [{ question: Q }] })],
  }));
  const nodes = [node('size', 'size', [], { state: 'done' }), node('shape', 'shape', ['size'], { state: 'done' }), node('critique', 'critique', ['shape'], { state: 'done' }),
    node('dispatch:P2:1', 'dispatch', ['critique'], { state: 'running', subgoal_id: 'P2', child: { run_id: 'c-P2', cwd: cdir, driver: { pid: process.pid, log: join(dir, 'drivers', 'd.stream.jsonl'), restarts: [] } } }),
    node('accept:P2:1', 'accept', ['dispatch:P2:1'], { subgoal_id: 'P2', state: 'pending' })];
  writeFileSync(join(dir, 'task.json'), JSON.stringify({
    run_id: id, kind: 'task', cwd, request: 'r', created_at: Date.now(), store_path: join(dir, 'task.json'),
    ...(opener === undefined ? {} : { opener }), spec: { packages: [{ id: 'P2', title: 'story P2', deps: [] }] }, nodes,
  }));
  return { id, dir };
}

const env = (w, extra = {}) => ({ ...process.env, TEAMS_RUNS_DIR: 'off', HARNESS_TASKS_DIR: w.tasks, TEAMS_SESSIONS_DIR: w.sessions, ...extra });
const view = (w, fmt, ...rest) => {
  const r = spawnSync(process.execPath, [VIEW, '--once', '--format', fmt, '--tasks-dir', w.tasks, ...rest], { encoding: 'utf8', env: env(w) });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
};
const askmsg = (w, args, { input = '', extra = {} } = {}) => {
  const r = spawnSync(process.execPath, [ASKMSG, ...args], { encoding: 'utf8', input, env: env(w, { TEAMS_OPENER_SESSION_ID: '', TEAMS_TASK_ID: '', ...extra }) });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
};
const session = (w, over = {}) => writeFileSync(join(w.sessions, `${over.pid || process.pid}.json`), JSON.stringify({ pid: process.pid, sessionId: 's-1', kind: 'interactive', ...over }));

test('view --session: poll ask, task cwd differs from session cwd', () => {
  const w = world();
  try {
    task(w, { cwd: '/a' });
    const st = view(w, 'status', '--cwd', '/b', '--session', 's-1');
    assert.equal(st.asks.length, 1);
    assert.deepEqual({ ...st.asks[0], since: null }, { task_id: 'aaaaaaaa-0001', key: 'E-aaaaaaaa/P2', who: 'P2', question: Q, since: null, via: 'poll' });
    assert.deepEqual(view(w, 'status', '--session', 's-1').asks.map((a) => a.who), ['P2']);
  } finally { w.cleanup(); }
});

test('view --session other -> []; no --session -> [] with waiting unchanged', () => {
  const w = world();
  try {
    task(w);
    assert.deepEqual(view(w, 'status', '--session', 'other').asks, []);
    const none = view(w, 'status', '--cwd', '/a');
    assert.deepEqual(none.asks, []);
    assert.equal(none.waiting, 1);
  } finally { w.cleanup(); }
});

test('task.json without opener -> [] and exit 0', () => {
  const w = world();
  try {
    task(w, { opener: 'none' });
    const st = view(w, 'status', '--session', 's-1');
    assert.deepEqual(st.asks, []);
    assert.equal(st.waiting, 1);
  } finally { w.cleanup(); }
});

test('status, summary.status and teams.status carry identical asks', () => {
  const w = world();
  try {
    task(w);
    const a = view(w, 'status', '--session', 's-1').asks;
    assert.equal(a.length, 1);
    assert.deepEqual(view(w, 'summary', '--session', 's-1').status.asks, a);
    assert.deepEqual(view(w, 'teams', '--session', 's-1').status.asks, a);
  } finally { w.cleanup(); }
});

test('ask-message --received turns via poll into via send', () => {
  const w = world();
  try {
    task(w);
    const ask = view(w, 'status', '--session', 's-1').asks[0];
    assert.equal(askmsg(w, ['--received', '--session', 's-1'], { input: 'hello there' }), '');
    assert.equal(view(w, 'status', '--session', 's-1').asks[0].via, 'poll');
    const text = askMessage({ ...ask, via: 'send' });
    assert.equal(askmsg(w, ['--received', '--session', 's-1'], { input: text }), 'E-aaaaaaaa/P2\n');
    const rows = readFileSync(join(w.tasks, 'aaaaaaaa-0001', 'asks.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(rows.length, 1);
    assert.deepEqual({ ...rows[0], at: 0 }, { event: 'received', key: 'E-aaaaaaaa/P2', session: 's-1', at: 0 });
    assert.equal(view(w, 'status', '--session', 's-1').asks[0].via, 'send');
  } finally { w.cleanup(); }
});

test('--send-plan: interactive live opener -> one entry; --sent --ok -> []', () => {
  const w = world();
  try {
    task(w);
    session(w);
    const e = { TEAMS_OPENER_SESSION_ID: 's-1', TEAMS_TASK_ID: 'aaaaaaaa-0001' };
    const plan = JSON.parse(askmsg(w, ['--send-plan', '--self', 'drv-9'], { extra: e }));
    assert.equal(plan.length, 1);
    assert.equal(plan[0].to, 's-1');
    assert.equal(plan[0].key, 'E-aaaaaaaa/P2');
    assert.equal(parseAskMessage(plan[0].text).question, Q);
    assert.equal(askmsg(w, ['--sent', plan[0].key, '--ok'], { extra: e }), '');
    const rows = readFileSync(join(w.tasks, 'aaaaaaaa-0001', 'asks.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(rows[0].event, 'sent');
    assert.equal(rows[0].to, 's-1');
    assert.equal(rows[0].since, 4242);
    assert.deepEqual(JSON.parse(askmsg(w, ['--send-plan', '--self', 'drv-9'], { extra: e })), []);
  } finally { w.cleanup(); }
});

test('--send-plan: failed send is retried; sdk kind, dead pid, missing env -> []', () => {
  const w = world();
  try {
    task(w);
    const e = { TEAMS_OPENER_SESSION_ID: 's-1', TEAMS_TASK_ID: 'aaaaaaaa-0001' };
    const plan = (x = e) => JSON.parse(askmsg(w, ['--send-plan', '--self', 'drv-9'], { extra: x }));
    session(w, { kind: 'sdk' });
    assert.deepEqual(plan(), []);
    session(w, { kind: 'interactive', pid: 2 ** 22 + 12345 });
    rmSync(join(w.sessions, `${process.pid}.json`));
    assert.deepEqual(plan(), []);
    session(w);
    rmSync(join(w.sessions, `${2 ** 22 + 12345}.json`));
    assert.equal(plan().length, 1);
    assert.deepEqual(plan({}), []);
    askmsg(w, ['--sent', 'E-aaaaaaaa/P2', '--error', 'boom'], { extra: e });
    const row = JSON.parse(readFileSync(join(w.tasks, 'aaaaaaaa-0001', 'asks.jsonl'), 'utf8').trim());
    assert.equal(row.event, 'send_failed');
    assert.equal(row.error, 'boom');
    assert.equal(plan().length, 1, 'send_failed does not dedupe');
  } finally { w.cleanup(); }
});

test('asks over all tasks: a task with another opener is not collected', () => {
  const w = world();
  try {
    task(w, { id: 'aaaaaaaa-0001', opener: { session_id: 's-1', entrypoint: 'cli' } });
    task(w, { id: 'bbbbbbbb-0002', opener: { session_id: 's-2', entrypoint: 'cli' } });
    task(w, { id: 'cccccccc-0003', opener: 'none' });
    const seen = [];
    const rows = floorTasks({ tasksDir: w.tasks, opener: 's-1', collect: (d, id) => { seen.push(id); return collectTask(d, id); } });
    assert.deepEqual(seen, ['aaaaaaaa-0001']);
    assert.equal(rows.length, 1);
  } finally { w.cleanup(); }
});
