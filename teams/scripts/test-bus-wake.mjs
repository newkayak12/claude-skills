#!/usr/bin/env node
// test-bus-wake.mjs - card 126, package P2: tm_ask is one kind of message on the EPIC bus (bus.mjs),
// and a parked STORY with unread bus messages is woken the way an answer wakes it. Modelled on
// test-story-ask-engine.mjs: a temp tasks dir, a stub command standing in for `claude -p`.
//
//   node --test teams/scripts/test-bus-wake.mjs

process.env.TEAMS_RUNS_DIR ??= 'off';
process.env.HARNESS_TEST_NO_DAEMON = '1';
process.env.HARNESS_JUDGE_TIMEOUT_MS = '1500';
delete process.env.HARNESS_TEST_NO_DRIVER;
delete process.env.HARNESS_ANSWER_DRIVER;
delete process.env.TEAMS_ASK_TASK_ID;
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = mkdtempSync(join(tmpdir(), 'bus-wake-root-'));
const SCRATCH = mkdtempSync(join(tmpdir(), 'bus-wake-scratch-'));
const STUB_LOG = join(SCRATCH, 'driver-calls.jsonl');
process.env.HARNESS_TASKS_DIR = ROOT;
process.env.STUB_LOG = STUB_LOG;
writeFileSync(join(SCRATCH, 'driver.mjs'), "import { appendFileSync } from 'node:fs';\nappendFileSync(process.env.STUB_LOG, JSON.stringify({ argv: process.argv.slice(2) }) + '\\n');\nsetTimeout(() => {}, 3000);\n");
process.env.HARNESS_CHILD_DRIVER = `node ${join(SCRATCH, 'driver.mjs')}`;

const tm = await import(join(HERE, '..', 'mcp', 'taskmanager.mjs'));
const graph = await import(join(HERE, '..', 'mcp', 'graph.mjs'));
const daemon = await import(join(HERE, '..', 'mcp', 'daemon.mjs'));
const bus = await import(join(HERE, '..', 'mcp', 'bus.mjs'));
const { mutateTask } = await import(join(HERE, '..', 'mcp', 'store.mjs'));
const { callTool } = tm;

process.on('exit', () => { for (const d of [ROOT, SCRATCH]) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best-effort */ } } });

const DEAD = 2 ** 22 + 12345;
const Q = 'Are amounts stored in cents or in dollars?';
let seq = 0;

// A size-L task with STORY P1 running: a dead driver pid (the driver exited) and a child run still running.
function seedTask({ dispatchState = 'running' } = {}) {
  const run_id = `1b2c${String(++seq).padStart(4, '0')}-1111-2222-3333-444444444444`;
  const cwd = mkdtempSync(join(SCRATCH, 'proj-'));
  const childCwd = mkdtempSync(join(SCRATCH, 'wt-'));
  const childId = `c-${run_id.slice(0, 8)}-P1`;
  const runs = join(childCwd, '.teams_output', 'broker', 'runs');
  mkdirSync(runs, { recursive: true });
  const runFile = join(runs, `${childId}.json`);
  writeFileSync(runFile, JSON.stringify({
    run_id: childId, flow: 'develop', max_retries: 2, cwd: childCwd, spec: { subgoals: [{ id: 'U1', title: 'unit' }] },
    nodes: [graph.node('implement:U1:1', 'implement', [], { state: 'pending', subgoal_id: 'U1' })],
  }));
  const path = tm.taskPath(run_id);
  mkdirSync(dirname(path), { recursive: true });
  const done = (id, stage, deps) => graph.node(id, stage, deps, { state: 'done', result: { stage_ok: true } });
  writeFileSync(path, JSON.stringify({
    run_id, kind: 'task', store_path: path, cwd, request: 'r', created_at: Date.now(),
    flow: 'develop', flow_chosen: 'develop', size: 'L', max_retries: 2, driver_restarts: 2,
    spec: { acceptance: ['a'], packages: [{ id: 'P1', title: 'module a', flow: 'develop', brief: 'b', acceptance: ['a'], touches: ['a.txt'], deps: [] }] },
    nodes: [done('size', 'size', []), done('shape', 'shape', ['size']), done('critique', 'critique', ['shape']),
      graph.node('dispatch:P1:1', 'dispatch', ['critique'], { subgoal_id: 'P1', state: dispatchState, child: { run_id: childId, cwd: childCwd, driver: { pid: DEAD, restarts: [], started_at: Date.now() - 1000 } } }),
      graph.node('accept:P1:1', 'accept', ['dispatch:P1:1'], { subgoal_id: 'P1' })],
  }, null, 2));
  current = { childId };
  return { id: run_id, key: `E-${run_id.slice(0, 8)}/P1`, node: 'dispatch:P1:1', childCwd, childId, runFile };
}

