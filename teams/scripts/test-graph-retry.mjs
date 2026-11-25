// graph-retry.mjs: settled failure, report retry, subgoal retry (incl. rollback target) and spec retry.
//   node --test teams/scripts/test-graph-retry.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stopRule, settleFailure, retryReport, retrySubgoal, retrySpec } from '../mcp/graph-retry.mjs';
import { expandSubgoals } from '../mcp/graph-expand.mjs';
import { createRun, getNode, node } from '../mcp/graph-nodes.mjs';
import { saveRun, loadRun } from '../mcp/graph-runfile.mjs';
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

// Local copy of the old decision: toolDenied / rejectionSig / priorSig / goalRejectionSig from
// teams/mcp/broker-independence.mjs (lines 144, 170-174, 177-182, 189-192) and the two
// comparisons in autoReassign (line 321) and autoReassignGoalGate (line 249).
const toolDenied = (result) => Boolean(result) && result.blocked === 'tool denied';
const rejectionSig = (result) => {
  if (!result || toolDenied(result)) return '';
  const gaps = [...(result.gaps || []), ...(result.blocking || [])].map((g) => String(g).trim().toLowerCase());
  return [String(result.reason || '').trim().toLowerCase(), ...gaps.sort()].filter(Boolean).join('|');
};
const priorSig = (run, sid, attempt) => {
  const prior = run.nodes.filter((x) => x.subgoal_id === sid && x.state === 'failed' && (x.attempt || 1) === attempt - 1 && x.result).pop();
  return prior ? rejectionSig(prior.result) : '';
};
const goalRejectionSig = (c) => [...(c.gaps || []), ...(c.spec_drift || [])].map((g) => String(g).trim().toLowerCase()).sort().join('|');

test('stopRule: subgoal stops at the third gate (F2-AC-14, max_retries=2), not the second', () => {
  withRun({ max_retries: 2 }, [{ id: 'U1' }], (run) => {
    assert.deepEqual(stopRule(run, { loop: 'subgoal', subgoal_id: 'U1' }), { stop: false });
    retrySubgoal(run, 'U1', 'f');
    assert.deepEqual(stopRule(run, { loop: 'subgoal', subgoal_id: 'U1' }), { stop: false }, 'two gates: one attempt left');
    retrySubgoal(run, 'U1', 'f');
    assert.deepEqual(stopRule(run, { loop: 'subgoal', subgoal_id: 'U1' }), { stop: true, reason: 'retry budget exhausted', action: 'settle' });
    assert.equal(retrySubgoal(run, 'U1', 'f').attempt, null);
  });
});

test('stopRule: spec stops at the third setgoal (F2-AC-14), not the second', () => {
  withRun({ max_retries: 2 }, [{ id: 'U1' }], (run) => {
    assert.equal(stopRule(run, { loop: 'spec' }).stop, false, 'one setgoal');
    run.nodes.push(node('setgoal:2', 'setgoal', []));
    assert.equal(stopRule(run, { loop: 'spec' }).stop, false);
    run.nodes.push(node('setgoal:3', 'setgoal', []));
    assert.deepEqual(stopRule(run, { loop: 'spec' }), { stop: true, reason: 'retry budget exhausted', action: 'settle' });
  });
});

test('stopRule: report stops at report_attempts 3 (F2-AC-14), not 2; no failed report never stops', () => {
  withRun({ max_retries: 2 }, [{ id: 'U1' }], (run) => {
    assert.equal(stopRule(run, { loop: 'report' }).stop, false, 'no failed report');
    const r = getNode(run, 'report');
    fail(r);
    r.report_attempts = 2;
    assert.equal(stopRule(run, { loop: 'report' }).stop, false);
    r.report_attempts = 3;
    assert.deepEqual(stopRule(run, { loop: 'report' }), { stop: true, reason: 'retry budget exhausted', action: 'settle' });
  });
});

