// Unit tests for the claim-verification helpers score.mjs uses. score.mjs itself cannot be
// imported directly - loading it runs the whole scoring pass as a top-level side effect - so
// the pure string/shape logic lives in ./lib/claims.mjs and is tested here in isolation.
// Covers the six false-claim shapes a 2026-09-16 live run exposed (see README "Judge fields"):
// filesystem-not-found phrasing, prose-joined commands, content-showing commands, placeholder
// args, and the token/queue shapes the README-example materialization is built from.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, chmodSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { impliesFailure, hasPlaceholder, isContentShowCmd, splitSlashCmd, splitCheck, claimedExit, fencedBlocksByLang, neededInputTokens, CHECK_ALLOW, parseRequirements, requirementCovered, majorityVote } from './lib/claims.mjs';

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

// GRAPH_BENCH_NO_JUDGE=1 by default: `scope_match` (added alongside the spec-driven metrics)
// runs for every case that has a request file, code-flat included, so every one of these
// fixture-driven tests would otherwise start spawning a real `claude` subprocess the moment
// score.mjs reaches it - turning a hermetic, sub-second unit test into a network call. Tests
// that actually want a judge verdict use scoreLineEnv with a stubbed `claude` on PATH instead
// (see stubClaudePath below), which overrides this default off.
function scoreLine(ws) {
  const r = spawnSync('node', [join(HERE, 'score.mjs'), 'code-flat', ws, join(ws, 'stream.jsonl')],
    { encoding: 'utf8', timeout: 60_000, env: { ...process.env, GRAPH_BENCH_NO_JUDGE: '1' } });
  return (r.stdout || '') + (r.stderr || '');
}

// Same as scoreLine, but with extra environment variables layered over this test process's own
// (PATH included) instead of the GRAPH_BENCH_NO_JUDGE=1 default above - used by the
// spec-driven-metrics tests below to either keep every judge call skipped explicitly, or to
// redirect it at a fake `claude` executable placed ahead of the real one on PATH, the same
// technique a real offline/CI environment would need since there is no `claude` CLI to call
// there either.
function scoreLineEnv(ws, extraEnv) {
  const r = spawnSync('node', [join(HERE, 'score.mjs'), 'code-flat', ws, join(ws, 'stream.jsonl')],
    { encoding: 'utf8', timeout: 60_000, env: { ...process.env, ...extraEnv } });
  return (r.stdout || '') + (r.stderr || '');
}