const load = (id) => JSON.parse(readFileSync(tm.taskPath(id), 'utf8'));
const save = (id, task) => writeFileSync(tm.taskPath(id), JSON.stringify(task));
const ledger = (id) => {
  const f = join(tm.taskDir(id), 'ledger.jsonl');
  return existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
};
const events = (id, ev) => ledger(id).filter((e) => e.event === ev);
const busLines = (id) => {
  const f = join(tm.taskDir(id), 'bus.jsonl');
  return existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
};
// A stub driver logs when its process starts, which can be after the test that spawned it: count
// per task (the prompt names the child run of the task last seeded), never across the file.
let current = null;
const driverCallsOf = (t) => (existsSync(STUB_LOG) ? readFileSync(STUB_LOG, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []).filter((c) => c.argv.at(-1).includes(t.childId));
const driverCalls = () => driverCallsOf(current);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 6000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return true; await sleep(50); }
  return fn();
}
const ask = (t, question = Q) => callTool('tm_ask', { task_id: t.id, key: t.key, question });
const post = (t, from, to, body = 'a note') => callTool('tm_post', { task_id: t.id, from, to, body });
const step = (t, answer) => daemon.stepOnce(t.id, { judge: async () => { throw new Error('no judge expected'); }, answer });
const verdict = (v) => async () => JSON.stringify(v);
const restarts = (t) => load(t.id).nodes.find((x) => x.node_id === t.node).child.driver.restarts;

// ---------- tm_ask is a bus message ----------

test('tm_ask and its answer are two bus lines: the answer replies to the question ts, and story_asks records that ts', async () => {
  const t = seedTask();
  const { ask_id } = await ask(t);
  const q = busLines(t.id);
  assert.equal(q.length, 1);
  assert.deepEqual({ from: q[0].from, to: q[0].to, body: q[0].body, reply_to: q[0].reply_to }, { from: t.key, to: 'teamleader', body: Q, reply_to: null });
  assert.equal(load(t.id).story_asks[0].question_ts, q[0].ts);
  await step(t, verdict({ verdict: 'answer', answer: 'cents' }));
  const lines = busLines(t.id);
  assert.equal(lines.length, 2);
  assert.deepEqual({ from: lines[1].from, to: lines[1].to, body: lines[1].body, reply_to: lines[1].reply_to }, { from: 'teamleader', to: t.key, body: 'cents', reply_to: q[0].ts });
  const entry = load(t.id).story_asks.find((a) => a.ask_id === ask_id);
  assert.equal(entry.question_ts, q[0].ts);
  assert.equal(entry.answer_ts, lines[1].ts);
  assert.equal(events(t.id, 'asked').length, 1, 'the asked ledger event is unchanged');
  assert.equal(events(t.id, 'answered').length, 1);
});

