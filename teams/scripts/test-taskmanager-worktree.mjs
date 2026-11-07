#!/usr/bin/env node
// taskmanager-worktree.mjs owns worktrees, child runs and tm_clean; taskmanager.mjs re-exports
// its public names unchanged.
//
//   node --test teams/scripts/test-taskmanager-worktree.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as facade from '../mcp/taskmanager.mjs';
import * as mod from '../mcp/taskmanager-worktree.mjs';

const OWNED = ['noDriver', 'harnessPathsUnder', 'commitWorktree', 'packageOf', 'findGoneWorktree', 'worktreeGoneStop'];

test('every public name taskmanager-worktree.mjs owns is the facade\'s own binding', () => {
  for (const name of OWNED) {
    assert.equal(typeof mod[name], 'function', `${name} is not exported by taskmanager-worktree.mjs`);
    assert.equal(facade[name], mod[name], `${name} on the facade is not the module's binding`);
  }
});

test('packageOf finds a planning, QA, audit or develop package by id (string or number), else null', () => {
  const task = {
    run_id: 'T1',
    planning_pkgs: [{ id: 'PLAN-F1', title: 'a' }],
    qa_pkgs: [{ id: 'QA-F1' }],
    audit_pkg: { id: 'AUDIT' },
    spec: { packages: [{ id: 'P1', title: 'one' }, { id: 2 }] },
    nodes: [],
  };
  assert.deepEqual(mod.packageOf(task, 'PLAN-F1'), { id: 'PLAN-F1', title: 'a' });
  assert.deepEqual(mod.packageOf(task, 'QA-F1'), { id: 'QA-F1' });
  assert.deepEqual(mod.packageOf(task, 'AUDIT'), { id: 'AUDIT' });
  assert.deepEqual(mod.packageOf(task, 'P1'), { id: 'P1', title: 'one' });
  assert.deepEqual(mod.packageOf(task, '2'), { id: 2 });
  assert.equal(mod.packageOf(task, 'nope'), null);
});

test('noDriver is true only when HARNESS_TEST_NO_DRIVER is 1', () => {
  const was = process.env.HARNESS_TEST_NO_DRIVER;
  try {
    process.env.HARNESS_TEST_NO_DRIVER = '1';
    assert.equal(mod.noDriver(), true);
    process.env.HARNESS_TEST_NO_DRIVER = '0';
    assert.equal(mod.noDriver(), false);
  } finally {
    if (was === undefined) delete process.env.HARNESS_TEST_NO_DRIVER; else process.env.HARNESS_TEST_NO_DRIVER = was;
  }
});

test('cleanTask appends cost_recorded {spend, estimated} before the clean event; a dry run appends nothing', () => {
  const root = mkdtempSync(join(tmpdir(), 'wt-cost-'));
  const was = process.env.HARNESS_TASKS_DIR;
  process.env.HARNESS_TASKS_DIR = root;
  try {
    const dir = join(root, 'T1');
    mkdirSync(join(dir, 'drivers'), { recursive: true });
    const stream = [{ type: 'assistant', message: { id: 'a', model: 'claude-opus-5-5', usage: { output_tokens: 1000 } } }, { type: 'result', total_cost_usd: 1.5, num_turns: 1, duration_ms: 1 }];
    writeFileSync(join(dir, 'drivers', 'S.stream.jsonl'), stream.map((e) => JSON.stringify(e)).join('\n') + '\n');
    writeFileSync(join(dir, 'ledger.jsonl'), '');
    const task = { run_id: 'T1', cwd: root, nodes: [], team: { opts: {} } };
    const events = () => readFileSync(join(dir, 'ledger.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    mod.cleanTask(task, true);
    assert.deepEqual(events(), []);
    mod.cleanTask(task, false);
    const evs = events().map((e) => e.event);
    assert.deepEqual(evs, ['cost_recorded', 'clean']);
    const c = events()[0];
    assert.equal(c.spend, 1.5);
    assert.equal(c.estimated, false);
  } finally {
    if (was === undefined) delete process.env.HARNESS_TASKS_DIR; else process.env.HARNESS_TASKS_DIR = was;
    rmSync(root, { recursive: true, force: true });
  }
});
