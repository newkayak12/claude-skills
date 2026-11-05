// taskmanager-repair.mjs - repair, defect STORYs, upstream defects, the audit phase-Team; split out of taskmanager.mjs (card 128 step 1), moved verbatim.
import { loadRun, nextIndex, node, pushChain, saveRun, settleFailure } from './graph.mjs';
import { docPaths, latestBySubgoal, livePlanningPkgs, packageFiling, phaseOfId, planningPkgs, planningStories, qaPkgs, storyLabel } from './tickets.mjs';
import { record, resolveHarnessRun } from './taskstate.mjs';
import { spawnSync } from 'node:child_process';
import { TEAM_DEFAULTS } from './teamconfig.mjs';
import { existsSync } from 'node:fs';
import { PACKAGE_CHAIN, bullets } from './taskmanager-stages.mjs';
import { integrationTrees, noDriver, packageOf } from './taskmanager-worktree.mjs';
import { replanPlanning, retryAreas, retryPackage, retryShape, shapeFeedback, touchesOverlap } from './taskmanager-plan.mjs';
import { nextSpawnAttempt, spawnChildDriver } from './taskmanager-drivers.mjs';
import { respawnDriver } from './taskmanager-claims.mjs';
import { spawnHarnessDriver } from './taskmanager-harness.mjs';

// ---------- repair: the package whose worktree is the integration tree ----------

// A seam is a defect that exists only in the combined tree: package P2's README example needs
// something P4 installed, two packages' exports disagree about a name. tm_retry({package_id})
// cannot reach it - it reopens that package in its OWN worktree, where the offending claim is
// still true and the defect does not reproduce. `goal-docs` round 2 ended settled-failure
// exactly there: every package accepted, integrate refusing twice, and no tool that could see
// what integrate saw. The answer is a package whose worktree IS the integration tree.
//
// Which integrate that would be, or why it is not one. Returns {node} or {error}: the caller
// throws, and the error has to name what to call instead - a manager session that gets an
// unhelpful refusal here has nowhere left to go.
function integrateToRepair(task) {
  const last = task.nodes.filter((x) => x.stage === 'integrate').pop();
  if (!last) {
    return { error: 'this task has integrated nothing yet, so there is no combined tree to repair. '
      + 'Retry a package with tm_retry({task_id, package_id}), or reshape with tm_retry({task_id}).' };
  }
  if (last.state !== 'failed') {
    return { error: `${last.node_id} is ${last.state}, not failed: a repair package exists to make a failed integrate's checks pass, and there is nothing here to repair`
      + (last.state === 'pending' ? '. Run it first - tm_next hands you its briefing.' : '.') };
  }
  const r = last.result || {};
  if (r.judge_failed === true) {
    return { error: `${last.node_id} was never judged (${String(r.reason || '').slice(0, 120)}); it is re-judged, not repaired.` };
  }
  if (r.blocked) {
    return { error: `${last.node_id} was blocked (${String(r.reason || '').slice(0, 120)}), not judged; allow the tool and tm_retry it instead of repairing.` };
  }
  if (r.verified === true) {
    return { error: `${last.node_id} verified the combined tree; its failure is not a seam. Fix what its stage_ok=false named, or retry the package its checks blame with tm_retry({task_id, package_id}).` };
  }
  if ((r.conflicts || []).length) {
    const ids = (r.conflicting_packages || []).map((x) => `"${x}"`).join(', ');
    return { error: `${last.node_id} failed on a merge conflict (${r.conflicts.join(', ')}), not on its checks: two packages own the same path, which is a shape failure and no repair can fix it. `
      + `tm_retry({task_id, repackage: [${ids}]}) reshapes them together.` };
  }
  if (!last.integration || !last.integration.cwd) {
    return { error: `${last.node_id} never reached a combined tree (${r.reason || 'it failed before the merges'}), so there is nothing for a repair package to work in.` };
  }
  if (task.nodes.some((x) => x.supersedes === last.node_id)) {
    return { error: `${last.node_id} has already been superseded; run the integrate that replaced it instead.` };
  }
  return { node: last };
}

// Opens a fresh `integrate:N` depending on `acceptIds` and reroutes every node that referenced
// `oldId` in its deps/after (gate:goal chief among them) to the fresh integrate instead -
// marking `supersedes: oldId` for evidence. The one move both a repair (one package's accept)
// and a filed defect STORY (one or more packages' accepts, §5b) make once their fix needs a
// fresh combined tree: openRepair and fileDefects both call this instead of each inlining their
// own copy of the rewiring loop.
// oldId may be a list: with one QA card per feature area (C7) the goal gate waits on several
// QA accepts at once, and a filed defect reroutes it off all of them onto the one fresh integrate.
function reintegrateBehind(task, oldId, acceptIds, feedback) {
  const olds = Array.isArray(oldId) ? oldId.map(String) : [String(oldId)];
  const fresh = `integrate:${nextIndex(task, 'integrate')}`;
  task.nodes.push(node(fresh, 'integrate', acceptIds.slice(), { subgoal_id: null, feedback: feedback || '', supersedes: olds[0] }));
  const swap = (list) => [...new Set(list.map((d) => (olds.includes(d) ? fresh : d)))];
  for (const x of task.nodes) {
    if (x.node_id === fresh) continue;
    x.deps = swap(x.deps);
    x.after = swap(x.after || []);
  }
  return fresh;
}

// Packages a spent retry budget left not done, once the one integrate over the rest has opened:
// the exhausted ones and everything that waits on them. Every coupling that used to key on
// task.budget_stopped alone (the undeliverable filter, the judges' scope, the goal floor) reads this.
function notDoneIds(task) {
  const ex = task.exhausted;
  return (ex && ex.reintegrated && Array.isArray(ex.not_done)) ? ex.not_done : [];
}

// card 39 (E-32e8068c, 2026-10-18): P1 spent its retries, settleFailure wrote the integrate, QA
// and gate:goal off, and the accepted P2 never reached an integration tree. Once nothing is
// running and every other package is accepted, ONE integrate opens over the accepted ones and
// what settleFailure wrote off behind the old integrate comes back, as rescueQaRound does for a
// QA card. A dependent of a not-done package is not done and is not merged. Zero accepted opens
// nothing; the guard is task.exhausted.reintegrated, like task.budget_stopped.reintegrated.
export function reintegrateExhausted(task) {
  const ex = task.exhausted;
  if (!ex || ex.reintegrated || task.cancelled || task.worktree_gone || task.budget_stopped) return false;
  if (task.s_run || task.harness_run) return false;
  if (task.nodes.some((n) => n.state === 'running') || pendingRejudgeAt(task) !== null) return false;
  const packages = ((task.spec && task.spec.packages) || []).filter((p) => !p.repair);
  const dependents = new Set(ex.packages.map(String));
  for (let grew = true; grew;) {
    grew = false;
    for (const p of packages) {
      if (dependents.has(String(p.id)) || !(p.deps || []).some((d) => dependents.has(String(d)))) continue;
      dependents.add(String(p.id));
      grew = true;
    }
  }
  const accepted = [];
  for (const p of packages) {
    if (dependents.has(String(p.id))) continue;
    const a = latestBySubgoal(task, String(p.id), 'accept');
    // Not accepted and not dead: a retry, a judge or a dispatch is still owed.
    if (!a || a.state !== 'done') return false;
    accepted.push(a.node_id);
  }
  if (!accepted.length) return false;
  const old = task.nodes.filter((n) => n.stage === 'integrate' && !task.nodes.some((x) => x.supersedes === n.node_id)).pop();
  if (!old || old.state !== 'unreachable') return false;
  const notDone = packages.map((p) => String(p.id)).filter((id) => dependents.has(id));
  const fresh = reintegrateBehind(task, old.node_id, accepted, `retry budget exhausted; not done: ${notDone.join(', ')}`);
  old.state = 'skipped';
  old.final = true;
  old.result = { stage_ok: false, reason: `superseded by ${fresh}: retry budget exhausted - integrating only the accepted packages` };
  ex.reintegrated = fresh;
  ex.not_done = notDone;
  const alive = (x) => x && ['done', 'pending', 'running', 'waiting_human'].includes(x.state);
  for (let grew = true; grew;) {
    grew = false;
    for (const x of task.nodes) {
      if (x.state !== 'unreachable') continue;
      if (![...x.deps, ...(x.after || [])].every((d) => alive(task.nodes.find((y) => y.node_id === d)))) continue;
      x.state = 'pending';
      delete x.result;
      delete x.final;
      // Counted like autoRejudge's reopen: only a child run's merge reads it, to let a reopen win.
      x.reopened = (x.reopened || 0) + 1;
      grew = true;
    }
  }
  for (const q of qaPkgs(task)) if (q.integration_of === old.node_id) q.integration_of = fresh;
  record(task, { event: 'exhausted_reintegrated', task_id: task.run_id, integrate: fresh, accepted, not_done: notDone });
  saveRun(task);
  return true;
}

