#!/usr/bin/env node
// Unit tests for mcp/layout-guard.mjs: the shared scratch sentence and the pure
// new-top-level-directory check (card 86). The commit-time wiring is covered in
// test-taskmanager.mjs.
//
//   node --test teams/scripts/test-layout-guard.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCRATCH_RULE, newTopLevelDirs, manifestPathOf } from '../mcp/layout-guard.mjs';

const none = () => false;

test('SCRATCH_RULE names the run dir and the OS temp dir and forbids a new project path', () => {
  assert.match(SCRATCH_RULE, /\.teams_output\//);
  assert.match(SCRATCH_RULE, /OS temp dir/);
  assert.match(SCRATCH_RULE, /never as a new path in the project/);
});

test('a directory absent at the pre-commit HEAD is flagged', () => {
  assert.deepEqual(newTopLevelDirs(['test/probe.mjs'], ['src', 'docs'], none), ['test']);
});

test('files under an existing top-level directory pass', () => {
  assert.deepEqual(newTopLevelDirs(['src/a.js', 'src/deep/b.js', 'docs/c.md'], ['src', 'docs'], none), []);
});

test('a dot-dir is exempt', () => {
  assert.deepEqual(newTopLevelDirs(['.github/ci.yml', '.teams_output/x.md'], ['src'], none), []);
});

test('a new directory carrying its own plugin manifest is exempt', () => {
  const staged = ['newplug/.claude-plugin/plugin.json', 'newplug/skills/a/SKILL.md'];
  const has = (d) => staged.includes(manifestPathOf(d));
  assert.deepEqual(newTopLevelDirs(staged, ['src'], has), []);
});

test('a new directory without a manifest is flagged even beside one that has it', () => {
  const staged = ['newplug/.claude-plugin/plugin.json', 'scratch/a.mjs'];
  const has = (d) => staged.includes(manifestPathOf(d));
  assert.deepEqual(newTopLevelDirs(staged, ['src'], has), ['scratch']);
});

test('a root-level file is not a directory', () => {
  assert.deepEqual(newTopLevelDirs(['README.md', 'notes.txt'], [], none), []);
});

test('the result is sorted and has no duplicates', () => {
  assert.deepEqual(newTopLevelDirs(['zeta/a', 'alpha/b', 'zeta/c', 'alpha/d/e'], [], none), ['alpha', 'zeta']);
});

test('empty or missing inputs return nothing', () => {
  assert.deepEqual(newTopLevelDirs([], ['src'], none), []);
  assert.deepEqual(newTopLevelDirs(undefined, undefined, undefined), []);
  assert.deepEqual(newTopLevelDirs(['x/y'], undefined, undefined), ['x']);
});
