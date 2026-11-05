#!/usr/bin/env node
// taskmanager-repair.mjs owns repair, defect STORYs, upstream defects and the audit phase-Team;
// taskmanager.mjs re-exports its public names unchanged.
//
//   node --test teams/scripts/test-taskmanager-repair.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as facade from '../mcp/taskmanager.mjs';
import * as mod from '../mcp/taskmanager-repair.mjs';

const OWNED = [
  'reintegrateExhausted', 'autoReshape', 'autoRetryPackages', 'clearCapacity', 'capacityResetAt',
  'autoResumeCapacity', 'pendingRejudgeAt', 'autoRejudge', 'autoRepair', 'settleQaRound', 'reproGate',
];

test('every public name taskmanager-repair.mjs owns is the facade\'s own binding', () => {
  for (const name of OWNED) {
    assert.equal(typeof mod[name], 'function', `${name} is not exported by taskmanager-repair.mjs`);
    assert.equal(facade[name], mod[name], `${name} on the facade is not the module's binding`);
  }
});

test('capacityResetAt: an unparseable reason falls back to since + 30 minutes', () => {
  assert.equal(mod.capacityResetAt('nothing here', 1000), 1000 + 30 * 60 * 1000);
});

test('capacityResetAt: "resets 5:40pm (UTC)" is the first 17:40 UTC after since', () => {
  const since = Date.UTC(2026, 0, 1, 12, 0);
  assert.equal(mod.capacityResetAt('You\'ve hit your limit · resets 5:40pm (UTC)', since), Date.UTC(2026, 0, 1, 17, 40));
});
