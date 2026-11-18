#!/usr/bin/env node
// Ended tasks resume from the node that stopped them (card 129 items 5-7). Later units append
// their tests below the shared helpers.
//
//   node --test teams/scripts/test-ended-resume.mjs

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = mkdtempSync(join(tmpdir(), 'ended-resume-'));
process.env.HARNESS_TASKS_DIR = ROOT;
// Stub daemon and child driver (U4): both stay up 30 s, so a spawn is seen as a live pid. Set
// before the first import of the engine reads them.
const STUB_DIR = mkdtempSync(join(tmpdir(), 'ended-resume-stub-'));
writeFileSync(join(STUB_DIR, 'stay.mjs'), 'setTimeout(() => {}, 30000);\n');
process.env.HARNESS_DAEMON = `node ${join(STUB_DIR, 'stay.mjs')}`;
process.env.HARNESS_CHILD_DRIVER = `node ${join(STUB_DIR, 'stay.mjs')}`;

const { retryPackage } = await import('../mcp/taskmanager-plan.mjs');
const { callTool, serviceDaemon, serviceRunningDispatches } = await import('../mcp/taskmanager.mjs');
const { node, peekHumanActions, saveRun } = await import('../mcp/graph.mjs');

const stubs = [];
const repos = [];
after(() => {
  for (const p of stubs) { try { process.kill(-p, 'SIGKILL'); } catch { /* gone */ } }
  rmSync(ROOT, { recursive: true, force: true });
  rmSync(STUB_DIR, { recursive: true, force: true });
  for (const d of repos) rmSync(d, { recursive: true, force: true });
});

// A live process standing in for a package's child driver (detached: killDriver signals the group).
function stubDriver() {
  const proc = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { detached: true, stdio: 'ignore' });
  proc.unref();
  stubs.push(proc.pid);
  return { pid: proc.pid, started_at: Date.now() };
}

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function deadWithin(pid, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (!alive(pid)) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return !alive(pid);
}

