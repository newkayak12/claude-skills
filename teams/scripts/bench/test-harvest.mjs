// harvest.mjs / triage.mjs: failure records classify by kind and group by a signature that
// ignores paths, numbers, ids and quoted values - the same defect in two runs is one group.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { signature, classify, harvest } from './harvest.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

test('the same defect in two runs has one signature', () => {
  const a = signature('claimed changed_files not present in the worktree: packages/csv/test/smoke.test.mjs (deleted)');
  const b = signature('claimed changed_files not present in the worktree: packages/rules/test/smoke.test.mjs (deleted)');
  assert.equal(a, b);
  assert.equal(signature('run 6650f6e0-5752-4b0a-8f96-6562c234129e took 42 s'), signature('run 61bb5a70-aaa3-4bb7-91e0-ad72d0f75009 took 7 s'));
});

test('classify names the kind a person would look for first', () => {
  const w = { level: 'child' };
  assert.equal(classify({ node_id: 'x', stage: 'implement', state: 'failed', result: { verification_error: 'claimed changed_files not present' } }, w).kind, 'cross-check');
  assert.equal(classify({ node_id: 'x', stage: 'implement', state: 'failed', result: { reason: 'adapter exit 1' } }, w).kind, 'adapter-exit');
  assert.equal(classify({ node_id: 'x', stage: 'gate', state: 'failed', result: { accept: false, gaps: ['no --help'] } }, w).message, 'no --help');
  assert.equal(classify({ node_id: 'x', stage: 'shape', state: 'failed', result: { judge_failed: true, reason: 'not valid JSON' } }, w).kind, 'judge-failed');
});

test('harvest keeps a workspace\'s record and triage reads it across runs', () => {
  const ws = mkdtempSync(join(tmpdir(), 'harvest-ws-'));
  const root = mkdtempSync(join(tmpdir(), 'harvest-root-'));
  try {
    const td = join(ws, '.harness-tasks', 't1');
    mkdirSync(join(td, 'drivers'), { recursive: true });
    writeFileSync(join(td, 'task.json'), JSON.stringify({ run_id: 't1', size: 'L', spec: { packages: [{ id: 'P1' }] }, nodes: [
      { node_id: 'accept:P1:1', stage: 'accept', state: 'done', result: { accept: false, gaps: ['missing --help'] } }] }));
    writeFileSync(join(td, 'ledger.jsonl'), `${JSON.stringify({ ts: Date.now(), event: 'tm_open' })}\n${JSON.stringify({ ts: Date.now(), event: 'daemon_done', state: 'complete' })}\n`);
    const runs = join(td, 'worktrees', 'P1', '.teams_output', 'broker', 'runs');
    mkdirSync(runs, { recursive: true });
    writeFileSync(join(runs, 'r1.json'), JSON.stringify({ run_id: 'r1', nodes: [{ node_id: 'implement:U1:1', stage: 'implement', state: 'failed', executor: 'codex', result: { reason: 'adapter exit 1' } }] }));
    writeFileSync(`${ws}.score.txt`, 'ws | 3/9 | fail: x | 1min | TOTAL=$1\n');
    const { out, summary } = harvest(ws, { label: 'L1', root });
    assert.equal(summary.state, 'complete');
    assert.deepEqual(summary.failures.map((f) => f.kind).sort(), ['adapter-exit', 'rejection']);
    assert.ok(existsSync(join(out, 'runs', 'P1', 'r1.json')));
    assert.match(readFileSync(join(root, 'index.jsonl'), 'utf8'), /"label":"L1"/);
    const tri = spawnSync('node', [join(HERE, 'triage.mjs'), '--root', root], { encoding: 'utf8' });
    assert.equal(tri.status, 0, tri.stderr);
    assert.match(tri.stdout, /adapter-exit x1 in 1 run/);
    assert.match(tri.stdout, /rejection x1 in 1 run\(s\)  manager:accept/);
  } finally { rmSync(ws, { recursive: true, force: true }); rmSync(root, { recursive: true, force: true }); rmSync(`${ws}.score.txt`, { force: true }); }
});
