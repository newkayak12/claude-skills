import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BoundedQueue } from '../src/queue.mjs';
import { Worker } from '../src/worker.mjs';

const settle = (ms) => new Promise((r) => setTimeout(r, ms));

test('processes all queued jobs', async () => {
  const q = new BoundedQueue(10);
  for (let i = 0; i < 5; i += 1) q.push(i);
  const seen = [];
  const w = new Worker(q, async (job) => { seen.push(job); }, { concurrency: 2 });
  w.start();
  await settle(50);
  await w.stop();
  assert.equal(seen.length, 5);
  assert.equal(w.stats().processed, 5);
  assert.equal(w.stats().inflight, 0);
});

test('counts failures after retries are exhausted', async () => {
  const q = new BoundedQueue(2);
  q.push('bad');
  const w = new Worker(q, async () => { throw new Error('nope'); }, { retry: { attempts: 2, baseMs: 1 } });
  w.start();
  await settle(50);
  await w.stop();
  assert.deepEqual(w.stats(), { processed: 0, failed: 1, inflight: 0 });
});

test('rejects invalid options', () => {
  const q = new BoundedQueue(1);
  assert.throws(() => new Worker(q, 'nope'), TypeError);
  assert.throws(() => new Worker(q, () => {}, { concurrency: 0 }), RangeError);
});