const ledgerOf = (task) => {
  try { return readFileSync(join(ROOT, task.run_id, 'ledger.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; }
};

// P1 behind a done critique: attempts in `running` have a running dispatch with a live stub driver
// and a pending accept; attempt 1, when not running, is failed.
function packageTask(runId, running) {
  mkdirSync(join(ROOT, runId), { recursive: true });
  const nodes = [node('critique', 'critique', [], { state: 'done' })];
  const drivers = {};
  const failed = { stage_ok: false, reason: 'rejected' };
  if (!running.includes(1)) {
    nodes.push(node('dispatch:P1:1', 'dispatch', ['critique'], { subgoal_id: 'P1', attempt: 1, state: 'failed', result: failed }));
    nodes.push(node('accept:P1:1', 'accept', ['dispatch:P1:1'], { subgoal_id: 'P1', attempt: 1, state: 'failed', result: failed }));
  }
  for (const a of running) {
    drivers[a] = stubDriver();
    nodes.push(node(`dispatch:P1:${a}`, 'dispatch', ['critique'], { subgoal_id: 'P1', attempt: a, state: 'running', child: { run_id: `child-${a}`, cwd: ROOT, driver: drivers[a] } }));
    nodes.push(node(`accept:P1:${a}`, 'accept', [`dispatch:P1:${a}`], { subgoal_id: 'P1', attempt: a }));
  }
  const task = { run_id: runId, cwd: ROOT, max_retries: 2, nodes, team: { opts: {} } };
  return { task, drivers };
}

async function checkSuperseded(task, drivers, attempts) {
  const out = retryPackage(task, 'P1', 'again');
  assert.equal(out.attempt, 3);
  const led = ledgerOf(task);
  for (const a of attempts) {
    assert.ok(await deadWithin(drivers[a].pid, 2000), `driver of attempt ${a} still alive`);
    const d = task.nodes.find((n) => n.node_id === `dispatch:P1:${a}`);
    assert.equal(d.state, 'skipped');
    assert.equal(d.result.superseded_by, 'dispatch:P1:3');
    assert.equal(task.nodes.find((n) => n.node_id === `accept:P1:${a}`).state, 'skipped');
    assert.ok(led.some((e) => e.event === 'child_driver_killed' && e.node_id === `dispatch:P1:${a}` && e.pid === drivers[a].pid), `no child_driver_killed for attempt ${a}`);
  }
  assert.equal(serviceRunningDispatches(task), 0);
  assert.ok(!ledgerOf(task).some((e) => e.event === 'child_driver_restarted'));
}

test('B5: package retry supersedes and kills the previous dispatch (running driver, pending accept)', async () => {
  const { task, drivers } = packageTask('b5000000-0000-0000-0000-000000000001', [2]);
  await checkSuperseded(task, drivers, [2]);
});

test('B5 older: an older running attempt is superseded too (attempts 1 and 2 both running)', async () => {
  const { task, drivers } = packageTask('b5000000-0000-0000-0000-000000000002', [1, 2]);
  await checkSuperseded(task, drivers, [1, 2]);
});

// ---------- B6: a blocked stop records a notify event ----------

const DAEMON = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'mcp', 'daemon.mjs');

function writeTask(runId, extra) {
  mkdirSync(join(ROOT, runId), { recursive: true });
  const task = { run_id: runId, cwd: ROOT, request: 'b6', max_retries: 2, team: { opts: {} }, ...extra };
  writeFileSync(join(ROOT, runId, 'task.json'), JSON.stringify(task));
  return task;
}

test('B6: a blocked daemon records a notify event after daemon_done', async () => {
  const runId = 'b6000000-0000-0000-0000-000000000001';
  const conflict = { stage_ok: false, reason: 'merge conflict', conflicts: ['a.txt'] };
  const task = writeTask(runId, {
    nodes: [
      node('critique', 'critique', [], { state: 'done' }),
      node('dispatch:P1:1', 'dispatch', ['critique'], { subgoal_id: 'P1', attempt: 1, state: 'failed', result: conflict }),
      node('accept:P1:1', 'accept', ['dispatch:P1:1'], { subgoal_id: 'P1', attempt: 1 }),
    ],
  });
  const stub = join(ROOT, 'judge-stub.mjs');
  writeFileSync(stub, 'process.exit(1);\n');
  const proc = spawn(process.execPath, [DAEMON, '--task', runId], {
    stdio: 'ignore',
    env: { ...process.env, HARNESS_TASKS_DIR: ROOT, HARNESS_JUDGE_DRIVER: `node ${stub}`, TEAMS_RUNS_DIR: 'off', HARNESS_TEST_RUNNER_PID: String(process.pid) },
  });
  const killer = setTimeout(() => { try { proc.kill('SIGKILL'); } catch { /* gone */ } }, 25000);
  const code = await new Promise((res) => proc.on('exit', res));
  clearTimeout(killer);
  assert.equal(code, 0);
  const led = ledgerOf(task);
  const done = led.findIndex((e) => e.event === 'daemon_done');
  assert.ok(done >= 0, 'daemon_done recorded');
  assert.equal(led[done].state, 'blocked');
  assert.equal(led[done + 1].event, 'notify');
  assert.equal(led[done + 1].kind, 'task_blocked');
  assert.equal(led[done + 1].node_id, 'dispatch:P1:1');
});

test('B6 exhausted: serviceDaemon records a notify event after daemon_exhausted', () => {
  const runId = 'b6000000-0000-0000-0000-000000000002';
  const task = writeTask(runId, {
    driver_restarts: 2,
    daemon: { pid: 2147483000, started_at: Date.now() - 1000, restarts: 2, exhausted: false },
    nodes: [
      node('critique', 'critique', [], { state: 'done' }),
      node('dispatch:P1:1', 'dispatch', ['critique'], { subgoal_id: 'P1', attempt: 1 }),
    ],
  });
  assert.equal(serviceDaemon(task), true);
  const led = ledgerOf(task);
  const ex = led.findIndex((e) => e.event === 'daemon_exhausted');
  assert.ok(ex >= 0, 'daemon_exhausted recorded');
  assert.equal(led[ex + 1].event, 'notify');
  assert.equal(led[ex + 1].kind, 'task_blocked');
  assert.equal(led.filter((e) => e.event === 'notify').length, 1);
});

// ---------- B1/B3: tm_retry continues from the blocked node and starts a daemon ----------

function gitRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'ended-resume-repo-'));
  repos.push(dir);
  const git = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' });
  git('init', '-q');
  git('config', 'user.email', 't@t');
  git('config', 'user.name', 't');
  writeFileSync(join(dir, 'a.txt'), 'x\n');
  writeFileSync(join(dir, '.gitignore'), '.teams_output/\n');
  git('add', '-A');
  git('commit', '-qm', 'init');
  return dir;
}

