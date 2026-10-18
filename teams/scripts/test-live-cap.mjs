#!/usr/bin/env node
// test-live-cap.mjs - the machine-wide cap on live teams-spawned drivers and judges
// (team.json max_live_drivers, teams/mcp/livecap.mjs; backlog card 51).
//
// Every driver here is a stub that stays alive until the test releases it, and every task lives
// under a temp HARNESS_TASKS_DIR: a live driver of a real EPIC under ~/.harness/tasks would count
// against the cap and the wait has no timeout. The first test asserts the root is isolated.
//
//   node --test teams/scripts/test-live-cap.mjs

process.env.TEAMS_RUNS_DIR ??= 'off';
process.env.TEAMS_VIEW = '0';
process.env.HARNESS_TEST_NO_DAEMON = '1';
delete process.env.HARNESS_TEST_NO_DRIVER;
delete process.env.HARNESS_CHILD_DRIVER;
delete process.env.HARNESS_LIVECAP_POLL_MS;
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync, existsSync, utimesSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = mkdtempSync(join(tmpdir(), 'live-cap-root-'));
const STUB_DIR = mkdtempSync(join(tmpdir(), 'live-cap-stub-'));
process.env.HARNESS_TASKS_DIR = ROOT;
process.env.STUB_DIR = STUB_DIR;
writeFileSync(join(STUB_DIR, 'driver.mjs'), [
  "import { writeFileSync, existsSync } from 'node:fs';",
  "import { join } from 'node:path';",
  "const dir = process.env.STUB_DIR;",
  "writeFileSync(join(dir, `started-${process.pid}`), '');",
  "setInterval(() => { if (existsSync(join(dir, `release-${process.pid}`)) || existsSync(join(dir, 'release-all'))) process.exit(0); }, 40);",
  "setTimeout(() => process.exit(0), 120000);",
].join('\n'));
writeFileSync(join(STUB_DIR, 'judge.mjs'), [
  "import { writeFileSync, existsSync } from 'node:fs';",
  "import { join } from 'node:path';",
  "const dir = process.env.STUB_DIR;",
  "writeFileSync(join(dir, `judge-started-${process.pid}`), '');",
  "const t = setInterval(() => { if (existsSync(join(dir, `release-${process.pid}`)) || existsSync(join(dir, 'release-all'))) {",
  "  clearInterval(t);",
  "  console.log(JSON.stringify({ type: 'result', result: JSON.stringify({ stage_ok: false, reason: 'stub judge' }) }));",
  "  process.exit(0);",
  "} }, 40);",
].join('\n'));
process.env.HARNESS_CHILD_DRIVER = `node ${join(STUB_DIR, 'driver.mjs')}`;

const tm = await import(join(HERE, '..', 'mcp', 'taskmanager.mjs'));
const graph = await import(join(HERE, '..', 'mcp', 'graph.mjs'));
const daemon = await import(join(HERE, '..', 'mcp', 'daemon.mjs'));
const cap = await import(join(HERE, '..', 'mcp', 'livecap.mjs'));
const { resolveTeamOptions, TEAM_DEFAULTS } = await import(join(HERE, '..', 'mcp', 'teamconfig.mjs'));
const { pidAlive } = await import(join(HERE, '..', 'mcp', 'proc.mjs'));
const { __storeHooks } = tm;

