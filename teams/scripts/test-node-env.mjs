// Run nodes (workers and judges) carry HARNESS_NODE=1; the processes that drive a run do not.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const src = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

test('workers are marked: the broker adapter spawn and the judge spawn', () => {
  assert.match(src('../mcp/broker.mjs'), /env: \{ \.\.\.process\.env, HARNESS_NODE: '1' \}/);
  assert.match(src('../mcp/daemon.mjs'), /HARNESS_NODE: '1' \}, stdio/);
});

test('drivers are not marked: the child driver and the daemon itself legitimately run entry skills and tm_*', () => {
  assert.ok(!src('../mcp/taskmanager.mjs').includes('HARNESS_NODE'));
});

test('hooks.json matches Skill', () => {
  assert.match(JSON.parse(src('../hooks/hooks.json')).hooks.PreToolUse[0].matcher, /\|Skill$/);
});