// Append a repair package to the shape, expand it like any other package, and open a fresh
// integrate behind it - the same move retryPackage makes when a package it retried was the one
// an integrate blamed. The old integrate stays failed as evidence, superseded, and the goal
// gate and report move behind the new one.
function openRepair(task, integ) {
  const packages = (task.spec && task.spec.packages) || [];
  const priors = packages.filter((p) => p.repair);
  if (priors.length > task.max_retries) {
    // Settle before saving: the same ordering retryPackage needs, for the same reason.
    const unreachable = settleFailure(task, integ);
    return { task: saveRun(task), package_id: null, reason: 'repair budget exhausted', unreachable };
  }
  const round = Number(String(integ.node_id).split(':')[1] || 1);
  const id = `R${priors.length + 1}`;
  const r = integ.result || {};
  const deferred = Array.isArray(r.deferred_conflicts) ? r.deferred_conflicts : [];
  const brief = [
    `This package works on the COMBINED tree of every package in this task - its worktree is the integration worktree, with all package branches already merged - and its whole job is to make the integration checks below pass.`,
    '',
    `Integration round ${round} was not verified.`,
    r.reason ? `Why it refused:\n${r.reason}` : '',
    (r.gaps || []).length ? `Gaps it named:\n${bullets(r.gaps)}` : '',
    (r.checks || []).length ? `Checks it ran:\n${bullets(r.checks)}` : '',
    r.evidence ? `Evidence:\n${r.evidence}` : '',
    // Card 109: filed packages whose merge conflicted were left out of this tree for the repair
    // to settle (prepareIntegration's deferral); the repair's job is to leave both fixes holding.
    deferred.length ? `Packages left out because their merge conflicted:\n${bullets(deferred.map((d) => `${d.package}: branch ${d.branch}, conflicts on ${d.conflicts.join(', ')}${(d.with || []).length ? ` (with ${d.with.join(', ')})` : ''}. Merge it into this tree (\`git merge ${d.branch}\`) resolving the conflict so both fixes hold, or leave it out when its change is already here.`))}` : '',
  ].filter(Boolean).join('\n');
  packages.push({
    id,
    title: `repair: integration ${round}`,
    repair: true,
    integration_of: integ.node_id,
    flow: task.flow_chosen || 'auto',
    brief,
    ...(deferred.length ? { settles: deferred.map((d) => String(d.package)) } : {}),
    acceptance: [
      ...((task.spec && task.spec.acceptance) || []),
      ...deferred.map((d) => { const c = (packageOf(task, d.package) || {}).repro; return c && c.command ? `${d.package}'s reproduction no longer reproduces its defect: ${c.command}` : ''; }).filter(Boolean),
    ],
    // Every path any package claimed: the seam is between them, so none of them is out of bounds.
    touches: [...new Set(packages.flatMap((p) => (p.touches || []).map(String)))],
    deps: packages.filter((p) => !p.repair && !notDoneIds(task).includes(String(p.id))).map((p) => String(p.id)),
  });
  // The same deps the failed integrate had - every package's accept, all done. A repair that
  // depended on the failed integrate itself could never become ready: a failed node is never
  // satisfied.
  const accept = pushChain(task, PACKAGE_CHAIN, id, 1, integ.deps.slice(), [], { feedback: '' });
  const fb = [r.reason, ...(r.gaps || []), ...(r.checks || [])].filter(Boolean).join('\n- ');
  const fresh = reintegrateBehind(task, integ.node_id, [accept], fb);
  return { task: saveRun(task), package_id: id, integrate: fresh, reason: '' };
}

// The daemon's own route out of a failed package - the move tm_retry({package_id}) makes for a
// caller, made by the loop itself. A package attempt fails two ways the manager can act on: its
// dispatch folded failed (the child ran out of its own gate retries and blocked, or its driver
// died past its restart budget), or its accept rejected. Either way, while retryPackage's
// max_retries budget allows, the next attempt opens with the last verdict's reason and gaps as
// feedback, exactly as the tool would; when the budget is spent retryPackage settles the
// failure so runState reads blocked for good. Skipped: a dispatch that failed on a merge conflict
// (a shape problem no retry fixes), a repair package (openRepair owns its budget), and any
// package that already has a later attempt. trap-beta-T1 (2026-09-21) stopped here: P1's child
// spent three gate attempts, folded failed, and the daemon recorded daemon_done on a task with a
// whole max_retries budget untouched.
// A failed shape or critique has the same shape as a failed package: the engine already knows
// how to recover (retryShape carries the verdict into the next attempt) and already knows what
// to say. Only tm_retry ever called it, so with the daemon owning the loop since v0.16.0 a
// critique that found real defects simply stopped the task and waited for a person - idol-pm-1
// (2026-09-22) named three blocking defects in the shape and sat blocked with the fix in hand.
// This is autoRepair/autoRetryPackages for the shaping pair, budgeted the same way.
export function autoReshape(task) {
  // A stopped box opens nothing new (see autoRetryPackages): a repair or reshape now would sit
  // undispatched with the task reading running forever. enforceBudget closes it to the report.
  if (task.budget_stopped) return false;
  if (task.s_run || task.harness_run) return false;
  // A judge that could not judge is not a verdict on the shape, exactly as it is not one on a
  // package (autoRetryPackages skips the same result for the same reason). autoRejudge owns the
  // node while its rejudge budget lasts - and it deliberately waits a minute (or a usage-limit
  // reset) before reopening, so within that window this function would otherwise find a 'failed'
  // shape/critique and spend a whole reshape attempt on it, carrying "judge process did not
  // finish within 45m and was killed" into the next shape as if it were a critique. idol-pm-1
  // (2026-09-22) hit the 45m judge timeout twice in 247 minutes; under this code that is two of
  // the three shaping attempts gone to a timeout string. Once the rejudge budget IS spent there
  // is no verdict coming, and reshaping is the only move left - so reshape then.
  const judgeStuck = (n) => Boolean(n.result.blocked) || (n.result.judge_failed === true && (n.judge_attempts || 0) < JUDGE_ATTEMPTS_MAX);
  // The plan stage's split and the planning integrate are the shaping pair's planning twins
  // (_repo/docs/plans/2026-09-28-teams-cards-everywhere.md C2/C4), recovered the same way: a failed
  // split is split again with its problems as feedback; a planning integrate whose judge never
  // came back (finish() already replans a real refusal) is replanned once its rejudges are spent.
  if (!task.nodes.some((n) => n.state === 'running')) {
    // The latest split attempt, refused by its own stage (validateAreas) or by its critique (M4).
    const lastSplit = task.nodes.filter((n) => n.stage === 'areas').pop();
    const lastCritique = lastSplit && task.nodes.find((n) => n.stage === 'areas-critique' && n.deps.includes(lastSplit.node_id));
    const split = [lastSplit, lastCritique].find((n) => n && n.state === 'failed' && n.result && !n.final && !judgeStuck(n));
    if (split) {
      const r = split.result;
      const out = retryAreas(task, [r.reason || '', ...(r.area_problems || []), ...(r.blocking || []), ...(r.problems || []).map((x) => `advice: ${x}`)].filter(Boolean).join('\n- '));
      saveRun(task);
      record(task, { event: out.attempt ? 'auto_resplit' : 'tm_settle', task_id: task.run_id, target: 'areas', attempt: out.attempt, from: split.node_id });
      return !!out.attempt;
    }
    const pi = task.nodes.filter((n) => n.stage === 'plan-integrate' && n.state === 'failed' && n.result && !n.final && !judgeStuck(n)
      && !task.nodes.some((x) => x.supersedes === n.node_id)).pop();
    if (pi) {
      const fresh = replanPlanning(task, pi);
      saveRun(task);
      return !!fresh;
    }
  }
  const source = task.nodes.filter((n) => (n.stage === 'critique' || n.stage === 'shape') && n.state === 'failed' && n.result && !n.final && !judgeStuck(n)).pop();
  if (!source) return false;
  // Nothing else may still be moving: a live dispatch belongs to the shape being replaced.
  if (task.nodes.some((n) => n.state === 'running')) return false;
  const out = retryShape(task, shapeFeedback(source));
  record(task, { event: out.attempt ? 'auto_reshape' : 'tm_settle', task_id: task.run_id, target: 'shape', attempt: out.attempt, from: source.node_id });
  return !!out.attempt;
}

