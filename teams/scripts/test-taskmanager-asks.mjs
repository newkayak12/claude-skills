#!/usr/bin/env node
// taskmanager-asks.mjs owns a running STORY's question and ask_timeout; taskmanager.mjs
// re-exports its public names unchanged.
//
//   node --test teams/scripts/test-taskmanager-asks.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as facade from '../mcp/taskmanager.mjs';
import * as mod from '../mcp/taskmanager-asks.mjs';

const OWNED = ['storyAsksOf', 'claimableStoryAsks', 'claimStoryAsk', 'settleStoryAsk', 'nextAskDeadline', 'expireAsks'];

test('every public name taskmanager-asks.mjs owns is the facade\'s own binding', () => {
  for (const name of OWNED) {
    assert.equal(typeof mod[name], 'function', `${name} is not exported by taskmanager-asks.mjs`);
    assert.equal(facade[name], mod[name], `${name} on the facade is not the module's binding`);
  }
});

test('a task with no asks has no claimable ask, no deadline and nothing to expire', () => {
  assert.deepEqual(mod.claimableStoryAsks({ nodes: [] }), []);
  assert.deepEqual(mod.storyAsksOf({ nodes: [] }, 'x'), []);
  assert.equal(mod.nextAskDeadline({}), null);
  assert.deepEqual(mod.expireAsks({ nodes: [] }), []);
});