const scratch = [];
const bystanders = [];
after(() => {
  writeFileSync(join(STUB_DIR, 'release-all'), '');
  for (const p of bystanders) { try { p.kill('SIGKILL'); } catch { /* gone */ } }
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
  const dir = mkdtempSync(join(tmpdir(), 'live-cap-repo-'));
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
const stubPids = () => readdirSync(STUB_DIR).filter((f) => f.startsWith('started-')).map((f) => Number(f.slice(8)));
const liveStubs = () => stubPids().filter((p) => pidAlive(p));
const release = (pid) => writeFileSync(join(STUB_DIR, `release-${pid}`), '');

let seq = 0;
const pkg = (id) => ({ id, title: `module ${id}`, flow: 'develop', brief: 'change a.txt', acceptance: ['a.txt says a'], touches: ['a.txt'], deps: [] });
const done = (id, stage, deps) => graph.node(id, stage, deps, { state: 'done', result: { stage_ok: true } });

// A size-L task past critique whose packages (and any extras) are all ready to dispatch.
function seedTask(cwd, ids, { cap: max = 2, extra = {}, nodes = null } = {}) {
  const run_id = `0000${String(++seq).padStart(4, '0')}-aaaa-bbbb-cccc-dddddddddddd`;
  const path = tm.taskPath(run_id);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({
    run_id, kind: 'task', store_path: path, cwd, request: 'r', created_at: Date.now(),
    flow: 'develop', flow_chosen: 'develop', size: 'L', max_retries: 2, driver_restarts: 2,
    base_ref: null, team: { opts: { max_parallel_teams: 4, max_live_drivers: max } },
    spec: { acceptance: ['a'], packages: ids.map(pkg) },
    nodes: nodes || [done('size', 'size', []), done('shape', 'shape', ['size']), done('critique', 'critique', ['shape']),
      ...ids.flatMap((id) => [
        graph.node(`dispatch:${id}:1`, 'dispatch', ['critique'], { subgoal_id: id }),
        graph.node(`accept:${id}:1`, 'accept', [`dispatch:${id}:1`], { subgoal_id: id }),
      ])],
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
const events = (id, ev) => ledger(id).filter((e) => e.event === ev);

test('the tasks root is a temp dir, never the real ~/.harness/tasks', () => {
  assert.equal(tm.tasksRoot(), ROOT);
  assert.notEqual(tm.tasksRoot(), join(homedir(), '.harness', 'tasks'));
  assert.ok(ROOT.startsWith(tmpdir()) || ROOT.startsWith('/private'), ROOT);
});

test('max_live_drivers: default 4, a valid value wins, an invalid one is ignored with a note', () => {
  assert.equal(TEAM_DEFAULTS.max_live_drivers, 4);
  assert.equal(resolveTeamOptions({}, {}).opts.max_live_drivers, 4);
  assert.equal(resolveTeamOptions({ max_live_drivers: 7 }, {}).opts.max_live_drivers, 7);
  assert.equal(resolveTeamOptions({}, { max_live_drivers: 2 }).opts.max_live_drivers, 2);
  for (const bad of [0, -1, 1.5, '3', null]) {
    const r = resolveTeamOptions({ max_live_drivers: bad }, {});
    assert.equal(r.opts.max_live_drivers, 4, `${JSON.stringify(bad)} must not replace the default`);
    assert.ok(r.notes.some((n) => /max_live_drivers/.test(n)), `a note for ${JSON.stringify(bad)}`);
  }
});

// ---------- the helper ----------

const RESERVER = `
import { existsSync, writeFileSync } from 'node:fs';
const [,, mod, root, go, ready] = process.argv;
process.env.HARNESS_TASKS_DIR = root;
const cap = await import(mod);
writeFileSync(ready + '.' + process.pid, '');
while (!existsSync(go)) await new Promise((r) => setTimeout(r, 2));
const got = cap.reserveSlot({ run_id: 'racer-' + process.pid, team: { opts: { max_live_drivers: 1 } } }, { label: 'race' });
console.log(JSON.stringify({ ok: got.ok, live: got.live }));
process.stdin.resume();
process.stdin.on('end', () => process.exit(0));
`;

test('two processes reserving at once with one slot left: exactly one wins, the other is told to wait', async () => {
  const root = mkdtempSync(join(tmpdir(), 'live-cap-race-'));
  scratch.push(root);
  const script = join(STUB_DIR, 'reserver.mjs');
  writeFileSync(script, RESERVER);
  const go = join(root, 'go');
  const ready = join(root, 'ready');
  const procs = [0, 1].map(() => spawn(process.execPath, [script, pathToFileURL(join(HERE, '..', 'mcp', 'livecap.mjs')).href, root, go, ready], { stdio: ['pipe', 'pipe', 'inherit'] }));
  try {
    await until(() => readdirSync(root).filter((f) => f.startsWith('ready.')).length === 2, 'both reservers ready');
    writeFileSync(go, '');
    const results = await Promise.all(procs.map((p) => new Promise((res, rej) => {
      let buf = '';
      p.stdout.on('data', (d) => { buf += d; if (buf.includes('\n')) res(JSON.parse(buf.split('\n')[0])); });
      p.on('error', rej);
    })));
    assert.deepEqual(results.map((r) => r.ok).sort(), [false, true], JSON.stringify(results));
  } finally {
    for (const p of procs) p.stdin.end();
  }
});

test('a recorded pid that is alive but is not the recorded process is pruned and does not count', () => {
  const root = mkdtempSync(join(tmpdir(), 'live-cap-prune-'));
  scratch.push(root);
  const other = spawn('sleep', ['120'], { stdio: 'ignore' });
  bystanders.push(other);
  const taskWith = (driver) => {
    const dir = join(root, 'reused-task');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'task.json'), JSON.stringify({ run_id: 'reused-task', nodes: [{ node_id: 'dispatch:P1:1', stage: 'dispatch', child: { driver } }] }));
  };
  assert.ok(pidAlive(other.pid));
  taskWith({ pid: other.pid, started_at: Date.now(), command: 'sleep 120' });
  assert.equal(cap.liveProcesses(root).length, 1, 'the matching record counts');
  taskWith({ pid: other.pid, started_at: Date.now() - 3600 * 1000, command: 'sleep 120' });
  assert.equal(cap.liveProcesses(root).length, 0, 'a record older than the process is a reused pid');
  taskWith({ pid: other.pid, started_at: Date.now(), command: 'claude -p --verbose' });
  assert.equal(cap.liveProcesses(root).length, 0, 'a command line that does not match is a reused pid');
  taskWith({ pid: 2 ** 22 + 12345, started_at: Date.now(), command: 'sleep 120' });
  assert.equal(cap.liveProcesses(root).length, 0, 'a dead pid does not count');
});

test('a stale lock does not block a reservation forever', () => {
  const root = mkdtempSync(join(tmpdir(), 'live-cap-lock-'));
  scratch.push(root);
  const lock = join(root, '.livecap', 'lock');
  mkdirSync(lock, { recursive: true });
  const old = new Date(Date.now() - 60 * 1000);
  utimesSync(lock, old, old);
  const got = cap.reserveSlot({ run_id: 'x', team: { opts: { max_live_drivers: 1 } } }, { root });
  assert.equal(got.ok, true);
  got.slot.release();
});

// ---------- the sites ----------

test('max_live_drivers=2 with three ready packages across two tasks: at most 2 drivers until one exits', async () => {
  const a = seedTask(repo(), ['P1', 'P2'], { cap: 2 });
  const b = seedTask(repo(), ['P1'], { cap: 2 });
  tm.advanceDispatches(a);
  await until(() => liveStubs().length === 2, 'two stub drivers');
  assert.equal(nodeOf(a, 'dispatch:P1:1').state, 'running');
  assert.equal(nodeOf(a, 'dispatch:P2:1').state, 'running');

  tm.advanceDispatches(b);
  tm.advanceDispatches(b);
  assert.equal(nodeOf(b, 'dispatch:P1:1').state, 'pending', 'the node stays ready');
  assert.equal(nodeOf(b, 'dispatch:P1:1').child, undefined);
  await sleep(300);
  assert.equal(liveStubs().length, 2, 'no third driver');
  assert.equal(events(b, 'waiting_cap').length, 1, 'one waiting_cap event for the wait, not one per poll');

  release(liveStubs()[0]);
  await until(() => liveStubs().length === 1, 'one driver gone');
  tm.advanceDispatches(b);
  await until(() => liveStubs().length === 2, 'the waiting package spawns once a slot frees');
  assert.equal(nodeOf(b, 'dispatch:P1:1').state, 'running');
  assert.equal(nodeOf(b, 'dispatch:P1:1').waiting_cap, undefined, 'the wait mark is cleared');
  assert.equal(events(b, 'waiting_cap').length, 1);
  writeFileSync(join(STUB_DIR, 'release-all'), '');
  await until(() => liveStubs().length === 0, 'all stubs released');
  rmSync(join(STUB_DIR, 'release-all'));
});

test('the daemon step waits at the cap with one waiting_cap event and spawns on the next re-check', async () => {
  assert.ok(daemon.FALLBACK_WAIT_MS <= 15000, 're-check interval is 15 s or less');
  const a = seedTask(repo(), ['P1'], { cap: 1 });
  const b = seedTask(repo(), ['P1'], { cap: 1 });
  await daemon.stepOnce(a);
  await until(() => liveStubs().length === 1, 'task a driver');
  for (let i = 0; i < 3; i++) await daemon.stepOnce(b);
  assert.equal(liveStubs().length, 1);
  assert.equal(nodeOf(b, 'dispatch:P1:1').state, 'pending');
  assert.equal(events(b, 'waiting_cap').length, 1, 'three polls, one event');
  release(liveStubs()[0]);
  await until(() => liveStubs().length === 0, 'a slot frees');
  await daemon.stepOnce(b);
  await until(() => liveStubs().length === 1, 'task b driver on the next re-check');
  assert.equal(nodeOf(b, 'dispatch:P1:1').state, 'running');
  writeFileSync(join(STUB_DIR, 'release-all'), '');
  await until(() => liveStubs().length === 0, 'all stubs released');
  rmSync(join(STUB_DIR, 'release-all'));
});

test('a reservation that loses the race inside openChild bounces the node back to pending with one waiting_cap', async () => {
  const id = seedTask(repo(), ['P1'], { cap: 1 });
  let rival = null;
  __storeHooks.afterClaim = () => {
    // The claim passed the pre-claim look; another daemon takes the last slot before the open runs.
    rival = cap.reserveSlot({ run_id: 'rival', team: { opts: { max_live_drivers: 1 } } }, { label: 'rival' });
  };
  tm.advanceDispatches(id);
  assert.equal(rival && rival.ok, true);
  const n = nodeOf(id, 'dispatch:P1:1');
  assert.equal(n.state, 'pending');
  assert.equal(n.child, undefined);
  assert.ok(n.waiting_cap, 'marked waiting');
  assert.equal(n.claim, undefined, 'the claim is gone');
  assert.equal(liveStubs().length, 0, 'nothing spawned');
  assert.equal(events(id, 'waiting_cap').length, 1);
  rival.slot.release();
  tm.advanceDispatches(id);
  await until(() => liveStubs().length === 1, 'spawns once the rival lets go');
  assert.equal(nodeOf(id, 'dispatch:P1:1').state, 'running');
  writeFileSync(join(STUB_DIR, 'release-all'), '');
  await until(() => liveStubs().length === 0, 'all stubs released');
  rmSync(join(STUB_DIR, 'release-all'));
});

test('a Phase-Team package counts against the cap', async () => {
  const cwd = repo();
  const planning = { id: 'PLAN-F1', area: 1, area_title: 'a', phase: 'planning', flow: 'plan', planning_mode: 'full', title: 'PRD: a', brief: 'write the plan', acceptance: ['a plan'], deps: [], touches: [] };
  const id = seedTask(cwd, ['P1'], {
    cap: 1,
    extra: { planning_pkgs: [planning] },
    nodes: [done('size', 'size', []), done('shape', 'shape', ['size']), done('critique', 'critique', ['shape']),
      graph.node('dispatch:PLAN-F1:1', 'dispatch', ['critique'], { subgoal_id: 'PLAN-F1' }),
      graph.node('accept:PLAN-F1:1', 'accept', ['dispatch:PLAN-F1:1'], { subgoal_id: 'PLAN-F1' }),
      graph.node('dispatch:P1:1', 'dispatch', ['critique'], { subgoal_id: 'P1' }),
      graph.node('accept:P1:1', 'accept', ['dispatch:P1:1'], { subgoal_id: 'P1' })],
  });
  tm.advanceDispatches(id);
  await until(() => liveStubs().length === 1, 'the planning driver');
  assert.equal(nodeOf(id, 'dispatch:PLAN-F1:1').state, 'running', 'the Phase-Team package opened first');
  assert.equal(nodeOf(id, 'dispatch:P1:1').state, 'pending', 'the develop package waits behind it');
  assert.equal(events(id, 'waiting_cap').length, 1);
  assert.equal(cap.liveProcesses().length, 1, 'the planning driver is counted');
  writeFileSync(join(STUB_DIR, 'release-all'), '');
  await until(() => liveStubs().length === 0, 'all stubs released');
  rmSync(join(STUB_DIR, 'release-all'));
});

test('a respawn of a dead driver defers at the cap, with one waiting_cap event, and spawns once a slot frees', async () => {
  const b = seedTask(repo(), ['P1'], { cap: 1 });
  tm.advanceDispatches(b);
  await until(() => liveStubs().length === 1, 'the first driver');
  release(liveStubs()[0]);
  await until(() => liveStubs().length === 0, 'the driver died');
  // Another process holds the only slot while this task's driver is dead.
  const holder = cap.reserveSlot({ run_id: 'holder', team: { opts: { max_live_drivers: 1 } } }, { label: 'holder' });
  assert.equal(holder.ok, true);
  for (let i = 0; i < 3; i++) await daemon.stepOnce(b);
  assert.equal(liveStubs().length, 0, 'no respawn while the cap is held');
  assert.equal(events(b, 'waiting_cap').length, 1, 'one event for the whole wait');
  assert.equal(events(b, 'child_driver_restarted').length, 0);
  holder.slot.release();
  await daemon.stepOnce(b);
  await until(() => liveStubs().length === 1, 'respawned once the slot frees');
  assert.ok(events(b, 'child_driver_restarted').length >= 1);
  assert.equal(nodeOf(b, 'dispatch:P1:1').child.waiting_cap, undefined);
  writeFileSync(join(STUB_DIR, 'release-all'), '');
  await until(() => liveStubs().length === 0, 'all stubs released');
  rmSync(join(STUB_DIR, 'release-all'));
});

test('a judge counts: its pid is recorded on n.judging.proc, and a judge at the cap waits', async () => {
  const prevJudge = process.env.HARNESS_JUDGE_DRIVER;
  process.env.HARNESS_JUDGE_DRIVER = `node ${join(STUB_DIR, 'judge.mjs')}`;
  try {
    const cwd = repo();
    const runner = seedTask(cwd, ['P1'], { cap: 1 });
    const id = seedTask(cwd, [], {
      cap: 1,
      nodes: [graph.node('size', 'size', [])],
    });
    tm.advanceDispatches(runner);
    await until(() => liveStubs().length === 1, 'a driver holding the only slot');
    await daemon.stepOnce(id);
    assert.equal(readdirSync(STUB_DIR).filter((f) => f.startsWith('judge-started-')).length, 0, 'no judge at the cap');
    assert.equal(events(id, 'waiting_cap').length, 1);
    await daemon.stepOnce(id);
    assert.equal(events(id, 'waiting_cap').length, 1, 'one event for the wait');

    release(liveStubs()[0]);
    await until(() => liveStubs().length === 0, 'the driver is gone');
    const step = daemon.stepOnce(id);
    const started = await until(() => readdirSync(STUB_DIR).find((f) => f.startsWith('judge-started-')), 'the judge starts');
    const judgePid = Number(started.slice('judge-started-'.length));
    const rec = await until(() => (nodeOf(id, 'size').judging || {}).proc, 'the judge pid on n.judging.proc');
    assert.equal(rec.pid, judgePid);
    assert.ok(cap.liveProcesses().some((p) => p.pid === judgePid), 'the judge counts');
    release(judgePid);
    await step;
  } finally {
    if (prevJudge === undefined) delete process.env.HARNESS_JUDGE_DRIVER; else process.env.HARNESS_JUDGE_DRIVER = prevJudge;
    writeFileSync(join(STUB_DIR, 'release-all'), '');
    await until(() => liveStubs().length === 0, 'all stubs released');
    rmSync(join(STUB_DIR, 'release-all'));
  }
});
