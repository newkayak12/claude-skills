#!/usr/bin/env node
// broker-vendors.mjs: the vendor registry, ledger, adapter invocation and readiness probe,
// exercised through the module's own exports (test-broker.mjs covers the same code only through a
// spawned broker).
//
//   node --test teams/scripts/test-broker-vendors.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AUTO_CANDIDATES,
  HARNESS_ROOT,
  brokerDir,
  loadVendors,
  probe,
  probeCache,
  readJson,
  record,
  runAdapter,
  syncOpenNodes,
} from '../mcp/broker-vendors.mjs';

function tmp(fn) {
  const d = mkdtempSync(join(tmpdir(), 'broker-vendors-'));
  const restore = process.env.BROKER_VENDORS;
  delete process.env.BROKER_VENDORS;
  const done = () => {
    if (restore === undefined) delete process.env.BROKER_VENDORS; else process.env.BROKER_VENDORS = restore;
    rmSync(d, { recursive: true, force: true });
  };
  const out = fn(d);
  return out && typeof out.then === 'function' ? out.finally(done) : (done(), out);
}

const node = (src) => ({ command: process.execPath, args: ['-e', src] });

test('AUTO_CANDIDATES names the two builtins, host vendor last, an unknown host changes nothing', () => {
  assert.deepEqual(AUTO_CANDIDATES(undefined), ['claude', 'codex']);
  assert.deepEqual(AUTO_CANDIDATES('claude'), ['codex', 'claude']);
  assert.deepEqual(AUTO_CANDIDATES('codex'), ['claude', 'codex']);
  assert.deepEqual(AUTO_CANDIDATES('gemini'), ['claude', 'codex']);
});

test('loadVendors: builtins point at real adapters; project and env registries layer on top; a malformed one is ignored', () => tmp((d) => {
  const base = loadVendors(d);
  assert.deepEqual(Object.keys(base).sort(), ['claude', 'codex']);
  for (const v of Object.values(base)) assert.ok(existsSync(v.args[0]), `adapter missing: ${v.args[0]}`);
  assert.equal(base.claude.requires_binary, 'claude');
  assert.ok(base.codex.sandboxes.includes('read-only'));

  mkdirSync(join(d, '.claude'));
  writeFileSync(join(d, '.claude', 'broker-vendors.json'), JSON.stringify({ mine: { command: 'x' }, codex: { command: 'override' } }));
  const merged = loadVendors(d);
  assert.equal(merged.mine.command, 'x');
  assert.equal(merged.codex.command, 'override');

  const envFile = join(d, 'env.json');
  writeFileSync(envFile, JSON.stringify({ viaenv: { command: 'y' } }));
  process.env.BROKER_VENDORS = envFile;
  assert.equal(loadVendors(d).viaenv.command, 'y');

  writeFileSync(join(d, '.claude', 'broker-vendors.json'), '{ not json');
  assert.equal(loadVendors(d).mine, undefined, 'a malformed project file adds nothing and breaks nothing');
  assert.equal(loadVendors(d).claude.command, 'node');
}));

test('loadVendors hands out a fresh copy: mutating one result never leaks into the next', () => tmp((d) => {
  loadVendors(d).claude.command = 'tampered';
  assert.equal(loadVendors(d).claude.command, 'node');
}));

