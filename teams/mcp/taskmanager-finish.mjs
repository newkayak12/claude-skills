// taskmanager-finish.mjs - verdicts: a node settling, the verdict, the finish of a stage; split out of taskmanager.mjs (card 128 step 1), moved verbatim.
import { DEFAULT_KIND, FLOWS, KINDS, appendDecisions, getNode, kindOf, loadRun, nextIndex, openAsk, pushChain, reasonFromVerdict, saveRun } from './graph.mjs';
import { TEAM_DEFAULTS } from './teamconfig.mjs';
import { compareOnBase, exclusionLine, failingTests, resolveBase } from './basefail.mjs';
import { livePlanningPkgs, phaseOfId, planningPkgs, planningStories, qaPkgs, ticketSnapshot } from './tickets.mjs';
import { placeholderAcceptance } from './shapecheck.mjs';
import { record } from './taskstate.mjs';
import { EVIDENCED, PACKAGE_CHAIN, VERDICT, drawShape, escalateBlocking, foldBrainstorm } from './taskmanager-stages.mjs';
import { JUDGE_ATTEMPTS_MAX, fileDefects, fileUpstreamDefects, notDoneIds, openAudit, reproGate, settleQaRound } from './taskmanager-repair.mjs';
import { areaOverlapBlocking, areasOf, expandAcceptedSplit, expandPackages, expandPlanning, preparePlanIntegration, replanPlanning, resplitPlanning, storyDuplicates, validateAreas, validateShape } from './taskmanager-plan.mjs';
import { budgetStatus } from './taskmanager-budget.mjs';
import { foldPackageHistory } from './taskmanager-children.mjs';
import { noDriver, packageOf } from './taskmanager-worktree.mjs';
import { syncTickets } from './taskmanager-handlers.mjs';
import { writeManagerBriefing } from './taskmanager-prompts.mjs';

// ---------- verdicts ----------

export function succeeded(task, n, result) {
  if (result.stage_ok !== true) return false;
  const f = VERDICT[n.stage];
  if (!f) return true;
  if (result[f] !== true) return false;
  // The manager's own goal gate is held to the same floor the graph engine holds its
  // goal gate to: accept:true at 40% match is reporting a partial result as a pass.
  // There is no per-package gate in the manager - every 'gate' node here IS the goal gate.
  // And by that same reading `accept` IS the gate for its package, so it gets the same floor:
  // without one, match_pct was decorative on every accept node. idol-pm-1's PRD was accepted at
  // 88% by a judgement whose own text said the document named nothing specific to the domain
  // ("fan-club"/"팬클럽"/"presale" zero times) - the number was recorded and nothing acted on it.
  // A rejection here is not the end of the package: it buys the retry max_retries already
  // budgets, with the gaps that cost it the points carried into the next attempt.
  // An accept below the floor fails only when the judge named something missing. The gate
  // contract tells a judge that a run which met its bar with known weaknesses is not a 100, and
  // observations never block - so an accept:true with gaps[] empty lands at 87-88 by design, and
  // the floor was turning those points into a rejection the judge never made. idol-pm-4
  // (2026-09-23): P2 and P5 accepted at 88 with no gaps, both failed, both rebuilt from scratch.
  // idol-pm-1's PRD, the case the floor exists for, named its gap - it still fails.
  if ((n.stage === 'gate' || n.stage === 'accept') && Number.isFinite(result.match_pct)) {
    const floor = Number.isInteger(task.goal_threshold) ? task.goal_threshold : 90;
    // A gap that names a failure also failing on the base (excludeBaseFailures) does not count.
    const excluded = Array.isArray(result.base_excluded) ? result.base_excluded : [];
    const named = Array.isArray(result.gaps) && result.gaps.some((g) => !excluded.some((e) => String(g).includes(e.test)));
    // accept:QA is the exception: its points are docked for the defects it files, and filing them
    // is what fixes them. Failing it on the floor dropped the defects (the file hook runs only on
    // 'done') and reran the whole QA on the same tree (awake-beta-ref1: accept:QA:2 accepted at
    // 72 with a real defect filed, failed on the floor, dispatch:QA:3 reopened over the same bug).
    const filesDefects = n.stage === 'accept' && phaseOfId(task, n.subgoal_id) === 'qa'
      && Array.isArray(result.defects) && result.defects.length > 0;
    // A goal gate after a budget/timebox sweep judges a Sprint that deliberately left packages
    // undone: its match against the WHOLE goal sits below the floor by construction (code-sprint-S6:
    // accept:true at 72 with three of four backlog items shipped, failed on the floor, no report).
    // The judge's own accept stands; the shortfall is what the retro's Next backlog carries.
    const boxedGoal = n.stage === 'gate' && String(n.node_id).startsWith('gate:goal')
      && ((task.budget_stopped && (task.budget_stopped.skipped_packages || []).length > 0) || notDoneIds(task).length > 0);
    if (result.match_pct < floor && (n.stage === 'gate' || named) && !filesDefects && !boxedGoal) return false;
  }
  // A rejection needs no evidence of its own. A positive verdict does: dispatch's accept
  // is computed by the manager itself from the folded child and is exempt, but gate,
  // accept and integrate are judgements a fresh agent returned, and accept:true/verified:true
  // with nothing in checks[] is a guess wearing a verdict.
  if (EVIDENCED.has(n.stage) && !(Array.isArray(result.checks) && result.checks.length > 0)) {
    return false;
  }
  return true;
}

