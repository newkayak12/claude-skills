import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Regression guard for one bug class that shipped three times in one week:
//
//   f765c03 - taskmanager.mjs's child_opts read raw args with its OWN hardcoded 90/2
//             fallbacks while the task-level fields read the resolved team.json layer T.
//   4999ed8 - goal_judges defaulted to 2 at team_open's tool boundary and 1 in createRun,
//             and taskmanager.mjs never threaded the argument through at all, so no caller
//             could raise a child run's judge count above 1.
//   be83bbc - team_open's toolGraphOpen built vendor/allocation/goal_threshold/max_retries
//             from raw args with literals that merely COINCIDED with TEAM_DEFAULTS, so
//             .claude/team.json was invisible on that path entirely.
//
// One option, more than one place deciding its default. This suite has two independent
// guards against it:
//
//   A. VALUE AGREEMENT - every site that declares a base/library-level literal default for
//      the same option (teamconfig.mjs's TEAM_DEFAULTS, createRun's own bare defaults, and
//      the handful of read-time "malformed data" fallbacks) must agree on the value. This
//      is the guard be83bbc would NOT have needed - its literals already agreed - which is
//      exactly why guard B exists too.
//   B. DELEGATION - at an MCP tool boundary (team_open, tm_open) that sits ON TOP of a
//      resolved team.json layer T, a tracked option must be read FROM T, never rebuilt from
//      raw arguments with its own fallback. A site that does the latter is the f765c03/
//      be83bbc shape even when today its literal happens to match T's.
//
// goal_judges is not a TEAM_DEFAULTS key (team.json cannot pin it), so guard B does not
// apply to it. Guard C below documents its one legitimate value split instead (commit
// 858e0b9, reconfirmed by 4999ed8) and separately proves the 4999ed8 shape - an argument
// silently never threaded through - is still caught.
//
// Every regex here is anchored to the literal source text as it reads today, quoted in full
// in the assertion messages that follow. Where a test claims "N sites", N is a specific
// literal, not a re-derivation of whatever the loop happens to find - so emptying a
// production array (or renaming a field so a regex stops matching) drops the count and this
// suite fails, rather than silently checking nothing. That failure mode is the reason this
// file exists: a coverage audit this week found guards of exactly the shape this comment is
// warning against.

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const FILES = {
  teamconfig: join(REPO_ROOT, 'teams/mcp/teamconfig.mjs'),
  teamsGraph: join(REPO_ROOT, 'teams/mcp/graph.mjs'),
  teamsBroker: join(REPO_ROOT, 'teams/mcp/broker.mjs'),
  teamsTaskmanager: join(REPO_ROOT, 'teams/mcp/taskmanager.mjs'),
  graphGraph: join(REPO_ROOT, 'graph/mcp/graph.mjs'),
  graphBroker: join(REPO_ROOT, 'graph/mcp/broker.mjs'),
  teamsTickets: join(REPO_ROOT, 'teams/mcp/tickets.mjs'),
  teamsDocs: join(REPO_ROOT, 'teams/mcp/docs.mjs'),
};

function src(key) {
  return readFileSync(FILES[key], 'utf8');
}

function countSubstr(text, substr) {
  return text.split(substr).length - 1;
}

// Every capture of `re` (which must carry the `g` flag) against `text`, labeled for the
// failure message. Used for guard A: each call names one place that declares a default.
function collect(text, re, label) {
  return [...text.matchAll(re)].map((m) => ({ label, value: m[1] }));
}

function describeSites(sites) {
  return sites.map((s) => `${s.label}=${JSON.stringify(s.value)}`).join(', ');
}

// Guard A: every site in `sites` must have declared the same value, and there must be at
// least `minSites` of them (the vacuity floor - too few means the regexes stopped matching
// real code, not that the option lost its duplicate declarations).
function checkAgreement(option, sites, minSites, expectedValue) {
  const problems = [];
  if (sites.length < minSites) {
    problems.push(`found only ${sites.length} declared-default site(s) for "${option}" (expected at least ${minSites}): ${describeSites(sites)}`);
  }
  const distinct = [...new Set(sites.map((s) => s.value))];
  if (distinct.length > 1) {
    problems.push(`"${option}" defaults disagree across sites: ${describeSites(sites)}`);
  } else if (distinct.length === 1 && String(distinct[0]) !== String(expectedValue)) {
    problems.push(`"${option}" default drifted to ${JSON.stringify(distinct[0])} (expected ${JSON.stringify(expectedValue)}) at: ${describeSites(sites)}`);
  }
  return { ok: problems.length === 0, message: problems.join('; ') };
}

// ---------- site extraction, one function per option so a proof test can feed in a mutated string ----------

// toolGraphOpen (graph/mcp/broker.mjs) used to be a 4th site here, declaring its own
// `a.vendor || 'auto'` / `a.allocation || 'ordered'` fallback that only agreed with the
// other three by coincidence - the same latent shape as be83bbc, just never triggered
// since graph has no config layer to bypass. It now passes a.vendor/a.allocation straight
// through and lets createRun (graph/mcp/graph.mjs) be the only site deciding either
// default, so it is intentionally absent from these lists - there is nothing left there
// to agree or disagree.
function vendorSites(teamconfigSrc, teamsGraphSrc, graphGraphSrc) {
  return [
    ...collect(teamconfigSrc, /^\s*vendor:\s*'([^']+)',\s*$/gm, 'TEAM_DEFAULTS (teams/mcp/teamconfig.mjs)'),
    ...collect(teamsGraphSrc, /vendor:\s*opts\.vendor\s*\|\|\s*'([^']+)',/g, 'createRun (teams/mcp/graph.mjs)'),
    ...collect(graphGraphSrc, /vendor:\s*opts\.vendor\s*\|\|\s*'([^']+)',/g, 'createRun (graph/mcp/graph.mjs)'),
  ];
}