// A blocked task: P1's attempts 1..failedAttempts failed (the last one with a merge conflict).
function retryFixture(runId, { exhausted, failedAttempts = 1 }) {
  const failed = { stage_ok: false, reason: 'merge conflict', conflicts: ['a.txt'] };
  const nodes = [node('critique', 'critique', [], { state: 'done' })];
  for (let a = 1; a <= failedAttempts; a++) {
    nodes.push(node(`dispatch:P1:${a}`, 'dispatch', ['critique'], { subgoal_id: 'P1', attempt: a, state: 'failed', result: failed }));
    nodes.push(node(`accept:P1:${a}`, 'accept', [`dispatch:P1:${a}`], { subgoal_id: 'P1', attempt: a }));
  }
  const cwd = gitRepo();
  const task = writeTask(runId, {
    cwd, driver_restarts: 2, nodes,
    spec: { packages: [{ id: 'P1', title: 'p1', touches: ['a.txt'] }] },
    daemon: { pid: 2147483000, started_at: Date.now() - 1000, restarts: 2, exhausted },
  });
  writeFileSync(join(ROOT, runId, 'ledger.jsonl'), JSON.stringify({ event: 'daemon_done', task_id: runId, state: 'blocked' }) + '\n');
  return { task, cwd };
}

const readTask = (runId) => JSON.parse(readFileSync(join(ROOT, runId, 'task.json'), 'utf8'));
function reap(runId) {
  const t = readTask(runId);
  if (t.daemon && t.daemon.pid) stubs.push(t.daemon.pid);
  for (const n of t.nodes) if (n.child && n.child.driver && n.child.driver.pid) stubs.push(n.child.driver.pid);
  return t;
}
const reasons = (task) => ledgerOf(task).filter((e) => e.event === 'daemon_restarted').map((e) => e.reason);
const reshaped = (t) => t.nodes.some((n) => /^(shape|critique):/.test(n.node_id));

async function daemonResumedOnce(runId, task) {
  const t = reap(runId);
  assert.ok(t.daemon.pid !== 2147483000 && alive(t.daemon.pid), 'a new daemon is alive');
  assert.deepEqual(reasons(task), ['reset']);
  assert.ok(ledgerOf(task).some((e) => e.event === 'daemon_resumed'));
  await callTool('tm_status', { task_id: runId });
  assert.equal(readTask(runId).daemon.pid, t.daemon.pid, 'tm_status does not respawn');
  assert.deepEqual(reasons(task), ['reset']);
}

test('B1: tm_retry on an ended blocked task continues from the blocked package and starts a daemon', async () => {
  const runId = 'b1000000-0000-0000-0000-000000000001';
  const { task } = retryFixture(runId, { exhausted: false });
  const reply = await callTool('tm_retry', { task_id: runId });
  assert.equal(reply.retried, true);
  assert.equal(reply.node_id, 'dispatch:P1:1');
  assert.equal(reply.target, 'P1');
  assert.ok(reply.daemon && reply.daemon.spawned === true);
  const t = readTask(runId);
  assert.ok(t.nodes.some((n) => n.node_id === 'dispatch:P1:2'), 'attempt 2 opened');
  assert.ok(!reshaped(t), 'no reshape');
  await daemonResumedOnce(runId, task);
});

test('B1 spent: bare tm_retry with the package budget spent settles, adds no attempt and no reshape', async () => {
  const runId = 'b1000000-0000-0000-0000-000000000002';
  const { task } = retryFixture(runId, { exhausted: false, failedAttempts: 3 });
  const reply = await callTool('tm_retry', { task_id: runId });
  reap(runId);
  assert.equal(reply.retried, false);
  assert.equal(reply.reason, 'retry budget exhausted');
  assert.ok(Array.isArray(reply.unreachable));
  const t = readTask(runId);
  assert.ok(!t.nodes.some((n) => n.node_id === 'dispatch:P1:4'), 'no fourth attempt');
  assert.ok(!reshaped(t), 'no reshape');
  assert.deepEqual(reasons(task), [], 'a settled graph starts no daemon');
});

test('B3a: package retry starts a daemon although exhausted is set', async () => {
  const runId = 'b3000000-0000-0000-0000-000000000001';
  const { task } = retryFixture(runId, { exhausted: true });
  const reply = await callTool('tm_retry', { task_id: runId, package_id: 'P1' });
  assert.equal(reply.retried, true);
  assert.ok(reply.daemon && reply.daemon.spawned === true);
  assert.equal(readTask(runId).daemon.exhausted, false);
  await daemonResumedOnce(runId, task);
});

