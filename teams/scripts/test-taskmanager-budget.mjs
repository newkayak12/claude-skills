#!/usr/bin/env node
// taskmanager-budget.mjs owns the budget / timebox and the max_parallel_teams AIMD controller;
// taskmanager.mjs re-exports its public names unchanged.
//
//   node --test teams/scripts/test-taskmanager-budget.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as facade from '../mcp/taskmanager.mjs';
import * as mod from '../mcp/taskmanager-budget.mjs';
import { renderHarnessReport } from '../mcp/docs.mjs';
import { unfinishedWork } from '../mcp/taskstate.mjs';
import { epicTicketState } from '../mcp/tickets.mjs';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { FALLBACK_RATES, fallbackRate, collectTaskCosts, taskFigure, spendFigure, latestCostEvent } from '../mcp/drivercost.mjs';

const OWNED = [
  'taskSpend', 'taskElapsedMinutes', 'budgetStatus', 'closeFailedPlanning', 'enforceBudget',
  'ensureAutoParallel', 'updateAutoParallel',
];

test('every public name taskmanager-budget.mjs owns is the facade\'s own binding', () => {
  for (const name of OWNED) {
    assert.equal(typeof mod[name], 'function', `${name} is not exported by taskmanager-budget.mjs`);
    assert.equal(facade[name], mod[name], `${name} on the facade is not the module's binding`);
  }
});

test('taskElapsedMinutes does not count the time the machine slept', () => {
  const m = mod.taskElapsedMinutes({ created_at: Date.now() - 180000, suspended_ms: 120000 });
  assert.ok(m > 0.9 && m < 1.5, String(m));
});

test('budgetStatus: neither budget_usd nor timebox_minutes set is unlimited, never over', () => {
  const s = mod.budgetStatus({});
  assert.equal(s.pct, 0);
  assert.equal(s.over, false);
  assert.equal(s.warn, false);
});

// ---- card 125 F3-US-8: per-model pricing, one spend figure, durable cost events ----

// A result-less session (the E-066abb46 shape): one Sonnet and one Opus message of equal size.
const OUT = 100000; // output tokens per message = 5 * OUT input-token units
const assistant = (id, model) => JSON.stringify({ type: 'assistant', message: { id, model, usage: { output_tokens: OUT } } });
const resultless = () => [JSON.stringify({ type: 'system', model: 'claude-opus-5-5' }), assistant('m1', 'claude-sonnet-5-5'), assistant('m2', 'claude-opus-5-5')].join('\n') + '\n';
const opusOnly = 5 * OUT * 2 * FALLBACK_RATES['claude-opus-5-5'];
const mixed = 5 * OUT * (FALLBACK_RATES['claude-opus-5-5'] + FALLBACK_RATES['claude-sonnet-5-5']);