test('the person route (forward, then tm_submit) writes the answer as a person line replying to the question', async () => {
  const t = seedTask();
  await ask(t);
  await step(t, verdict({ verdict: 'forward', reason: 'unsettled' }));
  const { cards } = await callTool('tm_inbox', { task_id: t.id });
  await callTool('tm_submit', { task_id: t.id, key: cards[0].key, payload: { decisions: [{ question: Q, chose: 'integers' }] } });
  const lines = busLines(t.id);
  assert.equal(lines.length, 2);
  assert.deepEqual({ from: lines[1].from, to: lines[1].to, reply_to: lines[1].reply_to }, { from: 'person', to: t.key, reply_to: lines[0].ts });
});

test('a long question and answer are clipped with a marker on the bus only; the ledger keeps the full text and tm_ask refuses nothing new', async () => {
  const t = seedTask();
  const long = 'q'.repeat(bus.BODY_MAX + 500);
  await ask(t, long);
  const longAnswer = 'a'.repeat(bus.BODY_MAX + 500);
  await step(t, verdict({ verdict: 'answer', answer: longAnswer }));
  const lines = busLines(t.id);
  assert.equal(lines.length, 2);
  for (const m of lines) { assert.ok(m.body.length <= bus.BODY_MAX); assert.match(m.body, /clipped/); }
  assert.equal(events(t.id, 'asked')[0].question, long);
  assert.equal(events(t.id, 'answered')[0].answer, longAnswer);
});

test('an answer to a STORY whose dispatch is no longer running does not throw and writes no answer line', async () => {
  const t = seedTask();
  await ask(t);
  const task = load(t.id);
  task.nodes.find((x) => x.node_id === t.node).state = 'done';
  const a = task.story_asks[0];
  a.state = 'answering';
  a.answering = { pid: process.pid, token: 'tok' };
  save(t.id, task);
  const out = mutateTask(t.id, (tk) => tm.settleStoryAsk(tk, a.ask_id, 'tok', { verdict: 'answer', answer: 'cents' }));
  assert.equal(out.superseded, false);
  assert.equal(events(t.id, 'answered').length, 1, 'the ledger still records the answer');
  assert.equal(busLines(t.id).length, 1, 'only the question line is on the bus');
});

// ---------- the wake ----------

test('(a) a post to a parked STORY with no open ask starts exactly one driver naming the unread count, and spends no restart', async () => {
  const t = seedTask();
  const calls0 = driverCalls().length;
  await post(t, 'teamleader', t.key, 'sibling P2 finished the schema');
  await post(t, 'teamleader', t.key, 'use cents');
  await step(t);
  assert.ok(await until(() => driverCalls().length > calls0), 'a driver was started');
  const prompt = driverCalls().at(-1).argv.at(-1);
  assert.match(prompt, /2 unread, call tm_read/);
  assert.ok(!prompt.includes('use cents') && !prompt.includes('schema'), 'no body is inlined');
  assert.deepEqual(restarts(t), [], 'no restart is spent');
  const ev = events(t.id, 'child_driver_restarted').at(-1);
  assert.equal(ev.reason, 'bus_unread');
  // the driver is alive and the wake is recorded: more ticks start nothing
  await step(t);
  await step(t);
  await sleep(150);
  assert.equal(driverCalls().length, calls0 + 1, 'exactly one driver');
});

test('a started wake is not repeated for the same unread messages once that driver has exited; a newer message wakes again', async () => {
  const t = seedTask();
  const calls0 = driverCalls().length;
  await post(t, 'teamleader', t.key, 'one');
  await step(t);
  assert.ok(await until(() => driverCalls().length === calls0 + 1));
  const woken = load(t.id).nodes.find((x) => x.node_id === t.node).child.bus_woken_ts;
  assert.ok(Number.isFinite(woken) && woken > 0, 'bus_woken_ts is set once a process started');
  const task = load(t.id);
  task.nodes.find((x) => x.node_id === t.node).child.driver.pid = DEAD; // it exited without reading
  task.nodes.find((x) => x.node_id === t.node).child.driver.settled = null;
  save(t.id, task);
  await step(t);
  assert.ok(!events(t.id, 'child_driver_restarted').slice(1).some((e) => e.reason === 'bus_unread'), 'no second wake for the same message');
  await sleep(100);
  const task2 = load(t.id);
  task2.nodes.find((x) => x.node_id === t.node).child.driver.pid = DEAD;
  save(t.id, task2);
  const before = events(t.id, 'child_driver_restarted').filter((e) => e.reason === 'bus_unread').length;
  await post(t, 'teamleader', t.key, 'two');
  await step(t);
  assert.equal(events(t.id, 'child_driver_restarted').filter((e) => e.reason === 'bus_unread').length, before + 1, 'a newer message wakes');
});

