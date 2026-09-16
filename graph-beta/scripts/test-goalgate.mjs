#!/usr/bin/env node
// Regression suite for goal-gate multi-judge consensus and the repair pass (Step 9).
//
// Runs against the live MCP surface over stdio with vendor:"self", exactly like
// test-broker.mjs - no vendor CLI needed. The style and helpers here are lifted from
// that file on purpose: this is the same broker, a new slice of behaviour on top of it.
//
//   node --test graph-beta/scripts/test-goalgate.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, appendFileSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stagePolicy } from '../mcp/graph.mjs';

const BROKER = join(dirname(fileURLToPath(import.meta.url)), '..', 'mcp', 'broker.mjs');

// ---------- routing bias for a second judge's identity (pure, no broker needed) ----------

test('a second judge on a round is biased away from the primary\'s resolved identity', () => {
  // Two candidates configured and the primary already resolved to 'claude': the
  // secondary's candidate order is biased so 'codex' is tried first.
  let run = {
    policy: { 'gate:goal': { candidates: ['claude', 'codex'] } }, vendor: 'auto', candidates: null, model: null,
    nodes: [{ node_id: 'gate:goal:1', executor: 'claude', model: 'sonnet' }],
  };
  assert.deepEqual(stagePolicy(run, { node_id: 'gate:goal:1b', stage: 'gate' }).candidates, ['codex', 'claude']);

  // Only one vendor is reachable (pinned to the same one the primary used): no vendor
  // to differ by, so the secondary gets that vendor's ordinary default tier instead of
  // whatever the primary got (selectModel would otherwise hand both the host model).
  run = {
    policy: { 'gate:goal': { vendor: 'claude' } }, vendor: 'auto', candidates: null, model: null,
    nodes: [{ node_id: 'gate:goal:1', executor: 'claude', model: 'current-driving-model' }],
  };
  const pol = stagePolicy(run, { node_id: 'gate:goal:1b', stage: 'gate' });
  assert.equal(pol.vendor, 'claude');
  assert.equal(pol.model, 'sonnet', 'the vendor default, not the primary\'s driving model');

  // The primary itself is never biased, and a judge whose primary has not resolved an
  // identity yet (nothing dispatched) is a no-op - there is nothing yet to differ from.
  const bare = { policy: {}, vendor: 'auto', candidates: null, model: null, nodes: [] };
  assert.deepEqual(stagePolicy(bare, { node_id: 'gate:goal:1', stage: 'gate' }), { vendor: 'auto', candidates: null, sandbox: undefined, model: null });
  const unresolved = { policy: {}, vendor: 'auto', candidates: null, model: null, nodes: [{ node_id: 'gate:goal:1' }] };
  assert.deepEqual(stagePolicy(unresolved, { node_id: 'gate:goal:1b', stage: 'gate' }), { vendor: 'auto', candidates: null, sandbox: undefined, model: null });
});

// ---------- a minimal MCP client (same shape as test-broker.mjs) ----------

class Client {
  constructor(env = {}) {
    this.proc = spawn('node', [BROKER], { stdio: ['pipe', 'pipe', 'inherit'], env: { ...process.env, ...env } });
    this.buf = '';
    this.id = 0;
    this.queue = [];
    this.proc.stdout.setEncoding('utf8');
    this.proc.stdout.on('data', (chunk) => {
      this.buf += chunk;
      let nl;
      while ((nl = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, nl);
        this.buf = this.buf.slice(nl + 1);
        if (line.trim()) this.queue.shift()(JSON.parse(line));
      }
    });
  }
  send(method, params) {
    return new Promise((resolve) => {
      this.queue.push(resolve);
      this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: ++this.id, method, params }) + '\n');
    });
  }
  async init() {
    await this.send('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
    return this;
  }
  async call(name, args) {
    const r = await this.send('tools/call', { name, arguments: args });
    const res = r.result || {};
    if (res.isError) return { error: res.content[0].text };
    return res.structuredContent;
  }
  close() {
    this.proc.stdin.end();
    this.proc.kill();
  }
}

function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'goalgate-test-'));
  const git = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' });
  git('init', '-q');
  git('config', 'user.email', 't@t');
  git('config', 'user.name', 't');
  writeFileSync(join(dir, 'a.txt'), 'x\n');
  git('add', '-A');
  git('commit', '-qm', 'init');
  return dir;
}

