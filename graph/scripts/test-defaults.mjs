#!/usr/bin/env node
// Standing guard against the split-default defect class in `graph/`.
//
// The class: ONE option, MORE THAN ONE place deciding its default, and the places disagree.
// This repo shipped it three times in `teams/` (f765c03/4999ed8, be83bbc, 3292a91) and
// twice here:
//
//   1a9d3c3 - toolGraphOpen re-applied `vendor`/`allocation` defaults createRun already owned
//   f205555 - the same for context, host_vendor, host_model, native_models, model,
//             candidates, sandbox, policy
//
// Both were harmless the day they were written and would not have stayed that way: the
// second site only had to be edited once for the two to disagree, and nothing would have
// said so. `teams/scripts/test-defaults.mjs` and `harness/scripts/test-defaults.mjs` are the
// same guard for their plugins; this is graph's.
//
// THE INVARIANT, stated narrowly enough to be true:
//   graph/mcp/graph.mjs's createRun() is the SOLE owner of every run-level default.
//   The one call site that builds a run - toolGraphOpen in graph/mcp/broker.mjs - passes
//   caller values through untouched. No property in its createRun({...}) literal may apply
//   a `||` fallback or a `? :` default.
// Three properties are NOT defaults and are named exceptions below, each with its reason.
// This is narrower than "toolGraphOpen declares nothing" - it declares `cwd` and `request`,
// which are required arguments being normalized, not options being defaulted.
//
// Everything below PINS EXACT NAMES AND EXACT COUNTS. If a field is added or removed these
// tests go red on purpose - that is the mechanism. Do not "fix" a failure by loosening an
// assertion to `>=` or `length > 0`; change the pinned set and say in the commit message why
// it moved. A guard that bends is not a guard.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BROKER = join(REPO, 'graph', 'mcp', 'broker.mjs');
const GRAPH = join(REPO, 'graph', 'mcp', 'graph.mjs');

const atRevision = (rev, path) =>
  execFileSync('git', ['show', `${rev}:${path}`], { cwd: REPO, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });

// ---------------------------------------------------------------------------
// The guard itself: a real function, run against real source text. Not a prose claim.
//
// Pull the `createRun({ ... })` argument literal out of a broker source string and return
// one entry per property, with the raw expression its value is written as. Comment lines and
// blank lines are dropped; nesting is tracked so a nested object or call does not end the
// scan early.
// ---------------------------------------------------------------------------
function createRunProperties(src) {
  const start = src.indexOf('createRun({');
  if (start === -1) throw new Error('no createRun({ ... }) call found in this source');
  let i = src.indexOf('{', start);
  let depth = 0;
  let end = -1;
  for (let j = i; j < src.length; j += 1) {
    const c = src[j];
    if (c === '{' || c === '(' || c === '[') depth += 1;
    else if (c === '}' || c === ')' || c === ']') {
      depth -= 1;
      if (depth === 0) { end = j; break; }
    }
  }
  if (end === -1) throw new Error('unbalanced createRun({ ... }) literal');

  const props = [];
  let buf = '';
  let d = 0;
  for (const line of src.slice(i + 1, end).split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('//')) continue;
    buf += (buf ? ' ' : '') + t;
    for (const c of t) {
      if (c === '{' || c === '(' || c === '[') d += 1;
      else if (c === '}' || c === ')' || c === ']') d -= 1;
    }
    if (d === 0 && buf.endsWith(',')) {
      const body = buf.slice(0, -1);
      const colon = body.indexOf(':');
      props.push(colon === -1
        ? { name: body.trim(), expr: body.trim() }          // shorthand, e.g. `cwd,`
        : { name: body.slice(0, colon).trim(), expr: body.slice(colon + 1).trim() });
      buf = '';
    }
  }
  return props;
}

// A property "decides a default" when its expression applies a fallback: `||` or a ternary.
// That is exactly the shape 1a9d3c3 and f205555 removed.
function decidesADefault(expr) {
  return expr.includes('||') || expr.includes('?');
}

// The findings the guard reports for a given broker source.
function splitDefaultFindings(src, allowed) {
  return createRunProperties(src)
    .filter((p) => !allowed.has(p.name) && decidesADefault(p.expr))
    .map((p) => p.name);
}

// Named exceptions. Each is NOT an option with a default, and each says why. Anything not on
// this list that applies a fallback is a finding.
const NOT_DEFAULTS = new Map([
  // Required argument, normalized (resolve) rather than defaulted. Shorthand `cwd,`.
  ['cwd', 'required arg, resolved not defaulted'],
  // Required argument, coerced with String(). No fallback value exists for it.
  ['request', 'required arg, coerced not defaulted'],
  // `a.isolated === true` is a boolean coercion hardcoded identically on both sides. There is
  // no second literal for the two sites to disagree on, so it is not a member of this class.
  // Removing it would be provably equivalent, but churn without a defect to justify it.
  ['isolated', 'boolean coercion, identical on both sides, no value to drift'],
]);

// ---------------------------------------------------------------------------
// Guard: the live source is clean.
// ---------------------------------------------------------------------------

