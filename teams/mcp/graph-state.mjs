// graph-state.mjs - reading a run: its state and what a node is briefed with (cut from graph.mjs).
//
// runState folds node counts and the goal-gate verdict into one word; nodeBriefing assembles what
// a node needs to be executed from what the graph already holds. Pure reads over a run. Builds on
// graph-kinds, graph-goalgate, graph-decisions, graph-expand and graph-ready.

import { REASONING_STAGES, flowOf, defaultKind, kindOf } from './graph-kinds.mjs';
import { goalRoundOf, goalConsensus } from './graph-goalgate.mjs';
import { settledDecisions } from './graph-decisions.mjs';
import { computeWriteScope } from './graph-expand.mjs';
import { readyNodes } from './graph-ready.mjs';

// The public shape of goal-gate consensus, trimmed of internal bookkeeping
// (`routing_failure` stays out - it means "not decided yet", not a verdict).
function publicGoalVerdict(c) {
  if (!c || !c.settled) return null;
  return { accept: c.accept, match_pct: c.match_pct, judges: c.judges, gaps: c.gaps, spec_drift: c.spec_drift };
}

export function runState(run) {
  const counts = { pending: 0, running: 0, done: 0, failed: 0, skipped: 0, unreachable: 0, waiting_human: 0 };
  for (const n of run.nodes) counts[n.state] = (counts[n.state] || 0) + 1;

  // The most recently SETTLED goal-gate round's consensus, once one exists - surfaced
  // here so a caller reading run state does not have to re-derive it from the node
  // list. "most recent" skips a newer round a repair already opened but that has not
  // finished judging yet - that round has no verdict of its own to report, and the
  // prior one's is still the honest answer to "did the run's goal gate accept".
  const rounds = [...new Set(
    run.nodes
      .filter((n) => n.stage === 'gate' && n.subgoal_id === null)
      .map((n) => goalRoundOf(n.node_id))
      .filter((r) => r != null),
  )].sort((a, b) => b - a);
  let goalVerdict = null;
  for (const r of rounds) {
    const c = goalConsensus(run, r);
    if (c && c.settled) { goalVerdict = publicGoalVerdict(c); break; }
  }
  const withVerdict = (s) => (goalVerdict ? { ...s, goal_verdict: goalVerdict } : s);

  // Only a finished report means the run finished. Deciding on "nothing pending" once
  // let a spec retry that rebuilt no nodes report itself complete having implemented
  // nothing - the worst kind of failure, because it looks like success.
  const reports = run.nodes.filter((n) => n.stage === 'report');
  if (reports.some((n) => n.state === 'done')) {
    // `complete` says the graph terminated normally; on its own it does not say the run
    // delivered. A report is also written over a settled failure - a retry budget ran out,
    // settleFailure released everything downstream as unreachable, and the report says plainly
    // what did not ship (idol-pm-1, 2026-09-22: three shaping attempts, zero packages
    // dispatched, and every machine-readable surface above the prose reading success). `settled`
    // carries that distinction without changing the state string, so no caller switching on
    // 'complete' flips behaviour while every surface that wants the truth can ask for it. The
    // ticket layer's SETTLED is the same fact, named for a board.
    const settled = counts.unreachable > 0;
    return withVerdict(settled ? { state: 'complete', settled: true, counts } : { state: 'complete', counts });
  }
  // tickets.mjs's epicTicketState and taskmanager.mjs's task-level runState(task) call this
  // same function (task.json is itself a "run" with a .nodes array), so this one branch fixes
  // both levels at once. Gated on "nothing else ready or running": readyNodes() already excludes
  // a waiting_human node, so without the gate a run with nothing else ready reads like a
  // deadlock; a sibling subgoal still moving means the run is still `running`, not waiting on
  // anything as a whole.
  if (!readyNodes(run).length && !counts.running && run.nodes.some((n) => n.state === 'waiting_human')) {
    return withVerdict({ state: 'waiting_human', counts });
  }
  if (run.routing_blocked && !counts.running) return withVerdict({ state: 'blocked', counts });
  // Blocked means nothing can proceed - not merely that nothing is pending. A node
  // waiting on a dependency that failed is still pending and still stuck.
  if (!readyNodes(run).length && !counts.running) return withVerdict({ state: 'blocked', counts });
  return withVerdict({ state: 'running', counts });
}

