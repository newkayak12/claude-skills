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

test('defaults alone: every key sourced "default"', () => {
  const { opts, sources } = resolveTeamOptions({}, {});
  assert.deepEqual(opts, TEAM_DEFAULTS);
  for (const k of Object.keys(TEAM_DEFAULTS)) assert.equal(sources[k], 'default', k);
});

test('team.json overrides defaults, explicit args override team.json', () => {
  const { opts, sources } = resolveTeamOptions(
    { goal_threshold: 80 },
    { goal_threshold: 95, max_retries: 5, roles: { qa: true } },
  );
  assert.equal(opts.goal_threshold, 80);
  assert.equal(sources.goal_threshold, 'args');
  assert.equal(opts.max_retries, 5);
  assert.equal(sources.max_retries, 'team.json');
  assert.deepEqual(opts.roles, { planning: false, qa: true }, 'roles merge key by key');
  assert.equal(sources.roles, 'team.json');
});

test('a wrongly typed key is ignored with a note, not applied', () => {
  const { opts, notes } = resolveTeamOptions({}, { goal_threshold: 'ninety', max_depth: 'two' });
  assert.equal(opts.goal_threshold, TEAM_DEFAULTS.goal_threshold);
  assert.equal(opts.max_depth, TEAM_DEFAULTS.max_depth);
  assert.equal(notes.length, 2);
  assert.match(notes[0], /goal_threshold/);
});

test('unknown keys are reported, not merged', () => {
  const { opts, notes } = resolveTeamOptions({}, { colour: 'blue' });
  assert.equal('colour' in opts, false);
  assert.match(notes[0], /unknown key "colour"/);
});
