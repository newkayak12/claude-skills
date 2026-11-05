// graph-pins.mjs: the human pin on a subgoal's author node, its release, and the two queued actions.
//   node --test teams/scripts/test-graph-pins.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyHumanPin, releaseHumanPin, applyPinAction, applyStoryPin, currentAttempt, nodeKind,
} from '../mcp/graph-pins.mjs';
import { node } from '../mcp/graph-nodes.mjs';

const mkRun = (extra = {}) => ({
  interactive: false,
  spec: { subgoals: [{ id: 'U1' }, { id: 'U2', kind: 'planning' }] },
  nodes: [node('implement:U1:1', 'implement', [], { subgoal_id: 'U1', attempt: 1 }), node('draft:U2:1', 'draft', [], { subgoal_id: 'U2', attempt: 1 }),
    node('investigate:U2:1', 'investigate', [], { subgoal_id: 'U2', attempt: 1 })],
  ...extra,
});
const sgOf = (run, id) => run.spec.subgoals.find((s) => s.id === id);

test('applyHumanPin: no assignee, or a node already past pending, changes nothing', () => {
  const run = mkRun();
  assert.equal(applyHumanPin(run, sgOf(run, 'U1'), 'U1', 1), null);
  run.nodes[0].state = 'running';
  assert.equal(applyHumanPin(run, { id: 'U1', assignee: { by: 'user' } }, 'U1', 1), null);
  assert.equal(run.nodes[0].assignment, undefined);
});

test('applyHumanPin: a user pin parks the AUTHOR node even when not interactive; judging stages are never pinned', () => {
  const run = mkRun();
  const sg = sgOf(run, 'U2');
  sg.assignee = { by: 'user', who: 'noah' };
  const n = applyHumanPin(run, sg, 'U2', 1);
  assert.equal(n.node_id, 'draft:U2:1', 'planning\'s author is draft, not investigate');
  assert.deepEqual(n.assignment, { executor: 'human', vendor: 'human', who: 'noah', reason: 'pinned by tm_assign' });
  assert.equal(run.nodes.find((x) => x.node_id === 'investigate:U2:1').assignment, undefined);
});

test('applyHumanPin: a model-written pin parks only when interactive; otherwise it is recorded as auto_decided_pin', () => {
  const quiet = mkRun();
  const sg = sgOf(quiet, 'U1');
  sg.assignee = 'human';
  assert.equal(applyHumanPin(quiet, sg, 'U1', 1), null);
  assert.equal(quiet.nodes[0].assignment, undefined);
  assert.equal(quiet.nodes[0].auto_decided_pin.by, 'auto');
  assert.equal(quiet.nodes[0].auto_decided_pin.pin, 'human');
  const live = mkRun({ interactive: true });
  const sg2 = sgOf(live, 'U1');
  sg2.assignee = { who: 'ana' };
  const n = applyHumanPin(live, sg2, 'U1', 1);
  assert.equal(n.assignment.reason, 'pinned by the subgoal spec (assignee)');
  assert.equal(n.assignment.who, 'ana');
});

test('releaseHumanPin: drops the spec assignee, un-parks a waiting node, removes only a human assignment', () => {
  const run = mkRun({ interactive: true });
  const sg = sgOf(run, 'U1');
  sg.assignee = { by: 'user' };
  const pinned = applyHumanPin(run, sg, 'U1', 1);
  pinned.state = 'waiting_human';
  pinned.waiting_since = 1;
  const n = releaseHumanPin(run, sg, 'U1', 1);
  assert.equal(n.state, 'pending');
  assert.ok(!('waiting_since' in n) && !('assignment' in n) && !('assignee' in sg));
  run.nodes[0].assignment = { executor: 'claude' };
  releaseHumanPin(run, sg, 'U1', 1);
  assert.deepEqual(run.nodes[0].assignment, { executor: 'claude' }, 'a routed assignment is kept');
  assert.equal(releaseHumanPin(run, sg, 'U9', 1), null);
});

test('applyPinAction: to human pins as the user; to auto releases; an unknown subgoal is null', () => {
  const run = mkRun();
  assert.equal(applyPinAction(run, { subgoal_id: 'nope', attempt: 1, to: 'human' }), null);
  const n = applyPinAction(run, { subgoal_id: 'U1', attempt: 1, to: 'human', who: 'sam' });
  assert.equal(n.assignment.who, 'sam');
  assert.deepEqual(sgOf(run, 'U1').assignee, { by: 'user', who: 'sam' });
  applyPinAction(run, { subgoal_id: 'U1', attempt: 1, to: 'auto' });
  assert.ok(!('assignee' in sgOf(run, 'U1')));
  assert.ok(!('assignment' in run.nodes[0]));
});

test('applyStoryPin: pins every existing subgoal, and a release restores a model-written assignee', () => {
  const run = mkRun({ subgoal_assignee: 'human' });
  sgOf(run, 'U1').assignee = 'human';
  assert.equal(applyStoryPin(run, { to: 'human', who: 'lee' }), true);
  assert.deepEqual(run.subgoal_assignee, { by: 'user', who: 'lee' });
  assert.equal(run.model_subgoal_assignee, 'human', 'the model\'s own assignee is kept aside');
  assert.equal(sgOf(run, 'U1').model_assignee, 'human');
  assert.equal(run.nodes[0].assignment.who, 'lee');
  assert.equal(applyStoryPin(run, { to: 'auto' }), true);
  assert.equal(run.subgoal_assignee, 'human', 'put back');
  assert.ok(!('model_subgoal_assignee' in run));
  assert.ok(!(run.nodes[0].assignment && run.nodes[0].assignment.executor === 'human'));
});

test('applyStoryPin: a release with nothing pinned reports no change', () => {
  assert.equal(applyStoryPin(mkRun(), { to: 'auto' }), false);
  assert.equal(applyStoryPin({ nodes: [] }, { to: 'human' }), true, 'a run with no spec still records the run-level pin');
});

test('currentAttempt is the highest attempt among the subgoal\'s nodes, 1 when there are none', () => {
  const run = mkRun();
  run.nodes.push(node('implement:U1:3', 'implement', [], { subgoal_id: 'U1', attempt: 3 }));
  assert.equal(currentAttempt(run, 'U1'), 3);
  assert.equal(currentAttempt(run, 'U9'), 1);
  assert.equal(currentAttempt(run, 'U2'), 1);
});

test('nodeKind: the subgoal\'s kind from the spec; null for run-level nodes or a missing spec', () => {
  const run = mkRun();
  assert.equal(nodeKind(run, { subgoal_id: 'U2' }), 'planning');
  assert.equal(nodeKind(run, { subgoal_id: 'U1' }), 'subgoal');
  assert.equal(nodeKind(run, { subgoal_id: 'U9' }), null);
  assert.equal(nodeKind(run, { stage: 'plan' }), null);
  assert.equal(nodeKind({ nodes: [] }, { subgoal_id: 'U1' }), null);
  assert.equal(nodeKind(run, null), null);
});
