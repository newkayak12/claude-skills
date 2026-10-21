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
import { floorOf } from './lib/view-floor.mjs';
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
    assert.deepEqual(Object.keys(p1).sort(), ['cost_estimated', 'cost_usd', 'doing', 'elapsed_ms', 'key', 'last_verdict', 'live', 'max', 'owner_key', 'run_file', 'state', 'title', 'try'].sort());
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
  assert.deepEqual(Object.keys(h[0]).sort(), ['from', 'time', 'to', 'what']);
  assert.equal(h[0].to, 'P3');
  assert.equal(h[3].from, 'you');
  assert.equal(h[3].to, 'P2');
  // nothing recorded, nothing shown
  assert.deepEqual(handoffs([JSON.stringify(ev(1, 'node_finish')), JSON.stringify(ev(2, 'daemon_spawned'))]), []);
  assert.deepEqual(handoffs([]), []);
});

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
    const f = entryOf(w, l.id).floor;
    assert.equal(f.items[0].last_verdict, 'accept');
    assert.equal(f.handoffs.length, 2);
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
    assert.deepEqual(st, { P1: 'you', P2: 'done', P3: 'idle', judge: 'acting' });
    assert.match(floor.workers.find((x) => x.id === 'judge').doing, /judging P2/);
    // the card and its question text
    const you = summarize(m).you;
    assert.equal(you.count, 1);
    assert.deepEqual(you.items, ['story P1']); // items stay plain titles (back-compat)
    assert.deepEqual(you.cards, [{ key: 'E-aaaaaaaa/P1', title: 'story P1', question: 'Keep the legacy PDF route?' }]);
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

test('two planning cards get distinct worker ids; max is null without a child limit', () => {
  const m = { task_id: 't', state: 'running', ticket: { key: 'E-t' }, packages: [
    { id: 'PL1', phase: 'planning', title: 'a', dispatch: { state: 'running' }, child: {} },
    { id: 'PL2', phase: 'planning', title: 'b', dispatch: { state: 'running' }, child: { max_retries: 1 } },
  ] };
  const f = floorOf(m, {});
  assert.deepEqual(f.workers.map((x) => x.id), ['PLAN', 'PLAN2', 'judge']);
  assert.deepEqual(f.items.map((x) => x.max), [null, 2]);
});
