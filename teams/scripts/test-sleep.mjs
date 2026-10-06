#!/usr/bin/env node
// test-sleep.mjs - a teams run survives Mac sleep/wake (../teams-mac-sleep/finding.md).
//
// A suspend is injected through taskstate.mjs's __clock seam (wall jumps, mono barely moves);
// nothing here sleeps. Drivers are real disposable `sleep` processes, so a stall-kill is visible
// as the process exiting; progress age is faked with utimesSync, as test-taskmanager.mjs does.
//
//   node --test teams/scripts/test-sleep.mjs

process.env.TEAMS_RUNS_DIR ??= 'off';
process.env.TEAMS_VIEW = '0';
process.env.HARNESS_TEST_NO_DAEMON = '1';
delete process.env.HARNESS_TEST_NO_DRIVER;
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, utimesSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = mkdtempSync(join(tmpdir(), 'tm-sleep-root-'));
process.env.HARNESS_TASKS_DIR = ROOT;
const STUB_DIR = mkdtempSync(join(tmpdir(), 'tm-sleep-drv-'));
writeFileSync(join(STUB_DIR, 'driver.mjs'), 'setTimeout(() => {}, 1000);\n');
process.env.HARNESS_CHILD_DRIVER = `node ${join(STUB_DIR, 'driver.mjs')}`;

const tm = await import(join(HERE, '..', 'mcp', 'taskmanager.mjs'));
const ts = await import(join(HERE, '..', 'mcp', 'taskstate.mjs'));
const graph = await import(join(HERE, '..', 'mcp', 'graph.mjs'));
const store = await import(join(HERE, '..', 'mcp', 'store.mjs'));
const daemon = await import(join(HERE, '..', 'mcp', 'daemon.mjs'));

const sleepers = [];
process.on('exit', () => {
  for (const p of sleepers) { try { process.kill(p, 'SIGKILL'); } catch { /* gone */ } }
  for (const d of [ROOT, STUB_DIR]) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best-effort */ } }
});

const H = 3600000;
const MIN = 60000;
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
function sleeper() {
  const p = spawn('sleep', ['300'], { detached: true, stdio: 'ignore' });
  p.unref();
  sleepers.push(p.pid);
  return p.pid;
}

// The clock seam, reset around every test. Undefined before S2: the test then runs on the real
// clock and fails on its behaviour assertion, not on a missing export.
const realClock = ts.__clock ? { ...ts.__clock } : null;
let fake = null;
function setClock(wall, mono) {
  fake = { wall, mono };
  if (ts.__clock) { ts.__clock.wall = () => fake.wall; ts.__clock.mono = () => fake.mono; }
}
function resetClock() {
  fake = null;
  if (realClock) Object.assign(ts.__clock, realClock);
  if (ts.__resetSuspendDetector) ts.__resetSuspendDetector();
}
const baseline = () => { if (ts.detectSuspends) ts.detectSuspends(); };
async function withClock(fn) {
  resetClock();
  try { return await fn(); } finally { resetClock(); }
}

