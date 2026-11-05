#!/usr/bin/env node
// broker-normalize.mjs: parseVendorResult, verdict and nodeSucceeded, called directly on plain
// node/run objects (test-broker.mjs reaches the same rules only through a spawned broker).
//
//   node --test teams/scripts/test-broker-normalize.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { entry, nodeSucceeded, parseVendorResult, verdict } from '../mcp/broker-normalize.mjs';

test('entry names the stage and node', () => {
  assert.equal(entry({ stage: 'implement', node_id: 'implement:U1:1' }), 'implement node implement:U1:1');
});

test('parseVendorResult: an object result is taken as is; no report is null; an empty reply is null', () => {
  const result = { stage_ok: true, x: 1 };
  assert.equal(parseVendorResult({ result }), result);
  assert.equal(parseVendorResult(null), null);
  assert.equal(parseVendorResult({ last_message: '   ' }), null);
  assert.equal(parseVendorResult({}), null);
});

test('parseVendorResult digs JSON out of prose, a fence, or a string result', () => {
  assert.deepEqual(parseVendorResult({ last_message: '{"a":1}' }), { a: 1 });
  assert.deepEqual(parseVendorResult({ last_message: 'Here you go:\n```json\n{"a":2}\n```\nbye' }), { a: 2 });
  assert.deepEqual(parseVendorResult({ last_message: 'I think {"a":3} is right' }), { a: 3 });
  assert.deepEqual(parseVendorResult({ result: '{"a":4}' }), { a: 4 });
});

test('parseVendorResult flags what it cannot parse instead of shaping it into a pass', () => {
  const out = parseVendorResult({ last_message: 'I could not do it.' });
  assert.equal(out._unparsed, true);
  assert.equal(out.handoff, 'I could not do it.');
  assert.equal(out.stage_ok, undefined, 'no stage_ok at all: an unflagged fallback read as success');
  assert.equal(parseVendorResult({ last_message: 'x'.repeat(5000) }).handoff.length, 4000);
});

const run = { run_id: 'r1' };

test('verdict: the base shape every node gets, and a reason cut to 300 characters', () => {
  const n = { node_id: 'implement:U1:1', stage: 'implement', vendor: 'claude', executor: 'claude', model: 'sonnet', state: 'done', subgoal_id: 'U1',
    result: { stage_ok: true, changed_files_verified: true, change_attribution: 'isolated', reason: 'r'.repeat(400) }, detail_path: '/d' };
  const v = verdict(run, n);
  assert.deepEqual(v, {
    run_id: 'r1', node_id: 'implement:U1:1', stage: 'implement', vendor: 'claude', executor: 'claude', model: 'sonnet', state: 'done',
    stage_ok: true, changed_files_verified: true, change_attribution: 'isolated', reason: 'r'.repeat(300), detail_path: '/d',
  });
});

test('verdict: a mutating node with no cross-check reports null attribution and lists contradicted files', () => {
  const v = verdict(run, { node_id: 'i', stage: 'implement', state: 'failed', result: { stage_ok: false, contradicted_files: ['x'], verification_error: 'claimed x' } });
  assert.equal(v.changed_files_verified, null);
  assert.equal(v.change_attribution, null);
  assert.deepEqual(v.contradicted_files, ['x']);
  assert.equal(v.reason, 'claimed x');
  assert.equal(v.detail_path, null);
});

test('verdict: gate, critique and test each surface their own verdict field', () => {
  const gate = verdict(run, { node_id: 'gate:goal:1', stage: 'gate', state: 'done', subgoal_id: null,
    result: { stage_ok: true, accept: true, match_pct: 95, gaps: ['a'], observations: ['o1', 'o2'], spec_drift: ['d'], attacks: ['x', 'y', 'z'] } });
  assert.deepEqual([gate.accept, gate.match_pct, gate.gap_count, gate.observation_count, gate.spec_drift_count, gate.attack_count], [true, 95, 1, 2, 1, 3]);
  const subGate = verdict(run, { node_id: 'gate:U1:1', stage: 'gate', state: 'done', subgoal_id: 'U1', result: { stage_ok: true, accept: false } });
  assert.equal(subGate.attack_count, undefined, 'only the goal gate counts attacks');
  assert.equal(subGate.accept, false);
  assert.equal(verdict(run, { node_id: 'c', stage: 'critique', state: 'done', result: { stage_ok: true, sound: true } }).sound, true);
  assert.equal(verdict(run, { node_id: 't', stage: 'test', state: 'done', result: { stage_ok: true, verified: false } }).verified, false);
});

