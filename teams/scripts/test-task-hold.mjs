#!/usr/bin/env node
// task.hold and tm_hold: one helper pair in taskstate.mjs writes the key and the two ledger events;
// the person holds/resumes through tm_hold; the engine holds only when a park leaves nothing runnable.
//
//   node --test teams/scripts/test-task-hold.mjs

process.env.TEAMS_RUNS_DIR ??= 'off';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const ROOT = realpathSync(mkdtempSync(join(tmpdir(), 'task-hold-')));
process.env.HARNESS_TASKS_DIR = ROOT;
process.env.HARNESS_TEST_NO_DAEMON = '1';
delete process.env.HARNESS_TEST_NO_DRIVER;
const STUB = join(ROOT, 'stay.mjs');
writeFileSync(STUB, 'setTimeout(() => {}, 30000);\n');
process.env.HARNESS_DAEMON = `node ${STUB}`;

const state = await import('../mcp/taskstate.mjs');
const { callTool } = await import('../mcp/taskmanager-tools.mjs');
const { toolHold } = await import('../mcp/taskmanager-handlers.mjs');
const { serviceDeadDriver, spawnChildDriver } = await import('../mcp/taskmanager-drivers.mjs');
const { worktreeGoneStop } = await import('../mcp/taskmanager-worktree.mjs');
const { node } = await import('../mcp/graph.mjs');

const pids = [];
after(() => {
  for (const p of pids) { try { process.kill(p, 'SIGKILL'); } catch { /* gone */ } }
  rmSync(ROOT, { recursive: true, force: true });
});

let seq = 0;
const done = (id, stage, deps) => node(id, stage, deps, { state: 'done', result: { stage_ok: true } });
function seed(extra = {}, nodes = null) {
  const run_id = `0000${String(++seq).padStart(4, '0')}-aaaa-bbbb-cccc-111111111111`;
  const path = state.taskPath(run_id);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({
    run_id, kind: 'task', store_path: path, cwd: ROOT, request: 'r', created_at: Date.now(),
    flow: 'develop', flow_chosen: 'develop', size: 'L', max_retries: 2, driver_restarts: 2,
    team: { opts: { max_parallel_teams: 4, max_live_drivers: 4 } },
    spec: { acceptance: ['a'], packages: [{ id: 'P1', title: 'p', flow: 'develop', brief: 'b', acceptance: ['a'], touches: ['a'], deps: [] }] },
    nodes: nodes || [done('size', 'size', []), done('shape', 'shape', ['size']), done('critique', 'critique', ['shape']),
      node('dispatch:P1:1', 'dispatch', ['critique'], { subgoal_id: 'P1' })],
    ...extra,
  }, null, 2));
  return run_id;
}
const load = (id) => JSON.parse(readFileSync(state.taskPath(id), 'utf8'));
const raw = (id) => readFileSync(state.taskPath(id), 'utf8');
const ledger = (id) => {
  const f = join(state.taskDir(id), 'ledger.jsonl');
  return existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
};
const events = (id, ev) => ledger(id).filter((e) => e.event === ev);
const tm = (name, a) => callTool(name, a, {});
const hold = (id, reason = 'lunch') => tm('tm_hold', { task_id: id, action: 'hold', reason });

test('F1-AC-19: a person hold writes task.hold and exactly one task_held event with the same fields', async () => {
  const id = seed();
  const out = await hold(id, 'wait for the design review');
  assert.equal(out.held, true);
  const h = load(id).hold;
  assert.deepEqual(Object.keys(h).sort(), ['by', 'reason', 'since']);
  assert.equal(h.by, 'person');
  assert.equal(h.reason, 'wait for the design review');
  assert.equal(new Date(h.since).toISOString(), h.since);
  const ev = events(id, 'task_held');
  assert.equal(ev.length, 1);
  assert.deepEqual({ reason: ev[0].reason, since: ev[0].since, by: ev[0].by }, h);
});

test('F1-AC-20: a person resume deletes the key, writes one task_resumed event and raises the daemon', async () => {
  const id = seed();
  await hold(id);
  delete process.env.HARNESS_TEST_NO_DAEMON;
  try {
    const out = await toolHold({ task_id: id, action: 'resume' });
    assert.equal(out.held, false);
  } finally {
    process.env.HARNESS_TEST_NO_DAEMON = '1';
  }
  const t = load(id);
  assert.equal('hold' in t, false, 'the key is deleted, not null');
  assert.equal(events(id, 'task_resumed').length, 1);
  assert.ok(t.daemon && Number.isInteger(t.daemon.pid), 'serviceDaemon raised a daemon');
  pids.push(t.daemon.pid);
});

