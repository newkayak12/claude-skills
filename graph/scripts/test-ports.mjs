#!/usr/bin/env node
// Defects fixed first in the teams fork of this engine and ported back to graph. Each
// case failed on graph before its port. graph and teams are separate plugins: nothing
// here imports teams.
//
//   node --test graph/scripts/test-ports.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, readFileSync, rmSync, chmodSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readyNodes } from '../mcp/graph.mjs';

const BROKER = join(dirname(fileURLToPath(import.meta.url)), '..', 'mcp', 'broker.mjs');

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
  const dir = mkdtempSync(join(tmpdir(), 'graph-ports-'));
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
  mkdirSync(dirname(join(dir, file)), { recursive: true });
  appendFileSync(join(dir, file), 'changed\n');
  return file;
}

const ok = (payload) => ({ stage_ok: true, evidence: 'e', ...payload });

const SPEC = {
  goal: 'G',
  acceptance: ['A'],
  subgoals: [
    { id: 'U1', title: 'first', acceptance: ['a'], test: ['t'], deps: [] },
    { id: 'U2', title: 'second', acceptance: ['b'], test: ['t'], deps: ['U1'] },
  ],
};

async function withRun(fn, extra = {}, env = {}) {
  const cwd = repo();
  const c = await new Client(env).init();
  try {
    const r = await c.call('graph_open', { request: 'r', cwd, vendor: 'self', ...extra });
    await fn({ c, cwd, runId: r.run_id });
  } finally {
    c.close();
    rmSync(cwd, { recursive: true, force: true });
  }
}

async function throughCritique(c, cwd, runId, spec = SPEC) {
  await c.call('graph_submit', { run_id: runId, cwd, node_id: 'plan', payload: ok({ handoff: 'p' }) });
  await c.call('graph_submit', { run_id: runId, cwd, node_id: 'setgoal', payload: ok({ spec, handoff: 's' }) });
  await c.call('graph_submit', { run_id: runId, cwd, node_id: 'critique', payload: ok({ sound: true }) });
}

const bare = (id, stage, deps, extra = {}) => ({ node_id: id, stage, deps, after: [], state: 'pending', attempt: 1, ticket: null, result: null, ...extra });

// ---------- #1 teams 8d3ba22 ----------

test('#1 a subgoal retried after a spec retry waits on the live generation, not the dead one', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    await c.call('graph_submit', { run_id: runId, cwd, node_id: 'plan', payload: ok({ handoff: 'p' }) });
    await c.call('graph_submit', { run_id: runId, cwd, node_id: 'setgoal', payload: ok({ spec: SPEC, handoff: 's' }) });
    await c.call('graph_submit', { run_id: runId, cwd, node_id: 'critique', payload: ok({ sound: false, blocking: ['no'] }) });
    const rs = await c.call('graph_retry', { run_id: runId, cwd });
    assert.equal(rs.retried, true);
    await c.call('graph_submit', { run_id: runId, cwd, node_id: 'setgoal:2', payload: ok({ spec: SPEC, handoff: 's' }) });
    await c.call('graph_submit', { run_id: runId, cwd, node_id: 'critique:2', payload: ok({ sound: true }) });
    const f = dirty(cwd);
    await c.call('graph_submit', { run_id: runId, cwd, node_id: 'implement:U1:2', payload: ok({ changed_files: [f] }) });
    await c.call('graph_submit', { run_id: runId, cwd, node_id: 'test:U1:2', payload: ok({ verified: false, checks: ['c -> failed'] }) });
    const rt = await c.call('graph_retry', { run_id: runId, cwd, subgoal_id: 'U1', feedback: 'fix it' });
    assert.equal(rt.retried, true);
    assert.equal(rt.attempt, 3);
    const st = await c.call('graph_status', { run_id: runId, cwd });
    const fresh = st.nodes.find((n) => n.node_id === 'implement:U1:3');
    // The earliest implement node (attempt 1) carried deps on the retired `critique`,
    // which never becomes done - the retry could never run.
    assert.deepEqual(fresh.deps, ['critique:2'], `inherited a dead generation's deps: ${fresh.deps.join(', ')}`);
    const nx = await c.call('graph_next', { run_id: runId, cwd });
    assert.ok(nx.ready.some((n) => n.node_id === 'implement:U1:3'), 'and so it is offered');
  });
});

