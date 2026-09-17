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

function vendorSites(teamconfigSrc, teamsGraphSrc, graphGraphSrc, graphBrokerSrc) {
  return [
    ...collect(teamconfigSrc, /^\s*vendor:\s*'([^']+)',\s*$/gm, 'TEAM_DEFAULTS (teams/mcp/teamconfig.mjs)'),
    ...collect(teamsGraphSrc, /vendor:\s*opts\.vendor\s*\|\|\s*'([^']+)',/g, 'createRun (teams/mcp/graph.mjs)'),
    ...collect(graphGraphSrc, /vendor:\s*opts\.vendor\s*\|\|\s*'([^']+)',/g, 'createRun (graph/mcp/graph.mjs)'),
    ...collect(graphBrokerSrc, /vendor:\s*a\.vendor\s*\|\|\s*'([^']+)',/g, 'toolGraphOpen (graph/mcp/broker.mjs)'),
  ];
}

function allocationSites(teamconfigSrc, teamsGraphSrc, graphGraphSrc, graphBrokerSrc) {
  return [
    ...collect(teamconfigSrc, /^\s*allocation:\s*'([^']+)',\s*$/gm, 'TEAM_DEFAULTS (teams/mcp/teamconfig.mjs)'),
    ...collect(teamsGraphSrc, /allocation:\s*opts\.allocation\s*\|\|\s*'([^']+)',/g, 'createRun (teams/mcp/graph.mjs)'),
    ...collect(graphGraphSrc, /allocation:\s*opts\.allocation\s*\|\|\s*'([^']+)',/g, 'createRun (graph/mcp/graph.mjs)'),
    ...collect(graphBrokerSrc, /allocation:\s*a\.allocation\s*\|\|\s*'([^']+)',/g, 'toolGraphOpen (graph/mcp/broker.mjs)'),
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
  const sites = vendorSites(src('teamconfig'), src('teamsGraph'), src('graphGraph'), src('graphBroker'));
  const r = checkAgreement('vendor', sites, 4, 'auto');
  assert.ok(r.ok, r.message);
});

test('allocation default ("ordered") agrees across every declared site, teams and graph alike', () => {
  const sites = allocationSites(src('teamconfig'), src('teamsGraph'), src('graphGraph'), src('graphBroker'));
  const r = checkAgreement('allocation', sites, 4, 'ordered');
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
  // this is the concrete demonstration that be83bbc needed guard B, not guard A.
  const stillAgrees = checkAgreement('vendor', vendorSites(src('teamconfig'), src('teamsGraph'), src('graphGraph'), src('graphBroker')), 4, 'auto');
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
