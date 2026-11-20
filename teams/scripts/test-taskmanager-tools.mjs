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
  // The fixture is the pre-merge capture; three descriptions have since gained the EPIC `name` (card 127).
  // Each is pinned exactly: the fixture's old text with only this one fragment swapped in.
  const NAME_FRAGMENT = {
    tm_status: ['Compact task state: ', 'Compact task state: the EPIC `name` (a short natural-language name), '],
    tm_board: ['(key, state, phase)', '(key, name - a short natural-language name, state, phase)'],
    tm_ticket: ['for the EPIC, E-xxxxxxxx/Pn', 'for the EPIC (with its short natural-language `name`), E-xxxxxxxx/Pn'],
  };
  // tm_open and tm_run gained the optional `name` argument (the model-written EPIC name), pinned as its exact schema.
  const NAME_PROP = {
    tm_open: { type: 'string', description: 'Optional short name for this EPIC, a few words in the request\'s language. Pass it only when the request\'s first clause does not read as a title (a chat sentence, not a card title). Stored once in task.json and shown beside the key; derived from the request when omitted.' },
    tm_run: { type: 'string', description: 'Same meaning as tm_open({name}): a few words in the request\'s language, passed only when the request\'s first clause does not read as a title. Stored once in task.json and shown beside the key; derived from the request when omitted.' },
  };
  const expected = listed.map((t0) => {
    const t = NAME_PROP[t0.name] ? { ...t0, inputSchema: { ...t0.inputSchema, properties: { ...t0.inputSchema.properties, name: NAME_PROP[t0.name] } } } : t0;
    const frag = NAME_FRAGMENT[t.name];
    if (!frag) return t;
    assert.equal(t.description.split(frag[0]).length, 2, `${t.name}: the fixture holds the anchor once`);
    return { ...t, description: t.description.replace(frag[0], () => frag[1]) };
  });
  // tm_post and tm_read (card 126, the message bus) postdate the fixture: pinned by name here,
  // their schemas are exercised by test-bus.mjs.
  const BUS_TOOLS = ['tm_post', 'tm_read'];
  const added = JSON.parse(JSON.stringify(mod.TOOLS)).filter((t) => BUS_TOOLS.includes(t.name));
  assert.deepEqual(added.map((t) => t.name).sort(), BUS_TOOLS);
  expected.push(...added);
  assert.deepEqual(JSON.parse(JSON.stringify(mod.TOOLS)).sort(byName), expected.sort(byName));
});

test('every TOOLS name has a dispatch case and every dispatch case has a TOOLS entry (20 tm_*)', () => {
  const text = readFileSync(join(HERE, '..', 'mcp', 'taskmanager-tools.mjs'), 'utf8');
  const fn = text.slice(text.indexOf('function dispatch('), text.indexOf('export async function callTool') >= 0 ? text.indexOf('export async function callTool') : undefined);
  const cases = [...fn.matchAll(/case '(tm_[a-z_]+)'/g)].map((m) => m[1]).sort();
  const names = mod.TOOLS.map((t) => t.name).sort();
  assert.equal(names.length, 20);
  assert.deepEqual(cases, names);
});
