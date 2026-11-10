// The floor part of `view.mjs --once --format summary` (F4 U2): items, workers, hand-offs, run files,
// cost and the task listing. Every fixture is a temp task dir this file builds (mkdtemp); the real
// repo cwd's tasks are never read.
//
//   node --test teams/scripts/test-view-floor.mjs
process.env.TEAMS_RUNS_DIR ??= 'off';
process.env.TZ = 'UTC';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { node } from '../mcp/graph.mjs';
import { collectTask, STALL_MS } from './lib/view-collect.mjs';
import { summarize } from './lib/view-summary.mjs';
import { floorOf, markOf } from './lib/view-floor.mjs';
import { handoffs } from './lib/view-events.mjs';
import { floorTasks, floorFacts, cacheStats, DAY_MS } from './lib/view-floor-fs.mjs';

const VIEW = join(dirname(fileURLToPath(import.meta.url)), 'view.mjs');
const MIN = 60 * 1000;

const asst = (text, id = 'm1') => JSON.stringify({ type: 'assistant', message: { id, content: [{ type: 'text', text }], usage: { input_tokens: 1000, output_tokens: 100 } } });
const result = (usd) => JSON.stringify({ type: 'result', subtype: 'success', total_cost_usd: usd, num_turns: 3 });
const touch = (p, agoMs) => { const t = (Date.now() - agoMs) / 1000; utimesSync(p, t, t); };
const write = (p, s, agoMs = 0) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, s); if (agoMs) touch(p, agoMs); };

// A temp world: <root>/tasks (the tasks dir), <root>/proj (the cwd), <root>/wt-<id> child worktrees.
function world() {
  const root = mkdtempSync(join(tmpdir(), 'view-floor-'));
  const w = { root, tasks: join(root, 'tasks'), cwd: join(root, 'proj'), cleanup: () => rmSync(root, { recursive: true, force: true }) };
  mkdirSync(w.tasks, { recursive: true });
  mkdirSync(w.cwd, { recursive: true });
  return w;
}

// An L task: one STORY per entry of `pkgs` { id, streamAgeMs (null = no stream), lines, child:{nodes,max_retries}, noChild, done }.
function lTask(w, { id = 'aaaaaaaa-0001', cwd = w.cwd, ageMs = 0, pkgs = [{ id: 'P1' }], ledger = null, report = false } = {}) {
  const dir = join(w.tasks, id);
  mkdirSync(join(dir, 'drivers'), { recursive: true });
  const nodes = [node('size', 'size', [], { state: 'done' }), node('shape', 'shape', ['size'], { state: 'done' }), node('critique', 'critique', ['shape'], { state: 'done' })];
  for (const p of pkgs) {
    const log = join(dir, 'drivers', `dispatch_${p.id}_1.stream.jsonl`);
    const cdir = join(w.root, `wt-${id}-${p.id}`);
    const runId = `c-${p.id}`;
    const child = p.noChild ? undefined : { run_id: runId, cwd: cdir, driver: { pid: process.pid, log, restarts: [] } };
    nodes.push(node(`dispatch:${p.id}:1`, 'dispatch', ['critique'], { state: p.done ? 'done' : 'running', subgoal_id: p.id, ...(child ? { child } : {}) }));
    nodes.push(node(`accept:${p.id}:1`, 'accept', [`dispatch:${p.id}:1`], { subgoal_id: p.id, state: p.done ? 'done' : 'pending', ...(p.done ? { result: { accept: true } } : {}) }));
    if (p.streamAgeMs != null) write(log, (p.lines || [asst(`working on ${p.id}`)]).join('\n') + '\n', p.streamAgeMs);
    if (child && !p.noRunFile) {
      const c = p.child || {};
      write(join(cdir, '.teams_output', 'broker', 'runs', `${runId}.json`), JSON.stringify({
        run_id: runId, flow: 'develop', max_retries: c.max_retries ?? 2,
        spec: { subgoals: [{ id: 'U1', title: 'unit' }] },
        nodes: c.nodes || [node('implement:U1:1', 'implement', [], { state: 'running', subgoal_id: 'U1' })],
      }));
    }
  }
  if (report) nodes.push(node('report', 'report', [], { state: 'done' }));
  write(join(dir, 'task.json'), JSON.stringify({
    run_id: id, kind: 'task', cwd, request: `request ${id}`, created_at: Date.now() - ageMs, store_path: join(dir, 'task.json'),
    spec: { packages: pkgs.map((p) => ({ id: p.id, title: p.title || `story ${p.id}`, deps: [] })) }, nodes,
  }));
  if (ledger) write(join(dir, 'ledger.jsonl'), ledger.map((e) => JSON.stringify(e)).join('\n') + '\n');
  return { id, dir };
}

// A size-S task on the development harness (task.harness_run), optionally with the legacy s_run too.
function sTask(w, { id = 'bbbbbbbb-0001', graphFile = false, legacyFile = false, withLegacyRef = false, streamAgeMs = 1000, ageMs = 0, pid = process.pid } = {}) {
  const dir = join(w.tasks, id);
  const hcwd = join(w.root, 'hcwd');
  const log = join(dir, 'drivers', 'S.stream.jsonl');
  const runId = 'graph-run-1';
  const now = Date.now() - ageMs;
  write(log, asst('s driver working') + '\n', streamAgeMs);
  if (graphFile) write(join(hcwd, '.harness-run', 'broker', 'runs', `${runId}.json`), JSON.stringify({ run_id: runId, request: `do it [teams-task ${id}]`, created_at: now, nodes: [] }));
  const scwd = join(w.root, 'scwd');
  if (legacyFile) write(join(scwd, '.teams_output', 'broker', 'runs', 'legacy-run-1.json'), JSON.stringify({ run_id: 'legacy-run-1', flow: 'develop', nodes: [node('implement:U1:1', 'implement', [], { state: 'running', subgoal_id: 'U1' })] }));
  write(join(dir, 'task.json'), JSON.stringify({
    run_id: id, kind: 'task', cwd: w.cwd, request: 'small thing', size: 'S', created_at: now - 5000, store_path: join(dir, 'task.json'), nodes: [],
    harness_run: { cwd: hcwd, opened_at: now - 10000, driver: { pid, log, restarts: [] }, ...(graphFile ? { run: { route: 'graph', run_id: runId, cwd: hcwd } } : {}) },
    ...(withLegacyRef ? { s_run: { cwd: scwd, run_id: 'legacy-run-1', driver: { pid: process.pid, log, restarts: [] } } } : {}),
  }));
  return { id, dir, hcwd, scwd, runId, graphPath: join(hcwd, '.harness-run', 'broker', 'runs', `${runId}.json`), legacyPath: join(scwd, '.teams_output', 'broker', 'runs', 'legacy-run-1.json') };
}

