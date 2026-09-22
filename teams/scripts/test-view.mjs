// Regression suite for teams/scripts/view.mjs - the human-readable status surface for a
// task-manager task. Builds a real task.json (through the task-manager and broker MCP
// servers, no vendor CLI needed - the same recipe test-taskmanager.mjs uses) and checks that
// collect() derives the right model, that the text renderer names every node, and that the
// HTTP server actually serves /state.json and an index page.
//
//   node --test teams/scripts/test-view.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, appendFileSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectTask, listTasks } from './lib/view-collect.mjs';
import { renderText, renderIndexText } from './lib/view-render-text.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const TM = join(HERE, '..', 'mcp', 'taskmanager.mjs');
const BROKER = join(HERE, '..', 'mcp', 'broker.mjs');
const VIEW = join(HERE, 'view.mjs');

// ---------- the same fixture recipe test-taskmanager.mjs uses ----------

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
  const dir = mkdtempSync(join(tmpdir(), 'view-test-repo-'));
  const git = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' });
  git('init', '-q');
  git('config', 'user.email', 't@t');
  git('config', 'user.name', 't');
  writeFileSync(join(dir, 'a.txt'), 'x\n');
  writeFileSync(join(dir, 'b.txt'), 'y\n');
  writeFileSync(join(dir, '.gitignore'), '.teams_output/\n');
  git('add', '-A');
  git('commit', '-qm', 'init');
  return dir;
}

const ok = (payload) => ({ stage_ok: true, evidence: 'e', checks: ['ok -> looked fine'], attacks: ['ok -> looked fine from outside'], ...payload });

const TWO_PKG_SHAPE = {
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

async function completeChild(g, child, { accept = true } = {}) {
  const { cwd, run_id } = child;
  const sub = (node_id, payload) => g.call('team_submit', { run_id, cwd, node_id, payload: ok(payload) });
  // Since 0.14.0 an ordinary STORY child is parent_shaped: chain-only (implement -> test -> gate),
  // no plan/setgoal/critique/gate:goal/report. Detect it the way test-taskmanager does.
  const full = await g.call('team_status', { run_id, cwd, full: true });
  const parentShaped = full.parent_shaped === true;
  if (!parentShaped) {
    const v = await sub('plan', { handoff: 'p', flow: 'develop', size: 'S' });
    assert.equal(v.state, 'done', JSON.stringify(v));
    await sub('setgoal', { spec: CHILD_SPEC });
    await sub('critique', { sound: true });
  }
  appendFileSync(join(cwd, 'a.txt'), `changed by ${child.package_id || 'child'}\n`);
  const v = await sub('implement:U1:1', { changed_files: ['a.txt'], handoff: 'built' });
  assert.equal(v.state, 'done', JSON.stringify(v));
  await sub('test:U1:1', { verified: true });
  if (parentShaped) {
    await sub('gate:U1:1', { accept, match_pct: accept ? 95 : 40, gaps: accept ? [] : ['missing the b half'], reason: accept ? '' : 'short' });
    const nx = await g.call('team_next', { run_id, cwd });
    assert.equal(nx.state, accept ? 'complete' : 'blocked');
    return;
  }
  await sub('gate:U1:1', { accept: true, match_pct: 95 });
  await sub('gate:goal:1', { accept, match_pct: accept ? 95 : 40, gaps: accept ? [] : ['missing the b half'], reason: accept ? '' : 'short' });
  const nx = await g.call('team_next', { run_id, cwd });
  if (!accept) { assert.equal(nx.state, 'blocked'); return; }
  assert.deepEqual(nx.ready.map((n) => n.node_id), ['report']);
  await sub('report', { handoff: `child report for ${cwd}` });
  assert.equal((await g.call('team_status', { run_id, cwd })).state, 'complete');
}

async function throughCritique(tm, task_id, shape) {
  let v = await tm.call('tm_submit', { task_id, node_id: 'size', payload: ok({ size: 'L', flow: 'develop', sizing: ['ls -> modules'], handoff: 'sized' }) });
  assert.equal(v.state, 'done', JSON.stringify(v));
  v = await tm.call('tm_submit', { task_id, node_id: 'shape', payload: ok({ ...shape, handoff: 's' }) });
  assert.equal(v.state, 'done', JSON.stringify(v));
  v = await tm.call('tm_submit', { task_id, node_id: 'critique', payload: ok({ sound: true }) });
  assert.equal(v.state, 'done', JSON.stringify(v));
}

async function withTask(shape, fn) {
  const cwd = repo();
  const root = mkdtempSync(join(tmpdir(), 'view-test-root-'));
  const tm = await new Client(TM, { HARNESS_TASKS_DIR: root, HARNESS_TEST_NO_DRIVER: '1' }).init();
  const g = await new Client(BROKER).init();
  try {
    const open = await tm.call('tm_open', { request: 'a request for the view test', cwd, vendor: 'self', roles: { planning: false, qa: false } });
    await throughCritique(tm, open.task_id, shape);
    await fn({ tm, g, cwd, root, task_id: open.task_id });
  } finally {
    tm.close();
    g.close();
    rmSync(cwd, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
}

// Walk the collect() model for every node_id it names, at any depth (manager stages, package
// dispatch/accept, child nodes, nested tasks) - used to assert the text renderer drops none.
function everyNodeId(model, acc = []) {
  if (!model || model.error) return acc;
  for (const n of model.manager_stages || []) acc.push(n.node_id);
  for (const n of (model.s_run && model.s_run.nodes) || []) acc.push(n.node_id);
  for (const p of model.packages || []) {
    if (p.dispatch) acc.push(p.dispatch.node_id);
    if (p.accept) acc.push(p.accept.node_id);
    if (p.child && !p.child.missing) {
      for (const n of p.child.nodes || []) acc.push(n.node_id);
      for (const nested of p.child.nested || []) everyNodeId(nested, acc);
    }
  }
  return acc;
}

function waitForListen(proc, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    let buf = '';
    const timer = setTimeout(() => reject(new Error(`view.mjs did not print a listen line: ${buf}`)), timeoutMs);
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (chunk) => {
      buf += chunk;
      const m = buf.match(/listening on (http:\/\/127\.0\.0\.1:\d+)/);
      if (m) { clearTimeout(timer); resolve(m[1]); }
    });
    proc.on('exit', (code) => { clearTimeout(timer); reject(new Error(`view.mjs exited early (${code}): ${buf}`)); });
  });
}

