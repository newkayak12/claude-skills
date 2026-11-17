import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { neededDenials, writeDenials } from '../mcp/denials.mjs';

// Probed live (claude 2.1.312, 2026-10-28): a PreToolUse hook deny of `sed -i` and a dontAsk denial
// of `touch` both land in permission_denials as {tool_name, tool_use_id, tool_input:{command,...}}.
// Nothing marks the hook one, so neededDenials re-asks the project's hooks.
const entry = command => ({ tool_name: 'Bash', tool_use_id: 't', tool_input: { command, description: 'x' } });

function project(hook) {
  const dir = mkdtempSync(join(tmpdir(), 'denials-'));
  mkdirSync(join(dir, '.claude'));
  writeFileSync(join(dir, 'hook.mjs'), hook);
  const settings = { hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'node "$CLAUDE_PROJECT_DIR/hook.mjs"' }] }] } };
  writeFileSync(join(dir, '.claude', 'settings.json'), JSON.stringify(settings));
  return dir;
}

const DENY_SED = `
let s = ''; process.stdin.on('data', d => { s += d; }).on('end', () => {
  const c = JSON.parse(s).tool_input.command;
  if (/^perl -i/.test(c)) console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'no' } }));
});`;

test('a command the project hook refuses is the guard working, not a needed denial', () => {
  const dir = project(DENY_SED);
  try {
    // perl -i, not sed -i: DISALLOWED_BASH already excludes `sed -i` without any hook
    const envelope = { permission_denials: [entry('perl -i -pe s/a/b/ notes.txt')] };
    assert.deepEqual(neededDenials(envelope, dir), []);
    assert.deepEqual(neededDenials(envelope), ['perl -i -pe s/a/b/ notes.txt'], 'without a cwd there is no hook to ask');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a real Bash permission denial still counts next to a hook deny', () => {
  const dir = project(DENY_SED);
  try {
    const envelope = { permission_denials: [entry('perl -i -pe s/a/b/ notes.txt'), entry('touch made.txt'), entry('git commit -m x')] };
    assert.deepEqual(neededDenials(envelope, dir), ['touch made.txt']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// The shape of the envelope recorded in _repo/docs/2026-10-28-hook-deny-permission-denials.md (claude
// 2.1.312, `claude -p --output-format json`, is_error false): the repo hook's deny of `perl -i` and a
// dontAsk denial of `touch` are two entries of one permission_denials array, same shape.
const LIVE_ENVELOPE = {
  type: 'result', subtype: 'success', is_error: false, terminal_reason: 'completed',
  permission_denials: [
    { tool_name: 'Bash', tool_use_id: 'toolu_01PUKFkKKL3iJUkPCgbU7aX9', tool_input: { command: 'perl -i -pe s/a/b/ _repo/docs/probe-nonexistent.txt', description: 'Run perl in-place edit probe on nonexistent file' } },
    { tool_name: 'Bash', tool_use_id: 'toolu_01Ai8864JEnW2cM23wiBm5xP', tool_input: { command: 'touch tmp/probe-made.txt', description: 'Create probe file under tmp directory' } },
  ],
};

test('the recorded live envelope: the hook-refused perl -i is dropped, the dontAsk touch is kept', () => {
  const dir = project(DENY_SED);
  try {
    assert.deepEqual(neededDenials(LIVE_ENVELOPE, dir), ['touch tmp/probe-made.txt']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a command only a plugin hooks.json hook refuses is kept (documented limit: settings hooks only)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'denials-'));
  try {
    mkdirSync(join(dir, '.claude'));
    mkdirSync(join(dir, 'plugin', 'hooks'), { recursive: true });
    writeFileSync(join(dir, 'hook.mjs'), DENY_SED);
    // the project's settings carry no hooks; the denying hook is declared in a plugin's hooks.json
    writeFileSync(join(dir, '.claude', 'settings.json'), JSON.stringify({}));
    const plugin = { hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'node "$CLAUDE_PROJECT_DIR/hook.mjs"' }] }] } };
    writeFileSync(join(dir, 'plugin', 'hooks', 'hooks.json'), JSON.stringify(plugin));
    assert.deepEqual(neededDenials(LIVE_ENVELOPE, dir), ['perl -i -pe s/a/b/ _repo/docs/probe-nonexistent.txt', 'touch tmp/probe-made.txt']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

const fileEntry = (tool_name, file_path) => ({ tool_name, tool_use_id: 't', tool_input: { file_path } });

test('writeDenials returns Write, Edit, MultiEdit and NotebookEdit denials with their file_path', () => {
  const denials = [
    fileEntry('Write', '/w/a.md'), fileEntry('Edit', '/w/b.mjs'),
    fileEntry('MultiEdit', '/w/c.mjs'), fileEntry('NotebookEdit', '/w/d.ipynb'),
  ];
  const got = writeDenials({ permission_denials: denials });
  assert.deepEqual(got, denials);
  assert.deepEqual(got.map(d => d.tool_input.file_path), ['/w/a.md', '/w/b.mjs', '/w/c.mjs', '/w/d.ipynb']);
});

test('writeDenials ignores Bash and other tools, and neededDenials is unchanged next to it', () => {
  const envelope = { permission_denials: [entry('touch made.txt'), fileEntry('Read', '/w/r.md'), fileEntry('Write', '/w/a.md')] };
  assert.deepEqual(writeDenials(envelope), [fileEntry('Write', '/w/a.md')]);
  assert.deepEqual(neededDenials(envelope), ['touch made.txt']);
});

test('writeDenials returns [] for a missing, empty or non-object envelope and never throws', () => {
  for (const bad of [undefined, null, 'x', 7, [], {}, { permission_denials: null }, { permission_denials: 'x' }, { permission_denials: [null, 3, {}, { tool_name: 'Write' }] }]) {
    assert.deepEqual(writeDenials(bad), []);
  }
});

test('a hook that exits 2 refuses; a hook that crashes or a project without settings does not', () => {
  const dir = project('process.exit(2)');
  const broken = project('throw new Error("boom")');
  const bare = mkdtempSync(join(tmpdir(), 'denials-'));
  try {
    const envelope = { permission_denials: [entry('touch made.txt')] };
    assert.deepEqual(neededDenials(envelope, dir), []);
    assert.deepEqual(neededDenials(envelope, broken), ['touch made.txt']);
    assert.deepEqual(neededDenials(envelope, bare), ['touch made.txt']);
  } finally { for (const d of [dir, broken, bare]) rmSync(d, { recursive: true, force: true }); }
});