let seq = 0;
// A size-L task past critique whose one package's dispatch is running: a child run in a scratch
// cwd, its driver a live `sleep`, its last progress `progressAgo` ms ago.
function seedTask({ progressAgo = 0, createdAgo = 3 * H, extra = {}, nodes = [] } = {}) {
  const run_id = `5eee${String(++seq).padStart(4, '0')}-1111-2222-3333-444444444444`;
  const path = tm.taskPath(run_id);
  mkdirSync(dirname(path), { recursive: true });
  const cwd = mkdtempSync(join(ROOT, 'wt-'));
  const childId = `child-${run_id}`;
  const runFile = join(cwd, '.teams_output', 'broker', 'runs', `${childId}.json`);
  mkdirSync(dirname(runFile), { recursive: true });
  writeFileSync(runFile, JSON.stringify({ run_id: childId, cwd, request: 'r', nodes: [graph.node('implement', 'implement', [])] }));
  const t = new Date(Date.now() - progressAgo);
  utimesSync(runFile, t, t);
  const pid = sleeper();
  const done = (id, stage, deps) => graph.node(id, stage, deps, { state: 'done', result: { stage_ok: true } });
  writeFileSync(path, JSON.stringify({
    run_id, kind: 'task', store_path: path, cwd: ROOT, request: 'r', created_at: Date.now() - createdAgo,
    flow: 'develop', flow_chosen: 'develop', size: 'L', max_retries: 2, driver_restarts: 2,
    base_ref: null, team: { opts: { max_parallel_teams: 4 } },
    spec: { acceptance: ['a'], packages: [{ id: 'P1', title: 'a', flow: 'develop', brief: 'b', acceptance: ['a'], touches: ['a.txt'], deps: [] }] },
    nodes: [done('size', 'size', []), done('shape', 'shape', ['size']), done('critique', 'critique', ['shape']),
      graph.node('dispatch:P1:1', 'dispatch', ['critique'], { subgoal_id: 'P1', state: 'running',
        child: { cwd, run_id: childId, driver: { pid, started_at: Date.now() - 3 * H } } }),
      graph.node('accept:P1:1', 'accept', ['dispatch:P1:1'], { subgoal_id: 'P1' }),
      ...nodes],
    ...extra,
  }, null, 2));
  return { id: run_id, pid };
}
const load = (id) => JSON.parse(readFileSync(tm.taskPath(id), 'utf8'));
const ledger = (id) => {
  const f = join(tm.taskDir(id), 'ledger.jsonl');
  return existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
};
const events = (id, ev) => ledger(id).filter((e) => e.event === ev);
const noJudge = async () => { throw new Error('nothing should be judged'); };
const ask = (since) => graph.node('ask:M:1', 'ask', [], { state: 'waiting_human', waiting_since: since, questions: [{ question: 'q', default: 'a' }] });

// ---------- A + B2: the daemon tick ----------

test('A/B2: one daemon tick after a 2h suspend records it before the stall watchdog and the timebox - driver not killed, timebox not tripped', () => withClock(async () => {
  const { id, pid } = seedTask({ progressAgo: 2 * H, createdAgo: 2 * H + 5 * MIN, extra: { team: { opts: { max_parallel_teams: 4, timebox_minutes: 60 } } } });
  const now = Date.now();
  setClock(now - 2 * H, 1000); // the previous tick, before the lid closed
  baseline();
  setClock(now, 2000); // wall +2h, mono +1s
  await daemon.stepOnce(id, { judge: noJudge });
  const t = load(id);
  assert.equal(events(id, 'suspend_detected').length, 1, 'one suspend_detected');
  assert.ok(Math.abs(t.suspended_ms - (2 * H - 1000)) < 2000, `suspended_ms ~2h, got ${t.suspended_ms}`);
  assert.equal(t.resumed_at, now);
  assert.equal(events(id, 'child_driver_killed').length, 0, 'the stalled driver is not killed');
  assert.ok(alive(pid), 'the driver process is alive');
  assert.equal(t.budget_stopped, undefined, 'the 60-minute timebox did not trip on the sleep');
}));

test('never-sleeping machine: wall and mono advance together (or a gap below 60s, or a backward wall step) - no suspend recorded, fields stay undefined', () => withClock(async () => {
  const { id } = seedTask({ progressAgo: 0 });
  const now = Date.now();
  setClock(now - 200 * 1000, 0);
  await daemon.stepOnce(id, { judge: noJudge });
  setClock(now - 170 * 1000, 30 * 1000); // +30s / +30s
  await daemon.stepOnce(id, { judge: noJudge });
  setClock(now - 110 * 1000, 31 * 1000); // wall +60s, mono +1s: a 59s gap
  await daemon.stepOnce(id, { judge: noJudge });
  setClock(now - 3 * H, 32 * 1000); // wall steps back
  await daemon.stepOnce(id, { judge: noJudge });
  const t = load(id);
  assert.equal(events(id, 'suspend_detected').length, 0);
  assert.equal(t.suspended_ms, undefined);
  assert.equal(t.resumed_at, undefined);
  assert.equal(t.suspends, undefined);
  if (ts.suspendGap) assert.equal(ts.suspendGap({ wall: 100, mono: 0 }, { wall: 0, mono: 50 }), 0, 'backward step reads as gap 0');
}));

// ---------- B2: the tm_* paths ----------

