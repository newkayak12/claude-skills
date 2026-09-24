import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankCandidates, selectModel, capacityFailure } from '../mcp/routing.mjs';
import { createRun, loadRun, saveRun } from '../mcp/graph.mjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

for (const host of ['claude', 'codex']) {
  test(`${host} drives reasoning and the other vendor handles execution`, () => {
    const run = { host_vendor: host, host_model: 'current-model', nodes: [] };
    const other = host === 'claude' ? 'codex' : 'claude';
    const hostDefault = host === 'claude' ? 'sonnet' : 'gpt-5.6-sol';
    const otherDefault = other === 'claude' ? 'sonnet' : 'gpt-5.6-sol';
    // Vendor preference (who does the work) is unaffected by which model tier a stage gets.
    for (const stage of ['plan', 'setgoal', 'critique', 'gate']) {
      assert.equal(rankCandidates(run, { stage }, ['claude', 'codex'])[0].vendor, host);
    }
    for (const stage of ['implement', 'test']) {
      assert.equal(rankCandidates(run, { stage }, ['claude', 'codex'])[0].vendor, other);
      assert.equal(selectModel(run, { stage }, 'claude'), 'sonnet');
      assert.equal(selectModel(run, { stage }, 'codex'), 'gpt-5.6-sol');
    }
    // The peer writes the run's account of itself, so the vendor that drove the run does
    // not get to be its own narrator - but report is judging work, not the decisive kind,
    // and takes the default tier like every judging stage except critique and the goal
    // gate. Measured: judging on the host's premium model was ~40% of a run's cost while
    // discriminating nothing.
    assert.equal(rankCandidates(run, { stage: 'report' }, ['claude', 'codex'])[0].vendor, other);
    assert.equal(selectModel(run, { stage: 'report' }, host), hostDefault);
    assert.equal(selectModel(run, { stage: 'report' }, other), otherDefault);
  });
}

test('only the two decisive judges - critique and the goal gate - inherit the host model', () => {
  for (const host of ['claude', 'codex']) {
    const run = { host_vendor: host, host_model: 'current-model' };
    const hostDefault = host === 'claude' ? 'sonnet' : 'gpt-5.6-sol';
    // A subgoal gate is judging work too, but not the decisive kind: default tier.
    assert.equal(selectModel(run, { stage: 'gate', subgoal_id: 'U1' }, host), hostDefault);
    // The goal gate is the one node that sees the request again, and stays on the host.
    assert.equal(selectModel(run, { stage: 'gate', subgoal_id: null }, host), 'current-model');
    // critique can reject the spec before anything is built: also stays on the host.
    assert.equal(selectModel(run, { stage: 'critique' }, host), 'current-model');
    // plan, setgoal, review and test never inherit the host model either way.
    for (const stage of ['plan', 'setgoal', 'review', 'test']) {
      assert.equal(selectModel(run, { stage }, host), hostDefault);
    }
    // An explicit model always wins, decisive stage or not.
    assert.equal(selectModel(run, { stage: 'gate', subgoal_id: null }, host, 'opus'), 'opus');
    assert.equal(selectModel(run, { stage: 'gate', subgoal_id: 'U1' }, host, 'opus'), 'opus');
  }
});

test('premium driving models are not inherited; explicit model selection wins', () => {
  for (const [host_vendor, host_model] of [['claude', 'fable'], ['codex', 'gpt-6-astra']]) {
    const run = { host_vendor, host_model };
    assert.notEqual(selectModel(run, { stage: 'plan' }, host_vendor), host_model);
    assert.equal(selectModel(run, { stage: 'plan' }, host_vendor, host_model), host_model);
  }
});

test('busy or repeatedly failing executor yields to the available peer', () => {
  const node = { node_id: 'implement:U1:2', stage: 'implement', subgoal_id: 'U1' };
  for (const state of ['running', 'failed']) {
    const nodes = Array.from({ length: 4 }, (_, i) => ({ node_id: `prior${i}`, stage: 'implement', executor: 'codex', state, result: { stage_ok: false } }));
    assert.equal(rankCandidates({ host_vendor: 'claude', nodes }, node, ['claude', 'codex'])[0].vendor, 'claude');
  }
});

test('negative gate verdict is not counted as an executor error', () => {
  const ranked = rankCandidates({ nodes: [{ stage: 'gate', executor: 'claude', state: 'failed', result: { stage_ok: true, accept: false } }] }, { stage: 'gate' }, ['claude']);
  assert.match(ranked[0].reason, /execution_errors=0/);
});

