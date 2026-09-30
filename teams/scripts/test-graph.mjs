// teams/scripts/test-graph.mjs - unit tests for graph.mjs's kind/flow tables: the shape
// the engine reads to expand a chain, key it to a verdict field, and pick default personas.
// Full round-trip behaviour (a real run expanding and judging a planning/qa subgoal) lives in
// test-broker.mjs alongside the document-kind suite this mirrors. The package-run tests below
// exercise createRun/runState/retrySubgoal/retrySpec for a package's child run directly against
// real run files - taskmanager.mjs's own coverage (openChild opening it, foldChild reading it
// back) lives in test-taskmanager.mjs instead.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { composePrompt } from '../mcp/prompts.mjs';
import {
  KINDS, VERDICT_FIELD, REASONING_STAGES, FLOWS, kindSkills, kindOf, authorStage,
  createRun, runState, retrySubgoal, retrySpec, getNode, readyNodes,
  validateSpec,
  expandSubgoals, node,
  applyHumanPin, releaseHumanPin, currentAttempt, promoteWaitingHuman, openAsk,
  computeWriteScope, nodeBriefing, goalConsensus, pushGoalGateRound,
  promoteHumanGates, autoPassHumanGateResult, humanGateResultFromPayload,
  humanGateIdentity, humanGateVerdictField,
  normalizeSpec, defaultKind, DOCUMENT_ONLY_KINDS,
  routeExecutionQuestions, planDecisions, settledDecisions,
} from '../mcp/graph.mjs';

