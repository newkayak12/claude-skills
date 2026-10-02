#!/usr/bin/env node
// test-store-interleave.mjs - claim before side effects (2026-10-02 task-store review, U3).
//
// Two in-process callers race on one node through the `__storeHooks.afterClaim` seam: the hook
// fires once, after the claim transaction committed and before the effect (git worktree add,
// createRun, prepareIntegration, foldChild's commit) runs, so whatever the hook calls is exactly
// the second caller arriving in that window. Before the claim, both callers saw the same
// `pending` dispatch on their own snapshot and both opened a child (v0.26.3: daemon + tm_submit
// double-folded one dispatch; only the git index.lock retry was ever fixed).
//
// HARNESS_TEST_NO_DAEMON (not NO_DRIVER): openChild records child_driver_spawned only when it
// spawns a driver, so the driver is a stub (HARNESS_CHILD_DRIVER) and the count means something.
//
//   node --test teams/scripts/test-store-interleave.mjs

process.env.TEAMS_RUNS_DIR ??= 'off';
process.env.TEAMS_VIEW = '0';
process.env.HARNESS_TEST_NO_DAEMON = '1';
delete process.env.HARNESS_TEST_NO_DRIVER;
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync, existsSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = mkdtempSync(join(tmpdir(), 'tm-interleave-root-'));
process.env.HARNESS_TASKS_DIR = ROOT;
const STUB_DIR = mkdtempSync(join(tmpdir(), 'tm-interleave-drv-'));
writeFileSync(join(STUB_DIR, 'driver.mjs'), "setTimeout(() => {}, 3000);\n");
process.env.HARNESS_CHILD_DRIVER = `node ${join(STUB_DIR, 'driver.mjs')}`;

const tm = await import(join(HERE, '..', 'mcp', 'taskmanager.mjs'));
const store = await import(join(HERE, '..', 'mcp', 'store.mjs'));
const graph = await import(join(HERE, '..', 'mcp', 'graph.mjs'));
const daemon = await import(join(HERE, '..', 'mcp', 'daemon.mjs'));
const { callTool, advanceDispatches, prepareReadyIntegrations, foldDispatch, __storeHooks } = tm;

const scratch = [];
process.on('exit', () => {
  for (const d of [ROOT, STUB_DIR, ...scratch]) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best-effort */ } }
});

const git = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });

function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'tm-interleave-repo-'));
  scratch.push(dir);
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@t');
  git(dir, 'config', 'user.name', 't');
  writeFileSync(join(dir, 'a.txt'), 'x\n');
  writeFileSync(join(dir, '.gitignore'), '.teams_output/\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'init');
  return dir;
}

let seq = 0;
const PKG = { id: 'P1', title: 'module a', flow: 'develop', brief: 'change a.txt', acceptance: ['a.txt says a'], touches: ['a.txt'], deps: [] };

// A size-L task past critique with one package: the fixture every test starts from. `nodes` are
// appended after the done planning nodes.
function seedTask(cwd, nodes, extra = {}) {
  const run_id = `0000${String(++seq).padStart(4, '0')}-1111-2222-3333-444444444444`;
  const path = tm.taskPath(run_id);
  mkdirSync(dirname(path), { recursive: true });
  const done = (id, stage, deps) => graph.node(id, stage, deps, { state: 'done', result: { stage_ok: true } });
  writeFileSync(path, JSON.stringify({
    run_id, kind: 'task', store_path: path, cwd, request: 'r', created_at: Date.now(),
    flow: 'develop', flow_chosen: 'develop', size: 'L', max_retries: 2, driver_restarts: 2,
    base_ref: null, team: { opts: { max_parallel_teams: 4 } },
    spec: { acceptance: ['a'], packages: [PKG] },
    nodes: [done('size', 'size', []), done('shape', 'shape', ['size']), done('critique', 'critique', ['shape']), ...nodes],
    ...extra,
  }, null, 2));
  return run_id;
}

const load = (id) => JSON.parse(readFileSync(tm.taskPath(id), 'utf8'));
const nodeOf = (id, nodeId) => load(id).nodes.find((n) => n.node_id === nodeId);
const ledger = (id) => {
  const f = join(tm.taskDir(id), 'ledger.jsonl');
  return existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
};
const events = (id, ev, nodeId) => ledger(id).filter((e) => e.event === ev && (!nodeId || e.node_id === nodeId));

function readyDispatch(cwd) {
  return seedTask(cwd, [
    graph.node('dispatch:P1:1', 'dispatch', ['critique'], { subgoal_id: 'P1' }),
    graph.node('accept:P1:1', 'accept', ['dispatch:P1:1'], { subgoal_id: 'P1' }),
  ]);
}

// Child run files under every worktree of this task: one per createRun.
function childRunFiles(taskId) {
  const wts = join(tm.taskDir(taskId), 'worktrees');
  if (!existsSync(wts)) return [];
  const out = [];
  for (const w of readdirSync(wts)) {
    const runs = join(wts, w, '.teams_output', 'broker', 'runs');
    if (existsSync(runs)) for (const f of readdirSync(runs)) if (f.endsWith('.json')) out.push(join(runs, f));
  }
  return out;
}
const worktreesFor = (cwd, name) => git(cwd, 'worktree', 'list').stdout.split('\n').filter((l) => l.includes(`/worktrees/${name} `)).length;

// One-shot hook that also proves it ran outside any transaction, exactly once.
function hook(fn) {
  const h = { calls: 0, inTx: null, pending: [] };
  __storeHooks.afterClaim = (info) => {
    h.calls++;
    h.inTx = store.inTransaction();
    h.info = info;
    const p = fn(info);
    if (p && typeof p.then === 'function') h.pending.push(p.then((v) => ({ ok: v }), (e) => ({ err: e })));
  };
  return h;
}
function assertHook(h) {
  assert.equal(h.calls, 1, 'the afterClaim hook fires exactly once');
  assert.equal(h.inTx, false, 'the hook (and so the effect after it) runs outside the store lock');
  assert.equal(__storeHooks.afterClaim, null, 'the hook is one-shot');
}