test('B3b: bare tm_retry never reshapes a blocked package, and a running graph resumes its daemon', async () => {
  const runId = 'b3000000-0000-0000-0000-000000000002';
  const { task } = retryFixture(runId, { exhausted: true });
  const reply = await callTool('tm_retry', { task_id: runId });
  assert.equal(reply.target, 'P1');
  assert.ok(!reshaped(readTask(runId)), 'no reshape');
  await daemonResumedOnce(runId, task);

  const run2 = 'b3000000-0000-0000-0000-000000000003';
  const f2 = retryFixture(run2, { exhausted: true });
  const t2 = readTask(run2);
  t2.nodes = [node('critique', 'critique', [], { state: 'done' }), node('dispatch:P1:1', 'dispatch', ['critique'], { subgoal_id: 'P1', attempt: 1 })];
  writeFileSync(join(ROOT, run2, 'task.json'), JSON.stringify(t2));
  const r2 = await callTool('tm_retry', { task_id: run2 });
  reap(run2);
  assert.equal(r2.retried, true);
  assert.equal(r2.target, 'daemon');
  assert.ok(!reshaped(readTask(run2)));
  assert.deepEqual(reasons(f2.task), ['reset']);
});

// ---------- B2: answering an ask on an ended task restarts the daemon ----------

const askNode = (id, extra) => node(id, 'ask', [], {
  state: 'waiting_human', waiting_since: Date.now(),
  questions: [{ question: 'q', options: [{ option: 'a' }, { option: 'b' }] }],
  assignment: { executor: 'human', vendor: 'human', who: 'PO' }, ...extra,
});
const endedLedger = (runId) => writeFileSync(join(ROOT, runId, 'ledger.jsonl'), JSON.stringify({ event: 'daemon_done', task_id: runId, state: 'waiting_human' }) + '\n');

async function answeredOnce(runId, task, nodeId) {
  const t = reap(runId);
  assert.ok(t.daemon.pid !== 2147483000 && alive(t.daemon.pid), 'a new daemon is alive');
  assert.equal(t.daemon.restarts, 0);
  assert.equal(t.daemon.exhausted, false);
  const resumed = ledgerOf(task).filter((e) => e.event === 'daemon_resumed');
  assert.equal(resumed.length, 1);
  assert.equal(resumed[0].reason, 'ask_answered');
  assert.equal(resumed[0].node_id, nodeId);
  assert.deepEqual(reasons(task), ['reset']);
  await callTool('tm_status', { task_id: runId });
  assert.equal(readTask(runId).daemon.pid, t.daemon.pid, 'tm_status does not respawn');
  assert.deepEqual(reasons(task), ['reset']);
}

test('B2: answering a manager ask on an ended task restarts the daemon', async () => {
  const runId = 'b2000000-0000-0000-0000-000000000001';
  const task = writeTask(runId, {
    driver_restarts: 2,
    nodes: [askNode('ask:TASK:1'), node('critique', 'critique', ['ask:TASK:1'], {})],
    daemon: { pid: 2147483000, started_at: Date.now() - 1000, restarts: 2, exhausted: false },
  });
  endedLedger(runId);
  const key = `E-${runId.slice(0, 8)}/TASK/ask:TASK:1`;
  await callTool('tm_submit', { task_id: runId, key, payload: { decisions: [{ question: 'q', chose: 'a' }] } });
  assert.equal(readTask(runId).nodes.find((n) => n.node_id === 'ask:TASK:1').state, 'done');
  await answeredOnce(runId, task, 'ask:TASK:1');
});

test('B2 child: answering a STORY ask on an ended task restarts the daemon', async () => {
  const runId = 'b2000000-0000-0000-0000-000000000002';
  const childId = 'b2-child-1';
  saveRun({
    cwd: ROOT, run_id: childId, max_retries: 2,
    spec: { subgoals: [{ id: 'U1', kind: 'planning' }] },
    nodes: [askNode('ask:U1:1', { subgoal_id: 'U1', attempt: 1 })],
  });
  const task = writeTask(runId, {
    driver_restarts: 2,
    nodes: [
      node('critique', 'critique', [], { state: 'done' }),
      node('dispatch:P1:1', 'dispatch', ['critique'], { subgoal_id: 'P1', attempt: 1, state: 'running', child: { run_id: childId, cwd: ROOT, driver: { pid: 2147483646, restarts: [] } } }),
      node('accept:P1:1', 'accept', ['dispatch:P1:1'], { subgoal_id: 'P1', attempt: 1 }),
    ],
    daemon: { pid: 2147483000, started_at: Date.now() - 1000, restarts: 2, exhausted: false },
  });
  // No daemon_done line: a running dispatch keeps the task running, so the daemon never ends
  // here; the dead daemon at its restart budget is the state a crash leaves.
  const key = `E-${runId.slice(0, 8)}/P1/U1`;
  await callTool('tm_submit', { task_id: runId, key, payload: { decisions: [{ question: 'q', chose: 'a' }] } });
  assert.ok(peekHumanActions(ROOT, childId).some((x) => x.kind === 'submit' && x.node_id === 'ask:U1:1'), 'answer queued for the child run');
  await answeredOnce(runId, task, 'ask:U1:1');
});

