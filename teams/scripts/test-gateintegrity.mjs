// Tests for teams/mcp/gateintegrity.mjs and teams/scripts/gateintegrity.mjs in a temporary git repo.
//   node --test teams/scripts/test-gateintegrity.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, unlinkSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gateIntegrity, parseDiff, weakenings, formatList } from '../mcp/gateintegrity.mjs';

const cli = join(dirname(fileURLToPath(import.meta.url)), 'gateintegrity.mjs');
const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8' });

const TEST_V1 = ["import test from 'node:test';", "test('first', () => {});", "test('second', () => {});", ''].join('\n');

// A repo with a.test.mjs and src.mjs committed; returns { d, base }.
function repo() {
  const d = mkdtempSync(join(tmpdir(), 'gateint-'));
  git(d, 'init', '-q');
  git(d, 'config', 'user.email', 't@t');
  git(d, 'config', 'user.name', 't');
  writeFileSync(join(d, 'a.test.mjs'), TEST_V1);
  writeFileSync(join(d, 'src.mjs'), 'export const x = 1;\n');
  git(d, 'add', '.');
  git(d, 'commit', '-qm', 'init');
  return { d, base: git(d, 'rev-parse', 'HEAD').trim() };
}
const run = (d, ...a) => spawnSync('node', [cli, '--cwd', d, ...a], { encoding: 'utf8' });
const rm = (d) => rmSync(d, { recursive: true, force: true });

test('removed-test: a removed test( call is reported at its old line', () => {
  const { d, base } = repo();
  try {
    writeFileSync(join(d, 'a.test.mjs'), ["import test from 'node:test';", "test('second', () => {});", ''].join('\n'));
    assert.deepEqual(gateIntegrity({ cwd: d, baseline: base }), [
      { tag: 'removed-test', file: 'a.test.mjs', line: 2, text: "test('first', () => {});" },
    ]);
  } finally { rm(d); }
});

test('added-skip: an added .skip is reported at its new line', () => {
  const { d, base } = repo();
  try {
    writeFileSync(join(d, 'a.test.mjs'), ["import test from 'node:test';", "test('first', () => {});", "test.skip('second', () => {});", ''].join('\n'));
    assert.deepEqual(gateIntegrity({ cwd: d, baseline: base }), [
      { tag: 'added-skip', file: 'a.test.mjs', line: 3, text: "test.skip('second', () => {});" },
    ]);
  } finally { rm(d); }
});

test('deleted-test-file: a deleted test file is reported at line 1', () => {
  const { d, base } = repo();
  try {
    unlinkSync(join(d, 'a.test.mjs'));
    assert.deepEqual(gateIntegrity({ cwd: d, baseline: base }), [
      { tag: 'deleted-test-file', file: 'a.test.mjs', line: 1, text: 'a.test.mjs' },
    ]);
  } finally { rm(d); }
});

test('a removed call whose title is re-added in the same file (reformat) is not reported', () => {
  const { d, base } = repo();
  try {
    writeFileSync(join(d, 'a.test.mjs'), ["import test from 'node:test';", '', "test(\"first\",   () => { /* moved */ });", "test('second', () => {});", ''].join('\n'));
    assert.deepEqual(gateIntegrity({ cwd: d, baseline: base }), []);
  } finally { rm(d); }
});

test('changes outside test files never produce a finding', () => {
  const { d, base } = repo();
  try {
    writeFileSync(join(d, 'src.mjs'), "export const x = 2;\ntest.skip('not a test file', () => {});\n");
    assert.deepEqual(gateIntegrity({ cwd: d, baseline: base }), []);
    unlinkSync(join(d, 'src.mjs'));
    assert.deepEqual(gateIntegrity({ cwd: d, baseline: base }), []);
  } finally { rm(d); }
});

test('a clean diff gives no findings and an empty string', () => {
  const { d, base } = repo();
  try {
    assert.deepEqual(gateIntegrity({ cwd: d, baseline: base }), []);
    assert.equal(formatList([]), '');
  } finally { rm(d); }
});

test('each tag family: .only .todo xit( describe( it.each Python def test_, tests/ dir', () => {
  const diff = [
    'diff --git a/tests/x.js b/tests/x.js',
    '--- a/tests/x.js',
    '+++ b/tests/x.js',
    '@@ -4,2 +4,3 @@',
    "-describe('suite', () => {",
    "-it.each([1, 2])('case %i', () => {});",
    '+it.only(\'a\', () => {});',
    '+xit(\'b\', () => {});',
    "+test.todo('c');",
    'diff --git a/pkg/test_mod.py b/pkg/test_mod.py',
    '--- a/pkg/test_mod.py',
    '+++ b/pkg/test_mod.py',
    '@@ -10 +9,0 @@',
    '-def test_gone():',
  ].join('\n');
  const got = weakenings(parseDiff(diff)).map((f) => `${f.tag} ${f.file}:${f.line}`);
  assert.deepEqual(got, [
    'removed-test tests/x.js:4',
    'removed-test tests/x.js:5',
    'added-skip tests/x.js:4',
    'added-skip tests/x.js:5',
    'added-skip tests/x.js:6',
    'removed-test pkg/test_mod.py:10',
  ]);
});

test('formatList renders tag, file:line and text per finding', () => {
  assert.equal(
    formatList([{ tag: 'added-skip', file: 'a.test.mjs', line: 3, text: 'test.skip(1)' }, { tag: 'deleted-test-file', file: 'b.spec.ts', line: 1, text: 'b.spec.ts' }]),
    'added-skip\ta.test.mjs:3\ttest.skip(1)\ndeleted-test-file\tb.spec.ts:1\tb.spec.ts\n',
  );
});

test('test files in a tests/ directory are covered by deletion', () => {
  const { d, base } = repo();
  try {
    mkdirSync(join(d, 'tests'));
    writeFileSync(join(d, 'tests', 'helper.js'), 'x\n');
    git(d, 'add', '.');
    git(d, 'commit', '-qm', 't');
    const b2 = git(d, 'rev-parse', 'HEAD').trim();
    unlinkSync(join(d, 'tests', 'helper.js'));
    assert.deepEqual(gateIntegrity({ cwd: d, baseline: b2 }).map((f) => f.tag), ['deleted-test-file']);
    assert.notEqual(base, b2);
  } finally { rm(d); }
});

test('CLI exits 1 and prints the list when a test was weakened', () => {
  const { d, base } = repo();
  try {
    writeFileSync(join(d, 'a.test.mjs'), '');
    const r = run(d, '--baseline', base);
    assert.equal(r.status, 1, r.stderr);
    assert.equal(
      r.stdout,
      "removed-test\ta.test.mjs:2\ttest('first', () => {});\nremoved-test\ta.test.mjs:3\ttest('second', () => {});\n",
    );
  } finally { rm(d); }
});

test('CLI exits 0 with no output on a clean tree', () => {
  const { d, base } = repo();
  try {
    const r = run(d, '--baseline', base);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, '');
  } finally { rm(d); }
});

test('CLI exits 2 with a usage line without --baseline or with an unknown one', () => {
  const { d } = repo();
  try {
    const none = run(d);
    assert.equal(none.status, 2);
    assert.match(none.stderr, /usage: gateintegrity\.mjs/);
    const bad = run(d, '--baseline', 'no-such-ref');
    assert.equal(bad.status, 2);
    assert.match(bad.stderr, /usage: gateintegrity\.mjs/);
  } finally { rm(d); }
});