test('record appends one timestamped JSON line under HARNESS_ROOT/broker and never throws', () => tmp((d) => {
  assert.equal(HARNESS_ROOT, '.teams_output');
  assert.equal(brokerDir(d), join(d, '.teams_output', 'broker'));
  record(d, { event: 'a', n: 1 });
  record(d, { event: 'b' });
  const lines = readFileSync(join(brokerDir(d), 'ledger.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(lines.map((l) => l.event), ['a', 'b']);
  assert.equal(typeof lines[0].ts, 'number');
  assert.equal(lines[0].n, 1);

  const asFile = join(d, 'plain-file');
  writeFileSync(asFile, 'x');
  assert.doesNotThrow(() => record(asFile, { event: 'unwritable' }), 'the ledger is evidence, never a dependency');
}));

test('syncOpenNodes snapshots only running nodes, keyed by ticket else node_id', () => tmp((d) => {
  const run = {
    run_id: 'r1', cwd: d,
    nodes: [
      { node_id: 'plan:1', stage: 'plan', state: 'done' },
      { node_id: 'implement:U1:1', stage: 'implement', state: 'running', ticket: 'tk-1', started_at: 111 },
      { node_id: 'test:U1:1', stage: 'test', state: 'running' },
    ],
  };
  syncOpenNodes(run);
  const map = readJson(join(brokerDir(d), 'open-nodes.json'));
  assert.deepEqual(Object.keys(map).sort(), ['test:U1:1', 'tk-1']);
  assert.deepEqual(map['tk-1'], { run_id: 'r1', node_id: 'implement:U1:1', stage: 'implement', cwd: d, opened_at: 111 });
  run.nodes[1].state = 'done';
  run.nodes[2].state = 'done';
  syncOpenNodes(run);
  assert.deepEqual(readJson(join(brokerDir(d), 'open-nodes.json')), {}, 'derived from the graph, so it empties with it');
}));

test('readJson returns the parsed value, or null for a missing or malformed file', () => tmp((d) => {
  writeFileSync(join(d, 'ok.json'), '{"a":1}');
  writeFileSync(join(d, 'bad.json'), '{');
  assert.deepEqual(readJson(join(d, 'ok.json')), { a: 1 });
  assert.equal(readJson(join(d, 'bad.json')), null);
  assert.equal(readJson(join(d, 'absent.json')), null);
}));

test('runAdapter captures stdout, stderr and the exit status, and marks the child as a node (HARNESS_NODE=1)', async () => {
  const r = await runAdapter(node("process.stdout.write('out:' + process.env.HARNESS_NODE); process.stderr.write('err'); process.exit(3)"), [], process.cwd());
  assert.equal(r.status, 3);
  assert.equal(r.stdout, 'out:1');
  assert.equal(r.stderr, 'err');
  assert.equal(r.killed_for, '');
});

test('runAdapter passes vendor args first, then the extra args', async () => {
  const r = await runAdapter(node('process.stdout.write(process.argv.slice(1).join(","))'), ['a', 'b'], process.cwd());
  assert.equal(r.stdout, 'a,b');
});

test('runAdapter kills a child that outlives timeoutMs and says so (killed_for: timeout)', async () => {
  const r = await runAdapter(node('setTimeout(() => {}, 60000)'), [], process.cwd(), { timeoutMs: 150 });
  assert.equal(r.killed_for, 'timeout');
  assert.notEqual(r.status, 0);
});

test('runAdapter hands the caller a cancel; calling it stops the child (killed_for: cancelled)', async () => {
  let cancel;
  const p = runAdapter(node('setTimeout(() => {}, 60000)'), [], process.cwd(), { register: (fn) => { cancel = fn; }, timeoutMs: 60000 });
  assert.equal(typeof cancel, 'function');
  setTimeout(() => cancel(), 100);
  const r = await p;
  assert.equal(r.killed_for, 'cancelled');
});

test('runAdapter reports a command that cannot start as status null with the error, never a rejection', async () => {
  const r = await runAdapter({ command: join(tmpdir(), 'definitely-not-a-command-xyz') }, [], process.cwd());
  assert.equal(r.status, null);
  assert.ok(r.error, 'the spawn error rides along');
});

// probe() refuses a vendor whose args[0] is not a file, so a fake adapter is a real script.
function scriptVendor(d, source) {
  const script = join(d, 'adapter.cjs');
  writeFileSync(script, source);
  return { command: process.execPath, args: [script] };
}
const reportAdapter = (d, report) => scriptVendor(d, `
const a = process.argv; const out = a[a.indexOf('--output') + 1];
require('node:fs').writeFileSync(out, JSON.stringify(${JSON.stringify(report)}));
`);

test('probe: a vendor whose --detect says ready is ready, the answer is cached, and the model keys the cache', () => tmp(async (d) => {
  probeCache.clear();
  const vendor = reportAdapter(d, { ok: true, ready: true, reachable: true });
  const a = await probe('fake', vendor, d, 'workspace-write', 'm1');
  assert.equal(a.ready, true);
  assert.equal(a.reachable, true);
  assert.ok(!a.quota);
  assert.equal(probeCache.size, 1);
  assert.equal(await probe('fake', vendor, d, 'workspace-write', 'm1'), a, 'second ask is the cached object');
  await probe('fake', vendor, d, 'workspace-write', 'm2');
  assert.equal(probeCache.size, 2, 'another model is another route');
  const files = readdirSync(brokerDir(d)).filter((f) => f.startsWith('probe-fake-workspace-write-'));
  assert.equal(files.length, 2, 'each model writes its own probe file (name carries a model hash) under the broker dir');
}));

test('probe: not ready but reachable is reported as exactly that (a reasoning node only needs reachable)', () => tmp(async (d) => {
  probeCache.clear();
  const r = await probe('half', reportAdapter(d, { ok: false, ready: false, reachable: true, reason: 'read-only' }), d, 'read-only');
  assert.equal(r.ready, false);
  assert.equal(r.reachable, true);
  assert.equal(r.reason, 'read-only');
}));

test('probe: a vendor with no adapter file, or whose binary is missing, is refused with a named reason', () => tmp(async (d) => {
  probeCache.clear();
  const noAdapter = await probe('ghost', { command: 'node', args: [join(d, 'nope.mjs')] }, d, 'workspace-write');
  assert.deepEqual([noAdapter.ready, noAdapter.reachable], [false, false]);
  assert.match(noAdapter.reason, /vendor "ghost" has no adapter at .*nope\.mjs/);

  const noBinary = await probe('bare', { command: 'node', args: [process.execPath], requires_binary: 'definitely-not-a-binary-xyz' }, d, 'workspace-write');
  assert.equal(noBinary.ready, false);
  assert.match(noBinary.reason, /requires definitely-not-a-binary-xyz on PATH/);
}));

test('probe: a spent usage limit is a quota, not a broken vendor, and its notice is kept in the reason', () => tmp(async (d) => {
  probeCache.clear();
  const r = await probe('spent', reportAdapter(d, { ok: false, ready: false, failure_kind: 'quota', last_message: "You've hit your usage limit. Try again at 5pm" }), d, 'workspace-write');
  assert.equal(r.quota, true);
  assert.equal(r.ready, false);
  assert.match(r.reason, /^usage capacity exhausted at probe: .*usage limit/);
}));

test('probe: an adapter that exits non-zero and writes nothing is not ready, with the exit in the reason', () => tmp(async (d) => {
  probeCache.clear();
  const r = await probe('dead', scriptVendor(d, 'console.error("boom"); process.exit(2)'), d, 'workspace-write');
  assert.equal(r.ready, false);
  assert.match(r.reason, /adapter exit 2: boom/);
}));
