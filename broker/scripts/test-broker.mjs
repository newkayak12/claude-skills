#!/usr/bin/env node
// Regression suite for the node-broker.
//
// Every case here is a bug that actually shipped and was caught by running a real
// graph, not by reading the code. They run against the live MCP surface over stdio
// with vendor:"self", so no vendor CLI is needed and the whole file finishes in
// seconds.
//
//   node --test broker/scripts/test-broker.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const BROKER = join(dirname(fileURLToPath(import.meta.url)), '..', 'mcp', 'broker.mjs');

// ---------- a minimal MCP client ----------

class Client {
  constructor() {
    this.proc = spawn('node', [BROKER], { stdio: ['pipe', 'pipe', 'inherit'] });
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
    await this.send('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'test', version: '1' },
    });
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

// ---------- fixtures ----------

function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'broker-test-'));
  const git = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' });
  git('init', '-q');
  git('config', 'user.email', 't@t');
  git('config', 'user.name', 't');
  writeFileSync(join(dir, 'a.txt'), 'x\n');
  git('add', '-A');
  git('commit', '-qm', 'init');
  return dir;
}

// A truthful claim needs a change git can actually see.
function dirty(dir, file = 'a.txt') {
  appendFileSync(join(dir, file), 'changed\n');
  return file;
}

const SPEC = {
  goal: 'G',
  acceptance: ['A'],
  subgoals: [
    { id: 'U1', title: 'first', acceptance: ['a'], test: ['t'], deps: [] },
    { id: 'U2', title: 'second', acceptance: ['b'], test: ['t'], deps: ['U1'] },
  ],
};

async function openRun(c, cwd, extra = {}) {
  const r = await c.call('graph_open', { request: 'r', cwd, vendor: 'self', ...extra });
  return r.run_id;
}

const ok = (payload) => ({ stage_ok: true, evidence: 'e', ...payload });

async function throughCritique(c, cwd, runId) {
  await c.call('graph_submit', { run_id: runId, cwd, node_id: 'plan', payload: ok({ handoff: 'p' }) });
  await c.call('graph_submit', { run_id: runId, cwd, node_id: 'setgoal', payload: ok({ spec: SPEC, handoff: 's' }) });
  await c.call('graph_submit', { run_id: runId, cwd, node_id: 'critique', payload: ok({ sound: true }) });
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

// ---------- protocol ----------

test('serves the MCP handshake and the graph tool surface', async () => {
  const c = await new Client().init();
  try {
    const r = await c.send('tools/list', {});
    const names = r.result.tools.map((t) => t.name).sort();
    assert.deepEqual(names, [
      'graph_next', 'graph_open', 'graph_retry', 'graph_run', 'graph_status', 'graph_submit',
    ]);
  } finally {
    c.close();
  }
});

test('graph_open seeds plan -> setgoal -> critique and offers plan first', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    const st = await c.call('graph_status', { run_id: runId, cwd });
    assert.deepEqual(st.nodes.map((n) => n.node_id), ['plan', 'setgoal', 'critique']);
    const nx = await c.call('graph_next', { run_id: runId, cwd });
    assert.deepEqual(nx.ready.map((n) => n.node_id), ['plan']);
  });
});

// ---------- the orchestrator must not receive payloads ----------

test('a verdict carries no spec, handoff, or evidence', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    await c.call('graph_submit', { run_id: runId, cwd, node_id: 'plan', payload: ok({ handoff: 'p' }) });
    const v = await c.call('graph_submit', {
      run_id: runId, cwd, node_id: 'setgoal',
      payload: ok({ spec: SPEC, handoff: 'long handoff text', evidence: 'long evidence text' }),
    });
    for (const leaked of ['spec', 'handoff', 'evidence', 'result', 'changed_files', 'gaps']) {
      assert.equal(leaked in v, false, `verdict leaked ${leaked}`);
    }
  });
});

test('setgoal expands the graph server-side from a spec the caller never gets back', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    await c.call('graph_submit', { run_id: runId, cwd, node_id: 'plan', payload: ok({ handoff: 'p' }) });
    await c.call('graph_submit', { run_id: runId, cwd, node_id: 'setgoal', payload: ok({ spec: SPEC }) });
    const st = await c.call('graph_status', { run_id: runId, cwd });
    const ids = st.nodes.map((n) => n.node_id);
    for (const id of ['implement:U1:1', 'test:U1:1', 'gate:U1:1', 'gate:goal:1', 'report']) {
      assert.ok(ids.includes(id), `missing ${id}`);
    }
    // U2 declared deps:["U1"], which must become a dependency on U1's gate.
    const u2 = st.nodes.find((n) => n.node_id === 'implement:U2:1');
    assert.ok(u2.deps.includes('gate:U1:1'));
  });
});

// ---------- ordering is enforced, not advisory ----------

test('graph_submit refuses a node whose deps are unmet', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    const r = await c.call('graph_submit', { run_id: runId, cwd, node_id: 'setgoal', payload: ok({}) });
    assert.match(r.error, /blocked on plan/);
  });
});

