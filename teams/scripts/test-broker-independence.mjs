#!/usr/bin/env node
// broker-independence.mjs: author != reviewer, finishNode and the retry machinery it drives, the
// interruption checkpoint, and the submit adjudication - on real runs built by graph.mjs's
// createRun in scratch directories, through the module's own exports.
//
//   node --test teams/scripts/test-broker-independence.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRun, expandSubgoals, getNode, loadRun, normalizeSpec } from '../mcp/graph.mjs';
import {
  checkpointInterruption,
  computeSubmitResult,
  finishNode,
  repairBriefing,
  reviewIndependence,
  reviewerModel,
  submitResult,
  subgoalFeedback,
  writeHumanBriefing,
} from '../mcp/broker-independence.mjs';
import { brokerDir } from '../mcp/broker-vendors.mjs';

function scratch(fn, { git = false } = {}) {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'broker-independence-')));
  if (git) spawnSync('git', ['init', '-q'], { cwd });
  try { return fn(cwd); } finally { rmSync(cwd, { recursive: true, force: true }); }
}

// A run past plan/setgoal/critique, its one subgoal U1 expanded into implement/test/gate.
function packageRun(cwd, opts = {}) {
  const run = createRun({ cwd, request: 'r', flow: 'develop', vendor: 'self', ...opts });
  for (const id of ['plan', 'setgoal', 'critique']) { getNode(run, id).state = 'done'; getNode(run, id).result = { stage_ok: true }; }
  run.spec = normalizeSpec(run, { goal: 'g', acceptance: ['own'], subgoals: [{ id: 'U1', title: 't', acceptance: ['a'], deps: [] }] });
  expandSubgoals(run, run.spec.subgoals);
  return run;
}

// ---------- author != reviewer (pure, on hand-built runs) ----------

const docRun = (authorModel, extra = {}) => ({
  spec: { subgoals: [{ id: 'U1', kind: 'document' }] },
  native_models: ['opus', 'sonnet'],
  nodes: [
    { node_id: 'draft:U1:1', stage: 'draft', subgoal_id: 'U1', attempt: 1, executor: 'claude', model: authorModel, result: { stage_ok: true } },
    { node_id: 'review:U1:1', stage: 'review', subgoal_id: 'U1', attempt: 1 },
  ],
  ...extra,
});

test('reviewerModel leaves a non-review stage alone, and a reviewer on another model than the author', () => {
  const run = docRun('opus');
  assert.deepEqual(reviewerModel(run, { stage: 'gate' }, 'opus'), { model: 'opus', note: '' });
  assert.deepEqual(reviewerModel(run, run.nodes[1], 'sonnet'), { model: 'sonnet', note: '' });
});

test('reviewerModel swaps to a second declared native model when the draft was written on the chosen one, visibly', () => {
  const run = docRun('opus');
  assert.deepEqual(reviewerModel(run, run.nodes[1], 'opus'), { model: 'sonnet', note: '; opus wrote the draft, reviewing with sonnet instead' });
});

test('reviewerModel with no second native model degrades visibly rather than deadlocking', () => {
  const run = docRun('opus', { native_models: ['opus'] });
  const out = reviewerModel(run, run.nodes[1], 'opus');
  assert.equal(out.model, 'opus');
  assert.match(out.note, /not independent/);
});

test('reviewIndependence: review by a different identity is distinct; by the same non-self identity it throws', () => {
  const run = docRun('opus');
  const review = run.nodes[1];
  assert.deepEqual(reviewIndependence(run, review, 'codex', 'gpt'), { independence: 'distinct-identity', author: 'claude@opus', reviewer: 'codex@gpt' });
  assert.throws(() => reviewIndependence(run, review, 'claude', 'opus'), /review review:U1:1 is routed to claude@opus, which wrote draft:U1:1.*policy\.review/s);
});

