#!/usr/bin/env node
// Card 130 F3-US-2: every pane and status spend number (tm_status, tm_board, the report briefing,
// the state server's cache that feeds the pane) is drivercost.mjs's taskFigure/spendFigure, the same
// function budgetStatus and the ledger read - so a larger exact durable cost_recorded event (its
// sessions and worktrees gone) shows in all of them, never only in the ledger.
//
//   node --test teams/scripts/test-spend-figure.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectDriverCosts, collectTaskCosts, taskFigure } from '../mcp/drivercost.mjs';
import { budgetStatus } from '../mcp/taskmanager-budget.mjs';
import { toolBoard, toolStatus } from '../mcp/taskmanager-handlers.mjs';
import { composeTaskPrompt } from '../mcp/taskmanager-prompts.mjs';
import { createTaskCache } from '../mcp/stateserver.mjs';

const LIVE = 12.34;
const DURABLE = 48.39;

// A task whose one live driver stream priced $12.34 while its ledger kept an exact $48.39 event.
function withFixture(fn) {
  const root = mkdtempSync(join(tmpdir(), 'spend-figure-'));
  const was = process.env.HARNESS_TASKS_DIR;
  process.env.HARNESS_TASKS_DIR = root;
  try {
    const dir = join(root, 'T1');
    mkdirSync(join(dir, 'drivers'), { recursive: true });
    writeFileSync(join(dir, 'drivers', 'S.stream.jsonl'), JSON.stringify({ type: 'result', total_cost_usd: LIVE, num_turns: 2, duration_ms: 1 }) + '\n');
    writeFileSync(join(dir, 'ledger.jsonl'), JSON.stringify({ ts: 1, event: 'cost_recorded', spend: DURABLE, estimated: false }) + '\n');
    const task = { run_id: 'T1', cwd: root, request: 'r', size: 'L', nodes: [], created_at: Date.now() - 600000, team: { opts: { budget_usd: 100 } } };
    writeFileSync(join(dir, 'task.json'), JSON.stringify(task));
    return fn({ root, dir, task });
  } finally {
    if (was === undefined) delete process.env.HARNESS_TASKS_DIR; else process.env.HARNESS_TASKS_DIR = was;
    rmSync(root, { recursive: true, force: true });
  }
}

test('the ledger and budget figure keeps the larger exact durable event over the live total', () => {
  withFixture(({ dir, task }) => {
    const figure = taskFigure(dir, task);
    assert.equal(collectTaskCosts(dir, task).cost_usd, LIVE);
    assert.equal(figure.spend, DURABLE);
    assert.equal(figure.from, 'durable');
    assert.equal(budgetStatus(task).spend, figure.spend);
    assert.ok(figure.spend > figure.live.cost_usd);
  });
});

test('tm_status and tm_board show taskFigure spend, not the live-only total', () => {
  withFixture(({ dir, task }) => {
    const spend = taskFigure(dir, task).spend;
    const status = toolStatus({ task_id: 'T1' });
    assert.equal(status.cost.usd, spend);
    assert.equal(status.cost.usd, budgetStatus(task).spend);
    assert.ok(status.cost.usd > LIVE);
    assert.equal(status.cost.sessions, 1, 'the per-driver breakdown still comes from the live reading');
    const board = toolBoard({ task_id: 'T1' });
    assert.equal(board.cost.usd, spend);
    assert.equal(board.cost.sessions, 1);
  });
});

test('the report briefing states taskFigure spend', () => {
  withFixture(({ dir, task }) => {
    const prompt = composeTaskPrompt(task, { stage: 'report', node_id: 'report' });
    assert.match(prompt, new RegExp(`Total across every session this task spawned: \\$${taskFigure(dir, task).spend.toFixed(2)} `));
    assert.doesNotMatch(prompt, new RegExp(`\\$${LIVE.toFixed(2)} \\(`));
  });
});

test('the pane model (state server cache -> view-collect) spends taskFigure spend', () => {
  withFixture(({ root, dir, task }) => {
    const m = createTaskCache().get(root, 'T1');
    assert.ok(m && !m.error, JSON.stringify(m && m.error));
    assert.equal(m.cost.usd, taskFigure(dir, task).spend);
    assert.equal(m.cost.usd, budgetStatus(task).spend);
    assert.ok(m.cost.usd > LIVE);
  });
});

// The recorded two-model S stream of E-2c7e6a24 (opus and sonnet, main and subagent messages,
// 14 result events: 11 at $5.5835, then 3 at $6.7512).
const FIXTURE = readFileSync(fileURLToPath(new URL('./fixtures/s-stream-two-models.jsonl', import.meta.url)), 'utf8').trim().split('\n');
const isResult = (l) => JSON.parse(l).type === 'result';
const firstResult = FIXTURE.findIndex(isResult);
const lastResults = FIXTURE.map((l, i) => (isResult(l) ? i : -1)).filter((i) => i >= 0).slice(-3);

function priceStream(lines) {
  const root = mkdtempSync(join(tmpdir(), 'spend-fixture-'));
  try {
    mkdirSync(join(root, 'T1', 'drivers'), { recursive: true });
    writeFileSync(join(root, 'T1', 'drivers', 'S.stream.jsonl'), lines.join('\n') + '\n');
    const c = collectDriverCosts(root);
    return { usd: c.cost_usd, estimated: c.streams[0].estimated === true };
  } finally { rmSync(root, { recursive: true, force: true }); }
}
const within = (got, want, pct) => assert.ok(Math.abs(got - want) / want <= pct, `${got} is not within ${pct * 100}% of ${want}`);

test('recorded S stream: a stream cut after a mid-stream result reads the exact result plus a priced tail, within 5% of the next exact total', () => {
  const r = priceStream(FIXTURE.slice(0, lastResults[0]));
  assert.equal(r.estimated, true);
  within(r.usd, 6.7512, 0.05);
  assert.ok(r.usd > 5.5835, 'the tail is added to the exact result');
});

test('recorded S stream: with every result removed the default S uplift lands within 5% of the final total', () => {
  const r = priceStream(FIXTURE.filter((l) => !isResult(l)));
  assert.equal(r.estimated, true);
  within(r.usd, 6.7512, 0.05);
});

test('recorded S stream: the lines before the first result land within 5% of that result', () => {
  const r = priceStream(FIXTURE.slice(0, firstResult));
  assert.equal(r.estimated, true);
  within(r.usd, 5.5835, 0.05);
});

test('recorded S stream: subagent messages are counted, each message id once', () => {
  const noResults = FIXTURE.filter((l) => !isResult(l));
  const main = noResults.filter((l) => !JSON.parse(l).parent_tool_use_id);
  assert.ok(priceStream(main).usd < priceStream(noResults).usd / 2);
  const doubled = noResults.concat(noResults.filter((l) => JSON.parse(l).type === 'assistant'));
  assert.equal(priceStream(doubled).usd, priceStream(noResults).usd);
});

test('recorded S stream: the full stream reads the exact total, not estimated', () => {
  const r = priceStream(FIXTURE);
  assert.equal(r.usd, 6.7512);
  assert.equal(r.estimated, false);
});

test('no pane or status source reads collectTaskCosts directly', () => {
  for (const f of ['stateserver.mjs', 'taskmanager-handlers.mjs', 'taskmanager-prompts.mjs']) {
    const src = readFileSync(fileURLToPath(new URL(`../mcp/${f}`, import.meta.url)), 'utf8');
    assert.doesNotMatch(src, /collectTaskCosts/, `${f} must take spend from taskFigure/spendFigure`);
  }
});
