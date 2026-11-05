#!/usr/bin/env node
// taskmanager-claims.mjs owns claims, spawns out of the transaction and open intents (tm_next,
// tm_submit); taskmanager.mjs re-exports its public names unchanged.
//
//   node --test teams/scripts/test-taskmanager-claims.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as facade from '../mcp/taskmanager.mjs';
import * as mod from '../mcp/taskmanager-claims.mjs';

const OWNED = [
  'liveClaim', 'claimNode', 'applyClaim', 'readyToJudge', 'refreshTask', 'advanceDispatches',
  'serviceRunningDispatches', 'prepareReadyIntegrations', 'foldDispatch', 'promoteManagerHumanGates',
];

test('every public name taskmanager-claims.mjs owns is the facade\'s own binding', () => {
  for (const name of OWNED) {
    assert.equal(typeof mod[name], 'function', `${name} is not exported by taskmanager-claims.mjs`);
    assert.equal(facade[name], mod[name], `${name} on the facade is not the module's binding`);
  }
});

test('__storeHooks is one object: the facade and the module hand out the same one', () => {
  assert.equal(typeof mod.__storeHooks, 'object');
  assert.equal(facade.__storeHooks, mod.__storeHooks);
});

test('liveClaim: no claim, or a token this process does not hold, is not live', () => {
  assert.equal(mod.liveClaim(null), false);
  assert.equal(mod.liveClaim({}), false);
  assert.equal(mod.liveClaim({ token: 'never-claimed-here', pid: process.pid }), false);
});
