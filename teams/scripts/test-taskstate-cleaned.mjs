#!/usr/bin/env node
// test-taskstate-cleaned.mjs - a finished size-S task whose run dir is gone (cleaned) reads
// complete/partial from harness_run.accepted, never running.
//
//   node --test teams/scripts/test-taskstate-cleaned.mjs

process.env.TEAMS_RUNS_DIR ??= 'off';
process.env.TEAMS_VIEW = '0';
process.env.HARNESS_TEST_NO_DAEMON = '1';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = mkdtempSync(join(tmpdir(), 'ts-cleaned-root-'));
process.env.HARNESS_TASKS_DIR = ROOT;
const { harnessState } = await import(join(HERE, '..', 'mcp', 'taskstate.mjs'));

const gone = join(ROOT, 'no-such-run');
function task(extra) {
  return {
    run_id: 'cleaned-task-0001',
    ledger: [],
    harness_run: { cwd: ROOT, opened_at: 0, run: { run_dir: gone }, driver: { pid: process.pid }, ...extra },
  };
}

test('accepted true -> complete', () => {
  const s = harnessState(task({ finished_at: 1, accepted: true }));
  assert.equal(s.state, 'complete');
});

test('accepted undefined -> complete', () => {
  assert.equal(harnessState(task({ finished_at: 1 })).state, 'complete');
});

test('accepted false -> partial with a reason, not running', () => {
  const s = harnessState(task({ finished_at: 1, accepted: false }));
  assert.equal(s.state, 'partial');
  assert.equal(s.partial, true);
  assert.ok(s.partial_reasons.length >= 1);
});

test('no finished_at with a live driver stays running', () => {
  assert.equal(harnessState(task({})).state, 'running');
});

test('cleanup', () => { rmSync(ROOT, { recursive: true, force: true }); });
