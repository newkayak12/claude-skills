// mcp/runlog.mjs: every teams task keeps a record at daemon_done, bench or not - the task dir
// lives wherever HARNESS_TASKS_DIR says, not under the project, and TEAMS_RUNS_DIR=off turns it off.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { harvestTask } from '../mcp/runlog.mjs';

function fixture() {
  const cwd = mkdtempSync(join(tmpdir(), 'runlog-proj-'));
  const tasks = mkdtempSync(join(tmpdir(), 'runlog-tasks-'));
  const td = join(tasks, 'abcdef12-0000-0000-0000-000000000000');
  mkdirSync(join(td, 'drivers'), { recursive: true });
  writeFileSync(join(td, 'task.json'), JSON.stringify({ run_id: 'abcdef12', cwd, size: 'L', spec: { packages: [{ id: 'P1' }] }, nodes: [
    { node_id: 'integrate:1', stage: 'integrate', state: 'failed', result: { verified: false, gaps: ['cli cannot import report'] } }] }));
  writeFileSync(join(td, 'ledger.jsonl'), `${JSON.stringify({ ts: Date.now(), event: 'tm_open' })}\n${JSON.stringify({ ts: Date.now(), event: 'daemon_done', state: 'blocked' })}\n`);
  mkdirSync(join(cwd, '.teams_output', 'team', 'E-abcdef12'), { recursive: true });
  writeFileSync(join(cwd, '.teams_output', 'team', 'E-abcdef12', '80-report.md'), '# report\n');
  return { cwd, tasks, td };
}

test('a task outside any bench keeps its record under <project>-<task id>, docs included', () => {
  const { cwd, tasks, td } = fixture();
  const root = mkdtempSync(join(tmpdir(), 'runlog-root-'));
  try {
    const r = harvestTask({ taskDir: td, cwd, root });
    assert.match(r.summary.label, /^runlog-proj-.*-abcdef12$/);
    assert.equal(r.summary.source, 'run');
    assert.equal(r.summary.state, 'blocked');
    assert.deepEqual(r.summary.failures.map((f) => f.kind), ['integrate-refused']);
    assert.ok(existsSync(join(r.out, 'docs', '80-report.md')));
    assert.match(readFileSync(join(root, 'index.jsonl'), 'utf8'), /abcdef12/);
  } finally { for (const d of [cwd, tasks, root]) rmSync(d, { recursive: true, force: true }); }
});

test('TEAMS_RUNS_DIR=off keeps nothing', () => {
  const { cwd, tasks, td } = fixture();
  const prev = process.env.TEAMS_RUNS_DIR;
  process.env.TEAMS_RUNS_DIR = 'off';
  try { assert.equal(harvestTask({ taskDir: td, cwd }), null); }
  finally { if (prev === undefined) delete process.env.TEAMS_RUNS_DIR; else process.env.TEAMS_RUNS_DIR = prev; for (const d of [cwd, tasks]) rmSync(d, { recursive: true, force: true }); }
});
