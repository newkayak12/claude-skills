// tickets.mjs - derives JIRA-style ticket state from task.json (and, for a TASK, its child
// run's own file). Pure: no writes, ever - the design doc's §4 principle that ticket state is a
// function of engine state, never a second source of truth. The one impure-looking thing here is
// reading a child run's file (`loadRun`), which taskmanager.mjs already does for the same reason
// (its own header: "READS child run files and never writes them") - a read is not a write.
//
// "alive" (whether a dispatch's driver process is still running) is the one input this module
// cannot derive from task.json alone - task.json never stores it, only a pid. Every function that
// needs it takes an injectable `{ alive }` predicate defaulting to a real process.kill(pid, 0)
// check, so a unit test can fix it without a real pid and the module stays otherwise pure.
import { join } from 'node:path';
import { loadRun, unmetDeps, runState, nodeKind, KINDS } from './graph.mjs';
import { TEAM_DEFAULTS } from './teamconfig.mjs';

export function epicKey(taskId) {
  return `E-${String(taskId).slice(0, 8)}`;
}
export function storyKey(taskId, pkgId) {
  return `${epicKey(taskId)}/${pkgId}`;
}
export function taskKey(taskId, pkgId, subgoalId) {
  return `${storyKey(taskId, pkgId)}/${subgoalId}`;
}

// §7c: the project's own docs_dir (team.json, default .teams_output/team - already resolved onto
// every task by teamconfig.mjs's TEAM_DEFAULTS) holds one directory per EPIC. story() is a
// function because a STORY's file lives one level deeper, under 40-stories/.
//
// The fallback reads TEAM_DEFAULTS.docs_dir rather than repeating its literal. It only fires
// for a task.json written before task.team existed; createTask has set it on every task since
// (taskmanager.mjs:187). Re-typing that literal here made this a second site deciding the same
// default - the shape be83bbc shipped, where the two literals agreed and nothing made them
// keep agreeing.
export function docPaths(task) {
  const docsDir = (task.team && task.team.opts && task.team.opts.docs_dir) || TEAM_DEFAULTS.docs_dir;
  const base = join(task.cwd, docsDir, epicKey(task.run_id));
  return {
    dir: base,
    index: join(base, 'INDEX.md'),
    request: join(base, '00-request.md'),
    planning: join(base, '10-planning.md'),
    prd: join(base, '10-prd.md'),
    shape: join(base, '20-shape.md'),
    critique: join(base, '30-critique.md'),
    story: (pkgId) => join(base, '40-stories', `${pkgId}.md`),
    integrate: join(base, '50-integrate.md'),
    qa: join(base, '60-qa.md'),
    audit: join(base, '65-audit.md'),
    goalGate: join(base, '70-goal-gate.md'),
    report: join(base, '80-report.md'),
  };
}

function processAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return !!(e && e.code === 'EPERM'); }
}

// The highest-attempt node for a package/stage pair, or null. A retried STORY always has to be
// read from its latest attempt - the failed prior one is kept around as evidence, not as current.
export function latestBySubgoal(task, pkgId, stage) {
  const list = task.nodes.filter((n) => n.subgoal_id === String(pkgId) && n.stage === stage);
  return list.length ? list[list.length - 1] : null;
}

// The current node for a goal-level stage. Stage alone disambiguates it - unlike 'gate', which
// a subgoal's own chain also uses, 'integrate' never names anything but the goal-level node, so
// no subgoal_id filter is needed. A repair (openRepair in taskmanager.mjs) opens a fresh
// `integrate:N` and rewires every other node's deps/after from the old one to it, but leaves the
// old, now-superseded node in place as evidence - so "current" means latest by push order, the
// same "last in array wins" rule latestBySubgoal already uses for a retried STORY's
// dispatch/accept.
function latestGoalNode(task, stage) {
  const list = task.nodes.filter((n) => n.stage === stage);
  return list.length ? list[list.length - 1] : null;
}