function assertOneOpen(taskId, cwd) {
  assert.equal(childRunFiles(taskId).length, 1, `exactly one child run file: ${childRunFiles(taskId).join(', ')}`);
  assert.equal(events(taskId, 'child_driver_spawned', 'dispatch:P1:1').length, 1, 'exactly one child_driver_spawned');
  assert.equal(events(taskId, 'dispatch', 'dispatch:P1:1').length, 1, 'exactly one dispatch record');
  assert.equal(worktreesFor(cwd, 'P1'), 1, 'one worktree for P1');
  const n = nodeOf(taskId, 'dispatch:P1:1');
  assert.equal(n.state, 'running');
  assert.ok(n.child && n.child.run_id, 'the open was applied to the node');
  assert.equal(n.claim, undefined, 'claim deleted on apply');
  assert.equal(events(taskId, 'claim_lost').length, 0);
}

test('(b) daemon advanceDispatches and tm_next racing on one ready dispatch open exactly one child (daemon claims first)', async () => {
  const cwd = repo();
  const id = readyDispatch(cwd);
  const h = hook(() => callTool('tm_next', { task_id: id }));
  const opened = advanceDispatches(id);
  assertHook(h);
  const [r] = await Promise.all(h.pending);
  assert.ok(!r.err, r.err && r.err.stack);
  assert.equal(opened, 1);
  assert.ok(!(r.ok.ready || []).some((x) => x.node_id === 'dispatch:P1:1'), 'tm_next does not offer the claimed dispatch');
  assertOneOpen(id, cwd);
});

test('(b) daemon advanceDispatches and tm_next racing on one ready dispatch open exactly one child (tm_next claims first)', async () => {
  const cwd = repo();
  const id = readyDispatch(cwd);
  let inner = null;
  const h = hook(() => { inner = advanceDispatches(id); });
  const out = await callTool('tm_next', { task_id: id });
  assertHook(h);
  assert.equal(inner, 0, 'the daemon side found the dispatch claimed and opened nothing');
  assert.ok(out.children.some((c) => c.node_id === 'dispatch:P1:1' && c.run_id), JSON.stringify(out.children));
  assertOneOpen(id, cwd);
});

// The child's own run, settled and accepted, plus a change in its worktree to commit.
function settleChild(taskId) {
  const n = nodeOf(taskId, 'dispatch:P1:1');
  const file = join(n.child.cwd, '.teams_output', 'broker', 'runs', `${n.child.run_id}.json`);
  const run = JSON.parse(readFileSync(file, 'utf8'));
  run.nodes = [
    graph.node('gate:goal:1', 'gate', [], { subgoal_id: null, state: 'done', result: { stage_ok: true, accept: true, match_pct: 95, gaps: [] } }),
    graph.node('report', 'report', ['gate:goal:1'], { state: 'done', result: { stage_ok: true, handoff: 'child report' } }),
  ];
  writeFileSync(file, JSON.stringify(run, null, 2));
  appendFileSync(join(n.child.cwd, 'a.txt'), 'changed by P1\n');
  return n;
}

test('double fold: a second foldDispatch from afterClaim finishes nothing - one node_finish, one commit', async () => {
  const cwd = repo();
  const id = readyDispatch(cwd);
  assert.equal(advanceDispatches(id), 1);
  const n = settleChild(id);
  const base = Number(git(n.child.cwd, 'rev-list', '--count', 'HEAD').stdout.trim());
  let second = null;
  const h = hook(() => { second = foldDispatch(id, 'dispatch:P1:1', 'tm_submit'); });
  const first = foldDispatch(id, 'dispatch:P1:1', 'daemon');
  assertHook(h);
  assert.ok(second && second.busy, `the second fold saw the live claim: ${JSON.stringify(second)}`);
  assert.equal(first.state, 'done', JSON.stringify(first));
  assert.equal(events(id, 'node_finish', 'dispatch:P1:1').length, 1, 'exactly one node_finish');
  const after = nodeOf(id, 'dispatch:P1:1');
  assert.equal(after.claim, undefined);
  assert.ok(after.result.commit, 'the fold committed');
  assert.equal(after.result.commit, git(n.child.cwd, 'rev-parse', n.child.branch).stdout.trim(), 'the commit is the package branch head');
  assert.equal(Number(git(n.child.cwd, 'rev-list', '--count', n.child.branch).stdout.trim()), base + 1, 'one commit on the package branch');
  // Sequentially, the second caller gets the stored verdict back, no work repeated.
  const again = foldDispatch(id, 'dispatch:P1:1', 'tm_submit');
  assert.equal(again.idempotent, true, JSON.stringify(again));
  assert.equal(events(id, 'node_finish', 'dispatch:P1:1').length, 1);
  assert.equal(Number(git(n.child.cwd, 'rev-list', '--count', n.child.branch).stdout.trim()), base + 1);
});

// A delivered P1 (its branch exists) and a ready integrate.
function readyIntegrate(cwd) {
  const id = seedTask(cwd, []);
  const branch = `harness/test-${seq}/P1`;
  git(cwd, 'branch', branch);
  const t = load(id);
  t.nodes.push(
    graph.node('dispatch:P1:1', 'dispatch', ['critique'], { subgoal_id: 'P1', state: 'done', result: { stage_ok: true, accept: true }, child: { cwd, run_id: 'c1', branch } }),
    graph.node('accept:P1:1', 'accept', ['dispatch:P1:1'], { subgoal_id: 'P1', state: 'done', result: { stage_ok: true, accept: true, match_pct: 95 } }),
    graph.node('integrate:1', 'integrate', ['accept:P1:1'], { subgoal_id: null }),
  );
  writeFileSync(tm.taskPath(id), JSON.stringify(t, null, 2));
  return id;
}

test('integrate claim: a tm_submit of the integrate from afterClaim keeps its verdict; the late prepare is claim_lost', async () => {
  const cwd = repo();
  const id = readyIntegrate(cwd);
  const h = hook(() => callTool('tm_submit', { task_id: id, node_id: 'integrate:1', payload: { stage_ok: false, verified: false, reason: 'submitted meanwhile', checks: ['x -> y'] } }));
  prepareReadyIntegrations(id);
  assertHook(h);
  const [r] = await Promise.all(h.pending);
  assert.ok(!r.err, r.err && r.err.stack);
  const n = nodeOf(id, 'integrate:1');
  assert.notEqual(n.state, 'pending', 'the submitted verdict stands');
  assert.match(String(n.result && n.result.reason), /submitted meanwhile/);
  assert.equal(n.integration, undefined, 'nothing from the late prepare was written to the node');
  assert.equal(n.claim, undefined);
  assert.equal(events(id, 'claim_lost', 'integrate:1').length, 1, 'claim_lost recorded');
});

