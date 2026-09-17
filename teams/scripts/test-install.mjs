import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const INSTALL = fileURLToPath(new URL('../skills/install/install.mjs', import.meta.url));
const HARNESS_CONV = fileURLToPath(new URL('../../harness/skills/install/templates/conventions/', import.meta.url));
const OUR_CONV = fileURLToPath(new URL('../skills/install/templates/conventions/', import.meta.url));

function fresh() {
  const home = mkdtempSync(join(tmpdir(), 'install-home-'));
  const dir = mkdtempSync(join(tmpdir(), 'install-proj-'));
  return { home, dir, cleanup: () => { rmSync(home, { recursive: true, force: true }); rmSync(dir, { recursive: true, force: true }); } };
}
function run(dir, home, args) {
  const r = spawnSync(process.execPath, [INSTALL, JSON.stringify({ projectDir: dir, ...args })], { encoding: 'utf8', env: { ...process.env, HOME: home } });
  return { status: r.status, report: r.stdout ? JSON.parse(r.stdout) : null, stderr: r.stderr };
}

test('first install creates team.json (defaults), CLAUDE.md block, conventions, gitignore lines; no dispatch without patterns', () => {
  const { home, dir, cleanup } = fresh();
  try {
    const { status, report } = run(dir, home, {});
    assert.equal(status, 0);
    assert.equal(report.actions.team, 'created');
    const team = JSON.parse(readFileSync(join(dir, '.claude', 'team.json'), 'utf8'));
    assert.equal(team.goal_threshold, 90);
    assert.deepEqual(team.roles, { planning: false, qa: false });
    assert.equal(report.actions.dispatch, 'skipped');
    assert.equal(report.actions.claudeMd, 'created');
    assert.match(readFileSync(join(dir, 'CLAUDE.md'), 'utf8'), /<!-- teams:begin/);
    assert.deepEqual(report.actions.conventions, { 'coding.md': 'created', 'verification.md': 'created', 'boundaries.md': 'created' });
    const gi = readFileSync(join(dir, '.gitignore'), 'utf8');
    assert.match(gi, /^\.harness-run\/$/m);
    assert.match(gi, /^\.claude\/\.harness-markers\/$/m);
  } finally { cleanup(); }
});

test('second run is idempotent: everything kept/present, nothing rewritten', () => {
  const { home, dir, cleanup } = fresh();
  try {
    run(dir, home, {});
    writeFileSync(join(dir, '.claude', 'conventions', 'coding.md'), '# mine\n');
    const { report } = run(dir, home, {});
    assert.equal(report.actions.team, 'kept');
    assert.equal(report.actions.claudeMd, 'present');
    assert.equal(report.actions.conventions['coding.md'], 'kept');
    assert.equal(readFileSync(join(dir, '.claude', 'conventions', 'coding.md'), 'utf8'), '# mine\n');
    assert.equal(report.actions.gitignore, 'present');
  } finally { cleanup(); }
});

test('dispatch patterns write teams-dispatch.json once; team overrides land in team.json', () => {
  const { home, dir, cleanup } = fresh();
  try {
    const { report } = run(dir, home, { dispatch: { paths: ['src/**'], min_chars: 400 }, team: { goal_threshold: 95, roles: { qa: true } } });
    assert.equal(report.actions.dispatch, 'created');
    assert.deepEqual(JSON.parse(readFileSync(join(dir, '.claude', 'teams-dispatch.json'), 'utf8')), { paths: ['src/**'], min_chars: 400 });
    const team = JSON.parse(readFileSync(join(dir, '.claude', 'team.json'), 'utf8'));
    assert.equal(team.goal_threshold, 95);
    assert.deepEqual(team.roles, { planning: false, qa: true });
    assert.equal(run(dir, home, { dispatch: { paths: ['lib/**'] } }).report.actions.dispatch, 'kept');
  } finally { cleanup(); }
});

test('refresh adds keys a newer plugin introduced to team.json without touching existing values', () => {
  const { home, dir, cleanup } = fresh();
  try {
    mkdirSync(join(dir, '.claude'), { recursive: true });
    writeFileSync(join(dir, '.claude', 'team.json'), JSON.stringify({ goal_threshold: 77 }));
    const { report } = run(dir, home, { refresh: true });
    assert.equal(report.actions.team, 'refreshed');
    const team = JSON.parse(readFileSync(join(dir, '.claude', 'team.json'), 'utf8'));
    assert.equal(team.goal_threshold, 77);
    assert.equal(team.max_retries, 2);
    assert.equal(run(dir, home, { refresh: true }).report.actions.team, 'unchanged');
  } finally { cleanup(); }
});

test('the stable graph plugin in the same project is a conflict: exit 3, nothing written, force overrides', () => {
  const { home, dir, cleanup } = fresh();
  try {
    writeFileSync(join(dir, '.mcp.json'), JSON.stringify({ mcpServers: { 'graph-engineering': { command: 'node', args: ['x'] } } }));
    const r = run(dir, home, {});
    assert.equal(r.status, 3);
    assert.deepEqual(r.report.conflicts, ['.mcp.json registers graph-engineering (stable graph)']);
    assert.equal(existsSync(join(dir, '.claude', 'team.json')), false);
    assert.equal(run(dir, home, { force: true }).status, 0);
  } finally { cleanup(); }
});

test('graph enabled in the user settings is also a conflict; harness enabled is not', () => {
  const { home, dir, cleanup } = fresh();
  try {
    mkdirSync(join(home, '.claude'), { recursive: true });
    writeFileSync(join(home, '.claude', 'settings.json'), JSON.stringify({ enabledPlugins: { 'graph@newkayak12-claude-skills': true, 'harness@newkayak12-claude-skills': true } }));
    const r = run(dir, home, {});
    assert.equal(r.status, 3);
    assert.match(r.report.conflicts[0], /graph@newkayak12-claude-skills/);
    writeFileSync(join(home, '.claude', 'settings.json'), JSON.stringify({ enabledPlugins: { 'harness@newkayak12-claude-skills': true } }));
    assert.equal(run(dir, home, {}).status, 0);
  } finally { cleanup(); }
});

test('shipped convention templates are byte-identical to the harness ones (drift guard)', () => {
  for (const f of ['coding.md', 'verification.md', 'boundaries.md']) {
    assert.equal(readFileSync(join(OUR_CONV, f), 'utf8'), readFileSync(join(HARNESS_CONV, f), 'utf8'), f);
  }
});
