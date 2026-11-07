// teams/scripts/test-state-lists.mjs - the state lists the pane's key tests read are the engine's own:
// TICKET_STATES (tickets.mjs) and TASK_STATES (view-summary.mjs) must equal the literals the emitting code can return,
// so a state added to the engine without its list entry (and so without its pane key) fails here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TASK_STATES, TICKET_STATES } from './lib/view-summary.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const quoted = (text, re, word = /'([A-Za-z_]+)'/g) => new Set([...text.matchAll(re)].flatMap((m) => [...m[0].matchAll(word)].map((q) => q[1])));
const sorted = (set) => [...set].sort();

test('TICKET_STATES equals every uppercase literal the ticket-state functions return', () => {
  const src = read('mcp/tickets.mjs');
  const from = src.indexOf('export function storyTicketState');
  const to = src.indexOf('export function storyTaskProgress');
  assert.ok(from > 0 && to > from);
  const returned = quoted(src.slice(from, to), /return[^;\n]*'[A-Z_]+'[^;\n]*/g, /'([A-Z_]+)'/g);
  assert.ok(returned.size >= 10);
  assert.deepEqual(sorted(returned), [...TICKET_STATES].sort());
});

test('TASK_STATES covers every state a collected task takes, and lists nothing the code cannot produce', () => {
  const graph = read('mcp/graph-state.mjs');
  const runStateBody = graph.slice(graph.indexOf('export function runState'), graph.indexOf('export function nodeBriefing'));
  const collect = read('scripts/lib/view-collect.mjs');
  const emitted = new Set([
    ...quoted(runStateBody, /state: '[a-z_]+'/g),
    ...quoted(collect, /\bstate = [^;\n]*'[a-z_]+'[^;\n]*/g),
  ]);
  emitted.delete('missing'); // size-S with no run file: collect turns it into 'blocked' (view-collect.mjs)
  for (const s of emitted) assert.ok(TASK_STATES.includes(s), `engine can emit task state '${s}' with no TASK_STATES entry`);
  for (const s of TASK_STATES) assert.ok(emitted.has(s), `TASK_STATES lists '${s}' but no code path emits it`);
});