// Whether the task has actually reached goal level, not merely had its goal-level nodes created.
// expandPackages (taskmanager.mjs) pushes integrate/gate:goal/report onto task.nodes in the same
// call that opens the package dispatch/accept chains - so `some(n => n.stage === 'integrate')`
// is true from the instant task.spec exists, long before any package is dispatched, let alone
// accepted. The integrate node's own `deps` are every package's accept id (see expandPackages),
// a data dependency: unmetDeps() reads it empty only once every one of those accepts has reached
// `done` - exactly "every package has been judged" the same way storyTicketState's own
// `unmetDeps(task, dispatch).length ? 'BACKLOG' : 'READY'` already distinguishes "not yet
// reachable" from "ready to run", and it reads off the dependency graph rather than off a node's
// own mutable `state`, which a fresh, not-yet-scheduled integrate node would still show as
// 'pending' even after every accept has landed.
function goalLevelReached(task) {
  const integrate = latestGoalNode(task, 'integrate');
  return !!integrate && unmetDeps(task, integrate).length === 0;
}

// §4's STORY row, plus CANCELLED/UNREACHABLE (the workflow diagram already draws these; the
// mapping table just did not spell them out - see the plan's 발견 4) and no WAITING_USER (no
// human executor exists yet to produce it - 발견 1).
export function storyTicketState(task, pkgId, opts = {}) {
  const alive = opts.alive || processAlive;
  const dispatch = latestBySubgoal(task, pkgId, 'dispatch');
  if (!dispatch) return 'BACKLOG'; // defensive: expandPackages always creates one alongside the spec entry
  if (dispatch.state === 'skipped') return 'CANCELLED';
  if (dispatch.state === 'unreachable') return 'UNREACHABLE';
  if (dispatch.state === 'pending') return unmetDeps(task, dispatch).length ? 'BACKLOG' : 'READY';
  if (dispatch.state === 'running') {
    if (dispatch.child && dispatch.child.waiting_capacity) return 'WAITING_CAPACITY';
    const driver = dispatch.child && dispatch.child.driver;
    if (driver && !alive(driver.pid)) return 'BLOCKED';
    return 'IN_PROGRESS';
  }
  // dispatch 'failed': either the worktree/merge step itself failed (openChild), or its driver
  // died with the restart budget spent (foldChild) - neither is a judged rejection, both are an
  // infrastructural stop. Same ticket state either way (see the plan's 전제 사실).
  if (dispatch.state === 'failed') return 'BLOCKED';
  // dispatch done: the STORY's outcome is now the manager's own judgement of it, accept.
  const accept = latestBySubgoal(task, pkgId, 'accept');
  if (!accept) return 'IN_REVIEW'; // pushChain always creates dispatch+accept together; kept for safety
  if (accept.state === 'pending' || accept.state === 'running') return 'IN_REVIEW';
  if (accept.state === 'skipped') return 'CANCELLED';
  if (accept.state === 'unreachable') return 'UNREACHABLE';
  if (accept.state === 'done') return accept.result && accept.result.accept === true ? 'DONE' : 'REJECTED';
  return 'REJECTED'; // accept 'failed' (e.g. the no-evidence guard) is still a rejection, no evidence of its own needed
}

// §4's EPIC row (shape 전 -> READY / dispatch 진행 -> IN_PROGRESS / integrate·gate:goal ->
// IN_REVIEW / report -> DONE), plus BLOCKED - not in §4's table, added because runState() already
// knows when nothing can proceed and showing READY/IN_PROGRESS for a stuck EPIC would defeat the
// board's own point (see the plan's 발견 3).
export function epicTicketState(task) {
  if (task.nodes.some((n) => n.stage === 'report' && n.state === 'done')) return 'DONE';
  if (runState(task).state === 'blocked') return 'BLOCKED';
  if (!task.spec) return 'READY';
  return goalLevelReached(task) ? 'IN_REVIEW' : 'IN_PROGRESS';
}

// §6's phase table: plan (size, shape) / setgoal (critique) / impl (dispatch:Pn) / qualitygate
// (accept:Pn, integrate, gate:goal, report). null once the report is done - there is no phase
// left to name.
export function epicPhase(task) {
  if (task.nodes.some((n) => n.stage === 'report' && n.state === 'done')) return null;
  if (!task.spec) {
    const critique = task.nodes.find((n) => n.node_id === 'critique' || n.stage === 'critique');
    return critique && critique.state !== 'pending' ? 'setgoal' : 'plan';
  }
  return goalLevelReached(task) ? 'qualitygate' : 'impl';
}

