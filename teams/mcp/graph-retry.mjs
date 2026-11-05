// graph-retry.mjs - settled failure and the three retries (cut from graph.mjs).
//
// settleFailure marks what can never run once a retry budget is gone; retryReport, retrySubgoal
// and retrySpec spend that budget by pushing a fresh attempt. Builds on graph-kinds, graph-nodes,
// graph-pins, graph-goalgate and graph-runfile.

import { KINDS, DEFAULT_KIND, kindOf, authorStage } from './graph-kinds.mjs';
import { node, getNode, pushChain } from './graph-nodes.mjs';
import { applyHumanPin } from './graph-pins.mjs';
import { goalRoundOf, goalGateSiblings, pushGoalGateRound } from './graph-goalgate.mjs';
import { saveRun } from './graph-runfile.mjs';

// The gate that closes a subgoal's attempt, by its kind - the last stage in the chain.
function gateStage(kind) {
  const { chain } = KINDS[kind] || KINDS[DEFAULT_KIND];
  return chain[chain.length - 1];
}

// Failure becomes definitive at exactly one point: when the retry budget is gone.
// Until then a failed node is a retry waiting to happen, and nothing downstream may be
// written off. Once it is definitive, everything that needs the node's output through a
// data edge can never run - mark it `unreachable` with the reason, transitively, so the
// graph says so instead of sitting `blocked` with a pile of `pending` nodes. A node that
// already failed downstream is final too: no retry of it can succeed with a dead upstream.
// Order-only edges do not propagate; that is what they are for.
export function settleFailure(run, root) {
  if (!root || root.state !== 'failed') return [];
  const touched = [];
  root.final = true;
  const queue = [root];
  while (queue.length) {
    const x = queue.shift();
    const why = x.state === 'failed' ? `${x.node_id} failed with no retry left` : `${x.node_id} is unreachable`;
    for (const n of run.nodes) {
      if (!n.deps.includes(x.node_id)) continue;
      if (n.state === 'pending') {
        n.state = 'unreachable';
        n.result = { stage_ok: false, reason: `unreachable: ${why}` };
        touched.push(n.node_id);
        queue.push(n);
      } else if (n.state === 'failed' && !n.final) {
        n.final = true;
        touched.push(n.node_id);
        queue.push(n);
      }
    }
  }
  return touched;
}

// A failed report is retried alone: the report writes from the ledger and nothing upstream
// depends on it, so re-pending that one node (not rebuilding a subgoal chain) is the whole
// repair. Pure like the rest of this file. It spends report_attempts against the same budget a
// subgoal has (run.max_retries + 1 retries), and settles the failure when that is gone. A node
// that is not a failed, non-interrupted report is refused without being touched.
// opts: node_id (which report; default the latest failed one), avoid_executors (executors the
// re-route tries last), different_vendor (avoid whoever ran the failed attempt).
export function retryReport(run, feedback, opts = {}) {
  const refuse = (reason) => ({ run, attempt: null, refused: true, reason });
  const n = opts.node_id
    ? getNode(run, String(opts.node_id))
    : run.nodes.filter((x) => x.stage === 'report' && x.state === 'failed').at(-1);
  if (!n || n.stage !== 'report') return refuse('node_id must identify a failed report node');
  if (n.state !== 'failed' || !n.result || n.result.stage_ok !== false || n.recovery) {
    return refuse('node_id must identify a failed report node');
  }
  const attempts = n.report_attempts || 0;
  if (attempts >= run.max_retries + 1) {
    const unreachable = settleFailure(run, n);
    return { run: saveRun(run), attempt: null, reason: 'retry budget exhausted', unreachable };
  }

  const prev = n.result;
  const gaps = Array.isArray(prev.gaps) ? prev.gaps : [];
  const fb = [feedback, prev.reason || prev.verification_error, ...gaps].filter(Boolean).join('\n- ');
  const asg = n.assignment || {};
  const ranBy = n.executor || asg.executor || n.vendor;
  const avoid = [...new Set([
    ...(Array.isArray(opts.avoid_executors) ? opts.avoid_executors.map(String) : []),
    ...(opts.different_vendor && ranBy && ranBy !== 'self' && ranBy !== 'human' ? [ranBy] : []),
  ])];

  n.state = 'pending';
  n.ticket = null;
  n.result = null;
  delete n.assignment;
  delete n.final;
  delete n.executor;
  delete n.model;
  delete n.finished_at;
  n.feedback = fb;
  n.report_attempts = attempts + 1;
  if (avoid.length) n.avoid_executors = avoid; else delete n.avoid_executors;
  // mergeOnto refuses failed -> pending unless `reopened` outruns the disk copy.
  n.reopened = (n.reopened || 0) + 1;
  return { run: saveRun(run), attempt: n.report_attempts, node_id: n.node_id };
}

