// taskmanager-children.mjs - opening, settling and folding child runs; split out of taskmanager.mjs (card 128 step 1), moved verbatim.
import { clearWaiting, noteWaiting, reserveSlot } from './livecap.mjs';
import { driverAlive, record } from './taskstate.mjs';
import { DEFAULT_KIND, FLOWS, REASONING_STAGES, createRun, loadRun, planDecisions, runState } from './graph.mjs';
import { latestBySubgoal, planningPkgs, storyId } from './tickets.mjs';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyMerge, foldRecords } from './reducers.mjs';
import { SCRATCH_RULE } from './layout-guard.mjs';
import { spawnSync } from 'node:child_process';
import { alreadyApplied, commitWorktree, containsBranch, deliveredBranch, dependencyOrder, ensureWorktree, git, mergeInto, noDriver, ownersOf, packageDiffFiles, packageOf, repairBase, repairWorktree } from './taskmanager-worktree.mjs';
import { notDoneIds, sameDefectSeen } from './taskmanager-repair.mjs';
import { boxedOpts, childContext } from './taskmanager-prompts.mjs';
import { driverRestartsSpent, driverStderrTail, serviceDeadDriver, spawnChildDriver } from './taskmanager-drivers.mjs';
import { missingPrdSections, prdStories, stripDocumentAcceptance } from './taskmanager-handlers.mjs';
import { serviceHarnessRun } from './taskmanager-harness.mjs';
import { storyAsksOf } from './taskmanager-asks.mjs';

// Executed by the server the moment the node is ready. The model never opens a run.
// The slot under max_live_drivers is taken first, before a worktree or a run file exists: a node
// that finds the cap full goes back to pending (the claim's apply writes that), marked
// waiting_cap, and is opened by a later poll. A first driver is the one spawn that is not
// reserveSpawn's, so the reservation is made here and kept until the driver's pid is attached.
export function openChild(task, n, progress = null) {
  let reservation = null;
  if (!noDriver()) {
    const got = reserveSlot(task, { label: n.node_id });
    if (!got.ok) {
      n.state = 'pending';
      delete n.child;
      noteWaiting(task, n, n.node_id, got);
      return;
    }
    reservation = got.slot;
  }
  try {
    openChildOnSlot(task, n, progress, reservation);
  } finally {
    if (reservation) reservation.release();
  }
}

