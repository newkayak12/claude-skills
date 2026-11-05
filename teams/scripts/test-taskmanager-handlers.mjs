#!/usr/bin/env node
// taskmanager-handlers.mjs owns the tool handlers (events, wait, board, open, run, retry, file,
// status); taskmanager.mjs re-exports its public names unchanged.
//
//   node --test teams/scripts/test-taskmanager-handlers.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as facade from '../mcp/taskmanager.mjs';
import * as mod from '../mcp/taskmanager-handlers.mjs';

const OWNED = [
  'prdStories', 'stripDocumentAcceptance', 'missingPrdSections', 'syncTickets', 'appendBoardTransitions',
  'requireRunnable', 'delegateIfSmall',
];

test('every public name taskmanager-handlers.mjs owns is the facade\'s own binding', () => {
  for (const name of OWNED) {
    assert.equal(typeof mod[name], 'function', `${name} is not exported by taskmanager-handlers.mjs`);
    assert.equal(facade[name], mod[name], `${name} on the facade is not the module's binding`);
  }
});

test('stripDocumentAcceptance drops the document\'s own acceptance from a story unless the request declared it', () => {
  const stories = [{ acceptance: ['AC-1: foo', 'bar'] }];
  assert.deepEqual(mod.stripDocumentAcceptance(stories, ['foo'], []), [{ acceptance: ['bar'] }]);
  assert.deepEqual(mod.stripDocumentAcceptance(stories, ['foo'], ['foo']), [{ acceptance: ['AC-1: foo', 'bar'] }]);
});

test('missingPrdSections: no document at all is every section missing, not none', () => {
  assert.ok(mod.missingPrdSections('/', []).length > 0);
});
