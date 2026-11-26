#!/usr/bin/env node
// The size-S path's free code-0 exit (card 178 Task 4, PRD F4): a driver's code-0 exit while the
// run is unfinished spends no restart when a background call is open or the run progressed since
// the spawn, bounded by FREE_EXIT_CAP. Whole tasks run on lib/s-path-fixture.mjs (fake driver,
// real server and daemon); exits that fixture cannot reach are serviced directly on a hand-built
// task.
//
//   node --test teams/scripts/test-harness-s-path.mjs

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runFixture, readLedger, readTaskJson } from './lib/s-path-fixture.mjs';
import { openHarnessRun, ownWritesPath, serviceHarnessRun, spawnHarnessDriver } from '../mcp/taskmanager-harness.mjs';
import { countedDriverRestarts, driverAlive } from '../mcp/taskstate.mjs';
import { sweepDeadDaemons, taskState } from '../mcp/taskmanager-drivers.mjs';
import { cleanTask, ensureWorktree, worktreeGoneStop } from '../mcp/taskmanager-worktree.mjs';

const SERVER = join(dirname(fileURLToPath(import.meta.url)), '..', 'mcp', 'server.mjs');

const base = realpathSync(mkdtempSync(join(tmpdir(), 's-path-fx-unit-')));
const root = join(base, 'tasks');
mkdirSync(root);
const pidfile = join(base, 'fixture-pids.txt');
process.env.S_PATH_FX_PIDFILE = pidfile; // only the bench uses the fixture's default pidfile
process.env.HARNESS_TASKS_DIR = root;
process.env.HARNESS_CHILD_DRIVER = 'node -e 0'; // nothing here may ever spawn a real driver
process.env.TEAMS_RUNS_DIR = 'off';

after(() => {
  let pids = [];
  try { pids = readFileSync(pidfile, 'utf8').split('\n').map(Number).filter(Number.isInteger); } catch { /* no fixture ran */ }
  const alive = pids.filter((pid) => driverAlive({ pid }));
  for (const pid of alive) { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } }
  rmSync(base, { recursive: true, force: true });
  assert.deepEqual(alive, [], 'a fixture process outlived its test');
});

const countOf = (ledger, event) => ledger.filter((e) => e.event === event).length;
const gatesOf = (tasksDir, taskId) => readLedger(tasksDir, taskId).filter((e) => e.event === 'harness_gate');
const gatesIn = (r) => r.ledger.filter((e) => e.event === 'harness_gate');
const fields = ({ ts, event, task_id, ...rest }) => rest;

// The tm server over stdio, with none of the caller's own teams/harness variables.
async function startClient(tasksDir, extra = {}) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(TEAMS|HARNESS)_/.test(k)));
  Object.assign(env, {
    HARNESS_TASKS_DIR: tasksDir, HARNESS_CHILD_DRIVER: 'node -e 0', TEAMS_RUNS_DIR: 'off',
    HARNESS_TEST_RUNNER_PID: String(process.pid), ...extra,
  });
  const proc = spawn('node', [SERVER], { stdio: ['pipe', 'pipe', 'inherit'], env });
  const waiting = new Map();
  let buf = '';
  proc.stdout.setEncoding('utf8');
  proc.stdout.on('data', (chunk) => {
    buf += chunk;
    for (let nl = buf.indexOf('\n'); nl >= 0; nl = buf.indexOf('\n')) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (line.trim()) { const m = JSON.parse(line); waiting.get(m.id)?.(m); }
    }
  });
  let id = 0;
  const send = (method, params) => new Promise((resolve, reject) => {
    const n = ++id;
    const timer = setTimeout(() => reject(new Error(`no reply to ${method}`)), 30 * 1000);
    waiting.set(n, (m) => { clearTimeout(timer); resolve(m); });
    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: n, method, params }) + '\n');
  });
  await send('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 's-path-test', version: '1' } });
  return {
    async call(name, args) {
      const res = (await send('tools/call', { name, arguments: args })).result;
      assert.ok(res && !res.isError, `${name}: ${res?.content?.[0]?.text}`);
      return res.structuredContent;
    },
    close() { proc.stdin.end(); proc.kill(); },
  };
}

// tm_next and tm_status, three times each, on a task that has ended.
async function pollEnded(tasksDir, taskId) {
  const tm = await startClient(tasksDir, { HARNESS_TEST_NO_LEADER: '1' });
  try {
    for (let i = 0; i < 3; i++) {
      for (const name of ['tm_next', 'tm_status']) await tm.call(name, { task_id: taskId });
    }
  } finally {
    tm.close();
  }
}

// ---------- whole tasks on the fixture ----------

// A stated limit, not fixed in these files (F1), so only the driver_restarts 0 fixture is held for
// a second: a driver that exits before tm_open's last step reads the task blocked there
// (harnessState knows no free exit), so no daemon is raised and nothing services the run. The
// bench runs unheld.
const HOLD_DRIVER = "if(process.argv[1]?.endsWith('fake-driver.mjs'))Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,1000)";
const FIXTURE_ENV = { NODE_OPTIONS: `--import=data:text/javascript,${encodeURIComponent(HOLD_DRIVER)}` };

const memo = new Map();
// One task per (route, pattern, restarts), shared by the tests that read it.
function fixture(route, pattern, driverRestarts = 1) {
  const key = `${route}/${pattern}/${driverRestarts}`;
  if (!memo.has(key)) {
    memo.set(key, (async () => {
      let seen = null;
      const outcome = await runFixture({
        route, pattern, driverRestarts, env: driverRestarts === 0 ? FIXTURE_ENV : {},
        // atEnd is the ledger as the daemon left it; ledger is the same after three tm_next and tm_status.
        inspect: async (ctx) => {
          const atEnd = readLedger(ctx.root, ctx.taskId);
          await pollEnded(ctx.root, ctx.taskId);
          seen = { atEnd, ledger: readLedger(ctx.root, ctx.taskId), task: readTaskJson(ctx.root, ctx.taskId) };
        },
      });
      return { ...outcome, ...seen };
    })());
  }
  return memo.get(key);
}

const FINISHING = [['graph', 1], ['fallback-copy', 1], ['fallback-files', 1], ['graph', 0]];
const DYING = ['crash', 'idle0', 'churn0', 'creep0'];

