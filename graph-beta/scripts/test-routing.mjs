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
    for (const stage of ['plan', 'setgoal', 'critique', 'gate']) {
      assert.equal(rankCandidates(run, { stage }, ['claude', 'codex'])[0].vendor, host);
      assert.equal(selectModel(run, { stage }, host), 'current-model');
    }
    for (const stage of ['implement', 'test']) {
      assert.equal(rankCandidates(run, { stage }, ['claude', 'codex'])[0].vendor, other);
      assert.equal(selectModel(run, { stage }, 'claude'), 'sonnet');
      assert.equal(selectModel(run, { stage }, 'codex'), 'gpt-5.6-sol');
    }
    // The peer writes the run's account of itself, so the vendor that drove the run does
    // not get to be its own narrator. It stays reasoning work all the same: degraded back
    // to the host it keeps the driving model rather than dropping to an execution default.
    assert.equal(rankCandidates(run, { stage: 'report' }, ['claude', 'codex'])[0].vendor, other);
    assert.equal(selectModel(run, { stage: 'report' }, host), 'current-model');
    assert.equal(selectModel(run, { stage: 'report' }, other), other === 'claude' ? 'sonnet' : 'gpt-5.6-sol');
  });
}

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
