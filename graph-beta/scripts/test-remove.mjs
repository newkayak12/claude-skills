import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const INSTALL = fileURLToPath(new URL('../skills/install/install.mjs', import.meta.url));
const REMOVE = fileURLToPath(new URL('../skills/remove/remove.mjs', import.meta.url));

function installed() {
  const home = mkdtempSync(join(tmpdir(), 'remove-home-'));
  const dir = mkdtempSync(join(tmpdir(), 'remove-proj-'));
  const tasks = mkdtempSync(join(tmpdir(), 'remove-tasks-'));
  writeFileSync(join(dir, 'CLAUDE.md'), '# Project\n\nkeep me\n');
  writeFileSync(join(dir, '.gitignore'), 'node_modules/\n');
  spawnSync(process.execPath, [INSTALL, JSON.stringify({ projectDir: dir, dispatch: { paths: ['src/**'] } })], { env: { ...process.env, HOME: home } });
  return { home, dir, tasks, cleanup: () => [home, dir, tasks].forEach((d) => rmSync(d, { recursive: true, force: true })) };
}
function run(dir, tasks, args) {
  const r = spawnSync(process.execPath, [REMOVE, JSON.stringify({ projectDir: dir, ...args })], { encoding: 'utf8', env: { ...process.env, HARNESS_TASKS_DIR: tasks } });
  return { status: r.status, report: r.stdout ? JSON.parse(r.stdout) : null, stderr: r.stderr };
}

test('remove deletes install artifacts, keeps conventions and unrelated content', () => {
  const { dir, tasks, cleanup } = installed();
  try {
    const { status, report } = run(dir, tasks, {});
    assert.equal(status, 0);
    assert.equal(report.actions.team, 'removed');
    assert.equal(report.actions.dispatch, 'removed');
    assert.equal(report.actions.claudeMd, 'removed-block');
    assert.equal(readFileSync(join(dir, 'CLAUDE.md'), 'utf8'), '# Project\n\nkeep me\n');
    assert.equal(readFileSync(join(dir, '.gitignore'), 'utf8'), 'node_modules/\n');
    assert.equal(report.actions.conventions, 'kept');
    assert.ok(existsSync(join(dir, '.claude', 'conventions', 'coding.md')));
  } finally { cleanup(); }
});

test('second run reports absent everywhere', () => {
  const { dir, tasks, cleanup } = installed();
  try {
    run(dir, tasks, {});
    const { report } = run(dir, tasks, {});
    assert.equal(report.actions.team, 'absent');
    assert.equal(report.actions.dispatch, 'absent');
    assert.equal(report.actions.claudeMd, 'absent');
    assert.equal(report.actions.gitignore, 'absent');
  } finally { cleanup(); }
});

test('purgeConventions and purgeRuns are opt-in', () => {
  const { dir, tasks, cleanup } = installed();
  try {
    mkdirSync(join(dir, '.harness-run', 'broker-beta'), { recursive: true });
    const { report } = run(dir, tasks, { purgeConventions: true, purgeRuns: true });
    assert.equal(report.actions.conventions, 'removed');
    assert.equal(report.actions.runs, 'removed');
    assert.equal(existsSync(join(dir, '.harness-run')), false);
  } finally { cleanup(); }
});

test('purgeTasks removes only tasks of this project, and refuses one whose driver is alive', () => {
  const { dir, tasks, cleanup } = installed();
  try {
    mkdirSync(join(tasks, 'mine-dead'), { recursive: true });
    writeFileSync(join(tasks, 'mine-dead', 'task.json'), JSON.stringify({ cwd: dir, nodes: [{ child: { driver: { pid: 999999999 } } }] }));
    mkdirSync(join(tasks, 'mine-alive'), { recursive: true });
    writeFileSync(join(tasks, 'mine-alive', 'task.json'), JSON.stringify({ cwd: dir, nodes: [{ child: { driver: { pid: process.pid } } }] }));
    mkdirSync(join(tasks, 'other'), { recursive: true });
    writeFileSync(join(tasks, 'other', 'task.json'), JSON.stringify({ cwd: '/somewhere/else', nodes: [] }));
    const { report } = run(dir, tasks, { purgeTasks: true });
    assert.deepEqual(report.actions.tasks, { 'mine-dead': 'removed', 'mine-alive': 'refused-alive' });
    assert.equal(existsSync(join(tasks, 'other')), true);
    assert.equal(existsSync(join(tasks, 'mine-alive')), true);
  } finally { cleanup(); }
});

test('unmatched CLAUDE.md markers are left alone and reported', () => {
  const { dir, tasks, cleanup } = installed();
  try {
    writeFileSync(join(dir, 'CLAUDE.md'), '<!-- graph-beta:begin v1 -->\nno end\n');
    const { report } = run(dir, tasks, {});
    assert.equal(report.actions.claudeMd, 'marker-error');
    assert.match(readFileSync(join(dir, 'CLAUDE.md'), 'utf8'), /no end/);
  } finally { cleanup(); }
});
