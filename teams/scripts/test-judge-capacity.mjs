#!/usr/bin/env node
// test-judge-capacity.mjs - a judge reply that is the usage-limit text parks the judging node as
// capacity; a malformed reply still ends judge_failed (backlog card 129 leftover, task 59613d5d:
// integrate:2's judge answered "You've hit your 5-hour limit" and the node stayed judge_failed,
// tm_retry({reset_capacity:true}) resumed [], each reopen spent a judge attempt).
//
// The judge is a stub chosen by HARNESS_JUDGE_DRIVER: it prints one stream-json result line whose
// text is read from STUB_DIR/reply.txt and appends one byte to STUB_DIR/calls per invocation. The
// real judge() runs through daemon.stepOnce; no judge is injected. Every test asserts only the
// desired behaviour: "red before" is read from a run on the unfixed tree, not asserted here.
//
//   node --test teams/scripts/test-judge-capacity.mjs

process.env.TEAMS_RUNS_DIR ??= 'off';
process.env.HARNESS_TEST_NO_DAEMON = '1';
delete process.env.HARNESS_TEST_NO_DRIVER;
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = mkdtempSync(join(tmpdir(), 'judge-cap-root-'));
const STUB_DIR = mkdtempSync(join(tmpdir(), 'judge-cap-stub-'));
process.env.HARNESS_TASKS_DIR = ROOT;
process.env.STUB_DIR = STUB_DIR;
writeFileSync(join(STUB_DIR, 'judge.mjs'), [
  "import { readFileSync, appendFileSync } from 'node:fs';",
  "import { join } from 'node:path';",
  "const dir = process.env.STUB_DIR;",
  "appendFileSync(join(dir, 'calls'), 'x');",
  "const reply = readFileSync(join(dir, 'reply.txt'), 'utf8');",
  "console.log(JSON.stringify({ type: 'result', is_error: true, result: reply }));",
].join('\n'));
process.env.HARNESS_JUDGE_DRIVER = `node ${join(STUB_DIR, 'judge.mjs')}`;

const tm = await import(join(HERE, '..', 'mcp', 'taskmanager.mjs'));
const graph = await import(join(HERE, '..', 'mcp', 'graph.mjs'));
const daemon = await import(join(HERE, '..', 'mcp', 'daemon.mjs'));
const { mutateTask } = await import(join(HERE, '..', 'mcp', 'store.mjs'));
const { capacityWait } = await import(join(HERE, '..', 'mcp', 'capacity-reset.mjs'));

const scratch = [];
after(() => {
  for (const d of [ROOT, STUB_DIR, ...scratch]) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best-effort */ } }
});

const LIMIT = "You've hit your 5-hour limit · resets 1:40pm (Asia/Seoul)";
const LIMIT_NO_RESET = "You've hit your 5-hour limit";
const GRACE = 3 * 60 * 1000; // taskmanager-repair.mjs CAPACITY_GRACE_MS
const MIN = 60 * 1000;

const git = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });
function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'judge-cap-repo-'));
  scratch.push(dir);
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@t');
  git(dir, 'config', 'user.name', 't');
  writeFileSync(join(dir, 'a.txt'), 'x\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'init');
  return dir;
}
const setReply = (text) => writeFileSync(join(STUB_DIR, 'reply.txt'), text);
const calls = () => (existsSync(join(STUB_DIR, 'calls')) ? readFileSync(join(STUB_DIR, 'calls'), 'utf8').length : 0);