test('reviewIndependence: self on either side is unverifiable; the same host routed to self is recorded, not refused', () => {
  const run = docRun('opus');
  assert.equal(reviewIndependence(run, run.nodes[1], 'self', 'opus').independence, 'unverifiable-self');
  run.nodes[0].executor = 'self';
  assert.equal(reviewIndependence(run, run.nodes[1], 'claude', 'opus').independence, 'unverifiable-self');
  run.nodes[0].executor = 'claude';
  const sameHost = { ...run.nodes[1], assignment: { vendor: 'self' } };
  // same identity, but the node was assigned to self: degrade visibly
  assert.equal(reviewIndependence(run, sameHost, 'claude', 'opus').independence, 'unverifiable-same-host');
});

test('reviewIndependence: not a review/revise/audit stage, or an author with no result yet, is null', () => {
  const run = docRun('opus');
  assert.equal(reviewIndependence(run, { stage: 'gate' }, 'claude', 'opus'), null);
  run.nodes[0].result = null;
  assert.equal(reviewIndependence(run, run.nodes[1], 'claude', 'opus'), null);
});

test('reviewIndependence audit: independent of every external author, recorded and never thrown', () => {
  const audit = { stage: 'audit', node_id: 'audit:1' };
  assert.equal(reviewIndependence({}, audit, 'claude', 'opus'), null, 'no external author, nothing to compare');
  const one = { external_author: { executor: 'claude', model: 'opus' } };
  assert.deepEqual(reviewIndependence(one, audit, 'codex', 'gpt'), { independence: 'distinct-identity', author: 'claude@opus', reviewer: 'codex@gpt' });
  assert.equal(reviewIndependence(one, audit, 'claude', 'opus').independence, 'unverifiable-same-host');
  assert.equal(reviewIndependence(one, audit, 'self', 'opus').independence, 'unverifiable-self');
  const many = { external_author: [{ executor: 'claude', model: 'opus' }, { vendor: 'codex', model: 'gpt' }] };
  assert.deepEqual(reviewIndependence(many, audit, 'gemini', 'x').author, ['claude@opus', 'codex@gpt']);
  assert.equal(reviewIndependence(many, audit, 'codex', 'gpt').independence, 'unverifiable-same-host');
});

// ---------- feedback and repair briefing ----------

test('subgoalFeedback carries what judged the attempt last, plus a rejected goal gate; a denied tool is no feedback', () => {
  const run = { nodes: [
    { node_id: 'test:U1:1', stage: 'test', subgoal_id: 'U1', state: 'failed', result: { reason: 'tests red', verified: false, checks: ['npm test: 2 failing'] } },
    { node_id: 'gate:goal:1', stage: 'gate', subgoal_id: null, state: 'failed', result: { reason: 'seams', gaps: ['no README'] } },
  ] };
  assert.equal(subgoalFeedback(run, 'U1'), 'tests red\n- npm test: 2 failing\n- goal gate gate:goal:1: seams\n- no README');
  run.nodes[0].result = { blocked: 'tool denied', reason: 'x' };
  run.nodes[1].final = true;
  assert.equal(subgoalFeedback(run, 'U1'), '');
});

test('repairBriefing lists the round\'s gaps and spec drift and cuts a long handoff at 1500 characters, saying so', () => {
  const run = {
    spec: { subgoals: [{ id: 'U1', title: 'one' }, { id: 'U2', title: 'two' }] },
    nodes: [
      { node_id: 'gate:U1:1', stage: 'gate', subgoal_id: 'U1', result: { handoff: 'h'.repeat(1600) } },
      { node_id: 'gate:U2:1', stage: 'gate', subgoal_id: 'U2', result: {} },
    ],
  };
  const text = repairBriefing(run, { round: 2, gaps: ['g1', 'g2'], spec_drift: ['d1'] });
  assert.match(text, /^goal gate round 2 rejected the assembled result/);
  assert.match(text, /Gaps \(union across judges\):\n- g1\n- g2/);
  assert.match(text, /Spec drift .*:\n- d1/);
  assert.match(text, /Subgoal U1 \(one\) handoff: h{1500} …\[truncated at 1500 chars\]/);
  assert.match(text, /Subgoal U2 \(two\) handoff: \(none recorded\)/);
  assert.doesNotMatch(repairBriefing(run, { round: 1, gaps: [], spec_drift: [] }), /Gaps|Spec drift/);
});

