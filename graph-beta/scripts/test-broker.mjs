#!/usr/bin/env node
// Regression suite for the graph-beta-engineering MCP server.
//
// Every case here is a bug that actually shipped and was caught by running a real
// graph, not by reading the code. They run against the live MCP surface over stdio
// with vendor:"self", so no vendor CLI is needed and the whole file finishes in
// seconds.
//
//   node --test graph/scripts/test-broker.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, readFileSync, rmSync, utimesSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const BROKER = join(dirname(fileURLToPath(import.meta.url)), '..', 'mcp', 'broker.mjs');
const CODEX_ADAPTER = join(dirname(fileURLToPath(import.meta.url)), '..', 'adapters', 'codex-exec-adapter.mjs');
const CLAUDE_ADAPTER = join(dirname(fileURLToPath(import.meta.url)), '..', 'adapters', 'claude-exec-adapter.mjs');

// ---------- a minimal MCP client ----------

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

// ---------- settled failure: order-only edges and the unreachable set ----------
// A subgoal that ran out of retries left the run `blocked` forever: gate:goal could never
// be satisfied, the report hung behind it, and the subgoals that HAD passed were never
// reported. Failure is settled at the moment the budget is gone, everything that needed the
// dead node becomes `unreachable`, and the report - order-only on the goal gate - runs.

const INDEPENDENT = {
  goal: 'G',
  acceptance: ['A'],
  subgoals: [
    { id: 'U1', title: 'first', acceptance: ['a'], test: ['t'], deps: [] },
    { id: 'U2', title: 'second', acceptance: ['b'], test: ['t'], deps: [] },
  ],
};

async function throughCritiqueWith(c, cwd, runId, spec) {
  await c.call('graph_submit', { run_id: runId, cwd, node_id: 'plan', payload: ok({ handoff: 'p' }) });
  await c.call('graph_submit', { run_id: runId, cwd, node_id: 'setgoal', payload: ok({ spec, handoff: 's' }) });
  await c.call('graph_submit', { run_id: runId, cwd, node_id: 'critique', payload: ok({ sound: true }) });
}

async function passSubgoal(c, cwd, runId, sg, attempt = 1) {
  const f = dirty(cwd);
  await c.call('graph_submit', { run_id: runId, cwd, node_id: `implement:${sg}:${attempt}`, payload: ok({ changed_files: [f], handoff: `built ${sg}` }) });
  await c.call('graph_submit', { run_id: runId, cwd, node_id: `test:${sg}:${attempt}`, payload: ok({ verified: true }) });
  await c.call('graph_submit', { run_id: runId, cwd, node_id: `gate:${sg}:${attempt}`, payload: ok({ accept: true, match_pct: 95 }) });
}

test('exhausting a subgoal settles it: its downstream is unreachable and the report is released', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    await throughCritiqueWith(c, cwd, runId, INDEPENDENT);
    await c.call('graph_submit', { run_id: runId, cwd, node_id: 'implement:U1:1', payload: ok({ changed_files: ['ghost.js'], handoff: 'claimed' }) });
    await passSubgoal(c, cwd, runId, 'U2');
    let nx = await c.call('graph_next', { run_id: runId, cwd });
    assert.equal(nx.state, 'blocked', 'with U1 failed and U2 done, nothing is runnable yet');

    const r = await c.call('graph_retry', { run_id: runId, cwd, subgoal_id: 'U1' });
    assert.equal(r.retried, false);
    assert.match(r.reason, /budget/);
    assert.deepEqual(r.unreachable.sort(), ['gate:U1:1', 'gate:goal:1', 'test:U1:1'],
      'everything that needed the dead implement through a data edge is written off - transitively');
    assert.equal(r.state, 'running', 'the run is not blocked: the report can run');
    assert.deepEqual(r.ready.map((n) => n.node_id), ['report']);

    const st = await c.call('graph_status', { run_id: runId, cwd });
    assert.equal(st.counts.unreachable, 3);
    const goal = st.nodes.find((n) => n.node_id === 'gate:goal:1');
    assert.equal(goal.state, 'unreachable');
    assert.match(goal.reason, /gate:U1:1 is unreachable/);

    nx = await c.call('graph_next', { run_id: runId, cwd });
    const brief = readFileSync(nx.ready.find((n) => n.stage === 'report').briefing_path, 'utf8');
    assert.match(brief, /built U2/, 'the partial success must reach the report');
    assert.match(brief, /ghost\.js/, 'and so must the failure that stopped U1');
    assert.match(brief, /gate:goal:1 \(gate\) — unreachable/);

    const v = await c.call('graph_submit', { run_id: runId, cwd, node_id: 'report', payload: ok({ handoff: 'U2 shipped; U1 did not' }) });
    assert.equal(v.state, 'done');
    assert.equal((await c.call('graph_status', { run_id: runId, cwd })).state, 'complete');
  }, { max_retries: 0 });
});

test('a failure with retries left does not release the report', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    await throughCritiqueWith(c, cwd, runId, INDEPENDENT);
    await c.call('graph_submit', { run_id: runId, cwd, node_id: 'implement:U1:1', payload: ok({ changed_files: ['ghost.js'] }) });
    await passSubgoal(c, cwd, runId, 'U2');
    const nx = await c.call('graph_next', { run_id: runId, cwd });
    assert.equal(nx.ready.some((n) => n.stage === 'report'), false, 'a plain failed gate is a retry waiting to happen, not a settled outcome');
    const r = await c.call('graph_submit', { run_id: runId, cwd, node_id: 'report', payload: ok({ handoff: 'too early' }) });
    assert.match(r.error, /blocked on gate:goal:1/);
  });
});

test('a spec-level `after` edge orders a subgoal without requiring the other to pass', async () => {
  const spec = {
    ...INDEPENDENT,
    subgoals: [
      { id: 'U1', title: 'first', acceptance: ['a'], test: ['t'], deps: [] },
      { id: 'U2', title: 'second', acceptance: ['b'], test: ['t'], deps: [], after: ['U1'] },
    ],
  };
  await withRun(async ({ c, cwd, runId }) => {
    await throughCritiqueWith(c, cwd, runId, spec);
    let nx = await c.call('graph_next', { run_id: runId, cwd });
    assert.deepEqual(nx.ready.map((n) => n.node_id), ['implement:U1:1'], 'U2 waits for U1 to finish');
    const st = await c.call('graph_status', { run_id: runId, cwd });
    const u2 = st.nodes.find((n) => n.node_id === 'implement:U2:1');
    assert.deepEqual(u2.after, ['gate:U1:1']);
    assert.equal(u2.deps.includes('gate:U1:1'), false, 'order-only, not a data dependency');

    await c.call('graph_submit', { run_id: runId, cwd, node_id: 'implement:U1:1', payload: ok({ changed_files: ['ghost.js'] }) });
    nx = await c.call('graph_next', { run_id: runId, cwd });
    assert.equal(nx.state, 'blocked', 'U1 merely failed: its gate is not settled, so U2 still waits');

    const r = await c.call('graph_retry', { run_id: runId, cwd, subgoal_id: 'U1' });
    assert.equal(r.retried, false);
    assert.ok(r.ready.map((n) => n.node_id).includes('implement:U2:1'), 'once U1 is settled as failed, U2 may run');
  }, { max_retries: 0 });
});

test('an `after` naming a missing subgoal, or closing a cycle, is caught like a dep', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    const v = await setgoalWith(c, cwd, runId, {
      spec: { goal: 'G', acceptance: ['A'], subgoals: [{ id: 'U1', title: 't', acceptance: ['a'], after: ['nope'] }] },
    });
    assert.equal(v.state, 'failed');
    assert.match(v.reason, /ordered after nope/);
  });
  await withRun(async ({ c, cwd, runId }) => {
    const v = await setgoalWith(c, cwd, runId, {
      spec: { goal: 'G', acceptance: ['A'], subgoals: [
        { id: 'U1', title: 't', acceptance: ['a'], after: ['U2'] },
        { id: 'U2', title: 't', acceptance: ['a'], deps: ['U1'] },
      ] },
    });
    assert.equal(v.state, 'failed');
    assert.match(v.reason, /cycle/);
  });
});