function openChildOnSlot(task, n, progress, reservation) {
  const pkg = packageOf(task, n.subgoal_id);
  if (!pkg) {
    n.state = 'failed';
    n.result = { stage_ok: false, reason: `no package ${n.subgoal_id} in the shape` };
    return;
  }
  // A package that depends on others starts from what they delivered: its tree is branched
  // from the first dependency's branch and the rest are merged in. A conflict between two
  // dependencies here is the same fact integration would find later, found earlier.
  const depBranches = (pkg.deps || []).map((d) => deliveredBranch(task, d)).filter(Boolean);
  // A repair package is the exception: its tree is the integration tree of the integrate it
  // repairs, already holding every package's work. Nothing is created and nothing is merged.
  // A planning card is NOT an exception any more (_repo/docs/plans/2026-09-28-teams-cards-everywhere.md
  // C2): several cards plan in parallel, and two of them writing docs/prd.md in the one project
  // cwd would overwrite each other. Each gets its own worktree like a develop package, and a card
  // whose area deps on another's branches from that card's delivered section.
  // A QA phase-Team package is the exception that IS shaped like a repair: it judges the
  // very tree integrate just built, so it reuses that worktree the same way repairWorktree
  // already does for a repair package (§0.3 finding 3 - same mechanism, no new function).
  // The audit phase-Team joins QA in that third exception, and for the same reason: it judges
  // the integrated tree, so its worktree IS the integration worktree.
  // A size-S task's QA card (m4) runs on a snapshot of the S run's working tree, never on the
  // tree itself: the S run wrote straight into the project, uncommitted.
  const wt = pkg.s_snapshot ? ensureWorktree(task, String(pkg.id), pkg.s_snapshot, pkg.title)
    : pkg.repair || pkg.phase === 'qa' || pkg.phase === 'audit'
      ? repairWorktree(task, pkg)
      : ensureWorktree(task, String(pkg.id), pkg.base_branch || depBranches[0] || task.base_ref || 'HEAD', pkg.title);
  // A tree that existed and is gone is the daemon's stop, not this node's failure: the node goes
  // back to pending and the next tick's worktreeGoneStop (advanceDispatches, the daemon step) names
  // it. It reaches here only when the tree vanished after that look.
  if (!wt.ok && wt.gone) {
    n.state = 'pending';
    delete n.child;
    return;
  }
  if (!wt.ok) {
    n.state = 'failed';
    n.result = { stage_ok: false, reason: `could not create a worktree for ${pkg.id}: ${wt.reason}` };
    record(task, { event: 'dispatch_failed', task_id: task.run_id, node_id: n.node_id, reason: n.result.reason });
    return;
  }
  // rollback (_repo/docs/plans/2026-09-23-teams-reducer-human-rollback.md §5, item 3): only a package
  // with a worktree of its own (not repair/qa/audit, which all reuse someone else's
  // tree) has a branch retryPackage can reset. The first time this package id ever creates the
  // worktree, its HEAD is the base every later attempt would roll back to if none of them are
  // ever accepted; retryPackage reads it back via n.base_commit on whichever dispatch node set
  // it, across shape rounds - ensureWorktree keeps ONE worktree per package id forever, so this
  // is written at most once.
  const ownWorktree = !pkg.repair && pkg.phase !== 'qa' && pkg.phase !== 'audit';
  if (ownWorktree && wt.created) {
    const head = git(wt.path, ['rev-parse', 'HEAD']);
    if (head.ok) n.base_commit = head.out;
  }
  // retryPackage (below) stamped n.rollback_to on THIS dispatch node when it opened, if the
  // task's retry_policy is 'rollback' and it found a commit to roll back to. Reused worktree
  // (wt.created false is exactly "a retry continuing where the last attempt left it") is the
  // only case this applies - a fresh worktree has nothing on it yet to discard.
  if (ownWorktree && !wt.created && n.rollback_to) {
    const reset = git(wt.path, ['reset', '--hard', n.rollback_to]);
    if (reset.ok) {
      git(wt.path, ['clean', '-fd']);
      record(task, { event: 'worktree_rolled_back', task_id: task.run_id, node_id: n.node_id, package_id: String(pkg.id), checkpoint: n.rollback_to });
    } else {
      record(task, { event: 'rollback_failed', task_id: task.run_id, node_id: n.node_id, package_id: String(pkg.id), reason: reset.err || reset.out || 'git reset --hard failed' });
    }
  }
  const based_on = [];
  if (wt.created) {
    if (depBranches[0]) based_on.push(depBranches[0]);
    for (const b of depBranches.slice(1)) {
      const m = mergeInto(wt.path, b, `harness: base ${pkg.id} on ${b}`);
      if (!m.ok) {
        const merged = (pkg.deps || []).filter((d) => based_on.includes(deliveredBranch(task, d)));
        const culprit = (pkg.deps || []).find((d) => deliveredBranch(task, d) === b);
        n.state = 'failed';
        n.result = {
          stage_ok: false, accept: false, conflicts: m.conflicts,
          conflicting_packages: [String(culprit), ...merged.map(String)],
          reason: `dependencies of ${pkg.id} conflict with each other on ${m.conflicts.join(', ')} (${culprit} against ${merged.join(', ')}); repackage them`,
        };
        record(task, { event: 'dispatch_failed', task_id: task.run_id, node_id: n.node_id, reason: n.result.reason });
        return;
      }
      based_on.push(b);
    }
  }
  const flow = FLOWS[pkg.flow] ? pkg.flow : (task.flow_chosen && FLOWS[task.flow_chosen] ? task.flow_chosen : 'auto');
  // Every package runs the full harness inside its own child run: plan -> setgoal -> critique
  // -> <chain> -> gate:goal -> report (the fractal rule, _repo/docs/plans/2026-09-17-teams-team.md §2;
  // the 2026-09-21 chain-only shortcut was reverted 2026-09-28). An ordinary STORY package - one
  // this task's own shape produced and its critique passed (not a phase Team, not a repair) -
  // is opened with `package`, which turns its plan into a BUILD plan for this package instead of
  // a re-split (prompts.mjs's packageBlock) and carries its acceptance verbatim into its spec.
  // Every package carries its acceptance verbatim into its spec (m12, _repo/docs/plans/2026-09-28-teams-
  // adversarial-fixes.md) - a repair, a planning/QA/audit card and a filed fix are judged against
  // their acceptance exactly as a shaped STORY is. What differs is what the child is told about
  // where the package came from: only a STORY shape produced has had a manager critique.
  const origin = pkg.repair ? 'repair'
    : ['planning', 'qa', 'audit'].includes(pkg.phase) ? pkg.phase
      : pkg.reporter ? 'filed' : 'shape';
  const child = createRun({
    ...task.child_opts,
    cwd: wt.path,
    request: [String(pkg.brief),
      pkg.phase === 'qa' && notDoneIds(task).length ? `\n\nOut of scope: ${notDoneIds(task).join(', ')} not done (retry budget exhausted) and absent from the integrated result by design. Exercise what was merged; do not report their missing work as a defect.` : '',
      n.feedback ? `\n\nPrevious attempt of this package was rejected - fix this:\n${n.feedback}` : ''].join(''),
    context: childContext(task, pkg),
    isolated: true,
    flow,
    // A phase-Team run is pinned to its flow's kind: a planning run writes a PRD, a qa run
    // runs cases, an audit run audits. mixed:true here let the first real planning run's own
    // plan node decompose the request into develop subgoals and start implementing it.
    mixed: !(pkg.phase === 'planning' || pkg.phase === 'qa' || pkg.phase === 'audit'),
    // Light PLAN mode is one PRD whose stories are the backlog items (§2.2), so it is capped the
    // same way a boxed Sprint's planning run is.
    max_subgoals: pkg.phase === 'planning' && (boxedOpts(task) || pkg.planning_mode === 'light') ? 1 : null,
    planning_mode: pkg.phase === 'planning' && pkg.planning_mode === 'light' ? 'light' : null,
    package: { id: String(pkg.id), origin },
    goal: pkg.title || pkg.brief,
    acceptance: Array.isArray(pkg.acceptance) && pkg.acceptance.length ? pkg.acceptance : null,
    // A STORY-level pin (shape's own `assignee: "human"` on the package, or tm_assign called
    // before this package ever dispatched). The child run holds it at run level and
    // expandSubgoals applies it to every subgoal its setgoal produces (graph.mjs).
    subgoal_assignee: pkg.assignee || null,
    // The audit phase-Team's own judge≠author gap (routing.mjs's externalAuthorOf, broker.mjs's
    // reviewIndependence): only openAudit's package ever sets this field, so every other package
    // threads a plain null through, unchanged.
    external_author: pkg.author_identity || null,
    // §6.2-2: a snapshot of what the task already decided, for openAsk's filter and every
    // stage's prior_decisions. §6.2-3: every package but PLAN is execution phase - it decides
    // new questions by default and only escalates a blocking one.
    // Only when a decision point ran BEFORE execution (§6.5's "when a person is called": a
    // session brainstorm, the brainstorm node, or PLAN) - with none of them, a package is still
    // the first place anyone could be asked, and it keeps asking exactly as before.
    task_decisions: task.decisions || [],
    execution_phase: pkg.phase !== 'planning'
      && (planningPkgs(task).length > 0 || task.session_brainstorm === true || task.nodes.some((x) => x.stage === 'brainstorm')),
  });
  // The child run exists from here on: an open whose apply never lands finds it by this note.
  if (progress) progress({ child_run_id: child.run_id, cwd: wt.path });
  n.state = 'running';
  n.started_at = Date.now();
  n.child = { cwd: wt.path, run_id: child.run_id, branch: wt.branch, flow, based_on };
  record(task, { event: 'dispatch', task_id: task.run_id, node_id: n.node_id, child_run_id: child.run_id, cwd: wt.path, branch: wt.branch });
  if (!noDriver()) {
    n.child.spawn_count = 0; // the first spawn gets no filename suffix; a respawn starts at 1
    const driver = spawnChildDriver(task, n.node_id, n.child);
    if (reservation) reservation.attach(driver);
    n.child.driver = driver;
    clearWaiting(task, n, n.node_id);
    if (progress) progress({ driver });
    record(task, {
      event: 'child_driver_spawned', task_id: task.run_id, node_id: n.node_id, child_run_id: child.run_id,
      pid: driver.pid, cwd: n.child.cwd, log: driver.log, command: driver.command,
      ...(driver.error ? { error: driver.error } : {}),
    });
  }
}

