// graph.mjs is a facade over graph-<concern>.mjs: the 70 names its importers take from it still
// resolve, with the same typeof they had before the cut, and each is the module's own value.
// (Named test-graphfacade, not test-graph-*: that glob is one test file per graph-*.mjs module.)
//
//   node --test teams/scripts/test-graphfacade.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as graph from '../mcp/graph.mjs';

const MCP = join(dirname(fileURLToPath(import.meta.url)), '..', 'mcp');

// name -> [typeof, module that owns it]; the 70 exports graph.mjs had before the cut.
const EXPORTS = {
  STAGES: ['object', 'kinds'], KINDS: ['object', 'kinds'], kindSkills: ['function', 'kinds'], DEFAULT_KIND: ['string', 'kinds'],
  kindOf: ['function', 'kinds'], REASONING_STAGES: ['object', 'kinds'], VERDICT_FIELD: ['object', 'kinds'], reasonFromVerdict: ['function', 'kinds'],
  FLOWS: ['object', 'kinds'], DEFAULT_FLOW: ['string', 'kinds'], flowOf: ['function', 'kinds'], defaultKind: ['function', 'kinds'],
  normalizeSpec: ['function', 'kinds'], authorStage: ['function', 'kinds'], isAuthorNode: ['function', 'kinds'],
  applyHumanPin: ['function', 'pins'], releaseHumanPin: ['function', 'pins'], applyPinAction: ['function', 'pins'],
  applyStoryPin: ['function', 'pins'], currentAttempt: ['function', 'pins'], nodeKind: ['function', 'pins'],
  queueHumanAction: ['function', 'runfile'], peekHumanActions: ['function', 'runfile'], drainHumanActions: ['function', 'runfile'],
  pathOf: ['function', 'runfile'], saveRun: ['function', 'runfile'], loadRunAt: ['function', 'runfile'], loadRun: ['function', 'runfile'],
  findRun: ['function', 'runfile'], listRuns: ['function', 'runfile'],
  node: ['function', 'nodes'], createRun: ['function', 'nodes'], stagePolicy: ['function', 'nodes'], getNode: ['function', 'nodes'],
  DOCUMENT_ONLY_KINDS: ['object', 'nodes'], validateSpec: ['function', 'nodes'], nextIndex: ['function', 'nodes'], pushChain: ['function', 'nodes'],
  goalRoundOf: ['function', 'goalgate'], goalGateSiblings: ['function', 'goalgate'], nextGoalRound: ['function', 'goalgate'],
  pushGoalGateRound: ['function', 'goalgate'], goalConsensus: ['function', 'goalgate'], nextRepairIndex: ['function', 'goalgate'],
  openRepair: ['function', 'goalgate'],
  answeredDecisions: ['function', 'decisions'], chosenOf: ['function', 'decisions'], normalizeDecision: ['function', 'decisions'],
  appendDecisions: ['function', 'decisions'], planDecisions: ['function', 'decisions'], settledDecisions: ['function', 'decisions'],
  routeExecutionQuestions: ['function', 'decisions'], openAsk: ['function', 'decisions'],
  expandSubgoals: ['function', 'expand'], computeWriteScope: ['function', 'expand'],
  settleFailure: ['function', 'retry'], retryReport: ['function', 'retry'], retrySubgoal: ['function', 'retry'], retrySpec: ['function', 'retry'],
  unmetDeps: ['function', 'ready'], readyNodes: ['function', 'ready'], promoteWaitingHuman: ['function', 'ready'],
  HUMAN_GATE_VERDICT_FIELD: ['object', 'humangate'], humanGateIdentity: ['function', 'humangate'], humanGateVerdictField: ['function', 'humangate'],
  autoPassHumanGateResult: ['function', 'humangate'], promoteHumanGates: ['function', 'humangate'], humanGateResultFromPayload: ['function', 'humangate'],
  runState: ['function', 'state'], nodeBriefing: ['function', 'state'],
};

test('graph.mjs still exports exactly the 70 names it had, with the same typeof', () => {
  assert.equal(Object.keys(EXPORTS).length, 70);
  assert.deepEqual(Object.keys(graph).sort(), Object.keys(EXPORTS).sort());
  for (const [name, [type]] of Object.entries(EXPORTS)) assert.equal(typeof graph[name], type, name);
});

test('every name is the very value its graph-<concern>.mjs module exports', async () => {
  const mods = {};
  for (const [name, [, concern]] of Object.entries(EXPORTS)) {
    mods[concern] ||= await import(`../mcp/graph-${concern}.mjs`);
    assert.strictEqual(graph[name], mods[concern][name], `${name} from graph-${concern}.mjs`);
  }
});

test('the modules are exactly the ones the facade names, each under 1,500 lines, with its own test file', () => {
  const concerns = [...new Set(Object.values(EXPORTS).map(([, c]) => c))].sort();
  const files = readdirSync(MCP).filter((f) => /^graph-.*\.mjs$/.test(f)).map((f) => f.slice(6, -4)).sort();
  assert.deepEqual(files, concerns);
  for (const c of concerns) {
    const lines = readFileSync(join(MCP, `graph-${c}.mjs`), 'utf8').split('\n').length;
    assert.ok(lines < 1500, `graph-${c}.mjs is ${lines} lines`);
    assert.ok(readdirSync(dirname(fileURLToPath(import.meta.url))).includes(`test-graph-${c}.mjs`), `test-graph-${c}.mjs exists`);
  }
});

test('graph.mjs holds only comments, imports and re-exports - no logic', () => {
  const body = readFileSync(join(MCP, 'graph.mjs'), 'utf8').replace(/^\/\/.*$/gm, '').replace(/export\s*\{[^}]*\}\s*from\s*'[^']+';/g, '');
  assert.equal(body.trim(), '');
});

test('the graph-<concern> modules import each other without a cycle', () => {
  const concerns = Object.values(EXPORTS).map(([, c]) => c);
  const deps = {};
  for (const c of new Set(concerns)) {
    const src = readFileSync(join(MCP, `graph-${c}.mjs`), 'utf8');
    deps[c] = [...src.matchAll(/from '\.\/graph-([a-z]+)\.mjs'/g)].map((m) => m[1]);
  }
  const state = {};
  const visit = (c, path) => {
    assert.notEqual(state[c], 'open', `cycle: ${[...path, c].join(' -> ')}`);
    if (state[c] === 'done') return;
    state[c] = 'open';
    for (const d of deps[c]) visit(d, [...path, c]);
    state[c] = 'done';
  };
  for (const c of Object.keys(deps)) visit(c, []);
});