test('B2: the gap seen first by a tm_* call (no daemon tick) - no stall-kill, no timebox trip, no ask expiry', () => withClock(async () => {
  const now = Date.now();
  const { id, pid } = seedTask({
    progressAgo: 2 * H, createdAgo: 2 * H + 5 * MIN,
    extra: { ask_timeout: 60 * MIN, team: { opts: { max_parallel_teams: 4, timebox_minutes: 60 } } },
    nodes: [ask(now - 2 * H - MIN)],
  });
  setClock(now - 2 * H, 1000);
  baseline();
  setClock(now, 2000);
  await tm.callTool('tm_next', { task_id: id });
  const t = load(id);
  assert.ok(t.suspended_ms > 2 * H - 3000, `suspended_ms ${t.suspended_ms}`);
  assert.equal(events(id, 'child_driver_killed').length, 0, 'no stall-kill');
  assert.ok(alive(pid));
  assert.equal(t.budget_stopped, undefined, 'no timebox trip');
  assert.equal(events(id, 'ask_timeout').length, 0, 'no ask expiry');
  assert.equal(t.nodes.find((n) => n.node_id === 'ask:M:1').state, 'waiting_human');
}));

test('B4/B5: one process, two tasks - a gap seen through task A is applied to task B too, once; a task created after the gap gets none of it', () => withClock(async () => {
  const now = Date.now();
  const a = seedTask({ progressAgo: 2 * H });
  const b = seedTask({ progressAgo: 2 * H });
  setClock(now - 2 * H, 1000);
  baseline();
  setClock(now, 2000);
  await tm.callTool('tm_status', { task_id: a.id });
  assert.ok(load(a.id).suspended_ms > 2 * H - 3000, 'A recorded the suspend');
  await tm.callTool('tm_next', { task_id: b.id });
  const tb = load(b.id);
  assert.ok(Math.abs(tb.suspended_ms - (2 * H - 1000)) < 2000, `B recorded it too: ${tb.suspended_ms}`);
  assert.equal(events(b.id, 'child_driver_killed').length, 0, "B's stalled driver is not killed");
  assert.ok(alive(b.pid));
  const before = [load(a.id).suspended_ms, tb.suspended_ms];
  await tm.callTool('tm_next', { task_id: a.id });
  await tm.callTool('tm_next', { task_id: b.id });
  assert.deepEqual([load(a.id).suspended_ms, load(b.id).suspended_ms], before, 'repeating adds nothing');
  assert.equal(load(a.id).suspends.length, 1);
  assert.equal(load(b.id).suspends.length, 1);
  const c = seedTask({ progressAgo: 0, createdAgo: -1000 }); // created after the gap
  await tm.callTool('tm_next', { task_id: c.id });
  const tc = load(c.id);
  assert.equal(tc.suspended_ms, undefined);
  assert.equal(tc.resumed_at, undefined);
  assert.equal(tc.suspends, undefined);
}));

test('idempotent: the same suspend noted by two processes (slightly different at) counts once, as one interval', () => {
  const t = { run_id: 'idem-1', created_at: 0, nodes: [] };
  const at = 10 * H;
  assert.ok(ts.noteSuspend, 'noteSuspend exists');
  ts.noteSuspend(t, at, 2 * H);
  ts.noteSuspend(t, at + 700, 2 * H - 300);
  assert.equal(t.suspends.length, 1);
  assert.ok(Math.abs(t.suspended_ms - 2 * H) <= 700, `${t.suspended_ms}`);
  assert.equal(t.resumed_at, at + 700);
  assert.equal(ts.noteSuspend(t, at, 2 * H), false, 'the same interval again is a no-op');
});

test('idempotent past the 50-entry cap: 51 suspends, then repeated applies with no clock movement change nothing', () => withClock(() => {
  const t = { run_id: 'cap-1', created_at: 0, nodes: [] };
  let wall = 1000 * H;
  let mono = 0;
  setClock(wall, mono);
  baseline();
  for (let i = 0; i < 51; i++) {
    wall += 2 * H; mono += 1000; // each step: a 2h suspend
    setClock(wall, mono);
    ts.applySuspends(t);
    wall += 10 * MIN; mono += 10 * MIN; // awake in between, so the intervals stay apart
    setClock(wall, mono);
    ts.applySuspends(t);
  }
  assert.equal(t.suspends.length, 50, 'capped');
  const ms = t.suspended_ms;
  const recs = events('cap-1', 'suspend_detected').length;
  for (let i = 0; i < 5; i++) assert.equal(ts.applySuspends(t), false, 'no clock movement: no change');
  assert.equal(t.suspended_ms, ms, 'suspended_ms unchanged');
  assert.equal(events('cap-1', 'suspend_detected').length, recs, 'no new records');
}));

