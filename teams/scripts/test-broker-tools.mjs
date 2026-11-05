#!/usr/bin/env node
// broker-tools.mjs: the tool table and the call dispatch, driven in-process through
// callBrokerTool with the ctx stdio.mjs hands a call (test-broker.mjs drives the same tools over a
// spawned stdio server). Vendor runs use a fake adapter script registered through BROKER_VENDORS.
//
//   node --test teams/scripts/test-broker-tools.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadRun, getNode, saveRun } from '../mcp/graph.mjs';
import { BROKER_TOOLS, callBrokerTool } from '../mcp/broker-tools.mjs';

async function scratch(fn) {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'broker-tools-')));
  const saved = process.env.BROKER_VENDORS;
  delete process.env.BROKER_VENDORS;
  try { return await fn(cwd); } finally {
    if (saved === undefined) delete process.env.BROKER_VENDORS; else process.env.BROKER_VENDORS = saved;
    rmSync(cwd, { recursive: true, force: true });
  }
}

// Registers vendor `fake`. On --detect the adapter answers ready; otherwise it writes `result` as
// the node's report (or sleeps for a minute when `hang` is set, so a cancel has something to stop).
function registerFake(cwd, { result = { stage_ok: true, flow: 'develop', size: 'S' }, hang = false } = {}) {
  const script = join(cwd, 'fake-adapter.cjs');
  writeFileSync(script, `
const a = process.argv; const out = a[a.indexOf('--output') + 1];
const fs = require('node:fs');
if (a.includes('--detect')) { fs.writeFileSync(out, JSON.stringify({ ok: true, ready: true, reachable: true })); process.exit(0); }
${hang ? 'setTimeout(() => {}, 60000);' : `fs.writeFileSync(out, JSON.stringify({ stage_ok: true, result: ${JSON.stringify(result)} }));`}
`);
  const file = join(cwd, 'vendors.json');
  writeFileSync(file, JSON.stringify({ fake: { command: process.execPath, args: [script], sandboxes: ['read-only', 'workspace-write'], default_sandbox: 'workspace-write' } }));
  process.env.BROKER_VENDORS = file;
}

const call = (name, args, ctx) => callBrokerTool(name, args, ctx);

test('the tool table: six team_* tools, each with an object input schema and a declared output schema', () => {
  assert.deepEqual(BROKER_TOOLS.map((t) => t.name), ['team_open', 'team_next', 'team_run', 'team_submit', 'team_retry', 'team_status']);
  for (const t of BROKER_TOOLS) {
    assert.equal(t.inputSchema.type, 'object', t.name);
    assert.equal(t.outputSchema.type, 'object', t.name);
    assert.equal(typeof t.description, 'string', t.name);
  }
  assert.deepEqual(BROKER_TOOLS[0].inputSchema.required, ['request', 'cwd']);
  assert.deepEqual(BROKER_TOOLS[2].inputSchema.required, ['run_id', 'node_id']);
});

test('callBrokerTool: an unknown tool throws (stdio.mjs turns that into an isError reply)', async () => {
  await assert.rejects(() => call('team_nope', {}), /unknown tool: team_nope/);
});

test('team_open builds the graph, offers plan to the orchestrator as self with a readable briefing, and team_status sees the run', () => scratch(async (cwd) => {
  const opened = await call('team_open', { request: 'do the thing', cwd, vendor: 'self', flow: 'develop' });
  assert.equal(opened.cwd, cwd);
  assert.equal(opened.state, 'running');
  assert.equal(opened.flow, 'develop');
  assert.equal(opened.ready.length, 1);
  const [plan] = opened.ready;
  assert.deepEqual([plan.node_id, plan.stage, plan.vendor], ['plan', 'plan', 'self']);
  assert.match(plan.next, /team_submit/);
  assert.ok(existsSync(plan.briefing_path), 'the briefing is on disk, not in the reply');
  assert.ok(loadRun(cwd, opened.run_id), 'the run is on disk');

  const status = await call('team_status', { run_id: opened.run_id, cwd });
  assert.equal(status.run_id, opened.run_id);
  assert.equal(status.has_spec, false);
  assert.deepEqual(status.nodes.map((n) => n.node_id), ['plan', 'setgoal', 'critique']);

  const overview = await call('team_status', { cwd });
  assert.deepEqual(overview.cwds, [cwd]);
  assert.equal(overview.runs[0].run_id, opened.run_id);
  assert.equal(overview.runs[0].request, 'do the thing');

  const full = await call('team_status', { run_id: opened.run_id, cwd, node_id: 'plan', full: true });
  assert.equal(full.node.node_id, 'plan');
  await assert.rejects(() => call('team_status', { run_id: opened.run_id, cwd, node_id: 'ghost', full: true }), /unknown node ghost/);
}));

test('team_status overview of a directory with no runs is an empty list, not an error', async () => {
  // knownCwds is process-wide and other tests add to it; an overview of an explicit empty dir is the stable case
  await scratch(async (cwd) => {
    const overview = await call('team_status', { cwd });
    assert.deepEqual(overview, { cwds: [cwd], runs: [] });
  });
});

test('team_submit records a self-executed node once: a second identical call returns the stored verdict, idempotent', () => scratch(async (cwd) => {
  const { run_id } = await call('team_open', { request: 'r', cwd, vendor: 'self', flow: 'develop' });
  const first = await call('team_submit', { run_id, cwd, node_id: 'plan', payload: { stage_ok: true, flow: 'develop', size: 'S' } });
  assert.equal(first.state, 'done');
  assert.equal(first.vendor, 'self');
  assert.equal(first.idempotent, undefined);
  const second = await call('team_submit', { run_id, cwd, node_id: 'plan', payload: { stage_ok: false } });
  assert.equal(second.idempotent, true);
  assert.equal(second.state, 'done', 'the second payload did not re-adjudicate');
  assert.match(second.note, /already done; returning the stored result/);
  const wrongAttempt = await call('team_submit', { run_id, cwd, node_id: 'plan', attempt: 9, payload: { stage_ok: true } }).catch((e) => e);
  assert.ok(wrongAttempt instanceof Error, 'a mismatched attempt is not served from the stored result');
  assert.match(wrongAttempt.message, /plan is done, not pending/);
}));

