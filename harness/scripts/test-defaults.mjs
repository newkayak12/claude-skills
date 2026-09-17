#!/usr/bin/env node
// Standing guard against the split-default defect class in `harness/`.
//
// The class: ONE option, MORE THAN ONE place deciding its default, and the places disagree.
// This repo shipped it three times in `teams/` in one week (f765c03/4999ed8, be83bbc,
// 3292a91) and twice in `graph/` (1a9d3c3, f205555). `teams/scripts/test-defaults.mjs` is
// the guard that closed it there; this is the same guard for `harness/`.
//
// Why harness cannot fix this by hoisting a shared constant, the way ordinary code would:
// the three sites are deliberately un-importable from each other.
//   - engine/pipeline.js is a Workflow script. Its own header states the rules it runs
//     under: "plain JS (no TS), no Date.now()/Math.random()/new Date(), no fs/Node APIs."
//     It cannot import a constants module.
//   - templates/meta-skeleton.js is a TEMPLATE, copied into a scratchpad and run from
//     there. An import of a harness-relative path would not resolve at its destination.
//   - engine/codex-runner.mjs is a standalone CLI with its own argv parsing.
// Independence is the design, so the literals must be duplicated. What must NOT happen is
// that they drift apart silently. That is what this file is for: the duplication stays,
// and this test is the thing that makes disagreement loud.
//
// Everything below PINS EXACT VALUES AND EXACT COUNTS. If a future change removes a site or
// changes a number, these tests go red on purpose - that is the whole mechanism. Do not
// "fix" a failure by loosening an assertion to `>=` or `length > 0`; change the pinned
// number and say in the commit message why the count moved. A guard that bends is not one.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HARNESS_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(HARNESS_ROOT, rel), 'utf8');

// ---------------------------------------------------------------------------
// The guard itself: a real function, run against real input. Not a prose claim.
//
// Given a list of {file, src} and a regex with one capture group, return every captured
// literal. Callers assert on the full list, so both "a site changed its value" and "a site
// disappeared" surface, not just disagreement.
// ---------------------------------------------------------------------------
function collectLiterals(sources, re) {
  const out = [];
  for (const { file, src } of sources) {
    for (const m of src.matchAll(new RegExp(re.source, 'g'))) out.push({ file, value: m[1] });
  }
  return out;
}

// A finding is produced when the captured literals are not all identical. Returns the
// distinct values found, sorted - empty-agreement is `[one value]`, disagreement is 2+.
function distinctValues(hits) {
  return [...new Set(hits.map((h) => h.value))].sort();
}

const MAX_RETRIES_RE = /Number\.isInteger\(\w+\.max_retries\) \? \w+\.max_retries : (\d+)/;
const CLI_MAX_RETRIES_RE = /maxRetries: (\d+)/;
const THRESHOLD_RE = /const GOAL_MATCH_THRESHOLD = (\d+)/;

// ---------------------------------------------------------------------------
// Guard A - value agreement across the three independent runtimes.
// ---------------------------------------------------------------------------

test('max_retries defaults to 2 at every site that decides it, and there are exactly three such sites', () => {
  const pipeline = { file: 'engine/pipeline.js', src: read('engine/pipeline.js') };
  const skeleton = { file: 'templates/meta-skeleton.js', src: read('templates/meta-skeleton.js') };
  const runner = { file: 'engine/codex-runner.mjs', src: read('engine/codex-runner.mjs') };

  // pipeline.js and meta-skeleton.js decide it the same way; codex-runner.mjs decides it as
  // an argv default, a different expression for the same option - hence two patterns.
  const guarded = collectLiterals([pipeline, skeleton], MAX_RETRIES_RE);
  const cli = collectLiterals([runner], CLI_MAX_RETRIES_RE);

  assert.deepStrictEqual(
    guarded.map((h) => h.file),
    ['engine/pipeline.js', 'templates/meta-skeleton.js'],
    'a site that decides max_retries was added or removed - update this list deliberately',
  );
  assert.deepStrictEqual(cli.map((h) => h.file), ['engine/codex-runner.mjs']);

  // pipeline.js decides it twice: once for the request (MAX) and once per spec, where the
  // second delegates to the first rather than re-deciding. Only the first carries a literal.
  assert.deepStrictEqual(distinctValues([...guarded, ...cli]), ['2']);
});

test('pipeline.js resolves a spec-level max_retries through MAX rather than repeating the literal', () => {
  const src = read('engine/pipeline.js');
  // This is the delegation half of the guard (the be83bbc lesson: agreeing literals are not
  // enough - a second decision site that rebuilds instead of delegating is the actual bug).
  // The per-spec resolution must fall back to MAX, never to its own `2`.
  assert.match(src, /Number\.isInteger\(spec\.max_retries\) \? spec\.max_retries : MAX/);
  assert.equal(
    (src.match(/Number\.isInteger\(\w+\.max_retries\) \? \w+\.max_retries : 2/g) || []).length,
    1,
    'pipeline.js must decide the max_retries default in exactly one place; the spec-level read delegates to MAX',
  );
});