function allocationSites(teamconfigSrc, teamsGraphSrc, graphGraphSrc) {
  return [
    ...collect(teamconfigSrc, /^\s*allocation:\s*'([^']+)',\s*$/gm, 'TEAM_DEFAULTS (teams/mcp/teamconfig.mjs)'),
    ...collect(teamsGraphSrc, /allocation:\s*opts\.allocation\s*\|\|\s*'([^']+)',/g, 'createRun (teams/mcp/graph.mjs)'),
    ...collect(graphGraphSrc, /allocation:\s*opts\.allocation\s*\|\|\s*'([^']+)',/g, 'createRun (graph/mcp/graph.mjs)'),
  ];
}

function maxRetriesSites(teamconfigSrc, teamsGraphSrc, graphGraphSrc) {
  return [
    ...collect(teamconfigSrc, /^\s*max_retries:\s*(\d+),\s*$/gm, 'TEAM_DEFAULTS (teams/mcp/teamconfig.mjs)'),
    ...collect(teamsGraphSrc, /max_retries:\s*Number\.isInteger\(opts\.max_retries\)\s*\?\s*opts\.max_retries\s*:\s*(\d+),/g, 'createRun (teams/mcp/graph.mjs)'),
    ...collect(graphGraphSrc, /max_retries:\s*Number\.isInteger\(opts\.max_retries\)\s*\?\s*opts\.max_retries\s*:\s*(\d+),/g, 'createRun (graph/mcp/graph.mjs)'),
  ];
}

function goalThresholdSites(teamconfigSrc, teamsGraphSrc, taskmanagerSrc, teamsBrokerSrc) {
  return [
    ...collect(teamconfigSrc, /^\s*goal_threshold:\s*(\d+),\s*$/gm, 'TEAM_DEFAULTS (teams/mcp/teamconfig.mjs)'),
    ...collect(teamsGraphSrc, /goal_threshold:\s*Number\.isInteger\(opts\.goal_threshold\)\s*\?\s*opts\.goal_threshold\s*:\s*(\d+),/g, 'createRun (teams/mcp/graph.mjs)'),
    ...collect(taskmanagerSrc, /Number\.isInteger\(task\.goal_threshold\)\s*\?\s*task\.goal_threshold\s*:\s*(\d+)/g, 'task.goal_threshold read-time fallback (teams/mcp/taskmanager.mjs)'),
    ...collect(teamsBrokerSrc, /Number\.isInteger\(run\.goal_threshold\)\s*\?\s*run\.goal_threshold\s*:\s*(\d+)/g, 'run.goal_threshold read-time fallback (teams/mcp/broker.mjs)'),
  ];
}

function driverRestartsSites(teamconfigSrc, taskmanagerSrc) {
  return [
    ...collect(teamconfigSrc, /^\s*driver_restarts:\s*(\d+),\s*$/gm, 'TEAM_DEFAULTS (teams/mcp/teamconfig.mjs)'),
    ...collect(taskmanagerSrc, /Number\.isInteger\(task\.driver_restarts\)\s*\?\s*task\.driver_restarts\s*:\s*(\d+)/g, 'task.driver_restarts read-time fallback (teams/mcp/taskmanager.mjs)'),
  ];
}

// ---------- guard A tests: value agreement ----------

test('vendor default ("auto") agrees across every declared site, teams and graph alike', () => {
  const sites = vendorSites(src('teamconfig'), src('teamsGraph'), src('graphGraph'));
  const r = checkAgreement('vendor', sites, 3, 'auto');
  assert.ok(r.ok, r.message);
});

test('allocation default ("ordered") agrees across every declared site, teams and graph alike', () => {
  const sites = allocationSites(src('teamconfig'), src('teamsGraph'), src('graphGraph'));
  const r = checkAgreement('allocation', sites, 3, 'ordered');
  assert.ok(r.ok, r.message);
});

test('max_retries default (2) agrees across every declared site, teams and graph alike', () => {
  const sites = maxRetriesSites(src('teamconfig'), src('teamsGraph'), src('graphGraph'));
  const r = checkAgreement('max_retries', sites, 3, '2');
  assert.ok(r.ok, r.message);
});

test('goal_threshold default (90) agrees across every declared site, including the read-time fallbacks', () => {
  const sites = goalThresholdSites(src('teamconfig'), src('teamsGraph'), src('teamsTaskmanager'), src('teamsBroker'));
  const r = checkAgreement('goal_threshold', sites, 4, '90');
  assert.ok(r.ok, r.message);
});

test('driver_restarts default (2) agrees across every declared site', () => {
  const sites = driverRestartsSites(src('teamconfig'), src('teamsTaskmanager'));
  const r = checkAgreement('driver_restarts', sites, 3, '2');
  assert.ok(r.ok, r.message);
});

// ---------- guard B: MCP tool boundaries must delegate to T, never rebuild from raw args ----------

