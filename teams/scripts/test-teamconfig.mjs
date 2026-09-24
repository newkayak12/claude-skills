import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TEAM_DEFAULTS, TEAM_FILE, readTeamConfig, resolveTeamOptions } from '../mcp/teamconfig.mjs';

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
  assert.deepEqual(opts.roles, { planning: true, qa: false, audit: true }, 'roles merge key by key (defaults are both on since 0.17.0)');
  assert.equal(sources.roles, 'team.json');
});

test('a wrongly typed key is ignored with a note, not applied', () => {
  const { opts, notes } = resolveTeamOptions({}, { goal_threshold: 'ninety', max_depth: 'two' });
  assert.equal(opts.goal_threshold, TEAM_DEFAULTS.goal_threshold);
  assert.equal(opts.max_depth, TEAM_DEFAULTS.max_depth);
  assert.equal(notes.length, 2);
  assert.match(notes[0], /goal_threshold/);
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

test('unknown keys are reported, not merged', () => {
  const { opts, notes } = resolveTeamOptions({}, { colour: 'blue' });
  assert.equal('colour' in opts, false);
  assert.match(notes[0], /unknown key "colour"/);
});