test('the goal-level gate threshold is 90 at both sites that decide it', () => {
  const hits = collectLiterals(
    [
      { file: 'engine/pipeline.js', src: read('engine/pipeline.js') },
      { file: 'templates/meta-skeleton.js', src: read('templates/meta-skeleton.js') },
    ],
    THRESHOLD_RE,
  );
  assert.deepStrictEqual(hits.map((h) => h.file), ['engine/pipeline.js', 'templates/meta-skeleton.js']);
  assert.deepStrictEqual(distinctValues(hits), ['90']);
});

test('codex_provider defaults to "off" and exactly one place in the code decides that', () => {
  const src = read('engine/pipeline.js');
  assert.match(src, /String\(req\.codex_provider \|\| req\.codex_mode \|\| 'off'\)/);
  // Unlike max_retries and the threshold, this option has a single code decision site.
  // meta-skeleton.js and codex-runner.mjs do not route by provider at all, so they have
  // nothing to disagree with. If that changes, this count is the thing that notices.
  const all = [read('engine/pipeline.js'), read('templates/meta-skeleton.js'), read('engine/codex-runner.mjs')]
    .join('\n')
    .match(/codex_provider \|\| /g) || [];
  assert.equal(all.length, 1);
});

// ---------------------------------------------------------------------------
// Guard B - the doc layer. A default that the README states and the code contradicts is the
// same defect and is the user-visible half of it. README.md (English) and KOR.md (Korean
// mirror) must agree with the code AND with each other - this repo's rule is that the two
// move together in the same commit.
// ---------------------------------------------------------------------------

test('README.md and KOR.md both document max_retries: 2 and codex_provider "off", matching the code', () => {
  const en = read('README.md');
  const kr = read('KOR.md');
  for (const [name, doc] of [['README.md', en], ['KOR.md', kr]]) {
    assert.match(doc, /max_retries: 2,/, `${name} must show the same max_retries default the code uses`);
    assert.match(doc, /codex_provider: "off"\s+\/\/ default "off"/, `${name} must show the same codex_provider default the code uses`);
  }
});

test('goal-spec.md and fallback.md state the same 90% goal-gate threshold the code pins', () => {
  assert.match(read('goal-spec.md'), /pass requires >= 90%/);
  assert.match(read('engine/fallback.md'), /`pass` is `match_pct >= 90`\./);
  assert.match(read('README.md'), /pass requires >= 90%/);
});

// ---------------------------------------------------------------------------
// proof: the guard has been shown to FAIL on bug-shaped input.
//
// Honest note on provenance: `teams` and `graph` replay their real pre-fix source here,
// because both had a shipped instance of this defect to replay. `harness` has none - it has
// never shipped a split default, which is why this file is a guard and not a fix. So these
// proofs feed SYNTHETIC drift instead of history. That is weaker evidence about the past and
// exactly as strong about the future: what matters is that the guard function returns a
// finding when the literals disagree, and these show it does.
// ---------------------------------------------------------------------------

test('proof: the guard reports disagreement when one max_retries site drifts to 3', () => {
  const drifted = [
    { file: 'a', src: 'const MAX = Number.isInteger(req.max_retries) ? req.max_retries : 2' },
    { file: 'b', src: 'const MAX = Number.isInteger(req.max_retries) ? req.max_retries : 3' },
  ];
  const hits = collectLiterals(drifted, MAX_RETRIES_RE);
  assert.equal(hits.length, 2);
  assert.deepStrictEqual(distinctValues(hits), ['2', '3'], 'two values must be visible as a disagreement, not collapsed');
});

test('proof: the guard reports a missing site, not just a disagreeing one', () => {
  // The failure mode that a `distinctValues(...).length === 1` check alone would MISS: a site
  // deleted entirely still leaves the survivors in perfect agreement. The file-list assertion
  // in the tests above is what catches this, so it is proved here too.
  const onlyOne = [{ file: 'a', src: 'const MAX = Number.isInteger(req.max_retries) ? req.max_retries : 2' }];
  const hits = collectLiterals(onlyOne, MAX_RETRIES_RE);
  assert.deepStrictEqual(distinctValues(hits), ['2'], 'a lone survivor agrees with itself - value agreement cannot catch this');
  assert.notDeepStrictEqual(hits.map((h) => h.file), ['a', 'b'], 'only the pinned file list notices the deletion');
});

test('proof: the guard reports a drifted goal threshold', () => {
  const drifted = [
    { file: 'a', src: 'const GOAL_MATCH_THRESHOLD = 90' },
    { file: 'b', src: 'const GOAL_MATCH_THRESHOLD = 80' },
  ];
  assert.deepStrictEqual(distinctValues(collectLiterals(drifted, THRESHOLD_RE)), ['80', '90']);
});
