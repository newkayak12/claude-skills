// asksFor(): the questions waiting on one session, from floorTasks-style rows. Pure, no fs: the
// rows are hand-built models with one card parked on a person.
//
//   node --test teams/scripts/test-view-asks.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { asksFor } from './lib/view-asks.mjs';

const card = (id, question, since, title = `story ${id}`) => ({
  id, title, ticket_key: `E-aaaaaaaa/${id}`,
  dispatch: { state: 'waiting_human', waiting_since: since, questions: question == null ? [] : [question] },
});
const row = (cards, { opener = { session_id: 's-1', entrypoint: 'cli' }, live = true, task_id = 'aaaaaaaa-0001', ...extra } = {}) =>
  ({ live, m: { task_id, opener, ticket: { key: 'E-aaaaaaaa' }, packages: cards, ...extra } });

test('addressed: one notice with who, question, since', () => {
  const out = asksFor([row([card('P2', 'Keep the legacy PDF route?', 1000)])], 's-1');
  assert.deepEqual(out, [{ task_id: 'aaaaaaaa-0001', key: 'E-aaaaaaaa/P2', who: 'P2', question: 'Keep the legacy PDF route?', since: 1000, via: 'poll' }]);
});

test('other session id -> []', () => {
  assert.deepEqual(asksFor([row([card('P2', 'q', 1)])], 's-2'), []);
});

test('opener null or absent -> [] and nothing throws', () => {
  assert.deepEqual(asksFor([row([card('P2', 'q', 1)], { opener: null })], 's-1'), []);
  const r = row([card('P2', 'q', 1)]);
  delete r.m.opener;
  assert.deepEqual(asksFor([r], 's-1'), []);
});

test('opener entrypoint sdk-cli is still matched by id (no entrypoint filter)', () => {
  const out = asksFor([row([card('P2', 'q', 1)], { opener: { session_id: 's-1', entrypoint: 'sdk-cli' } })], 's-1');
  assert.equal(out.length, 1);
});

test('empty sessionId -> []', () => {
  assert.deepEqual(asksFor([row([card('P2', 'q', 1)], { opener: { session_id: '', entrypoint: 'cli' } })], ''), []);
  assert.deepEqual(asksFor([row([card('P2', 'q', 1)])], undefined), []);
});

test('a task that is not live is skipped', () => {
  assert.deepEqual(asksFor([row([card('P2', 'q', 1)], { live: false })], 's-1'), []);
});

test('no question -> the card title', () => {
  assert.equal(asksFor([row([card('P2', null, 1, 'Pick a route')])], 's-1')[0].question, 'Pick a route');
});

test('question over 120 chars is clipped to 120 ending in an ellipsis', () => {
  const q = asksFor([row([card('P2', 'x'.repeat(200), 1)])], 's-1')[0].question;
  assert.equal(q.length, 120);
  assert.ok(q.endsWith('…'));
  assert.equal(asksFor([row([card('P2', 'y'.repeat(120), 1)])], 's-1')[0].question, 'y'.repeat(120));
});

test('two asks come newest first, across tasks', () => {
  const out = asksFor([row([card('P1', 'old', 1000)]), row([card('P2', 'new', 5000)], { task_id: 'bbbbbbbb-0002' })], 's-1');
  assert.deepEqual(out.map((a) => a.question), ['new', 'old']);
});

test('EPIC-level ask: who is the EPIC key', () => {
  const r = row([], { manager_stages: [{ node_id: 'shape', state: 'waiting_human', waiting_since: 7, questions: ['Which flow?'] }] });
  const out = asksFor([r], 's-1');
  assert.equal(out.length, 1);
  assert.equal(out[0].who, 'E-aaaaaaaa');
  assert.equal(out[0].key, 'E-aaaaaaaa');
  assert.equal(out[0].since, 7);
});

test('via is send when received holds {key, session}, else poll', () => {
  const rows = [row([card('P2', 'q', 1)])];
  assert.equal(asksFor(rows, 's-1', [{ key: 'E-aaaaaaaa/P2', session: 's-1' }])[0].via, 'send');
  assert.equal(asksFor(rows, 's-1', [{ key: 'E-aaaaaaaa/P2', session: 's-9' }])[0].via, 'poll');
  assert.equal(asksFor(rows, 's-1', [{ key: 'E-aaaaaaaa/P3', session: 's-1' }])[0].via, 'poll');
});