function dirty(dir, file = 'a.txt') {
  appendFileSync(join(dir, file), 'changed\n');
  return file;
}

const SPEC = {
  goal: 'G',
  acceptance: ['A'],
  subgoals: [{ id: 'U1', title: 'first', acceptance: ['a'], test: ['t'], deps: [] }],
};

// checks/attacks defaults mirror test-broker.mjs's `ok()`: the engine refuses an
// accept:true gate with either empty, so every fixture that does not test that rule
// carries a harmless default of both.
const ok = (payload) => ({ stage_ok: true, evidence: 'e', checks: ['ok -> looked fine'], attacks: ['ok -> looked fine from outside'], ...payload });

async function openRun(c, cwd, extra = {}) {
  const r = await c.call('graph_open', { request: 'r', cwd, vendor: 'self', ...extra });
  return r.run_id;
}

async function withRun(fn, extra) {
  const cwd = repo();
  const c = await new Client().init();
  try {
    const runId = await openRun(c, cwd, extra);
    await fn({ c, cwd, runId });
  } finally {
    c.close();
    rmSync(cwd, { recursive: true, force: true });
  }
}

// Drives plan -> setgoal -> critique -> implement/test/gate for the one subgoal in
// SPEC, leaving the goal-gate round (whatever `goal_judges` made of it) ready.
async function throughGoalGate(c, cwd, runId) {
  await c.call('graph_submit', { run_id: runId, cwd, node_id: 'plan', payload: ok({ handoff: 'p' }) });
  await c.call('graph_submit', { run_id: runId, cwd, node_id: 'setgoal', payload: ok({ spec: SPEC, handoff: 's' }) });
  await c.call('graph_submit', { run_id: runId, cwd, node_id: 'critique', payload: ok({ sound: true }) });
  const f = dirty(cwd);
  await c.call('graph_submit', { run_id: runId, cwd, node_id: 'implement:U1:1', payload: ok({ changed_files: [f], handoff: 'built' }) });
  await c.call('graph_submit', { run_id: runId, cwd, node_id: 'test:U1:1', payload: ok({ verified: true }) });
  await c.call('graph_submit', { run_id: runId, cwd, node_id: 'gate:U1:1', payload: ok({ accept: true, match_pct: 95 }) });
}

// ---------- naming and structure ----------

test('goal_judges:1 reproduces the single-node shape every earlier run had', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    await throughGoalGate(c, cwd, runId);
    const nx = await c.call('graph_next', { run_id: runId, cwd });
    assert.deepEqual(nx.ready.map((n) => n.node_id), ['gate:goal:1'], 'no letter suffix, no sibling');
    const v = await c.call('graph_submit', { run_id: runId, cwd, node_id: 'gate:goal:1', payload: ok({ accept: true, match_pct: 95 }) });
    assert.equal(v.state, 'done');
    assert.equal(v.repaired, undefined);
    const after = await c.call('graph_next', { run_id: runId, cwd });
    assert.deepEqual(after.ready.map((n) => n.node_id), ['report']);
  }, { goal_judges: 1 });
});

test('goal_judges default is 2: a fresh round is a primary and a lettered sibling, same deps', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    await throughGoalGate(c, cwd, runId);
    const nx = await c.call('graph_next', { run_id: runId, cwd });
    assert.deepEqual(nx.ready.map((n) => n.node_id).sort(), ['gate:goal:1', 'gate:goal:1b']);
    const st = await c.call('graph_status', { run_id: runId, cwd });
    const a = st.nodes.find((n) => n.node_id === 'gate:goal:1');
    const b = st.nodes.find((n) => n.node_id === 'gate:goal:1b');
    assert.deepEqual(a.deps, b.deps, 'both judges see the same assembled result');
  });
});

// ---------- consensus ----------

