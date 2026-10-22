// askMessage / parseAskMessage / asksToSend: the message an ask travels in and node's decision of
// who may send it. Pure, no fs.
//
//   node --test teams/scripts/test-ask-message.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { askMessage, parseAskMessage, asksToSend } from './lib/ask-message.mjs';

const n = { task_id: 'aaaaaaaa-0001', key: 'E-aaaaaaaa/P2', who: 'P2', question: 'Keep the legacy PDF route?', since: 1000, via: 'send' };

test('round trip is deepEqual, text is readable first and starts with the prefix', () => {
  const t = askMessage(n);
  assert.ok(t.startsWith('[teams ask] '));
  assert.match(t.split('\n')[0], /^\[teams ask\] P2 asks you: Keep the legacy PDF route\? — answer with tm_submit E-aaaaaaaa\/P2$/);
  assert.deepEqual(parseAskMessage(t), n);
});

test('a question with a newline and quotes still round-trips', () => {
  const m = { ...n, question: 'a "b"\nc' };
  assert.deepEqual(parseAskMessage(askMessage(m)), m);
});

test('non-teams text -> null', () => {
  assert.equal(parseAskMessage('hello from a peer'), null);
  assert.equal(parseAskMessage(''), null);
  assert.equal(parseAskMessage(undefined), null);
});

test('malformed JSON trailer -> null; missing key -> null; no trailer -> null', () => {
  assert.equal(parseAskMessage('[teams ask] P2 asks you: q\n{not json'), null);
  assert.equal(parseAskMessage('[teams ask] P2 asks you: q\n{"who":"P2"}'), null);
  assert.equal(parseAskMessage('[teams ask] P2 asks you: q'), null);
});

const sessions = [{ pid: 4242, sessionId: 's-1', kind: 'interactive' }];
const base = { opener: 's-1', self: 'drv', asks: [n], sessions, sent: [], alive: () => true };

test('send case: exactly the unsent asks', () => {
  const b = { ...n, key: 'E-aaaaaaaa/P3' };
  assert.deepEqual(asksToSend({ ...base, asks: [n, b] }), [n, b]);
  assert.deepEqual(asksToSend({ ...base, asks: [n, b], sent: [{ key: n.key, since: n.since }] }), [b]);
});

test('opener session_id null -> []', () => {
  assert.deepEqual(asksToSend({ ...base, opener: null }), []);
  assert.deepEqual(asksToSend({ ...base, opener: { session_id: null, entrypoint: null } }), []);
});

test('no session file for the opener -> []', () => {
  assert.deepEqual(asksToSend({ ...base, sessions: [{ pid: 1, sessionId: 'other', kind: 'interactive' }] }), []);
});

test('session kind not interactive -> []', () => {
  assert.deepEqual(asksToSend({ ...base, sessions: [{ pid: 4242, sessionId: 's-1', kind: 'headless' }] }), []);
});

test('pid not alive -> []', () => {
  assert.deepEqual(asksToSend({ ...base, alive: (pid) => pid !== 4242 }), []);
});

test('opener === self -> []', () => {
  assert.deepEqual(asksToSend({ ...base, self: 's-1' }), []);
});

test('already sent -> []', () => {
  assert.deepEqual(asksToSend({ ...base, sent: [{ key: n.key, since: n.since }] }), []);
});

test('a re-ask under the same key after an answer (new since) is sent again', () => {
  assert.deepEqual(asksToSend({ ...base, sent: [{ key: n.key, since: 500 }] }), [n]);
});
