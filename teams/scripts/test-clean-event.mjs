#!/usr/bin/env node
// test-clean-event.mjs - tm_clean's `clean` ledger event.
//
// The repo's push hold (.claude/hooks/repo-rules.mjs) releases a task whose last ledger event is
// `clean`. A tm_clean that finds nothing to remove (the worktrees are already gone) must still
// leave that event, or the hold has no signal to read; a dry run changes nothing and records
// nothing.
//
//   node --test teams/scripts/test-clean-event.mjs

process.env.TEAMS_RUNS_DIR ??= 'off';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterTmCall, beforeTmCall } from './lib/planning-drive.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const TM = join(HERE, '..', 'mcp', 'taskmanager.mjs');
const BROKER = join(HERE, '..', 'mcp', 'broker.mjs');

// Same stdio JSON-RPC client test-clean.mjs uses.
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
    if (this.script === TM) args = await beforeTmCall(this, name, args, () => this.planningBroker());
    const out = await this.rawCall(name, args);
    return this.script === TM ? afterTmCall(this, name, args, out) : out;
  }
  async rawCall(name, args) {
    const r = await this.send('tools/call', { name, arguments: args });
    const res = r.result || {};
    if (res.isError) return { error: res.content[0].text };
    return res.structuredContent;
  }
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
  const dir = mkdtempSync(join(tmpdir(), 'tm-clean-event-'));
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

const CHILD_SPEC = {
  goal: 'G', acceptance: ['A'],
  subgoals: [{ id: 'U1', title: 'do it', acceptance: ['a'], test: ['t'], deps: [] }],
};
async function completeChild(g, child) {
  const { cwd, run_id } = child;
  const sub = (node_id, payload) => g.call('team_submit', { run_id, cwd, node_id, payload: ok(payload) });
  await sub('plan', { handoff: 'p', flow: 'develop', size: 'S' });
  await sub('setgoal', { spec: CHILD_SPEC });
  await sub('critique', { sound: true });
  appendFileSync(join(cwd, 'a.txt'), `changed by ${child.package_id || 'child'}\n`);
  const v = await sub('implement:U1:1', { changed_files: ['a.txt'], handoff: 'built' });
  assert.equal(v.state, 'done', JSON.stringify(v));
  await sub('test:U1:1', { verified: true });
  await sub('gate:U1:1', { accept: true, match_pct: 95 });
  await sub('gate:goal:1', { accept: true, match_pct: 95 });
  await sub('report', { handoff: 'built' });
  const nx = await g.call('team_next', { run_id, cwd });
  assert.equal(nx.state, 'complete');
}

// Two packages, driven to a completed EPIC.
async function runEpic(tm, g, task_id) {
  const submit = (node_id, payload) => tm.call('tm_submit', { task_id, node_id, payload });
  let v = await submit('size', ok({ size: 'L', flow: 'develop', sizing: ['ls -> modules'], handoff: 'modules' }));
  assert.equal(v.state, 'done', JSON.stringify(v));
  v = await submit('shape', ok({ ...SHAPE, handoff: 's' }));
  assert.equal(v.state, 'done', JSON.stringify(v));
  v = await submit('critique', ok({ sound: true }));
  assert.equal(v.state, 'done', JSON.stringify(v));
  let nx = await tm.call('tm_next', { task_id });
  await completeChild(g, nx.children[0]);
  await submit('dispatch:P1:1');
  await submit('accept:P1:1', ok({ accept: true, match_pct: 90 }));
  nx = await tm.call('tm_next', { task_id });
  await completeChild(g, nx.children[0]);
  await submit('dispatch:P2:1');
  await submit('accept:P2:1', ok({ accept: true, match_pct: 90 }));
  await tm.call('tm_next', { task_id }); // opens integrate:1
  await submit('integrate:1', ok({ verified: true, checks: ['build -> ok'] }));
  await tm.call('tm_next', { task_id }); // opens gate:goal:1
  await submit('gate:goal:1', ok({ accept: true, match_pct: 92 }));
  await tm.call('tm_next', { task_id }); // opens report
  v = await submit('report', ok({ handoff: 'all done' }));
  assert.equal(v.state, 'done', JSON.stringify(v));
  assert.equal((await tm.call('tm_status', { task_id })).state, 'complete');
}

const cleanEvents = (root, task_id) => readFileSync(join(root, task_id, 'ledger.jsonl'), 'utf8')
  .split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((e) => e.event === 'clean');

async function withEpic(fn) {
  const cwd = repo();
  const root = mkdtempSync(join(tmpdir(), 'tm-clean-event-root-'));
  const tm = await new Client(TM, { HARNESS_TASKS_DIR: root, HARNESS_TEST_NO_DRIVER: '1' }).init();
  const g = await new Client(BROKER).init();
  tm.broker = g;
  try {
    const open = await tm.call('tm_open', { brainstorm: false, request: 'big request', cwd, vendor: 'self', roles: { qa: false, audit: false } });
    await runEpic(tm, g, open.task_id);
    await fn({ tm, root, task_id: open.task_id });
  } finally {
    tm.close();
    g.close();
    rmSync(cwd, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
}

test('a tm_clean that removes nothing still appends a clean ledger event', async () => {
  await withEpic(async ({ tm, root, task_id }) => {
    const first = await tm.call('tm_clean', { task_id });
    assert.ok(first.removed_worktrees.length > 0, 'the first call removes the package worktrees');
    assert.equal(cleanEvents(root, task_id).length, 1);
    const second = await tm.call('tm_clean', { task_id });
    assert.equal(second.removed_worktrees.length, 0);
    assert.equal(second.removed_branches.length, 0);
    assert.equal(cleanEvents(root, task_id).length, 2, 'the second call removed nothing and is still recorded');
  });
});

test('a tm_clean dry run appends no clean event', async () => {
  await withEpic(async ({ tm, root, task_id }) => {
    const r = await tm.call('tm_clean', { task_id, dry_run: true });
    assert.equal(r.dry_run, true);
    assert.equal(cleanEvents(root, task_id).length, 0);
  });
});