// Whether a running dispatch node's child has stopped running - the point past which foldChild
// can be called without it throwing "still running". Read-only: it does not service a dead
// driver itself (serviceRunningDispatches/foldChild already do that elsewhere) - it only answers
// "is there something to fold", which is what the daemon's own loop needs to know before it
// tries.
export function dispatchSettled(task, n) {
  if (!n.child) return false;
  if (n.child.waiting_capacity) return false; // parked until the reset; autoResumeCapacity reopens it
  if (storyAsksOf(task, n.node_id).length) return false; // parked on a question to its TeamLeader (tm_ask)
  const child = loadRun(n.child.cwd, n.child.run_id);
  if (!child) {
    // Missing file: foldChild will report that, and that IS a fold. Unparseable file: another
    // process is mid-write (or was, before saveRun became write-then-rename); not settled yet.
    return !existsSync(join(n.child.cwd, '.teams_output', 'broker', 'runs', `${n.child.run_id}.json`));
  }
  const st = runState(child).state;
  // waiting_human is not a settled child any more than 'running' is - the package's driver
  // already exited (zero compute while it waits, see graph.mjs's promoteWaitingHuman), but the
  // package itself is not done, not blocked, and not this attempt's failure: folding it here
  // would count a human's turnaround time as a package failure and spend a retry nobody asked
  // for. It stays open until the human answers (tm_submit) and the child moves on its own.
  // A running child whose driver is dead for good (restart budget spent, not parked on
  // capacity) will never advance on its own: that is settled, and foldChild folds it blocked
  // with every attempt's stderr, so the package's retry (or a person) can take it from there.
  if (st === 'running' && driverRestartsSpent(task, n.child)) return true;
  if (st === 'running' || st === 'waiting_human') return false;
  if (st === 'complete') return true;
  // Blocked or missing-report with a live driver: the driver's own broker may be about to open
  // the next attempt (auto_reassign), or is about to exit having reported the block. Either way
  // the settle signal is the driver's exit (serviceRunningDispatches reads its exit file), not
  // this snapshot. seam-silent-beta-E1: folded a 'blocked' P1 whose driver was on implement:U1:2.
  if (n.child.driver && driverAlive(n.child.driver)) return false;
  return true;
}

// serviceDeadDriver generalized to task.s_run, which mirrors n.child but is not a node's child -
// it is the task's own single run under a size-S request. Same story as dispatchSettled: a tiny
// wrapper so the daemon's S-branch does not have to know serviceDeadDriver's node-shaped calling
// convention.
export function serviceSRun(task) {
  return task.harness_run ? serviceHarnessRun(task) : false;
}