test('exhausting the spec retry settles the rebuilt graph and releases its report', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    await c.call('graph_submit', { run_id: runId, cwd, node_id: 'plan', payload: ok({ handoff: 'p' }) });
    await c.call('graph_submit', { run_id: runId, cwd, node_id: 'setgoal', payload: ok({ spec: SPEC }) });
    await c.call('graph_submit', { run_id: runId, cwd, node_id: 'critique', payload: ok({ sound: false, problems: ['vague'] }) });
    assert.equal((await c.call('graph_retry', { run_id: runId, cwd })).retried, true);
    await c.call('graph_submit', { run_id: runId, cwd, node_id: 'setgoal:2', payload: ok({ spec: SPEC }) });
    await c.call('graph_submit', { run_id: runId, cwd, node_id: 'critique:2', payload: ok({ sound: false, blocking: ['still vague'], problems: ['nit'] }) });

    const r = await c.call('graph_retry', { run_id: runId, cwd });
    assert.equal(r.retried, false);
    assert.ok(r.unreachable.includes('implement:U1:2') && r.unreachable.includes('gate:goal:2'),
      'the graph the rejected spec produced can never run');
    assert.deepEqual(r.ready.map((n) => n.node_id), ['report:2']);
    const brief = readFileSync(r.ready[0].briefing_path, 'utf8');
    assert.match(brief, /critique:2 \(critique\) — failed .*sound=false/);
    assert.match(brief, /still vague/, 'the report must see why the spec died');
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

test('a subgoal with an unknown kind is caught at setgoal, not left to expand into nothing', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    const v = await setgoalWith(c, cwd, runId, {
      spec: { goal: 'G', acceptance: ['A'], subgoals: [{ id: 'U1', title: 't', acceptance: ['a'], kind: 'sculpture' }] },
    });
    assert.equal(v.state, 'failed');
    assert.match(v.reason, /unknown kind sculpture/);
  });
});

test('a rejected goal gate is re-judged after the subgoal retry, instead of wedging the run', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    await throughCritiqueWith(c, cwd, runId, INDEPENDENT);
    await passSubgoal(c, cwd, runId, 'U1');
    await passSubgoal(c, cwd, runId, 'U2');
    const g = await c.call('graph_submit', { run_id: runId, cwd, node_id: 'gate:goal:1', payload: ok({ accept: false, match_pct: 50, gaps: ['U2 never wired to U1'], reason: 'halves do not meet' }) });
    assert.equal(g.state, 'failed');
    let nx = await c.call('graph_next', { run_id: runId, cwd });
    assert.equal(nx.state, 'blocked', 'a rejection with retries left holds the report');
    const rt = await c.call('graph_retry', { run_id: runId, cwd, subgoal_id: 'U2' });
    assert.equal(rt.retried, true);
    const prompt = readFileSync(rt.ready.find((n) => n.node_id === 'implement:U2:2').briefing_path, 'utf8');
    assert.match(prompt, /goal gate gate:goal:1: halves do not meet/, 'the retried subgoal hears why the whole was rejected');
    assert.match(prompt, /U2 never wired to U1/);
    await passSubgoal(c, cwd, runId, 'U2', 2);
    nx = await c.call('graph_next', { run_id: runId, cwd });
    assert.deepEqual(nx.ready.map((n) => n.node_id), ['gate:goal:2'], 'a fresh goal gate judges the rebuilt whole');
    const st = await c.call('graph_status', { run_id: runId, cwd });
    assert.equal(st.nodes.find((n) => n.node_id === 'gate:goal:1').state, 'failed', 'the rejection stays as evidence');
    assert.deepEqual(st.nodes.find((n) => n.node_id === 'gate:goal:2').deps.sort(), ['gate:U1:1', 'gate:U2:2']);
    assert.deepEqual(st.nodes.find((n) => n.node_id === 'report').after, ['gate:goal:2']);
    const gatePrompt = readFileSync(nx.ready[0].briefing_path, 'utf8');
    assert.match(gatePrompt, /Previous attempt was rejected[\s\S]*U2 never wired to U1/);
    await c.call('graph_submit', { run_id: runId, cwd, node_id: 'gate:goal:2', payload: ok({ accept: true, match_pct: 90 }) });
    nx = await c.call('graph_next', { run_id: runId, cwd });
    assert.deepEqual(nx.ready.map((n) => n.node_id), ['report']);
    await c.call('graph_submit', { run_id: runId, cwd, node_id: 'report', payload: ok({ handoff: 'done' }) });
    assert.equal((await c.call('graph_status', { run_id: runId, cwd })).state, 'complete');
  });
});

// ---------- document kind ----------

const MIXED = {
  goal: 'G',
  acceptance: ['A'],
  subgoals: [
    { id: 'U1', title: 'code', acceptance: ['a'], test: ['t'], deps: [] },
    { id: 'U2', title: 'more code', acceptance: ['b'], test: ['t'], deps: ['U1'] },
    { id: 'D1', kind: 'document', title: 'design note', acceptance: ['names the two modules', 'states the invariant'], files: ['doc.md'], deps: ['U1'] },
  ],
};

test('a mixed spec expands each subgoal by its kind and reaches the report', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    await throughCritiqueWith(c, cwd, runId, MIXED);
    const st = await c.call('graph_status', { run_id: runId, cwd });
    const ids = st.nodes.map((n) => n.node_id);
    assert.ok(ids.includes('implement:U1:1') && ids.includes('test:U1:1') && ids.includes('gate:U1:1'));
    assert.ok(ids.includes('draft:D1:1') && ids.includes('review:D1:1') && ids.includes('gate:D1:1'));
    assert.ok(!ids.includes('implement:D1:1') && !ids.includes('test:D1:1'), 'a document has no implement/test');
    const draft = st.nodes.find((n) => n.node_id === 'draft:D1:1');
    assert.deepEqual(draft.deps, ['critique', 'gate:U1:1'], 'the chain head carries the subgoal deps');
    assert.deepEqual(st.nodes.find((n) => n.node_id === 'review:D1:1').deps, ['draft:D1:1']);
    assert.ok(st.nodes.find((n) => n.node_id === 'gate:goal:1').deps.includes('gate:D1:1'), 'the goal gate collects the document gate');

    await passSubgoal(c, cwd, runId, 'U1');
    await passSubgoal(c, cwd, runId, 'U2');
    writeFileSync(join(cwd, 'doc.md'), '# note\nmodules: a, b\ninvariant: x\n');
    const d = await c.call('graph_submit', { run_id: runId, cwd, node_id: 'draft:D1:1', payload: ok({ changed_files: ['doc.md'], handoff: 'doc.md — a note' }) });
    assert.equal(d.state, 'done', JSON.stringify(d));
    const r = await c.call('graph_submit', { run_id: runId, cwd, node_id: 'review:D1:1', payload: ok({ verified: true, checks: ['names the two modules -> "modules: a, b"'] }) });
    assert.equal(r.state, 'done');
    assert.equal(r.verified, true);
    assert.equal(r.reviewer_independence, 'unverifiable-self', 'self cannot be checked, and the verdict says so');
    await c.call('graph_submit', { run_id: runId, cwd, node_id: 'gate:D1:1', payload: ok({ accept: true, match_pct: 90 }) });
    await c.call('graph_submit', { run_id: runId, cwd, node_id: 'gate:goal:1', payload: ok({ accept: true, match_pct: 90 }) });
    const nx = await c.call('graph_next', { run_id: runId, cwd });
    assert.deepEqual(nx.ready.map((n) => n.node_id), ['report']);
    await c.call('graph_submit', { run_id: runId, cwd, node_id: 'report', payload: ok({ handoff: 'done' }) });
    assert.equal((await c.call('graph_status', { run_id: runId, cwd })).state, 'complete');
  });
});

test('a document draft that changed no file is unattributed, not contradicted; a code implement still is', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    await throughCritiqueWith(c, cwd, runId, {
      goal: 'G', acceptance: ['A'],
      subgoals: [
        { id: 'D1', kind: 'document', title: 'inline answer', acceptance: ['a'], deps: [] },
        { id: 'U1', title: 'code', acceptance: ['a'], test: ['t'], deps: [] },
      ],
    });
    const d = await c.call('graph_submit', { run_id: runId, cwd, node_id: 'draft:D1:1', payload: ok({ changed_files: [], handoff: 'the whole note is here in the handoff' }) });
    assert.equal(d.state, 'done', JSON.stringify(d));
    assert.equal(d.stage_ok, true);
    assert.equal(d.changed_files_verified, null);
    assert.equal(d.change_attribution, 'document-unchanged');
    // The same empty claim from a code node is untouched behaviour: under isolation it
    // still verifies, because for code "nothing changed" is a claim git can confirm.
    const i = await c.call('graph_submit', { run_id: runId, cwd, node_id: 'implement:U1:1', payload: ok({ changed_files: [], handoff: 'h' }) });
    assert.equal(i.change_attribution, 'isolated');
    assert.equal(i.changed_files_verified, true);
  }, { isolated: true });
});

test('a review without a verdict fails, and a review is briefed as a reasoning node', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    await throughCritiqueWith(c, cwd, runId, {
      goal: 'G', acceptance: ['A'],
      subgoals: [{ id: 'D1', kind: 'document', title: 'note', acceptance: ['a'], files: ['doc.md'], deps: [] }],
    });
    let nx = await c.call('graph_next', { run_id: runId, cwd });
    const draftPrompt = readFileSync(nx.ready.find((n) => n.node_id === 'draft:D1:1').briefing_path, 'utf8');
    assert.match(draftPrompt, /Kind: document/);
    assert.match(draftPrompt, /one-paragraph abstract/);
    assert.doesNotMatch(draftPrompt, /This is a reasoning node/, 'a draft writes the artifact');
    writeFileSync(join(cwd, 'doc.md'), 'x\n');
    await c.call('graph_submit', { run_id: runId, cwd, node_id: 'draft:D1:1', payload: ok({ changed_files: ['doc.md'], handoff: 'doc.md' }) });
    nx = await c.call('graph_next', { run_id: runId, cwd });
    const reviewPrompt = readFileSync(nx.ready.find((n) => n.node_id === 'review:D1:1').briefing_path, 'utf8');
    assert.match(reviewPrompt, /This is a reasoning node/);
    assert.match(reviewPrompt, /You are the reader, not the author/);
    assert.match(reviewPrompt, /doc\.md/, 'the review sees the paths the draft reported');
    const r = await c.call('graph_submit', { run_id: runId, cwd, node_id: 'review:D1:1', payload: ok({ checks: ['read it'] }) });
    assert.equal(r.state, 'failed');
    assert.equal(r.missing_verdict, 'verified');
  });
});

