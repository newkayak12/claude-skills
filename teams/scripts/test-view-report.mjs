// reportPayload(): the pure builder behind `view.mjs --once --format report` (the teams-status Report tab).
//
//   node --test teams/scripts/test-view-report.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { reportPayload } from './lib/view-report.mjs';
import { collectTask } from './lib/view-collect.mjs';
import { cardsOf } from './lib/view-summary.mjs';
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

// ---- view.mjs --once --format report ----
const VIEW = join(HERE, 'view.mjs');
function cli(args) {
  const r = spawnSync('node', [VIEW, '--once', '--format', 'report', ...args], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const out = r.stdout.trim().split('\n');
  assert.equal(out.length, 1);
  return JSON.parse(out[0]);
}
// a tasks dir holding one fixture task
function tasksDirWith(name) {
  const { task } = load(name);
  const tasksDir = realpathSync(mkdtempSync(join(tmpdir(), 'view-report-tasks-')));
  mkdirSync(join(tasksDir, task.run_id));
  writeFileSync(join(tasksDir, task.run_id, 'task.json'), JSON.stringify(task));
  return { tasksDir, task };
}

test('CLI: --format report prints the builder payload for the task', () => {
  const { tasksDir, task } = tasksDirWith('done');
  const p = cli(['--tasks-dir', tasksDir, '--task', task.run_id, '--cwd', task.cwd]);
  const { result, ...rest } = p;
  assert.deepEqual(rest, JSON.parse(JSON.stringify(reportPayload(task))));
  assert.deepEqual(result, { stories: { accepted: 0, total: 0 }, gate: null }); // the fixture names no STORY package
  assert.equal(p.verdict, 'finished');
});

// ---- result: STORY packages accepted, and the last goal gate ----
// pkgs: [{ id, state, verdict }]; a verdict is a ledger line, a card's state is its dispatch node's
function resultWorld({ pkgs, gate = { accept: true, match_pct: 88 }, extraNodes = [] }) {
  const { task } = load('done');
  const nodes = [{ node_id: 'report', stage: 'report', state: 'done', deps: [] }, ...extraNodes];
  for (const p of pkgs) {
    nodes.push({ node_id: `dispatch:${p.id}:1`, stage: 'dispatch', state: p.state, subgoal_id: p.id, deps: [] });
    nodes.push({ node_id: `accept:${p.id}:1`, stage: 'accept', state: p.state, subgoal_id: p.id, deps: [] });
  }
  // a finished planning card with no verdict line: a card, but not a STORY package
  nodes.push({ node_id: 'dispatch:PLAN1:1', stage: 'dispatch', state: 'done', subgoal_id: 'PLAN1', deps: [] });
  nodes.push({ node_id: 'accept:PLAN1:1', stage: 'accept', state: 'done', subgoal_id: 'PLAN1', deps: [] });
  if (gate) nodes.push({ node_id: 'gate:goal:1', stage: 'gate', state: 'done', deps: [], result: gate });
  Object.assign(task, { nodes, goal_threshold: 80, spec: { packages: pkgs.map((p) => ({ id: p.id, title: p.id })) }, planning_pkgs: [{ id: 'PLAN1', title: 'plan', phase: 'planning' }] });
  const tasksDir = realpathSync(mkdtempSync(join(tmpdir(), 'view-report-result-')));
  mkdirSync(join(tasksDir, task.run_id));
  writeFileSync(join(tasksDir, task.run_id, 'task.json'), JSON.stringify(task));
  const ledger = pkgs.filter((p) => p.verdict).map((p) => JSON.stringify({ ts: 1000, event: 'verdict', subgoal_id: p.id, verdict: p.verdict, attempt: 1 }));
  writeFileSync(join(tasksDir, task.run_id, 'ledger.jsonl'), ledger.join('\n') + '\n');
  resultWorld.last = { tasksDir, id: task.run_id };
  return cli(['--tasks-dir', tasksDir, '--task', task.run_id]);
}

test('CLI: result counts STORY packages whose verdict is accept; the gate is the last goal gate', () => {
  const p = resultWorld({ pkgs: [
    { id: 'P1', state: 'done', verdict: 'accept' }, { id: 'P2', state: 'done', verdict: 'accept' }, { id: 'P3', state: 'failed', verdict: 'reject' },
  ] });
  // the planning card really is in the card list (kind 'plan', settled, no verdict), so excluding it from total is proven
  const cards = cardsOf(collectTask(resultWorld.last.tasksDir, resultWorld.last.id));
  const plan = cards.find((x) => String(x.c.id) === 'PLAN1');
  assert.ok(plan && plan.kind === 'plan' && plan.state === 'done');
  assert.equal(cards.length, 4);
  assert.deepEqual(p.result, { stories: { accepted: 2, total: 3 }, gate: { accept: true, score: 88, threshold: 80 } });
  assert.equal(p.verdict, 'finished');
  assert.equal(p.failed, 2);
});

test('CLI: a done card whose current verdict is not accept is not counted', () => {
  const p = resultWorld({ pkgs: [{ id: 'P1', state: 'done', verdict: 'accept' }, { id: 'P2', state: 'done', verdict: 'reject' }, { id: 'P3', state: 'done' }] });
  assert.deepEqual(p.result.stories, { accepted: 1, total: 3 });
});

test('CLI: no goal gate node gives gate null; a rejecting gate reads accept false', () => {
  assert.equal(resultWorld({ pkgs: [{ id: 'P1', state: 'done', verdict: 'accept' }], gate: null }).result.gate, null);
  assert.deepEqual(resultWorld({ pkgs: [{ id: 'P1', state: 'done', verdict: 'accept' }], gate: { accept: false, match_pct: 40 } }).result.gate, { accept: false, score: 40, threshold: 80 });
});

test('CLI: an unknown task has result null', () => {
  const { tasksDir } = tasksDirWith('done');
  assert.equal(cli(['--tasks-dir', tasksDir, '--task', 'no-such-task']).result, null);
});

test('CLI: blocked task reads blocked', () => {
  const { tasksDir, task } = tasksDirWith('blocked');
  const p = cli(['--tasks-dir', tasksDir, '--task', task.run_id]);
  assert.equal(p.verdict, 'blocked');
  assert.equal(p.needs.items.length, 2);
});

test('CLI: unknown task prints report null and retro null, exit 0', () => {
  const { tasksDir } = tasksDirWith('done');
  const p = cli(['--tasks-dir', tasksDir, '--task', 'no-such-task']);
  assert.equal(p.task_id, 'no-such-task');
  assert.equal(p.report, null);
  assert.equal(p.retro, null);
});

test('CLI: a stalled task labelled blocked takes its items from "What would move it"', () => {
  const { tasksDir, task } = tasksDirWith('blocked');
  // a running node under a dead daemon: runState says running, collectTask says stalled
  task.nodes = [{ node_id: 'dispatch:P1:3', stage: 'dispatch', state: 'running', subgoal_id: 'P1', deps: [] }];
  task.daemon = { pid: 999999 };
  writeFileSync(join(tasksDir, task.run_id, 'task.json'), JSON.stringify(task));
  const p = cli(['--tasks-dir', tasksDir, '--task', task.run_id]);
  assert.equal(p.verdict, 'blocked');
  assert.equal(p.needs.items.length, 2);
  assert.equal(p.needs.items[1], 'a person decides the split');
});

test('CLI: usage lists the report format', () => {
  const r = spawnSync('node', [VIEW, '--help'], { encoding: 'utf8' });
  assert.match(r.stdout, /--format report/);
});