// A gap the judge says belongs to another package (or to nobody) is not this package's shortfall:
// the accept's out_of_scope[] = [{gap, belongs_to}] moves those gaps to observations before the
// floor decision, so an 88 whose only gap is a sibling's settles accepted. belongs_to is 'none' or
// the id of another ordinary package in task.spec.packages (not this one, not a phase or repair
// package); a gap text under 8 characters is too loose to match on. An invalid entry is ignored and
// its gap stays. match_pct and accept are never touched. Fails closed: any throw leaves the gap.
export function scopeGaps(task, n, result) {
  try {
    if (n.stage !== 'accept' || result.stage_ok !== true) return result;
    if (!Array.isArray(result.out_of_scope) || !result.out_of_scope.length || !Array.isArray(result.gaps)) return result;
    const packages = (task.spec && Array.isArray(task.spec.packages)) ? task.spec.packages : [];
    const valid = result.out_of_scope.filter((e) => {
      if (!e || typeof e.gap !== 'string' || e.gap.trim().length < 8 || typeof e.belongs_to !== 'string') return false;
      if (e.belongs_to === 'none') return true;
      if (e.belongs_to === String(n.subgoal_id)) return false;
      const pkg = packages.find((p) => String(p.id) === e.belongs_to);
      return !!pkg && !pkg.phase && !pkg.repair;
    });
    if (!valid.length) return result;
    const moved = [];
    const hit = new Set();
    const gaps = result.gaps.filter((g) => {
      const e = valid.find((x) => String(g) === x.gap || String(g).includes(x.gap));
      if (!e) return true;
      hit.add(e);
      moved.push(`out of scope (belongs to ${e.belongs_to}): ${String(g)}`);
      return false;
    });
    if (!moved.length) return result;
    return {
      ...result, gaps,
      observations: [...(Array.isArray(result.observations) ? result.observations : []), ...moved],
      scoped_out: [...hit].map((e) => ({ gap: e.gap, belongs_to: e.belongs_to })),
    };
  } catch {
    return result;
  }
}

// Test seam only: the runner compareOnBase uses for the base side. null runs the real command.
export const __baseFail = { run: null };

// An output line that says its command failed, for a check whose output carries no TAP names.
const FAILED_OUTPUT = /(?:^|[^\d])[1-9]\d*\s+(?:fail|failed|failing)\b|\bexit(?:ed)?(?:\s+(?:code|status))?\s*[:=]?\s*[1-9]/i;

// card 39 F1-US-3: a failing check of a package's accept that also fails on the commit the
// package branched from is not the package's doing. Only that check runs on the base (twice, in
// compareOnBase's temp worktree), each exclusion is written under the package as
// exclusionLine(...), and succeeded() leaves the floor alone when those were the only gaps.
// Fails closed: any throw, a base that cannot run or an empty comparison excludes nothing.
function excludeBaseFailures(task, n, result) {
  try {
    if (result.stage_ok !== true || result.accept !== true) return result;
    const found = failingOnBase(task, n, result);
    if (!found) return result;
    recordBaseExclusions(task, n, found);
    return { ...result, base_excluded: found.excluded, exclusions: found.excluded.map(exclusionLine) };
  } catch {
    return result;
  }
}

// The compare half, shared by excludeBaseFailures and excludeBaseBeforeJudge: the failing checks of
// `evidence` ({checks, match_pct, gaps}) run on the package's base commit. {baseSha, excluded} or null.
function failingOnBase(task, n, evidence) {
  const pkg = packageOf(task, n.subgoal_id);
  if (!pkg || pkg.phase || pkg.repair) return null;
  if (noDriver() && !__baseFail.run) return null; // test seam: nothing is spawned
  const floor = Number.isInteger(task.goal_threshold) ? task.goal_threshold : 90;
  const below = Number.isFinite(evidence.match_pct) && evidence.match_pct < floor && Array.isArray(evidence.gaps) && evidence.gaps.length > 0;
  const failing = (Array.isArray(evidence.checks) ? evidence.checks : []).map((c) => {
    const s = String(c);
    const i = s.indexOf(' -> ');
    return i < 0 ? null : { command: s.slice(0, i).trim(), output: s.slice(i + 4) };
  }).filter((c) => c && c.command && (failingTests(c.output).length || (below && FAILED_OUTPUT.test(c.output))));
  if (!failing.length) return null;
  const d = task.nodes.find((x) => x.stage === 'dispatch' && x.subgoal_id === n.subgoal_id && (x.attempt || 1) === (n.attempt || 1));
  if (!d || !d.child || !d.child.cwd) return null;
  const baseSha = resolveBase({ cwd: d.child.cwd, baseCommit: d.base_commit, branch: d.child.branch, baseRef: task.base_ref });
  const excluded = failing.flatMap((c) => compareOnBase({
    cwd: d.child.cwd, baseSha, command: c.command, packageOutput: c.output, packageExit: 1,
    ...(__baseFail.run ? { run: __baseFail.run } : {}),
  }).excluded);
  return excluded.length ? { baseSha, excluded } : null;
}

