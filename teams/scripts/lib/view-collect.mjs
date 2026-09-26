// collect() builds one plain-JSON model of a task-manager task for a human to look at.
// Both renderers (the HTML page's /state.json and the --once text tree in view.mjs) draw from
// this single function - it is the only place that reads task.json, a child run file, or a
// driver stream. Read-only: nothing here ever writes a file.
//
// task.json / a child run file can be caught mid-write by another process (the daemon, a
// broker). A parse failure is tolerated, not fatal: it is reported on the model as
// `error` / a node's own `read_error`, never thrown past collect().
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadRunAt, runState } from '../../mcp/graph.mjs';
import { driverCostOf, collectDriverCosts } from '../bench/lib/drivercost.mjs';
// listTasks()'s card model speaks tickets.mjs's own vocabulary (EPIC key, ticket state, phase,
// STORY rows) rather than inventing a second one - the same words tm_board and tm_ticket already
// use, so a person moving between the index and those MCP tools never has to re-learn what
// "IN_PROGRESS" or "E-d0ee9043" means.
// storyTicketState/storyKey/taskKey/taskTicketState (§4/§8 - the ticket view) are read here for
// exactly the same reason epicTicketState etc. already were: one derivation, no second copy of
// "what state is this STORY/TASK in" living in view-collect.mjs.
import {
  epicKey, epicTicketState, epicPhase, epicBoardRows, storyLinks,
  storyTicketState, storyKey, taskKey, taskTicketState, storyBlockedReason, flowMetrics,
} from '../../mcp/tickets.mjs';

// ---------- small read helpers, all fail soft ----------

function readJsonRetry(path, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      return { ok: true, value: JSON.parse(readFileSync(path, 'utf8')) };
    } catch (e) {
      if (!existsSync(path)) return { ok: false, error: 'missing' };
      if (i === tries - 1) return { ok: false, error: String(e && e.message || e) };
      // A writer's read-modify-write is a handful of milliseconds; a synchronous busy-wait
      // (no I/O, no promise) is enough to let it land without pulling async into collect().
      const until = Date.now() + 5;
      while (Date.now() < until) { /* spin */ }
    }
  }
  return { ok: false, error: 'unreadable' };
}

function readJsonl(path, limit) {
  let text;
  try { text = readFileSync(path, 'utf8'); } catch { return []; }
  const lines = text.split('\n').filter((l) => l.trim());
  const tail = limit ? lines.slice(-limit) : lines;
  const out = [];
  for (const line of tail) {
    try { out.push(JSON.parse(line)); } catch { /* half-written last line; skip it */ }
  }
  return out;
}

function listTaskIds(tasksDir) {
  try {
    return readdirSync(tasksDir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && existsSync(join(tasksDir, e.name, 'task.json')))
      .map((e) => e.name);
  } catch {
    return [];
  }
}

function taskPathOf(tasksDir, id) { return join(tasksDir, id, 'task.json'); }

function driverInfo(driver, driverAliveFn) {
  if (!driver) return null;
  const cost = driver.log ? driverCostOf(driver.log) : null;
  return {
    pid: driver.pid || null,
    alive: driverAliveFn ? driverAliveFn(driver) : null,
    log: driver.log || null,
    command: driver.command || null,
    restarts: (driver.restarts || []).length,
    cost,
  };
}

// Best-effort "is this pid alive" without importing taskmanager.mjs (which spawns processes
// and touches engagement markers at import time in test mode) - view.mjs is read-only, so it
// gets its own trivial liveness probe identical in effect to taskmanager's driverAlive(): EPERM
// (the pid exists and belongs to someone else - a real, common case for a TaskLeader/TeamLeader
// spawned by a daemon running as a different user, e.g. under sudo or in a container) counts as
// alive, the same distinction driverAlive draws and tickets.mjs's own processAlive already makes
// - a plain try/catch->false here would read every such process as dead on the RESOURCE view.
function pidAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return !!(e && e.code === 'EPERM'); }
}

function elapsedMs(startedAt, endedAt) {
  if (!startedAt) return null;
  return (endedAt || Date.now()) - startedAt;
}