test('S free-exit: F4-AC-5 a code-0 exit with a background call open spends no restart (graph, graph-r0)', async () => {
  for (const restarts of [1, 0]) {
    const r = await fixture('graph', 'bg-exit', restarts);
    assert.equal(r.restarts_counted, 0, `restarts ${restarts}`);
    assert.equal(countOf(r.ledger, 'harness_driver_exhausted'), 0);
    const free = r.ledger.filter((e) => e.event === 'harness_driver_exit_free');
    assert.equal(free.length, 1);
    assert.equal(free[0].exit.code, 0);
    assert.equal(free[0].why, 'background_open');
    assert.equal(free[0].done_count, 1);
    assert.equal(free[0].free_exits, 1);
    assert.equal(r.task.harness_run.free_exits.length, 1);
    assert.equal(countOf(r.ledger, 'child_driver_restarted'), 1);
  }
});

test('S free-exit: F4-AC-6 the resumed run ends complete or partial on every route, never blocked', async () => {
  for (const [route, restarts] of FINISHING) {
    const r = await fixture(route, 'bg-exit', restarts);
    assert.ok(['complete', 'partial'].includes(r.outcome), `${route} r${restarts}: ${r.outcome}`);
    assert.equal(r.restarts_counted, 0);
  }
});

test('S free-exit: F4-AC-7 crash, idle0, churn0 and creep0 end blocked with harness_driver_exhausted: no unbounded chain', async () => {
  const expected = { crash: 0, idle0: 0, churn0: 1, creep0: 3 };
  for (const pattern of DYING) {
    const r = await fixture('graph', pattern, 1);
    assert.equal(r.outcome, 'blocked', pattern);
    assert.equal(countOf(r.ledger, 'harness_driver_exhausted'), 1, pattern);
    // churn0's first exit has also marked the plan done since its spawn: one free exit, no more.
    assert.equal(r.free_exits, expected[pattern], pattern);
    assert.equal(r.restarts_counted, 1, pattern);
    assert.equal(countOf(r.ledger, 'child_driver_restarted'), expected[pattern] + 1, pattern);
  }
});

// ---------- exits serviced directly ----------

const deadPid = () => spawnSync('node', ['-e', '0']).pid;
let seq = 0;

function unitTask({ dead = true, ...extra } = {}) {
  const run_id = `unit-${++seq}`;
  const cwd = join(base, run_id);
  mkdirSync(cwd);
  mkdirSync(join(root, run_id));
  return {
    run_id, cwd, request: 'small request', size: 'S', flow: 'auto', nodes: [], goal_threshold: 90, driver_restarts: 0,
    harness_run: {
      cwd, opened_at: Date.now(), route: null, run: null,
      pointer: join(root, run_id, 'harness-run.json'), report_path: join(root, run_id, 'harness-report.md'),
      ...(dead ? { driver: { pid: deadPid(), started_at: Date.now() } } : {}),
    },
    ...extra,
  };
}

function graphRun(task, nodes) {
  const dir = join(task.cwd, '.harness-run', 'broker', 'runs');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'g1.json'), JSON.stringify({ run_id: 'g1', request: `[teams-task ${task.run_id}] x`, created_at: Date.now(), nodes }));
}

const node = (node_id, stage, state, deps = [], result = null) => ({ node_id, stage, state, deps, result });

// This process spawns the driver and then services it without ever yielding, so the driver is a
// zombie whose exit listener cannot have written its exit file.
function spawnAndDie(task, code) {
  process.env.HARNESS_CHILD_DRIVER = `node -e process.exit(${code})`;
  try {
    task.harness_run.driver = spawnHarnessDriver(task);
  } finally {
    process.env.HARNESS_CHILD_DRIVER = 'node -e 0';
  }
  const { pid, exit } = task.harness_run.driver;
  const end = Date.now() + 30 * 1000;
  while (driverAlive({ pid }) && Date.now() < end) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
  assert.equal(driverAlive({ pid }), false);
  assert.equal(existsSync(exit), false, 'the exit listener has not run');
  return pid;
}

test('S free-exit: F4-AC-5 a progressed code-0 exit of a driver this process spawned is free with restarts spent, 20 of 20', () => {
  for (let i = 0; i < 20; i++) {
    const task = unitTask({ dead: false, driver_restarts: i % 2 });
    const pid = spawnAndDie(task, 0); // spawned before the run exists: progress_at_spawn 0
    if (i % 2) task.harness_run.driver.restarts = [{ pid: 1, at: Date.now() }];
    graphRun(task, [node('plan', 'plan', 'done', [], {}), node('implement:1', 'implement', 'pending', ['plan'])]);
    serviceHarnessRun(task);
    const ledger = readLedger(root, task.run_id);
    assert.equal(countOf(ledger, 'harness_driver_exhausted'), 0, `iteration ${i}`);
    const [free] = ledger.filter((e) => e.event === 'harness_driver_exit_free');
    assert.equal(free?.pid, pid, `iteration ${i}`);
    assert.deepEqual(free.exit, { code: 0, signal: null });
    assert.notEqual(task.harness_run.driver.pid, pid, `iteration ${i}: respawned in the same call`);
  }
});

test('S free-exit: F4-AC-7 a non-zero exit read before its exit file counts, with its code', () => {
  const spent = unitTask({ dead: false });
  spawnAndDie(spent, 3);
  graphRun(spent, [node('plan', 'plan', 'done', [], {})]);
  serviceHarnessRun(spent);
  assert.equal(countOf(readLedger(root, spent.run_id), 'harness_driver_exhausted'), 1);
  assert.equal(countOf(readLedger(root, spent.run_id), 'harness_driver_exit_free'), 0);

  const left = unitTask({ dead: false, driver_restarts: 1 });
  spawnAndDie(left, 3);
  graphRun(left, [node('plan', 'plan', 'done', [], {})]);
  serviceHarnessRun(left);
  assert.equal(left.harness_run.driver.restarts[0].exit.code, 3);
});

test('S free-exit: F4-AC-5 a background call that already has its tool_result is not open, and counts', () => {
  const task = unitTask();
  const log = join(root, task.run_id, 'S.stream.jsonl');
  const exit = join(root, task.run_id, 'S.exit.json');
  writeFileSync(log, [
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { run_in_background: true } }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'done' }] } },
    { type: 'result', result: 'ok' },
  ].map((e) => JSON.stringify(e)).join('\n') + '\n');
  writeFileSync(exit, JSON.stringify({ code: 0 }) + '\n');
  Object.assign(task.harness_run.driver, { log, exit, progress_at_spawn: 0 });
  serviceHarnessRun(task);
  assert.equal(countOf(readLedger(root, task.run_id), 'harness_driver_exhausted'), 1);
  assert.equal(countOf(readLedger(root, task.run_id), 'harness_driver_exit_free'), 0);
});