test('a rejected document gets a fresh draft, and the goal gate waits for the new review chain', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    await throughCritiqueWith(c, cwd, runId, {
      goal: 'G', acceptance: ['A'],
      subgoals: [{ id: 'D1', kind: 'document', title: 'note', acceptance: ['a'], deps: [] }],
    });
    await c.call('graph_submit', { run_id: runId, cwd, node_id: 'draft:D1:1', payload: ok({ changed_files: [], handoff: 'v1' }) });
    await c.call('graph_submit', { run_id: runId, cwd, node_id: 'review:D1:1', payload: ok({ verified: false, checks: ['a -> MISSING: the invariant'] }) });
    const rt = await c.call('graph_retry', { run_id: runId, cwd, subgoal_id: 'D1' });
    assert.equal(rt.retried, true);
    assert.equal(rt.attempt, 2);
    const st = await c.call('graph_status', { run_id: runId, cwd });
    const ids = st.nodes.map((n) => n.node_id);
    assert.ok(ids.includes('draft:D1:2') && ids.includes('review:D1:2') && ids.includes('gate:D1:2'));
    assert.equal(st.nodes.find((n) => n.node_id === 'gate:D1:1').state, 'skipped');
    assert.deepEqual(st.nodes.find((n) => n.node_id === 'gate:goal:1').deps, ['gate:D1:2']);
    const nx = await c.call('graph_next', { run_id: runId, cwd });
    const prompt = readFileSync(nx.ready.find((n) => n.node_id === 'draft:D1:2').briefing_path, 'utf8');
    assert.match(prompt, /Previous attempt was rejected/, 'the review\'s gaps reach the second draft');
  });
});

// ---------- flow ----------

test('flow document with mixed=false rejects a spec that carries a code subgoal', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    // U1 says it is code; U2 says nothing and so follows the flow; D1 is a document.
    const v = await setgoalWith(c, cwd, runId, { spec: { ...MIXED, subgoals: [
      { ...MIXED.subgoals[0], kind: 'subgoal' }, MIXED.subgoals[1], MIXED.subgoals[2],
    ] } });
    assert.equal(v.state, 'failed');
    assert.match(v.reason, /subgoal U1 has kind subgoal, but this run is flow document with mixed=false/);
    assert.doesNotMatch(v.reason, /subgoal U2/, 'an unnamed kind takes the flow and is not a violation');
    assert.doesNotMatch(v.reason, /subgoal D1/);
  }, { flow: 'document', mixed: false });
});

test('a fixed flow supplies the kind a subgoal did not name, and the entry choice is visible', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    const open = await c.call('graph_status', { run_id: runId, cwd });
    assert.equal(open.flow, 'document');
    assert.equal(open.mixed, true);
    let nx = await c.call('graph_next', { run_id: runId, cwd });
    assert.match(readFileSync(nx.ready[0].briefing_path, 'utf8'), /## Flow\ndocument \(fixed by the entry\) — default kind for a subgoal that names none: document/);
    await c.call('graph_submit', { run_id: runId, cwd, node_id: 'plan', payload: ok({ handoff: 'p' }) });
    nx = await c.call('graph_next', { run_id: runId, cwd });
    assert.match(readFileSync(nx.ready[0].briefing_path, 'utf8'), /Personas to draw from:\n- technical writer/);
    // SPEC names no kinds: under the document flow it is two documents, plus one code subgoal by name.
    await c.call('graph_submit', { run_id: runId, cwd, node_id: 'setgoal', payload: ok({ spec: {
      ...SPEC, subgoals: [...SPEC.subgoals, { id: 'U3', kind: 'subgoal', title: 'code', acceptance: ['c'], test: ['t'], deps: [] }],
    } }) });
    const ids = (await c.call('graph_status', { run_id: runId, cwd })).nodes.map((n) => n.node_id);
    assert.ok(ids.includes('draft:U1:1') && ids.includes('review:U2:1'), 'unnamed kinds follow the flow');
    assert.ok(ids.includes('implement:U3:1'), 'a named kind still wins under mixed=true');
    assert.ok(!ids.includes('implement:U1:1'));
  }, { flow: 'document' });
});

test('under auto, plan chooses the flow and measures the size; a plan that says nothing defaults to develop', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    let nx = await c.call('graph_next', { run_id: runId, cwd });
    assert.equal(nx.flow, 'auto');
    assert.equal(nx.size, undefined);
    assert.match(readFileSync(nx.ready[0].briefing_path, 'utf8'), /## Flow\nauto — plan decides/);
    await c.call('graph_submit', { run_id: runId, cwd, node_id: 'plan', payload: ok({ handoff: 'p', flow: 'document', size: 'S', sizing: ['ls docs -> 3 files'] }) });
    nx = await c.call('graph_next', { run_id: runId, cwd });
    assert.equal(nx.flow, 'document');
    assert.equal(nx.size, 'S');
    assert.match(readFileSync(nx.ready[0].briefing_path, 'utf8'), /document \(chosen by plan\)/);
    await c.call('graph_submit', { run_id: runId, cwd, node_id: 'setgoal', payload: ok({ spec: SPEC }) });
    const st = await c.call('graph_status', { run_id: runId, cwd });
    assert.equal(st.flow, 'document');
    assert.ok(st.nodes.some((n) => n.node_id === 'draft:U1:1'), 'the chosen flow supplies the default kind');
    const full = await c.call('graph_status', { run_id: runId, cwd, full: true });
    assert.equal(full.flow_source, 'plan');
  });
  await withRun(async ({ c, cwd, runId }) => {
    await c.call('graph_submit', { run_id: runId, cwd, node_id: 'plan', payload: ok({ handoff: 'p' }) });
    const nx = await c.call('graph_next', { run_id: runId, cwd });
    assert.equal(nx.flow, 'develop');
    const full = await c.call('graph_status', { run_id: runId, cwd, full: true });
    assert.equal(full.flow_source, 'default', 'a defaulted choice is recorded as such, not passed off as a decision');
  });
});

// A vendor that writes a document when asked to draft and answers as a reader when asked to
// review. Both run under one vendor name so the broker sees identical identities.
function documentRepo() {
  const dir = repo();
  const adapter = join(dir, 'ink-adapter.mjs');
  writeFileSync(adapter, `
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
const a = process.argv.slice(2), get = k => a[a.indexOf(k) + 1];
const out = get('--output'); mkdirSync(dirname(out), { recursive: true });
if (a.includes('--detect')) { writeFileSync(out, JSON.stringify({ vendor: { ready: true, reachable: true } })); process.exit(0); }
const stage = readFileSync(get('--prompt-file'), 'utf8').match(/^# (\\w+) node/)[1];
const result = { stage_ok: true, handoff: 'read', evidence: 'e', checks: ['c'], verified: true };
if (stage === 'draft') { writeFileSync(join(get('--cwd'), 'doc.md'), 'the note\\n'); result.changed_files = ['doc.md']; result.handoff = 'doc.md — the note'; }
writeFileSync(out, JSON.stringify({ stage_ok: true, result }));
`);
  mkdirSync(join(dir, '.claude'), { recursive: true });
  writeFileSync(join(dir, '.claude', 'broker-vendors.json'), JSON.stringify({
    ink: { command: 'node', args: [adapter], requires_binary: null, sandboxes: ['read-only', 'workspace-write'], default_sandbox: 'workspace-write' },
  }));
  return dir;
}

