#!/usr/bin/env node
// failure-events.mjs: the failed / reshaped / blocked events the graph mod toasts, with the
// reason and next step the mod renders. Fixtures use graph's own createRun, retrySpec and
// settleFailure, so the shapes are the ones the engine writes.
//
//   node --test graph/scripts/test-failure-events.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRun, expandSubgoals, retrySpec, settleFailure } from '../mcp/graph.mjs';
import { failureEvents } from './failure-events.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'failure-events.mjs');
const SPEC = { goal: 'g', acceptance: ['a'], subgoals: [{ id: 'U1', title: 'one', acceptance: ['a'] }] };

function freshRun(over = {}) {
  const cwd = mkdtempSync(join(tmpdir(), 'failure-events-'));
  const run = createRun({ cwd, request: 'r', max_retries: 2, ...over });
  return { run, cwd, done: () => rmSync(cwd, { recursive: true, force: true }) };
}
const byId = (run, id) => run.nodes.find((n) => n.node_id === id);
const fail = (run, id, reason, extra = {}) => {
  const n = byId(run, id);
  n.state = 'failed';
  n.result = reason === undefined ? null : { stage_ok: false, reason };
  Object.assign(n, extra);
  return n;
};
// the report is order-only behind the settled gate and runs on, which ends the run `complete`:
// a run is blocked (the state a gave up is reported in) only once nothing is left to run
const stall = (run) => {
  byId(run, 'report').state = 'unreachable';
};
const only = (events) => {
  assert.equal(events.length, 1, JSON.stringify(events));
  return events[0];
};

// plan, setgoal and critique done, U1 expanded: implement:U1:1 is the node under test
function withSubgoal() {
  const f = freshRun();
  for (const id of ['plan', 'setgoal', 'critique']) byId(f.run, id).state = 'done';
  expandSubgoals(f.run, SPEC.subgoals);
  byId(f.run, 'implement:U1:1').state = 'done';
  return f;
}

test('a failed non-final node is a retry: next step retry (attempt+1)/(max_retries+1), severity info', () => {
  const f = withSubgoal();
  fail(f.run, 'test:U1:1', 'tests red');
  const e = only(failureEvents(f.run));
  assert.deepEqual(e, {
    key: `${f.run.run_id}:test:U1:1:rejected:1`,
    kind: 'rejected',
    node: 'test:U1:1',
    attempt: 1,
    what: 'test:U1:1',
    reason: 'tests red',
    next_step: 'retry 2/3',
    severity: 'info',
  });
  f.done();
});

test('the retry fraction follows the attempt: attempt 2 of max_retries 2 reads retry 3/3', () => {
  const f = withSubgoal();
  fail(f.run, 'test:U1:1', 'x', { attempt: 2 });
  assert.equal(only(failureEvents(f.run)).next_step, 'retry 3/3');
  f.done();
});

test('no retry left (attempt+1 over max_retries+1) and not yet settled: no next step', () => {
  const f = withSubgoal();
  fail(f.run, 'test:U1:1', 'x', { attempt: 3 });
  const e = only(failureEvents(f.run));
  assert.equal(e.next_step, null);
  assert.equal(e.severity, 'info');
  f.done();
});

test('max_retries missing from the run: engine default of 2 gives the same denominator', () => {
  const f = withSubgoal();
  fail(f.run, 'test:U1:1', 'x');
  delete f.run.max_retries;
  assert.equal(only(failureEvents(f.run)).next_step, 'retry 2/3');
  f.done();
});

test('spec retry: a critique reshaped by the real retrySpec reads retrying as setgoal:N, severity info', () => {
  const f = freshRun();
  byId(f.run, 'plan').state = 'done';
  byId(f.run, 'setgoal').state = 'done';
  fail(f.run, 'critique', 'spec misses the error path');
  const { run } = retrySpec(f.run, 'fix the spec');
  assert.equal(byId(run, 'critique').state, 'skipped'); // the engine records no spec-retry field, only this shape
  const e = only(failureEvents(run));
  assert.deepEqual(e, {
    key: `${run.run_id}:critique:reshaped:1`,
    kind: 'reshaped',
    node: 'critique',
    attempt: 1,
    what: 'critique',
    reason: 'spec misses the error path',
    next_step: 'retrying as setgoal:2',
    severity: 'info',
  });
  f.done();
});

test('a second spec retry: critique:2 names setgoal:3, the first reshape is still reported', () => {
  const f = freshRun();
  byId(f.run, 'plan').state = 'done';
  byId(f.run, 'setgoal').state = 'done';
  fail(f.run, 'critique', 'first');
  retrySpec(f.run, 'fb');
  byId(f.run, 'setgoal:2').state = 'done';
  fail(f.run, 'critique:2', 'second');
  const { run } = retrySpec(f.run, 'fb2');
  assert.deepEqual(failureEvents(run).map((e) => [e.node, e.next_step, e.reason]), [
    ['critique', 'retrying as setgoal:2', 'first'],
    ['critique:2', 'retrying as setgoal:3', 'second'],
  ]);
  f.done();
});

test('a critique retired unrun by a spec retry (superseded) is not a failure event', () => {
  const f = freshRun();
  byId(f.run, 'plan').state = 'done';
  fail(f.run, 'setgoal', 'bad json');
  const { run } = retrySpec(f.run, 'fb');
  assert.equal(byId(run, 'critique').result.reason, 'superseded by spec attempt 2');
  assert.deepEqual(failureEvents(run), []);
  f.done();
});

