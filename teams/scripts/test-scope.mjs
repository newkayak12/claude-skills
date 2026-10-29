// Tests for teams/mcp/scope.mjs and teams/scripts/scope.mjs in a temporary git repo.
//   node --test teams/scripts/test-scope.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { baseline, touched, parsePorcelain, inScope, verdict, ownVerdict } from '../mcp/scope.mjs';

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

test('inScope: exact path, directory, and globs', () => {
  assert.equal(inScope('a.txt', ['a.txt']), true);
  assert.equal(inScope('src/x/y.js', ['src']), true);
  assert.equal(inScope('src/x/y.js', ['src/']), true);
  assert.equal(inScope('srcx/y.js', ['src']), false);
  assert.equal(inScope('src/x/y.js', ['src/**/*.js']), true);
  assert.equal(inScope('src/y.js', ['src/**/*.js']), true);
  assert.equal(inScope('src/x/y.md', ['src/**/*.js']), false);
  assert.equal(inScope('src/x/y.js', ['src/*.js']), false);
  assert.equal(inScope('a.txt', ['b.txt', 'a.*']), true);
  assert.equal(inScope('a.txt', []), false);
});

test('verdict (a): another run\'s dirty files at the baseline pass', () => {
  const d = repo();
  try {
    writeFileSync(join(d, 'a.txt'), 'foreign dirty\n');
    writeFileSync(join(d, 'foreign-new.txt'), 'f\n');
    const base = baseline(d);
    writeFileSync(join(d, 'mine.txt'), 'm\n');
    assert.deepEqual(verdict({ cwd: d, baseline: base, scope: ['mine.txt'] }), { ok: true, outOfScope: [] });
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('verdict (b): a foreign dirty file inside the scope after the baseline passes (partly met: attributed to this run)', () => {
  const d = repo();
  try {
    const base = baseline(d);
    writeFileSync(join(d, 'mine.txt'), 'm\n');
    mkdirSync(join(d, 'src'));
    writeFileSync(join(d, 'src', 'foreign.js'), 'f\n'); // another run's write, indistinguishable from ours
    assert.deepEqual(verdict({ cwd: d, baseline: base, scope: ['mine.txt', 'src/**'] }), { ok: true, outOfScope: [] });
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('verdict (c): a path this run touched outside the scope fails and is named; CLI exits 1', () => {
  const d = repo();
  try {
    writeFileSync(join(d, 'a.txt'), 'foreign dirty\n');
    const f = join(d, '..', `${Date.now()}-vbase.json`);
    assert.equal(spawnSync('node', [cli, 'baseline', '--cwd', d, '--out', f], { encoding: 'utf8' }).status, 0);
    writeFileSync(join(d, 'mine.txt'), 'm\n');
    writeFileSync(join(d, 'b.txt'), 'stray edit\n');
    assert.deepEqual(verdict({ cwd: d, baseline: JSON.parse(readFileSync(f, 'utf8')), scope: ['mine.txt'] }),
      { ok: false, outOfScope: ['b.txt'] });
    const r = spawnSync('node', [cli, 'verdict', '--cwd', d, '--baseline', f, '--scope', 'mine.txt'], { encoding: 'utf8' });
    assert.equal(r.status, 1, r.stderr);
    assert.equal(r.stdout, 'b.txt\n');
    const ok = spawnSync('node', [cli, 'verdict', '--cwd', d, '--baseline', f, '--scope', 'mine.txt,b.txt'], { encoding: 'utf8' });
    assert.equal(ok.status, 0, ok.stderr);
    assert.equal(ok.stdout, '');
    rmSync(f, { force: true });
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('verdict (d): a foreign write after the baseline outside the scope, not in the own-write list, passes', () => {
  const d = repo();
  try {
    const base = baseline(d);
    writeFileSync(join(d, 'mine.txt'), 'm\n');
    writeFileSync(join(d, 'other-run.txt'), 'x\n'); // another run, after our baseline: not in our record
    assert.deepEqual(ownVerdict({ cwd: d, baseline: base, scope: ['mine.txt'], own: ['mine.txt'] }), { ok: true, outOfScope: [] });
    // without a record (older run) the old rule holds
    assert.deepEqual(ownVerdict({ cwd: d, baseline: base, scope: ['mine.txt'] }), { ok: false, outOfScope: ['other-run.txt'] });
    assert.deepEqual(verdict({ cwd: d, baseline: base, scope: ['mine.txt'] }), { ok: false, outOfScope: ['other-run.txt'] });
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('ownVerdict: this run\'s own stray write outside the scope fails and is named', () => {
  const d = repo();
  try {
    const base = baseline(d);
    writeFileSync(join(d, 'mine.txt'), 'm\n');
    writeFileSync(join(d, 'stray.txt'), 's\n');
    writeFileSync(join(d, 'other-run.txt'), 'x\n');
    assert.deepEqual(ownVerdict({ cwd: d, baseline: base, scope: ['mine.txt'], own: ['./mine.txt', 'stray.txt'] }),
      { ok: false, outOfScope: ['stray.txt'] });
    assert.deepEqual(ownVerdict({ cwd: d, baseline: base, scope: ['mine.txt'], own: [] }), { ok: true, outOfScope: [] });
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('CLI verdict without --baseline or --scope exits 2', () => {
  const d = repo();
  try {
    assert.equal(spawnSync('node', [cli, 'verdict', '--cwd', d, '--scope', 'a'], { encoding: 'utf8' }).status, 2);
    assert.equal(spawnSync('node', [cli, 'verdict', '--cwd', d, '--baseline', 'x.json'], { encoding: 'utf8' }).status, 2);
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
