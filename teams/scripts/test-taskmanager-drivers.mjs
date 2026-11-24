#!/usr/bin/env node
// taskmanager-drivers.mjs owns the child driver and daemon processes; taskmanager.mjs
// re-exports its public names unchanged.
//
//   node --test teams/scripts/test-taskmanager-drivers.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as facade from '../mcp/taskmanager.mjs';
import * as mod from '../mcp/taskmanager-drivers.mjs';
import { STAGE_TOOLS } from '../mcp/server-tools.mjs';

const OWNED = [
  'openerEnv', 'driverArgv', 'driverStderrTail', 'driverRestartsSpent', 'serviceDeadDriver',
  'serviceStalledDriver', 'noDaemon', 'startKeepAwake', 'managerState', 'taskState', 'serviceDaemon',
];

test('every public name taskmanager-drivers.mjs owns is the facade\'s own binding', () => {
  for (const name of OWNED) {
    assert.equal(typeof mod[name], 'function', `${name} is not exported by taskmanager-drivers.mjs`);
    assert.equal(facade[name], mod[name], `${name} on the facade is not the module's binding`);
  }
});

test('openerEnv carries the opener session and task id, or nothing', () => {
  assert.deepEqual(mod.openerEnv(null), {});
  assert.deepEqual(mod.openerEnv({ opener: { session_id: 'S' }, run_id: 'T1' }), { TEAMS_OPENER_SESSION_ID: 'S', TEAMS_TASK_ID: 'T1' });
});

test('driverArgv: HARNESS_CHILD_DRIVER replaces the command line; otherwise it is claude -p stream-json', () => {
  const was = process.env.HARNESS_CHILD_DRIVER;
  try {
    process.env.HARNESS_CHILD_DRIVER = 'my driver --flag';
    assert.deepEqual(mod.driverArgv(null, {}), ['my', 'driver', '--flag']);
    process.env.HARNESS_CHILD_DRIVER = '';
    assert.deepEqual(mod.driverArgv(null, {}).slice(0, 8), [
      'claude', '-p', '--output-format', 'stream-json', '--verbose', '--dangerously-skip-permissions', '--setting-sources', 'project',
    ]);
  } finally {
    if (was === undefined) delete process.env.HARNESS_CHILD_DRIVER; else process.env.HARNESS_CHILD_DRIVER = was;
  }
});

test('card 126: the package driver skips permissions, runs --stage driver, and that set lists the bus tools', () => {
  const was = process.env.HARNESS_CHILD_DRIVER;
  try {
    delete process.env.HARNESS_CHILD_DRIVER;
    const argv = mod.driverArgv(null, { flow: 'develop' });
    assert.ok(argv.includes('--dangerously-skip-permissions'), 'every tool, MCP included, is granted');
    const cfg = JSON.parse(argv[argv.indexOf('--mcp-config') + 1]);
    const args = cfg.mcpServers.teams.args;
    assert.equal(args[args.indexOf('--stage') + 1], 'driver');
    for (const t of ['tm_ask', 'tm_post', 'tm_read']) assert.ok(STAGE_TOOLS.driver.includes(t), `${t} missing from the driver set`);
  } finally {
    if (was === undefined) delete process.env.HARNESS_CHILD_DRIVER; else process.env.HARNESS_CHILD_DRIVER = was;
  }
});