// Each entry names an exact delegation substring that must appear at least `min` times in
// the given source. A site that reverts to reading `a.<key>` with its own literal fallback
// (the f765c03/be83bbc shape) makes this substring's count drop below `min` even though the
// option's plain VALUE may still coincide with team.json's default - which is exactly the
// case guard A's value-agreement check cannot see on its own.
const DELEGATION_EXPECTATIONS = [
  { file: 'teamsBroker', label: 'team_open', substr: 'vendor: T.vendor,', min: 1 },
  { file: 'teamsBroker', label: 'team_open', substr: 'allocation: T.allocation,', min: 1 },
  { file: 'teamsBroker', label: 'team_open', substr: 'goal_threshold: T.goal_threshold,', min: 1 },
  { file: 'teamsBroker', label: 'team_open', substr: 'max_retries: T.max_retries,', min: 1 },
  // taskmanager.mjs declares max_retries/goal_threshold twice: once for the task itself,
  // once for child_opts (the exact pair f765c03 split apart - the task-level one was
  // already reading T, only child_opts had drifted to its own 90/2).
  { file: 'teamsTaskmanager', label: 'tm_open (task + child_opts)', substr: 'max_retries: T.max_retries,', min: 2 },
  { file: 'teamsTaskmanager', label: 'tm_open (task + child_opts)', substr: 'goal_threshold: T.goal_threshold,', min: 2 },
  { file: 'teamsTaskmanager', label: 'tm_open (task-level)', substr: 'driver_restarts: T.driver_restarts,', min: 1 },
  { file: 'teamsTaskmanager', label: 'tm_open (child_opts)', substr: 'vendor: T.vendor,', min: 1 },
  { file: 'teamsTaskmanager', label: 'tm_open (child_opts)', substr: 'allocation: T.allocation,', min: 1 },
];

function checkDelegation(sourcesByFile) {
  const problems = [];
  for (const e of DELEGATION_EXPECTATIONS) {
    const n = countSubstr(sourcesByFile[e.file], e.substr);
    if (n < e.min) {
      problems.push(`${e.label} (${e.file}) should delegate "${e.substr}" at least ${e.min}x, found ${n}x`);
    }
  }
  return { ok: problems.length === 0, message: problems.join('; ') };
}

test('team_open and tm_open delegate vendor/allocation/goal_threshold/max_retries/driver_restarts to T, never rebuilding them from raw args', () => {
  const r = checkDelegation({ teamsBroker: src('teamsBroker'), teamsTaskmanager: src('teamsTaskmanager') });
  assert.ok(r.ok, r.message);
});

// ---------- guard C: goal_judges' one documented, intentional value split ----------

// goal_judges is not a TEAM_DEFAULTS key - team.json cannot pin it (teamconfig.mjs's CHECK
// table has no entry for it), so guard B's delegate-to-T rule does not apply. Its 1-vs-2
// split is commit 858e0b9's deliberate choice, reconfirmed by 4999ed8: createRun's bare
// default (and everything that calls it directly, including tm_open's per-package child
// runs) stays 1 for backward compatibility; team_open's own MCP tool boundary defaults a
// FRESH run to 2. Both literal lines below must also still read their own `.goal_judges`
// argument - losing that (keeping the literal, dropping the argument) is exactly 4999ed8's
// bug: tm_open never threaded the argument through, so no caller could ever raise it.
const GOAL_JUDGES_ONE = 'goal_judges: Number.isInteger(opts.goal_judges) && opts.goal_judges > 0 ? opts.goal_judges : 1,';
const GOAL_JUDGES_TWO_AT_BROKER = 'goal_judges: Number.isInteger(a.goal_judges) && a.goal_judges > 0 ? a.goal_judges : 2,';
const GOAL_JUDGES_ONE_AT_TASKMANAGER = 'goal_judges: Number.isInteger(a.goal_judges) && a.goal_judges > 0 ? a.goal_judges : 1,';

function checkGoalJudgesException(teamsGraphSrc, teamsBrokerSrc, teamsTaskmanagerSrc) {
  const problems = [];
  if (!teamsGraphSrc.includes(GOAL_JUDGES_ONE)) {
    problems.push('createRun (teams/mcp/graph.mjs) no longer defaults goal_judges to 1 while reading opts.goal_judges - the documented exception (858e0b9) is stale');
  }
  if (!teamsBrokerSrc.includes(GOAL_JUDGES_TWO_AT_BROKER)) {
    problems.push('team_open (teams/mcp/broker.mjs) no longer defaults goal_judges to 2 while reading a.goal_judges - the documented exception (858e0b9) is stale');
  }
  if (!teamsTaskmanagerSrc.includes(GOAL_JUDGES_ONE_AT_TASKMANAGER)) {
    problems.push('tm_open (teams/mcp/taskmanager.mjs child_opts) no longer defaults goal_judges to 1 while reading a.goal_judges - this is the 4999ed8 shape: an argument silently never threaded through, pinning every child run to whatever literal remains with no escape hatch');
  }
  return { ok: problems.length === 0, message: problems.join('; ') };
}

test('goal_judges: createRun/tm_open default to 1, team_open defaults to 2 (858e0b9, reconfirmed by 4999ed8) - and every site still reads its own override argument', () => {
  const r = checkGoalJudgesException(src('teamsGraph'), src('teamsBroker'), src('teamsTaskmanager'));
  assert.ok(r.ok, r.message);
});

// ---------- graph/mcp structural-immunity canary ----------