test('N1: the daemon judge pass and tm_next skip an integrate that is claimed but not yet prepared', async () => {
  const cwd = repo();
  const id = readyIntegrate(cwd);
  const judged = [];
  const judge = async (_task, n) => { judged.push(n.node_id); return { stage_ok: true, verified: true, checks: ['x -> y'] }; };
  let step = null;
  let innerNext = null;
  const h = hook(() => {
    step = daemon.stepOnce(id, { judge });
    innerNext = callTool('tm_next', { task_id: id });
  });
  const out = await callTool('tm_next', { task_id: id });
  assertHook(h);
  await step;
  const inner = await innerNext;
  assert.deepEqual(judged, [], 'the daemon judged nothing - the integrate had no integration yet');
  assert.ok(!inner.ready.some((x) => x.node_id === 'integrate:1'), 'tm_next in the window does not offer it');
  assert.equal(events(id, 'claim_lost').length, 0);
  const n = nodeOf(id, 'integrate:1');
  assert.equal(n.state, 'pending');
  assert.ok(n.integration && n.integration.branch, 'prepared by the claimant');
  assert.equal(n.claim, undefined);
  assert.ok(out.ready.some((x) => x.node_id === 'integrate:1'), 'once prepared it is offered');
});

test('an effect that throws releases the claim, records claim_failed, and the dispatch is runnable again', () => {
  const cwd = repo();
  const id = readyDispatch(cwd);
  const h = hook(() => { throw new Error('boom between claim and open'); });
  assert.throws(() => advanceDispatches(id), /boom between claim and open/);
  assertHook(h);
  const n = nodeOf(id, 'dispatch:P1:1');
  assert.equal(n.state, 'pending');
  assert.equal(n.claim, undefined);
  assert.equal(events(id, 'claim_failed', 'dispatch:P1:1').length, 1);
  assert.equal(advanceDispatches(id), 1, 'opens on the next pass');
  assertOneOpen(id, cwd);
});

test('a claimed dispatch with no child yet reads as opening: tm_status, tm_board, and tm_submit say so', async () => {
  const cwd = repo();
  const id = readyDispatch(cwd);
  const h = hook(() => [callTool('tm_status', { task_id: id }), callTool('tm_board', { task_id: id }), callTool('tm_submit', { task_id: id, node_id: 'dispatch:P1:1' })]
    .reduce((p, q) => p.then((acc) => q.then((v) => [...acc, { ok: v }], (e) => [...acc, { err: e }])), Promise.resolve([])));
  advanceDispatches(id);
  assertHook(h);
  const [{ ok: [status, board, submit] }] = await Promise.all(h.pending);
  assert.ok(!status.err, status.err && status.err.stack);
  const sn = status.ok.nodes.find((x) => x.node_id === 'dispatch:P1:1');
  assert.equal(sn.opening, true, JSON.stringify(sn));
  assert.ok(!board.err, board.err && board.err.stack);
  const row = board.ok.stories.find((s) => s.id === 'P1');
  assert.equal(row.state, 'IN_PROGRESS');
  assert.equal(row.opening, true, JSON.stringify(row));
  assert.ok(submit.err, 'tm_submit refuses');
  assert.doesNotMatch(String(submit.err), /TypeError|Cannot read/);
  assert.match(String(submit.err.message), /still opening/);
  assertOneOpen(id, cwd);
});

test('a dead-owner claim on a running dispatch with no child is reclaimed and opened', () => {
  const cwd = repo();
  const id = seedTask(cwd, [
    graph.node('dispatch:P1:1', 'dispatch', ['critique'], { subgoal_id: 'P1', state: 'running', claim: { pid: 2147483646, token: 'dead-token', op: 'open', attempt: 1, at: Date.now() - 1000 } }),
    graph.node('accept:P1:1', 'accept', ['dispatch:P1:1'], { subgoal_id: 'P1' }),
  ]);
  assert.equal(advanceDispatches(id), 1);
  assert.equal(events(id, 'claim_reclaimed', 'dispatch:P1:1').length, 1);
  assertOneOpen(id, cwd);
});

test('a claim held by this pid with a token this process does not hold is stale, and a live other owner is skipped', () => {
  const cwd = repo();
  const id = seedTask(cwd, [
    graph.node('dispatch:P1:1', 'dispatch', ['critique'], { subgoal_id: 'P1', state: 'running', claim: { pid: process.pid, token: 'not-mine', op: 'open', attempt: 1, at: Date.now() } }),
    graph.node('accept:P1:1', 'accept', ['dispatch:P1:1'], { subgoal_id: 'P1' }),
  ]);
  assert.equal(advanceDispatches(id), 1, 'own pid, unknown token: a previous incarnation of this pid');
  assertOneOpen(id, cwd);

  const cwd2 = repo();
  const live = seedTask(cwd2, [
    graph.node('dispatch:P1:1', 'dispatch', ['critique'], { subgoal_id: 'P1', state: 'running', claim: { pid: process.ppid, token: 'theirs', op: 'open', attempt: 1, at: Date.now() } }),
    graph.node('accept:P1:1', 'accept', ['dispatch:P1:1'], { subgoal_id: 'P1' }),
  ]);
  assert.equal(advanceDispatches(live), 0, 'a live other owner keeps its claim');
  assert.equal(nodeOf(live, 'dispatch:P1:1').claim.token, 'theirs');
  assert.equal(childRunFiles(live).length, 0);
});

// ---------- goal repair 1: an open whose effect ran but whose apply did not land ----------
//
// openChild's effect (a child run file, a detached driver) is real the moment it returns. If the
// apply is then claim_lost, throws (ELOCKTIMEOUT), or the process dies before it, the node is
// reclaimed and opened again in the SAME worktree. Each case below must end with at most one live
// driver for P1's worktree and no child run that is neither the node's nor retired.

const { pidAlive } = await import(join(HERE, '..', 'mcp', 'proc.mjs'));
const LONG_STUB = join(STUB_DIR, 'driver-long.mjs');
writeFileSync(LONG_STUB, "setTimeout(() => {}, 30000);\n");
const spawnedPids = [];
process.on('exit', () => { for (const p of spawnedPids) { try { process.kill(-p, 'SIGKILL'); } catch { try { process.kill(p, 'SIGKILL'); } catch { /* gone */ } } } });

async function settlePids(pids, ms = 2000) {
  const end = Date.now() + ms;
  while (Date.now() < end && pids.some((p) => pidAlive(p))) await new Promise((r) => setTimeout(r, 25));
  return pids.filter((p) => pidAlive(p));
}
const runFile = (f) => JSON.parse(readFileSync(f, 'utf8'));