// The record half: the exclusions under the package (deduped by test) and one ledger line.
export function recordBaseExclusions(task, n, { baseSha, excluded }) {
  const id = String(n.subgoal_id);
  const known = (task.base_exclusions && task.base_exclusions[id]) || [];
  task.base_exclusions = { ...(task.base_exclusions || {}), [id]: [...known, ...excluded.filter((e) => !known.some((k) => k.test === e.test))] };
  record(task, { event: 'base_failures_excluded', task_id: task.run_id, node_id: n.node_id, package_id: id, base: baseSha, excluded: excluded.map((e) => e.test) });
}

// Before the judge scores an attempt: the failures its child's goal gate named (checks[] of the run
// file; the dispatch result keeps only gaps and the report) that the base commit has too. Base runs
// take minutes, so the daemon calls this on a snapshot OUTSIDE any transaction and persists the
// returned {baseSha, excluded} with recordBaseExclusions in a mutateTask. null: nothing excluded.
export function excludeBaseBeforeJudge(task, n) {
  try {
    if (n.stage !== 'accept') return null;
    const d = task.nodes.find((x) => x.stage === 'dispatch' && x.subgoal_id === n.subgoal_id && (x.attempt || 1) === (n.attempt || 1));
    if (!d || !d.child || !d.child.cwd || !d.child.run_id) return null;
    const child = loadRun(d.child.cwd, d.child.run_id);
    const gate = child && Array.isArray(child.nodes)
      ? child.nodes.filter((x) => x.stage === 'gate' && x.subgoal_id === null && x.result && x.state !== 'skipped').pop() : null;
    return gate ? failingOnBase(task, n, gate.result) : null;
  } catch {
    return null;
  }
}

function verdict(task, n) {
  const r = n.result || {};
  const out = {
    task_id: task.run_id,
    node_id: n.node_id,
    stage: n.stage,
    state: n.state,
    stage_ok: r.stage_ok === true,
  };
  const f = VERDICT[n.stage];
  if (f) out[f] = r[f] === true;
  if (n.stage === 'size' && r.size) { out.size = r.size; if (r.flow) out.flow = r.flow; }
  if (['accept', 'gate', 'dispatch'].includes(n.stage)) {
    if (r.match_pct !== undefined) out.match_pct = r.match_pct;
    out.gap_count = (r.gaps || []).length;
  }
  if (n.stage === 'dispatch' && n.child) out.child = { cwd: n.child.cwd, run_id: n.child.run_id, branch: n.child.branch, ...(r.commit ? { commit: r.commit } : {}) };
  if ((r.conflicting_packages || []).length) { out.conflicts = r.conflicts; out.conflicting_packages = r.conflicting_packages; }
  if (n.stage === 'integrate' && n.integration) out.integration = { cwd: n.integration.cwd, branch: n.integration.branch, merged: (n.integration.merged || []).length };
  if (n.state === 'failed' && r.stage_ok === true && f && r[f] === undefined) out.missing_verdict = f;
  const reason = String(r.reason || '');
  if (reason) out.reason = reason.slice(0, 300);
  return out;
}

// Gap 2 (judge≠author): the manager's own reasoning nodes - shape, critique, accept, integrate,
// gate, gate:goal - all run through daemon.mjs's judge(), one identical `claude -p` invocation
// per node (that file's own comment on judge()): no vendor is ever selected among candidates and
// no executor/vendor is ever recorded on a manager node, unlike a package's dispatch/accept
// chain, which broker.mjs routes and tags normally. routing.mjs's AUTHOR_OF same-actor penalty
// only nudges a CHOICE among ranked candidates, and judge() offers no choice to nudge - "route
// it away" (the same phrase openAudit's own gap answers with externalAuthorOf) has no move to
// make here today, since nothing stands ready to run critique or accept on a second identity.
// What is still owed, and what this gives, is the honest half of broker.mjs's own
// reviewIndependence pattern: recording reviewer_independence rather than asserting an
// independence this path cannot back up. Both sides of a manager judgement are the same
// untracked host identity by construction (`self`, the same word broker.mjs's own identityOf
// falls back to for an executor it cannot see), so this always reads 'unverifiable-self' -
// never 'distinct-identity', because nothing here could prove that even when accept's own
// package really did land on a peer vendor (broker.mjs's normal cross-vendor routing still
// applies to a package's own dispatch/accept chain - only the MANAGER's own nodes are exempt
// from it): the manager's own side of the comparison has no identity of its own to compare
// with, so "unverifiable" is the honest word regardless of what the other side turns out to be.
function managerReviewerIndependence(task, n) {
  if (n.stage === 'critique') {
    const shape = task.nodes.filter((x) => x.stage === 'shape' && x.state === 'done').pop();
    return shape ? 'unverifiable-self' : null;
  }
  if (n.stage === 'accept') {
    const dispatch = task.nodes.find((x) => x.stage === 'dispatch' && x.subgoal_id === n.subgoal_id
      && x.node_id === n.node_id.replace(/^accept:/, 'dispatch:'));
    const child = dispatch && dispatch.child ? loadRun(dispatch.child.cwd, dispatch.child.run_id) : null;
    if (!child) return null;
    const sg = child.spec && Array.isArray(child.spec.subgoals) ? child.spec.subgoals[0] : null;
    if (!sg) return null;
    const chain = (KINDS[kindOf(sg)] || KINDS[DEFAULT_KIND]).chain;
    // Any mutating (non-final) stage of the chain having a done node is enough to say
    // "this package was authored" - which specific stage (implement/draft/execute) does not
    // matter here, unlike planAuthorIdentity's audit-side need for the actual identity: accept
    // has no identity of its own to compare against, so only "was there an author" is asked.
    const authored = chain.slice(0, -1).some((stage) => child.nodes.some((x) => x.stage === stage
      && x.subgoal_id === String(sg.id) && x.state === 'done'));
    return authored ? 'unverifiable-self' : null;
  }
  return null;
}

