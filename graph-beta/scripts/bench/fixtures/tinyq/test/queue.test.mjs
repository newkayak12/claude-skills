import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BoundedQueue } from '../src/queue.mjs';

test('push returns false when full', () => {
  const q = new BoundedQueue(2);
  assert.equal(q.push(1), true);
  assert.equal(q.push(2), true);
  assert.equal(q.push(3), false);
  assert.equal(q.size(), 2);
});

test('shift is FIFO', () => {
  const q = new BoundedQueue(3);
  q.push('a'); q.push('b');
  assert.equal(q.shift(), 'a');
  assert.equal(q.shift(), 'b');
  assert.equal(q.shift(), undefined);
});

test('drain empties the queue and returns count', () => {
  const q = new BoundedQueue(3);
  q.push(1); q.push(2); q.push(3);
  const seen = [];
  assert.equal(q.drain((x) => seen.push(x)), 3);
  assert.deepEqual(seen, [1, 2, 3]);
  assert.equal(q.isEmpty(), true);
});

test('rejects invalid capacity', () => {
  assert.throws(() => new BoundedQueue(0), RangeError);
});