export function autoRetryPackages(task) {
  // A stopped box dispatches nothing new (advanceDispatches), so a retry opened now could never
  // run - code-sprint-S2 opened PLAN attempt 3 after budget_stopped, and it sat pending. The
  // failure stands as this Sprint's outcome and enforceBudget carries the rest to the report.
  if (task.budget_stopped) return false;
  let changed = false;
  // The phase-Team packages belong here for the same reason packageOf() has to know them: they
  // are dispatched and accepted exactly like a package, they just do not live in the list shape
  // owns. Without them a rejected accept:PLAN (or QA, or AUDIT) had no route forward at all -
  // the daemon would record daemon_done on a task whose whole retry budget was untouched, the
  // same wedge autoRepair/autoReshape were written to close. Reachable from the accept floor
  // below, which is the first thing that rejects a PLAN fold on a number rather than a verdict.
  const packages = [...planningPkgs(task), ...qaPkgs(task), task.audit_pkg, ...((task.spec && task.spec.packages) || [])].filter(Boolean);
  for (const pkg of packages) {
    if (pkg.repair) continue;
    const pid = String(pkg.id);
    const mine = task.nodes.filter((n) => n.subgoal_id === pid && (n.stage === 'dispatch' || n.stage === 'accept'));
    if (!mine.length) continue;
    const lastAttempt = Math.max(...mine.map((n) => n.attempt || 1));
    const latest = mine.filter((n) => (n.attempt || 1) === lastAttempt);
    const failed = latest.find((n) => n.state === 'failed' && n.result && !n.final);
    if (!failed) continue;
    if (latest.some((n) => n.state === 'running' || n.state === 'pending' || n.state === 'ready') && failed.stage === 'dispatch') {
      // accept of this attempt still open behind a failed dispatch cannot be - but guard anyway
    }
    if ((failed.result.conflicts || []).length) continue;
    if (failed.result.waiting_capacity) continue;
    if (failed.result.judge_failed === true) continue; // no verdict yet - autoRejudge owns it
    if (failed.result.blocked) continue; // a judge was denied a tool: no verdict, no reject feedback to retry on
    // A failed dispatch:QA whose child actually ran execute and recorded defects (foldChild's
    // defectsFound, carried onto this node as result.defects) is not a package to retry - its
    // case set already found what it was sent to find. Before this check, a rejected or
    // blocked dispatch:QA looped straight back into retryPackage, opening a fresh dispatch:QA
    // on the SAME integrated tree to run the SAME case set again - accept:QA (the only place
    // that normally files a defect, see finish()'s accept:QA hook above) never runs because its
    // data dep is a failed, not done, dispatch (awake-beta-ref1, 2026-09-24: dispatch:QA:1
    // failed with gaps:[] and the defects nowhere to go, and the daemon opened dispatch:QA:2
    // over the identical bug). File them here instead, capped by qa_rounds the same way
    // accept:QA's own hook caps a passing accept that reports defects - a dispatch that never
    // reached accept must not get a second, uncapped route to the same file.
    if (pkg.phase === 'qa' && failed.stage === 'dispatch' && Array.isArray(failed.result.defects) && failed.result.defects.length) {
      // The accept node this failed dispatch was gating can never become ready now - its one
      // data dep is a failed dispatch, and `settled` (graph.mjs) never counts a plain `failed`
      // as done. Retire it in place, carrying the defects, so the QA round's join (settleQaRound)
      // files them together with every sibling QA card's once the whole round has settled (C7).
      const records = failed.result.defects.map((d) => ({ title: d.length > 120 ? `${d.slice(0, 117)}...` : d, evidence: d, ...(failed.result.defect_repros && failed.result.defect_repros[d] ? { repro: failed.result.defect_repros[d] } : {}) }));
      for (const sib of latest) {
        if (sib.state === 'pending') {
          sib.state = 'skipped';
          sib.result = { stage_ok: false, reason: 'its dispatch found defects; filed directly instead of judged', defects: records, qa_direct: true };
        }
      }
      failed.final = true;
      const out = settleQaRound(task);
      record(task, { event: out && out.filed ? 'daemon_defects_filed' : out && out.unresolved ? 'daemon_retry_settled' : 'daemon_defects_held', task_id: task.run_id, package_id: pid,
        ...(out && out.filed ? { filed: out.filed } : {}), ...(out && out.unresolved ? { reason: 'qa_rounds exhausted with unresolved defects' } : {}), failed_node: failed.node_id });
      saveRun(task);
      changed = true;
      continue;
    }
    // §upstream_defects: a package whose dispatch failed (its own acceptance could not pass
    // while an upstream dependency was broken - not the QA case above, but the same wedge for an
    // ordinary develop package: awake-beta-ref2, 2026-09-25) carries them the same way foldChild
    // carries QA's defects through regardless of the fold's own accept/reject verdict. File the
    // fix and reopen this package's own next attempt wired onto it, instead of the blind retry
    // below reopening the SAME impossible attempt against the SAME broken upstream a third time.
    if (failed.stage === 'dispatch' && Array.isArray(failed.result.upstream_defects) && failed.result.upstream_defects.length) {
      const out = fileUpstreamDefects(task, pid, failed.result.upstream_defects);
      if (out.downstream_attempt) {
        record(task, {
          event: 'daemon_upstream_defects_filed', task_id: task.run_id, package_id: pid,
          filed: out.filed, targeted: out.targeted, downstream_attempt: out.downstream_attempt, failed_node: failed.node_id,
        });
        changed = true;
        continue;
      }
      // Every upstream package this attempt named was already at its own upstream_fix_rounds
      // cap (recorded onto task.unresolved_defects by fileUpstreamDefects), or named no real
      // package id at all - nothing left to file or wire. Fall through to the ordinary retry
      // below, same as before this existed.
    }
    const fb = [failed.result.reason || '', ...(failed.result.gaps || [])].filter(Boolean).join('\n- ');
    const out = retryPackage(task, pid, fb);
    if (!out.attempt && pkg.phase === 'qa') rescueQaRound(task, pkg, out.unreachable || [], failed);
    record(task, {
      event: out.attempt ? 'daemon_retry_opened' : 'daemon_retry_settled', task_id: task.run_id,
      // The feedback the retry was opened ON, not just retryPackage's own settle reason (set only
      // when it declines): every daemon_retry_opened read reason:"" before (trap, idol-beta-ask1),
      // so a person reading tm_events saw a retry and never why.
      package_id: pid, attempt: out.attempt || null, reason: String(out.reason || fb || '').slice(0, 400), failed_node: failed.node_id,
    });
    changed = true;
  }
  // The package that just spent its retries may be the last thing the daemon waited on; the same
  // tick opens the integrate, before the task reads blocked and the daemon is done.
  if (reintegrateExhausted(task)) changed = true;
  return changed;
}

// A child run the broker blocked at probe time remembers the spent vendor (unavailable_vendors)
// and would refuse it again on the resumed driver's first team_next. Same reset team_retry's
// reset_capacity does, applied here because the resumed driver is told to continue, not reset.
function reopenCapacity(child) {
  const run = loadRun(child.cwd, child.run_id);
  if (!run || !(run.routing_blocked_capacity || Object.keys(run.unavailable_vendors || {}).length)) return;
  run.unavailable_vendors = {};
  run.capacity_epoch = (run.capacity_epoch || 0) + 1;
  for (const x of run.nodes) if (x.state === 'pending' && !x.ticket) delete x.assignment;
  // Assigned, not deleted: saveRun merges onto the file, and a missing key keeps the file's value.
  run.routing_blocked = false; run.routing_blocked_capacity = null;
  saveRun(run);
}