// ---------- one harness_gate per end (card 178 Task 4, F4-AC-9..13) ----------

test('S gate: F4-AC-9 an accepted finish writes accept, match_pct and gaps (graph, fallback files)', async () => {
  for (const [route, source] of [['graph', 'graph'], ['fallback-files', 'fallback']]) {
    const [gate] = gatesIn(await fixture(route, 'bg-exit', 1));
    assert.equal(gate.accept, true, route);
    assert.equal(gate.match_pct, 95);
    assert.ok(Array.isArray(gate.gaps));
    assert.equal(gate.source, source);
  }
});

test('S gate: F4-AC-10 a report-copy finish writes the report\'s accept with match_pct null', async () => {
  const [gate] = gatesIn(await fixture('fallback-copy', 'bg-exit', 1));
  assert.deepEqual(fields(gate), { accept: false, match_pct: null, gaps: [], route: 'fallback', source: 'report_copy' });
});

test('S gate: F4-AC-11 reason driver_exhausted: an exhausted driver ends with verdict null', async () => {
  for (const pattern of DYING) {
    const [gate] = gatesIn(await fixture('graph', pattern, 1));
    assert.deepEqual(fields(gate), { verdict: null, reason: 'driver_exhausted' }, pattern);
  }
});

test('S gate: one per end after 3 polls (F4-AC-12, fixture ends)', async () => {
  for (const [route, restarts] of FINISHING) assert.equal(gatesIn(await fixture(route, 'bg-exit', restarts)).length, 1, `${route} r${restarts}`);
  for (const pattern of DYING) assert.equal(gatesIn(await fixture('graph', pattern, 1)).length, 1, pattern);
});

test('S gate: F4-AC-13 the gate-recorded rate over every fixture end path is N/N', async (t) => {
  const all = await Promise.all([
    ...FINISHING.map(([route, restarts]) => fixture(route, 'bg-exit', restarts)),
    ...DYING.map((pattern) => fixture('graph', pattern, 1)),
  ]);
  const recorded = all.filter((r) => gatesIn(r).length > 0).length;
  const byDaemon = all.filter((r) => r.atEnd.some((e) => e.event === 'harness_gate')).length;
  t.diagnostic(`gate recorded ${recorded}/${all.length}; before any tm poll ${byDaemon}/${all.length}`);
  assert.equal(recorded, all.length);
});

function fallbackRun(task, files) {
  const dir = join(task.cwd, '.harness-run', 'small');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ teams_task: task.run_id }));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
}

const persist = (task) => writeFileSync(join(root, task.run_id, 'task.json'), JSON.stringify(task));

// Services the task repeatedly, then polls it over tm_next / tm_status; returns its one gate.
async function oneGate(task) {
  for (let i = 0; i < 3; i++) serviceHarnessRun(task);
  persist(task);
  await pollEnded(root, task.run_id);
  const gates = gatesOf(root, task.run_id);
  assert.equal(gates.length, 1, JSON.stringify(gates));
  return fields(gates[0]);
}

test('S gate: F4-AC-9 a refused graph finish writes accept false with its match_pct and gaps', async () => {
  const task = unitTask();
  graphRun(task, [
    node('gate:goal:1', 'gate', 'done', [], { accept: false, match_pct: 40, gaps: ['not met'] }),
    node('report', 'report', 'done', ['gate:goal:1'], { handoff: 'r' }),
  ]);
  assert.deepEqual(await oneGate(task), { accept: false, match_pct: 40, gaps: ['not met'], route: 'graph', source: 'graph' });
});

test('S gate: F4-AC-9 a refused fallback finish writes accept false from 04-goal-gate.json', async () => {
  const task = unitTask();
  fallbackRun(task, { '04-goal-gate.json': JSON.stringify({ pass: false, match_pct: 30, reason: 'short' }), '05-report.md': '# r\n' });
  assert.deepEqual(await oneGate(task), { accept: false, match_pct: 30, gaps: ['short'], route: 'fallback', source: 'fallback' });
});

const failedReport = () => [
  node('plan', 'plan', 'done', [], {}),
  node('report', 'report', 'failed', ['plan'], { reason: 'verification failed' }),
];

test('S gate: F4-AC-11 reason run_stuck: a failed report node ends with verdict null, once', async () => {
  const task = unitTask({ driver_restarts: 2 });
  graphRun(task, failedReport());
  assert.deepEqual(await oneGate(task), { verdict: null, reason: 'run_stuck' });
  assert.ok(task.harness_run.stuck);
});

test('S gate: a new driver that ends the same way records a second end (tm_retry, per end not per task)', () => {
  const task = unitTask();
  graphRun(task, failedReport());
  serviceHarnessRun(task);
  delete task.harness_run.stuck; // what tm_retry does before it spawns
  task.harness_run.driver = { pid: deadPid(), started_at: Date.now() };
  serviceHarnessRun(task);
  serviceHarnessRun(task);
  assert.equal(gatesOf(root, task.run_id).length, 2);
});

test('S gate: F4-AC-11 reason budget_stopped: the kill is the end, dead driver or not, once', async () => {
  const alive = unitTask({ budget_stopped: { harness_killed: true, spend: 1 } });
  alive.harness_run.driver = { pid: process.pid };
  serviceHarnessRun(alive);
  serviceHarnessRun(alive);
  assert.equal(gatesOf(root, alive.run_id).length, 1, 'written while the killed driver is still alive');

  const stoppedOnly = unitTask({ budget_stopped: { spend: 1 } });
  stoppedOnly.harness_run.driver = { pid: process.pid };
  serviceHarnessRun(stoppedOnly);
  assert.equal(gatesOf(root, stoppedOnly.run_id).length, 0, 'a stop without the kill is no end');

  const task = unitTask({ budget_stopped: { harness_killed: true, spend: 1, budget_usd: 1 } });
  assert.deepEqual(await oneGate(task), { verdict: null, reason: 'budget_stopped' });
});

test('S gate: F4-AC-11 reason worktree_gone: the gone-directory stop ends with verdict null, once', async () => {
  const task = unitTask();
  rmSync(task.cwd, { recursive: true });
  worktreeGoneStop(task);
  worktreeGoneStop(task);
  assert.deepEqual(await oneGate(task), { verdict: null, reason: 'worktree_gone' });
});