// One manager-level or child-level node, trimmed to what a human wants on a strip: id, stage,
// state, timing, and a one-line verdict summary for a terminal state.
function nodeSummary(n) {
  const r = n.result || {};
  const out = {
    node_id: n.node_id,
    stage: n.stage,
    state: n.state,
    subgoal_id: n.subgoal_id || null,
    started_at: n.started_at || null,
    elapsed_ms: elapsedMs(n.started_at, n.ended_at),
  };
  if (n.state === 'failed' || n.state === 'blocked') {
    out.reason = String(r.reason || '').slice(0, 300) || null;
  }
  if (r.match_pct !== undefined) out.match_pct = r.match_pct;
  if (Array.isArray(r.gaps) && r.gaps.length) out.gaps = r.gaps.slice(0, 5);
  const verdictField = { critique: 'sound', dispatch: 'accept', accept: 'accept', integrate: 'verified', gate: 'accept' }[n.stage];
  if (verdictField && r[verdictField] !== undefined) out.verdict = r[verdictField];
  // executor/model: set on a child run's own chain node once it actually ran (broker.mjs's
  // finish()/submit() write n.executor/n.model off the routing decision - see stagePolicy).
  // The RESOURCE view's "workers per TASK" is this, verbatim - a second lookup would just be
  // this same field re-read from a different door.
  out.executor = n.executor || null;
  out.model = n.model || null;
  // A human-pinned node (graph.mjs's applyHumanPin / openAsk) carries n.assignment.executor
  // 'human' and, once someone is actually holding it, n.state 'waiting_human'. Surfaced here
  // (not just on the package) so both the TICKET view's per-TASK rows and the RESOURCE view's
  // worker strip can show who without either re-deriving it from n.assignment themselves.
  if (n.assignment && n.assignment.executor === 'human') out.assignee = n.assignment.who || 'human';
  // waiting_since (graph.mjs's promoteWaitingHuman/openAsk) is the ONLY timestamp a node parked
  // straight from 'pending' ever gets - it never ran, so started_at (set only once a driver
  // actually picks a node up) stays null and elapsed_ms above reads null too. Gated on the node
  // CURRENTLY reading waiting_human, not merely having waiting_since set: a card a human already
  // answered keeps the field (nothing clears it), and showing a stale "waiting Xh" on a resolved
  // card would be the same error runState's own waiting_human branch exists to avoid.
  if (n.state === 'waiting_human' && n.waiting_since) {
    out.waiting_since = n.waiting_since;
    out.waiting_elapsed_ms = elapsedMs(n.waiting_since);
  }
  return out;
}

// A child run's own node chain (plan -> setgoal -> critique -> implement:* -> test:* -> gate:*
// -> gate:goal -> report, or the cases/execute KIND for a test-writing flow) plus, recursively,
// any nested task-manager task found under <cwd>/.harness-tasks/ - a package worktree that
// itself opened a task-manager task rather than a plain graph run.
//
// `ticketCtx` ({taskRunId, pkgId}), when given, also derives this STORY's TASK children -
// E-xxxxxxxx/Pn/Un keyed rows (id/key/title/state) for the TICKET view's board card - straight
// off the SAME run object already loaded above, not a second read of it. Only the caller that
// builds a top-level packageModel passes it; a recursive call for a nested sub-EPIC's own child
// run does not (that run's TASK children belong to ITS OWN ticket board, not this one's).
function collectChildRun(cwd, runId, visiting, ticketCtx) {
  const run = loadRunAt(join(cwd, '.teams_output', 'broker', 'runs', `${runId}.json`));
  if (!run) return { run_id: runId, cwd, missing: true };
  const state = runState(run);
  const nested = collectNestedTasks(cwd, visiting);
  const tasks = ticketCtx && run.spec && Array.isArray(run.spec.subgoals)
    ? run.spec.subgoals.map((s) => ({
      id: String(s.id),
      key: taskKey(ticketCtx.taskRunId, ticketCtx.pkgId, String(s.id)),
      title: s.title || null,
      state: taskTicketState(run, String(s.id)),
    }))
    : [];
  return {
    run_id: run.run_id,
    cwd,
    flow: run.flow,
    state: state.state,
    counts: state.counts,
    goal_verdict: state.goal_verdict || null,
    nodes: run.nodes.map(nodeSummary),
    nested,
    tasks,
  };
}