// The child's account, read from its file. This is the only place the manager touches a
// run file, and it only reads.
export function foldChild(task, n) {
  const pkg = packageOf(task, n.subgoal_id);
  const child = loadRun(n.child.cwd, n.child.run_id);
  if (!child) return { stage_ok: false, reason: `child run ${n.child.run_id} has no file under ${n.child.cwd}` };
  const cs = runState(child);
  // A goal-gate round a repair superseded is skipped with its old verdict still on it (m9): the
  // live round is the one that judged the work as it now is.
  const goalGate = child.nodes.filter((x) => x.stage === 'gate' && x.subgoal_id === null && x.result && x.state !== 'skipped').pop();
  const report = child.nodes.filter((x) => x.stage === 'report' && x.state === 'done' && x.result).pop();
  // Through the declared registry (reducers.mjs), not an inline Set literal: the same union
  // merge goalConsensus and the run's own `reduce` node use, named once instead of copied.
  // Keyed by (node_id, attempt) - a node this loop sees twice (unlikely here since `child.nodes`
  // is read fresh each call, but the registry does not get to assume that of every caller)
  // still folds to the same set, which is the idempotence property item 1 asks for.
  const changed = applyMerge('union', child.nodes
    .filter((x) => x.result && Array.isArray(x.result.changed_files))
    .map((x) => ({ node_id: x.node_id, attempt: x.attempt || 1, value: x.result.changed_files })));
  // A round may have more than one judge (goal_judges > 1, the default above): the round's
  // consensus - every judge accepting, not any one sibling's own verdict - decides whether it
  // accepted. Reading the last gate node in node order (as this used to, unconditionally) picks
  // whichever sibling happens to sort last, which is not necessarily the primary and is never
  // the AND of all of them - a single dissenting judge could be silently overridden by whichever
  // one node the filter's .pop() lands on. runState already computes the true consensus as
  // goal_verdict, and it reduces to exactly this node's own fields when there is one judge, so
  // overriding with it here is a strict generalization, not a behaviour change, for a run still
  // opened with the legacy default. reason/observations have no consensus-level counterpart
  // (they are free text a single judge writes), so those two still come from the raw node.
  const raw = (goalGate && goalGate.result) || {};
  const gv = cs.goal_verdict;
  const g = gv ? { ...raw, accept: gv.accept, match_pct: gv.match_pct, gaps: gv.gaps, spec_drift: gv.spec_drift } : raw;
  // The child's `reduce` observed its subgoals' artifacts as a set and reported what did not
  // line up, without repairing any of it - deciding is the level above's job, and this is that
  // level. Carrying it into the fold is what makes that true: without this the findings die
  // inside the child run, and the manager integrates a tree whose seams nobody named.
  const reduceNode = child.nodes.filter((x) => x.stage === 'reduce' && x.result).pop();
  const rd = (reduceNode && reduceNode.result) || null;
  const setFindings = rd
    ? {
      undeclared: rd.undeclared || [],
      collisions: rd.collisions || [],
      orphans: rd.orphans || [],
      repairs_needed: rd.repairs_needed || [],
      // The deterministic check (item 2), recorded onto the reduce node's own result by
      // broker.mjs's finishNode - carried up here so the manager's own accept/gate:goal sees a
      // file or heading collision even when the child's LLM reduce pass did not report it.
      write_scope: rd.write_scope || null,
    }
    : null;
  // Read directly off every execute node in the child (graph.mjs's KINDS.qa chain), not off
  // the run's own gate:goal verdict - a defect the QA case set found is real evidence
  // regardless of whether the child run ever reached its goal gate at all (a blocked child,
  // an integration conflict on THIS attempt) or of whether a judging LLM faithfully restated
  // it there. Deduped because a subgoal that retried (a genuine stage_ok:false execute
  // failure, then a clean rerun) can otherwise report the same defect twice. This is what
  // autoRetryPackages (below) reads to decide "file it" over "retry the whole QA package",
  // and what composeTaskPrompt shows the accept:QA agent as "Defects it reported".
  // An execute defect is {title, evidence, repro} (a bare string is still read); the string is its
  // display form and its repro rides in defectRepros, keyed by that string, for the repro gate.
  const defectRepros = {};
  // Card 97: the same defect across gate attempts (equal trimmed title, or equal non-empty trimmed
  // repro.command) is kept once, first wins. Card 109's same-file-and-AC rule is not applied here: it
  // runs once in settleQaRound, after the repro gate, so a refused copy cannot hide a failing one.
  const sameDefect = sameDefectSeen({ fileAc: false });
  const defectsFound = [...new Set(
    child.nodes
      .filter((x) => x.stage === 'execute' && x.result && Array.isArray(x.result.defects))
      .flatMap((x) => x.result.defects.map((d) => {
        if (!d || typeof d !== 'object') return String(d).trim();
        if (sameDefect(d)) return '';
        const str = [d.title, d.evidence].filter((v) => typeof v === 'string' && v.trim()).join(' -> ') || JSON.stringify(d);
        if (d.repro) defectRepros[str] = d.repro;
        return str;
      }))
      .filter(Boolean),
  )];
  // §upstream_defects: a defect this package's own implement/test/gate found OUTSIDE its own
  // scope, in an upstream package it deps on (prompts.mjs's UPSTREAM_DEFECT_CONTRACT) - read
  // straight off every node in the child that can carry one, the same "regardless of whether the
  // child ever reached a goal-gate verdict" reasoning defectsFound above already uses, so a child
  // that never reached its own gate:U1 (folded blocked, not just done) still surfaces what
  // implement/test already found. Deduped by (package, title): a retried attempt that reports the
  // same upstream defect twice must not file it twice.
  const upstreamDefectsFound = (() => {
    const seen = new Map();
    for (const x of child.nodes) {
      const list = x.result && Array.isArray(x.result.upstream_defects) ? x.result.upstream_defects : [];
      for (const d of list) {
        if (!d || !d.package) continue;
        const key = `${d.package}::${d.title || ''}`;
        if (!seen.has(key)) {
          seen.set(key, {
            package: String(d.package),
            title: String(d.title || `upstream defect in ${d.package}`),
            evidence: String(d.evidence || ''),
            touches: Array.isArray(d.touches) ? d.touches.map(String) : [],
          });
        }
      }
    }
    return [...seen.values()];
  })();
  const base = {
    child_run_id: child.run_id,
    child_cwd: n.child.cwd,
    branch: n.child.branch,
    child_state: cs.state,
    child_counts: cs.counts,
    changed_files: changed,
    ...(defectsFound.length ? { defects: defectsFound } : {}),
    ...(Object.keys(defectRepros).length ? { defect_repros: defectRepros } : {}),
    ...(upstreamDefectsFound.length ? { upstream_defects: upstreamDefectsFound } : {}),
    ...(setFindings ? { set_findings: setFindings } : {}),
    // §6.2-3/4: what an execution-phase package could not decide by default - finish() parks it
    // once at EPIC level (escalateBlocking).
    ...(Array.isArray(child.blocking_questions) && child.blocking_questions.length ? { blocking_questions: child.blocking_questions } : {}),
    // §6.2-1: what PLAN settled, carried to the accept:PLAN that writes it into task.decisions.
    ...(pkg && pkg.phase === 'planning' ? { plan_decisions: planDecisions(child) } : {}),
    report: report ? String(report.result.handoff || '') : '',
  };
  if (cs.state === 'running') {
    // A direct tm_submit (skipping tm_next) still gets the same dead-driver handling tm_next
    // gives it on every poll: respawn on the same run_id, or park on capacity, before ever
    // folding blocked. Not persisted here and not thrown: this used to saveRun then throw, which
    // cannot work inside a transaction (a throw aborts the write). It returns {deferred, reason};
    // foldDispatch applies the n.child change in its apply transaction, tm_submit throws the
    // reason to its caller after that commits, and the daemon records daemon_fold_deferred.
    if (n.child.driver && !driverAlive(n.child.driver)) serviceDeadDriver(task, n.child, n.node_id);
    const driver = n.child.driver || null;
    if (n.child.waiting_capacity) {
      return { deferred: true, reason: `dispatch ${n.node_id}: child run ${n.child.run_id} is waiting on provider capacity `
        + `(${n.child.waiting_capacity.reason}). Tell the user the reset time and stop; `
        + `tm_retry({task_id, package_id: "${n.subgoal_id}", reset_capacity: true}) resumes it once capacity is back.` };
    }
    if (!driver || driverAlive(driver)) {
      return { deferred: true, reason: `dispatch ${n.node_id}: child run ${n.child.run_id} is still running (${JSON.stringify(cs.counts)}). `
        + (driver
          ? `Its driver process (pid ${driver.pid}) is still working; wait and poll tm_next, then submit this node again.`
          : `Drive it with team_next/team_run/team_submit at cwd ${n.child.cwd}, then submit this node again.`) };
    }
    // The driver died with the run unfinished and the restart budget (serviceDeadDriver already
    // tried) is spent. That is not a verdict about the package, but it is an honest end for
    // this attempt: fold it as blocked, with every attempt's stderr, so tm_retry can open the
    // next one in the same worktree.
    const restarts = driver.restarts || [];
    const tail = driverStderrTail(driver);
    const tails = [...restarts.map((r) => r.stderr_tail).filter(Boolean), tail].filter(Boolean);
    return {
      ...base, stage_ok: false, accept: false, gaps: g.gaps || [], match_pct: g.match_pct,
      child_state: 'running',
      driver: { pid: driver.pid, log: driver.log, stderr: driver.stderr },
      driver_restarts: restarts,
      driver_stderr: tails.join(' | '),
      reason: `child driver exited (pid ${driver.pid}) after ${restarts.length} restart(s) with the run still running (${JSON.stringify(cs.counts)})`
        + (tails.length ? `: ${tails.join(' | ')}` : ''),
    };
  }
  // A child that ran out of subgoal retries never reached a goal gate that judged anything - its
  // gate:goal is at best "unreachable: gate:U1:3 failed with no retry left" - so the verdicts
  // that actually stopped it are its failed gate/test/review nodes. Without them the retry brief
  // said only that one line (trap-beta-T2, 2026-09-21) and the next attempt had nothing to fix
  // from. Read for a blocked child and for one that wrote its report over a settled failure
  // (runState's `settled`) alike: both are the same "stopped short" to the package's retry.
  const stoppedShort = () => {
    const verdicts = child.nodes
      .filter((x) => x.state === 'failed' && x.result && REASONING_STAGES.has(x.stage) && (x.result.reason || (x.result.gaps || []).length))
      .slice(-3);
    return {
      verdicts,
      vReason: verdicts.map((x) => `${x.node_id}${x.result.match_pct != null ? ` (${x.result.match_pct}%)` : ''}: ${x.result.reason || ''}`).filter(Boolean).join('\n'),
      vGaps: verdicts.flatMap((x) => x.result.gaps || []),
      child_verdicts: verdicts.map((x) => ({ node_id: x.node_id, match_pct: x.result.match_pct, reason: x.result.reason || '', gaps: x.result.gaps || [] })),
    };
  };
  if (cs.state === 'blocked') {
    // The child stopped short of a report. Whatever its goal gate said is still the best
    // account of why, and is what a retried package needs to hear.
    const { verdicts, vReason, vGaps, child_verdicts } = stoppedShort();
    return {
      ...base, stage_ok: false, accept: false,
      gaps: [...new Set([...(g.gaps || []), ...vGaps])],
      match_pct: g.match_pct != null ? g.match_pct : (verdicts.length ? verdicts[verdicts.length - 1].result.match_pct : undefined),
      child_verdicts,
      reason: `child run ended blocked${g.reason ? `: ${g.reason}` : ''}${vReason ? `. Its own verdicts:\n${vReason}` : ''} (${JSON.stringify(cs.counts)})`,
    };
  }
  const settledShort = cs.settled && g.accept !== true ? stoppedShort() : null;
  // An accepted child's work becomes a commit on the package branch, so a dependent package
  // and the integration can start from it. A rejected child's tree is left as it is - the
  // retry continues there.
  let commit = null;
  if (g.accept === true) {
    const guarded = !!pkg && (pkg.repair || pkg.phase === 'qa' || pkg.phase === 'audit');
    const c = commitWorktree(n.child.cwd, `harness: package ${n.subgoal_id} attempt ${n.attempt || 1} (${child.run_id})`, guarded ? { layoutGuard: true } : {});
    if (!c.ok && c.layout) {
      // No `defects`: autoRetryPackages files a qa dispatch that carries them instead of retrying
      // it, and this package has to be redone, not reported. The files stay on disk (retry_policy
      // continue keeps the tree); the feedback names them so the retry deletes them.
      const { defects: _defects, ...rest } = base;
      return {
        ...rest, stage_ok: false, accept: false,
        gaps: [...(g.gaps || []), ...c.paths.map((p) => `delete ${p}`)],
        reason: `child passed but its commit was refused: it added ${c.reason}. These files are still on disk in ${n.child.cwd}; delete them, move what you need under the run dir or the OS temp dir, and finish again. ${SCRATCH_RULE}`,
      };
    }
    if (!c.ok) return { ...base, stage_ok: false, accept: false, reason: `child passed but its worktree could not be committed: ${c.reason}` };
    commit = c.commit;
  }
  // A PRD with no user stories is not a PRD the rest of this task can use: shape's completeness
  // check has nothing to check, the audit has nothing to audit, and every downstream briefing
  // says "(none)". goal-code-beta-R1 (2026-09-18) accepted exactly that at 93% and the run went
  // on to build from the request alone. The child's own gate cannot see this - it judges its
  // document, not what the manager needs from it - so the fold is where it has to be caught.
  const prdPaths = () => ((Array.isArray(g.prd_paths) ? g.prd_paths : []).length
    ? g.prd_paths
    : [...new Set((child.nodes || []).flatMap((x) => (x.result && x.result.changed_files) || []).map(String))]);
  let planningStories = pkg && pkg.phase === 'planning'
    ? (Array.isArray(g.user_stories) ? g.user_stories : []).filter((u) => storyId(u))
    : null;
  // The goal-level AC-n a PRD run sets (about the document itself) are not a story's behaviour:
  // a child that copies them into each story's acceptance[] is stripped of them here.
  const docAcceptance = child.spec && Array.isArray(child.spec.acceptance) ? child.spec.acceptance.filter((x) => typeof x === 'string') : [];
  const declaredAcceptance = pkg && Array.isArray(pkg.acceptance) ? pkg.acceptance : [];
  if (planningStories) planningStories = stripDocumentAcceptance(planningStories, docAcceptance, declaredAcceptance);
  if (planningStories && g.accept === true && !planningStories.length) {
    planningStories = stripDocumentAcceptance(prdStories(n.child ? n.child.cwd : task.cwd, prdPaths()), docAcceptance, declaredAcceptance);
  }
  // Same principle as the story check: a structural requirement the contract states in words is
  // verified here rather than trusted to a judge that accepted a PRD missing three of them.
  if (planningStories && g.accept === true && planningStories.length) {
    const missing = missingPrdSections(n.child ? n.child.cwd : task.cwd, prdPaths(), pkg.planning_mode === 'light' ? 'light' : 'full');
    if (missing.length) {
      return {
        ...base, stage_ok: true, accept: false, match_pct: g.match_pct, user_stories: planningStories,
        gaps: [...(g.gaps || []), ...missing.map((m) => `the PRD has no "${m}" section`)],
        reason: `the PRD is missing required sections: ${missing.join(', ')}. Every one of them is a heading a reader looks for and this document does not answer`,
      };
    }
  }
  // Each story is held to what the card contract asks (m1): acceptance criteria of its own, and
  // an id carrying the card's area prefix (F2-US-1) so ids stay unique across merged cards.
  if (planningStories && g.accept === true && planningStories.length) {
    const prefix = pkg && pkg.area ? `${pkg.area}-US-` : null;
    const storyGaps = [];
    for (const u of planningStories) {
      const id = storyId(u);
      const acc = u && typeof u === 'object' && Array.isArray(u.acceptance) ? u.acceptance.filter((x) => String(x).trim()) : [];
      if (!acc.length) storyGaps.push(`user story ${id} has no acceptance criteria`);
      if (prefix && !id.startsWith(prefix)) storyGaps.push(`user story ${id} does not carry this card's id prefix ${prefix}n`);
    }
    if (storyGaps.length) {
      return {
        ...base, stage_ok: true, accept: false, match_pct: g.match_pct, user_stories: planningStories,
        gaps: [...(g.gaps || []), ...storyGaps],
        reason: `the PRD's user stories do not meet the card contract: ${storyGaps.slice(0, 3).join('; ')}${storyGaps.length > 3 ? ` (+${storyGaps.length - 3} more)` : ''}`,
      };
    }
  }
  if (planningStories && g.accept === true && !planningStories.length) {
    return {
      ...base, stage_ok: true, accept: false, match_pct: g.match_pct, user_stories: [],
      gaps: [...(g.gaps || []), 'the PRD names no user stories, so nothing downstream can be built or audited against it'],
      reason: 'the planning run returned no user stories: the PRD must carry a "## User stories" section and gate:goal must return it as user_stories[]',
    };
  }
  return {
    ...base,
    commit,
    stage_ok: true,
    accept: g.accept === true,
    match_pct: g.match_pct != null ? g.match_pct : (settledShort && settledShort.verdicts.length ? settledShort.verdicts[settledShort.verdicts.length - 1].result.match_pct : undefined),
    gaps: settledShort ? [...new Set([...(g.gaps || []), ...settledShort.vGaps])] : (g.gaps || []),
    observations: g.observations || [],
    spec_drift: g.spec_drift || [],
    ...(settledShort ? { child_verdicts: settledShort.child_verdicts } : {}),
    reason: g.accept === true ? '' : `${g.reason || 'child goal gate did not accept'}${settledShort && settledShort.vReason ? `. Its own verdicts:\n${settledShort.vReason}` : ''}`,
    evidence: `child ${child.run_id}: ${cs.counts.done} done, ${cs.counts.failed} failed, ${cs.counts.unreachable} unreachable`,
    // The planning phase-Team's structured bridge (§0.4 finding 2): shape's implements[]
    // completeness check needs the ID list, not the PRD body, which stays in the child run.
    ...(pkg && pkg.phase === 'planning' ? {
      user_stories: planningStories && planningStories.length ? planningStories : (Array.isArray(g.user_stories) ? g.user_stories : []),
      // Where the PRD actually is. The child's own nodes recorded it; nothing else knows, and
      // shape's briefing has no other way to name a file a reader can open.
      prd_paths: [...new Set((child.nodes || []).flatMap((x) => (x.result && x.result.changed_files) || []).map(String))],
    } : {}),
  };
}

