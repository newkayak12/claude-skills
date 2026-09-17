import { test } from 'node:test';
import assert from 'node:assert/strict';
import { graphStageSkills, graphStageMounts, mountBlock } from '../mcp/mounts.mjs';
import { composePrompt, SKILL_METHOD_DISCLAIMER } from '../mcp/prompts.mjs';
import { createRun } from '../mcp/graph.mjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function node(node_id, stage, extra) {
  return { node_id, stage, ...(extra || {}) };
}

// ---------- stage-mounted skills: defaults ----------

test('every stage the plan doc names gets its default skill', () => {
  const run = {};
  assert.deepEqual(graphStageSkills(run, node('plan', 'plan')), ['agents:agent-task-decomposer']);
  assert.deepEqual(graphStageSkills(run, node('critique', 'critique')), ['think:devils-advocate']);
  assert.deepEqual(graphStageSkills(run, node('gate:U1:1', 'gate', { subgoal_id: 'U1' })), ['think:devils-advocate']);
  assert.deepEqual(graphStageSkills(run, node('gate:goal:1', 'gate', { subgoal_id: null })), ['think:devils-advocate']);
  assert.deepEqual(graphStageSkills(run, node('test:U1:1', 'test', { subgoal_id: 'U1' })), ['completion:verification-before-completion']);
  assert.deepEqual(graphStageSkills(run, node('review:D1:1', 'review', { subgoal_id: 'D1' })), ['think:devils-advocate']);
});

test('setgoal, implement and draft are not stage-mounted - their method comes from the kind or the spec', () => {
  const run = {};
  assert.deepEqual(graphStageSkills(run, node('setgoal', 'setgoal')), []);
  assert.deepEqual(graphStageSkills(run, node('implement:U1:1', 'implement', { subgoal_id: 'U1' })), []);
  assert.deepEqual(graphStageSkills(run, node('draft:D1:1', 'draft', { subgoal_id: 'D1' })), []);
});

test('a subgoal gate and the goal gate are keyed separately, so an override can tell them apart', () => {
  const run = { skills: { 'gate:goal': ['cognition:critical-thinking-workflow'] } };
  assert.deepEqual(graphStageSkills(run, node('gate:U1:1', 'gate', { subgoal_id: 'U1' })), ['think:devils-advocate'],
    'a subgoal gate keeps the default - only gate:goal was overridden');
  assert.deepEqual(graphStageSkills(run, node('gate:goal:1', 'gate', { subgoal_id: null })), ['cognition:critical-thinking-workflow']);
});

// ---------- off switch and override, mirroring tm_open({skills}) ----------

test('skills: false runs every stage on its contract alone', () => {
  const run = { skills: false };
  for (const [id, stage] of [['plan', 'plan'], ['critique', 'critique'], ['gate:goal:1', 'gate'], ['test:U1:1', 'test'], ['review:D1:1', 'review']]) {
    assert.deepEqual(graphStageSkills(run, node(id, stage)), []);
  }
});

test('an override replaces the default for that stage - it does not add to it, and it does not touch other stages', () => {
  const run = { skills: { plan: ['develop:architecture-designer'] } };
  assert.deepEqual(graphStageSkills(run, node('plan', 'plan')), ['develop:architecture-designer']);
  assert.deepEqual(graphStageSkills(run, node('critique', 'critique')), ['think:devils-advocate'], 'critique keeps its default');
});

test('an override to an empty array turns a single stage off without turning off the mechanism', () => {
  const run = { skills: { critique: [] } };
  assert.deepEqual(graphStageSkills(run, node('critique', 'critique')), []);
  assert.deepEqual(graphStageSkills(run, node('plan', 'plan')), ['agents:agent-task-decomposer'], 'plan is unaffected');
});

// ---------- stage-mounted MCP tools: defaults, off switch, override ----------

test('plan, setgoal and gate:goal each get one advisory MCP tool by default', () => {
  const run = {};
  assert.deepEqual(graphStageMounts(run, node('plan', 'plan')).map((m) => m.tool), ['mcp__sequential-thinking__sequentialthinking']);
  assert.deepEqual(graphStageMounts(run, node('setgoal', 'setgoal')).map((m) => m.tool), ['mcp__think-tool__think']);
  assert.deepEqual(graphStageMounts(run, node('gate:goal:1', 'gate', { subgoal_id: null })).map((m) => m.tool), ['mcp__mcp-reasoner__mcp-reasoner']);
  // A subgoal gate is not the goal gate - no mount by default.
  assert.deepEqual(graphStageMounts(run, node('gate:U1:1', 'gate', { subgoal_id: 'U1' })), []);
});

test('mounts: false offers no MCP tool anywhere', () => {
  const run = { mounts: false };
  assert.deepEqual(graphStageMounts(run, node('plan', 'plan')), []);
  assert.deepEqual(graphStageMounts(run, node('setgoal', 'setgoal')), []);
  assert.deepEqual(graphStageMounts(run, node('gate:goal:1', 'gate', { subgoal_id: null })), []);
});

