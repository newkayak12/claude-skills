import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { markerPath, touchMarker, clearMarker } from '../mcp/engage.mjs';

const HARNESS_GATE = fileURLToPath(new URL('../../harness/hooks/goal-gate.mjs', import.meta.url));

function worktreeLike() {
  const dir = mkdtempSync(join(tmpdir(), 'engage-'));
  mkdirSync(join(dir, '.claude'), { recursive: true });
  writeFileSync(join(dir, '.claude', 'harness-gate.json'), JSON.stringify({ patterns: ['src/.*\\.kt$'] }));
  writeFileSync(join(dir, 'transcript.jsonl'), '{"type":"user","text":"hello"}\n'); // no harness trace
  return dir;
}

function harnessGate(cwd) {
  const r = spawnSync(process.execPath, [HARNESS_GATE], {
    input: JSON.stringify({
      cwd, session_id: 'sess-1', tool_name: 'Write',
      tool_input: { file_path: join(cwd, 'src', 'A.kt'), content: 'x' },
      transcript_path: join(cwd, 'transcript.jsonl'),
    }),
    encoding: 'utf8',
  });
  return { status: r.status, stdout: r.stdout };
}

test('touchMarker writes a Date.now() string under .claude/.harness-markers/team-<task8>', () => {
  const dir = worktreeLike();
  try {
    const before = Date.now();
    assert.equal(touchMarker(dir, '0123456789abcdef'), true);
    const p = markerPath(dir, '0123456789abcdef');
    assert.equal(p, join(dir, '.claude', '.harness-markers', 'team-01234567'));
    const ts = parseInt(readFileSync(p, 'utf8'), 10);
    assert.ok(ts >= before && ts <= Date.now());
    clearMarker(dir, '0123456789abcdef');
    assert.equal(existsSync(p), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('touchMarker never throws on an unwritable cwd', () => {
  assert.equal(touchMarker('/nonexistent/definitely/not/here', 'abc'), false);
});

test('harness goal-gate denies a gated write in a fresh worktree, and passes once the team marker exists', () => {
  const dir = worktreeLike();
  try {
    const denied = harnessGate(dir);
    assert.equal(denied.status, 0, 'the harness hook always exits 0');
    assert.match(denied.stdout, /"permissionDecision":\s*"deny"/, 'without a marker the harness gate blocks the worker');
    touchMarker(dir, 'task-xyz');
    const passed = harnessGate(dir);
    assert.equal(passed.stdout.trim(), '', 'a recent marker in the shared dir lets the write through');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a stale marker (older than the 2h window) does not count', () => {
  const dir = worktreeLike();
  try {
    mkdirSync(join(dir, '.claude', '.harness-markers'), { recursive: true });
    writeFileSync(join(dir, '.claude', '.harness-markers', 'team-old'), String(Date.now() - 3 * 60 * 60 * 1000));
    assert.match(harnessGate(dir).stdout, /"permissionDecision":\s*"deny"/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
