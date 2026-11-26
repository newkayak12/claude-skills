// F5: a task whose task.json carries task.hold reads as held, never stalled. The hold is written into the
// fixture's task.json directly (F5-AC-25): the view reads that key only. Every fixture is a temp task dir.
//
//   node --test teams/scripts/test-view-hold.mjs
process.env.TEAMS_RUNS_DIR ??= 'off';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { node } from '../mcp/graph.mjs';
import { collectTask, listTasks } from './lib/view-collect.mjs';
import { floorTasks, floorEntry } from './lib/view-floor-fs.mjs';
import { dashboardModel, dashboardSvg } from './lib/view-dashboard.mjs';
import { floorOf } from './lib/view-floor.mjs';
import { summarize, TASK_STATES } from './lib/view-summary.mjs';

const VIEW = join(dirname(fileURLToPath(import.meta.url)), 'view.mjs');
const DEAD_PID = 2 ** 22 + 991;
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const HOLD = { reason: 'lunch break', since: '2026-11-01T10:00:00.000Z', by: 'person' };
const ID = 'E-aaaaaaaa1111';

// One STORY at work with one recorded driver. `ageMs` ages the task, its stream and its ledger.
function fixture({ hold = null, ageMs = 0, pid = DEAD_PID, daemon = false, capacity = false, ledger = [], extra = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'view-hold-'));
  const cwd = join(root, 'proj');
  const tasks = join(root, 'tasks');
  const dir = join(tasks, ID);
  mkdirSync(join(dir, 'drivers'), { recursive: true });
  mkdirSync(cwd, { recursive: true });
  const at = Date.now() - ageMs;
  const log = join(dir, 'drivers', 'dispatch_P1_1.stream.jsonl');
  const child = {
    run_id: 'child-1', cwd: join(root, 'wt'), driver: { pid, log, restarts: [] },
    ...(capacity ? { waiting_capacity: { reason: 'usage limit', since: Date.now() - 5 * MIN } } : {}),
  };
  const nodes = [
    node('size', 'size', [], { state: 'done' }),
    node('shape', 'shape', ['size'], { state: 'done' }),
    node('critique', 'critique', ['shape'], { state: 'done' }),
    node('dispatch:P1:1', 'dispatch', ['critique'], { state: 'running', subgoal_id: 'P1', child }),
    node('accept:P1:1', 'accept', ['dispatch:P1:1'], { subgoal_id: 'P1' }),
    node('integrate:1', 'integrate', ['accept:P1:1']),
    node('report', 'report', ['integrate:1']),
  ];
  const task = {
    run_id: ID, kind: 'task', cwd, request: 'build the thing', created_at: at, store_path: join(dir, 'task.json'),
    spec: { packages: [{ id: 'P1', title: 'one', deps: [] }] }, nodes,
    ...(daemon ? { daemon: { pid: DEAD_PID, started_at: at, restarts: 0 } } : {}),
    ...(hold ? { hold } : {}), ...extra,
  };
  const save = (name, text) => { const p = join(dir, name); writeFileSync(p, text); utimesSync(p, at / 1000, at / 1000); };
  save('task.json', JSON.stringify(task));
  const runs = join(child.cwd, '.teams_output', 'broker', 'runs');
  mkdirSync(runs, { recursive: true });
  writeFileSync(join(runs, 'child-1.json'), JSON.stringify({ run_id: 'child-1', nodes: [] }));
  save('ledger.jsonl', ledger.map((e) => JSON.stringify({ ts: at, ...e })).join('\n') + '\n');
  save(join('drivers', 'dispatch_P1_1.stream.jsonl'), '{"type":"system"}\n');
  return { root, cwd, tasks, dir, id: ID, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

const once = (f, ...args) => {
  const r = spawnSync(process.execPath, [VIEW, '--once', '--tasks-dir', f.tasks, '--cwd', f.cwd, ...args], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
};
const json = (f, ...args) => JSON.parse(once(f, ...args));
// every JSON task entry --once prints, with the name of the place it came from
const entries = (f) => {
  const s = json(f, '--format', 'summary', '--task', f.id);
  const t = json(f, '--format', 'teams', '--task', f.id);
  return [['summary.tasks', s.tasks[0]], ['summary.task', s.task], ['teams.tasks', t.tasks[0]], ['teams.task', t.task]];
};
// without hold and the fields that move with the clock
const stable = (e) => JSON.parse(JSON.stringify(e, (k, v) => (['hold', 'age_ms', 'elapsed_ms', 'wall_ms', 'at', 'created_at', 'time', 'day'].includes(k) ? undefined : v)).replace(/view-hold-\w+/g, 'view-hold'));
// a second, finished task, so the default text view is the task index
const addDone = (f) => {
  const dir = join(f.tasks, 'E-bbbbbbbb2222');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'task.json'), JSON.stringify({ run_id: 'E-bbbbbbbb2222', kind: 'task', cwd: f.cwd, request: 'done thing', created_at: Date.now() - HOUR, cancelled: true, nodes: [node('size', 'size', [], { state: 'done' })] }));
};
const using = (opts, fn) => { const f = fixture(opts); try { return fn(f); } finally { f.cleanup(); } };