test('E: serviceHarnessRun stamps after_wake on the free restart of the size-S harness driver', () => withClock(() => {
  const wake = Date.now() - MIN;
  const cwd = mkdtempSync(join(ROOT, 'hr-'));
  const t = { run_id: 'hr-1', cwd, created_at: Date.now() - 3 * H, driver_restarts: 2, nodes: [],
    suspends: [{ at: wake, gap_ms: 2 * H }], suspended_ms: 2 * H, resumed_at: wake,
    harness_run: { cwd, pointer: join(cwd, 'none.json'), opened_at: Date.now() - 3 * H, driver: { pid: 2 ** 22 + 4322, started_at: Date.now() - H } } };
  assert.equal(tm.serviceHarnessRun(t), true, 'respawned');
  const h = t.harness_run;
  assert.equal(h.driver.restarts[0].after_wake, wake, 'stamped');
  assert.equal(ts.countedDriverRestarts(t, h.driver).length, 0, 'free');
  try { if (h.driver.pid) process.kill(h.driver.pid, 'SIGKILL'); } catch { /* gone */ }
}));

// ---------- B: stall watchdog ----------

test('B: an otherwise kill-eligible stalled driver with resumed_at 30s ago is not killed; without resumed_at it is killed as today', () => withClock(() => {
  for (const resumed of [true, false]) {
    const { id, pid } = seedTask({ progressAgo: 2 * H });
    store.mutateTask(id, (t) => {
      if (resumed) t.resumed_at = Date.now() - 30 * 1000;
      const n = t.nodes.find((x) => x.node_id === 'dispatch:P1:1');
      tm.serviceStalledDriver(t, n.child, n.node_id);
    });
    assert.equal(events(id, 'child_driver_killed').length, resumed ? 0 : 1, resumed ? 'woke 30s ago: not killed' : 'no wake: killed as today');
    if (resumed) assert.ok(alive(pid));
  }
}));

// ---------- C: timebox ----------

test('C: a 60-minute timebox, created 90 min ago, suspended 60 min - not over; without suspended_ms over as today', () => {
  const task = { run_id: 'tb', created_at: Date.now() - 90 * MIN, team: { opts: { timebox_minutes: 60 } }, nodes: [] };
  assert.equal(tm.budgetStatus({ ...task, suspended_ms: 60 * MIN }).over, false);
  assert.equal(tm.budgetStatus(task).over, true);
});

// ---------- D: ask timeout ----------

test('D: a suspend after waiting_since extends the ask deadline; a suspend before it does not', () => withClock(() => {
  const now = Date.now();
  const base = { run_id: 'ask-d', ask_timeout: 60 * MIN, nodes: [ask(now - 90 * MIN)] };
  const after = { ...base, suspended_ms: 60 * MIN, suspends: [{ at: now - 20 * MIN, gap_ms: 60 * MIN }] };
  assert.deepEqual(tm.expireAsks(after, now), [], 'slept 60 of the 90 minutes: not expired');
  assert.equal(tm.nextAskDeadline(after), now - 90 * MIN + 120 * MIN);
  const before = { ...base, suspended_ms: 60 * MIN, suspends: [{ at: now - 140 * MIN, gap_ms: 60 * MIN }] };
  assert.equal(tm.nextAskDeadline(before), now - 30 * MIN, 'slept before the ask: expires as today');
}));

// ---------- E: restart budget ----------

test('E: one restart per driver per suspend is free - driver_restarts 2, four deaths in one wake window: the first is free, the budget is spent at the 4th', () => {
  const T = 100 * H;
  const task = { run_id: 'rs', driver_restarts: 2, suspends: [{ at: T, gap_ms: 2 * H }] };
  const deaths = [1, 2, 3, 4].map((i) => ({ at: T + i * 1000 }));
  const counted = (k) => ts.countedDriverRestarts(task, { restarts: deaths.slice(0, k) }).length;
  assert.equal(counted(1), 0, 'the first restart after wake is free');
  assert.equal(counted(2), 1);
  assert.equal(counted(3), 2, 'three restarts: two count - the 4th death finds the budget spent');
  assert.ok(counted(2) < ts.restartBudget(task) && counted(3) >= ts.restartBudget(task));
  const outside = deaths.map((r) => ({ at: r.at + 30 * MIN }));
  assert.equal(ts.countedDriverRestarts(task, { restarts: outside.slice(0, 1) }).length, 1, 'outside any window: counted as today');
  assert.equal(ts.countedDriverRestarts({ run_id: 'rs', driver_restarts: 2 }, { restarts: deaths.slice(0, 1) }).length, 1, 'no suspend: counted as today');
});