function withTask(fn, { stream = resultless(), opts = {}, ledger = [] } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'budget-f3-'));
  const was = process.env.HARNESS_TASKS_DIR;
  process.env.HARNESS_TASKS_DIR = root;
  try {
    const dir = join(root, 'T1');
    mkdirSync(join(dir, 'drivers'), { recursive: true });
    if (stream) writeFileSync(join(dir, 'drivers', 'S.stream.jsonl'), stream);
    writeFileSync(join(dir, 'ledger.jsonl'), ledger.map((e) => JSON.stringify(e) + '\n').join(''));
    const task = { run_id: 'T1', cwd: root, nodes: [], created_at: Date.now() - 600000, team: { opts } };
    return fn({ task, dir });
  } finally {
    if (was === undefined) delete process.env.HARNESS_TASKS_DIR; else process.env.HARNESS_TASKS_DIR = was;
    rmSync(root, { recursive: true, force: true });
  }
}
const ledgerOf = (dir) => readFileSync(join(dir, 'ledger.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

function liveDriver() {
  const child = spawn('sleep', ['60'], { detached: true, stdio: 'ignore' });
  child.unref();
  return { pid: child.pid };
}

test('enforceBudget kills a past-grace harness driver and leaves a report renderable', () => {
  withTask(({ dir, task }) => {
    const driver = liveDriver();
    const reportPath = join(dir, 'harness-report.md');
    writeFileSync(reportPath, '# harness report\n');
    task.harness_run = {
      driver, report_path: reportPath, cwd: dir,
      opened_at: Date.now() - 600000,
      run: null,
    };
    task.budget_stopped = { at: Date.now() - 600000, spend: 0 };
    try {
      mod.enforceBudget(task);
      const killed = ledgerOf(dir).find((e) => e.event === 'budget_killed' && e.node_id === 'S');
      assert.equal(killed.pid, driver.pid);
      assert.equal(killed.killed_driver, true);
      assert.ok(renderHarnessReport(task));
      mod.enforceBudget(task);
      assert.equal(ledgerOf(dir).filter((e) => e.event === 'budget_killed' && e.node_id === 'S').length, 1);
    } finally {
      try { process.kill(-driver.pid, 'SIGTERM'); } catch {}
    }
  }, { stream: resultless(), opts: { budget_usd: 1 } });
});

test('enforceBudget leaves a harness driver alive within both grace windows', () => {
  withTask(({ dir, task }) => {
    const driver = liveDriver();
    task.harness_run = { driver, cwd: dir, opened_at: Date.now(), run: null };
    task.budget_stopped = { at: Date.now(), spend: 0 };
    try {
      mod.enforceBudget(task);
      assert.doesNotThrow(() => process.kill(driver.pid, 0));
      assert.equal(ledgerOf(dir).some((e) => e.event === 'budget_killed'), false);
    } finally {
      try { process.kill(-driver.pid, 'SIGTERM'); } catch {}
    }
  }, { stream: resultless(), opts: { budget_usd: 1, budget_grace_usd: 100, budget_grace_minutes: 5 } });
});

// One enforceBudget call on a size-S task whose budget_stopped was set `agoMin` minutes ago with
// `stoppedSpend` already spent; reports whether the driver died and how many budget_killed it logged.
function harnessStopCase({ agoMin, stoppedSpend, opts }) {
  let out;
  withTask(({ dir, task }) => {
    const driver = liveDriver();
    task.harness_run = { driver, cwd: dir, opened_at: Date.now() - 3600000, run: null };
    task.budget_stopped = { at: Date.now() - agoMin * 60000, spend: stoppedSpend };
    try {
      mod.enforceBudget(task);
      let alive = true;
      try { process.kill(driver.pid, 0); } catch { alive = false; }
      out = { alive, kills: ledgerOf(dir).filter((e) => e.event === 'budget_killed' && e.pid === driver.pid).length };
    } finally {
      try { process.kill(-driver.pid, 'SIGTERM'); } catch {}
    }
  }, { stream: resultless(), opts: { budget_usd: 1, ...opts } });
  return out;
}

test('harness driver kill: dollar grace alone triggers (time grace not spent)', () => {
  const r = harnessStopCase({ agoMin: 0, stoppedSpend: 0, opts: { budget_grace_minutes: 5000 } });
  assert.equal(r.kills, 1);
});

test('harness driver kill: time grace alone triggers (no spend since the stop)', () => {
  const r = harnessStopCase({ agoMin: 10, stoppedSpend: 1e9, opts: { budget_grace_usd: 1e9 } });
  assert.equal(r.kills, 1);
});

test('harness driver kill: budget_grace_usd overrides the 10% default', () => {
  const dflt = harnessStopCase({ agoMin: 0, stoppedSpend: 0, opts: { budget_grace_minutes: 5000 } });
  const wide = harnessStopCase({ agoMin: 0, stoppedSpend: 0, opts: { budget_grace_minutes: 5000, budget_grace_usd: 1e9 } });
  assert.equal(dflt.kills, 1);
  assert.equal(wide.kills, 0);
  assert.equal(wide.alive, true);
});

test('a result-less Opus+Sonnet stream is priced per message: below the Opus-only price, marked estimated', () => {
  withTask(({ dir, task }) => {
    const c = collectTaskCosts(dir, task);
    assert.equal(c.estimated_sessions, 1);
    assert.ok(Math.abs(c.cost_usd - mixed) < 1e-3, `${c.cost_usd} vs ${mixed}`);
    assert.ok(c.cost_usd < opusOnly, `${c.cost_usd} not below ${opusOnly}`);
  });
});

test('enforceBudget: budget_warning and budget_stopped carry estimated:true and the status spend', () => {
  withTask(({ dir, task }) => {
    const status = mod.budgetStatus(task);
    assert.equal(status.estimated, true);
    assert.equal(status.spend, taskFigure(dir, task).spend);
    mod.enforceBudget(task);
    const evs = ledgerOf(dir);
    const w = evs.find((e) => e.event === 'budget_warning');
    const s = evs.find((e) => e.event === 'budget_stopped');
    for (const e of [w, s]) { assert.equal(e.estimated, true); assert.equal(e.spend, status.spend); }
  }, { opts: { budget_usd: 1 } });
});

test('budgetStatus with only timebox_minutes set returns the real spend', () => {
  withTask(({ dir, task }) => {
    const s = mod.budgetStatus(task);
    assert.ok(s.spend > 0);
    assert.equal(s.spend, mod.taskSpend(task));
    assert.equal(s.spend, taskFigure(dir, task).spend);
  }, { opts: { timebox_minutes: 600 } });
});

test('a finished session carries no estimated mark on the events', () => {
  const done = resultless() + JSON.stringify({ type: 'result', total_cost_usd: 2, num_turns: 1, duration_ms: 1 }) + '\n';
  withTask(({ dir, task }) => {
    assert.equal(mod.budgetStatus(task).estimated, false);
    mod.enforceBudget(task);
    const evs = ledgerOf(dir).filter((x) => x.event === 'budget_stopped' || x.event === 'budget_warning');
    assert.ok(evs.length >= 1);
    for (const e of evs) assert.equal('estimated' in e, false);
  }, { stream: done, opts: { budget_usd: 1 } });
});

test('spendFigure: an exact larger durable event wins; an estimated one never raises the figure', () => {
  const live = { cost_usd: 32.7186 };
  assert.deepEqual(spendFigure(live, { spend: 47.2906, estimated: false }), { spend: 47.2906, estimated: false, from: 'durable' });
  assert.equal(spendFigure(live, { spend: 47.2906, estimated: true }).spend, 32.7186);
  assert.equal(spendFigure(live, { spend: 10, estimated: false }).spend, 32.7186);
  assert.equal(spendFigure({ cost_usd: 5, estimated_sessions: 1 }, null).estimated, true);
});

test('fallbackRate prices a dated or suffixed model id by its family; an unknown claude model takes the Opus rate', () => {
  const opus = FALLBACK_RATES['claude-opus-5-5'];
  const sonnet = FALLBACK_RATES['claude-sonnet-5-5'];
  assert.equal(fallbackRate('claude-sonnet-5-5'), sonnet);
  assert.equal(fallbackRate('claude-sonnet-5-5-20261001'), sonnet);
  assert.equal(fallbackRate('claude-opus-5-5[1m]'), opus);
  assert.equal(fallbackRate('claude-haiku-5-5'), opus);
  assert.equal(fallbackRate('gpt-5'), null);
  assert.equal(fallbackRate(undefined), null);
  // end to end: a suffixed-id stream is priced like its plain-id twin, not 0
  const dated = [JSON.stringify({ type: 'system', model: 'claude-opus-5-5' }), assistant('m1', 'claude-sonnet-5-5-20261001'), assistant('m2', 'claude-opus-5-5[1m]')].join('\n') + '\n';
  withTask(({ dir, task }) => {
    const c = collectTaskCosts(dir, task);
    assert.ok(Math.abs(c.cost_usd - mixed) < 1e-3, `${c.cost_usd} vs ${mixed}`);
  }, { stream: dated });
});

test('taskFigure / taskSpend / budgetStatus.spend read the latest durable event from the ledger', () => {
  const ledger = [
    { event: 'cost_recorded', spend: 99, estimated: true },
    { event: 'cost_recorded', spend: 47.2906, estimated: false },
  ];
  withTask(({ dir, task }) => {
    assert.equal(latestCostEvent(ledgerOf(dir)).spend, 47.2906);
    assert.equal(taskFigure(dir, task).spend, 47.2906);
    assert.equal(mod.taskSpend(task), 47.2906);
    assert.equal(mod.budgetStatus(task).spend, 47.2906);
    assert.equal(mod.budgetStatus(task).estimated, false);
  }, { stream: null, opts: { budget_usd: 100 }, ledger });
});

// F3-US-1 wiring: the daemon tick must reach enforceBudget for a size-S task, or the grace kill
// above never fires on a live run (QA-F3 repair: stepOnceInner returned before it).
async function daemonTickCase({ agoMin, graceUsd }) {
  const root = mkdtempSync(join(tmpdir(), 'budget-f3-tick-'));
  const was = process.env.HARNESS_TASKS_DIR;
  process.env.HARNESS_TASKS_DIR = root;
  process.env.TEAMS_RUNS_DIR ??= 'off';
  process.env.HARNESS_TEST_NO_DAEMON = '1';
  const driver = liveDriver();
  try {
    const daemon = await import('../mcp/daemon.mjs');
    const store = await import('../mcp/taskstate.mjs');
    const id = '0000aaaa-eeee-ffff-0000-222222222222';
    const dir = store.taskDir(id);
    mkdirSync(join(dir, 'drivers'), { recursive: true });
    const reportPath = join(dir, 'harness-report.md');
    writeFileSync(reportPath, '# harness report\n');
    writeFileSync(join(dir, 'drivers', 'S.stream.jsonl'), JSON.stringify({ type: 'result', total_cost_usd: 50, num_turns: 1, duration_ms: 1 }) + '\n');
    writeFileSync(store.taskPath(id), JSON.stringify({
      run_id: id, kind: 'task', store_path: store.taskPath(id), cwd: root, request: 'r', created_at: Date.now() - 3600000,
      flow: 'develop', size: 'S', max_retries: 2, driver_restarts: 2, base_ref: null, nodes: [],
      team: { opts: { budget_usd: 40, budget_grace_minutes: 5, budget_grace_usd: graceUsd } },
      harness_run: { cwd: root, opened_at: Date.now() - 3600000, report_path: reportPath, driver, run: null },
      budget_stopped: { at: Date.now() - agoMin * 60000, spend: 41, budget_usd: 40, skipped_packages: [] },
    }));
    for (let i = 0; i < 3; i++) await daemon.stepOnce(id);
    await new Promise((r) => setTimeout(r, 300));
    let alive = true;
    try { process.kill(driver.pid, 0); } catch { alive = false; }
    const killed = ledgerOf(dir).filter((e) => e.event === 'budget_killed' && e.pid === driver.pid).length;
    return { alive, killed, report: readFileSync(reportPath, 'utf8') };
  } finally {
    try { process.kill(-driver.pid, 'SIGKILL'); } catch {}
    if (was === undefined) delete process.env.HARNESS_TASKS_DIR; else process.env.HARNESS_TASKS_DIR = was;
    rmSync(root, { recursive: true, force: true });
  }
}

test('daemon tick: a size-S run past budget plus time grace has its driver killed and the report stays', async () => {
  const r = await daemonTickCase({ agoMin: 10, graceUsd: 1e9 });
  assert.equal(r.alive, false);
  assert.equal(r.killed, 1);
  assert.ok(r.report.length > 0);
});

test('daemon tick: a size-S run inside grace is not killed', async () => {
  const r = await daemonTickCase({ agoMin: 0, graceUsd: 1e9 });
  assert.equal(r.alive, true);
  assert.equal(r.killed, 0);
});

// ---------- a budget-stopped size-S run ends partial, not blocked, running or complete ----------

// withTask for a body that awaits (the driver's death is a signal, not a return value).
async function withTaskAsync(fn, { stream, opts = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'budget-s-end-'));
  const was = process.env.HARNESS_TASKS_DIR;
  process.env.HARNESS_TASKS_DIR = root;
  try {
    const dir = join(root, 'T1');
    mkdirSync(join(dir, 'drivers'), { recursive: true });
    if (stream) writeFileSync(join(dir, 'drivers', 'S.stream.jsonl'), stream);
    writeFileSync(join(dir, 'ledger.jsonl'), '');
    const task = { run_id: 'T1', cwd: root, nodes: [], created_at: Date.now() - 600000, team: { opts } };
    return await fn({ task, dir });
  } finally {
    if (was === undefined) delete process.env.HARNESS_TASKS_DIR; else process.env.HARNESS_TASKS_DIR = was;
    rmSync(root, { recursive: true, force: true });
  }
}
const until = async (cond, ms = 5000) => {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 50))) if (cond()) return true;
  return cond();
};
const gone = (pid) => { try { process.kill(pid, 0); return false; } catch { return true; } };
const over = JSON.stringify({ type: 'result', total_cost_usd: 2, num_turns: 1, duration_ms: 1 }) + '\n';
const killedEvents = (dir) => ledgerOf(dir).filter((e) => e.event === 'budget_killed' && e.node_id === 'S');