test('a wake that could not start a process is not counted: bus_woken_ts stays unset and the next tick retries', async () => {
  const t = seedTask();
  const calls0 = driverCalls().length;
  await post(t, 'teamleader', t.key, 'hello');
  const good = process.env.HARNESS_CHILD_DRIVER;
  process.env.HARNESS_CHILD_DRIVER = '/nonexistent/driver-bin'; // spawn finds no binary: no process, no pid
  // The engine attaches no 'error' listener to a driver that never started; swallow that one
  // asynchronous ENOENT here so it does not fail the runner.
  const saved = process.listeners('uncaughtException');
  process.removeAllListeners('uncaughtException');
  process.on('uncaughtException', (e) => { if (!(e && e.code === 'ENOENT')) throw e; });
  try {
    await step(t);
    await step(t);
    await sleep(100);
  } finally {
    process.removeAllListeners('uncaughtException');
    for (const l of saved) process.on('uncaughtException', l);
    process.env.HARNESS_CHILD_DRIVER = good;
  }
  assert.equal(driverCalls().length, calls0, 'nothing started');
  const child = load(t.id).nodes.find((x) => x.node_id === t.node).child;
  assert.equal(child.bus_woken_ts, undefined);
  assert.ok(!child.driver.pid, 'the driver record has no pid');
  assert.equal(events(t.id, 'child_driver_restarted').filter((e) => e.reason === 'bus_unread').length, 2, 'retried on the second tick');
  assert.deepEqual(child.driver.restarts, [], 'no restart spent');
  await step(t);
  assert.ok(await until(() => driverCalls().length > calls0), 'retried on the next tick');
  assert.ok(await until(() => load(t.id).nodes.find((x) => x.node_id === t.node).child.bus_woken_ts > 0));
});

test('(b) a post to a STORY with an open ask starts no driver until the ask is answered; then one respawn carries the answer and the unread count', async () => {
  const t = seedTask();
  const calls0 = driverCalls().length;
  await ask(t);
  await post(t, 'teamleader', t.key, 'unrelated note');
  await step(t, verdict({ verdict: 'forward', reason: 'unsettled' }));
  await step(t, async () => { throw new Error('must not run again'); });
  await sleep(150);
  assert.equal(driverCalls().length, calls0, 'no driver while the ask is open');
  assert.equal(events(t.id, 'child_driver_restarted').length, 0);
  const { cards } = await callTool('tm_inbox', { task_id: t.id });
  await callTool('tm_submit', { task_id: t.id, key: cards[0].key, payload: { decisions: [{ question: Q, chose: 'integers' }] } });
  assert.ok(await until(() => driverCalls().length > calls0), 'the answer respawn started');
  const prompt = driverCalls().at(-1).argv.at(-1);
  assert.match(prompt, /integers/);
  assert.match(prompt, /1 unread, call tm_read/, 'the answer line itself is not counted');
  await step(t);
  await sleep(150);
  assert.equal(driverCalls().length, calls0 + 1, 'one respawn carried both');
  assert.deepEqual(restarts(t), []);
  assert.equal(events(t.id, 'child_driver_restarted').filter((e) => e.reason === 'bus_unread').length, 0);
});

