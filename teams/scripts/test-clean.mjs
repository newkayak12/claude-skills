#!/usr/bin/env node
// test-clean.mjs - tm_clean: EPIC teardown (§14 C-11).
//
// A package worktree/branch (ensureWorktree, taskmanager.mjs) accumulates forever once its
// dispatch is done - nothing server-owned removes it. tm_clean does, but only once the task is
// terminal, and only what is safe: the integration tree (the delivered result - teams never
// merges it into the project's own branch, v0.31.1) is never touched, and a package branch is
// deleted only once every commit on it is reachable from an integration branch or the project's
// own HEAD.
//
//   node --test teams/scripts/test-clean.mjs

process.env.TEAMS_RUNS_DIR ??= 'off';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeTmCall } from './lib/planning-drive.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const TM = join(HERE, '..', 'mcp', 'taskmanager.mjs');
const BROKER = join(HERE, '..', 'mcp', 'broker.mjs');

// Same stdio JSON-RPC client test-taskmanager.mjs uses.
class Client {
  constructor(script, env = {}) {
    this.script = script;
    this.proc = spawn('node', [script], { stdio: ['pipe', 'pipe', 'inherit'], env: { ...process.env, TEAMS_VIEW: '0', ...env } });
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
    // Every task plans now (cards-everywhere C5/C6): a task-manager client drives the planning a
    // shape submission waits on first - lib/planning-drive.mjs says how, and why.
    if (this.script === TM) args = await beforeTmCall(this, name, args, () => this.planningBroker());
    return this.rawCall(name, args);
  }
  async rawCall(name, args) {
    const r = await this.send('tools/call', { name, arguments: args });
    const res = r.result || {};
    if (res.isError) return { error: res.content[0].text };
    return res.structuredContent;
  }
  // The broker planning cards are driven through: the one the suite attached (client.broker), or
  // one this client spawns on first need and closes with itself.
  async planningBroker() {
    if (this.broker) return this.broker;
    if (!this.ownBroker) this.ownBroker = await new Client(BROKER).init();
    return this.ownBroker;
  }
  close() {
    if (this.ownBroker) this.ownBroker.close();
    this.proc.stdin.end();
    this.proc.kill();
  }
}

function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'tm-clean-test-'));
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

const SHAPE = {
  acceptance: ['both modules build together'],
  packages: [
    { id: 'P1', title: 'module a', flow: 'develop', brief: 'change a.txt', acceptance: ['a.txt says a'], touches: ['a.txt'], deps: [] },
    { id: 'P2', title: 'module b', flow: 'develop', brief: 'change b.txt using a', acceptance: ['b.txt says b'], touches: ['b.txt'], deps: ['P1'] },
  ],
};

// Same shape test-taskmanager.mjs's completeChild uses: a SHAPE package with no split/size:'L'
// is parent_shaped by default, so gate:U1 alone is both the subgoal gate and the run's verdict.
async function completeChild(g, child) {
  const { cwd, run_id } = child;
  const sub = (node_id, payload) => g.call('team_submit', { run_id, cwd, node_id, payload: ok(payload) });
  appendFileSync(join(cwd, 'a.txt'), `changed by ${child.package_id || 'child'}\n`);
  let v = await sub('implement:U1:1', { changed_files: ['a.txt'], handoff: 'built' });
  assert.equal(v.state, 'done', JSON.stringify(v));
  await sub('test:U1:1', { verified: true });
  await sub('gate:U1:1', { accept: true, match_pct: 95 });
  const nx = await g.call('team_next', { run_id, cwd });
  assert.equal(nx.state, 'complete');
}

async function throughCritique(tm, task_id, shape = SHAPE) {
  let v = await tm.call('tm_submit', { task_id, node_id: 'size', payload: ok({ size: 'L', flow: 'develop', sizing: ['ls -> modules'], handoff: 'modules' }) });
  assert.equal(v.state, 'done', JSON.stringify(v));
  v = await tm.call('tm_submit', { task_id, node_id: 'shape', payload: ok({ ...shape, handoff: 's' }) });
  assert.equal(v.state, 'done', JSON.stringify(v));
  v = await tm.call('tm_submit', { task_id, node_id: 'critique', payload: ok({ sound: true }) });
  assert.equal(v.state, 'done', JSON.stringify(v));
}