test('graph has exactly one createRun call site, and it is toolGraphOpen', () => {
  // The invariant above is simple only because there is a single place that builds a run.
  // If a second appears, this guard covers one of two and must be extended - which is what
  // this test exists to force. graph.mjs holds the definition; broker.mjs the sole call.
  const broker = readFileSync(BROKER, 'utf8');
  assert.equal((broker.match(/createRun\(\{/g) || []).length, 1);
  assert.match(broker.slice(0, broker.indexOf('createRun({')).split('\n').reverse().find((l) => l.startsWith('async function ') || l.startsWith('function ')), /^async function toolGraphOpen\(/);
  assert.match(readFileSync(GRAPH, 'utf8'), /^export function createRun\(opts\) \{$/m);
});

test('toolGraphOpen passes every run-level option through - createRun is the sole owner of their defaults', () => {
  const findings = splitDefaultFindings(readFileSync(BROKER, 'utf8'), new Set(NOT_DEFAULTS.keys()));
  assert.deepStrictEqual(findings, [], `these properties decide a default a second time: ${findings.join(', ')}`);
});

test('the exact set of properties toolGraphOpen hands createRun is pinned', () => {
  // Pinned, not counted. A field added here without a matching createRun default, or one
  // silently dropped, is the same class of defect from the other direction - the caller can
  // pass it and nothing reads it (the f765c03/4999ed8 shape).
  const names = createRunProperties(readFileSync(BROKER, 'utf8')).map((p) => p.name);
  assert.deepStrictEqual(names, [
    'cwd', 'request', 'context', 'vendor', 'allocation', 'host_vendor', 'host_model',
    'native_models', 'model', 'policy', 'candidates', 'sandbox', 'isolated', 'max_retries',
  ]);
});

test('createRun declares a default for every option toolGraphOpen forwards', () => {
  // The delegation half. be83bbc is why value agreement alone is not enough: its literals
  // already agreed, and the bug was a boundary rebuilding instead of reading the resolved
  // layer. Here the mirror risk is a forwarded option createRun has no default for, so the
  // value silently becomes undefined on every run that omits it.
  // Scoped to createRun's own body, so an `opts.x` somewhere else in graph.mjs cannot vouch
  // for a field createRun itself ignores.
  const graph = readFileSync(GRAPH, 'utf8');
  const body = graph.slice(graph.indexOf('export function createRun(opts) {'));
  const forwarded = createRunProperties(readFileSync(BROKER, 'utf8')).map((p) => p.name);
  const missing = forwarded.filter((n) => !new RegExp(`opts\\.${n}\\b`).test(body.slice(0, body.indexOf('\n}'))));
  assert.deepStrictEqual(missing, [], `createRun never reads: ${missing.join(', ')}`);
});

// ---------------------------------------------------------------------------
// proof: the guard has been shown to FAIL on the real bugs it exists to prevent.
//
// These replay the ACTUAL pre-fix source of 1a9d3c3 and f205555 through the guard function,
// rather than synthetic drift. If the guard is ever weakened, these go red, because the
// historical source is fixed and its defects are known.
// ---------------------------------------------------------------------------

test('proof: the guard flags 1a9d3c3\'s pre-fix source - vendor and allocation defaulted twice', () => {
  const before = atRevision('1a9d3c3^', 'graph/mcp/broker.mjs');
  const findings = splitDefaultFindings(before, new Set(NOT_DEFAULTS.keys()));
  assert.ok(findings.includes('vendor'), `expected vendor among ${findings.join(', ')}`);
  assert.ok(findings.includes('allocation'), `expected allocation among ${findings.join(', ')}`);
});

test('proof: the guard flags f205555\'s pre-fix source - eight more fields defaulted twice', () => {
  const before = atRevision('f205555^', 'graph/mcp/broker.mjs');
  const findings = splitDefaultFindings(before, new Set(NOT_DEFAULTS.keys()));
  assert.deepStrictEqual(findings.sort(), [
    'candidates', 'context', 'host_model', 'host_vendor', 'model', 'native_models', 'policy', 'sandbox',
  ]);
});

test('proof: the guard flags a single reintroduced default, not only a wholesale regression', () => {
  // The realistic future mistake is one field, not ten. Feed the live source with exactly one
  // fallback put back and confirm the guard names that one field and nothing else.
  const live = readFileSync(BROKER, 'utf8');
  const mutated = live.replace('    vendor: a.vendor,', "    vendor: a.vendor || 'auto',");
  assert.notEqual(mutated, live, 'mutation did not apply - the guard proof is not testing what it claims');
  assert.deepStrictEqual(splitDefaultFindings(mutated, new Set(NOT_DEFAULTS.keys())), ['vendor']);
});

test('proof: the exceptions are exceptions, not holes - each still parses as a fallback-free or named case', () => {
  const props = createRunProperties(readFileSync(BROKER, 'utf8'));
  for (const [name, why] of NOT_DEFAULTS) {
    const p = props.find((x) => x.name === name);
    assert.ok(p, `${name} is allowlisted but no longer forwarded - drop it from NOT_DEFAULTS (${why})`);
  }
  // The allowlist is INERT today, and that is asserted rather than assumed. None of the three
  // is even fallback-shaped: `cwd,` is shorthand, `request` is String(a.request), and
  // `isolated` is `a.isolated === true` - an `=== true` coercion, which decidesADefault does
  // not and should not treat as a default, because there is no second value to disagree on.
  // So the real guard is decidesADefault alone; NOT_DEFAULTS documents intent and is the
  // place to look if one of these three ever grows a `||`. When that happens this assertion
  // goes red FIRST, before the allowlist can quietly start hiding a genuine default - which
  // is the failure mode an allowlist normally introduces.
  assert.deepStrictEqual(
    [...NOT_DEFAULTS.keys()].filter((n) => decidesADefault(props.find((x) => x.name === n).expr)),
    [],
  );
});