test('a review routed to the identity that wrote the draft is refused, and the node stays open for rerouting', async () => {
  const cwd = documentRepo();
  const c = await new Client().init();
  try {
    const { run_id } = await c.call('graph_open', {
      request: 'r', cwd, vendor: 'self',
      policy: { draft: { vendor: 'ink', model: 'm1' }, review: { vendor: 'ink', model: 'm1' } },
    });
    await throughCritiqueWith(c, cwd, run_id, {
      goal: 'G', acceptance: ['A'],
      subgoals: [{ id: 'D1', kind: 'document', title: 'note', acceptance: ['a'], files: ['doc.md'], deps: [] }],
    });
    const d = await c.call('graph_run', { run_id, cwd, node_id: 'draft:D1:1' });
    assert.equal(d.state, 'done', JSON.stringify(d));
    assert.equal(d.executor, 'ink');
    assert.equal(d.model, 'm1');

    const refused = await c.call('graph_run', { run_id, cwd, node_id: 'review:D1:1' });
    assert.match(refused.error, /someone other than its author/);
    assert.match(refused.error, /ink@m1/);
    const st = await c.call('graph_status', { run_id, cwd, node_id: 'review:D1:1' });
    assert.equal(st.nodes[0].state, 'pending', 'a routing mistake costs no retry');

    // Same vendor, different model is a different identity.
    const r = await c.call('graph_run', { run_id, cwd, node_id: 'review:D1:1', model: 'm2' });
    assert.equal(r.state, 'done', JSON.stringify(r));
    assert.equal(r.verified, true);
    assert.equal(r.reviewer_independence, 'distinct-identity');
  } finally {
    c.close();
    rmSync(cwd, { recursive: true, force: true });
  }
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
import { writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { dirname } from 'node:path';
const args = process.argv.slice(2);
const get = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const out = get('--output');
mkdirSync(dirname(out), { recursive: true });
if (process.env.FAKE_ARGS_LOG) appendFileSync(process.env.FAKE_ARGS_LOG, JSON.stringify(args) + '\\n');
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
  const p = join(cwd, '.harness-run', 'broker-beta', 'runs', `${runId}.json`);
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

// "which node is running, on what, for how long" was unanswerable: a blocking graph_run
// showed up as a bare state:"running" row, and an operator without the run_id in hand
// could not reach the run at all.
test('an in-flight node names its vendor and elapsed time, with or without a run_id', async () => {
  await slowRun(async ({ c, cwd, runId }) => {
    const run = c.request('tools/call', { name: 'graph_run', arguments: { run_id: runId, cwd, node_id: 'plan' } });
    await c.request('ping', {}).done;
    const node = (await c.call('graph_status', { run_id: runId, cwd })).nodes.find((n) => n.node_id === 'plan');
    assert.equal(node.state, 'running');
    assert.equal(node.executor, 'slow');
    assert.ok(Number.isInteger(node.elapsed_s), `no elapsed_s on the running node: ${JSON.stringify(node)}`);
    const overview = await c.call('graph_status', { cwd });
    const row = overview.runs.find((r) => r.run_id === runId);
    assert.equal(row.state, 'running');
    assert.deepEqual(row.running.map((n) => [n.node_id, n.executor]), [['plan', 'slow']]);
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

// ---------- two brokers on one run ----------
// A run file is read-modify-written by every mutation, and a node can be held open for
// minutes. The slow broker's stale snapshot used to overwrite a node the fast one had
// already finished and reported `done` to its client: the work happened, the record
// vanished.

test('a slow node finishing does not erase a node another broker completed', async () => {
  const cwd = repoWithSlowVendor();
  const slow = await new AsyncClient({ SLOW_MS: '4000' }).init();
  const fast = await new AsyncClient({ SLOW_MS: '100' }).init();
  try {
    const { run_id } = await slow.call('graph_open', { request: 'r', cwd, vendor: 'slow' });
    const sub = (c, node_id, payload) => c.call('graph_submit', { run_id, cwd, node_id, payload: ok(payload) });
    await sub(slow, 'plan', { handoff: 'p' });
    await sub(slow, 'setgoal', {
      spec: {
        goal: 'G', acceptance: ['A'],
        subgoals: [
          { id: 'U1', title: 'a', acceptance: ['a'], deps: [] },
          { id: 'U2', title: 'b', acceptance: ['b'], deps: [] },
        ],
      },
    });
    await sub(slow, 'critique', { sound: true });

    const f = dirty(cwd);
    // the slow broker holds U1 open for seconds; the fast one finishes U2 meanwhile
    const held = slow.call('graph_run', { run_id, cwd, node_id: 'implement:U1:1' });
    await new Promise((r) => setTimeout(r, 1200));
    const other = await sub(fast, 'implement:U2:1', { changed_files: [f], handoff: 'from the fast broker' });
    assert.equal(other.state, 'done', 'the fast broker was told its node completed');
    await held;

    const st = await fast.call('graph_status', { run_id, cwd });
    const u2 = st.nodes.find((n) => n.node_id === 'implement:U2:1');
    assert.equal(u2.state, 'done', 'a node reported done must not revert to pending');
  } finally {
    slow.close();
    fast.close();
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('a stale lock left by a killed broker does not wedge the run', async () => {
  const cwd = repo();
  const c = await new Client().init();
  try {
    const { run_id } = await c.call('graph_open', { request: 'r', cwd, vendor: 'self' });
    // a lock older than the stale window, as a crashed process would leave
    const lock = join(cwd, '.harness-run', 'broker-beta', 'runs', `${run_id}.json.lock`);
    mkdirSync(lock, { recursive: true });
    const past = new Date(Date.now() - 5 * 60 * 1000);
    utimesSync(lock, past, past);

    const v = await c.call('graph_submit', { run_id, cwd, node_id: 'plan', payload: ok({ handoff: 'p' }) });
    assert.equal(v.state, 'done', 'a stale lock must be broken, not waited on forever');
  } finally {
    c.close();
    rmSync(cwd, { recursive: true, force: true });
  }
});

// ---------- the goal gate is the only node that sees the request again ----------
// plan -> setgoal narrows the request into a spec; critique checks the spec's internal
// soundness; subgoal gates check work against the spec. Nothing re-read the request, so
// a run could score 100% against a spec that had quietly asked for less.

test('the goal gate is briefed to judge against the request, not only the spec', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    await throughCritique(c, cwd, runId);
    for (const sg of ['U1', 'U2']) {
      const f = dirty(cwd);
      await c.call('graph_submit', { run_id: runId, cwd, node_id: `implement:${sg}:1`, payload: ok({ changed_files: [f], handoff: `built ${sg}` }) });
      await c.call('graph_submit', { run_id: runId, cwd, node_id: `test:${sg}:1`, payload: ok({ verified: true }) });
      await c.call('graph_submit', { run_id: runId, cwd, node_id: `gate:${sg}:1`, payload: ok({ accept: true, match_pct: 95 }) });
    }
    const nx = await c.call('graph_next', { run_id: runId, cwd });
    const goalGate = nx.ready.find((n) => n.node_id.startsWith('gate:goal'));
    const brief = readFileSync(goalGate.briefing_path, 'utf8');
    assert.match(brief, /spec_drift/, 'the goal gate must be asked where the spec narrowed the request');
    assert.match(brief, /the REQUEST as written/);
    assert.match(brief, /observations/, 'non-blocking weaknesses need somewhere to go');
  }, { isolated: true });
});

test('a subgoal gate is not given the goal-gate contract', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    await throughCritique(c, cwd, runId);
    const f = dirty(cwd);
    await c.call('graph_submit', { run_id: runId, cwd, node_id: 'implement:U1:1', payload: ok({ changed_files: [f] }) });
    await c.call('graph_submit', { run_id: runId, cwd, node_id: 'test:U1:1', payload: ok({ verified: true }) });
    const nx = await c.call('graph_next', { run_id: runId, cwd });
    const brief = readFileSync(nx.ready.find((n) => n.node_id === 'gate:U1:1').briefing_path, 'utf8');
    assert.equal(/spec_drift/.test(brief), false, 'only the goal gate re-reads the request');
    assert.match(brief, /observations/);
  }, { isolated: true });
});

test('observations and spec drift are surfaced but never block acceptance', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    await throughCritique(c, cwd, runId);
    for (const sg of ['U1', 'U2']) {
      const f = dirty(cwd);
      await c.call('graph_submit', { run_id: runId, cwd, node_id: `implement:${sg}:1`, payload: ok({ changed_files: [f] }) });
      await c.call('graph_submit', { run_id: runId, cwd, node_id: `test:${sg}:1`, payload: ok({ verified: true }) });
      await c.call('graph_submit', { run_id: runId, cwd, node_id: `gate:${sg}:1`, payload: ok({ accept: true, match_pct: 90 }) });
    }
    const nx = await c.call('graph_next', { run_id: runId, cwd });
    const goalGate = nx.ready.find((n) => n.node_id.startsWith('gate:goal'));
    const v = await c.call('graph_submit', {
      run_id: runId, cwd, node_id: goalGate.node_id,
      payload: ok({ accept: true, match_pct: 88, gaps: [], observations: ['no null guard'], spec_drift: ['request said url-safe generally'] }),
    });
    assert.equal(v.state, 'done', 'observations must not block a run that met its bar');
    assert.equal(v.observation_count, 1);
    assert.equal(v.spec_drift_count, 1);
  }, { isolated: true });
});

// ---------- a judging node must be given the evidence it is asked to weigh ----------
// A gate briefed with prose alone correctly refused: "no raw output or exit status was
// provided". It was being asked to prove something from material it never received.

test('a gate is briefed with the checks and commands its upstream reported', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    await throughCritique(c, cwd, runId);
    const f = dirty(cwd);
    await c.call('graph_submit', {
      run_id: runId, cwd, node_id: 'implement:U1:1',
      payload: ok({ changed_files: [f], handoff: 'built it', checks: ['node -e probe -> printed OK'] }),
    });
    await c.call('graph_submit', {
      run_id: runId, cwd, node_id: 'test:U1:1',
      payload: ok({ verified: true, checks: ['npm test -> 6 passed, 0 failed'] }),
    });
    const nx = await c.call('graph_next', { run_id: runId, cwd });
    const brief = readFileSync(nx.ready.find((n) => n.node_id === 'gate:U1:1').briefing_path, 'utf8');
    assert.match(brief, /npm test -> 6 passed, 0 failed/, 'the gate needs the check output, not a summary of it');
    assert.match(brief, /verified=true/);
    assert.match(brief, /Changed: /);
  }, { isolated: true });
});

