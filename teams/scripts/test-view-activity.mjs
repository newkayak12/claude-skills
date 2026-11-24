#!/usr/bin/env node
// view-activity.mjs: a worker's stream tail as one activity key plus plain-word vars (the pane maps
// the key to a localized phrase). Pure, so every mapping is checked here without a stream file.
//
//   node --test teams/scripts/test-view-activity.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ACTIVITY_KEYS, activityOf } from './lib/view-activity.mjs';
import { STAGE_KEYS } from './lib/view-stages.mjs';

const use = (name, input = {}, id = 'tu1') => ({ type: 'assistant', message: { id: `m-${id}`, content: [{ type: 'tool_use', id, name, input }] } });
const say = (type) => ({ type: 'assistant', message: { id: 'mt', content: [type === 'text' ? { type, text: 'ok then' } : { type, thinking: 'hmm' }] } });
const progress = (tool_name, id = 'tu1') => ({ type: 'tool_progress', tool_name, tool_use_id: id, elapsed_time_seconds: 60 });
const result = (id = 'tu1') => ({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'done' }] } });

const RAW_TOOLS = ['Bash', 'Edit', 'Write', 'Read', 'Grep', 'Glob', 'Agent', 'Task'];
const bad = new Set([...STAGE_KEYS, ...RAW_TOOLS]);

// D2: no raw token anywhere in a doing_vars value
function clean(r) {
  assert.ok(ACTIVITY_KEYS.includes(r.doing_key), `${r.doing_key} is an ACTIVITY_KEYS value`);
  assert.equal(typeof r.doing_vars, 'object');
  for (const v of Object.values(r.doing_vars)) {
    assert.equal(typeof v, 'string');
    assert.doesNotMatch(v, /tool_progress|mcp__/);
    assert.ok(!bad.has(v), `${v} is a stage key or a raw tool name`);
  }
  return r;
}

test('ACTIVITY_KEYS is a non-empty list of strings', () => {
  assert.ok(Array.isArray(ACTIVITY_KEYS) && ACTIVITY_KEYS.length > 0);
  assert.ok(ACTIVITY_KEYS.every((k) => typeof k === 'string' && k));
});

test('gate and accept are judging, whatever the last tool was', () => {
  for (const stage of ['gate', 'accept']) {
    const r = clean(activityOf([use('Edit', { file_path: '/a/b.mjs' })], stage, { id: 'P1' }));
    assert.equal(r.doing_key, 'actJudging');
    assert.match(r.doing_vars.what, /P1/);
  }
  const judge = clean(activityOf([use('Read', { file_path: '/a/b.mjs' })], 'gate'));
  assert.equal(judge.doing_key, 'actJudging');
  assert.ok(judge.doing_vars.what);
});

test('Bash running a test command is testing with a suite name', () => {
  const cmds = [
    ['cd /repo/teams && claude plugin test .', 'teams suite'],
    ['node --test teams/scripts/test-view-floor.mjs', 'teams suite'],
    ['npm test', 'the test suite'],
    ['cd /repo/web && pytest -q', 'web suite'],
  ];
  for (const [command, suite] of cmds) {
    const r = clean(activityOf([use('Bash', { command })], 'implement'));
    assert.equal(r.doing_key, 'actTesting', command);
    assert.equal(r.doing_vars.suite, suite, command);
  }
});

test('Bash running anything else is a plain running command', () => {
  const r = clean(activityOf([use('Bash', { command: 'git status' })], 'implement'));
  assert.equal(r.doing_key, 'actRunning');
});

test('Edit and Write are editing with the file basename', () => {
  for (const name of ['Edit', 'Write']) {
    const r = clean(activityOf([use(name, { file_path: '/repo/teams/hooks/pane.ts' })], 'implement'));
    assert.deepEqual([r.doing_key, r.doing_vars.file], ['actEditing', 'pane.ts']);
  }
});

test('Read, Grep and Glob are reading', () => {
  assert.deepEqual(activityOf([use('Read', { file_path: '/r/a.mjs' })], 'implement').doing_vars, { what: 'a.mjs' });
  for (const [name, input] of [['Read', { file_path: '/r/a.mjs' }], ['Grep', { pattern: 'doingOf' }], ['Glob', { pattern: '**/*.mjs' }]]) {
    const r = clean(activityOf([use(name, input)], 'implement'));
    assert.equal(r.doing_key, 'actReading', name);
    assert.ok(r.doing_vars.what, name);
  }
});