let seq = 0;
const done = (id, stage, deps) => graph.node(id, stage, deps, { state: 'done', result: { stage_ok: true } });
// size and shape done; `nodes` follow (a critique, a report, an integrate ... pending and ready).
function seedTask(nodes) {
  const run_id = `0000${String(++seq).padStart(4, '0')}-cccc-dddd-0000-111111111111`;
  const path = tm.taskPath(run_id);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({
    run_id, kind: 'task', store_path: path, cwd: repo(), request: 'r', created_at: Date.now(),
    flow: 'develop', flow_chosen: 'develop', size: 'L', max_retries: 2, driver_restarts: 2,
    base_ref: null, team: { opts: { max_parallel_teams: 4, max_live_drivers: 4 } },
    spec: { acceptance: ['a'], packages: [{ id: 'P1', title: 'module P1', flow: 'develop', brief: 'b', acceptance: ['a'], touches: ['a.txt'], deps: [] }] },
    nodes: [done('size', 'size', []), done('shape', 'shape', ['size']), ...nodes],
  }, null, 2));
  return run_id;
}
const load = (id) => JSON.parse(readFileSync(tm.taskPath(id), 'utf8'));
const save = (id, fn) => { const t = load(id); fn(t); writeFileSync(tm.taskPath(id), JSON.stringify(t, null, 2)); };
const nodeOf = (id, nodeId) => load(id).nodes.find((n) => n.node_id === nodeId);
const ledger = (id) => {
  const f = join(tm.taskDir(id), 'ledger.jsonl');
  return existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
};
const gateNode = (extra = {}) => graph.node('report', 'report', ['shape'], extra);
const critiqueNode = () => graph.node('critique', 'critique', ['shape']);
const integrateNode = () => graph.node('integrate:2', 'integrate', ['shape'], { integration: { cwd: tmpdir(), branch: 'harness/x/integration' } });

// One judge pass of a seeded task with `reply`; returns the node after.
async function judgeOnce(id, nodeId, reply) {
  setReply(reply);
  await daemon.stepOnce(id);
  return nodeOf(id, nodeId);
}
const parkOf = (n) => n.result.waiting_capacity;
const dueOf = (w) => capacityWait({ reason: w.reason, since: w.since, firstSince: w.first_since, parks: w.parks }) + GRACE;

test('case 1: a limit reply parks a non-integrate judging node as capacity, no attempt spent', async () => {
  const id = seedTask([gateNode()]);
  const n = await judgeOnce(id, 'report', LIMIT);
  assert.equal(n.state, 'failed');
  const w = n.result.waiting_capacity;
  assert.ok(w, `result carries waiting_capacity: ${JSON.stringify(n.result)}`);
  assert.ok(String(w.reason).includes('hit your 5-hour limit'), w.reason);
  assert.ok(w.since && w.first_since, 'since and first_since');
  assert.equal(w.parks, 1);
  assert.doesNotMatch(String(n.result.reason), /not valid JSON/);
  assert.ok(!n.judge_attempts, `judge_attempts unset or 0, got ${n.judge_attempts}`);
  const cls = ledger(id).filter((e) => e.event === 'failure_classified' && e.node_id === 'report');
  assert.ok(cls.some((e) => e.failure_kind === 'capacity'), `failure_classified capacity: ${JSON.stringify(cls)}`);
});

test('case 2: no reopen before the stated reset + grace, reopen after it, no attempt spent', async () => {
  const id = seedTask([gateNode()]);
  const n = await judgeOnce(id, 'report', LIMIT);
  assert.ok(parkOf(n), 'parked');
  // Pin the park to a fixed time: 10:45:22 KST, 2026-11-19. The stated reset 1:40pm KST is 04:40Z.
  const T0 = Date.UTC(2026, 10, 19, 1, 45, 22);
  const RESET = Date.UTC(2026, 10, 19, 4, 40, 0);
  save(id, (t) => {
    const x = t.nodes.find((m) => m.node_id === 'report');
    x.result.waiting_capacity.since = T0;
    x.result.waiting_capacity.first_since = T0;
    x.finished_at = T0;
    x.judge_attempts = 2; // JUDGE_ATTEMPTS_MAX already reached: a capacity park is not capped by it
  });
  const due = RESET + GRACE;
  const w = parkOf(nodeOf(id, 'report'));
  assert.equal(capacityWait({ reason: w.reason, since: w.since, firstSince: w.first_since, parks: w.parks }) + GRACE, due, 'the park reason carries the stated reset');
  assert.equal(mutateTask(id, (t) => tm.autoRejudge(t, due - 1000)), false);
  assert.equal(nodeOf(id, 'report').state, 'failed');
  assert.equal(tm.pendingRejudgeAt(load(id)), due);
  assert.equal(mutateTask(id, (t) => tm.autoRejudge(t, due + 1000)), true);
  const r = nodeOf(id, 'report');
  assert.equal(r.state, 'pending');
  assert.equal(r.judge_attempts, 2, 'no attempt spent');
  assert.ok(r.last_capacity, 'the cleared park is kept');
  assert.equal(r.last_capacity.parks, 1);
});