// Every child run file of the task is either the one the node holds or marked retired.
function assertNoOrphanRun(taskId) {
  const n = nodeOf(taskId, 'dispatch:P1:1');
  for (const f of childRunFiles(taskId)) {
    const r = runFile(f);
    if (n.child && r.run_id === n.child.run_id) continue;
    assert.ok(r.retired, `child run ${r.run_id} is neither the node's nor retired`);
  }
}

test('an open applied after the node moved (claim_lost): its driver is stopped, its child run retired, no dispatch ledger lines', async () => {
  const cwd = repo();
  const id = readyDispatch(cwd);
  let seen = null;
  __storeHooks.afterEffect = (info) => {
    seen = structuredClone(info.node);
    store.mutateTask(id, (t) => { const f = t.nodes.find((x) => x.node_id === 'dispatch:P1:1'); f.state = 'skipped'; });
  };
  assert.equal(advanceDispatches(id), 0);
  assert.equal(__storeHooks.afterEffect, null, 'afterEffect is one-shot');
  assert.ok(seen && seen.child && seen.child.driver && seen.child.driver.pid, 'the effect spawned a driver');
  spawnedPids.push(seen.child.driver.pid);
  assert.equal(events(id, 'claim_lost', 'dispatch:P1:1').length, 1);
  assert.deepEqual(await settlePids([seen.child.driver.pid]), [], 'the lost open\'s driver was stopped');
  const files = childRunFiles(id);
  assert.equal(files.length, 1);
  assert.ok(runFile(files[0]).retired, 'the lost open\'s child run is retired');
  assert.equal(events(id, 'dispatch', 'dispatch:P1:1').length, 0, 'no dispatch line for an open the node never got');
  assert.equal(events(id, 'child_driver_spawned', 'dispatch:P1:1').length, 0, 'no child_driver_spawned line for it either');
  assert.equal(events(id, 'open_undone', 'dispatch:P1:1').length, 1);
});

test('an open whose apply throws (ELOCKTIMEOUT) is adopted by the next pass: one child run, one live driver', async () => {
  const cwd = repo();
  const id = readyDispatch(cwd);
  let seen = null;
  let lock = null;
  const prev = process.env.TEAMS_LOCK_TIMEOUT_MS;
  __storeHooks.afterEffect = (info) => {
    seen = structuredClone(info.node);
    lock = store.acquireLock(tm.taskPath(id));
    process.env.TEAMS_LOCK_TIMEOUT_MS = '50';
  };
  try {
    assert.throws(() => advanceDispatches(id), (e) => e.code === 'ELOCKTIMEOUT');
  } finally {
    store.releaseLock(lock);
    if (prev === undefined) delete process.env.TEAMS_LOCK_TIMEOUT_MS; else process.env.TEAMS_LOCK_TIMEOUT_MS = prev;
  }
  spawnedPids.push(seen.child.driver.pid);
  assert.equal(advanceDispatches(id), 0, 'nothing new is opened: the existing child is adopted');
  assertOneOpen(id, cwd);
  const n = nodeOf(id, 'dispatch:P1:1');
  assert.equal(n.child.run_id, seen.child.run_id);
  assert.equal(n.child.driver.pid, seen.child.driver.pid);
  assert.equal(events(id, 'open_adopted', 'dispatch:P1:1').length, 1);
});

// A real crash: a second node process runs the open and exits inside afterEffect, after openChild
// returned (its detached driver lives on) and before the apply.
function crashOpen(id) {
  const script = join(STUB_DIR, `crash-${id}.mjs`);
  writeFileSync(script, [
    `const tm = await import(${JSON.stringify(join(HERE, '..', 'mcp', 'taskmanager.mjs'))});`,
    "tm.__storeHooks.afterEffect = (info) => { process.stdout.write(JSON.stringify(info.node.child) + '\\n'); process.exit(9); };",
    `tm.advanceDispatches(${JSON.stringify(id)});`,
  ].join('\n'));
  const r = spawnSync(process.execPath, [script], { encoding: 'utf8', env: { ...process.env, HARNESS_CHILD_DRIVER: `node ${LONG_STUB}` } });
  assert.equal(r.status, 9, r.stderr);
  const child = JSON.parse(r.stdout.trim().split('\n').pop());
  spawnedPids.push(child.driver.pid);
  assert.ok(pidAlive(child.driver.pid), 'the crashed process left its driver running');
  return child;
}

test('crash between the open effect and its apply: the next pass adopts the live driver instead of opening a second', async () => {
  const cwd = repo();
  const id = readyDispatch(cwd);
  const child = crashOpen(id);
  assert.equal(nodeOf(id, 'dispatch:P1:1').child, undefined, 'the crash left the node opening');
  assert.equal(advanceDispatches(id), 0);
  assertOneOpen(id, cwd);
  const n = nodeOf(id, 'dispatch:P1:1');
  assert.equal(n.child.run_id, child.run_id);
  assert.equal(n.child.driver.pid, child.driver.pid);
  assert.ok(pidAlive(child.driver.pid), 'the adopted driver keeps running');
  assertNoOrphanRun(id);
});

test('crash mid-effect (open intent without the finished fields): the old driver is stopped and its child run retired before reopening', async () => {
  const cwd = repo();
  const id = readyDispatch(cwd);
  const child = crashOpen(id);
  // The state a crash right after the driver spawn but before openChild returned leaves.
  const dir = join(tm.taskDir(id), 'opening');
  const [f] = readdirSync(dir);
  const intent = JSON.parse(readFileSync(join(dir, f), 'utf8'));
  delete intent.fields;
  delete intent.ledger;
  writeFileSync(join(dir, f), JSON.stringify(intent));
  assert.equal(advanceDispatches(id), 1, 'reopened');
  const n = nodeOf(id, 'dispatch:P1:1');
  spawnedPids.push(n.child.driver.pid);
  assert.notEqual(n.child.run_id, child.run_id);
  assert.deepEqual(await settlePids([child.driver.pid]), [], 'the orphan driver was stopped');
  assert.equal(childRunFiles(id).length, 2);
  assertNoOrphanRun(id);
  assert.equal(events(id, 'open_undone', 'dispatch:P1:1').length, 1);
});

