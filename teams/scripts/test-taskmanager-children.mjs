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
    P1: { changed_files: ['a'], gaps: [], reason: 'ok', accept: true, attempts: 1 },
  });
});
