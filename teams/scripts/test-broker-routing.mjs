#!/usr/bin/env node
// broker-routing.mjs: run lookup (mustFindRun, knownCwds, reclaimAbandoned, the human hand-off
// drain) and route(), against real runs in scratch directories and a fake vendor adapter.
// (test-routing.mjs covers routing.mjs, the ranking library; this file covers the broker's use of it.)
//
//   node --test teams/scripts/test-broker-routing.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRun, expandSubgoals, getNode, loadRun, normalizeSpec, queueHumanAction, saveRun } from '../mcp/graph.mjs';
import {
  activeNodes,
  ingestHandoff,
  knownCwds,
  mustFindRun,
  reclaimAbandoned,
  resolveNativeModel,
  route,
} from '../mcp/broker-routing.mjs';
import { brokerDir } from '../mcp/broker-vendors.mjs';

async function scratch(fn) {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'broker-routing-')));
  const saved = process.env.BROKER_VENDORS;
  delete process.env.BROKER_VENDORS;
  try { return await fn(cwd); } finally {
    if (saved === undefined) delete process.env.BROKER_VENDORS; else process.env.BROKER_VENDORS = saved;
    rmSync(cwd, { recursive: true, force: true });
  }
}

// A registry file with one vendor, `fake`, whose adapter answers --detect with `report`.
function registerFake(cwd, report, extra = {}) {
  const script = join(cwd, 'fake-adapter.cjs');
  writeFileSync(script, `
const a = process.argv; const out = a[a.indexOf('--output') + 1];
require('node:fs').writeFileSync(out, JSON.stringify(${JSON.stringify(report)}));
`);
  const file = join(cwd, 'vendors.json');
  writeFileSync(file, JSON.stringify({ fake: { command: process.execPath, args: [script], sandboxes: ['read-only', 'workspace-write'], default_sandbox: 'workspace-write', ...extra } }));
  process.env.BROKER_VENDORS = file;
}

function packageRun(cwd, opts = {}) {
  const run = createRun({ cwd, request: 'r', flow: 'develop', vendor: 'self', ...opts });
  for (const id of ['plan', 'setgoal', 'critique']) { getNode(run, id).state = 'done'; getNode(run, id).result = { stage_ok: true }; }
  run.spec = normalizeSpec(run, { goal: 'g', acceptance: ['own'], subgoals: [{ id: 'U1', title: 't', acceptance: ['a'], deps: [] }] });
  expandSubgoals(run, run.spec.subgoals);
  return run;
}

// ---------- resolveNativeModel ----------

test('resolveNativeModel: no declared list or no model asked for passes the model through', () => {
  assert.deepEqual(resolveNativeModel({}, 'sonnet'), { model: 'sonnet', fallback: false });
  assert.deepEqual(resolveNativeModel({ native_models: ['a'] }, null), { model: null, fallback: false });
});

test('resolveNativeModel: the same string, the host model, or a declared id of the same tier', () => {
  const run = { native_models: ['claude-sonnet-5', 'claude-opus-5'], host_model: 'claude-opus-5' };
  assert.deepEqual(resolveNativeModel(run, 'claude-sonnet-5'), { model: 'claude-sonnet-5', fallback: false });
  assert.deepEqual(resolveNativeModel(run, 'claude-opus-5'), { model: 'claude-opus-5', fallback: false });
  assert.deepEqual(resolveNativeModel(run, 'sonnet'), { model: 'claude-sonnet-5', fallback: false });
  assert.deepEqual(resolveNativeModel(run, 'OPUS'), { model: 'claude-opus-5', fallback: false });
});

test('resolveNativeModel: an undeclared tier falls back to the host model, marked; with no host model it is null', () => {
  assert.deepEqual(resolveNativeModel({ native_models: ['claude-opus-5'], host_model: 'claude-opus-5' }, 'haiku'), { model: 'claude-opus-5', fallback: true });
  assert.equal(resolveNativeModel({ native_models: ['claude-opus-5'] }, 'haiku'), null);
});

// ---------- reclaimAbandoned ----------

