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
import { composePrompt } from '../mcp/prompts.mjs';
import {
  KINDS, VERDICT_FIELD, REASONING_STAGES, FLOWS, kindSkills, kindOf, authorStage,
  createRun, runState, retrySubgoal, retrySpec, getNode, readyNodes, parentShapedTerminal,
  validateSpec,
  expandSubgoals, node,
  applyHumanPin, releaseHumanPin, currentAttempt, promoteWaitingHuman, openAsk,
  computeWriteScope, nodeBriefing, goalConsensus, pushGoalGateRound,
  promoteHumanGates, autoPassHumanGateResult, humanGateResultFromPayload,
  humanGateIdentity, humanGateVerdictField,
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
test('reduce: the fold a multi-subgoal run gets, and the single-subgoal run that does not', () => {
  // expandSubgoals saves, so each fixture needs its own store - a shared run_id under one cwd
  // merges with whatever a sibling test left behind.
  const dir = mkdtempSync(join(tmpdir(), 'reduce-'));
  const run = (n) => ({
    run_id: `r${n}`, cwd: dir, goal_judges: 1, max_retries: 2,
    nodes: [node('critique', 'critique', [], { state: 'done', result: {} })],
    spec: { subgoals: Array.from({ length: n }, (_, i) => ({ id: `U${i + 1}`, deps: [] })) },
  });

  const many = run(3);
  expandSubgoals(many, many.spec.subgoals);
  const red = many.nodes.find((x) => x.node_id === 'reduce');
  assert.ok(red, 'three subgoals get a fold');
  assert.deepEqual(red.deps.slice().sort(), ['gate:U1:1', 'gate:U2:1', 'gate:U3:1']);
  const goal = many.nodes.find((x) => x.node_id === 'gate:goal:1');
  assert.deepEqual(goal.deps, ['reduce'], 'the data edge runs through the fold');
  // Sight must not narrow with the data edge: nodeBriefing walks deps AND after, so the gate
  // keeps every subgoal gate as an order-only edge or it judges work it was never shown.
  assert.deepEqual((goal.after || []).slice().sort(), ['gate:U1:1', 'gate:U2:1', 'gate:U3:1']);

  const one = run(1);
  expandSubgoals(one, one.spec.subgoals);
  assert.equal(one.nodes.some((x) => x.stage === 'reduce'), false, 'one subgoal has nothing to fold');
  assert.deepEqual(one.nodes.find((x) => x.node_id === 'gate:goal:1').deps, ['gate:U1:1']);
  rmSync(dir, { recursive: true, force: true });
});

test('reduce reports and does not repair: it is a reasoning stage', () => {
  // The level above decides what happens to a collision or an orphan - a stage that observed
  // the set and then acted on it would be deciding at the level that was asked to look.
  assert.equal(REASONING_STAGES.has('reduce'), true);
});

test('a retry reopens the fold it already ran, bumping reopened so mergeOnto lets it back', () => {
  const dir = mkdtempSync(join(tmpdir(), 'refold-'));
  const run = {
    run_id: 'refold', cwd: dir, max_retries: 2,
    spec: { subgoals: [{ id: 'U1' }, { id: 'U2' }] },
    nodes: [
      node('gate:U1:1', 'gate', [], { subgoal_id: 'U1', state: 'done', result: {} }),
      node('gate:U2:1', 'gate', [], { subgoal_id: 'U2', state: 'failed', result: {} }),
      node('reduce', 'reduce', ['gate:U1:1', 'gate:U2:1'], { state: 'done', result: { handoff: 'stale' } }),
      node('gate:goal:1', 'gate', ['reduce'], { subgoal_id: null, after: ['gate:U1:1', 'gate:U2:1'], state: 'failed', result: {} }),
    ],
  };
  retrySubgoal(run, 'U2', '');
  const red = run.nodes.find((n) => n.node_id === 'reduce');
  assert.equal(red.state, 'pending', 'a fold that ran before the retry folded a set that no longer exists');
  assert.equal(red.result, null);
  assert.equal(red.reopened, 1, 'mergeOnto refuses done -> pending without this, and the reset is merged away');
  assert.ok(red.deps.includes('gate:U2:2'), 'and it now waits on the live attempt');
  rmSync(dir, { recursive: true, force: true });
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

// ---------- a human can pick up a card (waiting_human, the assignee pin) ----------

test('expandSubgoals applies a spec subgoal\'s assignee pin to the AUTHOR stage node only, never a judging stage', () => {
  const cwd = scratchCwd();
  try {
    // A spec subgoal's own assignee is the MODEL's pin (setgoal wrote it, not tm_assign), so it
    // only parks when the run is interactive - see applyHumanPin's source distinction, added
    // for the 0.27.3 review. interactive:true here is what makes THIS test about the pin
    // landing on the right node, not about the interactive gate itself (that gate has its own
    // tests below).
    const run = { cwd, run_id: 'r1', spec: null, nodes: [node('critique', 'critique', [])], goal_judges: 1, interactive: true };
    getNode(run, 'critique').state = 'done';
    expandSubgoals(run, [
      { id: 'U1', kind: 'subgoal', title: 't', acceptance: ['a'], assignee: 'human', deps: [] },
      { id: 'U2', kind: 'document', title: 'd', acceptance: ['a'], assignee: { who: 'sanghyeon' }, deps: [] },
      { id: 'U3', kind: 'subgoal', title: 'auto', acceptance: ['a'], deps: [] },
    ]);
    const implU1 = getNode(run, 'implement:U1:1');
    assert.deepEqual(implU1.assignment, { executor: 'human', vendor: 'human', who: null, reason: 'pinned by the subgoal spec (assignee)' });
    assert.equal(getNode(run, 'test:U1:1').assignment, undefined, 'test is a judging stage - never pinned');
    assert.equal(getNode(run, 'gate:U1:1').assignment, undefined, 'gate is a judging stage - never pinned');
    const draftU2 = getNode(run, 'draft:U2:1');
    assert.equal(draftU2.assignment.executor, 'human');
    assert.equal(draftU2.assignment.who, 'sanghyeon');
    assert.equal(getNode(run, 'review:U2:1').assignment, undefined, 'review is document\'s judging stage');
    assert.equal(getNode(run, 'implement:U3:1').assignment, undefined, 'no assignee in the spec - nothing pinned');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('applyHumanPin lands planning\'s pin on draft (the kind\'s own author), not chain[0] investigate', () => {
  // A bare sg.assignee (no {by: 'user'}) is a MODEL pin, so this run must be interactive for it
  // to park at all - see the "source" tests below for the off case.
  const run = { spec: null, nodes: [], interactive: true };
  const sg = { id: 'U1', kind: 'planning', assignee: 'human' };
  const chainNodes = KINDS.planning.chain;
  for (let i = 0, prev = null; i < chainNodes.length; i++) {
    const id = `${chainNodes[i]}:U1:1`;
    run.nodes.push(node(id, chainNodes[i], prev ? [prev] : [], { subgoal_id: 'U1', attempt: 1 }));
    prev = id;
  }
  applyHumanPin(run, sg, 'U1', 1);
  assert.equal(getNode(run, 'investigate:U1:1').assignment, undefined);
  assert.equal(getNode(run, 'draft:U1:1').assignment.executor, 'human');
  assert.equal(getNode(run, 'revise:U1:1').assignment, undefined);
  assert.equal(getNode(run, 'gate:U1:1').assignment, undefined);
});

test('applyHumanPin only touches a still-pending node - work already running or done is left alone', () => {
  const run = { spec: null, nodes: [node('implement:U1:1', 'implement', [], { subgoal_id: 'U1', attempt: 1, state: 'done' })] };
  applyHumanPin(run, { id: 'U1', kind: 'subgoal', assignee: 'human' }, 'U1', 1);
  assert.equal(getNode(run, 'implement:U1:1').assignment, undefined, 'a finished node is not retroactively pinned');
});

test('promoteWaitingHuman parks a ready, human-pinned pending node - and only once its deps are met', () => {
  const run = {
    nodes: [
      node('gate:U0:1', 'gate', [], { subgoal_id: 'U0', state: 'done', result: { stage_ok: true } }),
      node('implement:U1:1', 'implement', ['gate:U0:1'], {
        subgoal_id: 'U1', attempt: 1, assignment: { executor: 'human', vendor: 'human', who: null },
      }),
      node('implement:U2:1', 'implement', ['gate:U0:1', 'gate:never:1'], {
        subgoal_id: 'U2', attempt: 1, assignment: { executor: 'human', vendor: 'human', who: null },
      }),
    ],
  };
  const touched = promoteWaitingHuman(run);
  assert.deepEqual(touched.map((n) => n.node_id), ['implement:U1:1'], 'U2 is still waiting on an unmet dep - not ready yet');
  const u1 = getNode(run, 'implement:U1:1');
  assert.equal(u1.state, 'waiting_human');
  assert.ok(Number.isInteger(u1.waiting_since));
  assert.equal(getNode(run, 'implement:U2:1').state, 'pending', 'not promoted until its own deps are met');
  assert.deepEqual(readyNodes(run).map((n) => n.node_id), [], 'a waiting_human node is never offered by readyNodes');
});

test('runState reports waiting_human distinctly from blocked, and a settled report still wins', () => {
  const waiting = { nodes: [
    node('gate:U0:1', 'gate', [], { subgoal_id: 'U0', state: 'done', result: { stage_ok: true } }),
    node('implement:U1:1', 'implement', ['gate:U0:1'], { subgoal_id: 'U1', attempt: 1, state: 'waiting_human', waiting_since: Date.now() }),
  ] };
  const st = runState(waiting);
  assert.equal(st.state, 'waiting_human');
  assert.equal(st.counts.waiting_human, 1);

  const genuinelyStuck = { nodes: [
    node('implement:U1:1', 'implement', ['never'], { subgoal_id: 'U1', attempt: 1 }),
  ] };
  assert.equal(runState(genuinelyStuck).state, 'blocked', 'no waiting_human node here - an ordinary deadlock reads blocked, unchanged');

  const doneAnyway = { nodes: [
    node('report', 'report', [], { state: 'done' }),
    node('implement:U1:1', 'implement', [], { subgoal_id: 'U1', attempt: 1, state: 'waiting_human' }),
  ] };
  assert.equal(runState(doneAnyway).state, 'complete', 'a finished report outranks a stray waiting_human leftover');
});

test('runState on a parent_shaped run reports waiting_human the same way', () => {
  const cwd = scratchCwd();
  try {
    // subgoal_assignee is the shape's own field (openChild's pkg.assignee) - a MODEL pin, so
    // interactive:true is what makes it park here rather than being auto-decided.
    const run = createRun({ cwd, request: 'r', flow: 'develop', vendor: 'self', parent_shaped: true, goal: 'g', acceptance: ['a'], subgoal_assignee: 'human', interactive: true });
    assert.equal(getNode(run, 'implement:U1:1').assignment.executor, 'human', 'subgoal_assignee wires the pin through createRun for the common parent_shaped case');
    promoteWaitingHuman(run);
    assert.equal(runState(run).state, 'waiting_human');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('releaseHumanPin (tm_assign to: "auto") returns a waiting_human node to pending, and it dispatches normally again', () => {
  const run = {
    spec: { subgoals: [{ id: 'U1', kind: 'subgoal', assignee: 'human' }] },
    nodes: [
      node('implement:U1:1', 'implement', [], {
        subgoal_id: 'U1', attempt: 1, state: 'waiting_human', waiting_since: Date.now(),
        assignment: { executor: 'human', vendor: 'human', who: null },
      }),
    ],
  };
  releaseHumanPin(run, run.spec.subgoals[0], 'U1', 1);
  const n = getNode(run, 'implement:U1:1');
  assert.equal(n.state, 'pending');
  assert.equal(n.waiting_since, undefined);
  assert.equal(n.assignment, undefined);
  assert.equal(run.spec.subgoals[0].assignee, undefined);
  assert.deepEqual(readyNodes(run).map((x) => x.node_id), ['implement:U1:1'], 'released back into the ordinary ready pool');
});

test('a rejected human-authored subgoal reassigns to a fresh attempt that is pinned again - not to a model', () => {
  const cwd = scratchCwd();
  try {
    const run = createRun({ cwd, request: 'r', flow: 'develop', vendor: 'self', parent_shaped: true, goal: 'g', acceptance: ['a'], subgoal_assignee: 'human', interactive: true });
    for (const id of ['implement:U1:1', 'test:U1:1']) { getNode(run, id).state = 'done'; getNode(run, id).result = { stage_ok: true }; }
    const gate = getNode(run, 'gate:U1:1');
    gate.state = 'failed';
    gate.result = { stage_ok: true, accept: false, match_pct: 40, gaps: ['missing X'], reason: 'short' };
    const out = retrySubgoal(run, 'U1', 'fix it');
    assert.equal(out.attempt, 2);
    const again = getNode(out.run, 'implement:U1:2');
    assert.equal(again.assignment.executor, 'human', 'the retry lands back on the human, per the spec pin');
    // readyNodes() itself does not know about the pin - it is a plain dependency-readiness
    // filter, so the fresh attempt shows up there exactly like any other ready node. What keeps
    // it off a driver is the promotion step (broker.mjs's team_next calls promoteWaitingHuman
    // BEFORE reading readyNodes) - the same order this asserts directly.
    assert.deepEqual(readyNodes(out.run).map((n) => n.node_id), ['implement:U1:2']);
    promoteWaitingHuman(out.run);
    assert.equal(getNode(out.run, 'implement:U1:2').state, 'waiting_human');
    assert.deepEqual(readyNodes(out.run).map((n) => n.node_id), [], 'once promoted, no longer offered to a driver');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

// ---------- a pin's SOURCE decides whether it parks (0.27.3 review, 2026-09-24) ----------
//
// design §7's rule: a user's tm_assign (marked {by: 'user'}) always parks - the user is present
// by definition. A MODEL's own assignee (a bare 'human' string or {who} object, no `by` field -
// a shape package or a setgoal subgoal writing it, never tm_assign) only parks when the run is
// interactive; a non-interactive run auto-decides it instead, leaving the node pending (so it
// dispatches to an AI like any other node) and recording what would have parked it.

test('applyHumanPin: a MODEL pin (bare "human", no {by}) on a non-interactive run does not park - the node stays pending and carries an auto_decided_pin record', () => {
  const run = { spec: null, nodes: [node('implement:U1:1', 'implement', [], { subgoal_id: 'U1', attempt: 1 })], interactive: false };
  const out = applyHumanPin(run, { id: 'U1', kind: 'subgoal', assignee: 'human' }, 'U1', 1);
  assert.equal(out, null, 'nothing was pinned - the caller (expandSubgoals/retrySubgoal) proceeds as if assignee had been absent');
  const n = getNode(run, 'implement:U1:1');
  assert.equal(n.state, 'pending', 'still pending - not parked, so it is offered to a driver like any other node');
  assert.equal(n.assignment, undefined);
  assert.deepEqual(n.auto_decided_pin, {
    by: 'auto', who: null, pin: 'human',
    reason: 'assignee:"human" came from the shape/spec, not tm_assign, and this run is not interactive - dispatched to an AI instead of parking (§7)',
    at: n.auto_decided_pin.at,
  });
  assert.ok(Number.isInteger(n.auto_decided_pin.at));
});

test('applyHumanPin: a MODEL pin with a {who} carries who into the auto_decided_pin record, not into assignment', () => {
  const run = { spec: null, nodes: [node('draft:U2:1', 'draft', [], { subgoal_id: 'U2', attempt: 1 })], interactive: false };
  applyHumanPin(run, { id: 'U2', kind: 'document', assignee: { who: 'sanghyeon' } }, 'U2', 1);
  const n = getNode(run, 'draft:U2:1');
  assert.equal(n.assignment, undefined);
  assert.equal(n.auto_decided_pin.who, 'sanghyeon');
  assert.deepEqual(n.auto_decided_pin.pin, { who: 'sanghyeon' });
});

test('applyHumanPin: run.interactive undefined (the ordinary default, never explicitly false) still auto-decides a MODEL pin - the gate is "not true", not "===false"', () => {
  const run = { spec: null, nodes: [node('implement:U1:1', 'implement', [], { subgoal_id: 'U1', attempt: 1 })] };
  applyHumanPin(run, { id: 'U1', kind: 'subgoal', assignee: 'human' }, 'U1', 1);
  assert.equal(getNode(run, 'implement:U1:1').assignment, undefined);
  assert.ok(getNode(run, 'implement:U1:1').auto_decided_pin);
});

test('applyHumanPin: a MODEL pin on an interactive run parks exactly as 0.27.3 always did', () => {
  const run = { spec: null, nodes: [node('implement:U1:1', 'implement', [], { subgoal_id: 'U1', attempt: 1 })], interactive: true };
  applyHumanPin(run, { id: 'U1', kind: 'subgoal', assignee: 'human' }, 'U1', 1);
  const n = getNode(run, 'implement:U1:1');
  assert.equal(n.assignment.executor, 'human');
  assert.equal(n.auto_decided_pin, undefined, 'parked, so nothing was auto-decided');
});

test('applyHumanPin: a USER pin ({by: "user"}, tm_assign\'s own marker) parks regardless of interactive - the user is present by definition', () => {
  const run = { spec: null, nodes: [node('implement:U1:1', 'implement', [], { subgoal_id: 'U1', attempt: 1 })], interactive: false };
  const n = applyHumanPin(run, { id: 'U1', kind: 'subgoal', assignee: { by: 'user', who: 'sanghyeon' } }, 'U1', 1);
  assert.equal(n.assignment.executor, 'human');
  assert.equal(n.assignment.who, 'sanghyeon');
  assert.equal(n.assignment.reason, 'pinned by tm_assign');
  assert.equal(getNode(run, 'implement:U1:1').auto_decided_pin, undefined);
});

test('expandSubgoals: on a non-interactive run, a spec subgoal\'s own assignee dispatches to an AI - readyNodes offers it, promoteWaitingHuman never parks it', () => {
  const cwd = scratchCwd();
  try {
    const run = { cwd, run_id: 'r2', spec: null, nodes: [node('critique', 'critique', [])], goal_judges: 1, interactive: false };
    getNode(run, 'critique').state = 'done';
    expandSubgoals(run, [{ id: 'U1', kind: 'subgoal', title: 't', acceptance: ['a'], assignee: 'human', deps: [] }]);
    const n = getNode(run, 'implement:U1:1');
    assert.equal(n.assignment, undefined);
    assert.ok(n.auto_decided_pin, 'the record design §7 requires - what would have parked it, and that nobody was interactive');
    promoteWaitingHuman(run);
    assert.equal(n.state, 'pending', 'promoteWaitingHuman has nothing to promote - it was never assigned to a human');
    assert.ok(readyNodes(run).some((x) => x.node_id === 'implement:U1:1'), 'offered to a driver exactly like an unpinned subgoal');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('retrySubgoal: a rejected MODEL-pinned subgoal on a non-interactive run reassigns to a fresh attempt that is ALSO auto-decided, never parked', () => {
  const cwd = scratchCwd();
  try {
    // parent_shaped + subgoal_assignee mirrors openChild's own path (a shape package's
    // assignee), with interactive left at its default (false) - the run never asked to be
    // interrupted, so neither attempt 1 nor its retry may park.
    const run = createRun({ cwd, request: 'r', flow: 'develop', vendor: 'self', parent_shaped: true, goal: 'g', acceptance: ['a'], subgoal_assignee: 'human' });
    assert.equal(getNode(run, 'implement:U1:1').assignment, undefined, 'attempt 1 was already auto-decided at createRun time');
    assert.ok(getNode(run, 'implement:U1:1').auto_decided_pin);
    for (const id of ['implement:U1:1', 'test:U1:1']) { getNode(run, id).state = 'done'; getNode(run, id).result = { stage_ok: true }; }
    const gate = getNode(run, 'gate:U1:1');
    gate.state = 'failed';
    gate.result = { stage_ok: true, accept: false, match_pct: 40, gaps: ['missing X'], reason: 'short' };
    const out = retrySubgoal(run, 'U1', 'fix it');
    const again = getNode(out.run, 'implement:U1:2');
    assert.equal(again.assignment, undefined, 'the retry is not handed to a human either - same non-interactive run, same rule');
    assert.ok(again.auto_decided_pin, 'attempt 2 gets its own record');
    assert.deepEqual(readyNodes(out.run).map((n) => n.node_id), ['implement:U1:2'], 'offered to a driver, unlike the parked case (test-graph.mjs\'s interactive:true sibling of this test)');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('createRun(parent_shaped, subgoal_assignee) on a non-interactive run does not park at open - runState is "running"/"blocked" territory, never waiting_human, until interactive says otherwise', () => {
  const cwd = scratchCwd();
  try {
    const run = createRun({ cwd, request: 'r', flow: 'develop', vendor: 'self', parent_shaped: true, goal: 'g', acceptance: ['a'], subgoal_assignee: { who: 'sanghyeon' } });
    assert.equal(run.interactive, false, 'createRun\'s own default - opts.interactive was not passed');
    const n = getNode(run, 'implement:U1:1');
    assert.equal(n.assignment, undefined);
    assert.equal(n.auto_decided_pin.who, 'sanghyeon');
    promoteWaitingHuman(run);
    assert.notEqual(runState(run).state, 'waiting_human');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('currentAttempt reads the live attempt number straight off the nodes', () => {
  const run = { nodes: [
    node('implement:U1:1', 'implement', [], { subgoal_id: 'U1', attempt: 1 }),
    node('implement:U1:2', 'implement', [], { subgoal_id: 'U1', attempt: 2 }),
  ] };
  assert.equal(currentAttempt(run, 'U1'), 2);
  assert.equal(currentAttempt(run, 'nope'), 1, 'a subgoal with no nodes yet defaults to attempt 1');
});

// --- ask: the decision a person makes, as a node (D2 step 2) ---

const askRun = () => ({
  run_id: 'ask', cwd: '/tmp', max_retries: 2, interactive: true,
  spec: { subgoals: [{ id: 'U1', kind: 'planning' }] },
  nodes: [
    node('investigate:U1:1', 'investigate', [], { subgoal_id: 'U1', attempt: 1, state: 'done', result: {} }),
    node('draft:U1:1', 'draft', ['investigate:U1:1'], { subgoal_id: 'U1', attempt: 1 }),
    node('revise:U1:1', 'revise', ['draft:U1:1'], { subgoal_id: 'U1', attempt: 1 }),
  ],
});

const twoOptions = [{
  question: 'How many tickets may one account hold?',
  owner: 'Product/policy',
  options: [{ option: '2 across presale and general combined' }, { option: '2 per sale phase' }],
}];

test('ask: the node lands between investigate and draft, and draft consumes the answer', () => {
  const run = askRun();
  assert.deepEqual(openAsk(run, run.nodes[0], twoOptions), ['ask:U1:1']);
  const ask = run.nodes.find((n) => n.node_id === 'ask:U1:1');
  assert.deepEqual(ask.deps, ['investigate:U1:1']);
  assert.equal(ask.questions.length, 1);
  // The whole point: draft no longer reads investigate directly, so it cannot start before the
  // decision exists, and the decision is what it reads.
  assert.deepEqual(run.nodes.find((n) => n.node_id === 'draft:U1:1').deps, ['ask:U1:1']);
  assert.equal(ask.assignment.executor, 'human', 'born pinned - nothing may route it to a model');
  assert.equal(ask.assignment.who, 'Product/policy', 'the owner the investigation named');
});

test('ask parks on a human and stops the run, reusing 0.27.3 machinery unchanged', () => {
  const run = askRun();
  openAsk(run, run.nodes[0], twoOptions);
  // Born waiting, not left for the next poll to promote: its one dep is the node whose own
  // submission created it, so a card that needed a team_next to become visible would be a card
  // tm_inbox could not be trusted to list.
  assert.equal(run.nodes.find((n) => n.node_id === 'ask:U1:1').state, 'waiting_human');
  assert.deepEqual(promoteWaitingHuman(run), [], 'nothing left for the promoter to do');
  assert.equal(runState(run).state, 'waiting_human');
  assert.equal(readyNodes(run).length, 0, 'draft is not offered to anyone while the card is open');
  // No new state, no new reasoning class: a node that decides and writes nothing.
  assert.equal(REASONING_STAGES.has('ask'), true);
});

test('ask is not opened for a question with nothing to choose between, or twice', () => {
  const run = askRun();
  assert.deepEqual(openAsk(run, run.nodes[0], []), [], 'no unknowns, no card');
  assert.deepEqual(openAsk(run, run.nodes[0], [{ question: 'q', options: [{ option: 'only one' }] }]), [],
    'one candidate is not a choice');
  assert.deepEqual(openAsk(run, run.nodes[0], [{ question: 'q' }]), [], 'a question with no candidates stays an open question');
  assert.deepEqual(openAsk(run, run.nodes[0], twoOptions), ['ask:U1:1']);
  assert.deepEqual(openAsk(run, run.nodes[0], twoOptions), [], 'the same attempt asks once');
  assert.equal(run.nodes.filter((n) => n.stage === 'ask').length, 1);
});

test('createRun does not ask unless the run was told to', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ask-'));
  assert.equal(createRun({ cwd: dir, request: 'x' }).interactive, false);
  assert.equal(createRun({ cwd: dir, request: 'x', interactive: true }).interactive, true);
  rmSync(dir, { recursive: true, force: true });
});

test('a card goes to one owner: five roles in one envelope is nobody\'s card', () => {
  // idol-beta-ask1 (2026-09-24), the first real interactive run: seven questions, five owners,
  // all addressed to whoever came first. Nobody can answer that.
  const run = askRun();
  const qs = [
    { question: 'tier order?', owner: 'PO', options: [{ option: 'a' }, { option: 'b' }] },
    { question: 'refund window?', owner: 'Legal', options: [{ option: 'a' }, { option: 'b' }] },
    { question: 'per-person cap?', owner: 'PO', options: [{ option: 'a' }, { option: 'b' }] },
    { question: 'SLA?', owner: 'SRE', options: [{ option: 'a' }, { option: 'b' }] },
  ];
  const ids = openAsk(run, run.nodes[0], qs);
  assert.deepEqual(ids, ['ask:U1:1', 'ask:U1:1b', 'ask:U1:1c'], 'one card per owner, first-appearance order');
  const card = (id) => run.nodes.find((n) => n.node_id === id);
  assert.equal(card('ask:U1:1').assignment.who, 'PO');
  assert.deepEqual(card('ask:U1:1').questions.map((q) => q.question), ['tier order?', 'per-person cap?']);
  assert.equal(card('ask:U1:1b').assignment.who, 'Legal');
  assert.equal(card('ask:U1:1c').assignment.who, 'SRE');
  // draft waits for all of them, or it writes a rule one owner has not decided yet.
  assert.deepEqual(run.nodes.find((n) => n.node_id === 'draft:U1:1').deps, ids);
  assert.equal(promoteWaitingHuman(run).length, 0, 'all three are already parked');
  assert.equal(run.nodes.filter((n) => n.state === 'waiting_human').length, 3);
});

test('a question with no owner still gets its own card rather than someone else\'s', () => {
  const run = askRun();
  const ids = openAsk(run, run.nodes[0], [
    { question: 'whose?', options: [{ option: 'a' }, { option: 'b' }] },
    { question: 'tier?', owner: 'PO', options: [{ option: 'a' }, { option: 'b' }] },
  ]);
  assert.equal(ids.length, 2);
  assert.equal(run.nodes.find((n) => n.node_id === ids[0]).assignment.who, null);
});

// ---------- reducer registry (item 1/2/3 of the reducer plan) ----------

test('computeWriteScope: an undeclared writer collision is caught for a code-kind (subgoal) run, not only document runs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wscope-'));
  const run = {
    run_id: 'ws1', cwd: dir, goal_judges: 1, max_retries: 2,
    nodes: [node('critique', 'critique', [], { state: 'done', result: {} })],
    spec: {
      subgoals: [
        { id: 'U1', kind: 'subgoal', title: 'owns module A', acceptance: ['touches only module A'], files: ['src/index.js'], deps: [] },
        { id: 'U2', kind: 'subgoal', title: 'owns module B', acceptance: ['touches only module B'], files: ['src/registry.js'], deps: [] },
      ],
    },
  };
  expandSubgoals(run, run.spec.subgoals);
  const impl1 = getNode(run, 'implement:U1:1');
  impl1.state = 'done'; impl1.result = { stage_ok: true, changed_files: ['src/index.js'] };
  // U2 declared only src/registry.js but also wrote src/index.js - U1's own file.
  const impl2 = getNode(run, 'implement:U2:1');
  impl2.state = 'done'; impl2.result = { stage_ok: true, changed_files: ['src/registry.js', 'src/index.js'] };
  const gate1 = getNode(run, 'gate:U1:1');
  gate1.state = 'done'; gate1.result = { stage_ok: true, accept: true };
  const gate2 = getNode(run, 'gate:U2:1');
  gate2.state = 'done'; gate2.result = { stage_ok: true, accept: true };

  const reduceNode = getNode(run, 'reduce');
  const ws = computeWriteScope(run, reduceNode);
  assert.equal(ws.undeclared_writers.length, 1);
  assert.equal(ws.undeclared_writers[0].subgoal_id, 'U2');
  assert.equal(ws.undeclared_writers[0].file, 'src/index.js');
  assert.equal(ws.collisions.length, 0, 'src/index.js has exactly one declared owner (U1), so it is undeclared-writer, not a plain collision');

  const briefing = nodeBriefing(run, reduceNode);
  assert.deepEqual(briefing.write_scope, ws, 'the fold\'s own briefing surfaces the same deterministic check');

  const goalGate = getNode(run, 'gate:goal:1');
  const goalBriefing = nodeBriefing(run, goalGate);
  assert.deepEqual(goalBriefing.write_scope, ws, 'the goal gate behind the fold sees it too, via its order-only after edges');

  const otherStageBriefing = nodeBriefing(run, gate1);
  assert.equal(otherStageBriefing.write_scope, null, 'a subgoal\'s own gate is not where this check applies');

  rmSync(dir, { recursive: true, force: true });
});

test('computeWriteScope: two document subgoals sharing a file with distinct declared headings pass clean', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wscope-doc-'));
  const run = {
    run_id: 'ws2', cwd: dir, goal_judges: 1, max_retries: 2,
    nodes: [node('critique', 'critique', [], { state: 'done', result: {} })],
    spec: {
      subgoals: [
        { id: 'D1', kind: 'document', title: 'owns "## Rollout"', acceptance: ['writes only ## Rollout, touches no other section'], files: ['docs/prd.md'], deps: [] },
        { id: 'D2', kind: 'document', title: 'owns "## Risks"', acceptance: ['writes only ## Risks, touches no other section'], files: ['docs/prd.md'], deps: [] },
      ],
    },
  };
  expandSubgoals(run, run.spec.subgoals);
  for (const sg of ['D1', 'D2']) {
    const draft = getNode(run, `draft:${sg}:1`);
    draft.state = 'done'; draft.result = { stage_ok: true, changed_files: ['docs/prd.md'] };
    const review = getNode(run, `review:${sg}:1`);
    review.state = 'done'; review.result = { stage_ok: true, verified: true };
    const gate = getNode(run, `gate:${sg}:1`);
    gate.state = 'done'; gate.result = { stage_ok: true, accept: true };
  }
  const ws = computeWriteScope(run, getNode(run, 'reduce'));
  assert.deepEqual(ws, { collisions: [], undeclared_writers: [], heading_collisions: [] });
  rmSync(dir, { recursive: true, force: true });
});

test('goalConsensus: AND-consensus / min / concat-dedup come from the declared registry - order of the judges does not change the result', () => {
  const build = (order) => {
    const run = { run_id: `gc-${order.join('')}`, cwd: '/tmp', nodes: [] };
    const { round, ids } = pushGoalGateRound(run, [], {}, 2);
    const [a, b] = ids.map((id) => getNode(run, id));
    const results = {
      a: { stage_ok: true, accept: true, match_pct: 95, gaps: ['g1'], spec_drift: [] },
      b: { stage_ok: true, accept: true, match_pct: 88, gaps: ['g2', 'g1'], spec_drift: ['d1'] },
    };
    for (const key of order) {
      const target = key === 'a' ? a : b;
      target.state = 'done';
      target.result = results[key];
    }
    return goalConsensus(run, round);
  };
  const forward = build(['a', 'b']);
  const reverse = build(['b', 'a']);
  assert.deepEqual(forward, reverse, 'the order results were assigned in must not change the consensus');
  assert.equal(forward.accept, true);
  assert.equal(forward.match_pct, 88);
  assert.deepEqual(forward.gaps, ['g1', 'g2']);
  assert.deepEqual(forward.spec_drift, ['d1']);
});

test('goalConsensus: one dissenting judge still rejects the round (and-consensus, unchanged from before the registry refactor)', () => {
  const run = { run_id: 'gc-dissent', cwd: '/tmp', nodes: [] };
  const { round, ids } = pushGoalGateRound(run, [], {}, 2);
  const [a, b] = ids.map((id) => getNode(run, id));
  a.state = 'done'; a.result = { stage_ok: true, accept: true, match_pct: 95, gaps: [], spec_drift: [] };
  b.state = 'failed'; b.result = { stage_ok: true, accept: false, match_pct: 60, gaps: ['half-built'], spec_drift: [] };
  const c = goalConsensus(run, round);
  assert.equal(c.accept, false);
  assert.equal(c.match_pct, 60);
});

// --- D2 slice 3 (0.29.0): questions[] generalized past investigate's own unknowns[] ---

// A run/task-level judging node (setgoal, plan, critique, gate:goal - subgoal_id is null for
// all of them) has no subgoal to key an ask card off, unlike investigate's own U1/U2/... A run
// with a top-level critique feeding two subgoal chains (mirrors createRun's own non-parent-
// shaped shape) is what exercises that fallback and the `after`-edge consumer rewiring
// gate:goal's own report depends through.
const critiqueRun = () => ({
  run_id: 'critique-ask', cwd: '/tmp', max_retries: 2, interactive: true,
  spec: { subgoals: [{ id: 'U1', kind: 'code' }] },
  nodes: [
    node('critique', 'critique', ['setgoal'], { state: 'done', result: {} }),
    node('implement:U1:1', 'implement', ['critique'], { subgoal_id: 'U1', attempt: 1 }),
    node('gate:goal:1', 'gate', [], { subgoal_id: null, attempt: 1, after: ['critique'] }),
    node('report', 'report', [], { after: ['gate:goal:1'] }),
  ],
});

const defaultOnlyQuestion = [{
  question: 'Which flow does this package use?',
  to: 'Product',
  default: 'develop',
  why: 'no source in the request named one',
}];

test('openAsk keys a run-level node off its own node_id, and a `default` alone is decidable', () => {
  const run = critiqueRun();
  const ids = openAsk(run, run.nodes[0], defaultOnlyQuestion);
  assert.deepEqual(ids, ['ask:critique:1'], 'no subgoal_id to key off, so the node_id is the owner');
  const ask = getNode(run, 'ask:critique:1');
  assert.equal(ask.questions[0].default, 'develop');
  assert.equal(ask.assignment.who, 'Product', '`to` is read the same way investigate\'s own `owner` is');
  // implement:U1:1 named critique in `deps` - rewired there.
  assert.deepEqual(getNode(run, 'implement:U1:1').deps, ['ask:critique:1']);
});

test('openAsk rewires an `after` consumer too, not just `deps` - gate:goal -> report is order-only', () => {
  const run = critiqueRun();
  openAsk(run, run.nodes[0], defaultOnlyQuestion);
  // gate:goal named critique in `after`, so it is rewired there, not into `deps` - a card
  // parked between critique and the goal gate must not turn an order-only edge into a data one.
  assert.deepEqual(getNode(run, 'gate:goal:1').after, ['ask:critique:1']);
  assert.deepEqual(getNode(run, 'gate:goal:1').deps, []);
});

test('a bare question with neither options nor a default is still left as an open question, not a card', () => {
  const run = critiqueRun();
  assert.deepEqual(openAsk(run, run.nodes[0], [{ question: 'q', to: 'PO' }]), []);
});

test('the answer reaches the consumer\'s own briefing - nodeBriefing reads decisions off any upstream node in scope', () => {
  const run = critiqueRun();
  openAsk(run, run.nodes[0], defaultOnlyQuestion);
  const ask = getNode(run, 'ask:critique:1');
  ask.state = 'done';
  ask.result = { stage_ok: true, decisions: [{ question: defaultOnlyQuestion[0].question, chose: 'develop', because: 'decided by a person' }] };
  const briefing = nodeBriefing(run, getNode(run, 'implement:U1:1'));
  const upstream = briefing.upstream.find((u) => u.node_id === 'ask:critique:1');
  assert.ok(upstream, JSON.stringify(briefing.upstream));
  assert.deepEqual(upstream.decisions, ask.result.decisions);
});

// --- gate:human (D2 Task 4) ---

function gateHumanRun({ interactive = true, human_gates = ['critique', 'gate'] } = {}) {
  return {
    run_id: 'gate-human', cwd: '/tmp', max_retries: 2, interactive, human_gates,
    spec: { subgoals: [{ id: 'U1', kind: 'code' }] },
    nodes: [
      node('critique', 'critique', [], {}),
      node('gate:U1:1', 'gate', ['test:U1:1'], { subgoal_id: 'U1', attempt: 1 }),
    ],
  };
}

test('humanGateIdentity/humanGateVerdictField: gate:goal is told apart from a subgoal gate by node_id, not stage', () => {
  const goal = node('gate:goal:1', 'gate', [], { subgoal_id: null });
  const sub = node('gate:U1:1', 'gate', [], { subgoal_id: 'U1' });
  assert.equal(humanGateIdentity(goal), 'gate:goal');
  assert.equal(humanGateIdentity(sub), 'gate');
  assert.equal(humanGateVerdictField(goal), 'accept');
  assert.equal(humanGateVerdictField(sub), 'accept');
  assert.equal(humanGateVerdictField(node('shape', 'shape', [])), null, 'an authoring stage has no verdict field - never gated');
});

test('promoteHumanGates parks a named judging stage in waiting_human when interactive, and only once', () => {
  const run = gateHumanRun();
  const { parked, autoPass } = promoteHumanGates(run);
  assert.deepEqual(parked.map((n) => n.node_id), ['critique']);
  assert.deepEqual(autoPass, []);
  assert.equal(getNode(run, 'critique').state, 'waiting_human');
  assert.equal(getNode(run, 'critique').human_gate, true);
  assert.equal(getNode(run, 'critique').assignment.executor, 'human');
  // gate:U1:1 is not ready yet (its dep test:U1:1 does not exist) - promoteHumanGates never
  // parks a node before it is actually runnable, same as promoteWaitingHuman.
  assert.equal(getNode(run, 'gate:U1:1').state, 'pending');
  // A second poll must not re-decide an already-parked node.
  assert.deepEqual(promoteHumanGates(run).parked, []);
});

test('promoteHumanGates ignores a stage not named in human_gates', () => {
  const run = gateHumanRun({ human_gates: ['gate'] });
  const { parked } = promoteHumanGates(run);
  assert.deepEqual(parked, [], 'gate:U1:1 is not ready (deps unmet), critique is ready but not named');
});

test('promoteHumanGates auto-passes when not interactive, and records decided-for-you', () => {
  const run = gateHumanRun({ interactive: false });
  const { parked, autoPass } = promoteHumanGates(run);
  assert.deepEqual(parked, []);
  assert.deepEqual(autoPass.map((n) => n.node_id), ['critique']);
  const n = getNode(run, 'critique');
  assert.equal(n.state, 'pending', 'promoteHumanGates only marks it - the caller finalizes with autoPassHumanGateResult');
  assert.ok(n.auto_decided_pin, 'tm_inbox\'s decided list reads this');
  assert.match(n.auto_decided_pin.reason, /not interactive/);
});

test('autoPassHumanGateResult passes with evidence a "no evidence" guard accepts, per verdict field', () => {
  const critiqueResult = autoPassHumanGateResult(node('critique', 'critique', []));
  assert.equal(critiqueResult.stage_ok, true);
  assert.equal(critiqueResult.sound, true);
  assert.ok(critiqueResult.checks.length > 0);
  const goalResult = autoPassHumanGateResult(node('gate:goal:1', 'gate', [], { subgoal_id: null }));
  assert.equal(goalResult.accept, true);
  assert.equal(goalResult.match_pct, 100);
  assert.ok(Array.isArray(goalResult.attacks) && goalResult.attacks.length > 0, 'gate:goal needs attacks[] or nodeSucceeded refuses it (broker.mjs)');
});

test('humanGateResultFromPayload turns an accept/reject into the stage\'s own verdict shape, gaps included', () => {
  const gateNode = node('gate:U1:1', 'gate', [], { subgoal_id: 'U1' });
  const accepted = humanGateResultFromPayload(gateNode, { accept: true, reason: 'looks right' });
  assert.equal(accepted.accept, true);
  assert.equal(accepted.stage_ok, true);
  assert.deepEqual(accepted.gaps, []);
  const rejected = humanGateResultFromPayload(gateNode, { accept: false, reason: 'missing the b half', gaps: ['b.txt untouched'] });
  assert.equal(rejected.accept, false);
  assert.deepEqual(rejected.gaps, ['b.txt untouched'], 'rejection feeds gaps into the retry exactly like a model gate\'s own gaps[]');
  assert.match(rejected.reason, /missing the b half/);
});

test('a retry never asks a settled question again, and the next attempt is told what is settled', () => {
  // idol-beta-ask1 (2026-09-25): U4's draft failed twice; its third investigate raised six
  // questions, two of them byte-identical to ones answered on ask:U4:1 - a node the retry had
  // superseded, so nothing downstream knew. Asking a person to decide the same thing twice is
  // the failure; the other four were rewordings, which is why the briefing carries the decisions
  // too rather than relying on this filter alone.
  const run = askRun();
  run.nodes.push(node('ask:U1:1', 'ask', ['investigate:U1:1'], {
    subgoal_id: 'U1', ask_owner: 'U1', attempt: 1, state: 'done',
    result: { stage_ok: true, decisions: [{ question: 'how many tickets?', chose: 'two', because: 'legal' }] },
  }));
  // Attempt 2: the same investigation, raising one settled question and one genuinely new.
  const inv2 = node('investigate:U1:2', 'investigate', [], { subgoal_id: 'U1', attempt: 2, state: 'done', result: {} });
  const draft2 = node('draft:U1:2', 'draft', ['investigate:U1:2'], { subgoal_id: 'U1', attempt: 2 });
  run.nodes.push(inv2, draft2);
  const ids = openAsk(run, inv2, [
    { question: 'how many tickets?', options: [{ option: 'two' }, { option: 'four' }] },
    { question: 'what is the refund window?', options: [{ option: '72h' }, { option: '7d' }] },
  ]);
  assert.deepEqual(ids, ['ask:U1:2']);
  const card = run.nodes.find((x) => x.node_id === 'ask:U1:2');
  assert.deepEqual(card.questions.map((q) => q.question), ['what is the refund window?'],
    'the settled one is gone; only the new decision is put to anyone');

  // And every stage on the new attempt is told what was settled, which is what a reworded
  // repeat needs - no string filter can catch that one.
  const b = nodeBriefing(run, draft2);
  assert.deepEqual(b.prior_decisions.map((d) => d.chose), ['two']);
  assert.match(composePrompt(run, draft2, b), /Already decided by a person/);
  assert.match(composePrompt(run, draft2, b), /how many tickets\? -> two \(legal\)/);
});

test('a card does not print the questions it is itself asking as already decided', () => {
  const run = askRun();
  const ids = openAsk(run, run.nodes[0], twoOptions);
  const card = run.nodes.find((x) => x.node_id === ids[0]);
  card.result = { stage_ok: true, decisions: [{ question: twoOptions[0].question, chose: 'x' }] };
  const b = nodeBriefing(run, card);
  assert.deepEqual(b.prior_decisions, [], 'its own answer is not a prior decision to itself');
});

test('a decision is the run\'s: a sibling subgoal is told it and never asks it again', () => {
  // idol-beta-ask1: the fan-club tier question was decided under U1 (multi-tier), then asked
  // again under U2 and U3 (single tier) - each investigate saw only its own owner's answers.
  const run = askRun();
  run.nodes.push(node('ask:U1:1', 'ask', ['investigate:U1:1'], {
    subgoal_id: 'U1', ask_owner: 'U1', attempt: 1, state: 'done',
    result: { stage_ok: true, decisions: [{ question: 'fan-club tiers?', chose: 'multi-tier' }] },
  }));
  const invU2 = node('investigate:U2:1', 'investigate', [], { subgoal_id: 'U2', attempt: 1, state: 'done', result: {} });
  const draftU2 = node('draft:U2:1', 'draft', ['investigate:U2:1'], { subgoal_id: 'U2', attempt: 1 });
  run.nodes.push(invU2, draftU2);
  const ids = openAsk(run, invU2, [
    { question: 'fan-club tiers?', options: [{ option: 'single' }, { option: 'multi-tier' }] },
    { question: 'hold time?', options: [{ option: '5m' }, { option: '10m' }] },
  ]);
  assert.deepEqual(run.nodes.find((x) => x.node_id === ids[0]).questions.map((q) => q.question), ['hold time?']);
  const b = nodeBriefing(run, draftU2);
  assert.deepEqual(b.prior_decisions.map((d) => [d.chose, d.decided_for]), [['multi-tier', 'U1']]);
  assert.match(composePrompt(run, draftU2, b), /fan-club tiers\? -> multi-tier \[decided under U1\]/);
});