// Drives the two-package SHAPE all the way to a completed EPIC: both packages dispatched,
// accepted, integrated, goal-gated and reported. Returns the task.json snapshot so a test can
// read each package's own worktree/branch off it.
async function runFullEpic(tm, g, root, task_id) {
  await throughCritique(tm, task_id);
  let nx = await tm.call('tm_next', { task_id });
  await completeChild(g, nx.children[0]);
  await tm.call('tm_submit', { task_id, node_id: 'dispatch:P1:1' });
  await tm.call('tm_submit', { task_id, node_id: 'accept:P1:1', payload: ok({ accept: true, match_pct: 90 }) });
  nx = await tm.call('tm_next', { task_id });
  await completeChild(g, nx.children[0]);
  await tm.call('tm_submit', { task_id, node_id: 'dispatch:P2:1' });
  await tm.call('tm_submit', { task_id, node_id: 'accept:P2:1', payload: ok({ accept: true, match_pct: 90 }) });
  await tm.call('tm_next', { task_id }); // opens integrate:1
  await tm.call('tm_submit', { task_id, node_id: 'integrate:1', payload: ok({ verified: true, checks: ['build -> ok'] }) });
  await tm.call('tm_next', { task_id }); // opens gate:goal:1
  await tm.call('tm_submit', { task_id, node_id: 'gate:goal:1', payload: ok({ accept: true, match_pct: 92 }) });
  await tm.call('tm_next', { task_id }); // opens report
  const v = await tm.call('tm_submit', { task_id, node_id: 'report', payload: ok({ handoff: 'all done' }) });
  assert.equal(v.state, 'done', JSON.stringify(v));
  const fin = await tm.call('tm_status', { task_id });
  assert.equal(fin.state, 'complete');
  return JSON.parse(readFileSync(join(root, task_id, 'task.json'), 'utf8'));
}

function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  return { ok: r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}

function branchExists(cwd, branch) {
  return git(cwd, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]).ok;
}

function dispatchChild(task, pkgId) {
  const n = task.nodes.filter((x) => x.subgoal_id === pkgId && x.stage === 'dispatch' && x.child).pop();
  return n.child;
}

function integration(task) {
  const n = task.nodes.filter((x) => x.stage === 'integrate' && x.integration).pop();
  return n.integration;
}