test('graph_submit refuses an unknown node and a finished one', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    const unknown = await c.call('graph_submit', { run_id: runId, cwd, node_id: 'implement:U1:1', payload: ok({}) });
    assert.match(unknown.error, /unknown node/);
    await c.call('graph_submit', { run_id: runId, cwd, node_id: 'plan', payload: ok({ handoff: 'p' }) });
    const again = await c.call('graph_submit', { run_id: runId, cwd, node_id: 'plan', payload: ok({}) });
    assert.match(again.error, /is done, not pending/);
  });
});

// ---------- adjudication ----------

test('a claimed file the worktree does not show fails the node', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    await throughCritique(c, cwd, runId);
    const v = await c.call('graph_submit', {
      run_id: runId, cwd, node_id: 'implement:U1:1',
      payload: ok({ changed_files: ['ghost.js'], handoff: 'h' }),
    });
    assert.equal(v.submitted_stage_ok, true, 'the node claimed success');
    assert.equal(v.stage_ok, false, 'the broker must lower it');
    assert.deepEqual(v.contradicted_files, ['ghost.js']);
    assert.equal(v.state, 'failed');
  });
});

test('a truthful claim under isolated verifies positively', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    await throughCritique(c, cwd, runId);
    const f = dirty(cwd);
    const v = await c.call('graph_submit', {
      run_id: runId, cwd, node_id: 'implement:U1:1',
      payload: ok({ changed_files: [f], handoff: 'h' }),
    });
    assert.equal(v.stage_ok, true);
    assert.equal(v.changed_files_verified, true);
    assert.equal(v.change_attribution, 'isolated');
  }, { isolated: true });
});

test('a shared worktree reports null attribution rather than a pass', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    await throughCritique(c, cwd, runId);
    const f = dirty(cwd);
    const v = await c.call('graph_submit', {
      run_id: runId, cwd, node_id: 'implement:U1:1',
      payload: ok({ changed_files: [f], handoff: 'h' }),
    });
    assert.equal(v.stage_ok, true);
    assert.equal(v.changed_files_verified, null, 'could not attribute is not verified');
    assert.equal(v.change_attribution, 'shared-worktree');
  });
});

// ---------- verdicts must gate progression ----------
// stage_ok on a judging node means "the judging worked". Reading only stage_ok once let
// a rejected subgoal flow downstream as if it had passed.

test('test verified=false fails the node and blocks the graph', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    await throughCritique(c, cwd, runId);
    const f = dirty(cwd);
    await c.call('graph_submit', { run_id: runId, cwd, node_id: 'implement:U1:1', payload: ok({ changed_files: [f] }) });
    const v = await c.call('graph_submit', {
      run_id: runId, cwd, node_id: 'test:U1:1', payload: ok({ verified: false }),
    });
    assert.equal(v.stage_ok, true, 'the checks did run');
    assert.equal(v.state, 'failed', 'but the subgoal did not pass');
    const nx = await c.call('graph_next', { run_id: runId, cwd });
    assert.equal(nx.state, 'blocked');
    assert.deepEqual(nx.ready, []);
  }, { isolated: true });
});

test('gate accept=false fails the node and holds back dependents', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    await throughCritique(c, cwd, runId);
    const f = dirty(cwd);
    await c.call('graph_submit', { run_id: runId, cwd, node_id: 'implement:U1:1', payload: ok({ changed_files: [f] }) });
    await c.call('graph_submit', { run_id: runId, cwd, node_id: 'test:U1:1', payload: ok({ verified: true }) });
    const v = await c.call('graph_submit', {
      run_id: runId, cwd, node_id: 'gate:U1:1', payload: ok({ accept: false, match_pct: 85, gaps: ['no runtime check'] }),
    });
    assert.equal(v.state, 'failed');
    const nx = await c.call('graph_next', { run_id: runId, cwd });
    const ready = nx.ready.map((n) => n.node_id);
    assert.equal(ready.includes('implement:U2:1'), false, 'U2 must not start on a rejected U1');
  }, { isolated: true });
});

test('critique sound=false fails the node', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    await c.call('graph_submit', { run_id: runId, cwd, node_id: 'plan', payload: ok({ handoff: 'p' }) });
    await c.call('graph_submit', { run_id: runId, cwd, node_id: 'setgoal', payload: ok({ spec: SPEC }) });
    const v = await c.call('graph_submit', {
      run_id: runId, cwd, node_id: 'critique', payload: ok({ sound: false, problems: ['vague acceptance'] }),
    });
    assert.equal(v.state, 'failed');
  });
});

// ---------- retry ----------

test('a retry retires the dead attempt, rewires dependents, and yields a ready node', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    await throughCritique(c, cwd, runId);
    await c.call('graph_submit', {
      run_id: runId, cwd, node_id: 'implement:U1:1', payload: ok({ changed_files: ['ghost.js'] }),
    });
    let nx = await c.call('graph_next', { run_id: runId, cwd });
    assert.equal(nx.state, 'blocked', 'a failed implement blocks the graph');

    const r = await c.call('graph_retry', { run_id: runId, cwd, subgoal_id: 'U1' });
    assert.equal(r.retried, true);
    assert.equal(r.attempt, 2);
    assert.deepEqual(r.ready.map((n) => n.node_id), ['implement:U1:2'],
      'the new attempt must be runnable, not waiting on a gate that will never come');

    const st = await c.call('graph_status', { run_id: runId, cwd });
    const stale = st.nodes.filter((n) => ['test:U1:1', 'gate:U1:1'].includes(n.node_id));
    assert.ok(stale.every((n) => n.state === 'skipped'), 'the dead attempt must be retired');
    const goal = st.nodes.find((n) => n.node_id === 'gate:goal:1');
    assert.ok(goal.deps.includes('gate:U1:2'), 'the goal gate must follow the live attempt');
    assert.equal(goal.deps.includes('gate:U1:1'), false);
  }, { isolated: true });
});

