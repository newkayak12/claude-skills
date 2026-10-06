// Pure helpers behind `view.mjs --once --format status|events` (the teams-live mod).
//
//   node --test teams/scripts/test-view-events.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { notableEvents, statusLine } from './lib/view-events.mjs';

const L = (o) => JSON.stringify(o);
const ID = 'E-1a2b3c4d5e6f';

test('node_finish: only the failed one is notable', () => {
  const out = notableEvents([
    L({ ts: 10, event: 'node_finish', task_id: ID, node_id: 'n1', state: 'failed' }),
    L({ ts: 11, event: 'node_finish', task_id: ID, node_id: 'n2', state: 'done' }),
  ], 0);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0], { ts: 10, task_id: ID, kind: 'node_finish', text: 'E-1a2b3c4d n1 failed' });
});

test('the other five events produce the table texts', () => {
  const t = (e) => notableEvents([L({ ts: 5, task_id: ID, ...e })], 0).map((x) => x.text);
  assert.deepEqual(t({ event: 'waiting_human', node_id: 'n3' }), ['E-1a2b3c4d needs you: n3']);
  assert.deepEqual(t({ event: 'child_driver_capacity' }), ['E-1a2b3c4d paused: provider limit']);
  assert.deepEqual(t({ event: 'daemon_done', state: 'done' }), ['E-1a2b3c4d finished: done']);
  assert.deepEqual(t({ event: 'daemon_exhausted' }), ['E-1a2b3c4d stopped: daemon restarts used up']);
  assert.deepEqual(t({ event: 'upstream_fix_rounds_exhausted', package_id: '3' }), ['E-1a2b3c4d 3: fix rounds used up']);
  assert.deepEqual(t({ event: 'node_start' }), []);
});

test('events at or before sinceTs are dropped', () => {
  const out = notableEvents([
    L({ ts: 10, event: 'daemon_exhausted', task_id: ID }),
    L({ ts: 11, event: 'daemon_exhausted', task_id: ID }),
  ], 10);
  assert.deepEqual(out.map((e) => e.ts), [11]);
});

test('a torn last line is ignored', () => {
  const out = notableEvents([
    L({ ts: 10, event: 'daemon_exhausted', task_id: ID }),
    '{"ts":12,"event":"daemon_exhausted","task_id":"E-1a2b3c4d5e6f"',
  ], 0);
  assert.deepEqual(out.map((e) => e.ts), [10]);
});

test('statusLine: empty and two tasks', () => {
  assert.equal(statusLine([]), '');
  assert.equal(statusLine([
    { id: 'E-1a2b3c4d', state: 'running', done: 7, total: 12, current: 'P3 implement' },
    { id: 'E-5e6f7a8b', state: 'running', done: 2, total: 9, current: 'shape' },
  ]), 'teams: E-1a2b3c4d 7/12 P3 implement · E-5e6f7a8b 2/9 shape');
});

// ---------- CLI: view.mjs --once --format status|events ----------
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { node } from '../mcp/graph.mjs';

const VIEW = join(dirname(fileURLToPath(import.meta.url)), 'view.mjs');
const RUN_ID = 'E-aaaaaaaa1111';
const DONE_ID = 'E-bbbbbbbb2222';