test('a failed critique before its reshape: reported with no next step (the reshape follows as its own event)', () => {
  const f = freshRun();
  byId(f.run, 'plan').state = 'done';
  byId(f.run, 'setgoal').state = 'done';
  fail(f.run, 'critique', 'weak');
  const e = only(failureEvents(f.run));
  assert.equal(e.kind, 'rejected');
  assert.equal(e.next_step, null);
  assert.equal(e.severity, 'info');
  f.done();
});

test('a final failed node in a blocked run is gave up, severity failure', () => {
  const f = withSubgoal();
  const n = fail(f.run, 'implement:U1:1', 'compiler crashed');
  settleFailure(f.run, n);
  assert.equal(n.final, true);
  stall(f.run);
  const e = only(failureEvents(f.run));
  assert.deepEqual(e, {
    key: `${f.run.run_id}:implement:U1:1:failed:1`,
    kind: 'failed',
    node: 'implement:U1:1',
    attempt: 1,
    what: 'implement:U1:1',
    reason: 'compiler crashed',
    next_step: 'gave up',
    severity: 'failure',
  });
  f.done();
});

test('graph_settle: the root and a downstream node it settled are one gave up, on the first spent node', () => {
  const f = withSubgoal();
  fail(f.run, 'gate:U1:1', 'downstream rejected');
  const root = fail(f.run, 'implement:U1:1', 'root cause');
  const touched = settleFailure(f.run, root);
  assert.ok(touched.includes('gate:U1:1'));
  assert.equal(byId(f.run, 'gate:U1:1').final, true);
  stall(f.run);
  const gaveUp = failureEvents(f.run).filter((e) => e.next_step === 'gave up');
  assert.equal(gaveUp.length, 1);
  assert.equal(gaveUp[0].severity, 'failure');
  f.done();
});

test('routing_blocked with no failed node: blocked, gave up, on the first node', () => {
  const f = freshRun();
  f.run.routing_blocked = true;
  const e = only(failureEvents(f.run));
  assert.equal(e.kind, 'blocked');
  assert.equal(e.node, 'plan');
  assert.equal(e.next_step, 'gave up');
  assert.equal(e.severity, 'failure');
  assert.equal(e.reason, 'no reason recorded');
  f.done();
});

test('a finished run and a clean run produce no failure events', () => {
  const f = freshRun();
  assert.deepEqual(failureEvents(f.run), []);
  for (const n of f.run.nodes) n.state = 'done';
  f.run.nodes.push({ node_id: 'report', stage: 'report', deps: [], after: [], state: 'done', attempt: 1 });
  assert.deepEqual(failureEvents(f.run), []);
  f.done();
});

const reasonOf = (reason) => {
  const f = withSubgoal();
  fail(f.run, 'test:U1:1', reason);
  const out = only(failureEvents(f.run)).reason;
  f.done();
  return out;
};

test('reason: a multi-line reason with whitespace runs is one line, one space between words', () => {
  assert.equal(reasonOf('line one\n\nline  two\t\tthree\r\n'), 'line one line two three');
});

test('reason: 121 chars are cut to 119 + the ellipsis (120 in all)', () => {
  const out = reasonOf('a'.repeat(121));
  assert.equal(out.length, 120);
  assert.equal(out, `${'a'.repeat(119)}…`);
});

test('reason: exactly 120 chars is unchanged', () => {
  assert.equal(reasonOf('b'.repeat(120)), 'b'.repeat(120));
});

test('reason: a missing result, an empty reason and a blank reason are no reason recorded', () => {
  assert.equal(reasonOf(undefined), 'no reason recorded');
  assert.equal(reasonOf(''), 'no reason recorded');
  assert.equal(reasonOf(' \n\t '), 'no reason recorded');
});

function cli(arg) {
  const r = spawnSync('node', arg === undefined ? [SCRIPT] : [SCRIPT, arg], { encoding: 'utf8' });
  return { code: r.status, out: r.stdout.trim() };
}

test('CLI: a run file prints the events as a JSON array', () => {
  const f = withSubgoal();
  fail(f.run, 'test:U1:1', 'tests red');
  const file = join(f.cwd, 'run.json');
  writeFileSync(file, JSON.stringify(f.run));
  const r = cli(file);
  assert.equal(r.code, 0);
  const events = JSON.parse(r.out);
  assert.deepEqual(Object.keys(events[0]), ['key', 'kind', 'node', 'attempt', 'what', 'reason', 'next_step', 'severity']);
  assert.equal(events[0].next_step, 'retry 2/3');
  f.done();
});

test('CLI: a missing file, invalid JSON, a run without nodes and no argument all print [] and exit 0', () => {
  const dir = mkdtempSync(join(tmpdir(), 'failure-events-cli-'));
  const bad = join(dir, 'bad.json');
  const noNodes = join(dir, 'nonodes.json');
  writeFileSync(bad, '{"run_id": "x", "nodes": [');
  writeFileSync(noNodes, '{"run_id": "x"}');
  for (const arg of ['/nonexistent.json', bad, noNodes, undefined]) {
    const r = cli(arg);
    assert.deepEqual([r.code, r.out], [0, '[]'], String(arg));
  }
  rmSync(dir, { recursive: true, force: true });
});
