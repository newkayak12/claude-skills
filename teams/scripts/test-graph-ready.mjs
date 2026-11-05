// graph-ready.mjs: what holds a node back, which nodes may run, and parking a human-pinned node.
//   node --test teams/scripts/test-graph-ready.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unmetDeps, readyNodes, promoteWaitingHuman } from '../mcp/graph-ready.mjs';
import { node } from '../mcp/graph-nodes.mjs';

const st = (n, state, extra = {}) => Object.assign(n, { state }, extra);

test('unmetDeps: a data dep must be done; an order-only dep must be settled (done, skipped, unreachable, or final-failed)', () => {
  const a = node('a', 'plan');
  const x = node('x', 'gate', ['a'], { after: ['b'] });
  const run = { nodes: [a, node('b', 'plan'), x] };
  assert.deepEqual(unmetDeps(run, x), ['a', 'b']);
  st(a, 'done');
  assert.deepEqual(unmetDeps(run, x), ['b']);
  for (const [state, final, holdsBack] of [['done', false, false], ['skipped', false, false], ['unreachable', false, false], ['failed', true, false], ['failed', false, true], ['running', false, true], ['pending', false, true]]) {
    st(run.nodes[1], state, { final });
    assert.equal(unmetDeps(run, x).length > 0, holdsBack, `${state}${final ? ' final' : ''}`);
  }
  assert.deepEqual(unmetDeps({ nodes: [] }, node('y', 'gate', [], { after: ['ghost'] })), ['ghost'], 'a missing order-only dep is unmet');
});

test('unmetDeps: a report also waits on any node still live, but not on a pending node that cannot start', () => {
  const impl = st(node('impl', 'implement'), 'running');
  const stuck = node('stuck', 'test', ['never']);
  const rep = node('report', 'report');
  const run = { nodes: [impl, stuck, rep] };
  assert.deepEqual(unmetDeps(run, rep), ['impl']);
  st(impl, 'done');
  assert.deepEqual(unmetDeps(run, rep), [], 'stuck is pending behind an unmet dep and is not waited on');
  st(stuck, 'waiting_human');
  assert.deepEqual(unmetDeps(run, rep), ['stuck']);
});

test('readyNodes: pending nodes with nothing unmet', () => {
  const run = { nodes: [st(node('a', 'plan'), 'done'), node('b', 'setgoal', ['a']), node('c', 'critique', ['b']), st(node('d', 'plan'), 'running')] };
  assert.deepEqual(readyNodes(run).map((n) => n.node_id), ['b']);
});

test('promoteWaitingHuman: parks a ready human-pinned node and leaves everything else alone', () => {
  const pinned = node('p', 'implement', [], { assignment: { executor: 'human' } });
  const blocked = node('q', 'implement', ['p'], { assignment: { executor: 'human' } });
  const ai = node('r', 'implement', [], { assignment: { executor: 'claude' } });
  const run = { nodes: [pinned, blocked, ai, node('s', 'implement')] };
  const touched = promoteWaitingHuman(run);
  assert.deepEqual(touched.map((n) => n.node_id), ['p']);
  assert.equal(pinned.state, 'waiting_human');
  assert.equal(typeof pinned.waiting_since, 'number');
  assert.deepEqual([blocked.state, ai.state, run.nodes[3].state], ['pending', 'pending', 'pending']);
  assert.deepEqual(promoteWaitingHuman(run), [], 'a parked node is not parked again');
  assert.deepEqual(readyNodes(run).map((n) => n.node_id), ['r', 's'], 'a parked node is never offered to a driver');
});
