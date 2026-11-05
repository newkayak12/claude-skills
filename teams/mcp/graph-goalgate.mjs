// graph-goalgate.mjs - goal-gate rounds, consensus and repair (cut from graph.mjs).
//
// One goal-gate round is one or more sibling `gate` nodes over the same assembled result; this
// module names the rounds, folds the judges' verdicts into one, and opens repair when a round
// rejects. Builds on graph-nodes.mjs (node) and graph-runfile.mjs (saveRun).

import { applyMerge } from './reducers.mjs';
import { node } from './graph-nodes.mjs';
import { saveRun } from './graph-runfile.mjs';

// ---------- goal-gate consensus and repair (Step 9) ----------
//
// A goal-gate "round" is one or more sibling `gate` nodes with subgoal_id null, all
// judging the same assembled result over the same deps. The primary is unlettered
// (`gate:goal:3`); a second and further judge get a letter suffix (`gate:goal:3b`,
// `gate:goal:3c`, ...) so `goal_judges:1` reproduces the exact node id every prior run
// and test relied on, and `nextIndex(run, 'gate:goal')`-style counting elsewhere still
// treats the round as one thing rather than N.

function goalGateSuffix(i) {
  return i === 0 ? '' : String.fromCharCode(98 + i - 1); // 0 -> '', 1 -> 'b', 2 -> 'c', ...
}

// The round number embedded in a goal-gate node id, or null for anything else -
// including a subgoal gate, which never starts with `gate:goal`.
export function goalRoundOf(nodeId) {
  const m = /^gate:goal:(\d+)[a-z]?$/.exec(nodeId || '');
  return m ? Number(m[1]) : null;
}

// Every judge of a round, primary first, in a stable id order.
export function goalGateSiblings(run, round) {
  return run.nodes
    .filter((n) => n.stage === 'gate' && n.subgoal_id === null && goalRoundOf(n.node_id) === round)
    .sort((a, b) => a.node_id.localeCompare(b.node_id));
}

// One past the highest round already opened - siblings all share a round, so counting
// by node_id prefix the way `nextIndex` does would count N per round and desync the
// letter suffixes from the round number.
export function nextGoalRound(run) {
  let max = 0;
  for (const n of run.nodes) {
    const r = goalRoundOf(n.node_id);
    if (r != null && r > max) max = r;
  }
  return max + 1;
}

// Opens a fresh round of `judges` sibling gate nodes, all sharing `deps`. Used both for
// the round a fresh subgoal expansion produces and for the round that follows a repair.
export function pushGoalGateRound(run, deps, extra, judges) {
  const round = nextGoalRound(run);
  const n = Math.max(1, Number.isInteger(judges) ? judges : 1);
  const ids = [];
  for (let i = 0; i < n; i++) {
    const id = `gate:goal:${round}${goalGateSuffix(i)}`;
    run.nodes.push(node(id, 'gate', deps.slice(), { subgoal_id: null, ...(extra || {}) }));
    ids.push(id);
  }
  return { round, ids };
}