test('the retry budget is finite', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    await throughCritique(c, cwd, runId);
    for (let attempt = 1; attempt <= 2; attempt++) {
      await c.call('graph_submit', {
        run_id: runId, cwd, node_id: `implement:U1:${attempt}`, payload: ok({ changed_files: ['ghost.js'] }),
      });
      const r = await c.call('graph_retry', { run_id: runId, cwd, subgoal_id: 'U1' });
      assert.equal(r.retried, attempt === 1, `attempt ${attempt}`);
      if (!r.retried) assert.match(r.reason, /budget/);
    }
  }, { max_retries: 1 });
});

// ---------- routing ----------

test('a named vendor fails instead of silently degrading to self', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    const nx = await c.call('graph_next', { run_id: runId, cwd });
    assert.equal(nx.ready[0].vendor, 'vendor-failure');
    assert.match(JSON.stringify(nx.ready[0].attempts), /unknown vendor/);
  }, { vendor: 'nosuchvendor' });
});

test('auto degrades to self when no vendor is ready', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    const nx = await c.call('graph_next', { run_id: runId, cwd });
    assert.equal(nx.ready[0].vendor, 'self');
    assert.ok(nx.ready[0].briefing_path, 'a self node needs a briefing on disk, not in the reply');
  }, { vendor: 'auto', candidates: ['nosuchvendor'] });
});

test('graph_run refuses a self-routed node', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    const r = await c.call('graph_run', { run_id: runId, cwd, node_id: 'plan' });
    assert.match(r.error, /routed to self/);
  });
});

// ---------- a full pass ----------

test('a clean run reaches report', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    await throughCritique(c, cwd, runId);
    for (const sg of ['U1', 'U2']) {
      const f = dirty(cwd);
      await c.call('graph_submit', { run_id: runId, cwd, node_id: `implement:${sg}:1`, payload: ok({ changed_files: [f], handoff: 'h' }) });
      await c.call('graph_submit', { run_id: runId, cwd, node_id: `test:${sg}:1`, payload: ok({ verified: true }) });
      await c.call('graph_submit', { run_id: runId, cwd, node_id: `gate:${sg}:1`, payload: ok({ accept: true, match_pct: 95 }) });
    }
    await c.call('graph_submit', { run_id: runId, cwd, node_id: 'gate:goal:1', payload: ok({ accept: true, match_pct: 95 }) });
    const v = await c.call('graph_submit', { run_id: runId, cwd, node_id: 'report', payload: ok({ handoff: 'done' }) });
    assert.equal(v.state, 'done');
    const st = await c.call('graph_status', { run_id: runId, cwd });
    assert.equal(st.state, 'complete');
    assert.equal(st.counts.failed, 0);
  }, { isolated: true });
});

// ---------- a rejected spec ----------
// critique rejecting the spec used to dead-end the run: graph_retry only knew subgoals,
// so a graph everyone agreed was wrong had nowhere to go.

test('a spec-level node is briefed with the subgoals, not just the goal', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    await c.call('graph_submit', { run_id: runId, cwd, node_id: 'plan', payload: ok({ handoff: 'p' }) });
    await c.call('graph_submit', { run_id: runId, cwd, node_id: 'setgoal', payload: ok({ spec: SPEC }) });
    const nx = await c.call('graph_next', { run_id: runId, cwd });
    const briefing = readFileSync(nx.ready.find((n) => n.node_id === 'critique').briefing_path, 'utf8');
    assert.match(briefing, /Subgoals in the spec/);
    assert.match(briefing, /U1 — first/);
    assert.match(briefing, /U2 — second/);
    assert.match(briefing, /Depends on: U1/);
  });
});

test('a rejected spec can be retried, discarding the graph it produced', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    await c.call('graph_submit', { run_id: runId, cwd, node_id: 'plan', payload: ok({ handoff: 'p' }) });
    await c.call('graph_submit', { run_id: runId, cwd, node_id: 'setgoal', payload: ok({ spec: SPEC }) });
    await c.call('graph_submit', {
      run_id: runId, cwd, node_id: 'critique', payload: ok({ sound: false, problems: ['acceptance is unfalsifiable'] }),
    });
    let nx = await c.call('graph_next', { run_id: runId, cwd });
    assert.equal(nx.state, 'blocked');

    const r = await c.call('graph_retry', { run_id: runId, cwd });
    assert.equal(r.retried, true);
    assert.equal(r.target, 'spec');
    assert.deepEqual(r.ready.map((n) => n.node_id), ['setgoal:2']);

    const st = await c.call('graph_status', { run_id: runId, cwd });
    assert.equal(st.has_spec, false, 'the rejected spec must be dropped');
    const stale = st.nodes.filter((n) => n.node_id.startsWith('implement:') || n.node_id === 'gate:goal:1');
    assert.ok(stale.every((n) => n.state === 'skipped'), 'the old subgoal graph must be retired');
  });
});

