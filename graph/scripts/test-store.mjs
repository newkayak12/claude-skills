#!/usr/bin/env node
// graph's own transactional run store (graph/mcp/store.mjs) and the broker writes that
// go through it. graph and teams are separate plugins: this file tests graph's copy only.
//
//   node --test graph/scripts/test-store.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync, statSync, utimesSync, existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mutateRun, writeAtomic, runFilePath, pidAlive, deriveNow, compareRows, orderRows } from '../mcp/store.mjs';
import { createRun, loadRun, saveRun } from '../mcp/graph.mjs';
import { runRow } from '../mcp/runs-readout.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const MCP = join(HERE, '..', 'mcp');
const BROKER = join(MCP, 'broker.mjs');

function scratch() {
  return mkdtempSync(join(tmpdir(), 'graph-store-'));
}

function withEnv(env, fn) {
  const prev = {};
  for (const k of Object.keys(env)) { prev[k] = process.env[k]; process.env[k] = env[k]; }
  try { return fn(); } finally {
    for (const k of Object.keys(env)) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; }
  }
}

function seed(cwd) {
  const run = createRun({ cwd, request: 'r' });
  return { run, path: runFilePath(cwd, run.run_id) };
}

function holdLock(path, owner) {
  const lock = path + '.lock';
  mkdirSync(lock, { recursive: true });
  if (owner) writeFileSync(join(lock, 'owner.json'), JSON.stringify(owner));
  return lock;
}

// ---------- the lock ----------