test('size-S spend crossing budget_usd: driver killed, task partial with a budget reason, report and ticket say so', async () => {
  await withTaskAsync(async ({ dir, task }) => {
    const driver = liveDriver();
    task.harness_run = { driver, cwd: dir, opened_at: Date.now() - 600000, run: null, report_path: join(dir, 'none.md') };
    try {
      mod.enforceBudget(task);
      const evs = ledgerOf(dir);
      assert.ok(evs.some((e) => e.event === 'budget_stopped' && e.spend === 2));
      const k = killedEvents(dir);
      assert.equal(k.length, 1);
      assert.equal(k[0].pid, driver.pid);
      assert.equal(k[0].killed_driver, true);
      assert.ok(k[0].reason && k[0].spend_at_kill === 2);
      assert.ok(await until(() => gone(driver.pid)), 'driver still alive');
      const st = facade.taskState(task);
      assert.equal(st.state, 'partial');
      assert.match(st.partial_reasons.join('\n'), /budget/);
      const report = renderHarnessReport(task);
      assert.match(report, /budget stopped/);
      assert.match(report, /PARTIAL/);
      assert.doesNotMatch(report, /restart budget|tm_retry/);
      assert.equal(epicTicketState(task), 'SETTLED');
    } finally {
      try { process.kill(-driver.pid, 'SIGKILL'); } catch {}
    }
  }, { stream: over, opts: { budget_usd: 1, budget_grace_minutes: 0 } });
});

