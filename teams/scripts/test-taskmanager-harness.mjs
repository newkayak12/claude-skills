#!/usr/bin/env node
// taskmanager-harness.mjs owns size S on the development harness and the engine's own scope
// verdict; taskmanager.mjs re-exports its public names unchanged.
//
//   node --test teams/scripts/test-taskmanager-harness.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as facade from '../mcp/taskmanager.mjs';
import * as mod from '../mcp/taskmanager-harness.mjs';

const OWNED = [
  'openHarnessRun', 'scopePathsFromRun', 'ownWritesPath', 'readOwnWrites', 'computeScopeVerdict',
  'terminalBlocked', 'serviceHarnessRun',
];

test('every public name taskmanager-harness.mjs owns is the facade\'s own binding', () => {
  for (const name of OWNED) {
    assert.equal(typeof mod[name], 'function', `${name} is not exported by taskmanager-harness.mjs`);
    assert.equal(facade[name], mod[name], `${name} on the facade is not the module's binding`);
  }
});

test('ownWritesPath puts a run\'s own-writes ledger under the cwd\'s .harness-run/writes', () => {
  assert.equal(mod.ownWritesPath('/w', 'R1'), '/w/.harness-run/writes/R1.jsonl');
});

test('terminalBlocked is null for no run file and for a run that is not blocked', () => {
  assert.equal(mod.terminalBlocked(null), null);
  assert.equal(mod.terminalBlocked({ nodes: [] }), null);
});

test('readOwnWrites is null when the ledger does not exist', () => {
  assert.equal(mod.readOwnWrites('/nonexistent-cwd-for-test', 'R1'), null);
});
