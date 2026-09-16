import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXIT_CODES } from '../src/index.mjs';

test('@lintcfg/codes exposes the fixed exit-code table', () => {
  assert.deepEqual(EXIT_CODES, { OK: 0, PARSE_ERROR: 2, MISSING_FIELD: 3, BAD_TYPE: 4, UNKNOWN_FIELD: 5 });
});
