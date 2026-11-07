#!/usr/bin/env node
// test-own-record-chain.mjs - the whole own-write chain on a size-S run:
// spawnHarnessDriver env (TEAMS_OWN_WRITES, TEAMS_OWN_RUN) -> hooks/own-writes.mjs writes
// .harness-run/writes/<task>.jsonl -> serviceHarnessRun / computeScopeVerdict reads it -> the
// ledger scope_verdict event.
//
// The driver is a stub (HARNESS_CHILD_DRIVER): it takes only the env it received, pipes one Write
// and one Edit payload into the real hook with cwd = the task cwd, then dumps what it saw.
//
//   node --test teams/scripts/test-own-record-chain.mjs

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
const HOOK = join(HERE, '..', 'hooks', 'own-writes.mjs');
const ROOT = mkdtempSync(join(tmpdir(), 'own-chain-root-'));
const STUB_DIR = mkdtempSync(join(tmpdir(), 'own-chain-stub-'));
const OUT_DIR = mkdtempSync(join(tmpdir(), 'own-chain-out-'));
process.env.HARNESS_TASKS_DIR = ROOT;

// argv: outDir tag mode hook files(comma separated, relative to cwd)
// modes: chain (env as received), drop (env removed), badpath (record path outside
// /.harness-run/writes/), otherid (record under another task id), nohook (hook never run), dump.
writeFileSync(join(STUB_DIR, 'driver.mjs'), [
  "import { writeFileSync } from 'node:fs';",
  "import { spawnSync } from 'node:child_process';",
  "import { join } from 'node:path';",
  "const [dir, tag, mode, hook, files] = process.argv.slice(2);",
  "const cwd = process.cwd();",
  "const own = [process.env.TEAMS_OWN_WRITES ?? null, process.env.TEAMS_OWN_RUN ?? null];",
  "const env = { ...process.env };",
  "if (mode === 'drop') { delete env.TEAMS_OWN_WRITES; delete env.TEAMS_OWN_RUN; }",
  "if (mode === 'badpath') env.TEAMS_OWN_WRITES = join(cwd, 'elsewhere', 'x.jsonl');",
  "if (mode === 'otherid') env.TEAMS_OWN_WRITES = join(cwd, '.harness-run', 'writes', 'some-other-task.jsonl');",
  "const statuses = [];",
  "if (mode !== 'dump' && mode !== 'nohook') {",
  "  (files || '').split(',').filter(Boolean).forEach((f, i) => {",
  "    const tool_name = i % 2 === 0 ? 'Write' : 'Edit';",
  "    const payload = { tool_name, cwd, tool_input: { file_path: join(cwd, f) } };",
  "    const r = spawnSync('node', [hook], { cwd, env, input: JSON.stringify(payload), encoding: 'utf8' });",
  "    statuses.push(r.status);",
  "  });",
  "}",
  "writeFileSync(join(dir, tag + '.json'), JSON.stringify({ own, statuses, cwd }));",
].join('\n') + '\n');

const tm = await import(join(HERE, '..', 'mcp', 'taskmanager.mjs'));
const graph = await import(join(HERE, '..', 'mcp', 'graph.mjs'));
const { baseline } = await import(join(HERE, '..', 'mcp', 'scope.mjs'));

const scratch = [];
after(() => {
  for (const d of [ROOT, STUB_DIR, OUT_DIR, ...scratch]) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best-effort */ } }
});

const git = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });
function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'own-chain-repo-'));
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
  const run_id = `0000${String(++seq).padStart(4, '0')}-9999-6666-7777-888888888888`;
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

