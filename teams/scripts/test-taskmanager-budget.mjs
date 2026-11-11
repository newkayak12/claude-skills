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