// ---------- declared capabilities must be real ----------

test('the server declares only capabilities it implements', async () => {
  const c = await new Client().init();
  try {
    const init = await c.send('initialize', {
      protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' },
    });
    assert.equal(init.result.serverInfo.name, 'graph-beta-engineering');
    assert.equal(init.result.serverInfo.version, '1.0.0');
    const caps = init.result.capabilities;
    assert.ok(caps.tools, 'tools are implemented and must be declared');
    for (const unimplemented of ['logging', 'resources', 'prompts', 'completions']) {
      assert.equal(unimplemented in caps, false, `${unimplemented} is declared but not implemented`);
    }
  } finally {
    c.close();
  }
});

// ---------- declared output shapes ----------

test('every tool declares an outputSchema, and a real verdict validates against it', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    const list = await c.send('tools/list', {});
    for (const t of list.result.tools) {
      assert.ok(t.outputSchema, `${t.name} returns structuredContent with no declared shape`);
      assert.equal(t.outputSchema.type, 'object');
    }
    const byName = Object.fromEntries(list.result.tools.map((t) => [t.name, t.outputSchema]));

    const v = await c.call('graph_submit', { run_id: runId, cwd, node_id: 'plan', payload: ok({ handoff: 'p' }) });
    for (const req of byName.graph_submit.required) {
      assert.ok(req in v, `a real graph_submit verdict is missing declared field ${req}`);
    }
    // the schema must describe the verdict surface, not the payload
    for (const leaked of ['spec', 'handoff', 'evidence', 'checks']) {
      assert.equal(leaked in byName.graph_submit.properties, false,
        `outputSchema advertises ${leaked} - the payload must not cross this boundary`);
    }

    const nx = await c.call('graph_next', { run_id: runId, cwd });
    for (const req of byName.graph_next.required) {
      assert.ok(req in nx, `a real graph_next result is missing declared field ${req}`);
    }
  });
});

// ---------- a node must not re-enter the harness ----------
// Observed in a real run: codex, executing an implement node, ran codex-exec-adapter
// --detect and then --stage implement and --stage test inside that node. Four wasted
// invocations and muddled evidence, with nothing to stop it nesting further.

test('every node prompt forbids re-entering the harness', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    const seen = [];
    const brief = async () => {
      const nx = await c.call('graph_next', { run_id: runId, cwd });
      for (const n of nx.ready) {
        if (!n.briefing_path) continue;
        const text = readFileSync(n.briefing_path, 'utf8');
        seen.push(n.stage);
        assert.match(text, /You ARE this node of the harness graph/, `${n.node_id} may re-enter the harness`);
        assert.match(text, /no codex-exec-adapter\.mjs/, `${n.node_id} does not name the adapter`);
      }
    };
    await brief();
    await c.call('graph_submit', { run_id: runId, cwd, node_id: 'plan', payload: ok({ handoff: 'p' }) });
    await c.call('graph_submit', { run_id: runId, cwd, node_id: 'setgoal', payload: ok({ spec: SPEC }) });
    await brief();
    await c.call('graph_submit', { run_id: runId, cwd, node_id: 'critique', payload: ok({ sound: true }) });
    await brief();
    assert.ok(seen.includes('implement'), 'the implement stage is where this was actually observed');
  });
});

// Balanced mode uses deterministic stand-ins; no real AI CLI or account is used.
function balancedRepo() {
  const cwd = repo();
  const adapter = join(cwd, 'balanced-adapter.mjs');
  writeFileSync(adapter, `
import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
const a = process.argv.slice(2), get = k => a[a.indexOf(k) + 1];
const cwd = get('--cwd'), vendor = get('--vendor-id'), output = get('--output');
appendFileSync(join(cwd, 'invocations.jsonl'), JSON.stringify({vendor, args:a}) + '\\n');
if (a.includes('--detect')) {
  const ready = !existsSync(join(cwd, 'unavailable-' + vendor));
  writeFileSync(output, JSON.stringify({vendor:{ready, reachable:ready, reason:ready ? '' : 'unavailable'}}));
  process.exit(ready ? 0 : 1);
}
const prompt = readFileSync(get('--prompt-file'), 'utf8');
if (existsSync(join(cwd, 'quota-' + vendor))) {
  writeFileSync(join(cwd, 'partial.txt'), 'retained partial work');
  writeFileSync(output, JSON.stringify({stage_ok:false, failure_kind:'quota', stderr:'usage_limit_reached'}));
  process.exit(1);
}
const stage = prompt.match(/^# (\\w+) node/)[1];
const result = {stage_ok:true, handoff:'saved', evidence:'checked', changed_files:[], checks:['check -> pass'], verified:true, sound:true, accept:true, match_pct:100, gaps:[]};
if(stage === 'implement') { writeFileSync(join(cwd, 'a.txt'), 'implemented'); result.changed_files=['a.txt']; }
if(stage === 'setgoal') result.spec = ${JSON.stringify(SPEC)};
writeFileSync(output, JSON.stringify({stage_ok:true,result}));
`);
  mkdirSync(join(cwd, '.claude'), { recursive: true });
  writeFileSync(join(cwd, '.claude', 'broker-vendors.json'), JSON.stringify(Object.fromEntries(['claude', 'codex'].map(vendor => [vendor, {
    command: 'node', args: [adapter, '--vendor-id', vendor], requires_binary: null,
    sandboxes: ['read-only', 'workspace-write'], default_sandbox: 'workspace-write',
  }]))));
  return cwd;
}

for (const host_vendor of ['claude', 'codex']) {
  test(`balanced MCP flow: ${host_vendor} drives, peer implements/tests, host gates`, async () => {
    const cwd = balancedRepo();
    const c = await new Client({ CODEX_THREAD_ID: '' }).init();
    const other = host_vendor === 'claude' ? 'codex' : 'claude';
    try {
      const open = await c.call('graph_open', { request: 'r', cwd, allocation: 'balanced', host_vendor, host_model: 'driving-model' });
      const run_id = open.run_id;
      for (const [node_id, payload] of [['plan', ok({ handoff: 'p' })], ['setgoal', ok({ spec: SPEC })], ['critique', ok({ sound: true })]]) {
        const next = await c.call('graph_next', { run_id, cwd });
        assert.equal(next.ready[0].executor, host_vendor);
        assert.equal(next.ready[0].model, 'driving-model');
        assert.ok(next.ready[0].briefing_path.includes(run_id));
        const result = await c.call('graph_submit', { run_id, cwd, node_id, payload });
        assert.equal(result.state, 'done', JSON.stringify(result));
      }
      for (const stage of ['implement', 'test']) {
        const next = await c.call('graph_next', { run_id, cwd });
        assert.equal(next.ready[0].vendor, other);
        assert.equal(next.ready[0].model, other === 'claude' ? 'sonnet' : 'gpt-5.6-sol');
        assert.equal((await c.call('graph_run', { run_id, cwd, node_id: next.ready[0].node_id })).state, 'done');
      }
      const gate = await c.call('graph_next', { run_id, cwd });
      assert.equal(gate.ready[0].executor, host_vendor);
      assert.equal(gate.ready[0].stage, 'gate');
      await c.call('graph_submit', { run_id, cwd, node_id: gate.ready[0].node_id,
        payload: { stage_ok: false, failure_kind: 'quota' } });
      await c.call('graph_retry', { run_id, cwd, node_id: gate.ready[0].node_id, reset_capacity: true });
      // Gate rejection remains a failed verdict; it must not trigger quota recovery.
      const rejected = await c.call('graph_submit', { run_id, cwd, node_id: gate.ready[0].node_id, payload: ok({ accept: false, gaps: ['missing requirement'] }) });
      assert.equal(rejected.state, 'failed');
      assert.equal(rejected.recoverable, undefined);
      assert.ok((await c.call('graph_retry', { run_id, cwd, node_id: gate.ready[0].node_id })).error,
        'historical interruption cannot reopen a rejected gate');
    } finally { c.close(); rmSync(cwd, { recursive: true, force: true }); }
  });
}

