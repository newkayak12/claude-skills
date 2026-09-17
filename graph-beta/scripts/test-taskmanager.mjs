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
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, readFileSync, rmSync, existsSync, readdirSync, realpathSync } from 'node:fs';
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
  // Real projects ignore the run state directory. With it ignored, `git add -- . ':!.harness-run'`
  // exits 1 ("paths are ignored") - the fold that the first e2e task reached failed on exactly this.
  writeFileSync(join(dir, '.gitignore'), '.harness-run/\n');
  git('add', '-A');
  git('commit', '-qm', 'init');
  return dir;
}

// A default so every existing fixture keeps behaving as if it had checked something -
// the manager now refuses an accept:true/verified:true verdict with an empty checks[].
// Tests of that rule itself pass their own checks: [] to override the default.
// attacks is the goal gate's analogous default (graph.mjs Step 9): accept:true with an
// empty attacks[] is refused by the real broker exactly like an empty checks[], and every
// child run's gate:goal here is a real broker-adjudicated node.
const ok = (payload) => ({ stage_ok: true, evidence: 'e', checks: ['ok -> looked fine'], attacks: ['ok -> looked fine from outside'], ...payload });

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

async function withTask(fn, extra) {
  const cwd = repo();
  const root = mkdtempSync(join(tmpdir(), 'tm-root-'));
  const tm = await new Client(TM, { HARNESS_TASKS_DIR: root, HARNESS_TEST_NO_DRIVER: '1' }).init();
  const g = await new Client(BROKER).init();
  try {
    // These tests submit every node by hand through the broker, so they ask the manager to spawn
    // nothing. HARNESS_TEST_NO_DRIVER is a test seam, not an option: a real session never drives.
    const open = await tm.call('tm_open', { request: 'big request', cwd, vendor: 'self', ...extra });
    await fn({ tm, g, cwd, root, task_id: open.task_id, open });
  } finally {
    tm.close();
    g.close();
    // Worktrees register in the repo; remove the repo first so git does not mind.
    rmSync(cwd, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
}

test('serves the MCP handshake and the six manager tools', async () => {
  const c = await new Client(TM).init();
  try {
    const r = await c.send('tools/list', {});
    assert.deepEqual(r.result.tools.map((t) => t.name).sort(), ['tm_events', 'tm_next', 'tm_open', 'tm_retry', 'tm_status', 'tm_submit']);
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

test('tm_open({size}) pins the size: L opens shape without measuring, S opens its single run at once', async () => {
  const cwd = repo();
  const root = mkdtempSync(join(tmpdir(), 'tm-root-'));
  const tm = await new Client(TM, { HARNESS_TASKS_DIR: root, HARNESS_TEST_NO_DRIVER: '1' }).init();
  try {
    const L = await tm.call('tm_open', { request: 'big request', cwd, flow: 'develop', vendor: 'self', size: 'L' });
    assert.equal(L.state, 'running', JSON.stringify(L));
    assert.equal(L.size, 'L');
    assert.deepEqual(L.ready.map((r) => r.node_id), ['shape'], 'nothing was measured: shape is ready at once');
    const task = JSON.parse(readFileSync(join(root, L.task_id, 'task.json'), 'utf8'));
    const size = task.nodes.find((n) => n.node_id === 'size');
    assert.equal(size.state, 'done');
    assert.equal(size.result.size_source, 'pinned');
    const S = await tm.call('tm_open', { request: 'small request', cwd, flow: 'document', vendor: 'self', size: 'S' });
    assert.equal(S.task_state, 's_run');
    assert.ok(S.run_id, 'a pinned S opens its single graph run at once');
    const sTask = JSON.parse(readFileSync(join(root, S.task_id, 'task.json'), 'utf8'));
    assert.equal(sTask.nodes.find((n) => n.node_id === 'size').result.size_source, 'pinned');
    assert.equal(sTask.s_run.run_id, S.run_id);
  } finally { tm.close(); rmSync(cwd, { recursive: true, force: true }); rmSync(root, { recursive: true, force: true }); }
});

test('a pinned flow survives sizing and reaches the single run the manager opens', async () => {
  const cwd = repo();
  const root = mkdtempSync(join(tmpdir(), 'tm-root-'));
  const tm = await new Client(TM, { HARNESS_TASKS_DIR: root, HARNESS_TEST_NO_DRIVER: '1' }).init();
  const g = await new Client(BROKER).init();
  try {
    const { task_id } = await tm.call('tm_open', { request: 'r', cwd, flow: 'develop', vendor: 'self', max_retries: 1, isolated: true });
    // size says document; the entry pinned develop, and the entry wins.
    const v = await tm.call('tm_submit', { task_id, node_id: 'size', payload: ok({ size: 'S', flow: 'document' }) });
    assert.equal(v.task_state, 's_run');
    assert.ok(v.run_id, JSON.stringify(v));
    const st = await g.call('graph_status', { run_id: v.run_id, cwd, full: true });
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
    assert.ok(existsSync(join(c.cwd, '.claude', '.harness-markers', `team-${task_id.slice(0, 8)}`)), 'worktree carries the shared engagement marker');
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

// ---------- silent-ungated-worktree trap ----------
//
// A worktree holds only what git committed. A project that installed harness but has not yet
// committed .claude/harness-gate.json leaves every package worktree with no gate config at all -
// worker writes there are silently ungated, and the user still believes tm_open protects them.
// ensureWorktree cannot block on this (fail-open is the rule every hook in this codebase
// follows) but it must say so somewhere a person looks: the ledger, same as dispatch/integrated.
function addGateConfig(cwd) {
  mkdirSync(join(cwd, '.claude'), { recursive: true });
  writeFileSync(join(cwd, '.claude', 'harness-gate.json'), '{}\n');
}

test('a committed harness gate reaches the worktree: no uncommitted-gate warning', async () => {
  await withTask(async ({ tm, cwd, task_id }) => {
    addGateConfig(cwd);
    spawnSync('git', ['add', '.claude/harness-gate.json'], { cwd });
    spawnSync('git', ['commit', '-qm', 'add harness gate'], { cwd });
    await throughCritique(tm, task_id);
    await tm.call('tm_next', { task_id });
    const events = (await tm.call('tm_events', { task_id })).events;
    assert.ok(!events.some((e) => e.event === 'gate_uncommitted'), JSON.stringify(events));
  });
});

test('an uncommitted harness gate leaves the worktree silently ungated: ensureWorktree warns in the ledger', async () => {
  await withTask(async ({ tm, cwd, task_id }) => {
    // The gate file exists in the project's working tree but was never committed - exactly
    // the state `harness:install` leaves a project in until the user commits its output.
    addGateConfig(cwd);
    await throughCritique(tm, task_id);
    await tm.call('tm_next', { task_id });
    const events = (await tm.call('tm_events', { task_id })).events;
    const warn = events.find((e) => e.event === 'gate_uncommitted');
    assert.ok(warn, JSON.stringify(events));
    assert.match(warn.reason, /commit \.claude\/harness-gate\.json/i);
    assert.match(warn.reason, /worktree inherits only committed files/i);
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

// ---------- the manager's own goal gate has the same floor as the graph engine's ----------

// Drive the default two-package SHAPE to the point where gate:goal:1 is ready, reusing
// the same helpers the integrate tests use.
async function toManagerGoalGate(tm, g, task_id) {
  await toIntegrate(tm, g, task_id);
  await tm.call('tm_submit', { task_id, node_id: 'integrate:1', payload: ok({ verified: true, checks: ['build -> ok'] }) });
}

test('the manager\'s goal gate accepting at 85 fails: the number overrules the word', async () => {
  await withTask(async ({ tm, g, task_id }) => {
    await toManagerGoalGate(tm, g, task_id);
    const v = await tm.call('tm_submit', { task_id, node_id: 'gate:goal:1', payload: ok({ accept: true, match_pct: 85 }) });
    assert.equal(v.stage_ok, true, 'the judging itself worked');
    assert.equal(v.accept, true, 'and the gate did say accept');
    assert.equal(v.state, 'failed', 'the number it reported overrules the word');
    assert.match(v.reason, /match_pct 85 below the goal threshold 90/);
  });
});

test('tm_open({goal_threshold: 80}) lets the same 85% accept', async () => {
  await withTask(async ({ tm, g, task_id }) => {
    await toManagerGoalGate(tm, g, task_id);
    const v = await tm.call('tm_submit', { task_id, node_id: 'gate:goal:1', payload: ok({ accept: true, match_pct: 85 }) });
    assert.equal(v.state, 'done', 'a manager may decide the percentage is not its bar');
  }, { goal_threshold: 80 });
});

test('tm_open({goal_threshold}) is stored on the task and reaches every child through child_opts', async () => {
  const cwd = repo();
  const root = mkdtempSync(join(tmpdir(), 'tm-root-'));
  // No HARNESS_CHILD_DRIVER override here: without HARNESS_TEST_NO_LEADER, tm_open would try to
  // spawn a real `claude` process for the TaskLeader the moment it is called.
  const tm = await new Client(TM, { HARNESS_TASKS_DIR: root, HARNESS_TEST_NO_LEADER: '1' }).init();
  try {
    const open = await tm.call('tm_open', { request: 'r', cwd, vendor: 'self', goal_threshold: 77 });
    const task = JSON.parse(readFileSync(join(root, open.task_id, 'task.json'), 'utf8'));
    assert.equal(task.goal_threshold, 77);
    assert.equal(task.child_opts.goal_threshold, 77, 'every child run is opened with the same floor');
  } finally {
    tm.close();
    rmSync(cwd, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test('an accept node that says accept with no checks fails, not the package it judged', async () => {
  await withTask(async ({ tm, g, task_id }) => {
    await throughCritique(tm, task_id);
    const nx = await tm.call('tm_next', { task_id });
    await completeChild(g, nx.children[0]);
    await tm.call('tm_submit', { task_id, node_id: 'dispatch:P1:1' });
    const v = await tm.call('tm_submit', {
      task_id, node_id: 'accept:P1:1', payload: ok({ accept: true, match_pct: 90, checks: [] }),
    });
    assert.equal(v.stage_ok, false, 'the judging itself is what failed here');
    assert.equal(v.state, 'failed');
    assert.match(v.reason, /positive verdict without a check/);
    assert.match(v.reason, /judgement with no evidence is a guess/);
  });
});

// Drive SHAPE (P2 depends on P1) to the point where integrate:1 is ready, in the fewest calls.
async function toIntegrate(tm, g, task_id) {
  await throughCritique(tm, task_id);
  let nx = await tm.call('tm_next', { task_id });
  await completeChild(g, nx.children[0]);
  assert.equal((await tm.call('tm_submit', { task_id, node_id: 'dispatch:P1:1' })).state, 'done');
  assert.equal((await tm.call('tm_submit', { task_id, node_id: 'accept:P1:1', payload: ok({ accept: true, match_pct: 90 }) })).state, 'done');
  nx = await tm.call('tm_next', { task_id });
  await completeChild(g, nx.children[0]);
  assert.equal((await tm.call('tm_submit', { task_id, node_id: 'dispatch:P2:1' })).state, 'done');
  assert.equal((await tm.call('tm_submit', { task_id, node_id: 'accept:P2:1', payload: ok({ accept: true, match_pct: 90 }) })).state, 'done');
  nx = await tm.call('tm_next', { task_id });
  assert.deepEqual(nx.ready.map((n) => n.node_id), ['integrate:1']);
  return nx;
}

test('a failed integrate reopens once the package it blamed is retried; an unknown package id is refused', async () => {
  // The first docs task to finish its packages ended here: integrate ran the README examples,
  // one package's failed, the package was retried and accepted - and integrate stayed failed
  // with the goal gate pending behind it. The session's only probe, tm_retry({package_id:
  // "integrate"}), opened a phantom package.
  await withTask(async ({ tm, g, task_id }) => {
    await toIntegrate(tm, g, task_id);
    let v = await tm.call('tm_submit', { task_id, node_id: 'integrate:1', payload: ok({ verified: false, checks: ['run example -> P2 example fails'], gaps: ['P2 example does not run'] }) });
    assert.equal(v.state, 'failed');
    let nx = await tm.call('tm_next', { task_id });
    assert.equal(nx.state, 'blocked');

    const bad = await tm.call('tm_retry', { task_id, package_id: 'integrate' });
    assert.match(bad.error, /no package integrate in the shape \(packages: P1, P2\)/);
    assert.equal((await tm.call('tm_status', { task_id })).nodes.filter((n) => n.node_id.startsWith('dispatch:integrate')).length, 0, 'no phantom package');

    const rt = await tm.call('tm_retry', { task_id, package_id: 'P2' });
    assert.equal(rt.retried, true);
    assert.equal(rt.children.length, 1);
    assert.equal(rt.children[0].node_id, 'dispatch:P2:2');
    await completeChild(g, rt.children[0]);
    assert.equal((await tm.call('tm_submit', { task_id, node_id: 'dispatch:P2:2' })).state, 'done');
    assert.equal((await tm.call('tm_submit', { task_id, node_id: 'accept:P2:2', payload: ok({ accept: true, match_pct: 96 }) })).state, 'done');

    nx = await tm.call('tm_next', { task_id });
    assert.deepEqual(nx.ready.map((n) => n.node_id), ['integrate:2'], 'a fresh integrate judges the combined tree again');
    const st = await tm.call('tm_status', { task_id, node_id: 'integrate:2' });
    assert.ok(st.nodes[0].deps.includes('accept:P2:2') && st.nodes[0].deps.includes('accept:P1:1'), JSON.stringify(st.nodes[0].deps));
    const briefing = readFileSync(nx.ready[0].briefing_path, 'utf8');
    assert.match(briefing, /P2 example does not run/, 'the failed checks travel to the new integrate');
    const gate = (await tm.call('tm_status', { task_id, node_id: 'gate:goal:1' })).nodes[0];
    assert.deepEqual(gate.deps, ['integrate:2'], 'the goal gate waits for the new integrate, not the failed one');
    v = await tm.call('tm_submit', { task_id, node_id: 'integrate:2', payload: ok({ verified: true, checks: ['run example -> ok'] }) });
    assert.equal(v.state, 'done');
    assert.equal(v.integration.merged, 2, 'the retried package branch was merged again');
    nx = await tm.call('tm_next', { task_id });
    assert.deepEqual(nx.ready.map((n) => n.node_id), ['gate:goal:1']);
  });
});

// A seam: the combined tree fails a check no package's own worktree can reproduce. Before the
// repair package the only tool was tm_retry({package_id}), which reopens the blamed package in
// its own tree - where the offending claim is still true. `goal-docs` round 2 died there.
async function toSeam(tm, task_id) {
  const v = await tm.call('tm_submit', { task_id, node_id: 'integrate:1', payload: ok({
    verified: false,
    checks: ['run the README example -> fails: P2 documents a command only P1 installs'],
    gaps: ['the README example only runs with both packages present'],
    reason: 'the seam between P1 and P2 fails; neither package is wrong on its own',
  }) });
  assert.equal(v.state, 'failed', JSON.stringify(v));
  return (await tm.call('tm_status', { task_id, node_id: 'integrate:1' })).nodes[0].integration;
}

test('a seam opens a repair package whose worktree IS the integration tree, and the next integrate starts from it', async () => {
  await withTask(async ({ tm, g, root, task_id }) => {
    await toIntegrate(tm, g, task_id);
    const early = await tm.call('tm_retry', { task_id, repair: true });
    assert.match(early.error, /integrate:1 is pending, not failed/, 'nothing to repair until integrate has refused');

    const tree = await toSeam(tm, task_id);
    assert.equal(tree.merged, 2);

    const rt = await tm.call('tm_retry', { task_id, repair: true });
    assert.equal(rt.retried, true, JSON.stringify(rt));
    assert.equal(rt.package_id, 'R1');
    assert.equal(rt.repairs, 'integrate:1');
    assert.deepEqual((await tm.call('tm_status', { task_id })).packages, ['P1', 'P2', 'R1']);
    assert.equal(rt.children.length, 1);
    assert.equal(rt.children[0].node_id, 'dispatch:R1:1');
    assert.equal(rt.children[0].cwd, tree.cwd, 'the repair child runs in the integration worktree, not one of its own');
    assert.equal(rt.children[0].branch, tree.branch);
    assert.ok(!existsSync(join(root, task_id, 'worktrees', 'R1')), 'a repair package gets no worktree of its own');

    const child = await g.call('graph_status', { run_id: rt.children[0].run_id, cwd: rt.children[0].cwd, full: true });
    assert.match(child.request, /make the integration checks below pass/);
    assert.match(child.request, /the README example only runs with both packages present/);
    assert.match(child.request, /P2 documents a command only P1 installs/);
    assert.match(child.context, /COMBINED tree of every package in this task/);
    assert.match(child.context, /Every package's files are yours to touch/);
    assert.match(child.context, /Do not undo another package's work/);
    assert.match(child.context, /Paths the packages of this task own\. All of them are in scope here:/);
    assert.match(child.context, /- a\.txt\n- b\.txt/, 'the union of every package\'s touches');

    await completeChild(g, rt.children[0]);
    let v = await tm.call('tm_submit', { task_id, node_id: 'dispatch:R1:1' });
    assert.equal(v.state, 'done', JSON.stringify(v));
    assert.equal(v.child.branch, tree.branch, 'the repair is committed on the integration branch itself');
    assert.ok(v.child.commit, 'and it is a commit, not just a dirty tree');
    assert.equal((await tm.call('tm_submit', { task_id, node_id: 'accept:R1:1', payload: ok({ accept: true, match_pct: 95 }) })).state, 'done');

    const nx = await tm.call('tm_next', { task_id });
    assert.deepEqual(nx.ready.map((n) => n.node_id), ['integrate:2']);
    const file = JSON.parse(readFileSync(join(root, task_id, 'task.json'), 'utf8'));
    const two = file.nodes.find((n) => n.node_id === 'integrate:2');
    assert.equal(two.supersedes, 'integrate:1');
    assert.equal(two.integration.based_on, 'repair');
    assert.deepEqual(two.integration.merged.map((m) => m.package), ['R1'], 'nothing is re-merged: that would rebuild the tree the seam was in');
    assert.match(readFileSync(join(two.integration.cwd, 'a.txt'), 'utf8'), /changed by R1/, 'the repair commit is what round 2 checks');
    assert.deepEqual(file.nodes.find((n) => n.node_id === 'gate:goal:1').deps, ['integrate:2'], 'the goal gate waits for the repaired integrate');
    assert.deepEqual(file.nodes.find((n) => n.node_id === 'report').after, ['gate:goal:1'], 'and the report stays behind the gate');
    const briefing = readFileSync(nx.ready[0].briefing_path, 'utf8');
    assert.match(briefing, /repaired integration branch of package R1/);
    assert.match(briefing, /the README example only runs with both packages present/, 'the failed checks travel to the new integrate');

    v = await tm.call('tm_submit', { task_id, node_id: 'integrate:2', payload: ok({ verified: true, checks: ['run the README example -> ok'] }) });
    assert.equal(v.state, 'done');
    assert.equal(v.integration.merged, 1);
    assert.deepEqual((await tm.call('tm_next', { task_id })).ready.map((n) => n.node_id), ['gate:goal:1']);
  });
});

test('package_id: "integration" is the alias for a repair; "integrate" is still not a package', async () => {
  await withTask(async ({ tm, g, task_id }) => {
    await toIntegrate(tm, g, task_id);
    await toSeam(tm, task_id);
    const rt = await tm.call('tm_retry', { task_id, package_id: 'integration' });
    assert.equal(rt.retried, true, JSON.stringify(rt));
    assert.equal(rt.repair, true);
    assert.equal(rt.package_id, 'R1');
    assert.equal(rt.children[0].node_id, 'dispatch:R1:1');
    const bad = await tm.call('tm_retry', { task_id, package_id: 'integrate' });
    assert.match(bad.error, /no package integrate in the shape/, 'the alias is one word, not any word that looks like it');
  });
});

test('a merge conflict is refused a repair: that is a shape failure, and repackage is the route', async () => {
  await withTask(async ({ tm, g, task_id }) => {
    await throughCritique(tm, task_id, INDEPENDENT);
    await acceptBoth(tm, g, task_id);
    assert.equal((await tm.call('tm_next', { task_id })).state, 'blocked');
    const bad = await tm.call('tm_retry', { task_id, repair: true });
    assert.match(bad.error, /integrate:1 failed on a merge conflict \(a\.txt\)/);
    assert.match(bad.error, /tm_retry\(\{task_id, repackage: \["P2", "P1"\]\}\)/);
    assert.deepEqual((await tm.call('tm_status', { task_id })).packages, ['P1', 'P2'], 'no repair package was appended');
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
  // auto_reassign:false on the child runs: this test drives the manager's OWN
  // dispatch-fold/tm_retry path on a rejected child. With it on, the child's rejected
  // goal gate now opens a repair pass on itself (graph-beta Step 9, out of scope for
  // the manager's own gate:goal per the taskmanager plan) before the manager ever
  // folds the dispatch.
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
  }, { auto_reassign: false });
});

test('the package retry budget settles: downstream becomes unreachable and the report is released', async () => {
  // Same reason as above: auto_reassign:false keeps the rejected children's own goal
  // gates from opening a repair pass, so the dispatch fold sees a plain rejection.
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
  }, { auto_reassign: false });
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
  // No HARNESS_CHILD_DRIVER override here: without HARNESS_TEST_NO_LEADER, tm_open would try to
  // spawn a real `claude` process for the TaskLeader the moment it is called.
  const tm = await new Client(TM, { HARNESS_TASKS_DIR: root, HARNESS_TEST_NO_LEADER: '1' }).init();
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

test('a stage briefing carries its method, and the contract outranks what the method asks for', async () => {
  const cwd = repo();
  const root = mkdtempSync(join(tmpdir(), 'tm-root-'));
  // No HARNESS_CHILD_DRIVER override here: without HARNESS_TEST_NO_LEADER, tm_open would try to
  // spawn a real `claude` process for the TaskLeader the moment it is called.
  const tm = await new Client(TM, { HARNESS_TASKS_DIR: root, HARNESS_TEST_NO_LEADER: '1' }).init();
  try {
    const open = await tm.call('tm_open', { request: 'big request', cwd, vendor: 'self', size: 'L' });
    // size is a measurement: it gets no method at all, and reaching for one is its failure mode.
    const sizing = readFileSync(open.ready.find((n) => n.stage === 'shape' || n.stage === 'size')?.briefing_path, 'utf8');
    const shape = open.ready.find((n) => n.stage === 'shape');
    assert.ok(shape, 'a pinned L task opens at shape');
    assert.match(sizing, /## Method/);
    assert.match(sizing, /develop:domain-driven-design/);
    // The three things a headless node needs said out loud.
    assert.match(sizing, /output template does not apply/);
    assert.match(sizing, /ask no questions/);
    assert.match(sizing, /not installed here is simply skipped/);
    // Unfalsifiable otherwise: the stage has to say what it actually loaded.
    assert.match(sizing, /"skills_used"/);
  } finally {
    tm.close();
    rmSync(cwd, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test('the shape contract asks each package for optional skills, and says why shape is the one to name them', async () => {
  const cwd = repo();
  const root = mkdtempSync(join(tmpdir(), 'tm-root-'));
  // No HARNESS_CHILD_DRIVER override here: without HARNESS_TEST_NO_LEADER, tm_open would try to
  // spawn a real `claude` process for the TaskLeader the moment it is called.
  const tm = await new Client(TM, { HARNESS_TASKS_DIR: root, HARNESS_TEST_NO_LEADER: '1' }).init();
  try {
    const open = await tm.call('tm_open', { request: 'big request', cwd, vendor: 'self', size: 'L' });
    const shape = readFileSync(open.ready.find((n) => n.stage === 'shape').briefing_path, 'utf8');
    assert.match(shape, /"skills": \["plugin:skill"\]/);
    assert.match(shape, /optional/);
    assert.match(shape, /CLI package and a reference-document package want different method/);
    assert.match(shape, /travel into its child run/);
  } finally {
    tm.close();
    rmSync(cwd, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

const SKILLED = {
  acceptance: ['both modules build together'],
  packages: [
    { ...SHAPE.packages[0], skills: ['develop:cli-developer', 'develop:clean-code'] },
    SHAPE.packages[1],
  ],
};

test('a package that names skills hands them to its child run with the precedence rules attached', async () => {
  await withTask(async ({ tm, g, task_id }) => {
    await throughCritique(tm, task_id, SKILLED);
    const nx = await tm.call('tm_next', { task_id });
    const child = await g.call('graph_status', { run_id: nx.children[0].run_id, cwd: nx.children[0].cwd, full: true });
    assert.match(child.context, /Method for this package/);
    assert.match(child.context, /- develop:cli-developer\n- develop:clean-code/);
    // The child's nodes never read the manager's briefing, so the three rules have to be here.
    assert.match(child.context, /not installed here is skipped without comment or substitute/);
    assert.match(child.context, /output template does not apply/);
    assert.match(child.context, /ask nothing and finish the work yourself/);
    assert.equal(child.request, 'change a.txt', 'the brief itself is untouched');
  });
});

test('a package that names no skills produces the child request and context it produced before', async () => {
  let plain = null;
  await withTask(async ({ tm, g, task_id }) => {
    await throughCritique(tm, task_id, SHAPE);
    const nx = await tm.call('tm_next', { task_id });
    const child = await g.call('graph_status', { run_id: nx.children[0].run_id, cwd: nx.children[0].cwd, full: true });
    plain = { request: child.request, context: child.context };
    assert.doesNotMatch(child.context, /Method for this package/);
  });
  // Same shape with skills added to the OTHER package: P1's child is byte-for-byte what it was.
  await withTask(async ({ tm, g, task_id }) => {
    await throughCritique(tm, task_id, { ...SHAPE, packages: [SHAPE.packages[0], { ...SHAPE.packages[1], skills: ['write:writing-plans'] }] });
    const nx = await tm.call('tm_next', { task_id });
    const child = await g.call('graph_status', { run_id: nx.children[0].run_id, cwd: nx.children[0].cwd, full: true });
    assert.equal(child.request, plain.request);
    assert.equal(child.context, plain.context);
  });
});

test('the packages listing shows a package\'s method so critique can attack the choice', async () => {
  await withTask(async ({ tm, task_id }) => {
    await tm.call('tm_submit', { task_id, node_id: 'size', payload: ok({ size: 'L', flow: 'develop' }) });
    await tm.call('tm_submit', { task_id, node_id: 'shape', payload: ok({ ...SKILLED, handoff: 's' }) });
    const nx = await tm.call('tm_next', { task_id });
    const critique = readFileSync(nx.ready.find((n) => n.stage === 'critique').briefing_path, 'utf8');
    assert.match(critique, /### P1 — module a \(develop\)\nTouches: a\.txt\nMethod: develop:cli-developer, develop:clean-code/);
    assert.doesNotMatch(critique, /### P2 — module b \(develop\)\nTouches: b\.txt\nMethod:/, 'a package with no skills gets no Method line');
  });
});

test('skills: false runs every stage on its contract alone, and an override replaces the default', async () => {
  const cwd = repo();
  const root = mkdtempSync(join(tmpdir(), 'tm-root-'));
  // No HARNESS_CHILD_DRIVER override here: without HARNESS_TEST_NO_LEADER, tm_open would try to
  // spawn a real `claude` process for the TaskLeader the moment it is called.
  const tm = await new Client(TM, { HARNESS_TASKS_DIR: root, HARNESS_TEST_NO_LEADER: '1' }).init();
  try {
    const off = await tm.call('tm_open', { request: 'big request', cwd, vendor: 'self', size: 'L', skills: false });
    assert.doesNotMatch(readFileSync(off.ready[0].briefing_path, 'utf8'), /## Method/);
    const mine = await tm.call('tm_open', {
      request: 'big request', cwd, vendor: 'self', size: 'L',
      skills: { shape: ['write:writing-plans'] },
    });
    const prompt = readFileSync(mine.ready[0].briefing_path, 'utf8');
    assert.match(prompt, /write:writing-plans/);
    assert.doesNotMatch(prompt, /develop:domain-driven-design/, 'an override replaces the default, it does not add to it');
  } finally {
    tm.close();
    rmSync(cwd, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------- child driver processes ----------

// Records what the manager spawned, then exits without driving anything: a driver that dies with
// the run still open is exactly the case the fold has to survive.
const FAKE_DRIVER = `
import { writeFileSync, fstatSync } from 'node:fs';
let stdin_fifo = 'unreadable';
try { stdin_fifo = fstatSync(0).isFIFO(); } catch { /* keep the marker */ }
const out = process.env.FAKE_DRIVER_OUT;
if (out) {
  writeFileSync(out, JSON.stringify({
    argv: process.argv.slice(2),
    cwd: process.cwd(),
    claudecode: process.env.CLAUDECODE === undefined ? null : process.env.CLAUDECODE,
    tasks_dir: process.env.HARNESS_TASKS_DIR || null,
    stdin_fifo,
  }));
}
console.log('{"type":"fake-driver"}');
console.error('fake driver drove nothing');
`;

// Same write as FAKE_DRIVER, but stays up instead of exiting - for a test that wants to read what
// was spawned without racing serviceLeader/serviceDeadDriver's own respawn-on-death handling.
const FAKE_DRIVER_ALIVE = FAKE_DRIVER.replace(
  "console.log('{\"type\":\"fake-driver\"}');\nconsole.error('fake driver drove nothing');",
  "console.log('{\"type\":\"fake-driver\"}');\nconsole.error('fake driver drove nothing');\nsetTimeout(() => {}, 30000);",
);

// Dies on its first invocation (the death serviceDeadDriver has to catch and respawn from), then
// stays up on every later invocation - a respawned driver a test can observe alive, instead of
// racing the next death. A shared counter file (one JS process per invocation; no in-memory
// state survives between them) says which attempt this is; each attempt's own argv/pid is
// written to "<FAKE_DRIVER_OUT>.<n>" so a test can read every generation, not just the last.
const FAKE_DRIVER_RESPAWN = `
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
const counterFile = process.env.FAKE_DRIVER_COUNTER;
let n = 1;
if (counterFile) {
  n = existsSync(counterFile) ? parseInt(readFileSync(counterFile, 'utf8'), 10) + 1 : 1;
  writeFileSync(counterFile, String(n));
}
const out = process.env.FAKE_DRIVER_OUT;
if (out) writeFileSync(\`\${out}.\${n}\`, JSON.stringify({ n, pid: process.pid, argv: process.argv.slice(2) }));
console.log(JSON.stringify({ type: 'fake-driver', attempt: n }));
console.error(\`fake driver attempt \${n} drove nothing\`);
if (n < 2) { process.exit(0); } else { setTimeout(() => process.exit(0), 5000); }
`;

// Emits a usage-limit result event on its stdout stream - the same NDJSON shape
// \`claude -p --output-format stream-json\` writes - then exits. serviceDeadDriver reads this
// back from the log, not from stderr, exactly as scripts/bench/drive.sh does.
const FAKE_DRIVER_LIMIT = `
import { writeFileSync } from 'node:fs';
const out = process.env.FAKE_DRIVER_OUT;
if (out) writeFileSync(out, JSON.stringify({ argv: process.argv.slice(2) }));
console.log(JSON.stringify({ type: 'result', result: "You've hit your 5-hour limit · resets 11:50pm (Asia/Seoul)" }));
console.error('fake driver hit a usage limit');
setTimeout(() => process.exit(1), 50);
`;

async function waitFor(fn, what, ms = 15000) {
  const until = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

function driverFixture(env = {}, script = FAKE_DRIVER) {
  const cwd = repo();
  const root = mkdtempSync(join(tmpdir(), 'tm-root-'));
  const drv = mkdtempSync(join(tmpdir(), 'tm-drv-'));
  const scriptPath = join(drv, 'fake-driver.mjs');
  writeFileSync(scriptPath, script);
  const ran = join(drv, 'ran.json');
  const counter = join(drv, 'counter.txt');
  const client = new Client(TM, {
    HARNESS_TASKS_DIR: root,
    HARNESS_CHILD_DRIVER: `node ${scriptPath}`,
    FAKE_DRIVER_OUT: ran,
    FAKE_DRIVER_COUNTER: counter,
    // The manager runs inside a claude session; a nested `claude -p` refuses to start if it sees this.
    CLAUDECODE: '1',
    // These fixtures are about PACKAGE/S-run driver behavior, submitted through directly by the
    // test itself exactly like a TaskLeader would - not about the TaskLeader driver's own inbox
    // gate. Without this, a leader spawned from this same HARNESS_CHILD_DRIVER script would race
    // the test's own tm_submit calls into the inbox and write over FAKE_DRIVER_OUT.
    HARNESS_TEST_NO_LEADER: '1',
    ...env,
  });
  return { cwd, root, drv, ran, counter, client };
}

test('a ready dispatch spawns a driver process in the package worktree, with the run to continue in its prompt', async () => {
  const f = driverFixture();
  const tm = await f.client.init();
  try {
    const { task_id } = await tm.call('tm_open', {
      request: 'big request', cwd: f.cwd, vendor: 'self',
      host_vendor: 'claude', host_model: 'claude-opus-4', native_models: ['sonnet', 'haiku'],
    });
    await throughCritique(tm, task_id);
    const nx = await tm.call('tm_next', { task_id });
    const c = nx.children[0];
    assert.equal(c.node_id, 'dispatch:P1:1', JSON.stringify(nx));
    assert.ok(Number.isInteger(c.driver.pid), `no driver pid: ${JSON.stringify(c)}`);
    assert.equal(c.driver.log, join(f.root, task_id, 'drivers', 'dispatch_P1_1.stream.jsonl'));

    const ran = await waitFor(() => (existsSync(f.ran) ? JSON.parse(readFileSync(f.ran, 'utf8')) : null), 'the fake driver to run');
    // $TMPDIR is a symlink into /private/var on macOS; the spawn cwd is the path we gave it.
    assert.equal(realpathSync(ran.cwd), realpathSync(c.cwd), 'the driver runs in the package worktree');
    assert.equal(ran.tasks_dir, f.root, 'the tasks dir travels to the child session');
    assert.equal(ran.claudecode, null, 'CLAUDECODE is deleted: a nested claude refuses to start with it');
    assert.equal(ran.stdin_fifo, false, "stdin is ignored, not the manager's pipe");

    const prompt = ran.argv[ran.argv.length - 1];
    assert.match(prompt, new RegExp(`run_id ${c.run_id}`), prompt);
    assert.match(prompt, new RegExp(c.cwd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(prompt, /Do not call graph_open or tm_open/);
    assert.match(prompt, /graph_next\/graph_run\/graph_submit/);
    assert.match(prompt, /host_vendor claude, host_model claude-opus-4, native_models sonnet, haiku/);

    const ledger = readFileSync(join(f.root, task_id, 'ledger.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    const spawned = ledger.find((e) => e.event === 'child_driver_spawned');
    assert.equal(spawned.node_id, 'dispatch:P1:1');
    assert.equal(spawned.pid, c.driver.pid);
    // The driver's stdout is captured, not lost down /dev/null.
    await waitFor(() => existsSync(c.driver.log) && readFileSync(c.driver.log, 'utf8').includes('fake-driver'), 'the driver log');
  } finally {
    tm.close();
    rmSync(f.cwd, { recursive: true, force: true });
    rmSync(f.root, { recursive: true, force: true });
    rmSync(f.drv, { recursive: true, force: true });
  }
});

test('a driver that dies mid-run is respawned on the SAME run_id with a resume prompt, before any budget is spent', async () => {
  const f = driverFixture({}, FAKE_DRIVER_RESPAWN);
  const tm = await f.client.init();
  try {
    // Default driver_restarts (2): the first death must not fold anything.
    const { task_id } = await tm.call('tm_open', { request: 'big request', cwd: f.cwd, vendor: 'self' });
    await throughCritique(tm, task_id);
    const first = await tm.call('tm_next', { task_id });
    const firstChild = first.children[0];
    const firstPid = firstChild.driver.pid;

    // Attempt 1 dies immediately; tm_next's own poll respawns attempt 2, which stays up long
    // enough (FAKE_DRIVER_RESPAWN) for this to observe it alive rather than racing its death too.
    const resumed = await waitFor(async () => {
      const nx = await tm.call('tm_next', { task_id });
      const c = nx.children[0];
      return c.driver.restarts === 1 ? c : null;
    }, 'the respawned driver');
    assert.equal(resumed.child_state, 'running', 'the child run itself never stopped: only its driver died');
    assert.equal(resumed.run_id, firstChild.run_id, 'the SAME child run_id, not a fresh one');
    assert.equal(resumed.cwd, firstChild.cwd, 'the same worktree too');
    assert.notEqual(resumed.driver.pid, firstPid, 'a fresh process');
    assert.equal(resumed.driver.alive, true, 'the respawned driver is alive: nothing to fold yet');
    assert.match(resumed.next, /its driver process \(pid/, 'poll tm_next, do not fold - a live respawn is exactly like a first spawn');

    const early = await tm.call('tm_submit', { task_id, node_id: 'dispatch:P1:1' });
    assert.match(early.error, /still running/, 'a live respawned driver refuses the fold exactly like a first one would');

    const second = await waitFor(
      () => (existsSync(`${f.ran}.2`) ? JSON.parse(readFileSync(`${f.ran}.2`, 'utf8')) : null),
      'the respawned driver\'s own invocation record',
    );
    const prompt = second.argv[second.argv.length - 1];
    assert.match(prompt, new RegExp(`run_id ${firstChild.run_id}`), prompt);
    assert.match(prompt, /A previous driver for this exact run died before it finished/);
    assert.match(prompt, /graph_status\(\{run_id, cwd\}\) first/);
    assert.match(resumed.driver.log, /\.restart1\.stream\.jsonl$/, 'a distinct log per generation, not overwritten');

    const ledger = readFileSync(join(f.root, task_id, 'ledger.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    const restarted = ledger.find((e) => e.event === 'child_driver_restarted');
    assert.equal(restarted.node_id, 'dispatch:P1:1');
    assert.equal(restarted.restart, 1);
    assert.equal(restarted.budget, 2);
  } finally {
    tm.close();
    rmSync(f.cwd, { recursive: true, force: true });
    rmSync(f.root, { recursive: true, force: true });
    rmSync(f.drv, { recursive: true, force: true });
  }
});

test('once the restart budget is spent, the dispatch folds blocked with every attempt\'s stderr', async () => {
  const f = driverFixture(); // FAKE_DRIVER: dies immediately, every single time
  const tm = await f.client.init();
  try {
    const { task_id } = await tm.call('tm_open', { request: 'big request', cwd: f.cwd, vendor: 'self', driver_restarts: 1 });
    await throughCritique(tm, task_id);
    await tm.call('tm_next', { task_id });
    const spent = await waitFor(async () => {
      const nx = await tm.call('tm_next', { task_id });
      const c = nx.children[0];
      return c.driver.alive === false && c.driver.restarts === 1 ? c : null;
    }, 'the restart budget (1) to be spent');
    assert.equal(spent.child_state, 'running', 'the fake drove nothing: the child run is still open');
    assert.match(spent.next, /restart budget \(1\) is spent/);
    assert.match(spent.next, /tm_retry\({package_id: "P1"}\)/);

    const v = await tm.call('tm_submit', { task_id, node_id: 'dispatch:P1:1' });
    assert.equal(v.state, 'failed', JSON.stringify(v));
    assert.match(v.reason, /child driver exited \(pid \d+\) after 1 restart\(s\) with the run still running/);
    assert.match(v.reason, /fake driver drove nothing/, 'the last of the driver stderr is the evidence');
    const full = await tm.call('tm_status', { task_id, node_id: 'dispatch:P1:1', full: true });
    assert.equal(full.node.result.driver_restarts.length, 1, 'one death was recorded before the fold, not the fold itself');
    // Blocked, and retryable in the same worktree - the package is not dead, its session is.
    const after = await tm.call('tm_status', { task_id });
    assert.equal(after.state, 'blocked');
    const rt = await tm.call('tm_retry', { task_id, package_id: 'P1' });
    assert.equal(rt.retried, true, JSON.stringify(rt));
    assert.equal(rt.children[0].node_id, 'dispatch:P1:2');
    assert.ok(Number.isInteger(rt.children[0].driver.pid), 'the retry spawns its own driver');
    assert.equal(rt.children[0].driver.restarts, undefined, 'a fresh dispatch starts with no restarts of its own');
  } finally {
    tm.close();
    rmSync(f.cwd, { recursive: true, force: true });
    rmSync(f.root, { recursive: true, force: true });
    rmSync(f.drv, { recursive: true, force: true });
  }
});

test('a usage-limit death parks the dispatch on waiting_capacity, spends no restart, and tm_retry({reset_capacity}) resumes it', async () => {
  const f = driverFixture({}, FAKE_DRIVER_LIMIT);
  const tm = await f.client.init();
  try {
    const { task_id } = await tm.call('tm_open', { request: 'big request', cwd: f.cwd, vendor: 'self' });
    await throughCritique(tm, task_id);
    await tm.call('tm_next', { task_id });
    const parked = await waitFor(async () => {
      const nx = await tm.call('tm_next', { task_id });
      return nx.children[0].waiting_capacity ? nx.children[0] : null;
    }, 'the driver to park on capacity');
    assert.equal(parked.child_state, 'running');
    assert.match(parked.waiting_capacity.reason, /hit your 5-hour limit/);
    assert.equal(parked.driver.alive, false, 'the driver process did exit');
    assert.equal(parked.driver.restarts, undefined, 'a usage-limit death spends no restart');
    assert.match(parked.next, /waiting on provider capacity/);
    assert.match(parked.next, /tm_retry\({task_id, package_id: "P1", reset_capacity:true}\)/);

    const early = await tm.call('tm_submit', { task_id, node_id: 'dispatch:P1:1' });
    assert.match(early.error, /waiting on provider capacity/, 'parked, not blocked: reset_capacity is the way out, not a fold');

    const badPkg = await tm.call('tm_retry', { task_id, package_id: 'P9', reset_capacity: true });
    assert.equal(badPkg.retried, false, 'reset_capacity for a package with nothing waiting resumes nothing');

    const oldPid = parked.driver.pid;
    const rt = await tm.call('tm_retry', { task_id, package_id: 'P1', reset_capacity: true });
    assert.equal(rt.retried, true, JSON.stringify(rt));
    assert.deepEqual(rt.resumed, ['dispatch:P1:1']);
    assert.equal(rt.children[0].node_id, 'dispatch:P1:1', 'the SAME dispatch - reset_capacity is not a new attempt');
    assert.equal(rt.children[0].waiting_capacity, undefined, 'cleared');
    assert.ok(Number.isInteger(rt.children[0].driver.pid) && rt.children[0].driver.pid !== oldPid, 'a fresh driver process');
    assert.equal(rt.children[0].driver.alive, true, 'observed in the same tick spawnChildDriver returned it');

    const ledger = readFileSync(join(f.root, task_id, 'ledger.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.ok(ledger.some((e) => e.event === 'child_driver_capacity' && e.node_id === 'dispatch:P1:1'));
    assert.ok(ledger.some((e) => e.event === 'child_driver_capacity_cleared' && e.node_id === 'dispatch:P1:1'));
    assert.ok(ledger.some((e) => e.event === 'child_driver_restarted' && e.reason === 'reset_capacity'));
  } finally {
    tm.close();
    rmSync(f.cwd, { recursive: true, force: true });
    rmSync(f.root, { recursive: true, force: true });
    rmSync(f.drv, { recursive: true, force: true });
  }
});

test('a driver that exits only after its child run finished folds normally: a crash and an ordinary ending are not the same thing', async () => {
  const f = driverFixture(); // dies immediately; the point is that the RUN finishes some other way first
  const tm = await f.client.init();
  const g = await new Client(BROKER).init();
  try {
    const { task_id } = await tm.call('tm_open', { request: 'big request', cwd: f.cwd, vendor: 'self' });
    await throughCritique(tm, task_id);
    const nx = await tm.call('tm_next', { task_id });
    const c = nx.children[0];
    await waitFor(async () => (await tm.call('tm_next', { task_id })).children[0].driver.alive === false, 'the fake driver to exit');
    // The driver is long dead, but the run itself is completed by other means (as the broker
    // would, driven by whatever replaced the dead driver in a real deployment) before anyone
    // folds the dispatch. serviceDeadDriver must read that as a finish, not a crash.
    await completeChild(g, c);
    const after = await tm.call('tm_next', { task_id });
    assert.equal(after.children[0].child_state, 'complete');
    assert.equal(after.children[0].next, `tm_submit({task_id, node_id: "${c.node_id}"})`);
    const v = await tm.call('tm_submit', { task_id, node_id: 'dispatch:P1:1' });
    assert.equal(v.state, 'done', JSON.stringify(v));
    assert.equal(v.accept, true, 'the normal fold path ran, not the dead-driver one');
  } finally {
    tm.close();
    g.close();
    rmSync(f.cwd, { recursive: true, force: true });
    rmSync(f.root, { recursive: true, force: true });
    rmSync(f.drv, { recursive: true, force: true });
  }
});

test('HARNESS_TEST_NO_DRIVER spawns nothing: the child is the test to drive, and a fold is refused while it runs', async () => {
  const f = driverFixture({ HARNESS_TEST_NO_DRIVER: '1' });
  const tm = await f.client.init();
  const g = await new Client(BROKER).init();
  try {
    const { task_id } = await tm.call('tm_open', { request: 'big request', cwd: f.cwd, vendor: 'self' });
    await throughCritique(tm, task_id);
    const nx = await tm.call('tm_next', { task_id });
    const c = nx.children[0];
    assert.equal(c.driver, undefined, 'no driver was spawned');
    assert.match(c.next, /graph_next/);
    assert.ok(!existsSync(f.ran), 'the fake driver was never started');
    assert.ok(!existsSync(join(f.root, task_id, 'drivers')), 'no driver logs either');
    const early = await tm.call('tm_submit', { task_id, node_id: 'dispatch:P1:1' });
    assert.match(early.error, /still running/, 'with no driver, a running child is still the caller to finish');
    await completeChild(g, c);
    assert.equal((await tm.call('tm_submit', { task_id, node_id: 'dispatch:P1:1' })).state, 'done');
  } finally {
    tm.close();
    g.close();
    rmSync(f.cwd, { recursive: true, force: true });
    rmSync(f.root, { recursive: true, force: true });
    rmSync(f.drv, { recursive: true, force: true });
  }
});

// ---------- size-S process handoff: s_driver ----------

test('a size-S task spawns one headless driver, and tm_next relays its report once it completes', async () => {
  const f = driverFixture();
  const tm = await f.client.init();
  const g = await new Client(BROKER).init();
  try {
    const { task_id } = await tm.call('tm_open', { request: 'small request', cwd: f.cwd, vendor: 'self' });
    const v = await tm.call('tm_submit', { task_id, node_id: 'size', payload: ok({ size: 'S', flow: 'develop', sizing: ['ls -> one module'] }) });
    assert.equal(v.task_state, 's_run');
    assert.equal(v.delegate, undefined, 'process mode opens the run itself; there is nothing to delegate');
    assert.equal(v.state, 'running');
    assert.ok(Number.isInteger(v.driver.pid), JSON.stringify(v));
    assert.equal(v.driver.log, join(f.root, task_id, 'drivers', 'S.stream.jsonl'));
    const { run_id, cwd } = v;
    assert.equal(cwd, f.cwd, 'the single run opens directly in the project cwd, not a package worktree');
    assert.ok(existsSync(join(f.root, task_id, 'task.json')), 'the task stays on disk as the pointer to this run');

    const ran = await waitFor(() => (existsSync(f.ran) ? JSON.parse(readFileSync(f.ran, 'utf8')) : null), 'the fake driver to run');
    assert.match(ran.argv[ran.argv.length - 1], new RegExp(`run_id ${run_id}`));
    assert.equal(realpathSync(ran.cwd), realpathSync(cwd));

    // The fake driver drove nothing; drive the single run to completion directly, exactly as a
    // real driver session would with graph_next/graph_run/graph_submit.
    const sub = (node_id, payload) => g.call('graph_submit', { run_id, cwd, node_id, payload: ok(payload) });
    await sub('plan', { handoff: 'p', flow: 'develop', size: 'S' });
    await sub('setgoal', { spec: CHILD_SPEC });
    await sub('critique', { sound: true });
    appendFileSync(join(cwd, 'a.txt'), 'changed by S\n');
    await sub('implement:U1:1', { changed_files: ['a.txt'], handoff: 'built' });
    await sub('test:U1:1', { verified: true });
    await sub('gate:U1:1', { accept: true, match_pct: 95 });
    await sub('gate:goal:1', { accept: true, match_pct: 95 });
    await sub('report', { handoff: 'S run done' });

    const done = await waitFor(async () => {
      const nx = await tm.call('tm_next', { task_id });
      return nx.state !== 'running' ? nx : null;
    }, 'the S run to finish');
    assert.equal(done.state, 'complete');
    assert.equal(done.report, 'S run done');
    assert.deepEqual(done.ready, []);
    assert.deepEqual(done.children, []);
    const reportRow = done.nodes.find((nd) => nd.node_id === 'report');
    assert.ok(reportRow && reportRow.stage_ok === true, JSON.stringify(done.nodes));
    const implRow = done.nodes.find((nd) => nd.node_id === 'implement:U1:1');
    assert.ok(implRow, 'the table carries every node the entry skill\'s output template wants: node, vendor, stage_ok, note');

    const status = await tm.call('tm_status', { task_id });
    assert.equal(status.state, 'complete');
    assert.equal(status.s_run.run_id, run_id);
  } finally {
    tm.close();
    g.close();
    rmSync(f.cwd, { recursive: true, force: true });
    rmSync(f.root, { recursive: true, force: true });
    rmSync(f.drv, { recursive: true, force: true });
  }
});

test('tm_open({mixed}) reaches the size-S run the same way isolated does', async () => {
  const f = driverFixture();
  const tm = await f.client.init();
  const g = await new Client(BROKER).init();
  try {
    const proc = await tm.call('tm_open', { request: 'r', cwd: f.cwd, vendor: 'self', mixed: false, isolated: true });
    const pv = await tm.call('tm_submit', { task_id: proc.task_id, node_id: 'size', payload: ok({ size: 'S', flow: 'develop' }) });
    assert.equal(pv.task_state, 's_run');
    const full = await g.call('graph_status', { run_id: pv.run_id, cwd: pv.cwd, full: true });
    assert.equal(full.mixed, false);
    assert.equal(full.isolated, true);
  } finally {
    tm.close(); g.close();
    rmSync(f.cwd, { recursive: true, force: true });
    rmSync(f.root, { recursive: true, force: true });
    rmSync(f.drv, { recursive: true, force: true });
  }
});

test('child_driver and s_driver are gone: passing either is an error that names the reason', async () => {
  const cwd = repo();
  const root = mkdtempSync(join(tmpdir(), 'tm-root-'));
  const tm = await new Client(TM, { HARNESS_TASKS_DIR: root, HARNESS_TEST_NO_DRIVER: '1' }).init();
  try {
    for (const bad of [{ child_driver: 'inline' }, { s_driver: 'process' }]) {
      const r = await tm.call('tm_open', { request: 'r', cwd, vendor: 'self', ...bad });
      assert.match(r.error, /removed in 0\.10\.0/);
      assert.match(r.error, /never drives/);
    }
    assert.deepEqual(readdirSync(root), [], 'a refused open leaves no task behind');
  } finally { tm.close(); rmSync(cwd, { recursive: true, force: true }); rmSync(root, { recursive: true, force: true }); }
});

// ---------- the TaskLeader driver ----------

test('tm_open spawns a TaskLeader driver whose prompt names the task and manager.md, and records it', async () => {
  const cwd = repo();
  const root = mkdtempSync(join(tmpdir(), 'tm-root-'));
  const fake = join(root, 'fake-leader.mjs');
  writeFileSync(fake, FAKE_DRIVER_ALIVE);
  const out = join(root, 'leader.out');
  const tm = await new Client(TM, { HARNESS_TASKS_DIR: root, HARNESS_CHILD_DRIVER: `node ${fake}`, FAKE_DRIVER_OUT: out }).init();
  let pid;
  try {
    const open = await tm.call('tm_open', { request: 'lead me', cwd, vendor: 'self', size: 'L' });
    pid = open.leader.pid;
    assert.ok(open.leader && open.leader.pid, 'a leader pid comes back');
    assert.ok(open.leader.log.endsWith('leader.stream.jsonl'));
    await new Promise((r) => setTimeout(r, 400));
    const prompt = readFileSync(out, 'utf8');
    assert.match(prompt, new RegExp(open.task_id));
    assert.match(prompt, /references\/manager\.md/);
    assert.match(prompt, /Do not call tm_open/);
    assert.match(prompt, /never do a node's work/i);
    assert.match(prompt, /SendMessage/);
    const ledger = readFileSync(join(root, open.task_id, 'ledger.jsonl'), 'utf8');
    assert.match(ledger, /"event":"leader_spawned"/);
    const s = await tm.call('tm_status', { task_id: open.task_id });
    assert.equal(typeof s.leader.alive, 'boolean');
    assert.equal(s.leader.spawn_count, 1);
  } finally { try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ } tm.close(); rmSync(cwd, { recursive: true, force: true }); rmSync(root, { recursive: true, force: true }); }
});

test('a mutating call from a non-leader process is queued to the inbox; the leader process drains it on tm_next', async () => {
  const cwd = repo();
  const root = mkdtempSync(join(tmpdir(), 'tm-root-'));
  const main = await new Client(TM, { HARNESS_TASKS_DIR: root, HARNESS_CHILD_DRIVER: 'node -e setTimeout(()=>{},30000)' }).init();
  let leader;
  let pid;
  try {
    const open = await main.call('tm_open', { request: 'lead me', cwd, vendor: 'self', size: 'L' });
    pid = open.leader.pid;
    const q = await main.call('tm_submit', { task_id: open.task_id, node_id: 'shape', payload: { stage_ok: true } });
    assert.equal(q.queued, true);
    assert.match(q.inbox_path, /inbox\/\d+-\d+-tm_submit\.json$/);
    assert.ok(existsSync(q.inbox_path));
    const before = JSON.parse(readFileSync(join(root, open.task_id, 'task.json'), 'utf8'));
    assert.equal(before.nodes.find((n) => n.node_id === 'shape').state, 'pending', 'main did not write task.json');

    leader = await new Client(TM, { HARNESS_TASKS_DIR: root, HARNESS_LEADER_OF: open.task_id }).init();
    const n = await leader.call('tm_next', { task_id: open.task_id });
    assert.equal(existsSync(q.inbox_path), false, 'drained');
    assert.ok(n.inbox_applied >= 1);
    const ledger = readFileSync(join(root, open.task_id, 'ledger.jsonl'), 'utf8');
    assert.match(ledger, /"event":"inbox_applied"/);
    // shape depended on size; the queued submit was applied and failed the same way a direct one would.
    assert.match(ledger, /"tool":"tm_submit"/);
  } finally {
    try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ }
    main.close(); if (leader) leader.close();
    rmSync(cwd, { recursive: true, force: true }); rmSync(root, { recursive: true, force: true });
  }
});

test('tm_next from a non-leader process does not drive: it returns leader state and a hint', async () => {
  const cwd = repo();
  const root = mkdtempSync(join(tmpdir(), 'tm-root-'));
  const main = await new Client(TM, { HARNESS_TASKS_DIR: root, HARNESS_CHILD_DRIVER: 'node -e setTimeout(()=>{},30000)' }).init();
  let pid;
  try {
    const open = await main.call('tm_open', { request: 'lead me', cwd, vendor: 'self', size: 'L' });
    pid = open.leader.pid;
    const n = await main.call('tm_next', { task_id: open.task_id });
    assert.equal(n.driven_by, 'leader');
    assert.equal(n.leader.alive, true);
    assert.match(n.hint, /tm_status|tm_events/);
    assert.equal(n.ready, undefined, 'no briefing paths are handed to the watcher');
  } finally { try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ } main.close(); rmSync(cwd, { recursive: true, force: true }); rmSync(root, { recursive: true, force: true }); }
});

test('a dead leader is respawned on any tm_* call up to driver_restarts, then reported exhausted', async () => {
  const cwd = repo();
  const root = mkdtempSync(join(tmpdir(), 'tm-root-'));
  const fake = join(root, 'fake-leader.mjs');
  writeFileSync(fake, FAKE_DRIVER); // exits at once
  const tm = await new Client(TM, { HARNESS_TASKS_DIR: root, HARNESS_CHILD_DRIVER: `node ${fake}`, FAKE_DRIVER_OUT: join(root, 'o') }).init();
  try {
    const open = await tm.call('tm_open', { request: 'lead me', cwd, vendor: 'self', size: 'L', driver_restarts: 1 });
    await new Promise((r) => setTimeout(r, 400));
    let s = await tm.call('tm_status', { task_id: open.task_id });
    assert.equal(s.leader.restarts, 1, 'first dead leader respawned');
    await new Promise((r) => setTimeout(r, 400));
    s = await tm.call('tm_status', { task_id: open.task_id });
    assert.equal(s.leader.restarts, 1);
    assert.equal(s.leader.exhausted, true);
    assert.ok(s.leader.stderr_tail.length > 0);
    const ledger = readFileSync(join(root, open.task_id, 'ledger.jsonl'), 'utf8');
    assert.match(ledger, /"event":"leader_restarted"/);
    assert.match(ledger, /"event":"leader_exhausted"/);
  } finally { tm.close(); rmSync(cwd, { recursive: true, force: true }); rmSync(root, { recursive: true, force: true }); }
});

test('tm_events tails the ledger, newest last, filtered by since', async () => {
  await withTask(async ({ tm, task_id, root }) => {
    const all = await tm.call('tm_events', { task_id });
    assert.ok(all.events.length >= 1);
    assert.equal(all.events[0].event, 'tm_open');
    const last = all.events.at(-1).ts;
    await tm.call('tm_submit', { task_id, node_id: 'size', payload: { stage_ok: true, size: 'L', handoff: 'h', evidence: 'e' } });
    const since = await tm.call('tm_events', { task_id, since: last });
    assert.ok(since.events.every((e) => e.ts > last));
    assert.ok(since.events.some((e) => e.event === 'tm_submit' || e.event === 'node_done' || /submit|done/.test(e.event)));
    const two = await tm.call('tm_events', { task_id, limit: 2 });
    assert.equal(two.events.length, 2);
  });
});

// ---------- team.json project defaults ----------

test('tm_open reads .claude/team.json as defaults and an explicit argument still wins', async () => {
  const dir = repo();
  const tasks = mkdtempSync(join(tmpdir(), 'tm-tasks-'));
  mkdirSync(join(dir, '.claude'), { recursive: true });
  writeFileSync(join(dir, '.claude', 'team.json'), JSON.stringify({ goal_threshold: 95, max_retries: 4, roles: { qa: true } }));
  const tm = await new Client(TM, { HARNESS_TASKS_DIR: tasks, HARNESS_TEST_NO_LEADER: '1' }).init();
  try {
    const a = await tm.call('tm_open', { request: 'split me', cwd: dir, size: 'L' });
    const sa = await tm.call('tm_status', { task_id: a.task_id });
    assert.equal(sa.team.opts.goal_threshold, 95);
    assert.equal(sa.team.sources.goal_threshold, 'team.json');
    assert.equal(sa.team.opts.max_retries, 4);
    assert.deepEqual(sa.team.opts.roles, { planning: false, qa: true });
    assert.equal(sa.team.file_status, 'ok');
    const taskFile = JSON.parse(readFileSync(join(tasks, a.task_id, 'task.json'), 'utf8'));
    assert.equal(taskFile.goal_threshold, 95, 'the value the manager actually gates with');
    assert.equal(taskFile.max_retries, 4);

    const b = await tm.call('tm_open', { request: 'split me', cwd: dir, size: 'L', goal_threshold: 80 });
    const sb = await tm.call('tm_status', { task_id: b.task_id });
    assert.equal(sb.team.opts.goal_threshold, 80);
    assert.equal(sb.team.sources.goal_threshold, 'args');
  } finally { tm.close(); rmSync(dir, { recursive: true, force: true }); rmSync(tasks, { recursive: true, force: true }); }
});

test('a malformed team.json is reported on the task and the defaults apply', async () => {
  const dir = repo();
  const tasks = mkdtempSync(join(tmpdir(), 'tm-tasks-'));
  mkdirSync(join(dir, '.claude'), { recursive: true });
  writeFileSync(join(dir, '.claude', 'team.json'), '{oops');
  const tm = await new Client(TM, { HARNESS_TASKS_DIR: tasks, HARNESS_TEST_NO_LEADER: '1' }).init();
  try {
    const a = await tm.call('tm_open', { request: 'split me', cwd: dir, size: 'L' });
    const s = await tm.call('tm_status', { task_id: a.task_id });
    assert.equal(s.team.file_status, 'parse-error');
    assert.equal(s.team.opts.goal_threshold, 90);
  } finally { tm.close(); rmSync(dir, { recursive: true, force: true }); rmSync(tasks, { recursive: true, force: true }); }
});