test('S gate: F4-AC-11 reason cancelled: written at tm_clean, not by a dry run or a second clean', async () => {
  const task = unitTask({ cancelled: { at: Date.now() } });
  serviceHarnessRun(task);
  cleanTask(task, true);
  assert.equal(gatesOf(root, task.run_id).length, 0);
  assert.equal(countOf(readLedger(root, task.run_id), 'harness_driver_exit_free'), 0);
  cleanTask(task, false);
  delete task.harness_run.gate; // tm_clean saves no task state: the ledger is the dedupe
  cleanTask(task, false);
  assert.deepEqual(await oneGate(task), { verdict: null, reason: 'cancelled' });
});

test('S gate: a finished run cleaned after tm_cancel keeps its verdict as its one gate', () => {
  const task = unitTask();
  fallbackRun(task, { '04-goal-gate.json': JSON.stringify({ pass: true, match_pct: 95 }), '05-report.md': '# r\n' });
  serviceHarnessRun(task);
  task.cancelled = { at: Date.now() };
  cleanTask(task, false);
  const gates = gatesOf(root, task.run_id);
  assert.equal(gates.length, 1);
  assert.equal(gates[0].accept, true);
});

// tm_open and then nothing: no tm_status, no tm_next. The driver reports a spend and hangs; the
// daemon's own tick trips the timebox and kills it.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function daemonBudgetKill(ignoreSigterm) {
  const dir = mkdtempSync(join(base, 'daemon-'));
  const tasksDir = join(dir, 'tasks');
  const cwd = join(dir, 'work');
  mkdirSync(tasksDir);
  mkdirSync(cwd);
  const script = join(dir, 'hang-driver.mjs');
  writeFileSync(script, `${ignoreSigterm ? "process.on('SIGTERM', () => {});\n" : ''}setTimeout(() => {}, 120000);\n`);
  const tm = await startClient(tasksDir, { HARNESS_CHILD_DRIVER: `node ${script}`, CLAUDECODE: '1', HARNESS_DAEMON_POLL_MS: '250' });
  let taskId = null;
  const pids = () => readLedger(tasksDir, taskId).filter((e) => /^(child_driver|daemon)_(spawned|restarted)$/.test(e.event)).map((e) => e.pid);
  const until = async (pred) => {
    for (const end = Date.now() + 60 * 1000; Date.now() < end; await sleep(100)) if (pred(readLedger(tasksDir, taskId))) return true;
    return false;
  };
  try {
    taskId = (await tm.call('tm_open', {
      request: 'small request', cwd, vendor: 'self', size: 'S', roles: { qa: false }, brainstorm: false,
      timebox_minutes: 0.03, budget_grace_minutes: 0,
    })).task_id;
    tm.close();
    assert.ok(await until((l) => countOf(l, 'harness_gate') > 0), 'no gate from the daemon alone');
    const driverPid = readTaskJson(tasksDir, taskId).harness_run.driver.pid;
    const aliveAtGate = driverAlive({ pid: driverPid });
    if (ignoreSigterm) process.kill(driverPid, 'SIGKILL');
    assert.ok(await until((l) => countOf(l, 'daemon_done') > 0), 'no daemon_done');
    return { ledger: readLedger(tasksDir, taskId), aliveAtGate };
  } finally {
    tm.close();
    for (const pid of taskId ? pids() : []) { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } }
  }
}

test('S gate: F4-AC-11 F4-AC-13 a budget kill in the daemon alone writes its one gate before daemon_done', async () => {
  for (const ignoreSigterm of [true, false]) {
    const { ledger, aliveAtGate } = await daemonBudgetKill(ignoreSigterm);
    const at = (event) => ledger.findIndex((e) => e.event === event);
    assert.equal(countOf(ledger, 'harness_gate'), 1);
    assert.deepEqual(fields(ledger[at('harness_gate')]), { verdict: null, reason: 'budget_stopped' });
    assert.ok(at('budget_killed') < at('harness_gate') && at('harness_gate') < at('daemon_done'));
    assert.equal(ledger[at('daemon_done')].state, 'partial');
    if (ignoreSigterm) assert.equal(aliveAtGate, true, 'the gate did not wait for the driver to die');
  }
});

// ---------- the run in its own worktree (F4-US-4) ----------

const gitIn = (cwd, ...a) => spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'core.hooksPath=/dev/null', ...a], { cwd, encoding: 'utf8' });

// A task on a real checkout (main, one commit), opened with no driver; or on a plain directory.
function openedTask({ git = true, commit = true } = {}) {
  const run_id = `wt${++seq}-aaaaaaaa`;
  const cwd = join(base, `repo-${run_id}`);
  mkdirSync(cwd);
  mkdirSync(join(root, run_id));
  if (git) {
    gitIn(cwd, 'init', '-q', '-b', 'main');
    writeFileSync(join(cwd, 'a.txt'), 'x\n');
    if (commit) { gitIn(cwd, 'add', '-A'); gitIn(cwd, 'commit', '-qm', 'init'); }
  }
  const task = { run_id, cwd, request: 'small request', size: 'S', flow: 'auto', nodes: [], goal_threshold: 90, driver_restarts: 0 };
  process.env.HARNESS_TEST_NO_DRIVER = '1';
  try { openHarnessRun(task); } finally { delete process.env.HARNESS_TEST_NO_DRIVER; }
  return task;
}

test('S worktree: F4-AC-14 open makes the tree; cwd, writes path, baseline, marker and harness_open follow it', () => {
  const task = openedTask();
  const h = task.harness_run;
  const tree = join(root, task.run_id, 'worktrees', 'S');
  assert.equal(h.cwd, tree);
  assert.ok(existsSync(join(tree, '.git')));
  assert.deepEqual([h.main_cwd, h.branch, h.merge_target], [task.cwd, `harness/${task.run_id.slice(0, 8)}/S`, 'main']);
  assert.equal(h.writes_path, ownWritesPath(tree, task.run_id));
  assert.ok(existsSync(h.baseline_path));
  assert.ok(existsSync(join(tree, '.claude', '.harness-markers')), 'the marker is in the tree');
  assert.equal(existsSync(join(task.cwd, '.claude', '.harness-markers')), false, 'and not in the main checkout');
  const [open] = readLedger(root, task.run_id).filter((e) => e.event === 'harness_open');
  assert.deepEqual(fields(open), { cwd: tree, main_cwd: task.cwd, branch: h.branch, merge_target: 'main' });
  assert.equal(gitIn(task.cwd, 'status', '--porcelain').stdout, '', 'main is untouched');
});