// ---------- U4: every tm_* handler writes task.json through mutateTask ----------
//
// Strict is the default (U6): a saveRun of a task outside a transaction throws /outside
// mutateTask/ with no flag set, so a handler that still writes on its own snapshot fails HERE, by
// name. `strictly` sets nothing any more - it only marks the tests that depend on that default.

async function strictly(fn) {
  assert.equal(process.env.HARNESS_STORE_STRICT, undefined, 'no strict flag: the default is under test');
  return fn();
}

const ok = (payload) => ({ stage_ok: true, evidence: 'e', checks: ['ok -> looked fine'], ...payload });
const SHAPE2 = {
  acceptance: ['both modules build together'],
  packages: [
    { id: 'P1', title: 'module a', flow: 'develop', brief: 'change a.txt', acceptance: ['a.txt says a'], touches: ['a.txt'], deps: [] },
    { id: 'P2', title: 'module b', flow: 'develop', brief: 'change b.txt using a', acceptance: ['b.txt says b'], touches: ['b.txt'], deps: ['P1'] },
  ],
};
const ASK_Q = { question: 'Which storage?', options: ['sqlite', 'files'], default: 'sqlite' };

// Before shape: size done, shape pending, one EPIC-level ask card waiting on the requester.
function preShapeWithAsk(cwd, extra = {}) {
  const done = (id, stage, deps) => graph.node(id, stage, deps, { state: 'done', result: { stage_ok: true } });
  return seedTask(cwd, [], {
    spec: null, interactive: true,
    nodes: [
      done('size', 'size', []),
      graph.node('shape', 'shape', ['size']),
      graph.node('critique', 'critique', ['shape']),
      graph.node('ask:1', 'ask', [], { state: 'waiting_human', ask_owner: 'EPIC', questions: [ASK_Q], waiting_since: Date.now() }),
    ],
    ...extra,
  });
}

test('(a) a stale snapshot written after a concurrent tm_submit does not revert the node or drop spec.packages / task.decisions', async () => {
  const cwd = repo();
  const id = preShapeWithAsk(cwd);
  const stale = load(id); // what a writer that started before the submits holds
  await strictly(async () => {
    const v = await callTool('tm_submit', { task_id: id, node_id: 'shape', payload: ok({ ...SHAPE2, handoff: 's' }) });
    assert.equal(v.state, 'done', JSON.stringify(v));
    const h = await callTool('tm_submit', { task_id: id, key: `E-${id.slice(0, 8)}/TASK/ask:1`, payload: { decisions: [{ question: ASK_Q.question, chose: 'files' }] } });
    assert.equal(h.state, 'done', JSON.stringify(h));
    stale.nodes.find((n) => n.node_id === 'critique').note = 'stale writer was here';
    assert.throws(() => graph.saveRun(stale), /outside mutateTask/);
  });
  const t = load(id);
  assert.equal(t.nodes.find((n) => n.node_id === 'shape').state, 'done', 'the submitted node is not reverted');
  assert.deepEqual((t.spec && t.spec.packages || []).map((p) => p.id), ['P1', 'P2'], 'spec.packages intact');
  assert.ok((t.decisions || []).some((d) => d.question === ASK_Q.question && d.chose === 'files'), `task.decisions intact: ${JSON.stringify(t.decisions)}`);
  assert.equal(t.nodes.find((n) => n.node_id === 'critique').note, undefined, 'nothing of the stale snapshot landed');
});

test('a quiet task: tm_status, tm_board and tm_wait leave task.json mtime unchanged', async () => {
  const cwd = repo();
  const id = readyDispatch(cwd);
  const { statSync } = await import('node:fs');
  const before = statSync(tm.taskPath(id)).mtimeMs;
  await new Promise((r) => setTimeout(r, 25));
  await callTool('tm_status', { task_id: id });
  await callTool('tm_board', { task_id: id });
  await callTool('tm_wait', { task_id: id, max_ms: 0 });
  assert.equal(statSync(tm.taskPath(id)).mtimeMs, before, 'no rewrite of a task nothing changed in');
});

// A size-S task on the development harness whose driver is dead with no restart left.
function harnessTask(cwd) {
  return seedTask(cwd, [], {
    size: 'S', spec: null, driver_restarts: 0,
    nodes: [graph.node('size', 'size', [], { state: 'done', result: { stage_ok: true, size: 'S' } })],
    harness_run: { cwd, run: null, driver: { pid: 2147483646, log: join(cwd, 'no-such.log'), restarts: [] } },
  });
}

