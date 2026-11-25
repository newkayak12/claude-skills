#!/usr/bin/env node
// test-daemon-decisions.mjs - the daemon's restart / survive / finish decisions, one test per
// branch. Each test fails if its branch is removed (the maintainer's mutation script proves it).
//
//   node --test teams/scripts/test-daemon-decisions.mjs

process.env.TEAMS_RUNS_DIR ??= 'off';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, cpSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DAEMON = join(HERE, '..', 'mcp', 'daemon.mjs');
const ROOT = mkdtempSync(join(tmpdir(), 'daemon-decisions-'));
process.env.HARNESS_TASKS_DIR = ROOT;
// A daemon respawned in-process (resumeDaemon) is this stub: it stays up 30 s, seen as a live pid.
const STUB_DIR = mkdtempSync(join(tmpdir(), 'daemon-decisions-stub-'));
writeFileSync(join(STUB_DIR, 'stay.mjs'), 'setTimeout(() => {}, 30000);\n');
process.env.HARNESS_DAEMON = `node ${join(STUB_DIR, 'stay.mjs')}`;

const daemon = await import(join(HERE, '..', 'mcp', 'daemon.mjs'));
const { resumeDaemon } = await import(join(HERE, '..', 'mcp', 'taskmanager-drivers.mjs'));
const { mutateTask } = await import(join(HERE, '..', 'mcp', 'store.mjs'));
const { node } = await import(join(HERE, '..', 'mcp', 'graph.mjs'));