test('E: serviceDeadDriver stamps after_wake on the free restart only', () => withClock(() => {
  const { id } = seedTask();
  const wake = Date.now() - MIN;
  const dead = { pid: 2 ** 22 + 4321, started_at: Date.now() - H };
  store.mutateTask(id, (t) => { t.suspends = [{ at: wake, gap_ms: 2 * H }]; t.suspended_ms = 2 * H; t.resumed_at = wake; });
  const t = load(id);
  const n = t.nodes.find((x) => x.node_id === 'dispatch:P1:1');
  n.child.driver = { ...dead };
  assert.equal(tm.serviceDeadDriver(t, n.child, n.node_id), true, 'respawned');
  assert.equal(n.child.driver.restarts[0].after_wake, wake, 'the first death after wake is stamped');
  try { process.kill(n.child.driver.pid, 'SIGKILL'); } catch { /* gone */ }
  n.child.driver = { ...dead, restarts: n.child.driver.restarts };
  assert.equal(tm.serviceDeadDriver(t, n.child, n.node_id), true);
  assert.equal(n.child.driver.restarts[1].after_wake, undefined, 'the second is not');
  assert.equal(ts.countedDriverRestarts(t, n.child.driver).length, 1);
  try { process.kill(n.child.driver.pid, 'SIGKILL'); } catch { /* gone */ }
}));

// ---------- F: the daemon survives a lock timeout ----------

test('F: the daemon loop step survives LockTimeoutError and records daemon_lock_timeout once per streak; other errors propagate', async () => {
  assert.equal(typeof daemon.loopStep, 'function', 'daemon.mjs exports loopStep');
  const { id } = seedTask();
  const streak = {};
  const timeout = () => { throw new store.LockTimeoutError('/x/task.json', { pid: 4242 }, 5000); };
  for (let i = 0; i < 4; i++) assert.equal((await daemon.loopStep(id, streak, timeout)).ok, false);
  const recs = events(id, 'daemon_lock_timeout');
  assert.equal(recs.length, 1, 'one record for the streak');
  assert.equal(recs[0].path, '/x/task.json');
  assert.equal(recs[0].owner, 4242);
  assert.deepEqual(await daemon.loopStep(id, streak, () => 7), { ok: true, value: 7 }, 'the streak ends');
  await daemon.loopStep(id, streak, timeout);
  assert.equal(events(id, 'daemon_lock_timeout').length, 2, 'a new streak records again');
  await assert.rejects(daemon.loopStep(id, streak, () => { throw new Error('boom'); }), /boom/);
});

// ---------- G: darwin caffeinate ----------

test('G: on darwin the daemon pid is tied to caffeinate -i -w <pid>; elsewhere nothing is spawned', async () => {
  assert.equal(typeof tm.startKeepAwake, 'function');
  const dir = mkdtempSync(join(ROOT, 'caf-'));
  const out = join(dir, 'argv.json');
  const bin = join(dir, 'caffeinate');
  writeFileSync(bin, `#!${process.execPath}\nrequire('fs').writeFileSync(${JSON.stringify(out)}, JSON.stringify(process.argv.slice(2)));\n`);
  chmodSync(bin, 0o755);
  const ka = tm.startKeepAwake(4242, { platform: 'darwin', bin });
  assert.ok(ka && Number.isInteger(ka.pid));
  for (let i = 0; i < 100 && !existsSync(out); i++) await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(JSON.parse(readFileSync(out, 'utf8')), ['-i', '-w', '4242']);
  rmSync(out);
  assert.equal(tm.startKeepAwake(4242, { platform: 'linux', bin }), null);
  assert.equal(tm.startKeepAwake(4242, { platform: 'darwin', bin: join(dir, 'missing') }), null);
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(existsSync(out), false, 'nothing was spawned');
});
