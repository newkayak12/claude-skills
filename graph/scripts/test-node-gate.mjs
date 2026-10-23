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

// ---- write check: a gated path outside a run is denied (.claude/harness-gate.json) ----
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function gatedProject(config = { patterns: ['\\.mjs$'], window_hours: 2 }, openNodes = null) {
  const dir = mkdtempSync(join(tmpdir(), 'node-gate-'));
  mkdirSync(join(dir, '.claude'), { recursive: true });
  if (config !== null) writeFileSync(join(dir, '.claude', 'harness-gate.json'), typeof config === 'string' ? config : JSON.stringify(config));
  if (openNodes) {
    mkdirSync(join(dir, '.harness-run', 'broker'), { recursive: true });
    writeFileSync(join(dir, '.harness-run', 'broker', 'open-nodes.json'), JSON.stringify(openNodes));
  }
  return dir;
}

function writeRun(dir, payload, env = {}, hook = HOOK) {
  const r = spawnSync(process.execPath, [hook], {
    input: JSON.stringify({ cwd: dir, ...payload }),
    encoding: 'utf8',
    env: { ...process.env, HARNESS_NODE: '', CLAUDE_PROJECT_DIR: dir, ...env },
  });
  assert.equal(r.status, 0);
  const out = r.stdout.trim() ? JSON.parse(r.stdout).hookSpecificOutput : null;
  return { decision: out ? out.permissionDecision : 'allow', reason: out ? out.permissionDecisionReason : '' };
}
const write = (dir, file) => ({ tool_name: 'Write', tool_input: { file_path: join(dir, file) } });
const bash = (dir, command) => ({ tool_name: 'Bash', tool_input: { command } });
const patch = (dir, file) => ({ tool_name: 'apply_patch', tool_input: { command: `*** Begin Patch\n*** Add File: ${file}\n+x\n*** End Patch` } });

