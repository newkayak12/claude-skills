import { test } from 'node:test';
import assert from 'node:assert/strict';

test('@lintcfg/parser package loads', async () => {
  const m = await import('../src/index.mjs');
  assert.equal(typeof m, 'object');
});