test('S worktree: F4-AC-15 the driver runs in the tree, its prompt names it, the wiki stays in task.cwd', async () => {
  const task = openedTask();
  const out = join(base, `drv-${task.run_id}.json`);
  const script = join(base, `drv-${task.run_id}.mjs`);
  writeFileSync(script, `import{writeFileSync}from'node:fs';writeFileSync(${JSON.stringify(out)},JSON.stringify({cwd:process.cwd(),prompt:process.argv.at(-1),env:{w:process.env.TEAMS_OWN_WRITES,k:process.env.TEAMS_WIKI_ROOT}}))\n`);
  process.env.HARNESS_CHILD_DRIVER = `node ${script}`;
  try { task.harness_run.driver = spawnHarnessDriver(task); } finally { process.env.HARNESS_CHILD_DRIVER = 'node -e 0'; }
  for (const end = Date.now() + 30 * 1000; Date.now() < end && !existsSync(out); await new Promise((r) => setTimeout(r, 50)));
  const seen = JSON.parse(readFileSync(out, 'utf8'));
  const h = task.harness_run;
  assert.equal(realpathSync(seen.cwd), realpathSync(h.cwd));
  assert.ok(seen.prompt.includes(`in cwd ${h.cwd}`) && seen.prompt.includes(`cwd: "${h.cwd}"`) && seen.prompt.includes(`"cwd":"${h.cwd}"`) && !seen.prompt.includes(task.cwd), 'the prompt names the tree only');
  assert.deepEqual(seen.env, { w: ownWritesPath(h.cwd, task.run_id), k: task.cwd });
});

test('S worktree: F4-AC-16 the main checkout is identical at every sample while the fixture run finishes in the tree', async () => {
  let tree = null;
  const r = await runFixture({
    route: 'graph', pattern: 'bg-exit',
    inspect: async (ctx) => { const h = readTaskJson(ctx.root, ctx.taskId).harness_run; tree = { change: existsSync(join(h.cwd, 'change.txt')), main: existsSync(join(ctx.cwd, 'change.txt')) }; },
  });
  assert.equal(r.outcome, 'complete');
  assert.equal(r.worktree, 'yes');
  assert.ok(r.main_samples >= 3, `${r.main_samples} samples`);
  assert.equal(r.main_samples_identical, true, JSON.stringify(r.first_diff));
  assert.equal(r.merge, 'ok');
  assert.deepEqual([tree.change, tree.main], [true, true], 'the run changed the tree; main has the file only through the merge, after identical samples');
});

test('S worktree: F4-AC-17 a deleted tree reads gone and is not re-created', () => {
  const task = openedTask();
  const tree = task.harness_run.cwd;
  rmSync(tree, { recursive: true });
  gitIn(task.cwd, 'worktree', 'prune');
  const stop = worktreeGoneStop(task);
  assert.deepEqual([stop.kind, stop.path], ['run', tree]);
  assert.match(stop.reason, /run worktree .* is gone/);
  assert.equal(ensureWorktree(task, 'S').gone, true);
  assert.equal(existsSync(tree), false, 'nothing re-created it');
  assert.deepEqual(gatesOf(root, task.run_id).map(fields), [{ verdict: null, reason: 'worktree_gone' }]);
});

test('S worktree: D5 a plain directory, or a checkout the tree cannot be made from, runs in task.cwd with the reason on the ledger', () => {
  for (const opts of [{ git: false }, { commit: false }]) {
    const task = openedTask(opts);
    const h = task.harness_run;
    assert.equal(h.cwd, task.cwd);
    assert.equal('main_cwd' in h, false);
    const ledger = readLedger(root, task.run_id);
    const skipped = ledger.filter((e) => e.event === 'harness_worktree_skipped');
    assert.equal(skipped.length, 1);
    assert.ok(typeof skipped[0].reason === 'string' && skipped[0].reason.length > 0);
    assert.equal(fields(ledger.find((e) => e.event === 'harness_open')).cwd, task.cwd);
    assert.equal(worktreeGoneStop(task), null, 'task.cwd is there: not gone');
  }
});

// ---------- merge back on a pass, park otherwise (F4-US-5) ----------

const mergesOf = (task) => readLedger(root, task.run_id).filter((e) => e.event === 'harness_merge');
const headOf = (cwd) => gitIn(cwd, 'rev-parse', 'HEAD').stdout.trim();
const statusOf = (cwd) => gitIn(cwd, 'status', '--porcelain').stdout;

// A task whose tree holds uncommitted work and a finished fallback run (pass or refused goal gate).
function mergeTask({ pass = true, files = { 'new.txt': 'n\n' } } = {}) {
  const task = openedTask();
  gitIn(task.cwd, 'config', 'user.email', 't@t');
  gitIn(task.cwd, 'config', 'user.name', 't');
  const tree = task.harness_run.cwd;
  for (const [name, text] of Object.entries(files)) writeFileSync(join(tree, name), text);
  const dir = join(tree, '.harness-run', 'small');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ teams_task: task.run_id }));
  writeFileSync(join(dir, '04-goal-gate.json'), JSON.stringify({ pass, match_pct: pass ? 95 : 30 }));
  writeFileSync(join(dir, '05-report.md'), '# r\n');
  return task;
}

const commitMain = (task, name, text) => { writeFileSync(join(task.cwd, name), text); gitIn(task.cwd, 'add', '-A'); gitIn(task.cwd, 'commit', '-qm', `main ${name}`); };
const parkedWith = (task, reason) => {
  const h = task.harness_run;
  assert.equal(h.merge.ok, false);
  assert.match(h.merge.reason, reason);
  assert.ok(task.hold && task.hold.by === 'engine' && task.hold.reason.startsWith('merge_parked: '), JSON.stringify(task.hold));
  const [m] = mergesOf(task);
  assert.equal(mergesOf(task).length, 1);
  assert.equal(m.ok, false);
  assert.ok(Array.isArray(m.conflicts));
  assert.ok(existsSync(join(h.cwd, '.git')), 'the tree is kept');
  assert.equal(gitIn(task.cwd, 'rev-parse', '--verify', '--quiet', `refs/heads/${h.branch}`).status, 0, 'the branch is kept');
  return m;
};