test('planning kind: chain, no reasoning stage, and skills by stage', () => {
  assert.deepEqual(KINDS.planning.chain, ['investigate', 'draft', 'revise', 'gate']);
  assert.deepEqual(KINDS.planning.reasoning, []);
  assert.deepEqual(kindSkills('planning', 'investigate'), ['develop:domain-driven-design', 'cognition:assumption-extractor']);
  assert.deepEqual(kindSkills('planning', 'draft'), ['write:plans', 'develop:architecture-designer'], 'the implementation-lead persona draws what the PRD builds');
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

// ---------- light PLAN mode (_repo/docs/plans/2026-09-28-teams-light-plan.md §2.2-2.3) ----------

test('planning-light kind: investigate -> template-fill -> gate, template-fill authors, document-only like planning', () => {
  assert.deepEqual(KINDS['planning-light'].chain, ['investigate', 'template-fill', 'gate']);
  assert.deepEqual(KINDS['planning-light'].reasoning, []);
  assert.equal(authorStage('planning-light'), 'template-fill');
  assert.deepEqual(kindSkills('planning-light', 'investigate'), kindSkills('planning', 'investigate'), 'investigate is the same stage in both chains');
  assert.deepEqual(kindSkills('planning-light', 'gate'), ['think:devils-advocate']);
  assert.ok(!REASONING_STAGES.has('template-fill'), 'template-fill writes the document - a mutating stage');
  assert.ok(DOCUMENT_ONLY_KINDS.has('planning-light'));
  const problems = validateSpec({ goal: 'g', acceptance: ['a'], subgoals: [{ id: 'U1', kind: 'planning-light', title: 't', acceptance: ['a'], files: ['src/index.mjs'] }] });
  assert.ok(problems.some((p) => /not a document path/.test(p)), problems.join('; '));
  // The full chain is untouched.
  assert.deepEqual(KINDS.planning.chain, ['investigate', 'draft', 'revise', 'gate']);
});

test('a light PLAN run (planning_mode "light") defaults and rewrites planning subgoals to planning-light; setgoal\'s explicit "planning" passes mixed=false and expands the light chain', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'graph-light-'));
  try {
    const light = createRun({ cwd, request: 'r', flow: 'plan', mixed: false, vendor: 'self', planning_mode: 'light' });
    assert.equal(light.planning_mode, 'light');
    assert.equal(defaultKind(light), 'planning-light');
    const spec = normalizeSpec(light, { goal: 'g', acceptance: ['a'], subgoals: [
      { id: 'U1', kind: 'planning', title: 'PRD', acceptance: ['a'], files: ['docs/prd.md'] },
    ] });
    assert.equal(spec.subgoals[0].kind, 'planning-light');
    assert.deepEqual(validateSpec(spec, { kind: defaultKind(light), mixed: false, flow: 'plan' }), []);
    light.spec = spec;
    expandSubgoals(light, spec.subgoals);
    const chain = light.nodes.filter((n) => n.subgoal_id === 'U1').map((n) => n.stage);
    assert.deepEqual(chain, ['investigate', 'template-fill', 'gate']);

    const full = createRun({ cwd, request: 'r', flow: 'plan', mixed: false, vendor: 'self' });
    assert.equal(full.planning_mode, undefined, 'a run nobody asked for light carries no field at all');
    assert.equal(defaultKind(full), 'planning');
    assert.equal(normalizeSpec(full, { goal: 'g', acceptance: ['a'], subgoals: [{ id: 'U1', kind: 'planning', title: 't', acceptance: ['a'] }] }).subgoals[0].kind, 'planning');
    const dev = createRun({ cwd, request: 'r', flow: 'develop', vendor: 'self', planning_mode: 'light' });
    assert.equal(defaultKind(dev), 'subgoal', 'planning_mode only touches the planning kind');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('planning-light gate: briefed with investigate\'s unknowns and handed the per-item coverage + unknowns-not-lost contract; the full chain\'s gate is not', () => {
  const run = {
    run_id: 'r', cwd: '/tmp', request: 'req', interactive: false, flow: 'plan', mixed: false, planning_mode: 'light',
    spec: { goal: 'g', acceptance: ['a'], subgoals: [{ id: 'U1', kind: 'planning-light', title: 'PRD', acceptance: ['a'], files: ['docs/prd.md'] }] },
    nodes: [
      node('investigate:U1:1', 'investigate', [], { subgoal_id: 'U1', attempt: 1, state: 'done', result: { stage_ok: true, unknowns: [{ question: 'Which skills run multi-turn sessions?', owner: 'PO' }, { unknown: 'Is R6 per skill or per plugin?' }] } }),
      node('template-fill:U1:1', 'template-fill', ['investigate:U1:1'], { subgoal_id: 'U1', attempt: 1, state: 'done', result: { stage_ok: true, handoff: 'docs/prd.md' } }),
      node('gate:U1:1', 'gate', ['template-fill:U1:1'], { subgoal_id: 'U1', attempt: 1 }),
    ],
  };
  const fill = getNode(run, 'template-fill:U1:1');
  const fb = nodeBriefing(run, fill);
  assert.deepEqual(fb.investigate_unknowns, [{ question: 'Which skills run multi-turn sessions?', owner: 'PO' }, { question: 'Is R6 per skill or per plugin?', owner: null }]);
  assert.equal(fb.decide_by_default, true, 'template-fill is an authoring stage: non-interactive decides by default like draft');
  const fp = composePrompt(run, fill, fb);
  assert.match(fp, /## Investigate unknowns/);
  assert.match(fp, /This backlog already declared its acceptance criteria/);

  const gate = getNode(run, 'gate:U1:1');
  const gp = composePrompt(run, gate, nodeBriefing(run, gate));
  assert.match(gp, /Is R6 per skill or per plugin\?/);
  assert.match(gp, /Per-item rule coverage/);
  assert.match(gp, /never with one search over the whole file/);
  assert.match(gp, /No unknown lost/);

  // The same gate under the full planning kind reads exactly the ordinary gate contract.
  const fullRun = { ...run, planning_mode: undefined, spec: { ...run.spec, subgoals: [{ ...run.spec.subgoals[0], kind: 'planning' }] } };
  const fullGate = getNode(fullRun, 'gate:U1:1');
  const fb2 = nodeBriefing(fullRun, fullGate);
  assert.equal(fb2.investigate_unknowns, null);
  const fullPrompt = composePrompt(fullRun, fullGate, fb2);
  assert.doesNotMatch(fullPrompt, /Per-item rule coverage/);
  assert.doesNotMatch(fullPrompt, /## Investigate unknowns/);
});

// ---------- a package's child run runs the full harness (§3 chain-only reverted 2026-09-28) ----------
//
// The task manager opens every package's child run with createRun({package, goal, acceptance,
// subgoal_assignee}) - the ordinary plan/setgoal/critique start, like any run. What the manager
// already decided travels as data: run.package (the build-plan briefing, and the acceptance that
// normalizeSpec carries into the spec verbatim) and run.subgoal_assignee (the STORY pin that
// expandSubgoals applies to every subgoal). These tests exercise that directly against real run
// files - no broker or taskmanager process needed.

function scratchCwd() {
  return mkdtempSync(join(tmpdir(), 'graph-package-run-'));
}

// A package run past its own plan/setgoal/critique: the spec setgoal returned (normalized the way
// broker.mjs's finishNode does), expanded into its chains.
function packageRun(cwd, opts = {}, spec = { goal: 'g', acceptance: ['own'], subgoals: [{ id: 'U1', title: 't', acceptance: ['a'], deps: [] }] }) {
  const run = createRun({ cwd, request: 'r', flow: 'develop', vendor: 'self', package: { id: 'P1' }, goal: 'g', acceptance: ['pkg acceptance'], ...opts });
  for (const id of ['plan', 'setgoal', 'critique']) { getNode(run, id).state = 'done'; getNode(run, id).result = { stage_ok: true }; }
  run.spec = normalizeSpec(run, spec);
  expandSubgoals(run, run.spec.subgoals);
  return run;
}

test('createRun({package}) opens the full harness: plan/setgoal/critique first, the package recorded as data', () => {
  const cwd = scratchCwd();
  try {
    const run = createRun({
      cwd, request: 'do the one thing', flow: 'develop', vendor: 'self',
      package: { id: 'P1' }, goal: 'ship the one thing', acceptance: ['the one thing works'],
    });
    assert.deepEqual(run.nodes.map((n) => n.node_id), ['plan', 'setgoal', 'critique']);
    assert.deepEqual(run.package, { id: 'P1', origin: 'shape', title: 'ship the one thing', acceptance: ['the one thing works'] });
    assert.equal(run.spec, null, 'setgoal writes the spec - nothing is pre-decided into it');
    assert.equal(run.parent_shaped, undefined);
    assert.deepEqual(readyNodes(run).map((n) => n.node_id), ['plan']);
    assert.equal(run.depth, undefined, 'no depth field: there is no nested task');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('the retired parent_shaped option is ignored: a caller still passing it gets the full harness', () => {
  const cwd = scratchCwd();
  try {
    const run = createRun({ cwd, request: 'r', flow: 'develop', vendor: 'self', parent_shaped: true, goal: 'g', acceptance: ['a'] });
    assert.deepEqual(run.nodes.map((n) => n.node_id), ['plan', 'setgoal', 'critique']);
    assert.equal(run.parent_shaped, undefined);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('normalizeSpec carries a package\'s acceptance into the spec verbatim - missing items first, present ones not duplicated; a run with no package is untouched', () => {
  const pkgRun = { package: { acceptance: ['a.txt says a', 'b is built'] } };
  const spec = { goal: 'g', acceptance: ['b is built', 'own criterion'], subgoals: [{ id: 'U1' }] };
  assert.deepEqual(normalizeSpec(pkgRun, spec).acceptance, ['a.txt says a', 'b is built', 'own criterion']);
  assert.deepEqual(normalizeSpec(pkgRun, { goal: 'g', subgoals: [{ id: 'U1' }] }).acceptance, ['a.txt says a', 'b is built']);
  assert.deepEqual(normalizeSpec({}, spec).acceptance, ['b is built', 'own criterion']);
});

test('createRun without package is unaffected: the ordinary plan/setgoal/critique start, no package recorded', () => {
  const cwd = scratchCwd();
  try {
    const run = createRun({ cwd, request: 'do a bigger thing', vendor: 'self' });
    assert.deepEqual(run.nodes.map((n) => n.node_id), ['plan', 'setgoal', 'critique']);
    assert.equal(run.package, undefined);
    assert.equal(run.subgoal_assignee, undefined);
    assert.equal(run.depth, undefined);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('createRun({package, depth: 2}) ignores the retired depth option - there is no nested task to count', () => {
  const cwd = scratchCwd();
  try {
    const run = createRun({ cwd, request: 'r', vendor: 'self', package: { id: 'P1' }, depth: 2 });
    assert.equal(run.depth, undefined);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('runState on a package run: a done subgoal gate is not the end - complete only once gate:goal and report are done', () => {
  const cwd = scratchCwd();
  try {
    const run = packageRun(cwd);
    assert.deepEqual(run.nodes.map((n) => n.node_id), ['plan', 'setgoal', 'critique', 'implement:U1:1', 'test:U1:1', 'gate:U1:1', 'gate:goal:1', 'report']);
    assert.deepEqual(getNode(run, 'implement:U1:1').deps, ['critique']);
    assert.equal(runState(run).state, 'running');
    for (const id of ['implement:U1:1', 'test:U1:1']) { getNode(run, id).state = 'done'; getNode(run, id).result = { stage_ok: true }; }
    const gate = getNode(run, 'gate:U1:1');
    gate.state = 'done';
    gate.result = { stage_ok: true, accept: true, match_pct: 95, checks: ['ok -> fine'] };
    assert.equal(runState(run).state, 'running', 'the package\'s own gate:goal and report are still ahead');
    getNode(run, 'gate:goal:1').state = 'done';
    getNode(run, 'gate:goal:1').result = { stage_ok: true, accept: true, match_pct: 95 };
    assert.equal(runState(run).state, 'running');
    getNode(run, 'report').state = 'done';
    getNode(run, 'report').result = { stage_ok: true, handoff: 'built' };
    assert.equal(runState(run).state, 'complete');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('runState on a package run: a rejected gate with no retry called leaves the run blocked, not complete', () => {
  const cwd = scratchCwd();
  try {
    const run = packageRun(cwd);
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


test('retrySubgoal on a package run opens a fresh chain attempt, and the goal gate waits on it', () => {
  const cwd = scratchCwd();
  try {
    const run = packageRun(cwd);
    for (const id of ['implement:U1:1', 'test:U1:1']) { getNode(run, id).state = 'done'; getNode(run, id).result = { stage_ok: true }; }
    const gate = getNode(run, 'gate:U1:1');
    gate.state = 'failed';
    gate.result = { stage_ok: true, accept: false, match_pct: 40, gaps: ['missing X'], reason: 'short' };
    const out = retrySubgoal(run, 'U1', 'fix it');
    assert.equal(out.attempt, 2);
    assert.deepEqual(readyNodes(out.run).map((n) => n.node_id), ['implement:U1:2']);
    assert.ok(getNode(out.run, 'gate:goal:1').deps.includes('gate:U1:2'), 'the package\'s goal gate judges the live attempt');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('retrySpec on a package run redoes the package\'s own setgoal and critique - the package plans itself again', () => {
  const cwd = scratchCwd();
  try {
    const run = packageRun(cwd);
    for (const id of ['implement:U1:1', 'test:U1:1']) { getNode(run, id).state = 'done'; getNode(run, id).result = { stage_ok: true }; }
    const gate = getNode(run, 'gate:U1:1');
    gate.state = 'failed';
    gate.result = { stage_ok: true, accept: false, match_pct: 40, gaps: ['missing X'], reason: 'twice the same reason' };
    const out = retrySpec(run, 'the spec has to change');
    assert.equal(out.attempt, 2);
    assert.deepEqual(readyNodes(out.run).map((n) => n.node_id), ['setgoal:2']);
    assert.ok(getNode(out.run, 'critique:2'));
    assert.equal(out.run.spec, null);
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

test('runState on a package run reports waiting_human the same way', () => {
  const cwd = scratchCwd();
  try {
    // subgoal_assignee is the shape's own field (openChild's pkg.assignee) - a MODEL pin, so
    // interactive:true is what makes it park here rather than being auto-decided.
    const run = packageRun(cwd, { subgoal_assignee: 'human', interactive: true });
    assert.equal(getNode(run, 'implement:U1:1').assignment.executor, 'human', 'subgoal_assignee reaches the subgoal setgoal produced, through expandSubgoals');
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
    const run = packageRun(cwd, { subgoal_assignee: 'human', interactive: true });
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
    // package + subgoal_assignee mirrors openChild's own path (a shape package's assignee),
    // with interactive left at its default (false) - the run never asked to be interrupted, so
    // neither attempt 1 nor its retry may park.
    const run = packageRun(cwd, { subgoal_assignee: 'human' });
    assert.equal(getNode(run, 'implement:U1:1').assignment, undefined, 'attempt 1 was already auto-decided when setgoal\'s subgoal was expanded');
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

test('a package run with subgoal_assignee on a non-interactive run does not park - runState is "running"/"blocked" territory, never waiting_human, until interactive says otherwise', () => {
  const cwd = scratchCwd();
  try {
    const run = packageRun(cwd, { subgoal_assignee: { who: 'sanghyeon' } });
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

test('a STORY pin (subgoal_assignee) reaches every subgoal setgoal produces; a subgoal setgoal pinned itself keeps its own', () => {
  const cwd = scratchCwd();
  try {
    const spec = { goal: 'g', acceptance: ['a'], subgoals: [
      { id: 'U1', title: 'a', acceptance: ['a'], deps: [] },
      { id: 'U2', title: 'b', acceptance: ['b'], deps: [], assignee: { by: 'user', who: 'other' } },
    ] };
    const run = packageRun(cwd, { subgoal_assignee: { by: 'user', who: 'sanghyeon' } }, spec);
    assert.equal(getNode(run, 'implement:U1:1').assignment.who, 'sanghyeon');
    assert.equal(getNode(run, 'implement:U2:1').assignment.who, 'other');
    assert.deepEqual(run.spec.subgoals[0].assignee, { by: 'user', who: 'sanghyeon' }, 'on the spec, so retrySubgoal re-applies it');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('applyStoryPin sets and releases the run-level STORY pin (tm_assign on a STORY whose setgoal has not run yet)', async () => {
  const { applyStoryPin } = await import('../mcp/graph.mjs');
  const run = {};
  assert.equal(applyStoryPin(run, { kind: 'story_pin', to: 'human', who: 'sanghyeon' }), true);
  assert.deepEqual(run.subgoal_assignee, { by: 'user', who: 'sanghyeon' });
  assert.equal(applyStoryPin(run, { kind: 'story_pin', to: 'auto' }), true);
  assert.equal(run.subgoal_assignee, undefined);
  assert.equal(applyStoryPin(run, { kind: 'story_pin', to: 'auto' }), false, 'nothing to release');
});

test('G3: releasing a STORY pin restores the model-written assignee it replaced', async () => {
  const { applyStoryPin } = await import('../mcp/graph.mjs');
  const run = { nodes: [], subgoal_assignee: 'codex', spec: { subgoals: [{ id: 'U1', assignee: 'codex' }, { id: 'U2' }] } };
  assert.equal(applyStoryPin(run, { kind: 'story_pin', to: 'human', who: 'sanghyeon' }), true);
  assert.deepEqual(run.spec.subgoals[0].assignee, { by: 'user', who: 'sanghyeon' });
  assert.equal(applyStoryPin(run, { kind: 'story_pin', to: 'auto' }), true);
  assert.equal(run.spec.subgoals[0].assignee, 'codex', 'the model-written assignee is back');
  assert.equal(run.spec.subgoals[1].assignee, undefined, 'a subgoal with none stays with none');
  assert.equal(run.subgoal_assignee, 'codex', 'the run-level model assignee is back');
  assert.equal(run.spec.subgoals[0].model_assignee, undefined);
  assert.equal(run.model_subgoal_assignee, undefined);
  // A subgoal setgoal created while the pin was held takes the run's model assignee on release.
  applyStoryPin(run, { kind: 'story_pin', to: 'human' });
  run.spec.subgoals.push({ id: 'U3', assignee: { ...run.subgoal_assignee } });
  applyStoryPin(run, { kind: 'story_pin', to: 'auto' });
  assert.equal(run.spec.subgoals[2].assignee, 'codex');
});

test('a package run\'s plan/setgoal/critique briefings say: build this package, carry its acceptance, judge against it', () => {
  const cwd = scratchCwd();
  try {
    const run = createRun({ cwd, request: 'change a.txt', flow: 'develop', vendor: 'self', package: { id: 'P1' }, goal: 'module a', acceptance: ['a.txt says a'] });
    const prompt = (id) => composePrompt(run, getNode(run, id), nodeBriefing(run, getNode(run, id)));
    const plan = prompt('plan');
    assert.match(plan, /## This package \(P1\) — module a/);
    assert.match(plan, /already split the EPIC into packages \(shape\) and critiqued that split/);
    assert.match(plan, /Do not re-split the EPIC/);
    assert.match(plan, /files and modules to touch, the interfaces and data shapes .*order of work, the test plan .*risks/);
    assert.match(plan, /Package acceptance[^\n]*\n- a\.txt says a/);
    assert.match(prompt('setgoal'), /Keep one subgoal unless the package genuinely needs more/);
    assert.match(prompt('setgoal'), /verbatim/);
    getNode(run, 'plan').state = 'done';
    getNode(run, 'plan').result = { stage_ok: true, plan: 'edit a.txt; run cat a.txt' };
    const critique = prompt('critique');
    assert.match(critique, /Judge the plan and the spec against this package's brief/);
    assert.match(critique, /The build plan this spec came from:\nedit a\.txt; run cat a\.txt/);
    // A run that is not a package gets none of it.
    const plain = createRun({ cwd, request: 'r', vendor: 'self' });
    assert.doesNotMatch(composePrompt(plain, getNode(plain, 'plan'), nodeBriefing(plain, getNode(plain, 'plan'))), /## This package/);
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

test('code-sprint-S2: a non-interactive run hands its unasked questions to the author as decided by default', () => {
  const run = askRun();
  run.interactive = false;
  run.unasked = [
    { subgoal_id: 'U1', question: 'exit code on malformed rules?', owner: 'CLI lead', options: [{ option: '1' }, { option: '2' }] },
    { subgoal_id: 'U2', question: 'top-3 ties?', owner: null, options: [{ option: 'alphabetical' }, { option: 'first seen' }] },
  ];
  const draft = node('draft:U2:1', 'draft', [], { subgoal_id: 'U2', attempt: 1 });
  const inv = node('investigate:U2:1', 'investigate', [], { subgoal_id: 'U2', attempt: 1 });
  run.nodes.push(draft, inv);
  const b = nodeBriefing(run, draft);
  assert.deepEqual(b.default_decisions.map((d) => [d.question, d.chose]), [['exit code on malformed rules?', '1'], ['top-3 ties?', 'alphabetical']]);
  const text = composePrompt(run, draft, b);
  assert.match(text, /Decided by default — nobody is here to answer these/);
  assert.match(text, /A decision you discover while writing is decided the same way/);
  assert.match(text, /exit code on malformed rules\? -> 1 \[owner: CLI lead\]/);
  assert.deepEqual(nodeBriefing(run, inv).default_decisions, [], 'investigate still decides what is open');
  assert.equal(nodeBriefing(run, inv).decide_by_default, false);
  run.interactive = true;
  assert.deepEqual(nodeBriefing(run, draft).default_decisions, [], 'an interactive run asks instead');
});

test('code-beta-X3: a report waits on a node still running even after its goal gate went unreachable', () => {
  const run = {
    run_id: 'x3', cwd: '/tmp', max_retries: 2, spec: { subgoals: [] },
    nodes: [
      node('accept:P1:3', 'accept', [], { subgoal_id: 'P1', state: 'failed', final: true, result: {} }),
      node('dispatch:P2:3', 'dispatch', [], { subgoal_id: 'P2', state: 'running' }),
      node('accept:P2:3', 'accept', ['dispatch:P2:3'], { subgoal_id: 'P2' }),
      node('gate:goal:1', 'gate', ['accept:P1:3'], { subgoal_id: null, state: 'unreachable', result: {} }),
      node('report', 'report', [], { after: ['gate:goal:1'] }),
    ],
  };
  assert.deepEqual(readyNodes(run).map((n) => n.node_id), [], 'P2 still running: no report yet');
  getNode(run, 'dispatch:P2:3').state = 'done';
  assert.deepEqual(readyNodes(run).map((n) => n.node_id), ['accept:P2:3'], 'its accept runs first');
  getNode(run, 'accept:P2:3').state = 'done';
  assert.deepEqual(readyNodes(run).map((n) => n.node_id), ['report']);
});

test('code-sprint-P3: validateSpec holds a run to its max_subgoals', () => {
  const sg = (id) => ({ id, title: id, kind: 'planning', acceptance: ['a'], files: [`docs/${id}.md`] });
  const spec = { goal: 'g', acceptance: ['a'], subgoals: [sg('U1'), sg('U2')] };
  assert.ok(validateSpec(spec, { max_subgoals: 1 }).some((p) => /2 subgoals; this run allows at most 1/.test(p)));
  assert.ok(!validateSpec(spec, {}).some((p) => /allows at most/.test(p)));
  assert.ok(!validateSpec({ ...spec, subgoals: [sg('U1')] }, { max_subgoals: 1 }).some((p) => /allows at most/.test(p)));
});

// ---------- task.decisions (_repo/docs/plans/2026-09-28-teams-light-plan.md §6) ----------

test('§6.2-3: an execution-phase run decides a question with a safe default, and keeps as blocking only a contradiction or a question with no safe default', () => {
  const run = { ...askRun(), execution_phase: true, task_decisions: [{ question: twoOptions[0].question, chose: '2 per sale phase', decided_in: 'PLAN', source: 'ask' }] };
  const n = run.nodes[0];
  const out = routeExecutionQuestions(run, n, [
    ...twoOptions, // settled by task_decisions: dropped, not asked and not re-decided
    { question: 'Log format?', options: [{ option: 'json' }, { option: 'text' }] },
    { question: 'Retention?', default: '30 days' },
    { question: 'Which region hosts it?' }, // (b) nothing to default to
    { question: 'Presale enforces 4 - does 2 still hold?', options: [{ option: 'keep 2' }, { option: 'raise' }], default: 'keep 2', contradicts_decision: twoOptions[0].question }, // (a)
  ]);
  assert.deepEqual(out.decided.map((d) => [d.question, d.decided]), [['Log format?', null], ['Retention?', '30 days']]);
  assert.deepEqual(out.blocking.map((b) => [b.question, b.blocking]), [
    ['Which region hosts it?', 'no_safe_default'],
    ['Presale enforces 4 - does 2 still hold?', 'contradicts_decision'],
  ]);
  assert.equal(run.blocking_questions.length, 2);
  routeExecutionQuestions(run, n, [{ question: 'Which region hosts it?' }]);
  assert.equal(run.blocking_questions.length, 2, 'the same blocking question is kept once per run');
  assert.ok(!run.nodes.some((x) => x.stage === 'ask'), 'nothing is asked on the run itself');
});

test('§6.2-1: planDecisions folds a PLAN run\'s ask answers (every owner) and its defaults into one task.decisions list', () => {
  const run = askRun();
  openAsk(run, run.nodes[0], twoOptions);
  run.nodes.find((x) => x.node_id === 'ask:U1:1').result = { decisions: [{ question: twoOptions[0].question, chose: '2 per sale phase', because: 'legal' }] };
  run.unasked = [{ subgoal_id: 'U2', question: 'Refund window?', owner: 'Ops', options: [{ option: '7 days' }, { option: '14 days' }] }];
  assert.deepEqual(planDecisions(run), [
    { question: twoOptions[0].question, chose: '2 per sale phase', because: 'legal', owner: 'U1', decided_in: 'PLAN', source: 'ask' },
    { question: 'Refund window?', chose: '7 days', owner: 'Ops', decided_in: 'PLAN', source: 'default' },
  ]);
  // settledDecisions is what openAsk and nodeBriefing now read: the run's own answers, then the task's.
  run.task_decisions = [{ question: 'Session scope?', chose: 'MVP', decided_in: 'session', source: 'brainstorm' }];
  assert.deepEqual(settledDecisions(run).map((d) => [d.question, d.decided_for]), [
    [twoOptions[0].question, 'U1'], ['Session scope?', 'task/session (brainstorm)'],
  ]);
  assert.deepEqual(openAsk(run, { ...run.nodes[0], attempt: 2 }, [{ question: 'Session scope?', options: ['MVP', 'full'] }]), [], 'a task decision is never asked again');
});
