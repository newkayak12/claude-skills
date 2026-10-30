process.env.TEAMS_RUNS_DIR ??= 'off';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const hook = fileURLToPath(new URL('../hooks/own-writes.mjs', import.meta.url));
const hooksJson = fileURLToPath(new URL('../hooks/hooks.json', import.meta.url));
const codexJson = fileURLToPath(new URL('../hooks/codex.json', import.meta.url));

function checkout() {
  return mkdtempSync(join(tmpdir(), 'own-writes-'));
}
const recordOf = (dir, id = 'T1') => join(dir, '.harness-run', 'writes', `${id}.jsonl`);
const linesOf = (file) => readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));

function run(dir, payload, env = {}, raw = null) {
  const e = { ...process.env, ...env };
  if (env.TEAMS_OWN_WRITES === undefined && !('TEAMS_OWN_WRITES' in env)) delete e.TEAMS_OWN_WRITES;
  const r = spawnSync(process.execPath, [hook], {
    input: raw ?? JSON.stringify({ cwd: dir, ...payload }),
    encoding: 'utf8',
    env: e,
  });
  return { status: r.status, stdout: r.stdout };
}
const envFor = (dir, id = 'T1') => ({ TEAMS_OWN_WRITES: recordOf(dir, id), TEAMS_OWN_RUN: id });