test('case 3: clearCapacity reaches a parked judge node by package, and the node is judged again', async () => {
  const id = seedTask([gateNode({ subgoal_id: 'P1' })]);
  const n = await judgeOnce(id, 'report', LIMIT);
  assert.ok(parkOf(n), 'parked');
  for (const other of ['S', 'P9']) {
    const resumed = mutateTask(id, (t) => tm.clearCapacity(t, other));
    assert.ok(!resumed.includes('report'), `${other} does not reach it`);
    assert.equal(nodeOf(id, 'report').state, 'failed');
  }
  const resumed = mutateTask(id, (t) => tm.clearCapacity(t, 'P1'));
  assert.ok(resumed.includes('report'), `P1 reaches it: ${JSON.stringify(resumed)}`);
  assert.equal(nodeOf(id, 'report').state, 'pending');
  assert.ok(!nodeOf(id, 'report').judge_attempts, 'attempts unchanged');
  // null is the tm_retry({reset_capacity:true}) path
  const id2 = seedTask([gateNode({ subgoal_id: 'P1' })]);
  assert.ok(parkOf(await judgeOnce(id2, 'report', LIMIT)), 'parked');
  const resumed2 = mutateTask(id2, (t) => tm.clearCapacity(t, null));
  assert.ok(resumed2.includes('report'), `null reaches it: ${JSON.stringify(resumed2)}`);
  assert.equal(nodeOf(id2, 'report').state, 'pending');
  // the reopened node is judged: a verdict now stands
  const before = calls();
  const after2 = await judgeOnce(id2, 'report', JSON.stringify({ stage_ok: true, reason: 'fine' }));
  assert.equal(calls(), before + 1, 'the judge ran again');
  assert.equal(after2.state, 'done');
});

test('case 4: a malformed reply still ends judge_failed and reopens at +60s with one attempt spent', async () => {
  const id = seedTask([gateNode()]);
  const n = await judgeOnce(id, 'report', '{"stage_ok": tru');
  assert.equal(n.state, 'failed');
  assert.equal(n.result.judge_failed, true);
  assert.match(String(n.result.reason), /not valid JSON/);
  assert.equal(n.result.waiting_capacity, undefined);
  assert.equal(mutateTask(id, (t) => tm.autoRejudge(t, n.finished_at + 60 * 1000)), true);
  const r = nodeOf(id, 'report');
  assert.equal(r.state, 'pending');
  assert.equal(r.judge_attempts, 1);
});

test('case 5: a valid verdict that quotes the limit text is a verdict', async () => {
  const id = seedTask([gateNode()]);
  const n = await judgeOnce(id, 'report', JSON.stringify({ stage_ok: false, reason: 'the driver hit your 5-hour limit wording is handled' }));
  assert.equal(n.result.waiting_capacity, undefined);
  assert.notEqual(n.result.judge_failed, true);
});

test('case 6: an integrate node whose judge replies with the limit text parks, and clearCapacity(null) reopens it', async () => {
  const id = seedTask([integrateNode()]);
  const n = await judgeOnce(id, 'integrate:2', LIMIT);
  assert.equal(n.state, 'failed');
  const w = n.result.waiting_capacity;
  assert.ok(w, `integrate result carries waiting_capacity: ${JSON.stringify(n.result)}`);
  assert.ok(String(w.reason).includes('hit your 5-hour limit'), w.reason);
  assert.equal(w.parks, 1);
  assert.doesNotMatch(String(n.result.reason), /not valid JSON/);
  assert.ok(!n.judge_attempts, 'no attempt spent');
  assert.ok(ledger(id).some((e) => e.event === 'failure_classified' && e.node_id === 'integrate:2' && e.failure_kind === 'capacity'));
  // the incident's node has no subgoal_id: tm_retry({reset_capacity:true}) passes no package
  const resumed = mutateTask(id, (t) => tm.clearCapacity(t, null));
  assert.ok(resumed.includes('integrate:2'), `reset_capacity reopens it: ${JSON.stringify(resumed)}`);
  assert.equal(nodeOf(id, 'integrate:2').state, 'pending');
});