test('reclaimAbandoned fails a running node nobody in this process is running, saves, and ledgers it', () => scratch((cwd) => {
  const run = packageRun(cwd);
  const stale = getNode(run, 'implement:U1:1');
  stale.state = 'running';
  stale.started_at = 1;
  assert.equal(reclaimAbandoned(run), 1);
  assert.equal(stale.state, 'failed');
  assert.match(stale.result.reason, /^abandoned: the broker executing this node exited/);
  assert.equal(getNode(loadRun(cwd, run.run_id), 'implement:U1:1').state, 'failed', 'saved');
  assert.match(readFileSync(join(brokerDir(cwd), 'ledger.jsonl'), 'utf8'), /"event":"node_reclaimed".*"count":1/);
  assert.equal(reclaimAbandoned(run), 0, 'nothing left to reclaim');
}));

test('reclaimAbandoned leaves a node that is fresh, or active in this process, alone', () => scratch((cwd) => {
  const run = packageRun(cwd);
  const fresh = getNode(run, 'implement:U1:1');
  fresh.state = 'running';
  fresh.started_at = Date.now();
  const mine = getNode(run, 'test:U1:1');
  mine.state = 'running';
  mine.started_at = 1;
  activeNodes.add(`${run.run_id}:${mine.node_id}`);
  try {
    assert.equal(reclaimAbandoned(run), 0);
    assert.equal(fresh.state, 'running');
    assert.equal(mine.state, 'running');
  } finally {
    activeNodes.delete(`${run.run_id}:${mine.node_id}`);
  }
}));

// ---------- mustFindRun / knownCwds / ingestHandoff ----------

test('mustFindRun finds a run by cwd, remembers the cwd, and later finds it without one', () => scratch((cwd) => {
  const run = packageRun(cwd);
  saveRun(run);
  const found = mustFindRun({ run_id: run.run_id, cwd });
  assert.equal(found.run_id, run.run_id);
  assert.ok(knownCwds.has(cwd));
  assert.equal(mustFindRun({ run_id: run.run_id }).cwd, cwd, 'knownCwds is what lets a caller omit cwd');
}));

test('mustFindRun refuses an unknown run and says how to recover', () => scratch((cwd) => {
  assert.throws(() => mustFindRun({ run_id: 'no-such-run', cwd }), /unknown run no-such-run - pass cwd, or call team_open first/);
}));

test('ingestHandoff applies a queued human submission to a waiting_human node, exactly once', () => scratch((cwd) => {
  const run = packageRun(cwd);
  const n = getNode(run, 'implement:U1:1');
  n.state = 'waiting_human';
  saveRun(run);
  queueHumanAction(cwd, run.run_id, { kind: 'submit', node_id: n.node_id, payload: { stage_ok: true, changed_files: [] }, answered_at: 12345 });
  const found = mustFindRun({ run_id: run.run_id, cwd });
  const done = getNode(found, 'implement:U1:1');
  assert.equal(done.state, 'done');
  assert.equal(done.vendor, 'human');
  assert.equal(done.answered_at, 12345);
  assert.equal(getNode(loadRun(cwd, run.run_id), 'implement:U1:1').state, 'done', 'persisted');
  const again = mustFindRun({ run_id: run.run_id, cwd });
  assert.equal(getNode(again, 'implement:U1:1').vendor, 'human', 'the queue was drained, not replayed');
}));

test('ingestHandoff skips a submission whose node is no longer waiting', () => scratch((cwd) => {
  const run = packageRun(cwd);
  saveRun(run);
  queueHumanAction(cwd, run.run_id, { kind: 'submit', node_id: 'implement:U1:1', payload: { stage_ok: true } });
  const loaded = loadRun(cwd, run.run_id);
  ingestHandoff(loaded);
  assert.equal(getNode(loaded, 'implement:U1:1').state, 'pending');
}));

// ---------- route ----------

const plan = (run) => getNode(run, 'plan');
const implement = (run) => getNode(run, 'implement:U1:1');

test('route: a node already assigned keeps its assignment, unless that executor has become unavailable', () => scratch(async (cwd) => {
  const run = packageRun(cwd);
  const n = implement(run);
  n.assignment = { vendor: 'self', executor: 'claude', model: 'm' };
  assert.equal(await route(run, n), n.assignment);
  run.unavailable_vendors = { claude: 'spent' };
  const re = await route(run, n);
  assert.notEqual(re, n.assignment, 'an excluded executor is re-ranked');
  assert.equal(re.vendor, 'self', 'run.vendor is self, so it degrades to the orchestrator');
}));

