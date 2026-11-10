#!/usr/bin/env node
// taskmanager-finish.mjs owns the verdicts: a node settling and the finish of a stage;
// taskmanager.mjs re-exports its public names unchanged.
//
//   node --test teams/scripts/test-taskmanager-finish.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as facade from '../mcp/taskmanager.mjs';
import * as mod from '../mcp/taskmanager-finish.mjs';

const OWNED = ['succeeded', 'scopeGaps', 'recordBaseExclusions', 'excludeBaseBeforeJudge', 'finish'];

test('every public name taskmanager-finish.mjs owns is the facade\'s own binding', () => {
  for (const name of OWNED) {
    assert.equal(typeof mod[name], 'function', `${name} is not exported by taskmanager-finish.mjs`);
    assert.equal(facade[name], mod[name], `${name} on the facade is not the module's binding`);
  }
});

test('__baseFail is one object: the facade and the module hand out the same one', () => {
  assert.equal(typeof mod.__baseFail, 'object');
  assert.equal(facade.__baseFail, mod.__baseFail);
});

test('succeeded: a node that did not finish its stage never succeeds; a stage without a verdict field does', () => {
  assert.equal(mod.succeeded({}, { stage: 'no-such-stage' }, { stage_ok: false }), false);
  assert.equal(mod.succeeded({}, { stage: 'no-such-stage' }, { stage_ok: true }), true);
});

test('scopeGaps leaves a result alone unless it is a finished accept node with out_of_scope gaps', () => {
  const result = { stage_ok: true, gaps: ['x'] };
  assert.equal(mod.scopeGaps({}, { stage: 'gate' }, result), result);
  assert.equal(mod.scopeGaps({}, { stage: 'accept' }, result), result);
});

// A failed report stage returns prose in handoff/evidence and no reason; finish() keeps the words
// (E-8faf33b9's report node reached the blocked report as "(no reason recorded)").
function finishNode(stage, result) {
  // finish() records to the ledger under the tasks root: keep it in scratch, not ~/.harness.
  process.env.HARNESS_TASKS_DIR = mkdtempSync(join(tmpdir(), 'finish-reason-'));
  const task = { run_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', cwd: mkdtempSync(join(tmpdir(), 'finish-cwd-')), nodes: [], team: { opts: {} } };
  const n = { node_id: stage, stage, state: 'running' };
  task.nodes.push(n);
  mod.finish(task, n, result);
  return n;
}

test('report reason: a failed report with no reason takes it from its evidence', () => {
  const n = finishNode('report', { stage_ok: false, handoff: 'Result: partial. Planning stopped at plan-integrate:3', evidence: 'F4 stories defined twice' });
  assert.equal(n.state, 'failed');
  assert.match(n.result.reason, /F4 stories defined twice/);
});

test('report reason: long evidence keeps the head of the handoff and the tail of the evidence within about 400 chars', () => {
  const evidence = `Node results: ${'x'.repeat(900)} The last failure is F4 stories defined twice`;
  const n = finishNode('report', { stage_ok: false, handoff: `Result: partial. Planning stopped at plan-integrate:3 ${'y'.repeat(900)}`, evidence });
  assert.ok(n.result.reason.length <= 420, `length ${n.result.reason.length}`);
  assert.match(n.result.reason, /F4 stories defined twice/);
  assert.match(n.result.reason, /Planning stopped/);
});

test('report reason: a report that already has a reason keeps it byte for byte', () => {
  const n = finishNode('report', { stage_ok: false, reason: 'own  reason ', handoff: 'h', evidence: 'e' });
  assert.equal(n.result.reason, 'own  reason ');
});

test('integrate: the persisted result carries files_changed per package at fold time', () => {
  process.env.HARNESS_TASKS_DIR = mkdtempSync(join(tmpdir(), 'finish-fold-'));
  const task = {
    run_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', cwd: mkdtempSync(join(tmpdir(), 'finish-cwd-')), team: { opts: {} },
    spec: { packages: [{ id: 'P1' }] },
    nodes: [{ stage: 'dispatch', subgoal_id: 'P1', node_id: 'dispatch:P1:1', attempt: 1, result: { changed_files: ['a.txt', 'b.txt'], accept: true } }],
  };
  const n = { node_id: 'integrate:1', stage: 'integrate', state: 'running', deps: [] };
  task.nodes.push(n);
  mod.finish(task, n, { stage_ok: true, verified: true, checks: ['build -> ok'], conflicts: [] });
  assert.equal(n.state, 'done');
  assert.deepEqual(n.result.package_fold.P1.files_changed, ['a.txt', 'b.txt']);
});

test('report reason: a failed node of another stage with no reason is unchanged', () => {
  const n = finishNode('implement', { stage_ok: false, handoff: 'h', evidence: 'e' });
  assert.equal(n.state, 'failed');
  assert.equal('reason' in n.result, false);
});