test('S merge: a passing finish commits the tree, merges --no-ff once and mirrors it in h.merge', () => {
  const task = mergeTask();
  const h = task.harness_run;
  const before = headOf(task.cwd);
  for (let i = 0; i < 3; i++) serviceHarnessRun(task);
  const [m] = mergesOf(task);
  assert.equal(mergesOf(task).length, 1, 'repeated services do not merge again');
  assert.deepEqual([m.ok, m.into, m.branch, m.driver_alive], [true, 'main', h.branch, false]);
  assert.equal(m.commit, headOf(task.cwd));
  assert.deepEqual(h.merge && [h.merge.ok, h.merge.commit], [true, m.commit]);
  assert.equal(gitIn(task.cwd, 'rev-parse', 'HEAD^1').stdout.trim(), before, 'a merge commit on top of the old head');
  assert.equal(gitIn(task.cwd, 'rev-list', '--parents', '-n1', 'HEAD').stdout.trim().split(' ').length, 3);
  assert.equal(readFileSync(join(task.cwd, 'new.txt'), 'utf8'), 'n\n');
  assert.equal(existsSync(join(task.cwd, '.harness-run')), false, '.harness-run/ is not delivered');
  assert.equal(gitIn(task.cwd, 'ls-files', '.harness-run').stdout, '');
  assert.equal(task.hold, undefined);
  assert.equal(statusOf(task.cwd), '');
});

test('S merge: a moved tip merges 3-way', () => {
  const task = mergeTask();
  commitMain(task, 'other.txt', 'o\n');
  const tip = headOf(task.cwd);
  serviceHarnessRun(task);
  assert.equal(mergesOf(task)[0].ok, true);
  assert.equal(gitIn(task.cwd, 'rev-parse', 'HEAD^1').stdout.trim(), tip);
  assert.ok(existsSync(join(task.cwd, 'other.txt')) && existsSync(join(task.cwd, 'new.txt')));
});

test('S merge: a conflict parks, aborts the merge and leaves main as it was', () => {
  const task = mergeTask({ files: { 'a.txt': 'tree\n' } });
  commitMain(task, 'a.txt', 'main\n');
  const tip = headOf(task.cwd);
  serviceHarnessRun(task);
  const m = parkedWith(task, /./);
  assert.deepEqual(m.conflicts, ['a.txt']);
  assert.equal(headOf(task.cwd), tip);
  assert.equal(statusOf(task.cwd), '');
  assert.equal(readFileSync(join(task.cwd, 'a.txt'), 'utf8'), 'main\n');
  serviceHarnessRun(task);
  assert.equal(mergesOf(task).length, 1, 'a park is not retried');
});

test('S merge: a dirty file the merge would overwrite is refused, parked and left untouched', () => {
  const task = mergeTask({ files: { 'a.txt': 'tree\n' } });
  writeFileSync(join(task.cwd, 'a.txt'), 'my work\n');
  const tip = headOf(task.cwd);
  serviceHarnessRun(task);
  parkedWith(task, /./);
  assert.equal(readFileSync(join(task.cwd, 'a.txt'), 'utf8'), 'my work\n');
  assert.equal(headOf(task.cwd), tip);
  assert.equal(statusOf(task.cwd), ' M a.txt\n');
});

test('S merge: a dirty main the merge does not touch still merges, the dirty file untouched', () => {
  const task = mergeTask();
  writeFileSync(join(task.cwd, 'a.txt'), 'my work\n');
  writeFileSync(join(task.cwd, 'scratch.txt'), 's\n');
  serviceHarnessRun(task);
  assert.equal(mergesOf(task)[0].ok, true);
  assert.equal(task.hold, undefined);
  assert.equal(readFileSync(join(task.cwd, 'a.txt'), 'utf8'), 'my work\n');
  assert.equal(statusOf(task.cwd), ' M a.txt\n?? scratch.txt\n', 'main shows only what it showed before');
  assert.ok(existsSync(join(task.cwd, 'new.txt')));
});

test('S merge: staged changes in main park the merge instead of riding into its commit', () => {
  const task = mergeTask();
  writeFileSync(join(task.cwd, 'staged.txt'), 's\n');
  gitIn(task.cwd, 'add', 'staged.txt');
  const tip = headOf(task.cwd);
  serviceHarnessRun(task);
  parkedWith(task, /staged/);
  assert.equal(headOf(task.cwd), tip);
  assert.equal(statusOf(task.cwd), 'A  staged.txt\n');
});

test('S merge: a detached HEAD or another branch in task.cwd parks, nothing is checked out or merged', () => {
  for (const mode of ['detached', 'other']) {
    const task = mergeTask();
    if (mode === 'detached') gitIn(task.cwd, 'checkout', '-q', '--detach');
    else gitIn(task.cwd, 'checkout', '-q', '-b', 'other');
    const tip = headOf(task.cwd);
    serviceHarnessRun(task);
    parkedWith(task, /branch|detached|HEAD/i);
    assert.equal(headOf(task.cwd), tip, mode);
    assert.equal(existsSync(join(task.cwd, 'new.txt')), false, mode);
  }
});

test('S merge: a refused goal gate does not merge and keeps the tree', () => {
  const task = mergeTask({ pass: false });
  const tip = headOf(task.cwd);
  for (let i = 0; i < 3; i++) serviceHarnessRun(task);
  assert.equal(mergesOf(task).length, 0);
  assert.equal(task.harness_run.merge, undefined);
  assert.equal(task.hold, undefined);
  assert.ok(existsSync(join(task.harness_run.cwd, 'new.txt')));
  assert.equal(headOf(task.cwd), tip);
  assert.equal(statusOf(task.cwd), '');
});

test('S merge: a failing repo hook parks once, never loops, and --no-verify is never passed', () => {
  for (const hook of ['pre-commit', 'pre-merge-commit']) {
    const task = mergeTask();
    const hooks = join(task.cwd, '.git', 'hooks');
    mkdirSync(hooks, { recursive: true });
    writeFileSync(join(hooks, hook), '#!/bin/sh\necho refused >&2\nexit 1\n', { mode: 0o755 });
    // pre-merge-commit only runs when main has moved (a true merge); pre-commit runs in the tree.
    if (hook === 'pre-merge-commit') commitMain(task, 'other.txt', 'o\n');
    const tip = headOf(task.cwd);
    for (let i = 0; i < 3; i++) serviceHarnessRun(task);
    parkedWith(task, /./);
    assert.equal(headOf(task.cwd), tip, hook);
    assert.equal(statusOf(task.cwd), '', hook);
  }
  for (const f of ['taskmanager-harness.mjs', 'taskmanager-worktree.mjs']) {
    assert.equal(readFileSync(join(dirname(SERVER), f), 'utf8').includes('--no-verify'), false, f);
  }
});

