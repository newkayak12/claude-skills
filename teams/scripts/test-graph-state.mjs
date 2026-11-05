// graph-state.mjs: runState (counts, state word, goal verdict) and nodeBriefing (what a node is handed).
//   node --test teams/scripts/test-graph-state.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runState, nodeBriefing } from '../mcp/graph-state.mjs';
import { node, getNode } from '../mcp/graph-nodes.mjs';
import { pushGoalGateRound } from '../mcp/graph-goalgate.mjs';

const st = (n, state, result) => { n.state = state; if (result !== undefined) n.result = result; return n; };

test('runState: counts every state; nothing ready and nothing running is blocked; a ready node is running', () => {
  const a = node('a', 'plan');
  const b = node('b', 'setgoal', ['a']);
  assert.deepEqual(runState({ nodes: [a, b] }), { state: 'running', counts: { pending: 2, running: 0, done: 0, failed: 0, skipped: 0, unreachable: 0, waiting_human: 0 } });
  st(a, 'failed');
  assert.equal(runState({ nodes: [a, b] }).state, 'blocked', 'b waits on a failed dep');
  st(a, 'running');
  assert.equal(runState({ nodes: [a, b] }).state, 'running');
});

test('runState: waiting_human only when nothing else can move; routing_blocked blocks a run with nothing running', () => {
  const parked = st(node('p', 'implement'), 'waiting_human');
  assert.equal(runState({ nodes: [parked] }).state, 'waiting_human');
  assert.equal(runState({ nodes: [parked, node('other', 'plan')] }).state, 'running', 'a sibling is still ready');
  assert.equal(runState({ nodes: [node('x', 'plan', ['never'])], routing_blocked: true }).state, 'blocked');
  assert.equal(runState({ nodes: [st(node('x', 'plan'), 'running')], routing_blocked: true }).state, 'running');
});

test('runState: only a done report is complete; `settled: true` when something was unreachable', () => {
  const rep = st(node('report', 'report'), 'done');
  assert.deepEqual(runState({ nodes: [rep] }), { state: 'complete', counts: { pending: 0, running: 0, done: 1, failed: 0, skipped: 0, unreachable: 0, waiting_human: 0 } });
  const dead = st(node('d', 'test'), 'unreachable');
  const out = runState({ nodes: [rep, dead] });
  assert.deepEqual([out.state, out.settled], ['complete', true]);
  assert.equal(runState({ nodes: [node('report', 'report')] }).state, 'running', 'a pending report is not complete');
});

test('runState: the latest SETTLED goal round\'s verdict is surfaced, skipping a newer round still judging', () => {
  const run = { nodes: [] };
  pushGoalGateRound(run, [], {}, 1);
  pushGoalGateRound(run, [], {}, 1);
  st(getNode(run, 'gate:goal:1'), 'failed', { stage_ok: true, accept: false, match_pct: 50, gaps: ['g'] });
  const out = runState(run);
  assert.deepEqual([out.goal_verdict.accept, out.goal_verdict.match_pct, out.goal_verdict.gaps], [false, 50, ['g']]);
  assert.deepEqual(Object.keys(out.goal_verdict).sort(), ['accept', 'gaps', 'judges', 'match_pct', 'spec_drift']);
  const none = runState({ nodes: [node('a', 'plan')] });
  assert.ok(!('goal_verdict' in none));
});

const subgoalRun = () => {
  const impl = st(node('implement:U1:1', 'implement', [], { subgoal_id: 'U1', attempt: 1 }), 'done', {
    handoff: 'h', evidence: 'e', checks: ['c'], changed_files: ['a.mjs'], changed_files_verified: true,
    event_evidence: { commands: ['npm test'], commands_executed: 1, commands_failed: 0 },
  });
  const tst = st(node('test:U1:1', 'test', ['implement:U1:1'], { subgoal_id: 'U1', attempt: 1 }), 'done', { verified: true, defects: [{ d: 1 }] });
  const gate = node('gate:U1:1', 'gate', ['test:U1:1'], { subgoal_id: 'U1', attempt: 1 });
  return { run_id: 'r', cwd: '/c', request: 'req', context: '', flow: 'develop', nodes: [impl, tst, gate],
    spec: { goal: 'G', acceptance: ['A'], subgoals: [{ id: 'U1' }] } };
};

