// graph-kinds.mjs: the stage, kind and flow tables, imported from the module directly.
//   node --test teams/scripts/test-graph-kinds.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STAGES, KINDS, kindSkills, DEFAULT_KIND, kindOf, REASONING_STAGES, VERDICT_FIELD, reasonFromVerdict,
  FLOWS, DEFAULT_FLOW, flowOf, defaultKind, normalizeSpec, authorStage, isAuthorNode,
} from '../mcp/graph-kinds.mjs';

test('STAGES lists the ten run-level and chain stages in order', () => {
  assert.deepEqual(STAGES, ['plan', 'setgoal', 'critique', 'implement', 'test', 'draft', 'review', 'gate', 'repair', 'report']);
});

test('KINDS: every kind has a chain ending in gate, and every reasoning stage is in its chain', () => {
  assert.deepEqual(Object.keys(KINDS), ['subgoal', 'document', 'planning', 'planning-light', 'qa', 'planning-audit']);
  for (const [name, k] of Object.entries(KINDS)) {
    assert.equal(k.chain.at(-1), 'gate', `${name} closes on gate`);
    for (const s of k.reasoning) assert.ok(k.chain.includes(s), `${name}: ${s} is a chain stage`);
  }
  assert.equal(DEFAULT_KIND, 'subgoal');
});

test('kindSkills returns a copy by stage, [] for an unknown stage, the default kind for an unknown kind', () => {
  const a = kindSkills('subgoal', 'implement');
  assert.deepEqual(a, ['develop:clean-code']);
  a.push('x');
  assert.deepEqual(kindSkills('subgoal', 'implement'), ['develop:clean-code'], 'a caller cannot mutate the table');
  assert.deepEqual(kindSkills('subgoal', 'nope'), []);
  assert.deepEqual(kindSkills('no-such-kind', 'gate'), KINDS.subgoal.skills.gate);
});

test('kindOf reads sg.kind as a string and falls back to the default', () => {
  assert.equal(kindOf(null), 'subgoal');
  assert.equal(kindOf({}), 'subgoal');
  assert.equal(kindOf({ kind: 'qa' }), 'qa');
  assert.equal(kindOf({ kind: 7 }), '7');
});

test('REASONING_STAGES: the run-level stages plus each kind\'s own reasoning stages', () => {
  for (const s of ['plan', 'setgoal', 'critique', 'gate', 'report', 'reduce', 'ask', 'review']) assert.ok(REASONING_STAGES.has(s), s);
  for (const s of ['implement', 'draft', 'revise', 'test', 'execute', 'audit', 'investigate', 'repair']) assert.ok(!REASONING_STAGES.has(s), `${s} mutates`);
});

test('VERDICT_FIELD is the engine view of the verdict map', () => {
  assert.deepEqual(VERDICT_FIELD, { gate: 'accept', critique: 'sound', test: 'verified', review: 'verified', execute: 'verified' });
});

test('reasonFromVerdict: a failing check, else evidence, else every check; empty when the verdict was not false', () => {
  assert.equal(reasonFromVerdict({ accept: true }, 'accept'), '');
  assert.equal(reasonFromVerdict({ accept: false }, null), '');
  assert.equal(reasonFromVerdict({ accept: false, reason: 'because' }, 'accept'), '');
  assert.equal(reasonFromVerdict({ accept: false, gaps: ['g'] }, 'accept'), '');
  assert.equal(reasonFromVerdict({ sound: false, blocking: ['b'] }, 'sound'), '');
  assert.equal(reasonFromVerdict({ verified: false, checks: ['ran a -> ok', 'ran b -> tests failed'] }, 'verified'), 'ran b -> tests failed');
  assert.equal(reasonFromVerdict({ verified: false, checks: ['ran a -> ok'], evidence: 'the summary' }, 'verified'), 'the summary');
  assert.equal(reasonFromVerdict({ verified: false, checks: ['one', 'two'] }, 'verified'), 'one; two');
  assert.equal(reasonFromVerdict({ verified: false, checks: ["x -> 'does not move the score'"], evidence: 'e' }, 'verified'), 'e', 'quoted text is not a failure');
  assert.equal(reasonFromVerdict({ verified: false, evidence: 'x'.repeat(400) }, 'verified').length, 300);
});

test('FLOWS / flowOf / defaultKind: a pinned flow wins, auto uses flow_chosen, planning goes light by planning_mode', () => {
  assert.equal(DEFAULT_FLOW, 'develop');
  assert.deepEqual(Object.keys(FLOWS), ['develop', 'document', 'plan', 'qa', 'audit']);
  assert.equal(flowOf({ flow: 'qa' }), 'qa');
  assert.equal(flowOf({ flow: 'auto', flow_chosen: 'document' }), 'document');
  assert.equal(flowOf({ flow: 'auto', flow_chosen: null }), null);
  assert.equal(flowOf({ flow: 'bogus' }), null);
  assert.equal(defaultKind({ flow: 'auto' }), 'subgoal');
  assert.equal(defaultKind({ flow: 'plan' }), 'planning');
  assert.equal(defaultKind({ flow: 'plan', planning_mode: 'light' }), 'planning-light');
  assert.equal(defaultKind({ flow: 'qa', planning_mode: 'light' }), 'qa');
});

test('normalizeSpec: gives every subgoal an explicit kind, carries a package\'s acceptance, passes a non-spec through', () => {
  assert.equal(normalizeSpec({}, null), null);
  assert.deepEqual(normalizeSpec({}, { goal: 'g' }), { goal: 'g' }, 'no subgoals array: untouched');
  const out = normalizeSpec({ flow: 'document' }, { subgoals: [{ id: 'U1' }, { id: 'U2', kind: 'qa' }, 'junk'] });
  assert.deepEqual(out.subgoals, [{ id: 'U1', kind: 'document' }, { id: 'U2', kind: 'qa' }, 'junk']);
  const light = normalizeSpec({ flow: 'plan', planning_mode: 'light' }, { subgoals: [{ id: 'U1', kind: 'planning' }] });
  assert.equal(light.subgoals[0].kind, 'planning-light');
  const pkg = normalizeSpec({ flow: 'develop', package: { acceptance: ['A', 'B'] } }, { acceptance: ['B', 'C'], subgoals: [] });
  assert.deepEqual(pkg.acceptance, ['A', 'B', 'C'], 'missing package items are put first, none duplicated');
});

test('authorStage: the kind\'s named author, else chain[0]; isAuthorNode matches only that stage', () => {
  assert.equal(authorStage('subgoal'), 'implement');
  assert.equal(authorStage('planning'), 'draft');
  assert.equal(authorStage('planning-light'), 'template-fill');
  assert.equal(authorStage('qa'), 'cases');
  assert.equal(authorStage('unknown'), 'implement');
  const run = { spec: { subgoals: [{ id: 'U1', kind: 'planning' }, { id: 'U2' }] } };
  assert.equal(isAuthorNode(run, { subgoal_id: 'U1', stage: 'draft' }), true);
  assert.equal(isAuthorNode(run, { subgoal_id: 'U1', stage: 'investigate' }), false);
  assert.equal(isAuthorNode(run, { subgoal_id: 'U2', stage: 'implement' }), true);
  assert.equal(isAuthorNode(run, { stage: 'plan' }), false);
  assert.equal(isAuthorNode(run, null), false);
});