test('one judge accepts, one rejects: consensus refuses and a repair pass opens', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    await throughGoalGate(c, cwd, runId);
    await c.call('graph_submit', { run_id: runId, cwd, node_id: 'gate:goal:1', payload: ok({ accept: true, match_pct: 95 }) });
    const v = await c.call('graph_submit', {
      run_id: runId, cwd, node_id: 'gate:goal:1b',
      payload: ok({ accept: false, match_pct: 40, gaps: ['half-built'], reason: 'not enough' }),
    });
    assert.equal(v.state, 'failed');
    assert.ok(v.repaired, 'the round\'s rejection opened a repair pass, not a dead end');
    assert.equal(v.repaired.attempt, 1);

    const st = await c.call('graph_status', { run_id: runId, cwd });
    assert.equal(st.goal_verdict.accept, false);
    assert.equal(st.goal_verdict.match_pct, 40, 'the minimum across judges');
    assert.deepEqual(st.goal_verdict.gaps, ['half-built']);
    assert.equal(st.goal_verdict.judges.length, 2);

    const nx = await c.call('graph_next', { run_id: runId, cwd });
    assert.deepEqual(nx.ready.map((n) => n.node_id), ['repair:1']);
    const briefing = readFileSync(nx.ready[0].briefing_path, 'utf8');
    assert.match(briefing, /half-built/, 'the repair briefing carries the rejecting gaps');
    assert.match(briefing, /Subgoal U1/, 'and a pointer into every subgoal\'s handoff');
  });
});

test('both judges accept, but one is below threshold: consensus refuses on the number', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    await throughGoalGate(c, cwd, runId);
    await c.call('graph_submit', { run_id: runId, cwd, node_id: 'gate:goal:1', payload: ok({ accept: true, match_pct: 95 }) });
    const v = await c.call('graph_submit', { run_id: runId, cwd, node_id: 'gate:goal:1b', payload: ok({ accept: true, match_pct: 60 }) });
    assert.equal(v.state, 'failed', 'accept:true at 60% still fails the run\'s 90% floor');
    assert.ok(v.repaired);
    const st = await c.call('graph_status', { run_id: runId, cwd });
    assert.equal(st.goal_verdict.accept, false);
    assert.equal(st.goal_verdict.match_pct, 60);
  });
});

test('every judge accepts at or above the threshold: consensus accepts, no repair', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    await throughGoalGate(c, cwd, runId);
    await c.call('graph_submit', { run_id: runId, cwd, node_id: 'gate:goal:1', payload: ok({ accept: true, match_pct: 95 }) });
    const v = await c.call('graph_submit', { run_id: runId, cwd, node_id: 'gate:goal:1b', payload: ok({ accept: true, match_pct: 92 }) });
    assert.equal(v.state, 'done');
    assert.equal(v.repaired, undefined);
    const st = await c.call('graph_status', { run_id: runId, cwd });
    assert.equal(st.goal_verdict.accept, true);
    assert.equal(st.goal_verdict.match_pct, 92);
    const nx = await c.call('graph_next', { run_id: runId, cwd });
    assert.deepEqual(nx.ready.map((n) => n.node_id), ['report']);
  });
});

// ---------- attacks[] ----------

test('accept:true with an empty attacks[] is refused, same as an empty checks[]', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    await throughGoalGate(c, cwd, runId);
    const v = await c.call('graph_submit', {
      run_id: runId, cwd, node_id: 'gate:goal:1',
      payload: { stage_ok: true, accept: true, match_pct: 95, checks: ['looked fine'], attacks: [], evidence: 'e' },
    });
    assert.equal(v.state, 'failed');
    assert.match(v.reason, /accepted without an attack/);
  }, { goal_judges: 1 });
});

test('a rejection needs no attacks - only an acceptance is held to the rule', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    await throughGoalGate(c, cwd, runId);
    const v = await c.call('graph_submit', {
      run_id: runId, cwd, node_id: 'gate:goal:1',
      payload: { stage_ok: true, accept: false, match_pct: 40, checks: [], attacks: [], gaps: ['g'], reason: 'short', evidence: 'e' },
    });
    assert.equal(v.state, 'failed');
    assert.doesNotMatch(v.reason || '', /accepted without/, 'this is an ordinary rejection, not a no-evidence refusal');
  }, { goal_judges: 1, auto_reassign: false });
});

// ---------- repair ----------