// ---------- #2 teams 9d359b0 (graph part) ----------

test('#2 a report waits on a node still running even after its goal gate went unreachable', () => {
  const run = {
    run_id: 'r2', cwd: '/tmp', max_retries: 2, spec: { subgoals: [] },
    nodes: [
      bare('gate:U1:3', 'gate', [], { subgoal_id: 'U1', state: 'failed', final: true, result: {} }),
      bare('implement:U3:1', 'implement', [], { subgoal_id: 'U3', state: 'running' }),
      bare('test:U3:1', 'test', ['implement:U3:1'], { subgoal_id: 'U3' }),
      bare('gate:goal:1', 'gate', ['gate:U1:3'], { subgoal_id: null, state: 'unreachable', result: {} }),
      bare('report', 'report', [], { after: ['gate:goal:1'] }),
    ],
  };
  assert.deepEqual(readyNodes(run).map((n) => n.node_id), [], 'U3 still running: no report yet');
  run.nodes[1].state = 'done';
  assert.deepEqual(readyNodes(run).map((n) => n.node_id), ['test:U3:1'], 'its test runs first');
  run.nodes[2].state = 'done';
  assert.deepEqual(readyNodes(run).map((n) => n.node_id), ['report']);
});

test('#2 a pending node that can never run does not hold the report', () => {
  const run = {
    run_id: 'r2b', cwd: '/tmp', max_retries: 2, spec: { subgoals: [] },
    nodes: [
      bare('gate:U1:3', 'gate', [], { subgoal_id: 'U1', state: 'failed', final: true, result: {} }),
      bare('implement:U3:1', 'implement', ['gate:U1:3'], { subgoal_id: 'U3' }),
      bare('gate:goal:1', 'gate', ['gate:U1:3'], { subgoal_id: null, state: 'unreachable', result: {} }),
      bare('report', 'report', [], { after: ['gate:goal:1'] }),
    ],
  };
  assert.deepEqual(readyNodes(run).map((n) => n.node_id), ['report']);
});

// ---------- #6 teams 1a00aba ----------

test('#6 a changed_files claim with a note, a glob, or a space in the path matches what git lists', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    rmSync(join(cwd, 'a.txt'));
    mkdirSync(join(cwd, 'fx'), { recursive: true });
    writeFileSync(join(cwd, 'fx', 'a.json'), '{}');
    writeFileSync(join(cwd, 'fx', 'b.json'), '{}');
    writeFileSync(join(cwd, 'with space.md'), 'x');
    writeFileSync(join(cwd, 'café.md'), 'x');
    await throughCritique(c, cwd, runId);
    const r = await c.call('graph_submit', { run_id: runId, cwd, node_id: 'implement:U1:1',
      payload: ok({ changed_files: ['a.txt (deleted)', 'fx/*.json (2 fixtures: a, b (empty))', 'with space.md', 'café.md'] }) });
    assert.equal(r.state, 'done', JSON.stringify(r));
    assert.equal(r.changed_files_verified, true);
  }, { isolated: true });
});

test('#6 a renamed file is matched by its new path, and a claim git does not list is still contradicted', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    spawnSync('git', ['mv', 'a.txt', 'b c.txt'], { cwd });
    await throughCritique(c, cwd, runId);
    const r = await c.call('graph_submit', { run_id: runId, cwd, node_id: 'implement:U1:1',
      payload: ok({ changed_files: ['b c.txt', 'fx/*.json'] }) });
    assert.equal(r.state, 'failed');
    assert.deepEqual(r.contradicted_files, ['fx/*.json']);
  }, { isolated: true });
});

