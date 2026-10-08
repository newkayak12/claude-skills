#!/usr/bin/env node
// test-wikibridge.mjs - teams/mcp/wikibridge.mjs: the task engine's in-process door into teams-wiki.
// Design: _repo/docs/plans/2026-10-07-teams-wiki-memory.md (2단계).
//
//   node --test teams/scripts/test-wikibridge.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mode } from '../mcp/wikibridge.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

test('mode reports fts5 or scan', () => {
  assert.ok(['fts5', 'scan'].includes(mode()));
});

test('wikibridge.mjs holds mode only: no writes, no resume, imports only wiki', () => {
  const src = readFileSync(join(HERE, '..', 'mcp', 'wikibridge.mjs'), 'utf8');
  const from = [...src.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(from, ['./wiki.mjs']);
  assert.doesNotMatch(src, /wiki_write|callToolSync|writeLog|logPage|resumeContext|shippedIds/);
});
