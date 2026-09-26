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
import { mkdtempSync, mkdirSync, appendFileSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { node, saveRun } from '../mcp/graph.mjs';
import { collectTask, listTasks, deriveTitle } from './lib/view-collect.mjs';
import { renderText, renderIndexText, renderTicketsText, renderResourcesText } from './lib/view-render-text.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const TM = join(HERE, '..', 'mcp', 'taskmanager.mjs');
const BROKER = join(HERE, '..', 'mcp', 'broker.mjs');
const VIEW = join(HERE, 'view.mjs');
const PAGE_HTML = join(HERE, 'lib', 'view-page.html');

// Runs the page's own client-side indexBody(rows, tasksDir) against a real DOM-free stub - the
// same function view-page.html's tick()/render() call against /state.json's `tasks` array. This
// is the one way to pin what the browser actually shows for the index without a headless
// browser: extract the IIFE's body, stub the two globals it touches at load time (`location`,
// `document`), and call the function it defines by name.
function renderIndexHtml(rows, tasksDir) {
  const html = readFileSync(PAGE_HTML, 'utf8');
  const body = html.match(/\(function \(\) \{([\s\S]*)\}\)\(\);/)[1].replace(/tick\(\);\s*setInterval\(tick, 3000\);/, '');
  const sandbox = { location: { search: '' }, URLSearchParams, document: { getElementById: () => null } };
  const fn = new Function('location', 'URLSearchParams', 'document', 'exportsObj', `${body}\nexportsObj.indexBody = indexBody;`);
  const out = {};
  fn(sandbox.location, sandbox.URLSearchParams, sandbox.document, out);
  return out.indexBody(rows, tasksDir);
}

// Same extraction trick as renderIndexHtml, for pkgCard(p, idx) - the per-package card the HTML
// page renders on a task's own view. Used to pin that the browser and the CLI/text renderer
// show the SAME storyLinks() facts (view-render-text.mjs's formatLinksLine renders the identical
// model field, p.links, for the --once/terminal path).
function renderPkgCardHtml(p, idx = 0) {
  const html = readFileSync(PAGE_HTML, 'utf8');
  const body = html.match(/\(function \(\) \{([\s\S]*)\}\)\(\);/)[1].replace(/tick\(\);\s*setInterval\(tick, 3000\);/, '');
  const sandbox = { location: { search: '' }, URLSearchParams, document: { getElementById: () => null } };
  const fn = new Function('location', 'URLSearchParams', 'document', 'exportsObj', `${body}\nexportsObj.pkgCard = pkgCard;`);
  const out = {};
  fn(sandbox.location, sandbox.URLSearchParams, sandbox.document, out);
  return out.pkgCard(p, idx);
}

// Same extraction trick as renderIndexHtml/renderPkgCardHtml, for the TICKET/RESOURCE view's own
// client-side renderers - pins that the browser and the CLI/text renderer (view-render-text.mjs)
// draw the SAME collect() fields into the SAME shape, not two quietly-diverging surfaces.
function extractPageFns(names) {
  const html = readFileSync(PAGE_HTML, 'utf8');
  const body = html.match(/\(function \(\) \{([\s\S]*)\}\)\(\);/)[1].replace(/tick\(\);\s*setInterval\(tick, 3000\);/, '');
  const sandbox = { location: { search: '' }, URLSearchParams, document: { getElementById: () => null, querySelectorAll: () => [] } };
  const fn = new Function('location', 'URLSearchParams', 'document', 'exportsObj',
    `${body}\n${names.map((n) => `exportsObj.${n} = ${n};`).join('\n')}`);
  const out = {};
  fn(sandbox.location, sandbox.URLSearchParams, sandbox.document, out);
  return out;
}

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
  const tm = await new Client(TM, { HARNESS_TASKS_DIR: root, HARNESS_TEST_NO_DRIVER: '1', TEAMS_VIEW: '0' }).init();
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
  const tm = await new Client(TM, { HARNESS_TASKS_DIR: root, HARNESS_TEST_NO_DRIVER: '1', TEAMS_VIEW: '0' }).init();
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
  await sub('investigate:U1:1', { changed_files: [], handoff: 'findings' });
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

    // storyLinks (tickets.mjs), read straight through packageModel (view-collect.mjs) - pinned
    // exactly, both directions: P2's shape-declared `deps: ['P1']` shows up on P2 as blocked_by
    // P1 (already DONE) and, the computed inverse, on P1 as blocks P2 - P2's dispatch node is
    // pending but its own dep (accept:P1:1) is already done, so storyTicketState reads it READY,
    // not BACKLOG.
    const epicKeyHere = `E-${task_id.slice(0, 8)}`;
    assert.deepEqual(p1.links, {
      blocked_by: [], blocks: [{ key: `${epicKeyHere}/P2`, id: 'P2', state: 'READY' }], implements: [], filed_by: null,
    });
    assert.deepEqual(p2.links, {
      blocked_by: [{ key: `${epicKeyHere}/P1`, id: 'P1', state: 'DONE' }], blocks: [], implements: [], filed_by: null,
    });

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

// idol-beta-pm4 (2026-09-24): worktrees/P1/.harness-tasks/<top-level task id>/task.json (and
// P4's) were stale early snapshots of the TOP-LEVEL task - the worktree's own branch had
// committed .harness-tasks/ at some point, so checking it out brought along a frozen copy of the
// ancestor's own task.json, same run_id, its own store_path still pointing straight back at the
// ancestor's real file. collectNestedTasks used to render that whole tree again under P1, still
// reading `running` off pids that had long since exited. Built entirely by hand (no MCP servers,
// no vendor CLI) - fast, and it pins the exact fixture shape the live bug had: a stale self-copy
// alongside one genuinely different nested task, so the fix can be shown to drop only the former.
test('collect(): a nested task.json that is a stale self-copy of an ancestor (same id, or store_path pointing at the ancestor) is skipped - a genuinely different nested task is not', () => {
  const root = mkdtempSync(join(tmpdir(), 'view-test-stale-nested-'));
  try {
    const taskId = 'aaaaaaaa-0000-0000-0000-000000000000';
    const taskDir = join(root, taskId);
    const taskPath = join(taskDir, 'task.json');
    mkdirSync(taskDir, { recursive: true });
    const worktree = join(taskDir, 'worktrees', 'P1');
    mkdirSync(worktree, { recursive: true });

    // The package's own child run file - collectChildRun only ever looks for nested tasks once
    // this loads (its own early return on a missing run never reaches collectNestedTasks).
    const childRunId = 'child-1';
    saveRun({ run_id: childRunId, cwd: worktree, spec: null, nodes: [] });

    // The stale copy: same run_id as the ancestor, store_path pointing straight back at it -
    // not its own location (join(worktree, '.harness-tasks', taskId, 'task.json')).
    const staleDir = join(worktree, '.harness-tasks', taskId);
    mkdirSync(staleDir, { recursive: true });
    writeFileSync(join(staleDir, 'task.json'), JSON.stringify({
      run_id: taskId, cwd: root, request: 'top-level request', created_at: 1, store_path: taskPath,
      nodes: [node('dispatch:P1:1', 'dispatch', [], { subgoal_id: 'P1', state: 'running' })],
    }));

    // A genuinely different nested task (its own id, its own store_path) - nothing alive under
    // it (no daemon, no driver on its one node), so it should collect normally but read 'stale'
    // rather than 'running', per the general rule.
    const nestedId = 'bbbbbbbb-0000-0000-0000-000000000000';
    const nestedDir = join(worktree, '.harness-tasks', nestedId);
    mkdirSync(nestedDir, { recursive: true });
    writeFileSync(join(nestedDir, 'task.json'), JSON.stringify({
      run_id: nestedId, cwd: worktree, request: 'nested real work', created_at: 2,
      store_path: join(nestedDir, 'task.json'),
      nodes: [node('size', 'size', [], { state: 'running' })],
    }));

    writeFileSync(taskPath, JSON.stringify({
      run_id: taskId, cwd: root, request: 'top-level request', created_at: 1, store_path: taskPath,
      spec: { packages: [{ id: 'P1', title: 'module a' }] },
      nodes: [node('dispatch:P1:1', 'dispatch', [], {
        subgoal_id: 'P1', state: 'running', child: { cwd: worktree, run_id: childRunId },
      })],
    }));

    const model = collectTask(root, taskId);
    assert.equal(model.error, null);
    assert.equal(model.state, 'running', 'the TOP-LEVEL task itself is untouched - only a NESTED copy earns the stale check');
    const p1 = model.packages.find((p) => p.id === 'P1');
    assert.ok(p1.child && !p1.child.missing, 'the package child run itself still collects normally');
    assert.equal(p1.child.nested.length, 1, 'the stale self-copy is dropped; the genuinely different nested task is not');
    assert.equal(p1.child.nested[0].task_id, nestedId);
    assert.equal(p1.child.nested[0].state, 'stale', 'nothing alive under it (no daemon, no driver) - not shown as running');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('collect(): a package between retries (a fresh dispatch node with no child yet) falls back to the LATEST EARLIER attempt\'s own child/cost, tagged retry_pending - Team P2\'s "(not dispatched yet - no worktree)" regression', () => {
  const root = mkdtempSync(join(tmpdir(), 'view-test-retry-pending-'));
  try {
    const taskId = 'cccccccc-0000-0000-0000-000000000000';
    const taskDir = join(root, taskId);
    const taskPath = join(taskDir, 'task.json');
    mkdirSync(taskDir, { recursive: true });
    const worktree1 = join(taskDir, 'worktrees', 'P2-attempt1');
    mkdirSync(worktree1, { recursive: true });

    // attempt 1's own child run + a driver stream carrying real cost/turns - exactly what a live
    // package worktree leaves behind once its driver finishes (or dies and is retried).
    const childRunId = 'child-attempt-1';
    saveRun({ run_id: childRunId, cwd: worktree1, spec: null, nodes: [] });
    const driversDir = join(taskDir, 'drivers');
    mkdirSync(driversDir, { recursive: true });
    const streamPath = join(driversDir, 'dispatch_P2_1.stream.jsonl');
    writeFileSync(streamPath, JSON.stringify({ type: 'result', total_cost_usd: 1.23, num_turns: 7 }) + '\n');

    writeFileSync(taskPath, JSON.stringify({
      run_id: taskId, cwd: root, request: 'a request with a retried package', created_at: 1, store_path: taskPath,
      spec: { packages: [{ id: 'P2', title: 'flaky module' }] },
      nodes: [
        node('dispatch:P2:1', 'dispatch', [], {
          subgoal_id: 'P2', attempt: 1, state: 'failed',
          child: { cwd: worktree1, run_id: childRunId, branch: 'p2-attempt1', driver: { pid: 111, log: streamPath } },
        }),
        node('accept:P2:1', 'accept', [], { subgoal_id: 'P2', attempt: 1, state: 'failed', result: { accept: false } }),
        // The retry: a fresh attempt-2 dispatch, pending, with no child yet - the exact window
        // the bug report reproduced against Team P2's live task.
        node('dispatch:P2:2', 'dispatch', [], { subgoal_id: 'P2', attempt: 2, state: 'pending' }),
      ],
    }));

    const model = collectTask(root, taskId);
    assert.equal(model.error, null);
    const p2 = model.packages.find((p) => p.id === 'P2');
    assert.ok(p2.child, 'the worktree/cost from attempt 1 is not lost just because attempt 2 has not opened one yet');
    assert.equal(p2.child.retry_pending, true);
    assert.equal(p2.child.retry_pending_attempt, 1);
    assert.equal(p2.child.cwd, worktree1);
    assert.equal(p2.child.run_id, childRunId);
    assert.equal(p2.child.branch, 'p2-attempt1');
    assert.equal(p2.child.driver.cost.cost_usd, 1.23, 'attempt 1\'s spend is still visible, not silently dropped');
    assert.equal(p2.child.driver.cost.turns, 7);
    // attempt is still read off the CURRENT (latest) dispatch node, not the fallback - a person
    // asking "what attempt is this" should see 2, same as before this fix.
    assert.equal(p2.attempt, 2);

    const text = renderResourcesText(model);
    assert.doesNotMatch(text, /not dispatched yet - no worktree/, 'the fallback worktree renders instead of the old "no worktree" line');
    assert.match(text, /retry pending - showing attempt 1's worktree\/cost/);
    assert.match(text, new RegExp(worktree1.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('collect(): an ordinary package whose latest dispatch already has its own child never carries retry_pending', () => {
  const root = mkdtempSync(join(tmpdir(), 'view-test-no-retry-pending-'));
  try {
    const taskId = 'dddddddd-0000-0000-0000-000000000000';
    const taskDir = join(root, taskId);
    const taskPath = join(taskDir, 'task.json');
    mkdirSync(taskDir, { recursive: true });
    const worktree = join(taskDir, 'worktrees', 'P1');
    mkdirSync(worktree, { recursive: true });
    saveRun({ run_id: 'child-1', cwd: worktree, spec: null, nodes: [] });

    writeFileSync(taskPath, JSON.stringify({
      run_id: taskId, cwd: root, request: 'a request', created_at: 1, store_path: taskPath,
      spec: { packages: [{ id: 'P1', title: 'module a' }] },
      nodes: [node('dispatch:P1:1', 'dispatch', [], {
        subgoal_id: 'P1', attempt: 1, state: 'running', child: { cwd: worktree, run_id: 'child-1' },
      })],
    }));

    const model = collectTask(root, taskId);
    const p1 = model.packages.find((p) => p.id === 'P1');
    assert.ok(p1.child && !p1.child.retry_pending);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('renderText()/renderResourcesText(): a node state of "unreachable" gets its own mark, distinct from missing/unknown\'s "?"', () => {
  const model = {
    task_id: 'x', state: 'blocked', size: 'M', flow: 'develop', cost: { usd: 0, turns: 0 }, elapsed_ms: 0,
    manager_stages: [{ node_id: 'gate:goal:1', stage: 'gate', state: 'unreachable' }],
    packages: [],
  };
  const text = renderText(model);
  assert.match(text, /\[u\] gate:goal:1/, 'unreachable gets its own glyph, not the "?" missing/unknown already use');
  assert.doesNotMatch(text, /\[\?\] gate:goal:1/);
});

test('listTasks() lists every task dir under tasksRoot, newest first', async () => {
  await withTask(TWO_PKG_SHAPE, async ({ root, task_id }) => {
    const rows = listTasks(root);
    assert.equal(rows.length, 1);
    const row = rows[0];
    assert.equal(row.task_id, task_id);
    assert.deepStrictEqual(Object.keys(row).sort(), [
      'cost_usd', 'created_at', 'elapsed_ms', 'epic_key', 'open_defects',
      'phase', 'size', 'state', 'stories_done', 'stories_total', 'task_id', 'title',
    ].sort());
    // Pinned exactly: row.state is tickets.mjs's epicTicketState() ('IN_PROGRESS'), never the
    // engine's own runState() ('running') - the two vocabularies are close enough (both real
    // words a task can be in) that assert.ok(row.state) or a substring match would pass whether
    // this read the ticket state or the raw run state. Only critique has run at this point (no
    // package dispatched yet), which is exactly what epicPhase() calls 'impl' (task.spec exists,
    // goal level not reached) - a stale 'plan'/'setgoal' would mean shape's own task.spec write
    // was not seen.
    assert.deepStrictEqual(
      { epic_key: row.epic_key, title: row.title, state: row.state, phase: row.phase, size: row.size, stories_done: row.stories_done, stories_total: row.stories_total, open_defects: row.open_defects },
      { epic_key: `E-${task_id.slice(0, 8)}`, title: 'a request for the view test', state: 'IN_PROGRESS', phase: 'impl', size: 'L', stories_done: 0, stories_total: 2, open_defects: 0 },
    );
    assert.equal(typeof row.cost_usd, 'number');
    assert.equal(typeof row.elapsed_ms, 'number');
  });
});

test('listTasks() reads the ticket state through a real QA-found-defect round: IN_PROGRESS with an open defect while D1 is unresolved, IN_REVIEW with none once round 2 comes back clean', async () => {
  await withOpenTask({ planning: false, qa: true }, async ({ tm, g, root, task_id }) => {
    await driveToQaDefectFound(tm, g, task_id);
    let row = listTasks(root)[0];
    assert.deepStrictEqual(
      { state: row.state, phase: row.phase, stories_done: row.stories_done, stories_total: row.stories_total, open_defects: row.open_defects },
      { state: 'IN_PROGRESS', phase: 'impl', stories_done: 2, stories_total: 3, open_defects: 1 },
    );

    await driveQaRound2Clean(tm, g, task_id);
    row = listTasks(root)[0];
    assert.deepStrictEqual(
      { state: row.state, phase: row.phase, stories_done: row.stories_done, stories_total: row.stories_total, open_defects: row.open_defects },
      { state: 'IN_REVIEW', phase: 'qualitygate', stories_done: 3, stories_total: 3, open_defects: 0 },
    );
  });
});

test('listTasks() before shape: no packages yet reads READY/plan with null story progress, not "0/0"', async () => {
  const cwd = repo();
  const root = mkdtempSync(join(tmpdir(), 'view-test-root-'));
  const tm = await new Client(TM, { HARNESS_TASKS_DIR: root, HARNESS_TEST_NO_DRIVER: '1', TEAMS_VIEW: '0' }).init();
  try {
    const open = await tm.call('tm_open', { request: 'task A', cwd, vendor: 'self', roles: { planning: false, qa: false } });
    const row = listTasks(root)[0];
    assert.deepStrictEqual(
      { state: row.state, phase: row.phase, stories_done: row.stories_done, stories_total: row.stories_total, open_defects: row.open_defects },
      { state: 'READY', phase: 'plan', stories_done: null, stories_total: null, open_defects: 0 },
    );
    assert.equal(row.task_id, open.task_id);
  } finally {
    tm.close();
    rmSync(cwd, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

// Defect 1: epicTicketState()/epicPhase() (tickets.mjs) had no branch for task.s_run, so they
// read a size-S task's frozen 3-node manager graph ([size:done, shape:skipped,
// critique:skipped]) instead of the one child run task.s_run actually points at. Live repro via
// tm_board on this exact fixture, pre-fix: state 'BLOCKED', phase 'setgoal' - on a COMPLETED S
// run, because runState() on that frozen graph reads 'blocked' the instant delegateIfSmall skips
// shape/critique. view-collect.mjs's own listTasks() carried a local workaround
// (sRunTicketState) that covered only DONE/BLOCKED/IN_PROGRESS and never READY/IN_REVIEW or a
// real phase - this test now drives every leg of the real mapping through tickets.mjs's fixed
// epicTicketState/epicPhase, which listTasks() calls directly (no local copy left).
test('listTasks() on a size-S task (task.s_run, no task.spec) reads the real state/phase off the child run at every stage - READY/plan through DONE/null', async () => {
  const cwd = repo();
  const root = mkdtempSync(join(tmpdir(), 'view-test-root-'));
  const tm = await new Client(TM, { HARNESS_TASKS_DIR: root, HARNESS_TEST_NO_DRIVER: '1', TEAMS_VIEW: '0' }).init();
  const g = await new Client(BROKER).init();
  try {
    const open = await tm.call('tm_open', { request: 'small request', cwd, vendor: 'self', flow: 'develop', size: 'S', roles: { planning: false, qa: false } });
    assert.equal(open.task_state, 's_run');
    const { run_id } = open;
    const sub = (node_id, payload) => g.call('team_submit', { run_id, cwd, node_id, payload: ok(payload) });

    // Freshly opened: plan/setgoal/critique all pending, no spec yet -> READY/plan.
    let row = listTasks(root)[0];
    assert.deepStrictEqual({ state: row.state, phase: row.phase }, { state: 'READY', phase: 'plan' });

    // plan done, setgoal not yet submitted: critique still pending -> still READY/plan (the
    // 'setgoal' phase this same 'READY' state covers - critique started, still no spec - is
    // real (test-tickets.mjs pins it directly) but not independently observable through a live
    // drive of this flow: broker.mjs sets run.spec (and expandSubgoals) the instant setgoal's
    // own submission lands, one tm_submit call before critique is even opened - so a live run's
    // spec appears in the SAME call that would otherwise let a caller catch it critique-running-
    // but-spec-still-null).
    await sub('plan', { handoff: 'p', flow: 'develop', size: 'S' });
    row = listTasks(root)[0];
    assert.deepStrictEqual({ state: row.state, phase: row.phase }, { state: 'READY', phase: 'plan' });

    // setgoal done: spec set (and the subgoal chain pushed, gated on critique via its own deps)
    // -> already IN_PROGRESS/impl, even though critique has not run yet - epicPhase reads
    // "spec exists" as having left plan/setgoal for good, the same instant an ordinary task's
    // task.spec is set on shape's own completion, before its critique runs either.
    await sub('setgoal', { spec: CHILD_SPEC });
    row = listTasks(root)[0];
    assert.deepStrictEqual({ state: row.state, phase: row.phase }, { state: 'IN_PROGRESS', phase: 'impl' });

    // critique done, subgoal chain now unblocked and running -> still IN_PROGRESS/impl.
    await sub('critique', { sound: true });
    appendFileSync(join(cwd, 'a.txt'), 'changed\n');
    await sub('implement:U1:1', { changed_files: ['a.txt'], handoff: 'built' });
    row = listTasks(root)[0];
    assert.deepStrictEqual({ state: row.state, phase: row.phase }, { state: 'IN_PROGRESS', phase: 'impl' });

    // subgoal gate accepted, goal gate reached (ready, not yet judged) -> IN_REVIEW/qualitygate.
    await sub('test:U1:1', { verified: true });
    await sub('gate:U1:1', { accept: true, match_pct: 95 });
    row = listTasks(root)[0];
    assert.deepStrictEqual({ state: row.state, phase: row.phase }, { state: 'IN_REVIEW', phase: 'qualitygate' });

    // goal gate accepted and reported -> DONE/null.
    await sub('gate:goal:1', { accept: true, match_pct: 95 });
    await g.call('team_next', { run_id, cwd });
    await sub('report', { handoff: 'child report' });
    row = listTasks(root)[0];
    assert.deepStrictEqual({ state: row.state, phase: row.phase }, { state: 'DONE', phase: null });
  } finally {
    tm.close(); g.close();
    rmSync(cwd, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
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

    // storyLinks end to end: P1/P2 were shaped with implements[] (SHAPE_WITH_IMPLEMENTS, this
    // fixture's own shape payload), and D1 is the STORY the audit round filed - its own
    // links.filed_by must read 'planning-audit' straight through packageModel, the same value
    // d1.reporter already carries (one source, two fields reading it).
    const p1 = model.packages.find((p) => p.id === 'P1');
    const p2 = model.packages.find((p) => p.id === 'P2');
    assert.deepEqual(p1.links.implements, ['US-1']);
    assert.deepEqual(p2.links.implements, ['US-2']);
    assert.equal(d1.links.filed_by, 'planning-audit');
    assert.deepEqual(d1.links.blocked_by, [], 'fileDefects only wires named deps - none were named here');

    const text = renderText(model);
    for (const id of everyNodeId(model)) assert.ok(text.includes(id), `renderText output is missing node_id ${id}`);
    assert.match(text, /AUDIT:1[^\n]*unmet=1/);
    assert.match(text, /US-2 -> b\.txt was never wired to the exported path/);
    assert.match(text, /D1[^\n]*\[filed by planning-audit\]/);
    // P1 has no blocked_by of its own but IS a dep of P2 (TWO_PKG_SHAPE), so it also carries
    // the computed "blocks" side, on the same compact line as implements.
    assert.match(text, /P1[^\n]*\n\s+blocks P2 \(DONE\) · implements US-1/);
    assert.match(text, /P2[^\n]*\n\s+blocked by P1 \(DONE\) · implements US-2/);
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

test('renderText() indents every line of a filed defect\'s multi-line brief (fileDefects\' Title/Severity/Evidence block), not just the first', async () => {
  await withOpenTask({ planning: false, qa: true }, async ({ tm, g, root, task_id }) => {
    await driveToQaDefectFound(tm, g, task_id);
    const text = renderText(collectTask(root, task_id));
    const lines = text.split('\n');
    // Pinned exactly: every continuation line carries the SAME 4-space indent as the first
    // ("This package fixes...") - before the fix, only that first line was indented and every
    // line after it fell back to column 0 (the bug report's own repro).
    assert.equal(lines.find((l) => l.includes("This package fixes a defect")), '    This package fixes a defect filed against this task\'s integrated result.');
    assert.equal(lines.find((l) => l.trim() === 'Title: checkout crashes on empty cart'), '    Title: checkout crashes on empty cart');
    assert.equal(lines.find((l) => l.trim() === 'Severity: high'), '    Severity: high');
    assert.equal(lines.find((l) => l.trim() === 'Evidence:'), '    Evidence:');
    assert.equal(lines.find((l) => l.includes('run checkout with 0 items -> 500')), '    run checkout with 0 items -> 500');
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

// ---------- TICKET and RESOURCE views ----------

test('collect() adds ticket_key/ticket_state/attempt to each package (tickets.mjs\'s own storyTicketState, not a second derivation) and model.ticket for the EPIC header', async () => {
  await withTask(TWO_PKG_SHAPE, async ({ tm, g, root, task_id }) => {
    const nx = await tm.call('tm_next', { task_id });
    await completeChild(g, nx.children[0]);
    await tm.call('tm_submit', { task_id, node_id: 'dispatch:P1:1' });
    await tm.call('tm_submit', { task_id, node_id: 'accept:P1:1', payload: ok({ accept: true, match_pct: 90 }) });

    const model = collectTask(root, task_id);
    const epicKeyHere = `E-${task_id.slice(0, 8)}`;
    const p1 = model.packages.find((p) => p.id === 'P1');
    const p2 = model.packages.find((p) => p.id === 'P2');
    assert.equal(p1.ticket_key, `${epicKeyHere}/P1`);
    assert.equal(p1.ticket_state, 'DONE');
    assert.equal(p1.attempt, 1);
    assert.equal(p1.assignee, null, 'no pin was ever placed on P1');
    assert.equal(p2.ticket_state, 'READY', 'P2\'s only dep (P1) is already DONE');
    assert.deepEqual(model.ticket, {
      key: epicKeyHere, title: 'a request for the view test', state: 'IN_PROGRESS', phase: 'impl',
    });
  });
});

// The 0.27.3 human-pickup path end to end: tm_assign pins P1's STORY to a human before its own
// author node has run; team_next (promoteWaitingHuman, graph.mjs) then parks that node
// waiting_human - collect() must show the same three facts tm_inbox/tm_ticket would: the STORY's
// ticket_state, who is holding it, and the TASK row underneath it.
test('collect() surfaces a human pin through to a promoted waiting_human node: packages[].assignee, ticket_state WAITING_HUMAN, and the TASK child\'s own WAITING_HUMAN state', async () => {
  await withOpenTask({ planning: false, qa: false }, async ({ tm, g, root, task_id }) => {
    await throughCritique(tm, task_id, TWO_PKG_SHAPE);
    const nx = await tm.call('tm_next', { task_id });
    const child = nx.children.find((c) => c.package_id === 'P1');
    const epicKeyHere = `E-${task_id.slice(0, 8)}`;

    const assigned = await tm.call('tm_assign', { task_id, key: `${epicKeyHere}/P1`, to: { executor: 'human', who: 'sanghyeon' } });
    assert.equal(assigned.to, 'human');
    await g.call('team_next', { run_id: child.run_id, cwd: child.cwd });

    const model = collectTask(root, task_id);
    const p1 = model.packages.find((p) => p.id === 'P1');
    assert.equal(p1.ticket_state, 'WAITING_HUMAN');
    assert.equal(p1.assignee, 'sanghyeon');
    const u1Node = p1.child.nodes.find((n) => n.node_id === 'implement:U1:1');
    assert.equal(u1Node.state, 'waiting_human');
    assert.equal(u1Node.assignee, 'sanghyeon');
    assert.deepEqual(p1.child.tasks, [{ id: 'U1', key: `${epicKeyHere}/P1/U1`, title: 'module a', state: 'WAITING_HUMAN' }]);

    const text = renderTicketsText(model);
    assert.match(text, /WAITING_HUMAN:\n {2}\[E-[0-9a-f]{8}\/P1\] P1 - module a \(develop\)/);
    assert.match(text, />>> WAITING ON HUMAN: sanghyeon <<</);
    assert.match(text, new RegExp(`\\[WAITING_HUMAN\\] ${epicKeyHere}/P1/U1 - module a`));

    const resText = renderResourcesText(model);
    assert.match(resText, /human=sanghyeon/);
  });
});

// A hand-built model (like renderText's own minimalModel tests below) - storyTicketState's exact
// column vocabulary is pinned in test-tickets.mjs; this only pins how the TICKET view turns
// packageModel's own fields into columns/cards, and that an empty column never prints.
function minimalTicketModel(packages, extra = {}) {
  return {
    task_id: 't1', request: 'r', error: null,
    ticket: { key: 'E-aaaaaaaa', title: 'ship the thing', state: 'IN_PROGRESS', phase: 'impl' },
    packages, qa: null, audit: null,
    ...extra,
  };
}

test('renderTicketsText(): only non-empty state columns print, in tickets.mjs\'s own workflow order', () => {
  const text = renderTicketsText(minimalTicketModel([
    { id: 'P1', title: 'a', phase: null, reporter: null, attempt: 1, ticket_key: 'E-aaaaaaaa/P1', ticket_state: 'DONE', assignee: null, deps: [], links: { blocked_by: [], blocks: [], implements: [], filed_by: null }, child: null },
    { id: 'P2', title: 'b', phase: null, reporter: null, attempt: 1, ticket_key: 'E-aaaaaaaa/P2', ticket_state: 'BACKLOG', assignee: null, deps: ['P1'], links: { blocked_by: [], blocks: [], implements: [], filed_by: null }, child: null },
  ]));
  assert.match(text, /BACKLOG:/);
  assert.match(text, /DONE:/);
  assert.doesNotMatch(text, /READY:|IN_PROGRESS:|WAITING_HUMAN:|IN_REVIEW:|REJECTED:|BLOCKED:|CANCELLED:|UNREACHABLE:/);
  // BACKLOG prints before DONE - tickets.mjs §4's own workflow order, not insertion order (P2 is
  // declared after P1 above, but BACKLOG still comes first).
  assert.ok(text.indexOf('BACKLOG:') < text.indexOf('DONE:'));
});

test('renderTicketsText(): a card prints filed-by/attempt/deps, implements[], and (only when present) enables[]', () => {
  const text = renderTicketsText(minimalTicketModel([
    {
      id: 'P3', title: 'c', phase: null, reporter: 'qa', attempt: 3, ticket_key: 'E-aaaaaaaa/P3', ticket_state: 'BLOCKED', assignee: null,
      deps: ['P1', 'P2'], links: { blocked_by: [], blocks: [], implements: ['US-1'], enables: ['US-9'], filed_by: 'qa' }, child: null,
    },
  ]));
  assert.match(text, /filed by qa attempt=3 deps=P1,P2/);
  assert.match(text, /implements US-1/);
  assert.match(text, /enables US-9/);
});

test('renderTicketsText(): a card with a blocked_reason prints "blocked: ..." with the reason\'s own detail', () => {
  const unmet = renderTicketsText(minimalTicketModel([
    {
      id: 'P2', title: 'b', phase: null, reporter: null, attempt: 1, ticket_key: 'E-aaaaaaaa/P2', ticket_state: 'BACKLOG', assignee: null,
      deps: ['P1'], links: { blocked_by: [], blocks: [], implements: [], filed_by: null }, child: null,
      blocked_reason: { reason: 'unmet_deps', node_ids: ['dispatch:P1:1'] },
    },
  ]));
  assert.match(unmet, /blocked: unmet deps \(dispatch:P1:1\)/);

  const restarts = renderTicketsText(minimalTicketModel([
    {
      id: 'P3', title: 'c', phase: null, reporter: null, attempt: 2, ticket_key: 'E-aaaaaaaa/P3', ticket_state: 'BLOCKED', assignee: null,
      deps: [], links: { blocked_by: [], blocks: [], implements: [], filed_by: null }, child: null,
      blocked_reason: { reason: 'restart_exhausted', restarts: 2 },
    },
  ]));
  assert.match(restarts, /blocked: driver restart budget exhausted \(2 restarts\)/);

  const capacity = renderTicketsText(minimalTicketModel([
    {
      id: 'P4', title: 'd', phase: null, reporter: null, attempt: 1, ticket_key: 'E-aaaaaaaa/P4', ticket_state: 'WAITING_CAPACITY', assignee: null,
      deps: [], links: { blocked_by: [], blocks: [], implements: [], filed_by: null }, child: null,
      blocked_reason: { reason: 'capacity', since: 1000, elapsed_ms: 90000 },
    },
  ]));
  assert.match(capacity, /blocked: waiting on provider capacity \(1m30s\)/);
});

test('renderTicketsText(): a card with no blocked_reason prints no "blocked:" line', () => {
  const text = renderTicketsText(minimalTicketModel([
    { id: 'P1', title: 'a', phase: null, reporter: null, attempt: 1, ticket_key: 'E-aaaaaaaa/P1', ticket_state: 'READY', assignee: null, deps: [], links: { blocked_by: [], blocks: [], implements: [], filed_by: null }, child: null, blocked_reason: null },
  ]));
  assert.doesNotMatch(text, /blocked:/);
});

test('renderTicketsText(): flow_metrics prints one summary line (WIP, throughput, mean age, cycle/lead time)', () => {
  const withMetrics = renderTicketsText(minimalTicketModel([], {
    flow_metrics: {
      wip: 2,
      throughput: { done: 3, elapsed_ms: 86400000 * 2, per_day: 1.5 },
      mean_work_item_age_ms: 3600000,
      cycle_time_ms: { mean: 1800000, by_story: {} },
      lead_time_ms: { mean: 7200000, by_story: {} },
    },
  }));
  assert.match(withMetrics, /WIP=2 {2}throughput=1\.50\/day \(3 done\) {2}mean age=1h0m {2}cycle=30m0s {2}lead=2h0m/);

  const noMetrics = renderTicketsText(minimalTicketModel([], { flow_metrics: null }));
  assert.doesNotMatch(noMetrics, /WIP=|throughput=/);
});

test('renderTicketsText(): no relations, no pin -> no WAITING ON HUMAN marker and no tasks: block', () => {
  const text = renderTicketsText(minimalTicketModel([
    { id: 'P1', title: 'a', phase: null, reporter: null, attempt: 1, ticket_key: 'E-aaaaaaaa/P1', ticket_state: 'READY', assignee: null, deps: [], links: { blocked_by: [], blocks: [], implements: [], filed_by: null }, child: null },
  ]));
  assert.doesNotMatch(text, /WAITING ON HUMAN|tasks:/);
});

test('renderTicketsText(): the LATEST QA/audit round, not every historical round, becomes a board card', () => {
  const text = renderTicketsText(minimalTicketModel([], {
    qa: {
      id: 'QA',
      rounds: [
        { id: 'QA:1', title: null, phase: 'qa', reporter: null, attempt: 1, ticket_key: 'E-aaaaaaaa/QA', ticket_state: 'DONE', assignee: null, deps: [], links: { blocked_by: [], blocks: [], implements: [], filed_by: null }, child: null },
        { id: 'QA:2', title: null, phase: 'qa', reporter: null, attempt: 2, ticket_key: 'E-aaaaaaaa/QA', ticket_state: 'IN_REVIEW', assignee: null, deps: [], links: { blocked_by: [], blocks: [], implements: [], filed_by: null }, child: null },
      ],
    },
  }));
  // The round's own `.id` is "QA:2" (collectPhaseRounds overrides packageModel's `id: pkg.id`
  // with "<subgoal_id>:<attempt>" so a person can tell which round produced this card) - the
  // ticket_key stays the real STORY key (E-.../QA), unaffected by that override.
  assert.match(text, /IN_REVIEW:\n {2}\[E-aaaaaaaa\/QA\] QA:2 \(qa\)/);
  assert.doesNotMatch(text, /DONE:/);
});

// ---------- RESOURCE view ----------

function minimalResourceModel(overrides = {}) {
  return {
    task_id: 't1', tasks_dir: '/tmp/nested-root', error: null,
    daemon: { pid: 111, alive: true, started_at: 1000, restarts: 0, exhausted: false },
    s_run: null, packages: [], qa: null, audit: null,
    ...overrides,
  };
}

test('renderResourcesText(): TaskLeader row, a Team with a dead driver + cost, and its workers with executor/model/duration', () => {
  const model = minimalResourceModel({
    packages: [{
      id: 'P1', title: 'module a',
      child: {
        cwd: '/tmp/w1', branch: 'harness/x/P1', waiting_capacity: null,
        driver: { pid: 4242, alive: false, restarts: 2, cost: { cost_usd: 3.5, turns: 12 } },
        nodes: [
          { node_id: 'implement:U1:1', stage: 'implement', state: 'done', executor: 'claude', model: 'sonnet', elapsed_ms: 30000 },
          { node_id: 'test:U1:1', stage: 'test', state: 'failed', executor: 'codex', model: 'gpt', elapsed_ms: 5000 },
        ],
        nested: [],
      },
    }],
  });
  const text = renderResourcesText(model);
  assert.match(text, /TaskLeader\n {2}pid=111 alive=true started=1970-01-01T00:00:01\.000Z restarts=0/);
  assert.match(text, /Team P1 - module a/);
  assert.match(text, /worktree: \/tmp\/w1 \(harness\/x\/P1\)/);
  assert.match(text, /TeamLeader pid=4242 alive=false restarts=2 cost=\$3\.50 turns=12/);
  assert.match(text, /\[v\] implement:U1:1 \(implement\) executor=claude model=sonnet 30s/);
  assert.match(text, /\[x\] test:U1:1 \(test\) executor=codex model=gpt 5s/);
});

test('renderResourcesText(): no daemon prints a plain line, never a null pid', () => {
  assert.match(renderResourcesText(minimalResourceModel({ daemon: null })), /\(no daemon - driven by hand or an MCP client\)/);
});

test('renderResourcesText(): a STORY not yet dispatched has no worktree - "not dispatched yet", not a crash on a null child', () => {
  const text = renderResourcesText(minimalResourceModel({ packages: [{ id: 'P2', title: null, child: null }] }));
  assert.match(text, /Team P2\n {2}\(not dispatched yet - no worktree\)/);
});

test('renderResourcesText(): waiting_capacity on a Team\'s child prints its reason', () => {
  const text = renderResourcesText(minimalResourceModel({
    packages: [{ id: 'P1', title: null, child: { cwd: '/tmp/w1', branch: null, waiting_capacity: { reason: 'usage limit hit', since: 1 }, driver: null, nodes: [], nested: [] } }],
  }));
  assert.match(text, /waiting_capacity: usage limit hit/);
});

test('renderResourcesText(): waiting_capacity with elapsed_ms (view-collect.mjs\'s packageModel) prints "reason (elapsed)"', () => {
  const text = renderResourcesText(minimalResourceModel({
    packages: [{ id: 'P1', title: null, child: { cwd: '/tmp/w1', branch: null, waiting_capacity: { reason: 'usage limit hit', since: 1, elapsed_ms: 125000 }, driver: null, nodes: [], nested: [] } }],
  }));
  assert.match(text, /waiting_capacity: usage limit hit \(2m5s\)/);
});

test('renderResourcesText(): a worker\'s waiting_elapsed_ms (a node parked waiting_human straight from pending) prints "waiting=..."', () => {
  const text = renderResourcesText(minimalResourceModel({
    packages: [{
      id: 'P1', title: null,
      child: {
        cwd: '/tmp/w1', branch: null, waiting_capacity: null, driver: null, nested: [],
        nodes: [{ node_id: 'ask:U1:1', stage: 'ask', state: 'waiting_human', assignee: 'sanghyeon', waiting_elapsed_ms: 65000 }],
      },
    }],
  }));
  assert.match(text, /\[H\] ask:U1:1 \(ask\) human=sanghyeon waiting=1m5s/);
});

test('renderResourcesText(): a nested task inside a package worktree recurses as its own TaskLeader sub-tree', () => {
  const text = renderResourcesText(minimalResourceModel({
    packages: [{
      id: 'P1', title: null,
      child: {
        cwd: '/tmp/w1', branch: null, waiting_capacity: null, driver: null, nodes: [],
        nested: [minimalResourceModel({ task_id: 'nested-1' })],
      },
    }],
  }));
  assert.match(text, /nested task nested-1 at \/tmp\/nested-root/);
  const lines = text.split('\n');
  const nestedIdx = lines.findIndex((l) => l.includes('nested task nested-1'));
  assert.ok(nestedIdx >= 0);
  assert.match(lines[nestedIdx + 1], /TaskLeader/, 'the nested task gets its own TaskLeader row, not a flattened list');
});

test('renderResourcesText(): a size-S task renders one Team "S" instead of a packages loop', () => {
  const text = renderResourcesText(minimalResourceModel({
    s_run: { cwd: '/tmp/s1', driver: { pid: 9, alive: true, restarts: 0, cost: null }, nodes: [{ node_id: 'implement:U1:1', stage: 'implement', state: 'running' }] },
  }));
  assert.match(text, /Team S/);
  assert.match(text, /worktree: \/tmp\/s1/);
  assert.match(text, /\[>\] implement:U1:1 \(implement\)/);
});

// ---------- both views, through the HTML page's own client-side renderers ----------

test('ticketsBody (HTML): a WAITING_HUMAN card gets a badge, the reason line, and its TASK children as a list - the same facts renderTicketsText prints, as HTML', () => {
  const { ticketsBody } = extractPageFns(['ticketsBody']);
  const html = ticketsBody(minimalTicketModel([
    {
      id: 'P1', title: 'module a', phase: null, reporter: null, attempt: 2, ticket_key: 'E-aaaaaaaa/P1', ticket_state: 'WAITING_HUMAN', assignee: 'sanghyeon',
      deps: [], links: { blocked_by: [], blocks: [], implements: ['US-1'], filed_by: null },
      child: { tasks: [{ id: 'U1', key: 'E-aaaaaaaa/P1/U1', title: 'do it', state: 'WAITING_HUMAN' }] },
    },
  ]));
  assert.match(html, /<span class="badge WAITING_HUMAN">WAITING_HUMAN<\/span>/);
  assert.match(html, /<div class="reason">waiting on human: sanghyeon<\/div>/);
  assert.match(html, /<ul class="ticket-tasks"><li><span class="badge WAITING_HUMAN">WAITING_HUMAN<\/span>E-aaaaaaaa\/P1\/U1 – do it<\/li><\/ul>/);
  assert.match(html, /<h2>WAITING_HUMAN \(1\)<\/h2>/);
});

test('ticketCard (HTML): a blocked_reason prints its own "blocked: ..." reason line, the same text formatBlockedReason renders for the CLI', () => {
  const { ticketsBody } = extractPageFns(['ticketsBody']);
  const html = ticketsBody(minimalTicketModel([
    {
      id: 'P2', title: 'b', phase: null, reporter: null, attempt: 1, ticket_key: 'E-aaaaaaaa/P2', ticket_state: 'BACKLOG', assignee: null,
      deps: ['P1'], links: { blocked_by: [], blocks: [], implements: [], filed_by: null }, child: null,
      blocked_reason: { reason: 'unmet_deps', node_ids: ['dispatch:P1:1'] },
    },
  ]));
  assert.match(html, /<div class="reason">blocked: unmet deps \(dispatch:P1:1\)<\/div>/);
});

test('ticketsBody (HTML): flow_metrics renders a stat row (WIP/throughput/mean age/cycle/lead), absent when the model has none', () => {
  const { ticketsBody } = extractPageFns(['ticketsBody']);
  const withMetrics = ticketsBody(minimalTicketModel([], {
    flow_metrics: {
      wip: 2, throughput: { done: 3, elapsed_ms: 1, per_day: 1.5 },
      mean_work_item_age_ms: 3600000, cycle_time_ms: { mean: 1800000, by_story: {} }, lead_time_ms: { mean: 7200000, by_story: {} },
    },
  }));
  assert.match(withMetrics, /<div class="label">WIP<\/div><div class="value">2<\/div>/);
  assert.match(withMetrics, /<div class="label">throughput<\/div><div class="value">1\.50\/day \(3 done\)<\/div>/);
  assert.match(withMetrics, /<div class="label">mean age<\/div><div class="value">1h0m<\/div>/);
  assert.match(withMetrics, /<div class="label">cycle time<\/div><div class="value">30m0s<\/div>/);
  assert.match(withMetrics, /<div class="label">lead time<\/div><div class="value">2h0m<\/div>/);

  const noMetrics = ticketsBody(minimalTicketModel([], { flow_metrics: null }));
  assert.doesNotMatch(noMetrics, /label">WIP</);
});

test('resourcesBody (HTML): TaskLeader + Team + worker rows, dot classed by node state', () => {
  const { resourcesBody } = extractPageFns(['resourcesBody']);
  const html = resourcesBody(minimalResourceModel({
    packages: [{
      id: 'P1', title: 'module a',
      child: {
        cwd: '/tmp/w1', branch: 'b1', waiting_capacity: null,
        driver: { pid: 4242, alive: false, restarts: 2, cost: { cost_usd: 3.5, turns: 12 } },
        nodes: [{ node_id: 'implement:U1:1', stage: 'implement', state: 'waiting_human', assignee: 'sanghyeon' }],
        nested: [],
      },
    }],
  }));
  assert.match(html, /<div class="res-label">TaskLeader<\/div>/);
  assert.match(html, /<div class="res-label">Team P1 – module a<\/div>/);
  assert.match(html, /TeamLeader pid=4242 dead restarts=2/);
  assert.match(html, /<span class="dot waiting_human"><\/span>/);
  assert.match(html, /human: sanghyeon/);
});

test('viewTabs (HTML): all three views are offered, "pipeline" marked active with no ?view= in the URL', () => {
  const { viewTabs } = extractPageFns(['viewTabs']);
  const html = viewTabs();
  assert.match(html, /<span class="view-tab active" data-view="pipeline">pipeline<\/span>/);
  assert.match(html, /<span class="view-tab" data-view="tickets">tickets<\/span>/);
  assert.match(html, /<span class="view-tab" data-view="resources">resources<\/span>/);
});

// ---------- --view (the CLI's own selector) ----------

test('--once --view tickets renders the ticket board; --view resources renders the team tree; --view pipeline (or no flag) is unchanged', async () => {
  await withTask(TWO_PKG_SHAPE, async ({ root, task_id }) => {
    const tickets = spawnSync('node', [VIEW, '--tasks-dir', root, '--task', task_id, '--once', '--view', 'tickets'], { encoding: 'utf8' });
    assert.equal(tickets.status, 0, tickets.stderr);
    assert.match(tickets.stdout, /BACKLOG:|READY:/);
    assert.match(tickets.stdout, new RegExp(`E-${task_id.slice(0, 8)}`));

    const resources = spawnSync('node', [VIEW, '--tasks-dir', root, '--task', task_id, '--once', '--view', 'resources'], { encoding: 'utf8' });
    assert.equal(resources.status, 0, resources.stderr);
    assert.match(resources.stdout, /TaskLeader/);
    assert.match(resources.stdout, /Team P1/);

    const pipeline = spawnSync('node', [VIEW, '--tasks-dir', root, '--task', task_id, '--once'], { encoding: 'utf8' });
    assert.equal(pipeline.status, 0, pipeline.stderr);
    assert.match(pipeline.stdout, /manager pipeline:/);
  });
});

test('--view rejects an unknown value rather than silently falling back', async () => {
  await withTask(TWO_PKG_SHAPE, async ({ root, task_id }) => {
    const r = spawnSync('node', [VIEW, '--tasks-dir', root, '--task', task_id, '--once', '--view', 'bogus'], { encoding: 'utf8' });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /unknown --view 'bogus'/);
  });
});

test('/state.json carries model.ticket and packages[].ticket_state - the TICKET/RESOURCE views read the SAME poll the pipeline view already does', async () => {
  await withTask(TWO_PKG_SHAPE, async ({ root, task_id }) => {
    const proc = spawn('node', [VIEW, '--tasks-dir', root, '--task', task_id, '--port', '0'], { stdio: ['ignore', 'pipe', 'pipe'] });
    try {
      const base = await waitForListen(proc);
      const data = await (await fetch(`${base}/state.json`)).json();
      assert.equal(data.model.ticket.key, `E-${task_id.slice(0, 8)}`);
      assert.ok(data.model.packages.every((p) => typeof p.ticket_state === 'string'));
      assert.equal(data.model.daemon, null, 'this fixture was never put under a daemon');
    } finally {
      proc.kill();
    }
  });
});

// ---------- text renderer ----------

// A minimal hand-built model (renderModelBody only reads a handful of top-level fields) rather
// than a real collectTask() fixture - storyLinks' own exact object shape is already pinned in
// test-tickets.mjs; this only pins how view-render-text.mjs's formatLinksLine turns THAT shape
// into one line, and that it prints nothing extra when a package carries none of these relations.
function minimalModel(packages) {
  return {
    task_id: 't1', request: 'r', state: 'running', size: 'L', flow: 'develop',
    cost: {}, elapsed_ms: null, daemon: null, manager_stages: [], packages, qa: null, audit: null, events: [],
  };
}

test('renderText(): a package with no relations prints no extra line under its title', () => {
  const text = renderText(minimalModel([
    { id: 'P1', title: 'module a', links: { blocked_by: [], blocks: [], implements: [], filed_by: null } },
  ]));
  assert.doesNotMatch(text, /blocked by|blocks |implements /);
});

test('renderText(): blocked_by/blocks/implements render as one compact "·"-joined line; filed_by is not repeated there (already shown as "[filed by X]" on the title line)', () => {
  const text = renderText(minimalModel([
    {
      id: 'P2', title: 'module b', reporter: 'qa',
      links: {
        blocked_by: [{ key: 'E-aaaaaaaa/P1', id: 'P1', state: 'DONE' }],
        blocks: [{ key: 'E-aaaaaaaa/P3', id: 'P3', state: 'BACKLOG' }],
        implements: ['US-1'],
        filed_by: 'qa',
      },
    },
  ]));
  assert.match(text, /P2 - module b \[filed by qa\]/);
  assert.match(text, /blocked by P1 \(DONE\) · blocks P3 \(BACKLOG\) · implements US-1/);
  // filed_by must not produce a SECOND "filed by" occurrence - the title line's own is the only one.
  assert.equal((text.match(/filed by/g) || []).length, 1);
});

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

test('renderIndexText() renders one card per row, in tickets.mjs vocabulary (epic_key/state/phase), pinned exactly - not the raw task_id as headline, not the engine run state', () => {
  const rows = [
    { task_id: 't1', epic_key: 'E-t1', title: 'ship the thing', state: 'IN_PROGRESS', phase: 'impl', size: 'L', created_at: 1000, elapsed_ms: 65000, cost_usd: 1.5, stories_done: 1, stories_total: 2, open_defects: 0 },
    { task_id: 't2', epic_key: 'E-t2', title: 'done deal', state: 'DONE', phase: null, size: 'S', created_at: 2000, elapsed_ms: 5000, cost_usd: 0, stories_done: null, stories_total: null, open_defects: 2 },
    { task_id: 't3', epic_key: 'E-t3', error: 'could not read task.json: missing' },
  ];
  const text = renderIndexText(rows, '/tmp/somewhere');
  assert.equal(text, [
    'tasks under /tmp/somewhere:',
    '  E-t1  IN_PROGRESS · impl  ship the thing',
    '    task=t1  size=L  stories 1/2 done  cost=$1.50  elapsed=1m5s',
    '  E-t2  DONE  done deal',
    '    task=t2  size=S  open defects=2  cost=$0.00  elapsed=5s',
    '  E-t3  ERROR: could not read task.json: missing  (task t3)',
    '',
  ].join('\n'));
});

test('renderIndexText() on an empty tasks dir', () => {
  assert.equal(renderIndexText([], '/tmp/nowhere'), 'tasks under /tmp/nowhere:\n  (none)\n');
});

test('deriveTitle() takes the first sentence/clause of the request as the card headline, truncating deliberately rather than showing a raw task_id', () => {
  assert.equal(deriveTitle('Demo: build the expense tracker across two modules, then QA the integrated tree.'),
    'Demo: build the expense tracker across two modules, then QA the integra…');
  assert.equal(deriveTitle('Fix the login bug. Also update the docs.'), 'Fix the login bug');
  assert.equal(deriveTitle('no terminal punctuation at all here'), 'no terminal punctuation at all here');
  assert.equal(deriveTitle(''), '(no request)');
  assert.equal(deriveTitle(undefined), '(no request)');
  assert.equal(deriveTitle('   '), '(no request)');
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
  const tm1 = await new Client(TM, { HARNESS_TASKS_DIR: root, HARNESS_TEST_NO_DRIVER: '1', TEAMS_VIEW: '0' }).init();
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
    // the card model - epic_key/title/state/phase, the same shape listTasks() and
    // renderIndexText() are pinned against above - travels over the wire unchanged.
    const rowA = data.tasks.find((t) => t.task_id === a.task_id);
    assert.deepStrictEqual(
      { epic_key: rowA.epic_key, title: rowA.title, state: rowA.state, phase: rowA.phase },
      { epic_key: `E-${a.task_id.slice(0, 8)}`, title: 'task A', state: 'READY', phase: 'plan' },
    );

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

test('the HTML index page renders one card per EPIC, headlined by epic_key + title (never the raw task_id or the engine run state), each linking to its own /?task=<id>', () => {
  const rows = [
    { task_id: 'aaaaaaaa-1111-2222-3333-444444444444', epic_key: 'E-aaaaaaaa', title: 'ship the thing', state: 'IN_PROGRESS', phase: 'impl', size: 'L', created_at: Date.now(), elapsed_ms: 60000, cost_usd: 1.23, stories_done: 1, stories_total: 3, open_defects: 2 },
    { task_id: 'bbbbbbbb-1111-2222-3333-444444444444', epic_key: 'E-bbbbbbbb', error: 'could not read task.json: missing' },
  ];
  const html = renderIndexHtml(rows, '/tmp/x');
  assert.match(html, /<div class="index-grid">/);
  // headline is the epic key + title, not the raw task_id
  assert.match(html, /<span class="key mono">E-aaaaaaaa<\/span>/);
  assert.match(html, /<div class="title">ship the thing<\/div>/);
  // the ticket state (with phase), not the engine's run state, drives the badge
  assert.match(html, /<span class="badge IN_PROGRESS">IN_PROGRESS · impl<\/span>/);
  // full task_id survives, but only in the card body, never as the href's link text
  assert.match(html, /<a class="epic-card" href="\/\?task=aaaaaaaa-1111-2222-3333-444444444444">/);
  assert.match(html, /<div class="id mono">aaaaaaaa-1111-2222-3333-444444444444<\/div>/);
  assert.doesNotMatch(html, /<span class="key mono">aaaaaaaa-1111-2222-3333-444444444444/);
  // open defects only surface when there are any
  assert.match(html, /<span class="defects">open defects: 2<\/span>/);
  // an unreadable task.json still gets a card and a working link, not a crash
  assert.match(html, /<a class="epic-card" href="\/\?task=bbbbbbbb-1111-2222-3333-444444444444">/);
  assert.match(html, /could not read task\.json: missing/);
});

// The index card intentionally carries NO per-STORY relation detail (blocked by/blocks/
// implements/filed by) - listTasks()'s row is one EPIC-wide summary (stories done/total, open
// defect count; see view-collect.mjs's storyProgress), never a per-package breakdown. A STORY's
// own relations only make sense read against its OWN state, which the index row does not carry
// at all (epicTicketState is the EPIC's, not any one package's) - showing them here would mean
// re-deriving per-package facts on a card that has no room to render them meaningfully. They
// belong on the task view's package cards (pkgCard), where each package already has its own row.
test('the HTML index card renders no per-STORY link detail (blocked by/blocks/implements/filed by belong on the task view, not the index)', () => {
  const rows = [
    { task_id: 'aaaaaaaa-1111-2222-3333-444444444444', epic_key: 'E-aaaaaaaa', title: 'ship the thing', state: 'IN_PROGRESS', phase: 'impl', size: 'L', created_at: Date.now(), elapsed_ms: 60000, cost_usd: 1.23, stories_done: 1, stories_total: 3, open_defects: 2 },
  ];
  const html = renderIndexHtml(rows, '/tmp/x');
  assert.doesNotMatch(html, /blocked by|blocks |implements |filed by/);
});

// pkgCard (view-page.html) reads the SAME p.links field view-render-text.mjs's formatLinksLine
// does - pinned here so the browser and the terminal can never quietly disagree about a
// package's relations.
test('pkgCard (HTML): no relations -> no extra line; blocked_by/blocks/implements -> one compact line, filed_by left to the existing "[filed by X]" title fragment', () => {
  const noLinks = renderPkgCardHtml({ id: 'P1', title: 'module a', links: { blocked_by: [], blocks: [], implements: [], filed_by: null } });
  assert.doesNotMatch(noLinks, /blocked by|blocks |implements /);

  const withLinks = renderPkgCardHtml({
    id: 'P2', title: 'module b', reporter: 'qa',
    links: {
      blocked_by: [{ key: 'E-aaaaaaaa/P1', id: 'P1', state: 'DONE' }],
      blocks: [{ key: 'E-aaaaaaaa/P3', id: 'P3', state: 'BACKLOG' }],
      implements: ['US-1'],
      filed_by: 'qa',
    },
  });
  assert.match(withLinks, /\[filed by qa\]/);
  assert.match(withLinks, /<div class="muted mono">blocked by P1 \(DONE\) · blocks P3 \(BACKLOG\) · implements US-1<\/div>/);
  assert.equal((withLinks.match(/filed by/g) || []).length, 1);
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

test('collect()/renderText(): a Sprint shows its box (spend vs budget_usd, STOPPED with what was left), and a PLAN team running before shape is listed', () => {
  const root = mkdtempSync(join(tmpdir(), 'view-test-sprint-'));
  try {
    const taskId = 'dddddddd-0000-0000-0000-000000000000';
    const taskDir = join(root, taskId);
    const taskPath = join(taskDir, 'task.json');
    mkdirSync(join(taskDir, 'drivers'), { recursive: true });
    writeFileSync(join(taskDir, 'drivers', 'dispatch_PLAN_1.stream.jsonl'), JSON.stringify({ type: 'result', total_cost_usd: 4.5, num_turns: 9 }) + '\n');
    writeFileSync(join(taskDir, 'drivers', 'judge_size.stream.jsonl'), JSON.stringify({ type: 'result', total_cost_usd: 0.5, num_turns: 1 }) + '\n');
    writeFileSync(taskPath, JSON.stringify({
      run_id: taskId, cwd: root, request: 'a boxed backlog', created_at: Date.now(), store_path: taskPath,
      team: { opts: { budget_usd: 6 } },
      budget_warned: true,
      spec: null,
      planning_pkg: { id: 'PLAN', title: 'PRD', phase: 'planning' },
      nodes: [node('dispatch:PLAN:1', 'dispatch', [], { subgoal_id: 'PLAN', attempt: 1, state: 'running' })],
    }));
    let model = collectTask(root, taskId);
    assert.equal(model.budget.budget_usd, 6);
    assert.equal(model.budget.spend_usd, 5, 'judge_ logs count toward the box like any driver');
    assert.ok(model.packages.some((p) => p.id === 'PLAN'), 'PLAN is listed before shape has written task.spec');
    let text = renderText(model);
    assert.match(text, /budget \$5\.00\/\$6\.00 \(83%\) · WARN 80%/);

    const t = JSON.parse(readFileSync(taskPath, 'utf8'));
    t.budget_stopped = { skipped_packages: ['P3', 'P4'] };
    writeFileSync(taskPath, JSON.stringify(t));
    text = renderText(collectTask(root, taskId));
    assert.match(text, /STOPPED - not done: P3, P4/);

    delete t.team; delete t.budget_stopped;
    writeFileSync(taskPath, JSON.stringify(t));
    assert.equal(collectTask(root, taskId).budget, null, 'an unboxed task shows no box');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
