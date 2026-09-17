// Unit tests for the claim-verification helpers score.mjs uses. score.mjs itself cannot be
// imported directly - loading it runs the whole scoring pass as a top-level side effect - so
// the pure string/shape logic lives in ./lib/claims.mjs and is tested here in isolation.
// Covers the six false-claim shapes a 2026-09-16 live run exposed (see README "Judge fields"):
// filesystem-not-found phrasing, prose-joined commands, content-showing commands, placeholder
// args, and the token/queue shapes the README-example materialization is built from.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { impliesFailure, hasPlaceholder, isContentShowCmd, splitSlashCmd, splitCheck, claimedExit, fencedBlocksByLang, neededInputTokens, CHECK_ALLOW } from './lib/claims.mjs';

test('impliesFailure: filesystem-not-found phrasing implies non-zero exit', () => {
  assert.equal(impliesFailure("both 'No such file or directory' (removed)"), true);
  assert.equal(impliesFailure('file not found'), true);
  assert.equal(impliesFailure('ENOENT: no such file'), true);
  assert.equal(impliesFailure('cannot access /tmp/x'), true);
  assert.equal(impliesFailure('the config file does not exist'), true);
});

test('impliesFailure: ordinary pass/fail counts still read correctly', () => {
  assert.equal(impliesFailure('TAP output, 6 pass, 0 fail, exit code 0'), false);
  assert.equal(impliesFailure('6 tests passed, 0 failed'), false);
  assert.equal(impliesFailure('2 tests failed'), true);
  assert.equal(impliesFailure('threw an error'), true);
});

test('isContentShowCmd: cat/sed -n/head/tail/grep-without--c show content', () => {
  assert.equal(isContentShowCmd('cat src/csv.mjs'), true);
  assert.equal(isContentShowCmd("sed -n '1,5p' src/csv.mjs"), true);
  assert.equal(isContentShowCmd('head -5 src/csv.mjs'), true);
  assert.equal(isContentShowCmd('tail -20 src/csv.mjs'), true);
  assert.equal(isContentShowCmd("grep 'parseCsv' src/csv.mjs"), true);
});

test('isContentShowCmd: grep -c (a count) and non-content commands are not content-showing', () => {
  assert.equal(isContentShowCmd("grep -c 'parseCsv' src/csv.mjs"), false);
  assert.equal(isContentShowCmd('node --test test/csv.test.mjs'), false);
  assert.equal(isContentShowCmd('ls src/'), false);
});

test('splitSlashCmd: splits path-like " / "-joined commands, keeping the leading verb', () => {
  const cmd = 'node --test test/csv.test.mjs / test/rules.test.mjs / test/report.test.mjs / test/cli.test.mjs';
  assert.deepEqual(splitSlashCmd(cmd), [
    'node --test test/csv.test.mjs',
    'node --test test/rules.test.mjs',
    'node --test test/report.test.mjs',
    'node --test test/cli.test.mjs',
  ]);
});

test('splitSlashCmd: refuses prose that merely contains a slash', () => {
  assert.equal(splitSlashCmd('grep for each of the five export names / signatures'), null);
  assert.equal(splitSlashCmd('node --test test/csv.test.mjs'), null); // no " / " at all
});

test('hasPlaceholder: angle-bracket / bracket / paren placeholders are not runnable paths', () => {
  assert.equal(hasPlaceholder('ledger report <csv> --rules <json> [--month YYYY-MM]'), true);
  assert.equal(hasPlaceholder('node bin/ledger.mjs report transactions.csv --rules rules.json'), false);
});

test('splitCheck / claimedExit: unchanged shape parsing', () => {
  assert.deepEqual(splitCheck('node --test -> exit 0'), ['node --test', 'exit 0']);
  assert.deepEqual(splitCheck('grep -c x file: 3'), ['grep -c x file', '3']);
  assert.equal(splitCheck('no delimiter here')[1], null);
  assert.equal(claimedExit('claimed exit code: 1'), 1);
  assert.equal(claimedExit('no exit mentioned'), null);
});

test('CHECK_ALLOW: the safe-rerun allowlist matches the commands score.mjs relies on', () => {
  for (const cmd of ['node --test', 'node bin/ledger.mjs report x.csv', 'npm test', 'cat file', 'ls dir', "grep -c 'x' file", 'wc -l file', 'head -5 file']) {
    assert.equal(CHECK_ALLOW.some((re) => re.test(cmd)), true, cmd);
  }
  assert.equal(CHECK_ALLOW.some((re) => re.test('grep for each of the five export names')), false);
});

test('fencedBlocksByLang: queues fenced blocks by language tag, in document order', () => {
  const md = [
    '```csv', 'date,amount,merchant,memo', '2026-01-03,4.50,Coffee,latte', '```',
    '```json', '[{"match":"Coffee","category":"food"}]', '```',
    '```csv', 'second,csv,block', '```',
  ].join('\n');
  const q = fencedBlocksByLang(md);
  assert.equal(q.csv.length, 2);
  assert.match(q.csv[0], /date,amount,merchant,memo/);
  assert.match(q.csv[1], /second,csv,block/);
  assert.equal(q.json.length, 1);
  assert.match(q.json[0], /"match":"Coffee"/);
});

test('neededInputTokens: only bare, non-existing, recognized-extension args are candidates', () => {
  const exists = (tok) => tok === 'already-there.csv';
  const cmd = 'node bin/ledger.mjs report transactions.csv --rules rules.json --month 2026-02 already-there.csv';
  const needed = neededInputTokens(cmd, exists);
  assert.deepEqual(needed.map((n) => n.token), ['transactions.csv', 'rules.json']);
  assert.deepEqual(needed.map((n) => n.lang), ['csv', 'json']);
});

test('neededInputTokens: a placeholder-free command with no file-like args needs nothing', () => {
  assert.deepEqual(neededInputTokens('node bin/ledger.mjs --help', () => false), []);
});