// The team-lead's brief: graph has one entry point, one createRun call site, and no
// team.json config layer, so it has been structurally immune to this bug class - but only
// as long as it never grows the goal-gate/multi-judge feature that made teams vulnerable.
// This turns that fact into an enforced invariant: the day graph/mcp declares goal_threshold
// or goal_judges anywhere, this fails and says so, rather than silently going uncovered.
test('graph/mcp has no goal_threshold or goal_judges option - the multi-judge goal gate does not exist there, so it cannot yet diverge on those defaults', () => {
  const graphGraphSrc = src('graphGraph');
  const graphBrokerSrc = src('graphBroker');
  assert.ok(!graphGraphSrc.includes('goal_threshold') && !graphGraphSrc.includes('goal_judges'),
    'graph/mcp/graph.mjs now declares a goal-gate option - graph/mcp is no longer structurally immune to the split-default bug class; extend goalThresholdSites/checkGoalJudgesException to cover it');
  assert.ok(!graphBrokerSrc.includes('goal_threshold') && !graphBrokerSrc.includes('goal_judges'),
    'graph/mcp/broker.mjs now declares a goal-gate option - graph/mcp is no longer structurally immune to the split-default bug class; extend goalThresholdSites/checkGoalJudgesException to cover it');
});

// ---------- proofs: each guard actually fails on the historical bug shape it claims to catch ----------
//
// Every mutation below is a pure string transform of a freshly-read, real production file -
// never a hand-built fixture, and never a write back to disk. This repo is a shared
// worktree with other agents actively editing taskmanager.mjs and broker.mjs; touching them
// on disk even briefly risks discarding a concurrent in-progress edit, so the "revert" step
// is simply that the mutated string only ever lives in a local variable.

test('proof: the f765c03 shape (child_opts rebuilding max_retries/goal_threshold from raw args) makes the delegation guard fail; the real source passes', () => {
  const realTaskmanager = src('teamsTaskmanager');
  const realBroker = src('teamsBroker');
  assert.ok(checkDelegation({ teamsBroker: realBroker, teamsTaskmanager: realTaskmanager }).ok, 'sanity: real source must pass before mutating it');

  const mutatedTaskmanager = realTaskmanager
    .replaceAll('max_retries: T.max_retries,', 'max_retries: Number.isInteger(a.max_retries) ? a.max_retries : 2,')
    .replaceAll('goal_threshold: T.goal_threshold,', 'goal_threshold: Number.isInteger(a.goal_threshold) ? a.goal_threshold : 90,');
  assert.notEqual(mutatedTaskmanager, realTaskmanager, 'mutation target text was not found in teams/mcp/taskmanager.mjs - update this proof to match current source');

  const r = checkDelegation({ teamsBroker: realBroker, teamsTaskmanager: mutatedTaskmanager });
  assert.ok(!r.ok, 'the delegation guard should FAIL once taskmanager.mjs stops reading T.max_retries/T.goal_threshold and rebuilds them from raw args instead - it did not, so this guard cannot catch the f765c03 bug');
});

test('proof: the be83bbc shape (team_open rebuilding vendor/allocation/goal_threshold/max_retries from raw args) makes the delegation guard fail; the real source passes', () => {
  const realTaskmanager = src('teamsTaskmanager');
  const realBroker = src('teamsBroker');
  assert.ok(checkDelegation({ teamsBroker: realBroker, teamsTaskmanager: realTaskmanager }).ok, 'sanity: real source must pass before mutating it');

  const mutatedBroker = realBroker
    .replace('vendor: T.vendor,', "vendor: a.vendor || 'auto',")
    .replace('allocation: T.allocation,', "allocation: a.allocation || 'ordered',")
    .replace('goal_threshold: T.goal_threshold,', 'goal_threshold: Number.isInteger(a.goal_threshold) ? a.goal_threshold : 90,')
    .replace('max_retries: T.max_retries,', 'max_retries: Number.isInteger(a.max_retries) ? a.max_retries : 2,');
  assert.notEqual(mutatedBroker, realBroker, 'mutation target text was not found in teams/mcp/broker.mjs - update this proof to match current source');

  const r = checkDelegation({ teamsBroker: mutatedBroker, teamsTaskmanager: realTaskmanager });
  assert.ok(!r.ok, 'the delegation guard should FAIL once team_open stops reading T.vendor/T.allocation/T.goal_threshold/T.max_retries and rebuilds them from raw args instead - it did not, even though be83bbc\'s literals happened to coincide with team.json\'s, which is exactly why guard A (value agreement alone) would have missed this bug');

  // Confirm guard A alone really would have missed it: the rebuilt literals still agree in
  // VALUE with every other site, so the value-agreement check stays green on the mutation -
  // this is the concrete demonstration that be83bbc needed guard B, not guard A. (Sites are
  // teamconfig/teams-graph/graph-graph only - graph/mcp/broker.mjs no longer declares a
  // vendor default of its own, so it is not part of this mutation or this count.)
  const stillAgrees = checkAgreement('vendor', vendorSites(src('teamconfig'), src('teamsGraph'), src('graphGraph')), 3, 'auto');
  assert.ok(stillAgrees.ok, 'sanity: be83bbc\'s literals coincided with team.json\'s default, so guard A sees no disagreement even on the buggy shape - confirming guard A alone is not sufficient here');
});

