// broker-independence.mjs - author != reviewer, and what happens when a node finishes:
// finishNode, the auto-reassign / repair machinery, the interruption checkpoint, and the
// submit adjudication (computeSubmitResult / submitResult) that ingestHandoff and team_submit
// share. Cut out of broker.mjs (card 128). writeHumanBriefing lives here, not with the tool
// handlers, because finishNode needs it and the tools module imports this one, never the reverse.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  REASONING_STAGES,
  saveRun,
  getNode,
  expandSubgoals,
  openAsk,
  routeExecutionQuestions,
  validateSpec,
  retrySubgoal,
  retrySpec,
  nodeBriefing,
  VERDICT_FIELD,
  reasonFromVerdict,
  authorStage,
  nodeKind,
  FLOWS,
  DEFAULT_FLOW,
  flowOf,
  goalRoundOf,
  goalGateSiblings,
  goalConsensus,
  openRepair,
  defaultKind,
  normalizeSpec,
  computeWriteScope,
} from './graph.mjs';
import { composePrompt } from './prompts.mjs';
import { brokerDir, record, syncOpenNodes } from './broker-vendors.mjs';
import { applyRollback, attributionBase, crossCheck, gitChanged } from './broker-checkpoint.mjs';
import { nodeSucceeded, verdict } from './broker-normalize.mjs';

// ---------- author != reviewer ----------
//
// A document is checked by reading it, and a reading by the hand that wrote it checks
// nothing: the author already believes every acceptance item is met. The gate has always
// had this rule as prose ("you are the judge, not the actor"); review gets it as
// enforcement, because here the broker can actually see both identities. Identity is
// executor + model. Two vendor runs on the same identity are refused - the node stays
// pending so the caller can route it elsewhere - rather than failed, which would burn a
// retry on a routing mistake. `self` is the driving session dispatching a fresh native
// agent, whose identity the broker cannot see: allowed, and marked as unverifiable.
function identityOf(executor, model) {
  return `${executor || 'self'}@${model || 'default'}`;
}

// The model axis, tried before the degradation above. When draft and review both land on the
// host (no peer vendor installed), they arrive on the same model by default and the reviewer is
// the author. If the host declared more than one native model, use a different one for the
// review - independence by model rather than by vendor. Returns the model to use and a phrase
// for the routing reason, because a substituted model must be visible in the run, never silent.
export function reviewerModel(run, node, chosen) {
  if (node.stage !== 'review' && node.stage !== 'revise') return { model: chosen, note: '' };
  const kind = nodeKind(run, node);
  const author = run.nodes.find((x) => x.subgoal_id === node.subgoal_id
    && (x.attempt || 1) === (node.attempt || 1) && x.stage === authorStage(kind || 'subgoal'));
  const wrote = author && (author.model || (author.assignment && author.assignment.model));
  if (!wrote || wrote !== chosen) return { model: chosen, note: '' };
  const other = (Array.isArray(run.native_models) ? run.native_models.map(String) : []).find((m) => m !== wrote);
  if (!other) return { model: chosen, note: `; ${chosen} wrote the draft and the host declared no second native model, so this review is not independent` };
  return { model: other, note: `; ${chosen} wrote the draft, reviewing with ${other} instead` };
}

