// A test task must not land in the real run archive (mcp/runlog.mjs); spawned daemons inherit this.
process.env.TEAMS_RUNS_DIR ??= 'off';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
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
    assert.match(r.stderr, /Skill\(\{skill: "teams:orchestrate"/);
    assert.match(r.stderr, /src\/a\.mjs/);
    assert.match(r.stderr, /remove \.claude\/teams-dispatch\.json/, 'a gate must say how to get out of it');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('HARNESS_NODE=1 or agent_id: a gated write says stop and report; a main session keeps the invoke text and gains the sentence', () => {
  const dir = project({ paths: ['src/**'] });
  try {
    const input = { file_path: join(dir, 'src/a.mjs'), content: 'x'.repeat(5000) };
    const node = run(dir, input, 'Write', { HARNESS_NODE: '1' });
    assert.equal(node.status, 2);
    assert.match(node.stderr, /Stop and report this block/);
    assert.ok(!/Skill\(\{skill: "teams:orchestrate"/.test(node.stderr));
    const main = run(dir, input, 'Write', { HARNESS_NODE: '' });
    assert.match(main.stderr, /Skill\(\{skill: "teams:orchestrate"/);
    assert.match(main.stderr, /A subagent that sees this must not invoke the harness again/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('Skill: a node or subagent calling an entry skill is denied; others and main sessions pass', () => {
  const dir = project({ paths: ['src/**'] });
  const bare = project(null);
  const call = (d, skill, extra = {}, env = {}) => {
    const r = spawnSync(process.execPath, [gate], {
      input: JSON.stringify({ cwd: d, tool_name: 'Skill', tool_input: { skill }, ...extra }),
      encoding: 'utf8',
      env: { ...process.env, HARNESS_NODE: '', ...env },
    });
    return r.status;
  };
  try {
    for (const s of ['teams:orchestrate', 'teams:develop', 'teams:sprint', 'teams:document', 'teams:plan', 'teams:qa', 'graph:orchestrate', 'harness:harness']) {
      assert.equal(call(bare, s, {}, { HARNESS_NODE: '1' }), 2, s);
    }
    assert.equal(call(dir, 'teams:orchestrate', { agent_id: 'a' }), 2);
    assert.equal(call(bare, 'teams:orchestrate', { agent_id: 'a' }), 0);
    assert.equal(call(dir, 'teams:orchestrate'), 0);
    assert.equal(call(bare, 'teams:board', {}, { HARNESS_NODE: '1' }), 0);
    assert.equal(call(dir, 'teams:board', { agent_id: 'a' }), 0);
  } finally { rmSync(dir, { recursive: true, force: true }); rmSync(bare, { recursive: true, force: true }); }
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

test('a task that finished long ago, for this or another project, does not open the gate forever', () => {
  const dir = project({ paths: ['src/**'] });
  const tasks = join(dir, '.tasks');
  try {
    for (const [id, cwd, done] of [['a', dir, true], ['b', '/elsewhere', false]]) {
      mkdirSync(join(tasks, id), { recursive: true });
      writeFileSync(join(tasks, id, 'task.json'), JSON.stringify({ cwd }));
      writeFileSync(join(tasks, id, 'ledger.jsonl'), JSON.stringify({ event: 'tm_open' }) + '\n' + (done ? JSON.stringify({ event: 'daemon_done' }) + '\n' : ''));
    }
    assert.equal(run(dir, { file_path: join(dir, 'src/a.mjs'), content: 'x'.repeat(5000) }, 'Write', { HARNESS_TASKS_DIR: tasks }).status, 2);
    writeFileSync(join(tasks, 'a', 'ledger.jsonl'), JSON.stringify({ event: 'tm_open' }) + '\n');
    assert.equal(run(dir, { file_path: join(dir, 'src/a.mjs'), content: 'x'.repeat(5000) }, 'Write', { HARNESS_TASKS_DIR: tasks }).status, 0, 'this project\'s open task: nodes write');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a task opened through a symlink of this project counts as open, both ways', () => {
  const dir = project({ paths: ['src/**'] });
  const linkDir = mkdtempSync(join(tmpdir(), 'dispatch-gate-link-'));
  const link = join(linkDir, 'proj');
  const tasks = join(dir, '.tasks');
  try {
    symlinkSync(dir, link);
    mkdirSync(join(tasks, 'a'), { recursive: true });
    writeFileSync(join(tasks, 'a', 'ledger.jsonl'), JSON.stringify({ event: 'tm_open' }) + '\n');
    writeFileSync(join(tasks, 'a', 'task.json'), JSON.stringify({ cwd: link }));
    assert.equal(run(dir, { file_path: join(dir, 'src/a.mjs'), content: 'x'.repeat(5000) }, 'Write', { HARNESS_TASKS_DIR: tasks }).status, 0, 'task cwd is the link, session is the real dir');
    writeFileSync(join(tasks, 'a', 'task.json'), JSON.stringify({ cwd: dir }));
    assert.equal(run(link, { file_path: join(link, 'src/a.mjs'), content: 'x'.repeat(5000) }, 'Write', { HARNESS_TASKS_DIR: tasks }).status, 0, 'task cwd is the real dir, session is the link');
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(linkDir, { recursive: true, force: true });
  }
});

// ---- gate routing (_repo/docs/plans/2026-10-12-gate-routing.md) ----

function routed(dir, setup) {
  const home = mkdtempSync(join(tmpdir(), 'route-home-'));
  try {
    setup?.(home);
    return run(dir, { file_path: join(dir, 'src/a.mjs'), content: 'x'.repeat(5000) }, 'Write', { HOME: home });
  } finally { rmSync(home, { recursive: true, force: true }); }
}
const TEAMS_LINE = '  - A spec document, planning, QA, several areas, or unsure -> Skill({skill: "teams:orchestrate", args: "<the user\'s request>"})\n';

test('routing AC-1: harness + teams names the harness skill for simple development, teams for the rest', () => {
  const dir = project({ paths: ['src/**'] });
  try {
    writeFileSync(join(dir, '.claude', 'harness-gate.json'), '{}');
    const r = routed(dir);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /This project also dispatches through teams \+ harness; route by the kind of work\./);
    assert.ok(r.stderr.includes('-> Skill({skill: "harness:harness"})\n'));
    assert.ok(r.stderr.includes(TEAMS_LINE));
    assert.match(r.stderr, /remove \.claude\/teams-dispatch\.json/, 'the way out stays');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('routing AC-3: graph + teams (no harness config) names graph for simple development', () => {
  const dir = project({ paths: ['src/**'] });
  try {
    writeFileSync(join(dir, '.mcp.json'), JSON.stringify({ mcpServers: { 'graph-engineering': {} } }));
    const r = routed(dir);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /through teams \+ graph;/);
    assert.ok(r.stderr.includes('Skill({skill: "graph:orchestrate"})'));
    assert.ok(r.stderr.includes(TEAMS_LINE));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('routing AC-2: graph enabled in user settings with harness: graph first', () => {
  const dir = project({ paths: ['src/**'] });
  try {
    writeFileSync(join(dir, '.claude', 'harness-gate.json'), '{}');
    const r = routed(dir, (home) => {
      mkdirSync(join(home, '.claude'), { recursive: true });
      writeFileSync(join(home, '.claude', 'settings.json'), JSON.stringify({ enabledPlugins: { 'graph@newkayak12-claude-skills': true } }));
    });
    assert.match(r.stderr, /through teams \+ harness \+ graph;/);
    assert.ok(r.stderr.includes('Skill({skill: "graph:orchestrate"})'));
    assert.ok(!r.stderr.includes('harness:harness'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('routing AC-4: teams alone keeps today\'s message', () => {
  const dir = project({ paths: ['src/**'] });
  try {
    const r = routed(dir);
    assert.equal(r.status, 2);
    assert.ok(!r.stderr.includes('route by the kind of work'));
    assert.match(r.stderr, /Invoke the teams entry skill now with the user's request/);
    assert.match(r.stderr, /Skill\(\{skill: "teams:orchestrate", args: "<the user's request>"\}\)/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