test('case 7: before the due instant nothing respawns, reshapes, replans or rejudges a parked node', async () => {
  const id = seedTask([critiqueNode(), integrateNode()]);
  // no stated reset: since = now, so the wait is 30 min + grace
  setReply(LIMIT_NO_RESET);
  await daemon.stepOnce(id);
  const parked = ['critique', 'integrate:2'].map((nid) => nodeOf(id, nid));
  for (const n of parked) {
    assert.equal(n.state, 'failed', n.node_id);
    assert.ok(n.result.waiting_capacity, `${n.node_id} parked: ${JSON.stringify(n.result)}`);
    assert.ok(dueOf(n.result.waiting_capacity) - Date.now() >= 10 * MIN, `${n.node_id} due at least 10 minutes ahead`);
  }
  const count = load(id).nodes.length;
  const ran = calls();
  assert.equal(mutateTask(id, (t) => tm.autoRepair(t)), false, 'autoRepair');
  assert.equal(mutateTask(id, (t) => tm.autoRetryPackages(t)), false, 'autoRetryPackages');
  assert.equal(mutateTask(id, (t) => tm.autoReshape(t)), false, 'autoReshape');
  await daemon.stepOnce(id);
  const after3 = load(id);
  assert.equal(after3.nodes.length, count, 'no node added');
  for (const nid of ['critique', 'integrate:2']) {
    const n = after3.nodes.find((x) => x.node_id === nid);
    assert.equal(n.state, 'failed', nid);
    assert.ok(n.result && n.result.waiting_capacity, `${nid} keeps its park`);
  }
  assert.equal(calls(), ran, 'the judge was not invoked again');
});

test('case 8: a parked critique at the attempts cap is held by judgeStuck and keeps the daemon alive', async () => {
  const id = seedTask([critiqueNode()]);
  setReply(LIMIT_NO_RESET);
  await daemon.stepOnce(id);
  assert.ok(nodeOf(id, 'critique').result.waiting_capacity, 'parked');
  save(id, (t) => { t.nodes.find((x) => x.node_id === 'critique').judge_attempts = 2; });
  const before = JSON.stringify(nodeOf(id, 'critique'));
  assert.equal(mutateTask(id, (t) => tm.autoReshape(t)), false, 'autoReshape');
  assert.equal(JSON.stringify(nodeOf(id, 'critique')), before, 'node unchanged');
  const at = tm.pendingRejudgeAt(load(id));
  assert.notEqual(at, null, 'the daemon stays alive');
  assert.equal(at, dueOf(nodeOf(id, 'critique').result.waiting_capacity));
});

// ---------- the park as a hold, and its lift (F7-AC-13..18) ----------
//
// frozen_clock form used below: "Date.now pinned" - frozen(T, fn) replaces Date.now with a value
// the test sets (restored in finally); autoRejudge / autoResumeCapacity inside stepOnce read it.

const T0 = Date.UTC(2026, 10, 19, 1, 45, 22); // 10:45:22 KST
const DUE = Date.UTC(2026, 10, 19, 4, 40, 0) + GRACE; // LIMIT's "resets 1:40pm (Asia/Seoul)"

async function frozen(start, fn) {
  const realNow = Date.now;
  const was = process.env.HARNESS_CHILD_DRIVER;
  process.env.HARNESS_CHILD_DRIVER = 'node -e 0 --'; // the stub for every resumed driver
  let now = start;
  Date.now = () => now;
  try { return await fn((t) => { now = t; }); } finally {
    Date.now = realNow;
    if (was === undefined) delete process.env.HARNESS_CHILD_DRIVER; else process.env.HARNESS_CHILD_DRIVER = was;
  }
}
const events = (id, name) => ledger(id).filter((e) => e.event === name);
const starts = (id) => events(id, 'child_driver_spawned').length + events(id, 'child_driver_restarted').length;
const order = (id, names) => ledger(id).map((e) => e.event).filter((e) => names.includes(e));
const LIFT = ['judge_capacity_cleared', 'daemon_capacity_resumed', 'task_resumed'];
const engineHold = () => ({ reason: "waiting_capacity: You've hit your session limit", since: new Date(T0).toISOString(), by: 'engine' });
const personHold = () => ({ reason: 'look first', since: new Date(T0).toISOString(), by: 'person' });
const DEAD_PID = 2 ** 22 + 901;

