// graph's PreToolUse Skill hook and the worker marking.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const path = (rel) => fileURLToPath(new URL(rel, import.meta.url));
const HOOK = path('../hooks/node-gate.mjs');

function verdict(skill, env, extra = {}) {
  const r = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ tool_name: 'Skill', tool_input: { skill }, ...extra }),
    encoding: 'utf8',
    env: { ...process.env, HARNESS_NODE: '', ...env },
  });
  assert.equal(r.status, 0);
  return r.stdout.trim() ? JSON.parse(r.stdout).hookSpecificOutput.permissionDecision : 'allow';
}

function toolVerdict(tool_name, env) {
  const r = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ tool_name, tool_input: {} }),
    encoding: 'utf8',
    env: { ...process.env, HARNESS_NODE: '', ...env },
  });
  assert.equal(r.status, 0);
  return r.stdout.trim() ? JSON.parse(r.stdout).hookSpecificOutput.permissionDecision : 'allow';
}

test('HARNESS_NODE=1 denies every entry skill', () => {
  for (const s of ['harness:harness', 'harness', 'graph:orchestrate', 'teams:orchestrate', 'teams:develop', 'teams:sprint', 'teams:document', 'teams:plan', 'teams:qa']) {
    assert.equal(verdict(s, { HARNESS_NODE: '1' }), 'deny', s);
  }
});

test('non-entry skills, unset env, and agent_id alone pass', () => {
  assert.equal(verdict('graph:install', { HARNESS_NODE: '1' }), 'allow');
  assert.equal(verdict('graph:orchestrate', {}), 'allow');
  assert.equal(verdict('graph:orchestrate', {}, { agent_id: 'a' }), 'allow');
});

test('Codex MCP entry tools are denied inside a worker and allowed outside it', () => {
  for (const tool of ['mcp__graph-engineering__graph_open', 'mcp__task-manager__tm_open', 'mcp__task-manager__tm_run']) {
    assert.equal(toolVerdict(tool, { HARNESS_NODE: '1' }), 'deny', tool);
    assert.equal(toolVerdict(tool, {}), 'allow', tool);
  }
});

test('garbage input fails open', () => {
  const r = spawnSync(process.execPath, [HOOK], { input: 'not json', encoding: 'utf8', env: { ...process.env, HARNESS_NODE: '1' } });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});

test('hooks.json registers the Skill hook and keeps SessionStart', () => {
  const h = JSON.parse(readFileSync(path('../hooks/hooks.json'), 'utf8')).hooks;
  assert.equal(h.PreToolUse[0].matcher, 'Skill');
  assert.ok(h.SessionStart);
});

test('Codex registers the same Skill gate without Claude modules', () => {
  const config = JSON.parse(readFileSync(path('../hooks/codex.json'), 'utf8'));
  assert.equal(config.modules, undefined);
  assert.match(config.hooks.PreToolUse[0].matcher, /graph_open/);
  assert.match(config.hooks.PreToolUse[0].hooks[0].command, /node \$\{PLUGIN_ROOT\}\/hooks\/node-gate\.mjs/);
});

test('the broker marks its worker spawn', () => {
  assert.match(readFileSync(path('../mcp/broker.mjs'), 'utf8'), /env: \{ \.\.\.process\.env, HARNESS_NODE: '1' \}/);
});
