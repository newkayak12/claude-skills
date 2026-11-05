#!/usr/bin/env node
// taskmanager-prompts.mjs owns the child-run context and the briefings; taskmanager.mjs
// re-exports its public names unchanged.
//
//   node --test teams/scripts/test-taskmanager-prompts.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as facade from '../mcp/taskmanager.mjs';
import * as mod from '../mcp/taskmanager-prompts.mjs';

const OWNED = ['critiqueNotesFor', 'briefingPath', 'writeManagerBriefing', 'composeTaskPrompt'];

test('every public name taskmanager-prompts.mjs owns is the facade\'s own binding', () => {
  for (const name of OWNED) {
    assert.equal(typeof mod[name], 'function', `${name} is not exported by taskmanager-prompts.mjs`);
    assert.equal(facade[name], mod[name], `${name} on the facade is not the module's binding`);
  }
});

test('critiqueNotesFor keeps the critique problems that name the package id as a whole word', () => {
  assert.deepEqual(mod.critiqueNotesFor({ nodes: [] }, 'P1'), []);
  const task = { nodes: [{ stage: 'critique', state: 'done', result: { problems: ['P1 is vague', 'P10 other', { k: 'P1' }], blocking: ['no P1x'] } }] };
  assert.deepEqual(mod.critiqueNotesFor(task, 'P1'), ['P1 is vague', '{"k":"P1"}']);
});

test('briefingPath is briefings/<node id with unsafe characters as _>.md under the task dir', () => {
  const p = mod.briefingPath({ run_id: 'T1' }, { node_id: 'accept/P1:x' });
  assert.deepEqual(p.split('/').slice(-2), ['briefings', 'accept_P1_x.md']);
});