export function reviewIndependence(run, n, executor, model) {
  // audit (planning-audit's own kind) makes the same demand review/revise do, but its author -
  // the PLAN package's draft/revise - never ran in THIS run: it ran in a sibling child run the
  // TaskManager folded away before this one ever opened (taskmanager.mjs's openAudit). There is
  // no in-run peer to look up, so openAudit reads that other run once, up front, and stashes its
  // author's identity here as `run.external_author` - this branch is the audit-side half of
  // that same cross-run independence check, recording rather than refusing: unlike review/revise
  // this never throws, because a caller who already committed to opening this run as its own
  // child (openChild) has no in-loop reroute the way team_run's retry-within-a-run does; a
  // routed-away vendor (routing.mjs's externalAuthorOf) is the "where possible" half, and this
  // is the "record it either way" half.
  if (n.stage === 'audit') {
    // One author per planning card (m10): the audit is independent only of all of them.
    const exts = [].concat(run.external_author || []).filter(Boolean);
    if (!exts.length) return null;
    const mine = identityOf(executor, model);
    const theirs = exts.map((ext) => identityOf(ext.executor || ext.vendor, ext.model));
    const author = theirs.length === 1 ? theirs[0] : theirs;
    if ((executor || 'self') === 'self' || exts.some((ext) => (ext.executor || ext.vendor || 'self') === 'self')) {
      return { independence: 'unverifiable-self', author, reviewer: mine };
    }
    if (theirs.includes(mine)) return { independence: 'unverifiable-same-host', author, reviewer: mine };
    return { independence: 'distinct-identity', author, reviewer: mine };
  }
  // revise (planning kind) makes the same "not the same identity as the author" demand
  // review does - the design doc's decision that a different identity revises. The
  // reviewer_independence field is still merged into the result only on the reasoning
  // branch below (team_run/team_submit); revise is not a reasoning stage, so only the
  // refusal (the throw below) applies to it, not the field.
  if (n.stage !== 'review' && n.stage !== 'revise') return null;
  const kind = nodeKind(run, n);
  const author = run.nodes.find((x) => x.subgoal_id === n.subgoal_id
    && (x.attempt || 1) === (n.attempt || 1) && x.stage === authorStage(kind || 'subgoal'));
  if (!author || !author.result) return null;
  const mine = identityOf(executor, model);
  const theirs = identityOf(author.executor || author.vendor, author.model);
  if ((executor || 'self') === 'self' || (author.executor || author.vendor || 'self') === 'self') {
    return { independence: 'unverifiable-self', author: theirs, reviewer: mine };
  }
  if (mine === theirs) {
    // Both escapes the message used to name are unreachable for a host-dispatched node: a
    // second vendor may not be installed at all (the bench's own arms are claude-only), and
    // team_run refuses a node routed to self - so a run that got here had no move left and
    // sat offering the same node forever. Measured 2026-09-17: three driver sessions in a row
    // hit exactly this on review:U5:1, each correctly gave up, and the run stalled at 16/20
    // with every artifact already written.
    //
    // The design's independence comes from draft going to a peer vendor while review stays on
    // the host (routing.mjs's EXECUTION_STAGES comment: "without anyone arranging it"). When
    // there is no peer, draft degrades to the host and that arrangement silently collapses.
    // Model is then the only axis left, and route() now tries it first (see reviewerModel).
    // If even that is gone - one declared model, or none - the honest answer is the one this
    // file already gives everywhere else: degrade visibly rather than deadlock. The review
    // runs, and `reviewer_independence` says it was not independent, so the report and anyone
    // reading the run can see exactly what the verdict is worth.
    if ((n.assignment && n.assignment.vendor === 'self') || (executor || 'self') === 'self') {
      return { independence: 'unverifiable-same-host', author: theirs, reviewer: mine };
    }
    throw new Error(`${n.stage} ${n.node_id} is routed to ${mine}, which wrote ${author.node_id}. `
      + `A document must be read or revised by someone other than its author: route the ${n.stage} stage to another vendor `
      + `(policy.${n.stage}).`);
  }
  return { independence: 'distinct-identity', author: theirs, reviewer: mine };
}

// The feedback is whatever judged the attempt last: a gate's gaps, or - when the attempt
// never reached its gate - the check that failed it. A review that listed what the text
// lacks, or a test that printed the failing command, is the feedback the next draft or
// implement needs; carrying only gate verdicts sent it in blind.
// A node denied a tool it needed (adapter: blocked 'tool denied') judged nothing, so it is
// never feedback and never a rejection signature.
const toolDenied = (result) => Boolean(result) && result.blocked === 'tool denied';

export function subgoalFeedback(run, sid) {
  const judged = run.nodes.filter((n) => n.subgoal_id === sid && n.result && (n.stage === 'gate' || n.state === 'failed'));
  const last = judged[judged.length - 1];
  // A goal gate that rejected the assembled result names what the run as a whole lacks; the
  // subgoal being retried for it must hear that too, since its own gate passed.
  const goal = run.nodes.filter((n) => n.stage === 'gate' && n.subgoal_id === null && n.state === 'failed' && !n.final && n.result).pop();
  return [
    ...(last && last.result && !toolDenied(last.result)
      ? [last.result.reason || '', ...(last.result.gaps || []), ...(last.result.verified === false ? (last.result.checks || []) : [])]
      : []),
    ...(goal && !toolDenied(goal.result) ? [`goal gate ${goal.node_id}: ${goal.result.reason || 'rejected'}`, ...(goal.result.gaps || [])] : []),
  ].filter(Boolean).join('\n- ');
}

