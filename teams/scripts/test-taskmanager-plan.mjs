#!/usr/bin/env node
// taskmanager-plan.mjs owns planning cards and shape validation/expansion; taskmanager.mjs
// re-exports its public names unchanged.
//
//   node --test teams/scripts/test-taskmanager-plan.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as facade from '../mcp/taskmanager.mjs';
import * as mod from '../mcp/taskmanager-plan.mjs';

const OWNED = ['validateAreas', 'storyDuplicates', 'preparePlanIntegration', 'validateShape', 'shapeAnalysis', 'qaCards'];

test('every public name taskmanager-plan.mjs owns is the facade\'s own binding', () => {
  for (const name of OWNED) {
    assert.equal(typeof mod[name], 'function', `${name} is not exported by taskmanager-plan.mjs`);
    assert.equal(facade[name], mod[name], `${name} on the facade is not the module's binding`);
  }
});

test('validateAreas: no areas is one problem; an area without title or brief, or a non-object, is named by id or position', () => {
  assert.deepEqual(mod.validateAreas({}), ['the plan stage returned no feature areas - there would be no planning card to open']);
  assert.deepEqual(mod.validateAreas({ areas: [{ id: 'F1', title: 'T' }, { brief: 'b' }, 7] }), [
    'area F1 has no brief - its planning card would have no request',
    'area 2 has no title',
    'area 3 is not an object',
  ]);
  assert.deepEqual(mod.validateAreas({ areas: [{ title: 'T', brief: 'B' }] }), []);
});

test('storyDuplicates names the story ids that more than one card claims', () => {
  assert.deepEqual(mod.storyDuplicates([
    { id: 'US-1', card: 'PLAN-F1' }, { id: 'US-1', card: 'PLAN-F2' }, { id: 'US-2', card: 'PLAN-F1' },
  ]), [{ id: 'US-1', cards: ['PLAN-F1', 'PLAN-F2'] }]);
  assert.deepEqual(mod.storyDuplicates(null), []);
});