test('stopRule: repair and goal_round share the repair bound and its reason; an unknown loop never stops', () => {
  const run = { max_retries: 2, nodes: [node('repair:1', 'repair')] };
  assert.equal(stopRule(run, { loop: 'repair' }).stop, false);
  assert.equal(stopRule(run, { loop: 'goal_round' }).stop, false);
  run.nodes.push(node('repair:2', 'repair'));
  for (const loop of ['repair', 'goal_round']) {
    assert.deepEqual(stopRule(run, { loop }), { stop: true, reason: 'repair budget exhausted', action: 'settle' });
  }
  assert.deepEqual(stopRule(run, { loop: 'nope' }), { stop: false });
});

test('stopRule F2-AC-12: same signature wins over a spent count on subgoal; stalled wins over a spent repair bound', () => {
  withRun({ max_retries: 0 }, [{ id: 'U1' }], (run) => {
    assert.equal(stopRule(run, { loop: 'subgoal', subgoal_id: 'U1' }).reason, 'retry budget exhausted', 'count alone is spent here');
    assert.deepEqual(stopRule(run, { loop: 'subgoal', subgoal_id: 'U1', sig: 'x', prior_sig: 'x' }), { stop: true, reason: 'same signature', action: 'escalate' });
    assert.equal(stopRule(run, { loop: 'subgoal', subgoal_id: 'U1', sig: '', prior_sig: '' }).reason, 'retry budget exhausted', 'empty never matches');
    assert.equal(stopRule(run, { loop: 'subgoal', subgoal_id: 'U1', sig: 'x', prior_sig: 'y' }).reason, 'retry budget exhausted');
  });
  const run = { max_retries: 0, nodes: [], last_goal_sig: 'g' };
  assert.equal(stopRule(run, { loop: 'goal_round', sig: 'h' }).reason, 'repair budget exhausted');
  assert.deepEqual(stopRule(run, { loop: 'goal_round', sig: 'g' }), { stop: true, reason: 'stalled', action: 'settle' });
  assert.equal(stopRule(run, { loop: 'goal_round', sig: '' }).reason, 'repair budget exhausted', 'empty never matches');
  run.last_goal_sig = '';
  assert.equal(stopRule(run, { loop: 'goal_round', sig: '' }).reason, 'repair budget exhausted', 'empty equal empty is no match');
});

test('stopRule F2-AC-13: helper decision equals the old signature decision, toolDenied => empty', () => {
  const results = [
    { reason: 'Bad', gaps: ['B', 'a'] }, { reason: ' bad ', gaps: ['a', 'b'] }, { reason: 'other' },
    { reason: 'Bad', blocked: 'tool denied' }, { blocking: ['x'] }, {}, null,
  ];
  for (const a of results) for (const b of results) {
    withRun({ max_retries: 5 }, [{ id: 'U1' }], (run) => {
      const prior = getNode(run, 'gate:U1:1');
      prior.state = 'failed';
      prior.result = b;
      const sig = rejectionSig(a);
      const pSig = priorSig(run, 'U1', 2);
      const got = stopRule(run, { loop: 'subgoal', subgoal_id: 'U1', sig, prior_sig: pSig });
      assert.equal(got.stop && got.action === 'escalate', Boolean(sig) && sig === pSig, JSON.stringify([a, b]));
    });
  }
  assert.equal(rejectionSig(results[3]), '', 'toolDenied => empty signature');
  const cons = [{ gaps: ['A'], spec_drift: ['b'] }, { gaps: ['b', 'a'] }, { gaps: [] }, {}];
  for (const c of cons) for (const last of ['', ...cons.map(goalRejectionSig)]) {
    const sig = goalRejectionSig(c);
    const got = stopRule({ max_retries: 5, nodes: [], last_goal_sig: last }, { loop: 'goal_round', sig });
    assert.equal(got.stop && got.reason === 'stalled', Boolean(sig) && sig === last, JSON.stringify([c, last]));
  }
});