test('F5-AC-1 every task-listing --once format carries hold as recorded, and the state word is unchanged', () => {
  const plain = using({ pid: process.pid }, (f) => entries(f).map(([, e]) => e.state));
  using({ pid: process.pid, hold: { ...HOLD, extra: 'not copied' } }, (f) => {
    entries(f).forEach(([where, e], i) => {
      assert.deepEqual(e.hold, HOLD, where);
      assert.equal(e.state, plain[i], where);
    });
    assert.match(once(f, '--format', 'board', '--task', f.id), /^RUNNING .* · held$/m);
    for (const view of ['pipeline', 'tickets', 'resources']) assert.match(once(f, '--task', f.id, '--view', view), /held by person: lunch break/, view);
    addDone(f);
    const index = once(f);
    assert.match(index, /build the thing .*IN_PROGRESS.* · held$/m);
    assert.equal(index.match(/held/g).length, 1, 'only the held row says held');
    assert.deepEqual(listTasks(f.tasks).map((r) => r.hold), [HOLD, undefined]);
    const dash = dashboardModel(summarize(collectTask(f.tasks, f.id)));
    assert.deepEqual(dash.hold, HOLD);
    assert.match(dashboardSvg(dash), /· held</);
  });
  assert.ok(!TASK_STATES.includes('held'));
});

// every tasks[] entry says hold: null; the single `task` object carries the key only when held
const assertUnheld = (list) => {
  for (const [where, e] of list) assert.equal(where.endsWith('.tasks') ? e.hold : 'hold' in e, where.endsWith('.tasks') ? null : false, where);
};

test('F5-AC-2 a task without task.hold reads hold: null and every other value is as for the held one', () => {
  const read = (hold) => using({ pid: process.pid, hold }, (f) => {
    const list = entries(f);
    if (!hold) assertUnheld(list);
    const out = list.map(([, e]) => e);
    return { rest: out.map(stable), text: once(f, '--format', 'board', '--task', f.id) + once(f, '--task', f.id) };
  });
  const without = read(null);
  assert.doesNotMatch(without.text, /held/);
  assert.deepEqual(without.rest, read(HOLD).rest);
});

test('F5-AC-3 the ledger events are history: no task.hold key reads hold: null', () => {
  const held = { event: 'task_held', ...HOLD };
  const resumed = { event: 'task_resumed', by: 'person' };
  for (const ledger of [[held, resumed], [held]]) {
    using({ pid: process.pid, ledger }, (f) => assertUnheld(entries(f)));
  }
});

test('F5-AC-4 a held task with a dead daemon and dead drivers is not stalled anywhere in the model', () => {
  using({ hold: HOLD, daemon: true, ageMs: HOUR }, (f) => {
    const m = collectTask(f.tasks, f.id);
    assert.deepEqual(m.hold, HOLD);
    assert.deepEqual(m.stall, { stalled: false });
    assert.equal(m.state, 'running');
    assert.equal(m.ticket.state, 'IN_PROGRESS');
    assert.notEqual(m.packages[0].ticket_state, 'stalled');
    assert.equal(listTasks(f.tasks)[0].state, 'IN_PROGRESS');
    assert.deepEqual(summarize(m).metrics.drivers.stalled, []);
  });
  // a driver that is alive: the package reads IN_PROGRESS, which the stalled rule would otherwise rewrite
  using({ hold: HOLD, daemon: true, pid: process.pid, ageMs: HOUR }, (f) => {
    const m = collectTask(f.tasks, f.id);
    assert.equal(m.packages[0].ticket_state, 'IN_PROGRESS');
    assert.equal(m.ticket.state, 'IN_PROGRESS');
  });
  // a driver that is alive but silent is the drivers.stalled path
  using({ hold: HOLD, pid: process.pid, ageMs: HOUR, extra: { stall_minutes: 10 } }, (f) => {
    assert.deepEqual(summarize(collectTask(f.tasks, f.id)).metrics.drivers.stalled, []);
  });
});

test('F5-AC-5 the same task without task.hold still reads stalled with its minutes', () => {
  using({ daemon: true, ageMs: HOUR }, (f) => {
    const m = collectTask(f.tasks, f.id);
    assert.equal(m.hold, null);
    assert.equal(m.state, 'stalled');
    assert.equal(m.ticket.state, 'stalled');
    assert.equal(m.stall.stalled, true);
    assert.ok(m.stall.minutes >= 60);
  });
  using({ daemon: true, pid: process.pid, ageMs: HOUR }, (f) => assert.equal(collectTask(f.tasks, f.id).packages[0].ticket_state, 'stalled'));
  using({ pid: process.pid, ageMs: HOUR, extra: { stall_minutes: 10 } }, (f) => {
    assert.deepEqual(summarize(collectTask(f.tasks, f.id)).metrics.drivers.stalled.map((d) => d.id), ['P1']);
  });
});

