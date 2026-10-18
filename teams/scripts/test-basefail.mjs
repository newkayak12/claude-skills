// basefail.mjs: a failure that reproduces on the base commit is excluded from a package's score.
// Runs against a throwaway git repo in os.tmpdir(); `run` is injected, never the repo's suite.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveBase, failingTests, compareOnBase, exclusionLine } from '../mcp/basefail.mjs';

let repo, c1, c2;
const git = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: repo, encoding: 'utf8' }).trim();

before(() => {
  repo = mkdtempSync(join(tmpdir(), 'basefail-fixture-'));
  git('init', '-q', '-b', 'main');
  writeFileSync(join(repo, 'a.txt'), '1');
  git('add', 'a.txt');
  git('commit', '-q', '-m', 'c1');
  c1 = git('rev-parse', 'HEAD');
  git('branch', 'feat');
  writeFileSync(join(repo, 'a.txt'), '2');
  git('commit', '-q', '-am', 'c2');
  c2 = git('rev-parse', 'HEAD');
});
after(() => rmSync(repo, { recursive: true, force: true }));

const tap = (...names) => names.map((n, i) => `not ok ${i + 1} - ${n}\n`).join('');
const worktrees = () => git('worktree', 'list', '--porcelain').split('\n').filter((l) => l.startsWith('worktree ')).length;

// A fake runner answering each call from `answers` in order; records the calls.
function fake(...answers) {
  const calls = [];
  const run = (command, opts) => {
    calls.push({ command, cwd: opts.cwd, timeout: opts.timeout, head: git('-C', opts.cwd, 'rev-parse', 'HEAD') });
    const a = answers[Math.min(calls.length - 1, answers.length - 1)];
    if (a instanceof Error) throw a;
    return a;
  };
  return { run, calls };
}
const out = (stdout, status = 1) => ({ status, stdout, stderr: '' });

test('failingTests parses names from TAP, nested and with directives, de-duplicated', () => {
  const o = 'ok 1 - fine\nnot ok 2 - broke # SKIP later\n    not ok 1 - nested one\nnot ok 3 - broke\n';
  assert.deepEqual(failingTests(o), ['broke', 'nested one']);
});

test('failingTests gives [] for no failures, empty and non-string input', () => {
  assert.deepEqual(failingTests('ok 1 - a\nok 2 - b\n'), []);
  assert.deepEqual(failingTests(''), []);
  assert.deepEqual(failingTests(undefined), []);
  assert.deepEqual(failingTests(42), []);
});

test('exclusionLine renders an excluded item unchanged', () => {
  assert.equal(exclusionLine({ test: 'x', base: 'abc1234' }), 'excluded (also fails on base abc1234): x');
});

test('resolveBase returns the full sha of an existing baseCommit', () => {
  assert.equal(resolveBase({ cwd: repo, baseCommit: c1.slice(0, 10), branch: 'feat', baseRef: 'main' }), c1);
});

test('resolveBase falls back to the merge-base when baseCommit is missing, never to HEAD', () => {
  const missing = 'deadbeef'.repeat(5);
  const sha = resolveBase({ cwd: repo, baseCommit: missing, branch: 'feat', baseRef: 'main' });
  assert.equal(sha, c1);
  assert.notEqual(sha, 'HEAD');
  assert.equal(resolveBase({ cwd: repo, branch: 'feat' }), c1); // baseRef defaults to HEAD (main, at c2)
});

test('resolveBase propagates a git error when there is no merge-base', () => {
  assert.throws(() => resolveBase({ cwd: repo, branch: 'no-such-branch', baseRef: 'main' }));
});

test('a failure present on base and package is excluded and listed', () => {
  const { run, calls } = fake(out(tap('shared', 'base-only')));
  const r = compareOnBase({ cwd: repo, baseSha: c1, command: 'cmd-excluded', packageOutput: tap('shared', 'mine'), packageExit: 1, run });
  assert.deepEqual(r.excluded, [{ test: 'shared', base: c1.slice(0, 7) }]);
  assert.deepEqual(r.kept, ['mine']);
  assert.deepEqual(r.flaky, []);
  assert.equal(r.fallback, 'names');
  assert.equal(exclusionLine(r.excluded[0]), `excluded (also fails on base ${c1.slice(0, 7)}): shared`);
  assert.equal(calls.length, 2); // one run and one repeat
  assert.ok(calls.every((c) => c.head === c1 && c.cwd !== repo && c.timeout === 120000));
});