test('the retried spec rebuilds the graph off the live critique', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    await c.call('graph_submit', { run_id: runId, cwd, node_id: 'plan', payload: ok({ handoff: 'p' }) });
    await c.call('graph_submit', { run_id: runId, cwd, node_id: 'setgoal', payload: ok({ spec: SPEC }) });
    await c.call('graph_submit', { run_id: runId, cwd, node_id: 'critique', payload: ok({ sound: false, problems: ['x'] }) });
    await c.call('graph_retry', { run_id: runId, cwd });

    const NEW = { goal: 'G2', acceptance: ['A2'], subgoals: [{ id: 'V1', title: 'only', acceptance: ['a'], test: ['t'], deps: [] }] };
    await c.call('graph_submit', { run_id: runId, cwd, node_id: 'setgoal:2', payload: ok({ spec: NEW }) });
    await c.call('graph_submit', { run_id: runId, cwd, node_id: 'critique:2', payload: ok({ sound: true }) });

    const st = await c.call('graph_status', { run_id: runId, cwd });
    assert.deepEqual(st.subgoals, ['V1']);
    const impl = st.nodes.find((n) => n.node_id === 'implement:V1:1');
    assert.ok(impl.deps.includes('critique:2'), 'must hang off the live critique, not the retired one');
    const nx = await c.call('graph_next', { run_id: runId, cwd });
    assert.deepEqual(nx.ready.map((n) => n.node_id), ['implement:V1:1']);
  });
});

test('the spec retry budget is finite', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    await c.call('graph_submit', { run_id: runId, cwd, node_id: 'plan', payload: ok({ handoff: 'p' }) });
    await c.call('graph_submit', { run_id: runId, cwd, node_id: 'setgoal', payload: ok({ spec: SPEC }) });
    await c.call('graph_submit', { run_id: runId, cwd, node_id: 'critique', payload: ok({ sound: false }) });
    const first = await c.call('graph_retry', { run_id: runId, cwd });
    assert.equal(first.retried, true);
    await c.call('graph_submit', { run_id: runId, cwd, node_id: 'setgoal:2', payload: ok({ spec: SPEC }) });
    await c.call('graph_submit', { run_id: runId, cwd, node_id: 'critique:2', payload: ok({ sound: false }) });
    const second = await c.call('graph_retry', { run_id: runId, cwd });
    assert.equal(second.retried, false);
    assert.match(second.reason, /budget/);
  }, { max_retries: 1 });
});

// ---------- a spec retry that reuses subgoal ids ----------
// This shipped: retrySpec retired the subgoal nodes, then expandSubgoals saw the ids
// already existed and created nothing. Nothing was pending, so the run declared itself
// COMPLETE having never run an implement node. The earlier retry test missed it only
// because its replacement spec happened to use different ids.

test('a retried spec with the SAME subgoal ids rebuilds real nodes', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    await c.call('graph_submit', { run_id: runId, cwd, node_id: 'plan', payload: ok({ handoff: 'p' }) });
    await c.call('graph_submit', { run_id: runId, cwd, node_id: 'setgoal', payload: ok({ spec: SPEC }) });
    await c.call('graph_submit', { run_id: runId, cwd, node_id: 'critique', payload: ok({ sound: false, blocking: ['x'] }) });
    await c.call('graph_retry', { run_id: runId, cwd });

    // the same ids, deliberately
    await c.call('graph_submit', { run_id: runId, cwd, node_id: 'setgoal:2', payload: ok({ spec: SPEC }) });
    const v = await c.call('graph_submit', { run_id: runId, cwd, node_id: 'critique:2', payload: ok({ sound: true }) });
    assert.equal(v.state, 'done');

    const nx = await c.call('graph_next', { run_id: runId, cwd });
    assert.equal(nx.state, 'running', 'a rebuilt graph is not a finished one');
    assert.deepEqual(nx.ready.map((n) => n.node_id), ['implement:U1:2'],
      'the second expansion must create fresh nodes, not collide with the retired ones');

    const st = await c.call('graph_status', { run_id: runId, cwd });
    const live = st.nodes.filter((n) => n.node_id.startsWith('implement:U1:'));
    assert.equal(live.length, 2, 'the retired node stays as evidence alongside the new one');
  });
});

test('a run is complete only when a report node is done', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    await c.call('graph_submit', { run_id: runId, cwd, node_id: 'plan', payload: ok({ handoff: 'p' }) });
    await c.call('graph_submit', { run_id: runId, cwd, node_id: 'setgoal', payload: ok({ spec: SPEC }) });
    await c.call('graph_submit', { run_id: runId, cwd, node_id: 'critique', payload: ok({ sound: false }) });
    await c.call('graph_retry', { run_id: runId, cwd });
    await c.call('graph_submit', { run_id: runId, cwd, node_id: 'setgoal:2', payload: ok({ spec: SPEC }) });
    await c.call('graph_submit', { run_id: runId, cwd, node_id: 'critique:2', payload: ok({ sound: true }) });
    const st = await c.call('graph_status', { run_id: runId, cwd });
    assert.notEqual(st.state, 'complete', 'no implement node has run; this is not complete');
  });
});