// A fake `claude -p ... --output-format json <prompt>` that ignores its input and always
// returns the same judge response, in a fresh directory prepended to PATH - stands in for the
// real CLI so a judge-backed criterion (scope_match) can be tested without a network call or a
// real claude installation.
function stubClaudePath(responseJson) {
  const dir = mkdtempSync(join(tmpdir(), 'claude-stub-'));
  const script = join(dir, 'claude');
  const outer = JSON.stringify({ result: JSON.stringify(responseJson), total_cost_usd: 0.001 });
  writeFileSync(script, `#!/bin/sh\ncat <<'STUBEOF'\n${outer}\nSTUBEOF\n`);
  chmodSync(script, 0o755);
  return dir;
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

// ---------- Part 2: process criteria (spec coverage / review yield / regression / volume) -
// pure-logic pieces first, then one end-to-end check that score.mjs actually reports all four
// as `criteria` metadata without folding any of them into `passed`/`of`.

test('parseRequirements: a lettered request splits into its (a)/(b)/(c) clauses', () => {
  const req = 'Build a thing: (a) src/csv.mjs — parses rows; (b) src/rules.mjs — categorizes them; (c) bin/cli.mjs — wires it up.';
  const reqs = parseRequirements(req);
  assert.equal(reqs.length, 3);
  assert.match(reqs[0], /^src\/csv\.mjs/);
  assert.match(reqs[2], /^bin\/cli\.mjs/);
});

test('parseRequirements: a one-line prose goal (no letters) falls back to substantive sentences', () => {
  const req = 'Build ledger. You decide the split. It must import CSVs and report monthly spending from the command line, and a new user must be able to follow the README end to end.';
  const reqs = parseRequirements(req);
  assert.ok(reqs.length >= 1);
  assert.ok(reqs.every((r) => r.length > 30));
  assert.ok(!reqs.some((r) => /^you decide/i.test(r)));
});

test('parseRequirements: empty/missing request text yields no requirements, not a crash', () => {
  assert.deepEqual(parseRequirements(''), []);
  assert.deepEqual(parseRequirements(null), []);
});

test('requirementCovered: a backticked path/identifier that exists in the file list is covered', () => {
  const req = 'src/csv.mjs — parse CSV rows with `parseCsv` into typed records';
  const files = ['src/csv.mjs', 'src/rules.mjs', 'README.md'];
  const corpus = (files.join('\n') + '\nexport function parseCsv(text) {}').toLowerCase();
  assert.equal(requirementCovered(req, corpus, files), true);
});

test('requirementCovered: a requirement whose nouns never appear anywhere is uncovered', () => {
  const req = 'the CLI must also support exporting a PDF invoice with a company logo watermark';
  const files = ['src/csv.mjs', 'bin/ledger.mjs'];
  const corpus = (files.join('\n') + '\nexport function report() {}').toLowerCase();
  assert.equal(requirementCovered(req, corpus, files), false);
});

test('majorityVote: 3/3 and 2/3 both resolve, tracking the split', () => {
  const unanimous = [{ ok: true }, { ok: true }, { ok: true }];
  assert.deepEqual(majorityVote(unanimous, 'ok'), { value: true, split: '3/3' });
  const twoOfThree = [{ ok: true }, { ok: true }, { ok: false }];
  assert.deepEqual(majorityVote(twoOfThree, 'ok'), { value: true, split: '2/3' });
  const oneOfThree = [{ ok: false }, { ok: false }, { ok: true }];
  assert.deepEqual(majorityVote(oneOfThree, 'ok'), { value: false, split: '1/3' });
});

test('majorityVote: an even split (some judge calls failed and were dropped) falls to false, not true', () => {
  const tie = [{ ok: true }, { ok: false }];
  assert.deepEqual(majorityVote(tie, 'ok'), { value: false, split: '1/2' });
});

test('majorityVote: no successful calls at all reports 0/0, not a crash', () => {
  assert.deepEqual(majorityVote([], 'ok'), { value: null, split: '0/0' });
});

// End-to-end: a size-S synthetic workspace (same fixture shape as the tests above) actually
// carries `spec_coverage`, `review_yield`, `regression` and `volume` in its score.json, and none
// of the four leak into `passed`/`of` - they are objects/strings, not booleans, so the existing
// `typeof v === 'boolean'` filter that builds `bools` should skip them automatically.
test('Part 2 criteria appear as metadata in score.json and never move passed/of', () => {
  const ws = sizeSWorkspace([
    { node_id: 'plan', stage: 'plan', state: 'done', result: { stage_ok: true } },
    { node_id: 'implement:U1:1', stage: 'implement', state: 'done', result: { stage_ok: true, changed_files: ['bin/ledger.mjs'] } },
    { node_id: 'gate:U1:1', stage: 'gate', state: 'done', result: { stage_ok: true, accept: false, match_pct: 40, gaps: ['missing rules engine'] } },
    { node_id: 'implement:U1:2', stage: 'implement', state: 'done', result: { stage_ok: true, changed_files: ['bin/ledger.mjs', 'src/rules.mjs'] } },
    { node_id: 'gate:U1:2', stage: 'gate', state: 'done', result: { stage_ok: true, accept: true, match_pct: 95 } },
    { node_id: 'gate:goal:1', stage: 'gate', subgoal_id: null, state: 'done', result: { stage_ok: true, accept: true, match_pct: 96 } },
    { node_id: 'report', stage: 'report', state: 'done', result: { stage_ok: true, handoff: 'done' } },
  ]);
  try {
    scoreLine(ws); // score.mjs writes <ws>.score.json as a side effect
    const score = JSON.parse(readFileSync(`${ws}.score.json`, 'utf8'));
    for (const key of ['spec_coverage', 'review_yield', 'regression', 'volume']) {
      assert.ok(key in score.criteria, `criteria.${key} missing`);
    }
    // a gate rejection (accept:false on gate:U1:1) immediately followed by an implement:U1:2
    // that touched files is exactly what "yield" means: this fixture is built to have one.
    assert.equal(score.criteria.review_yield.rejections, 1);
    assert.equal(score.criteria.review_yield.yielded, 1);
    assert.equal(score.criteria.volume.src_files, 0); // the code-flat fixture seed ships no src/ files of its own
    assert.deepEqual(Object.keys(score.criteria.volume).sort(), ['packages', 'src_files', 'src_loc', 'test_files', 'test_loc'].sort());
    for (const [k, v] of Object.entries(score.criteria)) {
      if (['spec_coverage', 'review_yield', 'regression', 'volume'].includes(k)) assert.notEqual(typeof v, 'boolean', `criteria.${k} must not be a bare boolean`);
    }
  } finally { rmSync(ws, { recursive: true, force: true }); }
});

// ---------- Part 3: spec-driven metrics (spec_present / spec_user_stories / spec_traceability /
// scope_match) - a bare flat workspace (no .harness-tasks at all, the `none`-arm shape), scored
// with GRAPH_BENCH_NO_JUDGE=1 for the metadata-only checks and a stubbed `claude` on PATH for
// the one test that needs an actual judge verdict (scope_match).

function flatWorkspace(files) {
  const ws = mkdtempSync(join(tmpdir(), 'score-flat-'));
  for (const [rel, content] of Object.entries({
    'package.json': JSON.stringify({ name: 'ledger', type: 'module', scripts: { test: 'node --test' } }),
    'stream.jsonl': '',
    ...files,
  })) {
    const p = join(ws, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content);
  }
  return ws;
}

test('spec_present / spec_user_stories: a PRD under docs/ with a "## User stories" section is found and its US-n ids counted', () => {
  const ws = flatWorkspace({
    'docs/ledger-prd.md': [
      '# Ledger PRD', '',
      '## User stories', '',
      '- US-1: import a bank CSV — acceptance: rows parse into typed records',
      '- US-2: categorize by user rules — acceptance: each row gets a category',
      '- US-3: report monthly spending — acceptance: totals group by month',
    ].join('\n'),
  });
  try {
    scoreLineEnv(ws, { GRAPH_BENCH_NO_JUDGE: '1' });
    const score = JSON.parse(readFileSync(`${ws}.score.json`, 'utf8'));
    assert.equal(score.criteria.spec_present, true);
    assert.equal(score.criteria.spec_user_stories, 3);
    // NO_JUDGE held every judge-backed criterion back - both the pre-existing kind (none of
    // which apply to a code-flat, non-goal, non-seam case) and the two new ones.
    assert.equal(score.criteria.spec_traceability, 'skipped');
    assert.equal(score.criteria.scope_match, 'skipped');
  } finally { rmSync(ws, { recursive: true, force: true }); }
});

test('spec_present is a real boolean but is excluded from passed/of, the same way decomposition is', () => {
  const ws = flatWorkspace({ 'docs/ledger-prd.md': '# PRD\n\n## User stories\n\n- US-1: a story\n' });
  try {
    scoreLineEnv(ws, { GRAPH_BENCH_NO_JUDGE: '1' });
    const score = JSON.parse(readFileSync(`${ws}.score.json`, 'utf8'));
    assert.equal(typeof score.criteria.spec_present, 'boolean');
    // Re-derive score.mjs's own bools filter here: a boolean-typed spec_present/spec_traceability/
    // scope_match must not have been picked up into passed/of just because they are booleans.
    const excluded = ['decomposition', 'spec_present', 'spec_traceability', 'scope_match'];
    const expectedOf = Object.entries(score.criteria).filter(([k, v]) => !excluded.includes(k) && typeof v === 'boolean').length;
    assert.equal(score.of, expectedOf);
  } finally { rmSync(ws, { recursive: true, force: true }); }
});

test('no spec in the tree: spec_present=false, spec_user_stories=0, spec_traceability=n/a (not judge-failed)', () => {
  const ws = flatWorkspace({ 'src/csv.mjs': 'export function parseCsv() {}\n' });
  try {
    scoreLineEnv(ws, { GRAPH_BENCH_NO_JUDGE: '1' });
    const score = JSON.parse(readFileSync(`${ws}.score.json`, 'utf8'));
    assert.equal(score.criteria.spec_present, false);
    assert.equal(score.criteria.spec_user_stories, 0);
    assert.equal(score.criteria.spec_traceability, 'n/a');
  } finally { rmSync(ws, { recursive: true, force: true }); }
});

test('scope_match via a stubbed judge: unrequested features reported make scope_match false and are stored in the detail', () => {
  const ws = flatWorkspace({ 'src/csv.mjs': 'export function parseCsv() {}\n' });
  const stubDir = stubClaudePath({ unrequested: ['a persistence layer'], missing: [] });
  try {
    scoreLineEnv(ws, { PATH: `${stubDir}:${process.env.PATH}`, GRAPH_BENCH_JUDGE_N: '1' });
    const score = JSON.parse(readFileSync(`${ws}.score.json`, 'utf8'));
    assert.equal(score.criteria.scope_match, false);
    assert.deepEqual(score.criteria.scope_match_detail.unrequested, ['a persistence layer']);
    assert.deepEqual(score.criteria.scope_match_detail.missing, []);
    // scope_match is a real boolean here, but is excluded from passed/of - see the bools
    // filter's exclusion list in score.mjs (the same list decomposition/spec_present are on).
    assert.equal(typeof score.criteria.scope_match, 'boolean');
  } finally { rmSync(ws, { recursive: true, force: true }); rmSync(stubDir, { recursive: true, force: true }); }
});

test('scope_match via a stubbed judge: an empty unrequested[]/missing[] makes scope_match true', () => {
  const ws = flatWorkspace({ 'src/csv.mjs': 'export function parseCsv() {}\n' });
  const stubDir = stubClaudePath({ unrequested: [], missing: [] });
  try {
    scoreLineEnv(ws, { PATH: `${stubDir}:${process.env.PATH}`, GRAPH_BENCH_JUDGE_N: '1' });
    const score = JSON.parse(readFileSync(`${ws}.score.json`, 'utf8'));
    assert.equal(score.criteria.scope_match, true);
    assert.deepEqual(score.criteria.scope_match_detail.unrequested, []);
    assert.deepEqual(score.criteria.scope_match_detail.missing, []);
  } finally { rmSync(ws, { recursive: true, force: true }); rmSync(stubDir, { recursive: true, force: true }); }
});

test('spec_traceability via a stubbed judge: a spec present with matching imports reports true, with a detail object', () => {
  const ws = flatWorkspace({
    'docs/ledger-prd.md': '# PRD\n\n## User stories\n\n- US-1: import CSV\n',
    'src/csv.mjs': "import { EXIT_CODES } from './codes.mjs';\nexport function parseCsv() {}\n",
  });
  const stubDir = stubClaudePath({ traceable: true, detail: 'package wiring matches the PRD' });
  try {
    scoreLineEnv(ws, { PATH: `${stubDir}:${process.env.PATH}`, GRAPH_BENCH_JUDGE_N: '1' });
    const score = JSON.parse(readFileSync(`${ws}.score.json`, 'utf8'));
    assert.equal(score.criteria.spec_traceability, true);
    assert.equal(typeof score.criteria.spec_traceability_detail, 'object');
    assert.equal(score.criteria.spec_traceability_detail.detail, 'package wiring matches the PRD');
  } finally { rmSync(ws, { recursive: true, force: true }); rmSync(stubDir, { recursive: true, force: true }); }
});

test('parser_names_match_codes accepts a parser that names codes through a helper call or a property read, not only a `code:` literal', () => {
  // Every plain run (C1, E0) and the teams run S1 wrote `fail('PARSE_ERROR', msg)` and scored
  // 11/12 on this criterion for a whole day - a scorer false negative that read as a shipped
  // defect (2026-09-21).
  const ws = mkdtempSync(join(tmpdir(), 'score-seam-'));
  cpSync(join(HERE, 'fixtures', 'seam-mono'), ws, { recursive: true });
  writeFileSync(join(ws, 'stream.jsonl'), '');
  const parser = join(ws, 'packages', 'parser', 'src', 'index.mjs');
  writeFileSync(parser, `import { EXIT_CODES } from '../../codes/src/index.mjs';
const fail = (code, message) => ({ ok: false, code, message });
export function parseConfig(text) {
  if (typeof text !== 'string') return fail('PARSE_ERROR', 'not a string');
  const f = {};
  for (const raw of text.split(/\\r?\\n/)) {
    const line = raw.trim(); if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('='); if (i < 0) return fail('PARSE_ERROR', 'no =');
    const k = line.slice(0, i).trim(); const v = line.slice(i + 1).trim();
    if (!['name', 'port', 'timeout'].includes(k)) return fail('UNKNOWN_FIELD', k);
    if (k !== 'name' && !/^\\d+$/.test(v)) return { ok: false, code: Object.keys(EXIT_CODES).find((n) => n === 'BAD_TYPE'), message: k };
    f[k] = v;
  }
  for (const k of ['name', 'port', 'timeout']) if (!(k in f)) return fail('MISSING_FIELD', k);
  return { ok: true, value: { name: f.name, port: +f.port, timeout: +f.timeout } };
}
`);
  const r = spawnSync('node', [join(HERE, 'score.mjs'), 'seam-silent', ws, join(ws, 'stream.jsonl')],
    { encoding: 'utf8', timeout: 60_000, env: { ...process.env, GRAPH_BENCH_NO_JUDGE: '1' } });
  const json = JSON.parse(readFileSync(`${ws}.score.json`, 'utf8'));
  assert.equal(json.criteria.parser_names_match_codes, true, (r.stdout || '') + (r.stderr || ''));
  // and a genuine drift is still caught: a name the codes table does not define
  writeFileSync(parser, readFileSync(parser, 'utf8').replace("fail('UNKNOWN_FIELD', k)", "fail('UNKNOWN_KEY', k)"));
  spawnSync('node', [join(HERE, 'score.mjs'), 'seam-silent', ws, join(ws, 'stream.jsonl')], { encoding: 'utf8', timeout: 60_000, env: { ...process.env, GRAPH_BENCH_NO_JUDGE: '1' } });
  assert.equal(JSON.parse(readFileSync(`${ws}.score.json`, 'utf8')).criteria.parser_names_match_codes, false, 'UNKNOWN_KEY is not in the table');
  rmSync(ws, { recursive: true, force: true }); rmSync(`${ws}.score.json`, { force: true });
});

// ---------- Part 4: the trap case - a tiny reference scheduler implementation, built once and
// mutated one rule at a time, so each crit.trap_* can be shown flipping true/false
// deterministically rather than trusted on faith. GRAPH_BENCH_NO_JUDGE=1 throughout (offline).

const QUEUE_SRC = (precedenceBug = false) => `
import { systemClock, fixedClock } from '../../core/src/index.mjs';
import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';

const CAP = 3;
const WINDOW_MS = 10000;
const KEY_RE = /^[a-z0-9][a-z0-9-]*$/;

export function resolveNow(nowArg, envNow) {
  const raw = nowArg ?? envNow;
  if (raw == null) return systemClock().nowMs();
  if (/^\\d+$/.test(raw)) return fixedClock(Number(raw)).nowMs();
  const t = Date.parse(raw);
  return Number.isNaN(t) ? systemClock().nowMs() : fixedClock(t).nowMs();
}

export function readState(path) {
  if (!existsSync(path)) return { jobs: [] };
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return { jobs: [] }; }
}

export function writeStateAtomic(path, state) {
  const tmp = \`\${path}.\${process.pid}.\${Date.now()}.\${Math.random().toString(36).slice(2)}.tmp\`;
  writeFileSync(tmp, JSON.stringify(state));
  renameSync(tmp, path);
}

function rateLimited(state, key, now) {
  const last = state.jobs.filter((j) => j.key === key).sort((a, b) => b.submittedAt - a.submittedAt)[0];
  return !!last && (now - last.submittedAt) < WINDOW_MS;
}
function overCap(state) {
  return state.jobs.filter((j) => j.status === 'queued' || j.status === 'running').length >= CAP;
}

export function submit(state, { id, key, priority, now }) {
  const existing = state.jobs.find((j) => j.id === id);
  if (existing) return { ok: true, code: 0, message: \`already queued \${id}\`, mutated: false };
  if (!KEY_RE.test(key)) return { ok: false, code: 2, message: \`invalid key: \${key}\` };
  ${precedenceBug
    ? `if (rateLimited(state, key, now)) return { ok: false, code: 4, message: \`rate limited: \${key}\` };
  if (overCap(state)) return { ok: false, code: 3, message: 'queue full' };`
    : `if (overCap(state)) return { ok: false, code: 3, message: 'queue full' };
  if (rateLimited(state, key, now)) return { ok: false, code: 4, message: \`rate limited: \${key}\` };`}
  state.jobs.push({ id, key, priority, status: 'queued', submittedAt: now, seq: state.jobs.length });
  return { ok: true, code: 0, message: \`queued \${id} key=\${key} priority=\${priority}\`, mutated: true };
}

export function pickNext(state) {
  const queued = state.jobs.filter((j) => j.status === 'queued');
  if (!queued.length) return null;
  queued.sort((a, b) => (b.priority - a.priority) || (a.submittedAt - b.submittedAt) || (a.seq - b.seq));
  return queued[0];
}

export function run(state) {
  const job = pickNext(state);
  if (!job) return { ok: false, code: 5, message: 'no jobs queued' };
  job.status = 'done';
  return { ok: true, code: 0, message: \`RAN \${job.id} key=\${job.key} priority=\${job.priority}\` };
}

export function status(state, id) {
  const job = state.jobs.find((j) => j.id === id);
  if (!job) return { ok: false, code: 6, message: \`unknown id: \${id}\` };
  return { ok: true, code: 0, message: \`\${job.id} \${job.status}\` };
}

export function list(state) {
  const rank = (j) => (j.status === 'queued' ? [0, -j.priority, j.submittedAt, j.seq] : [1, 0, j.submittedAt, j.seq]);
  const sorted = [...state.jobs].sort((a, b) => {
    const ra = rank(a), rb = rank(b);
    for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return ra[i] - rb[i];
    return 0;
  });
  return sorted.map((j) => \`\${j.id} \${j.key} \${j.priority} \${j.status}\`);
}
`;

const CLI_SRC = `
import { resolveNow, readState, writeStateAtomic, submit, run as runNext, status as jobStatus, list as listJobs } from '../../queue/src/index.mjs';
import { resolve } from 'node:path';

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) args[a.slice(2)] = argv[++i];
    else args._.push(a);
  }
  return args;
}

function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  const statePath = resolve(process.cwd(), args.state || '.sched-state.json');
  const now = resolveNow(args.now, process.env.SCHED_NOW);
  const state = readState(statePath);

  if (cmd === 'submit') {
    const r = submit(state, { id: args.id, key: args._[0], priority: Number(args.priority ?? 0), now });
    if (r.ok) writeStateAtomic(statePath, state);
    console.log(r.message);
    process.exitCode = r.code;
    return;
  }
  if (cmd === 'run') {
    const r = runNext(state);
    if (r.ok) writeStateAtomic(statePath, state);
    console.log(r.message);
    process.exitCode = r.code;
    return;
  }
  if (cmd === 'status') {
    const r = jobStatus(state, args._[0]);
    console.log(r.message);
    process.exitCode = r.code;
    return;
  }
  if (cmd === 'list') {
    for (const line of listJobs(state)) console.log(line);
    process.exitCode = 0;
    return;
  }
  console.error(\`unknown command: \${cmd}\`);
  process.exitCode = 1;
}

main();
`;

function buildTrapWorkspace({ precedenceBug = false } = {}) {
  const ws = mkdtempSync(join(tmpdir(), 'score-trap-'));
  cpSync(join(HERE, 'fixtures', 'trap-mono'), ws, { recursive: true });
  writeFileSync(join(ws, 'stream.jsonl'), '');
  writeFileSync(join(ws, 'packages', 'queue', 'src', 'index.mjs'), QUEUE_SRC(precedenceBug));
  mkdirSync(join(ws, 'packages', 'cli', 'bin'), { recursive: true });
  writeFileSync(join(ws, 'packages', 'cli', 'bin', 'ratesched.mjs'), CLI_SRC);
  return ws;
}

function scoreTrap(ws) {
  return spawnSync('node', [join(HERE, 'score.mjs'), 'trap', ws, join(ws, 'stream.jsonl')],
    { encoding: 'utf8', timeout: 120_000, env: { ...process.env, GRAPH_BENCH_NO_JUDGE: '1' } });
}

test('trap: a correct reference scheduler passes every trap_a..trap_h', { timeout: 120_000 }, () => {
  const ws = buildTrapWorkspace();
  try {
    const r = scoreTrap(ws);
    const json = JSON.parse(readFileSync(`${ws}.score.json`, 'utf8'));
    for (const k of ['trap_a', 'trap_b', 'trap_c', 'trap_d', 'trap_e', 'trap_f', 'trap_g', 'trap_h']) {
      assert.equal(json.criteria[k], true, `${k} — ${(r.stdout || '') + (r.stderr || '')}`);
    }
  } finally { rmSync(ws, { recursive: true, force: true }); rmSync(`${ws}.score.json`, { force: true }); }
});

test('trap: an unbuilt fixture (nothing implemented yet) reports every trap_* false, no crash', () => {
  const ws = mkdtempSync(join(tmpdir(), 'score-trap-empty-'));
  cpSync(join(HERE, 'fixtures', 'trap-mono'), ws, { recursive: true });
  writeFileSync(join(ws, 'stream.jsonl'), '');
  try {
    const r = spawnSync('node', [join(HERE, 'score.mjs'), 'trap', ws, join(ws, 'stream.jsonl')],
      { encoding: 'utf8', timeout: 60_000, env: { ...process.env, GRAPH_BENCH_NO_JUDGE: '1' } });
    assert.equal(r.status, 0, (r.stdout || '') + (r.stderr || ''));
    const json = JSON.parse(readFileSync(`${ws}.score.json`, 'utf8'));
    for (const k of ['trap_a', 'trap_b', 'trap_c', 'trap_d', 'trap_e', 'trap_f', 'trap_g', 'trap_h']) {
      assert.equal(json.criteria[k], false, k);
    }
  } finally { rmSync(ws, { recursive: true, force: true }); rmSync(`${ws}.score.json`, { force: true }); }
});

test('trap_a: reversing precedence (rate-limit checked before the cap) flips trap_a false while trap_b stays true', { timeout: 120_000 }, () => {
  const ws = buildTrapWorkspace({ precedenceBug: true });
  try {
    scoreTrap(ws);
    const json = JSON.parse(readFileSync(`${ws}.score.json`, 'utf8'));
    assert.equal(json.criteria.trap_a, false, 'precedence bug: cap should have been reported over, not rate-limit');
    assert.equal(json.criteria.trap_b, true, 'the boundary rule itself is untouched by the precedence swap');
  } finally { rmSync(ws, { recursive: true, force: true }); rmSync(`${ws}.score.json`, { force: true }); }
});
