import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withRetry, computeDelay, RetryExhaustedError } from '../src/index.mjs';

test('returns on first success', async () => {
  let calls = 0;
  const result = await withRetry(async () => { calls += 1; return 'ok'; }, { baseMs: 1 });
  assert.equal(result, 'ok');
  assert.equal(calls, 1);
});

test('retries then throws RetryExhaustedError', async () => {
  let calls = 0;
  await assert.rejects(
    withRetry(async () => { calls += 1; throw new Error('boom'); }, { attempts: 3, baseMs: 1 }),
    (err) => err instanceof RetryExhaustedError && err.attempts === 3 && err.lastError.message === 'boom',
  );
  assert.equal(calls, 3);
});

test('computeDelay grows exponentially without jitter', () => {
  const opts = { baseMs: 10, factor: 2, jitter: 0 };
  assert.equal(computeDelay(1, opts), 10);
  assert.equal(computeDelay(2, opts), 20);
  assert.equal(computeDelay(3, opts), 40);
});