// An unstated park taken `ago` ms before T0: due 33 minutes after it.
const driverPark = (ago) => ({ reason: "You've hit your session limit", since: T0 - ago, first_since: T0 - ago, parks: 1 });
const PAST_DUE = 2 * 60 * MIN;

// A running dispatch whose child run is open, its driver dead, parked on the provider's limit.
function parkedDispatch(p, ago) {
  const wt = mkdtempSync(join(tmpdir(), 'judge-cap-child-'));
  scratch.push(wt);
  mkdirSync(join(wt, '.teams_output', 'broker', 'runs'), { recursive: true });
  const run_id = `child-${p}`;
  writeFileSync(join(wt, '.teams_output', 'broker', 'runs', `${run_id}.json`), JSON.stringify({ run_id, flow: 'develop', max_retries: 2, cwd: wt, spec: { subgoals: [{ id: 'U1', title: 'unit' }] }, nodes: [graph.node('implement:U1:1', 'implement', [], { state: 'pending', subgoal_id: 'U1' })] }));
  return graph.node(`dispatch:${p}:1`, 'dispatch', ['shape'], { subgoal_id: p, state: 'running', child: { run_id, cwd: wt, driver: { pid: DEAD_PID, restarts: [], started_at: T0 - ago }, waiting_capacity: driverPark(ago) } });
}

// A size-S task whose one harness driver is dead and parked.
function seedParkedS(extra) {
  const id = seedTask([]);
  save(id, (t) => {
    t.size = 'S';
    t.harness_run = { cwd: t.cwd, opened_at: T0 - PAST_DUE, report_path: join(tm.taskDir(id), 'harness-report.md'), run: null, driver: { pid: DEAD_PID, restarts: [], started_at: T0 - PAST_DUE }, waiting_capacity: driverPark(PAST_DUE) };
    Object.assign(t, extra);
  });
  return id;
}

test('a judge park on an idle task holds it: waiting_capacity, engine, one task_held; a standing hold is kept', async () => {
  const id = seedTask([gateNode()]);
  await frozen(T0, async () => {
    const n = await judgeOnce(id, 'report', LIMIT);
    const { hold } = load(id);
    assert.deepEqual(Object.keys(hold).sort(), ['by', 'reason', 'since']);
    assert.equal(hold.reason, `waiting_capacity: ${parkOf(n).reason}`.slice(0, 300));
    assert.equal(hold.by, 'engine');
    assert.ok(!Number.isNaN(Date.parse(hold.since)), hold.since); // setHold reads new Date(), which the pin leaves alone
    assert.equal(events(id, 'task_held').length, 1);
    assert.deepEqual(order(id, ['judge_capacity', 'task_held']), ['judge_capacity', 'task_held']);
  });
  // The hold lands while the judge is running (a person's hold ends a tick before any judge starts,
  // so it can only meet a park this way); the verdict is the park.
  // The first pass, with no standing hold, is the control of the two that follow.
  for (const standing of [null, { reason: 'budget_stopped', since: new Date(T0).toISOString(), by: 'engine' }, personHold()]) {
    const other = seedTask([gateNode()]);
    await daemon.stepOnce(other, {
      judge: async () => {
        if (standing) mutateTask(other, (t) => { t.hold = { ...standing }; });
        return { stage_ok: false, judge_failed: true, reason: LIMIT, waiting_capacity: { reason: LIMIT, since: T0, first_since: T0, parks: 1 } };
      },
    });
    assert.ok(parkOf(nodeOf(other, 'report')), 'the park was applied');
    if (standing) assert.deepEqual(load(other).hold, standing, standing.reason);
    else assert.equal(load(other).hold.reason, `waiting_capacity: ${LIMIT}`, 'control');
    assert.equal(events(other, 'task_held').length, standing ? 0 : 1, standing ? standing.reason : 'control');
  }
});