test('capacity errors are distinguished from implementation and test failures', () => {
  for (const stderr of ['insufficient_quota', 'rate_limit_error', "You've hit your limit", 'usage limit has been reached', 'out of credits']) {
    assert.equal(capacityFailure({ stderr }), true, stderr);
  }
  assert.equal(capacityFailure({ failure_kind: 'quota' }), true);
  assert.equal(capacityFailure({ stdout: JSON.stringify({ type: 'turn.failed', error: { message: 'usage_limit_reached' } }) }), true);
  assert.equal(capacityFailure({ result: { stage_ok: false, reason: 'rate_limit_error unit test failed' }, last_message: 'rate_limit_error unit test failed' }), false);
  assert.equal(capacityFailure({ stderr: 'SyntaxError: unexpected token' }), false);
});

test('concurrent saves retain capacity exclusions and explicit reset wins over stale writers', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'routing-state-'));
  try {
    const original = createRun({ cwd, request: 'r' });
    const first = loadRun(cwd, original.run_id), stale = loadRun(cwd, original.run_id);
    first.unavailable_vendors = { claude: 'quota' };
    saveRun(first);
    stale.unavailable_vendors = { codex: 'quota' };
    saveRun(stale);
    assert.deepEqual(loadRun(cwd, original.run_id).unavailable_vendors, { claude: 'quota', codex: 'quota' });
    const reset = loadRun(cwd, original.run_id);
    reset.capacity_epoch = 1;
    reset.unavailable_vendors = {};
    saveRun(reset);
    saveRun(stale);
    assert.deepEqual(loadRun(cwd, original.run_id).unavailable_vendors, {});
    assert.equal(loadRun(cwd, original.run_id).capacity_epoch, 1);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('test goes to whichever vendor did not implement the subgoal', () => {
  for (const host of ['claude', 'codex']) {
    const other = host === 'claude' ? 'codex' : 'claude';
    // The ordinary case: implement went to the peer, so test comes back to the host.
    let run = { host_vendor: host, host_model: 'm', nodes: [{ node_id: 'implement:U1:1', stage: 'implement', subgoal_id: 'U1', state: 'done', executor: other }] };
    let ranked = rankCandidates(run, { node_id: 'test:U1:1', stage: 'test', subgoal_id: 'U1' }, ['claude', 'codex']);
    assert.equal(ranked[0].vendor, host, `implement on ${other} -> test on ${host}`);
    assert.match(ranked.find((r) => r.vendor === other).reason, /same_actor=true/);
    // The peer ran out and implement fell back to the host: test must then go to the peer,
    // not follow the static cross-vendor rule to the host and share the author's blind spot.
    run = { host_vendor: host, host_model: 'm', nodes: [{ node_id: 'implement:U1:1', stage: 'implement', subgoal_id: 'U1', state: 'done', executor: host }] };
    ranked = rankCandidates(run, { node_id: 'test:U1:1', stage: 'test', subgoal_id: 'U1' }, ['claude', 'codex']);
    assert.equal(ranked[0].vendor, other, `implement on ${host} -> test on ${other}`);
    // Another subgoal's implementer is not this test's author.
    run = { host_vendor: host, host_model: 'm', nodes: [{ node_id: 'implement:U2:1', stage: 'implement', subgoal_id: 'U2', state: 'done', executor: host }] };
    assert.equal(rankCandidates(run, { node_id: 'test:U1:1', stage: 'test', subgoal_id: 'U1' }, ['claude', 'codex'])[0].vendor, other);
  }
});

// Gap 1 (judge≠author): audit's author never ran in this run at all - it is the PLAN
// package's draft/revise, folded away in a sibling child run before the audit run ever
// opens (taskmanager.mjs's openAudit/planAuthorIdentity). AUTHOR_OF's in-run peer lookup
// cannot see it, so this run carries it as `external_author` instead - routing.mjs's own
// half of that plumbing, tested here without any TaskManager involved.
test('audit routes away from external_author - the PRD author, carried in from a different run - when a peer vendor is free', () => {
  for (const host of ['claude', 'codex']) {
    const other = host === 'claude' ? 'codex' : 'claude';
    const run = { host_vendor: host, host_model: 'm', nodes: [], external_author: { executor: null, vendor: host, model: 'm' } };
    const ranked = rankCandidates(run, { node_id: 'audit:A1:1', stage: 'audit', subgoal_id: 'A1' }, ['claude', 'codex']);
    assert.equal(ranked[0].vendor, other, `PRD authored on ${host} -> audit prefers ${other}`);
    assert.match(ranked.find((r) => r.vendor === host).reason, /same_actor=true/);
    assert.match(ranked.find((r) => r.vendor === other).reason, /same_actor=false/);
  }
});

test('audit with no external_author (a run opened outside the TaskManager) is unaffected', () => {
  const run = { host_vendor: 'claude', host_model: 'm', nodes: [] };
  const ranked = rankCandidates(run, { node_id: 'audit:A1:1', stage: 'audit', subgoal_id: 'A1' }, ['claude', 'codex']);
  assert.ok(ranked.every((r) => /same_actor=false/.test(r.reason)));
});