// ---------- collect() ----------

test('collect() on an L task with one dispatched, accepted child: state derivation, packages, child node chain', async () => {
  await withTask(TWO_PKG_SHAPE, async ({ tm, g, root, task_id }) => {
    const nx = await tm.call('tm_next', { task_id });
    await completeChild(g, nx.children[0]);
    await tm.call('tm_submit', { task_id, node_id: 'dispatch:P1:1' });
    await tm.call('tm_submit', { task_id, node_id: 'accept:P1:1', payload: ok({ accept: true, match_pct: 90 }) });

    const model = collectTask(root, task_id);
    assert.equal(model.error, null);
    assert.equal(model.task_id, task_id);
    assert.equal(model.size, 'L');
    assert.equal(model.state, 'running', 'P2 still pending on P1, nothing left settled');
    assert.equal(model.counts.done > 0, true);

    const p1 = model.packages.find((p) => p.id === 'P1');
    const p2 = model.packages.find((p) => p.id === 'P2');
    assert.ok(p1 && p2, 'both packages appear even though only P1 was dispatched');
    assert.equal(p1.dispatch.state, 'done');
    assert.equal(p1.accept.state, 'done');
    assert.equal(p1.accept.verdict, true);
    assert.equal(p2.dispatch.state, 'pending', 'P2 is seeded pending: not ready until P1 is accepted');
    assert.equal(p2.child, null, 'no worktree/child run exists until the dispatch node actually runs');

    assert.ok(p1.child, 'P1 has a child run');
    assert.equal(p1.child.state, 'complete');
    // parent_shaped (0.14.0): the child carries only its KINDS chain.
    assert.deepEqual(p1.child.nodes.map((n) => n.node_id), ['implement:U1:1', 'test:U1:1', 'gate:U1:1']);
    assert.equal(p1.child.nodes.find((n) => n.node_id === 'gate:U1:1').match_pct, 95);

    // manager stages exclude dispatch/accept (those live under packages instead)
    assert.deepEqual(model.manager_stages.map((n) => n.node_id).sort(),
      ['critique', 'gate:goal:1', 'integrate:1', 'report', 'shape', 'size'].sort());

    const ids = everyNodeId(model);
    assert.ok(ids.includes('dispatch:P1:1') && ids.includes('accept:P1:1') && ids.includes('implement:U1:1'));
  });
});