test('S merge: tm_clean after a merge removes the tree and the branch; a second clean is a no-op', () => {
  const task = mergeTask();
  serviceHarnessRun(task);
  const h = task.harness_run;
  const dry = cleanTask(task, true);
  assert.equal(dry.removed_worktrees.length, 1);
  assert.ok(existsSync(join(h.cwd, '.git')), 'a dry run removes nothing');
  const out = cleanTask(task, false);
  assert.deepEqual(out.removed_worktrees.map((x) => x.package_id), ['S']);
  assert.deepEqual(out.removed_branches.map((x) => x.package_id), ['S']);
  assert.equal(existsSync(h.cwd), false);
  assert.equal(gitIn(task.cwd, 'rev-parse', '--verify', '--quiet', `refs/heads/${h.branch}`).status, 1);
  assert.equal(mergesOf(task).length, 1);
  cleanTask(task, false);
  assert.equal(mergesOf(task).length, 1);
  assert.equal(existsSync(join(task.cwd, 'new.txt')), true, 'the work is in main');
});

test('S merge: tm_clean after a park removes the tree but keeps the branch with the work committed', () => {
  const task = mergeTask({ files: { 'a.txt': 'tree\n' } });
  commitMain(task, 'a.txt', 'main\n');
  serviceHarnessRun(task);
  const h = task.harness_run;
  const tip = headOf(task.cwd);
  writeFileSync(join(h.cwd, 'late.txt'), 'l\n');
  const out = cleanTask(task, false);
  assert.equal(existsSync(h.cwd), false);
  assert.deepEqual(out.kept_branches.map((x) => x.package_id), ['S']);
  assert.equal(mergesOf(task).length, 1, 'clean does not retry a parked merge');
  assert.equal(headOf(task.cwd), tip);
  assert.equal(gitIn(task.cwd, 'show', `${h.branch}:late.txt`).stdout, 'l\n', 'unsaved tree work was committed to the branch');
});

test('S merge: tm_clean merges a passing finish no service call merged, then removes the tree', () => {
  const task = mergeTask();
  const h = task.harness_run;
  // A service call has seen the finish (finished_at); a daemon-only window left the merge undone.
  h.finished_at = Date.now();
  h.accepted = true;
  cleanTask(task, false);
  assert.equal(mergesOf(task).length, 1);
  assert.equal(mergesOf(task)[0].ok, true);
  assert.equal(existsSync(join(task.cwd, 'new.txt')), true);
  assert.equal(existsSync(h.cwd), false);
});

test('S merge: main\'s log and status change only by the merge commit', () => {
  const task = mergeTask();
  const log = (...a) => gitIn(task.cwd, 'log', '--format=%H', ...a).stdout.trim().split('\n');
  const before = log();
  serviceHarnessRun(task);
  assert.equal(log().length, before.length + 2, 'the merge commit and the one commit of the tree work');
  const after = log('--first-parent');
  assert.deepEqual(after.slice(1), before, 'main\'s own line gained only the merge commit');
  assert.equal(statusOf(task.cwd), '');
  assert.deepEqual(gitIn(task.cwd, 'diff', '--name-only', `${before[0]}..HEAD`).stdout.trim().split('\n'), ['new.txt']);
});

test('S merge: fixture graph pass merges once; the merge commit is task.cwd HEAD and main was identical until it', async () => {
  let seen = null;
  const r = await runFixture({
    route: 'graph', pattern: 'bg-exit',
    inspect: async (ctx) => {
      const h = readTaskJson(ctx.root, ctx.taskId).harness_run;
      seen = {
        head: gitIn(ctx.cwd, 'rev-parse', 'HEAD').stdout.trim(),
        parents: gitIn(ctx.cwd, 'rev-list', '--parents', '-n1', 'HEAD').stdout.trim().split(' ').length,
        merge: h.merge, merges: readLedger(ctx.root, ctx.taskId).filter((e) => e.event === 'harness_merge'),
        status: gitIn(ctx.cwd, 'status', '--porcelain').stdout, changed: existsSync(join(ctx.cwd, 'change.txt')),
      };
    },
  });
  assert.equal(r.outcome, 'complete');
  assert.equal(r.merge, 'ok');
  assert.equal(seen.merges.length, 1);
  assert.equal(seen.merges[0].ok, true);
  assert.equal(seen.merge.ok, true);
  assert.equal(seen.head, seen.merge.commit);
  assert.equal(seen.head, seen.merges[0].commit);
  assert.equal(seen.parents, 3, 'a merge commit');
  assert.equal(seen.status, '');
  assert.equal(seen.changed, true, 'the run\'s work arrived in main by the merge');
  assert.equal(r.main_samples_identical, true, JSON.stringify(r.first_diff));
  assert.ok(r.main_merged_at, 'a sample saw the merge commit');
});

test('S merge: the sampler still counts a main write the merge does not bring in', async () => {
  let wrote = false;
  const r = await runFixture({
    route: 'graph', pattern: 'bg-exit',
    onPoll: async (ctx) => { if (!wrote) { wrote = true; writeFileSync(join(ctx.cwd, 'stray.txt'), 'x'); } },
  });
  assert.equal(r.main_samples_identical, false, 'a write the merge does not bring in is a main write');
  assert.match(JSON.stringify(r.first_diff), /stray\.txt/);
});

// ---------- the engine resumes the S driver (card 178 Task 4, goal 3) ----------
// Session end: the MCP-start sweep (sweepDeadDaemons). Usage limit: the daemon's own tick
// (stepOnce: serviceSRun parks, autoResumeCapacity respawns). Both are the engine as it is.

const RECORD_PROMPT = "if(process.argv[1]?.endsWith('fake-driver.mjs')&&process.env.S_RESUME_PROMPTS)process.getBuiltinModule('node:fs').appendFileSync(process.env.S_RESUME_PROMPTS,JSON.stringify(process.argv.at(-1))+'\\n')";

