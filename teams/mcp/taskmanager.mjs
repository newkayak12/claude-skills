#!/usr/bin/env node
// taskmanager - the tm_* tools, for requests too large for one graph run.
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
//      pure, read-only function call, made possible only because broker.mjs binds no stdin.
//
// The child run is opened HERE, by the server, on a dispatch node - never by a model inside
// a node. The "do not re-enter the harness" rule in every node prompt stays true.
//
// State lives under ~/.harness/tasks/<task_id>/ (HARNESS_TASKS_DIR overrides), never under a
// project cwd: a task's packages live in several worktrees and belong to none of them.
// A library: served over stdio by server.mjs (the one teams MCP server), imported directly by
// daemon.mjs. It binds no stdin.

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