// A package's worktree (or a report/repair worktree) can itself hold a nested task under
// <cwd>/.harness-tasks/<task-id>/ - the same daemon-driven size->shape->critique->... shape,
// one level down. Recursion is capped and cycle-guarded: the fixture the live example on disk
// shows one where a worktree's nested task dir reused the SAME task id as an ancestor.
//
// A worktree whose branch happened to commit .harness-tasks/ (idol-beta-pm4's worktrees/P1 and
// P4, 2026-09-24) checks out a frozen COPY of an ancestor's own task.json at this exact nested
// path - same run_id, same store_path (taskmanager.mjs's createTask writes it once, pointing at
// the file's own canonical location), still pointing straight back at the ancestor's real file.
// That is not a second, real nested task: it is a snapshot, and the old `${dir}::${id}` cycle
// guard never caught it because `dir` (a different worktree each time) makes the key different
// every time, even for the identical id. Two independent tells, either enough to skip it: the id
// itself already names an ancestor (renders the SAME top-level graph again, a level deeper), or
// the file's own store_path resolves to an ancestor's task.json rather than to where it is
// actually sitting (catches a copy that also got a fresh id some renaming step assigned it).
// visiting.ancestorIds/ancestorPaths are seeded with the CURRENT task's own id/path by
// collectTaskFromValue below before this ever runs, so "ancestor" always includes the immediate
// parent, not just the ones above it.
function collectNestedTasks(cwd, visiting) {
  const dir = join(cwd, '.harness-tasks');
  if (!existsSync(dir) || visiting.depth > 6) return [];
  const ids = listTaskIds(dir);
  const out = [];
  for (const id of ids) {
    const key = `${dir}::${id}`;
    if (visiting.seen.has(key)) continue;
    visiting.seen.add(key);
    if (visiting.ancestorIds.has(id)) continue; // stale self-copy: an ancestor's own run_id
    const path = taskPathOf(dir, id);
    const read = readJsonRetry(path);
    if (read.ok && read.value && read.value.store_path
      && visiting.ancestorPaths.has(resolve(String(read.value.store_path)))) {
      continue; // stale self-copy: its own store_path still points at an ancestor's task.json
    }
    out.push(collectTask(dir, id, {
      depth: visiting.depth + 1,
      seen: visiting.seen,
      ancestorIds: visiting.ancestorIds,
      ancestorPaths: visiting.ancestorPaths,
    }));
  }
  return out;
}

