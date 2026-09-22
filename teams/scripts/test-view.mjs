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

// SHAPE, but with implements[] on every package - roles.planning turns on shape's completeness
// check against the user stories the PRD produced, which plain TWO_PKG_SHAPE would fail.
const SHAPE_WITH_IMPLEMENTS = {
  acceptance: TWO_PKG_SHAPE.acceptance,
  packages: TWO_PKG_SHAPE.packages.map((p, i) => ({ ...p, implements: [`US-${i + 1}`] })),
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

// Opens a task with the given roles but drives nothing past tm_open - unlike withTask, which
// always drives size -> shape -> critique with roles {planning:false, qa:false} baked in. A
// roles.planning:true task needs the PLAN phase-Team driven before shape can even be submitted,
// so that driving has to live in the caller, not in a shared helper built for the plain case.
async function withOpenTask(roles, fn) {
  const cwd = repo();
  const root = mkdtempSync(join(tmpdir(), 'view-test-root-'));
  const tm = await new Client(TM, { HARNESS_TASKS_DIR: root, HARNESS_TEST_NO_DRIVER: '1' }).init();
  const g = await new Client(BROKER).init();
  try {
    const open = await tm.call('tm_open', { request: 'a request for the view test', cwd, vendor: 'self', roles });
    await fn({ tm, g, cwd, root, task_id: open.task_id });
  } finally {
    tm.close();
    g.close();
    rmSync(cwd, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
}

// Drives one QA phase-Team child (kind qa: plan -> setgoal -> critique -> cases -> execute ->
// gate -> gate:goal -> report) from dispatch to report, then folds it into the manager - the
// same node sequence test-taskmanager.mjs's completeQaChild drives, since it is the QA kind's
// real chain, not something invented for this test.
async function completeQaChild(g, child, gatePayload) {
  const { cwd, run_id } = child;
  const sub = (node_id, payload) => g.call('team_submit', { run_id, cwd, node_id, payload: ok(payload) });
  await sub('plan', { handoff: 'p', flow: 'qa', size: 'S' });
  await sub('setgoal', { spec: { goal: 'QA', acceptance: ['no regressions'], subgoals: [{ id: 'Q1', title: 'run cases', acceptance: ['cases run'], deps: [] }] } });
  await sub('critique', { sound: true });
  await sub('cases:Q1:1', { changed_files: [], handoff: 'cases written' });
  await sub('execute:Q1:1', { verified: true, handoff: 'cases run' });
  await sub('gate:Q1:1', { accept: true, match_pct: 95 });
  await sub('gate:goal:1', gatePayload);
  const nx = await g.call('team_next', { run_id, cwd });
  assert.deepEqual(nx.ready.map((n) => n.node_id), ['report']);
  await sub('report', { handoff: 'QA report' });
}

// Drives a filed defect's own develop package (D1, D2, ...) to report. Unlike completeChild, a
// filed defect declares no deps of its own (fileDefects resolves any named dep to an
// already-done accept, but none are given here), so its worktree branches from the project's
// own HEAD - touching a fresh file, not a.txt, avoids a real merge conflict once the fresh
// integrate re-merges every package from HEAD.
async function completeDefectChild(g, child, filename) {
  const { cwd, run_id } = child;
  const sub = (node_id, payload) => g.call('team_submit', { run_id, cwd, node_id, payload: ok(payload) });
  await sub('plan', { handoff: 'p', flow: 'develop', size: 'S' });
  await sub('setgoal', { spec: CHILD_SPEC });
  await sub('critique', { sound: true });
  writeFileSync(join(cwd, filename), `fixed by ${child.package_id}\n`);
  await sub('implement:U1:1', { changed_files: [filename], handoff: 'fixed' });
  await sub('test:U1:1', { verified: true });
  await sub('gate:U1:1', { accept: true, match_pct: 95 });
  await sub('gate:goal:1', { accept: true, match_pct: 95 });
  await g.call('team_next', { run_id, cwd });
  await sub('report', { handoff: 'defect fix report' });
}

// Drives one planning-audit phase-Team child (kind planning-audit: audit -> gate) to report.
async function completeAuditChild(g, child, gatePayload) {
  const { cwd, run_id } = child;
  const sub = (node_id, payload) => g.call('team_submit', { run_id, cwd, node_id, payload: ok(payload) });
  await sub('plan', { handoff: 'p', flow: 'audit', size: 'S' });
  await sub('setgoal', { spec: { goal: 'AUDIT', acceptance: ['every user story is accounted for'], subgoals: [{ id: 'A1', title: 'cross-check the PRD', acceptance: ['each story judged'], deps: [] }] } });
  await sub('critique', { sound: true });
  await sub('audit:A1:1', { changed_files: [], handoff: 'stories judged', user_stories_checked: ['US-1', 'US-2'], unmet: [], qa_considered: false });
  await sub('gate:A1:1', { accept: true, match_pct: 95 });
  await sub('gate:goal:1', gatePayload);
  const nx = await g.call('team_next', { run_id, cwd });
  assert.deepEqual(nx.ready.map((n) => n.node_id), ['report']);
  await sub('report', { handoff: 'audit report' });
}

// Drives the PLAN package (opened by roles.planning:true) from dispatch to accept, so the task
// reaches the point where shape can be submitted with implements[] checked against these
// userStories. Assumes size has already been submitted.
async function completePlanning(tm, g, task_id, userStories) {
  const nx = await tm.call('tm_next', { task_id });
  const child = nx.children.find((c) => c.package_id === 'PLAN');
  const sub = (node_id, payload) => g.call('team_submit', { run_id: child.run_id, cwd: child.cwd, node_id, payload: ok(payload) });
  await sub('plan', { handoff: 'p', flow: 'plan', size: 'S' });
  await sub('setgoal', { spec: { goal: 'PRD', acceptance: ['PRD covers the request'], subgoals: [{ id: 'U1', title: 'draft PRD', acceptance: ['PRD written'], deps: [] }] } });
  await sub('critique', { sound: true });
  await sub('draft:U1:1', { changed_files: [], handoff: 'drafted' });
  await sub('revise:U1:1', { changed_files: [], handoff: 'revised' });
  await sub('gate:U1:1', { accept: true, match_pct: 95 });
  await sub('gate:goal:1', { accept: true, match_pct: 95, user_stories: userStories });
  await g.call('team_next', { run_id: child.run_id, cwd: child.cwd });
  await sub('report', { handoff: 'PRD complete' });
  await tm.call('tm_submit', { task_id, node_id: 'dispatch:PLAN:1' });
  await tm.call('tm_submit', { task_id, node_id: 'accept:PLAN:1', payload: ok({ accept: true, match_pct: 95 }) });
}

// Walk the collect() model for every node_id it names, at any depth (manager stages, package
// dispatch/accept, child nodes, nested tasks, QA/audit phase-Team rounds) - used to assert the
// text renderer drops none.
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
  for (const phase of [model.qa, model.audit]) {
    for (const r of (phase && phase.rounds) || []) {
      if (r.dispatch) acc.push(r.dispatch.node_id);
      if (r.accept) acc.push(r.accept.node_id);
      if (r.child && !r.child.missing) {
        for (const n of r.child.nodes || []) acc.push(n.node_id);
        for (const nested of r.child.nested || []) everyNodeId(nested, acc);
      }
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

// ---------- QA and planning-audit phase-Teams ----------
//
// view.mjs used to special-case task.planning_pkg alone and never reference task.qa_pkg or
// task.audit_pkg at all - a task with a QA round or an audit round drove the round for real
// (a defect found, a STORY filed, a second round, an audit verdict), all of it visible to
// inspect.mjs and tm_board/tm_docs, and none of it ever reached this surface. These tests drive
// a real QA round and a real audit round through the manager and broker (the same recipe
// test-taskmanager.mjs's own QA/audit tests use) and check that both come out the other end of
// collect() and renderText().

// Drives a roles:{qa:true} task from a fresh critique through P1/P2/integrate:1, through a QA
// round that finds one defect (which files D1, reporter 'qa', and reroutes gate:goal to a
// fresh integrate) - the shared setup every QA-visibility test below starts from.
async function driveToQaDefectFound(tm, g, task_id) {
  await throughCritique(tm, task_id, TWO_PKG_SHAPE);
  let nx = await tm.call('tm_next', { task_id });
  await completeChild(g, nx.children[0]);
  await tm.call('tm_submit', { task_id, node_id: 'dispatch:P1:1' });
  await tm.call('tm_submit', { task_id, node_id: 'accept:P1:1', payload: ok({ accept: true, match_pct: 90 }) });

  nx = await tm.call('tm_next', { task_id });
  await completeChild(g, nx.children[0]);
  await tm.call('tm_submit', { task_id, node_id: 'dispatch:P2:1' });
  await tm.call('tm_submit', { task_id, node_id: 'accept:P2:1', payload: ok({ accept: true, match_pct: 90 }) });

  // tm_next (not tm_submit) is what prepares an integrate node's own worktree
  // (prepareReadyIntegrations, taskmanager.mjs) - the QA/audit repair worktree below needs that
  // worktree's cwd, so this call cannot be skipped the way it can when neither role is on.
  nx = await tm.call('tm_next', { task_id });
  assert.deepEqual(nx.ready.map((n) => n.node_id), ['integrate:1']);
  await tm.call('tm_submit', { task_id, node_id: 'integrate:1', payload: ok({ verified: true, checks: ['build -> ok'] }) });

  nx = await tm.call('tm_next', { task_id });
  assert.equal(nx.children.length, 1, JSON.stringify(nx));
  assert.equal(nx.children[0].package_id, 'QA');
  await completeQaChild(g, nx.children[0], { accept: true, match_pct: 95 });
  await tm.call('tm_submit', { task_id, node_id: 'dispatch:QA:1' });
  await tm.call('tm_submit', { task_id, node_id: 'accept:QA:1', payload: ok({
    accept: true, match_pct: 95,
    defects: [{ title: 'checkout crashes on empty cart', touches: ['d.txt'], deps: [], evidence: 'run checkout with 0 items -> 500', severity: 'high' }],
  }) });
}

// Continues from driveToQaDefectFound: drives D1 and the fresh integrate it opened to done,
// which (roles.qa still on) reopens a second, clean QA round automatically.
async function driveQaRound2Clean(tm, g, task_id) {
  let nx = await tm.call('tm_next', { task_id });
  assert.equal(nx.children.length, 1, JSON.stringify(nx));
  assert.equal(nx.children[0].package_id, 'D1');
  await completeDefectChild(g, nx.children[0], 'd.txt');
  await tm.call('tm_submit', { task_id, node_id: 'dispatch:D1:1' });
  await tm.call('tm_submit', { task_id, node_id: 'accept:D1:1', payload: ok({ accept: true, match_pct: 92 }) });

  nx = await tm.call('tm_next', { task_id });
  assert.deepEqual(nx.ready.map((n) => n.node_id), ['integrate:2']);
  await tm.call('tm_submit', { task_id, node_id: 'integrate:2', payload: ok({ verified: true, checks: ['build -> ok'] }) });

  nx = await tm.call('tm_next', { task_id });
  assert.equal(nx.children.length, 1, JSON.stringify(nx));
  assert.equal(nx.children[0].package_id, 'QA');
  await completeQaChild(g, nx.children[0], { accept: true, match_pct: 95 });
  await tm.call('tm_submit', { task_id, node_id: 'dispatch:QA:2' });
  await tm.call('tm_submit', { task_id, node_id: 'accept:QA:2', payload: ok({ accept: true, match_pct: 95 }) });
}

// Drives a roles:{planning:true, qa:false} task from size through P1/P2/integrate:1, through
// an audit round that finds one unmet user story (which files D1, reporter 'planning-audit').
async function driveToAuditUnmetFound(tm, g, task_id) {
  let v = await tm.call('tm_submit', { task_id, node_id: 'size', payload: ok({ size: 'L', flow: 'develop', sizing: ['ls -> 2 modules'], handoff: 'two modules' }) });
  assert.equal(v.state, 'done', JSON.stringify(v));
  await completePlanning(tm, g, task_id, ['US-1', 'US-2']);

  v = await tm.call('tm_submit', { task_id, node_id: 'shape', payload: ok({ ...SHAPE_WITH_IMPLEMENTS, handoff: 's' }) });
  assert.equal(v.state, 'done', JSON.stringify(v));
  v = await tm.call('tm_submit', { task_id, node_id: 'critique', payload: ok({ sound: true }) });
  assert.equal(v.state, 'done', JSON.stringify(v));

  let nx = await tm.call('tm_next', { task_id });
  await completeChild(g, nx.children[0]);
  await tm.call('tm_submit', { task_id, node_id: 'dispatch:P1:1' });
  await tm.call('tm_submit', { task_id, node_id: 'accept:P1:1', payload: ok({ accept: true, match_pct: 90 }) });

  nx = await tm.call('tm_next', { task_id });
  await completeChild(g, nx.children[0]);
  await tm.call('tm_submit', { task_id, node_id: 'dispatch:P2:1' });
  await tm.call('tm_submit', { task_id, node_id: 'accept:P2:1', payload: ok({ accept: true, match_pct: 90 }) });

  // See driveToQaDefectFound's comment: tm_next prepares the integrate node's own worktree,
  // which the audit's repair worktree below needs.
  nx = await tm.call('tm_next', { task_id });
  assert.deepEqual(nx.ready.map((n) => n.node_id), ['integrate:1']);
  await tm.call('tm_submit', { task_id, node_id: 'integrate:1', payload: ok({ verified: true, checks: ['build -> ok'] }) });

  nx = await tm.call('tm_next', { task_id });
  assert.equal(nx.children.length, 1, JSON.stringify(nx));
  assert.equal(nx.children[0].package_id, 'AUDIT');
  await completeAuditChild(g, nx.children[0], { accept: true, match_pct: 95 });
  await tm.call('tm_submit', { task_id, node_id: 'dispatch:AUDIT:1' });
  await tm.call('tm_submit', { task_id, node_id: 'accept:AUDIT:1', payload: ok({
    accept: true, match_pct: 91, unmet: ['US-2 -> b.txt was never wired to the exported path'],
  }) });
}

test('collect() renders a QA round that found a defect, the STORY it filed, and a second clean QA round', async () => {
  await withOpenTask({ planning: false, qa: true }, async ({ tm, g, root, task_id }) => {
    await driveToQaDefectFound(tm, g, task_id);
    await driveQaRound2Clean(tm, g, task_id);

    const model = collectTask(root, task_id);
    assert.equal(model.error, null);
    assert.ok(model.qa, 'model.qa must exist once task.qa_pkg exists');

    // Pinned exactly, not length > 0 or a substring: both rounds, in order, with their real
    // round numbers, states, and defect counts - a round that found a defect and was then
    // superseded by a clean round must not disappear.
    assert.deepEqual(model.qa.rounds.map((r) => r.id), ['QA:1', 'QA:2'], 'both QA rounds must be present, not just the latest');
    assert.deepEqual(model.qa.rounds.map((r) => r.round), [1, 2]);
    assert.deepEqual(model.qa.rounds.map((r) => r.state), ['done', 'done']);
    assert.deepEqual(model.qa.rounds.map((r) => r.defects_count), [1, 0], 'round 1 found one defect, round 2 found none');
    assert.deepEqual(model.qa.rounds[0].defect_titles, ['checkout crashes on empty cart']);

    // The STORY that landed on the board because QA found it, not because shape declared it.
    const d1 = model.packages.find((p) => p.id === 'D1');
    assert.ok(d1, `D1 missing from packages: ${model.packages.map((p) => p.id).join(', ')}`);
    assert.equal(d1.reporter, 'qa', 'D1 must be tagged as QA-filed so it reads differently from a shape package');

    const text = renderText(model);
    for (const id of everyNodeId(model)) assert.ok(text.includes(id), `renderText output is missing node_id ${id}`);
    assert.match(text, /QA:1[^\n]*defects=1/);
    assert.match(text, /QA:2[^\n]*defects=0/);
    assert.match(text, /checkout crashes on empty cart/);
    assert.match(text, /D1[^\n]*\[filed by qa\]/);
  });
});

test('collect() renders an audit round that found an unmet user story and the STORY it filed', async () => {
  await withOpenTask({ planning: true, qa: false }, async ({ tm, g, root, task_id }) => {
    await driveToAuditUnmetFound(tm, g, task_id);

    const model = collectTask(root, task_id);
    assert.equal(model.error, null);
    assert.ok(model.audit, 'model.audit must exist once task.audit_pkg exists');
    assert.deepEqual(model.audit.rounds.map((r) => r.id), ['AUDIT:1']);
    assert.deepEqual(model.audit.rounds.map((r) => r.round), [1]);
    assert.deepEqual(model.audit.rounds.map((r) => r.state), ['done']);
    assert.deepEqual(model.audit.rounds.map((r) => r.unmet_count), [1]);
    assert.deepEqual(model.audit.rounds[0].unmet_titles, ['US-2 -> b.txt was never wired to the exported path']);

    const d1 = model.packages.find((p) => p.id === 'D1');
    assert.ok(d1, `D1 missing from packages: ${model.packages.map((p) => p.id).join(', ')}`);
    assert.equal(d1.reporter, 'planning-audit');

    const text = renderText(model);
    for (const id of everyNodeId(model)) assert.ok(text.includes(id), `renderText output is missing node_id ${id}`);
    assert.match(text, /AUDIT:1[^\n]*unmet=1/);
    assert.match(text, /US-2 -> b\.txt was never wired to the exported path/);
    assert.match(text, /D1[^\n]*\[filed by planning-audit\]/);
  });
});

test('--once renders a QA round, its defect count, and the STORY it filed (the CLI path shares collect() with the browser page)', async () => {
  await withOpenTask({ planning: false, qa: true }, async ({ tm, g, root, task_id }) => {
    await driveToQaDefectFound(tm, g, task_id);

    const r = spawnSync('node', [VIEW, '--tasks-dir', root, '--task', task_id, '--once'], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /QA:1/);
    assert.match(r.stdout, /defects=1/);
    assert.match(r.stdout, /checkout crashes on empty cart/);
    assert.match(r.stdout, /\[filed by qa\]/);
  });
});

test('/state.json carries model.qa for a task with a QA round (the HTML page and --once read the same collect() output)', async () => {
  await withOpenTask({ planning: false, qa: true }, async ({ tm, g, root, task_id }) => {
    await driveToQaDefectFound(tm, g, task_id);

    const proc = spawn('node', [VIEW, '--tasks-dir', root, '--task', task_id, '--port', '0'], { stdio: ['ignore', 'pipe', 'pipe'] });
    try {
      const base = await waitForListen(proc);
      const res = await fetch(`${base}/state.json`);
      const data = await res.json();
      assert.equal(data.model.qa.rounds.length, 1);
      assert.equal(data.model.qa.rounds[0].defects_count, 1);
      assert.equal(data.model.packages.find((p) => p.id === 'D1').reporter, 'qa');
    } finally {
      proc.kill();
    }
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
