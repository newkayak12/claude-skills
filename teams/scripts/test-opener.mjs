// U1: tm_open records the opener; openerEnv hands it to child drivers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openerEnv } from '../mcp/taskmanager.mjs';

const TM = join(dirname(fileURLToPath(import.meta.url)), '..', 'mcp', 'taskmanager.mjs');

function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'tm-opener-'));
  const git = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' });
  git('init', '-q');
  git('config', 'user.email', 't@t');
  git('config', 'user.name', 't');
  writeFileSync(join(dir, 'a.txt'), 'x\n');
  git('add', '-A');
  git('commit', '-qm', 'init');
  return dir;
}

// Spawn a TM server with env overrides (undefined deletes), call tm_open once, return task.json.
// The server reads <TEAMS_SESSIONS_DIR>/<its ppid>.json; its ppid is this process, so a fixture
// (sessionFile, a string) is written as <process.pid>.json. The dir is a fresh temp one, so no
// case reads the real ~/.claude/sessions.
async function openWith(envOver, sessionFile) {
  const cwd = repo();
  const root = mkdtempSync(join(tmpdir(), 'tm-opener-root-'));
  const sessions = mkdtempSync(join(tmpdir(), 'tm-opener-sessions-'));
  if (sessionFile !== undefined) writeFileSync(join(sessions, `${process.pid}.json`), sessionFile);
  const env = { ...process.env, TEAMS_VIEW: '0', HARNESS_TASKS_DIR: root, HARNESS_TEST_NO_DRIVER: '1', TEAMS_SESSIONS_DIR: sessions };
  for (const [k, v] of Object.entries(envOver)) { if (v === undefined) delete env[k]; else env[k] = v; }
  const proc = spawn('node', [TM], { stdio: ['pipe', 'pipe', 'inherit'], env });
  let buf = '';
  const waiting = [];
  proc.stdout.setEncoding('utf8');
  proc.stdout.on('data', (c) => {
    buf += c;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (line.trim()) waiting.shift()(JSON.parse(line));
    }
  });
  let id = 0;
  const send = (method, params) => new Promise((resolve) => {
    waiting.push(resolve);
    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }) + '\n');
  });
  try {
    await send('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
    const r = await send('tools/call', { name: 'tm_open', arguments: { request: 'big request', cwd, vendor: 'self', brainstorm: false, roles: { qa: false, audit: false } } });
    const out = r.result.structuredContent;
    assert.ok(out && out.task_id, JSON.stringify(r));
    return JSON.parse(readFileSync(join(root, out.task_id, 'task.json'), 'utf8'));
  } finally {
    proc.stdin.end();
    proc.kill();
    rmSync(cwd, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
    rmSync(sessions, { recursive: true, force: true });
  }
}

test('(a) tm_open records the opener from the MCP env', async () => {
  const task = await openWith({ CLAUDE_CODE_SESSION_ID: 's-1', CLAUDE_CODE_ENTRYPOINT: 'cli' });
  assert.deepEqual(task.opener, { session_id: 's-1', entrypoint: 'cli' });
});

test('(b) no env -> opener fields are null', async () => {
  const task = await openWith({ CLAUDE_CODE_SESSION_ID: undefined, CLAUDE_CODE_ENTRYPOINT: undefined });
  assert.deepEqual(task.opener, { session_id: null, entrypoint: null });
});

test('(a2) the session file beats the spawn-time env', async () => {
  const task = await openWith({ CLAUDE_CODE_SESSION_ID: 's-env', CLAUDE_CODE_ENTRYPOINT: 'cli' },
    JSON.stringify({ pid: process.pid, sessionId: 's-file', kind: 'interactive' }));
  assert.deepEqual(task.opener, { session_id: 's-file', entrypoint: 'cli' });
});

test('(b2) no session file -> the env id', async () => {
  const task = await openWith({ CLAUDE_CODE_SESSION_ID: 's-env' });
  assert.equal(task.opener.session_id, 's-env');
});

test('(c2) a malformed session file -> the env id', async () => {
  const task = await openWith({ CLAUDE_CODE_SESSION_ID: 's-env' }, '{not json');
  assert.equal(task.opener.session_id, 's-env');
});

test('(d2) no session file and no env -> null', async () => {
  const task = await openWith({ CLAUDE_CODE_SESSION_ID: undefined });
  assert.equal(task.opener.session_id, null);
});

test('(c) openerEnv reads task.opener and run_id', () => {
  assert.deepEqual(
    openerEnv({ run_id: 'r-9', opener: { session_id: 's-1', entrypoint: 'cli' } }),
    { TEAMS_OPENER_SESSION_ID: 's-1', TEAMS_TASK_ID: 'r-9' },
  );
});

test('(d) openerEnv is {} for a null opener, a null id, or no opener', () => {
  assert.deepEqual(openerEnv({ run_id: 'r-9', opener: { session_id: null, entrypoint: null } }), {});
  assert.deepEqual(openerEnv({ run_id: 'r-9', opener: null }), {});
  assert.deepEqual(openerEnv({ run_id: 'r-9' }), {});
});