const procs = [];
const dirs = [ROOT, STUB_DIR];
after(() => {
  for (const p of procs) { try { process.kill(-p, 'SIGKILL'); } catch { try { process.kill(p, 'SIGKILL'); } catch { /* gone */ } } }
  for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best-effort */ } }
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function until(fn, ms, step = 100) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) return v;
    await sleep(step);
  }
}
const ledger = (root, id) => {
  try { return readFileSync(join(root, id, 'ledger.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; }
};
const events = (root, id, name) => ledger(root, id).filter((e) => e.event === name);

// A daemon process on a task dir, its judge a stub, nothing real spawned. Killed in `after`.
function startDaemon(root, id, { __import, ...env } = {}) {
  const d = spawn(process.execPath, [...(__import ? ['--import', __import] : []), DAEMON, '--task', id], {
    stdio: ['ignore', 'ignore', 'pipe'],
    env: { ...process.env, HARNESS_TASKS_DIR: root, HARNESS_TEST_NO_DRIVER: '1', HARNESS_TEST_NO_DAEMON: '1', HARNESS_JUDGE_DRIVER: 'true',
      TEAMS_RUNS_DIR: 'off', HARNESS_TEST_RUNNER_PID: String(process.pid), ...env },
  });
  procs.push(d.pid);
  d.exited = new Promise((res) => d.on('exit', res));
  return d;
}

// ---------- A: a tick error does not kill the daemon (E-531fddcf died on one ENOSPC) ----------

let seq = 0;
function seedLedgerOnly() {
  const id = `d1ec${String(++seq).padStart(4, '0')}-1111-2222-3333-444444444444`;
  mkdirSync(join(ROOT, id), { recursive: true });
  return id;
}
const enospc = () => Object.assign(new Error('ENOSPC: no space left on device, open task.json.lock'), { code: 'ENOSPC' });
const failing = () => { throw enospc(); };
const LIMIT = { maxErrors: daemon.NON_LOCK_FAILURE_LIMIT };

test('tick error survives failures one to four', async () => {
  assert.equal(daemon.NON_LOCK_FAILURE_LIMIT, 5);
  const id = seedLedgerOnly();
  const streak = { count: 0 };
  for (let i = 1; i <= 4; i++) {
    const step = await daemon.loopStep(id, streak, failing, LIMIT);
    assert.equal(step.ok, false, `ENOSPC failure ${i} is survived`);
    assert.equal(step.wait, daemon.FALLBACK_WAIT_MS, 'the wait is the fallback, not the 1 s lock retry');
  }
});

test('tick error exits on the fifth consecutive failure and records why', async () => {
  const id = seedLedgerOnly();
  const streak = { count: 0 };
  for (let i = 1; i <= 4; i++) await daemon.loopStep(id, streak, failing, LIMIT);
  await assert.rejects(daemon.loopStep(id, streak, failing, LIMIT), /ENOSPC/);
  const exit = events(ROOT, id, 'daemon_tick_exit');
  assert.equal(exit.length, 1, 'one exit-reason event');
  assert.equal(exit[0].code, 'ENOSPC');
  assert.equal(exit[0].failures, 5);
  assert.match(exit[0].message, /no space left/);
});

test('tick error is recorded once per streak', async () => {
  const id = seedLedgerOnly();
  const streak = { count: 0 };
  for (let i = 1; i <= 4; i++) await daemon.loopStep(id, streak, failing, LIMIT);
  const errs = events(ROOT, id, 'daemon_tick_error');
  assert.equal(errs.length, 1, 'four failures, one event');
  assert.equal(errs[0].code, 'ENOSPC');
  assert.ok(errs[0].message);
});

test('tick error streak resets on success', async () => {
  const id = seedLedgerOnly();
  const streak = { count: 0 };
  for (let i = 1; i <= 3; i++) await daemon.loopStep(id, streak, failing, LIMIT);
  assert.deepEqual(await daemon.loopStep(id, streak, () => 7, LIMIT), { ok: true, value: 7 });
  for (let i = 1; i <= 4; i++) assert.equal((await daemon.loopStep(id, streak, failing, LIMIT)).ok, false, `a new streak: failure ${i} survived`);
  assert.equal(events(ROOT, id, 'daemon_tick_error').length, 2, 'the new streak records again');
  assert.equal(events(ROOT, id, 'daemon_tick_exit').length, 0);
});

test('tick error leaves lock timeouts and the default limit as they were', async () => {
  const id = seedLedgerOnly();
  const lock = () => { throw Object.assign(new Error('lock'), { code: 'ELOCKTIMEOUT', path: '/x/task.json' }); };
  const streak = { count: 0 };
  for (let i = 0; i < 6; i++) assert.deepEqual(await daemon.loopStep(id, streak, lock, LIMIT), { ok: false });
  assert.equal(events(ROOT, id, 'daemon_lock_timeout').length, 1);
  assert.equal(events(ROOT, id, 'daemon_tick_error').length, 0, 'a lock timeout is not a tick error');
  await assert.rejects(daemon.loopStep(id, {}, failing), /ENOSPC/, 'no limit given: the first non-lock error propagates');
});

// ---------- B: resumeDaemon - a person's action gives an exhausted dead daemon a fresh budget ----------

function managerTask(id, extra) {
  mkdirSync(join(ROOT, id), { recursive: true });
  const task = {
    run_id: id, cwd: ROOT, request: 'resume', max_retries: 2, team: { opts: {} }, driver_restarts: 2,
    nodes: [
      node('critique', 'critique', [], { state: 'done' }),
      node('dispatch:P1:1', 'dispatch', ['critique'], { subgoal_id: 'P1', attempt: 1 }),
    ],
    ...extra,
  };
  writeFileSync(join(ROOT, id, 'task.json'), JSON.stringify(task));
  return task;
}

test('resumeDaemon gives an exhausted dead daemon a fresh daemon with a fresh budget', async () => {
  const id = 'e5ed0000-0000-0000-0000-000000000001';
  managerTask(id, { daemon: { pid: 2147483000, started_at: Date.now() - 1000, restarts: 2, spawn_count: 3, exhausted: true } });
  const r = await mutateTask(id, (t) => resumeDaemon(t, { reason: 'retry', node_id: 'dispatch:P1:1' }));
  assert.equal(r.spawned, true);
  const t = JSON.parse(readFileSync(join(ROOT, id, 'task.json'), 'utf8'));
  assert.equal(t.daemon.exhausted, false, 'exhausted cleared');
  assert.equal(t.daemon.restarts, 0, 'a fresh budget, not prior + 1');
  assert.ok(alive(t.daemon.pid), 'a new daemon is running');
  procs.push(t.daemon.pid);
  const restarted = events(ROOT, id, 'daemon_restarted');
  assert.equal(restarted.length, 1);
  assert.equal(restarted[0].reason, 'reset');
  const resumed = events(ROOT, id, 'daemon_resumed');
  assert.equal(resumed.length, 1);
  assert.equal(resumed[0].reason, 'retry');
  assert.equal(resumed[0].node_id, 'dispatch:P1:1');
});

test('resumeDaemon spawns nothing for a live daemon or a graph that is not running, and still clears exhausted', async () => {
  const live = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { detached: true, stdio: 'ignore' });
  live.unref();
  procs.push(live.pid);
  const a = 'e5ed0000-0000-0000-0000-000000000002';
  managerTask(a, { daemon: { pid: live.pid, started_at: Date.now(), restarts: 1, exhausted: true } });
  assert.deepEqual(await mutateTask(a, (t) => resumeDaemon(t, { reason: 'retry' })), { spawned: false }, 'a live daemon is kept');
  assert.equal(JSON.parse(readFileSync(join(ROOT, a, 'task.json'), 'utf8')).daemon.exhausted, false);
  const b = 'e5ed0000-0000-0000-0000-000000000003';
  managerTask(b, { daemon: { pid: 2147483000, started_at: Date.now() - 1000, restarts: 2, exhausted: true },
    nodes: [node('critique', 'critique', [], { state: 'done' }), node('dispatch:P1:1', 'dispatch', ['critique'], { subgoal_id: 'P1', attempt: 1, state: 'done', result: { stage_ok: true } })] });
  const rb = await mutateTask(b, (t) => resumeDaemon(t, { reason: 'retry' }));
  assert.equal(rb.spawned, false, 'a graph that no longer reads running is not driven again');
  assert.equal(events(ROOT, b, 'daemon_resumed').length, 0);
});

// ---------- the idle task fixture (teams/scripts/fixtures/daemon-tick/531fddcf) ----------

const FULL_ID = '531fddcf-ee43-49df-b07e-53d2d0078423';
// A copy of the fixture in its own tasks dir with the placeholders filled, the child run file
// written and one live silent fake driver: an idle running task whose daemon is not running.
function seedFixture() {
  const root = mkdtempSync(join(tmpdir(), 'daemon-decisions-fx-'));
  const cwd = mkdtempSync(join(tmpdir(), 'daemon-decisions-fxcwd-'));
  dirs.push(root, cwd);
  const dir = join(root, FULL_ID);
  cpSync(join(HERE, 'fixtures', 'daemon-tick', '531fddcf'), dir, { recursive: true });
  const childId = '00000000-0000-4000-8000-000000000001';
  const driverFile = join(root, 'fake-driver.mjs');
  writeFileSync(driverFile, 'setTimeout(() => {}, 600000);');
  const drv = spawn(process.execPath, [driverFile, dir], { detached: true, stdio: 'ignore' });
  drv.unref();
  procs.push(drv.pid);
  const fill = (s) => s
    .replaceAll('__TASK_DIR__', dir).replaceAll('__CWD__', cwd).replaceAll('__CHILD_RUN_ID__', childId)
    .replaceAll('__PLUGIN_DIR__', join(HERE, '..')).replaceAll('__TASK_ID__', FULL_ID)
    .replaceAll('__DRIVER_SCRIPT__', driverFile).replaceAll('__HOME__', homedir());
  const t = JSON.parse(fill(readFileSync(join(dir, 'task.json'), 'utf8')));
  const dispatch = t.nodes.find((n) => n.node_id === 'dispatch:QA-F1:1');
  dispatch.child.driver.pid = drv.pid;
  t.daemon.pid = 4194303;
  writeFileSync(join(dir, 'task.json'), JSON.stringify(t, null, 1));
  const runFile = join(dispatch.child.cwd, '.teams_output', 'broker', 'runs', `${childId}.json`);
  mkdirSync(dirname(runFile), { recursive: true });
  mkdirSync(join(dir, 'drivers'), { recursive: true });
  writeFileSync(runFile, JSON.stringify({ run_id: childId, cwd: dispatch.child.cwd, request: 'r',
    nodes: [{ node_id: 'implement', stage: 'implement', deps: [], after: [], state: 'pending', attempt: 1 }] }));
  return { root, id: FULL_ID, dir };
}

// ---------- C: a torn task.json read is a beat, not a deleted task ----------

test('daemon_torn_read is recorded when task.json reads torn twice, and the daemon keeps running', async () => {
  const s = seedFixture();
  // Tears the two reads main() makes through loadTask() right after a tick (fresh read, then its
  // 250 ms retry): the file on disk is never touched, so it is "torn then restored" to the daemon.
  const preload = join(STUB_DIR, 'tear.mjs');
  writeFileSync(preload, `import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const orig = fs.readFileSync;
let armed = false, torn = 0;
fs.readFileSync = function (p, ...rest) {
  const r = orig.call(this, p, ...rest);
  if (typeof p === 'string' && p.endsWith('/task.json')) {
    if (!new Error().stack.includes('at loadTask ')) armed = true;
    else if (armed && torn < 2) { torn++; return typeof r === 'string' ? r.slice(0, 12) : r.subarray(0, 12); }
  }
  return r;
};
syncBuiltinESMExports();
`);
  const d = startDaemon(s.root, s.id, { __import: preload });
  const seen = await until(() => events(s.root, s.id, 'daemon_torn_read').length === 1, 20000);
  assert.ok(seen, 'daemon_torn_read recorded once');
  await sleep(1500);
  assert.equal(alive(d.pid), true, 'the daemon went on after the torn read');
  assert.ok(JSON.parse(readFileSync(join(s.dir, 'task.json'), 'utf8')).run_id, 'task.json is whole');
  assert.equal(events(s.root, s.id, 'daemon_task_missing').length, 0, 'not mistaken for a deleted task');
  process.kill(d.pid, 'SIGKILL');
});

// ---------- D: the finish sequence ----------

function blockedTask(root, id) {
  mkdirSync(join(root, id), { recursive: true });
  const conflict = { stage_ok: false, reason: 'merge conflict', conflicts: ['a.txt'] };
  const task = { run_id: id, cwd: root, request: 'finish', max_retries: 2, team: { opts: {} },
    nodes: [
      node('critique', 'critique', [], { state: 'done' }),
      node('dispatch:P1:1', 'dispatch', ['critique'], { subgoal_id: 'P1', attempt: 1, state: 'failed', result: conflict }),
      node('accept:P1:1', 'accept', ['dispatch:P1:1'], { subgoal_id: 'P1', attempt: 1 }),
    ] };
  writeFileSync(join(root, id, 'task.json'), JSON.stringify(task));
}
async function finishRun(id, runsDir) {
  const root = mkdtempSync(join(tmpdir(), 'daemon-decisions-fin-'));
  dirs.push(root);
  blockedTask(root, id);
  // HARNESS_TEST_NO_DRIVER off: the run-log step only runs for a daemon that may drive.
  const stub = join(root, 'judge.mjs');
  writeFileSync(stub, 'process.exit(1);\n');
  const d = startDaemon(root, id, { HARNESS_TEST_NO_DRIVER: '', HARNESS_JUDGE_DRIVER: `node ${stub}`, TEAMS_RUNS_DIR: runsDir(root) });
  const killer = setTimeout(() => { try { process.kill(d.pid, 'SIGKILL'); } catch { /* gone */ } }, 25000);
  const code = await d.exited;
  clearTimeout(killer);
  assert.equal(code, 0, 'the daemon ends cleanly');
  return ledger(root, id);
}

test('daemon finish records daemon_done then cost_recorded then run_logged', async () => {
  const led = await finishRun('f1100000-0000-0000-0000-000000000001', (root) => join(root, 'runs'));
  const at = (name) => led.findIndex((e) => e.event === name);
  assert.ok(at('daemon_done') >= 0, 'daemon_done');
  assert.equal(led[at('daemon_done')].state, 'blocked');
  assert.ok(at('cost_recorded') > at('daemon_done'), 'cost_recorded follows daemon_done');
  assert.ok(at('run_logged') > at('cost_recorded'), 'run_logged follows cost_recorded');
  assert.equal(at('run_log_failed'), -1);
});

test('daemon finish records run_log_failed when the run log cannot be kept, and still ends done', async () => {
  const led = await finishRun('f1100000-0000-0000-0000-000000000002', (root) => {
    writeFileSync(join(root, 'not-a-dir'), 'x');
    return join(root, 'not-a-dir', 'runs'); // mkdir under a file: ENOTDIR
  });
  assert.ok(led.some((e) => e.event === 'daemon_done'));
  assert.ok(led.some((e) => e.event === 'cost_recorded'));
  const failed = led.filter((e) => e.event === 'run_log_failed');
  assert.equal(failed.length, 1);
  assert.ok(failed[0].error);
  assert.ok(!led.some((e) => e.event === 'run_logged'));
});

// ---------- E: an idle daemon wakes when a driver's file lands ----------

test('waitForProgress wakes on a drivers file change before the fallback', async () => {
  const s = seedFixture();
  const log = join(s.root, 'watch.log');
  const preload = join(STUB_DIR, 'watchlog.mjs');
  // One fs.watch on <task>/drivers per waitForProgress, so the log counts idle ticks.
  writeFileSync(preload, `import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const w = fs.watch;
fs.watch = function (p, ...rest) { if (typeof p === 'string' && p.endsWith('/drivers')) fs.appendFileSync(process.env.WATCH_LOG, 'w\\n'); return w.call(this, p, ...rest); };
syncBuiltinESMExports();
`);
  const count = () => (existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean).length : 0);
  const d = startDaemon(s.root, s.id, { __import: preload, WATCH_LOG: log, HARNESS_DAEMON_POLL_MS: '60000' });
  assert.ok(await until(() => count() >= 1, 20000), 'the daemon is idling in waitForProgress');
  await sleep(1500);
  const before = count();
  writeFileSync(join(s.dir, 'drivers', 'zz.exit.json'), JSON.stringify({ code: 0 }));
  assert.ok(await until(() => count() > before, 8000), 'a drivers/ write woke the wait well before the 60 s fallback');
  process.kill(d.pid, 'SIGKILL');
  assert.ok(readdirSync(join(s.dir, 'drivers')).includes('zz.exit.json'));
});