test('nodeBriefing: a subgoal gate sees its whole attempt, not only its direct dep', () => {
  const run = subgoalRun();
  const b = nodeBriefing(run, getNode(run, 'gate:U1:1'));
  assert.deepEqual(b.upstream.map((u) => u.node_id), ['implement:U1:1', 'test:U1:1']);
  assert.deepEqual([b.upstream[0].changed_files, b.upstream[0].commands, b.upstream[0].commands_executed], [['a.mjs'], ['npm test'], 1]);
  assert.deepEqual(b.upstream[1].defects, [{ d: 1 }]);
  assert.deepEqual([b.run_id, b.stage, b.goal, b.goal_acceptance, b.subgoal, b.subgoals, b.whole_run], ['r', 'gate', 'G', ['A'], { id: 'U1' }, null, null]);
  assert.deepEqual([b.flow_chosen, b.default_kind, b.reasoning_stage, b.write_scope, b.investigate_unknowns], ['develop', 'subgoal', true, null, null]);
});

test('nodeBriefing: a spec-wide node sees the subgoals; the goal gate and report see every finished node', () => {
  const run = subgoalRun();
  const goal = node('gate:goal:1', 'gate', ['gate:U1:1'], { subgoal_id: null });
  run.nodes.push(goal);
  const b = nodeBriefing(run, goal);
  assert.deepEqual(b.subgoals, [{ id: 'U1' }]);
  assert.deepEqual(b.whole_run.map((x) => x.node_id), ['implement:U1:1', 'test:U1:1']);
  assert.deepEqual(b.whole_run[1].verified, true);
  assert.ok(b.write_scope && Array.isArray(b.write_scope.collisions || []), 'the goal gate carries the write-scope check');
  const crit = nodeBriefing(run, node('critique', 'critique', [], {}));
  assert.equal(crit.whole_run, null);
  assert.deepEqual(crit.subgoals, [{ id: 'U1' }]);
});

test('nodeBriefing: prior feedback, the previous setgoal\'s spec problems, and the settled decisions it must not re-ask', () => {
  const run = { run_id: 'r', nodes: [], spec: null, task_decisions: [{ question: 'q', chose: 'c' }] };
  run.nodes.push(st(node('setgoal', 'setgoal'), 'failed', { spec_problems: ['no goal'] }));
  const retry = node('setgoal:2', 'setgoal', ['plan'], { attempt: 2, feedback: 'redo' });
  run.nodes.push(retry);
  const b = nodeBriefing(run, retry);
  assert.deepEqual([b.prior_feedback, b.spec_problems], ['redo', ['no goal']]);
  assert.deepEqual(b.prior_decisions.map((d) => d.question), ['q']);
  const plain = nodeBriefing(run, getNode(run, 'setgoal'));
  assert.equal(plain.spec_problems, null);
});

test('nodeBriefing: default decisions only on authoring stages of a non-interactive (or execution-phase) run', () => {
  const unasked = [{ question: 'q1', options: [{ option: 'first' }, 'second'], owner: 'po', subgoal_id: 'U1' }, { question: 'q2', decided: 'yes' }, { question: 'q3' }];
  const run = { run_id: 'r', nodes: [], interactive: false, unasked };
  const draft = node('draft:U1:1', 'draft', [], { subgoal_id: 'U1' });
  const b = nodeBriefing(run, draft);
  assert.equal(b.decide_by_default, true);
  assert.deepEqual(b.default_decisions, [
    { question: 'q1', chose: 'first', owner: 'po', asked_under: 'U1' },
    { question: 'q2', chose: 'yes', owner: null, asked_under: null },
  ]);
  assert.deepEqual([nodeBriefing(run, node('gate:U1:1', 'gate', [], { subgoal_id: 'U1' })).decide_by_default], [false]);
  assert.equal(nodeBriefing({ ...run, interactive: true }, draft).decide_by_default, false);
  assert.equal(nodeBriefing({ ...run, interactive: true, execution_phase: true }, draft).decide_by_default, true);
});

test('nodeBriefing: a planning-light template-fill / gate is handed the same attempt\'s investigate unknowns', () => {
  const inv = st(node('investigate:U1:2', 'investigate', [], { subgoal_id: 'U1', attempt: 2 }), 'done', {
    unknowns: [{ question: 'q', owner: 'po' }, { unknown: 'u' }, { nothing: 1 }],
  });
  const old = st(node('investigate:U1:1', 'investigate', [], { subgoal_id: 'U1', attempt: 1 }), 'done', { unknowns: [{ question: 'old' }] });
  const fill = node('template-fill:U1:2', 'template-fill', ['investigate:U1:2'], { subgoal_id: 'U1', attempt: 2 });
  const run = { run_id: 'r', nodes: [old, inv, fill], spec: { goal: 'g', subgoals: [{ id: 'U1', kind: 'planning-light' }] } };
  assert.deepEqual(nodeBriefing(run, fill).investigate_unknowns, [{ question: 'q', owner: 'po' }, { question: 'u', owner: null }]);
  const draft = node('investigate:U1:2b', 'investigate', [], { subgoal_id: 'U1', attempt: 2 });
  assert.equal(nodeBriefing(run, draft).investigate_unknowns, null, 'investigate itself is not handed them');
});