test('Write with env appends one line {ts, run_id, node_id, path}, path relative', () => {
  const dir = checkout();
  try {
    const r = run(dir, { tool_name: 'Write', tool_input: { file_path: join(dir, 'src', 'a.mjs'), content: 'x' } }, envFor(dir));
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '');
    const rows = linesOf(recordOf(dir));
    assert.equal(rows.length, 1);
    assert.deepEqual(Object.keys(rows[0]).sort(), ['node_id', 'path', 'run_id', 'ts']);
    assert.equal(rows[0].run_id, 'T1');
    assert.equal(rows[0].node_id, 'S');
    assert.equal(rows[0].path, 'src/a.mjs');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('no env: nothing is created under .harness-run/writes', () => {
  const dir = checkout();
  try {
    const r = run(dir, { tool_name: 'Write', tool_input: { file_path: join(dir, 'a.mjs') } });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '');
    assert.equal(existsSync(join(dir, '.harness-run')), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('Edit, MultiEdit and NotebookEdit are recorded; agent_id gives S:<id>', () => {
  const dir = checkout();
  try {
    run(dir, { tool_name: 'Edit', tool_input: { file_path: join(dir, 'e.mjs') } }, envFor(dir));
    run(dir, { tool_name: 'MultiEdit', tool_input: { file_path: join(dir, 'm.mjs') }, agent_id: 'ag7' }, envFor(dir));
    run(dir, { tool_name: 'NotebookEdit', tool_input: { notebook_path: join(dir, 'n.ipynb') } }, envFor(dir));
    const rows = linesOf(recordOf(dir));
    assert.deepEqual(rows.map((x) => [x.node_id, x.path]), [['S', 'e.mjs'], ['S:ag7', 'm.mjs'], ['S', 'n.ipynb']]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('writes under .harness-run/ are not recorded', () => {
  const dir = checkout();
  try {
    run(dir, { tool_name: 'Write', tool_input: { file_path: join(dir, '.harness-run', 'x', '01-plan.md') } }, envFor(dir));
    assert.equal(existsSync(recordOf(dir)), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a write outside the checkout records its absolute path', () => {
  const dir = checkout();
  const other = checkout();
  try {
    run(dir, { tool_name: 'Write', tool_input: { file_path: join(other, 'z.txt') } }, envFor(dir));
    const [row] = linesOf(recordOf(dir));
    assert.ok(row.path.startsWith('/') && row.path.endsWith('/z.txt'));
  } finally { rmSync(dir, { recursive: true, force: true }); rmSync(other, { recursive: true, force: true }); }
});

test('fail open: garbage stdin and an unwritable record path exit 0 with no stdout', () => {
  const dir = checkout();
  try {
    let r = run(dir, {}, envFor(dir), 'not json');
    assert.deepEqual([r.status, r.stdout], [0, '']);
    // the record's parent is a file, so mkdir/append must fail
    writeFileSync(join(dir, '.harness-run'), 'blocker');
    r = run(dir, { tool_name: 'Write', tool_input: { file_path: join(dir, 'a.mjs') } }, envFor(dir));
    assert.deepEqual([r.status, r.stdout], [0, '']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('TEAMS_OWN_WRITES relative, not .jsonl, or not under .harness-run/writes writes nothing', () => {
  const dir = checkout();
  try {
    const payload = { tool_name: 'Write', tool_input: { file_path: join(dir, 'a.mjs') } };
    for (const bad of ['rel/.harness-run/writes/T1.jsonl', join(dir, '.harness-run', 'writes', 'T1.txt'), join(dir, 'elsewhere', 'T1.jsonl')]) {
      const r = run(dir, payload, { TEAMS_OWN_WRITES: bad, TEAMS_OWN_RUN: 'T1' });
      assert.equal(r.status, 0);
    }
    assert.equal(existsSync(join(dir, '.harness-run')), false);
    assert.equal(existsSync(join(dir, 'elsewhere')), false);
    assert.equal(existsSync(join(process.cwd(), 'rel')), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('apply_patch: one line per target, Move to included', () => {
  const dir = checkout();
  try {
    const command = '*** Begin Patch\n*** Add File: src/a.mjs\n+x\n*** Update File: b.mjs\n*** Move to: c.mjs\n*** Delete File: d.mjs\n*** End Patch';
    run(dir, { tool_name: 'apply_patch', tool_input: { command } }, envFor(dir));
    assert.deepEqual(linesOf(recordOf(dir)).map((x) => x.path), ['src/a.mjs', 'b.mjs', 'c.mjs', 'd.mjs']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('hooks.json and codex.json register the hook; codex.json has no modules', () => {
  const claude = JSON.parse(readFileSync(hooksJson, 'utf8'));
  assert.deepEqual(claude.modules, ['./mod.tsx']);
  const c = claude.hooks.PostToolUse.find((e) => /NotebookEdit/.test(e.matcher));
  assert.match(c.hooks[0].command, /\$\{CLAUDE_PLUGIN_ROOT\}.*own-writes\.mjs/);
  assert.equal(c.hooks[0].timeout, 5);
  assert.ok(claude.hooks.PreToolUse && claude.hooks.SessionStart);
  const codex = JSON.parse(readFileSync(codexJson, 'utf8'));
  assert.equal(codex.modules, undefined);
  const x = codex.hooks.PostToolUse.find((e) => /apply_patch/.test(e.matcher));
  assert.match(x.hooks[0].command, /\$\{PLUGIN_ROOT\}.*own-writes\.mjs/);
});

// Card 81 U3: the real hook script feeds the real engine. Two fallback-route tasks share one checkout.
async function twoRuns(planA, planB) {
  const { serviceHarnessRun, taskState } = await import('../mcp/taskmanager.mjs');
  const { baseline } = await import('../mcp/scope.mjs');
  const cwd = checkout();
  const root = mkdtempSync(join(tmpdir(), 'own-writes-root-'));
  const prevRoot = process.env.HARNESS_TASKS_DIR;
  process.env.HARNESS_TASKS_DIR = root;
  const git = (...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });
  git('init', '-q'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
  writeFileSync(join(cwd, '.gitignore'), '.teams_output/\n');
  git('add', '-A'); git('commit', '-qm', 'init');
  const mk = (id, plan) => {
    const dir = join(root, id);
    mkdirSync(dir, { recursive: true });
    const bp = join(dir, 'scope-baseline.json');
    writeFileSync(bp, JSON.stringify(baseline(cwd)));
    const run_dir = join(cwd, '.harness-run', `fb-${id}`);
    mkdirSync(run_dir, { recursive: true });
    writeFileSync(join(run_dir, 'manifest.json'), JSON.stringify({ teams_task: id }));
    writeFileSync(join(run_dir, '01-plan.md'), `Edit \`${plan}\`.\n`);
    writeFileSync(join(run_dir, '02-goal-spec.json'), JSON.stringify({ goal: 'g', acceptance: ['done'] }));
    writeFileSync(join(run_dir, '04-goal-gate.json'), JSON.stringify({ pass: true, match_pct: 95 }));
    writeFileSync(join(run_dir, '05-report.md'), 'done\n');
    writeFileSync(join(dir, 'harness-run.json'), JSON.stringify({ route: 'fallback', run_dir }));
    return { run_id: id, cwd, nodes: [], harness_run: { cwd, opened_at: Date.now(), pointer: join(dir, 'harness-run.json'), report_path: join(dir, 'report.md'), baseline_path: bp } };
  };
  const A = mk('tA', planA);
  const B = mk('tB', planB);
  // A write through the real hook with the env spawnHarnessDriver sets for that task.
  const write = (id, file) => {
    writeFileSync(join(cwd, file), `${id}\n`);
    return run(cwd, { tool_name: 'Write', tool_input: { file_path: join(cwd, file), content: id } }, { TEAMS_OWN_WRITES: recordOf(cwd, id), TEAMS_OWN_RUN: id });
  };
  const done = () => {
    if (prevRoot === undefined) delete process.env.HARNESS_TASKS_DIR; else process.env.HARNESS_TASKS_DIR = prevRoot;
    rmSync(cwd, { recursive: true, force: true }); rmSync(root, { recursive: true, force: true });
  };
  return { A, B, cwd, write, serviceHarnessRun, taskState, done };
}

test('e2e: two runs on one checkout through the real hook and serviceHarnessRun', async () => {
  const t = await twoRuns('a.txt', 'b-only.txt');
  try {
    // B writes outside A's scope; A has no stray: A complete, B complete.
    assert.equal(t.write('tA', 'a.txt').status, 0);
    assert.equal(t.write('tB', 'b-only.txt').status, 0);
    assert.deepEqual(linesOf(recordOf(t.cwd, 'tA')).map((x) => x.path), ['a.txt']);
    assert.deepEqual(linesOf(recordOf(t.cwd, 'tB')).map((x) => x.path), ['b-only.txt']);
    t.serviceHarnessRun(t.A);
    t.serviceHarnessRun(t.B);
    assert.equal(t.A.harness_run.scope.own_record, true, JSON.stringify(t.A.harness_run.scope));
    assert.equal(t.A.harness_run.scope.ok, true, JSON.stringify(t.A.harness_run.scope));
    assert.equal(t.taskState(t.A).state, 'complete');
    assert.equal(t.taskState(t.B).state, 'complete');
  } finally { t.done(); }

  // A also writes a stray outside its plan: A partial naming it, B complete.
  const s = await twoRuns('a.txt', 'b-only.txt');
  try {
    s.write('tA', 'a.txt');
    s.write('tA', 'stray-A.txt');
    s.write('tB', 'b-only.txt');
    s.serviceHarnessRun(s.A);
    s.serviceHarnessRun(s.B);
    const a = s.taskState(s.A);
    assert.equal(a.state, 'partial', JSON.stringify(a));
    assert.ok(a.partial_reasons.some((r) => r.startsWith('scope: own write(s) outside the planned scope:') && r.includes('stray-A.txt')), JSON.stringify(a));
    assert.equal(s.taskState(s.B).state, 'complete');
  } finally { s.done(); }
});

test('limit: two runs editing one file leave the path in both records', async () => {
  const t = await twoRuns('a.txt', 'b-only.txt');
  try {
    t.write('tA', 'a.txt');
    t.write('tB', 'a.txt');
    assert.deepEqual(linesOf(recordOf(t.cwd, 'tA')).map((x) => x.path), ['a.txt']);
    assert.deepEqual(linesOf(recordOf(t.cwd, 'tB')).map((x) => x.path), ['a.txt']);
    t.serviceHarnessRun(t.A);
    t.serviceHarnessRun(t.B);
    assert.equal(t.taskState(t.A).state, 'complete');
    // B's plan does not name a.txt, so the shared file counts as B's own write outside its scope.
    assert.deepEqual(t.B.harness_run.scope.outOfScope, ['a.txt'], JSON.stringify(t.B.harness_run.scope));
    assert.equal(t.taskState(t.B).state, 'partial');
  } finally { t.done(); }
});