// `links` is tickets.mjs's own storyLinks(task, pkg.id) - the one source of truth for "blocked
// by / blocks / implements / filed by" (see that function's comment). Read here, not
// re-derived: a second computation of the same relations from pkg.deps is exactly the kind of
// split default this codebase's own tests exist to catch (see test-defaults.mjs).
function packageModel(task, pkg, dispatchNode, acceptNode, visiting) {
  // A retried STORY's newest dispatch node (dispatches[dispatches.length - 1], the caller's own
  // "latest attempt wins" pick) has no `.child` yet the instant it goes pending/running and
  // before the daemon has actually opened its worktree - a real, ordinary window between
  // retries, not an error. Falling straight to `child: null` here loses BOTH the worktree the
  // PREVIOUS attempt already opened and whatever it already spent, exactly the RESOURCE view
  // regression Team P2 reproduced (--task <id> --view resources printing "(not dispatched yet -
  // no worktree)" for a package that plainly has one, from a prior attempt). So: when the
  // CURRENT attempt has no child, fall back to the latest EARLIER attempt of the SAME subgoal
  // that does have one - same worktree, same driver, same cost - tagged retry_pending so a
  // renderer can say plainly "this is the last attempt's team, a new one has not opened yet"
  // rather than silently passing off stale data as current.
  const dispatches = dispatchNode
    ? task.nodes.filter((n) => n.stage === 'dispatch' && n.subgoal_id === dispatchNode.subgoal_id
      && (n.attempt || 1) < (dispatchNode.attempt || 1) && n.child)
      .sort((a, b) => (a.attempt || 1) - (b.attempt || 1))
    : [];
  const retrySource = (!dispatchNode || dispatchNode.child) ? null : dispatches[dispatches.length - 1] || null;
  const childSource = dispatchNode && dispatchNode.child ? dispatchNode : retrySource;
  const child = childSource && childSource.child
    ? {
      run_id: childSource.child.run_id,
      cwd: childSource.child.cwd,
      branch: childSource.child.branch,
      // The RESOURCE view's "waiting_capacity if any" - set on the dispatch node's own child
      // record by serviceDeadDriver (taskmanager.mjs) after a usage-limit death, cleared by the
      // same code once the quota window passes. Not on driverInfo(): it is a fact about the
      // STORY's dispatch, not about the driver process itself (a parked driver has already
      // exited - see storyTicketState's own comment on why this and driver.alive disagree).
      // elapsed_ms is derived here (not stored) off the same `.since` serviceDeadDriver writes -
      // "how long has this STORY been parked" is exactly what a person watching WAITING_CAPACITY
      // wants and today's board never showed.
      waiting_capacity: childSource.child.waiting_capacity
        ? { ...childSource.child.waiting_capacity, elapsed_ms: elapsedMs(childSource.child.waiting_capacity.since) }
        : null,
      driver: driverInfo(childSource.child.driver, pidAliveFromDriver),
      ...collectChildRun(childSource.child.cwd, childSource.child.run_id, visiting, { taskRunId: task.run_id, pkgId: pkg.id }),
      // Only set once the CURRENT dispatch node is the one missing a child - never on the
      // ordinary "this attempt's own child" path, so a ticket already fully re-dispatched never
      // carries a stale flag forward.
      ...(retrySource ? { retry_pending: true, retry_pending_attempt: retrySource.attempt || 1 } : {}),
    }
    : null;
  // The TICKET view's per-card "who, if anyone, is holding this" - a node already
  // waiting_human (nodeSummary's own `assignee`) outranks the STORY-level pin (pkg.assignee,
  // tm_assign/shape's own `assignee` field): a pin can sit on a package for its NEXT attempt
  // without anyone waiting on it right now, but a node actually parked waiting_human always
  // names a real card in tm_inbox today.
  const waitingNode = child && Array.isArray(child.nodes) ? child.nodes.find((n) => n.state === 'waiting_human') : null;
  const pinWho = pkg.assignee && typeof pkg.assignee === 'object' ? (pkg.assignee.who || 'human') : (pkg.assignee ? 'human' : null);
  const assignee = (waitingNode && waitingNode.assignee) || pinWho || null;
  return {
    id: pkg.id,
    title: pkg.title || null,
    brief: String(pkg.brief || '').slice(0, 200),
    phase: pkg.phase || null,
    deps: pkg.deps || [],
    // Set only on a package fileDefects() created (a QA-found defect, an audit-found unmet
    // story, or a user's tm_file) - null for a package shape itself declared. This is the only
    // way a human looking at the board can tell "this STORY exists because QA/audit found
    // something" apart from "this STORY is part of the original plan".
    reporter: pkg.reporter || null,
    links: storyLinks(task, pkg.id),
    dispatch: dispatchNode ? nodeSummary(dispatchNode) : null,
    accept: acceptNode ? nodeSummary(acceptNode) : null,
    child,
    // ticket_key/ticket_state: the TICKET view's board column and card header - storyTicketState
    // (tickets.mjs), the exact same derivation tm_board/tm_ticket use, so this surface can never
    // show a STORY in a column those MCP tools would disagree with.
    ticket_key: storyKey(task.run_id, pkg.id),
    ticket_state: storyTicketState(task, String(pkg.id)),
    // "Why is it waiting" - tickets.mjs's own storyBlockedReason, the same reads
    // storyTicketState already makes (unmet deps' node ids, a capacity/human park's since, a
    // spent restart budget's count) named instead of thrown away. null for anything not
    // actually blocked - a STORY merely queued (READY) or moving (IN_PROGRESS) has none.
    blocked_reason: storyBlockedReason(task, String(pkg.id)),
    // attempt: the latest dispatch node's own `.attempt` - a retried STORY's Nth dispatch IS the
    // attempt count (pushChain/openRepair increment it in place; see tickets.mjs's
    // latestBySubgoal), not something this file has to count nodes to derive.
    attempt: dispatchNode ? (dispatchNode.attempt || 1) : null,
    assignee,
  };
}

function pidAliveFromDriver(driver) { return pidAlive(driver && driver.pid); }