// Clears a parked-on-capacity driver (every waiting child, or one package's, or the s_run)
// and respawns it on the same run_id - none of it counts against driver_restarts. Shared by
// tm_retry({reset_capacity:true}) and the daemon's own autoResumeCapacity.
export function clearCapacity(task, packageId) {
  const resumed = [];
  const a = { package_id: packageId };
    const h = task.harness_run;
    if (h && h.waiting_capacity && (!a.package_id || String(a.package_id) === 'S')) {
      record(task, { event: 'child_driver_capacity_cleared', task_id: task.run_id, node_id: 'S', was: h.waiting_capacity });
      delete h.waiting_capacity;
      if (!noDriver()) {
        const restarts = (h.driver && h.driver.restarts) || [];
        const run = resolveHarnessRun(task);
        const attempt = nextSpawnAttempt(h);
        respawnDriver(task, 'S', h, {
          attempt, reason: 'reset_capacity', restarts,
          spawn: (t) => spawnHarnessDriver(t, { resume: true, run, attempt }),
          event: (t, fresh) => ({ event: 'child_driver_restarted', task_id: t.run_id, node_id: 'S', pid: fresh.pid, reason: 'reset_capacity' }),
        });
      }
      resumed.push('S');
    }
    for (const n of task.nodes) {
      if (n.stage !== 'dispatch' || n.state !== 'running' || !n.child || !n.child.waiting_capacity) continue;
      if (a.package_id && n.subgoal_id !== String(a.package_id)) continue;
      record(task, { event: 'child_driver_capacity_cleared', task_id: task.run_id, node_id: n.node_id, was: n.child.waiting_capacity });
      delete n.child.waiting_capacity;
      reopenCapacity(n.child);
      if (!noDriver()) {
        const restarts = (n.child.driver && n.child.driver.restarts) || [];
        const attempt = nextSpawnAttempt(n.child);
        const nodeId = n.node_id;
        respawnDriver(task, nodeId, n.child, {
          attempt, reason: 'reset_capacity', restarts,
          spawn: (t, c) => spawnChildDriver(t, nodeId, c, { resume: true, attempt }),
          event: (t, fresh) => ({ event: 'child_driver_restarted', task_id: t.run_id, node_id: nodeId, pid: fresh.pid, reason: 'reset_capacity' }),
        });
      }
      resumed.push(n.node_id);
    }
  return resumed;
}

// "You've hit your session limit · resets 5:40pm (UTC)" / "resets 11:50pm (Asia/Seoul)" -> the
// epoch ms of that wall-clock time in that zone, the first occurrence after `since`. Unparseable
// -> since + 30 minutes, the same fallback drive.sh uses.
export function capacityResetAt(reason, since) {
  // Minutes are optional: idol-beta-ask1's P6 read "resets 3pm (UTC)", fell to the 30-minute
  // fallback, resumed an hour early and hit the limit again four seconds later.
  const m = /resets\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)(?:\s*\(([^)]+)\))?/i.exec(String(reason || ''));
  const base = Number(since) || Date.now();
  if (!m) {
    // Codex names a date in the host's local time: "try again at Sep 27th, 2026 12:00 AM".
    const at = /try again at\s+([A-Z][a-z]{2,8})\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\s+(\d{1,2}:\d{2}\s*[AP]M)/i.exec(String(reason || ''));
    const t = at ? Date.parse(`${at[1]} ${at[2]}, ${at[3]} ${at[4]}`) : NaN;
    if (Number.isFinite(t) && t > base) return t;
    return base + 30 * 60 * 1000;
  }
  let h = Number(m[1]) % 12; if (m[3].toLowerCase() === 'pm') h += 12;
  const min = Number(m[2] || 0);
  const tz = m[4] || 'UTC';
  // Walk the zone's wall clock: find the offset at `since`, build the candidate, roll a day if past.
  const wall = (ms) => {
    try {
      const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(ms));
      const g = (t) => Number(parts.find((x) => x.type === t).value);
      return { y: g('year'), mo: g('month'), d: g('day'), h: g('hour'), mi: g('minute') };
    } catch { return null; }
  };
  const w = wall(base);
  if (!w) return base + 30 * 60 * 1000;
  // zone offset at `since`: (wall clock as if UTC) - actual
  const asUtc = Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi);
  const offset = asUtc - Math.floor(base / 60000) * 60000;
  let candidate = Date.UTC(w.y, w.mo - 1, w.d, h, min) - offset;
  if (candidate <= base) candidate += 24 * 60 * 60 * 1000;
  return candidate;
}

const CAPACITY_GRACE_MS = 3 * 60 * 1000;

// The daemon's own tm_retry({reset_capacity:true}): once the reset time a provider named has
// passed (plus a few minutes' grace), clear the park and respawn - the caller no longer has to
// notice. trap-beta-T2 (2026-09-21) sat 1h51m on "resets 5:40pm (UTC)" after the reset because
// nothing in the loop read the clock.
export function autoResumeCapacity(task, now = Date.now()) {
  // A stopped box respawns nothing: a resumed driver is new spend the box already refused, and
  // enforceBudget settles the park instead (settleRunningDispatchesAtStop). Not refused at the
  // warning line: a park the daemon never resumes would also never settle (nothing spends, so
  // the box never trips), and portfolio-consolidate's P1 delivered accepted work after its resume.
  if (task.budget_stopped) return false;
  const due = (w) => w && now >= capacityResetAt(w.reason, w.since) + CAPACITY_GRACE_MS;
  let resumed = [];
  if (task.harness_run && due(task.harness_run.waiting_capacity)) resumed = resumed.concat(clearCapacity(task, 'S'));
  for (const n of task.nodes) {
    if (n.stage !== 'dispatch' || n.state !== 'running' || !n.child || !due(n.child.waiting_capacity)) continue;
    resumed = resumed.concat(clearCapacity(task, String(n.subgoal_id)));
  }
  if (!resumed.length) return false;
  saveRun(task);
  record(task, { event: 'daemon_capacity_resumed', task_id: task.run_id, resumed });
  return true;
}

const JUDGE_ATTEMPTS_MAX = 2;

// A judging node whose judge could not judge (process failed, timed out, replied without JSON,
// or answered with a usage-limit notice) has no verdict - it is not a refusal, and the moves a
// refusal triggers (a repair package, a package retry) must not fire on it. The daemon marks
// such results judge_failed:true; this reopens the node for another single-shot judge, at most
// JUDGE_ATTEMPTS_MAX more times, after a usage-limit reset when the reply named one. trap-beta-T2:
// integrate:1's judge hit the session limit and autoRepair opened a repair package on it.
// The earliest time autoRejudge will reopen a failed judge that still has attempts left, or
// null. The daemon's loop reads "not running" as done; a judge failure waiting out its 60s
// back-off (or a usage-limit reset) is not done - code-sprint-S5's daemon recorded daemon_done
// blocked seconds after integrate:2's re-judge was scheduled, so the re-judge never came.
export function pendingRejudgeAt(task) {
  let at = null;
  for (const n of task.nodes) {
    if (n.state !== 'failed' || !n.result || n.result.judge_failed !== true) continue;
    if ((n.judge_attempts || 0) >= JUDGE_ATTEMPTS_MAX) continue;
    const reason = String(n.result.reason || '');
    const t = /session limit|usage limit|resets\s+\d/i.test(reason)
      ? capacityResetAt(reason, n.finished_at || Date.now()) + CAPACITY_GRACE_MS
      : (n.finished_at || 0) + 60 * 1000;
    if (at === null || t < at) at = t;
  }
  return at;
}

export function autoRejudge(task, now = Date.now()) {
  let changed = false;
  for (const n of task.nodes) {
    if (n.state !== 'failed' || !n.result || n.result.judge_failed !== true) continue;
    if ((n.judge_attempts || 0) >= JUDGE_ATTEMPTS_MAX) continue;
    const reason = String(n.result.reason || '');
    const at = /session limit|usage limit|resets\s+\d/i.test(reason)
      ? capacityResetAt(reason, n.finished_at || now) + CAPACITY_GRACE_MS
      : (n.finished_at || 0) + 60 * 1000;
    if (now < at) continue;
    n.judge_attempts = (n.judge_attempts || 0) + 1;
    n.judge_failures = (n.judge_failures || []).concat([{ at: n.finished_at || null, reason: reason.slice(0, 300) }]);
    n.state = 'pending';
    n.reopened = (n.reopened || 0) + 1; // the reopen count; a child run's merge keys off it too
    delete n.result; delete n.finished_at; delete n.started_at;
    record(task, { event: 'daemon_rejudge', task_id: task.run_id, node_id: n.node_id, attempt: n.judge_attempts, reason: reason.slice(0, 200) });
    changed = true;
  }
  if (changed) saveRun(task);
  return changed;
}