// "Running" is collect()'s rule (view-collect.mjs collectTask): state 'running', and when
// task.daemon is set, task.daemon.pid alive (pidAlive). The fixture's daemon.pid is this test
// process, which pidAlive reports alive.
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'view-events-'));
  const cwd = join(root, 'proj');
  mkdirSync(cwd);
  const tasks = join(root, 'tasks');
  const mk = (id, nodes, daemon) => {
    mkdirSync(join(tasks, id), { recursive: true });
    writeFileSync(join(tasks, id, 'task.json'), JSON.stringify({
      run_id: id, cwd, request: 'r', created_at: 1, store_path: join(tasks, id, 'task.json'), nodes,
      ...(daemon ? { daemon: { pid: process.pid } } : {}),
    }));
  };
  mk(RUN_ID, [node('size', 'size', [], { state: 'done' }), node('shape', 'shape', ['size'], { state: 'running' }),
    node('critique', 'critique', ['shape'], { state: 'waiting_human' })], true);
  mk(DONE_ID, [node('report', 'report', [], { state: 'done', result: {} })], false);
  // a dir with only a ledger and no task.json: unknown state, not running
  mkdirSync(join(tasks, 'E-cccccccc3333'));
  writeFileSync(join(tasks, 'E-cccccccc3333', 'ledger.jsonl'), JSON.stringify({ ts: 9, event: 'daemon_exhausted', task_id: 'E-cccccccc3333' }) + '\n');
  writeFileSync(join(tasks, RUN_ID, 'ledger.jsonl'), [
    { ts: 5, event: 'node_start', task_id: RUN_ID },
    { ts: 6, event: 'daemon_exhausted', task_id: RUN_ID },
    { ts: 7, event: 'child_driver_capacity', task_id: RUN_ID },
  ].map((o) => JSON.stringify(o)).join('\n') + '\n');
  writeFileSync(join(tasks, DONE_ID, 'ledger.jsonl'), JSON.stringify({ ts: 9, event: 'daemon_exhausted', task_id: DONE_ID }) + '\n');
  return { root, cwd, tasks };
}
const cli = (f, ...a) => spawnSync(process.execPath, [VIEW, '--once', '--tasks-dir', f.tasks, '--cwd', f.cwd, ...a], { encoding: 'utf8' });

test('--format status: only the running task, id8 named, waiting from task.json node state', () => {
  const f = fixture();
  try {
    const r = cli(f, '--format', 'status');
    assert.equal(r.status, 0, r.stderr);
    const o = JSON.parse(r.stdout);
    assert.ok(o.line.length > 0);
    assert.ok(o.line.includes('E-aaaaaaaa'));
    assert.ok(!o.line.includes('E-bbbbbbbb') && !o.line.includes('E-cccccccc'));
    assert.equal(o.waiting, 1);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('--format status: another cwd gives an empty line', () => {
  const f = fixture();
  try {
    const r = spawnSync(process.execPath, [VIEW, '--once', '--tasks-dir', f.tasks, '--cwd', join(f.root, 'elsewhere'), '--format', 'status'], { encoding: 'utf8' });
    assert.deepEqual(JSON.parse(r.stdout), { line: '', waiting: 0 });
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('--format events --since 0: notable lines of running tasks only', () => {
  const f = fixture();
  try {
    const r = cli(f, '--format', 'events', '--since', '0');
    assert.equal(r.status, 0, r.stderr);
    const evs = r.stdout.trim().split('\n').map((l) => JSON.parse(l));
    assert.deepEqual(evs.map((e) => e.kind), ['daemon_exhausted', 'child_driver_capacity']);
    assert.ok(evs.every((e) => e.task_id === RUN_ID));
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('--format events reads only the ledger tail', () => {
  const f = fixture();
  try {
    const head = (JSON.stringify({ ts: 1, event: 'daemon_exhausted', task_id: RUN_ID }) + '\n').repeat(75000)
      + 'x'.repeat(300000);
    const tail = [
      { ts: 20, event: 'waiting_human', task_id: RUN_ID, node_id: 'n9' },
      { ts: 21, event: 'node_start', task_id: RUN_ID },
      { ts: 22, event: 'daemon_done', task_id: RUN_ID, state: 'done' },
    ].map((o) => JSON.stringify(o)).join('\n') + '\n';
    const p = join(f.tasks, RUN_ID, 'ledger.jsonl');
    writeFileSync(p, head + '\n' + tail);
    const big = cli(f, '--format', 'events', '--since', '0');
    writeFileSync(p, tail);
    const small = cli(f, '--format', 'events', '--since', '0');
    assert.ok(head.length > 4.5e6);
    assert.equal(big.stdout, small.stdout);
    assert.deepEqual(big.stdout.trim().split('\n').map((l) => JSON.parse(l).ts), [20, 22]);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});
