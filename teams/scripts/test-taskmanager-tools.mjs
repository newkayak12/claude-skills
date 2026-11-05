#!/usr/bin/env node
// taskmanager-tools.mjs owns the tool schema table, dispatch and callTool; taskmanager.mjs
// re-exports callTool unchanged. TOOLS is what tools/list answers: it must equal the golden
// fixture's tm_* entries, and every tool must have a dispatch case.
//
//   node --test teams/scripts/test-taskmanager-tools.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as facade from '../mcp/taskmanager.mjs';
import * as mod from '../mcp/taskmanager-tools.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const byName = (a, b) => (a.name < b.name ? -1 : 1);

test('callTool on the facade is the module\'s own binding', () => {
  assert.equal(typeof mod.callTool, 'function');
  assert.equal(facade.callTool, mod.callTool);
});

test('TOOLS deep-equals the golden fixture\'s tm_* entries', () => {
  const fixture = JSON.parse(readFileSync(join(HERE, 'fixtures', 'tools-before.json'), 'utf8')).filter((t) => t.name.startsWith('tm_'));
  assert.equal(fixture.length, 18);
  assert.ok(fixture.every((t) => t.server === 'task-manager'));
  // capture-tools.mjs tags each entry with the server it came from; tools/list does not carry that.
  const listed = fixture.map(({ server, ...tool }) => tool);
  assert.deepEqual(JSON.parse(JSON.stringify(mod.TOOLS)).sort(byName), listed.sort(byName));
});

test('every TOOLS name has a dispatch case and every dispatch case has a TOOLS entry (18 tm_*)', () => {
  const text = readFileSync(join(HERE, '..', 'mcp', 'taskmanager-tools.mjs'), 'utf8');
  const fn = text.slice(text.indexOf('function dispatch('), text.indexOf('export async function callTool') >= 0 ? text.indexOf('export async function callTool') : undefined);
  const cases = [...fn.matchAll(/case '(tm_[a-z_]+)'/g)].map((m) => m[1]).sort();
  const names = mod.TOOLS.map((t) => t.name).sort();
  assert.equal(names.length, 18);
  assert.deepEqual(cases, names);
});
