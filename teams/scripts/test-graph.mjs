// teams/scripts/test-graph.mjs - unit tests for graph.mjs's kind/flow tables: the shape
// the engine reads to expand a chain, key it to a verdict field, and pick default personas.
// Full round-trip behaviour (a real run expanding and judging a planning/qa subgoal) lives in
// test-broker.mjs alongside the document-kind suite this mirrors. The parent_shaped tests
// below (docs/plans/2026-09-21-teams-server-owns-the-loop.md §3) exercise createRun/runState/
// retrySubgoal/retrySpec directly against real run files - taskmanager.mjs's own
// parent_shaped coverage (openChild deciding it, foldChild reading it back) lives in
// test-taskmanager.mjs instead, since that is where a package's shape/split flag exists.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  KINDS, VERDICT_FIELD, REASONING_STAGES, FLOWS, kindSkills, kindOf, authorStage,
  createRun, runState, retrySubgoal, retrySpec, getNode, readyNodes, parentShapedTerminal,
  validateSpec,
} from '../mcp/graph.mjs';

test('planning kind: chain, no reasoning stage, and skills by stage', () => {
  assert.deepEqual(KINDS.planning.chain, ['investigate', 'draft', 'revise', 'gate']);
  assert.deepEqual(KINDS.planning.reasoning, []);
  assert.deepEqual(kindSkills('planning', 'investigate'), ['develop:domain-driven-design', 'cognition:assumption-extractor']);
  assert.deepEqual(kindSkills('planning', 'draft'), ['write:doc-coauthoring']);
  assert.deepEqual(kindSkills('planning', 'revise'), ['write:writer-verification', 'think:devils-advocate']);
  assert.deepEqual(kindSkills('planning', 'gate'), ['think:devils-advocate']);
  // investigate leads the chain but does not author the document; revise must be independent
  // of draft, not of the investigator.
  assert.equal(authorStage('planning'), 'draft');
});

test('qa kind: chain, no reasoning stage, and skills by stage', () => {
  assert.deepEqual(KINDS.qa.chain, ['cases', 'execute', 'gate']);
  assert.deepEqual(KINDS.qa.reasoning, []);
  assert.deepEqual(kindSkills('qa', 'cases'), ['develop:test-master', 'develop:scenario-director']);
  assert.deepEqual(kindSkills('qa', 'execute'), ['develop:scenario-actor', 'completion:verification-before-completion']);
  assert.deepEqual(kindSkills('qa', 'gate'), ['think:devils-advocate']);
  assert.equal(authorStage('qa'), 'cases');
});

test('neither investigate/draft/revise (planning) nor cases/execute (qa) is a reasoning stage - all mutate; only gate judges', () => {
  for (const s of ['investigate', 'draft', 'revise', 'cases', 'execute']) {
    assert.equal(REASONING_STAGES.has(s), false, `${s} should not be reasoning`);
  }
  assert.equal(REASONING_STAGES.has('gate'), true, 'gate stays reasoning, from BASE_REASONING');
  assert.equal(REASONING_STAGES.has('review'), true, 'document kind still contributes review');
});

test('execute carries a verdict field like test and review; revise and cases carry none, like draft and implement', () => {
  assert.equal(VERDICT_FIELD.execute, 'verified');
  assert.equal(VERDICT_FIELD.revise, undefined);
  assert.equal(VERDICT_FIELD.cases, undefined);
});

test('flow plan/qa supply their kind and a 3-persona list, the same shape as develop/document', () => {
  assert.equal(FLOWS.plan.kind, 'planning');
  assert.equal(FLOWS.plan.personas.length, 3);
  assert.equal(FLOWS.qa.kind, 'qa');
  assert.equal(FLOWS.qa.personas.length, 3);
});

test('kindOf is unaffected for unnamed and existing kinds, and resolves the two new ones', () => {
  assert.equal(kindOf({ id: 'U1' }), 'subgoal');
  assert.equal(kindOf({ id: 'D1', kind: 'planning' }), 'planning');
  assert.equal(kindOf({ id: 'Q1', kind: 'qa' }), 'qa');
});

