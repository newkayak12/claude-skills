import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TEAM_DEFAULTS, TEAM_FILE, readTeamConfig, resolveTeamOptions, normalizeInitiative } from '../mcp/teamconfig.mjs';

function project(json) {
  const dir = mkdtempSync(join(tmpdir(), 'teamconfig-'));
  if (json !== undefined) {
    mkdirSync(join(dir, '.claude'), { recursive: true });
    writeFileSync(join(dir, TEAM_FILE), typeof json === 'string' ? json : JSON.stringify(json));
  }
  return dir;
}

test('no file: status absent, config empty', () => {
  const dir = project();
  try {
    const r = readTeamConfig(dir);
    assert.equal(r.status, 'absent');
    assert.deepEqual(r.config, {});
    assert.equal(r.path, join(dir, TEAM_FILE));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('malformed file: status parse-error, config empty, never throws', () => {
  const dir = project('{not json');
  try {
    const r = readTeamConfig(dir);
    assert.equal(r.status, 'parse-error');
    assert.deepEqual(r.config, {});
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// This used to be titled "defaults alone: every key sourced 'default'" and asserted
// `assert.deepEqual(opts, TEAM_DEFAULTS)` as if that pinned the documented default VALUES. It
// does not and cannot: opts is built FROM TEAM_DEFAULTS (resolveTeamOptions's `{ ...TEAM_DEFAULTS,
// roles: { ...TEAM_DEFAULTS.roles } }`), so comparing it back against TEAM_DEFAULTS is comparing
// an object to itself - a wrong literal in TEAM_DEFAULTS (e.g. qa_rounds: 3, or roles.qa: false)
// would still make opts equal TEAM_DEFAULTS and this test would stay green. What this test can
// legitimately prove, and still does below: resolveTeamOptions({}, {}) does not corrupt or drop
// any key on the way through, does not alias a mutable sub-object (roles) back into the frozen
// TEAM_DEFAULTS, and marks every key's source 'default'. Pinning the default VALUES themselves is
// scripts/test-defaults.mjs's job (Guard F).
test('defaults alone: resolution reproduces TEAM_DEFAULTS without corrupting or aliasing it, and every key is sourced "default" (does not pin the default VALUES - see test-defaults.mjs Guard F)', () => {
  const { opts, sources } = resolveTeamOptions({}, {});
  assert.deepEqual(opts, TEAM_DEFAULTS, 'resolving with no team.json and no args must reproduce TEAM_DEFAULTS key-for-key - this can only catch resolveTeamOptions corrupting a key, never a wrong literal in TEAM_DEFAULTS itself');
  assert.notEqual(opts.roles, TEAM_DEFAULTS.roles, 'opts.roles must be resolveTeamOptions\' own fresh copy, never an alias into the frozen TEAM_DEFAULTS.roles object');
  for (const k of Object.keys(TEAM_DEFAULTS)) assert.equal(sources[k], 'default', k);
});

test('team.json overrides defaults, explicit args override team.json', () => {
  const { opts, sources } = resolveTeamOptions(
    { goal_threshold: 80 },
    { goal_threshold: 95, max_retries: 5, roles: { qa: false } },
  );
  assert.equal(opts.goal_threshold, 80);
  assert.equal(sources.goal_threshold, 'args');
  assert.equal(opts.max_retries, 5);
  assert.equal(sources.max_retries, 'team.json');
  assert.deepEqual(opts.roles, { planning: 'auto', qa: false, audit: true }, 'roles merge key by key (planning defaults to "auto" since the light PLAN mode, qa/audit on since 0.17.0)');
  assert.equal(sources.roles, 'team.json');
});

test('a wrongly typed key is ignored with a note, not applied', () => {
  const { opts, notes } = resolveTeamOptions({}, { goal_threshold: 'ninety', max_depth: 'two' });
  assert.equal(opts.goal_threshold, TEAM_DEFAULTS.goal_threshold);
  assert.equal(opts.max_depth, TEAM_DEFAULTS.max_depth);
  assert.equal(notes.length, 2);
  assert.match(notes[0], /goal_threshold/);
});

// roles.planning (docs/plans/2026-09-28-teams-light-plan.md §2.5): true | false | 'light' | 'auto'.
// The other roles stay boolean-only; any other string is a note, not a value.
test('roles.planning accepts true/false/"light"/"auto", defaults to "auto"; other strings and non-boolean qa/audit are ignored with a note', () => {
  assert.equal(TEAM_DEFAULTS.roles.planning, 'auto');
  for (const v of [true, false, 'light', 'auto']) {
    const r = resolveTeamOptions({}, { roles: { planning: v } });
    assert.equal(r.opts.roles.planning, v, `roles.planning ${JSON.stringify(v)} must be accepted`);
    assert.equal(r.notes.length, 0, JSON.stringify(r.notes));
  }
  const viaArgs = resolveTeamOptions({ roles: { planning: 'light' } }, { roles: { planning: true } });
  assert.equal(viaArgs.opts.roles.planning, 'light', 'an explicit arg outranks team.json');
  for (const bad of [{ planning: 'heavy' }, { planning: 1 }, { qa: 'auto' }, { audit: 'light' }]) {
    const r = resolveTeamOptions({}, { roles: bad });
    assert.deepEqual(r.opts.roles, TEAM_DEFAULTS.roles, `${JSON.stringify(bad)} must be ignored`);
    assert.match(r.notes[0], /roles/);
  }
});

// `interactive` (0.28.0) is what graph.mjs's openAsk AND applyHumanPin both read off run.
// interactive - a run nobody told to ask must still default a MODEL-written assignee pin
// forward instead of parking on it forever (the 0.27.3 review, 2026-09-24). Its own defaulting/
// validation deserves the same direct coverage every other key gets here, not just the
// behavioral tests in test-graph.mjs/test-broker.mjs/test-taskmanager.mjs that exercise it
// indirectly through a run.
test('interactive: defaults false and sourced "default", team.json can turn it on, and a non-boolean is ignored with a note', () => {
  assert.equal(TEAM_DEFAULTS.interactive, false);
  const bare = resolveTeamOptions({}, {});
  assert.equal(bare.opts.interactive, false);
  assert.equal(bare.sources.interactive, 'default');

  const onViaFile = resolveTeamOptions({}, { interactive: true });
  assert.equal(onViaFile.opts.interactive, true);
  assert.equal(onViaFile.sources.interactive, 'team.json');

  const onViaArgs = resolveTeamOptions({ interactive: true }, { interactive: false });
  assert.equal(onViaArgs.opts.interactive, true, 'an explicit arg outranks team.json, same precedence as every other key');
  assert.equal(onViaArgs.sources.interactive, 'args');

  const bad = resolveTeamOptions({}, { interactive: 'yes' });
  assert.equal(bad.opts.interactive, false, 'a non-boolean is ignored - the default survives');
  assert.match(bad.notes[0], /interactive/);
});

test('ask_timeout: defaults null (wait forever), takes a positive integer of ms from team.json or args, rejects anything else with a note', () => {
  assert.equal(TEAM_DEFAULTS.ask_timeout, null);
  const bare = resolveTeamOptions({}, {});
  assert.equal(bare.opts.ask_timeout, null);
  assert.equal(bare.sources.ask_timeout, 'default');

  const viaFile = resolveTeamOptions({}, { ask_timeout: 3600000 });
  assert.equal(viaFile.opts.ask_timeout, 3600000);
  assert.equal(viaFile.sources.ask_timeout, 'team.json');
  const viaArgs = resolveTeamOptions({ ask_timeout: 100 }, { ask_timeout: 3600000 });
  assert.equal(viaArgs.opts.ask_timeout, 100);
  assert.equal(viaArgs.sources.ask_timeout, 'args');
  assert.equal(resolveTeamOptions({ ask_timeout: null }, { ask_timeout: 5 }).opts.ask_timeout, null, 'an explicit null turns a team.json timeout back off');

  for (const bad of [0, -1, 1.5, '100', true]) {
    const r = resolveTeamOptions({}, { ask_timeout: bad });
    assert.equal(r.opts.ask_timeout, null, `${JSON.stringify(bad)} is ignored`);
    assert.match(r.notes[0], /ask_timeout/);
  }
});

// max_parallel_teams: 'auto' (default since 2026-09-28) hands the cap to taskmanager.mjs's AIMD
// controller; a project may still pin a fixed number instead, exactly as before that existed.
// This file only proves the CONFIG LAYER accepts both shapes and rejects everything else - the
// AIMD behaviour itself (increase/decrease/floor/ceiling) is scripts/test-autoparallel.mjs's job.
test('max_parallel_teams: defaults to "auto", team.json/args may pin a fixed integer instead, and anything else is ignored with a note', () => {
  assert.equal(TEAM_DEFAULTS.max_parallel_teams, 'auto');
  const bare = resolveTeamOptions({}, {});
  assert.equal(bare.opts.max_parallel_teams, 'auto');
  assert.equal(bare.sources.max_parallel_teams, 'default');

  const pinned = resolveTeamOptions({}, { max_parallel_teams: 4 });
  assert.equal(pinned.opts.max_parallel_teams, 4);
  assert.equal(pinned.sources.max_parallel_teams, 'team.json');

  const viaArgs = resolveTeamOptions({ max_parallel_teams: 1 }, { max_parallel_teams: 4 });
  assert.equal(viaArgs.opts.max_parallel_teams, 1, 'an explicit arg outranks team.json, same precedence as every other key');

  for (const bad of [0, -1, 1.5, 'fast', null, true]) {
    const r = resolveTeamOptions({}, { max_parallel_teams: bad });
    assert.equal(r.opts.max_parallel_teams, 'auto', `${JSON.stringify(bad)} must be rejected, the default survives`);
    assert.match(r.notes[0], /max_parallel_teams/);
  }
});

test('max_parallel_ceiling: defaults to null (the AIMD controller derives one from the host), team.json/args may pin a positive integer, anything else is ignored', () => {
  assert.equal(TEAM_DEFAULTS.max_parallel_ceiling, null);
  const bare = resolveTeamOptions({}, {});
  assert.equal(bare.opts.max_parallel_ceiling, null);
  assert.equal(bare.sources.max_parallel_ceiling, 'default');

  const pinned = resolveTeamOptions({}, { max_parallel_ceiling: 8 });
  assert.equal(pinned.opts.max_parallel_ceiling, 8);
  assert.equal(pinned.sources.max_parallel_ceiling, 'team.json');

  for (const bad of [0, -1, 2.5, 'six']) {
    const r = resolveTeamOptions({}, { max_parallel_ceiling: bad });
    assert.equal(r.opts.max_parallel_ceiling, null, `${JSON.stringify(bad)} must be rejected, the default survives`);
    assert.match(r.notes[0], /max_parallel_ceiling/);
  }
});

test('normalizeInitiative: slugifies (lowercase, non-alphanumeric runs collapsed to one "-", trimmed), and null in is null out', () => {
  assert.equal(normalizeInitiative(null), null);
  assert.equal(normalizeInitiative(undefined), null);
  assert.equal(normalizeInitiative('Q1 Roadmap'), 'q1-roadmap');
  assert.equal(normalizeInitiative('q1-roadmap'), 'q1-roadmap');
  assert.equal(normalizeInitiative('Q1_Roadmap!'), 'q1-roadmap');
  assert.equal(normalizeInitiative('  spaced out  '), 'spaced-out');
  assert.equal(normalizeInitiative('---'), null, 'a string with nothing alphanumeric in it normalizes to null, same as never setting one');
});

test('initiative: defaults null and sourced "default"; team.json/args are slug-normalized; a non-string/empty value is ignored with a note', () => {
  assert.equal(TEAM_DEFAULTS.initiative, null);
  const bare = resolveTeamOptions({}, {});
  assert.equal(bare.opts.initiative, null);
  assert.equal(bare.sources.initiative, 'default');

  const fromFile = resolveTeamOptions({}, { initiative: 'Q1 Roadmap' });
  assert.equal(fromFile.opts.initiative, 'q1-roadmap');
  assert.equal(fromFile.sources.initiative, 'team.json');

  // An explicit tm_open argument overrides team.json, same precedence every other key has.
  const fromArgs = resolveTeamOptions({ initiative: 'Q2 Roadmap' }, { initiative: 'Q1 Roadmap' });
  assert.equal(fromArgs.opts.initiative, 'q2-roadmap');
  assert.equal(fromArgs.sources.initiative, 'args');

  for (const bad of [42, true, {}, []]) {
    const r = resolveTeamOptions({}, { initiative: bad });
    assert.equal(r.opts.initiative, null, `${JSON.stringify(bad)} must be rejected, the default survives`);
    assert.match(r.notes[0], /initiative/);
  }
});

test('unknown keys are reported, not merged', () => {
  const { opts, notes } = resolveTeamOptions({}, { colour: 'blue' });
  assert.equal('colour' in opts, false);
  assert.match(notes[0], /unknown key "colour"/);
});