// Control for the "nothing happens" asserts: the next test, the same fixture at the due tick.
test('before the reset three daemon ticks start nothing and spend no attempt; a re-park on the same instant counts up', async () => {
  const id = seedTask([gateNode()]);
  await frozen(T0, async (at) => {
    await judgeOnce(id, 'report', LIMIT);
    const ran = calls();
    for (const t of [T0 + MIN, T0 + 60 * MIN, DUE - 1000]) {
      at(t);
      assert.equal(await daemon.stepOnce(id), false);
    }
    const task = load(id);
    const n = task.nodes.find((x) => x.node_id === 'report');
    assert.notEqual(n.final, true);
    // taskState is what the daemon reads: the raw graph state says blocked, and the scheduled
    // re-judge turns it back into running.
    assert.equal(tm.taskState(task).state, 'running');
    assert.equal(tm.pendingRejudgeAt(task), DUE);
    assert.equal(calls(), ran);
    assert.equal(starts(id), 0);
    assert.ok(!n.judge_attempts);
    assert.equal(events(id, 'daemon_rejudge').length, 0);
    assert.equal(events(id, 'judge_capacity_cleared').length, 0);
    // cleared by hand before the instant, the same reply parks the same wait again
    at(T0 + 61 * MIN);
    mutateTask(id, (t) => tm.clearCapacity(t, null));
    await daemon.stepOnce(id);
    const w = parkOf(nodeOf(id, 'report'));
    assert.equal(w.first_since, T0);
    assert.equal(w.parks, 2);
    assert.equal(calls(), ran + 1);
  });
});

test('at the due tick a parked judge reopens once, is judged once, and the hold is lifted after judge_capacity_cleared', async () => {
  const id = seedTask([gateNode()]);
  await frozen(T0, async (at) => {
    await judgeOnce(id, 'report', LIMIT);
    const ran = calls();
    setReply(JSON.stringify({ stage_ok: true, reason: 'fine' }));
    at(DUE - 1000);
    await daemon.stepOnce(id);
    assert.equal(events(id, 'judge_capacity_cleared').length, 0, 'not earlier');
    assert.ok(load(id).hold, 'still held');
    at(DUE);
    await daemon.stepOnce(id);
    assert.equal(events(id, 'judge_capacity_cleared').length, 1);
    assert.equal(calls(), ran + 1, 'exactly one judge');
    assert.equal(nodeOf(id, 'report').state, 'done');
    assert.equal(load(id).hold, undefined);
    assert.deepEqual(order(id, LIFT), ['judge_capacity_cleared', 'task_resumed']);
  });
});

test('a parked dispatch resumes at the due tick only: one daemon_capacity_resumed, one spawn, then task_resumed', async () => {
  const id = seedTask([parkedDispatch('P1', 0)]);
  save(id, (t) => { t.hold = engineHold(); });
  await frozen(T0 + 33 * MIN - 1000, async (at) => {
    await daemon.stepOnce(id);
    assert.equal(events(id, 'daemon_capacity_resumed').length, 0, 'not earlier');
    assert.equal(starts(id), 0);
    assert.ok(load(id).hold);
    at(T0 + 33 * MIN);
    await daemon.stepOnce(id);
    assert.equal(events(id, 'daemon_capacity_resumed').length, 1);
    assert.equal(starts(id), 1);
    assert.equal(load(id).hold, undefined);
    assert.deepEqual(order(id, LIFT), ['daemon_capacity_resumed', 'task_resumed']);
  });
  // two holders, one due: the lift follows any resume, as shipped, though P2 is still parked
  const two = seedTask([parkedDispatch('P1', PAST_DUE), parkedDispatch('P2', 0)]);
  save(two, (t) => { t.hold = engineHold(); });
  await frozen(T0, async () => {
    await daemon.stepOnce(two);
    assert.equal(events(two, 'daemon_capacity_resumed').length, 1);
    assert.ok(nodeOf(two, 'dispatch:P2:1').child.waiting_capacity);
    assert.equal(load(two).hold, undefined);
  });
});