test('F1-AC-15: through callTool, no daemon is raised while held and task_resumed is ledgered before daemon_restarted', async () => {
  const id = seed({ daemon: { pid: 2147483000, started_at: 1, restarts: 0 } });
  await hold(id);
  delete process.env.HARNESS_TEST_NO_DAEMON;
  try {
    await tm('tm_status', { task_id: id });
    assert.equal(events(id, 'daemon_restarted').length, 0, 'a held task is not raised by any call');
    await tm('tm_hold', { task_id: id, action: 'resume' });
  } finally {
    process.env.HARNESS_TEST_NO_DAEMON = '1';
  }
  const names = ledger(id).map((e) => e.event);
  const held = names.indexOf('task_held'), resumed = names.indexOf('task_resumed'), restarted = names.indexOf('daemon_restarted');
  assert.ok(held >= 0 && resumed > held && restarted > resumed, `order ${names.join(',')}`);
  pids.push(load(id).daemon.pid);
});

test('refusals write neither task.json nor the ledger', async () => {
  const unheld = seed();
  const held = seed();
  await hold(held);
  const cancelled = seed({ cancelled: { at: Date.now(), by: 'tm_cancel', was: 'running' } });
  const cleaned = seed();
  writeFileSync(join(state.taskDir(cleaned), 'ledger.jsonl'), JSON.stringify({ ts: Date.now(), event: 'clean', task_id: cleaned }) + '\n');
  const cases = [
    [unheld, { action: 'resume' }, /not held/],
    [held, { action: 'hold', reason: 'again' }, /already held/],
    [cancelled, { action: 'hold', reason: 'x' }, /cancelled/],
    [cleaned, { action: 'hold', reason: 'x' }, /refused/],
    [unheld, { action: 'hold', reason: '  ' }, /reason/],
  ];
  for (const [id, args, re] of cases) {
    const before = { json: raw(id), ledger: ledger(id).length };
    await assert.rejects(() => tm('tm_hold', { task_id: id, ...args }), re);
    assert.equal(raw(id), before.json, 'task.json untouched');
    assert.equal(ledger(id).length, before.ledger, 'ledger untouched');
  }
});

test('F1-AC-21: a held task with a dead daemon keeps its hold; F1-AC-22: an unheld one gets none', async () => {
  const dead = { pid: 2147483000, started_at: 1, restarts: 0 };
  const held = seed({ daemon: dead });
  await hold(held, 'paused by me');
  const before = load(held).hold;
  await tm('tm_status', { task_id: held });
  assert.deepEqual(load(held).hold, before);
  const stalled = seed({ daemon: dead });
  await tm('tm_status', { task_id: stalled });
  assert.equal('hold' in load(stalled), false, 'a real stall is not a hold');
  assert.equal(events(stalled, 'task_held').length, 0);
});

test('F1-AC-23: a task.json written before this change loads and counts as not held', async () => {
  const id = seed();
  assert.equal('hold' in load(id), false);
  assert.equal(state.personHeld(load(id)), false);
  const out = await tm('tm_status', { task_id: id });
  assert.equal(out.task_id, id);
  assert.equal(state.clearHold(load(id), { by: 'person' }), false);
});

test('F1-AC-13: an engine hold is written only when nothing is runnable, and an engine lift never frees a person hold', () => {
  const parked = (p) => node(`dispatch:${p}:1`, 'dispatch', ['critique'], { subgoal_id: p, state: 'running', child: { run_id: 'c', cwd: ROOT, waiting_capacity: { reason: 'limit' } } });
  const base = [done('size', 'size', []), done('shape', 'shape', ['size']), done('critique', 'critique', ['shape'])];
  // another node still runs: a park of one node writes no hold
  const busy = load(seed({}, [...base, parked('P1'), node('dispatch:P2:1', 'dispatch', ['critique'], { subgoal_id: 'P2', state: 'running', child: { run_id: 'd', cwd: ROOT } })]));
  assert.equal(state.holdIfIdle(busy, 'waiting_capacity: limit'), false);
  assert.equal('hold' in busy, false);
  // a ready pending node is runnable work too
  const ready = load(seed({}, [...base, parked('P1'), node('dispatch:P2:1', 'dispatch', ['critique'], { subgoal_id: 'P2' })]));
  assert.equal(state.holdIfIdle(ready, 'waiting_capacity: limit'), false);
  // nothing runnable: held by the engine, lifted by the engine
  const idleId = seed({}, [...base, parked('P1')]);
  const idle = load(idleId);
  assert.equal(state.holdIfIdle(idle, 'waiting_capacity: limit'), true);
  assert.equal(idle.hold.by, 'engine');
  assert.equal(events(idleId, 'task_held').length, 1);
  assert.equal(state.clearHold(idle, { by: 'engine', reasonPrefix: 'ask:' }), false, 'another park\'s lift leaves it');
  assert.equal(state.clearHold(idle, { by: 'engine', reasonPrefix: 'waiting_capacity:' }), true);
  assert.equal('hold' in idle, false);
  assert.equal(events(idleId, 'task_resumed').length, 1);
  // a person's hold is neither overwritten nor lifted by the engine
  const mine = load(seed({}, [...base, parked('P1')]));
  assert.equal(state.setHold(mine, { reason: 'mine', by: 'person' }), true);
  assert.equal(state.holdIfIdle(mine, 'waiting_capacity: limit'), false);
  assert.equal(state.clearHold(mine, { by: 'engine' }), false);
  assert.equal(mine.hold.reason, 'mine');
});

