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
export function docPaths(task) {
  const docsDir = (task.team && task.team.opts && task.team.opts.docs_dir) || join('.teams_output', 'team');
  const base = join(task.cwd, docsDir, epicKey(task.run_id));
  return {
    dir: base,
    index: join(base, 'INDEX.md'),
    request: join(base, '00-request.md'),
    shape: join(base, '20-shape.md'),
    critique: join(base, '30-critique.md'),
    story: (pkgId) => join(base, '40-stories', `${pkgId}.md`),
    integrate: join(base, '50-integrate.md'),
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
  const goalLevel = task.nodes.some((n) => n.stage === 'integrate' || (n.stage === 'gate' && n.subgoal_id === null));
  return goalLevel ? 'IN_REVIEW' : 'IN_PROGRESS';
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
  const goalLevel = task.nodes.some((n) => n.stage === 'integrate' || (n.stage === 'gate' && n.subgoal_id === null));
  return goalLevel ? 'qualitygate' : 'impl';
}

// §4's TASK row ("자식 run 노드 상태 그대로"), generalized over kind (subgoal/document/planning/
// qa, whichever v0.10.1 chain the subgoal is) rather than hardcoded to implement/test/gate - the
// same genericness graph.mjs's own engine already has. Extended with CANCELLED/UNREACHABLE/
// BACKLOG/READY/REJECTED for the same reason STORY was: §4's own diagram already has them.
export function taskTicketState(childRun, subgoalId) {
  const kind = nodeKind(childRun, { subgoal_id: subgoalId }) || 'subgoal';
  const chain = (KINDS[kind] || KINDS.subgoal).chain; // e.g. [implement,test,gate] or [draft,revise,gate]
  const [authorStage, midStage, gateStage] = chain;
  const byStage = (stage) => {
    const list = childRun.nodes.filter((n) => n.subgoal_id === String(subgoalId) && n.stage === stage);
    return list.length ? list[list.length - 1] : null;
  };
  const gate = byStage(gateStage);
  if (gate) {
    if (gate.state === 'done') return 'DONE';
    if (gate.state === 'failed') return 'REJECTED';
    if (gate.state === 'skipped') return 'CANCELLED';
    if (gate.state === 'unreachable') return 'UNREACHABLE';
    return 'IN_REVIEW'; // gate exists but has not judged yet: the mid stage already handed off
  }
  const mid = byStage(midStage);
  if (mid) return 'IN_REVIEW'; // running, done or failed - once the mid stage exists the TASK reads "in review"
  const author = byStage(authorStage);
  if (!author) return 'BACKLOG';
  if (author.state === 'running') return 'IN_PROGRESS';
  if (author.state === 'pending') return unmetDeps(childRun, author).length ? 'BACKLOG' : 'READY';
  if (author.state === 'skipped') return 'CANCELLED';
  if (author.state === 'unreachable') return 'UNREACHABLE';
  return 'IN_PROGRESS'; // author done, mid stage not yet pushed - a brief window, still "moving"
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

// One row per package, for tm_board's STORY table. role is always 'develop': no other Team
// (planning/qa) reaches the EPIC flow's shape output until v0.12.0 wires it in (§2 is not this
// round's job - see the plan's head).
export function epicBoardRows(task) {
  const packages = (task.spec && task.spec.packages) || [];
  return packages.map((p) => {
    const id = String(p.id);
    const accept = latestBySubgoal(task, id, 'accept');
    const r = accept && accept.result;
    const last = !r ? '—'
      : r.accept === true ? `accept ${r.match_pct == null ? '?' : r.match_pct}`
      : String(r.reason || 'rejected').slice(0, 60);
    return {
      key: storyKey(task.run_id, id), id, title: p.title || '',
      role: 'develop',
      state: storyTicketState(task, id),
      tasks: storyTaskProgress(task, id),
      last_verdict: last,
      reporter: p.repair ? 'repair' : 'shape',
    };
  });
}

// The snapshot a board.jsonl diff is taken over: EPIC key plus every STORY key this task
// currently has a shape for. Called before AND after a mutating tool call; only the keys whose
// value actually changed become a board.jsonl line (taskmanager.mjs's job, not this module's -
// this module never writes).
export function ticketSnapshot(task, opts = {}) {
  const snap = { [epicKey(task.run_id)]: epicTicketState(task) };
  for (const p of (task.spec && task.spec.packages) || []) {
    snap[storyKey(task.run_id, p.id)] = storyTicketState(task, String(p.id), opts);
  }
  return snap;
}