// ---------- the report must be able to see the run ----------

test('report and the goal gate are briefed with every finished node', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    await throughCritique(c, cwd, runId);
    for (const sg of ['U1', 'U2']) {
      const f = dirty(cwd);
      await c.call('graph_submit', {
        run_id: runId, cwd, node_id: `implement:${sg}:1`,
        payload: ok({ changed_files: [f], handoff: `built ${sg}`, checks: [`ran ${sg}`] }),
      });
      await c.call('graph_submit', { run_id: runId, cwd, node_id: `test:${sg}:1`, payload: ok({ verified: true, checks: [`checked ${sg}`] }) });
      await c.call('graph_submit', { run_id: runId, cwd, node_id: `gate:${sg}:1`, payload: ok({ accept: true, match_pct: 95 }) });
    }
    let nx = await c.call('graph_next', { run_id: runId, cwd });
    const goalGate = nx.ready.find((n) => n.node_id.startsWith('gate:goal'));
    const gateBrief = readFileSync(goalGate.briefing_path, 'utf8');
    assert.match(gateBrief, /Every node in this run/);
    assert.match(gateBrief, /built U1/, 'the goal gate must see the actual work, not just subgoal gates');

    await c.call('graph_submit', { run_id: runId, cwd, node_id: goalGate.node_id, payload: ok({ accept: true, match_pct: 93 }) });
    nx = await c.call('graph_next', { run_id: runId, cwd });
    const brief = readFileSync(nx.ready.find((n) => n.stage === 'report').briefing_path, 'utf8');
    for (const fact of ['built U1', 'built U2', 'checked U1', 'implement:U1:1']) {
      assert.ok(brief.includes(fact), `report briefing is missing ${fact}`);
    }
  }, { isolated: true });
});

test('the report briefing carries failures, not just successes', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    await throughCritique(c, cwd, runId);
    await c.call('graph_submit', {
      run_id: runId, cwd, node_id: 'implement:U1:1', payload: ok({ changed_files: ['ghost.js'], handoff: 'claimed' }),
    });
    await c.call('graph_retry', { run_id: runId, cwd, subgoal_id: 'U1' });
    for (const sg of [['U1', 2], ['U2', 1]]) {
      const f = dirty(cwd);
      await c.call('graph_submit', { run_id: runId, cwd, node_id: `implement:${sg[0]}:${sg[1]}`, payload: ok({ changed_files: [f], handoff: `built ${sg[0]}` }) });
      await c.call('graph_submit', { run_id: runId, cwd, node_id: `test:${sg[0]}:${sg[1]}`, payload: ok({ verified: true }) });
      await c.call('graph_submit', { run_id: runId, cwd, node_id: `gate:${sg[0]}:${sg[1]}`, payload: ok({ accept: true, match_pct: 90 }) });
    }
    const nx = await c.call('graph_next', { run_id: runId, cwd });
    const goalGate = nx.ready.find((n) => n.node_id.startsWith('gate:goal'));
    const brief = readFileSync(goalGate.briefing_path, 'utf8');
    assert.match(brief, /implement:U1:1 \(implement\) — failed/);
    assert.match(brief, /ghost\.js/, '"what was not done and why" needs the failed claim');
  }, { isolated: true });
});

// ---------- an unusable spec ----------
// A malformed spec never failed at setgoal; it failed much later as a deadlock, or - worse
// - as a run that finished having built nothing. Each case below was reachable.

async function setgoalWith(c, cwd, runId, payload) {
  await c.call('graph_submit', { run_id: runId, cwd, node_id: 'plan', payload: ok({ handoff: 'p' }) });
  return c.call('graph_submit', { run_id: runId, cwd, node_id: 'setgoal', payload: ok(payload) });
}

test('setgoal that returns no spec fails instead of quietly leaving a three-node graph', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    const v = await setgoalWith(c, cwd, runId, { handoff: 'forgot the spec' });
    assert.equal(v.state, 'failed');
    assert.match(v.reason, /unusable spec/);
    const st = await c.call('graph_status', { run_id: runId, cwd });
    assert.equal(st.has_spec, false);
    assert.notEqual(st.state, 'complete');
  });
});

test('a spec with no subgoals fails rather than making the goal gate immediately ready', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    const v = await setgoalWith(c, cwd, runId, { spec: { goal: 'G', acceptance: ['A'], subgoals: [] } });
    assert.equal(v.state, 'failed');
    assert.match(v.reason, /no subgoals/);
    const nx = await c.call('graph_next', { run_id: runId, cwd });
    assert.equal(nx.ready.some((n) => n.node_id.startsWith('gate:goal')), false);
  });
});

test('a dep on a subgoal that does not exist is caught, not left to deadlock', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    const v = await setgoalWith(c, cwd, runId, {
      spec: { goal: 'G', acceptance: ['A'], subgoals: [{ id: 'U1', title: 't', acceptance: ['a'], deps: ['GHOST'] }] },
    });
    assert.equal(v.state, 'failed');
    assert.match(v.reason, /GHOST, which is not in the spec/);
  });
});

