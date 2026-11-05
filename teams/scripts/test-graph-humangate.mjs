// graph-humangate.mjs: gate:human - which nodes a person judges, auto-pass, and the person's result shape.
//   node --test teams/scripts/test-graph-humangate.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HUMAN_GATE_VERDICT_FIELD, humanGateIdentity, humanGateVerdictField, autoPassHumanGateResult,
  promoteHumanGates, humanGateResultFromPayload,
} from '../mcp/graph-humangate.mjs';
import { HUMAN_GATE_VERDICT_FIELD as MAP_VIEW } from '../mcp/verdictfields.mjs';
import { node } from '../mcp/graph-nodes.mjs';

test('HUMAN_GATE_VERDICT_FIELD is the humanGate view of the verdict map, by identity', () => {
  assert.equal(HUMAN_GATE_VERDICT_FIELD, MAP_VIEW);
  assert.deepEqual(Object.keys(HUMAN_GATE_VERDICT_FIELD), ['gate', 'critique', 'accept', 'integrate', 'areas-critique', 'plan-integrate']);
});

test('humanGateIdentity / humanGateVerdictField: gate:goal by node id, else the stage; authoring stages have no field', () => {
  assert.equal(humanGateIdentity(node('gate:goal:2b', 'gate')), 'gate:goal');
  assert.equal(humanGateIdentity(node('gate:U1:1', 'gate')), 'gate');
  assert.equal(humanGateVerdictField(node('gate:goal:1', 'gate')), 'accept');
  assert.equal(humanGateVerdictField(node('critique', 'critique')), 'sound');
  assert.equal(humanGateVerdictField(node('integrate', 'integrate')), 'verified');
  assert.equal(humanGateVerdictField(node('implement:U1:1', 'implement')), null);
});

test('autoPassHumanGateResult: passes with the node\'s own verdict field, and a gate-shaped result for accept', () => {
  const crit = autoPassHumanGateResult(node('critique', 'critique'));
  assert.deepEqual([crit.stage_ok, crit.sound, 'match_pct' in crit], [true, true, false]);
  const gate = autoPassHumanGateResult(node('gate:goal:1', 'gate'));
  assert.deepEqual([gate.accept, gate.match_pct, gate.attacks.length], [true, 100, 1]);
  assert.match(gate.reason, /auto-passed/);
});

test('humanGateResultFromPayload: accept only on accept === true; reasons and gaps ride through; resplit is the one extra', () => {
  const yes = humanGateResultFromPayload(node('gate:goal:1', 'gate'), { accept: true });
  assert.deepEqual([yes.accept, yes.match_pct, yes.reason], [true, 100, 'approved by a person (gate:human)']);
  const no = humanGateResultFromPayload(node('gate:goal:1', 'gate'), { accept: 'yes', reason: 'too thin', gaps: ['g'], resplit: true });
  assert.deepEqual([no.accept, no.match_pct, no.reason, no.gaps, no.resplit], [false, 0, 'too thin', ['g'], true]);
  assert.deepEqual(no.attacks, ['gate:human: too thin']);
  const crit = humanGateResultFromPayload(node('critique', 'critique'), undefined);
  assert.deepEqual([crit.sound, crit.reason, crit.gaps, 'resplit' in crit, 'match_pct' in crit], [false, 'rejected by a person (gate:human)', [], false, false]);
  const authoring = humanGateResultFromPayload(node('implement:U1:1', 'implement'), { accept: true });
  assert.ok(!('accept' in authoring) && !('verified' in authoring), 'no verdict field for an authoring stage');
});

test('promoteHumanGates: nothing named, nothing happens', () => {
  const run = { nodes: [node('critique', 'critique')], human_gates: [] };
  assert.deepEqual(promoteHumanGates(run), { parked: [], autoPass: [] });
  assert.equal(run.nodes[0].state, 'pending');
});

test('promoteHumanGates: interactive parks a ready named node once; a node behind an unmet dep, or not named, is left', () => {
  const crit = node('critique', 'critique');
  const gate = node('gate:U1:1', 'gate', ['critique']);
  const other = node('gate:goal:1', 'gate');
  const impl = node('implement:U1:1', 'implement');
  const run = { human_gates: ['critique', 'gate'], interactive: true, nodes: [crit, gate, other, impl] };
  const out = promoteHumanGates(run);
  assert.deepEqual(out.parked.map((n) => n.node_id), ['critique']);
  assert.deepEqual([crit.state, crit.human_gate, crit.assignment.executor], ['waiting_human', true, 'human']);
  assert.equal(gate.state, 'pending', 'its dep is not done');
  assert.equal(other.state, 'pending', 'gate:goal was not named');
  assert.equal(impl.state, 'pending', 'an authoring stage is never gated');
  assert.deepEqual(promoteHumanGates(run), { parked: [], autoPass: [] }, 'decided once (human_gate_seen)');
});

test('promoteHumanGates: not interactive marks the node for auto-pass and records why', () => {
  const crit = node('critique', 'critique');
  const run = { human_gates: ['critique'], interactive: false, nodes: [crit] };
  const out = promoteHumanGates(run);
  assert.deepEqual(out.autoPass.map((n) => n.node_id), ['critique']);
  assert.equal(crit.state, 'pending', 'the caller applies the auto-pass');
  assert.equal(crit.auto_decided_pin.by, 'auto');
  assert.match(crit.auto_decided_pin.reason, /critique is in human_gates but this run is not interactive/);
});
