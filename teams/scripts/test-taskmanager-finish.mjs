#!/usr/bin/env node
// taskmanager-finish.mjs owns the verdicts: a node settling and the finish of a stage;
// taskmanager.mjs re-exports its public names unchanged.
//
//   node --test teams/scripts/test-taskmanager-finish.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as facade from '../mcp/taskmanager.mjs';
import * as mod from '../mcp/taskmanager-finish.mjs';

const OWNED = ['succeeded', 'scopeGaps', 'recordBaseExclusions', 'excludeBaseBeforeJudge', 'finish'];

test('every public name taskmanager-finish.mjs owns is the facade\'s own binding', () => {
  for (const name of OWNED) {
    assert.equal(typeof mod[name], 'function', `${name} is not exported by taskmanager-finish.mjs`);
    assert.equal(facade[name], mod[name], `${name} on the facade is not the module's binding`);
  }
});

test('__baseFail is one object: the facade and the module hand out the same one', () => {
  assert.equal(typeof mod.__baseFail, 'object');
  assert.equal(facade.__baseFail, mod.__baseFail);
});

test('succeeded: a node that did not finish its stage never succeeds; a stage without a verdict field does', () => {
  assert.equal(mod.succeeded({}, { stage: 'no-such-stage' }, { stage_ok: false }), false);
  assert.equal(mod.succeeded({}, { stage: 'no-such-stage' }, { stage_ok: true }), true);
});

test('scopeGaps leaves a result alone unless it is a finished accept node with out_of_scope gaps', () => {
  const result = { stage_ok: true, gaps: ['x'] };
  assert.equal(mod.scopeGaps({}, { stage: 'gate' }, result), result);
  assert.equal(mod.scopeGaps({}, { stage: 'accept' }, result), result);
});