test('repair accepted: a fresh goal-gate round follows it', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    await throughGoalGate(c, cwd, runId);
    await c.call('graph_submit', { run_id: runId, cwd, node_id: 'gate:goal:1', payload: ok({ accept: false, match_pct: 40, gaps: ['g1'], reason: 'short' }) });
    let nx = await c.call('graph_next', { run_id: runId, cwd });
    assert.deepEqual(nx.ready.map((n) => n.node_id), ['repair:1']);

    const f = dirty(cwd, 'b.txt');
    writeFileSync(join(cwd, 'b.txt'), 'seam fix\n');
    const v = await c.call('graph_submit', { run_id: runId, cwd, node_id: 'repair:1', payload: ok({ changed_files: [f], handoff: 'fixed the seam' }) });
    assert.equal(v.state, 'done');

    nx = await c.call('graph_next', { run_id: runId, cwd });
    assert.deepEqual(nx.ready.map((n) => n.node_id), ['gate:goal:2']);
    const st = await c.call('graph_status', { run_id: runId, cwd });
    assert.deepEqual(st.nodes.find((n) => n.node_id === 'gate:goal:2').deps.sort(), ['gate:U1:1', 'repair:1']);
    assert.deepEqual(st.nodes.find((n) => n.node_id === 'report').after, ['gate:goal:2']);

    await c.call('graph_submit', { run_id: runId, cwd, node_id: 'gate:goal:2', payload: ok({ accept: true, match_pct: 96 }) });
    nx = await c.call('graph_next', { run_id: runId, cwd });
    assert.deepEqual(nx.ready.map((n) => n.node_id), ['report']);
  }, { goal_judges: 1 });
});

test('a repair round that closes the same gaps twice stalls: the run proceeds to report on partial work', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    await throughGoalGate(c, cwd, runId);
    await c.call('graph_submit', { run_id: runId, cwd, node_id: 'gate:goal:1', payload: ok({ accept: false, match_pct: 40, gaps: ['same gap'], reason: 'short' }) });
    let nx = await c.call('graph_next', { run_id: runId, cwd });
    assert.deepEqual(nx.ready.map((n) => n.node_id), ['repair:1']);
    await c.call('graph_submit', { run_id: runId, cwd, node_id: 'repair:1', payload: ok({ changed_files: [], handoff: 'tried' }) });
    nx = await c.call('graph_next', { run_id: runId, cwd });
    assert.deepEqual(nx.ready.map((n) => n.node_id), ['gate:goal:2']);

    const v = await c.call('graph_submit', { run_id: runId, cwd, node_id: 'gate:goal:2', payload: ok({ accept: false, match_pct: 40, gaps: ['same gap'], reason: 'still short' }) });
    assert.equal(v.state, 'failed');
    assert.equal(v.stalled !== undefined && v.stalled !== false, true, 'the same rejection twice stalls rather than opening repair:2');

    nx = await c.call('graph_next', { run_id: runId, cwd });
    assert.deepEqual(nx.ready.map((n) => n.node_id), ['report'], 'the run proceeds to report on partial work');
    const st = await c.call('graph_status', { run_id: runId, cwd });
    assert.equal(st.nodes.filter((n) => n.node_id.startsWith('repair:')).length, 1, 'no second repair was opened');
  }, { goal_judges: 1 });
});

test('graph_retry({repair:true}) forces a repair round when auto_reassign is off', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    await throughGoalGate(c, cwd, runId);
    const v = await c.call('graph_submit', { run_id: runId, cwd, node_id: 'gate:goal:1', payload: ok({ accept: false, match_pct: 40, gaps: ['g'], reason: 'short' }) });
    assert.equal(v.repaired, undefined, 'auto_reassign is off: nothing opens on its own');
    let nx = await c.call('graph_next', { run_id: runId, cwd });
    assert.equal(nx.state, 'blocked');

    const rt = await c.call('graph_retry', { run_id: runId, cwd, repair: true });
    assert.equal(rt.retried, true);
    assert.equal(rt.attempt, 1);
    nx = await c.call('graph_next', { run_id: runId, cwd });
    assert.deepEqual(nx.ready.map((n) => n.node_id), ['repair:1']);

    // Calling it again over an already-accepted round is refused, not a second repair.
    await c.call('graph_submit', { run_id: runId, cwd, node_id: 'repair:1', payload: ok({ changed_files: [], handoff: 'fixed' }) });
    await c.call('graph_submit', { run_id: runId, cwd, node_id: 'gate:goal:2', payload: ok({ accept: true, match_pct: 95 }) });
    const again = await c.call('graph_retry', { run_id: runId, cwd, repair: true });
    assert.ok(again.error, 'nothing left to repair once the round accepted');
    assert.match(again.error, /already accepted/);
  }, { goal_judges: 1, auto_reassign: false });
});