// Who judged a node: vendor·model the daemon's judge() or a person stamped on it, else (a dispatch)
// the last child-run node the broker tagged with an executor. null when nothing recorded one.
function actorOf(n) {
  if (n.vendor) return n.model ? `${n.vendor}·${n.model}` : n.vendor;
  if (n.stage !== 'dispatch' || !n.child) return null;
  const child = loadRun(n.child.cwd, n.child.run_id);
  const tagged = child && Array.isArray(child.nodes) ? child.nodes.filter((x) => x.executor && x.state === 'done').pop() : null;
  if (!tagged) return null;
  n.vendor = tagged.executor;
  if (tagged.model) n.model = tagged.model;
  return actorOf(n);
}

const short = (s) => String(s).slice(0, 300);

// One ledger line per settled judge node (status panes design 2026-10-14): a re-judge resets the
// node, so without this the earlier verdict is gone from task.json.
function recordVerdict(task, n) {
  const r = n.result || {};
  const f = VERDICT[n.stage];
  const verdict = n.state === 'done' ? f : r.blocked ? 'blocked' : r.judge_failed === true ? 'judge_failed' : 'reject';
  const why = r.reason || [r.blocking, r.problems, r.gaps].flatMap((x) => (Array.isArray(x) ? x : []))
    .map((x) => (typeof x === 'object' ? (x.text || JSON.stringify(x)) : String(x))).join('; ');
  record(task, {
    event: 'verdict', task_id: task.run_id, node_id: n.node_id, stage: n.stage,
    ...(n.subgoal_id ? { subgoal_id: n.subgoal_id } : {}), ...(n.attempt ? { attempt: n.attempt } : {}),
    actor: actorOf(n), verdict, score: Number.isFinite(r.match_pct) ? r.match_pct : null, reason: why ? short(why) : null,
  });
}

// A person's answer as one line for the ledger: decisions as "question: chose", a gate's reason,
// else the payload itself.
function answerText(payload) {
  const p = payload || {};
  if (Array.isArray(p.decisions)) return short(p.decisions.map((d) => `${(d && d.question) || ''}: ${d && d.chose !== undefined ? d.chose : ''}`).join('; '));
  if (typeof p.accept === 'boolean') return short(`${p.accept ? 'accept' : 'reject'}${p.reason ? `: ${p.reason}` : ''}`);
  return short(JSON.stringify(p));
}

