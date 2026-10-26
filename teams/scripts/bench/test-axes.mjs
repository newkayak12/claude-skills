// Structure tests for the pre-registered bench axes: AXES.md terms, cases.tsv rows, and each
// hidden check accepting its good/ state and rejecting its bad/ state. Runs no arm; node built-ins only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const SLUGS = ['verified', 'defect', 'recovery', 'denied', 'baseline', 'seam', 'progress', 'decisions', 'cost'];
const HEADER = ['id', 'axis', 'slug', 'request', 'fixture', 'check', 'status'];

const lines = readFileSync(join(here, 'cases.tsv'), 'utf8').split('\n').filter(Boolean);
const rows = lines.slice(1).map((line) => Object.fromEntries(line.split('\t').map((v, i) => [HEADER[i], v])));

test('AXES.md names the nine slugs, unmeasured and below minimum effect', () => {
  const axes = readFileSync(join(here, 'AXES.md'), 'utf8');
  for (const slug of SLUGS) assert.ok(axes.includes('`' + slug + '`'), slug);
  assert.ok(axes.includes('unmeasured'));
  assert.ok(axes.includes('below minimum effect'));
});

test('cases.tsv has the 7-column header and tab-separated rows', () => {
  assert.deepEqual(lines[0].split('\t'), HEADER);
  for (const line of lines.slice(1)) assert.equal(line.split('\t').length, HEADER.length, line);
});

test('each slug has at least 3 rows', () => {
  for (const slug of SLUGS) assert.ok(rows.filter((r) => r.slug === slug).length >= 3, slug);
});

test('every request and fixture exists', () => {
  for (const r of rows) {
    assert.ok(existsSync(join(here, r.request)), r.request);
    assert.ok(existsSync(join(here, r.fixture)), r.fixture);
  }
});

test('every check exists, is a check.mjs, and is not under fixtures/', () => {
  for (const r of rows) {
    assert.ok(r.check.endsWith('check.mjs'), r.check);
    assert.ok(existsSync(join(here, r.check)), r.check);
    assert.ok(!r.check.split(/[\\/]/).includes('fixtures'), r.check);
  }
});

test('each check exits 0 on hidden/<id>/good and non-zero on hidden/<id>/bad', () => {
  for (const r of rows) {
    const check = join(here, r.check);
    const run = (state) => spawnSync(process.execPath, [check, join(here, 'hidden', r.id, state)], { encoding: 'utf8' });
    const good = run('good');
    assert.equal(good.status, 0, `${r.id} good: ${good.stderr}`);
    const bad = run('bad');
    assert.notEqual(bad.status, 0, `${r.id} bad passed`);
  }
});

test('every status is pending and no row is for Codex', () => {
  for (const r of rows) {
    assert.equal(r.status, 'pending', r.id);
    assert.ok(!/codex/i.test(line(r)), r.id);
  }
});

function line(r) {
  return HEADER.map((k) => r[k]).join('\t');
}