test('a dependency cycle is caught', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    const v = await setgoalWith(c, cwd, runId, {
      spec: {
        goal: 'G', acceptance: ['A'],
        subgoals: [
          { id: 'U1', title: 't', acceptance: ['a'], deps: ['U2'] },
          { id: 'U2', title: 't', acceptance: ['a'], deps: ['U1'] },
        ],
      },
    });
    assert.equal(v.state, 'failed');
    assert.match(v.reason, /cycle/);
  });
});

test('duplicate subgoal ids and missing acceptance are caught', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    const v = await setgoalWith(c, cwd, runId, {
      spec: {
        goal: 'G', acceptance: ['A'],
        subgoals: [
          { id: 'U1', title: 't', acceptance: ['a'] },
          { id: 'U1', title: 't2' },
        ],
      },
    });
    assert.equal(v.state, 'failed');
    assert.match(v.reason, /duplicate subgoal id U1/);
    assert.match(v.reason, /no acceptance criteria/);
  });
});

test('an unusable spec is retryable and its defects reach the next attempt', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    await setgoalWith(c, cwd, runId, { spec: { goal: 'G', acceptance: ['A'], subgoals: [] } });
    const r = await c.call('graph_retry', { run_id: runId, cwd });
    assert.equal(r.retried, true);
    assert.equal(r.target, 'spec');
    const nx = await c.call('graph_next', { run_id: runId, cwd });
    const brief = readFileSync(nx.ready.find((n) => n.node_id === 'setgoal:2').briefing_path, 'utf8');
    assert.match(brief, /Previous attempt was rejected/);
    assert.match(brief, /no subgoals/, 'the next attempt must be told what was wrong');
  });
});

// ---------- vendor output the broker has to survive ----------
// A stand-in vendor, so the graph_run path can be exercised without a real CLI.

const FAKE_ADAPTER = `#!/usr/bin/env node
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
const args = process.argv.slice(2);
const get = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const out = get('--output');
mkdirSync(dirname(out), { recursive: true });
if (args.includes('--detect')) {
  writeFileSync(out, JSON.stringify({ ok: true, codex: { ready: true, reachable: true, write_probe: { ok: true } } }));
  process.exit(0);
}
writeFileSync(out, JSON.stringify({ ok: true, last_message: process.env.FAKE_REPLY ?? '' }));
process.exit(0);
`;

function repoWithFakeVendor() {
  const dir = repo();
  const adapter = join(dir, 'fake-adapter.mjs');
  writeFileSync(adapter, FAKE_ADAPTER);
  mkdirSync(join(dir, '.claude'), { recursive: true });
  writeFileSync(join(dir, '.claude', 'broker-vendors.json'), JSON.stringify({
    fake: { command: 'node', args: [adapter], sandboxes: ['read-only', 'workspace-write'], default_sandbox: 'workspace-write' },
  }));
  return dir;
}

async function runPlanWith(reply) {
  const cwd = repoWithFakeVendor();
  process.env.FAKE_REPLY = reply;
  const c = await new Client().init();
  try {
    const { run_id } = await c.call('graph_open', { request: 'r', cwd, vendor: 'fake' });
    return { v: await c.call('graph_run', { run_id, cwd, node_id: 'plan' }), cwd, c };
  } finally {
    c.close();
    delete process.env.FAKE_REPLY;
    rmSync(cwd, { recursive: true, force: true });
  }
}

test('a vendor that returns nothing fails the node', async () => {
  const { v } = await runPlanWith('');
  assert.equal(v.state, 'failed');
  assert.match(v.reason, /no usable JSON/);
});

test('a vendor that returns prose instead of JSON fails the node', async () => {
  const { v } = await runPlanWith('I could not do it.');
  assert.equal(v.state, 'failed');
  assert.match(v.reason, /no usable JSON/);
  assert.match(v.reason, /could not do it/, 'the reason must quote what the vendor actually said');
});

test('a vendor that wraps its JSON in prose and fences still parses', async () => {
  const { v } = await runPlanWith('Sure thing:\n```json\n{"stage_ok":true,"plan":"x","handoff":"h","evidence":"e"}\n```\nAll done.');
  assert.equal(v.state, 'done');
  assert.equal(v.stage_ok, true);
});

test('a vendor that returns stage_ok:false fails the node', async () => {
  const { v } = await runPlanWith('{"stage_ok":false,"handoff":"blocked by sandbox","evidence":"e"}');
  assert.equal(v.state, 'failed');
});

// ---------- an abandoned node ----------
// graph_run is synchronous, so a node still marked `running` after the broker that
// started it exited is not in flight - it is stranded. Before this, such a run wedged
// permanently: graph_next offered nothing and graph_run refused the node as running.

function forceRunning(cwd, runId, nodeId, ageMs) {
  const p = join(cwd, '.harness-run', 'broker', 'runs', `${runId}.json`);
  const run = JSON.parse(readFileSync(p, 'utf8'));
  const n = run.nodes.find((x) => x.node_id === nodeId);
  n.state = 'running';
  n.started_at = Date.now() - ageMs;
  writeFileSync(p, JSON.stringify(run, null, 2));
}