const summary = (w, ...extra) => {
  const r = spawnSync(process.execPath, [VIEW, '--once', '--format', 'summary', '--tasks-dir', w.tasks, '--cwd', w.cwd, ...extra], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
};
const entryOf = (w, id) => {
  const m = collectTask(w.tasks, id);
  const facts = floorFacts(m, w.tasks, id);
  return { m, facts, floor: floorOf(m, facts) };
};

test('two tasks in one cwd', () => {
  const w = world();
  try {
    lTask(w, { id: 'aaaaaaaa-0001', pkgs: [{ id: 'P1', streamAgeMs: 1000 }], ageMs: 5000 });
    lTask(w, { id: 'cccccccc-0002', pkgs: [{ id: 'P1', streamAgeMs: 1000 }], ageMs: 1000 });
    const out = summary(w);
    assert.ok(Array.isArray(out.tasks));
    assert.equal(out.tasks.length, 2);
    assert.deepEqual(out.tasks.map((t) => t.task_id), ['cccccccc-0002', 'aaaaaaaa-0001']); // newest created first
    assert.ok(out.task && out.task.key, 'task kept for back-compat');
    assert.equal(out.status.latest, 'cccccccc-0002');
  } finally { w.cleanup(); }
});

test('L EPIC with three packages', () => {
  const w = world();
  try {
    lTask(w, { pkgs: [
      { id: 'P1', streamAgeMs: 1000, lines: [asst('editing view-floor')], child: { nodes: [node('implement:U1:2', 'implement', [], { state: 'running', subgoal_id: 'U1' })], max_retries: 2 } },
      { id: 'P2', streamAgeMs: 2000 },
      { id: 'P3', streamAgeMs: 3000 },
    ] });
    const out = summary(w);
    const t = out.tasks[0];
    assert.equal(t.items.length, 3);
    assert.deepEqual(t.items.map((i) => i.key), ['P1', 'P2', 'P3']);
    const p1 = t.items[0];
    assert.equal(p1.state, 'acting');
    assert.equal(p1.live, true);
    assert.match(p1.doing, /editing view-floor/);
    assert.equal(p1.try, 2);
    assert.equal(p1.max, 3);
    assert.equal(p1.owner_key, 'E-aaaaaaaa/P1');
    assert.ok(typeof p1.elapsed_ms === 'number' || p1.elapsed_ms === null);
    assert.deepEqual(Object.keys(p1).sort(), ['cost_estimated', 'cost_usd', 'doing', 'elapsed_ms', 'key', 'last_verdict', 'live', 'max', 'metrics', 'owner_key', 'run_file', 'state', 'title', 'try', 'icon', 'word', 'word_key'].sort());
    assert.deepEqual(t.workers.map((x) => x.id), ['P1', 'P2', 'P3', 'judge']);
    assert.deepEqual(t.workers.slice(0, 3).map((x) => x.state), ['acting', 'acting', 'acting']);
    assert.equal(t.workers[3].state, 'idle');
  } finally { w.cleanup(); }
});

test('S task with a live driver', () => {
  const w = world();
  try {
    const s = sTask(w, { graphFile: true });
    const out = summary(w);
    assert.equal(out.tasks.length, 1);
    const t = out.tasks[0];
    assert.equal(t.live, true);
    assert.equal(t.state, 'running');
    assert.equal(t.items.length, 1);
    assert.equal(t.items[0].state, 'acting');
    assert.equal(t.items[0].live, true);
    assert.match(t.items[0].doing, /s driver working/);
    assert.deepEqual(t.workers.map((x) => x.id), ['S', 'judge']);
    assert.equal(t.items[0].owner_key, 'E-bbbbbbbb');
    assert.equal(t.items[0].run_file, s.graphPath);
  } finally { w.cleanup(); }
});

test('stalled task', () => {
  const w = world();
  try {
    lTask(w, { id: 'aaaaaaaa-0001', ageMs: 30 * MIN, pkgs: [{ id: 'P1', streamAgeMs: STALL_MS + 60 * 1000 }] });
    const out = summary(w);
    assert.equal(out.tasks.length, 1);
    const t = out.tasks[0];
    assert.equal(t.live, false);
    assert.equal(t.state, 'stalled');
    assert.ok(t.age_ms >= STALL_MS && t.age_ms < DAY_MS, `age_ms ${t.age_ms}`);
    assert.equal(t.items[0].state, 'stalled');
    assert.equal(t.items[0].doing, '');
    assert.equal(t.workers[0].state, 'stalled');
    assert.equal(out.task, null, 'no running task');
  } finally { w.cleanup(); }
});

test('F3-AC-4/5/8: a stalled worker carries integer minutes, a live one has no minutes key, a silent worker beside a live one is stalled', () => {
  const w = world();
  try {
    const s = lTask(w, { id: 'aaaaaaaa-0001', ageMs: 60 * MIN, pkgs: [{ id: 'P1', streamAgeMs: 30 * MIN }] });
    const live = lTask(w, { id: 'bbbbbbbb-0002', ageMs: 60 * MIN, pkgs: [{ id: 'P1', streamAgeMs: 1000 }] });
    const mixed = lTask(w, { id: 'cccccccc-0003', ageMs: 60 * MIN, pkgs: [{ id: 'P1', streamAgeMs: 1000 }, { id: 'P2', streamAgeMs: 25 * MIN }] });
    const sw = entryOf(w, s.id);
    assert.equal(sw.m.state, 'stalled');
    assert.equal(sw.floor.workers[0].state, 'stalled');
    assert.equal(sw.floor.workers[0].minutes, 30, 'whole minutes since the worker\'s own stream');
    const lw = entryOf(w, live.id).floor.workers;
    assert.equal(lw[0].state, 'acting');
    assert.equal('minutes' in lw[0], false, 'a live worker has no minutes key');
    assert.equal('minutes' in lw.find((x) => x.id === 'judge'), false);
    const mx = entryOf(w, mixed.id);
    assert.equal(mx.m.state, 'running', 'one silent worker beside a live one is not a stalled task');
    const by = Object.fromEntries(mx.floor.workers.map((x) => [x.id, x]));
    assert.equal(by.P1.state, 'acting');
    assert.equal(by.P2.state, 'stalled');
    assert.equal(by.P2.minutes, 25);
    // the second stall list is not a source: workers[] reads the same without it
    assert.equal(by.P2.minutes, floorOf(mx.m, { stories: { P2: { silent: true, minutes: 25 } } }, { metrics: { stories: [], drivers: { stalled: [] } } }).workers.find((x) => x.id === 'P2').minutes);
  } finally { w.cleanup(); }
});

test('F3-AC-41: floorTasks live flag follows the task\'s own stall_minutes', () => {
  const w = world();
  try {
    const set = (id, agoMs) => {
      const l = lTask(w, { id, ageMs: 60 * MIN, pkgs: [{ id: 'P1', streamAgeMs: agoMs }] });
      const p = join(l.dir, 'task.json');
      write(p, JSON.stringify({ ...JSON.parse(readFileSync(p, 'utf8')), stall_minutes: 20 }));
    };
    set('aaaaaaaa-0001', 19 * MIN);
    set('bbbbbbbb-0002', 21 * MIN);
    const out = floorTasks({ tasksDir: w.tasks, cwd: w.cwd });
    const live = Object.fromEntries(out.map((x) => [x.id, x.live]));
    assert.deepEqual(live, { 'aaaaaaaa-0001': true, 'bbbbbbbb-0002': false });
    assert.equal(out.find((x) => x.id === 'bbbbbbbb-0002').m.stall.minutes, 21);
  } finally { w.cleanup(); }
});

test('live first then stalled, and a stalled task past 24 h is not listed', () => {
  const w = world();
  try {
    lTask(w, { id: 'dddddddd-0004', ageMs: 2 * MIN, pkgs: [{ id: 'P1', streamAgeMs: 30 * 60 * 1000 }] }); // stalled, newest created
    lTask(w, { id: 'aaaaaaaa-0001', ageMs: 50 * MIN, pkgs: [{ id: 'P1', streamAgeMs: 1000 }] }); // live, older
    lTask(w, { id: 'eeeeeeee-0005', ageMs: 25 * 3600 * 1000, pkgs: [{ id: 'P1', streamAgeMs: 25 * 3600 * 1000 }] }); // stalled 25 h
    const out = summary(w);
    assert.deepEqual(out.tasks.map((t) => `${t.task_id}:${t.live}`), ['aaaaaaaa-0001:true', 'dddddddd-0004:false']);
  } finally { w.cleanup(); }
});

test('summary under 3 s with prefilter and mtime cache', () => {
  const w = world();
  try {
    lTask(w, { id: 'aaaaaaaa-0001', pkgs: [{ id: 'P1', streamAgeMs: 1000, lines: [asst('x'), result(0.5)] }] });
    lTask(w, { id: 'bbbbbbbb-0002', cwd: join(w.root, 'other'), pkgs: [{ id: 'P1', streamAgeMs: 1000 }] }); // another cwd
    lTask(w, { id: 'cccccccc-0003', ageMs: 26 * 3600 * 1000, pkgs: [{ id: 'P1', streamAgeMs: 26 * 3600 * 1000 }] }); // older than 24 h
    lTask(w, { id: 'dddddddd-0004', pkgs: [{ id: 'P1', done: true, streamAgeMs: 1000 }], report: true }); // finished
    const cancelled = lTask(w, { id: 'eeeeeeee-0005', pkgs: [{ id: 'P1', streamAgeMs: 1000 }] });
    write(join(cancelled.dir, 'task.json'), JSON.stringify({ ...JSON.parse(readFileSync(join(cancelled.dir, 'task.json'), 'utf8')), cancelled: true }));
    const seen = [];
    const t0 = Date.now();
    const listed = floorTasks({ tasksDir: w.tasks, cwd: w.cwd, collect: (d, id) => { seen.push(id); return collectTask(d, id); } });
    const items = listed.map((x) => floorOf(x.m, floorFacts(x.m, w.tasks, x.id)));
    assert.ok(Date.now() - t0 < 3000, 'elapsed < 3000 ms');
    assert.deepEqual(seen, ['aaaaaaaa-0001'], 'collectTask only for this cwd open-or-stalled-under-24h tasks');
    assert.equal(items[0].items[0].cost_usd, 0.5);
    const before = cacheStats();
    floorFacts(listed[0].m, w.tasks, listed[0].id);
    const after = cacheStats();
    assert.ok(after.hits > before.hits, 'second call hits the mtime cache');
    assert.equal(after.misses, before.misses);
  } finally { w.cleanup(); }
});

test('S run_file graph route', () => {
  const w = world();
  try {
    const s = sTask(w, { graphFile: true });
    assert.equal(entryOf(w, s.id).floor.items[0].run_file, s.graphPath);
  } finally { w.cleanup(); }
});

test('S run_file legacy s_run', () => {
  const w = world();
  try {
    const s = sTask(w, { graphFile: false, legacyFile: true, withLegacyRef: true });
    assert.equal(entryOf(w, s.id).floor.items[0].run_file, s.legacyPath);
  } finally { w.cleanup(); }
});

test('S run_file graph route wins over legacy', () => {
  const w = world();
  try {
    const s = sTask(w, { graphFile: true, legacyFile: true, withLegacyRef: true });
    assert.equal(entryOf(w, s.id).floor.items[0].run_file, s.graphPath);
  } finally { w.cleanup(); }
});

test('run_file null when absent', () => {
  const w = world();
  try {
    const s = sTask(w, { graphFile: false, legacyFile: false, withLegacyRef: false });
    assert.equal(entryOf(w, s.id).floor.items[0].run_file, null);
    const l = lTask(w, { id: 'aaaaaaaa-0001', pkgs: [{ id: 'P1', streamAgeMs: 1000, noRunFile: true }] });
    assert.equal(entryOf(w, l.id).floor.items[0].run_file, null);
  } finally { w.cleanup(); }
});

test('package run_file is the child run file when it exists', () => {
  const w = world();
  try {
    const l = lTask(w, { pkgs: [{ id: 'P1', streamAgeMs: 1000 }] });
    assert.equal(entryOf(w, l.id).floor.items[0].run_file, join(w.root, `wt-${l.id}-P1`, '.teams_output', 'broker', 'runs', 'c-P1.json'));
  } finally { w.cleanup(); }
});

test('cost join on drivers/<node>.stream.jsonl plus child node sessions', () => {
  const w = world();
  try {
    const l = lTask(w, { pkgs: [{ id: 'P1', streamAgeMs: 1000, lines: [asst('a'), result(0.5)] }, { id: 'P10', streamAgeMs: 1000, lines: [asst('a'), result(9)] }] });
    write(join(l.dir, 'drivers', 'dispatch_P1_1.restart1.stream.jsonl'), asst('b', 'm2') + '\n' + result(0.25) + '\n');
    write(join(w.root, `wt-${l.id}-P1`, '.teams_output', 'broker', 'c-P1', 'implement', 'att-1', 'events.jsonl'), result(0.1) + '\n');
    const f = entryOf(w, l.id).floor;
    const by = Object.fromEntries(f.items.map((i) => [i.key, i]));
    assert.equal(by.P1.cost_usd, 0.85); // 0.5 + restart 0.25 + node session 0.1; P10's 9 is not P1's
    assert.equal(by.P1.cost_estimated, false);
    assert.equal(by.P10.cost_usd, 9);
  } finally { w.cleanup(); }
});

test('~ estimate for a running session without a result', () => {
  const w = world();
  try {
    const l = lTask(w, { pkgs: [{ id: 'P1', streamAgeMs: 1000, lines: [asst('still going')] }, { id: 'P2', streamAgeMs: 1000, lines: [asst('done one'), result(0.3)] }] });
    const by = Object.fromEntries(entryOf(w, l.id).floor.items.map((i) => [i.key, i]));
    assert.equal(by.P1.cost_estimated, true);
    assert.ok(by.P1.cost_usd > 0);
    assert.equal(by.P2.cost_estimated, false);
  } finally { w.cleanup(); }
});

test('blank cost', () => {
  const w = world();
  try {
    const l = lTask(w, { pkgs: [{ id: 'P1', streamAgeMs: null }] });
    const i = entryOf(w, l.id).floor.items[0];
    assert.equal(i.cost_usd, null);
    assert.equal(i.cost_estimated, false);
  } finally { w.cleanup(); }
});

test('blank doing', () => {
  const w = world();
  try {
    const l = lTask(w, { pkgs: [{ id: 'P1', streamAgeMs: null }, { id: 'P2', streamAgeMs: STALL_MS + 60 * 1000 }] });
    const by = Object.fromEntries(entryOf(w, l.id).floor.items.map((i) => [i.key, i]));
    assert.equal(by.P1.doing, '', 'no stream file');
    assert.equal(by.P2.doing, '', 'stale stream reads idle');
    assert.equal(by.P2.live, false);
  } finally { w.cleanup(); }
});

test('try/max', () => {
  const w = world();
  try {
    const nodes = [
      node('implement:U1:1', 'implement', [], { state: 'failed', subgoal_id: 'U1' }),
      node('implement:U1:2', 'implement', [], { state: 'running', subgoal_id: 'U1' }),
    ];
    const l = lTask(w, { pkgs: [{ id: 'P1', streamAgeMs: 1000, child: { nodes, max_retries: 4 } }, { id: 'P2', streamAgeMs: 1000, noChild: true }] });
    const by = Object.fromEntries(entryOf(w, l.id).floor.items.map((i) => [i.key, i]));
    assert.equal(by.P1.try, 2);
    assert.equal(by.P1.max, 5);
    assert.equal(by.P2.try, null);
    assert.equal(by.P2.max, null);
  } finally { w.cleanup(); }
});

test('hand-offs newest 5 recorded only', () => {
  const ev = (ts, event, extra = {}) => ({ ts, event, task_id: 't', ...extra });
  const ledger = [
    ev(1000, 'verdict', { node_id: 'accept:P1:1', subgoal_id: 'P1', actor: 'judge', verdict: 'accept' }),
    ev(2000, 'node_finish', { node_id: 'x', state: 'done' }),
    ev(3000, 'integrated', { node_id: 'integrate:1', merged: 2 }),
    ev(4000, 'daemon_spawned', { pid: 1 }),
    ev(5000, 'defects_filed', { reporter: 'qa', filed: ['D1'] }),
    ev(6000, 'tm_submit_human', { key: 'E-aaaaaaaa/P2/ask:P2:1', node_id: 'ask:P2:1', answer: 'keep it' }),
    ev(7000, 'waiting_human', { node_id: 'ask:P3:1' }),
    ev(8000, 'verdict', { node_id: 'accept:P2:1', subgoal_id: 'P2', actor: 'judge', verdict: 'reject' }),
    ev(9000, 'child_driver_spawned', { node_id: 'P1' }),
    ev(10000, 'verdict', { node_id: 'accept:P3:1', subgoal_id: 'P3', actor: 'judge', verdict: 'accept' }),
  ].map((e) => JSON.stringify(e));
  const h = handoffs([...ledger, '{"ts":11000,"event":"verd'], { limit: 5 }); // a torn last line is ignored
  assert.equal(h.length, 5);
  assert.deepEqual(h.map((x) => x.what), ['verdict accept', 'verdict reject', 'asks you', 'keep it', 'filed 1 defect(s)']);
  assert.deepEqual(Object.keys(h[0]).sort(), ['from', 'time', 'to', 'what', 'what_key', 'what_vars']);
  assert.equal(h[0].to, 'P3');
  assert.equal(h[3].from, 'you');
  assert.equal(h[3].to, 'P2');
  // nothing recorded, nothing shown
  assert.deepEqual(handoffs([JSON.stringify(ev(1, 'node_finish')), JSON.stringify(ev(2, 'daemon_spawned'))]), []);
  assert.deepEqual(handoffs([]), []);
});

// A settled card: its dispatch failed, so its verdict is its status.
const failDispatch = (l) => {
  const tp = join(l.dir, 'task.json');
  const t = JSON.parse(readFileSync(tp, 'utf8'));
  t.nodes.find((n) => n.node_id === 'dispatch:P1:1').state = 'failed';
  writeFileSync(tp, JSON.stringify(t));
};

test('last_verdict and hand-offs come from the ledger tail', () => {
  const w = world();
  try {
    const l = lTask(w, {
      pkgs: [{ id: 'P1', streamAgeMs: 1000 }],
      ledger: [
        { ts: 1000, event: 'verdict', task_id: 'aaaaaaaa-0001', node_id: 'accept:P1:1', subgoal_id: 'P1', actor: 'judge', verdict: 'reject' },
        { ts: 2000, event: 'verdict', task_id: 'aaaaaaaa-0001', node_id: 'accept:P1:2', subgoal_id: 'P1', actor: 'judge', verdict: 'accept' },
      ],
    });
    failDispatch(l);
    const f = entryOf(w, l.id).floor;
    assert.equal(f.items[0].last_verdict, 'accept');
    assert.equal(f.handoffs.length, 2);
  } finally { w.cleanup(); }
});

test('last_verdict ignores a verdict from before the current shape (round_first_attempt)', () => {
  const w = world();
  try {
    const l = lTask(w, {
      pkgs: [{ id: 'P1', streamAgeMs: 1000 }],
      ledger: [{ ts: 1000, event: 'verdict', task_id: 'aaaaaaaa-0001', node_id: 'accept:P1:3', subgoal_id: 'P1', attempt: 3, actor: 'judge', verdict: 'reject' }],
    });
    assert.equal(entryOf(w, l.id).floor.items[0].last_verdict, null, 'a running :1 is not attempt 3');
    // repackaged: the only dispatch is :4, whose deps hold the live critique
    const tp = join(l.dir, 'task.json');
    const t = JSON.parse(readFileSync(tp, 'utf8'));
    t.nodes = t.nodes.filter((n) => n.node_id !== 'accept:P1:1');
    const d = t.nodes.find((n) => n.node_id === 'dispatch:P1:1');
    d.node_id = 'dispatch:P1:4'; d.attempt = 4;
    writeFileSync(tp, JSON.stringify(t));
    const item = entryOf(w, l.id).floor.items[0];
    assert.equal(item.last_verdict, null, 'a reject of attempt 3 judged the old shape');
  } finally { w.cleanup(); }
});

test('card94: a running retry has no last_verdict from the attempt before it', () => {
  const w = world();
  try {
    const l = lTask(w, {
      pkgs: [{ id: 'P1', streamAgeMs: 1000 }],
      ledger: [{ ts: 1000, event: 'verdict', task_id: 'aaaaaaaa-0001', node_id: 'accept:P1:1', subgoal_id: 'P1', attempt: 1, actor: 'judge', verdict: 'reject' }],
    });
    const tp = join(l.dir, 'task.json');
    const t = JSON.parse(readFileSync(tp, 'utf8'));
    // in-round retry: :1 stays (failed, its accept:P1:1 kept), :2 runs; round_first_attempt stays 1
    const d1 = t.nodes.find((n) => n.node_id === 'dispatch:P1:1');
    d1.state = 'failed'; d1.attempt = 1;
    t.nodes.push({ ...d1, node_id: 'dispatch:P1:2', state: 'running', attempt: 2 });
    writeFileSync(tp, JSON.stringify(t));
    const item = entryOf(w, l.id).floor.items[0];
    assert.equal(item.state, 'acting');
    assert.equal(item.last_verdict, null, 'dispatch :2 running, the verdict judged attempt 1');
  } finally { w.cleanup(); }
});

test('card94: an acting STORY item has word_key acting and a fixed word without an arrow; doing stays a field', () => {
  const doing = '-> Bash node --test teams/scripts/test-view-summary.mjs teams/scripts/test-view-floor.mjs teams/scripts/test-view.mjs';
  const f = floorOf(
    { task_id: 't', state: 'running', ticket: { key: 'E-t' }, packages: [{ id: 'A', title: 'A', dispatch: { state: 'running' }, child: {} }] },
    { stories: { A: { doing, live: true } } },
  );
  const item = f.items[0];
  assert.equal(item.word_key, 'acting');
  assert.equal(item.word, 'working');
  assert.ok(!item.word.includes('->'));
  assert.equal(item.doing, doing);
  assert.equal(f.workers[0].word, doing, 'the Floor worker keeps the live word');
});

test('card94 own cause: collectTask reads judge cause from the judged accept node by node_id, gaps then blocking then problems then the ledger reason', () => {
  const w = world();
  try {
    const verdict = (reason) => ({ ts: 1000, event: 'verdict', task_id: 'aaaaaaaa-0001', node_id: 'accept:P1:1', stage: 'accept', subgoal_id: 'P1', attempt: 1, actor: 'judge', verdict: 'reject', score: 93, reason });
    const l = lTask(w, { pkgs: [{ id: 'P1', streamAgeMs: 1000 }], ledger: [verdict('ledger reason')] });
    const tp = join(l.dir, 'task.json');
    const t = JSON.parse(readFileSync(tp, 'utf8'));
    const acc = t.nodes.find((n) => n.node_id === 'accept:P1:1');
    const cause = (result) => {
      acc.state = 'failed'; acc.result = result;
      writeFileSync(tp, JSON.stringify(t));
      return collectTask(w.tasks, l.id).telemetry.judge.P1.cause;
    };
    // a pending retry node has no gaps; the judged node keeps its own
    t.nodes.push({ ...acc, node_id: 'accept:P1:2', state: 'pending', attempt: 2, result: undefined });
    assert.equal(cause({ gaps: ['gap one', 'gap two'], blocking: ['block'] }), 'gap one');
    assert.equal(cause({ gaps: [{ text: 'gap obj' }] }), 'gap obj');
    assert.equal(cause({ blocking: ['block one'], problems: ['p'] }), 'block one');
    assert.equal(cause({ problems: [{ text: 'problem one' }] }), 'problem one');
    assert.equal(cause({ accept: false }), 'ledger reason');
  } finally { w.cleanup(); }
});

test('owner_key per kind', () => {
  const w = world();
  try {
    const l = lTask(w, { id: 'aaaaaaaa-0001', pkgs: [{ id: 'P1', streamAgeMs: 1000 }] });
    const s = sTask(w, { id: 'bbbbbbbb-0001', graphFile: true });
    assert.equal(entryOf(w, l.id).floor.items[0].owner_key, 'E-aaaaaaaa/P1'); // a package: the STORY key
    assert.equal(entryOf(w, s.id).floor.items[0].owner_key, 'E-bbbbbbbb'); // an S task: epicKey(run_id)
  } finally { w.cleanup(); }
});

test('worker states: you, done, idle, judge acting', () => {
  const w = world();
  try {
    const ask = node('ask:U1:1', 'ask', [], { state: 'waiting_human', subgoal_id: 'U1', questions: [{ question: 'Keep the legacy PDF route?' }] });
    const l = lTask(w, { pkgs: [{ id: 'P1', streamAgeMs: 1000, child: { nodes: [ask] } }, { id: 'P2', done: true, streamAgeMs: 1000 }, { id: 'P3', streamAgeMs: STALL_MS + 60000 }] });
    write(join(l.dir, 'drivers', 'judge_accept_P2_1.stream.jsonl'), asst('judging P2') + '\n', 1000);
    const { m, floor } = entryOf(w, l.id);
    const st = Object.fromEntries(floor.workers.map((x) => [x.id, x.state]));
    // F3-AC-5: P3's own stream is silent past the threshold, so it reads stalled beside the live ones
    assert.deepEqual(st, { P1: 'you', P2: 'done', P3: 'stalled', judge: 'acting' });
    assert.match(floor.workers.find((x) => x.id === 'judge').doing, /judging P2/);
    // the card and its question text
    const you = summarize(m).you;
    assert.equal(you.count, 1);
    assert.deepEqual(you.items, ['story P1']); // items stay plain titles (back-compat)
    assert.deepEqual(you.cards, [{ key: 'E-aaaaaaaa/P1', title: 'story P1', question: 'Keep the legacy PDF route?', who: 'P1', since: null, stage: 'ask' }]);
  } finally { w.cleanup(); }
});

test('waiting card parked in a child run stays listed live past 24 h', () => {
  const w = world();
  try {
    const H25 = 25 * 3600 * 1000;
    const ask = node('ask:U1:1', 'ask', [], { state: 'waiting_human', subgoal_id: 'U1', questions: [{ question: 'Keep the legacy PDF route?' }] });
    // the package driver exited on purpose: its stream is stale, task.json's dispatch node still says running
    lTask(w, { id: 'aaaaaaaa-0001', ageMs: H25, pkgs: [{ id: 'P1', streamAgeMs: H25, child: { nodes: [ask] } }] });
    lTask(w, { id: 'bbbbbbbb-0002', ageMs: 2 * MIN, pkgs: [{ id: 'P1', streamAgeMs: 30 * 60 * 1000 }] }); // plain stalled
    const out = summary(w);
    assert.deepEqual(out.tasks.map((t) => `${t.task_id}:${t.live}`), ['aaaaaaaa-0001:true', 'bbbbbbbb-0002:false']);
    const t = out.tasks[0];
    assert.equal(t.state, 'waiting_human');
    assert.equal(t.age_ms, null);
    assert.equal(t.you.count, 1);
    assert.equal(t.you.cards[0].question, 'Keep the legacy PDF route?');
    assert.equal(t.items[0].state, 'you');
    assert.equal(t.items[0].live, true);
    assert.equal(t.workers[0].state, 'you');
    assert.equal(out.status.waiting, 1, 'the band count sees the parked card');
  } finally { w.cleanup(); }
});

test('--format status counts a parked waiting card with nothing running, and agrees with summary.status', () => {
  const w = world();
  try {
    const H25 = 25 * 3600 * 1000;
    const ask = node('ask:U1:1', 'ask', [], { state: 'waiting_human', subgoal_id: 'U1', questions: [{ question: 'Keep the legacy PDF route?' }] });
    lTask(w, { id: 'aaaaaaaa-0001', ageMs: H25, pkgs: [{ id: 'P1', streamAgeMs: H25, child: { nodes: [ask] } }] });
    const r = spawnSync(process.execPath, [VIEW, '--once', '--format', 'status', '--tasks-dir', w.tasks, '--cwd', w.cwd], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const st = JSON.parse(r.stdout);
    assert.equal(st.latest, null, 'nothing is running');
    assert.equal(st.waiting, 1);
    assert.deepEqual(st, summary(w).status);
  } finally { w.cleanup(); }
});

test('waiting graph-route harness stage of an S task reads live and counts', () => {
  const w = world();
  try {
    const s = sTask(w, { graphFile: true, streamAgeMs: 60 * MIN, ageMs: 25 * 60 * MIN, pid: 2 ** 22 + 12345 });
    write(s.graphPath, JSON.stringify({ run_id: s.runId, request: `do it [teams-task ${s.id}]`, created_at: Date.now(), nodes: [node('implement:U1:1', 'implement', [], { state: 'waiting_human', subgoal_id: 'U1' })] }));
    const out = summary(w);
    assert.equal(out.tasks.length, 1);
    assert.equal(out.tasks[0].live, true);
    assert.equal(out.tasks[0].you.count, 1);
    assert.equal(out.status.waiting, 1);
    assert.equal(out.tasks[0].items[0].state, 'you');
    assert.equal(out.tasks[0].workers[0].state, 'you');
    assert.equal(out.tasks[0].items[0].live, true);
    assert.equal(typeof out.tasks[0].harness.moving, 'boolean');
    assert.ok(out.tasks[0].harness.slug);
  } finally { w.cleanup(); }
});

// The contract the teams pane renders from: a closed set of worker states, nothing said for idle/done
// workers, a capped feed, and the facts the EPIC row prints.
test('worker states are a closed set; idle and done workers say nothing', () => {
  const w = world();
  try {
    const ask = node('ask:U1:1', 'ask', [], { state: 'waiting_human', subgoal_id: 'U1', questions: [{ question: 'Keep the legacy PDF route?' }] });
    const l = lTask(w, { pkgs: [{ id: 'P1', streamAgeMs: 1000, child: { nodes: [ask] } }, { id: 'P2', done: true, streamAgeMs: 1000 }, { id: 'P3', streamAgeMs: STALL_MS + 60000 }, { id: 'P4', streamAgeMs: 1000 }] });
    const { workers } = entryOf(w, l.id).floor;
    const STATES = ['acting', 'you', 'done', 'stalled', 'idle'];
    assert.ok(workers.length >= 5);
    for (const x of workers) assert.ok(STATES.includes(x.state), `${x.id}: ${x.state}`);
    // F3-AC-5: the silent P3 beside live workers reads stalled (the task itself is not stalled)
    assert.deepEqual([...new Set(workers.map((x) => x.state))].sort(), ['acting', 'done', 'idle', 'stalled', 'you']);
    for (const x of workers.filter((y) => y.state === 'idle' || y.state === 'done')) assert.equal(x.doing, '', x.id);
    const stalled = entryOf(w, lTask(w, { id: 'cccccccc-0003', ageMs: 30 * MIN, pkgs: [{ id: 'P1', streamAgeMs: STALL_MS + 60000 }] }).id).floor.workers;
    for (const x of stalled) assert.ok(STATES.includes(x.state), `${x.id}: ${x.state}`);
    assert.equal(stalled[0].state, 'stalled');
    assert.equal(stalled[0].doing, '');
  } finally { w.cleanup(); }
});

test('hand-offs stay at five however long the ledger is', () => {
  const w = world();
  try {
    const ledger = Array.from({ length: 9 }, (_, i) => ({ ts: 1000 * (i + 1), event: 'verdict', task_id: 'aaaaaaaa-0001', node_id: `accept:P1:${i + 1}`, subgoal_id: 'P1', actor: 'judge', verdict: i % 2 ? 'reject' : 'accept' }));
    const l = lTask(w, { pkgs: [{ id: 'P1', streamAgeMs: 1000 }], ledger });
    assert.equal(entryOf(w, l.id).floor.handoffs.length, 5);
    assert.equal(summary(w).tasks[0].handoffs.length, 5);
  } finally { w.cleanup(); }
});

// Part C: the story-ask exchange (ledger lines in teams/mcp/storyask.mjs's shape) reaches the feed with no mod.
test('--once summary: asked and answered lines are hand-offs, newest 5 only, no mod or TTY needed', () => {
  const w = world();
  try {
    const t = 'aaaaaaaa-0001';
    const base = { task_id: t, key: 'E-aaaaaaaa/P3', node_id: 'dispatch:P3:1', ask_id: '3f0c2a52-8d1e-4a6b-9a53-2d6c1c9d7e10' };
    const ledger = [
      { ts: 1000, event: 'verdict', task_id: t, node_id: 'accept:P1:1', subgoal_id: 'P1', actor: 'judge', verdict: 'accept' },
      { ts: 2000, event: 'integrated', task_id: t, node_id: 'integrate:1', merged: 1 },
      { ts: 3000, event: 'verdict', task_id: t, node_id: 'accept:P2:1', subgoal_id: 'P2', actor: 'judge', verdict: 'reject' },
      { ts: 4000, event: 'asked', ...base, question: 'is amount in cents?' },
      { ts: 5000, event: 'answered', ...base, answer: 'cents, see the plan', by: 'teamleader', route: 'answer' },
      { ts: 6000, event: 'asked', ...base, ask_id: 'b1', question: 'which currency for refunds?' },
      { ts: 7000, event: 'tm_submit_human', task_id: t, key: 'E-aaaaaaaa/P3/ask:P3:1', node_id: 'ask:P3:1', answer: 'EUR', ask_id: 'b1' },
      { ts: 8000, event: 'answered', ...base, ask_id: 'b1', answer: 'EUR', by: 'person', route: 'forward' },
    ];
    const l = lTask(w, { id: t, pkgs: [{ id: 'P3', streamAgeMs: 1000 }], ledger });
    const r = spawnSync(process.execPath, [VIEW, '--once', '--format', 'summary', '--tasks-dir', w.tasks, '--cwd', w.cwd], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const h = JSON.parse(r.stdout).tasks.find((x) => x.task_id === l.id).handoffs;
    // newest first, five of the seven drawn lines; the forwarded submit is not drawn a second time
    assert.deepEqual(h.map(({ from, what, to }) => ({ from, what, to })), [
      { from: 'you', what: 'EUR', to: 'P3' },
      { from: 'P3', what: 'which currency for refunds?', to: 'TeamLeader' },
      { from: 'TeamLeader', what: 'cents, see the plan', to: 'P3' },
      { from: 'P3', what: 'is amount in cents?', to: 'TeamLeader' },
      { from: 'judge', what: 'verdict reject', to: 'P2' },
    ]);
    assert.deepEqual(Object.keys(h[0]).sort(), ['from', 'from_key', 'time', 'to', 'what']);
  } finally { w.cleanup(); }
});

test('a waiting task entry carries what its EPIC row prints', () => {
  const w = world();
  try {
    const H25 = 25 * 3600 * 1000;
    const ask = node('ask:U1:1', 'ask', [], { state: 'waiting_human', subgoal_id: 'U1', questions: [{ question: 'Keep the legacy PDF route?' }] });
    lTask(w, { id: 'aaaaaaaa-0001', ageMs: H25, pkgs: [{ id: 'P1', streamAgeMs: H25, child: { nodes: [ask] } }, { id: 'P2', done: true, streamAgeMs: H25 }] });
    const t = summary(w).tasks[0];
    assert.equal(t.state, 'waiting_human');
    assert.equal(t.key, 'E-aaaaaaaa');
    assert.equal(typeof t.title, 'string');
    assert.ok(t.title.length > 0);
    assert.equal(t.total, 2);
    assert.equal(t.done, 1);
    assert.equal(t.live, true);
    assert.equal(t.age_ms, null);
    for (const k of ['workers', 'handoffs', 'you']) assert.ok(k in t, k);
  } finally { w.cleanup(); }
});

test('two planning cards get distinct worker ids; max is null without a child limit', () => {
  const m = { task_id: 't', state: 'running', ticket: { key: 'E-t' }, packages: [
    { id: 'PL1', phase: 'planning', title: 'a', dispatch: { state: 'running' }, child: {} },
    { id: 'PL2', phase: 'planning', title: 'b', dispatch: { state: 'running' }, child: { max_retries: 1 } },
  ] };
  const f = floorOf(m, {});
  assert.deepEqual(f.workers.map((x) => x.id), ['PLAN', 'PLAN2', 'judge']);
  assert.deepEqual(f.items.map((x) => x.max), [null, 2]);
});

const PAIRS = {
  acting: ['●', 'editing a.ts', ''], you: ['⚑', 'asks a question', ''], idle: ['◌', 'idle', 'idle'],
  done: ['✔', 'done', 'done'], stalled: ['⊘', 'stalled', 'stalled'], failed: ['✘', 'failed', 'failed'],
};

test('icon and word agree for every state (markOf)', () => {
  assert.deepEqual(Object.keys(PAIRS).sort(), ['acting', 'done', 'failed', 'idle', 'stalled', 'you']);
  for (const [state, [icon, word, key]] of Object.entries(PAIRS)) {
    assert.deepEqual(markOf(state, state === 'you' ? 'asks a question' : 'editing a.ts'), { icon, word, word_key: key }, state);
  }
  // a live state without a driver word is blank, never an invented one
  assert.deepEqual(markOf('acting', ''), { icon: '●', word: '', word_key: '' });
  assert.deepEqual(markOf('you'), { icon: '⚑', word: '', word_key: '' });
  // a still state ignores any doing text it is handed
  for (const st of ['idle', 'done', 'stalled', 'failed']) assert.equal(markOf(st, 'running tests').word, st);
});

test('mod.test.ts mirror equals markOf for every state', () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../hooks/mod.test.ts'), 'utf8');
  const blocks = [...src.matchAll(/\/\/ MARKS-BEGIN[^\n]*\n([\s\S]*?)\/\/ MARKS-END/g)];
  assert.equal(blocks.length, 1, 'exactly one MARKS-BEGIN..MARKS-END block');
  const line = blocks[0][1].trim();
  const marks = JSON.parse(line.slice(line.indexOf('= ') + 2).replace(/;$/, ''));
  assert.deepEqual(Object.keys(marks).sort(), ['acting', 'done', 'failed', 'idle', 'stalled', 'you']);
  for (const [state, { icon, word }] of Object.entries(marks)) {
    for (const doing of ['', 'editing a.ts']) {
      assert.deepEqual({ icon, word: word ?? doing, word_key: word === null ? '' : state }, markOf(state, doing), `${state} / ${doing}`);
    }
  }
  const markOfLines = src.split('\n').filter((l) => l.startsWith('const markOf = (state: string, doing: string) =>'));
  assert.equal(markOfLines.length, 1, 'exactly one markOf line in mod.test.ts');
  assert.equal(
    markOfLines[0],
    "const markOf = (state: string, doing: string) => { const m = MARKS[state]!; return { icon: m.icon, word: m.word ?? doing, word_key: m.word === null ? '' : state } }",
  );
});

test('icon and word agree for every state (floorOf items and workers)', () => {
  const pkg = (id, dispatch) => ({ id, title: id, dispatch, child: {} });
  const run = (packages, facts, extra = {}) => floorOf({ task_id: 't', state: 'running', ticket: { key: 'E-t' }, packages, ...extra }, facts);
  const live = { doing: 'editing a.ts', live: true };
  const f = run(
    [pkg('A', { state: 'running' }), pkg('B', { state: 'waiting_human' }), pkg('C', { state: 'running' }), pkg('D', { state: 'failed' }), pkg('E', { state: 'failed' }), { ...pkg('F', { state: 'done' }), accept: { state: 'done' } }],
    { stories: { A: live, B: { doing: 'asks a question', live: false }, D: live, E: { doing: 'old text', live: false } } },
  );
  const item = Object.fromEntries(f.items.map((i) => [i.key, i]));
  const worker = Object.fromEntries(f.workers.map((x) => [x.id, x]));
  const is = (x, state) => { const [icon, word, key] = PAIRS[state]; assert.equal(x.icon, icon); assert.equal(x.word, word); assert.equal(x.word_key, key); };
  // a STORY item says one fixed word for acting and you too (card94); the Floor worker keeps the live `doing` word
  assert.deepEqual([item.A.icon, item.A.word, item.A.word_key, item.A.doing], ['●', 'working', 'acting', 'editing a.ts']); is(worker.A, 'acting');
  assert.deepEqual([item.B.icon, item.B.word, item.B.word_key, item.B.doing], ['⚑', 'needs you', 'you', 'asks a question']); is(worker.B, 'you');
  is(item.C, 'idle'); is(worker.C, 'idle');
  is(worker.F, 'done'); assert.equal(item.F, undefined);
  // failed with a live driver and a doing word: the row says failed, not the live word; state and doing keep their meaning
  assert.equal(item.D.state, 'failed'); assert.equal(item.D.doing, 'editing a.ts'); is(item.D, 'failed');
  is(item.E, 'failed');
  is(worker.judge, 'idle');
  const judged = run([pkg('A', { state: 'running' })], { stories: { A: live }, judge: { live: true, doing: 'judging A' } });
  assert.equal(judged.workers.find((x) => x.id === 'judge').word, 'judging A');
  // stalled: it was working and nothing is alive
  const st = run([pkg('A', { state: 'running' })], { stories: { A: { doing: 'x', live: false } } }, { state: 'stalled' });
  is(st.items[0], 'stalled'); is(st.workers[0], 'stalled');
});

test('a STORY item carries its numbers as metrics; the existing try, max and cost_usd stay', () => {
  const card = (id, dispatch, over = {}) => ({ id, title: `story ${id}`, dispatch, child: { max_retries: 2 }, ...over });
  const m = { task_id: 't', state: 'running', ticket: { key: 'E-t' },
    packages: [
      card('P2', { state: 'running', started_at: 1 }, { attempt: 3 }),
      card('P3', { state: 'pending' }, { attempt: 1 }),
    ],
    telemetry: {
      goal_threshold: 90, max_attempts: 3, out_of_retries: ['P2', 'P3'],
      judge: { P2: { score: 85, reason: 'the footer is not cleared', attempt: 3 } },
      spend: [
        { story: 'P2', attempt: 1, stage: null, cost_usd: 1.25, duration_ms: 60000 },
        { story: 'P2', attempt: 3, stage: null, cost_usd: 2.5, duration_ms: 120000 },
      ],
    } };
  const f = floorOf(m, { stories: { P2: { cost_usd: 3.75 } } });
  const by = Object.fromEntries(f.items.map((i) => [i.key, i]));
  assert.deepEqual(by.P2.metrics, {
    attempt: 3, max_attempts: 3, judge: { score: 85, threshold: 90, verdict: null, attempt: 3, reason: 'the footer is not cleared', gap: null },
    cost_usd: 1.25, retry_cost_usd: 2.5, wall_ms: 180000, out_of_retries: true,
  });
  assert.equal(by.P2.cost_usd, 3.75, 'the desk cost the item already had is unchanged');
  assert.equal(by.P2.max, 3);
  assert.equal(by.P3, undefined, 'a pending STORY is not on the floor yet');
  assert.ok(!JSON.stringify(f.items).match(/NaN|undefined/));
});

test('--once summary: items carry metrics read from the ledger (accept judge, never a dispatch self-score)', () => {
  const w = world();
  try {
    lTask(w, { pkgs: [{ id: 'P1', streamAgeMs: 1000 }], ledger: [
      { event: 'verdict', stage: 'dispatch', subgoal_id: 'P1', score: 99, verdict: 'accepted', attempt: 1 },
      { event: 'verdict', stage: 'accept', subgoal_id: 'P1', score: 85, reason: 'the footer is not cleared', verdict: 'rejected', attempt: 1 },
    ] });
    const p1 = summary(w).tasks[0].items[0];
    assert.equal(p1.metrics.judge.score, 85);
    assert.equal(p1.metrics.judge.reason, 'the footer is not cleared');
    assert.equal(p1.metrics.attempt, 1);
    assert.equal(p1.try, 1, 'try is the child run\'s and unchanged');
    assert.equal(p1.max, 3);
    assert.equal(p1.metrics.out_of_retries, false);
    assert.equal(p1.metrics.retry_cost_usd, 0);
  } finally { w.cleanup(); }
});

// ---------- F2: per-Phase counts and hand-offs (card 125 F2, F2-AC-41/42/45/48) ----------

test('F2-AC-48: workers carry their Phase; phases count only workers[] and a stalled one needs its integer minutes', () => {
  const m = { task_id: 't', state: 'running', ticket: { key: 'E-t' },
    packages: [
      { id: 'P1', title: 'a', phase: 'planning', dispatch: { state: 'running', started_at: 1 }, child: { max_retries: 2 } },
      { id: 'P2', title: 'b', dispatch: { state: 'running', started_at: 1 }, child: { max_retries: 2 } },
      { id: 'P3', title: 'c', dispatch: { state: 'running', started_at: 1 }, child: { max_retries: 2 } },
      { id: 'P4', title: 'd', dispatch: { state: 'running', started_at: 1 }, child: { max_retries: 2 } },
    ] };
  const f = floorOf(m, { stories: { P1: { live: true, doing: 'x' }, P2: { live: true, doing: 'y' }, P3: { silent: true, minutes: 23 }, P4: { silent: true } }, judge: { live: true, doing: 'j' } }, { now: 0 });
  assert.deepEqual(f.workers.map((w) => [w.id, w.phase]), [['PLAN', 'plan'], ['P2', 'build'], ['P3', 'build'], ['P4', 'build'], ['judge', 'gate']]);
  const by = Object.fromEntries(f.phases.map((p) => [p.key, p]));
  assert.deepEqual(f.phases.map((p) => p.key), ['plan', 'build', 'integrate', 'qa', 'gate', 'report']);
  assert.deepEqual([by.plan.acting, by.build.acting, by.build.stalled, by.gate.acting], [1, 1, 1, 1]);
  assert.equal(by.build.workers, 3);
  // a stalled worker without minutes is not counted as stalled (no rule of this file's own)
  assert.equal(f.workers.find((w) => w.id === 'P4').minutes, undefined);
});

test('F2-AC-48: hand-offs are per Phase, each with its own newest five; a STORY event is Build, a manager node its stage', () => {
  const L = (o) => JSON.stringify({ task_id: 'E-t', ...o });
  const ledger = [
    L({ ts: 1000, event: 'verdict', node_id: 'accept:P1:1', subgoal_id: 'P1', verdict: 'reject' }),
    L({ ts: 2000, event: 'waiting_human', node_id: 'ask:P1:1', key: 'E-t/P1' }),
    L({ ts: 3000, event: 'verdict', node_id: 'critique', verdict: 'sound' }),
    L({ ts: 4000, event: 'integrated', merged: 2 }),
    ...[0, 1, 2, 3, 4, 5, 6].map((i) => L({ ts: 5000 + i, event: 'verdict', node_id: 'accept:P1:2', subgoal_id: 'P1', verdict: 'accept' })),
  ];
  const f = floorOf({ task_id: 't', state: 'running', ticket: { key: 'E-t' }, packages: [{ id: 'P1', title: 'a', dispatch: { state: 'running', started_at: 1 }, child: { max_retries: 2 } }] }, { ledger }, { now: 0 });
  assert.equal(f.phase_handoffs.build.length, 5, 'Build keeps its own newest five');
  assert.equal(f.phase_handoffs.plan.length, 1);
  assert.equal(f.phase_handoffs.plan[0].what, 'verdict sound');
  assert.equal(f.phase_handoffs.integrate.length, 1);
  assert.deepEqual(f.phase_handoffs.qa, []);
  assert.equal(f.handoffs.length, 5, 'the EPIC-wide list is unchanged');
});

test('F2-AC-2: an acting worker carries node, role and elapsed_ms from its running node; a waiting one is the TeamLeader\'s; absent where unrecorded', () => {
  const model = (child) => ({ task_id: 't', state: 'running', ticket: { key: 'E-t' }, packages: [
    { id: 'P1', title: 'a', dispatch: { state: 'running', started_at: 1000, stage: 'dispatch' }, child },
    { id: 'P2', title: 'b', dispatch: { state: 'running', started_at: 1000, stage: 'dispatch' }, child: { max_retries: 2 } },
    { id: 'P3', title: 'c', dispatch: { state: 'running', started_at: 1000, stage: 'dispatch' }, child: { max_retries: 2, nodes: [{ node_id: 'ask:P3:1', stage: 'ask', state: 'waiting_human', waiting_since: 31000 }] } },
  ] });
  const facts = { stories: { P1: { live: true }, P2: { live: true }, P3: { live: true } } };
  const running = { max_retries: 2, nodes: [{ node_id: 'implement:U1:1', stage: 'implement', state: 'running', started_at: 1000 }] };
  const f = floorOf(model(running), facts, { now: 61000 });
  const by = Object.fromEntries(f.workers.map((x) => [x.id, x]));
  assert.deepEqual([by.P1.node, by.P1.role, by.P1.elapsed_ms], ['implement', 'implementer', 60000]);
  // a claimed dispatch with no inner node yet: nothing recorded, nothing sent
  assert.deepEqual(['node', 'role', 'elapsed_ms'].map((k) => k in by.P2), [false, false, false]);
  assert.deepEqual([by.P3.node, by.P3.role, by.P3.elapsed_ms], ['ask', 'TeamLeader', 30000]);
  // a stalled worker keeps only its minutes
  const stalled = floorOf({ ...model(running), state: 'stalled', stall: { minutes: 23 } }, { stories: {} }, { now: 61000 });
  assert.deepEqual(['node', 'role', 'elapsed_ms'].map((k) => k in stalled.workers[0]), [false, false, false]);
});

test('F2-AC-2: Phase hand-offs carry story, a verdict\'s score, reason and next role, and a question is TeamLeader to you; the EPIC-wide list keeps its fields', () => {
  const L = (o) => JSON.stringify({ task_id: 'E-t', ...o });
  const ledger = [
    L({ ts: 1000, event: 'verdict', node_id: 'accept:P1:1', stage: 'accept', subgoal_id: 'P1', verdict: 'accept', score: 91, reason: null }),
    L({ ts: 2000, event: 'verdict', node_id: 'accept:P2:1', stage: 'accept', subgoal_id: 'P2', verdict: 'reject', score: 61, reason: 'AC 3 missing' }),
    L({ ts: 3000, event: 'asked', key: 'E-t/P2', question: 'How many retries?' }),
    L({ ts: 4000, event: 'verdict', node_id: 'critique', verdict: 'sound' }),
    L({ ts: 5000, event: 'integrated', merged: 2 }),
  ];
  const f = floorOf({ task_id: 't', state: 'running', ticket: { key: 'E-t' }, packages: [{ id: 'P1', title: 'a', dispatch: { state: 'running', started_at: 1 }, child: { max_retries: 2 } }, { id: 'P2', title: 'b', dispatch: { state: 'running', started_at: 1 }, child: { max_retries: 2 } }] }, { ledger }, { now: 0 });
  const b = f.phase_handoffs.build;
  assert.deepEqual(b.map((h) => h.story), ['P2', 'P2', 'P1']);
  assert.deepEqual([b[2].score, b[2].to_role, 'reason' in b[2]], [91, 'integrate', false]);
  assert.deepEqual([b[1].score, b[1].reason, b[1].to_role], [61, 'AC 3 missing', 'implementer']);
  assert.deepEqual([b[0].from, b[0].what, b[0].reason, b[0].to, b[0].to_key], ['TeamLeader', '', 'How many retries?', 'you', 'partyYou']);
  // a manager verdict and an integration record no story and no flow
  assert.deepEqual([f.phase_handoffs.plan[0].story, f.phase_handoffs.plan[0].to_role, f.phase_handoffs.integrate[0].story], [undefined, undefined, undefined]);
  assert.deepEqual(Object.keys(f.handoffs.find((h) => h.what === 'verdict reject')).sort(), ['from', 'time', 'to', 'what', 'what_key', 'what_vars']);
});

test('floor source: no use of metrics.drivers.stalled or taskStalled', () => {
  const src = readFileSync(join(dirname(VIEW), 'lib', 'view-floor.mjs'), 'utf8');
  assert.ok(!/metrics\.drivers\.stalled|taskStalled/.test(src));
});