// planning-audit: the kind the 기획 크로스 검수 (planning cross-review) pass uses -
// taskmanager.mjs's openAudit opens a child run of it after integration. This pins only the
// lookup-table row itself, as literals, so a later change to taskmanager.mjs cannot silently
// redefine the kind's shape.
test('planning-audit kind: chain, no reasoning stage, and both audit and gate skilled with devils-advocate', () => {
  assert.deepEqual(KINDS['planning-audit'].chain, ['audit', 'gate']);
  assert.deepEqual(KINDS['planning-audit'].reasoning, []);
  assert.deepEqual(kindSkills('planning-audit', 'audit'), ['think:devils-advocate']);
  assert.deepEqual(kindSkills('planning-audit', 'gate'), ['think:devils-advocate']);
  assert.equal(authorStage('planning-audit'), 'audit');
});

test('audit is not a reasoning stage - it mutates nothing, but the shape follows planning/qa: only gate judges', () => {
  assert.equal(REASONING_STAGES.has('audit'), false);
});

test('flow audit supplies the planning-audit kind and reuses planning\'s own persona list verbatim', () => {
  assert.equal(FLOWS.audit.kind, 'planning-audit');
  // Canary: pins an actual persona string as a literal, so this test still fails if
  // FLOWS.plan.personas and FLOWS.audit.personas drift together to something else - the
  // deepEqual below only proves the two lists match each other, not what they match to.
  assert.ok(FLOWS.audit.personas.includes('PO who owns value and scope'));
  assert.deepEqual(FLOWS.audit.personas, FLOWS.plan.personas);
});

test('kindOf resolves planning-audit', () => {
  assert.equal(kindOf({ id: 'A1', kind: 'planning-audit' }), 'planning-audit');
});

// ---------- parent_shaped (§3 of docs/plans/2026-09-21-teams-server-owns-the-loop.md) ----------
//
// A parent that already shaped and critiqued a package's one subgoal opens its child run with
// createRun({parent_shaped: true, ...}) instead of the ordinary plan/setgoal/critique start.
// These tests exercise createRun/runState/retrySubgoal/retrySpec directly against real run
// files, the same way test-goalgate.mjs exercises stagePolicy - no broker or taskmanager
// process needed, since none of this reads or writes anything outside the run object itself.

function scratchCwd() {
  return mkdtempSync(join(tmpdir(), 'graph-parent-shaped-'));
}