// A rejected subgoal gets a fresh attempt rather than a retried node: the old attempt
// stays in the graph as evidence of what was tried and why it failed.
export function retrySubgoal(run, subgoalId, feedback) {
  const sg = ((run.spec && run.spec.subgoals) || []).find((x) => String(x.id) === String(subgoalId));
  const kind = kindOf(sg);
  const gateOf = gateStage(kind);
  const prior = run.nodes.filter((n) => n.subgoal_id === subgoalId && n.stage === gateOf);
  const attempt = prior.length + 1;
  if (attempt > run.max_retries + 1) {
    const dead = run.nodes.filter((n) => n.subgoal_id === subgoalId && n.state === 'failed' && !n.final);
    const unreachable = dead.flatMap((n) => settleFailure(run, n));
    return { run: saveRun(run), attempt: null, reason: 'retry budget exhausted', unreachable };
  }

  const prevGate = `${gateOf}:${subgoalId}:${attempt - 1}`;

  // The previous attempt may have died at implement, leaving its test and gate pending
  // forever. Retire them: a node waiting on a dep that can never complete is a dead
  // loop, and a dep on a failed node never satisfies.
  for (const n of run.nodes) {
    if (n.subgoal_id === subgoalId && (n.attempt || 1) === attempt - 1 && n.state === 'pending') {
      n.state = 'skipped';
      n.result = { stage_ok: false, reason: `superseded by attempt ${attempt}` };
    }
  }

  // The new attempt starts from the upstream its own generation had, not from the attempt
  // that just failed - every attempt in a generation copies the same baseDeps, so the latest
  // head node carries it. Reading the *earliest* head node instead was a run-killer: after a
  // spec-level retry re-expands the subgoals, attempt 1's deps name gate nodes that retry
  // skipped as superseded, so the new attempt was born waiting on the dead generation and
  // could never become ready. Observed in a live run, which then blocked with the goal gate
  // and two subgoals never reached and a retry budget spent on a node nothing was waiting for.
  const headStage = (KINDS[kind] || KINDS[DEFAULT_KIND]).chain[0];
  const heads = run.nodes.filter((x) => x.subgoal_id === subgoalId && x.stage === headStage);
  const live = heads.filter((x) => !(x.state === 'skipped' && x.result && /superseded/.test(x.result.reason || '')));
  const head = (live.length ? live : heads).at(-1);
  const baseDeps = head ? head.deps.slice() : ['critique'];
  const baseAfter = head ? (head.after || []).slice() : [];

  // rollback (_repo/docs/plans/2026-09-23-teams-reducer-human-rollback.md §5): reset the worktree to
  // the checkpoint broker.mjs recorded before this subgoal's OWN first attempt touched it, i.e.
  // the state that had already cleared every gate upstream of this subgoal - not a checkpoint
  // from any later attempt, which would itself carry a still-uncommitted, still-failing edit.
  // Guarded to a run with exactly one subgoal: a shared worktree with siblings still working in
  // it cannot be reset for one subgoal without also discarding theirs (no per-subgoal commit
  // exists to reset around - nothing commits until the whole package folds, taskmanager.mjs's
  // commitWorktree). The caller (broker.mjs's team_retry) performs the actual git reset; this
  // function only decides and reports the target, staying pure like the rest of this file.
  const authorNodesFor = (att) => run.nodes.filter((x) => x.subgoal_id === subgoalId && x.stage === authorStage(kind) && (x.attempt || 1) === att);
  const soleSubgoal = ((run.spec && run.spec.subgoals) || []).length <= 1;
  const firstAuthor = authorNodesFor(1)[0];
  let rollback = null;
  if (run.retry_policy === 'rollback') {
    if (!soleSubgoal) rollback = { skipped: true, reason: `run has ${(run.spec.subgoals || []).length} subgoals sharing one worktree; rollback would also discard their work, so this retry continues instead` };
    else if (!firstAuthor || !firstAuthor.checkpoint) rollback = { skipped: true, reason: 'no checkpoint was recorded for this subgoal\'s first attempt; continuing instead' };
    else rollback = { checkpoint: firstAuthor.checkpoint, node_id: firstAuthor.node_id };
  }

  const gate = pushChain(run, (KINDS[kind] || KINDS[DEFAULT_KIND]).chain, subgoalId, attempt, baseDeps, baseAfter, { feedback: feedback || '' });
  // A subgoal the spec pinned to a human stays pinned on its next attempt too - a rejection
  // must send the SAME card back to waiting_human, never quietly hand the retry to a model.
  applyHumanPin(run, sg, subgoalId, attempt);

  // Anything that waited on the old attempt's gate must wait on the new one.
  for (const n of run.nodes) {
    if (n.node_id === gate) continue;
    n.deps = n.deps.map((d) => (d === prevGate ? gate : d));
    n.after = (n.after || []).map((d) => (d === prevGate ? gate : d));
  }
  // A goal gate retired by an earlier failure would strand the rebuilt attempt.
  for (const n of run.nodes) {
    if (n.stage === 'gate' && n.subgoal_id === null && n.state === 'skipped' && n.deps.includes(gate)) {
      n.state = 'pending';
      n.result = null;
    }
  }
  // A fold that already ran folded the set as it was BEFORE this retry, and the rewire above
  // just moved its data edge onto an attempt it has never seen. Leaving it `done` hands the
  // goal gate a stale reading of the artifacts and, worse, one that looks current. Send it
  // back to pending so it folds what is actually on disk now.
  for (const n of run.nodes) {
    if (n.stage === 'reduce' && n.state === 'done' && n.deps.includes(gate)) {
      n.state = 'pending';
      n.result = null;
      // mergeOnto refuses done -> pending unless `reopened` outruns the disk copy, which is
      // how it keeps one broker from undoing another's progress. This is the same deliberate
      // reopen autoRejudge makes, so it says so the same way; without the bump the reset is
      // written and silently merged away, and the fold stays stale.
      n.reopened = (n.reopened || 0) + 1;
    }
  }
  // A goal gate that REJECTED is a different case: it ran, and its verdict is evidence. The
  // retried subgoal will pass or fail on its own, but nothing re-judged the whole - the old
  // gate stayed `failed`, the report stayed behind it, and the run wedged with the fix in
  // place. Open a fresh goal-gate ROUND (every judge, not just the one whose deps happen to
  // name this gate) over the live subgoal gates, carrying the rejection as feedback, and move
  // the report behind it. The old round stays, as every failed attempt does.
  // Matched on `after` as well as `deps` since `reduce` began carrying the data edge: a goal
  // gate over a multi-subgoal run now depends on the fold and keeps the subgoal gates as
  // order-only edges, so a deps-only lookup found no stale round and silently opened none -
  // the retried subgoal rebuilt the tree and nothing re-judged it.
  const staleRounds = [...new Set(
    run.nodes
      .filter((n) => n.stage === 'gate' && n.subgoal_id === null && !n.final
        && (n.deps.includes(gate) || (n.after || []).includes(gate)))
      .map((n) => goalRoundOf(n.node_id))
      .filter((r) => r != null),
  )];
  for (const round of staleRounds) {
    const siblings = goalGateSiblings(run, round);
    if (siblings.some((s) => s.state === 'pending' || s.state === 'running')) continue; // still live, not stale
    const rejecting = siblings.filter((s) => s.state === 'failed');
    if (!rejecting.length) continue; // the round accepted; nothing stale to replace
    const fb = rejecting
      .flatMap((old) => [old.result && old.result.reason, ...((old.result && old.result.gaps) || [])])
      .filter(Boolean).join('\n- ');
    const { ids: fresh } = pushGoalGateRound(run, siblings[0].deps.slice(), { feedback: fb, supersedes: siblings.map((s) => s.node_id), ...((siblings[0].after || []).length ? { after: siblings[0].after.slice() } : {}) }, run.goal_judges || siblings.length);
    const oldIds = new Set(siblings.map((s) => s.node_id));
    for (const n of run.nodes) {
      if (!n.after || !n.after.some((d) => oldIds.has(d))) continue;
      n.after = [...new Set([...n.after.filter((d) => !oldIds.has(d)), ...fresh])];
    }
  }
  return { run: saveRun(run), attempt, reason: '', rollback };
}