test('proof: the 4999ed8 shape (tm_open never threading goal_judges through) makes the goal_judges guard fail; the real source passes', () => {
  const realTaskmanager = src('teamsTaskmanager');
  const realGraph = src('teamsGraph');
  const realBroker = src('teamsBroker');
  assert.ok(checkGoalJudgesException(realGraph, realBroker, realTaskmanager).ok, 'sanity: real source must pass before mutating it');

  const mutatedTaskmanager = realTaskmanager.replace(GOAL_JUDGES_ONE_AT_TASKMANAGER, 'goal_judges: 1,');
  assert.notEqual(mutatedTaskmanager, realTaskmanager, 'mutation target text was not found in teams/mcp/taskmanager.mjs - update this proof to match current source');

  const r = checkGoalJudgesException(realGraph, realBroker, mutatedTaskmanager);
  assert.ok(!r.ok, 'the goal_judges guard should FAIL once tm_open stops reading a.goal_judges and hardcodes the literal instead - it did not, so this guard cannot catch the 4999ed8 bug (an argument silently never threaded through, with no way for a caller to raise a package\'s judge count)');
});

// ---------- guard E: every declared output-schema field must have a producer ----------
//
// A sibling bug class to A/B/C above, same underlying shape: a declaration and the behaviour
// behind it disagree, and nothing catches it. Where A/B/C are about one OPTION's default value
// agreeing across sites, E is about one FIELD's presence in an output schema being backed by
// code that can actually produce it. It shipped once: taskmanager.mjs's NEXT_SCHEMA and
// VERDICT_SCHEMA both declared `delegate` (and NEXT_SCHEMA's `state` enum listed `'delegated'`),
// but `delegateIfSmall` (taskmanager.mjs) always calls `openSRun` and returns
// `task_state: 's_run'` - nothing ever set `delegate`. Fixed in the commit this guard's proof
// test targets; this guard is general on purpose, so the next field that goes the same way
// fails a test instead of sitting undetected the way `delegate` did.
//
// A field counts as having a producer if, anywhere in the file OUTSIDE the schema's own
// declaration and outside comments, it appears as:
//   1. a JS object-literal key:      fieldName: <value>        (most fields)
//   2. a JSON-shaped CONTRACT key:   "fieldName": <value>      (a field a fresh agent's payload
//                                    carries, spread through via `{...payload}` in toolSubmit -
//                                    CONTRACT's "Return JSON" templates are where that shape is
//                                    documented, in JSON's quoted-key syntax, not JS's)
//   3. a dot-assignment:             <expr>.fieldName = <value>  (a few fields, e.g. gap_count
//                                    and missing_verdict, are computed onto an object after
//                                    it's built, not declared as a literal key)
// This is deliberately textual, not a real evaluator: a field produced only through some other
// indirection (a computed key, a renamed destructure) would still read as "unreachable" here and
// need the explicit ALLOWLIST below, with the reason a human can check. An empty allowlist today
// means every current field is producible by one of the three patterns above - proven per-field,
// not assumed.

