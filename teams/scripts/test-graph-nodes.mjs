// graph-nodes.mjs: node(), createRun, stagePolicy, validateSpec and the chain wiring.
//   node --test teams/scripts/test-graph-nodes.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  node, createRun, stagePolicy, getNode, DOCUMENT_ONLY_KINDS, validateSpec, nextIndex, pushChain,
} from '../mcp/graph-nodes.mjs';
import { loadRun } from '../mcp/graph-runfile.mjs';
import { DEFAULT_MODELS } from '../mcp/routing.mjs';

const withCwd = (fn) => {
  const cwd = mkdtempSync(join(tmpdir(), 'graph-nodes-'));
  try { return fn(cwd); } finally { rmSync(cwd, { recursive: true, force: true }); }
};

test('node(): defaults, and `extra` overrides them', () => {
  assert.deepEqual(node('a', 'plan'), { node_id: 'a', stage: 'plan', deps: [], after: [], state: 'pending', attempt: 1, ticket: null, result: null });
  const n = node('b', 'gate', ['a'], { attempt: 3, subgoal_id: 'U1', after: ['x'] });
  assert.deepEqual([n.deps, n.after, n.attempt, n.subgoal_id], [['a'], ['x'], 3, 'U1']);
});

test('createRun: three-node head, persisted, with the documented defaults', () => {
  withCwd((cwd) => {
    const run = createRun({ cwd, request: 'r' });
    assert.deepEqual(run.nodes.map((n) => [n.node_id, n.deps]), [['plan', []], ['setgoal', ['plan']], ['critique', ['setgoal']]]);
    assert.equal(run.flow, 'auto');
    assert.equal(run.goal_threshold, 90);
    assert.equal(run.goal_judges, 1);
    assert.equal(run.max_retries, 2);
    assert.equal(run.retry_policy, 'continue');
    assert.equal(run.interactive, false);
    assert.equal(run.auto_reassign, true);
    assert.deepEqual(run.human_gates, []);
    assert.ok(!('planning_mode' in run) && !('task_decisions' in run) && !('execution_phase' in run), 'optional keys are absent, not empty');
    assert.equal(loadRun(cwd, run.run_id).run_id, run.run_id, 'saved to its run file');
  });
});

test('createRun: options are validated, not copied blindly', () => {
  withCwd((cwd) => {
    const run = createRun({
      cwd, request: 'r', flow: 'qa', goal_judges: 3, goal_threshold: 80, max_retries: 0, retry_policy: 'rollback',
      planning_mode: 'light', execution_phase: true, interactive: true, human_gates: ['gate'], max_subgoals: 1,
      task_decisions: [{ question: 'q', chose: 'c' }], skills: false, mounts: { a: 1 },
    });
    assert.equal(run.flow, 'qa');
    assert.equal(run.goal_judges, 3);
    assert.equal(run.goal_threshold, 80);
    assert.equal(run.max_retries, 0);
    assert.equal(run.retry_policy, 'rollback');
    assert.equal(run.planning_mode, 'light');
    assert.equal(run.execution_phase, true);
    assert.equal(run.max_subgoals, 1);
    assert.deepEqual(run.task_decisions, [{ question: 'q', chose: 'c' }]);
    assert.equal(run.skills, false);
    assert.deepEqual(run.mounts, { a: 1 });
    const bad = createRun({ cwd, request: 'r', flow: 'nope', goal_judges: 0, max_subgoals: -1, retry_policy: 'x', skills: 'y' });
    assert.equal(bad.flow, 'auto');
    assert.equal(bad.goal_judges, 1);
    assert.equal(bad.max_subgoals, null);
    assert.equal(bad.retry_policy, 'continue');
    assert.equal(bad.skills, null);
  });
});

test('createRun: a package carries its acceptance and subgoal_assignee', () => {
  withCwd((cwd) => {
    const run = createRun({ cwd, request: 'r', package: { id: 7, title: 't' }, goal: 'G', acceptance: ['a', '', 'b'], subgoal_assignee: { by: 'user' } });
    assert.deepEqual(run.package, { id: '7', origin: 'shape', title: 'G', acceptance: ['a', 'b'] });
    assert.deepEqual(run.subgoal_assignee, { by: 'user' });
  });
});

test('getNode finds by id or returns null', () => {
  const run = { nodes: [node('a', 'plan')] };
  assert.equal(getNode(run, 'a').stage, 'plan');
  assert.equal(getNode(run, 'z'), null);
});

test('stagePolicy: stage entry beats the run default; gate:goal can be keyed apart', () => {
  const run = { vendor: 'auto', candidates: null, sandbox: null, model: 'm0', policy: { gate: { vendor: 'codex' }, 'gate:goal': { model: 'mg' } }, nodes: [] };
  assert.deepEqual(stagePolicy(run, node('implement:U1:1', 'implement')), { vendor: 'auto', candidates: null, sandbox: null, model: 'm0' });
  assert.deepEqual(stagePolicy(run, node('gate:U1:1', 'gate')), { vendor: 'codex', candidates: null, sandbox: null, model: 'm0' });
  assert.deepEqual(stagePolicy(run, node('gate:goal:1', 'gate')), { vendor: 'codex', candidates: null, sandbox: null, model: 'mg' });
});