test('verdict makes an overruled executor visible: submitted_stage_ok, self_reported_stage_ok, missing_verdict, killed_for, independence', () => {
  const overruled = verdict(run, { node_id: 'i', stage: 'implement', state: 'failed', result: { stage_ok: false, submitted_stage_ok: true } });
  assert.equal(overruled.submitted_stage_ok, true);
  const self = verdict(run, { node_id: 'i', stage: 'implement', state: 'done', result: { stage_ok: true, self_reported_stage_ok: false } });
  assert.equal(self.self_reported_stage_ok, false);
  const missing = verdict(run, { node_id: 't', stage: 'test', state: 'failed', result: { stage_ok: true } });
  assert.equal(missing.missing_verdict, 'verified');
  const killed = verdict(run, { node_id: 'p', stage: 'plan', state: 'failed', result: { stage_ok: false, killed_for: 'timeout', reviewer_independence: 'unverifiable-self' } });
  assert.equal(killed.killed_for, 'timeout');
  assert.equal(killed.reviewer_independence, 'unverifiable-self');
});

const gate = (result, extra = {}) => nodeSucceeded({}, { stage: 'gate', subgoal_id: null, ...extra }, result);

test('nodeSucceeded: stage_ok false never succeeds; a node with no verdict field needs only stage_ok', () => {
  assert.equal(nodeSucceeded({}, { stage: 'implement' }, { stage_ok: false }), false);
  assert.equal(nodeSucceeded({}, { stage: 'implement' }, { stage_ok: true }), true);
});

test('nodeSucceeded: the verdict must be present and affirmative (test: verified, review: verified, critique: sound)', () => {
  for (const [stage, field] of [['test', 'verified'], ['review', 'verified'], ['critique', 'sound']]) {
    assert.equal(nodeSucceeded({}, { stage }, { stage_ok: true }), false, `${stage}: absent ${field} is not a pass`);
    assert.equal(nodeSucceeded({}, { stage }, { stage_ok: true, [field]: false }), false, `${stage}: false ${field}`);
    assert.equal(nodeSucceeded({}, { stage }, { stage_ok: true, [field]: true }), true, `${stage}: true ${field}`);
  }
});

test('nodeSucceeded: execute is the exception - verified:false (defects found) is still a successful run', () => {
  assert.equal(nodeSucceeded({}, { stage: 'execute' }, { stage_ok: true, verified: false }), true);
  assert.equal(nodeSucceeded({}, { stage: 'execute' }, { stage_ok: false, verified: true }), false);
});

test('nodeSucceeded: a gate accept needs checks[]; a subgoal gate needs nothing more', () => {
  const sub = { subgoal_id: 'U1' };
  assert.equal(gate({ stage_ok: true, accept: true }, sub), false, 'accept with no checks is a guess');
  assert.equal(gate({ stage_ok: true, accept: true, checks: ['ran x'] }, sub), true);
  assert.equal(gate({ stage_ok: true, accept: false, checks: ['ran x'] }, sub), false);
});

test('nodeSucceeded: the goal gate also needs attacks[] and a match_pct at the run threshold (default 90)', () => {
  const ok = { stage_ok: true, accept: true, checks: ['c'], attacks: ['a'] };
  assert.equal(gate(ok), true);
  assert.equal(gate({ ...ok, attacks: [] }), false, 'never invoked from outside the tree');
  assert.equal(gate({ ...ok, match_pct: 95 }), true);
  assert.equal(gate({ ...ok, match_pct: 80, gaps: ['named'] }), false, 'below the floor with a named gap fails');
  assert.equal(gate({ ...ok, match_pct: 86 }), true, 'within 5 of the floor, accepted, no named gap: a band, not a waiver');
  assert.equal(gate({ ...ok, match_pct: 70 }), false, 'an accept at 70 with no gaps contradicts itself');
});

test('nodeSucceeded: run.goal_threshold moves the floor, and 0 goes by verdict alone', () => {
  const ok = { stage_ok: true, accept: true, checks: ['c'], attacks: ['a'], match_pct: 70, gaps: ['g'] };
  const goal = { stage: 'gate', subgoal_id: null };
  assert.equal(nodeSucceeded({ goal_threshold: 60 }, goal, ok), true);
  assert.equal(nodeSucceeded({ goal_threshold: 0 }, goal, ok), true);
  assert.equal(nodeSucceeded({ goal_threshold: 95 }, goal, ok), false);
  assert.equal(nodeSucceeded({}, goal, ok), false);
});
