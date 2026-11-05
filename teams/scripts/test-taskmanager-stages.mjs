#!/usr/bin/env node
// taskmanager-stages.mjs owns the manager's stages and task creation; taskmanager.mjs re-exports
// its public names unchanged.
//
//   node --test teams/scripts/test-taskmanager-stages.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
// The facade is imported first: it is the entry, and it loads the modules in the order it wants.
import * as facade from '../mcp/taskmanager.mjs';
import * as mod from '../mcp/taskmanager-stages.mjs';

const OWNED = ['autoPackageDiagram', 'repairGroups', 'mendDiagram', 'sharedSizeSLive', 'mustFindTask'];

test('every public name taskmanager-stages.mjs owns is the facade\'s own binding', () => {
  for (const name of OWNED) {
    assert.equal(typeof mod[name], 'function', `${name} is not exported by taskmanager-stages.mjs`);
    assert.equal(facade[name], mod[name], `${name} on the facade is not the module's binding`);
  }
});

test('VERDICT is the module\'s one literal, shared with siblings and not on the facade', () => {
  assert.equal(typeof mod.VERDICT, 'object');
  assert.equal(facade.VERDICT, undefined);
});

test('mendDiagram clips an over-long label to 48 characters, keeps the full text as the note', () => {
  const long = 'x'.repeat(60);
  const out = mod.mendDiagram({ nodes: [{ id: 'a', label: long }, { id: 'b', label: 'ok' }], edges: [{ from: 'a', to: 'b', label: long, note: 'n' }] });
  assert.deepEqual(out, {
    nodes: [{ id: 'a', label: `${'x'.repeat(47)}…`, note: long }, { id: 'b', label: 'ok' }],
    edges: [{ from: 'a', to: 'b', label: `${'x'.repeat(47)}…`, note: `n - ${long}` }],
  });
  assert.equal(mod.mendDiagram(null), null);
});

test('bullets renders one dash line per item, or a (none) placeholder', () => {
  assert.equal(mod.bullets(['a', 'b']), '- a\n- b');
  assert.equal(mod.bullets([]), '- (none)');
  assert.equal(mod.bullets(null), '- (none)');
});