test('F2-AC-15: settleFailure over an order-only edge settles nothing downstream', () => {
  const run = { nodes: [node('a', 'implement'), node('b', 'test', [], { after: ['a'] })] };
  fail(run.nodes[0]);
  assert.deepEqual(settleFailure(run, run.nodes[0]), []);
  assert.equal(run.nodes[1].state, 'pending');
  assert.equal(run.nodes[0].final, true);
});

test('F2-AC-20: retrySubgoal leaves the old head and pushes a fresh pending head with a new node id', () => {
  withRun({ max_retries: 2 }, [{ id: 'U1' }], (run) => {
    const old = getNode(run, 'implement:U1:1');
    fail(old);
    const out = retrySubgoal(run, 'U1', 'f');
    assert.equal(out.attempt, 2);
    const head = getNode(run, 'implement:U1:2');
    assert.ok(head && head.node_id !== old.node_id);
    assert.equal(head.state, 'pending');
    assert.equal(old.state, 'failed', 'the old attempt stays as evidence');
  });
});

test('stopRule does not mutate run', () => {
  withRun({ max_retries: 0 }, [{ id: 'U1' }], (run) => {
    const before = JSON.parse(JSON.stringify(run));
    for (const loop of ['subgoal', 'spec', 'report', 'repair', 'goal_round']) stopRule(run, { loop, subgoal_id: 'U1', sig: 's', prior_sig: 's' });
    assert.deepEqual(run, before);
  });
});

// F2-US-4: spec-escalation carry-over of a passed sibling.
const passSubgoal = (run, sid) => run.nodes.filter((n) => n.subgoal_id === sid).forEach((n) => { n.state = 'done'; n.result = { stage_ok: true }; });
const respec = (run, specSubgoals) => {
  retrySpec(run, 'fb');
  run.spec = { goal: 'g', acceptance: ['a'], subgoals: specSubgoals };
  const before = run.nodes.length;
  expandSubgoals(run, specSubgoals);
  return run.nodes.slice(before);
};
const twoSpec = () => [{ id: 'U1', acceptance: ['x', 'y'] }, { id: 'U2', deps: ['U1'] }];

test('F2-AC-17: a passed sibling kept as it was gets no new nodes, keeps its done nodes and gate result', () => {
  withRun({}, twoSpec(), (run) => {
    passSubgoal(run, 'U1');
    getNode(run, 'gate:U1:1').result = { stage_ok: true, mark: 'kept' };
    const pushed = respec(run, twoSpec());
    assert.ok(pushed.every((n) => n.subgoal_id !== 'U1'), 'no node for the carried sibling');
    assert.equal(pushed.filter((n) => n.subgoal_id === 'U2').length, 3);
    assert.equal(pushed.length, 6, 'U2 chain, reduce, goal gate, report: 6 where a full rebuild pushes 9');
    assert.equal(run.nodes.filter((n) => n.subgoal_id === 'U1').length, 3);
    assert.ok(run.nodes.filter((n) => n.subgoal_id === 'U1').every((n) => n.state === 'done'));
    assert.equal(getNode(run, 'gate:U1:1').result.mark, 'kept');
    assert.deepEqual(run.carry, []);
  });
});

test('F2-AC-17: a rebuilt sibling that depends on the carried one waits on the carried gate', () => {
  withRun({}, twoSpec(), (run) => {
    passSubgoal(run, 'U1');
    respec(run, twoSpec());
    assert.deepEqual(getNode(run, 'implement:U2:2').deps, ['critique:2', 'gate:U1:1']);
  });
});

test('F2-AC-18: a changed id gives a full chain', () => {
  withRun({}, twoSpec(), (run) => {
    passSubgoal(run, 'U1');
    const pushed = respec(run, [{ id: 'U1b', acceptance: ['x', 'y'] }, { id: 'U2' }]);
    assert.equal(pushed.filter((n) => n.subgoal_id === 'U1b').length, 3);
  });
});

