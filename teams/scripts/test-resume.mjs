#!/usr/bin/env node
// blockedNode and stopNotice (card 129 item 7): pure reads of a task graph.
//
//   node --test teams/scripts/test-resume.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blockedNode, stopNotice } from '../mcp/resume.mjs';

const n = (id, stage, state, extra = {}) => ({ node_id: id, stage, deps: [], after: [], state, attempt: 1, result: null, ...extra });
const fail = { stage_ok: false, reason: 'rejected' };
const task = (...nodes) => ({ run_id: 'r1', nodes });

test('blockedNode: a failed dispatch is the package route', () => {
  const t = task(n('critique', 'critique', 'done'), n('dispatch:P1:1', 'dispatch', 'failed', { subgoal_id: 'P1', result: fail }), n('accept:P1:1', 'accept', 'pending', { subgoal_id: 'P1' }));
  const b = blockedNode(t);
  assert.equal(b.node.node_id, 'dispatch:P1:1');
  assert.equal(b.route, 'package');
});

test('blockedNode: a failed accept is the package route (also a PLAN package)', () => {
  const t = task(n('dispatch:PLAN:1', 'dispatch', 'done', { subgoal_id: 'PLAN' }), n('accept:PLAN:1', 'accept', 'failed', { subgoal_id: 'PLAN', result: fail }));
  const b = blockedNode(t);
  assert.deepEqual([b.node.node_id, b.route], ['accept:PLAN:1', 'package']);
});

test('blockedNode: a failed integrate is the repair route', () => {
  const b = blockedNode(task(n('integrate:1', 'integrate', 'failed', { result: fail })));
  assert.deepEqual([b.node.node_id, b.route], ['integrate:1', 'repair']);
});

test('blockedNode: an integrate a later integrate supersedes is ignored', () => {
  const t = task(n('integrate:1', 'integrate', 'failed', { result: fail }), n('integrate:2', 'integrate', 'done', { supersedes: 'integrate:1' }));
  assert.equal(blockedNode(t), null);
});

test('blockedNode: a failed shape or critique is the shape route', () => {
  assert.equal(blockedNode(task(n('shape:1', 'shape', 'done'), n('critique', 'critique', 'failed', { result: fail }))).route, 'shape');
  assert.equal(blockedNode(task(n('shape:1', 'shape', 'failed', { result: fail }))).route, 'shape');
});

test('blockedNode: a failed areas or areas-critique is the areas route', () => {
  assert.equal(blockedNode(task(n('areas', 'areas', 'failed', { result: fail }))).route, 'areas');
  assert.equal(blockedNode(task(n('areas-critique', 'areas-critique', 'failed', { result: fail }))).route, 'areas');
});

test('blockedNode: a superseded node is ignored', () => {
  const t = task(n('dispatch:P1:1', 'dispatch', 'failed', { subgoal_id: 'P1', result: { ...fail, superseded_by: 'dispatch:P1:2' } }));
  assert.equal(blockedNode(t), null);
});

test('blockedNode: a final failure is ignored', () => {
  assert.equal(blockedNode(task(n('dispatch:P1:3', 'dispatch', 'failed', { subgoal_id: 'P1', attempt: 3, final: true, result: fail }))), null);
});

test('blockedNode: a failure of an older attempt is ignored, the latest attempt wins', () => {
  const t = task(
    n('dispatch:P1:1', 'dispatch', 'failed', { subgoal_id: 'P1', attempt: 1, result: fail }),
    n('dispatch:P1:2', 'dispatch', 'running', { subgoal_id: 'P1', attempt: 2 }),
  );
  assert.equal(blockedNode(t), null);
  t.nodes[1].state = 'failed';
  t.nodes[1].result = fail;
  assert.equal(blockedNode(t).node.node_id, 'dispatch:P1:2');
});

test('blockedNode: the last failed node wins across subgoals', () => {
  const t = task(
    n('dispatch:P1:1', 'dispatch', 'failed', { subgoal_id: 'P1', result: fail }),
    n('dispatch:P2:1', 'dispatch', 'failed', { subgoal_id: 'P2', result: fail }),
  );
  assert.equal(blockedNode(t).node.node_id, 'dispatch:P2:1');
});

test('blockedNode: a running graph (nothing failed) -> null', () => {
  assert.equal(blockedNode(task(n('critique', 'critique', 'done'), n('dispatch:P1:1', 'dispatch', 'pending', { subgoal_id: 'P1' }))), null);
});

test('stopNotice: blocked -> a task_blocked notify with the blocked node', () => {
  const t = task(n('dispatch:P1:1', 'dispatch', 'failed', { subgoal_id: 'P1', result: fail }));
  assert.deepEqual(stopNotice(t, 'blocked', 'nothing can proceed'), { event: 'notify', kind: 'task_blocked', task_id: 'r1', reason: 'nothing can proceed', node_id: 'dispatch:P1:1' });
});

test('stopNotice: blocked with no failed node -> no node_id', () => {
  const e = stopNotice(task(n('dispatch:P1:1', 'dispatch', 'pending', { subgoal_id: 'P1' })), 'blocked');
  assert.equal(e.kind, 'task_blocked');
  assert.equal('node_id' in e, false);
});

test('stopNotice: waiting_human and running -> null', () => {
  const t = task(n('dispatch:P1:1', 'dispatch', 'failed', { subgoal_id: 'P1', result: fail }));
  assert.equal(stopNotice(t, 'waiting_human'), null);
  assert.equal(stopNotice(t, 'running'), null);
});
