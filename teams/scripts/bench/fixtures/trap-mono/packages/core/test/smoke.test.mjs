import { test } from 'node:test';
import assert from 'node:assert/strict';
import { systemClock, fixedClock } from '../src/index.mjs';

// Fixed by the fixture, not the arm under test: this is the seam's one source of truth.
// Nothing in this bench case should ever need to edit this file or this test.
test('@ratesched/core exposes a Clock with a nowMs() reader', () => {
  assert.equal(typeof systemClock().nowMs(), 'number');
  assert.equal(fixedClock(1700000000000).nowMs(), 1700000000000);
});