function stripComments(src) {
  let out = '';
  let inStr = null;
  for (let i = 0; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (inStr) {
      out += c;
      if (c === '\\') { out += n; i++; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { inStr = c; out += c; continue; }
    if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') i++; out += '\n'; continue; }
    if (c === '/' && n === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++; i++; out += '  '; continue; }
    out += c;
  }
  return out;
}

// Balanced-brace extraction from `openIdx` (the index of an opening `{`), string-literal-aware
// so a brace quoted inside a description (there are none today, but a future one could add one)
// can't desync the depth count.
function extractBalanced(src, openIdx) {
  let depth = 0, inStr = null;
  for (let i = openIdx; i < src.length; i++) {
    const c = src[i];
    if (inStr) {
      if (c === '\\') { i++; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { inStr = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return src.slice(openIdx, i + 1); }
  }
  throw new Error(`unbalanced braces extracting from index ${openIdx}`);
}

function findSchemaLiteral(src, constName) {
  const m = new RegExp(`const ${constName}\\s*=\\s*(\\{)`).exec(src);
  if (!m) throw new Error(`"const ${constName} = {" not found - schema renamed or restructured; update this guard`);
  return extractBalanced(src, m.index + m[0].length - 1);
}

// Object.keys(schema.properties) reads the schema's OWN notion of its top-level fields - not a
// regex re-deriving what "looks like" a field, so a nested field (e.g. NEXT_SCHEMA.ready's own
// item shape) is never mistaken for a top-level one. The schema literal has no free variables
// (every value is a literal string/array/object), so evaluating it is exact, not approximate.
function schemaKeys(rawLiteral) {
  const schema = new Function(`return ${rawLiteral}`)();
  return Object.keys(schema.properties);
}

// Fields with no textual producer anywhere else in this file, by design: each entry names why,
// so an empty allowlist (the state today) is a claim this test proves, not an assumption.
const SCHEMA_FIELD_ALLOWLIST = {};

// Removes each schema's own literal text from a comment-stripped copy of `fullSrc`, so a
// field's declaration inside its own schema can never count as its own producer, then checks
// every declared field's producer patterns against what's left. Throws if a schema's
// comment-stripped literal can't be found verbatim in the comment-stripped source (extraction
// drifted from stripComments) rather than silently checking nothing.
function checkSchemaReachability(fullSrc, schemaNames, allowlist = SCHEMA_FIELD_ALLOWLIST) {
  const noComments = stripComments(fullSrc);
  let producerText = noComments;
  const allKeys = {};
  for (const name of schemaNames) {
    allKeys[name] = schemaKeys(findSchemaLiteral(fullSrc, name));
    const strippedLiteral = findSchemaLiteral(noComments, name);
    const before = producerText;
    producerText = producerText.split(strippedLiteral).join('');
    if (producerText === before) throw new Error(`${name}'s literal did not appear in the comment-stripped source - extraction mismatch, not "no comments to strip"`);
  }
  const reachable = (field) => {
    const objKey = new RegExp(`\\b${field}\\s*:`);
    const jsonKey = new RegExp(`"${field}"\\s*:`);
    const dotAssign = new RegExp(`\\.${field}\\s*=[^=]`);
    return objKey.test(producerText) || jsonKey.test(producerText) || dotAssign.test(producerText);
  };
  const unreachable = [];
  for (const [schemaName, keys] of Object.entries(allKeys)) {
    for (const k of keys) {
      if (reachable(k) || allowlist[k]) continue;
      unreachable.push(`${schemaName}.${k}`);
    }
  }
  return { unreachable, allKeys };
}

test('every NEXT_SCHEMA/VERDICT_SCHEMA field in taskmanager.mjs has a producer, or a reasoned allowlist entry', () => {
  const r = checkSchemaReachability(src('teamsTaskmanager'), ['NEXT_SCHEMA', 'VERDICT_SCHEMA']);
  assert.deepEqual(r.unreachable, [], `declared with no producer and no allowlist entry: ${r.unreachable.join(', ')}`);
  // The vacuity floor guard A/B/C already explain: too few fields found means extraction
  // stopped matching real code, not that the schemas shrank. Pinned to today's exact shape -
  // if a field is added or removed, update these two numbers in the same commit.
  assert.equal(r.allKeys.NEXT_SCHEMA.length, 10, `NEXT_SCHEMA should declare 10 fields, found ${r.allKeys.NEXT_SCHEMA.length}: ${r.allKeys.NEXT_SCHEMA.join(', ')}`);
  assert.equal(r.allKeys.VERDICT_SCHEMA.length, 19, `VERDICT_SCHEMA should declare 19 fields, found ${r.allKeys.VERDICT_SCHEMA.length}: ${r.allKeys.VERDICT_SCHEMA.join(', ')}`);
});

test('guard E is general, not tuned to taskmanager.mjs: a synthetic schema with one produced and one dead field is told apart correctly', () => {
  const synthetic = `
const FAKE_SCHEMA = {
  type: 'object',
  properties: {
    alpha: { type: 'string' },
    beta: { type: 'string' },
  },
};

function build() {
  return { alpha: 'x' }; // beta is declared above but never produced anywhere
}
`;
  const r = checkSchemaReachability(synthetic, ['FAKE_SCHEMA']);
  assert.deepEqual(r.unreachable, ['FAKE_SCHEMA.beta']);
  assert.deepEqual(r.allKeys.FAKE_SCHEMA, ['alpha', 'beta']);
});

test('proof: re-adding delegate to NEXT_SCHEMA (the exact 2095662 shape) makes guard E fail; the real source passes', () => {
  const realTaskmanager = src('teamsTaskmanager');
  assert.deepEqual(checkSchemaReachability(realTaskmanager, ['NEXT_SCHEMA', 'VERDICT_SCHEMA']).unreachable, [], 'sanity: real source must pass before mutating it');

  const mutated = realTaskmanager.replace(
    "flow: { type: 'string' },\n    run_id:",
    "flow: { type: 'string' },\n    delegate: { type: 'object', description: 'size S: open this with team_open instead; the task left nothing on disk' },\n    run_id:",
  );
  assert.notEqual(mutated, realTaskmanager, 'mutation target text was not found in teams/mcp/taskmanager.mjs - update this proof to match current source');

  const r = checkSchemaReachability(mutated, ['NEXT_SCHEMA', 'VERDICT_SCHEMA']);
  assert.deepEqual(r.unreachable, ['NEXT_SCHEMA.delegate'], 'guard E should flag exactly the re-added dead field - it did not, so this guard cannot catch the 2095662 shape (a schema field with no producer)');
});

// ---------- Guard D: sole ownership. A default RE-TYPED rather than re-declared. ----------
//
// Guards A and B compare sites that all declare the same option. They cannot see the other
// shape: a consumer deep in the codebase that writes the default's literal VALUE again as a
// `||` fallback, without looking like a declaration site at all. That is how docs_dir got a
// second owner - tickets.mjs's docPaths read
//
//     (task.team && task.team.opts && task.team.opts.docs_dir) || join('.teams_output', 'team')
//
// with a comment two lines above it that correctly said teamconfig.mjs's TEAM_DEFAULTS had
// already resolved the value onto every task. The two literals agreed. Nothing made them keep
// agreeing, and neither guard A nor guard B was looking at that file.
//
// This guard is deliberately narrow: for an option whose default is a distinctive literal,
// TEAM_DEFAULTS must be the ONLY place in teams/mcp that writes it. The count is pinned, not
// bounded - a new legitimate occurrence must be added here on purpose, with a reason.

const TEAMS_MCP_FOR_SOLE_OWNERSHIP = ['teamconfig', 'teamsGraph', 'teamsBroker', 'teamsTaskmanager', 'teamsTickets', 'teamsDocs'];

function docsDirLiteralSites() {
  // Matched as the PAIR, not on '.teams_output' alone: that root is legitimately written by
  // three other places for a different subdirectory (broker.mjs:144 and graph.mjs:217 for
  // .teams_output/broker, taskmanager.mjs:645 for a git rm --cached path). Only the pair
  // ('.teams_output', 'team') is docs_dir's default, so only the pair is this option's.
  return TEAMS_MCP_FOR_SOLE_OWNERSHIP
    .flatMap((k) => collect(src(k), /('\.teams_output', 'team')/g, k));
}

test('docs_dir: TEAM_DEFAULTS is the only place in teams/mcp that writes the .teams_output literal', () => {
  const sites = docsDirLiteralSites();
  assert.deepStrictEqual(
    sites.map((x) => x.label),
    ['teamconfig'],
    `.teams_output is written outside TEAM_DEFAULTS at: ${sites.map((x) => x.label).join(', ')} - `
    + 'a consumer must fall back to TEAM_DEFAULTS.docs_dir, not re-type the literal',
  );
  assert.match(src('teamsTickets'), /\|\| TEAM_DEFAULTS\.docs_dir;/, 'docPaths must fall back through TEAM_DEFAULTS');
});

test('proof: guard D flags the pre-fix docPaths line that re-typed docs_dir', () => {
  // The real pre-fix expression, verbatim. Fed to the same collector the live test uses, so
  // the proof cannot drift away from the guard it is proving.
  const preFix = "  const docsDir = (task.team && task.team.opts && task.team.opts.docs_dir) || join('.teams_output', 'team');";
  const hits = collect(preFix, /('\.teams_output', 'team')/g, 'teamsTickets');
  assert.deepStrictEqual(hits.map((x) => x.label), ['teamsTickets']);
});

// ---------- Guard D (continued): max_parallel_teams, the same sole-ownership shape ----------
//
// toolNext's (taskmanager.mjs) max_parallel_teams fallback had exactly docs_dir's defect: it
// re-typed TEAM_DEFAULTS.max_parallel_teams's literal (2) as its own `? ... : 2` ternary branch
// instead of reading TEAM_DEFAULTS.max_parallel_teams. Unlike the docs_dir pair
// ('.teams_output', 'team'), the bare digit 2 is not a distinctive literal on its own - it also
// appears for max_depth, qa_rounds, driver_restarts and other unrelated defaults throughout
// teams/mcp - so this guard matches the exact ternary SHAPE the bug took
// (`? task.team.opts.max_parallel_teams : <N>`), not the digit alone.
//
// Neither max_parallel_teams nor docs_dir was tracked by any guard in this file before today -
// that gap is why both survived a week of this exact defect class being hunted elsewhere.

function maxParallelTeamsLiteralSites() {
  return TEAMS_MCP_FOR_SOLE_OWNERSHIP
    .flatMap((k) => collect(src(k), /\? task\.team\.opts\.max_parallel_teams : (\d+)/g, k));
}

test('max_parallel_teams: toolNext falls back to TEAM_DEFAULTS.max_parallel_teams, not a re-typed literal', () => {
  const sites = maxParallelTeamsLiteralSites();
  assert.deepStrictEqual(
    sites, [],
    `max_parallel_teams fallback re-types a literal instead of reading TEAM_DEFAULTS at: ${sites.map((x) => x.label).join(', ')}`,
  );
  assert.match(src('teamsTaskmanager'), /: TEAM_DEFAULTS\.max_parallel_teams;/, 'toolNext must fall back through TEAM_DEFAULTS.max_parallel_teams');
});

test('proof: guard D flags the pre-fix toolNext line that re-typed max_parallel_teams', () => {
  // The real pre-fix expression, verbatim. Fed to the same collector the live test uses, so
  // the proof cannot drift away from the guard it is proving.
  const preFix = '  const maxParallel = Number.isInteger(task.team && task.team.opts && task.team.opts.max_parallel_teams)\n    ? task.team.opts.max_parallel_teams : 2;';
  const hits = collect(preFix, /\? task\.team\.opts\.max_parallel_teams : (\d+)/g, 'teamsTaskmanager');
  assert.deepStrictEqual(hits.map((x) => x.label), ['teamsTaskmanager']);
});

// ---------- Guard F: TEAM_DEFAULTS's own declared VALUES, pinned directly ----------
//
// Guards A-E above all compare a default against something else - another declared site (A),
// a delegation shape (B), a documented split (C), a schema's own field list (E). None of them
// ever reads TEAM_DEFAULTS's own literal and checks it is the value the docs (and every caller
// who reads them) believe it is. That gap is invisible as long as at least one test somewhere
// exercises a key's real, un-overridden default - but a key whose every consuming test passes
// its own explicit override never does, and then a wrong literal ships silently.
//
// Proven live during the coverage audit that motivated this guard: changing
// TEAM_DEFAULTS.qa_rounds from 2 to 3 (teamconfig.mjs) left this whole file green AND left every
// qa_rounds-sensitive test in test-taskmanager.mjs green, because each one passes qa_rounds
// explicitly (1 or 0). Changing TEAM_DEFAULTS.roles.qa from true to false did the same to every
// roles-sensitive test there (each pins roles itself) and to test-teamconfig.mjs's "defaults
// alone" test (compared the resolved object back against the very TEAM_DEFAULTS object it was
// built from - a tautology, fixed alongside this guard). The one test that does exercise the real
// default without overriding it - test-taskmanager.mjs's "tm_open with no roles argument defaults
// BOTH planning and qa on" - is a real behavioral proof and stays; this guard pins the same fact
// textually too, so it does not depend on that one test surviving unedited.
//
// max_depth and plugin_dirs are the same shape: max_depth's only other reader (taskmanager.mjs's
// openChild) delegates to TEAM_DEFAULTS.max_depth already (no second literal to agree or
// disagree with, so guard A does not apply), and today task.depth is always 0, so any default
// >= 1 is behaviourally identical to any other - a test-taskmanager.mjs test does catch a default
// of exactly 0 (split:true no longer escaping parent_shaped), but nothing catches a drift to, say,
// 5. plugin_dirs's only readers (daemon.mjs, taskmanager.mjs) fall back to a re-typed `[]` on a
// missing task.team/opts, which is harmless only because `[] || []` never actually reaches the
// fallback - but the shipped default value itself, `[]`, is asserted nowhere.
//
// This is a literal source-text extraction of TEAM_DEFAULTS's own declaration, evaluated once
// (the same `new Function` trick guard E's schemaKeys uses, safe because the literal has no free
// variables) - not a resolved runtime object, which is exactly what made the teamconfig.mjs test
// above vacuous.
function teamDefaultsObject(teamconfigSrc) {
  // Comment-stripped first: TEAM_DEFAULTS's own comments contain contractions
  // ("taskmanager.mjs's", "it's") whose odd apostrophe counts would desync extractBalanced's
  // string-literal tracking if left in - the same reason checkSchemaReachability strips
  // comments before treating a match as a boundary, even though it reads keys from the
  // original text.
  const stripped = stripComments(teamconfigSrc);
  const m = /const TEAM_DEFAULTS\s*=\s*Object\.freeze\(\s*(\{)/.exec(stripped);
  if (!m) throw new Error('"const TEAM_DEFAULTS = Object.freeze({" not found - teamconfig.mjs restructured; update this guard');
  const literal = extractBalanced(stripped, m.index + m[0].length - 1);
  // TEAM_DEFAULTS.max_parallel_teams reads the named PROVISIONAL_MAX_PARALLEL_TEAMS constant,
  // not a bare literal - not this guard's concern (it pins qa_rounds/roles/max_depth/plugin_dirs
  // only), but the literal still has to evaluate, so the identifier is resolved the same way
  // guard E's schemaKeys already relies on the literal having no OTHER free variables.
  const pm = /const PROVISIONAL_MAX_PARALLEL_TEAMS\s*=\s*(\d+);/.exec(stripped);
  if (!pm) throw new Error('"const PROVISIONAL_MAX_PARALLEL_TEAMS = <N>;" not found - teamconfig.mjs restructured; update this guard');
  // docs_dir's own literal calls join(...) (teamconfig.mjs imports it from node:path) - the same
  // free-variable situation as PROVISIONAL_MAX_PARALLEL_TEAMS above, resolved the same way.
  return new Function('PROVISIONAL_MAX_PARALLEL_TEAMS', 'join', `return ${literal}`)(Number(pm[1]), join);
}

test('TEAM_DEFAULTS pins its own documented default VALUES for the keys no test exercises un-overridden: qa_rounds, roles, max_depth, plugin_dirs', () => {
  const d = teamDefaultsObject(src('teamconfig'));
  assert.deepStrictEqual(d.qa_rounds, 2, `qa_rounds default drifted to ${JSON.stringify(d.qa_rounds)} (expected 2)`);
  assert.deepStrictEqual(d.roles, { planning: true, qa: true, audit: true }, `roles default drifted to ${JSON.stringify(d.roles)} (expected {planning: true, qa: true, audit: true})`);
  assert.deepStrictEqual(d.max_depth, 2, `max_depth default drifted to ${JSON.stringify(d.max_depth)} (expected 2)`);
  assert.deepStrictEqual(d.plugin_dirs, [], `plugin_dirs default drifted to ${JSON.stringify(d.plugin_dirs)} (expected [])`);
});

test('proof: guard F catches the qa_rounds 2->3 drift that the coverage audit found live; the real source passes', () => {
  const real = src('teamconfig');
  assert.deepStrictEqual(teamDefaultsObject(real).qa_rounds, 2, 'sanity: real source must pass before mutating it');

  const mutated = real.replace('qa_rounds: 2,', 'qa_rounds: 3,');
  assert.notEqual(mutated, real, 'mutation target text was not found in teams/mcp/teamconfig.mjs - update this proof to match current source');

  assert.notDeepEqual(teamDefaultsObject(mutated).qa_rounds, 2, 'guard F should have caught qa_rounds drifting off 2 - it did not');
});

test('proof: guard F catches the roles.qa true->false drift that the coverage audit found live; the real source passes', () => {
  const real = src('teamconfig');
  assert.deepStrictEqual(teamDefaultsObject(real).roles, { planning: true, qa: true, audit: true }, 'sanity: real source must pass before mutating it');

  const mutated = real.replace('roles: { planning: true, qa: true, audit: true },', 'roles: { planning: true, qa: false, audit: true },');
  assert.notEqual(mutated, real, 'mutation target text was not found in teams/mcp/teamconfig.mjs - update this proof to match current source');

  assert.notDeepEqual(teamDefaultsObject(mutated).roles, { planning: true, qa: true, audit: true }, 'guard F should have caught roles.qa drifting off true - it did not');
});