// What a node needs to know to be executed, assembled from what the graph already
// holds. The orchestrator should not have to remember any of this itself.
export function nodeBriefing(run, n) {
  // Prose only was not enough. A gate briefed with a handoff and a one-line summary
  // correctly rejected the work as undemonstrated: "no raw output or exit status was
  // provided". The checks the executor ran, the commands the adapter observed, and the
  // files it touched are the evidence - withholding them and then asking for proof is
  // the same mistake as briefing critique without the subgoals.
  // A subgoal gate depends only on that subgoal's test node, so briefing it from deps
  // alone showed it the verification and hid the implementation it was judging. Give a
  // gate the whole attempt it is ruling on.
  const inScope = (x) => {
    if (n.deps.includes(x.node_id) || (n.after || []).includes(x.node_id)) return true;
    return n.stage === 'gate'
      && n.subgoal_id
      && x.subgoal_id === n.subgoal_id
      && (x.attempt || 1) === (n.attempt || 1)
      && x.node_id !== n.node_id;
  };
  const upstream = run.nodes
    .filter((x) => inScope(x) && x.result)
    .map((x) => ({
      node_id: x.node_id,
      stage: x.stage,
      state: x.state,
      handoff: x.result.handoff || '',
      // A person's answers on an `ask` card. Carried explicitly because none of the ordinary
      // fields hold them - a decision is not a handoff, a check or a changed file - and the
      // stage below (draft) exists to write the answer down.
      decisions: Array.isArray(x.result.decisions) ? x.result.decisions : [],
      evidence: x.result.evidence || '',
      checks: x.result.checks || [],
      // An execute node's own deliverable when verified:false (prompts.mjs's execute contract):
      // this is what a QA subgoal's own gate must see to judge whether the case set was run and
      // reported, not just its checks[] summary of pass/fail per case.
      defects: Array.isArray(x.result.defects) ? x.result.defects : [],
      // A defect implement/test found OUTSIDE this package's own scope, in an upstream package
      // it deps on (prompts.mjs's UPSTREAM_DEFECT_CONTRACT) - this package's own gate must see
      // every one of them to carry them through into its own "upstream_defects", the same way it
      // already carries an execute node's `defects` through for a QA subgoal.
      upstream_defects: Array.isArray(x.result.upstream_defects) ? x.result.upstream_defects : [],
      changed_files: x.result.changed_files || [],
      changed_files_verified: x.result.changed_files_verified,
      verified: x.result.verified,
      commands: (x.result.event_evidence && x.result.event_evidence.commands) || [],
      commands_executed: x.result.event_evidence ? x.result.event_evidence.commands_executed : undefined,
      commands_failed: x.result.event_evidence ? x.result.event_evidence.commands_failed : undefined,
    }));

  // What a person has already decided for this owner, including on attempts this one superseded.
  // A retry rebuilds the chain with fresh deps, so a superseded `ask` node is out of `upstream`'s
  // scope entirely and the new attempt's investigate had no way to know a question was settled -
  // idol-beta-ask1 (2026-09-25) re-raised six of them, two word for word. openAsk drops the exact
  // repeats; this is what stops the rewordings, by telling the stage that writes the questions.
  // settledDecisions adds the task's own (run.task_decisions, §6.2-2/§6.5-2) after the run's.
  const priorDecisions = settledDecisions(run)
    .filter((d) => !(n.stage === 'ask' && (n.questions || []).some((q) => (q.question || q.unknown) === d.question)));

  const sg = run.spec && n.subgoal_id
    ? (run.spec.subgoals || []).find((s) => String(s.id) === String(n.subgoal_id))
    : null;

  // A node that judges the spec as a whole - critique, the goal gate, report - must see
  // the subgoals. Briefing it with only the goal made critique complain that the
  // decomposition "references U1 and U2 without defining them": it was being asked to
  // review a document half of which was withheld.
  const specWide = !n.subgoal_id && run.spec ? run.spec.subgoals || [] : null;

  // The goal gate and the report judge the run as a whole, but their direct deps are
  // only the subgoal gates - so briefing them with deps alone left the report holding
  // one line of gate evidence and nothing about what was actually built. Give them
  // every finished node, including the failures: "what was not done and why" cannot be
  // written from a list of successes.
  // By stage, not by id: after a spec retry the live report is `report:N`, and matching
  // the bare name left that report briefed with nothing but its order-only upstream.
  // repair joins this branch (Step 9): it fixes across the tree at the seams a rejected
  // goal gate found, not one subgoal's slice, so it needs the same whole-run view the
  // goal gate itself gets - plus, via `prior_feedback` below (n.feedback, set when
  // repair is opened), the rejecting round's reason and gaps.
  const wholeRun = n.stage === 'report' || n.node_id.startsWith('gate:goal') || n.stage === 'repair'
    ? run.nodes
        .filter((x) => x.result && x.node_id !== n.node_id)
        .map((x) => ({
          node_id: x.node_id,
          stage: x.stage,
          state: x.state,
          vendor: x.vendor || null,
          handoff: x.result.handoff || '',
          evidence: x.result.evidence || '',
          checks: x.result.checks || [],
          // Same reasoning as upstream's own `defects` above - the report and the goal gate
          // both read every finished node here (not just deps), so an execute node's defects
          // must be visible in this list too, not only to the subgoal gate beside it.
          defects: Array.isArray(x.result.defects) ? x.result.defects : [],
          upstream_defects: Array.isArray(x.result.upstream_defects) ? x.result.upstream_defects : [],
          changed_files: x.result.changed_files || [],
          changed_files_verified: x.result.changed_files_verified,
          verified: x.result.verified,
          accept: x.result.accept,
          sound: x.result.sound,
          match_pct: x.result.match_pct,
          // A gate's gaps, or a critique's blocking defects and problems: whatever the
          // judging node said was wrong. The report cannot explain a dead spec otherwise.
          gaps: x.result.gaps || [...(x.result.blocking || []), ...(x.result.problems || [])],
          reason: x.result.reason || x.result.verification_error || '',
        }))
    : null;

  // A setgoal retry's feedback is one flat string by the time it reaches this node -
  // retrySpec joined it from whichever node rejected the prior attempt. That collapses two
  // different situations: a critique that rejected the spec on its merits (blocking/problems),
  // and a setgoal draft that validateSpec itself threw out before any judgment happened
  // (spec_problems). Only the second is the structural-validation failure the degenerate-spec
  // diagnosis in prompts.mjs is for, so recover it here from the actual prior setgoal attempt's
  // result rather than guessing from the joined string.
  const priorSetgoal = n.stage === 'setgoal' && (n.attempt || 1) > 1
    ? run.nodes.find((x) => x.stage === 'setgoal' && (x.attempt || 1) === (n.attempt || 1) - 1)
    : null;
  const specProblems = priorSetgoal && priorSetgoal.result && Array.isArray(priorSetgoal.result.spec_problems)
    && priorSetgoal.result.spec_problems.length
    ? priorSetgoal.result.spec_problems
    : null;

  // The deterministic sibling write-scope check (item 2): shown to the fold itself and to the
  // goal gate that judges behind it, so a collision or an undeclared writer is visible before
  // either has to trust the `reduce` LLM pass's own prose reading of the same disk state.
  const writeScope = (n.stage === 'reduce' || (n.stage === 'gate' && n.subgoal_id == null))
    ? computeWriteScope(run, n)
    : null;

  return {
    run_id: run.run_id,
    node_id: n.node_id,
    stage: n.stage,
    attempt: n.attempt,
    cwd: run.cwd,
    request: run.request,
    context: run.context,
    flow: run.flow || 'auto',
    flow_chosen: flowOf(run),
    default_kind: defaultKind(run),
    mixed: run.mixed !== false,
    size: run.size || null,
    goal: run.spec ? run.spec.goal : null,
    goal_acceptance: run.spec ? run.spec.acceptance || [] : [],
    subgoal: sg || null,
    subgoals: specWide,
    whole_run: wholeRun,
    prior_feedback: n.feedback || '',
    spec_problems: specProblems,
    upstream,
    prior_decisions: priorDecisions,
    // Non-interactive only: questions nobody will ever answer, each decided by its recommended
    // (first) option. code-sprint-S2's PLAN wrote them as open questions with owners, and its
    // gate rejected three rounds at 93-95 because the validation matrix then asserted behaviour
    // the same document called unresolved - a contradiction no revise could close while the
    // questions stayed open and unanswerable. Shown to authoring stages, not to investigate
    // (which decides what is open) or ask.
    // An execution-phase run (§6.2-3) decides by default even when interactive.
    decide_by_default: (!run.interactive || run.execution_phase === true) && ['draft', 'revise', 'template-fill', 'implement', 'cases'].includes(n.stage),
    default_decisions: (!run.interactive || run.execution_phase === true) && ['draft', 'revise', 'template-fill', 'implement', 'cases'].includes(n.stage)
      ? (run.unasked || []).filter((u) => u && u.question && ((Array.isArray(u.options) && u.options.length) || u.decided != null))
        .map((u) => ({ question: u.question, chose: u.decided != null ? (typeof u.decided === 'string' ? u.decided : JSON.stringify(u.decided)) : String((u.options[0] && (u.options[0].option || u.options[0])) || ''), owner: u.owner || null, asked_under: u.subgoal_id || null }))
        .filter((d, i, all) => d.chose && all.findIndex((x) => x.question === d.question) === i)
      : [],
    write_scope: writeScope,
    // planning-light (§2.3): investigate's unknowns, handed verbatim to template-fill (which
    // must carry each one) and to the gate (which checks none was lost). The full chain's gate
    // is two stages removed from investigate and never needed them; this one is the check.
    investigate_unknowns: sg && kindOf(sg) === 'planning-light' && ['template-fill', 'gate'].includes(n.stage)
      ? lightUnknowns(run, n)
      : null,
    reasoning_stage: REASONING_STAGES.has(n.stage),
  };
}

// The unknowns the same attempt's investigate returned - the one this template-fill/gate
// descends from, not an earlier attempt's.
function lightUnknowns(run, n) {
  const inv = run.nodes.filter((x) => x.stage === 'investigate' && x.subgoal_id === n.subgoal_id
    && (x.attempt || 1) === (n.attempt || 1) && x.result).pop();
  const us = inv && Array.isArray(inv.result.unknowns) ? inv.result.unknowns : [];
  return us.filter((u) => u && (u.question || u.unknown))
    .map((u) => ({ question: String(u.question || u.unknown), owner: u.owner || null }));
}