test('quota fallback preserves partial files and checkpoint across broker restart', async () => {
  const cwd = balancedRepo();
  let c = await new Client({ CODEX_THREAD_ID: '' }).init();
  try {
    writeFileSync(join(cwd, 'quota-claude'), '1');
    const open = await c.call('graph_open', { request: 'original acceptance', cwd, allocation: 'balanced' });
    const run_id = open.run_id;
    assert.equal(open.ready[0].vendor, 'claude');
    const interrupted = await c.call('graph_run', { run_id, cwd, node_id: 'plan' });
    assert.equal(interrupted.state, 'pending');
    assert.equal(interrupted.recoverable, true);
    assert.equal(readFileSync(join(cwd, 'partial.txt'), 'utf8'), 'retained partial work');
    assert.ok(readFileSync(interrupted.checkpoint_path, 'utf8').includes('partial.txt'));
    c.close();
    c = await new Client({ CODEX_THREAD_ID: '' }).init();
    const next = await c.call('graph_next', { run_id, cwd });
    assert.equal(next.ready[0].vendor, 'codex');
    const done = await c.call('graph_run', { run_id, cwd, node_id: 'plan' });
    assert.equal(done.state, 'done');
    const prompt = readFileSync(join(dirname(done.detail_path), 'prompt.md'), 'utf8');
    assert.ok(prompt.includes(interrupted.checkpoint_path));
    assert.ok(prompt.includes('original acceptance'));
    assert.equal(readFileSync(join(cwd, 'partial.txt'), 'utf8'), 'retained partial work');
    assert.ok((await c.call('graph_retry', { run_id, cwd, node_id: 'plan' })).error, 'completed nodes cannot be reopened through recovery');
  } finally { c.close(); rmSync(cwd, { recursive: true, force: true }); }
});

test('native quota submission falls back; all exhausted blocks until explicit capacity reset', async () => {
  const cwd = balancedRepo();
  const c = await new Client({ CODEX_THREAD_ID: '' }).init();
  try {
    const open = await c.call('graph_open', { request: 'r', cwd, allocation: 'balanced', host_vendor: 'claude' });
    const run_id = open.run_id;
    const native = await c.call('graph_submit', { run_id, cwd, node_id: 'plan', payload: { stage_ok: false, failure_kind: 'quota' } });
    assert.equal(native.recoverable, true);
    const fallback = await c.call('graph_next', { run_id, cwd });
    assert.equal(fallback.ready[0].vendor, 'codex');
    const bypass = await c.call('graph_submit', { run_id, cwd, node_id: 'plan', payload: ok({}) });
    assert.ok(bypass.error);
    writeFileSync(join(cwd, 'quota-codex'), '1');
    await c.call('graph_run', { run_id, cwd, node_id: 'plan' });
    assert.equal((await c.call('graph_next', { run_id, cwd })).state, 'blocked');
    assert.equal((await c.call('graph_status', { run_id, cwd })).state, 'blocked');
    const resumed = await c.call('graph_retry', { run_id, cwd, node_id: 'plan', reset_capacity: true });
    assert.equal(resumed.ready[0].executor, 'claude');
    assert.equal(resumed.ready[0].vendor, 'self');
    assert.ok(readFileSync(resumed.ready[0].briefing_path, 'utf8').includes('Resume after interrupted'));
  } finally { c.close(); rmSync(cwd, { recursive: true, force: true }); }
});

test('single vendor uses native lower model; unsupported native model fails visibly', async () => {
  const cwd = balancedRepo();
  const c = await new Client({ CODEX_THREAD_ID: '' }).init();
  try {
    const open = await c.call('graph_open', { request: 'r', cwd, allocation: 'balanced', host_vendor: 'codex',
      host_model: 'driving-model', candidates: ['codex'], policy: { plan: { model: 'gpt-5.6-sol' } }, native_models: ['gpt-5.6-sol'] });
    assert.equal(open.ready[0].vendor, 'self');
    assert.equal(open.ready[0].model, 'gpt-5.6-sol');
    const unavailable = await c.call('graph_open', { request: 'r', cwd, allocation: 'balanced', host_vendor: 'codex',
      candidates: ['codex'], native_models: ['gpt-6-astra'] });
    assert.equal(unavailable.state, 'blocked');
    assert.match(JSON.stringify(unavailable.ready[0].attempts), /cannot select model/);
    const explicit = await c.call('graph_open', { request: 'r', cwd, allocation: 'balanced', host_vendor: 'codex',
      candidates: ['codex'], native_models: ['gpt-6-astra'], model: 'gpt-6-astra' });
    assert.equal(explicit.ready[0].model, 'gpt-6-astra');
    const a = await c.call('graph_open', { request: 'different run', cwd, allocation: 'balanced', host_vendor: 'codex', candidates: ['codex'] });
    assert.notEqual(open.ready[0].briefing_path, a.ready[0].briefing_path);
  } finally { c.close(); rmSync(cwd, { recursive: true, force: true }); }
});

// ---------- registering a vendor does not enrol it in "auto" ----------
// The default candidate list is empty on purpose: a run that does not name a vendor
// stays on the orchestrator, even when a perfectly ready vendor is registered. Without
// a test, restoring the old `Object.keys(vendors)` would silently start delegating
// every unnamed run to whatever happened to be installed.

