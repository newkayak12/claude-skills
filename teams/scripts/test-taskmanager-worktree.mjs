#!/usr/bin/env node
// taskmanager-worktree.mjs owns worktrees, child runs and tm_clean; taskmanager.mjs re-exports
// its public names unchanged.
//
//   node --test teams/scripts/test-taskmanager-worktree.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
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
