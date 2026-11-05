// graph-retry.mjs: settled failure, report retry, subgoal retry (incl. rollback target) and spec retry.
//   node --test teams/scripts/test-graph-retry.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { settleFailure, retryReport, retrySubgoal, retrySpec } from '../mcp/graph-retry.mjs';
import { expandSubgoals } from '../mcp/graph-expand.mjs';
import { createRun, getNode } from '../mcp/graph-nodes.mjs';
import { goalGateSiblings } from '../mcp/graph-goalgate.mjs';

const withRun = (opts, specSubgoals, fn) => {
  const cwd = mkdtempSync(join(tmpdir(), 'graph-retry-'));
  try {
    const run = createRun({ cwd, request: 'r', ...opts });
    run.spec = { goal: 'g', acceptance: ['a'], subgoals: specSubgoals };
    expandSubgoals(run, specSubgoals);
    return fn(run);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
};
const fail = (n, result = { stage_ok: false, reason: 'no' }) => { n.state = 'failed'; n.result = result; };

test('settleFailure: only a failed root; downstream data deps become unreachable, `after` edges do not propagate', () => {
  withRun({}, [{ id: 'U1' }], (run) => {
    assert.deepEqual(settleFailure(run, getNode(run, 'implement:U1:1')), [], 'a pending node is not a failure');
    assert.deepEqual(settleFailure(run, null), []);
    const impl = getNode(run, 'implement:U1:1');
    fail(impl);
    const touched = settleFailure(run, impl);
    assert.equal(impl.final, true);
    assert.deepEqual(touched, ['test:U1:1', 'gate:U1:1', 'gate:goal:1']);
    assert.equal(getNode(run, 'gate:goal:1').state, 'unreachable');
    assert.match(getNode(run, 'test:U1:1').result.reason, /implement:U1:1 failed with no retry left/);
    assert.match(getNode(run, 'gate:U1:1').result.reason, /test:U1:1 is unreachable/);
    assert.equal(getNode(run, 'report').state, 'pending', 'the report hangs off `after` and is left to run');
  });
});

test('settleFailure: a downstream node that already failed is made final too', () => {
  withRun({}, [{ id: 'U1' }], (run) => {
    const impl = getNode(run, 'implement:U1:1');
    const test_ = getNode(run, 'test:U1:1');
    fail(impl); fail(test_);
    settleFailure(run, impl);
    assert.equal(test_.final, true);
  });
});

test('retryReport: refuses anything but a failed report; re-pends one with feedback, spends report_attempts, then settles', () => {
  withRun({ max_retries: 1 }, [{ id: 'U1' }], (run) => {
    assert.equal(retryReport(run, 'f').refused, true, 'no failed report yet');
    assert.equal(retryReport(run, 'f', { node_id: 'plan' }).reason, 'node_id must identify a failed report node');
    const rep = getNode(run, 'report');
    fail(rep, { stage_ok: false, reason: 'boom', gaps: ['g1'] });
    rep.executor = 'claude'; rep.model = 'm';
    const r1 = retryReport(run, 'try again', { different_vendor: true, avoid_executors: ['codex'] });
    assert.deepEqual([r1.attempt, r1.node_id], [1, 'report']);
    assert.deepEqual([rep.state, rep.result, rep.reopened, rep.report_attempts], ['pending', null, 1, 1]);
    assert.equal(rep.feedback, 'try again\n- boom\n- g1');
    assert.deepEqual(rep.avoid_executors, ['codex', 'claude']);
    assert.ok(!('executor' in rep) && !('model' in rep));
    fail(rep); retryReport(run, 'again');
    fail(rep);
    const over = retryReport(run, 'again');
    assert.deepEqual([over.attempt, over.reason], [null, 'retry budget exhausted']);
    assert.equal(rep.final, true);
  });
});

test('retrySubgoal: a fresh attempt hangs off the same upstream; the old gate\'s dependents move to the new gate', () => {
  withRun({ goal_judges: 1 }, [{ id: 'U1' }, { id: 'U2' }], (run) => {
    fail(getNode(run, 'gate:U1:1'));
    getNode(run, 'test:U1:1').state = 'done';
    const out = retrySubgoal(run, 'U1', 'fix it');
    assert.equal(out.attempt, 2);
    assert.equal(out.rollback, null);
    assert.deepEqual(getNode(run, 'implement:U1:2').deps, ['critique']);
    assert.equal(getNode(run, 'implement:U1:2').feedback, 'fix it');
    assert.deepEqual(getNode(run, 'reduce').deps, ['gate:U1:2', 'gate:U2:1'], 'the fold follows the new gate');
    assert.ok(getNode(run, 'gate:goal:1').after.includes('gate:U1:2'));
  });
});

test('retrySubgoal: supersedes the pending nodes of the previous attempt and re-pends a fold that already ran', () => {
  withRun({}, [{ id: 'U1' }, { id: 'U2' }], (run) => {
    getNode(run, 'implement:U1:1').state = 'done';
    fail(getNode(run, 'test:U1:1'));
    const reduce = getNode(run, 'reduce');
    reduce.state = 'done'; reduce.result = { stage_ok: true };
    retrySubgoal(run, 'U1', 'f');
    assert.equal(getNode(run, 'gate:U1:1').state, 'skipped');
    assert.match(getNode(run, 'gate:U1:1').result.reason, /superseded by attempt 2/);
    assert.deepEqual([reduce.state, reduce.result, reduce.reopened], ['pending', null, 1]);
  });
});

test('retrySubgoal: a rejected goal-gate round is replaced by a fresh round behind which the report waits', () => {
  withRun({}, [{ id: 'U1' }], (run) => {
    for (const id of ['implement:U1:1', 'test:U1:1']) getNode(run, id).state = 'done';
    fail(getNode(run, 'gate:U1:1'));
    const goal = getNode(run, 'gate:goal:1');
    fail(goal, { stage_ok: true, reason: 'seam', gaps: ['gap'] });
    retrySubgoal(run, 'U1', 'f');
    const fresh = goalGateSiblings(run, 2);
    assert.equal(fresh.length, 1);
    assert.deepEqual(fresh[0].supersedes, ['gate:goal:1']);
    assert.equal(fresh[0].feedback, 'seam\n- gap');
    assert.deepEqual(getNode(run, 'report').after, ['gate:goal:2']);
  });
});

test('retrySubgoal: budget gone settles the failure; rollback names the first attempt\'s checkpoint for a sole subgoal', () => {
  withRun({ max_retries: 0 }, [{ id: 'U1' }], (run) => {
    fail(getNode(run, 'implement:U1:1'));
    const out = retrySubgoal(run, 'U1', 'f');
    assert.deepEqual([out.attempt, out.reason], [null, 'retry budget exhausted']);
    assert.ok(out.unreachable.includes('test:U1:1'));
  });
  withRun({ retry_policy: 'rollback' }, [{ id: 'U1' }], (run) => {
    assert.match(retrySubgoal(run, 'U1', 'f').rollback.reason, /no checkpoint was recorded/);
    getNode(run, 'implement:U1:1').checkpoint = 'abc123';
    assert.deepEqual(retrySubgoal(run, 'U1', 'f').rollback, { checkpoint: 'abc123', node_id: 'implement:U1:1' });
  });
  withRun({ retry_policy: 'rollback' }, [{ id: 'U1' }, { id: 'U2' }], (run) => {
    assert.match(retrySubgoal(run, 'U1', 'f').rollback.reason, /2 subgoals sharing one worktree/);
  });
});

test('retrySpec: retires the subgoal graph, clears the spec, opens setgoal:N and critique:N', () => {
  withRun({}, [{ id: 'U1' }], (run) => {
    getNode(run, 'implement:U1:1').state = 'running';
    const out = retrySpec(run, 'the spec was wrong');
    assert.equal(out.attempt, 2);
    assert.equal(run.spec, null);
    assert.equal(getNode(run, 'test:U1:1').state, 'skipped');
    assert.equal(getNode(run, 'implement:U1:1').state, 'running', 'running work is evidence, not retired');
    assert.match(getNode(run, 'report').result.reason, /superseded by spec attempt 2/);
    assert.deepEqual([getNode(run, 'setgoal:2').deps, getNode(run, 'setgoal:2').feedback, getNode(run, 'critique:2').deps], [['plan'], 'the spec was wrong', ['setgoal:2']]);
  });
});

test('retrySpec: over budget returns no attempt and settles the dead setgoal / critique', () => {
  withRun({ max_retries: 0 }, [{ id: 'U1' }], (run) => {
    fail(getNode(run, 'critique'));
    const out = retrySpec(run, 'f');
    assert.deepEqual([out.attempt, out.reason], [null, 'retry budget exhausted']);
    assert.equal(getNode(run, 'critique').final, true);
  });
});