// ---------- #7 teams e33f3aa (cross-check part) ----------

test('#7 a claimed file under a git-ignored path is not contradicted when it exists, and still is when it does not', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    writeFileSync(join(cwd, '.gitignore'), 'out/\n');
    spawnSync('git', ['add', '.gitignore'], { cwd });
    spawnSync('git', ['commit', '-qm', 'ignore'], { cwd });
    mkdirSync(join(cwd, 'out'), { recursive: true });
    writeFileSync(join(cwd, 'out', 'notes.md'), '# n\n');
    await throughCritique(c, cwd, runId);
    const r = await c.call('graph_submit', { run_id: runId, cwd, node_id: 'implement:U1:1',
      payload: ok({ changed_files: ['out/notes.md'] }) });
    assert.equal(r.state, 'done', JSON.stringify(r));
    assert.equal(r.changed_files_verified, null, 'git cannot see it, so it is not verified either');
    const st = await c.call('graph_status', { run_id: runId, cwd });
    assert.ok(st.nodes.find((n) => n.node_id === 'implement:U1:1'));
  }, { isolated: true });
  await withRun(async ({ c, cwd, runId }) => {
    writeFileSync(join(cwd, '.gitignore'), 'out/\n');
    spawnSync('git', ['add', '.gitignore'], { cwd });
    spawnSync('git', ['commit', '-qm', 'ignore'], { cwd });
    await throughCritique(c, cwd, runId);
    const ghost = await c.call('graph_submit', { run_id: runId, cwd, node_id: 'implement:U1:1',
      payload: ok({ changed_files: ['out/never-written.md'] }) });
    assert.equal(ghost.state, 'failed');
    assert.deepEqual(ghost.contradicted_files, ['out/never-written.md']);
  }, { isolated: true });
});

// ---------- #8 teams e332ed4 (open-nodes.json; the run file is U7's test-store) ----------

test('#8 open-nodes.json is replaced by rename, never rewritten in place under a reader', async () => {
  const { statSync } = await import('node:fs');
  await withRun(async ({ c, cwd, runId }) => {
    const p = join(cwd, '.harness-run', 'broker', 'open-nodes.json');
    await c.call('graph_submit', { run_id: runId, cwd, node_id: 'plan', payload: ok({ handoff: 'p' }) });
    assert.ok(existsSync(p));
    const before = statSync(p).ino;
    await c.call('graph_submit', { run_id: runId, cwd, node_id: 'setgoal', payload: ok({ spec: SPEC, handoff: 's' }) });
    // An in-place writeFileSync keeps the inode, and a hook reading mid-write saw half a file.
    assert.notEqual(statSync(p).ino, before, 'open-nodes.json must be written tmp + rename');
    JSON.parse(readFileSync(p, 'utf8'));
  });
});

// ---------- #9 teams 803dc5b ----------

test('#9 an author stage_ok:false with no reason and passing checks goes on to be judged', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    await throughCritique(c, cwd, runId);
    const f = dirty(cwd);
    const r = await c.call('graph_submit', { run_id: runId, cwd, node_id: 'implement:U1:1',
      payload: { stage_ok: false, evidence: 'e', changed_files: [f], checks: ['npm test -> 66 tests, 66 pass, 0 fail'] } });
    assert.equal(r.state, 'done', JSON.stringify(r));
    assert.equal(r.self_reported_stage_ok, false, 'the overrule is visible');
    const nx = await c.call('graph_next', { run_id: runId, cwd });
    assert.ok(nx.ready.some((n) => n.node_id === 'test:U1:1'));
  });
});

