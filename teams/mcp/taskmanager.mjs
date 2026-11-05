#!/usr/bin/env node
// task-manager - local stdio MCP server for requests too large for one graph run.
//
// A graph run is bound to one working directory and one spec. A medium or large request
// spans modules, worktrees, sometimes repositories: it has to be split into packages, each
// run as its own graph in its own worktree, then integrated and judged as a whole. That is
// this server's job, and only that:
//
//   size -> areas -> [dispatch -> accept] per planning card -> plan-integrate -> shape -> critique
//     -> [dispatch -> accept] per package -> integrate -> [dispatch -> accept] per QA card
//     -> gate:goal -> report
//
// (_repo/docs/plans/2026-09-28-teams-cards-everywhere.md: every phase runs on cards. `areas` is the
// EPIC's plan stage - it splits the request by FEATURE into planning cards PLAN-F1, PLAN-F2, ...;
// plan-integrate merges their PRD sections into one 10-prd.md and judges it; shape splits the
// merged user stories again, by OWNERSHIP, into develop cards; QA runs one card per feature area.)
//
// Three rules keep it small:
//
//   1. It reuses graph.mjs as a library - nodes, typed edges, readiness, retries, settled
//      failure - and adds no second DAG. Its own stage names are the only thing new.
//   2. It READS child run files and never writes them. The graph broker is the one writer
//      of a run file; a second writer is the race mergeOnto exists to paper over. A human's pin
//      (tm_assign) or card answer (tm_submit({key})) is an exception that proves the rule, not a
//      hole in it: both preview their effect against a read-only loadRun (applyPinAction /
//      broker.mjs's computeSubmitResult - the SAME functions the broker itself applies for real)
//      and then queueHumanAction the actual instruction - graph.mjs's own handoff, drained by
//      the broker's mustFindRun the next time anything touches the run. 0.27.3 broke rule 2
//      here, loadRun+saveRun'ing the child directly from this process (2026-09-24 review, against
//      this header and design §7's "changed_files는 워크트리 대조로 똑같이 검증" - a human's
//      report was taken at face value, with no cross-check at all).
//   3. It does not call the graph broker over MCP. There is no server-to-server JSON-RPC channel,
//      and the driving session is already the relay: `tm_next` hands back a child pointer
//      {cwd, run_id}, the session drives the child with team_next/team_run/team_submit,
//      and calls `tm_submit` on the dispatch node when the child's report is done. Importing
//      broker.mjs as a library for computeSubmitResult (below) is not that channel - it is a
//      pure, read-only function call, made possible only because broker.mjs is import-safe
//      (isEntryPoint guards its stdio loop the same way this file's own `isMain` does).
//
// The child run is opened HERE, by the server, on a dispatch node - never by a model inside
// a node. The "do not re-enter the harness" rule in every node prompt stays true.
//
// State lives under ~/.harness/tasks/<task_id>/ (HARNESS_TASKS_DIR overrides), never under a
// project cwd: a task's packages live in several worktrees and belong to none of them.
// Zero dependencies: MCP's stdio transport is newline-delimited JSON-RPC 2.0.

import { isEntryPoint } from './pluginroots.mjs';
import { TOOLS, callTool } from './taskmanager-tools.mjs';

// Light PLAN mode (_repo/docs/plans/2026-09-28-teams-light-plan.md): the structural "is acceptance
// already declared?" check and the roles.planning resolution it drives. Re-exported so a caller
// that already imports this module can reach the one detection function by name.
export { hasDeclaredAcceptance } from './acceptance.mjs';
// Moved to leaf modules (taskstate.mjs, stagecontract.mjs, tickets.mjs); re-exported so every
// caller that imports them from here keeps working.
export { tasksRoot, taskDir, taskPath, record, driverAlive, unfinishedWork, resolveHarnessRun } from './taskstate.mjs';
export { STAGE_SKILLS, CONTRACT } from './stagecontract.mjs';
export { storyId, storyLabel } from './tickets.mjs';