test('F1-AC-13: worktreeGoneStop writes an engine hold and nothing lifts it', () => {
  const id = seed({ cwd: join(ROOT, 'gone-dir') });
  const task = load(id);
  const stop = worktreeGoneStop(task);
  assert.equal(stop.kind, 'task_cwd');
  assert.equal(task.hold.by, 'engine');
  assert.match(task.hold.reason, /^worktree_gone:/);
  assert.equal(events(id, 'task_held').length, 1);
  assert.equal(state.clearHold(task, { by: 'engine', reasonPrefix: 'waiting_capacity:' }), false);
  assert.equal(state.clearHold(task, { by: 'engine', reasonPrefix: 'ask:' }), false);
  assert.ok(task.hold, 'the hold stays on record until tm_cancel / tm_clean');
});

test('no driver is restarted while hold.by is person, and starts again after the resume', async () => {
  const log = join(ROOT, 'drivers.jsonl');
  const driverJs = join(ROOT, 'driver.mjs');
  writeFileSync(driverJs, `import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const prompt = process.argv.at(-1);
const m = prompt.match(/run_id (\\S+) at cwd (\\S+)\\. Do not/);
appendFileSync(process.env.STUB_LOG, JSON.stringify({ pid: process.pid }) + '\\n');
if (m) {
  const file = join(m[2], '.teams_output', 'broker', 'runs', m[1] + '.json');
  const run = JSON.parse(readFileSync(file, 'utf8'));
  const n = run.nodes.find((x) => x.state === 'pending');
  if (n) { n.state = 'done'; n.result = { stage_ok: true }; }
  writeFileSync(file, JSON.stringify(run));
}
`);
  process.env.STUB_LOG = log;
  process.env.HARNESS_CHILD_DRIVER = `node ${driverJs}`;
  const childCwd = mkdtempSync(join(ROOT, 'wt-'));
  mkdirSync(join(childCwd, '.teams_output', 'broker', 'runs'), { recursive: true });
  writeFileSync(join(childCwd, '.teams_output', 'broker', 'runs', 'c1.json'), JSON.stringify({
    run_id: 'c1', flow: 'develop', max_retries: 2, cwd: childCwd, spec: { subgoals: [{ id: 'U1', title: 'unit' }] },
    nodes: [node('implement:U1:1', 'implement', [], { state: 'pending', subgoal_id: 'U1' }), node('test:U1:1', 'test', ['implement:U1:1'], { state: 'pending', subgoal_id: 'U1' })],
  }));
  const child = { run_id: 'c1', cwd: childCwd };
  const n = { node_id: 'dispatch:P1:1', stage: 'dispatch', subgoal_id: 'P1', state: 'running', child };
  const task = { run_id: '1a2b0004-1111-2222-3333-444444444444', kind: 'task', cwd: ROOT, driver_restarts: 2, nodes: [n] };
  child.driver = spawnChildDriver(task, n.node_id, child);
  const end = Date.now() + 8000;
  while (!existsSync(child.driver.exit) && Date.now() < end) await new Promise((r) => setTimeout(r, 25));
  assert.ok(existsSync(child.driver.exit), 'the first driver exited');
  const calls = () => readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).length;
  assert.equal(calls(), 1);
  state.setHold(task, { reason: 'mine', by: 'person' });
  assert.equal(serviceDeadDriver(task, child, n.node_id), false, 'held: the dead driver is not replaced');
  assert.equal(calls(), 1, 'no process started');
  state.clearHold(task, { by: 'person' });
  assert.equal(serviceDeadDriver(task, child, n.node_id), true, 'resumed: the next driver starts');
});