// The reachable incident (E-e9e7a45b): the STORY's run file vanished, its dispatch folded failed,
// the daemon ended blocked. A forwarded ask card is all that waits on the person.
function blockedStoryAsk(runId, { failedAttempts = 1 } = {}) {
  const failed = { stage_ok: false, reason: 'child run file missing' };
  const nodes = [node('critique', 'critique', [], { state: 'done' })];
  for (let a = 1; a <= failedAttempts; a++) {
    nodes.push(node(`dispatch:P1:${a}`, 'dispatch', ['critique'], { subgoal_id: 'P1', attempt: a, state: 'failed', result: failed, child: { run_id: 'vanished-child', cwd: ROOT, driver: { pid: 2147483646, restarts: [] } } }));
    nodes.push(node(`accept:P1:${a}`, 'accept', [`dispatch:P1:${a}`], { subgoal_id: 'P1', attempt: a }));
  }
  const pkey = `E-${runId.slice(0, 8)}/P1/U1`;
  nodes.push(askNode('ask:story-P1:1', { ask_id: 'A1', ask_owner: 'story-P1', story: { ask_id: 'A1', key: pkey } }));
  const task = writeTask(runId, {
    cwd: gitRepo(), driver_restarts: 2, nodes,
    spec: { packages: [{ id: 'P1', title: 'p1', touches: ['a.txt'] }] },
    story_asks: [{ ask_id: 'A1', key: pkey, pkg: 'P1', node_id: `dispatch:P1:${failedAttempts}`, question: 'which db?', state: 'forwarded', card_node_id: 'ask:story-P1:1', at: Date.now() }],
    daemon: { pid: 2147483000, started_at: Date.now() - 1000, restarts: 2, exhausted: false },
  });
  writeFileSync(join(ROOT, runId, 'ledger.jsonl'), JSON.stringify({ event: 'daemon_done', task_id: runId, state: 'blocked' }) + '\n');
  return task;
}

test('B2 blocked: answering a STORY ask on a blocked ended task continues from the blocked node with the answer', async () => {
  const runId = 'b2000000-0000-0000-0000-000000000003';
  const task = blockedStoryAsk(runId);
  const key = `E-${runId.slice(0, 8)}/TASK/ask:story-P1:1`;
  await callTool('tm_submit', { task_id: runId, key, payload: { decisions: [{ question: 'which db?', chose: 'postgres' }] } });
  const t = readTask(runId);
  const next = t.nodes.find((n) => n.node_id === 'dispatch:P1:2');
  assert.ok(next, 'attempt 2 opened');
  assert.ok(/postgres/.test(next.feedback || ''), 'the answer reaches the new attempt');
  assert.ok(!reshaped(t), 'no reshape');
  await answeredOnce(runId, task, 'dispatch:P1:1');
});

test('B2 blocked spent: answering with the package budget spent spawns nothing and says so', async () => {
  const runId = 'b2000000-0000-0000-0000-000000000004';
  const task = blockedStoryAsk(runId, { failedAttempts: 3 });
  const key = `E-${runId.slice(0, 8)}/TASK/ask:story-P1:1`;
  const reply = await callTool('tm_submit', { task_id: runId, key, payload: { decisions: [{ question: 'which db?', chose: 'postgres' }] } });
  const t = reap(runId);
  assert.equal(reply.retry && reply.retry.retried, false);
  assert.equal(reply.retry.reason, 'retry budget exhausted');
  assert.ok(!t.nodes.some((n) => n.node_id === 'dispatch:P1:4'), 'no fourth attempt');
  assert.ok(!reshaped(t), 'no reshape');
  assert.deepEqual(reasons(task), [], 'no daemon');
});