async function withTask(fn, extra) {
  const cwd = repo();
  const root = mkdtempSync(join(tmpdir(), 'tm-clean-root-'));
  const tm = await new Client(TM, { HARNESS_TASKS_DIR: root, HARNESS_TEST_NO_DRIVER: '1' }).init();
  const g = await new Client(BROKER).init();
  tm.broker = g;
  try {
    // Planning always runs (cards-everywhere C5) - the client drives it ahead of shape
    // (lib/planning-drive.mjs); QA and the planning audit are still pinned off for a plain graph.
    const roles = { qa: false, audit: false };
    const open = await tm.call('tm_open', { brainstorm: false, request: 'big request', cwd, vendor: 'self', roles, ...extra });
    await fn({ tm, g, cwd, root, task_id: open.task_id });
  } finally {
    tm.close();
    g.close();
    rmSync(cwd, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
}

test('tm_clean removes every package worktree and branch once merged into integrate, keeps the integration tree, and records a ledger event', async () => {
  await withTask(async ({ tm, g, cwd, root, task_id }) => {
    const task = await runFullEpic(tm, g, root, task_id);
    const p1 = dispatchChild(task, 'P1');
    const p2 = dispatchChild(task, 'P2');
    const integ = integration(task);
    assert.ok(existsSync(join(p1.cwd, '.git')) && existsSync(join(p2.cwd, '.git')), 'both package worktrees exist before cleaning');

    const prdPath = join(cwd, '.teams_output', 'team', `E-${task_id.slice(0, 8)}`, '10-prd.md');
    const prdBefore = readFileSync(prdPath, 'utf8');
    const r = await tm.call('tm_clean', { task_id });
    assert.equal(r.dry_run, false);
    // The planning card's worktree is a package worktree too (cards-everywhere C2): cleaned alike.
    assert.deepEqual(r.removed_worktrees.map((x) => x.package_id).sort(), ['P1', 'P2', 'PLAN-F1']);
    assert.deepEqual(r.removed_branches.map((x) => x.package_id).sort(), ['P1', 'P2', 'PLAN-F1']);
    assert.deepEqual(r.kept_branches, []);
    assert.deepEqual(r.kept.map((k) => k.cwd), [integ.cwd]);

    assert.ok(!existsSync(join(p1.cwd, '.git')), 'P1 worktree gone');
    assert.ok(!existsSync(join(p2.cwd, '.git')), 'P2 worktree gone');
    assert.equal(branchExists(cwd, p1.branch), false, 'P1 branch gone');
    assert.equal(branchExists(cwd, p2.branch), false, 'P2 branch gone');
    assert.ok(existsSync(join(integ.cwd, '.git')), 'the integration worktree is untouched');
    assert.equal(branchExists(cwd, integ.branch), true, 'the integration branch is untouched');

    const ledger = readFileSync(join(root, task_id, 'ledger.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const cleanEvent = ledger.find((e) => e.event === 'clean');
    assert.ok(cleanEvent, 'a clean event is recorded in the task ledger');
    assert.deepEqual(cleanEvent.removed_worktrees.sort(), ['P1', 'P2', 'PLAN-F1']);
    // The merged PRD does not depend on the card's worktree still being there: a re-render after
    // the clean reads the snapshot the planning integrate took (C4).
    await tm.call('tm_docs', { task_id, rebuild: true });
    assert.equal(readFileSync(prdPath, 'utf8'), prdBefore, '10-prd.md survives tm_clean unchanged');
  });
});

test('tm_clean is idempotent: a second call finds everything already gone', async () => {
  await withTask(async ({ tm, g, root, task_id }) => {
    await runFullEpic(tm, g, root, task_id);
    const first = await tm.call('tm_clean', { task_id });
    assert.equal(first.removed_worktrees.length, 3, 'P1, P2 and the planning card PLAN-F1');
    const second = await tm.call('tm_clean', { task_id });
    assert.equal(second.removed_worktrees.length, 0);
    assert.equal(second.removed_branches.length, 0);
    assert.deepEqual(second.already_clean.map((x) => x.package_id).sort(), ['P1', 'P2', 'PLAN-F1']);
  });
});

test('tm_clean refuses a task that is still running', async () => {
  await withTask(async ({ tm, task_id }) => {
    await throughCritique(tm, task_id); // dispatch:P1:1 is now pending/running - the task is not terminal
    const r = await tm.call('tm_clean', { task_id });
    assert.match(r.error, /running/);
    assert.match(r.error, /terminal state/);
  });
});

test('tm_clean({dry_run:true}) reports what it would remove and touches no git state', async () => {
  await withTask(async ({ tm, g, root, task_id }) => {
    const task = await runFullEpic(tm, g, root, task_id);
    const p1 = dispatchChild(task, 'P1');
    const r = await tm.call('tm_clean', { task_id, dry_run: true });
    assert.equal(r.dry_run, true);
    assert.deepEqual(r.removed_worktrees.map((x) => x.package_id).sort(), ['P1', 'P2', 'PLAN-F1']);
    assert.deepEqual(r.removed_branches.map((x) => x.package_id).sort(), ['P1', 'P2', 'PLAN-F1']);
    assert.ok(existsSync(join(p1.cwd, '.git')), 'dry_run never removes the worktree');
    assert.equal(branchExists(p1.cwd, p1.branch), true, 'dry_run never deletes the branch');
    // Nothing was actually removed, so a real clean afterwards still finds it all.
    const real = await tm.call('tm_clean', { task_id });
    assert.equal(real.removed_worktrees.length, 3);
  });
});

test('a package branch with commits made after integration is kept (reason given); only its worktree directory is removed', async () => {
  await withTask(async ({ tm, g, cwd, root, task_id }) => {
    const task = await runFullEpic(tm, g, root, task_id);
    const p1 = dispatchChild(task, 'P1');
    const p2 = dispatchChild(task, 'P2');
    // Simulate work landing on P1's branch after it was already merged into integrate:1 - a real
    // git state tm_clean must actually check for, not assume away.
    writeFileSync(join(p1.cwd, 'late.txt'), 'late\n');
    git(p1.cwd, ['add', '-A']);
    git(p1.cwd, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'work after integration']);

    const r = await tm.call('tm_clean', { task_id });
    assert.deepEqual(r.removed_branches.map((x) => x.package_id).sort(), ['P2', 'PLAN-F1']);
    assert.deepEqual(r.kept_branches.map((x) => x.package_id), ['P1']);
    assert.match(r.kept_branches[0].reason, /not reachable/);
    assert.deepEqual(r.removed_worktrees.map((x) => x.package_id).sort(), ['P1', 'P2', 'PLAN-F1'], 'the worktree directory is removed either way - the branch ref alone keeps the commits');

    assert.ok(!existsSync(join(p1.cwd, '.git')), 'P1 worktree directory is still removed');
    assert.equal(branchExists(cwd, p1.branch), true, 'P1 branch is kept - its extra commit is not reachable from anywhere else');
    assert.equal(branchExists(cwd, p2.branch), false, 'P2 branch is deleted as usual');
  });
});

test('tm_clean({}) without task_id sweeps every task under the tasks root, defaulting to dry_run and skipping a running one', async () => {
  await withTask(async ({ tm: tmA, g: gA, root, task_id: doneId }) => {
    await runFullEpic(tmA, gA, root, doneId);
    // A second task in the SAME tasks root, left running (never past critique).
    const cwdB = repo();
    const tmB = await new Client(TM, { HARNESS_TASKS_DIR: root, HARNESS_TEST_NO_DRIVER: '1' }).init();
    try {
      const openB = await tmB.call('tm_open', { brainstorm: false, request: 'second', cwd: cwdB, vendor: 'self', roles: { qa: false, audit: false } });
      const runningId = openB.task_id;

      const listed = await tmA.call('tm_clean', {});
      assert.equal(listed.dry_run, true, 'no task_id - default is list candidates, not act');
      const doneRow = listed.tasks.find((t) => t.task_id === doneId);
      const runningRow = listed.tasks.find((t) => t.task_id === runningId);
      assert.ok(doneRow && runningRow);
      assert.equal(runningRow.skipped, true);
      assert.deepEqual(doneRow.removed_worktrees.map((x) => x.package_id).sort(), ['P1', 'P2', 'PLAN-F1']);

      const done = JSON.parse(readFileSync(join(root, doneId, 'task.json'), 'utf8'));
      const p1 = dispatchChild(done, 'P1');
      assert.ok(existsSync(join(p1.cwd, '.git')), 'dry_run by default - nothing removed yet');

      const swept = await tmA.call('tm_clean', { dry_run: false });
      const doneRow2 = swept.tasks.find((t) => t.task_id === doneId);
      assert.equal(doneRow2.removed_worktrees.length, 3);
      assert.ok(!existsSync(join(p1.cwd, '.git')), 'the explicit sweep actually removed it');
      const runningRow2 = swept.tasks.find((t) => t.task_id === runningId);
      assert.equal(runningRow2.skipped, true, 'a running task is skipped, never refused, in sweep mode');
    } finally {
      tmB.close();
      rmSync(cwdB, { recursive: true, force: true });
    }
  });
});