test('team_submit refuses a node whose dependencies never ran, and an unknown node', () => scratch(async (cwd) => {
  const { run_id } = await call('team_open', { request: 'r', cwd, vendor: 'self', flow: 'develop' });
  await assert.rejects(() => call('team_submit', { run_id, cwd, node_id: 'setgoal', payload: { stage_ok: true } }), /node setgoal is blocked on plan/);
  await assert.rejects(() => call('team_submit', { run_id, cwd, node_id: 'ghost', payload: {} }), /unknown node ghost/);
  await assert.rejects(() => call('team_next', { run_id: 'no-such-run', cwd }), /unknown run no-such-run/);
}));

test('team_run on a self-routed node is refused: it belongs to team_submit', () => scratch(async (cwd) => {
  const { run_id } = await call('team_open', { request: 'r', cwd, vendor: 'self', flow: 'develop' });
  await assert.rejects(() => call('team_run', { run_id, cwd, node_id: 'plan' }), /node plan is routed to self - use team_submit/);
}));

test('team_run executes the node with its routed vendor and returns a one-line verdict; the payload stays on disk', () => scratch(async (cwd) => {
  registerFake(cwd);
  const { run_id, ready } = await call('team_open', { request: 'r', cwd, vendor: 'fake', flow: 'develop' });
  assert.deepEqual([ready[0].vendor, ready[0].next], ['fake', 'call team_run']);
  const v = await call('team_run', { run_id, cwd, node_id: 'plan' });
  assert.deepEqual([v.node_id, v.state, v.stage_ok, v.vendor], ['plan', 'done', true, 'fake']);
  assert.ok(existsSync(v.detail_path), 'the full result is read from detail_path, not carried in the reply');
  assert.equal(JSON.parse(readFileSync(v.detail_path, 'utf8')).result.flow, 'develop');
  assert.equal(getNode(loadRun(cwd, run_id), 'plan').state, 'done');
  const next = await call('team_next', { run_id, cwd });
  assert.equal(next.ready[0].node_id, 'setgoal', 'plan done opens setgoal');
}));

test('team_run: a client cancel reaches the vendor child through ctx.registerChild and the node fails killed_for: cancelled', () => scratch(async (cwd) => {
  registerFake(cwd, { hang: true });
  const { run_id } = await call('team_open', { request: 'r', cwd, vendor: 'fake', flow: 'develop' });
  let child = null;
  const running = call('team_run', { run_id, cwd, node_id: 'plan' }, { registerChild: (c) => { child = c; } });
  const deadline = Date.now() + 15000;
  while (!child && Date.now() < deadline) await new Promise((r) => setTimeout(r, 25));
  assert.ok(child, 'team_run registered its vendor child');
  assert.equal(typeof child.kill, 'function');
  child.kill();
  const v = await running;
  assert.equal(v.state, 'failed');
  assert.equal(v.killed_for, 'cancelled');
  assert.match(v.reason, /cancelled by the client/);
}));

test('team_run works without a ctx at all (the facade default)', () => scratch(async (cwd) => {
  registerFake(cwd);
  const { run_id } = await call('team_open', { request: 'r', cwd, vendor: 'fake', flow: 'develop' });
  assert.equal((await call('team_run', { run_id, cwd, node_id: 'plan' })).state, 'done');
}));

test('team_retry: a node that is not an interrupted pending one is refused; reset_capacity alone clears exclusions and re-offers work', () => scratch(async (cwd) => {
  const { run_id } = await call('team_open', { request: 'r', cwd, vendor: 'self', flow: 'develop' });
  await assert.rejects(() => call('team_retry', { run_id, cwd, node_id: 'plan' }), /node_id must identify a currently interrupted pending node/);
  await assert.rejects(() => call('team_retry', { run_id, cwd, avoid_executors: 'claude' }), /avoid_executors must be an array/);

  const run = loadRun(cwd, run_id);
  run.unavailable_vendors = { claude: 'spent' };
  saveRun(run);
  const out = await call('team_retry', { run_id, cwd, reset_capacity: true });
  assert.deepEqual([out.target, out.retried], ['capacity', true]);
  assert.equal(out.ready[0].node_id, 'plan');
  const after = loadRun(cwd, run_id);
  assert.deepEqual(after.unavailable_vendors, {});
  assert.equal(after.capacity_epoch, 1);
}));

test('team_retry with no subgoal_id targets the spec and replies with run_id, target and retried', () => scratch(async (cwd) => {
  const { run_id } = await call('team_open', { request: 'r', cwd, vendor: 'self', flow: 'develop', max_retries: 0 });
  const out = await call('team_retry', { run_id, cwd });
  assert.equal(out.target, 'spec');
  assert.equal(out.run_id, run_id);
  assert.equal(typeof out.retried, 'boolean');
}));

test('team_retry repair refuses when no goal-gate round exists', () => scratch(async (cwd) => {
  const { run_id } = await call('team_open', { request: 'r', cwd, vendor: 'self', flow: 'develop' });
  await assert.rejects(() => call('team_retry', { run_id, cwd, repair: true }), /no goal-gate round exists yet to repair/);
}));