test('F2-AC-18: a changed kind gives a full chain', () => {
  withRun({}, twoSpec(), (run) => {
    passSubgoal(run, 'U1');
    const pushed = respec(run, [{ id: 'U1', kind: 'document', acceptance: ['x', 'y'] }, { id: 'U2' }]);
    assert.ok(pushed.filter((n) => n.subgoal_id === 'U1').length > 0);
    assert.ok(getNode(run, 'draft:U1:2'));
  });
});

test('F2-AC-18: a changed acceptance gives a full chain', () => {
  withRun({}, twoSpec(), (run) => {
    passSubgoal(run, 'U1');
    const pushed = respec(run, [{ id: 'U1', acceptance: ['x', 'z'] }, { id: 'U2' }]);
    assert.equal(pushed.filter((n) => n.subgoal_id === 'U1').length, 3);
  });
});

test('F2-AC-19: the carried gate feeds reduce and the new goal-gate round; goal gate and report are still pushed', () => {
  withRun({}, twoSpec(), (run) => {
    passSubgoal(run, 'U1');
    const pushed = respec(run, twoSpec());
    assert.deepEqual(pushed.find((n) => n.stage === 'reduce').deps, ['gate:U1:1', 'gate:U2:2']);
    const goal = pushed.find((n) => n.stage === 'gate' && n.subgoal_id === null);
    assert.ok(goal && goal.after.includes('gate:U1:1') && goal.after.includes('gate:U2:2'));
    assert.ok(pushed.some((n) => n.stage === 'report'));
  });
});

test('F2-AC-19: with every sibling carried the goal gate and report are still pushed', () => {
  withRun({}, [{ id: 'U1' }], (run) => {
    passSubgoal(run, 'U1');
    const pushed = respec(run, [{ id: 'U1' }]);
    assert.deepEqual(pushed.map((n) => n.stage), ['gate', 'report']);
    assert.deepEqual(pushed[0].deps, ['gate:U1:1']);
  });
});

test('carry cleared: durable through saveRun/loadRun, and a second escalation carries only what passed', () => {
  withRun({}, twoSpec(), (run) => {
    passSubgoal(run, 'U1');
    retrySpec(run, 'fb');
    assert.deepEqual(run.carry, [{ id: 'U1', kind: 'subgoal', acceptance: ['x', 'y'], gate: 'gate:U1:1' }]);
    run.spec = { goal: 'g', acceptance: ['a'], subgoals: twoSpec() };
    expandSubgoals(run, twoSpec());
    saveRun(run);
    assert.deepEqual(loadRun(run.cwd, run.run_id).carry, [], 'a deleted field would come back from disk');
    // U2 was rebuilt under the second spec and has not passed: only U1 is carried again.
    retrySpec(run, 'fb2');
    assert.deepEqual(run.carry.map((c) => c.id), ['U1']);
  });
});

test('a run with no carry expands exactly as before: same ids and deps, no carry field written', () => {
  withRun({}, twoSpec(), (run) => {
    assert.equal('carry' in run, false);
    assert.deepEqual(run.nodes.map((n) => [n.node_id, n.deps]).slice(3), [
      ['implement:U1:1', ['critique']], ['test:U1:1', ['implement:U1:1']], ['gate:U1:1', ['test:U1:1']],
      ['implement:U2:1', ['critique', 'gate:U1:1']], ['test:U2:1', ['implement:U2:1']], ['gate:U2:1', ['test:U2:1']],
      ['reduce', ['gate:U1:1', 'gate:U2:1']], ['gate:goal:1', ['reduce']], ['report', []],
    ]);
  });
});

test('retrySubgoal after a carry-over finds the rebuilt subgoal head and the carried gate', () => {
  withRun({}, twoSpec(), (run) => {
    passSubgoal(run, 'U1');
    respec(run, twoSpec());
    fail(getNode(run, 'implement:U2:2'));
    const r = retrySubgoal(run, 'U2', 'again');
    assert.equal(r.attempt, 3, 'gate:U2:1 (superseded) and gate:U2:2 came before');
    assert.deepEqual(getNode(run, 'implement:U2:3').deps, ['critique:2', 'gate:U1:1']);
  });
});