// A driver stub that only records that a process started.
function stubDriver(name) {
  const log = join(ROOT, `${name}.log`);
  const js = join(ROOT, `${name}.mjs`);
  writeFileSync(js, `import { appendFileSync } from 'node:fs';\nappendFileSync(${JSON.stringify(log)}, 'x\\n');\n`);
  process.env.HARNESS_CHILD_DRIVER = `node ${js}`;
  return () => (existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean).length : 0);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function harnessSeed() {
  return seed({
    size: 'S', spec: null, driver_restarts: 3,
    harness_run: { cwd: ROOT, run: null, opened_at: Date.now(), pointer: join(ROOT, 'none.json'), driver: { pid: 2147483646, log: join(ROOT, 'no-such.log'), restarts: [] } },
  }, [done('size', 'size', [])]);
}

test('no driver starts through tm_status or tm_next of a size-S task under a person hold', async () => {
  const spawns = stubDriver('s-harness');
  const held = harnessSeed();
  await hold(held);
  await tm('tm_status', { task_id: held });
  const reply = await tm('tm_next', { task_id: held });
  await sleep(500);
  assert.equal(reply.held, true);
  assert.equal(spawns(), 0, 'held: no process started');
  assert.equal(events(held, 'child_driver_restarted').length, 0);
  assert.equal(load(held).harness_run.driver.pid, 2147483646);
  const control = harnessSeed();
  await tm('tm_status', { task_id: control });
  const end = Date.now() + 5000;
  while (!spawns() && Date.now() < end) await sleep(25);
  assert.equal(spawns(), 1, 'control: the same call on an unheld task restarts the driver');
});

test('no package opens through tm_next of a size-L task under a person hold', async () => {
  const spawns = stubDriver('l-dispatch');
  const id = seed();
  await hold(id);
  const reply = await tm('tm_next', { task_id: id });
  await sleep(300);
  assert.equal(reply.held, true);
  assert.equal(spawns(), 0);
  assert.equal(load(id).nodes.find((n) => n.node_id === 'dispatch:P1:1').state, 'pending', 'the dispatch never opened');
});

for (const [label, mk] of [['S', harnessSeed], ['L', () => seed()]]) {
  test(`tm_retry and tm_retry reset_capacity of a size-${label} task under a person hold are refused: no driver, nothing written; after resume they are accepted`, async () => {
    const spawns = stubDriver(`retry-${label}`);
    const id = mk();
    await hold(id);
    const before = raw(id);
    const nEvents = ledger(id).length;
    for (const a of [{}, { reset_capacity: true }]) {
      await assert.rejects(() => tm('tm_retry', { task_id: id, ...a }), /tm_retry refused: the task is held by a person/);
    }
    await sleep(300);
    assert.equal(spawns(), 0, 'no process started');
    assert.equal(raw(id), before, 'task.json untouched');
    assert.equal(ledger(id).length, nEvents, 'ledger untouched');
    await tm('tm_hold', { task_id: id, action: 'resume' });
    const reply = await tm('tm_retry', { task_id: id, reset_capacity: true });
    assert.equal(reply.task_id, id, 'after resume the retry is accepted');
    assert.equal(events(id, 'tm_reset_capacity').length, 1);
  });
}

test('F1-AC-13: the worktree-gone hold survives tm_retry and tm_hold resume, and is written again if missing', async () => {
  const id = seed({ cwd: join(ROOT, 'gone-dir-2') });
  const task = load(id);
  worktreeGoneStop(task);
  writeFileSync(state.taskPath(id), JSON.stringify(task));
  assert.equal(state.clearHold(task, { by: 'engine' }), false, 'a generic engine lift leaves it');
  assert.equal(state.clearHold(task, { by: 'person' }), false, 'a person lift leaves it');
  await assert.rejects(() => tm('tm_hold', { task_id: id, action: 'resume' }), /gone worktree/);
  assert.match(load(id).hold.reason, /^worktree_gone:/);
  await tm('tm_retry', { task_id: id, reset_capacity: true }).catch(() => {});
  assert.match(load(id).hold.reason, /^worktree_gone:/, 'tm_retry does not lift it');
  const lost = load(id);
  delete lost.hold;
  worktreeGoneStop(lost);
  assert.match(lost.hold.reason, /^worktree_gone:/, 'the stop standing, the record is written again');
});