// The daemon's own route out of a refused integrate. tm_retry({package_id: "integration"}) is the
// same move made by a caller; the daemon makes it itself, because a task whose integrate refused
// on its checks (verified:false, a combined tree that exists, no merge conflict) is not blocked -
// it has a repair left to try, budgeted by max_retries exactly as openRepair already counts.
// seam-beta-D2 (2026-09-21) stopped here: integrate rightly refused (cli tests hardcoded exit
// numbers), the daemon saw runState "blocked", recorded daemon_done and left, three accepted
// packages one repair short of a report. Returns true when a repair package was opened (or the
// budget was spent and the failure settled) so the daemon knows the graph changed.
export function autoRepair(task) {
  // A stopped box opens nothing new (see autoRetryPackages): a repair or reshape now would sit
  // undispatched with the task reading running forever. enforceBudget closes it to the report.
  if (task.budget_stopped) return false;
  // Before a repair or a reshape: the accepted packages reach an integration tree first.
  if (reintegrateExhausted(task)) return true;
  const target = integrateToRepair(task);
  if (!target.node) return false;
  const out = openRepair(task, target.node);
  record(task, {
    event: 'daemon_repair_opened', task_id: task.run_id, integrate: target.node.node_id,
    package_id: out.package_id, integrate_next: out.integrate || null, reason: out.reason || '',
  });
  return true;
}