// Consensus over one round: null until every judge has a terminal state. `accept`
// requires every judge's OWN verdict to have passed (nodeSucceeded already enforces
// that judge's accept/match_pct/checks rule, so a judge that fails on any of those
// never reaches `done`) - consensus adds nothing beyond "all of them, not just one".
// `routing_failure` is a peer that could not judge at all (transport, vendor,
// unparseable reply): the same distinction the subgoal branch of autoReassign draws,
// and the caller's problem, not a rejection to repair.
export function goalConsensus(run, round) {
  const judges = goalGateSiblings(run, round);
  if (!judges.length) return null;
  const routingFailure = judges.some((n) => n.result && n.result.stage_ok !== true);
  const settled = !routingFailure && judges.every((n) => n.state === 'done' || n.state === 'failed');
  // Through the declared registry (reducers.mjs), not an inline Set/Math.min: this is the same
  // AND-consensus / min / concat-dedup merge foldChild and the run-level `reduce` node use, so a
  // reader learns the rule once. Judges are true SIBLINGS (one round, several independent
  // opinions), which is exactly what and-consensus/min/concat-dedup are for - unlike a
  // package's own retry history (taskmanager.mjs's foldPackageHistory), where the same field
  // names mean something else and are folded last-by-attempt instead.
  const acceptEntries = judges.map((n) => ({ node_id: n.node_id, attempt: round, value: n.state === 'done' }));
  const matchEntries = judges
    .map((n) => ({ node_id: n.node_id, attempt: round, value: n.result && Number.isFinite(n.result.match_pct) ? n.result.match_pct : undefined }))
    .filter((e) => e.value !== undefined);
  const gapsEntries = judges.map((n) => ({ node_id: n.node_id, attempt: round, value: (n.result && n.result.gaps) || [] }));
  const driftEntries = judges.map((n) => ({ node_id: n.node_id, attempt: round, value: (n.result && n.result.spec_drift) || [] }));
  return {
    round,
    settled,
    routing_failure: routingFailure,
    accept: settled && applyMerge('and-consensus', acceptEntries),
    match_pct: matchEntries.length ? applyMerge('min', matchEntries) : null,
    gaps: applyMerge('concat-dedup', gapsEntries),
    spec_drift: applyMerge('concat-dedup', driftEntries),
    judges: judges.map((n) => ({
      node_id: n.node_id,
      state: n.state,
      accept: n.result ? n.result.accept === true : null,
      match_pct: n.result && Number.isFinite(n.result.match_pct) ? n.result.match_pct : null,
      identity: `${n.executor || n.vendor || 'self'}@${n.model || 'default'}`,
    })),
  };
}

// One repair per rejected round, capped like every other attempt counter -
// `nextIndex(run, 'repair')` is deliberately not reused: subgoal budgets are per
// subgoal, the spec budget is per run, and this is a third counter with its own name.
export function nextRepairIndex(run) {
  return run.nodes.filter((n) => n.stage === 'repair').length + 1;
}

// Opens repair:N over the rejecting round's siblings, then a fresh goal-gate round
// behind it - `repair:N after [gate:goal:round's siblings]`, `gate:goal:round+1 deps
// [repair:N, ...the subgoal gates that fed round]` - and moves the report's `after`
// from the old round onto the new one. Over budget, the rejecting siblings are marked
// final and the report is left free to run on partial work, same as every other
// exhausted budget in this engine.
//
// repair's edge to the round it follows is `after`, not `deps`: a rejecting judge ends
// `failed`, never `done`, and a data dep only ever waits for `done` - repair would sit
// forever behind a round it exists to answer. `after` only needs the round settled,
// which a failed-and-final judge already is.
export function openRepair(run, round, feedback, judges) {
  const siblings = goalGateSiblings(run, round);
  const attempt = nextRepairIndex(run);
  if (attempt > run.max_retries) {
    for (const s of siblings) if (s.state === 'failed') s.final = true;
    return { run: saveRun(run), attempt: null, reason: 'repair budget exhausted' };
  }
  const subgoalGateIds = siblings.length ? siblings[0].deps.slice() : [];
  const repairId = `repair:${attempt}`;
  run.nodes.push(node(repairId, 'repair', [], { after: siblings.map((s) => s.node_id), feedback: feedback || '' }));
  const { ids: freshIds } = pushGoalGateRound(run, [repairId, ...subgoalGateIds], {}, judges || 1);

  const oldIds = new Set(siblings.map((s) => s.node_id));
  for (const n of run.nodes) {
    if (n.node_id === repairId) continue; // repair itself follows the OLD round, not the new one it opens
    if (!n.after || !n.after.some((d) => oldIds.has(d))) continue;
    n.after = [...new Set([...n.after.filter((d) => !oldIds.has(d)), ...freshIds])];
  }
  return { run: saveRun(run), attempt, repair_id: repairId, gate_ids: freshIds };
}
