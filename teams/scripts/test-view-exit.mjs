// A viewer that ends itself: view.mjs server mode is spawned detached (mcp/viewserver.mjs), so nothing
// else ever stops it. It exits when its --tasks-dir is gone (checked every 2 s, no grace for a dir
// missing at startup), or once TEAMS_VIEW_IDLE_MS has passed with no HTTP request and no live task
// (READY, IN_PROGRESS, IN_REVIEW). Each test runs the real script as a child process.
//
//   node --test teams/scripts/test-view-exit.mjs

// A test task must not land in the real run archive (mcp/runlog.mjs).
process.env.TEAMS_RUNS_DIR ??= 'off';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { node } from '../mcp/graph.mjs';
import { listTasks } from './lib/view-collect.mjs';

const VIEW_SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'view.mjs');
const IDLE_MS = 1500;          // the short idle time the idle tests pass as TEAMS_VIEW_IDLE_MS
const EXIT_WITHIN_MS = 8000;   // 2000 ms dir check + 1 s exit grace + margin
const spawned = [];            // pids of every viewer started here
const roots = [];              // every scratch tasks root

function scratch() {
  const d = mkdtempSync(join(tmpdir(), 'teams-viewexit-'));
  roots.push(d);
  return d;
}

function killAll() {
  for (const pid of spawned.splice(0)) { try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ } }
}

function cleanRoots() {
  for (const d of roots) rmSync(d, { recursive: true, force: true });
}

process.on('exit', killAll);
after(() => { killAll(); cleanRoots(); });

// A tasks root holding one fixture task with the given extra fields (none: no nodes = BLOCKED).
function seedTask(dir, id, extra = {}) {
  mkdirSync(join(dir, id), { recursive: true });
  writeFileSync(join(dir, id, 'task.json'), JSON.stringify({
    run_id: id, cwd: dir, request: `request ${id}`, created_at: Date.now(), store_path: join(dir, id, 'task.json'), nodes: [], ...extra,
  }));
}