// task.qa_pkg / task.audit_pkg (§2/§3 of the QA and planning-audit phase-Teams) are not part of
// task.spec.packages - they are a single fixed package template (id 'QA' or 'AUDIT') that can be
// dispatched more than once: a QA round that finds a defect reopens a fresh QA round once the
// fix is integrated (capped by qa_rounds), and an audit round can do the same for an unmet user
// story. Each round is its own dispatch:<id>:<attempt>/accept:<id>:<attempt> node pair sharing
// one subgoal_id - packageModel's own "latest attempt wins" rule (built for a retried develop
// package) would silently hide every round but the last, which is exactly the bug: a QA round
// that found a defect and was then superseded by a clean round 2 would vanish from view.mjs
// entirely. So this walks every attempt, oldest first, and returns one round entry each.
function collectPhaseRounds(task, pkg, subgoalId, visiting) {
  if (!pkg) return [];
  const dispatches = task.nodes.filter((n) => n.stage === 'dispatch' && n.subgoal_id === subgoalId)
    .sort((a, b) => (a.attempt || 1) - (b.attempt || 1));
  return dispatches.map((dispatchNode) => {
    const attempt = dispatchNode.attempt || 1;
    const accepts = task.nodes.filter((n) => n.stage === 'accept' && n.subgoal_id === subgoalId && (n.attempt || 1) === attempt);
    const acceptNode = accepts[accepts.length - 1] || null;
    const pm = packageModel(task, pkg, dispatchNode, acceptNode, visiting);
    const r = (acceptNode && acceptNode.result) || {};
    // 'defects' (QA) and 'unmet' (audit) are the two shapes fileDefects() itself reads off a
    // finished accept node (taskmanager.mjs) - counted here, not left buried in accept.result,
    // because "did this round find anything, and how much" is the single fact a person watching
    // a live run most needs and least wants to go dig a result blob for. taskmanager.mjs's own
    // finish() reads a missing defects/unmet array the same as an empty one
    // (`Array.isArray(result.defects) ? result.defects : []`), so a finished round with neither
    // field present counts as zero, not unknown - null is reserved for "this round has not
    // finished (or was never dispatched) yet", the one case that really is unknown.
    const defects = Array.isArray(r.defects) ? r.defects : [];
    const unmet = Array.isArray(r.unmet) ? r.unmet : [];
    return {
      ...pm,
      id: `${subgoalId}:${attempt}`,
      round: attempt,
      state: (acceptNode && acceptNode.state) || dispatchNode.state,
      defects_count: acceptNode ? defects.length : null,
      defect_titles: acceptNode ? defects.slice(0, 5).map((d) => String((d && d.title) || d)) : null,
      unmet_count: acceptNode ? unmet.length : null,
      unmet_titles: acceptNode ? unmet.slice(0, 5).map((u) => String((u && u.title) || u)) : null,
    };
  });
}

// The one function both renderers call. `tasksDir` is where task.json lives directly under
// <tasksDir>/<taskId>/ - the top-level tasks root for the outermost call, or a package
// worktree's own .harness-tasks/ for a nested one.
// A Sprint's box (budget_usd / timebox_minutes), the same fractions budgetStatus
// (taskmanager.mjs) stops on, computed here from the spend this collect already summed rather
// than a second walk of drivers/. null when neither is set - an unboxed task shows nothing.
function sprintBox(task, spend) {
  const o = (task.team && task.team.opts) || {};
  const budget = Number.isFinite(o.budget_usd) ? o.budget_usd : null;
  const timebox = Number.isFinite(o.timebox_minutes) ? o.timebox_minutes : null;
  if (budget == null && timebox == null) return null;
  const elapsedMin = elapsedMs(task.created_at) / 60000;
  return {
    budget_usd: budget, spend_usd: spend, timebox_minutes: timebox, elapsed_minutes: elapsedMin,
    budget_pct: budget ? spend / budget : null,
    timebox_pct: timebox ? elapsedMin / timebox : null,
    warned: !!task.budget_warned,
    stopped: task.budget_stopped ? { skipped_packages: task.budget_stopped.skipped_packages || [] } : null,
  };
}

