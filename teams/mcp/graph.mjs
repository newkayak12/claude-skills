// graph.mjs - the harness flow as a persisted node graph.
//
// The broker owns WHICH nodes exist, in what order, and who may execute each one.
// It does not own what happens inside a node - that is the model's job, whichever
// vendor gets assigned. Splitting it this way is the point: the flow stops being
// something each orchestrator re-improvises in prose and becomes state on disk that
// survives a restart and can be read by a hook.
//
// Runs live at <cwd>/.teams_output/broker/runs/<run_id>.json.
//
// This file is the facade: it holds no logic, only the names every importer (broker.mjs,
// taskmanager.mjs, tickets.mjs, the tests ...) has always taken from './graph.mjs'. The code
// lives in graph-<concern>.mjs, cut along the section headers this file used to carry:
//
//   graph-kinds.mjs      stages, kinds, flows, spec normalisation, author stage
//   graph-pins.mjs       the human pin on a subgoal's author node
//   graph-runfile.mjs    run files on disk, locking, merge, the human-action handoff queue
//   graph-nodes.mjs      node(), createRun, stage policy, spec validation, chain wiring
//   graph-goalgate.mjs   goal-gate rounds, consensus, repair
//   graph-decisions.mjs  answered/settled decisions, openAsk
//   graph-expand.mjs     expandSubgoals, computeWriteScope
//   graph-retry.mjs      settleFailure, retryReport / retrySubgoal / retrySpec
//   graph-ready.mjs      unmetDeps, readyNodes, promoteWaitingHuman
//   graph-humangate.mjs  gate:human
//   graph-state.mjs      runState, nodeBriefing

export {
  STAGES, KINDS, kindSkills, DEFAULT_KIND, kindOf, REASONING_STAGES, VERDICT_FIELD, reasonFromVerdict,
  FLOWS, DEFAULT_FLOW, flowOf, defaultKind, normalizeSpec, authorStage, isAuthorNode,
} from './graph-kinds.mjs';

export {
  applyHumanPin, releaseHumanPin, applyPinAction, applyStoryPin, currentAttempt, nodeKind,
} from './graph-pins.mjs';

export {
  queueHumanAction, peekHumanActions, drainHumanActions, pathOf, saveRun, loadRunAt, loadRun, findRun, listRuns,
} from './graph-runfile.mjs';

export {
  node, createRun, stagePolicy, getNode, DOCUMENT_ONLY_KINDS, validateSpec, nextIndex, pushChain,
} from './graph-nodes.mjs';

export {
  goalRoundOf, goalGateSiblings, nextGoalRound, pushGoalGateRound, goalConsensus, nextRepairIndex, openRepair,
} from './graph-goalgate.mjs';

export {
  answeredDecisions, chosenOf, normalizeDecision, appendDecisions, planDecisions, settledDecisions,
  routeExecutionQuestions, openAsk,
} from './graph-decisions.mjs';

export { expandSubgoals, computeWriteScope } from './graph-expand.mjs';

export { settleFailure, retryReport, retrySubgoal, retrySpec } from './graph-retry.mjs';

export { unmetDeps, readyNodes, promoteWaitingHuman } from './graph-ready.mjs';

export {
  HUMAN_GATE_VERDICT_FIELD, humanGateIdentity, humanGateVerdictField, autoPassHumanGateResult,
  promoteHumanGates, humanGateResultFromPayload,
} from './graph-humangate.mjs';

export { runState, nodeBriefing } from './graph-state.mjs';