test('size-S past grace with an exited pid, no driver, or a parked run: settled partial, one budget_killed killed_driver:false', async () => {
  const exited = spawn('true', [], { stdio: 'ignore' });
  await new Promise((r) => exited.on('exit', r));
  const cases = [
    { driver: { pid: exited.pid } },
    { driver: null },
    { driver: null, waiting_capacity: { reason: 'usage limit' } },
  ];
  for (const c of cases) {
    await withTaskAsync(async ({ dir, task }) => {
      task.harness_run = { ...c, cwd: dir, opened_at: Date.now() - 600000, run: null };
      mod.enforceBudget(task);
      mod.enforceBudget(task);
      assert.equal(task.budget_stopped.harness_killed, true);
      const k = killedEvents(dir);
      assert.equal(k.length, 1);
      assert.equal(k[0].killed_driver, false);
      assert.equal(k[0].pid, c.driver ? exited.pid : null);
      assert.equal(facade.taskState(task).state, 'partial');
    }, { stream: over, opts: { budget_usd: 1, budget_grace_minutes: 0 } });
  }
});

test('size-S run finished and accepted while harness_killed is set: still complete / DONE, report notes the stop', async () => {
  await withTaskAsync(async ({ dir, task }) => {
    const reportPath = join(dir, 'harness-report.md');
    writeFileSync(reportPath, '# harness report\n');
    const runDir = join(dir, 'run');
    mkdirSync(runDir);
    writeFileSync(join(runDir, 'manifest.json'), JSON.stringify({ teams_task: 'T1' }));
    writeFileSync(join(runDir, '04-goal-gate.json'), JSON.stringify({ pass: true, match_pct: 95 }));
    writeFileSync(join(runDir, '05-report.md'), '# done\n');
    task.harness_run = { driver: null, cwd: dir, opened_at: Date.now() - 600000, run: { route: 'fallback', run_dir: runDir }, report_path: reportPath };
    task.budget_stopped = { at: Date.now() - 600000, spend: 2, budget_usd: 1, harness_killed: true };
    assert.equal(facade.taskState(task).state, 'complete');
    assert.equal(epicTicketState(task), 'DONE');
    assert.match(renderHarnessReport(task), /budget_stopped fired at \$2\.00/);
  }, { opts: { budget_usd: 1 } });
});