test('stagePolicy: a second goal judge is biased away from the primary\'s vendor', () => {
  const primary = node('gate:goal:1', 'gate', [], { executor: 'claude' });
  const run = { vendor: 'auto', candidates: ['claude', 'codex'], sandbox: null, model: null, policy: {}, nodes: [primary] };
  assert.deepEqual(stagePolicy(run, node('gate:goal:1b', 'gate')).candidates, ['codex', 'claude']);
  assert.deepEqual(stagePolicy(run, primary).candidates, ['claude', 'codex'], 'the primary itself is not reordered');
  const one = { vendor: 'claude', candidates: null, sandbox: null, model: null, policy: {}, nodes: [primary] };
  assert.equal(stagePolicy(one, node('gate:goal:1b', 'gate')).model, DEFAULT_MODELS.claude, 'pinned to the same vendor: its default tier');
});

test('validateSpec: each structural defect is named', () => {
  assert.deepEqual(validateSpec(null), ['setgoal returned no spec object']);
  assert.deepEqual(validateSpec({}), ['spec has no goal', 'spec has no goal-level acceptance criteria', 'spec has no subgoals - there would be nothing to implement']);
  const ok = { goal: 'g', acceptance: ['a'], subgoals: [{ id: 'U1', title: 't', acceptance: ['x'] }, { id: 'U2', title: 't', acceptance: ['x'], deps: ['U1'] }] };
  assert.deepEqual(validateSpec(ok), []);
  const p = validateSpec({ goal: 'g', acceptance: ['a'], subgoals: [
    { id: 'U1', title: 't', acceptance: ['x'], deps: ['U1', 'U9'], after: ['U1', 'U8'] },
    { id: 'U1', acceptance: [] },
    { title: 'no id' },
    { id: 'U3', title: 't', acceptance: ['x'], kind: 'weird' },
  ] });
  for (const re of [/depends on itself/, /depends on U9, which is not in the spec/, /ordered after itself/, /ordered after U8/,
    /duplicate subgoal id U1/, /subgoal U1 has no acceptance/, /a subgoal has no id/, /unknown kind weird/]) {
    assert.ok(p.some((x) => re.test(x)), String(re));
  }
});

test('validateSpec: cycles, max_subgoals, mixed=false, and document-only kinds', () => {
  const cyc = { goal: 'g', acceptance: ['a'], subgoals: [
    { id: 'A', title: 't', acceptance: ['x'], deps: ['B'] }, { id: 'B', title: 't', acceptance: ['x'], after: ['A'] } ] };
  assert.ok(validateSpec(cyc).some((x) => /dependency cycle: A -> B -> A/.test(x)));
  const two = { goal: 'g', acceptance: ['a'], subgoals: [{ id: 'A', title: 't', acceptance: ['x'] }, { id: 'B', title: 't', acceptance: ['x'] }] };
  assert.ok(validateSpec(two, { max_subgoals: 1 }).some((x) => /at most 1 - fold the rest into the one/.test(x)));
  assert.ok(validateSpec(two, { mixed: false, kind: 'document', flow: 'document' }).some((x) => /kind subgoal, but this run is flow document with mixed=false/.test(x)));
  const doc = { goal: 'g', acceptance: ['a'], subgoals: [{ id: 'A', title: 't', acceptance: ['x'], kind: 'planning', files: ['a.md', 'src/x.mjs'] }] };
  const problems = validateSpec(doc);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /"src\/x\.mjs" is not a document path/);
  assert.deepEqual([...DOCUMENT_ONLY_KINDS], ['planning', 'planning-light', 'planning-audit']);
});

test('nextIndex counts the id and its `prefix:` children; pushChain wires a chain head to tail', () => {
  const run = { nodes: [node('implement:U1:1', 'implement'), node('implement:U1:2', 'implement'), node('implement:U10:1', 'implement')] };
  assert.equal(nextIndex(run, 'implement:U1'), 3, 'U10 does not count towards U1');
  assert.equal(nextIndex(run, 'gate'), 1);
  const last = pushChain(run, ['implement', 'test', 'gate'], 'U2', 1, ['critique'], ['gate:U1:1'], { feedback: 'f' });
  assert.equal(last, 'gate:U2:1');
  const [i, t, g] = ['implement:U2:1', 'test:U2:1', 'gate:U2:1'].map((id) => getNode(run, id));
  assert.deepEqual([i.deps, i.after, i.feedback], [['critique'], ['gate:U1:1'], 'f']);
  assert.deepEqual([t.deps, t.after, t.feedback], [['implement:U2:1'], [], undefined], 'only the head carries deps/after/extra');
  assert.deepEqual([g.deps, g.subgoal_id, g.attempt], [['test:U2:1'], 'U2', 1]);
});