// view.mjs --tasks-dir <dir> --port 0; resolves with { child, port, exited } once it prints its URL.
// `exited` resolves with the time the process was gone. idleMs undefined leaves TEAMS_VIEW_IDLE_MS unset.
function start(dir, idleMs) {
  const env = { ...process.env };
  if (idleMs === undefined) delete env.TEAMS_VIEW_IDLE_MS; else env.TEAMS_VIEW_IDLE_MS = String(idleMs);
  const child = spawn(process.execPath, [VIEW_SCRIPT, '--tasks-dir', dir, '--port', '0'], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  spawned.push(child.pid);
  const exited = new Promise((resolve) => child.once('exit', () => resolve(Date.now())));
  return new Promise((resolve, reject) => {
    let out = '';
    child.once('exit', () => reject(new Error(`viewer exited before it listened: ${out}`)));
    child.stdout.on('data', (b) => {
      out += b;
      const m = /listening on http:\/\/127\.0\.0\.1:(\d+)/.exec(out);
      if (m) resolve({ child, port: Number(m[1]), exited });
    });
  });
}

// true when `exited` resolves within ms, false when the timer wins.
async function exitsWithin(exited, ms) {
  let timer;
  const gone = await Promise.race([exited.then(() => true), new Promise((r) => { timer = setTimeout(() => r(false), ms); })]);
  clearTimeout(timer);
  return gone;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const alive = (child) => child.exitCode === null && child.signalCode === null;

test('a viewer ends itself within 8 s of its tasks dir being deleted', async () => {
  const dir = scratch();
  const v = await start(dir);
  assert.ok(alive(v.child), 'the viewer is up before the dir goes');
  rmSync(dir, { recursive: true, force: true });
  const t0 = Date.now();
  assert.equal(await exitsWithin(v.exited, EXIT_WITHIN_MS), true, `the viewer must end within ${EXIT_WITHIN_MS} ms of its dir being deleted`);
  assert.ok(Date.now() - t0 < EXIT_WITHIN_MS);
  assert.equal(v.child.exitCode, 0, 'a self-ended viewer exits 0');
});

test('a tasks dir missing at startup ends the viewer on its first check (no grace)', async () => {
  const dir = scratch();
  rmSync(dir, { recursive: true, force: true });
  const v = await start(dir);
  assert.equal(await exitsWithin(v.exited, EXIT_WITHIN_MS), true);
});

test('an idle viewer with no live task ends itself once the idle time has passed', async () => {
  const dir = scratch();
  const v = await start(dir, IDLE_MS);
  assert.equal(await exitsWithin(v.exited, EXIT_WITHIN_MS), true, 'no request and no task: the viewer must end');
  assert.equal(v.child.exitCode, 0);
});

test('a viewer whose tasks are all CANCELLED or BLOCKED is idle: it ends', async () => {
  const dir = scratch();
  seedTask(dir, 'T-cancelled', { cancelled: true });
  seedTask(dir, 'T-blocked');
  assert.deepEqual(listTasks(dir).map((r) => r.state).sort(), ['BLOCKED', 'CANCELLED'], 'fixture: neither task is live');
  const v = await start(dir, IDLE_MS);
  assert.equal(await exitsWithin(v.exited, EXIT_WITHIN_MS), true);
});

test('GET /state.json resets the idle clock: a polled viewer outlives two idle periods, then ends once polling stops', async () => {
  const dir = scratch();
  const v = await start(dir, IDLE_MS);
  const until = Date.now() + 2 * IDLE_MS + 1500;
  while (Date.now() < until) {
    const res = await fetch(`http://127.0.0.1:${v.port}/state.json`);
    assert.equal(res.status, 200);
    await res.text();
    await sleep(300);
  }
  assert.ok(alive(v.child), 'polled more often than the idle time, past two idle periods: still up');
  assert.equal(await exitsWithin(v.exited, EXIT_WITHIN_MS), true, 'polling stopped: the same viewer now ends');
});

test('a viewer with a live task stays up past the idle time with no request at all', async () => {
  const dir = scratch();
  seedTask(dir, 'T-live', { nodes: [node('size', 'size', [])] }); // a pending size node, no spec: READY
  assert.equal(listTasks(dir)[0].state, 'READY', 'fixture: the task reads READY (live)');
  const v = await start(dir, IDLE_MS);
  assert.equal(await exitsWithin(v.exited, 2 * IDLE_MS + 2500), false, 'a READY task keeps the viewer up');
  assert.ok(alive(v.child));
  // a viewer ended by the dir going is the same code path as above; here it only proves the liveness check still reads the dir
  rmSync(dir, { recursive: true, force: true });
  assert.equal(await exitsWithin(v.exited, EXIT_WITHIN_MS), true, 'a live task does not keep a viewer whose dir is gone');
});

test('TEAMS_VIEW_IDLE_MS: non-numeric and non-positive values fall back to the 30 min default', async () => {
  for (const bad of ['abc', '0', '-5']) {
    const dir = scratch();
    const v = await start(dir, bad);
    assert.equal(await exitsWithin(v.exited, IDLE_MS + 1500), false, `'${bad}' must not make the viewer idle-exit`);
    rmSync(dir, { recursive: true, force: true });
    assert.equal(await exitsWithin(v.exited, EXIT_WITHIN_MS), true);
  }
});

// A viewer started on `a` with `b` registered into it.
async function startTwo(a, b) {
  const v = await start(a, IDLE_MS);
  const res = await fetch(`http://127.0.0.1:${v.port}/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tasks_dir: b }) });
  assert.equal(res.status, 200);
  return v;
}

test('two roots: a live task in B keeps the viewer past idle, losing the starting root A does not end it, losing B does', async () => {
  const a = scratch();
  const b = scratch();
  seedTask(a, 'T-blocked');
  seedTask(b, 'T-live', { nodes: [node('size', 'size', [])] });
  assert.equal(listTasks(b)[0].state, 'READY', 'fixture: B holds a live task');
  const v = await startTwo(a, b);
  assert.equal(await exitsWithin(v.exited, 2 * IDLE_MS + 2500), false, 'B is live: still up past idle');
  rmSync(a, { recursive: true, force: true });
  assert.equal(await exitsWithin(v.exited, EXIT_WITHIN_MS), false, 'A is gone but B is live: still up');
  rmSync(b, { recursive: true, force: true });
  assert.equal(await exitsWithin(v.exited, EXIT_WITHIN_MS), true, 'no root left: it ends');
});

test('two roots with no live task end at idle', async () => {
  const a = scratch();
  const b = scratch();
  const v = await startTwo(a, b);
  assert.equal(await exitsWithin(v.exited, EXIT_WITHIN_MS), true);
});

test('nothing a test here started is left in ps', async () => {
  killAll();
  await sleep(300);
  for (const dir of roots) {
    const r = spawnSync('pgrep', ['-f', `scripts/view.mjs --tasks-dir ${dir} `], { encoding: 'utf8' });
    assert.equal((r.stdout || '').trim(), '', `a viewer on ${dir} is still running`);
  }
});