test('S resume: session death raises the daemon and respawns the driver in h.cwd with the resume prompt, free, no tm_* call', async () => {
  const prompts = join(base, 'resume-prompts.jsonl');
  let seen = null;
  const r = await runFixture({
    route: 'graph', pattern: 'hang', sessionDeath: true,
    env: { S_RESUME_PROMPTS: prompts, NODE_OPTIONS: `--import=data:text/javascript,${encodeURIComponent(RECORD_PROMPT)}` },
    inspect: async (ctx) => {
      const task = readTaskJson(ctx.root, ctx.taskId);
      seen = { task, ledger: readLedger(ctx.root, ctx.taskId), counted: countedDriverRestarts(task, task.harness_run.driver), runs: readFileSync(join(ctx.base, 'drv', 'ran.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)) };
    },
  });
  const h = seen.task.harness_run;
  // The fixture's own session-death case calls no tm_* between the new server's start and the respawn.
  assert.equal(r.session_death.killed_pids, 2, 'daemon and driver both died with the session');
  assert.equal(r.session_death.respawned, true, 'the start sweep raised the task');
  assert.deepEqual(r.session_death.daemon_restarted_events, [{ reason: 'session_death', free: true }]);
  assert.equal(seen.runs.length >= 2 && seen.runs[1].attempt, 2);
  assert.equal(seen.runs[1].cwd, h.cwd, 'the respawned driver runs in h.cwd');
  assert.notEqual(h.cwd, h.main_cwd, 'h.cwd is the S tree, not the main checkout');
  const sent = readFileSync(prompts, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(sent.length, 2);
  assert.doesNotMatch(sent[0], /A previous driver for this task died/);
  assert.match(sent[1], /A previous driver for this task died/);
  assert.ok(sent[1].includes(h.cwd), 'the resume prompt names h.cwd');
  assert.equal(h.driver.restarts.length, 1);
  assert.ok(Number.isFinite(h.driver.restarts[0].after_wake), 'stamped as the free restart of the wake');
  assert.equal(seen.counted.length, 0, 'countedDriverRestarts does not count it');
  assert.equal(countOf(seen.ledger, 'harness_driver_exhausted'), 0);
  assert.equal(r.outcome, 'complete');
});

// A hand-built S task, persisted, with a dead driver whose stream ends in a usage-limit notice.
function limitTask() {
  const task = unitTask({ driver_restarts: 0 });
  const log = join(root, task.run_id, 'S.stream.jsonl');
  writeFileSync(log, JSON.stringify({ type: 'result', subtype: 'success', result: "You've hit your session limit" }) + '\n');
  task.harness_run.driver.log = log;
  persist(task);
  return task;
}

const NO_JUDGE = { judge: async () => { throw new Error('no judge expected'); }, answer: async () => { throw new Error('no answer expected'); } };
const THREE_HOURS = 3 * 60 * 60 * 1000;

// Moves the park three hours back: its wait (30 min first) has passed.
function ageParked(id) {
  const t = readTaskJson(root, id);
  t.harness_run.waiting_capacity.since -= THREE_HOURS;
  t.harness_run.waiting_capacity.first_since -= THREE_HOURS;
  writeFileSync(join(root, id, 'task.json'), JSON.stringify(t));
}

test('S resume: usage limit parks with no restart spent and the daemon tick respawns it after parkDueAt, no tm_retry', async () => {
  const { stepOnce } = await import('../mcp/daemon.mjs');
  const task = limitTask();
  const id = task.run_id;
  const first = task.harness_run.driver.pid;
  await stepOnce(id, NO_JUDGE);
  let t = readTaskJson(root, id);
  assert.match(t.harness_run.waiting_capacity.reason, /hit your session limit/);
  assert.equal(t.harness_run.driver.pid, first, 'parked: no respawn');
  assert.deepEqual(t.harness_run.driver.restarts || [], [], 'no restart spent');
  assert.equal(countedDriverRestarts(t, t.harness_run.driver).length, 0);
  let ledger = readLedger(root, id);
  assert.equal(countOf(ledger, 'child_driver_capacity'), 1);
  assert.equal(countOf(ledger, 'harness_driver_exhausted'), 0, 'driver_restarts 0 and still not exhausted');
  await stepOnce(id, NO_JUDGE); // before parkDueAt: still parked
  t = readTaskJson(root, id);
  assert.ok(t.harness_run.waiting_capacity);
  assert.equal(t.harness_run.driver.pid, first);
  ageParked(id);
  await stepOnce(id, NO_JUDGE); // the daemon's tick: autoResumeCapacity
  t = readTaskJson(root, id);
  ledger = readLedger(root, id);
  assert.equal(t.harness_run.waiting_capacity, undefined, 'the park is cleared');
  assert.notEqual(t.harness_run.driver.pid, first, 'a new driver was spawned');
  assert.equal(countOf(ledger, 'daemon_capacity_resumed'), 1);
  const [restarted] = ledger.filter((e) => e.event === 'child_driver_restarted');
  assert.equal(restarted.reason, 'reset_capacity');
  assert.equal(countedDriverRestarts(t, t.harness_run.driver).length, 0, 'still no restart spent');
  assert.equal(countOf(ledger, 'harness_driver_exhausted'), 0);
});

test('S resume: hold blocks the start sweep and the daemon tick; lifted, the tick resumes', async () => {
  const { stepOnce } = await import('../mcp/daemon.mjs');
  const held = { reason: 'on purpose', since: new Date().toISOString(), by: 'person' };

  // Session death: a running S task with a dead daemon is raised by the sweep unless a person holds it.
  const dead = unitTask({ driver_restarts: 1, daemon: { pid: deadPid(), started_at: Date.now() } });
  assert.equal(taskState(dead).state, 'running', 'without the hold this task is one the sweep raises');
  dead.hold = held;
  persist(dead);
  assert.deepEqual(await sweepDeadDaemons(), []);
  const after = readTaskJson(root, dead.run_id);
  assert.equal(after.daemon.pid, dead.daemon.pid, 'the dead daemon is left');
  assert.equal(after.harness_run.driver.pid, dead.harness_run.driver.pid, 'no driver respawned');
  assert.equal(countOf(readLedger(root, dead.run_id), 'daemon_restarted'), 0);

  // Usage limit: parked and due, held: the tick respawns nothing; the park stays.
  const task = limitTask();
  const id = task.run_id;
  await stepOnce(id, NO_JUDGE);
  ageParked(id);
  const parked = readTaskJson(root, id);
  const first = parked.harness_run.driver.pid;
  parked.hold = held;
  writeFileSync(join(root, id, 'task.json'), JSON.stringify(parked));
  await stepOnce(id, NO_JUDGE);
  let t = readTaskJson(root, id);
  assert.ok(t.harness_run.waiting_capacity, 'still parked');
  assert.equal(t.harness_run.driver.pid, first);
  assert.equal(countOf(readLedger(root, id), 'daemon_capacity_resumed'), 0);
  delete t.hold;
  writeFileSync(join(root, id, 'task.json'), JSON.stringify(t));
  await stepOnce(id, NO_JUDGE);
  t = readTaskJson(root, id);
  assert.equal(t.harness_run.waiting_capacity, undefined, 'the same park resumes once the hold is gone');
  assert.equal(countOf(readLedger(root, id), 'daemon_capacity_resumed'), 1);
});
