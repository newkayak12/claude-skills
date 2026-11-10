#!/usr/bin/env node
// taskmanager-children.mjs owns opening, settling and folding child runs; taskmanager.mjs
// re-exports its public names unchanged.
//
//   node --test teams/scripts/test-taskmanager-children.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as facade from '../mcp/taskmanager.mjs';
import * as mod from '../mcp/taskmanager-children.mjs';

const OWNED = ['openChild', 'dispatchSettled', 'serviceSRun', 'foldChild', 'prepareIntegration', 'runPackageTests', 'foldPackageHistory'];

test('every public name taskmanager-children.mjs owns is the facade\'s own binding', () => {
  for (const name of OWNED) {
    assert.equal(typeof mod[name], 'function', `${name} is not exported by taskmanager-children.mjs`);
    assert.equal(facade[name], mod[name], `${name} on the facade is not the module's binding`);
  }
});

test('foldPackageHistory folds a package\'s dispatch results into one record per package, skipping packages with none', () => {
  assert.deepEqual(mod.foldPackageHistory({ nodes: [] }), {});
  const task = {
    spec: { packages: [{ id: 'P1' }, { id: 'P2' }] },
    nodes: [{ stage: 'dispatch', subgoal_id: 'P1', node_id: 'd1', attempt: 1, result: { changed_files: ['a'], gaps: [], reason: 'ok', accept: true } }],
  };
  assert.deepEqual(mod.foldPackageHistory(task), {
    P1: { changed_files: ['a'], files_changed: ['a'], gaps: [], reason: 'ok', accept: true, attempts: 1 },
  });
});

test('foldPackageHistory records files_changed from the latest attempt, while changed_files stays the union of every attempt', () => {
  const task = {
    spec: { packages: [{ id: 'P1' }] },
    nodes: [
      { stage: 'dispatch', subgoal_id: 'P1', node_id: 'd1', attempt: 1, result: { changed_files: ['a', 'old'], accept: false } },
      { stage: 'dispatch', subgoal_id: 'P1', node_id: 'd2', attempt: 2, result: { changed_files: ['a', 'b', 'a'], accept: true } },
    ],
  };
  const fold = mod.foldPackageHistory(task).P1;
  assert.deepEqual(fold.files_changed, ['a', 'b']);
  assert.deepEqual([...fold.changed_files].sort(), ['a', 'b', 'old']);
});
