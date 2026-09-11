#!/usr/bin/env node
// Regression suite for the task-manager MCP server.
//
// Runs against the live stdio surface, with the graph-beta-engineering broker alongside it
// as a second process: the manager opens child runs as a library, the broker drives them,
// and the manager reads them back. No vendor CLI is needed; every node is self-submitted.
//
//   node --test graph-beta/scripts/test-taskmanager.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, appendFileSync, readFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const TM = join(HERE, '..', 'mcp', 'taskmanager.mjs');
const BROKER = join(HERE, '..', 'mcp', 'broker.mjs');

class Client {
  constructor(script, env = {}) {
    this.proc = spawn('node', [script], { stdio: ['pipe', 'pipe', 'inherit'], env: { ...process.env, ...env } });
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
  const dir = mkdtempSync(join(tmpdir(), 'tm-test-'));
  const git = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' });
  git('init', '-q');
  git('config', 'user.email', 't@t');
  git('config', 'user.name', 't');
  writeFileSync(join(dir, 'a.txt'), 'x\n');
  writeFileSync(join(dir, 'b.txt'), 'y\n');
  git('add', '-A');
  git('commit', '-qm', 'init');
  return dir;
}

const ok = (payload) => ({ stage_ok: true, evidence: 'e', ...payload });

const SHAPE = {
  acceptance: ['both modules build together'],
  packages: [
    { id: 'P1', title: 'module a', flow: 'develop', brief: 'change a.txt', acceptance: ['a.txt says a'], touches: ['a.txt'], deps: [] },
    { id: 'P2', title: 'module b', flow: 'develop', brief: 'change b.txt using a', acceptance: ['b.txt says b'], touches: ['b.txt'], deps: ['P1'] },
  ],
};

const CHILD_SPEC = {
  goal: 'G', acceptance: ['A'],
  subgoals: [{ id: 'U1', title: 'do it', acceptance: ['a'], test: ['t'], deps: [] }],
};

// Drive one child run from plan to report through the graph broker, exactly as the session would.
async function completeChild(g, child, { accept = true } = {}) {
  const { cwd, run_id } = child;
  const sub = (node_id, payload) => g.call('graph_submit', { run_id, cwd, node_id, payload: ok(payload) });
  let v = await sub('plan', { handoff: 'p', flow: 'develop', size: 'S' });
  assert.equal(v.state, 'done', JSON.stringify(v));
  await sub('setgoal', { spec: CHILD_SPEC });
  await sub('critique', { sound: true });
  // Distinct per package: git resolves identical hunks silently, and a conflict test needs a real one.
  appendFileSync(join(cwd, 'a.txt'), `changed by ${child.package_id || 'child'}\n`);
  v = await sub('implement:U1:1', { changed_files: ['a.txt'], handoff: 'built' });
  assert.equal(v.state, 'done', JSON.stringify(v));
  await sub('test:U1:1', { verified: true });
  await sub('gate:U1:1', { accept: true, match_pct: 95 });
  await sub('gate:goal:1', { accept, match_pct: accept ? 95 : 40, gaps: accept ? [] : ['missing the b half'], reason: accept ? '' : 'short' });
  const nx = await g.call('graph_next', { run_id, cwd });
  if (!accept) {
    // A rejected goal gate with retries left holds the report back: the child is blocked,
    // and the session driving it would retry a subgoal. Here it does not - the manager sees
    // a child that stopped, which is what the dispatch has to fold honestly.
    assert.equal(nx.state, 'blocked');
    return;
  }
  assert.deepEqual(nx.ready.map((n) => n.node_id), ['report']);
  await sub('report', { handoff: `child report for ${cwd}` });
  assert.equal((await g.call('graph_status', { run_id, cwd })).state, 'complete');
}

async function throughCritique(tm, task_id, shape = SHAPE) {
  let v = await tm.call('tm_submit', { task_id, node_id: 'size', payload: ok({ size: 'L', flow: 'develop', sizing: ['ls -> 2 modules'], handoff: 'two modules' }) });
  assert.equal(v.state, 'done', JSON.stringify(v));
  v = await tm.call('tm_submit', { task_id, node_id: 'shape', payload: ok({ ...shape, handoff: 's' }) });
  assert.equal(v.state, 'done', JSON.stringify(v));
  v = await tm.call('tm_submit', { task_id, node_id: 'critique', payload: ok({ sound: true }) });
  assert.equal(v.state, 'done', JSON.stringify(v));
}

async function withTask(fn) {
  const cwd = repo();
  const root = mkdtempSync(join(tmpdir(), 'tm-root-'));
  const tm = await new Client(TM, { HARNESS_TASKS_DIR: root }).init();
  const g = await new Client(BROKER).init();
  try {
    const open = await tm.call('tm_open', { request: 'big request', cwd, vendor: 'self' });
    await fn({ tm, g, cwd, root, task_id: open.task_id, open });
  } finally {
    tm.close();
    g.close();
    // Worktrees register in the repo; remove the repo first so git does not mind.
    rmSync(cwd, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
}

test('serves the MCP handshake and the five manager tools', async () => {
  const c = await new Client(TM).init();
  try {
    const r = await c.send('tools/list', {});
    assert.deepEqual(r.result.tools.map((t) => t.name).sort(), ['tm_next', 'tm_open', 'tm_retry', 'tm_status', 'tm_submit']);
  } finally {
    c.close();
  }
});

test('tm_open seeds size -> shape -> critique under the tasks root, not under the project', async () => {
  await withTask(async ({ cwd, root, task_id, open }) => {
    assert.deepEqual(open.ready.map((n) => n.node_id), ['size']);
    assert.equal(open.state, 'running');
    assert.ok(existsSync(join(root, task_id, 'task.json')));
    assert.ok(!existsSync(join(cwd, '.harness-run')), 'the project holds no manager state');
    const prompt = readFileSync(open.ready[0].briefing_path, 'utf8');
    assert.match(prompt, /# size node size \(task manager\)/);
    assert.match(prompt, /The default is S/);
    assert.match(prompt, /big request/);
  });
});

test('size S delegates to graph_open and leaves nothing on disk', async () => {
  await withTask(async ({ cwd, root, task_id, tm }) => {
    const v = await tm.call('tm_submit', { task_id, node_id: 'size', payload: ok({ size: 'S', flow: 'document', sizing: ['ls -> one file'] }) });
    assert.equal(v.state, 'done');
    assert.equal(v.size, 'S');
    assert.equal(v.task_state, 'delegated');
    assert.equal(v.delegate.tool, 'graph_open');
    assert.equal(v.delegate.args.cwd, cwd);
    assert.equal(v.delegate.args.request, 'big request');
    assert.equal(v.delegate.args.flow, 'document', 'the flow size chose travels with the delegation');
    assert.equal(v.delegate.args.vendor, 'self', 'routing arguments travel too');
    assert.ok(!existsSync(join(root, task_id)), 'an S request produces no manager state');
    assert.deepEqual(readdirSync(root), []);
    const after = await tm.call('tm_next', { task_id });
    assert.match(after.error, /unknown task/);
  });
});

test('a pinned flow survives sizing, and delegate.args open a graph run verbatim', async () => {
  const cwd = repo();
  const root = mkdtempSync(join(tmpdir(), 'tm-root-'));
  const tm = await new Client(TM, { HARNESS_TASKS_DIR: root }).init();
  const g = await new Client(BROKER).init();
  try {
    const { task_id } = await tm.call('tm_open', { request: 'r', cwd, flow: 'develop', vendor: 'self', max_retries: 1 });
    // size says document; the entry pinned develop, and the entry wins.
    const v = await tm.call('tm_submit', { task_id, node_id: 'size', payload: ok({ size: 'S', flow: 'document' }) });
    assert.equal(v.delegate.args.flow, 'develop');
    assert.equal(v.delegate.args.max_retries, 1);
    const open = await g.call('graph_open', { ...v.delegate.args, isolated: true });
    assert.ok(open.run_id, JSON.stringify(open));
    assert.deepEqual(open.ready.map((n) => n.node_id), ['plan']);
    const st = await g.call('graph_status', { run_id: open.run_id, cwd, full: true });
    assert.equal(st.flow, 'develop');
    assert.equal(st.isolated, true);
    assert.equal(st.max_retries, 1);
    assert.equal(st.request, 'r');
  } finally {
    tm.close(); g.close();
    rmSync(cwd, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test('a shape is validated: one package, overlapping touches, dangling deps and cycles fail it', async () => {
  await withTask(async ({ tm, task_id }) => {
    await tm.call('tm_submit', { task_id, node_id: 'size', payload: ok({ size: 'L', flow: 'develop' }) });
    const v = await tm.call('tm_submit', { task_id, node_id: 'shape', payload: ok({
      acceptance: ['x'],
      packages: [
        { id: 'P1', title: 'a', brief: 'b', acceptance: ['a'], touches: ['src/a'], deps: ['P2'] },
        { id: 'P2', title: 'b', brief: 'b', acceptance: ['a'], touches: ['src/a'], deps: ['P1', 'P9'] },
      ],
    }) });
    assert.equal(v.state, 'failed');
    assert.match(v.reason, /both touch src\/a/);
    assert.match(v.reason, /depends on P9, which is not in the shape/);
    assert.match(v.reason, /dependency cycle/);
    const single = await tm.call('tm_retry', { task_id });
    assert.equal(single.retried, true);
    const v2 = await tm.call('tm_submit', { task_id, node_id: 'shape:2', payload: ok({ acceptance: ['x'], packages: [{ id: 'P1', title: 'a', brief: 'b', acceptance: ['a'] }] }) });
    assert.equal(v2.state, 'failed');
    assert.match(v2.reason, /one package.*size S/);
    const prompt = readFileSync((await tm.call('tm_retry', { task_id })).ready[0].briefing_path, 'utf8');
    assert.match(prompt, /Previous attempt was rejected/);
    assert.match(prompt, /one package/);
  });
});

test('a sound shape dispatches its root package: worktree created, child run opened, node running', async () => {
  await withTask(async ({ tm, g, cwd, root, task_id }) => {
    await throughCritique(tm, task_id);
    const nx = await tm.call('tm_next', { task_id });
    assert.equal(nx.state, 'running');
    assert.deepEqual(nx.ready, [], 'nothing is left for a fresh agent: dispatch ran here');
    assert.equal(nx.children.length, 1, 'P2 depends on P1 and is not dispatched yet');
    const c = nx.children[0];
    assert.equal(c.node_id, 'dispatch:P1:1');
    assert.equal(c.package_id, 'P1');
    assert.equal(c.child_state, 'running');
    assert.match(c.next, /graph_next/);
    // The worktree is a real git worktree branched from HEAD, under the tasks root.
    assert.ok(c.cwd.startsWith(join(root, task_id, 'worktrees')));
    assert.equal(spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: c.cwd, encoding: 'utf8' }).stdout.trim(), c.branch);
    assert.equal(readFileSync(join(c.cwd, 'a.txt'), 'utf8'), 'x\n');
    // The child is a graph-beta run the broker can pick up by (cwd, run_id): isolated, flowed, briefed.
    const st = await g.call('graph_status', { run_id: c.run_id, cwd: c.cwd });
    assert.equal(st.state, 'running');
    assert.deepEqual(st.nodes.map((n) => n.node_id), ['plan', 'setgoal', 'critique']);
    assert.equal(st.flow, 'develop');
    const full = await g.call('graph_status', { run_id: c.run_id, cwd: c.cwd, full: true });
    assert.equal(full.isolated, true);
    assert.equal(full.request, 'change a.txt');
    assert.match(full.context, /package P1 \(module a\)/);
    assert.match(full.context, /a\.txt says a/);
    assert.equal(full.vendor, 'self', 'routing came from tm_open');
    // Folding before the child is done is refused, and costs nothing.
    const early = await tm.call('tm_submit', { task_id, node_id: 'dispatch:P1:1' });
    assert.match(early.error, /still running/);
    assert.equal((await tm.call('tm_status', { task_id, node_id: 'dispatch:P1:1' })).nodes[0].state, 'running');
  });
});

test('a parent with two dependent children runs to report; the second child sees the first\'s report', async () => {
  await withTask(async ({ tm, g, task_id }) => {
    await throughCritique(tm, task_id);
    let nx = await tm.call('tm_next', { task_id });
    await completeChild(g, nx.children[0]);
    // Read-only over children: folding the child leaves its run file byte-for-byte as the broker wrote it.
    const childPath = join(nx.children[0].cwd, '.harness-run', 'broker-beta', 'runs', `${nx.children[0].run_id}.json`);
    const beforeFold = readFileSync(childPath, 'utf8');
    let v = await tm.call('tm_submit', { task_id, node_id: 'dispatch:P1:1' });
    assert.equal(v.state, 'done', JSON.stringify(v));
    assert.equal(readFileSync(childPath, 'utf8'), beforeFold, 'the manager never writes a child run file');
    assert.match(v.child.commit, /^[0-9a-f]{40}$/, 'an accepted child\'s work is committed on its package branch');
    assert.equal(spawnSync('git', ['status', '--porcelain', '--', '.', ':!.harness-run'], { cwd: nx.children[0].cwd, encoding: 'utf8' }).stdout.trim(), '', 'the worktree is clean after the fold');
    assert.equal(v.accept, true);
    assert.equal(v.match_pct, 95);
    assert.equal(v.child.run_id, nx.children[0].run_id);
    nx = await tm.call('tm_next', { task_id });
    assert.deepEqual(nx.ready.map((n) => n.node_id), ['accept:P1:1']);
    assert.deepEqual(nx.children, [], 'P2 waits for P1 to be accepted, not merely dispatched');
    const acceptPrompt = readFileSync(nx.ready[0].briefing_path, 'utf8');
    assert.match(acceptPrompt, /## Package P1 — module a/);
    assert.match(acceptPrompt, /Its goal gate: accept=true match=95%/);
    assert.match(acceptPrompt, /child report for/);
    assert.match(acceptPrompt, /Files it reported changing:\n- a\.txt/);
    v = await tm.call('tm_submit', { task_id, node_id: 'accept:P1:1', payload: ok({ accept: true, match_pct: 90 }) });
    assert.equal(v.state, 'done');

    nx = await tm.call('tm_next', { task_id });
    assert.equal(nx.children.length, 1);
    assert.equal(nx.children[0].node_id, 'dispatch:P2:1');
    const p2 = await g.call('graph_status', { run_id: nx.children[0].run_id, cwd: nx.children[0].cwd, full: true });
    assert.match(p2.context, /Delivered by package P1/);
    assert.match(p2.context, /child report for/);
    assert.equal(readFileSync(join(nx.children[0].cwd, 'a.txt'), 'utf8'), 'x\nchanged by P1\n', 'P2 starts from what P1 delivered, not from HEAD');
    assert.notEqual(nx.children[0].cwd, (await tm.call('tm_status', { task_id, node_id: 'dispatch:P1:1' })).nodes[0].child.cwd, 'each package has its own worktree');
    await completeChild(g, nx.children[0]);
    await tm.call('tm_submit', { task_id, node_id: 'dispatch:P2:1' });
    await tm.call('tm_submit', { task_id, node_id: 'accept:P2:1', payload: ok({ accept: true, match_pct: 90 }) });

    nx = await tm.call('tm_next', { task_id });
    assert.deepEqual(nx.ready.map((n) => n.node_id), ['integrate:1']);
    const st = await tm.call('tm_status', { task_id, node_id: 'integrate:1' });
    assert.ok(st.nodes[0].deps.includes('accept:P1:1') && st.nodes[0].deps.includes('accept:P2:1'));
    const integ = readFileSync(nx.ready[0].briefing_path, 'utf8');
    const wtMatch = integ.match(/## Integration worktree\n(.*worktrees\/integration) on branch (harness\/[0-9a-f]{8}\/integration)/);
    assert.ok(wtMatch, integ);
    assert.match(integ, /Already merged, in dependency order:\n- P1: harness\/[0-9a-f]{8}\/P1 -> [0-9a-f]{40}\n- P2: harness\/[0-9a-f]{8}\/P2 -> [0-9a-f]{40}/, 'the manager merged, and says what');
    assert.match(integ, /You may run commands and change files only inside the integration worktree/);
    assert.match(integ, /### P1 — module a \(develop\)\nTouches: a\.txt/);
    assert.equal(readFileSync(join(wtMatch[1], 'a.txt'), 'utf8'), 'x\nchanged by P1\nchanged by P2\n', 'the integration tree holds both packages\' work');
    v = await tm.call('tm_submit', { task_id, node_id: 'integrate:1', payload: ok({ verified: true, checks: ['build -> ok'] }) });
    assert.equal(v.state, 'done');
    assert.equal(v.verified, true);
    assert.equal(v.integration.merged, 2);

    nx = await tm.call('tm_next', { task_id });
    assert.deepEqual(nx.ready.map((n) => n.node_id), ['gate:goal:1']);
    const gate = readFileSync(nx.ready[0].briefing_path, 'utf8');
    assert.match(gate, /## Every node in this task/);
    assert.match(gate, /### dispatch:P1:1 \(dispatch\) — done accept=true match=95%/);
    assert.match(gate, /### integrate:1 \(integrate\) — done verified=true/);
    assert.match(gate, /Merged:\n- P1 harness/, 'the gate sees the merge commits the manager made');
    assert.match(gate, /spec_drift/);
    await tm.call('tm_submit', { task_id, node_id: 'gate:goal:1', payload: ok({ accept: true, match_pct: 92 }) });
    nx = await tm.call('tm_next', { task_id });
    assert.deepEqual(nx.ready.map((n) => n.node_id), ['report']);
    v = await tm.call('tm_submit', { task_id, node_id: 'report', payload: ok({ handoff: 'all done' }) });
    assert.equal(v.state, 'done');
    const fin = await tm.call('tm_status', { task_id });
    assert.equal(fin.state, 'complete');
    assert.deepEqual(fin.packages, ['P1', 'P2']);
  });
});

const INDEPENDENT = {
  acceptance: ['both modules build together'],
  packages: [
    { id: 'P1', title: 'module a', flow: 'develop', brief: 'change a.txt', acceptance: ['a'], touches: ['a.txt'], deps: [] },
    { id: 'P2', title: 'module b', flow: 'develop', brief: 'change b.txt', acceptance: ['b'], touches: ['b.txt'], deps: [] },
  ],
};

// Both children edit a.txt - P2 despite declaring b.txt. Declared touches are a claim; the
// merge is the fact.
async function acceptBoth(tm, g, task_id) {
  const nx = await tm.call('tm_next', { task_id });
  assert.equal(nx.children.length, 2, 'independent packages dispatch together');
  for (const c of nx.children) {
    await completeChild(g, c);
    assert.equal((await tm.call('tm_submit', { task_id, node_id: c.node_id })).state, 'done');
  }
  for (const id of ['P1', 'P2']) {
    assert.equal((await tm.call('tm_submit', { task_id, node_id: `accept:${id}:1`, payload: ok({ accept: true, match_pct: 90 }) })).state, 'done');
  }
}

test('an integration conflict is observed by the manager, names the packages, and tm_retry({repackage}) reshapes them together', async () => {
  await withTask(async ({ tm, g, task_id }) => {
    await throughCritique(tm, task_id, INDEPENDENT);
    await acceptBoth(tm, g, task_id);
    const nx = await tm.call('tm_next', { task_id });
    assert.equal(nx.state, 'blocked');
    assert.deepEqual(nx.ready, [], 'no agent is asked to run checks on a tree that did not merge');
    const st = await tm.call('tm_status', { task_id, node_id: 'integrate:1' });
    const integ = st.nodes[0];
    assert.equal(integ.state, 'failed');
    assert.equal(integ.verified, false);
    assert.deepEqual(integ.conflicts, ['a.txt']);
    assert.deepEqual(integ.conflicting_packages, ['P2', 'P1'], 'the package being merged, then the merged owner by declared touches');
    assert.match(integ.reason, /merge of P2 conflicts on a\.txt with P1 \(by declared touches\)/);
    assert.match(integ.reason, /tm_retry\(\{repackage: \["P2", "P1"\]\}\)/);

    const bad = await tm.call('tm_retry', { task_id, repackage: ['P9'] });
    assert.match(bad.error, /not in the shape: P9/);
    const rt = await tm.call('tm_retry', { task_id, repackage: integ.conflicting_packages });
    assert.equal(rt.retried, true);
    assert.equal(rt.attempt, 2);
    assert.deepEqual(rt.repackage, ['P2', 'P1']);
    assert.deepEqual(rt.ready.map((n) => n.node_id), ['shape:2']);
    const prompt = readFileSync(rt.ready[0].briefing_path, 'utf8');
    assert.match(prompt, /Repackage P2 and P1: they conflicted at integration/);
    assert.match(prompt, /Conflicting files: a\.txt/);
    assert.match(prompt, /P2 \(module b\) declared touches: b\.txt/);
    assert.match(prompt, /Worktrees of package ids you keep are reused/);
    const after = await tm.call('tm_status', { task_id });
    assert.equal(after.nodes.find((n) => n.node_id === 'dispatch:P1:1').state, 'done', 'delivered packages stay as evidence');
    assert.equal(after.nodes.find((n) => n.node_id === 'gate:goal:1').state, 'skipped');
  });
});

test('two dependencies that conflict with each other fail the dependent dispatch before any child is opened', async () => {
  await withTask(async ({ tm, g, task_id }) => {
    await throughCritique(tm, task_id, {
      ...INDEPENDENT,
      packages: [...INDEPENDENT.packages, { id: 'P3', title: 'glue', flow: 'develop', brief: 'join them', acceptance: ['c'], touches: ['c.txt'], deps: ['P1', 'P2'] }],
    });
    await acceptBoth(tm, g, task_id);
    const nx = await tm.call('tm_next', { task_id });
    assert.deepEqual(nx.children, [], 'P3 was not dispatched');
    const d = (await tm.call('tm_status', { task_id, node_id: 'dispatch:P3:1' })).nodes[0];
    assert.equal(d.state, 'failed');
    assert.deepEqual(d.conflicts, ['a.txt']);
    assert.deepEqual(d.conflicting_packages, ['P2', 'P1']);
    assert.match(d.reason, /dependencies of P3 conflict with each other on a\.txt/);
    assert.match(d.reason, /repackage them/);
  });
});

test('a child whose goal gate rejected fails the dispatch; tm_retry reopens it in the same worktree with the gaps', async () => {
  await withTask(async ({ tm, g, task_id }) => {
    await throughCritique(tm, task_id);
    let nx = await tm.call('tm_next', { task_id });
    const first = nx.children[0];
    await completeChild(g, first, { accept: false });
    const v = await tm.call('tm_submit', { task_id, node_id: 'dispatch:P1:1' });
    assert.equal(v.state, 'failed');
    assert.equal(v.accept, false);
    assert.equal(v.gap_count, 1);
    assert.match(v.reason, /short/);
    nx = await tm.call('tm_next', { task_id });
    assert.equal(nx.state, 'blocked');
    const rt = await tm.call('tm_retry', { task_id, package_id: 'P1' });
    assert.equal(rt.retried, true);
    assert.equal(rt.attempt, 2);
    assert.equal(rt.children.length, 1);
    const second = rt.children[0];
    assert.equal(second.node_id, 'dispatch:P1:2');
    assert.equal(second.cwd, first.cwd, 'the retry continues in the worktree the first attempt left');
    assert.notEqual(second.run_id, first.run_id, 'but it is a fresh child run');
    const child = await g.call('graph_status', { run_id: second.run_id, cwd: second.cwd, full: true });
    assert.match(child.request, /Previous attempt of this package was rejected/);
    assert.match(child.request, /missing the b half/);
    assert.equal(readFileSync(join(second.cwd, 'a.txt'), 'utf8'), 'x\nchanged by P1\n', 'the first attempt\'s work is still there');
    const st = await tm.call('tm_status', { task_id });
    assert.equal(st.nodes.find((n) => n.node_id === 'accept:P1:1').state, 'skipped');
    assert.deepEqual(st.nodes.find((n) => n.node_id === 'dispatch:P2:1').deps, ['critique', 'accept:P1:2'], 'P2 now waits on the new attempt');
  });
});

test('the package retry budget settles: downstream becomes unreachable and the report is released', async () => {
  await withTask(async ({ tm, g, task_id }) => {
    await throughCritique(tm, task_id);
    for (let attempt = 1; attempt <= 3; attempt++) {
      const nx = attempt === 1 ? await tm.call('tm_next', { task_id }) : await tm.call('tm_retry', { task_id, package_id: 'P1' });
      const child = nx.children.find((c) => c.node_id === `dispatch:P1:${attempt}`);
      assert.ok(child, `attempt ${attempt} dispatched`);
      await completeChild(g, child, { accept: false });
      assert.equal((await tm.call('tm_submit', { task_id, node_id: `dispatch:P1:${attempt}` })).state, 'failed');
    }
    const rt = await tm.call('tm_retry', { task_id, package_id: 'P1' });
    assert.equal(rt.retried, false);
    assert.match(rt.reason, /budget exhausted/);
    assert.ok(rt.unreachable.includes('accept:P1:3'));
    assert.ok(rt.unreachable.includes('dispatch:P2:1'));
    assert.ok(rt.unreachable.includes('integrate:1'));
    assert.ok(rt.unreachable.includes('gate:goal:1'));
    assert.deepEqual(rt.ready.map((n) => n.node_id), ['report']);
    const prompt = readFileSync(rt.ready[0].briefing_path, 'utf8');
    assert.match(prompt, /### dispatch:P1:3 \(dispatch\) — failed accept=false/);
    assert.match(prompt, /### integrate:1 \(integrate\) — unreachable/);
    await tm.call('tm_submit', { task_id, node_id: 'report', payload: ok({ handoff: 'partial' }) });
    assert.equal((await tm.call('tm_status', { task_id })).state, 'complete');
  });
});

test('kill and restart the manager: the tree resumes from files and no running dispatch is reclaimed', async () => {
  await withTask(async ({ tm, g, root, task_id }) => {
    await throughCritique(tm, task_id);
    const before = await tm.call('tm_next', { task_id });
    tm.close();
    const tm2 = await new Client(TM, { HARNESS_TASKS_DIR: root }).init();
    try {
      const list = await tm2.call('tm_status', {});
      assert.equal(list.tasks.length, 1);
      assert.equal(list.tasks[0].task_id, task_id);
      const after = await tm2.call('tm_next', { task_id });
      assert.equal(after.state, 'running');
      assert.deepEqual(after.children.map((c) => [c.node_id, c.run_id, c.cwd]), before.children.map((c) => [c.node_id, c.run_id, c.cwd]), 'the same child, not a second one');
      await completeChild(g, after.children[0]);
      const v = await tm2.call('tm_submit', { task_id, node_id: 'dispatch:P1:1' });
      assert.equal(v.state, 'done', JSON.stringify(v));
    } finally {
      tm2.close();
    }
  });
});

test('a project that is not a git repository fails the dispatch with the reason, not a hang', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'tm-nogit-'));
  const root = mkdtempSync(join(tmpdir(), 'tm-root-'));
  const tm = await new Client(TM, { HARNESS_TASKS_DIR: root }).init();
  try {
    const { task_id } = await tm.call('tm_open', { request: 'r', cwd });
    await throughCritique(tm, task_id);
    const nx = await tm.call('tm_next', { task_id });
    assert.equal(nx.state, 'blocked');
    assert.deepEqual(nx.children, []);
    const st = await tm.call('tm_status', { task_id, node_id: 'dispatch:P1:1' });
    assert.equal(st.nodes[0].state, 'failed');
    assert.match(st.nodes[0].reason, /could not create a worktree for P1/);
  } finally {
    tm.close();
    rmSync(cwd, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});