export function collectTask(tasksDir, taskId, opts = {}) {
  const path = taskPathOf(tasksDir, taskId);
  const read = readJsonRetry(path);
  if (!read.ok) {
    return { task_id: taskId, tasks_dir: tasksDir, error: `could not read task.json: ${read.error}` };
  }
  try {
    return collectTaskFromValue(tasksDir, taskId, read.value, opts);
  } catch (e) {
    // A task.json caught mid-write can have a node missing fields graph.mjs's runState/
    // readyNodes assume (deps/after always set by node(), but a torn write can still lose
    // half a line). Never let that crash the request - report it as this task's error.
    return { task_id: taskId, tasks_dir: tasksDir, error: `collect failed: ${String(e && e.message || e)}` };
  }
}

function collectTaskFromValue(tasksDir, taskId, task, opts) {
  // Every level adds ITS OWN id/path before recursing into its own packages/s_run, so a nested
  // task discovered one level down already sees its immediate parent as an ancestor, not only
  // the ones further up - see collectNestedTasks' own comment for what this catches.
  const visiting = {
    depth: opts.depth || 0,
    seen: opts.seen || new Set(),
    ancestorIds: new Set([...(opts.ancestorIds || []), taskId]),
    ancestorPaths: new Set([...(opts.ancestorPaths || []), resolve(taskPathOf(tasksDir, taskId))]),
  };
  const isS = !!task.s_run;
  let state, counts, sRun = null;
  if (isS) {
    const run = loadRunAt(join(task.s_run.cwd, '.teams_output', 'broker', 'runs', `${task.s_run.run_id}.json`));
    const cs = run ? runState(run) : { state: 'missing', counts: {} };
    state = cs.state === 'complete' ? 'complete' : (cs.state === 'running' ? 'running' : 'blocked');
    counts = cs.counts || {};
    sRun = {
      cwd: task.s_run.cwd,
      run_id: task.s_run.run_id,
      driver: driverInfo(task.s_run.driver, pidAliveFromDriver),
      nodes: run ? run.nodes.map(nodeSummary) : [],
    };
  } else {
    const cs = runState(task);
    state = cs.state;
    counts = cs.counts || {};
  }

  const packages = [];
  // planning_pkg dispatches BEFORE shape writes task.spec, so it is listed on its own: gated
  // behind spec.packages, a running PLAN team left "packages:" empty for the whole planning
  // phase (code-sprint-S2, 2026-09-26).
  {
    const all = [...((task.spec && Array.isArray(task.spec.packages)) ? task.spec.packages : []), ...(task.planning_pkg ? [task.planning_pkg] : [])];
    for (const pkg of all) {
      // A retried package can have several dispatch:<id>:<attempt> nodes; take the latest.
      const dispatches = task.nodes.filter((n) => n.stage === 'dispatch' && n.subgoal_id === pkg.id)
        .sort((a, b) => (a.attempt || 1) - (b.attempt || 1));
      const dispatchNode = dispatches[dispatches.length - 1] || null;
      const accepts = task.nodes.filter((n) => n.stage === 'accept' && n.subgoal_id === pkg.id)
        .sort((a, b) => (a.attempt || 1) - (b.attempt || 1));
      const acceptNode = accepts[accepts.length - 1] || null;
      packages.push(packageModel(task, pkg, dispatchNode, acceptNode, visiting));
    }
  }

  // task.qa_pkg / task.audit_pkg: the QA and planning-audit phase-Teams (view-collect.mjs's
  // packages loop above only ever sees task.spec.packages + planning_pkg, so without this a
  // task with QA or audit turned on drives every one of its rounds - defects found, STORYs
  // filed, the audit's own verdict - with nothing on this surface ever showing it happened).
  const qaRounds = collectPhaseRounds(task, task.qa_pkg, 'QA', visiting);
  const auditRounds = collectPhaseRounds(task, task.audit_pkg, 'AUDIT', visiting);

  const managerStages = task.nodes.filter((n) => !['dispatch', 'accept'].includes(n.stage)).map(nodeSummary);

  const driverTotal = collectDriverCosts(join(tasksDir, taskId));
  const daemon = task.daemon ? {
    pid: task.daemon.pid,
    alive: pidAlive(task.daemon.pid),
    // The RESOURCE view's TaskLeader row: when this process (spawnDaemon, taskmanager.mjs) was
    // started. Present on every task.daemon taskmanager.mjs itself writes (spawnDaemon sets it
    // on both the fresh-spawn and the respawn-after-death branches) - null only for a task never
    // put under a daemon at all (driven by hand / an MCP client polling tm_next directly).
    started_at: task.daemon.started_at || null,
    restarts: task.daemon.restarts || 0,
    exhausted: !!task.daemon.exhausted,
    log: task.daemon.log || null,
  } : null;

  // A NESTED run (visiting.depth > 0 - reached through collectNestedTasks, one level under some
  // package worktree) whose own graph still reads 'running' is only actually running while
  // something down there is alive to move it - its own TaskLeader, a size-S driver, or a
  // package's own TeamLeader. A worktree checked out from a branch that committed its
  // .harness-tasks/ snapshot (see collectNestedTasks' own comment) freezes that reading forever:
  // every pid it names has long since exited, nothing will ever move it again, and showing
  // `running` on it looks exactly like a live task still working. 'stale' names that honestly -
  // the same graph, the same counts, just nothing left alive to act on them.
  //
  // Gated on depth > 0, not applied to every task this function ever collects: a TOP-LEVEL task
  // driven by hand (an MCP client polling tm_next directly, never put under a daemon - the exact
  // case renderResourcesText's own "(no daemon - driven by hand or an MCP client)" line already
  // names as ordinary, not stale) legitimately reads 'running' with no daemon and no driver
  // fields at all under the test seam (HARNESS_TEST_NO_DRIVER) - not a frozen snapshot, just not
  // resourced with a driver process. Only a NESTED copy earns the extra suspicion, because only
  // a nested copy can be the kind of frozen worktree artifact this exists to catch.
  if (visiting.depth > 0 && state === 'running') {
    const anyDriverAlive = (daemon && daemon.alive)
      || (sRun && sRun.driver && sRun.driver.alive)
      || [...packages, ...qaRounds, ...auditRounds].some((p) => p.child && p.child.driver && p.child.driver.alive);
    if (!anyDriverAlive) state = 'stale';
  }

  const ledgerPath = join(tasksDir, taskId, 'ledger.jsonl');
  const events = readJsonl(ledgerPath, 50);
  // flow_metrics: Kanban's other half (tickets.mjs's own flowMetrics) - board.jsonl's transition
  // log read once here, the one place this file already reads a task's own JSONL evidence
  // (ledger.jsonl, one line up), and handed to a pure function rather than re-derived from
  // task.nodes, which only ever knows "now".
  const boardEntries = readJsonl(join(tasksDir, taskId, 'board.jsonl'));
  const flow_metrics = flowMetrics(task, boardEntries);

  return {
    task_id: task.run_id || taskId,
    tasks_dir: tasksDir,
    cwd: task.cwd,
    request: String(task.request || ''),
    // The TICKET view's EPIC header - tickets.mjs's own JIRA vocabulary (READY/IN_PROGRESS/...,
    // plan/setgoal/impl/qualitygate), never `state`/`flow` below (the engine's own run-state
    // words) - the two are deliberately different vocabularies for different audiences (see
    // tickets.mjs's header comment), and this surface shows both rather than picking one.
    ticket: { key: epicKey(task.run_id || taskId), title: deriveTitle(task.request), state: epicTicketState(task), phase: epicPhase(task) },
    size: task.size || null,
    flow: task.flow && task.flow !== 'auto' ? task.flow : (task.flow_chosen || 'auto'),
    kind: task.kind || 'task',
    created_at: task.created_at || null,
    elapsed_ms: elapsedMs(task.created_at),
    state,
    counts,
    daemon,
    cost: { usd: driverTotal.cost_usd, turns: driverTotal.turns, sessions: driverTotal.sessions },
    budget: sprintBox(task, driverTotal.cost_usd),
    manager_stages: managerStages,
    packages,
    qa: task.qa_pkg ? { id: task.qa_pkg.id, rounds: qaRounds } : null,
    audit: task.audit_pkg ? { id: task.audit_pkg.id, rounds: auditRounds } : null,
    s_run: sRun,
    events,
    flow_metrics,
    error: null,
  };
}