export function finish(task, n, result) {
  // A node settling is what moves a ticket, and it is the one place both callers pass through -
  // tm_submit and the daemon alike. Hooking the caller instead left the whole surface stale
  // between steps, and a daemon step is a whole judge call long (2026-09-22).
  const ticketsBefore = ticketSnapshot(task);
  // A judge denied a tool it needed (daemon.mjs judgeDenials) judged nothing: the node is recorded
  // blocked, never rejected - no reject is counted, no retry feedback is built (autoRetryPackages,
  // autoReshape and integrateToRepair skip a blocked result), and it is not judge_failed, so
  // autoRejudge leaves it alone. The task reads blocked until a person allows the tool.
  if (result && result.blocked && result.stage_ok !== true) {
    n.state = 'failed';
    n.result = result;
    n.finished_at = Date.now();
    saveRun(task);
    if (VERDICT[n.stage]) recordVerdict(task, n);
    record(task, { event: 'node_finish', task_id: task.run_id, node_id: n.node_id, stage: n.stage, stage_ok: false, state: n.state, ...(n.subgoal_id ? { subgoal_id: n.subgoal_id } : {}), ...(n.attempt ? { attempt: n.attempt } : {}) });
    try { syncTickets(task, ticketsBefore, n.node_id); } catch { /* evidence, not a dependency */ }
    return verdict(task, n);
  }
  // The merges the manager made are part of the integrate node's account.
  if (n.stage === 'integrate' && n.integration) {
    result = { ...result, integration_branch: n.integration.branch, integration_cwd: n.integration.cwd,
      merged: (n.integration.merged || []).map((m) => `${m.package} ${m.branch} -> ${m.commit}`) };
  }
  if (n.stage === 'accept') result = excludeBaseFailures(task, n, scopeGaps(task, n, result));
  const reviewerIndependence = managerReviewerIndependence(task, n);
  if (reviewerIndependence) result = { ...result, reviewer_independence: reviewerIndependence };
  const f = VERDICT[n.stage];
  const floor = Number.isInteger(task.goal_threshold) ? task.goal_threshold : 90;
  const belowFloor = n.stage === 'gate' && f && result[f] === true
    && Number.isFinite(result.match_pct) && result.match_pct < floor;
  if (belowFloor && task.budget_stopped && (task.budget_stopped.skipped_packages || []).length && String(n.node_id).startsWith('gate:goal')) {
    result = { ...result, goal_floor_waived: `budget/timebox stopped the Sprint with ${task.budget_stopped.skipped_packages.join(', ')} undone; match_pct ${result.match_pct} is judged against the whole goal` };
  } else if (belowFloor && notDoneIds(task).length && String(n.node_id).startsWith('gate:goal')) {
    result = { ...result, goal_floor_waived: `retries ran out with ${notDoneIds(task).join(', ')} not done; match_pct ${result.match_pct} is judged against the whole goal` };
  }
  const noEvidence = EVIDENCED.has(n.stage) && f && result[f] === true
    && !(Array.isArray(result.checks) && result.checks.length > 0);
  // Two areas planning the same edit is a collision, not advice: a model judge's sound:true does
  // not outrank it (a person's gate does - D3). The existing re-split path carries the lines.
  if (n.stage === 'areas-critique' && !n.human_gate && result.stage_ok === true) {
    const split = areasOf(task, n);
    const added = areaOverlapBlocking(split && split.result && split.result.areas, result, [...(result.blocking || [])]);
    if (added.length) result = { ...result, sound: false, blocking: [...(result.blocking || []), ...added], reason: `file ownership overlap between areas: ${added.join('; ')}` };
  }
  n.state = succeeded(task, n, result) ? 'done' : 'failed';
  if (n.state === 'failed' && belowFloor) {
    // The judging itself worked - it is the number that overrules the word, exactly as
    // the graph engine's own goal gate is held to its floor.
    result = { ...result, reason: `match_pct ${result.match_pct} below the goal threshold ${floor}` };
  } else if (n.state === 'failed' && noEvidence) {
    // A rejection needs no evidence of its own; a positive verdict does. This is the
    // manager's own judging failing to do its job, not a verdict on the work it judged.
    result = { ...result, stage_ok: false, reason: `${n.stage} returned a positive verdict without a check; a judgement with no evidence is a guess` };
  } else if (n.state === 'failed' && result.stage_ok === true && f) {
    // A real rejection that named no reason (and no gaps/blocking): integrate's schema has only
    // checks/evidence/unowned, so portfolio-consolidate-8518d5dd's integrate:6 reached the
    // ledger, report and triage as "integrate:6: " - the broker's own rule, at manager level.
    const synthesized = reasonFromVerdict(result, f);
    if (synthesized) result = { ...result, reason: synthesized };
  }
  n.result = result;
  n.finished_at = Date.now();

  // Manager-level reduce (item 4): every package's declared fold - who changed what, its
  // verdicts across attempts, defects, cost if a dispatch ever reports one - carried through
  // the same registry foldChild and the run-level reduce use. Attached once integrate settles,
  // since that is the point every package this round touches has a dispatch result to fold.
  if (n.stage === 'integrate' && n.state === 'done') {
    n.result = { ...n.result, package_fold: foldPackageHistory(task) };
  }

  if (n.stage === 'size' && n.state === 'done') {
    if (!['S', 'L'].includes(result.size)) {
      n.state = 'failed';
      n.result = { ...result, stage_ok: false, reason: 'size returned neither S nor L' };
    } else {
      task.size = result.size;
      if (task.flow === 'auto') task.flow_chosen = FLOWS[result.flow] ? result.flow : null;
    }
  }
  // The EPIC's plan stage (C2): its feature areas become planning cards, the planning integrate
  // behind them, and shape/critique behind that. A split with nothing to open is a failed stage,
  // retried by autoReshape with its problems as feedback.
  if (n.stage === 'areas' && n.state === 'done') {
    const problems = validateAreas(result);
    if (problems.length) {
      n.state = 'failed';
      n.result = { ...result, stage_ok: false, area_problems: problems, reason: `unusable feature split: ${problems.join('; ')}` };
    } else if (!livePlanningPkgs(task).length && !task.nodes.some((x) => x.stage === 'areas-critique' && x.deps.includes(n.node_id))) {
      expandPlanning(task, result.areas, [n.node_id], { withShape: true });
      record(task, { event: 'planning_cards_opened', task_id: task.run_id, node_id: n.node_id, cards: planningPkgs(task).map((p) => p.id) });
    }
  }
  // M4: the split's own gate. Accepted: its cards open. Refused: a failed critique, which
  // autoReshape re-splits with the blocking defects as feedback (retryAreas, same budget).
  if (n.stage === 'areas-critique' && n.state === 'done') expandAcceptedSplit(task, n);
  // The planning integrate (C4). Story ids that collide across cards are a fact the manager
  // counted (preparePlanIntegration), not a judgement: they refuse the merge whatever the judge
  // said. Accepted: a size-S task opens its one run now (C6), with the merged PRD as context; an
  // L task's shape is already waiting on this node. Refused with a verdict: the offending cards go
  // back (replanPlanning). A judge that never judged is left to autoRejudge.
  if (n.stage === 'plan-integrate') {
    // Submitted without passing through tm_next/the daemon's prepare step: merge now, so the
    // collision check and 10-prd.md never depend on which path the verdict arrived by.
    if (!n.prd) preparePlanIntegration(task, n);
    const dups = (n.prd && n.prd.duplicates) || storyDuplicates(planningStories(task));
    if (dups.length) {
      const dupText = dups.map((x) => `${x.id} (${x.cards.join(', ')})`).join(', ');
      if (n.state === 'done') {
        n.state = 'failed';
        n.result = { ...n.result, accept: false, reason: `story ids collide across planning cards: ${dupText}` };
      }
      n.result = { ...n.result, duplicate_ids: dups, duplicates: [...new Set([...(n.result.duplicates || []), ...dups.map((x) => `${x.id} -> ${x.cards.join(', ')}`)])] };
    }
    // Acceptance that is a pointer or an id list is no criterion: mechanical like the duplicates.
    const placeholders = placeholderAcceptance(planningStories(task));
    if (placeholders.length) {
      if (n.state === 'done') {
        const ids = [...new Set(placeholders.map((x) => x.story))].join(', ');
        n.state = 'failed';
        n.result = { ...n.result, accept: false, reason: `story acceptance is a placeholder or a bare id list, not criteria: ${ids}` };
      }
      n.result = { ...n.result, placeholder_acceptance: placeholders };
    }
    if (n.state === 'failed' && n.result.judge_failed !== true) {
      if (n.result.resplit === true) resplitPlanning(task, n);
      else replanPlanning(task, n);
    }
  }
  if (n.stage === 'shape' && n.state === 'done') {
    // The merged PRD's stories, every planning card's (C4) - shape's implements[] must cover all.
    const userStories = livePlanningPkgs(task).length ? planningStories(task) : null;
    const problems = validateShape(result, userStories);
    if (problems.length) {
      n.state = 'failed';
      n.result = { ...result, stage_ok: false, shape_problems: problems, reason: `unusable shape: ${problems.join('; ')}` };
    } else {
      task.spec = {
        acceptance: result.acceptance,
        packages: result.packages.map((p, i) => ({ ...p, id: String(p.id), priority: Number.isInteger(p.priority) ? p.priority : i })),
      };
      expandPackages(task, task.spec.packages);
      drawShape(task, result);
    }
  }
  // A QA card's accept carries defects (§5b), not a pass/fail on the card itself - `accept:QA-Fn:N`
  // still finishes 'done' whether or not it found any. The round's join (settleQaRound) files every
  // card's defects together once the last card of the round has settled, capped by qa_rounds;
  // beyond the cap they are recorded for the report's "unresolved defects" section and the EPIC
  // proceeds to the goal gate (C7).
  if (n.stage === 'accept' && phaseOfId(task, n.subgoal_id) === 'qa' && n.state === 'done') {
    settleQaRound(task);
  }
  // §upstream_defects: ANY package's accept (not just QA/AUDIT) can carry these - foldChild reads
  // them off the child's own implement/test/gate regardless of package phase, and the base accept
  // contract (above) tells every judge to relay them through. File each as a fix STORY owned by
  // the upstream package's own scope, and reopen THIS package's own next attempt wired onto the
  // fix instead of blindly repeating what just passed against a still-broken dependency.
  if (n.stage === 'accept' && n.state === 'done' && Array.isArray(result.upstream_defects) && result.upstream_defects.length) {
    fileUpstreamDefects(task, n.subgoal_id, result.upstream_defects);
  }
  // Every integrate that finishes reroutes gate:goal behind it (see fileDefects/reintegrateBehind
  // above and retryPackage's own re-integrate loop) - so "an integrate just finished" is the one
  // moment that generalizes over both "the first round" (expandPackages already wired QA ahead of
  // time, at shape) and "a later round" (a filed defect's fix, where nothing has wired QA yet).
  // Reopen a fresh QA round here, lazily, only when nothing already depends on THIS integrate for
  // QA - which is deliberately what makes the phase-Team exemption above still safe: by the time
  // any integrate reaches 'done', every package it depends on is already done too (integrate's own
  // deps are every one of those accepts), so the QA dispatch this opens is never concurrent with a
  // develop STORY dispatch that fed into it.
  if (n.stage === 'integrate' && n.state === 'done'
    && task.team && task.team.opts && task.team.opts.roles && task.team.opts.roles.qa) {
    // QA judges the tree THIS integrate built: its worktree (repairWorktree) and the budget
    // close path's goal-gate rewire (closeStoppedToReport) both read integration_of, which used
    // to stay on the first integrate forever - portfolio-consolidate's close found integrate:1
    // (skipped) there and skipped gate:goal instead of rewiring it onto integrate:2.
    for (const q of qaPkgs(task)) q.integration_of = n.node_id;
    const alreadyWired = task.nodes.some((x) => x.stage === 'dispatch' && phaseOfId(task, x.subgoal_id) === 'qa' && x.deps.includes(n.node_id));
    // A stopped box dispatches nothing, so a fresh QA round now could only ever be skipped.
    if (!alreadyWired && !task.budget_stopped && qaPkgs(task).length) {
      const goal = task.nodes.filter((x) => x.stage === 'gate' && x.subgoal_id == null).pop();
      // One round number for every card of the round, so QA-F1:2 and QA-F2:2 read as one round.
      const qaRound = Math.max(...qaPkgs(task).map((q) => nextIndex(task, `dispatch:${q.id}`)));
      const qaAccepts = qaPkgs(task).map((q) => pushChain(task, PACKAGE_CHAIN, String(q.id), qaRound, [n.node_id], [], {}));
      if (goal) goal.deps = qaAccepts;
    }
  }
  // planning's second pass (§2, decision #4). The trigger is "the node gate:goal is waiting on
  // just finished": accept:QA:N when roles.qa is on, the integrate itself when it is off. Reading
  // gate:goal's own dep rather than the node's stage alone is what keeps this from firing on a
  // round that ended in defects - fileDefects (above) has already rerouted gate:goal to a fresh
  // integrate by the time this runs, so the audit waits for the fix instead of auditing a tree
  // that is about to be rebuilt.
  // The `&& !roles.qa` on the integrate branch below looks like it is keeping this from firing
  // on an integrate that QA still needs to see, but it is dead: verified by mutation (removed it,
  // the full suite - including the roles.qa-on tests above - stayed green). When roles.qa is on,
  // the QA-reopen hook just above ALWAYS runs first for the same finishing integrate node and
  // rewrites goal.deps to a fresh accept:QA:N before this line ever reads it, so the `goal.deps[0]
  // === n.node_id` check two lines down is already false by the time it matters - the `!roles.qa`
  // never gets to be the reason. When roles.qa is off, `!roles.qa` was true anyway, so it changes
  // nothing there either. Left in (not deleted) because it reads as documentation of intent - "do
  // not open the audit out from under a pending QA round" - even though the reopen hook's own
  // side effect on goal.deps is what actually enforces that.
  const roles = (task.team && task.team.opts && task.team.opts.roles) || {};
  // roles.audit defaults true, paired with roles.planning exactly like before this key existed
  // (teamconfig.mjs) - so a project that never sets it keeps today's behaviour, and one that
  // sets `roles: {audit: false}` keeps the rest of planning without the post-integration pass.
  // With QA split into one card per feature area (C7) the goal gate waits on a whole round of QA
  // accepts: the audit opens once the LAST of them is done (and settleQaRound above filed nothing
  // - filing reroutes the goal gate onto a fresh integrate, and this no longer matches).
  if (roles.planning && roles.audit !== false && n.state === 'done'
    && ((n.stage === 'accept' && phaseOfId(task, n.subgoal_id) === 'qa') || (n.stage === 'integrate' && !roles.qa))) {
    const goal = task.nodes.filter((x) => x.stage === 'gate' && x.subgoal_id == null).pop();
    const allDone = goal && goal.deps.every((d) => { const x = task.nodes.find((y) => y.node_id === d); return x && x.state === 'done'; });
    if (goal && goal.deps.includes(n.node_id) && allDone) {
      // Past the box's warning line an audit is a new Team the box cannot pay for, and whatever
      // it finds cannot be fixed inside it: code-sprint-P5 opened AUDIT:1 at ~95%, it cost $5.14
      // after the stop, and its death took the goal gate with it.
      const box = budgetStatus(task);
      if (task.budget_stopped || box.warn) {
        record(task, { event: 'audit_skipped', task_id: task.run_id, reason: 'budget', pct: Math.round(box.pct * 100) });
      } else openAudit(task, goal.deps.slice());
    }
  }
  // An unmet user story the audit named is filed exactly like a QA-found defect - same STORY
  // path, same detour through a fresh integrate - under its own reporter, and capped by the same
  // qa_rounds knob for the same reason: a pass that can file work which reopens the pass needs a
  // bound, and a second knob for the second such pass would only be two numbers to keep in step.
  if (n.stage === 'accept' && n.subgoal_id === 'AUDIT' && n.state === 'done') {
    const unmet = reproGate(task, (Array.isArray(result.unmet) ? result.unmet : [])
      .map((u) => (u && typeof u === 'object' ? u : { title: String(u), evidence: '' })), 'audit');
    if (unmet.length) {
      const rounds = task.nodes.filter((x) => x.stage === 'accept' && x.subgoal_id === 'AUDIT').length;
      const cap = Number.isInteger(task.team && task.team.opts && task.team.opts.qa_rounds)
        ? task.team.opts.qa_rounds : TEAM_DEFAULTS.qa_rounds;
      if (rounds > cap) {
        task.unresolved_defects = (task.unresolved_defects || []).concat(unmet.map((u) => ({ ...u, reporter: 'audit', origin: 'planning-audit', round: rounds })));
      } else {
        const out = fileDefects(task, unmet, { reporter: 'audit', origin: 'planning-audit' });
        // What 65-audit.md links. Kept on the node rather than recomputed from the package list
        // because a later round's STORYs would be indistinguishable from this one's.
        n.result = { ...n.result, filed: out.filed };
      }
    }
  }
  // task.decisions (_repo/docs/plans/2026-09-28-teams-light-plan.md §6.2/§6.5). Before the questions[]
  // block below: foldBrainstorm decides what reaches it.
  // The brainstorm is advice the task can proceed without, not a gate: once it has no rejudge left
  // (autoRejudge), a failed one is closed as done with nothing decided, rather than leaving
  // PLAN/shape unreachable behind it.
  if (n.stage === 'brainstorm' && n.state === 'failed'
    && !(n.result.judge_failed === true && (n.judge_attempts || 0) < JUDGE_ATTEMPTS_MAX)) {
    n.state = 'done';
    n.result = { ...n.result, stage_ok: true, brainstorm_failed: n.result.reason || 'brainstorm returned stage_ok:false', questions: [] };
  }
  else if (n.stage === 'brainstorm' && n.state === 'done') foldBrainstorm(task, n, n.result);
  // §6.2-1: each planning card's own decisions, written once, at the accept that ends that card -
  // a card is folded once (task.plan_decisions_folded lists the cards already written), so a
  // replan's later attempt of the same card cannot write a second, different list.
  if (n.stage === 'accept' && phaseOfId(task, n.subgoal_id) === 'planning' && n.state === 'done') {
    // A task.json from before the split recorded one boolean for its one PLAN package.
    const folded = Array.isArray(task.plan_decisions_folded) ? task.plan_decisions_folded : (task.plan_decisions_folded ? ['PLAN'] : []);
    if (!folded.includes(String(n.subgoal_id))) {
      const d = task.nodes.find((x) => x.stage === 'dispatch' && x.subgoal_id === n.subgoal_id && (x.attempt || 1) === (n.attempt || 1));
      appendDecisions(task.decisions || (task.decisions = []), (d && d.result && d.result.plan_decisions) || []);
      task.plan_decisions_folded = [...folded, String(n.subgoal_id)];
    }
  }
  if (n.stage === 'dispatch' && n.state === 'done' && Array.isArray(result.blocking_questions) && result.blocking_questions.length) {
    escalateBlocking(task, n, result.blocking_questions);
  }
  // A person's answer on any task-level card is the task's answer from here on - every package
  // opened after this reads it as settled. A brainstorm question they left unanswered keeps the
  // engine's default.
  if (n.stage === 'ask' && n.state === 'done' && Array.isArray(n.result.decisions)) {
    const list = task.decisions || (task.decisions = []);
    appendDecisions(list, n.result.decisions, { owner: 'requester', decided_in: n.ask_owner === 'EPIC' ? 'EPIC' : (n.ask_owner || 'task'), source: 'ask' });
    if (n.ask_owner === 'brainstorm') appendDecisions(list, n.questions || [], { owner: 'engine', decided_in: 'brainstorm', source: 'self-brainstorm' });
  }
  // D2 slice 3 (0.29.0): the manager graph's own judging/deciding stages (shape, critique,
  // accept, integrate, gate, gate:goal) get the same `questions[]` treatment the child-run
  // graph's stages do (broker.mjs's finishNode, its own comment explains the contract shape) -
  // reused unmodified because task.json is itself a run (openAsk/getNode work over any
  // object with `.nodes`). Manager-level cards get a briefing written explicitly, the way
  // writeHumanBriefing does for a child run - toolNext's own ready-node loop never sees an
  // `ask` node because openAsk parks it 'waiting_human' at birth, never 'pending'.
  if (n.state === 'done' && Array.isArray(n.result.questions) && n.result.questions.length) {
    const decidable = n.result.questions.filter((q) => q && q.question
      && ((Array.isArray(q.options) && q.options.length > 1) || q.default !== undefined));
    if (decidable.length) {
      if (task.interactive) {
        for (const askId of openAsk(task, n, decidable)) writeManagerBriefing(task, getNode(task, askId));
      } else {
        task.unasked = [...(task.unasked || []), ...decidable.map((q) => ({
          subgoal_id: n.subgoal_id, node_id: n.node_id, stage: n.stage,
          question: q.question, owner: q.to || null, options: q.options || null,
          decided: q.default !== undefined ? q.default : null, why: q.why || null,
        }))];
      }
    }
  }
  saveRun(task);
  if (VERDICT[n.stage]) recordVerdict(task, n);
  record(task, { event: 'node_finish', task_id: task.run_id, node_id: n.node_id, stage: n.stage, stage_ok: n.result.stage_ok === true, state: n.state, ...(n.subgoal_id ? { subgoal_id: n.subgoal_id } : {}), ...(n.attempt ? { attempt: n.attempt } : {}) });
  try { syncTickets(task, ticketsBefore, n.node_id); } catch { /* evidence, not a dependency */ }
  return verdict(task, n);
}

export { answerText, verdict };