const PLAN_FILES = ['a.txt', 'b.txt'];
const sizeS = (id) => tm.callTool('tm_submit', { task_id: id, node_id: 'size', payload: { stage_ok: true, size: 'S', flow: 'develop', sizing: ['wc -l -> small'], handoff: 'h', evidence: 'e' } });
const ledger = (id) => readFileSync(join(ROOT, id, 'ledger.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const lines = (cwd, id) => readFileSync(join(cwd, '.harness-run', 'writes', `${id}.jsonl`), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

// Opens a size-S task whose stub driver runs `mode` over `files`; waits for the stub to finish.
async function runDriver(tag, mode, files = PLAN_FILES, hook = HOOK) {
  process.env.HARNESS_CHILD_DRIVER = `node ${join(STUB_DIR, 'driver.mjs')} ${OUT_DIR} ${tag} ${mode} ${hook} ${files.join(',')}`;
  const cwd = repo();
  const id = seedTask(cwd, [graph.node('size', 'size', []), graph.node('shape', 'shape', ['size']), graph.node('critique', 'critique', ['shape'])],
    { size: null, spec: null });
  const r = await sizeS(id);
  assert.equal(r.task_state, 'harness', JSON.stringify(r));
  const got = await seen(tag);
  for (const f of files) writeFileSync(join(cwd, f), `${id}\n`);
  return { cwd, id, got };
}

// A finished fallback-route run for the task: plan names PLAN_FILES, gate passed, report written.
function layFallback(id, cwd) {
  const task = JSON.parse(readFileSync(tm.taskPath(id), 'utf8'));
  const h = task.harness_run;
  assert.ok(h && h.baseline_path, 'the task opened a harness run with a baseline');
  const run_dir = join(cwd, '.harness-run', `fb-${id}`);
  mkdirSync(run_dir, { recursive: true });
  writeFileSync(join(run_dir, 'manifest.json'), JSON.stringify({ teams_task: id }));
  writeFileSync(join(run_dir, '01-plan.md'), `Edit \`${PLAN_FILES.join('` and `')}\`.\n`);
  writeFileSync(join(run_dir, '02-goal-spec.json'), JSON.stringify({ goal: 'g', acceptance: ['done'] }));
  writeFileSync(join(run_dir, '04-goal-gate.json'), JSON.stringify({ pass: true, match_pct: 95 }));
  writeFileSync(join(run_dir, '05-report.md'), 'done\n');
  writeFileSync(h.pointer, JSON.stringify({ route: 'fallback', run_dir }));
  return { task, h, run: { route: 'fallback', run_dir } };
}

const verdictEvent = (id) => ledger(id).find((e) => e.event === 'scope_verdict');

test('chain: env from the size-S driver -> hook -> record -> scope_verdict own_record true, ok true', async () => {
  const { cwd, id, got } = await runDriver('chain', 'chain');
  assert.deepEqual(got.own, [join(cwd, '.harness-run', 'writes', `${id}.jsonl`), id]);
  assert.deepEqual(got.statuses, [0, 0]);
  const rec = lines(cwd, id);
  assert.deepEqual(rec.map((x) => x.path).sort(), PLAN_FILES);
  assert.ok(rec.every((x) => x.run_id === id && x.node_id === 'S'), JSON.stringify(rec));

  const { task } = layFallback(id, cwd);
  tm.serviceHarnessRun(task);
  const ev = verdictEvent(id);
  assert.ok(ev, 'a scope_verdict event is in the ledger');
  assert.equal(ev.own_record, true, JSON.stringify(ev));
  assert.equal(ev.ok, true, JSON.stringify(ev));
  assert.deepEqual([...ev.scope].sort(), PLAN_FILES);
  assert.deepEqual(ev.out_of_scope, []);
  assert.equal(ev.route, 'fallback');
});

test('chain: a write outside the plan flips ok to false and names the path, so the verdict comes from the hook line', async () => {
  const { cwd, id } = await runDriver('stray', 'chain', [...PLAN_FILES, 'stray.txt']);
  assert.deepEqual(lines(cwd, id).map((x) => x.path).sort(), [...PLAN_FILES, 'stray.txt']);
  const { task } = layFallback(id, cwd);
  tm.serviceHarnessRun(task);
  const ev = verdictEvent(id);
  assert.equal(ev.own_record, true, JSON.stringify(ev));
  assert.equal(ev.ok, false, JSON.stringify(ev));
  assert.deepEqual(ev.out_of_scope, ['stray.txt']);
  assert.equal(ev.gates, true);
});

test('negative 1: the stub drops the env, nothing is recorded, own_record is not true', async () => {
  const { cwd, id, got } = await runDriver('dropped', 'drop');
  assert.deepEqual(got.own.map((v) => v !== null), [true, true], 'the engine delivered the env; the stub then dropped it');
  assert.deepEqual(got.statuses, [0, 0]);
  assert.equal(existsSync(join(cwd, '.harness-run', 'writes', `${id}.jsonl`)), false);
  const { task, h, run } = layFallback(id, cwd);
  const v = tm.computeScopeVerdict(h, run, task);
  assert.notEqual(v.own_record, true, JSON.stringify(v));
  assert.equal(v.own_record, false);
});

test('negative 2a: the hook is not run, nothing is recorded', async () => {
  const { cwd, id } = await runDriver('nohook', 'nohook');
  assert.equal(existsSync(join(cwd, '.harness-run', 'writes', `${id}.jsonl`)), false);
  const { task, h, run } = layFallback(id, cwd);
  assert.equal(tm.computeScopeVerdict(h, run, task).own_record, false);
});

test('negative 2b: a hook copy that exits without writing records nothing', async () => {
  const dud = join(STUB_DIR, 'dud-hook.mjs');
  writeFileSync(dud, 'process.exit(0);\n');
  const { cwd, id, got } = await runDriver('dudhook', 'chain', PLAN_FILES, dud);
  assert.deepEqual(got.statuses, [0, 0]);
  assert.equal(existsSync(join(cwd, '.harness-run', 'writes', `${id}.jsonl`)), false);
  const { task, h, run } = layFallback(id, cwd);
  assert.equal(tm.computeScopeVerdict(h, run, task).own_record, false);
});

test('negative 2c: an env path outside /.harness-run/writes/ is refused by the hook, nothing is recorded', async () => {
  const { cwd, id, got } = await runDriver('badpath', 'badpath');
  assert.deepEqual(got.statuses, [0, 0]);
  assert.equal(existsSync(join(cwd, 'elsewhere')), false);
  assert.equal(existsSync(join(cwd, '.harness-run', 'writes', `${id}.jsonl`)), false);
  const { task, h, run } = layFallback(id, cwd);
  assert.equal(tm.computeScopeVerdict(h, run, task).own_record, false);
});

test('negative 3a: the record sits under another task id, so this task has no own record', async () => {
  const { cwd, id } = await runDriver('otherid', 'otherid');
  assert.ok(lines(cwd, 'some-other-task').length === 2, 'the hook did record, under the wrong id');
  assert.equal(existsSync(join(cwd, '.harness-run', 'writes', `${id}.jsonl`)), false);
  const { task, h, run } = layFallback(id, cwd);
  assert.equal(tm.computeScopeVerdict(h, run, task).own_record, false);
});

test('negative 3b: the verdict is asked without a run_id, so a real record is not found', async () => {
  const { cwd, id } = await runDriver('norunid', 'chain');
  assert.equal(lines(cwd, id).length, 2);
  const { h, run } = layFallback(id, cwd);
  assert.equal(tm.computeScopeVerdict(h, run, {}).own_record, false);
  assert.equal(tm.computeScopeVerdict(h, run, null).own_record, false);
});

test('a package (non-harness) driver gets neither TEAMS_OWN_WRITES nor TEAMS_OWN_RUN, even when the parent env has them', async () => {
  process.env.TEAMS_OWN_WRITES = '/parent/.harness-run/writes/leak.jsonl';
  process.env.TEAMS_OWN_RUN = 'leak';
  try {
    process.env.HARNESS_CHILD_DRIVER = `node ${join(STUB_DIR, 'driver.mjs')} ${OUT_DIR} package dump ${HOOK}`;
    const id = seedTask(repo(), [
      done('size', 'size', []), done('shape', 'shape', ['size']), done('critique', 'critique', ['shape']),
      graph.node('dispatch:P1:1', 'dispatch', ['critique'], { subgoal_id: 'P1' }),
      graph.node('accept:P1:1', 'accept', ['dispatch:P1:1'], { subgoal_id: 'P1' }),
    ]);
    tm.advanceDispatches(id);
    assert.deepEqual((await seen('package')).own, [null, null]);
  } finally { delete process.env.TEAMS_OWN_WRITES; delete process.env.TEAMS_OWN_RUN; }
});