// A short, human-quotable headline for a card - there is no title field on a task, only
// `request` (a free-text sentence or paragraph a person typed). Takes the first sentence/clause
// (up to the first ./!/?), falls back to the whole string when none of those appear, then
// truncates. The full `request` is never lost: view.mjs's per-task page (and --task <id>) still
// show it in full - this is only the index's headline.
const TITLE_MAX = 72;
export function deriveTitle(request) {
  const s = String(request || '').trim();
  if (!s) return '(no request)';
  const clause = (s.match(/^[^.!?]*[.!?]/) || [s])[0].replace(/[.!?]+$/, '').trim();
  if (clause.length <= TITLE_MAX) return clause;
  return `${clause.slice(0, TITLE_MAX - 1).trimEnd()}…`;
}

// epicBoardRows' own `reporter` field (tickets.mjs) is not itself "was this filed as a defect" -
// it defaults to 'shape' for an ordinary package and 'repair' for a repair package precisely so
// tm_board always has SOME reporter to print. A filed defect/unmet-story STORY is the one whose
// reporter is one of these four - fileDefects (taskmanager.mjs) never writes any other value -
// the same set epicBoardRows' own comment names. 'upstream' is fileUpstreamDefects' own reporter
// (taskmanager.mjs, §upstream_defects): a fix STORY a downstream package's dispatch/accept filed
// against an upstream dependency it deps on, same fileDefects machinery, different filer.
const FILED_REPORTERS = ['qa', 'you', 'planning-audit', 'upstream'];

