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
import { collectTaskCosts, taskFigure } from '../mcp/drivercost.mjs';
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

test('no pane or status source reads collectTaskCosts directly', () => {
  for (const f of ['stateserver.mjs', 'taskmanager-handlers.mjs', 'taskmanager-prompts.mjs']) {
    const src = readFileSync(fileURLToPath(new URL(`../mcp/${f}`, import.meta.url)), 'utf8');
    assert.doesNotMatch(src, /collectTaskCosts/, `${f} must take spend from taskFigure/spendFigure`);
  }
});