test('F5-AC-6 a held task\'s silent workers carry no stalled minutes and no phase counts them paused', () => {
  const floor = (hold) => using({ hold, pid: process.pid, ageMs: HOUR }, (f) => {
    const m = collectTask(f.tasks, f.id);
    return floorEntry({ m, id: f.id, live: true, age_ms: null }, f.tasks);
  });
  const stalledOf = (e) => e.phases.reduce((a, p) => a + p.stalled, 0);
  assert.equal(stalledOf(floor(null)), 1, 'the unheld control is counted');
  const e = floor(HOLD);
  assert.equal(stalledOf(e), 0);
  for (const w of [...e.workers, ...e.items]) {
    assert.notEqual(w.state, 'stalled', w.id || w.key);
    assert.equal(w.minutes, undefined);
  }
});

test('F5-AC-7 text and board draw no Stalled line for a held task and put nothing under Needs you', () => {
  const read = (hold) => using({ hold, pid: process.pid, ageMs: HOUR, extra: { stall_minutes: 10 } }, (f) => ({
    board: once(f, '--format', 'board', '--task', f.id),
    text: once(f, '--task', f.id),
  }));
  assert.match(read(null).board, /Stalled P1 \d+m/, 'the unheld control draws the line');
  const held = read(HOLD);
  for (const s of [held.board, held.text]) assert.doesNotMatch(s, /stalled/i);
  assert.doesNotMatch(held.board, /On you \d|Needs you [1-9]|^⚑/m);
});

test('F5-AC-12 a held waiting_capacity task reads held with the provider-limit wording and no minutes', () => {
  using({ hold: { ...HOLD, by: 'engine', reason: 'capacity' }, capacity: true, ageMs: HOUR, daemon: true }, (f) => {
    const [, e] = entries(f)[0];
    assert.equal(e.hold.by, 'engine');
    assert.notEqual(e.state, 'stalled');
    assert.ok(e.workers.every((w) => w.minutes === undefined));
    const text = once(f, '--task', f.id, '--view', 'resources');
    assert.match(text, /held by engine: capacity$/m);
    assert.match(text, /waiting_capacity: usage limit \(\d+m\d+s\)/);
    assert.doesNotMatch(text, /stalled/i);
  });
});

test('F5-AC-12 a person hold on a capacity-parked task carries capacity_parked, whatever its reason says', () => {
  for (const [hold, capacity, want] of [[HOLD, true, true], [HOLD, false, undefined], [null, true, undefined]]) {
    using({ hold, capacity, pid: process.pid }, (f) => {
      for (const [where, e] of entries(f)) assert.equal(e.capacity_parked, want, where);
    });
  }
});

test('F5-AC-8 a held planning desk names its card as the worker\'s item, and its STORY payload carries it', () => {
  const planning = { spec: { packages: [] }, nodes: [node('size', 'size', [], { state: 'done' })], plan_cards: [] };
  for (const hold of [HOLD, null]) {
    using({ hold, pid: process.pid }, (f) => {
      const m = collectTask(f.tasks, f.id);
      m.packages[0].phase = 'planning'; // the P1 card read as a planning card
      const w = floorOf(m).workers.find((x) => x.id === 'PLAN');
      assert.equal(w.item, hold ? 'P1' : undefined);
    });
  }
});

test('F5-AC-13 without task.hold, waiting_capacity is as before and a merely silent task still reads stalled', () => {
  using({ capacity: true, ageMs: HOUR }, (f) => {
    const m = collectTask(f.tasks, f.id);
    assert.equal(m.hold, null);
    assert.notEqual(m.state, 'stalled');
    assert.equal(m.packages[0].ticket_state, 'WAITING_CAPACITY');
    const text = once(f, '--task', f.id, '--view', 'resources');
    assert.match(text, /waiting_capacity: usage limit \(/);
    assert.doesNotMatch(text, /held/);
  });
  using({ ageMs: HOUR }, (f) => assert.equal(collectTask(f.tasks, f.id).state, 'stalled'));
});

test('F5-AC-16 a held task older than 24 h is listed live; the same task unheld is not listed', () => {
  using({ ageMs: 48 * HOUR }, (f) => {
    assert.deepEqual(floorTasks({ tasksDir: f.tasks, cwd: f.cwd }), []);
  });
  using({ hold: HOLD, ageMs: 48 * HOUR, daemon: true }, (f) => {
    const listed = floorTasks({ tasksDir: f.tasks, cwd: f.cwd });
    assert.deepEqual(listed.map((x) => [x.id, x.live, !!x.waiting]), [[f.id, true, false]]);
    // listedOf, through both the full listing and the status line's live-only one
    assert.deepEqual(json(f, '--format', 'summary').tasks.map((t) => [t.task_id, t.live, t.state]), [[f.id, true, 'running']]);
    assert.match(json(f, '--format', 'status').line, /E-aaaaaaaa/);
  });
});