test('a failure only on the package is kept', () => {
  const { run } = fake(out('', 0));
  const r = compareOnBase({ cwd: repo, baseSha: c1, command: 'cmd-kept', packageOutput: tap('mine'), packageExit: 1, run });
  assert.deepEqual(r.excluded, []);
  assert.deepEqual(r.kept, ['mine']);
});

test('a test whose result differs between the two base runs is flaky and kept', () => {
  const { run } = fake(out(tap('wobbly')), out('', 0));
  const r = compareOnBase({ cwd: repo, baseSha: c1, command: 'cmd-flaky', packageOutput: tap('wobbly', 'solid'), packageExit: 1, run });
  assert.deepEqual(r.excluded, []);
  assert.deepEqual(r.flaky, ['wobbly']);
  assert.deepEqual(r.kept, ['wobbly', 'solid']);
});

test('no parseable names falls back to the exit code: all non-zero excludes the check as one item', () => {
  const { run } = fake(out('boom', 2));
  const r = compareOnBase({ cwd: repo, baseSha: c1, command: 'cmd-exit-both', packageOutput: 'boom', packageExit: 1, run });
  assert.equal(r.fallback, 'exit');
  assert.deepEqual(r.excluded, [{ test: 'cmd-exit-both', base: c1.slice(0, 7) }]);
  assert.deepEqual(r.kept, []);
});

test('exit fallback keeps the check when the base exits zero', () => {
  const { run } = fake(out('fine', 0));
  const r = compareOnBase({ cwd: repo, baseSha: c1, command: 'cmd-exit-base-ok', packageOutput: 'boom', packageExit: 1, run });
  assert.equal(r.fallback, 'exit');
  assert.deepEqual(r.excluded, []);
  assert.deepEqual(r.kept, ['cmd-exit-base-ok']);
});

test('a second call with the same base and command does not run again, and still compares the new package output', () => {
  const { run, calls } = fake(out(tap('shared')));
  const args = { cwd: repo, baseSha: c1, command: 'cmd-cache', packageExit: 1, run };
  const a = compareOnBase({ ...args, packageOutput: tap('shared') });
  const n = calls.length;
  const b = compareOnBase({ ...args, packageOutput: tap('other') });
  assert.equal(calls.length, n);
  assert.equal(a.excluded.length, 1);
  assert.deepEqual(b.excluded, []);
  assert.deepEqual(b.kept, ['other']);
});

test('the temp worktree is removed after a call and when run throws; a throwing base run excuses nothing and is not cached', () => {
  const before = worktrees();
  const ok = fake(out(tap('shared')));
  compareOnBase({ cwd: repo, baseSha: c1, command: 'cmd-clean', packageOutput: tap('shared'), packageExit: 1, run: ok.run });
  assert.equal(worktrees(), before);
  assert.equal(existsSync(ok.calls[0].cwd), false);

  const bad = fake(new Error('spawn failed'));
  const r = compareOnBase({ cwd: repo, baseSha: c1, command: 'cmd-throws', packageOutput: tap('shared'), packageExit: 1, run: bad.run });
  assert.deepEqual(r.excluded, []);
  assert.deepEqual(r.kept, ['shared']);
  assert.equal(worktrees(), before);

  const again = fake(out(tap('shared')));
  compareOnBase({ cwd: repo, baseSha: c1, command: 'cmd-throws', packageOutput: tap('shared'), packageExit: 1, run: again.run });
  assert.equal(again.calls.length, 2); // the failed attempt left nothing in the cache
});

test('a timed-out base run excuses nothing', () => {
  const { run } = fake({ status: null, signal: 'SIGTERM', error: Object.assign(new Error('spawnSync ETIMEDOUT'), { code: 'ETIMEDOUT' }), stdout: '', stderr: '' });
  const r = compareOnBase({ cwd: repo, baseSha: c1, command: 'cmd-timeout', packageOutput: 'boom', packageExit: 1, run });
  assert.deepEqual(r.excluded, []);
  assert.deepEqual(r.kept, ['cmd-timeout']);
  assert.equal(worktrees(), 1);
});

test('the default runner runs a shell command in the detached worktree at baseSha', () => {
  const r = compareOnBase({ cwd: repo, baseSha: c1, command: `printf 'not ok 1 - real\\n'; exit 1`, packageOutput: tap('real'), packageExit: 1 });
  assert.deepEqual(r.excluded, [{ test: 'real', base: c1.slice(0, 7) }]);
  assert.equal(worktrees(), 1);
  assert.notEqual(c1, c2);
});