test('a node stranded in running is reclaimed once it is stale', async () => {
  const cwd = repo();
  const c = await new Client().init();
  try {
    const { run_id } = await c.call('graph_open', { request: 'r', cwd, vendor: 'self' });
    forceRunning(cwd, run_id, 'plan', 60 * 60 * 1000);

    const nx = await c.call('graph_next', { run_id, cwd });
    assert.deepEqual(nx.ready.map((n) => n.node_id), [], 'a failed plan blocks the graph');
    const st = await c.call('graph_status', { run_id, cwd });
    const plan = st.nodes.find((n) => n.node_id === 'plan');
    assert.equal(plan.state, 'failed');
    assert.match(plan.reason, /abandoned/);
  } finally {
    c.close();
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('a node that only just started is left alone', async () => {
  const cwd = repo();
  const c = await new Client().init();
  try {
    const { run_id } = await c.call('graph_open', { request: 'r', cwd, vendor: 'self' });
    forceRunning(cwd, run_id, 'plan', 1000);
    const st = await c.call('graph_status', { run_id, cwd });
    assert.equal(st.nodes.find((n) => n.node_id === 'plan').state, 'running',
      'a live node must not be reclaimed out from under the broker running it');
  } finally {
    c.close();
    rmSync(cwd, { recursive: true, force: true });
  }
});

// ---------- a verdict that never arrived ----------
// `!== false` treated a missing field as a pass, so a vendor returning an
// implement-shaped result for a test node, or a gate returning no verdict, went through.

test('a test node with no verified field fails rather than passing by default', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    await throughCritique(c, cwd, runId);
    const f = dirty(cwd);
    await c.call('graph_submit', { run_id: runId, cwd, node_id: 'implement:U1:1', payload: ok({ changed_files: [f] }) });
    const v = await c.call('graph_submit', {
      run_id: runId, cwd, node_id: 'test:U1:1', payload: ok({ checks: ['ran something'] }),
    });
    assert.equal(v.state, 'failed');
    assert.equal(v.missing_verdict, 'verified');
  }, { isolated: true });
});

test('a gate with no accept field fails rather than passing by default', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    await throughCritique(c, cwd, runId);
    const f = dirty(cwd);
    await c.call('graph_submit', { run_id: runId, cwd, node_id: 'implement:U1:1', payload: ok({ changed_files: [f] }) });
    await c.call('graph_submit', { run_id: runId, cwd, node_id: 'test:U1:1', payload: ok({ verified: true }) });
    const v = await c.call('graph_submit', {
      run_id: runId, cwd, node_id: 'gate:U1:1', payload: ok({ match_pct: 90, reason: 'looks fine' }),
    });
    assert.equal(v.state, 'failed');
    assert.equal(v.missing_verdict, 'accept');
  }, { isolated: true });
});

test('a critique with no sound field fails rather than passing by default', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    await c.call('graph_submit', { run_id: runId, cwd, node_id: 'plan', payload: ok({ handoff: 'p' }) });
    await c.call('graph_submit', { run_id: runId, cwd, node_id: 'setgoal', payload: ok({ spec: SPEC }) });
    const v = await c.call('graph_submit', { run_id: runId, cwd, node_id: 'critique', payload: ok({ problems: [] }) });
    assert.equal(v.state, 'failed');
    assert.equal(v.missing_verdict, 'sound');
  });
});

// ---------- isolation must stay true ----------
// `isolated` is the broker's own claim that one node had the worktree to itself; it is
// what makes changed_files_verified:true mean anything. Offering two independent
// implement nodes at once invited the orchestrator to falsify it.

const THREE = {
  goal: 'G', acceptance: ['A'],
  subgoals: [
    { id: 'U1', title: 'a', acceptance: ['a'], deps: [] },
    { id: 'U2', title: 'b', acceptance: ['b'], deps: [] },
    { id: 'U3', title: 'c', acceptance: ['c'], deps: ['U1'] },
  ],
};

async function upToSubgoals(c, cwd, runId, spec) {
  await c.call('graph_submit', { run_id: runId, cwd, node_id: 'plan', payload: ok({ handoff: 'p' }) });
  await c.call('graph_submit', { run_id: runId, cwd, node_id: 'setgoal', payload: ok({ spec }) });
  await c.call('graph_submit', { run_id: runId, cwd, node_id: 'critique', payload: ok({ sound: true }) });
}

test('an isolated run offers one mutating node at a time', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    await upToSubgoals(c, cwd, runId, THREE);
    const nx = await c.call('graph_next', { run_id: runId, cwd });
    assert.equal(nx.ready.length, 1, 'two implement nodes at once would falsify the isolation claim');
    assert.equal(nx.ready[0].node_id, 'implement:U1:1');
  }, { isolated: true });
});

test('a shared run may offer independent nodes together', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    await upToSubgoals(c, cwd, runId, THREE);
    const nx = await c.call('graph_next', { run_id: runId, cwd });
    assert.deepEqual(nx.ready.map((n) => n.node_id), ['implement:U1:1', 'implement:U2:1'],
      'without an isolation claim there is nothing to protect');
  });
});

// ---------- the server must stay alive while a node runs ----------
// spawnSync froze the whole server for the length of a node - measured at 12 minutes on
// a real implement node. ping went unanswered, status could not be read, and nothing
// could be cancelled: a client watching for liveness would have concluded it had died.

