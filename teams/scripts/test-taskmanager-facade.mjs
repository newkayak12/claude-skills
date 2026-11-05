#!/usr/bin/env node
// taskmanager.mjs is the MCP entry over taskmanager-*.mjs: every name it exported before the cut
// (107 at 0778a782: 12 re-exported from leaf modules, 95 declared in the file) still resolves, and
// importing it binds no stdin loop.
//
//   node --test teams/scripts/test-taskmanager-facade.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as facade from '../mcp/taskmanager.mjs';
import * as finishMod from '../mcp/taskmanager-finish.mjs';
import * as claimsMod from '../mcp/taskmanager-claims.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const MCP = join(HERE, '..', 'mcp');

// Every export taskmanager.mjs had before the cut (recorded from the pre-change file).
const RECORDED = [
  'hasDeclaredAcceptance', 'tasksRoot', 'taskDir', 'taskPath', 'record', 'driverAlive',
  'unfinishedWork', 'resolveHarnessRun', 'STAGE_SKILLS', 'CONTRACT', 'storyId', 'storyLabel',
  'autoPackageDiagram', 'repairGroups', 'mendDiagram', 'sharedSizeSLive', 'mustFindTask',
  'validateAreas', 'storyDuplicates', 'preparePlanIntegration', 'validateShape', 'shapeAnalysis',
  'qaCards', 'reintegrateExhausted', 'autoReshape', 'autoRetryPackages', 'clearCapacity',
  'capacityResetAt', 'autoResumeCapacity', 'pendingRejudgeAt', 'autoRejudge', 'autoRepair',
  'settleQaRound', 'reproGate', 'noDriver', 'harnessPathsUnder', 'commitWorktree', 'packageOf',
  'findGoneWorktree', 'worktreeGoneStop', 'critiqueNotesFor', 'openerEnv', 'driverArgv',
  'driverStderrTail', 'driverRestartsSpent', 'serviceDeadDriver', 'serviceStalledDriver', 'noDaemon',
  'startKeepAwake', 'managerState', 'taskState', 'serviceDaemon', 'openChild', 'dispatchSettled',
  'serviceSRun', 'foldChild', 'prepareIntegration', 'runPackageTests', 'foldPackageHistory',
  'briefingPath', 'writeManagerBriefing', 'composeTaskPrompt', 'succeeded', 'scopeGaps', '__baseFail',
  'recordBaseExclusions', 'excludeBaseBeforeJudge', 'finish', 'prdStories', 'stripDocumentAcceptance',
  'missingPrdSections', 'syncTickets', 'appendBoardTransitions', 'requireRunnable', 'delegateIfSmall',
  'openHarnessRun', 'scopePathsFromRun', 'ownWritesPath', 'readOwnWrites', 'computeScopeVerdict',
  'terminalBlocked', 'serviceHarnessRun', 'taskSpend', 'taskElapsedMinutes', 'budgetStatus',
  'closeFailedPlanning', 'enforceBudget', 'ensureAutoParallel', 'updateAutoParallel', '__storeHooks',
  'liveClaim', 'claimNode', 'applyClaim', 'readyToJudge', 'refreshTask', 'advanceDispatches',
  'serviceRunningDispatches', 'prepareReadyIntegrations', 'foldDispatch', 'promoteManagerHumanGates',
  'storyAsksOf', 'claimableStoryAsks', 'claimStoryAsk', 'settleStoryAsk', 'nextAskDeadline',
  'expireAsks', 'callTool',
];

test('the recorded list holds the 107 names taskmanager.mjs exported before the cut', () => {
  assert.equal(RECORDED.length, 107);
  assert.equal(new Set(RECORDED).size, 107);
});

test('every recorded taskmanager.mjs export still resolves', () => {
  for (const name of RECORDED) {
    assert.notEqual(facade[name], undefined, `${name} no longer resolves from taskmanager.mjs`);
  }
});

test('taskmanager.mjs exports exactly the recorded names: none missing, no sibling-internal leaked', () => {
  assert.deepEqual(Object.keys(facade).sort(), [...RECORDED].sort());
});

const MODULES = ['stages', 'plan', 'repair', 'worktree', 'prompts', 'drivers', 'children', 'finish', 'tools', 'handlers', 'harness', 'budget', 'claims', 'asks'];

test('no taskmanager-*.mjs imports ./taskmanager.mjs', () => {
  for (const f of readdirSync(MCP).filter((x) => /^taskmanager-.+\.mjs$/.test(x))) {
    assert.ok(!/from '\.\/taskmanager\.mjs'/.test(readFileSync(join(MCP, f), 'utf8')), `${f} imports the facade`);
  }
});

test('the facade declares no function', () => {
  const text = readFileSync(join(MCP, 'taskmanager.mjs'), 'utf8');
  const names = [...text.matchAll(/^(?:export\s+)?(?:async\s+)?function\*?\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]).sort();
  assert.deepEqual(names, []);
});

test('every teams/mcp/*.mjs is under 1,500 lines', () => {
  for (const f of readdirSync(MCP).filter((x) => x.endsWith('.mjs'))) {
    const lines = readFileSync(join(MCP, f), 'utf8').split('\n').length - 1;
    assert.ok(lines < 1500, `${f} has ${lines} lines`);
  }
});

test('each of the 14 modules exists with its own test file', () => {
  for (const c of MODULES) {
    assert.ok(existsSync(join(MCP, `taskmanager-${c}.mjs`)), `taskmanager-${c}.mjs is missing`);
    assert.ok(existsSync(join(HERE, `test-taskmanager-${c}.mjs`)), `test-taskmanager-${c}.mjs is missing`);
  }
});

test('the two mutable state objects are the same objects tests and code reach through the facade', () => {
  assert.equal(typeof facade.__baseFail, 'object');
  assert.ok('run' in facade.__baseFail);
  assert.equal(typeof facade.__storeHooks, 'object');
  assert.equal(facade.__baseFail, finishMod.__baseFail);
  assert.equal(facade.__storeHooks, claimsMod.__storeHooks);
});

test('importing taskmanager.mjs binds no stdin loop: a child that only imports it exits by itself, silent', () => {
  const r = spawnSync(process.execPath, ['-e', `import(${JSON.stringify(pathToFileURL(join(MCP, 'taskmanager.mjs')).href)})`], {
    input: '', encoding: 'utf8', timeout: 20000,
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, '');
});
