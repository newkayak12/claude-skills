// Unit tests for the claim-verification helpers score.mjs uses. score.mjs itself cannot be
// imported directly - loading it runs the whole scoring pass as a top-level side effect - so
// the pure string/shape logic lives in ./lib/claims.mjs and is tested here in isolation.
// Covers the six false-claim shapes a 2026-09-16 live run exposed (see README "Judge fields"):
// filesystem-not-found phrasing, prose-joined commands, content-showing commands, placeholder
// args, and the token/queue shapes the README-example materialization is built from.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
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


// ---------- the size-S verdict, run end to end ----------
//
// score.mjs cannot be imported (it scores as a top-level side effect), so this drives the real
// file as a subprocess over a synthetic workspace - which is what makes it a test of the bug
// rather than of a copy of the logic.
//
// The bug: a size-S task keeps only size/shape/critique in task.json (shape and critique
// skipped the moment size resolves) and moves the whole run, gate:goal included, into the child
// run task.s_run names. Reading the task's own nodes finds no goal gate, so every size-S task
// scored 'not-delivered' - including the 2026-09-17 run that closed 20/20 with an accepted goal
// gate. The engine had the same mistake in its own watcher branch (teams 0.12.2).
const HERE = dirname(fileURLToPath(import.meta.url));

function sizeSWorkspace(childNodes) {
  const ws = mkdtempSync(join(tmpdir(), 'score-s-'));
  const taskDir = join(ws, '.harness-tasks', 'task1');
  mkdirSync(taskDir, { recursive: true });
  writeFileSync(join(taskDir, 'task.json'), JSON.stringify({
    run_id: 'task1', cwd: ws, request: 'r',
    s_run: { cwd: ws, run_id: 'r1' },
    nodes: [
      { node_id: 'size', stage: 'size', state: 'done', result: { stage_ok: true, size: 'S' } },
      { node_id: 'shape', stage: 'shape', state: 'skipped' },
      { node_id: 'critique', stage: 'critique', state: 'skipped' },
    ],
  }));
  const runs = join(ws, '.teams_output', 'broker', 'runs');
  mkdirSync(runs, { recursive: true });
  writeFileSync(join(runs, 'r1.json'), JSON.stringify({ run_id: 'r1', cwd: ws, state: 'complete', flow: 'develop', size: 'S', nodes: childNodes }));
  // The code-flat fixture's own seed: score.mjs reads package.json unconditionally for its
  // no_deps criterion, so a workspace without one is not a workspace it is ever handed.
  writeFileSync(join(ws, 'package.json'), JSON.stringify({ name: 'ledger', type: 'module', scripts: { test: 'node --test' } }));
  writeFileSync(join(ws, 'stream.jsonl'), '');
  return ws;
}

function scoreLine(ws) {
  const r = spawnSync('node', [join(HERE, 'score.mjs'), 'code-flat', ws, join(ws, 'stream.jsonl')], { encoding: 'utf8' });
  return (r.stdout || '') + (r.stderr || '');
}

test('a size-S task whose child run closed with an accepted goal gate scores delivered, not not-delivered', () => {
  const ws = sizeSWorkspace([
    { node_id: 'plan', stage: 'plan', state: 'done', result: { stage_ok: true } },
    { node_id: 'implement:U1:1', stage: 'implement', state: 'done', result: { stage_ok: true } },
    { node_id: 'gate:goal:1', stage: 'gate', subgoal_id: null, state: 'done', result: { stage_ok: true, accept: true, match_pct: 96 } },
    { node_id: 'report', stage: 'report', state: 'done', result: { stage_ok: true, handoff: 'done' } },
  ]);
  try {
    assert.match(scoreLine(ws), /task delivered/);
  } finally { rmSync(ws, { recursive: true, force: true }); }
});

test('a size-S task whose child run still has a pending node scores incomplete - the child is read, not merely trusted', () => {
  const ws = sizeSWorkspace([
    { node_id: 'plan', stage: 'plan', state: 'done', result: { stage_ok: true } },
    { node_id: 'review:U5:1', stage: 'review', state: 'pending' },
    { node_id: 'gate:goal:1', stage: 'gate', subgoal_id: null, state: 'pending' },
  ]);
  try {
    assert.match(scoreLine(ws), /task incomplete/);
  } finally { rmSync(ws, { recursive: true, force: true }); }
});