// A task's STORY rows that are develop work (epicBoardRows' `role` is 'develop' for a plan
// package and any filed defect/unmet-story STORY; PLAN/QA/AUDIT phase-Team packages carry their
// own phase as role instead) - what a person scanning the index means by "how much of the actual
// work is done", and separately, how many of those rows a QA or planning-audit round filed
// (reporter in FILED_REPORTERS) that have not yet reached DONE/CANCELLED/UNREACHABLE - still
// open, still something to look at.
function storyProgress(task) {
  const rows = epicBoardRows(task).filter((r) => r.role === 'develop');
  const openDefects = rows.filter((r) => FILED_REPORTERS.includes(r.reporter) && !['DONE', 'CANCELLED', 'UNREACHABLE'].includes(r.state)).length
    // task.unresolved_defects: a defect/unmet-story found after the QA/planning-audit round cap
    // was already spent - never filed as a STORY at all (fileDefects is skipped for these; see
    // taskmanager.mjs), so epicBoardRows never sees them. Still a real, still-open problem this
    // run will not fix on its own - counted in, not silently dropped.
    + (Array.isArray(task.unresolved_defects) ? task.unresolved_defects.length : 0);
  return {
    storiesDone: rows.length ? rows.filter((r) => r.state === 'DONE').length : null,
    storiesTotal: rows.length || null,
    openDefects,
  };
}

export function listTasks(tasksDir) {
  const ids = listTaskIds(tasksDir);
  const rows = [];
  for (const id of ids) {
    const key = epicKey(id);
    const read = readJsonRetry(taskPathOf(tasksDir, id));
    if (!read.ok) { rows.push({ task_id: id, epic_key: key, error: read.error }); continue; }
    const task = read.value;
    let state = 'unknown', phase = null, stories = { storiesDone: null, storiesTotal: null, openDefects: 0 };
    try {
      // epicTicketState/epicPhase (tickets.mjs) now read task.s_run themselves - a size-S
      // task's own state/phase come from the child run they point at, not from task.spec,
      // which a size-S task never sets. storyProgress still only makes sense for a task that
      // shaped packages (epicBoardRows reads task.spec.packages), so it stays skipped for one.
      state = epicTicketState(task);
      phase = epicPhase(task);
      if (!task.s_run) stories = storyProgress(task);
    } catch { /* leave 'unknown' / no progress - a torn task.json should not crash the index */ }
    const driverTotal = collectDriverCosts(join(tasksDir, id));
    rows.push({
      task_id: id,
      epic_key: key,
      title: deriveTitle(task.request),
      state,
      phase,
      size: task.size || null,
      created_at: task.created_at || null,
      elapsed_ms: elapsedMs(task.created_at),
      cost_usd: driverTotal.cost_usd,
      stories_done: stories.storiesDone,
      stories_total: stories.storiesTotal,
      open_defects: stories.openDefects,
    });
  }
  rows.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
  return rows;
}
