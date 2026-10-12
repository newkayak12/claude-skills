// fallback-check regressions: 0% goal gate must not be COMPLETE; "todo list feature" is a real title.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const CHECK = join(dirname(fileURLToPath(import.meta.url)), '..', 'engine', 'fallback-check.mjs');

function makeRun({ title = 'Build the thing', matchPct = 100 } = {}) {
  const d = mkdtempSync(join(tmpdir(), 'fbc-'));
  const w = (rel, v) => {
    mkdirSync(dirname(join(d, rel)), { recursive: true });
    writeFileSync(join(d, rel), typeof v === 'string' ? v : JSON.stringify(v));
  };
  w('manifest.json', { request: 'do it', subgoals: [{ id: 's1' }] });
  w('01-plan.md', 'a plan that is long enough');
  w('02-goal-spec.json', {
    goal: 'a goal that is long enough',
    acceptance: ['a'],
    subgoals: [{ id: 's1', title }],
  });
  w('subgoals/s1/result.json', { passed: true });
  w('subgoals/s1/test-1.json', {});
  w('04-goal-gate.json', { match_pct: matchPct });
  w('05-report.md', 'a report that is long enough');
  return d;
}
const run = (d) => spawnSync('node', [CHECK, d], { encoding: 'utf8' });

test('baseline run is COMPLETE', () => {
  const r = run(makeRun());
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /^COMPLETE/);
});

test('0% goal gate is not COMPLETE', () => {
  const r = run(makeRun({ matchPct: 0 }));
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stdout, /^INCOMPLETE/);
});

test('title starting with "todo" is not a placeholder', () => {
  const r = run(makeRun({ title: 'todo list feature' }));
  assert.equal(r.status, 0, r.stdout);
});

test('bare "TODO" title is still a placeholder', () => {
  const r = run(makeRun({ title: 'TODO' }));
  assert.equal(r.status, 1, r.stdout);
});