test('a Write to a gated path with no open run is denied, naming the path and the rule', () => {
  const dir = gatedProject();
  try {
    const v = writeRun(dir, write(dir, 'src/a.mjs'));
    assert.equal(v.decision, 'deny');
    assert.match(v.reason, /\/src\/a\.mjs/);
    assert.match(v.reason, /harness-gate\.json/);
    assert.match(v.reason, /\\\.mjs\$/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the same Write passes with HARNESS_NODE=1 or an open node; ungated paths pass', () => {
  const dir = gatedProject();
  const open = gatedProject(undefined, { 'implement:U1:1': { opened_at: Date.now() - 60_000 } });
  try {
    assert.equal(writeRun(dir, write(dir, 'src/a.mjs'), { HARNESS_NODE: '1' }).decision, 'allow');
    assert.equal(writeRun(open, write(open, 'src/a.mjs')).decision, 'allow');
    assert.equal(writeRun(dir, write(dir, 'notes.txt')).decision, 'allow');
  } finally { rmSync(dir, { recursive: true, force: true }); rmSync(open, { recursive: true, force: true }); }
});

test('an open-node entry older than window_hours (or from the future) is not an open run', () => {
  const stale = gatedProject({ patterns: ['\\.mjs$'], window_hours: 2 }, { n: { opened_at: Date.now() - 3 * 3600_000 } });
  const future = gatedProject(undefined, { n: { opened_at: Date.now() + 3600_000 } });
  const narrow = gatedProject({ patterns: ['\\.mjs$'], window_hours: 1 }, { n: { opened_at: Date.now() - 90 * 60_000 } });
  try {
    for (const d of [stale, future, narrow]) assert.equal(writeRun(d, write(d, 'a.mjs')).decision, 'deny', d);
  } finally { for (const d of [stale, future, narrow]) rmSync(d, { recursive: true, force: true }); }
});

test('Edit, MultiEdit and NotebookEdit are judged by their path', () => {
  const dir = gatedProject({ patterns: ['\\.mjs$', '\\.ipynb$'] });
  try {
    for (const tool_name of ['Edit', 'MultiEdit']) {
      assert.equal(writeRun(dir, { tool_name, tool_input: { file_path: join(dir, 'a.mjs') } }).decision, 'deny', tool_name);
    }
    assert.equal(writeRun(dir, { tool_name: 'NotebookEdit', tool_input: { notebook_path: join(dir, 'n.ipynb') } }).decision, 'deny');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a Bash redirect and a Codex apply_patch into a gated path are denied outside a run', () => {
  const dir = gatedProject();
  try {
    const b = writeRun(dir, bash(dir, 'echo x > src/a.mjs'));
    assert.equal(b.decision, 'deny');
    assert.match(b.reason, /a\.mjs/);
    const p = writeRun(dir, patch(dir, 'src/a.mjs'));
    assert.equal(p.decision, 'deny');
    assert.match(p.reason, /a\.mjs/);
    assert.equal(writeRun(dir, bash(dir, 'echo x > src/a.mjs'), { HARNESS_NODE: '1' }).decision, 'allow');
    assert.equal(writeRun(dir, patch(dir, 'src/a.mjs'), { HARNESS_NODE: '1' }).decision, 'allow');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('Bash and apply_patch that touch no gated path are allowed', () => {
  const dir = gatedProject();
  try {
    assert.equal(writeRun(dir, bash(dir, 'ls -la && git status')).decision, 'allow');
    assert.equal(writeRun(dir, bash(dir, 'echo x > notes.txt')).decision, 'allow');
    assert.equal(writeRun(dir, patch(dir, 'notes.txt')).decision, 'allow');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('no gate config, a malformed config or malformed input fails open', () => {
  const none = gatedProject(null);
  const bad = gatedProject('{not json');
  const badRe = gatedProject({ patterns: ['('] });
  try {
    for (const d of [none, bad, badRe]) assert.equal(writeRun(d, write(d, 'a.mjs')).decision, 'allow', d);
    for (const input of ['', 'null', '[]', '{"tool_name":"Write"}', '{"tool_name":"Bash","tool_input":{"command":7}}']) {
      const r = spawnSync(process.execPath, [HOOK], { input, encoding: 'utf8', env: { ...process.env, HARNESS_NODE: '', CLAUDE_PROJECT_DIR: none } });
      assert.equal(r.status, 0, input);
      assert.equal(r.stdout, '', input);
    }
  } finally { for (const d of [none, bad, badRe]) rmSync(d, { recursive: true, force: true }); }
});

test('a missing harness/hooks/goal-gate.mjs fails open', () => {
  const dir = gatedProject();
  try {
    mkdirSync(join(dir, 'graph', 'hooks'), { recursive: true });
    const lone = join(dir, 'graph', 'hooks', 'node-gate.mjs');
    copyFileSync(HOOK, lone);
    assert.equal(writeRun(dir, write(dir, 'a.mjs'), {}, lone).decision, 'allow');
    assert.equal(writeRun(dir, write(dir, 'a.mjs')).decision, 'deny');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the write check leaves Skill and MCP tool calls alone outside a run', () => {
  const dir = gatedProject();
  try {
    assert.equal(writeRun(dir, { tool_name: 'Skill', tool_input: { skill: 'graph:orchestrate' } }).decision, 'allow');
    assert.equal(writeRun(dir, { tool_name: 'mcp__graph-engineering__graph_open', tool_input: {} }).decision, 'allow');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('hooks.json and codex.json each gain a write-check entry after the Skill entry', () => {
  const claude = JSON.parse(readFileSync(path('../hooks/hooks.json'), 'utf8')).hooks.PreToolUse;
  assert.equal(claude.length, 2);
  assert.equal(claude[0].matcher, 'Skill');
  assert.equal(claude[1].matcher, 'Write|Edit|MultiEdit|NotebookEdit|Bash');
  assert.match(claude[1].hooks[0].command, /\$\{CLAUDE_PLUGIN_ROOT\}\/hooks\/node-gate\.mjs/);
  const raw = readFileSync(path('../hooks/codex.json'), 'utf8');
  const codex = JSON.parse(raw).hooks.PreToolUse;
  assert.equal(codex.length, 2);
  assert.equal(codex[0].matcher, 'Skill|mcp__.*__(graph_open|tm_open|tm_run)');
  assert.equal(codex[1].matcher, 'Write|Edit|MultiEdit|NotebookEdit|apply_patch|Bash');
  assert.match(codex[1].hooks[0].command, /node \$\{PLUGIN_ROOT\}\/hooks\/node-gate\.mjs/);
  assert.ok(!raw.includes('modules'));
});

test('node-gate carries no adapter body and no critique-round definition', () => {
  const src = readFileSync(HOOK, 'utf8');
  assert.ok(!/detectCodex|runCodex|max_critique_rounds/.test(src));
});
