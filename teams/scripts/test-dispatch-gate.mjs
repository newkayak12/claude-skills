import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const gate = fileURLToPath(new URL('../hooks/dispatch-gate.mjs', import.meta.url));

function project(config) {
  const dir = mkdtempSync(join(tmpdir(), 'dispatch-gate-'));
  mkdirSync(join(dir, '.claude'), { recursive: true });
  if (config !== null) writeFileSync(join(dir, '.claude', 'teams-dispatch.json'), JSON.stringify(config));
  return dir;
}

function run(cwd, tool_input, tool_name = 'Write', env = {}) {
  const r = spawnSync(process.execPath, [gate], {
    input: JSON.stringify({ cwd, tool_name, tool_input }),
    encoding: 'utf8',
    // A stray tasks dir from the developer's own machine must not decide a test.
    env: { ...process.env, HARNESS_TASKS_DIR: join(cwd, '.no-tasks'), ...env },
  });
  return { status: r.status, stderr: r.stderr };
}

test('no opt-in file means no gate at all', () => {
  const dir = project(null);
  try {
    assert.equal(run(dir, { file_path: join(dir, 'src/a.mjs'), content: 'x'.repeat(5000) }).status, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a gated write with nothing open is denied, and the message says what to call', () => {
  const dir = project({ paths: ['src/**'] });
  try {
    const r = run(dir, { file_path: join(dir, 'src/a.mjs'), content: 'x'.repeat(5000) });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /tm_open/);
    assert.match(r.stderr, /src\/a\.mjs/);
    assert.match(r.stderr, /remove \.claude\/teams-dispatch\.json/, 'a gate must say how to get out of it');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('once a run is open the nodes are the ones writing, so writes pass', () => {
  const dir = project({ paths: ['src/**'] });
  try {
    mkdirSync(join(dir, '.teams_output', 'broker', 'runs'), { recursive: true });
    writeFileSync(join(dir, '.teams_output', 'broker', 'runs', 'r.json'), '{}');
    assert.equal(run(dir, { file_path: join(dir, 'src/a.mjs'), content: 'x'.repeat(5000) }).status, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('paths outside the list, the allow list, and small edits all pass', () => {
  const dir = project({ paths: ['src/**'], allow: ['src/generated/**'], min_chars: 400 });
  try {
    assert.equal(run(dir, { file_path: join(dir, 'docs/x.md'), content: 'x'.repeat(5000) }).status, 0, 'not in paths');
    assert.equal(run(dir, { file_path: join(dir, 'src/generated/g.mjs'), content: 'x'.repeat(5000) }).status, 0, 'allowed');
    assert.equal(run(dir, { file_path: join(dir, 'src/a.mjs'), content: 'tiny' }).status, 0, 'under min_chars');
    assert.equal(run(dir, { file_path: join(dir, 'src/a.mjs'), content: 'x'.repeat(500) }).status, 2, 'over min_chars');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the harness own state is never gated, and neither is anything outside the project', () => {
  const dir = project({});
  try {
    assert.equal(run(dir, { file_path: join(dir, '.harness-run/broker/runs/r.json'), content: 'x'.repeat(900) }).status, 0, 'the harness/graph run dir stays allowed for coexistence');
    assert.equal(run(dir, { file_path: join(dir, '.teams_output/broker/runs/r.json'), content: 'x'.repeat(900) }).status, 0);
    assert.equal(run(dir, { file_path: join(dir, '.harness-tasks/t/task.json'), content: 'x'.repeat(900) }).status, 0);
    assert.equal(run(dir, { file_path: '/etc/hosts', content: 'x'.repeat(900) }).status, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('malformed hook input and malformed config both fail open', () => {
  const dir = project('not an object');
  try {
    const bad = spawnSync(process.execPath, [gate], { input: 'not json', encoding: 'utf8' });
    assert.equal(bad.status, 0, 'a hook must never brick a session over its own parsing');
    assert.equal(run(dir, { file_path: join(dir, 'src/a.mjs'), content: 'x'.repeat(900) }).status, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('an Edit and a MultiEdit are measured by what they add', () => {
  const dir = project({ min_chars: 400 });
  try {
    assert.equal(run(dir, { file_path: join(dir, 'a.mjs'), new_string: 'x'.repeat(500) }, 'Edit').status, 2);
    assert.equal(run(dir, { file_path: join(dir, 'a.mjs'), new_string: 'x' }, 'Edit').status, 0);
    const edits = { file_path: join(dir, 'a.mjs'), edits: [{ new_string: 'x'.repeat(300) }, { new_string: 'y'.repeat(300) }] };
    assert.equal(run(dir, edits, 'MultiEdit').status, 2, '300 + 300 is over 400');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a recent harness marker means another engine is engaged, so the write passes', () => {
  const dir = project({ paths: ['src/**'] });
  try {
    mkdirSync(join(dir, '.claude', '.harness-markers'), { recursive: true });
    writeFileSync(join(dir, '.claude', '.harness-markers', 'sess-1'), String(Date.now()));
    assert.equal(run(dir, { file_path: join(dir, 'src/a.mjs'), content: 'x'.repeat(5000) }).status, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a stale harness marker does not open the gate', () => {
  const dir = project({ paths: ['src/**'] });
  try {
    mkdirSync(join(dir, '.claude', '.harness-markers'), { recursive: true });
    writeFileSync(join(dir, '.claude', '.harness-markers', 'sess-1'), String(Date.now() - 3 * 60 * 60 * 1000));
    assert.equal(run(dir, { file_path: join(dir, 'src/a.mjs'), content: 'x'.repeat(5000) }).status, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
