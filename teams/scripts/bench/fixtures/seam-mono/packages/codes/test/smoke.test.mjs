import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXIT_CODES } from '../src/index.mjs';

// Fixed by the fixture, not the arm under test: this is the seam's one source of truth.
// Nothing in this bench case should ever need to edit this file or this test.
test('@lintcfg/codes exposes the fixed exit-code table', () => {
  assert.deepEqual(EXIT_CODES, { OK: 0, PARSE_ERROR: 2, MISSING_FIELD: 3, BAD_TYPE: 4, UNKNOWN_FIELD: 5 });
});