// A rejected quality gate reassigns the subgoal itself. Leaving the next attempt to the
// caller made the rejection advisory: a session that did not call team_retry simply
// stopped, and the gate's gaps went nowhere. The engine opens the next attempt instead,
// carrying the same feedback team_retry would have carried, and settles when the budget
// is gone exactly as before. The goal gate is not included - its rejection blames the
// assembled result, not one subgoal, and choosing which subgoal to reopen is a judgement
// the manager makes.
// A rejection, reduced to what it actually objected to. Two attempts that fail on the same
// signature are not converging: the work is being asked for something it cannot produce
// where it stands, and a third attempt spends budget to learn that again.
function rejectionSig(result) {
  if (!result || toolDenied(result)) return '';
  const gaps = [...(result.gaps || []), ...(result.blocking || [])].map((g) => String(g).trim().toLowerCase());
  return [String(result.reason || '').trim().toLowerCase(), ...gaps.sort()].filter(Boolean).join('|');
}

// The rejection this subgoal's previous attempt died on, if it had one.
function priorSig(run, sid, attempt) {
  const prior = run.nodes
    .filter((x) => x.subgoal_id === sid && x.state === 'failed' && (x.attempt || 1) === attempt - 1 && x.result)
    .pop();
  return prior ? rejectionSig(prior.result) : '';
}

// A goal-gate round's rejection, reduced to what it actually objected to - the same
// shape rejectionSig gives a subgoal, but over the union the whole round agreed on
// (gaps and spec_drift both name a shortfall) rather than one judge's reason line,
// which the round's judges will not have worded identically even when they mean the
// same thing.
function goalRejectionSig(consensus) {
  const gaps = [...(consensus.gaps || []), ...(consensus.spec_drift || [])].map((g) => String(g).trim().toLowerCase());
  return gaps.sort().join('|');
}

// repair's briefing: the goal is already in nodeBriefing's `goal`/`goal_acceptance`,
// and the whole run's nodes arrive via the `whole_run` branch it now shares with the
// goal gate - so what repair needs here is the round's own verdict (the reason the
// generic upstream/whole_run views cannot carry, since consensus is computed across
// several nodes, not read off one) and a size-bounded pointer into every subgoal's
// handoff. Unsliced, a run of a dozen subgoals would hand repair a briefing as large
// as the run itself - the same shape of problem handoffOf's 1500-character cap solved
// one level down, and just as uncredited if it silently works.
const REPAIR_HANDOFF_CAP = 1500;
export function repairBriefing(run, consensus) {
  const lines = [];
  lines.push(`goal gate round ${consensus.round} rejected the assembled result: every judge must accept at or above the run's threshold, and did not.`);
  if (consensus.gaps.length) lines.push(`Gaps (union across judges):\n- ${consensus.gaps.join('\n- ')}`);
  if (consensus.spec_drift.length) lines.push(`Spec drift (the request asked for this, the spec never turned it into a criterion):\n- ${consensus.spec_drift.join('\n- ')}`);
  const subgoals = (run.spec && run.spec.subgoals) || [];
  for (const sg of subgoals) {
    // Every kind's chain ends in `gate` (subgoal: implement/test/gate; document:
    // draft/review/gate), so the subgoal's own gate is always this stage name -
    // no need to look up the kind to find it.
    const gates = run.nodes.filter((n) => n.subgoal_id === String(sg.id) && n.stage === 'gate' && n.result);
    const last = gates.at(-1);
    const handoff = last && last.result ? String(last.result.handoff || '') : '';
    const sliced = handoff.length > REPAIR_HANDOFF_CAP
      ? `${handoff.slice(0, REPAIR_HANDOFF_CAP)} …[truncated at ${REPAIR_HANDOFF_CAP} chars]`
      : handoff;
    lines.push(`Subgoal ${sg.id} (${sg.title}) handoff: ${sliced || '(none recorded)'}`);
  }
  lines.push('Fix across the tree at the seams these gaps point to - several subgoals may own the files involved, which is the point: a gap here is usually in what is between them, not inside any one of them. Do not restate the goal-level acceptance criteria to fit what already exists; the gate that follows judges them unchanged.');
  return lines.join('\n');
}

