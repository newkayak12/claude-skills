// test-render-docs.mjs - render-docs.mjs: backfill by_stage from the streams, re-render, exit codes.
//   node --test teams/scripts/test-render-docs.mjs
process.env.TEAMS_RUNS_DIR ??= 'off';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = join(dirname(fileURLToPath(import.meta.url)), 'render-docs.mjs');
const ID = 'f20f1c65-aaaa-bbbb-cccc-dddddddddddd';

function setup({ report = true, streams = true, daemon, ledger = [{ event: 'cost_recorded', spend: 2, estimated: false }] } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'render-docs-'));
  const cwd = join(root, 'proj');
  mkdirSync(cwd, { recursive: true });
  const dir = join(root, 'tasks', ID);
  mkdirSync(join(dir, 'drivers'), { recursive: true });
  const nodes = [{ node_id: 'dispatch:P1:1', stage: 'dispatch', state: 'done', subgoal_id: 'P1', result: {} }];
  if (report) nodes.push({ node_id: 'report:1', stage: 'report', state: 'done', result: { handoff: 'Result: done' } });
  const task = { run_id: ID, cwd, request: 'r', team: { opts: { budget_usd: 60 } }, size: 'L', nodes, spec: null };
  if (daemon) task.daemon = daemon;
  writeFileSync(join(dir, 'task.json'), JSON.stringify(task));
  writeFileSync(join(dir, 'ledger.jsonl'), ledger.map((e) => JSON.stringify(e)).join('\n') + '\n');
  if (streams) writeFileSync(join(dir, 'drivers', 'dispatch_P1.stream.jsonl'), JSON.stringify({ type: 'result', total_cost_usd: 1.5, num_turns: 1, duration_ms: 1 }) + '\n');
  return { root, cwd, dir, tasks: join(root, 'tasks') };
}
const run = (tasks, key) => spawnSync(process.execPath, [CLI, key], { env: { ...process.env, HARNESS_TASKS_DIR: tasks }, encoding: 'utf8' });
const ledgerOf = (dir) => readFileSync(join(dir, 'ledger.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));

test('E-key: appends cost_recorded with by_stage, re-renders, report has the Cost section', () => {
  const s = setup();
  try {
    const r = run(s.tasks, 'E-f20f1c65');
    assert.equal(r.status, 0, r.stderr);
    const ev = ledgerOf(s.dir).filter((e) => e.event === 'cost_recorded');
    assert.equal(ev.length, 2);
    assert.deepEqual(ev[1].by_stage, { dispatch_package: 1.5 });
    const report = r.stdout.trim();
    assert.ok(existsSync(report));
    const txt = readFileSync(report, 'utf8');
    assert.match(txt, /- dispatch_package: \$1\.50/);
    assert.match(txt, /Total: \$[\d.]+ of \$60 budget/);
    // second run: latest event has by_stage now, nothing appended
    assert.equal(run(s.tasks, 'E-f20f1c65').status, 0);
    assert.equal(ledgerOf(s.dir).filter((e) => e.event === 'cost_recorded').length, 2);
  } finally { rmSync(s.root, { recursive: true, force: true }); }
});

test('task dir path works too', () => {
  const s = setup();
  try {
    const r = spawnSync(process.execPath, [CLI, s.dir], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(readFileSync(r.stdout.trim(), 'utf8'), /## Cost/);
  } finally { rmSync(s.root, { recursive: true, force: true }); }
});

test('no streams: nothing appended, stages read no cost recorded, exit 0', () => {
  const s = setup({ streams: false });
  try {
    const r = run(s.tasks, ID);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(ledgerOf(s.dir).filter((e) => e.event === 'cost_recorded').length, 1);
    assert.match(readFileSync(r.stdout.trim(), 'utf8'), /- dispatch: no cost recorded/);
  } finally { rmSync(s.root, { recursive: true, force: true }); }
});

test('cleanTask re-renders: 80-report.md has the Cost section without a tm_docs call', async () => {
  const s = setup();
  const was = process.env.HARNESS_TASKS_DIR;
  process.env.HARNESS_TASKS_DIR = s.tasks;
  try {
    const { cleanTask } = await import('../mcp/taskmanager-worktree.mjs');
    const { docPaths } = await import('../mcp/tickets.mjs');
    const task = JSON.parse(readFileSync(join(s.dir, 'task.json'), 'utf8'));
    cleanTask(task, false);
    const txt = readFileSync(docPaths(task).report, 'utf8');
    assert.match(txt, /- dispatch_package: \$1\.50/);
    assert.match(txt, /Total: \$2\.00 of \$60 budget/); // the larger exact durable event wins (spendFigure)
  } finally {
    if (was === undefined) delete process.env.HARNESS_TASKS_DIR; else process.env.HARNESS_TASKS_DIR = was;
    rmSync(s.root, { recursive: true, force: true });
  }
});

test('unknown key exits non-zero naming the key', () => {
  const s = setup();
  try {
    const r = run(s.tasks, 'E-deadbeef');
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /E-deadbeef/);
  } finally { rmSync(s.root, { recursive: true, force: true }); }
});

test('live daemon: refuses, names the daemon and key, ledger bytes unchanged', () => {
  const s = setup({ daemon: { pid: process.pid } });
  try {
    const before = readFileSync(join(s.dir, 'ledger.jsonl'));
    const r = run(s.tasks, 'E-f20f1c65');
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /daemon/);
    assert.match(r.stderr, /E-f20f1c65/);
    assert.deepEqual(readFileSync(join(s.dir, 'ledger.jsonl')), before);
  } finally { rmSync(s.root, { recursive: true, force: true }); }
});

test('dead daemon pid and no daemon field: renders with the Cost section, exit 0', () => {
  for (const daemon of [{ pid: 999999 }, undefined]) {
    const s = setup({ daemon });
    try {
      const r = run(s.tasks, 'E-f20f1c65');
      assert.equal(r.status, 0, r.stderr);
      assert.match(readFileSync(r.stdout.trim(), 'utf8'), /## Cost/);
    } finally { rmSync(s.root, { recursive: true, force: true }); }
  }
});

test('run through a symlink: main runs, prints the report path, exit 0', () => {
  const s = setup();
  try {
    const link = join(s.root, 'render-docs-link.mjs');
    symlinkSync(CLI, link);
    const r = spawnSync(process.execPath, [link, 'E-f20f1c65'], { env: { ...process.env, HARNESS_TASKS_DIR: s.tasks }, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(existsSync(r.stdout.trim()), `stdout is the report path: ${r.stdout}`);
  } finally { rmSync(s.root, { recursive: true, force: true }); }
});

test('no done report node exits non-zero, no crash', () => {
  const s = setup({ report: false });
  try {
    const r = run(s.tasks, 'E-f20f1c65');
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /E-f20f1c65/);
    assert.ok(!/at .*\.mjs:\d+/.test(r.stderr), 'a message, not a stack trace');
  } finally { rmSync(s.root, { recursive: true, force: true }); }
});