// The daemon tick path past grace, polled instead of slept on (see daemonTickCase for the setup).
test('daemon tick: a size-S run past grace ends partial, with budget_killed in the ledger', async () => {
  const root = mkdtempSync(join(tmpdir(), 'budget-s-tick-'));
  const was = process.env.HARNESS_TASKS_DIR;
  process.env.HARNESS_TASKS_DIR = root;
  process.env.TEAMS_RUNS_DIR ??= 'off';
  process.env.HARNESS_TEST_NO_DAEMON = '1';
  const driver = liveDriver();
  try {
    const daemon = await import('../mcp/daemon.mjs');
    const store = await import('../mcp/taskstate.mjs');
    const id = '0000aaaa-eeee-ffff-0000-333333333333';
    const dir = store.taskDir(id);
    mkdirSync(join(dir, 'drivers'), { recursive: true });
    writeFileSync(join(dir, 'drivers', 'S.stream.jsonl'), over);
    writeFileSync(store.taskPath(id), JSON.stringify({
      run_id: id, kind: 'task', store_path: store.taskPath(id), cwd: root, request: 'r', created_at: Date.now() - 3600000,
      flow: 'develop', size: 'S', max_retries: 2, driver_restarts: 2, base_ref: null, nodes: [],
      team: { opts: { budget_usd: 1, budget_grace_minutes: 5, budget_grace_usd: 1e9 } },
      harness_run: { cwd: root, opened_at: Date.now() - 3600000, report_path: join(dir, 'none.md'), driver, run: null },
      budget_stopped: { at: Date.now() - 10 * 60000, spend: 1.5, budget_usd: 1, skipped_packages: [] },
    }));
    for (let i = 0; i < 3; i++) await daemon.stepOnce(id);
    assert.ok(await until(() => gone(driver.pid)), 'driver still alive');
    assert.equal(killedEvents(dir).length, 1);
    assert.equal(facade.taskState(JSON.parse(readFileSync(store.taskPath(id), 'utf8'))).state, 'partial');
  } finally {
    try { process.kill(-driver.pid, 'SIGKILL'); } catch {}
    if (was === undefined) delete process.env.HARNESS_TASKS_DIR; else process.env.HARNESS_TASKS_DIR = was;
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------- closeFailedPlanning: the deciding attempt (card 129, E-89982ed5) ----------
const pNode = (node_id, stage, subgoal_id, attempt, state, extra = {}) => ({
  node_id, stage, subgoal_id, attempt, deps: [], after: [], state, final: state === 'failed' || state === 'done', result: null, ...extra,
});
function closePlanning(task) {
  const root = mkdtempSync(join(tmpdir(), 'cfp-'));
  const was = process.env.HARNESS_TASKS_DIR;
  process.env.HARNESS_TASKS_DIR = root;
  try {
    const closed = mod.closeFailedPlanning(task);
    return { closed, skipped: task.nodes.filter((n) => n.state === 'skipped') };
  } finally {
    if (was === undefined) delete process.env.HARNESS_TASKS_DIR; else process.env.HARNESS_TASKS_DIR = was;
    rmSync(root, { recursive: true, force: true });
  }
}
const planTask = (nodes) => ({ run_id: 'cfp-test', nodes, planning_pkgs: [{ id: 'PLAN-F2' }] });

test('closeFailedPlanning names the deciding attempt: E-89982ed5 replay picks plan-integrate:3, not dispatch:PLAN-F2:2', () => {
  const task = planTask([
    pNode('dispatch:PLAN-F2:1', 'dispatch', 'PLAN-F2', 1, 'done'),
    pNode('accept:PLAN-F2:1', 'accept', 'PLAN-F2', 1, 'failed', { result: { reason: 'gaps' } }),
    pNode('dispatch:PLAN-F2:2', 'dispatch', 'PLAN-F2', 2, 'failed', { result: { reason: 'no retry left' } }),
    pNode('dispatch:PLAN-F2:3', 'dispatch', 'PLAN-F2', 3, 'done'),
    pNode('accept:PLAN-F2:3', 'accept', 'PLAN-F2', 3, 'done', { result: { match_pct: 92 } }),
    pNode('plan-integrate:3', 'plan-integrate', null, 3, 'failed', { result: { reason: 'integrate refused' } }),
    pNode('shape', 'shape', null, 1, 'unreachable', { final: false }),
  ]);
  const { closed, skipped } = closePlanning(task);
  assert.equal(closed, true);
  assert.equal(task.planning_failed.node_id, 'plan-integrate:3');
  assert.deepEqual(skipped.map((n) => n.node_id), ['shape']);
  assert.match(skipped[0].result.reason, /planning stopped at plan-integrate:3 with no retry left/);
  const w = unfinishedWork(task);
  assert.equal(w.partial, true);
  assert.ok(w.partial_reasons[0].startsWith('planning stopped at plan-integrate:3'));
  assert.ok(!w.partial_reasons.join('\n').includes('PLAN-F2:2'));
});

test('closeFailedPlanning control: a planning card whose last attempt failed final is still chosen', () => {
  const task = planTask([
    pNode('dispatch:PLAN-F2:1', 'dispatch', 'PLAN-F2', 1, 'failed', { result: { reason: 'first' } }),
    pNode('dispatch:PLAN-F2:2', 'dispatch', 'PLAN-F2', 2, 'failed', { result: { reason: 'second' } }),
    pNode('shape', 'shape', null, 1, 'unreachable', { final: false }),
  ]);
  assert.equal(closePlanning(task).closed, true);
  assert.equal(task.planning_failed.node_id, 'dispatch:PLAN-F2:2');
  assert.equal(task.planning_failed.reason, 'second');
});

test('closeFailedPlanning and unfinishedWork say rejected twice for the same gaps when the deciding node failed on a repeat', () => {
  const task = planTask([
    pNode('plan-integrate:1', 'plan-integrate', null, 1, 'failed', { result: { reason: 'r1' } }),
    pNode('plan-integrate:2', 'plan-integrate', null, 2, 'failed', {
      result: { reason: 'rejected twice for the same gaps: PLAN-F2: F2-US-1', failure_kind: 'repeated-identical-rejection' },
    }),
    pNode('shape', 'shape', null, 1, 'unreachable', { final: false }),
  ]);
  const { skipped } = closePlanning(task);
  assert.equal(task.planning_failed.node_id, 'plan-integrate:2');
  assert.equal(task.planning_failed.failure_kind, 'repeated-identical-rejection');
  assert.equal(skipped[0].result.reason, 'skipped: planning stopped at plan-integrate:2: rejected twice for the same gaps');
  assert.ok(unfinishedWork(task).partial_reasons[0].startsWith('planning stopped at plan-integrate:2: rejected twice for the same gaps: '));
  assert.ok(!skipped[0].result.reason.includes('no retry left'));
});
