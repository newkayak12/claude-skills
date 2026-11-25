#!/usr/bin/env node
// test-daemon-tick.mjs - what one daemon tick reads and writes on an idle task, and what wakes an
// idle daemon. Runs on a temp copy of the real-shape fixture teams/scripts/fixtures/daemon-tick/531fddcf
// (one running dispatch, a live silent driver, nothing ready).
//
//   node --test teams/scripts/test-daemon-tick.mjs

process.env.TEAMS_RUNS_DIR ??= 'off';
process.env.HARNESS_TEST_NO_DRIVER = '1';
process.env.HARNESS_TEST_NO_DAEMON = '1';
process.env.HARNESS_DAEMON_POLL_MS = '1500';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, cpSync, statSync, appendFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const FULL_ID = '531fddcf-ee43-49df-b07e-53d2d0078423';
// task.json reads one stepOnce made on this fixture before F1 cut them (E-4d18badd F1 baseline,
// 02-baseline.md task_json_reads_per_tick, median of 5 on the same fixture).
const BASELINE_TASK_JSON_READS = 16;

const procs = [];
const dirs = [];
after(() => {
  for (const p of procs) { try { process.kill(-p, 'SIGKILL'); } catch { try { process.kill(p, 'SIGKILL'); } catch { /* gone */ } } }
  for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best-effort */ } }
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Copy the fixture into a fresh tasks root, fill its placeholders, give it a live silent driver and
// the child run file a running dispatch reads. Points HARNESS_TASKS_DIR at the root.
function seedFixture() {
  const root = mkdtempSync(join(tmpdir(), 'daemon-tick-'));
  const cwd = mkdtempSync(join(tmpdir(), 'daemon-tick-cwd-'));
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
  process.env.HARNESS_TASKS_DIR = root;
  return { root, id: FULL_ID, dir, taskJson: join(dir, 'task.json') };
}

// Counts full task.json reads (readFileSync) while on. store.mjs and graph-runfile.mjs import
// readFileSync by name, so the ESM exports are re-synced after the swap.
const counter = { on: false, n: 0 };
const origRead = fs.readFileSync;
fs.readFileSync = function (p, ...rest) {
  if (counter.on && typeof p === 'string' && p.endsWith(`${sep}task.json`)) counter.n++;
  return origRead.call(this, p, ...rest);
};
syncBuiltinESMExports();

const NO_JUDGE = { judge: async () => { throw new Error('no judge on an idle fixture'); } };
const daemon = await import(join(HERE, '..', 'mcp', 'daemon.mjs'));

test('one idle tick reads task.json fewer times than the baseline of 16', async () => {
  const s = seedFixture();
  await daemon.stepOnce(s.id, NO_JUDGE); // warm-up: the first tick settles first-tick state
  counter.n = 0; counter.on = true;
  await daemon.stepOnce(s.id, NO_JUDGE);
  counter.on = false;
  assert.ok(counter.n > 0, 'the counter sees the tick read task.json');
  assert.ok(counter.n < BASELINE_TASK_JSON_READS, `${counter.n} task.json reads in one tick, baseline ${BASELINE_TASK_JSON_READS}`);
});

test('a tick that finds nothing to do leaves task.json untouched (mtime and bytes)', async () => {
  const s = seedFixture();
  await daemon.stepOnce(s.id, NO_JUDGE);
  const before = readFileSync(s.taskJson, 'utf8');
  const mtime = statSync(s.taskJson).mtimeMs;
  await sleep(30);
  await daemon.stepOnce(s.id, NO_JUDGE);
  assert.equal(statSync(s.taskJson).mtimeMs, mtime, 'task.json mtime unchanged by an idle tick');
  assert.equal(readFileSync(s.taskJson, 'utf8'), before);
});

// Resolves how long waitForProgress took when `poke` runs 200 ms after it starts.
async function waited(s, poke) {
  const task = JSON.parse(readFileSync(s.taskJson, 'utf8'));
  const start = Date.now();
  const p = daemon.waitForProgress(task).then(() => Date.now() - start);
  await sleep(200);
  poke();
  return p;
}

test('waitForProgress: a stream or stderr append does not wake the wait before the fallback, an exit file does', async () => {
  assert.equal(daemon.FALLBACK_WAIT_MS, 1500, 'the test runs with a 1.5 s fallback');
  const s = seedFixture();
  const drivers = join(s.dir, 'drivers');
  await sleep(500); // the seed's own writes are still reaching fs.watch on some platforms
  const quiet = await waited(s, () => {
    appendFileSync(join(drivers, 'dispatch_QA-F1_1.stream.jsonl'), '{"type":"assistant"}\n');
    appendFileSync(join(drivers, 'dispatch_QA-F1_1.stderr.txt'), 'x\n');
  });
  assert.ok(quiet >= daemon.FALLBACK_WAIT_MS - 100, `a stream/stderr append woke the wait after ${quiet} ms`);
  const woke = await waited(s, () => writeFileSync(join(drivers, 'dispatch_QA-F1_1.exit.json'), JSON.stringify({ code: 0 })));
  assert.ok(woke < 1000, `an exit file woke the wait after ${woke} ms, well before the fallback`);
});
