// Pure helpers behind `view.mjs --once --format status|events` (the teams-status mod).
//
//   node --test teams/scripts/test-view-events.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { notableEvents, statusLine, handoffs } from './lib/view-events.mjs';

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

test('node_finish: the package and attempt ride along; the attempt shows from the second', () => {
  const out = notableEvents([
    L({ ts: 10, event: 'node_finish', task_id: ID, node_id: 'gate:P1:2', subgoal_id: 'P1', attempt: 2, state: 'failed' }),
    L({ ts: 11, event: 'node_finish', task_id: ID, node_id: 'gate:P2:1', subgoal_id: 'P2', attempt: 1, state: 'failed' }),
  ], 0);
  assert.deepEqual(out, [
    { ts: 10, task_id: ID, kind: 'node_finish', text: 'E-1a2b3c4d gate:P1:2 failed (attempt 2)', package: 'P1', attempt: 2 },
    { ts: 11, task_id: ID, kind: 'node_finish', text: 'E-1a2b3c4d gate:P2:1 failed', package: 'P2', attempt: 1 },
  ]);
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

test('a daemon_done line carries the daemon state; other lines do not', () => {
  const out = notableEvents([
    L({ ts: 5, event: 'daemon_done', task_id: ID, state: 'partial' }),
    L({ ts: 6, event: 'daemon_done', task_id: ID }),
    L({ ts: 7, event: 'daemon_exhausted', task_id: ID, state: 'x' }),
    L({ ts: 8, event: 'waiting_human', task_id: ID, node_id: 'n3', state: 'x' }),
  ], 0);
  assert.deepEqual(out.map((e) => e.state), ['partial', undefined, undefined, undefined]);
  assert.equal('state' in out[1], false);
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

// ---------- a failed node_finish carries reason, next_step, severity ----------
// Field names are the real writers' (teams/mcp/taskmanager.mjs): verdict {node_id, stage, subgoal_id?, attempt?, reason};
// auto_reshape / auto_resplit {from, attempt = the new attempt}; daemon_retry_opened / daemon_retry_settled
// {failed_node, package_id, attempt}; tm_settle {target | package_id | packages, from?}. waiting_human has no writer
// in taskmanager.mjs (status counts it from task.json), so its line here is synthetic.
const HOLD = 120000;
const V = (o) => L({ event: 'verdict', task_id: ID, ...o });
const F = (o) => L({ event: 'node_finish', task_id: ID, state: 'failed', ...o });
const fail = (lines, ctx = {}) => notableEvents(lines, 0, { now: 1e9, ...ctx });

test('failed node_finish + daemon_retry_opened: reason from the verdict, retry n/m from the event attempt and max_retries + 1', () => {
  const out = fail([
    V({ ts: 9, node_id: 'accept:P1:1', stage: 'accept', subgoal_id: 'P1', attempt: 1, verdict: 'reject', reason: 'gap: no test' }),
    F({ ts: 10, node_id: 'accept:P1:1', stage: 'accept', subgoal_id: 'P1', attempt: 1 }),
    L({ ts: 12, event: 'daemon_retry_opened', task_id: ID, package_id: 'P1', attempt: 2, reason: 'x', failed_node: 'accept:P1:1' }),
  ], { maxRetries: 2 });
  assert.deepEqual(out, [{
    ts: 12, task_id: ID, kind: 'node_finish', package: 'P1', attempt: 1,
    text: 'E-1a2b3c4d accept:P1:1 failed: gap: no test → retry 2/3', run: 'E-1a2b3c4d', node: 'accept:P1:1',
    reason: 'gap: no test', next_step: 'retry 2/3', severity: 'info',
  }]);
});

test('retry n/m: maxRetries defaults to 2 and moves the denominator', () => {
  const lines = [
    F({ ts: 10, node_id: 'd', attempt: 2 }),
    L({ ts: 11, event: 'daemon_retry_opened', task_id: ID, package_id: 'P1', attempt: 3, failed_node: 'd' }),
  ];
  assert.equal(fail(lines)[0].next_step, 'retry 3/3');
  assert.equal(fail(lines, { maxRetries: 4 })[0].next_step, 'retry 3/5');
});

test('auto_reshape and auto_resplit: the new attempt from the event, severity info; the text carries reason and next step', () => {
  const out = fail([
    V({ ts: 9, node_id: 'critique:2', stage: 'critique', attempt: 2, reason: 'shape too wide' }),
    F({ ts: 10, node_id: 'critique:2', stage: 'critique', attempt: 2 }),
    L({ ts: 11, event: 'auto_reshape', task_id: ID, target: 'shape', attempt: 3, from: 'critique:2' }),
    F({ ts: 20, node_id: 'areas-critique:1', stage: 'areas-critique' }),
    L({ ts: 21, event: 'auto_resplit', task_id: ID, target: 'areas', attempt: 2, from: 'areas-critique:1' }),
  ]);
  assert.deepEqual(out.map((e) => [e.ts, e.next_step, e.severity]), [[11, 'retrying as shape:3', 'info'], [21, 'retrying as areas:2', 'info']]);
  assert.equal(out[0].text, 'E-1a2b3c4d critique:2 failed (attempt 2): shape too wide → retrying as shape:3');
});

test('needs you: a waiting_human naming the node (synthetic line) is a failure; the waiting_human toast is still its own entry', () => {
  const out = fail([
    F({ ts: 10, node_id: 'n3', stage: 'critique' }),
    L({ ts: 11, event: 'waiting_human', task_id: ID, node_id: 'n3' }),
  ]);
  assert.deepEqual(out.map((e) => [e.ts, e.text]), [
    [11, 'E-1a2b3c4d n3 failed: no reason recorded → needs you'],
    [11, 'E-1a2b3c4d needs you: n3'],
  ]);
  assert.deepEqual([out[0].next_step, out[0].severity], ['needs you', 'failure']);
  assert.equal('next_step' in out[1], false);
});

test('gave up: tm_settle (by from, package_id, packages, target, integrate) and daemon_retry_settled (failed_node), severity failure', () => {
  const case1 = (node, settle) => fail([F({ ts: 10, ...node }), L({ ts: 11, task_id: ID, ...settle })]);
  const gaveUp = (out) => [out.length, out[0] && out[0].next_step, out[0] && out[0].severity];
  const g = [1, 'gave up', 'failure'];
  assert.deepEqual(gaveUp(case1({ node_id: 'critique:3', stage: 'critique' }, { event: 'tm_settle', target: 'shape', from: 'critique:3' })), g);
  assert.deepEqual(gaveUp(case1({ node_id: 'accept:P2:3', stage: 'accept', subgoal_id: 'P2' }, { event: 'tm_settle', package_id: 'P2' })), g);
  assert.deepEqual(gaveUp(case1({ node_id: 'accept:P2:3', stage: 'accept', subgoal_id: 'P2' }, { event: 'tm_settle', packages: ['P1', 'P2'] })), g);
  assert.deepEqual(gaveUp(case1({ node_id: 'shape:1', stage: 'shape' }, { event: 'tm_settle', target: 'shape' })), g);
  assert.deepEqual(gaveUp(case1({ node_id: 'integrate:1', stage: 'integrate' }, { event: 'tm_settle', integrate: 'integrate:1' })), g);
  assert.deepEqual(gaveUp(case1({ node_id: 'accept:P1:3', stage: 'accept', subgoal_id: 'P1' }, { event: 'daemon_retry_settled', package_id: 'P1', attempt: null, failed_node: 'accept:P1:3' })), g);
  assert.equal(fail([F({ ts: 10, node_id: 'accept:P1:3', subgoal_id: 'P1' }), L({ ts: 11, event: 'daemon_retry_settled', task_id: ID, failed_node: 'accept:P1:3' })])[0].text,
    'E-1a2b3c4d accept:P1:3 failed: no reason recorded → gave up');
});

test('a following event for another node, or one that is no next step for this one, does not decide it', () => {
  // another package's settle and another node's retry do not name this node; the node waits out the hold, then is info/null
  const lines = [
    F({ ts: 10, node_id: 'accept:P1:1', stage: 'accept', subgoal_id: 'P1', attempt: 1 }),
    L({ ts: 11, event: 'tm_settle', task_id: ID, package_id: 'P2' }),
    L({ ts: 12, event: 'daemon_retry_opened', task_id: ID, package_id: 'P2', attempt: 2, failed_node: 'accept:P2:1' }),
    L({ ts: 13, event: 'auto_reshape', task_id: ID, attempt: 2, from: 'critique:1' }),
  ];
  assert.deepEqual(fail(lines, { now: 13 }), []);
  const out = fail(lines, { now: 10 + HOLD });
  assert.deepEqual(out.map((e) => [e.ts, e.next_step, e.severity]), [[10 + HOLD, null, 'info']]);
  // a named, unmapped event is no next step: null, info, released at its ts
  const other = fail([F({ ts: 10, node_id: 'n1' }), L({ ts: 14, event: 'daemon_defects_held', task_id: ID, package_id: 'P1', failed_node: 'n1' })]);
  assert.deepEqual(other.map((e) => [e.ts, e.next_step, e.severity, e.text]), [[14, null, 'info', 'E-1a2b3c4d n1 failed: no reason recorded']]);
});

test('no next-step event: null and info, emitted once 120 s after its ts, with ts set to the release time', () => {
  const lines = [F({ ts: 1000, node_id: 'n1', stage: 'accept' })];
  assert.deepEqual(notableEvents(lines, 0, { now: 1000 + HOLD - 1 }), []);
  assert.deepEqual(notableEvents(lines, 0, { now: 1000 + HOLD }), [{
    ts: 1000 + HOLD, task_id: ID, kind: 'node_finish', text: 'E-1a2b3c4d n1 failed: no reason recorded',
    run: 'E-1a2b3c4d', node: 'n1', reason: 'no reason recorded', next_step: null, severity: 'info',
  }]);
});

test('hold: the newest line of the ledger also releases it (no clock needed); a next-step event after the window does not count', () => {
  assert.deepEqual(notableEvents([
    F({ ts: 1000, node_id: 'n1' }),
    L({ ts: 1000 + HOLD, event: 'node_start', task_id: ID }),
  ], 0, {}).map((e) => [e.ts, e.next_step]), [[1000 + HOLD, null]]);
  const late = notableEvents([
    F({ ts: 1000, node_id: 'n1' }),
    L({ ts: 1000 + HOLD + 5, event: 'daemon_retry_opened', task_id: ID, attempt: 2, failed_node: 'n1' }),
  ], 0, { now: 1000 + HOLD + 5 });
  assert.deepEqual(late.map((e) => [e.ts, e.next_step]), [[1000 + HOLD, null]]);
});

test('hold vs the --since cursor: two consecutive windows straddling the release deliver it exactly once', () => {
  const noNext = [F({ ts: 1000, node_id: 'n1' }), L({ ts: 2000, event: 'daemon_exhausted', task_id: ID })];
  const w1 = notableEvents(noNext, 500, { now: 2000 });
  assert.deepEqual(w1.map((e) => e.kind), ['daemon_exhausted']);
  const cursor1 = w1[w1.length - 1].ts;
  const w2 = notableEvents(noNext, cursor1, { now: 1000 + HOLD + 7 });
  assert.deepEqual(w2.map((e) => [e.kind, e.ts]), [['node_finish', 1000 + HOLD]]);
  assert.deepEqual(notableEvents(noNext, w2[0].ts, { now: 1000 + HOLD + 99 }), []);
  // the next-step event lands between the windows: the node_finish itself is before both cursors
  const withNext = [F({ ts: 1000, node_id: 'n1' }), L({ ts: 1500, event: 'daemon_retry_opened', task_id: ID, attempt: 2, failed_node: 'n1' })];
  const a = notableEvents(withNext.slice(0, 1), 900, { now: 1200 });
  const b = notableEvents(withNext, 1200, { now: 1600 });
  const c = notableEvents(withNext, b[0].ts, { now: 1700 });
  assert.deepEqual([a.length, b.map((e) => e.ts), c.length], [0, [1500], 0]);
});

test('reason: the latest earlier verdict of the node (and attempt), else result.reason, else the literal', () => {
  const nf = F({ ts: 50, node_id: 'accept:P1:2', stage: 'accept', subgoal_id: 'P1', attempt: 2 });
  const r = (lines, ctx) => fail(lines, ctx)[0].reason;
  const vd = (ts, o) => V({ ts, node_id: 'accept:P1:2', stage: 'accept', ...o });
  // latest wins; another node's, another attempt's and a later verdict do not
  assert.equal(r([vd(1, { attempt: 2, reason: 'old' }), vd(2, { attempt: 2, reason: 'new' }), vd(3, { attempt: 1, reason: 'attempt 1' }),
    V({ ts: 4, node_id: 'other', attempt: 2, reason: 'other node' }), nf, vd(60, { attempt: 2, reason: 'after' })]), 'new');
  // a verdict with no reason falls through to result.reason
  assert.equal(r([vd(1, { attempt: 2, reason: null }), nf], { reasons: { 'accept:P1:2': 'from task.json' } }), 'from task.json');
  assert.equal(r([nf], { reasons: { 'accept:P1:2': 'from task.json' } }), 'from task.json');
  assert.equal(r([nf], { reasons: { other: 'x' } }), 'no reason recorded');
  assert.equal(r([nf]), 'no reason recorded');
  // no attempt on the node_finish: any attempt's verdict of the node matches
  assert.equal(r([vd(1, { attempt: 7, reason: 'seven' }), F({ ts: 50, node_id: 'accept:P1:2' })]), 'seven');
});

test('reason: newlines and whitespace runs collapse to one space; over 120 chars is 119 + "…"; exactly 120 is unchanged', () => {
  const via = (reason) => fail([V({ ts: 1, node_id: 'n', reason }), F({ ts: 2, node_id: 'n' })])[0];
  assert.equal(via('  first line\n\n- second   point\t\tthird  ').reason, 'first line - second point third');
  const r120 = 'a'.repeat(120);
  assert.equal(via(r120).reason, r120);
  const cut = via('b'.repeat(121)).reason;
  assert.equal(cut, 'b'.repeat(119) + '…');
  assert.equal(cut.length, 120);
  assert.equal(via('word '.repeat(60)).reason.length, 120);
  // collapse first, then measure: 130 raw chars that collapse to 100 are not cut
  assert.equal(via('c'.repeat(50) + '\n'.repeat(30) + 'd'.repeat(50)).reason, 'c'.repeat(50) + ' ' + 'd'.repeat(50));
  assert.equal(via('x'.repeat(130)).text, `E-1a2b3c4d n failed: ${'x'.repeat(119)}…`);
});

test('without ctx the old behaviour holds: no fields, no hold', () => {
  const out = notableEvents([F({ ts: 10, node_id: 'n1' })], 0);
  assert.deepEqual(out, [{ ts: 10, task_id: ID, kind: 'node_finish', text: 'E-1a2b3c4d n1 failed' }]);
});

test('output is sorted by ts; a released failure lands among the other events by its release ts', () => {
  const out = fail([
    F({ ts: 10, node_id: 'n1' }),
    L({ ts: 20, event: 'daemon_exhausted', task_id: ID }),
    L({ ts: 30, event: 'daemon_retry_opened', task_id: ID, attempt: 2, failed_node: 'n1' }),
    L({ ts: 25, event: 'child_driver_capacity', task_id: ID }),
  ]);
  assert.deepEqual(out.map((e) => [e.ts, e.kind]), [[20, 'daemon_exhausted'], [25, 'child_driver_capacity'], [30, 'node_finish']]);
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
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, utimesSync, symlinkSync } from 'node:fs';
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
    assert.deepEqual(JSON.parse(r.stdout), { line: '', waiting: 0, latest: null, asks: [] });
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('--format status: latest is the newest running task id, null for another cwd', () => {
  const f = fixture();
  try {
    assert.equal(JSON.parse(cli(f, '--format', 'status').stdout).latest, RUN_ID);
    const r = spawnSync(process.execPath, [VIEW, '--once', '--tasks-dir', f.tasks, '--cwd', join(f.root, 'elsewhere'), '--format', 'status'], { encoding: 'utf8' });
    assert.equal(JSON.parse(r.stdout).latest, null);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('--format status|events: a symlinked --cwd matches the real task cwd', () => {
  const f = fixture();
  try {
    const link = join(f.root, 'link');
    symlinkSync(f.cwd, link);
    const run = (...a) => spawnSync(process.execPath, [VIEW, '--once', '--tasks-dir', f.tasks, '--cwd', link, ...a], { encoding: 'utf8' });
    const s = run('--format', 'status');
    assert.equal(s.status, 0, s.stderr);
    const o = JSON.parse(s.stdout);
    assert.ok(o.line.includes('E-aaaaaaaa'));
    assert.equal(o.waiting, 1);
    const e = run('--format', 'events', '--since', '0');
    assert.equal(e.status, 0, e.stderr);
    const evs = e.stdout.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
    assert.deepEqual(evs.map((x) => x.task_id), [RUN_ID, RUN_ID, DONE_ID]);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('--format events --since 0: ledgers of every listed task, running or finished; task.json-less dir skipped', () => {
  const f = fixture();
  try {
    const r = cli(f, '--format', 'events', '--since', '0');
    assert.equal(r.status, 0, r.stderr);
    const evs = r.stdout.trim().split('\n').map((l) => JSON.parse(l));
    assert.deepEqual(evs.map((e) => e.kind), ['daemon_exhausted', 'child_driver_capacity', 'daemon_exhausted']);
    assert.deepEqual(evs.map((e) => e.task_id), [RUN_ID, RUN_ID, DONE_ID]);
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
    assert.deepEqual(big.stdout.trim().split('\n').map((l) => JSON.parse(l).ts), [9, 20, 22]);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('--format events: a just-finished task (no longer running) still delivers its finished event; an unchanged ledger does not', () => {
  const f = fixture();
  try {
    writeFileSync(join(f.tasks, DONE_ID, 'ledger.jsonl'), JSON.stringify({ ts: 50, event: 'daemon_done', task_id: DONE_ID, state: 'done' }) + '\n');
    const r = cli(f, '--format', 'events', '--since', '10');
    const evs = r.stdout.trim().split('\n').map((l) => JSON.parse(l));
    assert.deepEqual(evs.map((e) => [e.task_id, e.kind]), [[DONE_ID, 'daemon_done']]);
    assert.ok(evs[0].text.includes('finished'));
    // ledger untouched since before --since: not read at all
    utimesSync(join(f.tasks, DONE_ID, 'ledger.jsonl'), 0, 0);
    utimesSync(join(f.tasks, RUN_ID, 'ledger.jsonl'), 0, 0);
    assert.equal(cli(f, '--format', 'events', '--since', '10').stdout, '');
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('--format events: a failed node_finish carries reason, next_step and severity; the next --since delivers nothing', () => {
  const f = fixture();
  try {
    const task = JSON.parse(readFileSync(join(f.tasks, RUN_ID, 'task.json'), 'utf8'));
    task.max_retries = 2;
    task.nodes.push(node('dispatch:P2:1', 'dispatch', [], { state: 'failed', result: { stage_ok: false, reason: 'result.reason\nof P2' } }));
    writeFileSync(join(f.tasks, RUN_ID, 'task.json'), JSON.stringify(task));
    const rows = [
      { ts: 1000, event: 'verdict', task_id: RUN_ID, node_id: 'accept:P1:1', stage: 'accept', subgoal_id: 'P1', attempt: 1, verdict: 'reject', reason: 'gap: no test' },
      { ts: 1001, event: 'node_finish', task_id: RUN_ID, node_id: 'accept:P1:1', stage: 'accept', state: 'failed', subgoal_id: 'P1', attempt: 1 },
      { ts: 1002, event: 'daemon_retry_opened', task_id: RUN_ID, package_id: 'P1', attempt: 2, failed_node: 'accept:P1:1' },
      { ts: 1003, event: 'node_finish', task_id: RUN_ID, node_id: 'dispatch:P2:1', stage: 'dispatch', state: 'failed', subgoal_id: 'P2' },
    ];
    writeFileSync(join(f.tasks, RUN_ID, 'ledger.jsonl'), rows.map((o) => JSON.stringify(o)).join('\n') + '\n');
    const lines = (r) => { assert.equal(r.status, 0, r.stderr); return r.stdout.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)); };
    const first = lines(cli(f, '--format', 'events', '--since', '0')).filter((e) => e.task_id === RUN_ID && e.kind === 'node_finish');
    assert.equal(first.length, 2);
    assert.deepEqual([first[0].ts, first[0].reason, first[0].next_step, first[0].severity], [1002, 'gap: no test', 'retry 2/3', 'info']);
    // no verdict: task.json's result.reason, one line; its ts is the release time (ts + 120 s), long past by the wall clock
    assert.deepEqual([first[1].ts, first[1].reason, first[1].next_step, first[1].severity], [1003 + HOLD, 'result.reason of P2', null, 'info']);
    assert.equal(lines(cli(f, '--format', 'events', '--since', String(1003 + HOLD))).filter((e) => e.task_id === RUN_ID).length, 0);
    // since inside the hold window of a held event: the file is still read (mtime window), the event comes out
    assert.deepEqual(lines(cli(f, '--format', 'events', '--since', '1100')).filter((e) => e.task_id === RUN_ID).map((e) => e.ts), [1003 + HOLD]);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

// ---------- part C: the story-ask exchange as hand-offs (ledger lines in teams/mcp/storyask.mjs's shape) ----------
const ASK_ID = '3f0c2a52-8d1e-4a6b-9a53-2d6c1c9d7e10';
const asked = (ts, question) => L({ ts, event: 'asked', task_id: ID, key: 'E-1a2b3c4d/P3', node_id: 'dispatch:P3:1', question, ask_id: ASK_ID });
const answered = (ts, by, answer, route = by === 'person' ? 'forward' : 'answer') => L({ ts, event: 'answered', task_id: ID, key: 'E-1a2b3c4d/P3', node_id: 'dispatch:P3:1', answer, by, route, ask_id: ASK_ID });
const hand = (lines) => handoffs(lines).map(({ from, what, to }) => ({ from, what, to }));

test('hand-offs: an asked line reads P3 -> TeamLeader "question"', () => {
  assert.deepEqual(hand([asked(10, 'is amount in cents?')]), [{ from: 'P3', what: 'is amount in cents?', to: 'TeamLeader' }]);
});

test('hand-offs: an answer by the team leader reads TeamLeader -> P3', () => {
  assert.deepEqual(hand([answered(10, 'teamleader', 'cents, see the plan')]), [{ from: 'TeamLeader', what: 'cents, see the plan', to: 'P3' }]);
});

test('hand-offs: an answer by the person reads you -> P3', () => {
  assert.deepEqual(hand([answered(10, 'person', 'cents')]), [{ from: 'you', what: 'cents', to: 'P3' }]);
});

test('hand-offs: a question or answer past the clip limit ends in an ellipsis', () => {
  const long = 'x'.repeat(200);
  const [a, b] = hand([asked(10, long), answered(20, 'person', long)]).map((h) => h.what).reverse();
  for (const w of [a, b]) {
    assert.equal(w.length, 60);
    assert.ok(w.endsWith('…'), w);
  }
});

test('hand-offs: tm_submit_human with an ask_id yields no line; without one it is you -> card', () => {
  const sub = (extra) => L({ ts: 10, event: 'tm_submit_human', task_id: ID, key: 'E-1a2b3c4d/P3/ask:P3:1', node_id: 'ask:P3:1', answer: 'keep it', ...extra });
  assert.deepEqual(hand([sub({ ask_id: ASK_ID })]), []);
  assert.deepEqual(hand([sub({})]), [{ from: 'you', what: 'keep it', to: 'P3' }]);
});

test('hand-offs: a forwarded answer is drawn once - the answered line, not the submit as well', () => {
  const sub = L({ ts: 9, event: 'tm_submit_human', task_id: ID, key: 'E-1a2b3c4d/P3/ask:P3:1', node_id: 'ask:P3:1', answer: 'cents', ask_id: ASK_ID });
  assert.deepEqual(hand([sub, answered(10, 'person', 'cents')]), [{ from: 'you', what: 'cents', to: 'P3' }]);
});

test('hand-offs: the waiting_human line is unchanged (literal from the code before part C)', () => {
  const out = handoffs([L({ ts: 7000, event: 'waiting_human', task_id: ID, node_id: 'ask:P3:1' })]);
  assert.equal(JSON.stringify(out[0]), JSON.stringify({ time: out[0].time, from: 'P3', what: 'asks you', to: 'you' }));
  assert.deepEqual(Object.keys(out[0]), ['time', 'from', 'what', 'to']);
  assert.deepEqual(hand([L({ ts: 7000, event: 'waiting_human', task_id: ID, node_id: 'ask:P3:1' })]), [{ from: 'P3', what: 'asks you', to: 'you' }]);
});
