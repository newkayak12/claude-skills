// graph-goalgate.mjs: goal-gate rounds, consensus over sibling judges, and repair.
//   node --test teams/scripts/test-graph-goalgate.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  goalRoundOf, goalGateSiblings, nextGoalRound, pushGoalGateRound, goalConsensus, nextRepairIndex, openRepair,
} from '../mcp/graph-goalgate.mjs';
import { node, getNode } from '../mcp/graph-nodes.mjs';

test('goalRoundOf: the round of a goal-gate id, null for anything else', () => {
  assert.equal(goalRoundOf('gate:goal:3'), 3);
  assert.equal(goalRoundOf('gate:goal:12c'), 12);
  assert.equal(goalRoundOf('gate:U1:3'), null, 'a subgoal gate is not a goal gate');
  assert.equal(goalRoundOf('gate:goal:x'), null);
  assert.equal(goalRoundOf(undefined), null);
});

test('pushGoalGateRound: one judge is gate:goal:N; more get b, c suffixes; the next round is one past', () => {
  const run = { nodes: [] };
  assert.equal(nextGoalRound(run), 1);
  const r1 = pushGoalGateRound(run, ['g1'], { after: ['x'] }, 1);
  assert.deepEqual(r1, { round: 1, ids: ['gate:goal:1'] });
  assert.deepEqual(getNode(run, 'gate:goal:1').after, ['x']);
  assert.equal(getNode(run, 'gate:goal:1').subgoal_id, null);
  const r2 = pushGoalGateRound(run, ['g1'], null, 3);
  assert.deepEqual(r2.ids, ['gate:goal:2', 'gate:goal:2b', 'gate:goal:2c']);
  assert.equal(nextGoalRound(run), 3, 'siblings share a round');
  assert.deepEqual(pushGoalGateRound(run, [], {}, 0).ids, ['gate:goal:3'], 'at least one judge');
  assert.deepEqual(goalGateSiblings(run, 2).map((n) => n.node_id), ['gate:goal:2', 'gate:goal:2b', 'gate:goal:2c']);
  assert.deepEqual(goalGateSiblings(run, 9), []);
});

test('goalConsensus: null with no judges; unsettled while one is pending; accept needs every judge done', () => {
  const run = { nodes: [] };
  assert.equal(goalConsensus(run, 1), null);
  pushGoalGateRound(run, [], {}, 2);
  const [a, b] = goalGateSiblings(run, 1);
  a.state = 'done'; a.result = { stage_ok: true, accept: true, match_pct: 95, gaps: ['g1'], spec_drift: ['d'] };
  assert.equal(goalConsensus(run, 1).settled, false, 'b still pending');
  b.state = 'done'; b.result = { stage_ok: true, accept: true, match_pct: 91, gaps: ['g1', 'g2'] };
  const c = goalConsensus(run, 1);
  assert.equal(c.settled, true);
  assert.equal(c.accept, true);
  assert.equal(c.match_pct, 91, 'the minimum');
  assert.deepEqual(c.gaps, ['g1', 'g2'], 'union, de-duplicated');
  assert.deepEqual(c.spec_drift, ['d']);
  assert.deepEqual(c.judges.map((j) => j.node_id), ['gate:goal:1', 'gate:goal:1b']);
  assert.equal(c.judges[0].identity, 'self@default');
});

test('goalConsensus: one rejecting judge rejects; a judge that could not judge is a routing failure, not settled', () => {
  const run = { nodes: [] };
  pushGoalGateRound(run, [], {}, 2);
  const [a, b] = goalGateSiblings(run, 1);
  a.state = 'done'; a.result = { stage_ok: true, accept: true, match_pct: 99 };
  b.state = 'failed'; b.result = { stage_ok: true, accept: false, match_pct: 40 };
  const rej = goalConsensus(run, 1);
  assert.deepEqual([rej.settled, rej.accept, rej.match_pct], [true, false, 40]);
  b.result = { stage_ok: false, reason: 'transport' };
  const rf = goalConsensus(run, 1);
  assert.deepEqual([rf.routing_failure, rf.settled, rf.accept], [true, false, false]);
});

test('nextRepairIndex counts repair nodes', () => {
  assert.equal(nextRepairIndex({ nodes: [node('a', 'plan')] }), 1);
  assert.equal(nextRepairIndex({ nodes: [node('repair:1', 'repair')] }), 2);
});

test('openRepair: repair follows the rejecting round by `after`, a fresh round gates it, the report moves behind it', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'graph-goalgate-'));
  try {
    const run = { run_id: 'rr', cwd, max_retries: 2, nodes: [node('gate:U1:1', 'gate', [], { subgoal_id: 'U1' })] };
    pushGoalGateRound(run, ['gate:U1:1'], {}, 1);
    run.nodes.push(node('report', 'report', [], { after: ['gate:goal:1'] }));
    getNode(run, 'gate:goal:1').state = 'failed';
    const out = openRepair(run, 1, 'fix the seam', 2);
    assert.deepEqual([out.attempt, out.repair_id, out.gate_ids], [1, 'repair:1', ['gate:goal:2', 'gate:goal:2b']]);
    const repair = getNode(run, 'repair:1');
    assert.deepEqual([repair.deps, repair.after, repair.feedback], [[], ['gate:goal:1'], 'fix the seam']);
    assert.deepEqual(getNode(run, 'gate:goal:2').deps, ['repair:1', 'gate:U1:1']);
    assert.deepEqual(getNode(run, 'report').after, ['gate:goal:2', 'gate:goal:2b']);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('openRepair: over budget it marks the rejecting judges final and opens nothing', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'graph-goalgate-'));
  try {
    const run = { run_id: 'rr', cwd, max_retries: 0, nodes: [] };
    pushGoalGateRound(run, [], {}, 1);
    getNode(run, 'gate:goal:1').state = 'failed';
    const out = openRepair(run, 1, 'x', 1);
    assert.deepEqual([out.attempt, out.reason], [null, 'repair budget exhausted']);
    assert.equal(getNode(run, 'gate:goal:1').final, true);
    assert.equal(run.nodes.length, 1);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});
