#!/usr/bin/env node
// verdictfields.mjs: one stage -> { field, scope } map, five derived views. Each view is pinned
// here against the literal its reader held before the map existed (copied verbatim), key for key.
//
//   node --test teams/scripts/test-verdictfields.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  VERDICT_MAP, SCOPES, verdictView, VERDICT_FIELD, HUMAN_GATE_VERDICT_FIELD, REASONING_VERDICT, TASKMANAGER_VERDICT,
} from '../mcp/verdictfields.mjs';
import * as graph from '../mcp/graph.mjs';

const MCP = join(dirname(fileURLToPath(import.meta.url)), '..', 'mcp');

// graph.mjs:196 before the map.
const GRAPH_VERDICT_FIELD = { gate: 'accept', critique: 'sound', test: 'verified', review: 'verified', execute: 'verified' };
// graph.mjs:1777 before the map.
const GRAPH_HUMAN_GATE = { gate: 'accept', critique: 'sound', accept: 'accept', integrate: 'verified', 'areas-critique': 'sound', 'plan-integrate': 'accept' };
// inspect-collect.mjs:18 and view-collect.mjs:140 before the map (the two were identical).
const INSPECT_VERDICT = { critique: 'sound', dispatch: 'accept', accept: 'accept', integrate: 'verified', gate: 'accept' };
const VIEW_COLLECT_VERDICT = { critique: 'sound', dispatch: 'accept', accept: 'accept', integrate: 'verified', gate: 'accept' };
// taskmanager.mjs:146 today (its VERDICT const; taskmanager.mjs is not edited by this change).
const TASKMANAGER_LITERAL = { critique: 'sound', 'areas-critique': 'sound', dispatch: 'accept', accept: 'accept', integrate: 'verified', gate: 'accept', 'plan-integrate': 'accept' };

test('every view equals the literal its reader held, key for key', () => {
  assert.deepStrictEqual(VERDICT_FIELD, GRAPH_VERDICT_FIELD);
  assert.deepStrictEqual(HUMAN_GATE_VERDICT_FIELD, GRAPH_HUMAN_GATE);
  assert.deepStrictEqual(REASONING_VERDICT, INSPECT_VERDICT);
  assert.deepStrictEqual(REASONING_VERDICT, VIEW_COLLECT_VERDICT);
  assert.deepStrictEqual(TASKMANAGER_VERDICT, TASKMANAGER_LITERAL);
});

test('exact key sets of each view', () => {
  assert.deepStrictEqual(Object.keys(VERDICT_FIELD).sort(), ['critique', 'execute', 'gate', 'review', 'test']);
  assert.deepStrictEqual(Object.keys(HUMAN_GATE_VERDICT_FIELD).sort(), ['accept', 'areas-critique', 'critique', 'gate', 'integrate', 'plan-integrate']);
  assert.deepStrictEqual(Object.keys(REASONING_VERDICT).sort(), ['accept', 'critique', 'dispatch', 'gate', 'integrate']);
  assert.deepStrictEqual(Object.keys(TASKMANAGER_VERDICT).sort(), ['accept', 'areas-critique', 'critique', 'dispatch', 'gate', 'integrate', 'plan-integrate']);
});

test('graph.mjs still exports the same VERDICT_FIELD and HUMAN_GATE_VERDICT_FIELD objects', () => {
  assert.equal(graph.VERDICT_FIELD, VERDICT_FIELD);
  assert.equal(graph.HUMAN_GATE_VERDICT_FIELD, HUMAN_GATE_VERDICT_FIELD);
});

test('VERDICT_FIELD[stage] is today\'s value for every stage; truthy for exactly critique, execute, gate, review, test', () => {
  const stages = [
    ...graph.STAGES, 'execute', 'accept', 'integrate', 'dispatch', 'areas-critique', 'plan-integrate',
    'revise', 'cases', 'shape',
  ];
  for (const s of [...stages, 'toString', 'constructor', '__proto__']) {
    assert.equal(VERDICT_FIELD[s], GRAPH_VERDICT_FIELD[s], `VERDICT_FIELD[${s}]`);
  }
  // The truthiness uses: broker.mjs:876, 897, 1216 and prompts.mjs:379 test VERDICT_FIELD[n.stage].
  const truthy = stages.filter((s) => VERDICT_FIELD[s]);
  assert.deepStrictEqual([...new Set(truthy)].sort(), ['critique', 'execute', 'gate', 'review', 'test']);
  assert.equal(VERDICT_FIELD.revise, undefined);
  assert.equal(VERDICT_FIELD.cases, undefined);
});

test('views are plain objects, so a prototype lookup reads as it did for a literal', () => {
  for (const v of [VERDICT_FIELD, HUMAN_GATE_VERDICT_FIELD, REASONING_VERDICT, TASKMANAGER_VERDICT]) {
    assert.equal(Object.getPrototypeOf(v), Object.prototype);
  }
  assert.equal(HUMAN_GATE_VERDICT_FIELD.toString, Object.prototype.toString);
});

test('the map: each stage has one field, and every scope names a known view', () => {
  assert.deepStrictEqual(SCOPES, ['engine', 'humanGate', 'reasoning', 'manager']);
  for (const [stage, { field, scope }] of Object.entries(VERDICT_MAP)) {
    assert.ok(['accept', 'sound', 'verified'].includes(field), `${stage} field`);
    assert.ok(scope.length > 0 && scope.every((s) => SCOPES.includes(s)), `${stage} scope`);
  }
  assert.deepStrictEqual(verdictView('nope'), {});
});

test('taskmanager.mjs still holds the literal this test pins (or imports the view)', () => {
  const src = readFileSync(join(MCP, 'taskmanager-stages.mjs'), 'utf8');
  const m = src.match(/^const VERDICT = (\{.*\});$/m);
  if (m) assert.deepStrictEqual(new Function(`return ${m[1]}`)(), TASKMANAGER_VERDICT);
  else assert.match(src, /TASKMANAGER_VERDICT/);
});
