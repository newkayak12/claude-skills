// graph-humangate.mjs - gate:human, a person's accept/reject over a judging stage (cut from graph.mjs).
//
// Which nodes `human_gates` names, what a person's answer looks like once it lands on the node,
// and the non-interactive auto-pass. Builds on verdictfields.mjs (HUMAN_GATE_VERDICT_FIELD) and
// graph-ready.mjs (unmetDeps).

import { HUMAN_GATE_VERDICT_FIELD } from './verdictfields.mjs';
import { unmetDeps } from './graph-ready.mjs';

// gate:human (D2 Task 4, _repo/docs/plans/2026-09-23-teams-reducer-human-rollback.md §1): a
// configurable human approval gate over a judging stage, set with the team option
// `human_gates: ['critique', 'gate', 'gate:goal', ...]` (run.human_gates, threaded the same way
// run.interactive is - teamconfig.mjs, task.child_opts, createRun). Only a VERDICT-bearing
// judging stage can be gated this way - one whose contract already reduces to a single
// accept/reject boolean the engine can act on (HUMAN_GATE_VERDICT_FIELD below); an authoring
// stage (implement, draft, shape's own package proposal) has no such field and is left alone
// even if named in human_gates by mistake.
//
// A gated node never reaches a driver: the human's own accept/reject IS the node's result,
// submitted through the exact same tm_submit({key, payload}) path a pinned author stage uses,
// so every downstream hook that already reads a stage's result (autoReassign's retry, shape's
// expandPackages, a package's own accept feeding the manager) keeps working unmodified - a
// human's verdict and a model's verdict are the same shape once they land on the node.
// The map lives in verdictfields.mjs; this is its humanGate view.
export { HUMAN_GATE_VERDICT_FIELD };

// gate:goal is `stage: 'gate'` with `subgoal_id: null` on both the child-run graph
// (expandSubgoals' pushGoalGateRound) and the manager graph (taskmanager.mjs's own
// pushGoalGateRound) - composeTaskPrompt already tells the two apart this same way (by
// node_id prefix, not by stage) to pick the right CONTRACT text, so this reuses that test
// rather than inventing a second one.
export function humanGateIdentity(n) {
  return n.node_id.startsWith('gate:goal') ? 'gate:goal' : n.stage;
}

export function humanGateVerdictField(n) {
  return humanGateIdentity(n) === 'gate:goal' ? 'accept' : (HUMAN_GATE_VERDICT_FIELD[n.stage] || null);
}

// The default result for a human_gates node when nobody is watching (run.interactive is
// false): auto-pass, recorded as decided-for-you rather than left to block a run nobody can
// unblock. Mirrors applyHumanPin's own non-interactive default (dispatch instead of park) in
// spirit, but a gate has no AI fallback to dispatch to - the whole point of naming a stage in
// human_gates is that a person, not a model, judges it - so the only non-blocking default is
// to pass it, exactly as an ungated run would if nobody had configured a gate here at all.
export function autoPassHumanGateResult(n) {
  const field = humanGateVerdictField(n);
  return {
    stage_ok: true,
    ...(field ? { [field]: true } : {}),
    // match_pct/attacks only matter to a 'gate'/'gate:goal' node (nodeSucceeded's own floor and
    // no-attacks-no-pass checks, broker.mjs) - harmless extra fields on critique/accept/integrate.
    ...(field === 'accept' ? { match_pct: 100, attacks: ['gate:human: not interactive, auto-passed - no invocation was made'] } : {}),
    checks: ['human_gates named this stage but the run is not interactive - auto-passed'],
    gaps: [],
    reason: 'auto-passed (decided for you, not interactive)',
    evidence: 'gate:human default: a non-interactive run cannot block on a person, so it passes',
  };
}

// Parks a human_gates node in waiting_human (interactive) or marks it for the caller to
// auto-pass (not interactive) the moment it becomes ready - the same "called at the one place
// readiness is computed for a driver" seam promoteWaitingHuman documents above, but kept as its
// own function rather than folded into it: promoteWaitingHuman's pin is written by someone
// upstream (a spec, tm_assign) before this runs, while a human_gates pin is decided HERE, from
// team config, the first time the node is seen - `human_gate_seen` marks that decision made so
// a later poll (this runs on every team_next) never re-decides a node already parked or
// auto-passed. Works over any run-shaped object with `.nodes`/`.human_gates`/`.interactive` -
// task.json (the manager graph) qualifies exactly as a graph.mjs run does.
export function promoteHumanGates(run) {
  const gates = new Set(run.human_gates || []);
  const parked = [];
  const autoPass = [];
  if (!gates.size) return { parked, autoPass };
  for (const n of run.nodes) {
    if (n.state !== 'pending' || n.human_gate_seen) continue;
    if (!humanGateVerdictField(n)) continue;
    if (!gates.has(humanGateIdentity(n))) continue;
    if (unmetDeps(run, n).length) continue;
    n.human_gate_seen = true;
    n.human_gate = true;
    if (run.interactive) {
      n.assignment = { executor: 'human', vendor: 'human', who: null, reason: 'human_gates (team config)' };
      n.state = 'waiting_human';
      n.waiting_since = Date.now();
      parked.push(n);
    } else {
      n.auto_decided_pin = {
        by: 'auto',
        reason: `${humanGateIdentity(n)} is in human_gates but this run is not interactive - auto-passed instead of parking`,
        at: Date.now(),
      };
      autoPass.push(n);
    }
  }
  return { parked, autoPass };
}

// The human's own accept/reject, in the same shape a driver's JSON would have been. `gaps`
// rides straight into the retry path unchanged - a rejected `gate`/`gate:goal` already reads
// `result.gaps` to brief the next attempt, so a human's reasons reach it exactly the way a
// model gate's own gaps[] would, with no separate wiring needed.
export function humanGateResultFromPayload(n, payload) {
  const field = humanGateVerdictField(n);
  const p = payload && typeof payload === 'object' ? payload : {};
  const accept = p.accept === true;
  const reason = (typeof p.reason === 'string' && p.reason) || (accept ? 'approved by a person (gate:human)' : 'rejected by a person (gate:human)');
  return {
    stage_ok: true,
    ...(field ? { [field]: accept } : {}),
    ...(field === 'accept' ? { match_pct: accept ? 100 : 0, attacks: [`gate:human: ${reason}`] } : {}),
    checks: [`human accept/reject: ${reason}`],
    gaps: Array.isArray(p.gaps) ? p.gaps : [],
    // A person refusing the planning integrate can ask for the feature split itself to be redone
    // (M4) - the one non-boolean a human verdict carries through.
    ...(p.resplit === true ? { resplit: true } : {}),
    observations: [],
    reason,
    evidence: 'gate:human: a person judged this node directly, not a model',
  };
}
