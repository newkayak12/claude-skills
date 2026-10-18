#!/usr/bin/env node
// test-worktree-gone.mjs - a worktree directory that existed and vanished is a stop, not a spawn
// (backlog card 51, 2026-10-17: drivers were spawned into trees deleted from outside).
//
// The daemon, before it spawns a driver into a package or integration worktree whose directory is
// gone, spawns nothing: it writes one `worktree_gone` ledger event naming the node key and the
// missing path, and the task reads blocked. The same for the task's own cwd, where no judge is
// spawned either. A tree that was never created (the first open) is still created.
//
// Every driver and judge is a stub that records itself in STUB_DIR; "spawns nothing" is the
// stub's own marker file never appearing. HARNESS_TASKS_DIR is a temp dir.
//
//   node --test teams/scripts/test-worktree-gone.mjs

process.env.TEAMS_RUNS_DIR ??= 'off';
process.env.TEAMS_VIEW = '0';
process.env.HARNESS_TEST_NO_DAEMON = '1';
delete process.env.HARNESS_TEST_NO_DRIVER;
delete process.env.HARNESS_CHILD_DRIVER;
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = mkdtempSync(join(tmpdir(), 'wt-gone-root-'));
const STUB_DIR = mkdtempSync(join(tmpdir(), 'wt-gone-stub-'));
process.env.HARNESS_TASKS_DIR = ROOT;
process.env.STUB_DIR = STUB_DIR;
const STUB_BODY = (prefix, out) => [
  "import { writeFileSync, existsSync } from 'node:fs';",
  "import { join } from 'node:path';",
  "const dir = process.env.STUB_DIR;",
  `writeFileSync(join(dir, \`${prefix}-\${process.pid}\`), process.cwd());`,
  "const t = setInterval(() => { if (existsSync(join(dir, 'release-all'))) {",
  `  clearInterval(t); ${out} process.exit(0);`,
  "} }, 40);",
  "setTimeout(() => process.exit(0), 60000);",
].join('\n');
writeFileSync(join(STUB_DIR, 'driver.mjs'), STUB_BODY('driver', ''));
writeFileSync(join(STUB_DIR, 'judge.mjs'), STUB_BODY('judge', "console.log(JSON.stringify({ type: 'result', result: JSON.stringify({ stage_ok: false, reason: 'stub judge' }) }));"));
process.env.HARNESS_CHILD_DRIVER = `node ${join(STUB_DIR, 'driver.mjs')}`;
process.env.HARNESS_JUDGE_DRIVER = `node ${join(STUB_DIR, 'judge.mjs')}`;

const tm = await import(join(HERE, '..', 'mcp', 'taskmanager.mjs'));
const graph = await import(join(HERE, '..', 'mcp', 'graph.mjs'));
const daemon = await import(join(HERE, '..', 'mcp', 'daemon.mjs'));

const scratch = [];
after(() => {
  writeFileSync(join(STUB_DIR, 'release-all'), '');
  for (const d of [ROOT, STUB_DIR, ...scratch]) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best-effort */ } }
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, what, ms = 8000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > end) assert.fail(`timed out waiting for ${what}`);
    await sleep(40);
  }
}
const git = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });
function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'wt-gone-repo-'));
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
const started = (prefix) => readdirSync(STUB_DIR).filter((f) => f.startsWith(`${prefix}-`)).length;
const drivers = () => started('driver');
const judges = () => started('judge');
const release = async () => {
  writeFileSync(join(STUB_DIR, 'release-all'), '');
  await sleep(200);
  rmSync(join(STUB_DIR, 'release-all'), { force: true });
};