test('auto does not pick up a registered, ready vendor that was never named', async () => {
  const cwd = repoWithFakeVendor();
  process.env.FAKE_REPLY = '{"stage_ok":true,"handoff":"h","evidence":"e"}';
  const c = await new Client().init();
  try {
    const auto = await c.call('graph_open', { request: 'r', cwd, vendor: 'auto' });
    assert.equal(auto.ready[0].vendor, 'self',
      'an unnamed run must stay on the orchestrator even with a ready vendor installed');

    const named = await c.call('graph_open', { request: 'r', cwd, vendor: 'fake' });
    assert.equal(named.ready[0].vendor, 'fake', 'naming the vendor still routes to it');

    const listed = await c.call('graph_open', { request: 'r', cwd, vendor: 'auto', candidates: ['fake'] });
    assert.equal(listed.ready[0].vendor, 'fake', 'listing it in candidates still routes to it');
  } finally {
    c.close();
    delete process.env.FAKE_REPLY;
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('a run with no vendor argument at all stays on the orchestrator', async () => {
  const cwd = repoWithFakeVendor();
  const c = await new Client().init();
  try {
    const r = await c.call('graph_open', { request: 'r', cwd });
    assert.equal(r.ready[0].vendor, 'self');
    assert.ok(r.ready[0].briefing_path, 'a self node needs its briefing written to disk');
  } finally {
    c.close();
    rmSync(cwd, { recursive: true, force: true });
  }
});

// ---------- who decides which vendor and model runs each phase ----------
// Nobody did. One vendor was chosen at graph_open and used for plan, implement and
// report alike, while `model` existed only as an argument the caller had to remember on
// every graph_run - so the harness contract (reasoning on a strong model, execution on
// whatever can write here) had no way to be expressed at all.

const FULL_POLICY = {
  plan: { vendor: 'self', model: 'opus' },
  setgoal: { vendor: 'self', model: 'opus' },
  implement: { vendor: 'fake', model: 'exec-model' },
  gate: { vendor: 'self', model: 'opus' },
  report: { vendor: 'self', model: 'sonnet' },
};

test('a stage policy routes each phase to its own vendor and model', async () => {
  const cwd = repoWithFakeVendor();
  const c = await new Client().init();
  try {
    const open = await c.call('graph_open', {
      request: 'r', cwd, vendor: 'fake', model: 'run-default', policy: FULL_POLICY,
    });
    const plan = open.ready.find((n) => n.node_id === 'plan');
    assert.equal(plan.vendor, 'self', 'plan is pinned to self by policy');
    assert.equal(plan.model, 'opus');

    await c.call('graph_submit', { run_id: open.run_id, cwd, node_id: 'plan', payload: ok({ handoff: 'p' }) });
    await c.call('graph_submit', { run_id: open.run_id, cwd, node_id: 'setgoal', payload: ok({ spec: SPEC }) });

    // critique has no policy entry: it must inherit the run-level vendor and model
    const nx = await c.call('graph_next', { run_id: open.run_id, cwd });
    const critique = nx.ready.find((n) => n.node_id === 'critique');
    assert.equal(critique.vendor, 'fake', 'an unpolicied stage falls back to the run vendor');
    assert.equal(critique.model, 'run-default', 'and to the run model');
  } finally {
    c.close();
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('the broker forwards a stage policy model to the readiness probe', async () => {
  const cwd = repoWithFakeVendor();
  const log = join(cwd, 'adapter-args.jsonl');
  process.env.FAKE_ARGS_LOG = log;
  const c = await new Client().init();
  try {
    const open = await c.call('graph_open', {
      request: 'r', cwd, vendor: 'self',
      policy: { plan: { vendor: 'fake', model: 'probe-model' } },
    });
    assert.equal(open.ready[0].vendor, 'fake');
    const calls = readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse);
    const detect = calls.find((call) => call.includes('--detect'));
    assert.ok(detect, 'the vendor adapter must receive a readiness call');
    assert.equal(detect[detect.indexOf('--model') + 1], 'probe-model');
  } finally {
    c.close();
    delete process.env.FAKE_ARGS_LOG;
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('the Codex adapter probes reachability and writes with the selected model', () => {
  const cwd = repo();
  const bin = join(cwd, 'bin');
  const log = join(cwd, 'codex-args.jsonl');
  const output = join(cwd, 'probe-result.json');
  mkdirSync(bin);
  const stub = join(bin, 'codex');
  writeFileSync(stub, `#!/usr/bin/env node
import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const args = process.argv.slice(2);
appendFileSync(process.env.CODEX_ARGS_LOG, JSON.stringify(args) + '\\n');
if (args.includes('--version')) process.exit(0);
const prompt = args.at(-1) || '';
if (prompt.includes('CODEX_READY')) process.stdout.write('CODEX_READY\\n');
const match = prompt.match(/Create a file named ([^ ]+)/);
if (match) {
  const cwdArg = args[args.indexOf('-C') + 1];
  writeFileSync(join(cwdArg, match[1]), 'PROBE_OK\\n');
}
process.exit(0);
`);
  chmodSync(stub, 0o755);
  try {
    const result = spawnSync('node', [
      CODEX_ADAPTER,
      '--detect', '--cwd', cwd, '--sandbox', 'workspace-write',
      '--model', 'probe-model', '--output', output,
    ], {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, CODEX_ARGS_LOG: log },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(readFileSync(output, 'utf8')).codex.ready, true);
    const calls = readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse)
      .filter((call) => call[0] === 'exec');
    assert.equal(calls.length, 2, 'detect must run one read-only smoke and one write probe');
    for (const call of calls) {
      assert.equal(call[call.indexOf('-m') + 1], 'probe-model');
    }
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('a policy can route reasoning and execution to different vendors in one run', async () => {
  const cwd = repoWithFakeVendor();
  process.env.FAKE_REPLY = '{"stage_ok":true,"sound":true,"handoff":"h","evidence":"e"}';
  const c = await new Client().init();
  try {
    const { run_id } = await c.call('graph_open', {
      request: 'r', cwd, vendor: 'self',
      policy: { critique: { vendor: 'fake' }, implement: { vendor: 'fake', model: 'exec-model' } },
    });
    await c.call('graph_submit', { run_id, cwd, node_id: 'plan', payload: ok({ handoff: 'p' }) });
    await c.call('graph_submit', { run_id, cwd, node_id: 'setgoal', payload: ok({ spec: SPEC }) });

    const nx = await c.call('graph_next', { run_id, cwd });
    assert.equal(nx.ready.find((n) => n.node_id === 'critique').vendor, 'fake',
      'one run must be able to send reasoning to a vendor and keep the rest on self');

    const v = await c.call('graph_run', { run_id, cwd, node_id: 'critique' });
    assert.equal(v.state, 'done');
    assert.equal(v.vendor, 'fake');

    const after = await c.call('graph_next', { run_id, cwd });
    const impl = after.ready.find((n) => n.node_id === 'implement:U1:1');
    assert.equal(impl.vendor, 'fake');
    assert.equal(impl.model, 'exec-model', 'the executor gets its own model, not the reasoning one');
  } finally {
    c.close();
    delete process.env.FAKE_REPLY;
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('gate:goal can be policied separately from the per-subgoal gates', async () => {
  const cwd = repoWithFakeVendor();
  const c = await new Client().init();
  try {
    const { run_id } = await c.call('graph_open', {
      request: 'r', cwd, vendor: 'self',
      policy: { gate: { model: 'gate-model' }, 'gate:goal': { model: 'goal-gate-model' } },
    });
    await c.call('graph_submit', { run_id, cwd, node_id: 'plan', payload: ok({ handoff: 'p' }) });
    await c.call('graph_submit', { run_id, cwd, node_id: 'setgoal', payload: ok({ spec: SPEC }) });
    await c.call('graph_submit', { run_id, cwd, node_id: 'critique', payload: ok({ sound: true }) });
    for (const sg of ['U1', 'U2']) {
      const f = dirty(cwd);
      await c.call('graph_submit', { run_id, cwd, node_id: `implement:${sg}:1`, payload: ok({ changed_files: [f] }) });
      await c.call('graph_submit', { run_id, cwd, node_id: `test:${sg}:1`, payload: ok({ verified: true }) });
      const nx = await c.call('graph_next', { run_id, cwd });
      const gate = nx.ready.find((n) => n.node_id === `gate:${sg}:1`);
      assert.equal(gate.model, 'gate-model', 'a subgoal gate uses the gate policy');
      await c.call('graph_submit', { run_id, cwd, node_id: gate.node_id, payload: ok({ accept: true, match_pct: 95 }) });
    }
    const nx = await c.call('graph_next', { run_id, cwd });
    const goalGate = nx.ready.find((n) => n.node_id.startsWith('gate:goal'));
    assert.equal(goalGate.model, 'goal-gate-model', 'the goal gate may be judged by a different model');
  } finally {
    c.close();
    rmSync(cwd, { recursive: true, force: true });
  }
});

// ---------- quota discovered at probe time ----------
// The real Codex adapter buries the usage-limit message at codex.smoke.stderr and writes
// nothing to its own stderr, so a probe-time exhaustion is indistinguishable from a broken
// vendor unless the report is searched. Reproduces that exact shape.
function quotaProbeRepo() {
  const cwd = repo();
  const adapter = join(cwd, 'quota-probe-adapter.mjs');
  writeFileSync(adapter, `
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const a = process.argv.slice(2), get = k => a[a.indexOf(k) + 1];
const cwd = get('--cwd'), vendor = get('--vendor-id'), output = get('--output');
if (a.includes('--detect')) {
  if (existsSync(join(cwd, 'broken-' + vendor))) {
    writeFileSync(output, JSON.stringify({ ok: false, codex: { available: true, ready: false, reachable: false,
      reason: 'sandbox denied write access',
      smoke: { exit_code: 1, stdout: '', stderr: 'operation not permitted; the model produced no output limit' } } }));
    process.exit(1);
  }
  if (existsSync(join(cwd, 'quota-' + vendor))) {
    writeFileSync(output, JSON.stringify({ ok: false, codex: { available: true, ready: false, reachable: false,
      reason: 'codex unreachable',
      smoke: { exit_code: 1, stdout: '', stderr: "You've hit your usage limit. Upgrade to Pro, visit settings to purchase more credits or try again at 4:21 AM." } } }));
    process.exit(1);
  }
  writeFileSync(output, JSON.stringify({ vendor: { ready: true, reachable: true, reason: '' } }));
  process.exit(0);
}
const stage = readFileSync(get('--prompt-file'), 'utf8').match(/^# (\\w+) node/)[1];
const result = { stage_ok: true, handoff: 'h', evidence: 'e', changed_files: [], checks: ['c -> pass'], verified: true, sound: true, accept: true, match_pct: 100, gaps: [] };
if (stage === 'implement') { writeFileSync(join(cwd, 'a.txt'), 'implemented'); result.changed_files = ['a.txt']; }
writeFileSync(output, JSON.stringify({ stage_ok: true, result }));
`);
  mkdirSync(join(cwd, '.claude'), { recursive: true });
  writeFileSync(join(cwd, '.claude', 'broker-vendors.json'), JSON.stringify(Object.fromEntries(['claude', 'codex'].map(vendor => [vendor, {
    command: 'node', args: [adapter, '--vendor-id', vendor], requires_binary: null,
    sandboxes: ['read-only', 'workspace-write'], default_sandbox: 'workspace-write',
  }]))));
  writeFileSync(join(cwd, 'quota-codex'), '');
  return cwd;
}

// Same fixture, but the probe fails for a reason that has nothing to do with capacity.
function brokenProbeRepo() {
  const cwd = quotaProbeRepo();
  rmSync(join(cwd, 'quota-codex'));
  writeFileSync(join(cwd, 'broken-codex'), '');
  return cwd;
}

test('a probe rejected for usage limits is recorded as spent capacity, not a broken vendor', async () => {
  const cwd = quotaProbeRepo();
  const c = await new Client({ CODEX_THREAD_ID: '' }).init();
  try {
    const { run_id } = await c.call('graph_open', { request: 'r', cwd, allocation: 'balanced',
      host_vendor: 'claude', host_model: 'driving-model' });
    for (const [node_id, payload] of [['plan', ok({ handoff: 'p' })], ['setgoal', ok({ spec: SPEC })], ['critique', ok({ sound: true })]]) {
      await c.call('graph_next', { run_id, cwd });
      assert.equal((await c.call('graph_submit', { run_id, cwd, node_id, payload })).state, 'done');
    }
    // Implement prefers the peer vendor; its probe is out of quota, so the run falls back.
    const next = await c.call('graph_next', { run_id, cwd });
    assert.equal(next.ready[0].executor, 'claude', 'the exhausted peer must not be assigned');

    const full = await c.call('graph_status', { run_id, cwd, full: true });
    assert.match(String((full.unavailable_vendors || {}).codex || ''), /capacity/i,
      'a quota-exhausted probe must mark the vendor as spent capacity so reset_capacity is the way back');
  } finally {
    c.close();
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('capacity reset alone restores a vendor excluded at probe time, with no interrupted node to name', async () => {
  const cwd = quotaProbeRepo();
  const c = await new Client({ CODEX_THREAD_ID: '' }).init();
  try {
    const { run_id } = await c.call('graph_open', { request: 'r', cwd, allocation: 'balanced',
      host_vendor: 'claude', host_model: 'driving-model' });
    for (const [node_id, payload] of [['plan', ok({ handoff: 'p' })], ['setgoal', ok({ spec: SPEC })], ['critique', ok({ sound: true })]]) {
      await c.call('graph_next', { run_id, cwd });
      await c.call('graph_submit', { run_id, cwd, node_id, payload });
    }
    await c.call('graph_next', { run_id, cwd });
    assert.ok((await c.call('graph_status', { run_id, cwd, full: true })).unavailable_vendors.codex, 'precondition: codex is excluded');

    rmSync(join(cwd, 'quota-codex'));  // capacity came back
    const reset = await c.call('graph_retry', { run_id, cwd, reset_capacity: true });

    const full = await c.call('graph_status', { run_id, cwd, full: true });
    assert.deepEqual(full.unavailable_vendors, {}, 'a capacity reset must clear probe-time exclusions');
    assert.equal(reset.ready?.[0]?.vendor, 'codex', 'the recovered vendor is offered again for execution work');
  } finally {
    c.close();
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('a rejected graph_retry leaves capacity untouched; a failed call must not half-apply', async () => {
  const cwd = quotaProbeRepo();
  const c = await new Client({ CODEX_THREAD_ID: '' }).init();
  try {
    const { run_id } = await c.call('graph_open', { request: 'r', cwd, allocation: 'balanced',
      host_vendor: 'claude', host_model: 'driving-model' });
    for (const [node_id, payload] of [['plan', ok({ handoff: 'p' })], ['setgoal', ok({ spec: SPEC })], ['critique', ok({ sound: true })]]) {
      await c.call('graph_next', { run_id, cwd });
      await c.call('graph_submit', { run_id, cwd, node_id, payload });
    }
    await c.call('graph_next', { run_id, cwd });
    const before = await c.call('graph_status', { run_id, cwd, full: true });
    assert.ok(before.unavailable_vendors.codex, 'precondition: codex is excluded');

    // 'implement:U1:1' is pending but was never interrupted, so this retry is rejected.
    const r = await c.call('graph_retry', { run_id, cwd, node_id: 'implement:U1:1', reset_capacity: true });
    assert.match(String(r.error || ''), /interrupted pending node/);

    const after = await c.call('graph_status', { run_id, cwd, full: true });
    assert.deepEqual(after.unavailable_vendors, before.unavailable_vendors,
      'a retry that throws must not have already cleared capacity exclusions');
    assert.equal(after.capacity_epoch, before.capacity_epoch, 'nor bumped the capacity epoch');
  } finally {
    c.close();
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('an ordinary probe failure is not laundered into a capacity exclusion', async () => {
  const cwd = brokenProbeRepo();
  const c = await new Client({ CODEX_THREAD_ID: '' }).init();
  try {
    const { run_id } = await c.call('graph_open', { request: 'r', cwd, allocation: 'balanced',
      host_vendor: 'claude', host_model: 'driving-model' });
    for (const [node_id, payload] of [['plan', ok({ handoff: 'p' })], ['setgoal', ok({ spec: SPEC })], ['critique', ok({ sound: true })]]) {
      await c.call('graph_next', { run_id, cwd });
      await c.call('graph_submit', { run_id, cwd, node_id, payload });
    }
    const next = await c.call('graph_next', { run_id, cwd });
    assert.equal(next.ready[0].executor, 'claude', 'a broken peer is still routed around');

    const full = await c.call('graph_status', { run_id, cwd, full: true });
    assert.deepEqual(full.unavailable_vendors, {},
      'a broken vendor must stay probeable; only spent capacity is held against the run');
  } finally {
    c.close();
    rmSync(cwd, { recursive: true, force: true });
  }
});

// A briefing names files by absolute path, so a truthful executor reports them that way.
// The cross-check compared the claim to git's relative output and called every honest
// absolute claim a lie.
test('an absolute changed_files path inside cwd verifies instead of contradicting', async () => {
  const cwd = repoWithFakeVendor();
  const c = await new Client().init();
  try {
    const { run_id } = await c.call('graph_open', { request: 'r', cwd, vendor: 'self', isolated: true });
    for (const [node_id, payload] of [['plan', ok({ handoff: 'p' })], ['setgoal', ok({ spec: SPEC })], ['critique', ok({ sound: true })]]) {
      await c.call('graph_submit', { run_id, cwd, node_id, payload });
    }
    const rel = dirty(cwd);
    const r = await c.call('graph_submit', { run_id, cwd, node_id: 'implement:U1:1',
      payload: ok({ changed_files: [join(cwd, rel)] }) });

    assert.equal(r.state, 'done', JSON.stringify(r));
    assert.equal(r.changed_files_verified, true, 'the file really is in the worktree');
    assert.equal(r.contradicted_files, undefined, 'an existing file must not be called contradicted');
  } finally {
    c.close();
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('an absolute path outside cwd is still contradicted', async () => {
  const cwd = repoWithFakeVendor();
  const c = await new Client().init();
  try {
    const { run_id } = await c.call('graph_open', { request: 'r', cwd, vendor: 'self', isolated: true });
    for (const [node_id, payload] of [['plan', ok({ handoff: 'p' })], ['setgoal', ok({ spec: SPEC })], ['critique', ok({ sound: true })]]) {
      await c.call('graph_submit', { run_id, cwd, node_id, payload });
    }
    dirty(cwd);
    const r = await c.call('graph_submit', { run_id, cwd, node_id: 'implement:U1:1',
      payload: ok({ changed_files: ['/etc/hosts'] }) });

    assert.equal(r.state, 'failed');
    assert.deepEqual(r.contradicted_files, ['/etc/hosts']);
  } finally {
    c.close();
    rmSync(cwd, { recursive: true, force: true });
  }
});

// A lead that lost its run_id - a fresh session, a compaction, a second operator - had no
// way back into a run through the MCP, only through the transcript.
test('every run in a directory is listable without knowing a run_id', async () => {
  const cwd = repo();
  const c = await new Client().init();
  try {
    const first = await openRun(c, cwd);
    const second = await openRun(c, cwd, { request: 'the second request' });
    const overview = await c.call('graph_status', { cwd });
    assert.deepEqual([...overview.runs.map((r) => r.run_id)].sort(), [first, second].sort());
    const stamps = overview.runs.map((r) => Date.parse(r.created_at));
    assert.deepEqual(stamps, [...stamps].sort((x, y) => y - x), 'newest run is not listed first');
    const fresh = overview.runs.find((r) => r.run_id === second);
    assert.equal(fresh.request, 'the second request');
    assert.equal(fresh.state, 'running');
    assert.equal(fresh.counts.pending, 3);
    assert.deepEqual(fresh.running, []);
    assert.equal(fresh.last_finished, null);
    // The overview is a progress view, never a way around the one-node-at-a-time rule.
    assert.ok(!JSON.stringify(overview).includes('acceptance'), 'the overview leaked payload');

    await c.call('graph_submit', { run_id: first, cwd, node_id: 'plan', payload: ok({ handoff: 'p' }) });
    const row = (await c.call('graph_status', { cwd })).runs.find((r) => r.run_id === first);
    assert.deepEqual(row.last_finished, { node_id: 'plan', stage: 'plan', state: 'done' });
    assert.equal(row.counts.done, 1);
  } finally { c.close(); rmSync(cwd, { recursive: true, force: true }); }
});

// The driver grading its own account of the run is exactly the self-attestation the gate
// stages exist to prevent; report now goes to the peer for the same reason.
test('the peer vendor, not the driver, writes the run report', async () => {
  const cwd = balancedRepo();
  const c = await new Client({ CODEX_THREAD_ID: '' }).init();
  try {
    const { run_id } = await c.call('graph_open', {
      request: 'r', cwd, allocation: 'balanced', host_vendor: 'claude', host_model: 'driving-model' });
    let report = null;
    for (let i = 0; i < 24 && !report; i++) {
      const next = await c.call('graph_next', { run_id, cwd });
      assert.ok(next.ready.length, `run stalled with nothing ready: ${JSON.stringify(next.counts)}`);
      const node = next.ready[0];
      if (node.stage === 'report') { report = node; break; }
      // Host-vendor work comes back as self; only the peer's nodes are actually run.
      const r = node.vendor === 'self'
        ? await c.call('graph_submit', { run_id, cwd, node_id: node.node_id,
          payload: ok(node.stage === 'setgoal' ? { spec: SPEC } : { handoff: 'h', sound: true, accept: true, match_pct: 100, gaps: [] }) })
        : await c.call('graph_run', { run_id, cwd, node_id: node.node_id });
      assert.equal(r.state, 'done', JSON.stringify(r));
    }
    assert.ok(report, 'the run never reached its report node');
    assert.equal(report.executor, 'codex');
    assert.equal(report.model, 'gpt-5.6-sol');
    assert.match(report.routing_reason, /preference=codex/);
    assert.equal((await c.call('graph_run', { run_id, cwd, node_id: 'report' })).state, 'done');
    assert.equal((await c.call('graph_status', { run_id, cwd })).state, 'complete');
  } finally { c.close(); rmSync(cwd, { recursive: true, force: true }); }
});