// A critique that rejects the spec has nowhere to go otherwise: team_retry only knows
// subgoals, so the run would dead-end holding a spec everyone agrees is wrong. Redo
// setgoal with the critique's problems, and discard the subgoal graph the old spec
// produced - a new spec may decompose differently.
export function retrySpec(run, feedback) {
  const priors = run.nodes.filter((n) => n.stage === 'setgoal');
  const attempt = priors.length + 1;
  if (attempt > run.max_retries + 1) {
    const dead = run.nodes.filter((n) => (n.stage === 'setgoal' || n.stage === 'critique') && n.state === 'failed' && !n.final);
    const unreachable = dead.flatMap((n) => settleFailure(run, n));
    return { run: saveRun(run), attempt: null, reason: 'retry budget exhausted', unreachable };
  }

  for (const n of run.nodes) {
    // `repair` joins the run-level stages retired here: escalation discards the
    // subgoal graph a rejected spec produced, and a pending repair over that graph's
    // goal gate has nothing left to fix. A repair already RUNNING cannot be retired -
    // its commits are already in the tree, and it stays in the graph as evidence of
    // what was tried, exactly like a retried subgoal's superseded attempt.
    if (n.stage === 'setgoal' || n.stage === 'critique' || n.subgoal_id || n.stage === 'report'
      || n.stage === 'repair' || (n.stage === 'gate' && n.subgoal_id === null)) {
      if (n.state === 'pending' || n.state === 'failed') {
        n.state = 'skipped';
        n.result = n.result || { stage_ok: false, reason: `superseded by spec attempt ${attempt}` };
      }
    }
  }
  run.spec = null;

  const sg = `setgoal:${attempt}`;
  const cr = `critique:${attempt}`;
  run.nodes.push(node(sg, 'setgoal', ['plan'], { attempt, feedback: feedback || '' }));
  run.nodes.push(node(cr, 'critique', [sg], { attempt }));
  return { run: saveRun(run), attempt, reason: '' };
}