test('Agent and Task are a subagent, with its kind', () => {
  const r = clean(activityOf([use('Agent', { subagent_type: 'reviewer', prompt: 'x' })], 'implement'));
  assert.deepEqual([r.doing_key, r.doing_vars.kind], ['actSubagent', 'reviewer']);
  assert.equal(clean(activityOf([use('Task', {})], 'implement')).doing_key, 'actSubagent');
});

test('an MCP team_* or tm_* call is the engine, with a plain verb per tool', () => {
  const verbs = new Set();
  for (const tool of ['team_run', 'team_submit', 'team_status', 'team_next', 'tm_status', 'tm_read', 'tm_post', 'tm_ask', 'team_unknown']) {
    const r = clean(activityOf([use(`mcp__teams__${tool}`, {})], 'implement'));
    assert.equal(r.doing_key, 'actEngine', tool);
    assert.ok(r.doing_vars.verb, tool);
    verbs.add(r.doing_vars.verb);
  }
  assert.ok(verbs.size >= 4, 'tools do not all read the same');
  // an MCP tool that is not the engine's is a plain command
  assert.equal(clean(activityOf([use('mcp__other__lookup', {})], 'implement')).doing_key, 'actRunning');
});

test('tool_progress takes the key of the tool it reports on', () => {
  const eng = clean(activityOf([use('mcp__teams__team_run', {}), progress('mcp__teams__team_run')], 'implement'));
  assert.equal(eng.doing_key, 'actEngine');
  // the call is in the tail: Bash progress is testing when the call ran a test
  const bash = clean(activityOf([use('Bash', { command: 'node --test teams/scripts/test-x.mjs' }), progress('Bash')], 'implement'));
  assert.deepEqual([bash.doing_key, bash.doing_vars.suite], ['actTesting', 'teams suite']);
  // the call scrolled out of the tail: the name alone decides
  assert.equal(clean(activityOf([progress('Edit', 'gone')], 'implement')).doing_key, 'actEditing');
  assert.equal(clean(activityOf([progress('Bash', 'gone')], 'implement')).doing_key, 'actRunning');
  assert.equal(clean(activityOf([progress('Agent', 'gone')], 'implement')).doing_key, 'actSubagent');
});

test('thinking and text are thinking', () => {
  assert.equal(clean(activityOf([say('thinking')], 'implement')).doing_key, 'actThinking');
  assert.equal(clean(activityOf([say('text')], 'implement')).doing_key, 'actThinking');
});

test('nothing in the tail says the stage in a plain word, never the stage key', () => {
  for (const stage of ['plan', 'setgoal', 'critique', 'implement', 'test', 'draft', 'review', 'integrate', 'other', undefined]) {
    const r = clean(activityOf([], stage));
    assert.equal(r.doing_key, 'actStage', String(stage));
    assert.ok(r.doing_vars.stage);
  }
  // a tool result alone, or non-stream noise, is nothing to say yet
  assert.equal(activityOf([result(), { type: 'rate_limit_event' }, { type: 'system', subtype: 'init', model: 'm' }], 'implement').doing_key, 'actStage');
  assert.equal(activityOf(null, 'implement').doing_key, 'actStage');
});

test('the newest meaningful record wins, a result after a call does not hide it', () => {
  const r = clean(activityOf([use('Edit', { file_path: '/a/old.mjs' }, 'a'), result('a'), use('Read', { file_path: '/a/new.mjs' }, 'b'), result('b')], 'implement'));
  assert.deepEqual([r.doing_key, r.doing_vars.what], ['actReading', 'new.mjs']);
});

test('a value that would show a raw token is replaced, never passed on', () => {
  const r = clean(activityOf([use('Read', { file_path: 'mcp__x' })], 'implement'));
  assert.equal(r.doing_key, 'actReading');
  const g = clean(activityOf([use('Grep', { pattern: 'Bash' })], 'implement'));
  assert.equal(g.doing_key, 'actReading');
  const a = clean(activityOf([use('Agent', { subagent_type: 'Task' })], 'implement'));
  assert.equal(a.doing_key, 'actSubagent');
});

test('the module imports nothing but view-stages.mjs', () => {
  const src = readFileSync(fileURLToPath(new URL('./lib/view-activity.mjs', import.meta.url)), 'utf8');
  const specs = [...src.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|^import\s+)['"]([^'"]+)['"]/gm)].map((m) => m[1]);
  assert.ok(specs.every((s) => s === './view-stages.mjs'), JSON.stringify(specs));
});