test('(c) a post to a STORY whose driver is running starts no driver', async () => {
  const t = seedTask();
  const task = load(t.id);
  task.nodes.find((x) => x.node_id === t.node).child.driver.pid = process.pid;
  save(t.id, task);
  const calls0 = driverCalls().length;
  await post(t, 'teamleader', t.key, 'for a running driver');
  await step(t);
  await sleep(150);
  assert.equal(driverCalls().length, calls0);
  assert.equal(events(t.id, 'child_driver_restarted').length, 0);
  assert.equal(bus.unreadFor(load(t.id), t.key), 1, 'it waits to be read with tm_read');
});

test('(d) a post to `all` starts no driver and counts as unread for nobody', async () => {
  const t = seedTask();
  await post(t, 'teamleader', 'all', 'broadcast');
  assert.equal(bus.unreadFor(load(t.id), t.key), 0);
  // The driver is dead, as a parked STORY's is: the one thing a wake reads is the unread count, and
  // a broadcast is not in it. (The ordinary dead-driver restart may still run; it is not a wake.)
  const { busUnread } = await import(join(HERE, '..', 'mcp', 'taskmanager-drivers.mjs'));
  assert.deepEqual(busUnread(load(t.id), t.key), { count: 0, max_ts: 0 });
  await step(t);
  assert.equal(events(t.id, 'child_driver_restarted').filter((e) => e.reason === 'bus_unread').length, 0, 'no bus wake');
  assert.equal(events(t.id, 'bus_message').length, 1);
  assert.equal(load(t.id).nodes.find((x) => x.node_id === t.node).child.bus_woken_ts, undefined);
});

test('a STORY whose dispatch is no longer running, or whose run is done, is not woken by an unread message', async () => {
  const t = seedTask();
  const u = seedTask();
  await post(t, 'teamleader', t.key, 'late');
  await post(u, 'teamleader', u.key, 'late');
  // t: its dispatch has settled (a caller never services it); u: the child run finished.
  const task = load(t.id);
  task.nodes.find((x) => x.node_id === t.node).state = 'done';
  save(t.id, task);
  const run = JSON.parse(readFileSync(u.runFile, 'utf8'));
  run.nodes[0].state = 'done';
  writeFileSync(u.runFile, JSON.stringify(run));
  const tk = load(u.id);
  const n = tk.nodes.find((y) => y.node_id === u.node);
  assert.equal(tm.serviceDeadDriver(tk, n.child, n.node_id), false, 'a finished run is left to the fold');
  const tt = load(t.id);
  const nt = tt.nodes.find((y) => y.node_id === t.node);
  tm.serviceDeadDriver(tt, nt.child, nt.node_id);
  await sleep(150);
  assert.equal(driverCallsOf(u).length, 0, 'zero spawns for the finished run');
  assert.deepEqual(restarts(u), [], 'no restart spent');
  assert.equal(events(t.id, 'child_driver_restarted').filter((e) => e.reason === 'bus_unread').length, 0, 'no bus wake for a settled dispatch');
});

// ---------- the driver prompt ----------

test('the STORY driver prompt names tm_post and tm_read with the STORY key, and says questions go through tm_ask', async () => {
  const t = seedTask();
  const calls0 = driverCalls().length;
  await post(t, 'teamleader', t.key, 'x');
  await step(t);
  assert.ok(await until(() => driverCalls().length > calls0));
  const prompt = driverCalls().at(-1).argv.at(-1);
  assert.ok(prompt.includes(`tm_post({task_id: "${t.id}", from: "${t.key}"`), 'tm_post with the own key');
  assert.ok(prompt.includes(`tm_read({task_id: "${t.id}", key: "${t.key}"`), 'tm_read with the own key');
  assert.match(prompt, /still goes through tm_ask, never tm_post/);
  assert.ok(prompt.includes(`tm_ask({task_id: "${t.id}", key: "${t.key}"`));
});