// ---------- defect STORYs: tm_file and the QA re-loop (v0.12.1 Task 1, §5b) ----------
//
// Files one ordinary develop package per defect - unlike a repair package, each gets its OWN
// fresh worktree (shape's usual package machinery), because a defect fix is normal develop work,
// not a fix to a seam only visible in the combined tree. `reporter` is set instead of `repair:
// true` so the board (tickets.mjs epicBoardRows) and docs can tell a filed STORY apart from one
// shape produced. Reuses reintegrateBehind for the same "detour gate:goal through a fresh
// integrate" move openRepair makes; unlike openRepair this can file more than one package at
// once (one QA gate can report several defects in the same round).
//
// Deliberately does NOT touch QA here: reopening a QA round the moment defects are filed would
// make the QA phase-Team's dispatch "live" at the same time as the defect packages' own dispatch
// nodes - exactly the concurrency the v0.12.1 self-review flags as breaking the
// max_parallel_teams/runningStories phase-Team exemption (taskmanager.mjs's isPhaseTeam block,
// below). Instead the integrate-completion hook in finish() reopens QA lazily, only once the
// fresh integrate this call creates has itself finished - by which point every defect package is
// already done, not running, so the exemption's original premise (a phase-Team dispatch is never
// concurrent with a develop STORY dispatch) keeps holding. See that hook's comment for the rest
// of this argument.
//
// Never itself checks qa_rounds: the cap is the caller's job. The accept:QA:N hook below checks
// it before deciding whether to call this at all; tm_file (a user filing a STORY directly) never
// checks it - a user-filed STORY is not a QA round (v0.12.1 self-review's open risk on tm_file
// vs qa_rounds, resolved here: tm_file always proceeds, uncapped).
// The QA round's join (_repo/docs/plans/2026-09-28-teams-cards-everywhere.md C7). A round is one QA
// card per feature area over the same integrated tree, and the goal gate waits on all of their
// accepts. Defects are filed once the WHOLE round has settled - every card accepted, or retired
// with its dispatch's defects (autoRetryPackages' qa_direct) - and all together: filing on the
// first card's accept would rebuild the tree under the siblings still exercising it, and would
// start fix STORYs while a QA card is still running (the exemption advanceDispatches gives
// phase-Team cards rests on the two never overlapping). qa_rounds caps the rounds exactly as it
// capped the single QA pass: the round number is the most attempts any one QA card has had.
// Returns null while the round is still open, else {filed?, unresolved?, defects}.
// Returns a predicate (d, card) that is truthy for a defect already seen in this pass: equal trimmed
// title, or equal non-empty trimmed repro.command (true); or, card 109, the same finding worded
// again: same QA card, an AC token in common and the same set of files (the first such defect, so the
// caller can fold the copy into it). The first of a kind is remembered and passes.
// E-ea14c9c4 (2026-10-30): one QA card listed 4 findings as 15 defects, each copy with its own
// title and its own per-case repro command, so the title/command keys missed every one and each
// was built, accepted and integrated. A defect naming no AC or no file is never merged by the
// file+AC rule. fileAc: false keeps the title/command rule alone.
const DEFECT_AC_RE = /\b(?:[A-Za-z0-9]+(?:[-/][A-Za-z0-9]+)*[-/])?AC-\d+\b/gi;
const DEFECT_FILE_RE = /[\w.@-]+(?:\/[\w.@-]+)*\.(?:mjs|cjs|js|jsx|ts|tsx|json|md|txt|py|sh|ya?ml|toml|css|html|csv)(?!\w)/gi;
function sameDefectSeen({ fileAc = true } = {}) {
  const titles = new Set();
  const commands = new Set();
  const kept = [];
  const trim = (v) => (typeof v === 'string' ? v.trim() : '');
  const sameFile = (a, b) => a === b || a.endsWith(`/${b}`) || b.endsWith(`/${a}`);
  const tokens = (d) => {
    const r = (d && d.repro && typeof d.repro === 'object') ? d.repro : {};
    const text = [d && d.title, d && d.evidence, r.observed, r.expected].filter((v) => typeof v === 'string').join('\n');
    const cmd = typeof r.command === 'string' ? r.command : '';
    const acs = new Set((`${text}\n${cmd}`.match(DEFECT_AC_RE) || []).map((t) => t.toUpperCase()));
    // The repro command names a file only when nothing else does: `node --test test-x.mjs` runs a
    // test file, not the defect's source file, and must not merge two defects of different sources.
    const named = [...((d && Array.isArray(d.touches)) ? d.touches.map(String) : []), ...(text.match(DEFECT_FILE_RE) || [])];
    const files = new Set((named.length ? named : (cmd.match(DEFECT_FILE_RE) || []))
      .map((f) => f.trim().replace(/^\.\//, '').toLowerCase()).filter(Boolean));
    return { acs, files: [...files] };
  };
  return (d, card) => {
    const title = trim(d && d.title);
    const command = trim(d && d.repro && d.repro.command);
    const dup = (title && titles.has(title)) || (command && commands.has(command));
    if (title) titles.add(title);
    if (command) commands.add(command);
    if (dup || !fileAc) return Boolean(dup);
    const t = tokens(d);
    const first = kept.find((k) => k.card === card && [...t.acs].some((a) => k.acs.has(a))
      && t.files.length && t.files.every((f) => k.files.some((g) => sameFile(f, g)))
      && k.files.every((g) => t.files.some((f) => sameFile(f, g))));
    if (first) return first.defect;
    kept.push({ defect: d, card, ...t });
    return false;
  };
}

export function settleQaRound(task) {
  if (task.s_run) return null; // S2: a legacy size-S task's QA cards are read, never settled
  const goal = task.nodes.filter((n) => n.stage === 'gate' && n.subgoal_id == null).pop();
  if (!goal) return null;
  const round = goal.deps.map((d) => task.nodes.find((x) => x.node_id === d)).filter((x) => x && x.stage === 'accept' && phaseOfId(task, x.subgoal_id) === 'qa');
  if (!round.length) return null;
  const settledCard = (x) => x.state === 'done' || (x.state === 'skipped' && x.result && x.result.qa_direct);
  if (!round.every(settledCard)) return null;
  const fresh = round.filter((x) => x.result && !x.result.defects_settled);
  // Gated once: the card is marked defects_settled below, so a rescue or retry that re-enters this
  // join never sees a dropped defect again.
  // Card 97: one filing holds each defect once even when several cards/attempts reported it
  // (first wins); never compared against rounds filed earlier.
  // Card 109: the file+AC rule runs on the repro gate's survivors, so a copy the gate refused never
  // stands in for a finding another copy proves; each folded copy is listed on dropped_defects and
  // its title and command join the kept defect's evidence (the fix sees every wording).
  const sameDefect = sameDefectSeen({ fileAc: false });
  const sameFinding = sameDefectSeen();
  const gated = reproGate(task, fresh.flatMap((x) => (Array.isArray(x.result.defects) ? x.result.defects : [])
    .map((d) => ({ ...(d && typeof d === 'object' ? d : { title: String(d), evidence: String(d) }), qa_card: x.subgoal_id }))
    .filter((d) => !sameDefect(d))), 'qa');
  const defects = [];
  for (const { qa_card: card, ...d } of gated) {
    const first = sameFinding(d, card);
    if (!first) { defects.push(d); continue; }
    if (first === true) continue;
    task.dropped_defects = (task.dropped_defects || []).concat([{
      id: d.id || null, title: d.title || '', reason: `same file and AC as "${first.title || ''}"`, repro: d.repro && typeof d.repro === 'object' ? d.repro : null, source: 'qa',
    }]);
    const also = `Also reported as "${d.title || ''}"${d.repro && d.repro.command ? ` (repro: ${d.repro.command})` : ''}`;
    first.evidence = first.evidence ? `${first.evidence}\n${also}` : also;
  }
  for (const x of fresh) x.result = { ...x.result, defects_settled: true };
  if (!defects.length) return { defects: [] };
  const qaRound = Math.max(1, ...qaPkgs(task).map((q) => task.nodes.filter((x) => x.stage === 'dispatch' && x.subgoal_id === String(q.id)).length));
  const cap = Number.isInteger(task.team && task.team.opts && task.team.opts.qa_rounds)
    ? task.team.opts.qa_rounds : TEAM_DEFAULTS.qa_rounds;
  if (qaRound > cap) {
    task.unresolved_defects = (task.unresolved_defects || []).concat(defects.map((d) => ({ ...d, round: qaRound })));
    // A card retired on its dispatch's defects is never `done`; the goal gate judges without it
    // rather than waiting on it forever. What it found is on the unresolved list above.
    const kept = goal.deps.filter((d) => { const x = task.nodes.find((y) => y.node_id === d); return !(x && x.state === 'skipped' && x.result && x.result.qa_direct); });
    const integ = (qaPkgs(task)[0] || {}).integration_of;
    goal.deps = kept.length ? kept : (integ ? [integ] : goal.deps);
    return { unresolved: true, defects };
  }
  const out = fileDefects(task, defects, { reporter: 'qa', origin: 'qa' });
  return { filed: out.filed, defects };
}

// The repro gate (QA's join and the audit hook, before fileDefects). A defect names a repro
// {command, observed, expected}; the command exits non-zero while the defect exists. Refused:
// no repro, or a missing/empty command, observed or expected ('no repro'). Rerun on the latest
// integration tree: exit 0 means the failure is gone, so it is dropped ('repro passes on
// integration tree'); non-zero is filed. A rerun that cannot run (spawn error, exit 127, timeout,
// no tree) is filed with repro_unverified: true, never dropped. Refused and dropped defects are
// kept on task.dropped_defects as {id, title, reason, repro, source}. Only the exit code is judged.
const REPRO_TIMEOUT_MS = 60000;
export function reproGate(task, defects, source) {
  const text = (v) => typeof v === 'string' && v.trim() !== '';
  const timeout = Number(process.env.TEAMS_REPRO_TIMEOUT_MS) > 0 ? Number(process.env.TEAMS_REPRO_TIMEOUT_MS) : REPRO_TIMEOUT_MS;
  const tree = integrationTrees(task).map((t) => t.cwd).filter((c) => existsSync(c)).pop() || null;
  const kept = [];
  for (const d of defects) {
    const r = d && d.repro;
    const drop = (reason) => {
      task.dropped_defects = (task.dropped_defects || []).concat([{
        id: (d && d.id) || null, title: (d && d.title) || '', reason, repro: r && typeof r === 'object' ? r : null, source,
      }]);
    };
    if (!r || typeof r !== 'object' || !text(r.command) || !text(r.observed) || !text(r.expected)) { drop('no repro'); continue; }
    let unverified = true;
    if (tree) {
      const run = spawnSync('sh', ['-c', r.command], { cwd: tree, timeout, stdio: 'ignore' });
      if (!run.error && !run.signal && run.status === 0) { drop('repro passes on integration tree'); continue; }
      unverified = Boolean(run.error || run.signal || run.status === 127 || run.status === null);
    }
    kept.push(unverified ? { ...d, repro_unverified: true } : d);
  }
  return kept;
}

// A QA card spent past its retries (M3, _repo/docs/plans/2026-09-28-teams-adversarial-fixes.md): its
// settleFailure made the goal gate unreachable, so the round's join never ran and a sibling
// card's defects were neither filed nor listed. The dead card is dropped from the goal gate's
// deps (onto the round's other QA accepts, or the integrate they judge), everything its failure
// wrote off is put back to pending, and the join runs over the cards that did settle. The goal
// gate and the report are told which card never reached a verdict (task.qa_not_run).
function rescueQaRound(task, pkg, unreachable, failed) {
  const pid = String(pkg.id);
  if (task.s_run) {
    task.qa_not_run = [...(task.qa_not_run || []), { pass: pid, node_id: `accept:${pid}`, reason: String((failed && failed.result && failed.result.reason) || 'retries exhausted').slice(0, 300) }];
    return false;
  }
  const own = (id) => { const x = task.nodes.find((y) => y.node_id === id); return x && x.subgoal_id === pid; };
  const goal = task.nodes.filter((n) => n.stage === 'gate' && n.subgoal_id == null && String(n.node_id).startsWith('gate:goal')).pop();
  if (!goal) return false;
  const deadDeps = goal.deps.filter((d) => own(d));
  if (!deadDeps.length) return false;
  for (const id of unreachable) {
    if (own(id)) continue;
    const x = task.nodes.find((y) => y.node_id === id);
    if (!x || x.state !== 'unreachable') continue;
    x.state = 'pending';
    delete x.result;
    delete x.final;
    // Counted, the same mark autoRejudge's reopen carries. task.json is written whole by
    // mutateTask; only a child run's merge (graph.mjs mergeOnto) still reads it to let a reopen win.
    x.reopened = (x.reopened || 0) + 1;
  }
  const kept = goal.deps.filter((d) => !deadDeps.includes(d));
  goal.deps = kept.length ? kept : (pkg.integration_of ? [pkg.integration_of] : kept);
  task.qa_not_run = [...(task.qa_not_run || []), { pass: pid, node_id: deadDeps[0], reason: String((failed && failed.result && failed.result.reason) || 'retries exhausted').slice(0, 300) }];
  record(task, { event: 'qa_card_dropped', task_id: task.run_id, package_id: pid, goal: goal.node_id, deps: goal.deps, restored: unreachable.filter((id) => !own(id)) });
  settleQaRound(task);
  return true;
}

function fileDefects(task, defects, opts) {
  // reporter is the issuing TEAM ('qa'/'audit'/'user', or an actual develop package id like 'P4'
  // for a fix fileUpstreamDefects files on that package's own behalf); origin is the STAGE that
  // filed it ('qa'/'planning-audit'/'tm_file'/'upstream') - tickets.mjs's packageFiling reads
  // both straight off the package, no recomputation. Defaulting to 'user'/'tm_file' matches
  // tm_file's own call (the only caller that omits both).
  const reporter = (opts && opts.reporter) || 'user';
  const origin = (opts && opts.origin) || 'tm_file';
  const packages = task.spec.packages;
  // A QA or audit filing is made on the integrated tree of the pass that found it; the fix
  // branches from that integration branch, not from the project's HEAD. Read before
  // reintegrateBehind rewrites integration_of to the fresh integrate.
  const filingPkg = origin === 'qa' ? qaPkgs(task)[0] : origin === 'planning-audit' ? task.audit_pkg : null;
  const filingInteg = filingPkg && filingPkg.integration_of != null
    ? task.nodes.find((x) => x.node_id === String(filingPkg.integration_of) && x.integration)
    : null;
  const goal = task.nodes.filter((n) => n.stage === 'gate' && n.subgoal_id == null).pop();
  if (!goal) throw new Error('this task has not reached goal level yet - there is no gate:goal to reroute a filed STORY behind');
  // Every node the goal gate waits on - one integrate, one audit accept, or a whole round of QA
  // card accepts (C7) - is replaced by the one fresh integrate.
  const oldDep = goal.deps.length > 1 ? goal.deps.slice() : goal.deps[0];
  const acceptIds = [];
  const filed = [];
  // Overlapping touches is what integration conflicts are made of, and shape orders its own
  // packages for it; a filed package gets the same ordering (C7). ws-a6b31c1b (0.40.1): D1-D4 all
  // touched one csv source file, were filed unordered, ran in parallel and conflicted at
  // integrate:2. An upstream fix never orders behind its filer, nor anything depending on it:
  // fileUpstreamDefects rewires the filer's next dispatch onto the fix, so that edge is a cycle.
  const behindFiler = new Set(origin === 'upstream' ? [String(reporter)] : []);
  for (let grew = behindFiler.size > 0; grew;) {
    grew = false;
    for (const p of packages) {
      if (behindFiler.has(String(p.id)) || !(p.deps || []).some((x) => behindFiler.has(String(x)))) continue;
      behindFiler.add(String(p.id));
      grew = true;
    }
  }
  // An earlier package not yet accepted is waited on only when it is itself filed: those depend
  // only backwards, so the edge cannot close a loop. A dead one (skipped, written off) never is.
  const overlapDeps = (pkg) => packages.filter((q) => {
    if (q.repair || behindFiler.has(String(q.id)) || !touchesOverlap(q, pkg)) return false;
    const acc = latestBySubgoal(task, q.id, 'accept');
    if (!acc || acc.state === 'skipped' || acc.state === 'unreachable') return false;
    return acc.state === 'done' || (!acc.final && Boolean(q.reporter));
  }).map((q) => String(q.id));
  for (const d of defects) {
    const id = `D${packages.filter((p) => p.reporter).length + 1}`;
    const evidence = d && d.evidence ? String(d.evidence) : '';
    const title = (d && d.title) || `defect ${id}`;
    const pkg = {
      id,
      title,
      reporter,
      origin,
      // Only an upstream fix ever gets a link - the fix STORY's own "what this blocks/targets"
      // (§upstream_defects). d.upstream is fileUpstreamDefects' own explicit field (set beside
      // deps:[upstreamId], never left to be inferred from deps alone - see that function).
      ...(origin === 'upstream'
        ? { link: { type: 'blocks', target: String((d && d.upstream) != null ? d.upstream : ((Array.isArray(d && d.deps) && d.deps[0]) || '')) } }
        : {}),
      flow: task.flow_chosen || 'auto',
      brief: [
        `This package fixes a defect filed against this task's integrated result.`,
        `Title: ${title}`,
        d && d.severity ? `Severity: ${d.severity}` : '',
        evidence ? `Evidence:\n${evidence}` : '',
      ].filter(Boolean).join('\n'),
      // §5b: acceptance is that the reproduction QA (or the filer) gave stops reproducing.
      acceptance: [evidence ? `the reproduction below no longer reproduces the defect:\n${evidence}` : `"${title}" no longer reproduces`],
      touches: ((d && d.touches) || []).map(String),
      deps: ((d && d.deps) || []).map(String),
      ...(d && d.repro ? { repro: d.repro } : {}),
      ...(d && d.repro_unverified ? { repro_unverified: true } : {}),
      ...(filingInteg && filingInteg.integration.branch ? { base_branch: filingInteg.integration.branch } : {}),
    };
    // The filer's own deps first: dispatch branches from the first dep, so the base stays the same.
    pkg.deps = [...new Set([...pkg.deps, ...overlapDeps(pkg)])];
    if (pkg.deps.some((x) => behindFiler.has(x))) behindFiler.add(id);
    packages.push(pkg);
    filed.push(pkg);
    // Every named dep is a sibling package id, resolved to ITS current accept the same way a
    // shape-declared package's deps are resolved in expandPackages - all of them are already
    // done by the time a goal-level defect can even be filed, so this always finds one.
    const headDeps = pkg.deps.map((dep) => { const acc = latestBySubgoal(task, dep, 'accept'); return acc ? acc.node_id : null; }).filter(Boolean);
    acceptIds.push(pushChain(task, PACKAGE_CHAIN, id, 1, headDeps, [], { feedback: '' }));
  }
  const feedback = defects.map((d) => `${(d && d.title) || ''}${d && d.evidence ? `: ${d.evidence}` : ''}`).filter(Boolean).join('\n- ');
  const fresh = reintegrateBehind(task, oldDep, acceptIds, feedback);
  // Every route that files (QA's accept, the audit, tm_file, upstream) says so on the ledger once.
  record(task, { event: 'defects_filed', task_id: task.run_id, reporter, origin, filed: filed.map((p) => p.id) });
  // acceptIds (parallel to `filed`, same order) is what fileUpstreamDefects reads to rewire a
  // downstream package's own next attempt onto the fix instead of the upstream package's stale
  // accept - every other caller ignores the extra key.
  return { task: saveRun(task), filed: filed.map((p) => p.id), acceptIds: acceptIds.slice(), integrate: fresh };
}

// ---------- upstream defects: a downstream package's own fix-forward route (§upstream_defects) ----------
//
// A package's dispatch (implement/test/gate, or the manager's own accept judging it) can name a
// defect it found OUTSIDE its own touches[], in a package it deps on - a frozen-contract problem
// no downstream package may fix in its own worktree (this package's files are not in scope
// there). awake-beta-ref2 (2026-09-25): P3 (adapters) was ACCEPTED at 93 identifying Claude Code
// processes by kernel comm=='claude', but on P4's host the real CLI's kernel comm is a version
// string; P4 proved it, but had no route but to fail its own dispatch against a package it could
// not touch, twice, and the daemon just reopened the identical, impossible retry a third time.
//
// This is the fix-forward route: file a fix STORY owned by the UPSTREAM package's own scope
// (touches from that package, deps on that package - reusing fileDefects/reintegrateBehind, the
// same machinery a QA-found defect already takes), then reopen the DOWNSTREAM package's own next
// attempt with its deps rewired onto the fix's accept instead of the upstream package's now-
// superseded one - so it waits for the fix and re-runs against it, instead of retrying blind
// against the same broken upstream. Capped per upstream package by team.opts.upstream_fix_rounds
// (teamconfig.mjs), the same way qa_rounds caps a QA round that keeps finding the same defect:
// beyond it, recorded onto task.unresolved_defects instead of filed, and the caller (finish()'s
// accept hook, or autoRetryPackages' failed-dispatch branch) falls back to its own ordinary path.
//
// Returns {filed, targeted, downstream_attempt} - `targeted` is the upstream package ids a fix
// was actually filed against this call (empty when every one of them was already at cap), and
// `downstream_attempt` is the new dispatch:<downstreamPid>:N this opened, or null when nothing
// was filed (nothing to wire the downstream package behind).
function fileUpstreamDefects(task, downstreamPid, defects) {
  const cap = Number.isInteger(task.team && task.team.opts && task.team.opts.upstream_fix_rounds)
    ? task.team.opts.upstream_fix_rounds : TEAM_DEFAULTS.upstream_fix_rounds;
  const byUpstream = new Map();
  for (const d of Array.isArray(defects) ? defects : []) {
    const upstreamId = d && d.package != null ? String(d.package) : '';
    if (!upstreamId || upstreamId === String(downstreamPid)) continue; // no id, or a package naming itself
    if (!byUpstream.has(upstreamId)) byUpstream.set(upstreamId, []);
    byUpstream.get(upstreamId).push(d);
  }
  const records = [];
  const targeted = [];
  for (const [upstreamId, group] of byUpstream) {
    const upstreamPkg = packageOf(task, upstreamId);
    if (!upstreamPkg) continue; // not a real package id in this task - nothing to file against
    // Rounds already run against THIS upstream package - every prior fix STORY fileUpstreamDefects
    // itself filed, regardless of which downstream package found the next one. Read off the
    // packages list, the same way qaAttempts (autoRetryPackages) counts dispatch:QA nodes: a
    // filed fix package's own deps names the upstream id it was filed against (see `records`
    // below), so this needs no extra bookkeeping field of its own. packageFiling's own origin
    // (not reporter, which is now the FILER's team id, never the literal 'upstream') is what
    // marks a package as an upstream fix - see tickets.mjs's packageFiling.
    const priorRounds = (task.spec.packages || []).filter((p) => packageFiling(p).origin === 'upstream' && (p.deps || []).map(String).includes(upstreamId)).length;
    if (priorRounds >= cap) {
      task.unresolved_defects = (task.unresolved_defects || []).concat(group.map((d) => ({
        title: (d && d.title) || `upstream defect in ${upstreamId}`, evidence: (d && d.evidence) || '',
        reporter: String(downstreamPid), origin: 'upstream', link: { type: 'blocks', target: upstreamId }, round: priorRounds + 1,
      })));
      record(task, { event: 'upstream_fix_rounds_exhausted', task_id: task.run_id, package_id: String(downstreamPid), upstream: upstreamId, filed: priorRounds });
      continue;
    }
    targeted.push(upstreamId);
    for (const d of group) {
      records.push({
        title: (d && d.title) || `upstream defect in ${upstreamId}`,
        evidence: (d && d.evidence) || '',
        // The upstream package's OWN scope, not the downstream reporter's: the fix has to land
        // in the files the defect actually lives in, and touches[] is what shape's own rule
        // (CONTRACT.shape) already uses to say who owns what.
        touches: (d && Array.isArray(d.touches) && d.touches.length ? d.touches : upstreamPkg.touches) || [],
        deps: [upstreamId],
        // fileDefects' own link builder reads this - explicit, not inferred from deps[0], so a
        // future caller with more than one dep can never silently point the link at the wrong one.
        upstream: upstreamId,
      });
    }
  }
  if (!records.length) return { filed: [], targeted: [], downstream_attempt: null };
  // reporter is the downstream package that FOUND the defect - an actual develop team id (e.g.
  // 'P4'), never the literal 'upstream' a pre-reporter/origin-split package used to carry (see
  // packageFiling's own back-compat comment for why a legacy upstream-filed package can no
  // longer recover this fact at all).
  const out = fileDefects(task, records, { reporter: String(downstreamPid), origin: 'upstream' });
  const fixAcceptsByUpstream = {};
  out.acceptIds.forEach((accId, i) => {
    const upstreamId = records[i].deps[0];
    (fixAcceptsByUpstream[upstreamId] = fixAcceptsByUpstream[upstreamId] || []).push(accId);
  });
  // Reopen the downstream package's own next attempt - retryPackage's usual move (supersede the
  // open attempt, keep its retry budget, reopen a failed integrate that blamed it) EXCEPT for its
  // deps: retryPackage would copy the package's very FIRST dispatch's deps unchanged, which is
  // exactly the stale accept:<upstream>:N this whole mechanism exists to stop retrying against.
  const feedback = `blocked on a defect this package found outside its own scope, in ${targeted.join(', ')}: waiting for the fix package(s) filed against ${targeted.join(', ')} to be accepted before retrying.`;
  const retried = retryPackage(task, downstreamPid, feedback);
  if (retried.attempt) {
    const dispatchNode = task.nodes.find((x) => x.node_id === `dispatch:${downstreamPid}:${retried.attempt}`);
    if (dispatchNode) {
      const rewritten = [];
      for (const dep of dispatchNode.deps) {
        const m = /^accept:(.+):\d+$/.exec(dep);
        if (m && fixAcceptsByUpstream[m[1]]) rewritten.push(...fixAcceptsByUpstream[m[1]]);
        else rewritten.push(dep);
      }
      dispatchNode.deps = [...new Set(rewritten)];
      saveRun(task);
    }
  }
  return { task, filed: out.filed, targeted, downstream_attempt: retried.attempt || null };
}

// ---------- the audit phase-Team: planning's second pass (v0.12.1 Task 2, §2, §3) ----------
//
// Opens AUDIT in front of gate:goal, the same shape the QA phase-Team takes, once the node
// gate:goal currently hangs on has finished - the last accept:QA:N when roles.qa is on, the
// integrate itself when it is off. Gated on roles.planning ALONE (team leader decision #4): the
// audit is planning's own second pass over the EPIC, so hanging it off roles.qa would delete a
// planning stage the user never asked to turn off. The QA report is consumed when one exists and
// is simply absent when it does not - which is also why the brief is built here, at open time,
// rather than at shape: only now is there an integrated result and (maybe) a QA verdict to name.
// routing.mjs's AUTHOR_OF cannot see this run's author: audit's author - the PLAN package's
// draft/revise - ran in a sibling child run, folded away before this one ever opens, so there
// is no in-run peer sharing a subgoal_id the way every other judging stage's actor lookup finds
// one. Read that run once, here, before it is gone (it stays on disk, but there is no reason to
// re-open it every time audit routes a candidate) - revise's identity wins over draft's when
// both exist, because revise is the last hand that actually wrote what audit is now reading.
// With one planning card per feature area (C2) the PRD has several authors; the first card whose
// run shows one is the identity the audit routes away from - every card ran under the same
// child_opts routing, so in practice they are one identity, and the audit's independence is
// recorded either way (broker.mjs's reviewIndependence).
function planAuthorIdentity(task) {
  // Every card's author, distinct (m10): the PRD has one per feature area, and the audit is
  // routed away from, and judged independent of, all of them - not only the first card's.
  const out = [];
  for (const card of livePlanningPkgs(task)) {
    const planDispatch = latestBySubgoal(task, String(card.id), 'dispatch');
    if (!planDispatch || !planDispatch.child) continue;
    const planRun = loadRun(planDispatch.child.cwd, planDispatch.child.run_id);
    if (!planRun || !Array.isArray(planRun.nodes)) continue;
    const author = planRun.nodes.filter((x) => x.stage === 'revise' && x.state === 'done').pop()
      || planRun.nodes.filter((x) => x.stage === 'draft' && x.state === 'done').pop()
      // a light PLAN run (planning-light kind) has one authoring hand: template-fill.
      || planRun.nodes.filter((x) => x.stage === 'template-fill' && x.state === 'done').pop();
    if (!author) continue;
    const id = { executor: author.executor || null, vendor: author.vendor || null, model: author.model || null };
    if (!out.some((x) => x.executor === id.executor && x.vendor === id.vendor && x.model === id.model)) out.push(id);
  }
  return out.length ? out : null;
}

function openAudit(task, afterNodeIds) {
  const after = Array.isArray(afterNodeIds) ? afterNodeIds.slice() : [afterNodeIds];
  const integ = task.nodes.filter((x) => x.stage === 'integrate' && x.state === 'done' && x.integration).pop();
  // The MERGED PRD's stories (plan-integrate, C4) - every planning card's, not one package's.
  const stories = planningStories(task);
  const qaAccepts = after.map((d) => task.nodes.find((x) => x.node_id === d)).filter((x) => x && x.stage === 'accept' && x.state === 'done' && x.result && phaseOfId(task, x.subgoal_id) === 'qa');
  const L = [
    `This is planning's second pass over this task: cross-check what was actually built against the PRD this same Team wrote, and say which user stories are still unmet.`,
    '',
    // awake-beta-ref2 AUDIT:2 (2026-09-25): after a fix round, setgoal listed the source files it
    // meant to inspect in files[], the document-path rule rejected the spec, and the audit ended
    // blocked - the same split planning's own setgoal learned in idol-pm-3.
    `Each audit subgoal's files[] is only the markdown report it writes. The code, tests and documents it must inspect go in that subgoal's sources[] - never in files[].`,
    '',
    'User stories the PRD produced, each with the acceptance it is judged against:',
    // Labels, not the objects: code-sprint-P5's audit read "[object Object]" four times and had
    // to rebuild the stories from the PRD file itself.
    stories.length ? stories.map((u) => {
      const acc = u && typeof u === 'object' && Array.isArray(u.acceptance) ? u.acceptance : [];
      return [`- ${storyLabel(u)}`, ...acc.map((a) => `  - ${a}`)].join('\n');
    }).join('\n') : '- (none)',
  ];
  L.push('', `The merged PRD (every planning card's section) is at ${docPaths(task).prd}. Read it there; the stories above are its "User stories".`);
  for (const qaAccept of qaAccepts) {
    const r = qaAccept.result;
    L.push('', `A QA card has already run (${qaAccept.node_id}). Its verdict, as further evidence - a story whose files exist can still be unmet:`);
    L.push(`- accept: ${r.accept === true} (match ${r.match_pct == null ? '?' : r.match_pct})`);
    if ((r.gaps || []).length) L.push('Gaps it named:', bullets(r.gaps));
    if ((r.defects || []).length) L.push('Defects it reported:', bullets(r.defects.map((d) => (d && d.title) || String(d))));
  }
  task.audit_pkg = {
    id: 'AUDIT', phase: 'audit', flow: 'audit', integration_of: integ ? integ.node_id : null,
    title: 'planning audit',
    brief: L.join('\n'),
    acceptance: ['every user story in the PRD is judged against the integrated result, and the unmet ones are named'],
    deps: [], touches: [],
    // Threaded into the audit child run by openChild as `external_author` - routing.mjs's
    // externalAuthorOf reads it to route audit away from this identity when a peer vendor is
    // available, and broker.mjs's reviewIndependence records reviewer_independence on the audit
    // node's result either way, the same "route away where possible, record it regardless"
    // pattern review/revise already runs for their own in-run author.
    author_identity: planAuthorIdentity(task),
  };
  const accept = pushChain(task, PACKAGE_CHAIN, 'AUDIT', nextIndex(task, 'dispatch:AUDIT'), after, [], {});
  const goal = task.nodes.filter((x) => x.stage === 'gate' && x.subgoal_id == null).pop();
  if (goal) goal.deps = [accept];
  return accept;
}


export { JUDGE_ATTEMPTS_MAX, fileDefects, fileUpstreamDefects, integrateToRepair, notDoneIds, openAudit, openRepair, reintegrateBehind, sameDefectSeen };
