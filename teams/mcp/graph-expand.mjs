// graph-expand.mjs - turning a spec's subgoals into graph nodes (cut from graph.mjs).
//
// expandSubgoals builds each subgoal's chain, the reduce fold and the goal gate + report behind
// them; computeWriteScope is the pure sibling-collision check that fold and gate read. Builds on
// graph-kinds, graph-nodes, graph-pins, graph-goalgate and graph-runfile.

import { writeScopeFindings } from './reducers.mjs';
import { KINDS, DEFAULT_KIND, kindOf, authorStage } from './graph-kinds.mjs';
import { node, getNode, nextIndex, pushChain } from './graph-nodes.mjs';
import { applyHumanPin } from './graph-pins.mjs';
import { pushGoalGateRound } from './graph-goalgate.mjs';
import { saveRun } from './graph-runfile.mjs';

export function expandSubgoals(run, subgoals) {
  const gateIds = [];
  // After a spec retry the live critique is critique:N, not the retired `critique`.
  const liveCritique = run.nodes.filter((n) => n.stage === 'critique' && n.state !== 'skipped').pop();
  const critiqueDep = liveCritique ? liveCritique.node_id : 'critique';

  // One attempt number for the whole expansion, so a subgoal's deps can name its
  // siblings' gates without guessing which round they belong to. Counted over every
  // kind's chain stages, not implement alone: a planning/qa/audit chain has no implement
  // node, so its respec came back as round 1 and re-pushed the retired ids (u40). Every
  // kind also covers a subgoal whose kind changed between specs.
  const chainStages = [...new Set(Object.values(KINDS).flatMap((k) => k.chain))];
  const round = Math.max(
    1,
    ...subgoals.flatMap((sg) => chainStages.map((stage) => nextIndex(run, `${stage}:${String(sg.id)}`))),
  );

  for (const sg of subgoals) {
    const id = String(sg.id);
    const deps = (sg.deps || []).map((d) => `gate:${d}:${round}`);
    const after = (sg.after || []).map((d) => `gate:${d}:${round}`);
    gateIds.push(pushChain(run, (KINDS[kindOf(sg)] || KINDS[DEFAULT_KIND]).chain, id, round, [critiqueDep, ...deps], after, {}));
    // A STORY-level pin (run.subgoal_assignee: the package's own assignee from shape, or
    // tm_assign on the STORY) covers every subgoal the package's setgoal produced - the STORY
    // is the human's, so its TASKs are too. A subgoal setgoal already pinned keeps its own.
    // Written onto the spec subgoal (not only the node) so retrySubgoal's later attempts
    // re-apply it the same way.
    if (run.subgoal_assignee && !sg.assignee) {
      sg.assignee = typeof run.subgoal_assignee === 'object' ? { ...run.subgoal_assignee } : run.subgoal_assignee;
    }
    applyHumanPin(run, sg, id, round);
  }
  // Where parallel subgoals converge. Until this node existed the only place they met was
  // the goal gate, which is a judging node and writes nothing - so nothing ever looked at
  // the artifacts as a set. What held that seam together was a convention: the setgoal
  // contract tells subgoals sharing one file to each name the heading they own. A
  // convention breaks quietly and nobody checks it, and idol-plan-2 (2026-09-23) is what
  // that looks like in practice - five sibling investigate stages, told to name their
  // findings file after their subgoal, produced U1-investigate.md,
  // U3-1-investigate-notes.md, investigate-U4-findings.md, investigate-U2-findings.md and
  // decisions/investigate_U5_1-findings.md, and a retry left investigate_U5_2 beside its
  // own first attempt as an orphan. `reduce` is the leader that folds the set: it reads
  // what the subgoals actually wrote and reports what does not line up. It does not judge
  // - that stays the goal gate's job.
  //
  // Only pushed when there is more than one subgoal: a single-subgoal run has nothing to
  // fold, and inserting a node there would add a model call that can only say "nothing to
  // do".
  let gateDeps = gateIds;
  let gateAfter = [];
  if (subgoals.length > 1) {
    const reduceId = round === 1 ? 'reduce' : `reduce:${round}`;
    run.nodes.push(node(reduceId, 'reduce', gateIds, {}));
    // The goal gate's data edge moves to reduce, but its SIGHT must not narrow with it:
    // nodeBriefing walks deps and after, so a gate whose deps are ['reduce'] alone would be
    // handed one node's lists and none of the work it is judging. The subgoal gates stay on
    // as order-only edges, which is what `after` is for - they are already satisfied by the
    // time reduce is, so this adds no waiting, only visibility.
    gateDeps = [reduceId];
    gateAfter = gateIds.slice();
  }
  // Multi-judge consensus (Step 9 / D-goal-consensus): a fresh round of `run.goal_judges`
  // sibling gates over the same subgoal gates, instead of the single node this used to
  // push directly. goal_judges:1 is exactly the old shape - one node named `gate:goal:N`.
  const { ids: goalGates } = pushGoalGateRound(run, gateDeps, gateAfter.length ? { after: gateAfter } : {}, run.goal_judges || 1);
  const reportId = round === 1 ? 'report' : `report:${round}`;
  // Order-only: the report waits for every judge in the round to be settled, not to
  // pass. A run whose subgoal ran out of retries used to end `blocked` with the
  // passing subgoals' work never reported - partial success was simply lost.
  run.nodes.push(node(reportId, 'report', [], { after: goalGates }));
  return saveRun(run);
}

// Deterministic sibling write-scope check (item 2 of the reducer plan, §0.1/§4 of
// _repo/docs/plans/2026-09-23-teams-reducer-human-rollback.md): whether parallel subgoals collided
// on a file - or, sharing one document, the same heading - without a single declared owner.
// This is a pure function of run state, not a model call, so it runs whether or not the run's
// own `reduce` LLM pass happened to notice the same thing (see broker.mjs's finishNode, which
// records this onto the `reduce` node's own result) and whether or not a run even HAS a reduce
// node - `n` may be the goal gate itself on a run with exactly one subgoal, where there is
// nothing to collide and this returns three empty lists.
//
// `n`'s subgoal gates are wherever the caller put them: `reduce`'s own deps (the direct fold),
// or `gate:goal`'s `after` (the goal gate depends on `reduce` alone but keeps every subgoal
// gate as order-only sight - expandSubgoals's own comment on gateAfter explains why). Reading
// both covers either caller without either needing to know how the other is wired.
export function computeWriteScope(run, n) {
  const subgoals = (run.spec && run.spec.subgoals) || [];
  const ids = [...new Set([...(n.deps || []), ...(n.after || [])])];
  const records = ids
    .map((id) => getNode(run, id))
    .filter((g) => g && g.stage === 'gate' && g.subgoal_id)
    .map((g) => {
      const sg = subgoals.find((s) => String(s.id) === String(g.subgoal_id));
      const stage = authorStage(kindOf(sg));
      const author = getNode(run, `${stage}:${g.subgoal_id}:${g.attempt || 1}`);
      return {
        subgoal_id: g.subgoal_id,
        attempt: g.attempt || 1,
        changed_files: (author && author.result && Array.isArray(author.result.changed_files)) ? author.result.changed_files : [],
      };
    });
  return writeScopeFindings(subgoals, records);
}