let seq = 0;
const pkg = (id, extra = {}) => ({ id, title: `module ${id}`, flow: 'develop', brief: 'change a.txt', acceptance: ['a.txt says a'], touches: ['a.txt'], deps: [], ...extra });
const done = (id, stage, deps) => graph.node(id, stage, deps, { state: 'done', result: { stage_ok: true } });
function seedTask(cwd, packages, nodes, extra = {}) {
  const run_id = `0000${String(++seq).padStart(4, '0')}-eeee-ffff-0000-111111111111`;
  const path = tm.taskPath(run_id);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({
    run_id, kind: 'task', store_path: path, cwd, request: 'r', created_at: Date.now(),
    flow: 'develop', flow_chosen: 'develop', size: 'L', max_retries: 2, driver_restarts: 2,
    base_ref: null, team: { opts: { max_parallel_teams: 4, max_live_drivers: 4 } },
    spec: { acceptance: ['a'], packages },
    nodes: [done('size', 'size', []), done('shape', 'shape', ['size']), done('critique', 'critique', ['shape']), ...nodes],
    ...extra,
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
const events = (id, ev) => ledger(id).filter((e) => e.event === ev);
const oneStop = (id, pathPart, nodeId) => {
  const gone = events(id, 'worktree_gone');
  assert.equal(gone.length, 1, `one worktree_gone event, got ${JSON.stringify(gone)}; ledger: ${ledger(id).map((e) => `${e.event}${e.node_id ? `@${e.node_id}` : ''}${e.reason ? `(${String(e.reason).slice(0, 90)})` : ''}`).join(' | ')}`);
  assert.ok(String(gone[0].path).includes(pathPart), `names the missing path: ${gone[0].path}`);
  if (nodeId) {
    assert.equal(gone[0].node_id, nodeId);
    assert.ok(String(gone[0].key).endsWith(`/${nodeId}`) || String(gone[0].key).includes(nodeId), `names the node key: ${gone[0].key}`);
  }
  const st = tm.taskState(load(id));
  assert.equal(st.state, 'blocked');
  assert.ok(/gone|missing/.test(String(st.reason)), `a reason: ${st.reason}`);
};
const dispatchOf = (p) => [
  graph.node(`dispatch:${p}:1`, 'dispatch', ['critique'], { subgoal_id: p }),
  graph.node(`accept:${p}:1`, 'accept', [`dispatch:${p}:1`], { subgoal_id: p }),
];

test('a worktree not yet created is still created on the first open, and a driver spawns into it', async () => {
  const cwd = repo();
  const id = seedTask(cwd, [pkg('P1')], dispatchOf('P1'));
  const before = drivers();
  tm.advanceDispatches(id);
  await until(() => drivers() === before + 1, 'the first driver');
  const n = nodeOf(id, 'dispatch:P1:1');
  assert.equal(n.state, 'running');
  assert.ok(existsSync(join(n.child.cwd, '.git')), 'the tree was created');
  assert.equal(events(id, 'worktree_gone').length, 0);
  await release();
});

test('autoRetryPackages -> ensureWorktree: a retry into a package tree that vanished spawns nothing and stops', async () => {
  const cwd = repo();
  const id = seedTask(cwd, [pkg('P1')], dispatchOf('P1'));
  tm.advanceDispatches(id);
  await until(() => drivers() >= 1, 'the first attempt driver');
  await release();
  const path = nodeOf(id, 'dispatch:P1:1').child.cwd;
  // The first attempt failed; its tree is then deleted from outside, as on 2026-10-17.
  save(id, (t) => {
    const d = t.nodes.find((n) => n.node_id === 'dispatch:P1:1');
    d.state = 'failed';
    d.result = { stage_ok: false, reason: 'the attempt failed' };
  });
  rmSync(path, { recursive: true, force: true });
  const before = drivers();
  for (let i = 0; i < 3; i++) await daemon.stepOnce(id);
  await sleep(300);
  assert.equal(drivers(), before, 'no driver spawned into (or instead of) the gone tree');
  oneStop(id, '/worktrees/P1', 'dispatch:P1:2');
  assert.ok(!existsSync(path), 'the tree was not re-created');
  assert.equal(events(id, 'dispatch_failed').length, 0, 'not a failed dispatch burning the retry budget');
});

test('autoRetryPackages -> ensureWorktree, registration already pruned: the tree is not quietly re-created for a new driver', async () => {
  const cwd = repo();
  const id = seedTask(cwd, [pkg('P1')], dispatchOf('P1'));
  tm.advanceDispatches(id);
  await until(() => drivers() >= 1, 'the first attempt driver');
  await release();
  const path = nodeOf(id, 'dispatch:P1:1').child.cwd;
  save(id, (t) => {
    const d = t.nodes.find((n) => n.node_id === 'dispatch:P1:1');
    d.state = 'failed';
    d.result = { stage_ok: false, reason: 'the attempt failed' };
  });
  rmSync(path, { recursive: true, force: true });
  git(cwd, 'worktree', 'prune'); // git no longer knows the tree, so `worktree add <branch>` would succeed
  const before = drivers();
  for (let i = 0; i < 3; i++) await daemon.stepOnce(id);
  await sleep(300);
  assert.equal(drivers(), before, 'no driver spawned into a re-created tree');
  assert.ok(!existsSync(path), 'the tree that vanished was not re-created');
  oneStop(id, '/worktrees/P1', 'dispatch:P1:2');
});

test('serviceDeadDriver respawn: a running dispatch whose tree vanished is not respawned into it, and stops', async () => {
  const cwd = repo();
  const id = seedTask(cwd, [pkg('P1')], dispatchOf('P1'));
  tm.advanceDispatches(id);
  await until(() => drivers() >= 1, 'the driver');
  const path = nodeOf(id, 'dispatch:P1:1').child.cwd;
  await release(); // the driver dies
  await sleep(200);
  rmSync(path, { recursive: true, force: true });
  const before = drivers();
  for (let i = 0; i < 3; i++) await daemon.stepOnce(id);
  await sleep(300);
  assert.equal(drivers(), before, 'no driver respawned into the gone tree');
  assert.equal(events(id, 'child_driver_restarted').length, 0, 'no restart was spent');
  oneStop(id, '/worktrees/P1', 'dispatch:P1:1');
});

test('repairWorktree: a repair package whose integration tree vanished stops the daemon, not just that dispatch', async () => {
  const cwd = repo();
  const gone = join(tmpdir(), `wt-gone-integration-${process.pid}`, 'integration');
  const repair = pkg('R1', { repair: true, integration_of: 'integrate:1', title: 'repair the seam' });
  const id = seedTask(cwd, [pkg('P1'), repair], [
    graph.node('integrate:1', 'integrate', ['critique'], { subgoal_id: null, state: 'failed', result: { stage_ok: false, reason: 'seam' }, integration: { cwd: gone, branch: 'harness/x/integration' } }),
    graph.node('dispatch:R1:1', 'dispatch', ['critique'], { subgoal_id: 'R1' }),
    graph.node('accept:R1:1', 'accept', ['dispatch:R1:1'], { subgoal_id: 'R1' }),
  ]);
  const before = drivers();
  for (let i = 0; i < 3; i++) await daemon.stepOnce(id);
  await sleep(300);
  assert.equal(drivers(), before);
  oneStop(id, 'integration', 'dispatch:R1:1');
  assert.equal(events(id, 'dispatch_failed').length, 0, 'the refusal is a daemon stop, not a failed node');
});

test('the task cwd is gone: the daemon stops with the same event and no judge is spawned', async () => {
  const cwd = repo();
  const id = seedTask(cwd, [pkg('P1')], [graph.node('gate:goal', 'gate', ['critique'], { subgoal_id: null })]);
  rmSync(cwd, { recursive: true, force: true });
  const j = judges();
  await daemon.stepOnce(id);
  await daemon.stepOnce(id);
  await sleep(300);
  assert.equal(judges(), j, 'no judge process');
  oneStop(id, cwd);
});
