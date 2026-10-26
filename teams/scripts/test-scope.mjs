// Tests for teams/mcp/scope.mjs and teams/scripts/scope.mjs in a temporary git repo.
//   node --test teams/scripts/test-scope.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { baseline, touched, parsePorcelain } from '../mcp/scope.mjs';

const cli = join(dirname(fileURLToPath(import.meta.url)), 'scope.mjs');
const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8' });

function repo() {
  const d = mkdtempSync(join(tmpdir(), 'scope-'));
  git(d, 'init', '-q');
  git(d, 'config', 'user.email', 't@t');
  git(d, 'config', 'user.name', 't');
  writeFileSync(join(d, 'a.txt'), 'a\n');
  writeFileSync(join(d, 'b.txt'), 'b\n');
  git(d, 'add', '.');
  git(d, 'commit', '-qm', 'init');
  return d;
}

test('parsePorcelain reads -z entries and skips the rename origin', () => {
  assert.deepEqual(parsePorcelain(' M a.txt\0?? n w.txt\0R  new.txt\0old.txt\0'), ['a.txt', 'n w.txt', 'new.txt']);
});

test('clean baseline: nothing touched until a change', () => {
  const d = repo();
  try {
    const base = baseline(d);
    assert.deepEqual(base, {});
    assert.deepEqual(touched(d, base), []);
    writeFileSync(join(d, 'a.txt'), 'changed\n');
    assert.deepEqual(touched(d, base), ['a.txt']);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('pre-dirty path left alone is excluded', () => {
  const d = repo();
  try {
    writeFileSync(join(d, 'a.txt'), 'dirty before\n');
    const base = baseline(d);
    assert.deepEqual(Object.keys(base), ['a.txt']);
    assert.deepEqual(touched(d, base), []);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('pre-dirty path edited again is counted', () => {
  const d = repo();
  try {
    writeFileSync(join(d, 'a.txt'), 'dirty before\n');
    const base = baseline(d);
    writeFileSync(join(d, 'a.txt'), 'dirty after\n');
    assert.deepEqual(touched(d, base), ['a.txt']);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('new untracked path is counted', () => {
  const d = repo();
  try {
    writeFileSync(join(d, 'old-untracked.txt'), 'x\n');
    const base = baseline(d);
    writeFileSync(join(d, 'new.txt'), 'n\n');
    assert.deepEqual(touched(d, base), ['new.txt']);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('deleted path is counted; one deleted before the baseline is not', () => {
  const d = repo();
  try {
    unlinkSync(join(d, 'a.txt'));
    const base = baseline(d);
    assert.deepEqual(touched(d, base), []);
    unlinkSync(join(d, 'b.txt'));
    assert.deepEqual(touched(d, base), ['b.txt']);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('CLI prints touched paths one per line', () => {
  const d = repo();
  try {
    writeFileSync(join(d, 'a.txt'), 'dirty before\n');
    const f = join(d, '..', `${Date.now()}-base.json`);
    const b = spawnSync('node', [cli, 'baseline', '--cwd', d, '--out', f], { encoding: 'utf8' });
    assert.equal(b.status, 0, b.stderr);
    writeFileSync(join(d, 'n1.txt'), '1\n');
    writeFileSync(join(d, 'n2.txt'), '2\n');
    const t = spawnSync('node', [cli, 'touched', '--cwd', d, '--baseline', f], { encoding: 'utf8' });
    assert.equal(t.status, 0, t.stderr);
    assert.equal(t.stdout, 'n1.txt\nn2.txt\n');
    rmSync(f, { force: true });
  } finally { rmSync(d, { recursive: true, force: true }); }
});
