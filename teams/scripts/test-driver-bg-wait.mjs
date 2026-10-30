#!/usr/bin/env node
// test-driver-bg-wait.mjs - every teams-spawned driver (size-S harness driver and package child
// driver) gets CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0 and a prompt that says never to end a turn
// while its own background agent or test run is still running.
//
// The driver is a stub (HARNESS_CHILD_DRIVER) that writes its env value and prompt to a file.
//
//   node --test teams/scripts/test-driver-bg-wait.mjs

process.env.TEAMS_RUNS_DIR ??= 'off';
process.env.TEAMS_VIEW = '0';
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
const ROOT = mkdtempSync(join(tmpdir(), 'bg-wait-root-'));
const STUB_DIR = mkdtempSync(join(tmpdir(), 'bg-wait-stub-'));
const OUT_DIR = mkdtempSync(join(tmpdir(), 'bg-wait-out-'));
process.env.HARNESS_TASKS_DIR = ROOT;
writeFileSync(join(STUB_DIR, 'driver.mjs'), [
  "import { writeFileSync } from 'node:fs';",
  "import { join } from 'node:path';",
  "const [dir, tag, prompt] = process.argv.slice(2);",
  "writeFileSync(join(dir, tag + '.json'), JSON.stringify({ env: process.env.CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS ?? null, prompt, own: [process.env.TEAMS_OWN_WRITES ?? null, process.env.TEAMS_OWN_RUN ?? null] }));",
].join('\n') + '\n');

const tm = await import(join(HERE, '..', 'mcp', 'taskmanager.mjs'));
const graph = await import(join(HERE, '..', 'mcp', 'graph.mjs'));

const scratch = [];
after(() => {
  for (const d of [ROOT, STUB_DIR, OUT_DIR, ...scratch]) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best-effort */ } }
});

const git = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });
function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'bg-wait-repo-'));
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function seen(tag) {
  const f = join(OUT_DIR, `${tag}.json`);
  const end = Date.now() + 8000;
  while (!existsSync(f) || !readFileSync(f, 'utf8').endsWith('}')) {
    if (Date.now() > end) assert.fail(`timed out waiting for the ${tag} driver`);
    await sleep(40);
  }
  return JSON.parse(readFileSync(f, 'utf8'));
}

let seq = 0;
const done = (id, stage, deps) => graph.node(id, stage, deps, { state: 'done', result: { stage_ok: true } });
function seedTask(cwd, nodes, extra = {}) {
  const run_id = `0000${String(++seq).padStart(4, '0')}-5555-6666-7777-888888888888`;
  const path = tm.taskPath(run_id);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({
    run_id, kind: 'task', store_path: path, cwd, request: 'r', created_at: Date.now(),
    flow: 'develop', flow_chosen: 'develop', size: 'L', max_retries: 2, driver_restarts: 2,
    base_ref: null, team: { opts: { max_parallel_teams: 4 } },
    spec: { acceptance: ['a'], packages: [{ id: 'P1', title: 'module P1', flow: 'develop', brief: 'change a.txt', acceptance: ['a.txt says a'], touches: ['a.txt'], deps: [] }] },
    nodes, ...extra,
  }, null, 2));
  return run_id;
}

const SENTENCE = /Never end a turn while your own background agent or test run is still running/;

test('a package child driver gets the wait ceiling 0 and the never-end-a-turn sentence', async () => {
  process.env.HARNESS_CHILD_DRIVER = `node ${join(STUB_DIR, 'driver.mjs')} ${OUT_DIR} package`;
  const id = seedTask(repo(), [
    done('size', 'size', []), done('shape', 'shape', ['size']), done('critique', 'critique', ['shape']),
    graph.node('dispatch:P1:1', 'dispatch', ['critique'], { subgoal_id: 'P1' }),
    graph.node('accept:P1:1', 'accept', ['dispatch:P1:1'], { subgoal_id: 'P1' }),
  ]);
  tm.advanceDispatches(id);
  const got = await seen('package');
  assert.equal(got.env, '0');
  assert.match(got.prompt, SENTENCE);
});

test('a size-S harness driver gets the wait ceiling 0 and the never-end-a-turn sentence', async () => {
  process.env.HARNESS_CHILD_DRIVER = `node ${join(STUB_DIR, 'driver.mjs')} ${OUT_DIR} harness`;
  const id = seedTask(repo(), [graph.node('size', 'size', []), graph.node('shape', 'shape', ['size']), graph.node('critique', 'critique', ['shape'])],
    { size: null, spec: null });
  const r = await tm.callTool('tm_submit', { task_id: id, node_id: 'size', payload: { stage_ok: true, size: 'S', flow: 'develop', sizing: ['wc -l -> small'], handoff: 'h', evidence: 'e' } });
  assert.equal(r.task_state, 'harness', JSON.stringify(r));
  const got = await seen('harness');
  assert.equal(got.env, '0');
  assert.match(got.prompt, SENTENCE);
});

test('TEAMS_OWN_* reach the size-S driver only: a package driver gets neither even when the parent env has them', async () => {
  process.env.TEAMS_OWN_WRITES = '/parent/.harness-run/writes/leak.jsonl';
  process.env.TEAMS_OWN_RUN = 'leak';
  try {
    process.env.HARNESS_CHILD_DRIVER = `node ${join(STUB_DIR, 'driver.mjs')} ${OUT_DIR} package-own`;
    const pkg = seedTask(repo(), [
      done('size', 'size', []), done('shape', 'shape', ['size']), done('critique', 'critique', ['shape']),
      graph.node('dispatch:P1:1', 'dispatch', ['critique'], { subgoal_id: 'P1' }),
      graph.node('accept:P1:1', 'accept', ['dispatch:P1:1'], { subgoal_id: 'P1' }),
    ]);
    tm.advanceDispatches(pkg);
    assert.deepEqual((await seen('package-own')).own, [null, null]);

    process.env.HARNESS_CHILD_DRIVER = `node ${join(STUB_DIR, 'driver.mjs')} ${OUT_DIR} harness-own`;
    const cwd = repo();
    const id = seedTask(cwd, [graph.node('size', 'size', []), graph.node('shape', 'shape', ['size']), graph.node('critique', 'critique', ['shape'])],
      { size: null, spec: null });
    const r = await tm.callTool('tm_submit', { task_id: id, node_id: 'size', payload: { stage_ok: true, size: 'S', flow: 'develop', sizing: ['wc -l -> small'], handoff: 'h', evidence: 'e' } });
    assert.equal(r.task_state, 'harness', JSON.stringify(r));
    const got = await seen('harness-own');
    assert.deepEqual(got.own, [join(cwd, '.harness-run', 'writes', `${id}.jsonl`), id]);
    assert.equal(JSON.parse(readFileSync(tm.taskPath(id), 'utf8')).harness_run.writes_path, got.own[0]);
  } finally { delete process.env.TEAMS_OWN_WRITES; delete process.env.TEAMS_OWN_RUN; }
});
