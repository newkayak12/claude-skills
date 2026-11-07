// The stalled rule (F4-AC-9..13): a task with no live driver reads stalled in every view.mjs output.
// Every fixture is a temp task dir this file builds; the real repo cwd's tasks are never read.
//
//   node --test teams/scripts/test-view-stalled.mjs
process.env.TEAMS_RUNS_DIR ??= 'off';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { node } from '../mcp/graph.mjs';
import { STALL_MS, driverLive, collectTask, listTasks } from './lib/view-collect.mjs';
import { renderIndexText } from './lib/view-render-text.mjs';

const VIEW = join(dirname(fileURLToPath(import.meta.url)), 'view.mjs');
const DEAD_PID = 2 ** 22 + 991;
const SEC = 1000;

// A plain (non-S) task, one STORY at work, whose dispatch node records one driver; the epic reads
// IN_PROGRESS and the package IN_PROGRESS before the stalled rule.
function fixture({ id = 'E-aaaaaaaa1111', ageMs = 0, streamAgeMs = null, pid = process.pid, driver = true, ledgerAgeMs = null, createdAgeMs = null } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'view-stalled-'));
  const cwd = join(root, 'proj');
  const dir = join(root, 'tasks', id);
  mkdirSync(join(dir, 'drivers'), { recursive: true });
  mkdirSync(cwd, { recursive: true });
  const now = Date.now();
  const log = join(dir, 'drivers', 'P1.stream.jsonl');
  const child = { run_id: 'child-1', cwd: join(root, 'wt'), driver: { pid, log, restarts: [] } };
  const nodes = [
    node('size', 'size', [], { state: 'done' }),
    node('shape', 'shape', ['size'], { state: 'done' }),
    node('critique', 'critique', ['shape'], { state: 'done' }),
    node('dispatch:P1:1', 'dispatch', ['critique'], { state: 'running', subgoal_id: 'P1', ...(driver ? { child } : {}) }),
    node('accept:P1:1', 'accept', ['dispatch:P1:1'], { subgoal_id: 'P1' }),
    node('integrate:1', 'integrate', ['accept:P1:1']),
    node('report', 'report', ['integrate:1']),
  ];
  writeFileSync(join(dir, 'task.json'), JSON.stringify({
    run_id: id, kind: 'task', cwd, request: 'build the thing', created_at: now - (createdAgeMs ?? ageMs), store_path: join(dir, 'task.json'),
    spec: { packages: [{ id: 'P1', title: 'one', deps: [] }] }, nodes,
  }));
  const touch = (p, agoMs) => { const t = (now - agoMs) / 1000; utimesSync(p, t, t); };
  if (streamAgeMs != null) { writeFileSync(log, '{"type":"system"}\n'); touch(log, streamAgeMs); }
  if (ledgerAgeMs != null) { const lp = join(dir, 'ledger.jsonl'); writeFileSync(lp, ''); touch(lp, ledgerAgeMs); }
  return { root, cwd, dir, tasks: join(root, 'tasks'), id, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

const once = (f, ...a) => spawnSync(process.execPath, [VIEW, '--once', '--tasks-dir', f.tasks, '--cwd', f.cwd, ...a], { encoding: 'utf8' });

test('STALL_MS pinned to 600000', () => {
  assert.equal(STALL_MS, 600000);
});

test('9:59 not stalled', () => {
  const f = fixture({ streamAgeMs: STALL_MS - 1 * SEC });
  try {
    const m = collectTask(f.tasks, f.id);
    assert.equal(m.state, 'running');
    assert.equal(m.ticket.state, 'IN_PROGRESS');
    assert.equal(m.packages[0].ticket_state, 'IN_PROGRESS');
    assert.equal(listTasks(f.tasks)[0].state, 'IN_PROGRESS');
  } finally { f.cleanup(); }
});

test('10:01 stalled', () => {
  const f = fixture({ streamAgeMs: STALL_MS + 1 * SEC });
  try {
    const m = collectTask(f.tasks, f.id);
    assert.equal(m.state, 'stalled');
    assert.equal(m.ticket.state, 'stalled');
    assert.equal(m.packages[0].ticket_state, 'stalled');
    assert.equal(listTasks(f.tasks)[0].state, 'stalled');
  } finally { f.cleanup(); }
});

test('dead pid with fresh stream is stalled', () => {
  const f = fixture({ streamAgeMs: 1 * SEC, pid: DEAD_PID });
  try {
    const m = collectTask(f.tasks, f.id);
    assert.equal(m.state, 'stalled');
    assert.equal(m.ticket.state, 'stalled');
  } finally { f.cleanup(); }
});

test('a live daemon does not save a task whose driver stream is stale', () => {
  const f = fixture({ streamAgeMs: STALL_MS + 5 * SEC });
  try {
    const p = join(f.dir, 'task.json');
    const body = JSON.parse(readFileSync(p, 'utf8'));
    writeFileSync(p, JSON.stringify({ ...body, daemon: { pid: process.pid } }));
    assert.equal(collectTask(f.tasks, f.id).daemon.alive, true);
    assert.equal(collectTask(f.tasks, f.id).state, 'stalled');
  } finally { f.cleanup(); }
});

test('driverLive: fresh stream and live pid; no log or no stream is not live', () => {
  const f = fixture({ streamAgeMs: 1 * SEC });
  try {
    const log = join(f.dir, 'drivers', 'P1.stream.jsonl');
    assert.equal(driverLive({ pid: process.pid, log }, Date.now()), true);
    assert.equal(driverLive({ log }, Date.now()), true, 'no pid recorded: the stream alone decides');
    assert.equal(driverLive({ pid: DEAD_PID, log }, Date.now()), false);
    assert.equal(driverLive({ pid: process.pid, log }, Date.now() + STALL_MS + 2 * SEC), false);
    assert.equal(driverLive({ pid: process.pid }, Date.now()), false);
    assert.equal(driverLive({ pid: process.pid, log: join(f.dir, 'nope.jsonl') }, Date.now()), false);
    assert.equal(driverLive(null, Date.now()), false);
  } finally { f.cleanup(); }
});

test('no driver ever recorded: judged on the newest of stream, ledger, created_at', () => {
  const old = 3 * STALL_MS;
  const a = fixture({ driver: false, createdAgeMs: old, ledgerAgeMs: old });
  const b = fixture({ driver: false, createdAgeMs: old, ledgerAgeMs: 1 * SEC });
  const c = fixture({ driver: false, createdAgeMs: 1 * SEC });
  try {
    assert.equal(collectTask(a.tasks, a.id).state, 'stalled', 'everything old');
    assert.equal(collectTask(b.tasks, b.id).state, 'running', 'fresh ledger');
    assert.equal(collectTask(c.tasks, c.id).state, 'running', 'just created');
  } finally { a.cleanup(); b.cleanup(); c.cleanup(); }
});

test('a task that is done keeps its terminal word', () => {
  const f = fixture({ streamAgeMs: 3 * STALL_MS });
  try {
    const p = join(f.dir, 'task.json');
    const body = JSON.parse(readFileSync(p, 'utf8'));
    body.cancelled = true;
    writeFileSync(p, JSON.stringify(body));
    const m = collectTask(f.tasks, f.id);
    assert.equal(m.state, 'cancelled');
    assert.equal(m.ticket.state, 'CANCELLED');
  } finally { f.cleanup(); }
});

test('9-day-old task prints stalled', () => {
  const f = fixture({ ageMs: 9 * 86400 * SEC, streamAgeMs: 9 * 86400 * SEC });
  try {
    const row = listTasks(f.tasks)[0];
    assert.equal(row.state, 'stalled');

    const pipeline = once(f);
    assert.equal(pipeline.status, 0, pipeline.stderr);
    assert.match(pipeline.stdout, /stalled/);
    assert.ok(!pipeline.stdout.includes('IN_PROGRESS'), pipeline.stdout);

    const tickets = once(f, '--view', 'tickets', '--task', f.id);
    assert.equal(tickets.status, 0, tickets.stderr);
    assert.match(tickets.stdout, /stalled/);
    assert.ok(!tickets.stdout.includes('IN_PROGRESS') && !tickets.stdout.includes('READY'), tickets.stdout);

    const index = renderIndexText(listTasks(f.tasks), f.tasks);
    assert.match(index, /stalled/);
    assert.ok(!index.includes('IN_PROGRESS'), index);
    // two tasks make the CLI print the index itself
    const g = fixture({ id: 'E-bbbbbbbb2222', streamAgeMs: 1 * SEC });
    try {
      mkdirSync(join(f.tasks, g.id), { recursive: true });
      writeFileSync(join(f.tasks, g.id, 'task.json'), readFileSync(join(g.tasks, g.id, 'task.json')));
      const cli = spawnSync(process.execPath, [VIEW, '--once', '--tasks-dir', f.tasks], { encoding: 'utf8' });
      assert.equal(cli.status, 0, cli.stderr);
      assert.match(cli.stdout, /E-aaaaaa\s+stalled/);
    } finally { g.cleanup(); }

    const summary = once(f, '--format', 'summary', '--task', f.id);
    assert.equal(summary.status, 0, summary.stderr);
    assert.ok(!summary.stdout.includes('IN_PROGRESS'), summary.stdout);
    assert.equal(JSON.parse(summary.stdout).task.state, 'stalled');
  } finally { f.cleanup(); }
});

// ---------- F3 (card 125): one verdict, the task's own threshold, minutes ----------
const MIN = 60 * SEC;
const patchTask = (f, patch) => {
  const p = join(f.dir, 'task.json');
  writeFileSync(p, JSON.stringify({ ...JSON.parse(readFileSync(p, 'utf8')), ...patch }));
};
const stream = (f, name, agoMs) => {
  const p = join(f.dir, 'drivers', name);
  writeFileSync(p, '{"type":"system"}\n');
  const t = (Date.now() - agoMs) / 1000;
  utimesSync(p, t, t);
  return p;
};

// P1 is dispatched with no recorded driver; the one recorded driver is a dead planning driver, 2 h silent.
const planned = (id) => {
  const f = fixture({ id, driver: false, ledgerAgeMs: 2 * 60 * MIN, createdAgeMs: 2 * 60 * MIN });
  const log = stream(f, 'plan_1.stream.jsonl', 2 * 60 * MIN);
  const p = join(f.dir, 'task.json');
  const body = JSON.parse(readFileSync(p, 'utf8'));
  body.nodes.find((n) => n.node_id === 'critique').child = { run_id: 'plan-1', cwd: f.cwd, driver: { pid: DEAD_PID, log, restarts: [] } };
  writeFileSync(p, JSON.stringify(body));
  return f;
};

test('F3-AC-1: a fresh stream no recorded driver owns keeps the task running; AC-2 control: all streams old is stalled', () => {
  const live = planned('E-aaaaaaaa1111');
  const old = planned('E-bbbbbbbb2222');
  try {
    stream(live, 'dispatch_P1_1.stream.jsonl', 1 * SEC);
    const m = collectTask(live.tasks, live.id);
    assert.equal(m.state, 'running');
    assert.equal(m.ticket.state, 'IN_PROGRESS');
    assert.equal(m.packages[0].ticket_state, 'IN_PROGRESS');
    assert.deepEqual(m.stall, { stalled: false });
    stream(old, 'dispatch_P1_1.stream.jsonl', 2 * 60 * MIN);
    const c = collectTask(old.tasks, old.id);
    assert.equal(c.state, 'stalled');
    assert.equal(c.packages[0].ticket_state, 'stalled');
    assert.equal(c.stall.stalled, true);
    assert.ok(Number.isInteger(c.stall.minutes) && c.stall.minutes >= 119, `minutes ${c.stall.minutes}`);
  } finally { live.cleanup(); old.cleanup(); }
});

test('F3-AC-6: stall_minutes 20 with 15 min silent is not stalled; none with 10:01 is stalled', () => {
  const a = fixture({ streamAgeMs: 15 * MIN, createdAgeMs: 60 * MIN });
  const b = fixture({ streamAgeMs: STALL_MS + 1 * SEC, createdAgeMs: 60 * MIN });
  const c = fixture({ streamAgeMs: 21 * MIN, createdAgeMs: 60 * MIN });
  try {
    patchTask(a, { stall_minutes: 20 });
    patchTask(c, { stall_minutes: 20 });
    const ma = collectTask(a.tasks, a.id);
    assert.equal(ma.state, 'running');
    assert.equal(ma.packages[0].ticket_state, 'IN_PROGRESS');
    assert.equal(listTasks(a.tasks)[0].state, 'IN_PROGRESS', 'the index path uses the same verdict');
    assert.equal(collectTask(b.tasks, b.id).state, 'stalled');
    const mc = collectTask(c.tasks, c.id);
    assert.equal(mc.state, 'stalled');
    assert.equal(mc.stall.minutes, 21);
    const log = join(a.dir, 'drivers', 'P1.stream.jsonl');
    assert.equal(driverLive({ pid: process.pid, log }, Date.now(), 20 * MIN), true);
    assert.equal(driverLive({ pid: process.pid, log }), false, 'default threshold is STALL_MS');
  } finally { a.cleanup(); b.cleanup(); c.cleanup(); }
});

test('F3-AC-9/11/12: live pid within the threshold is not stalled; every driver dead and no fresh stream is stalled with minutes above 0', () => {
  const a = fixture({ streamAgeMs: 1 * SEC });
  const b = fixture({ pid: DEAD_PID, streamAgeMs: 30 * MIN, createdAgeMs: 60 * MIN });
  const c = fixture({ pid: DEAD_PID, streamAgeMs: 1 * SEC });
  try {
    assert.equal(collectTask(a.tasks, a.id).state, 'running');
    const mb = collectTask(b.tasks, b.id);
    assert.equal(mb.state, 'stalled');
    assert.equal(mb.stall.minutes, 30);
    const mc = collectTask(c.tasks, c.id);
    assert.equal(mc.state, 'stalled');
    assert.ok(mc.stall.minutes >= 1, 'a fresh own stream of a dead driver still reads above 0');
  } finally { a.cleanup(); b.cleanup(); c.cleanup(); }
});

test('F3-AC-7: the dead-daemon path returns the same { stalled, minutes } shape on the task-level basis', () => {
  const d = fixture({ driver: false, ledgerAgeMs: 25 * MIN, createdAgeMs: 40 * MIN });
  try {
    patchTask(d, { daemon: { pid: DEAD_PID } });
    stream(d, 'dispatch_P1_1.stream.jsonl', 5 * MIN);
    const m = collectTask(d.tasks, d.id);
    assert.equal(m.state, 'stalled');
    assert.equal(m.stall.stalled, true);
    assert.equal(m.stall.minutes, 5, 'task-level newest sign of life');
  } finally { d.cleanup(); }
});

test('F3-AC-7: the nested stale path returns the same { stalled, minutes } shape on the task-level basis', () => {
  const d = fixture({ driver: false, ledgerAgeMs: 25 * MIN, createdAgeMs: 40 * MIN });
  try {
    stream(d, 'dispatch_P1_1.stream.jsonl', 5 * MIN);
    const m = collectTask(d.tasks, d.id, { depth: 1 });
    assert.equal(m.state, 'stale');
    assert.equal(m.stall.stalled, true);
    assert.equal(m.stall.minutes, 5, 'task-level newest sign of life');
  } finally { d.cleanup(); }
});

test('F3-AC-10: every recorded driver dead and a fresh stream no recorded driver owns is not stalled', () => {
  const f = planned('E-cccccccc3333');
  try {
    stream(f, 'dispatch_P1_1.stream.jsonl', 1 * SEC);
    const m = collectTask(f.tasks, f.id);
    assert.equal(m.state, 'running');
    assert.deepEqual(m.stall, { stalled: false });
  } finally { f.cleanup(); }
});