// Whether a chain node's own state can be trusted as reached progress, rather than the
// placeholder expandSubgoals/pushChain (graph.mjs) leaves sitting there. A subgoal's whole
// chain - author/mid/gate, e.g. implement/test/gate - is pushed by ONE pushChain call, so
// every stage's node exists, in state 'pending', from the instant the subgoal is created,
// long before the author stage even starts. Every OTHER state (running/done/failed/
// skipped/unreachable) only happens through a genuine transition: running/done/failed only
// once the orchestrator actually dispatches the node, which itself requires the node's own
// deps to already be met; skipped/unreachable only via an explicit retry or settleFailure.
// So only 'pending' is ambiguous between "not yet reached" and "ready to run" - and
// unmetDeps (whether the *previous* stage has reached 'done') is exactly what disambiguates
// it, the same reading goalLevelReached (the EPIC fix above) gives the integrate node.
function reached(childRun, n) {
  return n.state !== 'pending' || unmetDeps(childRun, n).length === 0;
}

// §4's TASK row ("자식 run 노드 상태 그대로": implement/draft/cases running -> IN_PROGRESS,
// test/revise/execute -> IN_REVIEW, gate done -> DONE), generalized over kind (subgoal/
// document/planning/qa, whichever v0.10.1 chain the subgoal is) rather than hardcoded to
// implement/test/gate - the same genericness graph.mjs's own engine already has. Extended
// with CANCELLED/UNREACHABLE/BACKLOG/READY/REJECTED for the same reason STORY was: §4's own
// diagram already has them.
//
// Gates on progression, not existence. expandSubgoals pushes a subgoal's whole chain in one
// pushChain call, so checking whether the gate (or mid) node merely EXISTS put every TASK in
// IN_REVIEW for its entire life, the instant its chain was created - the same existence-vs-
// reached confusion epicTicketState had, except here it swallowed almost the whole state
// machine (BACKLOG/READY/IN_PROGRESS/CANCELLED/UNREACHABLE at the author stage) instead of
// skipping one transition. Reading backward from the gate - each stage trusted only once
// `reached()` says the one before it has actually handed off - is what storyTicketState
// already does by construction when it walks dispatch -> accept in stage order.
export function taskTicketState(childRun, subgoalId) {
  const kind = nodeKind(childRun, { subgoal_id: subgoalId }) || 'subgoal';
  const chain = (KINDS[kind] || KINDS.subgoal).chain; // e.g. [implement,test,gate] or [draft,revise,gate]
  const [authorStage, midStage, gateStage] = chain;
  const byStage = (stage) => {
    const list = childRun.nodes.filter((n) => n.subgoal_id === String(subgoalId) && n.stage === stage);
    return list.length ? list[list.length - 1] : null;
  };
  const gate = byStage(gateStage);
  if (gate && reached(childRun, gate)) {
    if (gate.state === 'done') return 'DONE';
    if (gate.state === 'failed') return 'REJECTED';
    if (gate.state === 'skipped') return 'CANCELLED';
    if (gate.state === 'unreachable') return 'UNREACHABLE';
    return 'IN_REVIEW'; // pending-but-ready or running: the mid stage already handed off
  }
  const mid = byStage(midStage);
  if (mid && reached(childRun, mid)) {
    if (mid.state === 'skipped') return 'CANCELLED';
    if (mid.state === 'unreachable') return 'UNREACHABLE';
    // running, pending-but-ready, or failed-not-yet-settled: §4 counts test/revise/execute
    // as already "in review" the moment the author stage has handed off to it.
    return 'IN_REVIEW';
  }
  const author = byStage(authorStage);
  if (!author) return 'BACKLOG'; // defensive: pushChain always creates the whole chain together
  if (author.state === 'running') return 'IN_PROGRESS';
  if (author.state === 'pending') return unmetDeps(childRun, author).length ? 'BACKLOG' : 'READY';
  if (author.state === 'skipped') return 'CANCELLED';
  if (author.state === 'unreachable') return 'UNREACHABLE';
  return 'IN_PROGRESS'; // author failed, not yet retried or settled - a brief window, still "moving"
}