// One row per writing handler: seed -> call under strict -> the write landed. A handler whose
// write still goes through a bare saveRun throws /outside mutateTask/ here.
const HANDLERS = [
  {
    name: 'callTool prelude (expireAsks on an expired ask)',
    seed: (cwd) => preShapeWithAsk(cwd, { ask_timeout: 1000 }),
    prep: (id) => { const t = load(id); t.nodes.find((n) => n.node_id === 'ask:1').waiting_since = Date.now() - 60000; writeFileSync(tm.taskPath(id), JSON.stringify(t)); },
    call: (id) => callTool('tm_status', { task_id: id }),
    check: (id) => assert.equal(nodeOf(id, 'ask:1').state, 'done'),
  },
  {
    name: 'tm_next (enforceBudget stops an over-timebox task)',
    seed: (cwd) => seedTask(cwd, [graph.node('dispatch:P1:1', 'dispatch', ['critique'], { subgoal_id: 'P1' })],
      { team: { opts: { max_parallel_teams: 4, timebox_minutes: 1 } }, created_at: Date.now() - 10 * 60000 }),
    call: (id) => callTool('tm_next', { task_id: id }),
    check: (id) => assert.ok(load(id).budget_stopped, 'budget_stopped written'),
  },
  {
    name: 'tm_submit (a judging node)',
    seed: (cwd) => preShapeWithAsk(cwd),
    call: (id) => callTool('tm_submit', { task_id: id, node_id: 'shape', payload: ok({ ...SHAPE2, handoff: 's' }) }),
    check: (id) => assert.equal(nodeOf(id, 'shape').state, 'done'),
  },
  {
    name: 'tm_submit({key}) (a TASK-level card)',
    seed: (cwd) => preShapeWithAsk(cwd),
    call: (id) => callTool('tm_submit', { task_id: id, key: `E-${id.slice(0, 8)}/TASK/ask:1`, payload: { decisions: [{ question: ASK_Q.question, chose: 'files' }] } }),
    check: (id) => assert.equal(nodeOf(id, 'ask:1').state, 'done'),
  },
  {
    name: 'tm_retry (a failed shape)',
    seed: (cwd) => {
      const done = (nid, stage, deps) => graph.node(nid, stage, deps, { state: 'done', result: { stage_ok: true } });
      return seedTask(cwd, [], { spec: null, nodes: [done('size', 'size', []),
        graph.node('shape', 'shape', ['size'], { state: 'failed', result: { stage_ok: false, reason: 'bad shape' } }),
        graph.node('critique', 'critique', ['shape'], { state: 'unreachable' })] });
    },
    call: (id) => callTool('tm_retry', { task_id: id }),
    check: (id) => assert.ok(load(id).nodes.some((n) => n.node_id === 'shape:2'), 'shape:2 opened'),
  },
  {
    name: 'tm_file (a user STORY)',
    seed: (cwd) => seedTask(cwd, [
      graph.node('dispatch:P1:1', 'dispatch', ['critique'], { subgoal_id: 'P1', state: 'done', result: { stage_ok: true, accept: true } }),
      graph.node('accept:P1:1', 'accept', ['dispatch:P1:1'], { subgoal_id: 'P1', state: 'done', result: { stage_ok: true, accept: true } }),
      graph.node('integrate:1', 'integrate', ['accept:P1:1'], { subgoal_id: null }),
      graph.node('gate:goal:1', 'gate', ['integrate:1'], { subgoal_id: null }),
    ]),
    call: (id) => callTool('tm_file', { task_id: id, stories: [{ title: 'fix b', brief: 'b is broken', acceptance: ['b works'], touches: ['b.txt'] }] }),
    check: (id) => assert.ok(load(id).spec.packages.length > 1, 'a package was filed'),
  },
  {
    name: 'tm_assign (a STORY pin before dispatch)',
    seed: (cwd) => readyDispatch(cwd),
    call: (id) => callTool('tm_assign', { task_id: id, key: `E-${id.slice(0, 8)}/P1`, to: 'human' }),
    check: (id) => assert.equal(load(id).spec.packages[0].assignee.by, 'user'),
  },
  {
    name: 'tm_status harness branch (serviceHarnessRun marks a spent driver exhausted)',
    seed: harnessTask,
    call: (id) => callTool('tm_status', { task_id: id }),
    check: (id) => assert.equal(load(id).harness_run.exhausted, true),
  },
  {
    name: 'tm_next harness branch (toolNextHarness)',
    seed: harnessTask,
    call: (id) => callTool('tm_next', { task_id: id }),
    check: (id) => assert.equal(load(id).harness_run.exhausted, true),
  },
  {
    name: 'tm_open (createTask)',
    seed: () => null,
    call: (_id, cwd) => callTool('tm_open', { request: 'add a line to a.txt', cwd, size: 'L' }),
    check: (_id, out) => assert.ok(out.task_id && existsSync(tm.taskPath(out.task_id)), JSON.stringify(out)),
  },
  {
    name: 'tm_run (createTask + pinned size)',
    seed: () => null,
    call: (_id, cwd) => callTool('tm_run', { request: 'add a line to a.txt', cwd, size: 'L' }),
    check: (_id, out) => assert.equal(load(out.task_id).nodes.find((n) => n.node_id === 'size').state, 'done'),
  },
];

for (const h of HANDLERS) {
  test(`strict-scoped: ${h.name} writes task.json through mutateTask`, async () => {
    const cwd = repo();
    const id = h.seed(cwd);
    if (h.prep) h.prep(id);
    const out = await strictly(() => h.call(id, cwd));
    h.check(id, out);
  });
}

test('tm_submit: the tm_submit ledger line of a refused dispatch payload is not written', async () => {
  const cwd = repo();
  const id = readyDispatch(cwd);
  const t = load(id);
  t.nodes.find((n) => n.node_id === 'dispatch:P1:1').state = 'running';
  writeFileSync(tm.taskPath(id), JSON.stringify(t));
  await assert.rejects(callTool('tm_submit', { task_id: id, node_id: 'dispatch:P1:1', payload: { stage_ok: true } }), /takes no payload/);
  assert.equal(events(id, 'tm_submit').length, 0, 'no phantom tm_submit');
});

test('tm_assign (former save-then-throw): a STORY pin whose child run file is missing keeps the pin and still throws', async () => {
  const cwd = repo();
  const id = seedTask(cwd, [
    graph.node('dispatch:P1:1', 'dispatch', ['critique'], { subgoal_id: 'P1', state: 'running', child: { cwd, run_id: 'gone-run', branch: 'x' } }),
  ]);
  await assert.rejects(callTool('tm_assign', { task_id: id, key: `E-${id.slice(0, 8)}/P1`, to: 'human' }), /no spec yet/);
  assert.equal(load(id).spec.packages[0].assignee.by, 'user', 'the package pin survived the throw');
});

// ---------- U5: the daemon holds no snapshot across `await judge` (judge compare-and-set) ----------
//
// stepOnce(taskId, {judge}) with an injected judge. The judge is the window: whatever it calls
// before resolving is a session's tm_* call arriving while a real `claude -p` judge runs.

// Size done, shape + critique pending, no spec yet: `shape` is the one node the judge pass takes.
function shapeReady(cwd, extra = {}) {
  const done = (nid, stage, deps) => graph.node(nid, stage, deps, { state: 'done', result: { stage_ok: true } });
  return seedTask(cwd, [], {
    spec: null,
    nodes: [done('size', 'size', []), graph.node('shape', 'shape', ['size']), graph.node('critique', 'critique', ['shape'])],
    ...extra,
  });
}

// One-shot judge that proves it runs outside any transaction, exactly once per node.
function judgeWith(fn) {
  const j = { calls: [], inTx: [] };
  j.judge = async (task, n) => {
    j.calls.push(n.node_id);
    j.inTx.push(store.inTransaction());
    return fn(task, n, j);
  };
  return j;
}
function assertJudgedOnce(j, nodeId) {
  assert.deepEqual(j.calls, [nodeId], 'the judge fires exactly once, for that node');
  assert.deepEqual(j.inTx, [false], 'the judge runs outside the store lock');
}
function assertSuperseded(id, nodeId) {
  const sup = events(id, 'judge_superseded', nodeId);
  assert.equal(sup.length, 1, 'judge_superseded in the ledger');
  const start = events(id, 'judge_start', nodeId);
  assert.equal(start.length, 1, 'one judge_start');
  assert.ok(sup[0].token && sup[0].token === start[0].token, 'judge_superseded names the token judge_start stamped');
  const n = nodeOf(id, nodeId);
  assert.ok(Array.isArray(n.judge_superseded) && n.judge_superseded[0].token === sup[0].token, `node carries judge_superseded: ${JSON.stringify(n.judge_superseded)}`);
  assert.equal(n.judging, undefined, 'judging stamp cleared');
}