test('lock timeout throws instead of writing unlocked', () => {
  const cwd = scratch();
  try {
    const { run, path } = seed(cwd);
    holdLock(path, { pid: process.pid, at: Date.now(), token: 'held' });
    const before = readFileSync(path, 'utf8');
    withEnv({ GRAPH_LOCK_TIMEOUT_MS: '200' }, () => {
      assert.throws(() => mutateRun(cwd, run.run_id, (r) => { r.request = 'changed'; }), (e) => e.code === 'ELOCKTIMEOUT');
      assert.throws(() => saveRun({ ...loadRun(cwd, run.run_id), request: 'changed' }), (e) => e.code === 'ELOCKTIMEOUT');
    });
    assert.equal(readFileSync(path, 'utf8'), before, 'a timed-out writer must not have written');
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('a lock held by a live owner pid is never stolen, however old it is', () => {
  const cwd = scratch();
  try {
    const { run, path } = seed(cwd);
    const lock = holdLock(path, { pid: process.pid, at: Date.now() - 60 * 60 * 1000, token: 'live' });
    const past = new Date(Date.now() - 60 * 60 * 1000);
    utimesSync(lock, past, past);
    withEnv({ GRAPH_LOCK_TIMEOUT_MS: '200' }, () => {
      assert.throws(() => mutateRun(cwd, run.run_id, (r) => { r.request = 'x'; }), (e) => e.code === 'ELOCKTIMEOUT');
    });
    assert.equal(JSON.parse(readFileSync(join(lock, 'owner.json'), 'utf8')).token, 'live', 'the live lock is still in place');
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

// A wall-clock jump (wake from sleep, NTP step) must not expire the wait at once.
test('the lock wait deadline is monotonic: a forward Date.now jump does not cut the wait short', () => {
  const cwd = scratch();
  const realNow = Date.now;
  try {
    const { run, path } = seed(cwd);
    holdLock(path, { pid: process.ppid, at: realNow(), token: 'other' });
    let calls = 0;
    Date.now = () => realNow() + (calls++ > 0 ? 60 * 60 * 1000 : 0);
    const t0 = performance.now();
    withEnv({ GRAPH_LOCK_TIMEOUT_MS: '300' }, () => {
      assert.throws(() => mutateRun(cwd, run.run_id, (r) => { r.request = 'x'; }), (e) => e.code === 'ELOCKTIMEOUT');
    });
    const waited = performance.now() - t0;
    assert.ok(waited >= 250, `waited only ${Math.round(waited)} ms of a 300 ms timeout`);
  } finally {
    Date.now = realNow;
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('a lock whose owner pid is dead is broken', () => {
  const cwd = scratch();
  try {
    const { run, path } = seed(cwd);
    assert.equal(pidAlive(2147483646), false);
    holdLock(path, { pid: 2147483646, at: Date.now(), token: 'dead' });
    withEnv({ GRAPH_LOCK_TIMEOUT_MS: '500' }, () => mutateRun(cwd, run.run_id, (r) => { r.request = 'after-steal'; }));
    assert.equal(loadRun(cwd, run.run_id).request, 'after-steal');
    assert.equal(existsSync(path + '.lock'), false, 'the lock is released after the transaction');
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('an ownerless lock is broken only once its mtime is stale', () => {
  const cwd = scratch();
  try {
    const { run, path } = seed(cwd);
    const lock = holdLock(path, null);
    withEnv({ GRAPH_LOCK_TIMEOUT_MS: '200' }, () => {
      assert.throws(() => mutateRun(cwd, run.run_id, () => {}), (e) => e.code === 'ELOCKTIMEOUT');
    });
    const past = new Date(Date.now() - 5 * 60 * 1000);
    utimesSync(lock, past, past);
    withEnv({ GRAPH_LOCK_TIMEOUT_MS: '500' }, () => mutateRun(cwd, run.run_id, (r) => { r.request = 'ok'; }));
    assert.equal(loadRun(cwd, run.run_id).request, 'ok');
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

// ---------- the transaction ----------

test('a throwing fn aborts: nothing is written and the error propagates', () => {
  const cwd = scratch();
  try {
    const { run, path } = seed(cwd);
    const before = readFileSync(path, 'utf8');
    assert.throws(() => mutateRun(cwd, run.run_id, (r) => { r.request = 'half'; throw new Error('boom'); }), /boom/);
    assert.equal(readFileSync(path, 'utf8'), before);
    assert.equal(existsSync(path + '.lock'), false);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('an async fn is refused before anything is written', () => {
  const cwd = scratch();
  try {
    const { run, path } = seed(cwd);
    const before = readFileSync(path, 'utf8');
    assert.throws(() => mutateRun(cwd, run.run_id, async (r) => { r.request = 'async'; }), /synchronous/);
    assert.equal(readFileSync(path, 'utf8'), before);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('a transaction that changes nothing does not rewrite the file', () => {
  const cwd = scratch();
  try {
    const { run, path } = seed(cwd);
    const ino = statSync(path).ino;
    const out = mutateRun(cwd, run.run_id, (r) => r.nodes.length);
    assert.equal(out, 3, 'fn\'s return value comes back');
    assert.equal(statSync(path).ino, ino, 'no-change transactions must not write');
    mutateRun(cwd, run.run_id, (r) => { r.request = 'changed'; });
    assert.notEqual(statSync(path).ino, ino, 'a change is written by rename');
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('a nested transaction and saveRun inside one join the outer transaction', () => {
  const cwd = scratch();
  try {
    const { run } = seed(cwd);
    mutateRun(cwd, run.run_id, (outer) => {
      outer.request = 'outer';
      mutateRun(cwd, run.run_id, (inner) => {
        assert.equal(inner, outer, 'the inner fn sees the outer transaction\'s object');
        inner.context = 'inner';
      });
      assert.equal(saveRun(outer), outer);
      assert.equal(loadRun(cwd, run.run_id).request, 'r', 'nothing is committed before the outer fn returns');
    });
    const r = loadRun(cwd, run.run_id);
    assert.equal(r.request, 'outer');
    assert.equal(r.context, 'inner');
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('writeAtomic and saveRun leave no .tmp behind', () => {
  const cwd = scratch();
  try {
    const { run } = seed(cwd);
    for (let i = 0; i < 5; i++) saveRun({ ...loadRun(cwd, run.run_id), context: String(i) });
    writeAtomic(join(cwd, 'x.json'), { a: 1 });
    assert.deepEqual(JSON.parse(readFileSync(join(cwd, 'x.json'), 'utf8')), { a: 1 });
    const dir = dirname(runFilePath(cwd, run.run_id));
    assert.deepEqual(readdirSync(dir).filter((f) => f.endsWith('.tmp')), []);
    assert.deepEqual(readdirSync(cwd).filter((f) => f.endsWith('.tmp')), []);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

function runChild(source, env = {}) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, ['--input-type=module', '-e', source], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } });
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', (e) => resolve({ code: -1, err: String(e) }));
    p.on('close', (code) => resolve({ code, err }));
  });
}

test('a reader polling during 200 saves never sees a torn file', async () => {
  const cwd = scratch();
  try {
    const { run, path } = seed(cwd);
    // big enough that a plain writeFileSync is observably non-atomic to a concurrent reader
    const writer = runChild(`
      import { loadRun, saveRun } from ${JSON.stringify(join(MCP, 'graph.mjs'))};
      const r = loadRun(${JSON.stringify(cwd)}, ${JSON.stringify(run.run_id)});
      const big = 'x'.repeat(256 * 1024);
      for (let i = 0; i < 200; i++) { r.context = big + i; saveRun(r); }
    `);
    let done = false;
    let reads = 0;
    const torn = [];
    writer.then(() => { done = true; });
    while (!done) {
      try { JSON.parse(readFileSync(path, 'utf8')); reads++; } catch (e) { torn.push(e.message); }
      await new Promise((r) => setTimeout(r, 1));
    }
    const { code, err } = await writer;
    assert.equal(code, 0, err);
    assert.ok(reads > 0);
    assert.deepEqual(torn, [], `torn reads: ${torn.length}`);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('4 processes x 50 increments through mutateRun lose no update', async () => {
  const cwd = scratch();
  try {
    const { run } = seed(cwd);
    mutateRun(cwd, run.run_id, (r) => { r.counter = 0; });
    const src = `
      import { mutateRun } from ${JSON.stringify(join(MCP, 'store.mjs'))};
      for (let i = 0; i < 50; i++) mutateRun(${JSON.stringify(cwd)}, ${JSON.stringify(run.run_id)}, (r) => { r.counter += 1; });
    `;
    const outs = await Promise.all([1, 2, 3, 4].map(() => runChild(src, { GRAPH_LOCK_TIMEOUT_MS: '20000' })));
    for (const o of outs) assert.equal(o.code, 0, o.err);
    assert.equal(loadRun(cwd, run.run_id).counter, 200);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

// A waiter that judged the planted lock dead earlier must not remove the live lock another
// process acquired after breaking it - that is two holders and a lost update.
test('a planted dead-owner lock broken by many processes at once loses no update', async () => {
  const cwd = scratch();
  try {
    const { run, path } = seed(cwd);
    mutateRun(cwd, run.run_id, (r) => { r.counter = 0; });
    const src = `
      import { mutateRun } from ${JSON.stringify(join(MCP, 'store.mjs'))};
      const go = Number(process.env.GO_AT);
      while (Date.now() < go) { /* start together */ }
      for (let i = 0; i < 5; i++) mutateRun(${JSON.stringify(cwd)}, ${JSON.stringify(run.run_id)}, (r) => { r.counter += 1; });
    `;
    const ROUNDS = 25, PROCS = 8;
    for (let round = 0; round < ROUNDS; round++) {
      holdLock(path, { pid: 2147483646, at: Date.now(), token: `dead-${round}` });
      const go = String(Date.now() + 400);
      const outs = await Promise.all(Array.from({ length: PROCS }, () => runChild(src, { GRAPH_LOCK_TIMEOUT_MS: '20000', GO_AT: go })));
      for (const o of outs) assert.equal(o.code, 0, o.err);
      assert.equal(loadRun(cwd, run.run_id).counter, (round + 1) * PROCS * 5, `lost an update in round ${round}`);
    }
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

// ---------- the steal lock: a dead breaker is succeeded, never removed by name ----------

const DEAD = 2147483646;
const lockLitter = (path) => readdirSync(dirname(path)).filter((f) => /\.lock|\.steal/.test(f));

test('a live successor of a dead .steal blocks breaking; a dead successor is succeeded and the chain cleaned', () => {
  const cwd = scratch();
  try {
    const { run, path } = seed(cwd);
    holdLock(path, { pid: DEAD, at: Date.now(), token: 'dead-main' });
    const lock = path + '.lock';
    writeFileSync(lock + '.steal', JSON.stringify({ pid: DEAD, at: Date.now(), token: 'dead-steal' }));
    writeFileSync(lock + '.steal.dead-steal', JSON.stringify({ pid: process.pid, at: Date.now(), token: 'live-successor' }));
    withEnv({ GRAPH_LOCK_TIMEOUT_MS: '300' }, () => {
      assert.throws(() => mutateRun(cwd, run.run_id, (r) => { r.request = 'x'; }), (e) => e.code === 'ELOCKTIMEOUT');
    });
    assert.ok(existsSync(lock + '.steal'), 'a non-holder removed the dead base of a live chain');
    assert.ok(existsSync(lock + '.steal.dead-steal'), 'a non-holder removed a live successor');
    // the successor dies too: it is succeeded in turn, and the winner cleans the whole chain
    writeFileSync(lock + '.steal.dead-steal', JSON.stringify({ pid: DEAD, at: Date.now(), token: 'dead-successor' }));
    withEnv({ GRAPH_LOCK_TIMEOUT_MS: '1000' }, () => mutateRun(cwd, run.run_id, (r) => { r.request = 'through'; }));
    assert.equal(loadRun(cwd, run.run_id).request, 'through');
    assert.deepEqual(lockLitter(path), []);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('an empty or unparsable .steal holds while young, then is judged dead by its mtime', () => {
  for (const junk of ['', 'garbage{']) {
    const cwd = scratch();
    try {
      const { run, path } = seed(cwd);
      holdLock(path, { pid: DEAD, at: Date.now(), token: 'dead-main' });
      const steal = path + '.lock.steal';
      writeFileSync(steal, junk);
      withEnv({ GRAPH_LOCK_TIMEOUT_MS: '300' }, () => {
        assert.throws(() => mutateRun(cwd, run.run_id, () => {}), (e) => e.code === 'ELOCKTIMEOUT', `young ${JSON.stringify(junk)} .steal`);
      });
      const past = new Date(Date.now() - 5 * 60 * 1000);
      utimesSync(steal, past, past);
      withEnv({ GRAPH_LOCK_TIMEOUT_MS: '1000' }, () => mutateRun(cwd, run.run_id, (r) => { r.request = 'ok'; }));
      assert.equal(loadRun(cwd, run.run_id).request, 'ok');
      assert.deepEqual(lockLitter(path), []);
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  }
});

test('an old-format .steal directory left by a dead breaker is succeeded and removed', () => {
  const cwd = scratch();
  try {
    const { run, path } = seed(cwd);
    holdLock(path, { pid: DEAD, at: Date.now(), token: 'dead-main' });
    mkdirSync(path + '.lock.steal');
    writeFileSync(join(path + '.lock.steal', 'owner.json'), JSON.stringify({ pid: DEAD, at: Date.now(), token: 'old' }));
    withEnv({ GRAPH_LOCK_TIMEOUT_MS: '1000' }, () => mutateRun(cwd, run.run_id, (r) => { r.request = 'ok'; }));
    assert.equal(loadRun(cwd, run.run_id).request, 'ok');
    assert.deepEqual(lockLitter(path), []);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

// Fault injection: every remove/unlink of a lock-family path is delayed a few ms in the
// children, which widens the window between "judged dead" and "removed by name". A breaker
// that removes a dead .steal by name then removes a live one, two breakers overlap, and the
// second removes the main lock the first has just re-taken: a lost update.
test('8 processes x 24 rounds breaking a planted dead lock + dead/garbage/chained .steal lose no update', async () => {
  const cwd = scratch();
  try {
    const { run, path } = seed(cwd);
    mutateRun(cwd, run.run_id, (r) => { r.counter = 0; });
    const src = `
      import { createRequire, syncBuiltinESMExports } from 'node:module';
      const fs = createRequire(${JSON.stringify(join(MCP, 'x.cjs'))})('fs');
      const cell = new Int32Array(new SharedArrayBuffer(4));
      const slow = (name) => { const real = fs[name]; fs[name] = (p, ...rest) => {
        if (/\\.lock/.test(String(p))) Atomics.wait(cell, 0, 0, 1 + Math.floor(Math.random() * 15));
        return real(p, ...rest);
      }; };
      slow('rmSync'); slow('unlinkSync');
      syncBuiltinESMExports();
      const { mutateRun } = await import(${JSON.stringify(join(MCP, 'store.mjs'))});
      const go = Number(process.env.GO_AT);
      while (Date.now() < go) { /* start together */ }
      for (let i = 0; i < 5; i++) mutateRun(${JSON.stringify(cwd)}, ${JSON.stringify(run.run_id)}, (r) => { r.counter += 1; });
    `;
    const ROUNDS = 24, PROCS = 8;
    const lock = path + '.lock';
    const past = new Date(Date.now() - 5 * 60 * 1000);
    for (let round = 0; round < ROUNDS; round++) {
      holdLock(path, { pid: DEAD, at: Date.now(), token: `dead-${round}` });
      const kind = Number(process.env.STEAL_KIND ?? round % 3);
      // kind 0 is the old directory form, which the pre-fix breaker also recognises as dead
      if (kind === 0) { mkdirSync(lock + '.steal'); writeFileSync(join(lock + '.steal', 'owner.json'), JSON.stringify({ pid: DEAD, at: Date.now(), token: `ds-${round}` })); }
      if (kind === 1) { writeFileSync(lock + '.steal', 'garbage{'); utimesSync(lock + '.steal', past, past); }
      if (kind === 2) {
        writeFileSync(lock + '.steal', JSON.stringify({ pid: DEAD, at: Date.now(), token: `ds-${round}` }));
        writeFileSync(lock + `.steal.ds-${round}`, JSON.stringify({ pid: DEAD, at: Date.now(), token: `dc-${round}` }));
      }
      const go = String(Date.now() + 400);
      const outs = await Promise.all(Array.from({ length: PROCS }, () => runChild(src, { GRAPH_LOCK_TIMEOUT_MS: '20000', GO_AT: go })));
      for (const o of outs) assert.equal(o.code, 0, o.err);
      assert.equal(loadRun(cwd, run.run_id).counter, (round + 1) * PROCS * 5, `lost an update in round ${round} (kind ${kind})`);
      assert.deepEqual(lockLitter(path), [], `lock litter after round ${round}`);
    }
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

// ---------- broker: claim before the adapter, compare-and-set after it ----------

const ADAPTER = `#!/usr/bin/env node
import { writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { dirname } from 'node:path';
const args = process.argv.slice(2);
const get = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const out = get('--output');
mkdirSync(dirname(out), { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (args.includes('--detect')) {
  await sleep(Number(process.env.PROBE_DELAY_MS || 0));
  const ready = process.env.PROBE_FAIL !== '1';
  writeFileSync(out, JSON.stringify({ ok: ready, codex: { ready, reachable: ready, reason: ready ? '' : 'probe says no' } }));
  process.exit(0);
}
appendFileSync(process.env.COUNT_FILE, get('--prompt-file') + '\\n');
await sleep(Number(process.env.SLOW_MS || 0));
writeFileSync(out, JSON.stringify({ ok: true, last_message: JSON.stringify({ stage_ok: true, handoff: process.env.REPLY_TAG || 'h', evidence: 'e' }) }));
process.exit(0);
`;

function brokerRepo() {
  const dir = scratch();
  const git = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' });
  git('init', '-q');
  git('config', 'user.email', 't@t');
  git('config', 'user.name', 't');
  writeFileSync(join(dir, 'a.txt'), 'x\n');
  git('add', '-A');
  git('commit', '-qm', 'init');
  const adapter = join(dir, 'count-adapter.mjs');
  writeFileSync(adapter, ADAPTER);
  mkdirSync(join(dir, '.claude'), { recursive: true });
  writeFileSync(join(dir, '.claude', 'broker-vendors.json'), JSON.stringify({
    fake: { command: 'node', args: [adapter], sandboxes: ['read-only', 'workspace-write'], default_sandbox: 'workspace-write' },
  }));
  return dir;
}

class Client {
  constructor(env) {
    this.proc = spawn('node', [BROKER], { stdio: ['pipe', 'pipe', 'inherit'], env: { ...process.env, ...env } });
    this.buf = '';
    this.id = 0;
    this.pending = new Map();
    this.proc.stdout.setEncoding('utf8');
    this.proc.stdout.on('data', (chunk) => {
      this.buf += chunk;
      let nl;
      while ((nl = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, nl);
        this.buf = this.buf.slice(nl + 1);
        if (!line.trim()) continue;
        const d = JSON.parse(line);
        if (this.pending.has(d.id)) { this.pending.get(d.id)(d); this.pending.delete(d.id); }
      }
    });
  }
  request(method, params) {
    const id = ++this.id;
    const p = new Promise((resolve) => this.pending.set(id, resolve));
    this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    return p;
  }
  async init() { await this.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } }); return this; }
  async call(name, args) {
    const r = await this.request('tools/call', { name, arguments: args });
    const res = r.result || {};
    if (res.isError) return { error: res.content[0].text };
    return res.structuredContent;
  }
  close() { this.proc.stdin.end(); this.proc.kill(); }
}

const ok = (payload) => ({ stage_ok: true, evidence: 'e', ...payload });
const count = (cwd) => { try { return readFileSync(join(cwd, 'count.log'), 'utf8').split('\n').filter(Boolean).length; } catch { return 0; } };
const ledger = (cwd) => readFileSync(join(cwd, '.harness-run', 'broker', 'ledger.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

async function brokers(envs, fn) {
  const cwd = brokerRepo();
  const clients = [];
  try {
    for (const env of envs) clients.push(await new Client({ COUNT_FILE: join(cwd, 'count.log'), ...env }).init());
    await fn({ cwd, clients });
  } finally {
    for (const c of clients) c.close();
    rmSync(cwd, { recursive: true, force: true });
  }
}

test('two graph_run calls on one pending node run the adapter once', async () => {
  // b reads the run while plan is still pending, then spends its probe; a starts the node meanwhile
  await brokers([{ SLOW_MS: '2000' }, { SLOW_MS: '2000', PROBE_DELAY_MS: '1000' }], async ({ cwd, clients: [a, b] }) => {
    const { run_id } = await a.call('graph_open', { request: 'r', cwd, vendor: 'fake' });
    const second = b.call('graph_run', { run_id, cwd, node_id: 'plan' });
    await new Promise((r) => setTimeout(r, 200));
    const [x, y] = await Promise.all([a.call('graph_run', { run_id, cwd, node_id: 'plan' }), second]);
    assert.equal(count(cwd), 1, 'the adapter ran more than once for one node');
    const results = [x, y];
    assert.equal(results.filter((v) => v.state === 'done').length, 1, JSON.stringify(results));
    const refused = results.find((v) => v.error);
    assert.ok(refused, `the second call was not refused: ${JSON.stringify(results)}`);
    assert.match(refused.error, /running|not pending/);
  });
});

// N6: the vendor-failure branch used to write `failed` from the snapshot it took before
// `await route()` - over a node another broker had started meanwhile.
test('a vendor-failure verdict does not overwrite a node another broker started', async () => {
  await brokers([{ SLOW_MS: '3000' }, { PROBE_DELAY_MS: '1200', PROBE_FAIL: '1' }], async ({ cwd, clients: [a, b] }) => {
    const { run_id } = await a.call('graph_open', { request: 'r', cwd, vendor: 'fake' });
    const late = b.call('graph_run', { run_id, cwd, node_id: 'plan' });
    await new Promise((r) => setTimeout(r, 200));
    const held = a.call('graph_run', { run_id, cwd, node_id: 'plan' });
    const v = await late;
    assert.ok(v.error, `vendor-failure was written over a running node: ${JSON.stringify(v)}`);
    const st = await a.call('graph_status', { run_id, cwd });
    assert.equal(st.nodes.find((n) => n.node_id === 'plan').state, 'running');
    assert.equal((await held).state, 'done');
  });
});

test('a result whose ticket was superseded is dropped and recorded, the first result kept', async () => {
  await brokers([{ SLOW_MS: '2000', REPLY_TAG: 'late' }], async ({ cwd, clients: [a] }) => {
    const { run_id } = await a.call('graph_open', { request: 'r', cwd, vendor: 'fake' });
    const held = a.call('graph_run', { run_id, cwd, node_id: 'plan' });
    // another broker took the node over and finished it meanwhile
    await new Promise((r) => setTimeout(r, 800));
    mutateRun(cwd, run_id, (run) => {
      const n = run.nodes.find((x) => x.node_id === 'plan');
      assert.equal(n.state, 'running');
      n.ticket = 'other-ticket';
      n.state = 'done';
      n.result = { stage_ok: true, handoff: 'first' };
    });
    const v = await held;
    assert.equal(v.superseded, true, JSON.stringify(v));
    const plan = loadRun(cwd, run_id).nodes.find((x) => x.node_id === 'plan');
    assert.equal(plan.state, 'done');
    assert.equal(plan.result.handoff, 'first', 'the late result replaced the first one');
    assert.equal(plan.ticket, 'other-ticket');
    assert.equal(plan.superseded_results.length, 1);
    assert.ok(ledger(cwd).some((e) => e.event === 'result_superseded' && e.node_id === 'plan'));
  });
});

test('graph_retry during a running adapter call drops the late result', async () => {
  await brokers([{ SLOW_MS: '2500' }, {}], async ({ cwd, clients: [a, b] }) => {
    const { run_id } = await a.call('graph_open', { request: 'r', cwd, vendor: 'self' });
    const sub = (node_id, payload) => a.call('graph_submit', { run_id, cwd, node_id, payload: ok(payload) });
    await sub('plan', { handoff: 'p' });
    await sub('setgoal', { spec: { goal: 'G', acceptance: ['A'], subgoals: [{ id: 'U1', title: 'a', acceptance: ['a'], deps: [] }] } });
    await sub('critique', { sound: true });
    mutateRun(cwd, run_id, (run) => { run.vendor = 'fake'; });
    const held = a.call('graph_run', { run_id, cwd, node_id: 'implement:U1:1' });
    await new Promise((r) => setTimeout(r, 800));
    assert.equal(loadRun(cwd, run_id).nodes.find((x) => x.node_id === 'implement:U1:1').state, 'running');
    const retried = await b.call('graph_retry', { run_id, cwd, subgoal_id: 'U1' });
    assert.equal(retried.retried, true, JSON.stringify(retried));
    const v = await held;
    assert.equal(v.superseded, true, JSON.stringify(v));
    const run = loadRun(cwd, run_id);
    assert.equal(run.nodes.find((x) => x.node_id === 'implement:U1:1').state, 'skipped', 'the late result revived a retired attempt');
    assert.equal(run.nodes.find((x) => x.node_id === 'implement:U1:2').state, 'pending');
    assert.ok(ledger(cwd).some((e) => e.event === 'result_superseded' && e.node_id === 'implement:U1:1'));
  });
});

// A throw between the claim and the adapter's result (the prompt write, runAdapter) used to
// leave the node running under a ticket nobody would ever finish: it waited STALE_AFTER_MS
// and was then failed as abandoned, spending an attempt.
test('a graph_run that throws after its claim releases the node, which runs again at once', async () => {
  await brokers([{}], async ({ cwd, clients: [a] }) => {
    const { run_id } = await a.call('graph_open', { request: 'r', cwd, vendor: 'fake' });
    // the node's work directory cannot be created: a plain file sits where it goes
    const blocker = join(cwd, '.harness-run', 'broker', run_id, 'plan');
    mkdirSync(dirname(blocker), { recursive: true });
    writeFileSync(blocker, 'not a directory');
    const v = await a.call('graph_run', { run_id, cwd, node_id: 'plan' });
    assert.ok(v.error, JSON.stringify(v));
    const plan = loadRun(cwd, run_id).nodes.find((x) => x.node_id === 'plan');
    assert.equal(plan.state, 'pending', 'the claim was not released');
    assert.equal(plan.ticket ?? null, null, 'the claim ticket was left on the node');
    assert.equal(count(cwd), 0);
    assert.ok(ledger(cwd).some((e) => e.event === 'claim_failed' && e.node_id === 'plan'));
    rmSync(blocker);
    assert.equal((await a.call('graph_run', { run_id, cwd, node_id: 'plan' })).state, 'done');
    assert.equal(count(cwd), 1);
  });
});

// ---------- abandoned = the claiming process is gone, not "slow" ----------

const plantRunning = (cwd, run_id, fields) => mutateRun(cwd, run_id, (run) => {
  const n = run.nodes.find((x) => x.node_id === 'plan');
  Object.assign(n, { state: 'running', ticket: 'planted', started_at: Date.now(), ...fields });
});
const planOf = (cwd, run_id) => loadRun(cwd, run_id).nodes.find((x) => x.node_id === 'plan');

test('(a) a claim older than the stale window whose owner process is alive is not reclaimed, and its result applies', async () => {
  // b judges anything running for 300 ms as stale; a's adapter takes 2 s
  await brokers([{ SLOW_MS: '2000', REPLY_TAG: 'long' }, { BROKER_STALE_AFTER_MS: '300' }], async ({ cwd, clients: [a, b] }) => {
    const { run_id } = await a.call('graph_open', { request: 'r', cwd, vendor: 'fake' });
    const held = a.call('graph_run', { run_id, cwd, node_id: 'plan' });
    await new Promise((r) => setTimeout(r, 1000));
    await b.call('graph_status', { run_id, cwd });
    assert.equal(planOf(cwd, run_id).state, 'running', 'a live broker\'s node was reclaimed as abandoned');
    const v = await held;
    assert.notEqual(v.superseded, true, JSON.stringify(v));
    assert.equal(v.state, 'done');
    assert.equal(planOf(cwd, run_id).result.handoff, 'long');
  });
});

test('(b) a claim whose owner process is dead is reclaimed without waiting out the stale window', async () => {
  await brokers([{}], async ({ cwd, clients: [a] }) => {
    const { run_id } = await a.call('graph_open', { request: 'r', cwd, vendor: 'fake' });
    plantRunning(cwd, run_id, { owner_pid: DEAD });
    await a.call('graph_status', { run_id, cwd });
    const plan = planOf(cwd, run_id);
    assert.equal(plan.state, 'failed');
    assert.match(plan.result.reason, /abandoned/);
  });
});

test('(c) a claim with no owner recorded (older run file) keeps the time-based fallback', async () => {
  await brokers([{ BROKER_STALE_AFTER_MS: '600000' }], async ({ cwd, clients: [a] }) => {
    const { run_id } = await a.call('graph_open', { request: 'r', cwd, vendor: 'fake' });
    plantRunning(cwd, run_id, {});
    await a.call('graph_status', { run_id, cwd });
    assert.equal(planOf(cwd, run_id).state, 'running', 'a fresh ownerless claim was reclaimed');
    plantRunning(cwd, run_id, { started_at: Date.now() - 11 * 60 * 1000 });
    await a.call('graph_status', { run_id, cwd });
    assert.equal(planOf(cwd, run_id).state, 'failed');
  });
});

// ---------- the derived `now` record and the run-list order (card 48, F2) ----------

const NOW_KEYS = ['stage', 'doing', 'round', 'last_step', 'next', 'waiting', 'cost_usd'];

// A node as graph.mjs writes it, with the stage read off the id (plan, critique:2, implement:S1:1).
const nd = (id, state, extra = {}) => ({
  node_id: id, stage: id.split(':')[0], deps: [], after: [], state, attempt: 1, ticket: null, result: null, ...extra,
});
const runOf = (nodes, extra = {}) => ({ run_id: 'r-0', request: 'r', created_at: 1000, nodes, ...extra });
const nowOf = (nodes, extra) => deriveNow(runOf(nodes, extra));
const rowOf = (runId, nodes, mtimeMs, extra = {}) =>
  runRow(runOf(nodes, { run_id: runId, ...extra }), { file: `/x/${runId}.json`, mtimeMs, now: 10_000_000 });
const ids = (rows) => rows.map((r) => r.run_id);

test('F2-AC-1 a running plan node is the stage', () => {
  assert.equal(nowOf([nd('plan', 'running')]).stage, 'plan');
});

test('F2-AC-2 of several running nodes the one earliest in STAGES is the stage', () => {
  const n = nowOf([nd('test:S1:1', 'running', { subgoal_id: 'S1' }), nd('implement:S2:1', 'running', { subgoal_id: 'S2' })]);
  assert.equal(n.stage, 'implement:S2:1');
});

test('F2-AC-3 with nothing running the first ready node is the stage, else the last done one', () => {
  assert.equal(nowOf([nd('plan', 'done', { finished_at: 1 }), nd('critique:2', 'pending', { deps: ['setgoal:2'] }), nd('setgoal:2', 'pending', { deps: ['plan'] })]).stage, 'setgoal:2');
  assert.equal(nowOf([nd('plan', 'done', { finished_at: 1 }), nd('report', 'done', { finished_at: 9 })]).stage, 'report');
});

test('F2-AC-4 doing is executor·model, then the subgoal title, else the stage name', () => {
  assert.equal(nowOf([nd('critique', 'running', { executor: 'claude', model: 'opus' })]).doing, 'claude·opus');
  const sub = nd('implement:S1:1', 'running', { subgoal_id: 'S1', executor: 'codex', model: 'gpt-5' });
  assert.equal(nowOf([sub], { spec: { subgoals: [{ id: 'S1', title: 'Add the store' }] } }).doing, 'codex·gpt-5 — Add the store');
  assert.equal(nowOf([nd('plan', 'running')]).doing, 'plan');
});

test('F2-AC-5 doing is null when no node runs', () => {
  assert.equal(nowOf([nd('plan', 'pending')]).doing, null);
});

test('F2-AC-6 next is the ready node ids, sorted and joined, else null', () => {
  const ready = [nd('implement:S2:1', 'pending', { subgoal_id: 'S2' }), nd('implement:S1:1', 'pending', { subgoal_id: 'S1' })];
  assert.equal(nowOf(ready).next, 'implement:S1:1, implement:S2:1');
  assert.equal(nowOf([nd('plan', 'running')]).next, null);
});

test('F2-AC-7 round is null before a critique starts', () => {
  assert.equal(nowOf([nd('plan', 'done'), nd('setgoal', 'pending', { deps: ['plan'] }), nd('critique', 'pending', { deps: ['setgoal'] })]).round, null);
});

test('F2-AC-8 round counts the critique attempts started, a skipped first one included', () => {
  const n = nowOf([
    nd('critique', 'skipped', { result: { stage_ok: false, reason: 'superseded by spec attempt 2' } }),
    nd('critique:2', 'running', { attempt: 2 }),
  ]);
  assert.equal(n.round, 2);
  assert.equal(nowOf([nd('critique', 'running')]).round, 1);
  assert.equal(nowOf([nd('critique', 'failed'), nd('critique:2', 'pending', { attempt: 2, deps: ['setgoal:2'] })]).round, 1);
});

test('F2-AC-9 round is a positive integer or null on every row', () => {
  for (const nodes of [[nd('plan', 'running')], [nd('critique', 'done')], [nd('critique:3', 'running', { attempt: 3 })], []]) {
    const r = nowOf(nodes).round;
    assert.ok(r === null || (Number.isInteger(r) && r > 0), `round was ${JSON.stringify(r)}`);
  }
});

test('F2-AC-10 last_step is the newest finished node\'s, a failed one included', () => {
  const n = nowOf([
    nd('plan', 'done', { finished_at: 100, last_step: 'plan written' }),
    nd('test:S1:1', 'failed', { finished_at: 200, last_step: 'tests red' }),
  ]);
  assert.equal(n.last_step, 'tests red');
  assert.equal(nowOf([nd('plan', 'running')]).last_step, null);
});

test('F2-AC-11 last_step is cut to 120 characters in now only', () => {
  const long = 'x'.repeat(200);
  const row = rowOf('r-1', [nd('plan', 'done', { finished_at: 5, last_step: long })], 1);
  assert.equal(row.now.last_step, long.slice(0, 120));
  assert.equal(row.last_step, long, 'the row\'s own last_step is left as it was');
});

test('F2-AC-12 a routing block with nothing running is a wait on you', () => {
  const nodes = [nd('implement:S1:1', 'pending')];
  assert.deepEqual(nowOf(nodes, { routing_blocked: true, unavailable_vendors: { codex: { reason: 'x' } } }).waiting, { who: 'you', what: 'routing blocked: codex' });
  assert.deepEqual(nowOf(nodes, { routing_blocked: true }).waiting, { who: 'you', what: 'routing blocked' });
});

test('F2-AC-13 a node still running means no wait', () => {
  assert.equal(nowOf([nd('plan', 'running')], { routing_blocked: true, unavailable_vendors: { codex: {} } }).waiting, null);
  assert.equal(nowOf([nd('plan', 'pending')]).waiting, null);
});

test('F2-AC-14 cost_usd is a finite number or null', () => {
  assert.equal(nowOf([nd('plan', 'pending')], { cost_usd: 1.5 }).cost_usd, 1.5);
  assert.equal(nowOf([nd('plan', 'pending')], { cost_usd: null }).cost_usd, null);
  assert.equal(nowOf([nd('plan', 'pending')], { cost_usd: '1.5' }).cost_usd, null);
});

test('F2-AC-15 a waiting run comes before a newer running run with a failed node, every now field asserted', () => {
  const a = rowOf('A', [nd('plan', 'done', { finished_at: 50, last_step: 'plan written' }), nd('setgoal', 'pending', { deps: ['plan'] })], 1000,
    { routing_blocked: true, unavailable_vendors: { codex: {} }, cost_usd: 2 });
  const b = rowOf('B', [
    nd('implement:S1:1', 'running', { subgoal_id: 'S1', executor: 'claude', model: 'sonnet' }),
    nd('test:S1:1', 'failed', { subgoal_id: 'S1', finished_at: 300, last_step: 'tests red' }),
  ], 9000, { spec: { subgoals: [{ id: 'S1', title: 'Build it' }] } });
  assert.deepEqual(ids(orderRows([b, a])), ['A', 'B']);
  assert.deepEqual(a.now, { stage: 'setgoal', doing: null, round: null, last_step: 'plan written', next: 'setgoal', waiting: { who: 'you', what: 'routing blocked: codex' }, cost_usd: 2 });
  assert.deepEqual(b.now, { stage: 'implement:S1:1', doing: 'claude·sonnet — Build it', round: null, last_step: 'tests red', next: null, waiting: null, cost_usd: null });
});

test('F2-AC-16 with no wait a failed run comes before a newer clean one', () => {
  const a = rowOf('A', [nd('test:S1:1', 'failed', { finished_at: 10 })], 1000);
  const b = rowOf('B', [nd('plan', 'running')], 9000);
  assert.deepEqual(ids(orderRows([b, a])), ['A', 'B']);
});

test('F2-AC-17 of two failed runs the one that failed later comes first', () => {
  const a = rowOf('A', [nd('test:S1:1', 'failed', { finished_at: 900 })], 1000);
  const b = rowOf('B', [nd('test:S1:1', 'failed', { finished_at: 100 })], 9000);
  assert.deepEqual(ids(orderRows([b, a])), ['A', 'B']);
});

test('F2-AC-18 of two waiting runs the newer change comes first, equal changes go to the lower run_id', () => {
  const blocked = { routing_blocked: true };
  const old = rowOf('A', [nd('plan', 'pending')], 1000, blocked);
  const fresh = rowOf('B', [nd('plan', 'pending')], 2000, blocked);
  assert.deepEqual(ids(orderRows([old, fresh])), ['B', 'A']);
  const x = rowOf('X', [nd('plan', 'pending')], 5000, blocked);
  const y = rowOf('Y', [nd('plan', 'pending')], 5000, blocked);
  assert.deepEqual(ids(orderRows([y, x])), ['X', 'Y']);
});

test('F2-AC-19 the text columns of a row are unchanged and compareRows is a usable sort comparator', () => {
  const row = rowOf('abcdef0123', [nd('plan', 'running', { last_step: 's' })], 1);
  for (const k of ['id8', 'state', 'owner', 'created_at', 'cost_usd', 'running']) assert.ok(k in row, k);
  const rows = [rowOf('B', [nd('plan', 'running')], 1), rowOf('A', [nd('plan', 'running')], 1)];
  assert.deepEqual(ids([...rows].sort(compareRows)), ['A', 'B']);
  assert.equal(compareRows(rows[0], rows[0]), 0);
});

test('F2-AC-20 graph_status keeps its own order: runs-readout does not sort', () => {
  const rows = [rowOf('B', [nd('plan', 'running')], 1), rowOf('A', [nd('plan', 'running')], 9)];
  const copy = [...rows];
  orderRows(rows);
  assert.deepEqual(rows, copy, 'orderRows sorted its input in place');
});

test('F2-AC-21 with no failure and no wait the newer change comes first, equal changes go to the lower run_id', () => {
  const old = rowOf('A', [nd('plan', 'running')], 1000);
  const fresh = rowOf('B', [nd('plan', 'running')], 2000);
  assert.deepEqual(ids(orderRows([old, fresh])), ['B', 'A']);
  assert.equal(old.now.waiting, null);
  assert.equal(fresh.now.waiting, null);
  assert.deepEqual(ids(orderRows([rowOf('Y', [nd('plan', 'running')], 7), rowOf('X', [nd('plan', 'running')], 7)])), ['X', 'Y']);
});

test('F2-AC-22 a run just made by createRun has the fresh now', () => {
  const cwd = scratch();
  try {
    const { run } = seed(cwd);
    assert.deepEqual(deriveNow(run), { stage: 'plan', doing: null, round: null, last_step: null, next: 'plan', waiting: null, cost_usd: null });
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('F2-AC-23 now has exactly the seven keys, on every shape of run', () => {
  const shapes = [[], [nd('plan', 'running')], [nd('plan', 'failed', { finished_at: 1 })], [nd('report', 'done', { finished_at: 1 })]];
  for (const nodes of shapes) assert.deepEqual(Object.keys(nowOf(nodes)), NOW_KEYS);
  assert.deepEqual(Object.keys(deriveNow({ run_id: 'r' })), NOW_KEYS, 'a run with no nodes array');
  assert.deepEqual(Object.keys(rowOf('r', [nd('plan', 'running')], 1).now), NOW_KEYS);
});

// ---------- the CLI readout: spawned, read-only ----------

const runsCli = (...args) => spawnSync('node', [BROKER, 'runs', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000 });
const runsSnapshot = (cwd) => {
  const dir = dirname(runFilePath(cwd, 'x'));
  return readdirSync(dir).sort().map((f) => [f, readFileSync(join(dir, f), 'utf8'), statSync(join(dir, f)).mtimeMs]);
};

test('F2-AC-24 an old run file with no now and no created_at gets a derived now in --show and ranks by the same rules', () => {
  const cwd = scratch();
  try {
    const { run, path } = seed(cwd);
    const old = JSON.parse(readFileSync(path, 'utf8'));
    delete old.created_at;
    delete old.now;
    writeFileSync(path, JSON.stringify(old, null, 2));
    const shown = runsCli('--show', path);
    assert.equal(shown.status, 0, shown.stderr);
    const row = JSON.parse(shown.stdout);
    assert.equal(row.created_at, 'unknown');
    assert.deepEqual(row.now, { stage: 'plan', doing: null, round: null, last_step: null, next: 'plan', waiting: null, cost_usd: null });
    assert.ok(!('now' in JSON.parse(readFileSync(path, 'utf8'))), 'now was persisted');
    const newer = { ...row, run_id: 'zzz', last_change_ms: row.last_change_ms + 1000 };
    assert.deepEqual(ids(orderRows([row, newer])), ['zzz', run.run_id]);
    const listed = JSON.parse(runsCli('--list', '--json', '--cwd', cwd).stdout);
    assert.deepEqual(listed[0].now, row.now);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('F2-AC-25 runs --list --json and --show leave bytes, mtimes and the lock alone', () => {
  const cwd = scratch();
  try {
    const { path } = seed(cwd);
    seed(cwd);
    const stamp = new Date(Date.now() - 3_600_000);
    for (const f of readdirSync(dirname(path))) utimesSync(join(dirname(path), f), stamp, stamp);
    const before = runsSnapshot(cwd);
    assert.equal(runsCli('--list', '--json', '--cwd', cwd).status, 0);
    assert.equal(runsCli('--show', path).status, 0);
    assert.deepEqual(runsSnapshot(cwd), before);
    assert.ok(!existsSync(path + '.lock'), 'a lock was left');
    assert.ok(!readdirSync(dirname(path)).some((f) => f.endsWith('.lock') || f.endsWith('.tmp')));
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('F2-AC-26 a cwd with no runs directory lists []', () => {
  const cwd = scratch();
  try {
    const out = runsCli('--list', '--json', '--cwd', cwd);
    assert.equal(out.status, 0, out.stderr);
    assert.deepEqual(JSON.parse(out.stdout), []);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

const BOOT_FILE = '/proc/sys/kernel/random/boot_id';
const bootId = () => readFileSync(BOOT_FILE, 'utf8').trim();

test('(d) a claim under the broker\'s own pid whose ticket it does not hold is reclaimed', async () => {
  await brokers([{ BROKER_STALE_AFTER_MS: '600000' }], async ({ cwd, clients: [a] }) => {
    const { run_id } = await a.call('graph_open', { request: 'r', cwd, vendor: 'fake' });
    const boot = existsSync(BOOT_FILE) ? bootId() : null;
    plantRunning(cwd, run_id, { owner_pid: a.proc.pid, owner_boot: boot, ticket: 'not-held' });
    await a.call('graph_status', { run_id, cwd });
    const plan = planOf(cwd, run_id);
    assert.equal(plan.state, 'failed', 'an own-pid claim nobody in this broker holds stayed running');
    assert.match(plan.result.reason, /abandoned/);
  });
});

test('(e) a claim stamped under another boot is reclaimed though its pid is alive', { skip: !existsSync(BOOT_FILE) }, async () => {
  await brokers([{ BROKER_STALE_AFTER_MS: '600000' }], async ({ cwd, clients: [a] }) => {
    const { run_id } = await a.call('graph_open', { request: 'r', cwd, vendor: 'fake' });
    plantRunning(cwd, run_id, { owner_pid: process.pid, owner_boot: bootId() });
    await a.call('graph_status', { run_id, cwd });
    assert.equal(planOf(cwd, run_id).state, 'running', 'a live same-boot claim was reclaimed');
    plantRunning(cwd, run_id, { owner_pid: process.pid, owner_boot: 'another-boot' });
    await a.call('graph_status', { run_id, cwd });
    const plan = planOf(cwd, run_id);
    assert.equal(plan.state, 'failed', 'a claim from another boot was not reclaimed');
    assert.match(plan.result.reason, /abandoned/);
  });
});