// The goal-gate branch of autoReassign. A rejected subgoal gate reassigns the subgoal;
// a rejected goal-gate ROUND has no single subgoal to blame - the failure is usually in
// the seam between subgoals that each met their own acceptance - so it opens a repair
// pass over the assembled result instead (Step 9). Consensus, not one judge: the round
// is not decided until every sibling has a terminal state, and a peer that could not
// judge at all is a routing failure for the caller, not a verdict to repair.
function autoReassignGoalGate(run, n) {
  if (run.auto_reassign === false) return null;
  if (n.final) return null;
  const round = goalRoundOf(n.node_id);
  if (round == null) return null;
  const siblings = goalGateSiblings(run, round);
  if (siblings.some((s) => s.state === 'pending' || s.state === 'running')) return null; // wait for the rest of the round
  // A later round already exists means this one was already handled - by a prior call
  // of this same function for a sibling that finished after this one, or before it.
  if (run.nodes.some((x) => x.stage === 'gate' && x.subgoal_id === null && goalRoundOf(x.node_id) === round + 1)) return null;

  const consensus = goalConsensus(run, round);
  if (!consensus || consensus.routing_failure || !consensus.settled) return null; // a peer's transport/vendor failure - the caller's problem
  if (consensus.accept) return null; // every judge accepted at or above the threshold

  for (const s of siblings) s.final = true;

  const sig = goalRejectionSig(consensus);
  if (sig && sig === run.last_goal_sig) {
    saveRun(run);
    record(run.cwd, { event: 'team_settle', run_id: run.run_id, target: 'goal_gate', round, signature: sig, stalled: true });
    return { round, stalled: true };
  }
  run.last_goal_sig = sig;

  const feedback = repairBriefing(run, consensus);
  const out = openRepair(run, round, feedback, run.goal_judges || siblings.length);
  record(run.cwd, {
    event: out.attempt ? 'team_repair' : 'team_settle',
    run_id: run.run_id, target: 'goal_gate', round,
    ...(out.attempt ? { attempt: out.attempt, repair_id: out.repair_id } : { reason: out.reason }),
  });
  return out.attempt
    ? { round, repaired: { attempt: out.attempt, repair_id: out.repair_id } }
    : { round, stalled: false, settled: true, reason: out.reason };
}

function autoReassign(run, n) {
  if (n.stage === 'gate' && n.subgoal_id === null) return autoReassignGoalGate(run, n);
  if (run.auto_reassign === false) return null;
  // A critique's rejection (`sound: false`) has no subgoal to reassign - the spec itself
  // is the defect. Escalate straight to retrySpec, the same move a subgoal takes below
  // after two identical rejections: it opens a fresh setgoal+critique pair, so the
  // re-authored spec is critiqued again rather than waved through the way a one-shot
  // critic would. Budgeted the same way too - retrySpec caps at max_retries + 1 attempts
  // and settles, leaving the rejection for the caller, when that budget is gone.
  // A setgoal whose spec failed validation is the same defect found one node earlier: the engine
  // knows exactly what is wrong (spec_problems) and nothing else can fix it but a new spec.
  // portfolio-consolidate's PLAN:2 (2026-09-28) wrote one "document" subgoal in a planning run;
  // the child blocked at 1/3 with its retries unspent, and the manager paid for a third planning
  // run from scratch.
  const specRejected = n.stage === 'setgoal' && !n.final && n.state === 'failed'
    && Array.isArray(n.result && n.result.spec_problems) && n.result.spec_problems.length > 0;
  if (specRejected || (n.stage === 'critique' && !n.final)) {
    if (n.state !== 'failed') return null;
    if (!specRejected && n.result && n.result.stage_ok !== true) return null;
    if (!specRejected && (!n.result || n.result.sound !== false)) return null;
    const feedback = specRejected
      ? [`the spec was rejected before critique: ${n.result.reason || ''}`, ...n.result.spec_problems].join('\n- ')
      : [n.result.reason || '', ...(n.result.blocking || [])].filter(Boolean).join('\n- ')
        || 'critique found the spec unsound (sound: false)';
    const out = retrySpec(run, feedback);
    // retrySpec's own cleanup sweeps every setgoal/critique node still `pending` or
    // `failed` to `skipped` as "superseded by spec attempt N" - including THIS node,
    // since it is a critique node too. That is right for a stale prior attempt; it is not
    // right for the node that just ran and whose own verdict this call is about to return.
    // Put it back the way finishNode left it before handing back to verdict().
    n.state = 'failed';
    saveRun(run);
    record(run.cwd, {
      event: out.attempt ? 'team_escalate' : 'team_settle',
      run_id: run.run_id, rejected_by: n.node_id,
      ...(out.attempt ? { attempt: out.attempt } : { unreachable: out.unreachable.length }),
    });
    return { ...out, escalated: true };
  }
  if (!n.subgoal_id || n.final) return null;
  if (!VERDICT_FIELD[n.stage]) return null;
  if (n.state !== 'failed') return null;
  // Only the verdict reassigns. A node that could not run at all (transport, vendor,
  // malformed output) is a different failure and keeps its existing path.
  if (n.result && n.result.stage_ok !== true) return null;
  const sid = String(n.subgoal_id);

  // Same objection twice: retrying the subgoal again would ask the same author, in the same
  // worktree, for the same thing. Escalate to the line that can actually change the answer -
  // setgoal and critique - carrying what the subgoal kept failing on. goal-docs is the case
  // this exists for: a package README truthfully said "the repo has no other docs", which was
  // false only in the combined tree, so no attempt inside that package could ever fix it.
  const sig = rejectionSig(n.result);
  if (sig && sig === priorSig(run, sid, n.attempt || 1)) {
    const out = retrySpec(run, `subgoal ${sid} was rejected twice for the same reason, so the shape is what has to change, not the work:\n- ${subgoalFeedback(run, sid)}`);
    record(run.cwd, {
      event: out.attempt ? 'team_escalate' : 'team_settle',
      run_id: run.run_id, subgoal_id: sid, rejected_by: n.node_id, signature: sig,
      ...(out.attempt ? { attempt: out.attempt } : { unreachable: out.unreachable.length }),
    });
    return { ...out, escalated: true };
  }

  const out = retrySubgoal(run, sid, subgoalFeedback(run, sid));
  if (out.attempt) out.rollback = applyRollback(out.run, out.rollback, sid);
  record(run.cwd, {
    event: out.attempt ? 'team_reassign' : 'team_settle',
    run_id: run.run_id, subgoal_id: n.subgoal_id, rejected_by: n.node_id,
    ...(out.attempt ? { attempt: out.attempt } : { unreachable: out.unreachable.length }),
  });
  return out;
}