test('a mounts override replaces the default for that stage only, and accepts a plain string', () => {
  const run = { mounts: { plan: ['mcp__think-tool__think'] } };
  assert.deepEqual(graphStageMounts(run, node('plan', 'plan')).map((m) => m.tool), ['mcp__think-tool__think']);
  assert.deepEqual(graphStageMounts(run, node('setgoal', 'setgoal')).map((m) => m.tool), ['mcp__think-tool__think'], 'setgoal keeps its default');
});

test('draft and cases each get one advisory MCP tool by default, added for planning/qa', () => {
  const run = {};
  assert.deepEqual(graphStageMounts(run, node('draft:D1:1', 'draft', { subgoal_id: 'D1' })).map((m) => m.tool), ['mcp__think-tool__think']);
  assert.deepEqual(graphStageMounts(run, node('cases:Q1:1', 'cases', { subgoal_id: 'Q1' })).map((m) => m.tool), ['mcp__sequential-thinking__sequentialthinking']);
  // execute gets none by default, matching the design doc's "없음"
  assert.deepEqual(graphStageMounts(run, node('execute:Q1:1', 'execute', { subgoal_id: 'Q1' })), []);
});

test('a mounts override on draft does not touch cases, and vice versa', () => {
  const run = { mounts: { draft: [] } };
  assert.deepEqual(graphStageMounts(run, node('draft:D1:1', 'draft', { subgoal_id: 'D1' })), []);
  assert.deepEqual(graphStageMounts(run, node('cases:Q1:1', 'cases', { subgoal_id: 'Q1' })).map((m) => m.tool), ['mcp__sequential-thinking__sequentialthinking']);
});

// ---------- mountBlock rendering ----------

test('mountBlock renders nothing for a stage with neither a skill nor a mount', () => {
  assert.equal(mountBlock({}, node('implement:U1:1', 'implement', { subgoal_id: 'U1' })), '');
});

test('mountBlock renders a Method section, a Tools section, or both, as the stage warrants', () => {
  const run = {};
  const plan = mountBlock(run, node('plan', 'plan'));
  assert.match(plan, /## Method/);
  assert.match(plan, /agents:agent-task-decomposer/);
  assert.match(plan, /## Tools/);
  assert.match(plan, /mcp__sequential-thinking__sequentialthinking/);

  const setgoal = mountBlock(run, node('setgoal', 'setgoal'));
  assert.doesNotMatch(setgoal, /## Method/, 'setgoal has no stage-mounted skill');
  assert.match(setgoal, /## Tools/);

  const critique = mountBlock(run, node('critique', 'critique'));
  assert.match(critique, /## Method/);
  assert.doesNotMatch(critique, /## Tools/, 'critique has no stage-mounted mount');
});

test('the fall-back-to-SKILL.md instruction and the shared disclaimer both appear in a Method block', () => {
  const block = mountBlock({}, node('plan', 'plan'));
  assert.match(block, /Skill tool/);
  assert.match(block, /SKILL\.md/);
  assert.ok(block.includes(SKILL_METHOD_DISCLAIMER), 'reused verbatim, not reworded');
});

// ---------- composePrompt: the shared disclaimer appears exactly once ----------

test('the contract-outranks disclaimer appears exactly once in a composed prompt for a stage with only the stage mount', () => {
  const run = { cwd: '/tmp/mounts-test', request: 'r', context: '', allocation: 'ordered' };
  const prompt = composePrompt(run, node('plan', 'plan'), { upstream: [] });
  const count = prompt.split(SKILL_METHOD_DISCLAIMER).length - 1;
  assert.equal(count, 1, 'plan only ever gets the stage-mounted Method block, never the subgoal one');
});

test('the contract-outranks disclaimer still appears at least once when a subgoal Method block ALSO renders', () => {
  // test/review/gate belong to a subgoal chain (kind skills) AND are stage-mounted, so both
  // Method blocks can render on the same node. The disclaimer is shared text, not a new
  // mechanism, so this asserts it is present rather than asserting a count.
  const run = { cwd: '/tmp/mounts-test', request: 'r', context: '', allocation: 'ordered' };
  const briefing = {
    upstream: [],
    subgoal: { id: 'U1', title: 't', kind: 'subgoal', acceptance: ['a'], test: ['t'] },
  };
  const prompt = composePrompt(run, node('test:U1:1', 'test', { subgoal_id: 'U1' }), briefing);
  assert.ok(prompt.includes(SKILL_METHOD_DISCLAIMER));
});

// ---------- createRun stores the options ----------

test('createRun normalizes skills and mounts the same way tm_open does: null default, false off, object override', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'mounts-createrun-'));
  try {
    const bare = createRun({ cwd, request: 'r' });
    assert.equal(bare.skills, null);
    assert.equal(bare.mounts, null);

    const off = createRun({ cwd, request: 'r', skills: false, mounts: false });
    assert.equal(off.skills, false);
    assert.equal(off.mounts, false);

    const override = createRun({ cwd, request: 'r', skills: { plan: ['x'] }, mounts: { plan: ['y'] } });
    assert.deepEqual(override.skills, { plan: ['x'] });
    assert.deepEqual(override.mounts, { plan: ['y'] });

    // Garbage input (a string, a number) is not an object override and is not `false`
    // either - it must fall back to the default, not be stored verbatim.
    const garbage = createRun({ cwd, request: 'r', skills: 'nonsense' });
    assert.equal(garbage.skills, null);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