test('route: vendor self (or off/none) is routed to self with no sandbox', () => scratch(async (cwd) => {
  for (const vendor of ['self', 'off', 'none']) {
    const run = packageRun(cwd, { vendor });
    const r = await route(run, implement(run));
    assert.equal(r.vendor, 'self', vendor);
    assert.equal(r.sandbox, null);
    assert.deepEqual(r.attempts, []);
  }
}));

test('route: a named vendor that is not registered is a vendor-failure naming it, never a silent degrade', () => scratch(async (cwd) => {
  const run = packageRun(cwd, { vendor: 'nope' });
  const r = await route(run, implement(run));
  assert.equal(r.vendor, 'vendor-failure');
  assert.deepEqual(r.attempts, [{ vendor: 'nope', ready: false, reason: 'unknown vendor "nope"' }]);
}));

test('route: a named vendor whose probe is ready is chosen, with its sandbox (reasoning nodes read-only, writers workspace-write)', () => scratch(async (cwd) => {
  registerFake(cwd, { ok: true, ready: true, reachable: true });
  const run = packageRun(cwd, { vendor: 'fake', model: 'm1' });
  const w = await route(run, implement(run));
  assert.deepEqual([w.vendor, w.executor, w.sandbox, w.model], ['fake', 'fake', 'workspace-write', 'm1']);
  assert.equal(w.attempts[0].ready, true);
  const reasoning = await route(run, plan(run));
  assert.equal(reasoning.sandbox, 'read-only');
}));

test('route: a vendor that is reachable but not writable serves a reasoning node and fails a writing one', () => scratch(async (cwd) => {
  registerFake(cwd, { ok: false, ready: false, reachable: true, reason: 'read-only host' });
  const run = packageRun(cwd, { vendor: 'fake' });
  assert.equal((await route(run, plan(run))).vendor, 'fake');
  const w = await route(run, implement(run));
  assert.equal(w.vendor, 'vendor-failure');
  assert.equal(w.attempts[0].reason, 'read-only host');
}));

test('route: a vendor out of credit is recorded on the run and skipped from then on', () => scratch(async (cwd) => {
  registerFake(cwd, { ok: false, ready: false, failure_kind: 'quota', last_message: 'You have hit your usage limit' });
  const run = packageRun(cwd, { vendor: 'fake' });
  const first = await route(run, implement(run));
  assert.equal(first.vendor, 'vendor-failure');
  assert.match(run.unavailable_vendors.fake, /^usage capacity exhausted at probe/);
  assert.match(loadRun(cwd, run.run_id).unavailable_vendors.fake, /^usage capacity exhausted/, 'saved');
  const second = await route(run, implement(run));
  assert.match(second.attempts[0].reason, /^usage capacity exhausted/, 'not re-probed');
}));

test('route: a codex host never runs nested codex; the reason says to use native agents', () => scratch(async (cwd) => {
  const run = packageRun(cwd, { vendor: 'codex', host_vendor: 'codex' });
  const r = await route(run, implement(run));
  assert.equal(r.vendor, 'vendor-failure');
  assert.equal(r.attempts[0].reason, 'Codex hosts must use native agents; nested Codex CLI is disabled');
}));

test('route: balanced allocation on the host vendor returns self with the executor identity and a resolved native model', () => scratch(async (cwd) => {
  const run = packageRun(cwd, { vendor: 'auto', allocation: 'balanced', host_vendor: 'claude', host_model: 'claude-opus-5', native_models: ['claude-opus-5', 'claude-sonnet-5'], candidates: ['claude'] });
  const r = await route(run, implement(run));
  assert.equal(r.vendor, 'self');
  assert.equal(r.executor, 'claude');
  assert.equal(r.sandbox, null);
  assert.ok(['claude-opus-5', 'claude-sonnet-5'].includes(r.model), `native model, got ${r.model}`);
}));

test('route: an explicit vendor order skips a human entry in the candidate list', () => scratch(async (cwd) => {
  registerFake(cwd, { ok: true, ready: true, reachable: true });
  const run = packageRun(cwd, { vendor: 'auto', candidates: ['human', 'fake'] });
  const r = await route(run, implement(run));
  assert.equal(r.vendor, 'fake');
  assert.deepEqual(r.attempts.map((a) => a.vendor), ['fake'], 'human never enters the pool');
}));