export function prepareIntegration(task, n) {
  const round = Number(String(n.node_id).split(':')[1] || 1);
  // After an accepted repair, this round starts FROM the repaired integration branch and
  // merges nothing: that branch already is every package branch merged, plus the repair. The
  // seam was fixed in the combined tree, and re-merging from HEAD would recreate it.
  const repair = repairBase(task, n);
  const wt = ensureWorktree(task, round === 1 ? 'integration' : `integration-${round}`, repair ? repair.branch : (task.base_ref || 'HEAD'));
  if (!wt.ok) {
    n.state = 'failed';
    n.result = { stage_ok: false, verified: false, reason: `could not create the integration worktree: ${wt.reason}` };
    return;
  }
  const merged = repair ? [{ package: repair.package, branch: repair.branch, commit: repair.commit }] : [];
  // A package whose dispatch was permanently skipped (§B.1: budget/timebox exhausted before it
  // ever got a driver) never has a delivered branch and never will - unlike an ordinary pending
  // retry, which this integrate would simply wait for. Read its LATEST attempt, not "any": a
  // package that was skipped once and later retried (not today's budget path, but a state this
  // general check should not misread) has a real delivered branch by its later attempt.
  const skippedForBudget = (id) => { const d = latestBySubgoal(task, String(id), 'dispatch'); return !!d && d.state === 'skipped'; };
  // After a budget stop nothing will be retried, so a package that failed before the stop will
  // not deliver either: the sweep's integrate depends on the accepted ones only, and this merges
  // the same set. code-sprint-P3: P2's dispatch failed as the box ran out, integrate:2 refused
  // "package P2 has no delivered branch", and P1 - accepted - never reached an integration tree.
  // A spent retry budget (reintegrateExhausted) leaves the same hole: the not-done packages never deliver.
  const undeliverable = (id) => skippedForBudget(id) || (task.budget_stopped && !deliveredBranch(task, id)) || notDoneIds(task).includes(String(id));
  const ordered = dependencyOrder((task.spec.packages || []).filter((p) => !p.repair && !undeliverable(p.id)));
  // Card 109: a package whose change is already in the tree is not merged again, and a FILED
  // package (reporter) that conflicts is deferred to one repair package instead of ending the
  // integrate `blocked` (E-ea14c9c4: duplicates of one fix, all accepted). A shape package's
  // conflict is a shape failure and keeps the repackage route below.
  const settled = repair ? ((packageOf(task, repair.package) || {}).settles || []).map(String) : [];
  const alreadyIn = [];
  const deferred = [];
  for (const p of ordered) {
    const branch = deliveredBranch(task, p.id);
    if (!branch) {
      n.state = 'failed';
      n.result = { stage_ok: false, verified: false, reason: `package ${p.id} has no delivered branch to merge` };
      return;
    }
    // A package branch the repair was made on is already in this tree. Only one delivered
    // since - a retry that landed while the repair ran - is outside it, and it is merged in
    // dependency order like any other.
    if (repair && containsBranch(wt.path, branch)) {
      if (settled.includes(String(p.id))) alreadyIn.push({ package: String(p.id), branch });
      continue;
    }
    if (alreadyApplied(task, wt.path, p.id, branch)) {
      alreadyIn.push({ package: String(p.id), branch });
      continue;
    }
    const m = mergeInto(wt.path, branch, `harness: integrate ${p.id} (${branch})`);
    if (!m.ok && p.reporter) {
      const withPkgs = merged.filter((x) => { const q = packageOf(task, x.package); return q && !q.repair && packageDiffFiles(task, wt.path, x.package, x.branch).some((f) => m.conflicts.includes(f)); }).map((x) => x.package);
      deferred.push({ package: String(p.id), branch, conflicts: m.conflicts, with: withPkgs });
      continue;
    }
    if (!m.ok) {
      const owners = ownersOf(ordered.filter((q) => merged.some((x) => x.package === String(q.id))), m.conflicts);
      n.state = 'failed';
      n.result = {
        stage_ok: false, verified: false,
        integration_branch: wt.branch, merged: merged.map((x) => `${x.package} ${x.branch} -> ${x.commit}`),
        conflicts: m.conflicts,
        conflicting_packages: [String(p.id), ...owners],
        reason: `merge of ${p.id} conflicts on ${m.conflicts.join(', ')}`
          + (owners.length ? ` with ${owners.join(', ')} (by declared touches)` : ' with an already merged package none of them declared')
          + `; tm_retry({repackage: [${[String(p.id), ...owners].map((x) => `"${x}"`).join(', ')}]}) reshapes them together`,
      };
      record(task, { event: 'integrate_conflict', task_id: task.run_id, node_id: n.node_id, conflicts: m.conflicts, packages: n.result.conflicting_packages });
      return;
    }
    merged.push({ package: String(p.id), branch, commit: m.commit });
  }
  for (const a of alreadyIn) record(task, { event: 'integrate_already_applied', task_id: task.run_id, node_id: n.node_id, package: a.package, branch: a.branch });
  const base = { cwd: wt.path, branch: wt.branch, merged, ...(alreadyIn.length ? { already_applied: alreadyIn } : {}), ...(repair ? { based_on: 'repair', repair_package: repair.package } : (task.base_ref ? { based_on: 'base_ref', base_ref: task.base_ref } : {})) };
  if (deferred.length) {
    // No `conflicts` key: that is what integrateToRepair refuses as a shape failure. The tree
    // exists, holds everything that merged, and the daemon's autoRepair opens one repair on it.
    n.state = 'failed';
    n.integration = base;
    n.result = {
      stage_ok: false, verified: false,
      integration_branch: wt.branch, merged: merged.map((x) => `${x.package} ${x.branch} -> ${x.commit}`),
      deferred_conflicts: deferred,
      reason: deferred.map((d) => `merge of ${d.package} conflicts on ${d.conflicts.join(', ')}${d.with.length ? ` with ${d.with.join(', ')}` : ''}`).join('; ')
        + '; settled as one repair package on the integration tree',
    };
    record(task, { event: 'integrate_conflict', task_id: task.run_id, node_id: n.node_id, deferred: true, conflicts: [...new Set(deferred.flatMap((d) => d.conflicts))], packages: deferred.map((d) => d.package) });
    return;
  }
  const packageTests = runPackageTests(task, wt.path, merged.map((m) => m.package));
  n.integration = { ...base, ...(packageTests.length ? { package_tests: packageTests } : {}) };
  record(task, { event: 'integrated', task_id: task.run_id, node_id: n.node_id, merged: merged.length, ...(repair ? { based_on: 'repair' } : {}), ...(packageTests.length ? { package_tests: packageTests.map((t) => `${t.package}:${t.exit}`) } : {}) });
}