test('#9 an author stage_ok:false with a reason, or a failing check, still fails', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    await throughCritique(c, cwd, runId);
    const f = dirty(cwd);
    const r = await c.call('graph_submit', { run_id: runId, cwd, node_id: 'implement:U1:1',
      payload: { stage_ok: false, evidence: 'e', reason: 'could not build', changed_files: [f] } });
    assert.equal(r.state, 'failed');
    assert.equal(r.self_reported_stage_ok, undefined);
  });
  await withRun(async ({ c, cwd, runId }) => {
    await throughCritique(c, cwd, runId);
    const f = dirty(cwd);
    const r = await c.call('graph_submit', { run_id: runId, cwd, node_id: 'implement:U1:1',
      payload: { stage_ok: false, evidence: 'e', changed_files: [f], checks: ['npm test -> 3 failed'] } });
    assert.equal(r.state, 'failed');
  });
});

// ---------- #10 teams b914d04 ----------

test('#10 a test that comes back verified:false with no reason gets one from its checks', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    await throughCritique(c, cwd, runId);
    const f = dirty(cwd);
    await c.call('graph_submit', { run_id: runId, cwd, node_id: 'implement:U1:1', payload: ok({ changed_files: [f] }) });
    const r = await c.call('graph_submit', { run_id: runId, cwd, node_id: 'test:U1:1',
      payload: ok({ verified: false, checks: ['lint -> ok', 'npm test -> 2 failed'] }) });
    assert.equal(r.state, 'failed');
    assert.equal(r.reason, 'npm test -> 2 failed');
  });
});

test('#10 a gate rejection with gaps keeps its own reasoning, and an empty one falls back to evidence', async () => {
  await withRun(async ({ c, cwd, runId }) => {
    await throughCritique(c, cwd, runId);
    const f = dirty(cwd);
    await c.call('graph_submit', { run_id: runId, cwd, node_id: 'implement:U1:1', payload: ok({ changed_files: [f] }) });
    await c.call('graph_submit', { run_id: runId, cwd, node_id: 'test:U1:1', payload: ok({ verified: true, checks: ['t -> ok'] }) });
    const r = await c.call('graph_submit', { run_id: runId, cwd, node_id: 'gate:U1:1',
      payload: { stage_ok: true, accept: false, evidence: 'acceptance a is not demonstrated' } });
    assert.equal(r.state, 'failed');
    assert.equal(r.reason, 'acceptance a is not demonstrated');
  });
});

// ---------- #11 teams 3cf65d7 ----------

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

test('#11 a vendor answer with malformed JSON gets one fresh attempt, and a second is a failure', async () => {
  const cwd = repoWithFakeVendor();
  const c = await new Client({ FAKE_REPLY: '{"stage_ok":true,"plan":"x","handoff":"h","evidence":"e"]' }).init();
  try {
    const { run_id } = await c.call('graph_open', { request: 'r', cwd, vendor: 'fake' });
    const first = await c.call('graph_run', { run_id, cwd, node_id: 'plan' });
    assert.equal(first.state, 'pending', JSON.stringify(first));
    assert.equal(first.recoverable, true);
    const nx = await c.call('graph_next', { run_id, cwd });
    assert.ok(nx.ready.some((n) => n.node_id === 'plan'), 'offered again');
    const second = await c.call('graph_run', { run_id, cwd, node_id: 'plan' });
    assert.equal(second.state, 'failed');
    assert.match(second.reason, /no usable JSON/);
  } finally {
    c.close();
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('#11 prose with no JSON in it is not retried', async () => {
  const cwd = repoWithFakeVendor();
  const c = await new Client({ FAKE_REPLY: 'I could not do it.' }).init();
  try {
    const { run_id } = await c.call('graph_open', { request: 'r', cwd, vendor: 'fake' });
    const v = await c.call('graph_run', { run_id, cwd, node_id: 'plan' });
    assert.equal(v.state, 'failed');
  } finally {
    c.close();
    rmSync(cwd, { recursive: true, force: true });
  }
});