test('(c) a judge result for a node that moved meanwhile (tm_submit during the judge) is dropped as judge_superseded', async () => {
  const cwd = repo();
  const id = shapeReady(cwd);
  const j = judgeWith(async () => {
    const v = await callTool('tm_submit', { task_id: id, node_id: 'shape', payload: ok({ ...SHAPE2, handoff: 'from the session' }) });
    assert.equal(v.state, 'done', JSON.stringify(v));
    return { stage_ok: false, reason: 'the daemon judge refused the shape', blocking: ['late verdict'] };
  });
  await strictly(() => daemon.stepOnce(id, { judge: j.judge }));
  assertJudgedOnce(j, 'shape');
  const n = nodeOf(id, 'shape');
  assert.equal(n.state, 'done', 'the node keeps the tm_submit result');
  assert.equal(n.result.handoff, 'from the session');
  assert.equal(events(id, 'node_finish', 'shape').length, 1, 'no second node_finish');
  assertSuperseded(id, 'shape');
});

test('(c) tm_retry variant: a node retried during its judge is not finished by the late verdict', async () => {
  const cwd = repo();
  const id = shapeReady(cwd);
  const j = judgeWith(async () => {
    await callTool('tm_submit', { task_id: id, node_id: 'shape', payload: { stage_ok: false, reason: 'session refused it', blocking: ['x'] } });
    await callTool('tm_retry', { task_id: id });
    return ok({ ...SHAPE2, handoff: 'late daemon shape' });
  });
  await daemon.stepOnce(id, { judge: j.judge });
  assertJudgedOnce(j, 'shape');
  const t = load(id);
  assert.notEqual(t.nodes.find((n) => n.node_id === 'shape').state, 'done', 'the old shape is not finished by the late verdict');
  assert.ok(t.nodes.some((n) => n.node_id === 'shape:2'), 'the retry stands');
  assert.equal(t.spec, null, 'no spec from the dropped verdict');
  assert.equal(events(id, 'node_finish', 'shape').length, 1, 'only the session finish');
  assertSuperseded(id, 'shape');
});

test('(c) a node reopened during its judge (same state, same attempt) is superseded', async () => {
  const cwd = repo();
  const id = shapeReady(cwd);
  const j = judgeWith(async () => {
    store.mutateTask(id, (t) => { const s = t.nodes.find((n) => n.node_id === 'shape'); s.reopened = (s.reopened || 0) + 1; });
    return ok({ ...SHAPE2, handoff: 'late' });
  });
  await daemon.stepOnce(id, { judge: j.judge });
  assertJudgedOnce(j, 'shape');
  assert.equal(nodeOf(id, 'shape').state, 'pending');
  assert.equal(events(id, 'node_finish', 'shape').length, 0);
  assertSuperseded(id, 'shape');
});

test('(a) daemon form: spec.packages and task.decisions written during the judge survive the step', async () => {
  const cwd = repo();
  const id = preShapeWithAsk(cwd);
  const j = judgeWith(async () => {
    await callTool('tm_submit', { task_id: id, node_id: 'shape', payload: ok({ ...SHAPE2, handoff: 's' }) });
    await callTool('tm_submit', { task_id: id, key: `E-${id.slice(0, 8)}/TASK/ask:1`, payload: { decisions: [{ question: ASK_Q.question, chose: 'files' }] } });
    return { stage_ok: false, reason: 'stale daemon verdict', blocking: ['x'] };
  });
  await strictly(() => daemon.stepOnce(id, { judge: j.judge }));
  assertJudgedOnce(j, 'shape');
  const t = load(id);
  assert.equal(t.nodes.find((n) => n.node_id === 'shape').state, 'done', 'the submitted node is not reverted');
  assert.deepEqual((t.spec && t.spec.packages || []).map((p) => p.id), ['P1', 'P2'], 'spec.packages intact');
  assert.ok((t.decisions || []).some((d) => d.chose === 'files'), `task.decisions intact: ${JSON.stringify(t.decisions)}`);
});

test('judge positive control: no interference -> the verdict is applied and judging cleared', async () => {
  const cwd = repo();
  const id = shapeReady(cwd);
  let stampSeen = null;
  const j = judgeWith(async () => { stampSeen = nodeOf(id, 'shape').judging; return ok({ ...SHAPE2, handoff: 'daemon shape' }); });
  const progressed = await strictly(() => daemon.stepOnce(id, { judge: j.judge }));
  assertJudgedOnce(j, 'shape');
  assert.equal(progressed, true);
  assert.ok(stampSeen && stampSeen.token && stampSeen.pid === process.pid && stampSeen.attempt === 1 && stampSeen.reopened === 0, `stamped before the judge: ${JSON.stringify(stampSeen)}`);
  const n = nodeOf(id, 'shape');
  assert.equal(n.state, 'done');
  assert.equal(n.result.handoff, 'daemon shape');
  assert.equal(n.judging, undefined, 'judging cleared on apply');
  assert.equal(n.judge_superseded, undefined);
  assert.equal(events(id, 'judge_start', 'shape').length, 1);
  assert.equal(events(id, 'judge_superseded').length, 0);
  assert.deepEqual(load(id).spec.packages.map((p) => p.id), ['P1', 'P2']);
});

test('a judge that throws: its judging stamp is cleared and the node stays pending', async () => {
  const cwd = repo();
  const id = shapeReady(cwd);
  const j = judgeWith(async () => { throw new Error('judge exploded'); });
  await assert.rejects(daemon.stepOnce(id, { judge: j.judge }), /judge exploded/);
  assertJudgedOnce(j, 'shape');
  const n = nodeOf(id, 'shape');
  assert.equal(n.state, 'pending');
  assert.equal(n.judging, undefined, 'judging cleared after the throw');
  assert.equal(events(id, 'judge_start', 'shape').length, 1);
});