// Each merged package's OWN test command, run by the manager in the combined tree, as facts for
// the integrate judge. seam-beta-D2: cli's tests passed under the root runner and failed 0/10
// run on their own, and no judge ever ran them that way. Mechanical and ecosystem-narrow on
// purpose: a package whose declared touches hold a package.json with a `test` script is run with
// `npm test --prefix <dir>` (120s cap); anything else is not measured here, and the judge still
// runs its own checks.
export function runPackageTests(task, cwd, pkgIds) {
  if (noDriver() && !process.env.HARNESS_PACKAGE_TESTS) return []; // test seam: nothing is spawned
  const out = [];
  for (const id of pkgIds) {
    const pkg = packageOf(task, id);
    if (!pkg || pkg.repair) continue;
    const dirs = [...new Set((pkg.touches || []).map((t) => String(t).replace(/\/\*.*$/, '').replace(/\/$/, '')).filter((t) => t && !/[*?]/.test(t)))];
    for (const d of dirs) {
      let scripts = null;
      try { scripts = JSON.parse(readFileSync(join(cwd, d, 'package.json'), 'utf8')).scripts || null; } catch { continue; }
      if (!scripts || !scripts.test) continue;
      const r = spawnSync('npm', ['test', '--prefix', d], { cwd, encoding: 'utf8', timeout: 120000, env: { ...process.env, CI: '1' } });
      const tail = `${r.stdout || ''}${r.stderr || ''}`.split('\n').filter((l) => /# (pass|fail|tests)|failing|passing|Error|not ok/i.test(l)).slice(-6).join(' | ');
      out.push({ package: String(id), dir: d, command: `npm test --prefix ${d}`, exit: r.status == null ? (r.error ? 'error' : 'timeout') : r.status, summary: tail.slice(0, 400) });
      break; // one test command per package
    }
  }
  return out;
}

// The manager-level reduce (item 4): a package's own dispatch attempts are its RETRY history,
// not siblings - a rejected attempt 1 must not veto an accepted attempt 3 the way a dissenting
// SIBLING judge should. So every field folds through the same registry foldChild and the
// run-level `reduce` node use (reducers.mjs), except `accept` itself, which this function
// deliberately overrides to last-by-attempt instead of the registry's and-consensus default -
// the registry's `accept` rule is for consensus among SIBLINGS in one round (graph.mjs's
// goalConsensus), and a package's retry history is not that.
function packageReducerKind(pkg) {
  if (!pkg) return DEFAULT_KIND;
  if (pkg.phase === 'planning') return 'planning';
  if (pkg.phase === 'qa') return 'qa';
  if (pkg.phase === 'audit') return 'planning-audit';
  return DEFAULT_KIND;
}

export function foldPackageHistory(task) {
  const out = {};
  for (const pkg of (task.spec && task.spec.packages) || []) {
    const dispatches = task.nodes.filter((x) => x.stage === 'dispatch' && x.subgoal_id === String(pkg.id) && x.result);
    if (!dispatches.length) continue;
    const records = dispatches.map((x) => {
      const r = x.result;
      const fields = {
        changed_files: r.changed_files || [],
        gaps: r.gaps || [],
        reason: r.reason || '',
      };
      if (Array.isArray(r.defects)) fields.defects = r.defects;
      if (Number.isFinite(r.match_pct)) fields.match_pct = r.match_pct;
      // Not tracked anywhere in this codebase today (see reducers.mjs's DEFAULT_FIELDS
      // comment) - carried through untouched, for whenever a dispatch result starts
      // reporting one, rather than requiring a registry change to pick it up.
      if (r.cost !== undefined) fields.cost = r.cost;
      return { node_id: x.node_id, attempt: x.attempt || 1, fields };
    });
    const acceptEntries = dispatches
      .filter((x) => x.result.accept !== undefined)
      .map((x) => ({ node_id: x.node_id, attempt: x.attempt || 1, value: x.result.accept === true }));
    out[String(pkg.id)] = {
      ...foldRecords(packageReducerKind(pkg), records),
      accept: acceptEntries.length ? applyMerge('last-by-attempt', acceptEntries) : undefined,
      attempts: records.length,
    };
  }
  return out;
}