// A STORY's "x/y" tasks column: how many of its child run's subgoals have a DONE task ticket.
// null (not 0/0) before the child run exists at all - "no tasks yet" reads differently from
// "zero of zero tasks done".
export function storyTaskProgress(task, pkgId) {
  const dispatch = latestBySubgoal(task, pkgId, 'dispatch');
  if (!dispatch || !dispatch.child) return null;
  const child = loadRun(dispatch.child.cwd, dispatch.child.run_id);
  if (!child || !child.spec) return null;
  const ids = (child.spec.subgoals || []).map((s) => String(s.id));
  const done = ids.filter((id) => taskTicketState(child, id) === 'DONE').length;
  return `${done}/${ids.length}`;
}

// The full package list a board walks: the planning phase-Team's package (task.planning_pkg)
// first, ahead of shape's own task.spec.packages, then the qa phase-Team's package
// (task.qa_pkg) last - the same order they run in (§2). Neither phase-Team package ever joins
// task.spec.packages (taskmanager.mjs's packageOf reads them straight off these fields), so
// they are stitched in here rather than found in `packages`. Shared by epicBoardRows (one row
// per package) and ticketSnapshot (one key per package) - v0.12.0 gave epicBoardRows this list
// but left ticketSnapshot reading task.spec.packages alone, so the board showed a planning/qa
// row that board.jsonl never logged a single transition for. One list, read by both, closes
// that gap for good.
function boardPackages(task) {
  return [
    ...(task.planning_pkg ? [task.planning_pkg] : []),
    ...((task.spec && task.spec.packages) || []),
    ...(task.qa_pkg ? [task.qa_pkg] : []),
    ...(task.audit_pkg ? [task.audit_pkg] : []),
  ];
}

// One row per package, for tm_board's STORY table. role is p.phase || 'develop'.
export function epicBoardRows(task) {
  return boardPackages(task).map((p) => {
    const id = String(p.id);
    const accept = latestBySubgoal(task, id, 'accept');
    const r = accept && accept.result;
    const last = !r ? '—'
      : r.accept === true ? `accept ${r.match_pct == null ? '?' : r.match_pct}`
      : String(r.reason || 'rejected').slice(0, 60);
    return {
      key: storyKey(task.run_id, id), id, title: p.title || '',
      role: p.phase || 'develop',
      state: storyTicketState(task, id),
      tasks: storyTaskProgress(task, id),
      last_verdict: last,
      // A filed defect STORY (fileDefects, taskmanager.mjs - QA-found or tm_file) carries its own
      // reporter ('qa'/'you'/'planning-audit'); everything else is either a
      // repair package (its worktree IS the integration tree, never filed as a STORY) or
      // shape's own original scope.
      reporter: p.reporter || (p.repair ? 'repair' : 'shape'),
    };
  });
}

// The snapshot a board.jsonl diff is taken over: EPIC key plus every STORY key this task
// currently has a shape for - the planning/qa phase-Team packages included, via the same
// boardPackages() list epicBoardRows renders (see its comment for why they need stitching in).
// storyTicketState applies to a phase-Team package unchanged: pushChain (graph.mjs) opens its
// dispatch/accept chain with subgoal_id 'PLAN'/'QA' exactly as it does for any develop package
// with subgoal_id 'P1', and storyTicketState only ever reads a node by subgoal_id/stage - it
// has no develop-only assumption to violate. Called before AND after a mutating tool call; only
// the keys whose value actually changed become a board.jsonl line (taskmanager.mjs's job, not
// this module's - this module never writes).
export function ticketSnapshot(task, opts = {}) {
  const snap = { [epicKey(task.run_id)]: epicTicketState(task) };
  for (const p of boardPackages(task)) {
    snap[storyKey(task.run_id, p.id)] = storyTicketState(task, String(p.id), opts);
  }
  return snap;
}