const SLOW_ADAPTER = `#!/usr/bin/env node
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
const args = process.argv.slice(2);
const get = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const out = get('--output');
mkdirSync(dirname(out), { recursive: true });
if (args.includes('--detect')) {
  writeFileSync(out, JSON.stringify({ ok: true, codex: { ready: true, reachable: true } }));
  process.exit(0);
}
setTimeout(() => {
  writeFileSync(out, JSON.stringify({ ok: true, last_message: '{"stage_ok":true,"handoff":"h","evidence":"e"}' }));
  process.exit(0);
}, Number(process.env.SLOW_MS || 4000));
`;

function repoWithSlowVendor() {
  const dir = repo();
  const adapter = join(dir, 'slow-adapter.mjs');
  writeFileSync(adapter, SLOW_ADAPTER);
  mkdirSync(join(dir, '.claude'), { recursive: true });
  writeFileSync(join(dir, '.claude', 'broker-vendors.json'), JSON.stringify({
    slow: { command: 'node', args: [adapter], sandboxes: ['read-only', 'workspace-write'], default_sandbox: 'workspace-write' },
  }));
  return dir;
}

// The Client above resolves replies in order, which cannot express "answer B while A is
// still open". This one keys by id and collects notifications.
class AsyncClient {
  constructor(env) {
    this.proc = spawn('node', [BROKER], { stdio: ['pipe', 'pipe', 'inherit'], env: { ...process.env, ...env } });
    this.buf = '';
    this.id = 0;
    this.pending = new Map();
    this.notifications = [];
    this.proc.stdout.setEncoding('utf8');
    this.proc.stdout.on('data', (chunk) => {
      this.buf += chunk;
      let nl;
      while ((nl = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, nl);
        this.buf = this.buf.slice(nl + 1);
        if (!line.trim()) continue;
        const d = JSON.parse(line);
        if (d.method === 'notifications/progress') this.notifications.push(d.params);
        else if (this.pending.has(d.id)) { this.pending.get(d.id)(d); this.pending.delete(d.id); }
      }
    });
  }
  request(method, params) {
    const id = ++this.id;
    const p = new Promise((resolve) => this.pending.set(id, resolve));
    this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    return { id, done: p };
  }
  notify(method, params) {
    this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  }
  async init() { await this.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } }).done; return this; }
  async call(name, args, meta) { const r = await this.request('tools/call', { name, arguments: args, ...(meta ? { _meta: meta } : {}) }).done; return (r.result || {}).structuredContent; }
  close() { this.proc.stdin.end(); this.proc.kill(); }
}

async function slowRun(fn, env) {
  const cwd = repoWithSlowVendor();
  const c = await new AsyncClient(env).init();
  try {
    const { run_id } = await c.call('graph_open', { request: 'r', cwd, vendor: 'slow' });
    await fn({ c, cwd, runId: run_id });
  } finally {
    c.close();
    rmSync(cwd, { recursive: true, force: true });
  }
}

test('ping is answered while a node is still running', async () => {
  await slowRun(async ({ c, cwd, runId }) => {
    const run = c.request('tools/call', { name: 'graph_run', arguments: { run_id: runId, cwd, node_id: 'plan' } });
    const t0 = Date.now();
    await c.request('ping', {}).done;
    const pingMs = Date.now() - t0;
    assert.ok(pingMs < 2000, `ping took ${pingMs}ms - the server was blocked by the node`);
    const st = await c.call('graph_status', { run_id: runId, cwd });
    assert.equal(st.nodes.find((n) => n.node_id === 'plan').state, 'running');
    await run.done;
  }, { SLOW_MS: '5000' });
});

test('a running node can be cancelled', async () => {
  await slowRun(async ({ c, cwd, runId }) => {
    const run = c.request('tools/call', {
      name: 'graph_run', arguments: { run_id: runId, cwd, node_id: 'plan' },
    });
    setTimeout(() => c.notify('notifications/cancelled', { requestId: run.id, reason: 'test' }), 800);
    const r = await run.done;
    const v = r.result.structuredContent;
    assert.equal(v.state, 'failed');
    assert.equal(v.killed_for, 'cancelled');
    assert.match(v.reason, /cancelled by the client/);
  }, { SLOW_MS: '30000' });
});

test('a node that overruns its timeout is killed', async () => {
  await slowRun(async ({ c, cwd, runId }) => {
    const v = await c.call('graph_run', { run_id: runId, cwd, node_id: 'plan' });
    assert.equal(v.state, 'failed');
    assert.equal(v.killed_for, 'timeout');
    assert.match(v.reason, /timeout/);
  }, { SLOW_MS: '30000', BROKER_NODE_TIMEOUT_MS: '1500' });
});

test('a progressToken produces progress notifications, starting immediately', async () => {
  await slowRun(async ({ c, cwd, runId }) => {
    await c.call('graph_run', { run_id: runId, cwd, node_id: 'plan' }, { progressToken: 'tok' });
    assert.ok(c.notifications.length >= 1, 'no progress was reported at all');
    assert.equal(c.notifications[0].progressToken, 'tok');
    assert.match(c.notifications[0].message, /graph_run plan/);
  }, { SLOW_MS: '2000' });
});