// ---------- finishNode ----------

test('finishNode: a passing node is done, stamped, saved to disk and in the ledger; the reply is its verdict', () => scratch((cwd) => {
  const run = packageRun(cwd);
  const n = getNode(run, 'implement:U1:1');
  const out = finishNode(run, n, { stage_ok: true, changed_files_verified: true, change_attribution: 'isolated' }, 'claude');
  assert.equal(n.state, 'done');
  assert.equal(n.vendor, 'claude');
  assert.equal(typeof n.finished_at, 'number');
  assert.equal(out.node_id, 'implement:U1:1');
  assert.equal(out.stage_ok, true);
  assert.equal(getNode(loadRun(cwd, run.run_id), 'implement:U1:1').state, 'done', 'persisted');
  const events = readFileSync(join(brokerDir(cwd), 'ledger.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(events.at(-1), { ...events.at(-1), event: 'node_finish', node_id: 'implement:U1:1', vendor: 'claude', stage_ok: true });
}));

test('finishNode: blocked: tool denied drops any verdict that rode along and fails the node', () => scratch((cwd) => {
  const run = packageRun(cwd);
  const n = getNode(run, 'implement:U1:1');
  finishNode(run, n, { blocked: 'tool denied', stage_ok: true, accept: true, match_pct: 99, gaps: [] }, 'claude');
  assert.equal(n.state, 'failed');
  assert.equal(n.result.reason, 'blocked: tool denied');
  assert.equal(n.result.stage_ok, false);
  assert.equal(n.result.accept, undefined);
  assert.equal(n.result.match_pct, undefined);
}));

test('finishNode: an author that says stage_ok:false with no reason and no failing check has mis-set a flag; the chain judges it', () => scratch((cwd) => {
  const run = packageRun(cwd);
  const n = getNode(run, 'implement:U1:1');
  finishNode(run, n, { stage_ok: false, checks: ['66 tests, 66 pass, 0 fail'] }, 'claude');
  assert.equal(n.state, 'done');
  assert.equal(n.result.stage_ok, true);
  assert.equal(n.result.self_reported_stage_ok, false);
  assert.match(n.result.stage_ok_note, /the test and gate nodes judge the work/);

  const run2 = packageRun(cwd);
  const m = getNode(run2, 'implement:U1:1');
  finishNode(run2, m, { stage_ok: false, checks: ['npm test: 2 failed'] }, 'claude');
  assert.equal(m.state, 'failed', 'a failing check is honoured');
  assert.equal(m.result.stage_ok, false);
}));

test('finishNode: a gate that accepts with no checks failed at judging, and reads that way', () => scratch((cwd) => {
  const run = packageRun(cwd);
  const g = getNode(run, 'gate:U1:1');
  finishNode(run, g, { stage_ok: true, accept: true, checks: [] }, 'claude');
  assert.equal(g.state, 'failed');
  assert.equal(g.result.stage_ok, false);
  assert.match(g.result.reason, /gate accepted without a check/);
}));

test('finishNode: a rejected test reassigns the subgoal itself (attempt 2), with a synthesized reason', () => scratch((cwd) => {
  const run = packageRun(cwd);
  getNode(run, 'implement:U1:1').state = 'done';
  const t = getNode(run, 'test:U1:1');
  const out = finishNode(run, t, { stage_ok: true, verified: false, checks: ['npm test: 3 failed'] }, 'claude');
  assert.equal(t.state, 'failed');
  assert.ok(t.result.reason, 'verified:false with no reason gets one synthesized');
  assert.deepEqual(out.reassigned, { target: 'subgoal', subgoal_id: 'U1', attempt: 2 });
  assert.ok(getNode(run, 'implement:U1:2'), 'the next attempt is in the graph');
  assert.ok(getNode(loadRun(cwd, run.run_id), 'implement:U1:2'), 'and saved with the rejection');
}));

test('finishNode: auto_reassign:false leaves the next attempt to team_retry', () => scratch((cwd) => {
  const run = packageRun(cwd, { auto_reassign: false });
  getNode(run, 'implement:U1:1').state = 'done';
  const out = finishNode(run, getNode(run, 'test:U1:1'), { stage_ok: true, verified: false, checks: ['x'] }, 'claude');
  assert.equal(out.reassigned, undefined);
  assert.ok(!getNode(run, 'implement:U1:2'), 'no attempt 2 in the graph');
}));

test('finishNode: plan on an auto run records the flow it chose and its size; an unknown flow falls to develop (defaulted)', () => scratch((cwd) => {
  const run = createRun({ cwd, request: 'r', flow: 'auto', vendor: 'self' });
  finishNode(run, getNode(run, 'plan'), { stage_ok: true, flow: 'document', size: 'S' }, 'claude');
  assert.equal(run.flow_chosen, 'document');
  assert.equal(run.flow_source, 'plan');
  assert.equal(run.size, 'S');
  const run2 = createRun({ cwd, request: 'r', flow: 'auto', vendor: 'self' });
  finishNode(run2, getNode(run2, 'plan'), { stage_ok: true, flow: 'nonsense', size: 'XL' }, 'claude');
  assert.equal(run2.flow_chosen, 'develop');
  assert.equal(run2.flow_source, 'default');
  assert.equal(run2.size, null);
}));

test('finishNode: setgoal expands a valid spec into subgoal chains and fails an unusable one with its defects as the reason', () => scratch((cwd) => {
  const run = createRun({ cwd, request: 'r', flow: 'develop', vendor: 'self' });
  getNode(run, 'plan').state = 'done';
  const spec = { goal: 'g', acceptance: ['own'], subgoals: [{ id: 'U1', title: 't', acceptance: ['a'], deps: [] }] };
  finishNode(run, getNode(run, 'setgoal'), { stage_ok: true, spec }, 'claude');
  assert.equal(getNode(run, 'setgoal').state, 'done');
  assert.ok(getNode(run, 'implement:U1:1'), 'expanded');

  const bad = createRun({ cwd, request: 'r', flow: 'develop', vendor: 'self' });
  getNode(bad, 'plan').state = 'done';
  const sg = getNode(bad, 'setgoal');
  finishNode(bad, sg, { stage_ok: true, spec: { goal: 'g', subgoals: [] } }, 'claude');
  assert.equal(sg.state, 'failed');
  assert.ok(sg.result.spec_problems.length > 0);
  assert.match(sg.result.reason, /^unusable spec: /);
}));

// ---------- checkpointInterruption ----------

test('checkpointInterruption parks the node pending with a checkpoint on disk, and a quota drops the vendor for the run', () => scratch((cwd) => {
  const run = packageRun(cwd);
  const n = getNode(run, 'implement:U1:1');
  n.state = 'running';
  n.ticket = 'tk';
  n.assignment = { vendor: 'claude' };
  const out = checkpointInterruption(run, n, 'claude', { transport: { status: 1 } }, 'quota');
  assert.equal(out.recoverable, true);
  assert.ok(existsSync(out.checkpoint_path));
  const cp = JSON.parse(readFileSync(out.checkpoint_path, 'utf8'));
  assert.deepEqual([cp.node_id, cp.executor, cp.kind, cp.cwd], ['implement:U1:1', 'claude', 'quota', cwd]);
  assert.deepEqual(JSON.parse(readFileSync(cp.detail_path, 'utf8')), { transport: { status: 1 } });
  assert.equal(n.state, 'pending');
  assert.equal(n.ticket, null);
  assert.equal(n.assignment, undefined);
  assert.equal(n.recovery.kind, 'quota');
  assert.equal(n.interruptions.length, 1);
  assert.match(n.result.reason, /^claude quota; work retained at /);
  assert.equal(run.unavailable_vendors.claude, 'usage capacity exhausted in this run');
  assert.match(out.next, /team_retry with node_id and reset_capacity/);
}));

test('checkpointInterruption for a malformed envelope retains the work but does not take the vendor away', () => scratch((cwd) => {
  const run = packageRun(cwd);
  const n = getNode(run, 'implement:U1:1');
  checkpointInterruption(run, n, 'claude', {}, 'malformed');
  assert.equal(n.recovery.kind, 'malformed');
  assert.deepEqual(run.unavailable_vendors, {});
}));

// ---------- submit adjudication ----------

test('computeSubmitResult: a reasoning node\'s payload passes through with stage_ok defaulting to true; nothing is written', () => scratch((cwd) => {
  const run = packageRun(cwd);
  const critique = getNode(run, 'critique');
  const { result, done } = computeSubmitResult(run, critique, { sound: true }, 'self');
  assert.deepEqual(result, { sound: true, stage_ok: true });
  assert.equal(done, true);
  assert.equal(computeSubmitResult(run, critique, { sound: false }, 'self').done, false);
  assert.equal(critique.state, 'done', 'pure: the node object is not transitioned (it was done already, and still is)');
}));

test('computeSubmitResult: a mutating node is cross-checked against the worktree and its own stage_ok can only be lowered', () => scratch((cwd) => {
  const run = packageRun(cwd);
  const n = getNode(run, 'implement:U1:1');
  writeFileSync(join(cwd, 'real.txt'), 'x');
  const honest = computeSubmitResult(run, n, { stage_ok: true, changed_files: ['real.txt'] }, 'self');
  assert.equal(honest.result.stage_ok, true);
  assert.equal(honest.result.submitted_stage_ok, true);
  assert.equal(honest.result.change_attribution, 'shared-worktree');
  assert.equal(honest.done, true);
  const liar = computeSubmitResult(run, n, { stage_ok: true, changed_files: ['ghost.txt'] }, 'self');
  assert.equal(liar.result.stage_ok, false);
  assert.equal(liar.result.submitted_stage_ok, true, 'the caller\'s claim is kept so the overrule is visible');
  assert.match(liar.result.verification_error, /claimed changed_files not present in the worktree: ghost\.txt/);
  assert.equal(liar.done, false);
  assert.equal(computeSubmitResult(run, n, { stage_ok: false, changed_files: ['real.txt'] }, 'self').result.stage_ok, false, 'never raised');
}, { git: true }));

test('submitResult is computeSubmitResult plus finishNode: the node ends done and persisted', () => scratch((cwd) => {
  const run = packageRun(cwd);
  const n = getNode(run, 'implement:U1:1');
  writeFileSync(join(cwd, 'real.txt'), 'x');
  const out = submitResult(run, n, { stage_ok: true, changed_files: ['real.txt'] }, 'human');
  assert.equal(n.state, 'done');
  assert.equal(n.vendor, 'human');
  assert.equal(out.stage_ok, true);
  assert.equal(getNode(loadRun(cwd, run.run_id), 'implement:U1:1').state, 'done');
}, { git: true }));

// ---------- the card a person reads ----------

test('writeHumanBriefing writes the node\'s briefing under the broker dir and records its path; a failure is swallowed', () => scratch((cwd) => {
  const run = packageRun(cwd);
  const n = getNode(run, 'implement:U1:1');
  writeHumanBriefing(run, n);
  assert.equal(n.briefing_path, join(brokerDir(cwd), run.run_id, 'briefings', 'implement_U1_1.md'));
  assert.ok(readFileSync(n.briefing_path, 'utf8').length > 0);
  const broken = { ...run, cwd: join(cwd, 'no', 'such', 'file') };
  writeFileSync(join(cwd, 'no'), 'a file where a directory is needed');
  const m = getNode(run, 'implement:U1:1');
  delete m.briefing_path;
  assert.doesNotThrow(() => writeHumanBriefing(broken, m));
  assert.equal(m.briefing_path, undefined);
}));