test('a judge that throws while the store is locked: the judge error, not the clear\'s ELOCKTIMEOUT, is what surfaces and is logged', async () => {
  const cwd = repo();
  const id = shapeReady(cwd);
  const prev = process.env.TEAMS_LOCK_TIMEOUT_MS;
  let lock = null;
  const j = judgeWith(async () => {
    lock = store.acquireLock(tm.taskPath(id));
    process.env.TEAMS_LOCK_TIMEOUT_MS = '50';
    throw new Error('judge exploded under lock');
  });
  try {
    await assert.rejects(daemon.stepOnce(id, { judge: j.judge }), /judge exploded under lock/);
  } finally {
    store.releaseLock(lock);
    if (prev === undefined) delete process.env.TEAMS_LOCK_TIMEOUT_MS; else process.env.TEAMS_LOCK_TIMEOUT_MS = prev;
  }
  const [e] = events(id, 'judging_clear_failed', 'shape');
  assert.ok(e, 'the failed clear is on the ledger');
  assert.match(e.judge_error, /judge exploded under lock/);
  assert.match(e.error, /lock timeout/);
});

test('two judged nodes: the second node is stamped only after the first node\'s judge returned', async () => {
  const cwd = repo();
  const t0 = seedTask(cwd, []);
  const t = load(t0);
  t.spec.packages = SHAPE2.packages.map((p) => ({ ...p, deps: [] }));
  for (const p of ['P1', 'P2']) {
    t.nodes.push(
      graph.node(`dispatch:${p}:1`, 'dispatch', ['critique'], { subgoal_id: p, state: 'done', result: { stage_ok: true }, child: { cwd, run_id: `c-${p}`, branch: `b-${p}` } }),
      graph.node(`accept:${p}:1`, 'accept', [`dispatch:${p}:1`], { subgoal_id: p }),
    );
  }
  writeFileSync(tm.taskPath(t0), JSON.stringify(t, null, 2));
  const seen = [];
  const j = judgeWith(async (_task, n) => {
    seen.push({ node: n.node_id, started: events(t0, 'judge_start').map((e) => e.node_id),
      stamped: load(t0).nodes.filter((x) => x.judging).map((x) => x.node_id) });
    return { stage_ok: false, judge_failed: true, reason: 'not judged in this test' };
  });
  await daemon.stepOnce(t0, { judge: j.judge });
  assert.deepEqual(j.calls, ['accept:P1:1', 'accept:P2:1']);
  assert.deepEqual(j.inTx, [false, false]);
  assert.deepEqual(seen[0], { node: 'accept:P1:1', started: ['accept:P1:1'], stamped: ['accept:P1:1'] }, 'while the first judge runs, only it is stamped');
  assert.deepEqual(seen[1], { node: 'accept:P2:1', started: ['accept:P1:1', 'accept:P2:1'], stamped: ['accept:P2:1'] });
});

test('a stale judging stamp (dead pid, own pid with an unheld token, or older than the judge timeout) is re-stamped and judged', async () => {
  const cwd = repo();
  for (const judging of [
    { pid: 2147483646, token: 'dead', attempt: 1, reopened: 0, at: Date.now() },
    { pid: process.pid, token: 'previous-incarnation', attempt: 1, reopened: 0, at: Date.now() },
    { pid: process.ppid, token: 'ancient', attempt: 1, reopened: 0, at: 1 },
  ]) {
    const id = shapeReady(cwd);
    const t = load(id); t.nodes.find((n) => n.node_id === 'shape').judging = judging; writeFileSync(tm.taskPath(id), JSON.stringify(t));
    const j = judgeWith(async () => ok({ ...SHAPE2, handoff: 'h' }));
    await daemon.stepOnce(id, { judge: j.judge });
    assertJudgedOnce(j, 'shape');
    assert.equal(nodeOf(id, 'shape').state, 'done', `applied over the stale stamp ${judging.token}`);
    assert.notEqual(events(id, 'judge_start', 'shape')[0].token, judging.token, 're-stamped with a new token');
  }
});

test('a live judging stamp of another process is skipped', async () => {
  const cwd = repo();
  const id = shapeReady(cwd);
  const stamp = { pid: process.ppid, token: 'other-daemon', attempt: 1, reopened: 0, at: Date.now() };
  const t = load(id); t.nodes.find((n) => n.node_id === 'shape').judging = stamp; writeFileSync(tm.taskPath(id), JSON.stringify(t));
  const j = judgeWith(async () => ok({ ...SHAPE2, handoff: 'h' }));
  await daemon.stepOnce(id, { judge: j.judge });
  assert.deepEqual(j.calls, []);
  assert.deepEqual(nodeOf(id, 'shape').judging, stamp);
  assert.equal(nodeOf(id, 'shape').state, 'pending');
});

// N2: the size node's delegateIfSmall (spawns the harness driver) belongs to the apply.
function sizeReady(cwd) {
  return seedTask(cwd, [], {
    size: null, spec: null,
    nodes: [graph.node('size', 'size', []), graph.node('shape', 'shape', ['size']), graph.node('critique', 'critique', ['shape'])],
  });
}
const SIZE = (size) => ({ stage_ok: true, size, flow: 'develop', sizing: ['wc -l -> small'], handoff: 'h', evidence: 'e' });

test('N2: a superseded size verdict spawns no harness driver', async () => {
  const cwd = repo();
  const id = sizeReady(cwd);
  const j = judgeWith(async () => {
    const v = await callTool('tm_submit', { task_id: id, node_id: 'size', payload: SIZE('L') });
    assert.equal(v.state, 'done', JSON.stringify(v));
    return SIZE('S');
  });
  await daemon.stepOnce(id, { judge: j.judge });
  assertJudgedOnce(j, 'size');
  const t = load(id);
  assert.equal(t.size, 'L', 'the session size stands');
  assert.equal(t.harness_run, undefined, 'no harness run from the dropped S');
  assert.equal(events(id, 'harness_open').length, 0);
  assert.equal(events(id, 'child_driver_spawned').length, 0, 'no driver spawned');
  assertSuperseded(id, 'size');
});

test('N2 control: an applied size S verdict delegates to the harness inside the apply', async () => {
  const cwd = repo();
  const id = sizeReady(cwd);
  const j = judgeWith(async () => SIZE('S'));
  await strictly(() => daemon.stepOnce(id, { judge: j.judge }));
  assertJudgedOnce(j, 'size');
  const t = load(id);
  assert.equal(t.size, 'S');
  assert.ok(t.harness_run, 'harness run opened');
  assert.equal(events(id, 'harness_open').length, 1);
  assert.equal(events(id, 'child_driver_spawned', 'S').length, 1, 'one harness driver');
  assert.equal(t.nodes.find((n) => n.node_id === 'shape').state, 'skipped');
});