test('a task driven to completion (both packages, integrate, gate, report) reports state "complete"', async () => {
  await withTask(TWO_PKG_SHAPE, async ({ tm, g, root, task_id }) => {
    let nx = await tm.call('tm_next', { task_id });
    await completeChild(g, nx.children[0]);
    await tm.call('tm_submit', { task_id, node_id: 'dispatch:P1:1' });
    await tm.call('tm_submit', { task_id, node_id: 'accept:P1:1', payload: ok({ accept: true, match_pct: 90 }) });

    nx = await tm.call('tm_next', { task_id });
    await completeChild(g, nx.children[0]);
    await tm.call('tm_submit', { task_id, node_id: 'dispatch:P2:1' });
    await tm.call('tm_submit', { task_id, node_id: 'accept:P2:1', payload: ok({ accept: true, match_pct: 90 }) });

    await tm.call('tm_submit', { task_id, node_id: 'integrate:1', payload: ok({ verified: true, checks: ['build -> ok'] }) });
    await tm.call('tm_submit', { task_id, node_id: 'gate:goal:1', payload: ok({ accept: true, match_pct: 92 }) });
    await tm.call('tm_submit', { task_id, node_id: 'report', payload: ok({ handoff: 'all done' }) });

    const model = collectTask(root, task_id);
    assert.equal(model.error, null);
    assert.equal(model.state, 'complete');
    assert.equal(model.manager_stages.find((n) => n.node_id === 'report').state, 'done');
    assert.equal(model.packages.every((p) => p.dispatch.state === 'done' && p.accept.state === 'done'), true);
  });
});

test('collect() tolerates a missing task.json (never throws)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'view-test-root-'));
  try {
    const model = collectTask(root, 'no-such-task');
    assert.match(model.error, /could not read task\.json/);
    assert.equal(model.task_id, 'no-such-task');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('listTasks() lists every task dir under tasksRoot, newest first', async () => {
  await withTask(TWO_PKG_SHAPE, async ({ root, task_id }) => {
    const rows = listTasks(root);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].task_id, task_id);
    assert.equal(rows[0].state, 'running');
  });
});

// ---------- text renderer ----------

test('renderText() names every node_id the model carries', async () => {
  await withTask(TWO_PKG_SHAPE, async ({ tm, g, root, task_id }) => {
    const nx = await tm.call('tm_next', { task_id });
    await completeChild(g, nx.children[0]);
    await tm.call('tm_submit', { task_id, node_id: 'dispatch:P1:1' });
    await tm.call('tm_submit', { task_id, node_id: 'accept:P1:1', payload: ok({ accept: true, match_pct: 90 }) });

    const model = collectTask(root, task_id);
    const text = renderText(model);
    for (const id of everyNodeId(model)) {
      assert.ok(text.includes(id), `renderText output is missing node_id ${id}`);
    }
    assert.match(text, new RegExp(task_id));
  });
});

test('renderIndexText() lists every task row', () => {
  const rows = [
    { task_id: 't1', request: 'req one', state: 'running', size: 'L', created_at: 1000, cost_usd: 1.5 },
    { task_id: 't2', request: 'req two', state: 'complete', size: 'S', created_at: 2000, cost_usd: 0 },
  ];
  const text = renderIndexText(rows, '/tmp/somewhere');
  assert.match(text, /t1/);
  assert.match(text, /t2/);
  assert.match(text, /req one/);
  assert.match(text, /\/tmp\/somewhere/);
});

// ---------- the view.mjs CLI itself ----------

test('--once prints a text tree to stdout and exits, for a single task', async () => {
  await withTask(TWO_PKG_SHAPE, async ({ root, task_id }) => {
    const r = spawnSync('node', [VIEW, '--tasks-dir', root, '--task', task_id, '--once'], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, new RegExp(task_id));
    assert.match(r.stdout, /manager pipeline:/);
  });
});