export { autoPackageDiagram, repairGroups, mendDiagram, sharedSizeSLive, mustFindTask } from './taskmanager-stages.mjs';
export { validateAreas, storyDuplicates, preparePlanIntegration, validateShape, shapeAnalysis, qaCards } from './taskmanager-plan.mjs';
export { reintegrateExhausted, autoReshape, autoRetryPackages, clearCapacity, capacityResetAt, autoResumeCapacity, pendingRejudgeAt, autoRejudge, autoRepair, settleQaRound, reproGate } from './taskmanager-repair.mjs';
export { noDriver, harnessPathsUnder, commitWorktree, packageOf, findGoneWorktree, worktreeGoneStop } from './taskmanager-worktree.mjs';
export { critiqueNotesFor, briefingPath, writeManagerBriefing, composeTaskPrompt } from './taskmanager-prompts.mjs';
export { openerEnv, driverArgv, driverStderrTail, driverRestartsSpent, serviceDeadDriver, serviceStalledDriver, noDaemon, startKeepAwake, managerState, taskState, serviceDaemon } from './taskmanager-drivers.mjs';
export { openChild, dispatchSettled, serviceSRun, foldChild, prepareIntegration, runPackageTests, foldPackageHistory } from './taskmanager-children.mjs';
export { succeeded, scopeGaps, __baseFail, recordBaseExclusions, excludeBaseBeforeJudge, finish } from './taskmanager-finish.mjs';
export { callTool } from './taskmanager-tools.mjs';
export { prdStories, stripDocumentAcceptance, missingPrdSections, syncTickets, appendBoardTransitions, requireRunnable, delegateIfSmall } from './taskmanager-handlers.mjs';
export { openHarnessRun, scopePathsFromRun, ownWritesPath, readOwnWrites, computeScopeVerdict, terminalBlocked, serviceHarnessRun } from './taskmanager-harness.mjs';
export { taskSpend, taskElapsedMinutes, budgetStatus, closeFailedPlanning, enforceBudget, ensureAutoParallel, updateAutoParallel } from './taskmanager-budget.mjs';
export { __storeHooks, liveClaim, claimNode, applyClaim, readyToJudge, refreshTask, advanceDispatches, serviceRunningDispatches, prepareReadyIntegrations, foldDispatch, promoteManagerHumanGates } from './taskmanager-claims.mjs';
export { storyAsksOf, claimableStoryAsks, claimStoryAsk, settleStoryAsk, nextAskDeadline, expireAsks } from './taskmanager-asks.mjs';

const SERVER = { name: 'task-manager', version: '0.7.0' };
const DEFAULT_PROTOCOL = '2025-06-18';

function emit(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

async function handle(msg) {
  const { id, method, params } = msg;
  const reply = (result) => ({ jsonrpc: '2.0', id, result });
  switch (method) {
    case 'initialize':
      return reply({
        protocolVersion: params && typeof params.protocolVersion === 'string' ? params.protocolVersion : DEFAULT_PROTOCOL,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER,
      });
    case 'ping': return reply({});
    case 'tools/list': return reply({ tools: TOOLS });
    case 'tools/call': {
      try {
        const out = await callTool(params && params.name, params && params.arguments);
        return reply({ content: [{ type: 'text', text: JSON.stringify(out, null, 2) }], structuredContent: out, isError: false });
      } catch (e) {
        return reply({ content: [{ type: 'text', text: String((e && e.message) || e) }], isError: true });
      }
    }
    default:
      if (typeof id === 'undefined') return null;
      return { jsonrpc: '2.0', id, error: { code: -32601, message: 'method not found: ' + method } };
  }
}

// Only run the stdio server when this file is the process entry point. daemon.mjs imports this
// module as a plain library - advanceDispatches, finish, foldChild, and the rest of the exports
// above - to drive a task's graph directly, without a JSON-RPC layer in between. Its own stdin is
// closed (spawnDaemon's stdio: ['ignore', ...]), and an ignored stream emits 'end' as soon as
// Node looks at it - so without this guard, importing taskmanager.mjs would call process.exit(0)
// on the daemon within its first tick, before it ever read the task it was told to drive.
//
// isEntryPoint (pluginroots.mjs) realpath-resolves both sides of the comparison rather than
// comparing raw strings - a symlinked plugin path (macOS's $TMPDIR -> /private/var, or an
// installed-marketplace layout) must still count as "this file is argv[1]" when it names the
// same real file. The raw-string version of this guard shipped in 3c5ad0c8 and exited silently,
// starting nothing, the first time a real path actually went through a symlink.
const isMain = isEntryPoint(import.meta.url);

if (isMain) {
  let buf = '';
  // handle() is async (tools/call can now await callTool -> dispatch -> tm_open/tm_run's own
  // await on ensureViewer). Chaining each line onto `queue` keeps replies in the same order
  // requests arrived - the same guarantee the old fully-synchronous loop gave for free - instead
  // of however their individual promises happen to settle.
  let queue = Promise.resolve();
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      queue = queue.then(async () => {
        let msg;
        try { msg = JSON.parse(line); } catch { return; }
        let out;
        try { out = await handle(msg); } catch (e) {
          out = typeof msg.id === 'undefined' ? null : { jsonrpc: '2.0', id: msg.id, error: { code: -32603, message: String((e && e.message) || e) } };
        }
        if (out) emit(out);
      });
    }
  });
  process.stdin.on('end', () => { queue.then(() => process.exit(0)); });
}
