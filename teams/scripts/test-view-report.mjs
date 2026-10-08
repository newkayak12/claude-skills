// reportPayload(): the pure builder behind `view.mjs --once --format report` (the teams-live Report tab).
//
//   node --test teams/scripts/test-view-report.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reportPayload } from './lib/view-report.mjs';
import { docPaths } from '../mcp/tickets.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, 'fixtures', 'report');

// a fixture copied to a temp dir, with task.cwd pointing at it
function load(name) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'view-report-')));
  cpSync(join(FIX, name), root, { recursive: true });
  const task = JSON.parse(readFileSync(join(root, 'task.json'), 'utf8'));
  task.cwd = root;
  return { root, task };
}
const lines = (s) => s.split('\n').length;

test('done fixture: verdict, failed from run state, 3 items and more', () => {
  const { task } = load('done');
  const p = reportPayload(task);
  assert.equal(p.task_id, 'aaaaaaaa1111');
  assert.equal(p.verdict, 'finished');
  assert.equal(p.failed, 2);
  assert.deepEqual(p.needs.items, ['module b: tests red', 'module c: never dispatched', 'D1 b.txt never wired']);
  assert.equal(p.needs.more, 2); // D2 and the open question
  assert.equal(p.path, docPaths(task).report);
  assert.match(p.report.text, /^---\nkey: E-aaaaaaaa/);
  assert.equal(p.report.truncated, false);
  assert.equal(p.report.more_lines, 0);
  assert.ok(p.report.mtime > 0);
  assert.equal(p.retro.next_backlog.unaccepted_packages.length, 2);
});

test('blocked fixture: items come from "What would move it"', () => {
  const { task } = load('blocked');
  const p = reportPayload(task);
  assert.equal(p.verdict, 'blocked');
  assert.equal(p.needs.items.length, 2);
  assert.match(p.needs.items[0], /^tm_retry\(/);
  assert.equal(p.needs.items[1], 'a person decides the split');
  assert.equal(p.needs.more, 0);
  assert.equal(p.retro, null);
});

test('no retro.json: retro null, report still returned', () => {
  const p = reportPayload(load('no-retro').task);
  assert.equal(p.retro, null);
  assert.ok(p.report.text.includes('# Report'));
  assert.deepEqual(p.needs.items, []);
});

test('bad retro.json: retro null', () => {
  const p = reportPayload(load('bad-json').task);
  assert.equal(p.retro, null);
  assert.ok(p.report);
});

test('no report file: report null, path still set', () => {
  const { task, root } = load('done');
  rmSync(docPaths(task).report);
  const p = reportPayload(task);
  assert.equal(p.report, null);
  assert.equal(p.path, join(root, 'docs', 'E-aaaaaaaa', '80-report.md'));
  assert.ok(p.retro);
});

test('30k report: capped at 20000, truncated, more_lines counted (S1 fallback)', () => {
  const { task } = load('huge');
  const full = readFileSync(docPaths(task).report, 'utf8');
  assert.ok(full.length >= 30000);
  const p = reportPayload(task);
  assert.ok(p.report.text.length <= 20000);
  assert.ok(p.report.text.length > 19000);
  assert.equal(p.report.truncated, true);
  assert.equal(p.report.more_lines, lines(full.replace(/\n$/, '')) - lines(p.report.text));
  assert.ok(full.startsWith(p.report.text));
  assert.equal(p.path, docPaths(task).report);
});

test('custom docs_dir', () => {
  const { task, root } = load('done');
  cpSync(join(root, 'docs'), join(root, 'elsewhere', 'deep'), { recursive: true });
  rmSync(join(root, 'docs'), { recursive: true });
  task.team.opts.docs_dir = join('elsewhere', 'deep');
  const p = reportPayload(task);
  assert.equal(p.path, join(root, 'elsewhere', 'deep', 'E-aaaaaaaa', '80-report.md'));
  assert.ok(p.report);
});

test('default docs_dir when the task names none', () => {
  const { task, root } = load('done');
  delete task.team;
  mkdirSync(join(root, '.teams_output', 'team'), { recursive: true });
  cpSync(join(root, 'docs', 'E-aaaaaaaa'), join(root, '.teams_output', 'team', 'E-aaaaaaaa'), { recursive: true });
  assert.ok(reportPayload(task).report);
});

test('cwd through a symlink reads the same file', () => {
  const { task, root } = load('done');
  const link = join(tmpdir(), `view-report-link-${process.pid}`);
  symlinkSync(root, link);
  try {
    const viaLink = reportPayload({ ...task, cwd: link });
    assert.equal(viaLink.report.text, reportPayload(task).report.text);
  } finally { rmSync(link); }
});

test('unreadable report or io that throws: nulls, never a throw', () => {
  const { task } = load('done');
  const boom = () => { throw new Error('nope'); };
  const p = reportPayload(task, { read: boom, stat: boom });
  assert.equal(p.report, null);
  assert.equal(p.retro, null);
  assert.deepEqual(p.needs, { items: [], more: 0 });
});

test('a task with nothing usable still returns a payload', () => {
  const p = reportPayload({});
  assert.equal(p.report, null);
  assert.equal(p.retro, null);
});

test('retro with fewer fields yields fewer items, none invented', () => {
  const { task } = load('done');
  writeFileSync(docPaths(task).retro, JSON.stringify({ next_backlog: { unresolved_defects: [{ title: 'only one' }] } }));
  assert.deepEqual(reportPayload(task).needs, { items: ['only one'], more: 0 });
});
