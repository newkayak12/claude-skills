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

// ---- Codex adapter path and the Codex-unavailable-then-Claude route ----
import { codexAdapterPath, routeCodex } from '../mcp/routing.mjs';
import { readFileSync } from 'node:fs';

test('the Codex adapter resolves to the harness file when present, else to the graph copy', () => {
  const root = '/plug/graph';
  const asked = [];
  const both = codexAdapterPath(root, (p) => { asked.push(p); return true; });
  assert.equal(both.source, 'harness');
  assert.equal(both.path, '/plug/harness/engine/codex-exec-adapter.mjs');
  assert.deepEqual(asked, ['/plug/harness/engine/codex-exec-adapter.mjs']);
  const only = codexAdapterPath(root, (p) => !/harness\/engine/.test(p));
  assert.equal(only.source, 'graph');
  assert.equal(only.path, '/plug/graph/adapters/codex-exec-adapter.mjs');
  assert.match(only.reason, /harness/);
});

const AT = '2026-10-23T00:00:00.000Z';
const states = {
  'not executable': { ready: false, reachable: false, adapter: '/h/a.mjs', reason: 'codex CLI is not executable' },
  unreachable: { ready: false, reachable: false, adapter: '/h/a.mjs', reason: 'codex unreachable: 401 Unauthorized' },
  'reachable, not ready': { ready: false, reachable: true, adapter: '/h/a.mjs', reason: 'write probe failed' },
};
const READY = { ready: true, reachable: true, adapter: '/h/a.mjs', reason: '' };

for (const [state, probe] of Object.entries(states)) {
  for (const stage of ['implement', 'test']) {
    test(`Codex ${state}: ${stage} falls back to Claude with the adapter reason verbatim`, () => {
      const r = routeCodex({ stage, probe, at: AT });
      assert.equal(r.executor, 'claude');
      assert.deepEqual(r.fallback, { from: 'codex', to: 'claude', reason: probe.reason, ready: probe.ready, reachable: probe.reachable, adapter: probe.adapter, at: AT });
    });
  }
}

test('critique and plan fall back when Codex is not executable or unreachable, and keep Codex when only reachable', () => {
  for (const stage of ['plan', 'critique']) {
    for (const state of ['not executable', 'unreachable']) {
      const r = routeCodex({ stage, probe: states[state], at: AT });
      assert.equal(r.executor, 'claude', `${stage} ${state}`);
      assert.equal(r.fallback.reason, states[state].reason);
    }
    assert.deepEqual(routeCodex({ stage, probe: states['reachable, not ready'], at: AT }), { executor: 'codex', fallback: null });
  }
});

test('a ready Codex keeps every stage', () => {
  for (const stage of ['plan', 'critique', 'implement', 'test']) {
    assert.deepEqual(routeCodex({ stage, probe: READY, at: AT }), { executor: 'codex', fallback: null });
  }
});

test('a Codex host or a CODEX_THREAD_ID never routes to Codex and records the nested-CLI reason', () => {
  for (const ctx of [{ host_vendor: 'codex' }, { host_vendor: 'claude', threadId: 't1' }, { threadId: 't1' }]) {
    for (const stage of ['plan', 'implement']) {
      const r = routeCodex({ stage, probe: READY, at: AT, ...ctx });
      assert.equal(r.executor, 'claude');
      assert.equal(r.fallback.from, 'codex');
      assert.equal(r.fallback.to, 'claude');
      assert.match(r.fallback.reason, /nested Codex CLI is disabled/);
      assert.equal(r.fallback.ready, true);
      assert.equal(r.fallback.at, AT);
    }
  }
});

test('routeCodex reads no environment: an ambient CODEX_THREAD_ID does not change the route', () => {
  const before = process.env.CODEX_THREAD_ID;
  process.env.CODEX_THREAD_ID = 'ambient';
  try {
    assert.deepEqual(routeCodex({ stage: 'implement', probe: READY, at: AT }), { executor: 'codex', fallback: null });
  } finally { if (before === undefined) delete process.env.CODEX_THREAD_ID; else process.env.CODEX_THREAD_ID = before; }
});

test('an empty adapter reason still leaves a recorded reason, and a missing at is stamped', () => {
  const r = routeCodex({ stage: 'implement', probe: { ready: false, reachable: false } });
  assert.equal(r.executor, 'claude');
  assert.ok(r.fallback.reason.length > 0);
  assert.equal(r.fallback.adapter, null);
  assert.ok(!Number.isNaN(Date.parse(r.fallback.at)));
});


test('routing.mjs points at the harness adapter and holds no adapter body or critique-round definition', () => {
  const src = readFileSync(new URL('../mcp/routing.mjs', import.meta.url), 'utf8');
  assert.match(src, /harness\/engine\/codex-exec-adapter\.mjs/);
  assert.ok(!/detectCodex|runCodex|--detect|max_critique_rounds/.test(src));
});
