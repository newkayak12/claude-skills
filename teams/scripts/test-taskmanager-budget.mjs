#!/usr/bin/env node
// taskmanager-budget.mjs owns the budget / timebox and the max_parallel_teams AIMD controller;
// taskmanager.mjs re-exports its public names unchanged.
//
//   node --test teams/scripts/test-taskmanager-budget.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as facade from '../mcp/taskmanager.mjs';
import * as mod from '../mcp/taskmanager-budget.mjs';

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