// The card a person reads. Shared by the two ways a node reaches waiting_human: promoted here
// when a pin becomes ready, or born there by openAsk at the moment its investigate dep is
// submitted. tm_inbox has to point the main session at SOMETHING readable, and it is the same
// briefing a fresh agent would have read - not a second document invented for a human.
export function writeHumanBriefing(run, n) {
  const briefingPath = join(brokerDir(run.cwd), run.run_id, 'briefings', `${n.node_id.replace(/[^A-Za-z0-9._-]/g, '_')}.md`);
  try {
    mkdirSync(dirname(briefingPath), { recursive: true });
    writeFileSync(briefingPath, composePrompt(run, n, nodeBriefing(run, n)));
    n.briefing_path = briefingPath;
  } catch {
    /* tm_inbox falls back to team_status full:true */
  }
}

export function finishNode(run, n, result, vendorName) {
  delete n.recovery; // historical interruptions remain in n.interruptions
  // Blocked is not a verdict: whatever verdict fields rode along are dropped, and the node fails
  // and counts as an attempt like any other failed node. First, so no later rule reads them.
  if (toolDenied(result)) {
    const { match_pct, accept, gaps, ...rest } = result;
    result = { ...rest, stage_ok: false, reason: 'blocked: tool denied' };
  }
  // A gate that says accept with nothing in checks[] did not fail the work - it failed to
  // do its own job. That is a defect in the judging, not a verdict on the subgoal, so it
  // must read as one and it must not autoReassign the subgoal the way a real rejection
  // does (autoReassign skips a node whose stage_ok did not come back true - see below).
  // The gate itself is retried the ordinary way: team_retry({subgoal_id}) - the engine has
  // no path that reruns a gate alone, so that rebuilds the whole chain, gate included.
  const noChecks = n.stage === 'gate' && result.accept === true
    && !(Array.isArray(result.checks) && result.checks.length > 0);
  // Same rule, one level up: the goal gate accepting with no `attacks[]` judged nothing
  // outside the tree - see nodeSucceeded.
  const noAttacks = n.stage === 'gate' && !n.subgoal_id && result.accept === true
    && !(Array.isArray(result.attacks) && result.attacks.length > 0);
  const gateNoEvidence = noChecks || noAttacks;
  // An authoring node's own stage_ok is not a verdict on its work - the chain's test and gate
  // are. An author that reports stage_ok:false with no reason, no error and only passing checks
  // has mis-set a flag, not failed: trap-beta-T2's P3 did exactly that twice ("66 tests, 66
  // pass, 0 fail", "clean working tree after commit", stage_ok:false) and each time the chain
  // treated the self-report as final, made the gate unreachable, blocked the child and sent
  // the whole package back to attempt 1. The flag is kept on the result for the gate to see,
  // and the work goes on to be judged. A stated reason, an error, or a failing check is honoured.
  if (!REASONING_STAGES.has(n.stage) && result.stage_ok === false && !result.reason && !result.error
    && !result.verification_error && !(result.contradicted_files || []).length && result.submitted_stage_ok !== true) {
    const checks = Array.isArray(result.checks) ? result.checks : [];
    const failing = checks.some((c) => /\b(fail(ed|ing|s)?|error|ENOENT|exit(ed)? [1-9]|not ok)\b/i.test(String(c)) && !/\b0 fail/i.test(String(c)));
    if (!failing) {
      result = {
        ...result, stage_ok: true, self_reported_stage_ok: false,
        stage_ok_note: 'author reported stage_ok:false with no reason and no failing check; the test and gate nodes judge the work, not the author',
      };
    }
  }
  n.state = nodeSucceeded(run, n, result) ? 'done' : 'failed';
  if (gateNoEvidence && n.state === 'failed') {
    result = { ...result, stage_ok: false, reason: noChecks
      ? 'gate accepted without a check; a judgement with no evidence is a guess'
      : 'goal gate accepted without an attack; a judgement never invoked from outside the tree is a guess' };
  }
  // A rejection the judging machinery itself produced (stage_ok:true, verdict field false) can
  // still leave `reason` empty: review's and test's schema never had a reason field at all - only
  // `checks`/`evidence` describe why verified came back false - and a gate or critique can in
  // principle reject with empty gaps/blocking too. Downstream (runlog.mjs classify, triage.mjs
  // groups) reads only `reason`, so an unfilled one surfaced as e.g. "P4 review:U1:1: (empty)" -
  // a real rejection with no visible cause. execute is excluded: its own verified:false is a
  // passing case-set run carrying defects forward, not a failure (see nodeSucceeded above).
  if (n.state === 'failed' && result.stage_ok === true && n.stage !== 'execute') {
    const synthesized = reasonFromVerdict(result, VERDICT_FIELD[n.stage]);
    if (synthesized) result = { ...result, reason: synthesized };
  }
  n.result = result;
  n.vendor = vendorName;
  n.finished_at = Date.now();

  // setgoal is the only node that changes the shape of the graph. Expanding here keeps
  // the spec out of the orchestrator entirely - but only for a spec that can actually
  // be expanded. A bad one is failed here with its defects as the reason, so the normal
  // spec-retry loop carries them into the next attempt instead of deadlocking later.
  // plan is where an `auto` run learns its flow and size. A plan that names neither is
  // not failed - the earlier contract never asked - it falls to the develop flow, and the
  // record says the choice was defaulted rather than made.
  if (n.stage === 'plan' && n.state === 'done') {
    if (run.flow === 'auto') {
      const chosen = FLOWS[result.flow] ? result.flow : DEFAULT_FLOW;
      run.flow_chosen = chosen;
      run.flow_source = FLOWS[result.flow] ? 'plan' : 'default';
    }
    run.size = ['S', 'L'].includes(result.size) ? result.size : null;
  }
  if (n.stage === 'setgoal' && n.state === 'done') {
    const spec = normalizeSpec(run, result.spec);
    const problems = validateSpec(spec, { kind: defaultKind(run), mixed: run.mixed, flow: flowOf(run), max_subgoals: run.max_subgoals });
    if (problems.length) {
      n.state = 'failed';
      n.result = { ...result, stage_ok: false, spec_problems: problems, reason: `unusable spec: ${problems.join('; ')}` };
    } else {
      run.spec = spec;
      n.result = { ...result, spec };
      expandSubgoals(run, spec.subgoals);
    }
  }
  // investigate is the second node that can change the shape of the graph, and for the same
  // reason setgoal is the first: it produces something the rest of the chain has to be built
  // around. An unknown that names candidate answers is a decision, not a research gap - so an
  // interactive run opens an `ask` card for it (parked on a human, never polled for a model)
  // and draft consumes the answer instead of the question. A non-interactive run records the
  // same questions on run.unasked, which is what makes "we decided this by default, and here
  // is what we would have asked" legible in the report instead of invisible in the document.
  // An execution-phase package run (§6.2-3, _repo/docs/plans/2026-09-28-teams-light-plan.md) asks no
  // one on its own card, interactive or not: every new question is decided by default and
  // recorded, and only a blocking one is kept for the task manager to park once at EPIC level.
  if (run.execution_phase === true && n.state === 'done') {
    const raw = [
      ...(n.stage === 'investigate' && Array.isArray(result.unknowns) ? result.unknowns : []),
      ...(Array.isArray(result.questions) ? result.questions : []),
    ];
    if (raw.length) routeExecutionQuestions(run, n, raw);
  } else if (n.stage === 'investigate' && n.state === 'done') {
    const decidable = (Array.isArray(result.unknowns) ? result.unknowns : [])
      .filter((u) => u && (u.question || u.unknown) && Array.isArray(u.options) && u.options.length > 1);
    if (decidable.length) {
      if (run.interactive) {
        for (const askId of openAsk(run, n, decidable)) writeHumanBriefing(run, getNode(run, askId));
      }
      else run.unasked = [...(run.unasked || []), ...decidable.map((u) => ({
        subgoal_id: n.subgoal_id, question: u.question || u.unknown, owner: u.owner || null, options: u.options,
      }))];
    }
  }
  // Deterministic sibling write-scope check (item 2 of the reducer plan): recorded onto the
  // fold's own persisted result, not only shown in the briefing gate:goal reads afterward - so
  // a collision or undeclared writer this run's own `reduce` LLM pass missed is still on disk,
  // and foldChild (taskmanager.mjs) can carry it up into set_findings regardless of whether the
  // model noticed the same thing in prose.
  if (n.stage === 'reduce' && n.state === 'done') {
    n.result = { ...n.result, write_scope: computeWriteScope(run, n) };
  }
  // D2 slice 3 (0.29.0): the same treatment, generalized past investigate's own unknowns[] -
  // any stage's contract may return `questions[]` ({question, to, options?, default, why}, see
  // openAsk's own comment) and the engine opens the same kind of card for it. Kept as a second
  // block, not folded into the one above, so investigate's own unknowns[] (and its report shape
  // on run.unasked) stay exactly as they were for every existing caller and test.
  if (run.execution_phase !== true && n.state === 'done' && Array.isArray(result.questions) && result.questions.length) {
    const decidable = result.questions.filter((q) => q && q.question
      && ((Array.isArray(q.options) && q.options.length > 1) || q.default !== undefined));
    if (decidable.length) {
      if (run.interactive) {
        for (const askId of openAsk(run, n, decidable)) writeHumanBriefing(run, getNode(run, askId));
      } else {
        run.unasked = [...(run.unasked || []), ...decidable.map((q) => ({
          subgoal_id: n.subgoal_id, node_id: n.node_id, stage: n.stage,
          question: q.question, owner: q.to || null, options: q.options || null,
          decided: q.default !== undefined ? q.default : null, why: q.why || null,
        }))];
      }
    }
  }
  // One save, after autoReassign: a rejected gate and the retry chain it opens must land on
  // disk together. Saved separately, the run is 'blocked' on disk for the gap between the two
  // writes, and a reader woken by fs.watch on the first rename (the task-manager daemon's
  // dispatchSettled) folds the dispatch as failed while this driver is already on attempt 2 -
  // seam-silent-beta-E1 (2026-09-21) lost P1 exactly there.
  const reassigned = autoReassign(run, n);
  saveRun(run);
  syncOpenNodes(run);
  record(run.cwd, { event: 'node_finish', run_id: run.run_id, node_id: n.node_id, stage: n.stage, vendor: vendorName, stage_ok: n.result.stage_ok === true });
  const out = verdict(run, n);
  if (reassigned) {
    if (reassigned.repaired || reassigned.stalled !== undefined) {
      // Goal-gate consensus rejected the round: a repair pass opens over the assembled
      // result rather than reassigning a subgoal, or the run is stalled on a repair
      // that closed the same gaps twice. As visible as `reassigned` is for a subgoal.
      if (reassigned.repaired) out.repaired = reassigned.repaired;
      if (reassigned.stalled) {
        out.stalled = { reason: 'repair rejected the same gaps twice; the run proceeds to report on partial work' };
      } else if (reassigned.stalled === false && reassigned.settled) {
        out.repaired = { attempt: null, reason: reassigned.reason };
      }
    } else {
      const where = reassigned.escalated ? 'spec' : 'subgoal';
      out.reassigned = reassigned.attempt
        ? { target: where, subgoal_id: n.subgoal_id, attempt: reassigned.attempt,
            ...(reassigned.escalated ? { reason: 'the same rejection twice: reshaped rather than retried' } : {}) }
        : { target: where, subgoal_id: n.subgoal_id, attempt: null, reason: reassigned.reason, unreachable: reassigned.unreachable };
    }
    if (reassigned.rollback) out.rollback = reassigned.rollback;
  }
  return out;
}