test('createRun({parent_shaped: true}) opens exactly the subgoal chain - no plan/setgoal/critique/gate:goal/report', () => {
  const cwd = scratchCwd();
  try {
    const run = createRun({
      cwd, request: 'do the one thing', flow: 'develop', vendor: 'self',
      parent_shaped: true, goal: 'ship the one thing', acceptance: ['the one thing works'],
    });
    assert.equal(run.parent_shaped, true);
    assert.deepEqual(run.nodes.map((n) => n.node_id), ['implement:U1:1', 'test:U1:1', 'gate:U1:1']);
    assert.equal(run.spec.goal, 'ship the one thing');
    assert.deepEqual(run.spec.acceptance, ['the one thing works']);
    assert.equal(run.spec.subgoals.length, 1);
    assert.equal(run.spec.subgoals[0].kind, 'subgoal', 'develop flow supplies the subgoal kind');
    // The head of the chain has no dep on a plan/setgoal/critique that was never created -
    // it is ready from the moment the run opens.
    assert.deepEqual(getNode(run, 'implement:U1:1').deps, []);
    assert.deepEqual(readyNodes(run).map((n) => n.node_id), ['implement:U1:1']);
    assert.equal(run.depth, 0, 'a caller that never asks gets depth 0');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('createRun({parent_shaped: true}) picks the kind from the run\'s own flow - a document package chains draft/review/gate', () => {
  const cwd = scratchCwd();
  try {
    const run = createRun({
      cwd, request: 'write the one page', flow: 'document', vendor: 'self',
      parent_shaped: true, goal: 'the page exists', acceptance: ['a reader can find X'],
    });
    assert.deepEqual(run.nodes.map((n) => n.node_id), ['draft:U1:1', 'review:U1:1', 'gate:U1:1']);
    assert.equal(run.spec.subgoals[0].kind, 'document');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('createRun without parent_shaped is unaffected: the ordinary plan/setgoal/critique start, parent_shaped left unset', () => {
  const cwd = scratchCwd();
  try {
    const run = createRun({ cwd, request: 'do a bigger thing', vendor: 'self' });
    assert.deepEqual(run.nodes.map((n) => n.node_id), ['plan', 'setgoal', 'critique']);
    assert.equal(run.parent_shaped, undefined);
    assert.equal(run.depth, 0);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('createRun({parent_shaped: true, depth: 2}) records the depth the caller passed', () => {
  const cwd = scratchCwd();
  try {
    const run = createRun({ cwd, request: 'r', vendor: 'self', parent_shaped: true, depth: 2 });
    assert.equal(run.depth, 2);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('runState on a parent_shaped run: running while the chain is open, complete the moment its gate is done', () => {
  const cwd = scratchCwd();
  try {
    let run = createRun({ cwd, request: 'r', flow: 'develop', vendor: 'self', parent_shaped: true, goal: 'g', acceptance: ['a'] });
    assert.equal(runState(run).state, 'running');
    getNode(run, 'implement:U1:1').state = 'done';
    getNode(run, 'implement:U1:1').result = { stage_ok: true, handoff: 'built', changed_files: ['a.txt'] };
    getNode(run, 'test:U1:1').state = 'done';
    getNode(run, 'test:U1:1').result = { stage_ok: true, verified: true };
    assert.equal(runState(run).state, 'running', 'the chain gate is still pending');
    const gate = getNode(run, 'gate:U1:1');
    gate.state = 'done';
    gate.result = { stage_ok: true, accept: true, match_pct: 95, checks: ['ok -> fine'] };
    assert.equal(runState(run).state, 'complete');
    assert.equal(parentShapedTerminal(run).node_id, 'gate:U1:1');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('runState on a parent_shaped run: a rejected gate with no retry called leaves the run blocked, not complete', () => {
  const cwd = scratchCwd();
  try {
    const run = createRun({ cwd, request: 'r', flow: 'develop', vendor: 'self', parent_shaped: true, goal: 'g', acceptance: ['a'] });
    for (const id of ['implement:U1:1', 'test:U1:1']) { getNode(run, id).state = 'done'; getNode(run, id).result = { stage_ok: true }; }
    const gate = getNode(run, 'gate:U1:1');
    gate.state = 'failed';
    gate.result = { stage_ok: true, accept: false, match_pct: 40, gaps: ['missing X'], reason: 'short' };
    assert.equal(runState(run).state, 'blocked');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
test('a report written over a settled failure completes with settled:true, and a clean one does not', () => {
  const clean = { nodes: [
    { node_id: 'report', stage: 'report', subgoal_id: null, state: 'done', deps: [] },
  ] };
  const st = runState(clean);
  assert.equal(st.state, 'complete');
  assert.equal(st.settled, undefined, 'a clean completion carries no settled marker');

  // settleFailure releases everything downstream as unreachable and a report is still written
  // over it. The state string stays 'complete' on purpose - every caller collapses anything
  // else to 'blocked' - but the marker stops the machine surface from reading plain success.
  const wrecked = { nodes: [
    { node_id: 'report', stage: 'report', subgoal_id: null, state: 'done', deps: [] },
    { node_id: 'dispatch:P1:1', stage: 'dispatch', subgoal_id: 'P1', state: 'unreachable', deps: [] },
  ] };
  const w = runState(wrecked);
  assert.equal(w.state, 'complete');
  assert.equal(w.settled, true);
});


test('retrySubgoal on a parent_shaped run opens a fresh chain attempt - there is no gate:goal round to reroute', () => {
  const cwd = scratchCwd();
  try {
    const run = createRun({ cwd, request: 'r', flow: 'develop', vendor: 'self', parent_shaped: true, goal: 'g', acceptance: ['a'] });
    for (const id of ['implement:U1:1', 'test:U1:1']) { getNode(run, id).state = 'done'; getNode(run, id).result = { stage_ok: true }; }
    const gate = getNode(run, 'gate:U1:1');
    gate.state = 'failed';
    gate.result = { stage_ok: true, accept: false, match_pct: 40, gaps: ['missing X'], reason: 'short' };
    const out = retrySubgoal(run, 'U1', 'fix it');
    assert.equal(out.attempt, 2);
    assert.deepEqual(readyNodes(out.run).map((n) => n.node_id), ['implement:U1:2']);
    // No gate:goal node ever existed to reroute behind the new attempt - retrySubgoal's own
    // staleRounds sweep (which only looks at subgoal_id === null gates) finds nothing and is
    // a silent no-op here, exactly as intended.
    assert.equal(out.run.nodes.some((n) => n.subgoal_id === null && n.stage === 'gate'), false);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('retrySpec on a parent_shaped run has no setgoal to redo - it delegates to retrySubgoal on the run\'s one subgoal', () => {
  const cwd = scratchCwd();
  try {
    const run = createRun({ cwd, request: 'r', flow: 'develop', vendor: 'self', parent_shaped: true, goal: 'g', acceptance: ['a'] });
    for (const id of ['implement:U1:1', 'test:U1:1']) { getNode(run, id).state = 'done'; getNode(run, id).result = { stage_ok: true }; }
    const gate = getNode(run, 'gate:U1:1');
    gate.state = 'failed';
    gate.result = { stage_ok: true, accept: false, match_pct: 40, gaps: ['missing X'], reason: 'twice the same reason' };
    const out = retrySpec(run, 'the shape has to change');
    assert.equal(out.attempt, 2, 'retrySpec falls back to a fresh chain attempt, not a fresh setgoal');
    assert.equal(out.run.nodes.some((n) => n.stage === 'setgoal'), false, 'no setgoal node is ever created on a parent_shaped run');
    assert.deepEqual(readyNodes(out.run).map((n) => n.node_id), ['implement:U1:2']);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

// ---------- planning subgoals write documents, not source (2026-09-22, P1) ----------

test('a planning subgoal may not name a source file in files[] - it writes a document', () => {
  const spec = {
    goal: 'PRD',
    acceptance: ['covers the request'],
    subgoals: [{ id: 'U1', kind: 'planning', title: 'time rules', acceptance: ['states the rule'], files: ['packages/cli/src/index.mjs'] }],
  };
  const problems = validateSpec(spec, { kind: 'planning', mixed: false, flow: 'plan' });
  assert.equal(problems.length, 1, JSON.stringify(problems));
  assert.match(problems[0], /not a document path/);
});

test('a planning subgoal naming a markdown document passes, and an audit subgoal is held to the same rule', () => {
  const ok = (files, kind) => validateSpec({
    goal: 'g', acceptance: ['a'],
    subgoals: [{ id: 'U1', kind, title: 't', acceptance: ['a'], files }],
  }, { kind, mixed: false });
  assert.deepEqual(ok(['docs/PRD.md'], 'planning'), []);
  assert.deepEqual(ok([], 'planning'), [], 'naming no file at all is still allowed');
  assert.equal(ok(['src/thing.mjs'], 'planning-audit').length, 1, 'the audit writes nothing either');
  assert.deepEqual(ok(['src/thing.mjs'], 'subgoal'), [], 'ordinary code work is untouched by the rule');
});