test('--once with no --task and exactly one task auto-selects it', async () => {
  await withTask(TWO_PKG_SHAPE, async ({ root, task_id }) => {
    const r = spawnSync('node', [VIEW, '--tasks-dir', root, '--once'], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, new RegExp(task_id));
  });
});

test('the HTTP server serves /state.json for a task and an HTML page at /', async () => {
  await withTask(TWO_PKG_SHAPE, async ({ root, task_id }) => {
    const proc = spawn('node', [VIEW, '--tasks-dir', root, '--task', task_id, '--port', '0'], { stdio: ['ignore', 'pipe', 'pipe'] });
    try {
      const base = await waitForListen(proc);
      const stateRes = await fetch(`${base}/state.json`);
      assert.equal(stateRes.status, 200);
      assert.match(stateRes.headers.get('content-type') || '', /application\/json/);
      const data = await stateRes.json();
      assert.equal(data.mode, 'task');
      assert.equal(data.model.task_id, task_id);
      assert.equal(data.model.error, null);

      const pageRes = await fetch(`${base}/`);
      assert.equal(pageRes.status, 200);
      assert.match(pageRes.headers.get('content-type') || '', /text\/html/);
      const html = await pageRes.text();
      assert.match(html, /<title>/);
      assert.match(html, /state\.json/);
      // no external network resources - the deliverable is a self-contained page
      assert.doesNotMatch(html, /https?:\/\/(?!127\.0\.0\.1)/);
    } finally {
      proc.kill();
    }
  });
});

test('/state.json serves an index when several tasks exist and no --task is given', async () => {
  const cwd1 = repo();
  const cwd2 = repo();
  const root = mkdtempSync(join(tmpdir(), 'view-test-root-'));
  const tm1 = await new Client(TM, { HARNESS_TASKS_DIR: root, HARNESS_TEST_NO_DRIVER: '1' }).init();
  let proc;
  try {
    const a = await tm1.call('tm_open', { request: 'task A', cwd: cwd1, vendor: 'self', roles: { planning: false, qa: false } });
    const b = await tm1.call('tm_open', { request: 'task B', cwd: cwd2, vendor: 'self', roles: { planning: false, qa: false } });
    tm1.close();

    proc = spawn('node', [VIEW, '--tasks-dir', root, '--port', '0'], { stdio: ['ignore', 'pipe', 'pipe'] });
    const base = await waitForListen(proc);
    const res = await fetch(`${base}/state.json`);
    const data = await res.json();
    assert.equal(data.mode, 'index');
    const ids = data.tasks.map((t) => t.task_id).sort();
    assert.deepEqual(ids, [a.task_id, b.task_id].sort());

    // the index page's per-task link resolves through the same server
    const linked = await fetch(`${base}/state.json?task=${a.task_id}`);
    const linkedData = await linked.json();
    assert.equal(linkedData.mode, 'task');
    assert.equal(linkedData.model.task_id, a.task_id);
  } finally {
    if (proc) proc.kill();
    rmSync(cwd1, { recursive: true, force: true });
    rmSync(cwd2, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test('view.mjs never writes to task.json (read-only)', async () => {
  await withTask(TWO_PKG_SHAPE, async ({ root, task_id }) => {
    const path = join(root, task_id, 'task.json');
    const before = readFileSync(path, 'utf8');
    spawnSync('node', [VIEW, '--tasks-dir', root, '--task', task_id, '--once'], { encoding: 'utf8' });
    const after = readFileSync(path, 'utf8');
    assert.equal(after, before);
  });
});

test('view.mjs defaults --tasks-dir to tasksRoot() (HARNESS_TASKS_DIR) when omitted', async () => {
  await withTask(TWO_PKG_SHAPE, async ({ root, task_id }) => {
    const r = spawnSync('node', [VIEW, '--task', task_id, '--once'], { encoding: 'utf8', env: { ...process.env, HARNESS_TASKS_DIR: root } });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, new RegExp(task_id));
  });
});

test('lib/view-page.html exists next to view.mjs (the page view.mjs serves is a real file, not a stub)', () => {
  assert.ok(existsSync(join(HERE, 'lib', 'view-page.html')));
});