test('a parked judge reopened by a same-package dispatch resume: one task_resumed, before daemon_capacity_resumed', async () => {
  const parkedJudge = gateNode({ subgoal_id: 'P1', state: 'failed', finished_at: T0, result: { stage_ok: false, judge_failed: true, reason: LIMIT, waiting_capacity: { reason: LIMIT, since: T0, first_since: T0, parks: 1 } } });
  const id = seedTask([parkedDispatch('P1', PAST_DUE), parkedJudge]);
  save(id, (t) => { t.hold = engineHold(); });
  setReply(JSON.stringify({ stage_ok: true, reason: 'fine' }));
  await frozen(T0, async () => { // the judge's own park is not due: only clearCapacity can reopen it
    await daemon.stepOnce(id);
    assert.deepEqual(order(id, LIFT), ['judge_capacity_cleared', 'task_resumed', 'daemon_capacity_resumed']);
    assert.equal(load(id).hold, undefined);
  });
});

// Each stop case has its control: the same fixture without budget_stopped resumes on that tick.
// Protecting path: autoResumeCapacity's `if (task.budget_stopped) return false` (taskmanager-repair.mjs).
// A parked judge is not asserted here: autoRejudge has no budget_stopped guard (F1 hand-off).
test('under budget_stopped a due dispatch or size-S park is not resumed and nothing starts (control: without the stop it is)', async () => {
  const stop = { budget_stopped: { at: T0, spend: 0, skipped_packages: [] }, hold: { reason: 'budget_stopped', since: new Date(T0).toISOString(), by: 'engine' } };
  const fixtures = {
    dispatch: (extra) => { const id = seedTask([parkedDispatch('P1', PAST_DUE)]); save(id, (t) => { Object.assign(t, extra); }); return id; },
    S: (extra) => seedParkedS(extra),
  };
  for (const [name, seed] of Object.entries(fixtures)) {
    await frozen(T0, async () => {
      const control = seed({});
      await daemon.stepOnce(control);
      assert.equal(events(control, 'daemon_capacity_resumed').length, 1, `${name} control resumes`);
      assert.equal(starts(control), 1, `${name} control starts one driver`);
      const id = seed(structuredClone(stop));
      await daemon.stepOnce(id);
      assert.equal(events(id, 'daemon_capacity_resumed').length, 0, name);
      assert.equal(starts(id), 0, name);
      assert.equal(load(id).hold.reason, 'budget_stopped', name);
    });
  }
});

// Protecting path, both cases: the personHeld early return in stepOnceInner (daemon.mjs, `if
// (personHeld(t)) return`), which runs before autoRejudge and autoResumeCapacity. autoResumeCapacity
// itself has no personHeld check; the judge reopen path is autoRejudge.
test('person hold is never cleared by autoResumeCapacity', async () => {
  // dispatch park
  const dispatch = () => seedTask([parkedDispatch('P1', PAST_DUE)]);
  // judge park, already due
  const judged = () => seedTask([gateNode({ state: 'failed', finished_at: T0 - PAST_DUE, result: { stage_ok: false, judge_failed: true, reason: LIMIT_NO_RESET, waiting_capacity: { reason: LIMIT_NO_RESET, since: T0 - PAST_DUE, first_since: T0 - PAST_DUE, parks: 1 } } })]);
  setReply(JSON.stringify({ stage_ok: true, reason: 'fine' }));
  for (const [name, seed, resumeEvent] of [['dispatch', dispatch, 'daemon_capacity_resumed'], ['judge', judged, 'judge_capacity_cleared']]) {
    await frozen(T0, async () => {
      const control = seed();
      const before = calls();
      await daemon.stepOnce(control);
      assert.equal(events(control, resumeEvent).length, 1, `${name} control resumes`);
      assert.equal(starts(control) + calls() - before, 1, `${name} control starts one process`);
      const id = seed();
      const hold = personHold();
      save(id, (t) => { t.hold = hold; });
      const ran = calls();
      await daemon.stepOnce(id);
      assert.deepEqual(load(id).hold, hold, name);
      for (const e of ['task_resumed', 'daemon_capacity_resumed', 'judge_capacity_cleared']) assert.equal(events(id, e).length, 0, `${name} ${e}`);
      assert.equal(starts(id), 0, name);
      assert.equal(calls(), ran, `${name}: no judge call`);
    });
  }
});