export function checkpointInterruption(run, n, executor, details, kind = 'quota') {
  const dir = join(brokerDir(run.cwd), run.run_id, n.node_id.replace(/[^A-Za-z0-9._-]/g, '_'), `recovery-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'checkpoint.json');
  const detailPath = join(dir, 'interrupted-result.json');
  writeFileSync(detailPath, JSON.stringify(details, null, 2));
  writeFileSync(path, JSON.stringify({ node_id: n.node_id, executor, kind, cwd: run.cwd,
    detail_path: detailPath, previous_detail_path: n.detail_path || null,
    previous_checkpoint: n.recovery?.checkpoint_path || null,
    run_path: join(brokerDir(run.cwd), 'runs', `${run.run_id}.json`),
    changed_files: (gitChanged(run.cwd) || []).filter(p => !p.startsWith('.teams_output/')),
    instruction: 'Inspect the current files before continuing. Partial writes are not verified completion. Keep original acceptance criteria; rerun verification.' }, null, 2));
  n.recovery = { checkpoint_path: path, executor, kind, from_ticket: n.ticket || null };
  n.interruptions = [...(n.interruptions || []), n.recovery];
  n.result = { stage_ok: false, reason: `${executor} ${kind}; work retained at ${path}` };
  n.vendor = executor;
  n.state = 'pending';
  n.ticket = null;
  delete n.assignment;
  if (kind === 'quota') run.unavailable_vendors = { ...(run.unavailable_vendors || {}), [executor]: 'usage capacity exhausted in this run' };
  saveRun(run);
  syncOpenNodes(run);
  record(run.cwd, { event: 'node_interrupted', run_id: run.run_id, node_id: n.node_id, executor, kind, checkpoint_path: path });
  return { ...verdict(run, n), recoverable: true, checkpoint_path: path, next: 'call team_next for fallback; team_retry with node_id and reset_capacity after quota renewal' };
}

// Pure: the result and pass/fail verdict a node's payload earns, worktree cross-check included
// - no write, not even to `run` on disk (mutating the node's in-memory object is fine; nothing
// here calls saveRun). team_submit's own body below is this plus finishNode's apply-and-persist
// step; the TaskManager's tm_submit({key}) (taskmanager.mjs) imports this SAME function to
// preview a human's submission - a claimed changed_files gets the identical cross-check an AI's
// would - without ever writing the child run itself (design §7: "changed_files는 워크트리 대조로
// 똑같이 검증"; the 0.27.3 review, 2026-09-24, is what this replaced - see graph.mjs's
// queueHumanAction for the mechanism).
export function computeSubmitResult(run, n, payload, vendorName) {
  const independence = reviewIndependence(run, n, n.executor || vendorName, n.model);
  let result;
  if (REASONING_STAGES.has(n.stage)) {
    result = { ...payload, stage_ok: payload.stage_ok !== false, ...(independence ? { reviewer_independence: independence.independence } : {}) };
  } else {
    const check = crossCheck(run.cwd, payload.changed_files, run.isolated, nodeKind(run, n), attributionBase(run, n));
    const contradicted = check.contradicted_files.length > 0;
    result = {
      ...payload,
      submitted_stage_ok: payload.stage_ok === true,
      stage_ok: payload.stage_ok === true && !contradicted,
      ...check,
      verification_error: contradicted
        ? `claimed changed_files not present in the worktree: ${check.contradicted_files.join(', ')}`
        : '',
      ...(independence ? { reviewer_independence: independence.independence } : {}),
    };
  }
  return { result, done: nodeSucceeded(run, n, result) };
}

// The apply-and-persist half: computeSubmitResult plus finishNode's state transition, autoReassign
// and saveRun. team_submit calls this for a self-executed node; ingestHandoff (mustFindRun, in
// broker-routing.mjs) calls it for a human's queued submission - same function either way.
export function submitResult(run, n, payload, vendorName) {
  const { result } = computeSubmitResult(run, n, payload, vendorName);
  return finishNode(run, n, result, vendorName);
}
