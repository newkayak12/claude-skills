// Pure helpers behind `view.mjs --once --format status|events` (the teams-live mod).
//
//   node --test teams/scripts/test-view-events.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { notableEvents, statusLine } from './lib/view-events.mjs';

const L = (o) => JSON.stringify(o);
const ID = 'E-1a2b3c4d5e6f';

test('node_finish: only the failed one is notable', () => {
  const out = notableEvents([
    L({ ts: 10, event: 'node_finish', task_id: ID, node_id: 'n1', state: 'failed' }),
    L({ ts: 11, event: 'node_finish', task_id: ID, node_id: 'n2', state: 'done' }),
  ], 0);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0], { ts: 10, task_id: ID, kind: 'node_finish', text: 'E-1a2b3c4d n1 failed' });
});

test('the other five events produce the table texts', () => {
  const t = (e) => notableEvents([L({ ts: 5, task_id: ID, ...e })], 0).map((x) => x.text);
  assert.deepEqual(t({ event: 'waiting_human', node_id: 'n3' }), ['E-1a2b3c4d needs you: n3']);
  assert.deepEqual(t({ event: 'child_driver_capacity' }), ['E-1a2b3c4d paused: provider limit']);
  assert.deepEqual(t({ event: 'daemon_done', state: 'done' }), ['E-1a2b3c4d finished: done']);
  assert.deepEqual(t({ event: 'daemon_exhausted' }), ['E-1a2b3c4d stopped: daemon restarts used up']);
  assert.deepEqual(t({ event: 'upstream_fix_rounds_exhausted', package_id: '3' }), ['E-1a2b3c4d 3: fix rounds used up']);
  assert.deepEqual(t({ event: 'node_start' }), []);
});

test('events at or before sinceTs are dropped', () => {
  const out = notableEvents([
    L({ ts: 10, event: 'daemon_exhausted', task_id: ID }),
    L({ ts: 11, event: 'daemon_exhausted', task_id: ID }),
  ], 10);
  assert.deepEqual(out.map((e) => e.ts), [11]);
});

test('a torn last line is ignored', () => {
  const out = notableEvents([
    L({ ts: 10, event: 'daemon_exhausted', task_id: ID }),
    '{"ts":12,"event":"daemon_exhausted","task_id":"E-1a2b3c4d5e6f"',
  ], 0);
  assert.deepEqual(out.map((e) => e.ts), [10]);
});

test('statusLine: empty and two tasks', () => {
  assert.equal(statusLine([]), '');
  assert.equal(statusLine([
    { id: 'E-1a2b3c4d', state: 'running', done: 7, total: 12, current: 'P3 implement' },
    { id: 'E-5e6f7a8b', state: 'running', done: 2, total: 9, current: 'shape' },
  ]), 'teams: E-1a2b3c4d 7/12 P3 implement · E-5e6f7a8b 2/9 shape');
});
