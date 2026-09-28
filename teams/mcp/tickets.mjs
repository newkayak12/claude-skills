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
import { pidAlive } from './proc.mjs';
import { join } from 'node:path';
import { loadRun, loadRunAt, unmetDeps, runState, nodeKind, authorStage, KINDS } from './graph.mjs';
import { TEAM_DEFAULTS } from './teamconfig.mjs';

export function epicKey(taskId) {
  return `E-${String(taskId).slice(0, 8)}`;
}
export function initiativeKey(slug) {
  return `I-${slug}`;
}
export function storyKey(taskId, pkgId) {
  return `${epicKey(taskId)}/${pkgId}`;
}
export function taskKey(taskId, pkgId, subgoalId) {
  return `${storyKey(taskId, pkgId)}/${subgoalId}`;
}

// One key parser for every INITIATIVE/EPIC/STORY/TASK key this module and tm_ticket/tm_assign
// resolve - `I-<slug>`, `E-xxxxxxxx`, `E-xxxxxxxx/Pn`, or `E-xxxxxxxx/Pn/subgoalId`. Before this,
// tm_ticket's own regex (taskmanager.mjs's toolTicket) captured everything past the STORY segment
// as one greedy group, so a TASK-shaped key silently became a STORY lookup for a package id that
// could never exist ("Pn/subgoalId"). tm_assign needs the same three-way split tm_ticket does
// (STORY for a package, TASK for a subgoal - see the plugin's tm_assign spec), so it lives here
// once and both tools resolve a key identically.
//
// An `I-<slug>` key never carries epic8/pkgId/subgoalId - it names a group of EPICs, not a run -
// so tm_assign's own `!parsed.pkgId` guard already rejects it exactly as it rejects a bare EPIC
// key, with no extra branch of its own needed there. The slug charset matches
// teamconfig.mjs's normalizeInitiative output (lowercase alphanumerics and single '-' runs, no
// leading/trailing '-') - the only shape that function ever produces.
export function parseTicketKey(key) {
  const s = String(key || '');
  const mi = /^I-([a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(s);
  if (mi) return { initiative: mi[1] };
  const m = /^E-([0-9a-f]{8})(?:\/([^/]+)(?:\/(.+))?)?$/.exec(s);
  if (!m) return null;
  return { epic8: m[1], pkgId: m[2] || null, subgoalId: m[3] || null };
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
    // §B.2: the Retrospective + Next backlog the report stage writes, machine-readable and kept
    // beside the human-readable 80-report.md that carries the same two sections in prose.
    retro: join(base, 'retro.json'),
  };
}

function processAlive(pid) {
  if (!pid) return false;
  return pidAlive(pid);
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
    // A package whose child run is parked on a human card looks, from the task-level dispatch
    // node alone, exactly like a dead driver: the driver already exited cleanly the moment
    // team_next found nothing left to offer it (zero compute while waiting - see graph.mjs's
    // promoteWaitingHuman), so `alive(driver.pid)` reads false either way. Reading the child's
    // own runState() is what tells the two apart - the same distinction runState() itself
    // draws between `waiting_human` and `blocked`.
    const child = dispatch.child && dispatch.child.cwd && dispatch.child.run_id
      ? loadRun(dispatch.child.cwd, dispatch.child.run_id) : null;
    if (child && runState(child).state === 'waiting_human') return 'WAITING_HUMAN';
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

// A size-S task's own manager graph (task.nodes) settles the instant `size` resolves - three
// nodes, none of them ever touching task.spec (delegateIfSmall, taskmanager.mjs, skips shape/
// critique outright). The real work is the ONE graph run task.s_run points at. Every function
// above this point reads task.nodes/task.spec directly, so calling one of them on a size-S task
// sees a task frozen at its very first instant forever - epicTicketState/epicPhase would report
// READY/plan on a completed or blocked S run exactly as they would on one still queued. Loaded
// the same way taskState() (taskmanager.mjs) and view-collect.mjs's own listTasks() used to -
// this is now the one place that read happens, not a third copy of it.
function loadSRun(task) {
  if (!task.s_run) return null;
  return loadRunAt(join(task.s_run.cwd, '.teams_output', 'broker', 'runs', `${task.s_run.run_id}.json`));
}

// The S-run's own goal-level gate, reached the same way goalLevelReached (above) reads a
// manager task's integrate node - except a plain graph.mjs run (createRun)
// never gets an integrate node at all: its goal-level gate IS a 'gate' node with subgoal_id
// null (expandSubgoals/pushGoalGateRound), and a repair can reopen a fresh round - so "current"
// means latest by push order, the same rule latestGoalNode already applies to a manager task's
// integrate/gate:goal.
function sRunGoalGateReached(run) {
  const goalGates = run.nodes.filter((n) => n.stage === 'gate' && n.subgoal_id === null);
  const gate = goalGates.length ? goalGates[goalGates.length - 1] : null;
  return !!gate && reached(run, gate);
}

// epicTicketState's own rule, read off the child run instead of the task: report done -> DONE,
// runState blocked -> BLOCKED (checked before spec - a run stuck before setgoal is still
// BLOCKED, never READY), no spec yet (still in plan/setgoal/critique) -> READY, spec set ->
// IN_PROGRESS until the goal gate is reached, then IN_REVIEW - the exact same four words
// epicTicketState uses for an ordinary task, never a fifth invented for the S run. A run this
// could not load (task.s_run unset, or the file has not landed on disk yet) counts as BLOCKED,
// the same "nothing to show" default the old view-collect.mjs workaround used - not READY,
// which would claim a readiness this function has no evidence for.
function sRunTicketState(run) {
  if (!run) return 'BLOCKED';
  if (run.nodes.some((n) => n.stage === 'report' && n.state === 'done')) return 'DONE';
  if (runState(run).state === 'blocked') return 'BLOCKED';
  if (!run.spec) return 'READY';
  return sRunGoalGateReached(run) ? 'IN_REVIEW' : 'IN_PROGRESS';
}

// epicPhase's own §6 table, read off the child run instead of the task: its own plan/setgoal
// nodes map onto plan/setgoal directly (they are literally named that - graph.mjs's createRun
// bootstraps every run with exactly those three node ids), its subgoal chains are
// impl, and its own gate:goal/report are qualitygate - the same four words §6 already names,
// never a new one for the S run. A run this could not load reads as 'plan' - the same "nothing
// has happened yet" reading a fresh, never-driven run would give honestly.
function sRunPhase(run) {
  if (!run) return 'plan';
  if (run.nodes.some((n) => n.stage === 'report' && n.state === 'done')) return null;
  if (!run.spec) {
    const critique = run.nodes.find((n) => n.node_id === 'critique' || n.stage === 'critique');
    return critique && critique.state !== 'pending' ? 'setgoal' : 'plan';
  }
  return sRunGoalGateReached(run) ? 'qualitygate' : 'impl';
}

// §4's EPIC row (shape 전 -> READY / dispatch 진행 -> IN_PROGRESS / integrate·gate:goal ->
// IN_REVIEW / report -> DONE), plus BLOCKED - not in §4's table, added because runState() already
// knows when nothing can proceed and showing READY/IN_PROGRESS for a stuck EPIC would defeat the
// board's own point (see the plan's 발견 3). A size-S task (task.s_run set) delegates the whole
// question to sRunTicketState - see its own comment for why task.spec can never answer it.
export function epicTicketState(task) {
  if (task.s_run) return sRunTicketState(loadSRun(task));
  if (task.nodes.some((n) => n.stage === 'report' && n.state === 'done')) {
    // A report is also written over a settled failure: a retry budget ran out, settleFailure
    // released everything downstream as unreachable, and the report says plainly what did not
    // ship. idol-pm-1 (2026-09-22) ended exactly there - three shaping attempts spent, zero
    // packages dispatched, six of its seven STORYs UNREACHABLE - and this row still read DONE.
    // The report's prose was honest; every machine-readable surface above it said success, which
    // is the one failure mode runState's own comment calls the worst kind. SETTLED is "finished,
    // and it did not deliver": a terminal state like DONE, never confused with it.
    //
    // Delivery is the test, not the wreckage. Reading SETTLED off the presence of an
    // `unreachable` node asks whether a failure left a trace, and a run that reaches report
    // having accepted nothing by some other route leaves none - it reads DONE again. So ask the
    // question directly: did any package the shape declared come back accepted? A task whose
    // spec declared no packages at all is not judged this way - there was nothing to deliver.
    const declared = (task.spec && task.spec.packages || []).length > 0;
    const delivered = task.nodes.some((n) => n.stage === 'accept' && n.state === 'done'
      && n.result && n.result.accept === true);
    if (task.nodes.some((n) => n.state === 'unreachable')) return 'SETTLED';
    return declared && !delivered ? 'SETTLED' : 'DONE';
  }
  if (runState(task).state === 'blocked') return 'BLOCKED';
  if (!task.spec) return 'READY';
  return goalLevelReached(task) ? 'IN_REVIEW' : 'IN_PROGRESS';
}

// §6's phase table: plan (size, shape) / setgoal (critique) / impl (dispatch:Pn) / qualitygate
// (accept:Pn, integrate, gate:goal, report). null once the report is done - there is no phase
// left to name. A size-S task delegates to sRunPhase, same reason as epicTicketState above.
export function epicPhase(task) {
  if (task.s_run) return sRunPhase(loadSRun(task));
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
  // Destructuring the chain as a fixed [author, mid, gate] triple held only while every kind
  // was three stages long. planning is four (investigate -> draft -> revise -> gate), and under
  // the old read its gate slot landed on `revise`, so a planning TASK reported DONE the moment
  // revise finished and could never report REJECTED. Derived by position instead: the gate is
  // the last stage, the kind's own author splits what comes before it, and everything between
  // author and gate is the reviewing half.
  const chain = (KINDS[kind] || KINDS.subgoal).chain; // [implement,test,gate] | [investigate,draft,revise,gate]
  const gateStage = chain[chain.length - 1];
  const authorIdx = Math.max(0, chain.indexOf(authorStage(kind)));
  const preStages = chain.slice(0, authorIdx + 1); // through the hand that authors
  const reviewStages = chain.slice(authorIdx + 1, chain.length - 1); // after it, before the gate
  const byStage = (stage) => {
    const list = childRun.nodes.filter((n) => n.subgoal_id === String(subgoalId) && n.stage === stage);
    return list.length ? list[list.length - 1] : null;
  };
  // A card waiting on a person outranks every stage reading below, and it need not be a stage
  // in the chain at all: `ask` (graph.mjs's openAsk) sits between investigate and draft without
  // being either. Reading it off the state rather than off a named stage is what keeps this
  // from having to learn each new kind of human card.
  if (childRun.nodes.some((n) => n.subgoal_id === String(subgoalId) && n.state === 'waiting_human')) return 'WAITING_HUMAN';
  const gate = byStage(gateStage);
  if (gate && reached(childRun, gate)) {
    if (gate.state === 'done') return 'DONE';
    if (gate.state === 'failed') return 'REJECTED';
    if (gate.state === 'skipped') return 'CANCELLED';
    if (gate.state === 'unreachable') return 'UNREACHABLE';
    return 'IN_REVIEW'; // pending-but-ready or running: the mid stage already handed off
  }
  for (const stage of reviewStages.slice().reverse()) {
    const mid = byStage(stage);
    if (!mid || !reached(childRun, mid)) continue;
    if (mid.state === 'skipped') return 'CANCELLED';
    if (mid.state === 'unreachable') return 'UNREACHABLE';
    // running, pending-but-ready, or failed-not-yet-settled: §4 counts test/revise/execute
    // as already "in review" the moment the author stage has handed off to it.
    return 'IN_REVIEW';
  }
  for (const stage of preStages.slice().reverse()) {
    const author = byStage(stage);
    if (!author) continue;
    const first = stage === chain[0];
    // Only the chain's opening stage can still be waiting to start. A later pre-gate stage
    // that is merely pending-and-ready means the ones before it are done - that is work in
    // progress, not a task nobody has picked up.
    if (!first && !reached(childRun, author)) continue;
    if (author.state === 'skipped') return 'CANCELLED';
    if (author.state === 'unreachable') return 'UNREACHABLE';
    if (author.state === 'waiting_human') return 'WAITING_HUMAN';
    if (author.state === 'pending') {
      if (!first) return 'IN_PROGRESS';
      return unmetDeps(childRun, author).length ? 'BACKLOG' : 'READY';
    }
    return 'IN_PROGRESS'; // running, or failed-not-yet-settled - a brief window, still "moving"
  }
  return 'BACKLOG'; // defensive: pushChain always creates the whole chain together
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

// The full package list a board walks: the planning cards (planningPkgs - one per feature area)
// first, ahead of shape's own task.spec.packages, then the QA cards (qaPkgs) and the audit last -
// the same order they run in (§2). No phase-Team package ever joins
// task.spec.packages (taskmanager.mjs's packageOf reads them straight off these fields), so
// they are stitched in here rather than found in `packages`. Shared by epicBoardRows (one row
// per package) and ticketSnapshot (one key per package) - v0.12.0 gave epicBoardRows this list
// but left ticketSnapshot reading task.spec.packages alone, so the board showed a planning/qa
// row that board.jsonl never logged a single transition for. One list, read by both, closes
// that gap for good.
function boardPackages(task) {
  return [
    ...planningPkgs(task),
    ...((task.spec && task.spec.packages) || []),
    ...qaPkgs(task),
    ...(task.audit_pkg ? [task.audit_pkg] : []),
  ];
}

// Cards everywhere (docs/plans/2026-09-28-teams-cards-everywhere.md C2/C7): planning and QA are
// no longer one phase-Team package each but one STORY card per feature area - task.planning_pkgs
// (PLAN-F1, PLAN-F2, ...) and task.qa_pkgs (QA-F1, QA-F2, ...). Every reader goes through these
// two, never the fields directly: a task.json written before the split still carries the single
// task.planning_pkg / task.qa_pkg, and reads back as a one-card list rather than as nothing.
export function planningPkgs(task) {
  if (!task) return [];
  if (Array.isArray(task.planning_pkgs)) return task.planning_pkgs;
  return task.planning_pkg ? [task.planning_pkg] : [];
}
// The planning cards still standing: a re-split (plan-integrate's resplit, M4) retires the cards
// of the split it replaced. They stay in planning_pkgs - their nodes, tickets and ids are history
// - but no PRD, story, QA card or shape coverage reads them.
export function livePlanningPkgs(task) {
  return planningPkgs(task).filter((p) => !p.retired);
}
export function qaPkgs(task) {
  if (!task) return [];
  if (Array.isArray(task.qa_pkgs)) return task.qa_pkgs;
  return task.qa_pkg ? [task.qa_pkg] : [];
}
// The phase of the package a node's subgoal_id names ('planning' | 'qa' | 'audit'), or null for
// a develop/repair/defect package - what every "is this a PLAN/QA/AUDIT node" check reads now
// that the id is no longer the literal 'PLAN' or 'QA'.
export function phaseOfId(task, id) {
  const s = String(id);
  if (planningPkgs(task).some((p) => String(p.id) === s)) return 'planning';
  if (qaPkgs(task).some((p) => String(p.id) === s)) return 'qa';
  if (task && task.audit_pkg && String(task.audit_pkg.id) === s) return 'audit';
  return null;
}

// The user stories every planning card delivered, in card order - read off each card's latest
// dispatch that its own accept let through (or, before any accept, the latest dispatch with a
// result). A card retried after a planning-integrate rejection contributes its NEW stories, not
// the ones the integrate refused. Each story carries the card it came from as `card`.
export function planningStories(task) {
  const out = [];
  for (const p of livePlanningPkgs(task)) {
    const id = String(p.id);
    const dispatches = task.nodes.filter((n) => n.stage === 'dispatch' && n.subgoal_id === id && n.result);
    const accepted = dispatches.filter((d) => {
      const acc = task.nodes.find((x) => x.stage === 'accept' && x.subgoal_id === id && (x.attempt || 1) === (d.attempt || 1));
      return acc && acc.state === 'done';
    });
    const d = accepted.length ? accepted[accepted.length - 1] : dispatches[dispatches.length - 1];
    const list = d && Array.isArray(d.result.user_stories) ? d.result.user_stories : [];
    // A bare null/empty entry is no story: String(null) once gave it the id "null".
    for (const u of list) {
      if (u == null || (typeof u !== 'object' && !String(u).trim())) continue;
      out.push(typeof u === 'object' ? { ...u, card: id } : { id: String(u).trim(), card: id });
    }
  }
  return out;
}

// storyLinks(): the relations §4/§7c never surfaced anywhere a human looks - one STORY's own
// state answers "is it done", never "what is it waiting on, what is waiting on it, what PRD
// story it satisfies, or who filed it".
//
// "blocked_by" is this package's own p.deps (the sibling package ids shape - or fileDefects, via
// its own `deps` field - wired onto it; see the packages[] schema in taskmanager.mjs), each
// resolved to THAT sibling's own storyTicketState. This is not a new fact: expandPackages wires
// the very same ids onto the dispatch node's own `.deps`, and storyTicketState's
// `unmetDeps(task, dispatch).length ? 'BACKLOG' : 'READY'` already reads them to decide whether
// the STORY itself can run - storyLinks only names, per sibling, the fact that check already
// collapses into one BACKLOG/READY bit.
//
// "blocks" is the inverse, computed by scanning every OTHER package (boardPackages - the same
// stitched-in planning/qa/audit list epicBoardRows and ticketSnapshot already share) for a dep
// naming this one. Never stored: storing it would make it a second copy of what p.deps already
// says, exactly the "second source of truth" this module's own header rules out.
//
// "implements" is p.implements - the PRD user-story ids (US-1, ...) shape wired a package to when
// roles.planning is on (see the packages[].implements schema, taskmanager.mjs); [] when planning
// is off or shape declared none for this package.
//
// "filed_by" is packageFiling(pkg).origin, gated to FILED_ORIGINS - the same fact epicBoardRows'
// own `origin` column carries, named here as "which stage filed this" rather than "what team is
// on it" (storyLinks is about relations, not ownership - filed_by answers "was this filed, and
// against what kind of finding", the same question the old overloaded reporter answered before
// the reporter/origin split). null for a package shape declared itself, or a repair/phase-Team
// package - none of those were ever "filed" against anything (the same falsy epicBoardRows
// already treats as "nothing to report").
export function storyLinks(task, pkgId) {
  const id = String(pkgId);
  const all = boardPackages(task);
  const pkg = all.find((p) => String(p.id) === id) || null;
  const linkOf = (otherId) => ({ key: storyKey(task.run_id, otherId), id: otherId, state: storyTicketState(task, otherId) });
  const blocked_by = ((pkg && pkg.deps) || []).map(String).map(linkOf);
  const blocks = all
    .filter((p) => String(p.id) !== id && (p.deps || []).map(String).includes(id))
    .map((p) => linkOf(String(p.id)));
  const filing = pkg ? packageFiling(pkg) : null;
  return {
    blocked_by,
    blocks,
    implements: (pkg && Array.isArray(pkg.implements)) ? pkg.implements.map(String) : [],
    filed_by: (filing && FILED_ORIGINS.has(filing.origin)) ? filing.origin : null,
  };
}

// Kanban theory treats "blocked" as a flag orthogonal to a card's column, not a column of its
// own - a STORY sitting in BACKLOG because a sibling dep has not cleared is a different fact
// from a STORY sitting in BACKLOG because nobody has looked at it yet, and §4's ticket state
// alone cannot say which. storyBlockedReason names the one fact storyTicketState's own branches
// already computed and threw away: which of the five things actually holds this STORY back -
// 'unmet_deps' (BACKLOG: the sibling dep ids themselves, straight off unmetDeps - the same
// dependency read storyTicketState's own BACKLOG branch already makes), 'upstream_defect'
// (BACKLOG: the same unmet dep ids, but at least one of them is a fix STORY this package's own
// dispatch/accept found and filed against an upstream dependency - fileUpstreamDefects,
// taskmanager.mjs - so the "upstream" field also names the ORIGINAL upstream package ids the
// fix(es) target, not the fix STORYs' own ids), 'capacity'
// (WAITING_CAPACITY: since/elapsed off the same dispatch.child.waiting_capacity storyTicketState
// reads), 'human_wait' (WAITING_HUMAN: since/elapsed off the child run's own waiting_human node),
// or 'restart_exhausted' (BLOCKED, once the driver's restart budget is actually spent and
// foldChild has folded the dispatch 'failed' - taskmanager.mjs's foldChild only sets
// result.driver_restarts on exactly that path, never on the transient "driver just died, still
// being serviced" BLOCKED reading storyTicketState also returns while state is still 'running').
// null everywhere else - a STORY that is READY/IN_PROGRESS/IN_REVIEW/DONE/... is not blocked on
// anything this function names, and the transient BLOCKED-while-running window has no settled
// reason yet either.
export function storyBlockedReason(task, pkgId) {
  const dispatch = latestBySubgoal(task, pkgId, 'dispatch');
  if (!dispatch) return null;
  if (dispatch.state === 'pending') {
    const deps = unmetDeps(task, dispatch);
    if (!deps.length) return null;
    // §upstream_defects: this package's own next attempt was rewired (fileUpstreamDefects,
    // taskmanager.mjs) to wait on a fix STORY's accept instead of blindly retrying - a more
    // specific fact than plain 'unmet_deps', and the one a person reading tm_ticket/tm_status
    // actually wants: not "waiting on a sibling", but "waiting on a fix it itself filed".
    // Detected the same way storyLinks/epicBoardRows already tell a filed defect STORY apart
    // from shape's own scope: packageFiling(p).origin === 'upstream' (fileUpstreamDefects is the
    // only writer of that origin), its link.target naming the upstream package id the fix
    // targets - a legacy on-disk package with no link falls back to its own deps[0], exactly as
    // packageFiling's own back-compat branch already does.
    const packages = (task.spec && task.spec.packages) || [];
    const upstream = deps
      .map((d) => /^accept:(.+):\d+$/.exec(String(d)))
      .filter(Boolean)
      .map((m) => packages.find((p) => String(p.id) === m[1]))
      .filter((p) => p && packageFiling(p).origin === 'upstream')
      .map((p) => {
        const filing = packageFiling(p);
        return (filing.link && filing.link.target) || String((p.deps || [])[0] || p.id);
      });
    if (upstream.length) return { reason: 'upstream_defect', node_ids: deps, upstream: [...new Set(upstream)] };
    return { reason: 'unmet_deps', node_ids: deps };
  }
  if (dispatch.state === 'running') {
    if (dispatch.child && dispatch.child.waiting_capacity) {
      const since = dispatch.child.waiting_capacity.since || null;
      return { reason: 'capacity', since, elapsed_ms: since ? Date.now() - since : null };
    }
    const child = dispatch.child && dispatch.child.cwd && dispatch.child.run_id
      ? loadRun(dispatch.child.cwd, dispatch.child.run_id) : null;
    const waitingNode = child ? child.nodes.find((n) => n.state === 'waiting_human') : null;
    if (waitingNode) {
      const since = waitingNode.waiting_since || null;
      return { reason: 'human_wait', since, elapsed_ms: since ? Date.now() - since : null };
    }
    return null; // IN_PROGRESS, or a dead driver not yet serviced - no settled reason yet
  }
  if (dispatch.state === 'failed' && dispatch.result && Array.isArray(dispatch.result.driver_restarts)) {
    return { reason: 'restart_exhausted', restarts: dispatch.result.driver_restarts.length };
  }
  return null;
}

// A filed defect STORY (fileDefects, taskmanager.mjs - QA-found, audit-found, tm_file, or an
// upstream fix) carries its own `reporter` (a TEAM - 'qa'/'audit'/'user'/an actual develop
// package id like 'P4') and `origin` (the STAGE that filed it - 'qa'/'planning-audit'/'tm_file'/
// 'upstream'); a phase-Team package (PLAN/QA/AUDIT) carries p.phase but neither, and reported
// itself, not shape - falling through to p.phase used to mislabel it 'qa' for the QA phase-Team
// row, the exact same string a QA-filed defect STORY's own reporter used to carry before this
// split (see FILED_ORIGINS below) - two different kinds of row, one token, no way to tell them
// apart. `reporter: 'planning'` for a phase-Team/repair/shape-declared package is honest instead
// of a phase name: this row exists because a role (roles.planning/roles.qa) is on, or shape
// itself, not because anyone filed anything - `origin` ('phase'/'repair'/'shape') carries which
// case it is, and the caller's own `role`/`phase` field already carries which phase. epicBoardRows
// (tm_board) and toolTicket (tm_ticket, taskmanager.mjs) both call this one function so the two
// tools can never again report a different reporter/origin for the same key.
//
// New packages (fileDefects/fileUpstreamDefects, taskmanager.mjs) write reporter/origin (and,
// for an upstream fix, `link: {type:'blocks', target:<upstream package id>}`) directly - nothing
// here recomputes them. An OLD task.json (written before this split existed) instead carries the
// single overloaded `reporter` this function used to return by itself - 'qa'/'you'/
// 'planning-audit'/'upstream' - and, for an upstream fix, never a `reported_by`/`upstream` field
// on the package itself (only task.unresolved_defects' own cap-exhausted fallback entries ever
// carried those - see fileUpstreamDefects) - so a legacy upstream-filed package's own filer can
// no longer be named; only its origin and link (the upstream id, off its own `deps[0]`) survive.
// Translated here, once, so a task opened before this change renders exactly as one opened after
// it - never rewritten on disk (this module never writes, per its own header).
const LEGACY_REPORTER = {
  qa: { reporter: 'qa', origin: 'qa' },
  you: { reporter: 'user', origin: 'tm_file' },
  'planning-audit': { reporter: 'audit', origin: 'planning-audit' },
};
export function packageFiling(p) {
  if (p.origin) return { reporter: p.reporter || null, origin: p.origin, link: p.link || null };
  if (p.reporter === 'upstream') {
    const target = p.upstream != null ? String(p.upstream)
      : (Array.isArray(p.deps) && p.deps[0] != null ? String(p.deps[0]) : null);
    return { reporter: p.reported_by ? String(p.reported_by) : null, origin: 'upstream', link: target ? { type: 'blocks', target } : null };
  }
  if (p.reporter && LEGACY_REPORTER[p.reporter]) {
    const m = LEGACY_REPORTER[p.reporter];
    return { reporter: m.reporter, origin: m.origin, link: null };
  }
  if (p.reporter) return { reporter: String(p.reporter), origin: null, link: null }; // unrecognized value, kept verbatim rather than dropped
  if (p.repair) return { reporter: 'planning', origin: 'repair', link: null };
  if (p.phase) return { reporter: 'planning', origin: 'phase', link: null };
  return { reporter: 'planning', origin: 'shape', link: null };
}

// The origins that mean "this STORY was filed against already-integrated work", as opposed to
// part of the original shape/repair/phase-Team scope - fileDefects (taskmanager.mjs) never
// writes any other origin for an actually-filed package, and packageFiling's own LEGACY_REPORTER
// table maps every pre-existing on-disk value onto one of these same four tokens. Shared by
// storyLinks' filed_by (below) and view-collect.mjs's storyProgress so the two can never again
// disagree about which rows count as "filed".
export const FILED_ORIGINS = new Set(['qa', 'planning-audit', 'upstream', 'tm_file']);

// One row per package, for tm_board's STORY table. role is p.phase || 'develop'.
export function epicBoardRows(task) {
  return boardPackages(task).map((p) => {
    const id = String(p.id);
    const accept = latestBySubgoal(task, id, 'accept');
    const r = accept && accept.result;
    const last = !r ? '—'
      : r.accept === true ? `accept ${r.match_pct == null ? '?' : r.match_pct}`
      : String(r.reason || 'rejected').slice(0, 60);
    const filing = packageFiling(p);
    return {
      key: storyKey(task.run_id, id), id, title: p.title || '',
      role: p.phase || 'develop',
      state: storyTicketState(task, id),
      tasks: storyTaskProgress(task, id),
      last_verdict: last,
      reporter: filing.reporter,
      origin: filing.origin,
      link: filing.link,
      links: storyLinks(task, id),
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

// ---------- flow metrics: Kanban's other half, read off board.jsonl's own history ----------
//
// Every state function above answers "what is this ticket RIGHT NOW" off task.nodes - the
// engine's live graph. A STORY's cycle time, lead time, or a task's throughput are not facts
// about right now; they are facts about WHEN a key crossed a line, and the only place that is
// recorded is board.jsonl's own transition log (appendBoardTransitions, taskmanager.mjs -
// {ts,key,from,to}, one line per state a key actually moved through). This module owns no
// filesystem reads of its own (see this file's header) - boardEntries is whatever the caller
// already read off <taskDir>/board.jsonl, in that exact shape; a fixture in a test is exactly as
// valid an input as a real file's parsed lines.
//
// Only STORY keys are counted: parseTicketKey's own three-way split (pkgId set, subgoalId not)
// is what already tells a STORY key apart from an EPIC key (neither set) or a TASK key (both
// set, never logged to board.jsonl today) - reused here rather than a second regex over the
// same key shape.
const FLOW_TERMINAL_STATES = new Set(['DONE', 'REJECTED', 'CANCELLED', 'UNREACHABLE']);
const FLOW_WIP_STATES = new Set(['IN_PROGRESS', 'IN_REVIEW', 'WAITING_HUMAN', 'WAITING_CAPACITY', 'BLOCKED']);

function mean(values) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

// One run through board.jsonl's transitions for a single STORY key, oldest first: when it first
// entered BACKLOG (falling back to its very first logged transition - a package whose deps were
// already met at dispatch time never gets a BACKLOG line at all, so "created" is the honest
// fallback), when it first entered IN_PROGRESS (work actually starting, §4's own first "moving"
// state), when it first reached DONE, and what it reads as right now (the last line logged).
function storyHistory(entries) {
  const sorted = entries.slice().sort((a, b) => (a.ts || 0) - (b.ts || 0));
  return {
    backlogAt: (sorted.find((e) => e.to === 'BACKLOG') || sorted[0]).ts,
    inProgressAt: (sorted.find((e) => e.to === 'IN_PROGRESS') || {}).ts,
    doneAt: (sorted.find((e) => e.to === 'DONE') || {}).ts,
    current: sorted[sorted.length - 1].to,
  };
}

// task.created_at anchors throughput's own elapsed window and a never-started open item's age
// (opts.now defaults to Date.now(), overridable so a test can fix "now" instead of racing the
// clock).
export function flowMetrics(task, boardEntries, opts = {}) {
  const now = opts.now || Date.now();
  const byKey = new Map();
  for (const e of boardEntries || []) {
    if (!e || !e.key) continue;
    const parsed = parseTicketKey(e.key);
    if (!parsed || !parsed.pkgId || parsed.subgoalId) continue; // STORY keys only
    if (!byKey.has(e.key)) byKey.set(e.key, []);
    byKey.get(e.key).push(e);
  }

  const cycleByStory = {};
  const leadByStory = {};
  let doneCount = 0;
  let wip = 0;
  const openAges = [];
  let earliestTs = task && task.created_at ? task.created_at : null;

  for (const [key, entries] of byKey) {
    const h = storyHistory(entries);
    if (earliestTs == null || (h.backlogAt != null && h.backlogAt < earliestTs)) earliestTs = h.backlogAt;
    if (h.inProgressAt != null && h.doneAt != null) cycleByStory[key] = h.doneAt - h.inProgressAt;
    if (h.backlogAt != null && h.doneAt != null) leadByStory[key] = h.doneAt - h.backlogAt;
    if (h.doneAt != null) doneCount += 1;
    if (FLOW_WIP_STATES.has(h.current)) wip += 1;
    if (!FLOW_TERMINAL_STATES.has(h.current)) {
      const startedAt = h.inProgressAt != null ? h.inProgressAt : h.backlogAt;
      if (startedAt != null) openAges.push(now - startedAt);
    }
  }

  const elapsedMs = earliestTs != null ? Math.max(0, now - earliestTs) : null;
  const perDay = elapsedMs != null && elapsedMs > 0 ? doneCount / (elapsedMs / 86400000) : null;

  return {
    wip,
    throughput: { done: doneCount, elapsed_ms: elapsedMs, per_day: perDay },
    mean_work_item_age_ms: mean(openAges),
    cycle_time_ms: { mean: mean(Object.values(cycleByStory)), by_story: cycleByStory },
    lead_time_ms: { mean: mean(Object.values(leadByStory)), by_story: leadByStory },
  };
}
