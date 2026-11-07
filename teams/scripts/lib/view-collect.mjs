// collect() builds one plain-JSON model of a teams task for a human to look at.
// Every renderer (the --once text trees in view.mjs and the state server's answers) draws from
// this single function - it is the only place that reads task.json, a child run file, or a
// driver stream. Read-only: nothing here ever writes a file.
//
// task.json / a child run file can be caught mid-write by another process (the daemon, a
// broker). A parse failure is tolerated, not fatal: it is reported on the model as
// `error` / a node's own `read_error`, never thrown past collect().
import { pidAlive } from '../../mcp/proc.mjs';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { loadRunAt, runState } from '../../mcp/graph.mjs';
import { REASONING_VERDICT } from '../../mcp/verdictfields.mjs';
import { readPointer, ownsRun, findTaggedRun, harnessVerdict, graphRunPath } from '../../mcp/harnessrun.mjs';
import { countedDriverRestarts, restartBudget } from '../../mcp/taskstate.mjs';
import { driverCostOf, collectTaskCosts, latestCostEvent, spendFigure, taskFigure } from '../bench/lib/drivercost.mjs';
import { capOf, liveProcesses } from '../../mcp/livecap.mjs';
import { statSig } from './view-index.mjs';

// Clock fields: values derived from "now" and a start time (elapsed_ms, waiting_elapsed_ms, elapsed_minutes,
// timebox_pct, a blocked reason's elapsed_ms, flow_metrics). While a model is built inside captureClock(),
// each one registers a function (now) that recomputes it in place from facts already in the model, so a
// long-lived reader (the state server) moves them forward without building the task again.
let clockSink = null;
const onClock = (fn) => { if (clockSink) clockSink.push(fn); };
export function captureClock(fn) {
  const prev = clockSink;
  const clock = [];
  clockSink = clock;
  try { return { value: fn(), clock }; } finally { clockSink = prev; }
}

// The live-process count scans every task.json and runs ps per recorded pid; one answer per root is
// reused for 2 s (the shared server's answer window), so a sweep over many running tasks pays it once.
const LIVE_TTL_MS = 2000;
const liveCounts = new Map();
function liveCount(root) {
  const hit = liveCounts.get(root);
  if (hit && Date.now() - hit.at < LIVE_TTL_MS) return hit.n;
  const n = liveProcesses(root).length;
  liveCounts.set(root, { at: Date.now(), n });
  return n;
}
import { STAGE_KEYS, stageOfNode, nodeState, mergeStates } from './view-stages.mjs';
// listTasks()'s card model speaks tickets.mjs's own vocabulary (EPIC key, ticket state, phase,
// STORY rows) rather than inventing a second one - the same words tm_board and tm_ticket already
// use, so a person moving between the index and those MCP tools never has to re-learn what
// "IN_PROGRESS" or "E-d0ee9043" means.
// storyTicketState/storyKey/taskKey/taskTicketState (§4/§8 - the ticket view) are read here for
// exactly the same reason epicTicketState etc. already were: one derivation, no second copy of
// "what state is this STORY/TASK in" living in view-collect.mjs.
import {
  epicKey, epicTicketState, epicPhase, epicBoardRows, storyLinks, packageFiling, FILED_ORIGINS,
  storyTicketState, storyKey, taskKey, taskTicketState, storyBlockedReason, flowMetrics,
  planningPkgs, qaPkgs,
} from '../../mcp/tickets.mjs';

// ---------- small read helpers, all fail soft ----------

export function readJsonRetry(path, tries = 3) {
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

export function readJsonl(path, limit) {
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
// pidAlive (mcp/proc.mjs) is that one shared check.

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
    // broker.mjs writes finished_at, an older run file ended_at: either ends the node's clock.
    elapsed_ms: elapsedMs(n.started_at, n.ended_at || n.finished_at),
    // gaps a judge moved to a sibling or to nobody (taskmanager.mjs scopeGaps)
    scoped_out: Array.isArray(r.scoped_out)
      ? r.scoped_out.slice(0, 10).map((e) => ({ gap: String((e && e.gap) || ''), belongs_to: String((e && e.belongs_to) || 'none') }))
      : [],
    // a node denied a tool it needed (broker.mjs finishNode / daemon.mjs judge)
    blocked: r.blocked === 'tool denied' || r.reason === 'blocked: tool denied',
  };
  if (n.started_at && !(n.ended_at || n.finished_at)) onClock((now) => { out.elapsed_ms = now - n.started_at; });
  // A dispatch claimed and not yet applied (taskmanager.mjs's claim): running with no child run
  // yet - the same predicate tickets.mjs's board uses for its own `opening` flag.
  if (n.stage === 'dispatch' && n.state === 'running' && !n.child) out.opening = true;
  if (n.state === 'failed' || n.state === 'blocked') {
    out.reason = String(r.reason || '').slice(0, 300) || null;
  }
  if (r.match_pct !== undefined) out.match_pct = r.match_pct;
  if (Array.isArray(r.gaps) && r.gaps.length) out.gaps = r.gaps.slice(0, 5);
  const verdictField = REASONING_VERDICT[n.stage];
  if (verdictField && r[verdictField] !== undefined) out.verdict = r[verdictField];
  // executor/model: set on a child run's own chain node once it actually ran (broker.mjs's
  // finish()/submit() write n.executor/n.model off the routing decision - see stagePolicy).
  // The RESOURCE view's "workers per TASK" is this, verbatim - a second lookup would just be
  // this same field re-read from a different door.
  // A manager node the daemon judged (or a person answered) carries vendor/model instead.
  out.executor = n.executor || n.vendor || null;
  out.model = n.model || null;
  // A judge node stays pending while the daemon's judge() runs; its stamp says since when.
  if (n.judging && n.judging.at) out.judging_since = n.judging.at;
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
  // An ask card's own question text: what the pane shows next to a card waiting on a person.
  if (n.stage === 'ask' && Array.isArray(n.questions)) {
    out.questions = n.questions.map((q) => String((q && (q.question || q.unknown)) || '')).filter(Boolean).slice(0, 5);
  }
  if (n.state === 'waiting_human' && n.waiting_since) {
    out.waiting_since = n.waiting_since;
    out.waiting_elapsed_ms = elapsedMs(n.waiting_since);
    onClock((now) => { out.waiting_elapsed_ms = now - n.waiting_since; });
  }
  return out;
}

// A child run's own node chain (plan -> setgoal -> critique -> implement:* -> test:* -> gate:*
// -> gate:goal -> report, or the cases/execute KIND for a test-writing flow) plus, recursively,
// any nested teams task found under <cwd>/.harness-tasks/ - a package worktree that
// itself opened a teams task rather than a plain graph run.
//
// `ticketCtx` ({taskRunId, pkgId}), when given, also derives this STORY's TASK children -
// E-xxxxxxxx/Pn/Un keyed rows (id/key/title/state) for the TICKET view's board card - straight
// off the SAME run object already loaded above, not a second read of it. Only the caller that
// builds a top-level packageModel passes it; a recursive call for a nested sub-EPIC's own child
// run does not (that run's TASK children belong to ITS OWN ticket board, not this one's).
function collectChildRun(cwd, runId, visiting, ticketCtx) {
  const run = (visiting.io ? visiting.io.loadRun : loadRunAt)(join(cwd, '.teams_output', 'broker', 'runs', `${runId}.json`));
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
    max_retries: Number.isInteger(run.max_retries) ? run.max_retries : null,
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

// The first dispatch attempt of this package's CURRENT shape round: a read-only mirror of the
// engine's roundDispatch (mcp/taskmanager.mjs) that retryPackage counts `attempt - first.attempt`
// from. A repackage numbers the new dispatch on (e.g. :4), so the story's own attempt count starts
// here, and a verdict recorded before it belongs to the discarded shape. null with no dispatch.
function roundFirstAttempt(task, pkgId) {
  const critique = task.nodes.filter((n) => n.stage === 'critique' && n.state !== 'skipped').pop();
  const mine = task.nodes.filter((x) => x.subgoal_id === pkgId && x.stage === 'dispatch');
  const first = (critique && mine.find((x) => (x.deps || []).includes(critique.node_id))) || mine[0] || null;
  return first ? (first.attempt || 1) : null;
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
        ? (() => {
          const wc = { ...childSource.child.waiting_capacity, elapsed_ms: elapsedMs(childSource.child.waiting_capacity.since) };
          if (wc.since) onClock((now) => { wc.elapsed_ms = now - wc.since; });
          return wc;
        })()
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
    // story, a user's tm_file, or an upstream fix) - null for a package shape/repair/a
    // phase-Team itself declared. This is the only way a human looking at the board can tell
    // "this STORY exists because something was filed against already-integrated work" apart
    // from "this STORY is part of the original plan" - packageFiling (tickets.mjs) normalizes
    // an old on-disk package's overloaded `reporter` the same way epicBoardRows/tm_ticket do, so
    // a task opened before the reporter/origin split still renders correctly here too.
    ...(() => {
      const filing = packageFiling(pkg);
      const filed = FILED_ORIGINS.has(filing.origin);
      return { reporter: filed ? filing.reporter : null, origin: filed ? filing.origin : null, link: filing.link };
    })(),
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
    blocked_reason: (() => {
      const why = storyBlockedReason(task, String(pkg.id));
      if (why && why.since && why.elapsed_ms != null) onClock((now) => { why.elapsed_ms = now - why.since; });
      return why;
    })(),
    // attempt: the latest dispatch node's own `.attempt` - a retried STORY's Nth dispatch IS the
    // attempt count (pushChain/openRepair increment it in place; see tickets.mjs's
    // latestBySubgoal), not something this file has to count nodes to derive.
    attempt: dispatchNode ? (dispatchNode.attempt || 1) : null,
    // the attempt number the current shape's first dispatch carries (see roundFirstAttempt)
    round_first_attempt: roundFirstAttempt(task, pkg.id),
    assignee,
  };
}

function pidAliveFromDriver(driver) { return pidAlive(driver && driver.pid); }

// ---------- the stalled rule (F4-AC-9..13) ----------
// A driver is live only while its stream.jsonl was written within STALL_MS and, when a pid is
// recorded, that pid is alive. A task that reads READY/IN_PROGRESS/IN_REVIEW with no live driver
// reads stalled, whether or not its daemon lives.
export const STALL_MS = 10 * 60 * 1000;
const STALLABLE = new Set(['READY', 'IN_PROGRESS', 'IN_REVIEW']);

function mtimeOf(path) {
  try { return statSync(path).mtimeMs; } catch { return null; }
}

// The task's own threshold: task.stall_minutes (a positive integer) in ms, else STALL_MS.
export function stallMsOf(task) {
  const n = task && task.stall_minutes;
  return Number.isInteger(n) && n > 0 ? n * 60000 : STALL_MS;
}

export function driverLive(driver, now = Date.now(), thresholdMs = STALL_MS) {
  if (!driver || !driver.log) return false;
  const m = mtimeOf(driver.log);
  if (m == null || now - m > thresholdMs) return false;
  return driver.pid ? pidAlive(driver.pid) : true;
}

// Whole minutes (at least 1) since `at` (ms): a stalled worker or task always reads above 0.
export const minutesSince = (now, at) => Math.max(1, Math.floor((now - at) / 60000));

// The task-level newest sign of life: created_at, ledger.jsonl, every drivers/*.stream.jsonl and every
// recorded driver log (ms).
function lastSignOfLife(tasksDir, taskId, task, drivers = []) {
  const dir = join(tasksDir, taskId);
  const marks = [Number(task.created_at) || 0, mtimeOf(join(dir, 'ledger.jsonl')) || 0];
  for (const d of drivers) if (d && d.log) marks.push(mtimeOf(d.log) || 0);
  try {
    for (const e of readdirSync(join(dir, 'drivers'))) if (e.endsWith('.stream.jsonl')) marks.push(mtimeOf(join(dir, 'drivers', e)) || 0);
  } catch { /* no drivers dir */ }
  return Math.max(...marks);
}

function recordedDrivers(tasksDir, taskId, task) {
  const h = task.harness_run;
  const drivers = [];
  if (h && h.driver) drivers.push({ ...h.driver, log: h.driver.log || join(tasksDir, taskId, 'drivers', 'S.stream.jsonl') });
  if (task.s_run && task.s_run.driver) drivers.push(task.s_run.driver);
  for (const n of Array.isArray(task.nodes) ? task.nodes : []) if (n && n.child && n.child.driver) drivers.push(n.child.driver);
  return drivers;
}

// The one stall verdict { stalled, minutes } (minutes only when stalled, on the task-level newest sign of life).
// state, ticket_state, workers[] and the state server's cache key all read it with the one threshold (stallMsOf).
// Stalled when no recorded driver is live and no fresh stream exists that no recorded driver owns (a package
// driver not yet recorded); with no recorded driver (driven by hand) the newest sign of life decides.
export function stallVerdict(tasksDir, taskId, task, now = Date.now()) {
  const limit = stallMsOf(task);
  const h = task.harness_run;
  const nodes = Array.isArray(task.nodes) ? task.nodes : [];
  // A driver parked on a usage limit has exited on purpose; that is waiting, not stalled.
  if ((h && h.waiting_capacity) || nodes.some((n) => n && n.child && n.child.waiting_capacity)) return { stalled: false };
  const drivers = recordedDrivers(tasksDir, taskId, task);
  const last = lastSignOfLife(tasksDir, taskId, task, drivers);
  let stalled;
  if (drivers.length) {
    const owned = new Set(drivers.map((d) => d.log).filter(Boolean));
    const dir = join(tasksDir, taskId, 'drivers');
    let freshUnowned = false;
    try {
      for (const e of readdirSync(dir)) {
        if (!e.endsWith('.stream.jsonl') || owned.has(join(dir, e))) continue;
        if (now - (mtimeOf(join(dir, e)) || 0) <= limit) freshUnowned = true;
      }
    } catch { /* no drivers dir */ }
    stalled = !freshUnowned && !drivers.some((d) => driverLive(d, now, limit));
  } else {
    stalled = now - last > limit;
  }
  return stalled ? { stalled: true, minutes: minutesSince(now, last) } : { stalled: false };
}

function taskStalled(tasksDir, taskId, task, now = Date.now()) {
  return stallVerdict(tasksDir, taskId, task, now).stalled;
}

// The QA cards and task.audit_pkg (§2/§3 of the QA and planning-audit phase-Teams) are not part of
// task.spec.packages - each is a fixed package template (id 'QA-F<n>' or 'AUDIT') that can be
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
  const box = {
    budget_usd: budget, spend_usd: spend, timebox_minutes: timebox, elapsed_minutes: elapsedMin,
    budget_pct: budget ? spend / budget : null,
    timebox_pct: timebox ? elapsedMin / timebox : null,
    warned: !!task.budget_warned,
    stopped: task.budget_stopped ? { skipped_packages: task.budget_stopped.skipped_packages || [] } : null,
  };
  if (task.created_at) onClock((now) => { box.elapsed_minutes = (now - task.created_at) / 60000; box.timebox_pct = timebox ? box.elapsed_minutes / timebox : null; });
  return box;
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

// collectTask over an already parsed task.json, with `io` ({ loadRun, jsonl, costs, live }): the state
// server's per-file readers, kept by file stat, so a rebuild that follows only the clock or a pid reads
// no ledger, driver stream or unchanged run file again. Without `io` it is collectTask.
export function collectFromRaw(tasksDir, taskId, raw, io) {
  try {
    return collectTaskFromValue(tasksDir, taskId, raw, { io });
  } catch (e) {
    return { task_id: taskId, tasks_dir: tasksDir, error: `collect failed: ${String(e && e.message || e)}` };
  }
}

// ---------- a size-S task on the development harness (task.harness_run) ----------
//
// taskstate.harnessState reads this state through resolveHarnessRun, which records a refused
// pointer in the ledger and writes h.run into task.json. A viewer never writes, so the same
// judgement is made here from the read-only half of harnessrun.mjs (readPointer, ownsRun,
// findTaggedRun, harnessVerdict) and the pid / restart budget taskstate already exports.

// A stream line newer than this says the driver is still moving.
export const MOVING_MS = 2 * 60 * 1000;

// The run this task owns: the one already recorded, else the driver's pointer when the run it
// names carries this task's tag, else the tagged run found on disk. Nothing is recorded.
function findHarnessRun(task, taskId) {
  const h = task.harness_run;
  const id = task.run_id || taskId;
  const cwd = h.cwd || task.cwd;
  try {
    if (h.run && ownsRun(h.run, id, h.opened_at)) return h.run;
    const p = readPointer(h.pointer, cwd);
    if (p && ownsRun(p, id, h.opened_at)) return p;
    return findTaggedRun(cwd, id, h.opened_at);
  } catch {
    return null;
  }
}

function readJsonFile(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

// The stage bar of one harness run, from the run's own files: a graph run's nodes through
// stageOfNode (a skipped node is not work), a fallback run dir's 01-plan.md / 02-* (plan),
// 04-goal-gate.json (gate) and 05-report.md (report). A stage nothing says anything about stays
// pending - the stream log is never read here.
function harnessStages(run, loadRun = loadRunAt) {
  const by = Object.fromEntries(STAGE_KEYS.map((k) => [k, []]));
  if (run && run.route === 'graph') {
    const g = loadRun(graphRunPath(run.cwd, run.run_id));
    for (const n of (g && Array.isArray(g.nodes) ? g.nodes : [])) {
      if (!n || n.state === 'skipped') continue;
      const k = stageOfNode(n.node_id);
      if (k) by[k].push(nodeState(n.state));
    }
  } else if (run && run.route === 'fallback') {
    let names = [];
    try { names = readdirSync(run.run_dir); } catch { /* run dir gone */ }
    if (names.includes('01-plan.md') || names.some((f) => f.startsWith('02-'))) by.plan.push('done');
    const gate = readJsonFile(join(run.run_dir, '04-goal-gate.json'));
    if (gate) by.gate.push(gate.pass === true ? 'done' : 'failed');
    if (names.includes('05-report.md')) by.report.push('done');
  }
  return STAGE_KEYS.map((key) => ({ key, state: mergeStates(by[key]) || 'pending' }));
}

// A fallback run's own position, read-only: n subgoals in 02-goal-spec.json, k the 1-based place of
// the first one without result.json passed:true (n when all passed), stage_key from now.json only
// while it is live. The liveness rule is a copy of harness/engine/fallback-check.mjs (liveNow +
// artifactMs): now.json counts only when it is an object whose `at` parses and is not older than
// the newest artifact of the run (run dir and subgoals/, now.json excluded). Keys and numbers,
// never words. null without a goal spec or on any other route.
const NOW_STAGE_KEYS = ['plan', 'setgoal', 'critique', 'implement', 'test', 'gate', 'report'];
export function fallbackProgress(run) {
  if (!run || run.route !== 'fallback') return null;
  const dir = run.run_dir;
  const spec = readJsonFile(join(dir, '02-goal-spec.json'));
  const ids = (Array.isArray(spec && spec.subgoals) ? spec.subgoals : []).map((s) => String(s && s.id));
  if (!ids.length) return null;
  const mtimeOf = (path) => { try { return statSync(path).mtimeMs; } catch { return 0; } };
  const list = (d) => { try { return readdirSync(d); } catch { return []; } };
  const artifactMs = Math.max(
    0,
    ...list(dir).filter((n) => n !== 'now.json' && !n.startsWith('now.json.tmp-')).map((n) => mtimeOf(join(dir, n))),
    ...list(join(dir, 'subgoals')).map((n) => mtimeOf(join(dir, 'subgoals', n))),
  );
  const nowJson = readJsonFile(join(dir, 'now.json'));
  const at = nowJson && typeof nowJson === 'object' && !Array.isArray(nowJson) ? Date.parse(nowJson.at) : NaN;
  const live = !Number.isNaN(at) && at >= artifactMs ? nowJson : null;
  const open = ids.findIndex((id) => { const r = readJsonFile(join(dir, 'subgoals', id, 'result.json')); return !(r && r.passed === true); });
  const sg = { k: open < 0 ? ids.length : open + 1, n: ids.length };
  if (live && NOW_STAGE_KEYS.includes(live.stage)) sg.stage_key = live.stage;
  return sg;
}

// taskstate.harnessState's judgement, read-only: the run's written report is complete (its goal
// gate accepted) or partial; else running while the driver lives, is parked on capacity, or its
// stream is still moving; blocked once it is dead past its restart budget.
function collectHarness(task, taskId, tasksDir, loadRun = loadRunAt) {
  const h = task.harness_run;
  const run = findHarnessRun(task, taskId);
  const v = run ? harnessVerdict(run) : null;
  const log = (h.driver && h.driver.log) || join(tasksDir, taskId, 'drivers', 'S.stream.jsonl');
  let moving = false;
  try { moving = Date.now() - statSync(log).mtimeMs <= MOVING_MS; } catch { /* no stream yet */ }
  const driver = driverInfo(h.driver, pidAliveFromDriver);
  let state = 'running';
  if (v && v.finished) state = v.accept ? 'complete' : 'partial';
  else if ((!v || v.readable === false) && h.finished_at) state = h.accepted === false ? 'partial' : 'complete';
  else if (!(h.waiting_capacity || !h.driver || (driver && driver.alive) || moving)
    && countedDriverRestarts(task, h.driver).length >= restartBudget(task)) state = 'blocked';
  const stages = harnessStages(run, loadRun);
  const counts = { pending: 0, running: 0, done: 0, failed: 0 };
  for (const s of stages) counts[s.state] += 1;
  return {
    state, counts,
    harness: {
      slug: run ? (run.route === 'fallback' ? basename(run.run_dir) : run.run_id) : null, moving, driver, stages,
      // fallback route only: {k, n, stage_key?} from the run dir; null on the graph route or before a goal spec exists
      sg: fallbackProgress(run),
      // the graph-route run's own file location (run_file in the floor summary); null on the fallback route
      graph: run && run.route === 'graph' ? { run_id: run.run_id, cwd: run.cwd } : null,
      // graph-route nodes parked on a person (the stage bar folds waiting into running)
      waiting: run && run.route === 'graph'
        ? ((loadRun(graphRunPath(run.cwd, run.run_id)) || {}).nodes || []).filter((n) => n && n.state === 'waiting_human').length : 0,
    },
  };
}

// ---------- the run's numbers (model.telemetry; view-summary's metrics() reads it) ----------
//
// Everything here is read from files collect already has: the whole ledger, the driver streams
// (driverTotal) and the cards. Nothing is judged; view-summary.mjs turns it into the shapes a
// person reads. Costs are rows {story, attempt, stage, cost_usd, duration_ms}: story is the
// card id (null for a manager judge), stage is null when the card's own stage applies.

const DISPATCH_STREAM = /^dispatch_(.+)_(\d+)$/;
const JUDGE_ACCEPT_STREAM = /^judge_accept_(.+)_(\d+)$/;

// judge_integrate_2 -> integrate:2, judge_gate_goal_1 -> gate:goal:1: the stage of the node judged.
function stageOfJudgeStream(rest) {
  return stageOfNode(rest.replace(/_/g, ':')) || (/^(plan|areas|brainstorm)/.test(rest) ? 'plan' : 'other');
}

function spendRows(driverTotal, task) {
  const rows = [];
  const row = (story, attempt, stage, s) => rows.push({ story, attempt, stage, cost_usd: s.cost_usd || 0, duration_ms: s.duration_ms || 0 });
  for (const s of driverTotal.streams || []) {
    const name = basename(String(s.stream)).replace(/\.(?:stream\.)?jsonl$/, '');
    const d = DISPATCH_STREAM.exec(name) || JUDGE_ACCEPT_STREAM.exec(name);
    if (d) row(d[1], Number(d[2]), null, s);
    else if (name.startsWith('judge_')) row(null, 1, stageOfJudgeStream(name.slice(6)), s);
    else row(null, 1, 'other', s);
  }
  // a child run's node sessions belong to the STORY whose dispatch opened that run
  const runStory = new Map();
  for (const n of task.nodes || []) {
    if (n.stage === 'dispatch' && n.child && n.child.run_id) runStory.set(String(n.child.run_id), { story: n.subgoal_id || null, attempt: n.attempt || 1 });
  }
  for (const s of driverTotal.node_streams || []) {
    const [runId, node] = String(s.stream).split('/');
    const own = runStory.get(runId);
    row(own ? own.story : null, own ? own.attempt : 1, stageOfNode(node || '') || 'build', s);
  }
  // spend a durable event keeps for sessions whose worktrees are gone: one row, so the rows sum to the figure
  if (driverTotal.durable_gap > 0) row(null, 1, 'other', { cost_usd: driverTotal.durable_gap });
  return rows;
}

const storyId = (p) => String(p.id).split(':')[0];

function telemetryOf({ task, tasksDir, depth, ledger, driverTotal, harness, sRun, cards, io }) {
  const opts = (task.team && task.team.opts) || {};
  const int = (a, b) => (Number.isInteger(a) ? a : (Number.isInteger(b) ? b : null));
  const maxRetries = int(task.max_retries, opts.max_retries);

  // the last judge score and reason per STORY: the accept judge's, never a dispatch self-score
  const judge = {};
  let judgeDenials = 0;
  const outOfRetries = new Set();
  const filed = new Set();
  for (const e of ledger) {
    if (e.event === 'verdict') {
      if (e.verdict === 'blocked') judgeDenials += 1;
      if (e.stage === 'accept' && e.subgoal_id) {
        // cause: the judged accept node's own first gap, read by e.node_id so a later retry node
        // (pending, no gaps) cannot replace it. Gaps come before blocking and problems on purpose:
        // the board names the gap the judge left open, where the ledger reason lists blocking first.
        const jn = (task.nodes || []).find((n) => n && n.node_id === e.node_id);
        const jr = (jn && jn.result) || {};
        const first = [jr.gaps, jr.blocking, jr.problems].map((x) => (Array.isArray(x) && x.length ? x[0] : null)).find((x) => x != null);
        const cause = first != null ? (typeof first === 'object' ? (first.text || JSON.stringify(first)) : String(first)) : (e.reason || null);
        judge[String(e.subgoal_id)] = { score: Number.isFinite(e.score) ? e.score : null, reason: e.reason || null, attempt: e.attempt || null, verdict: e.verdict || null, cause };
      }
    } else if (e.event === 'daemon_retry_settled' && /retry budget exhausted/.test(String(e.reason || '')) && e.package_id) {
      outOfRetries.add(String(e.package_id));
    } else if (e.event === 'exhausted_reintegrated' && Array.isArray(e.not_done)) {
      for (const id of e.not_done) outOfRetries.add(String(id));
    } else if (['defects_filed', 'tm_file', 'daemon_defects_filed', 'daemon_upstream_defects_filed'].includes(e.event)) {
      for (const f of Array.isArray(e.filed) ? e.filed : []) filed.add(String((f && f.id) || f));
    }
  }

  // live drivers and how long since each wrote: a stalled driver is alive with no progress
  const drivers = [];
  const seen = new Set();
  const addDriver = (story, d) => {
    if (!d || !d.alive || !d.log || seen.has(d.pid)) return;
    seen.add(d.pid);
    drivers.push({ story, progress_at: mtimeOf(d.log) });
  };
  for (const p of cards) addDriver(storyId(p), p.child && p.child.driver);
  addDriver(null, harness && harness.driver);
  addDriver(null, sRun && sRun.driver);

  const workers = new Set();
  for (const p of cards) {
    for (const n of (p.child && p.child.nodes) || []) if (n.blocked) workers.add(`${p.child.run_id}/${n.node_id}`);
  }

  // The process count scans every task.json under the root, and --format status never reads it: it is
  // taken on the first read of `live`, not on every collect.
  let live;
  const liveOnce = () => {
    if (live === undefined) {
      live = null;
      if (depth === 0) {
        try {
          const cap = capOf(task);
          live = { live: io ? io.live(tasksDir) : liveCount(tasksDir), cap: Number.isFinite(cap) ? cap : null };
        } catch { /* no process table: say nothing */ }
      }
    }
    return live;
  };

  return {
    goal_threshold: Number.isFinite(task.goal_threshold) ? task.goal_threshold : (Number.isFinite(opts.goal_threshold) ? opts.goal_threshold : null),
    max_attempts: maxRetries == null ? null : maxRetries + 1,
    stall_minutes: int(task.stall_minutes, opts.stall_minutes),
    budget_usd: Number.isFinite(opts.budget_usd) ? opts.budget_usd : (Number.isFinite(task.budget_usd) ? task.budget_usd : null),
    spent_usd: driverTotal.cost_usd,
    judge,
    out_of_retries: [...outOfRetries],
    spend: spendRows(driverTotal, task),
    drivers,
    get live() { return liveOnce(); },
    denials: { judges: judgeDenials, workers: workers.size },
    defects: {
      filed: [...filed],
      dropped: (Array.isArray(task.dropped_defects) ? task.dropped_defects : [])
        .map((d) => ({ id: (d && d.id) || null, title: String((d && d.title) || ''), reason: String((d && d.reason) || '') })),
    },
  };
}

function collectTaskFromValue(tasksDir, taskId, task, opts) {
  // Every level adds ITS OWN id/path before recursing into its own packages/s_run, so a nested
  // task discovered one level down already sees its immediate parent as an ancestor, not only
  // the ones further up - see collectNestedTasks' own comment for what this catches.
  const visiting = {
    depth: opts.depth || 0,
    io: opts.io || null,
    seen: opts.seen || new Set(),
    ancestorIds: new Set([...(opts.ancestorIds || []), taskId]),
    ancestorPaths: new Set([...(opts.ancestorPaths || []), resolve(taskPathOf(tasksDir, taskId))]),
  };
  const isH = !!task.harness_run;
  const isS = !isH && !!task.s_run;
  const io = visiting.io;
  const loadRun = io ? io.loadRun : loadRunAt;
  let state, counts, sRun = null, harness = null;
  if (isH) {
    ({ state, counts, harness } = collectHarness(task, taskId, tasksDir, loadRun));
  } else if (isS) {
    const run = loadRun(join(task.s_run.cwd, '.teams_output', 'broker', 'runs', `${task.s_run.run_id}.json`));
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

  // tm_cancel's marker is terminal, and the daemon's worktree-gone stop reads blocked
  // (taskmanager.mjs taskState): neither is a graph state, so the run's own reading gives way.
  if (task.cancelled) state = 'cancelled';
  else if (task.worktree_gone) state = 'blocked';

  const packages = [];
  // The planning cards (one per feature area, cards-everywhere C2) dispatch BEFORE shape writes
  // task.spec, so they are listed on their own: gated behind spec.packages, a running PLAN team
  // left "packages:" empty for the whole planning phase (code-sprint-S2, 2026-09-26).
  {
    const all = [...((task.spec && Array.isArray(task.spec.packages)) ? task.spec.packages : []), ...planningPkgs(task)];
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

  // The QA cards (one per feature area, cards-everywhere C7) and the planning audit (the packages
  // loop above only ever sees task.spec.packages + the planning cards, so without this a task
  // with QA or audit turned on drives every one of its rounds - defects found, STORYs filed, the
  // audit's own verdict - with nothing on this surface ever showing it happened). qa.cards keeps
  // each card's rounds apart; qa.rounds is all of them, card by card, for the round-by-round list.
  const qaCards = qaPkgs(task).map((p) => ({ id: String(p.id), title: p.area_title || p.title || '', rounds: collectPhaseRounds(task, p, String(p.id), visiting) }));
  const qaRounds = qaCards.flatMap((c) => c.rounds);
  const auditRounds = collectPhaseRounds(task, task.audit_pkg, 'AUDIT', visiting);

  const managerStages = task.nodes.filter((n) => !['dispatch', 'accept'].includes(n.stage)).map(nodeSummary);

  const ledgerPath = join(tasksDir, taskId, 'ledger.jsonl');
  const ledger = io ? io.jsonl(ledgerPath) : readJsonl(ledgerPath);
  // THE spend figure (drivercost.mjs spendFigure): the live total, or the latest exact durable event when larger
  const live = io ? io.costs(join(tasksDir, taskId), task) : collectTaskCosts(join(tasksDir, taskId), task);
  const figure = spendFigure(live, latestCostEvent(ledger));
  const driverTotal = { ...live, cost_usd: figure.spend, estimated: figure.estimated, durable_gap: figure.spend > live.cost_usd ? +(figure.spend - live.cost_usd).toFixed(4) : 0 };
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
  const harnessAlive = !!(harness && (harness.moving || (harness.driver && harness.driver.alive)));
  const epicWord = epicTicketState(task);
  const verdict = visiting.depth === 0 && STALLABLE.has(epicWord) ? stallVerdict(tasksDir, taskId, task) : { stalled: false };
  const stalledTask = verdict.stalled;
  // { stalled, minutes? } for every stalled or stale path; minutes on the task-level newest sign of life
  const stall = { ...verdict };
  if (stalledTask) {
    if (state === 'running') state = 'stalled';
    for (const p of packages) if (STALLABLE.has(p.ticket_state)) p.ticket_state = 'stalled';
  }
  if (visiting.depth > 0 && state === 'running') {
    const anyDriverAlive = (daemon && daemon.alive)
      || harnessAlive
      || (sRun && sRun.driver && sRun.driver.alive)
      || [...packages, ...qaRounds, ...auditRounds].some((p) => p.child && p.child.driver && p.child.driver.alive);
    if (!anyDriverAlive) { state = 'stale'; stall.stalled = true; stall.minutes = minutesSince(Date.now(), lastSignOfLife(tasksDir, taskId, task, recordedDrivers(tasksDir, taskId, task))); }
  } else if (state === 'running' && daemon && !daemon.alive) {
    // A task that WAS under a daemon, whose daemon is dead and whose drivers are all dead, is not
    // running - nothing is. idol-plan-2's S run read 'running' 86h after daemon_done blocked,
    // because a child run file a dead driver never finished still says running. (A task driven by
    // hand has no task.daemon at all and is left alone, per the comment above.)
    const anyDriverAlive = harnessAlive
      || (sRun && sRun.driver && sRun.driver.alive)
      || [...packages, ...qaRounds, ...auditRounds].some((p) => p.child && p.child.driver && p.child.driver.alive);
    if (!anyDriverAlive) { state = 'stalled'; stall.stalled = true; stall.minutes = minutesSince(Date.now(), lastSignOfLife(tasksDir, taskId, task, recordedDrivers(tasksDir, taskId, task))); }
  }

  const events = ledger.slice(-50);
  const telemetry = telemetryOf({
    task, tasksDir, depth: visiting.depth, ledger, driverTotal, harness, sRun, io,
    cards: [...packages, ...qaRounds, ...auditRounds],
  });
  // flow_metrics: Kanban's other half (tickets.mjs's own flowMetrics) - board.jsonl's transition
  // log read once here, the one place this file already reads a task's own JSONL evidence
  // (ledger.jsonl, one line up), and handed to a pure function rather than re-derived from
  // task.nodes, which only ever knows "now".
  const boardPath = join(tasksDir, taskId, 'board.jsonl');
  const boardEntries = io ? io.jsonl(boardPath) : readJsonl(boardPath);
  const flow_metrics = flowMetrics(task, boardEntries);

  const model = {
    task_id: task.run_id || taskId,
    tasks_dir: tasksDir,
    cwd: task.cwd,
    request: String(task.request || ''),
    // The TICKET view's EPIC header - tickets.mjs's own JIRA vocabulary (READY/IN_PROGRESS/...,
    // plan/setgoal/impl/qualitygate), never `state`/`flow` below (the engine's own run-state
    // words) - the two are deliberately different vocabularies for different audiences (see
    // tickets.mjs's header comment), and this surface shows both rather than picking one.
    ticket: { key: epicKey(task.run_id || taskId), slug: task.slug || null, title: deriveTitle(task.request, task.requests), state: stalledTask ? 'stalled' : epicWord, phase: epicPhase(task) },
    size: task.size || null,
    flow: task.flow && task.flow !== 'auto' ? task.flow : (task.flow_chosen || 'auto'),
    kind: task.kind || 'task',
    // who opened the task ({session_id, entrypoint}); null on a task created before tm_open recorded it
    opener: task.opener || null,
    created_at: task.created_at || null,
    elapsed_ms: elapsedMs(task.created_at),
    state,
    stall,
    counts,
    daemon,
    cost: { usd: driverTotal.cost_usd, turns: driverTotal.turns, sessions: driverTotal.sessions, ...(driverTotal.estimated_usd ? { estimated_usd: driverTotal.estimated_usd } : {}), ...(driverTotal.estimated ? { estimated: true } : {}), ...(task.budget_stopped ? { post_stop_usd: +Math.max(0, driverTotal.cost_usd - (task.budget_stopped.spend || 0)).toFixed(4) } : {}) },
    budget: sprintBox(task, driverTotal.cost_usd),
    package_map: task.shape_diagram && task.shape_diagram.path ? { path: task.shape_diagram.path, source: task.shape_diagram.source } : null,
    manager_stages: managerStages,
    packages,
    qa: qaCards.length ? { id: qaCards.map((c) => c.id).join(', '), cards: qaCards, rounds: qaRounds } : null,
    audit: task.audit_pkg ? { id: task.audit_pkg.id, rounds: auditRounds } : null,
    s_run: sRun,
    // The harness run's stage bar and whether its driver is moving - the one field every renderer
    // (view-summary's stagesOf, view-render-text) draws a harness_run task's stages from.
    harness,
    events,
    flow_metrics,
    telemetry,
    error: null,
  };
  if (task.created_at) onClock((now) => { model.elapsed_ms = now - task.created_at; });
  onClock((now) => { model.flow_metrics = flowMetrics(task, boardEntries, { now }); });
  return model;
}

// A short, human-quotable headline for a card - there is no title field on a task, only
// `request` (a free-text sentence or paragraph a person typed). Takes the first sentence/clause
// (up to the first ./!/?), falls back to the whole string when none of those appear, then
// truncates. The full `request` is never lost: view.mjs's per-task text (--once --task <id>) still
// shows it in full - this is only the index's headline.
//
// A backlog (tm_open requests[], the raw items in task.requests) past one item reads as the backlog
// cards its items name ("Backlog cards 74, 84"), else as its first item and how many more ("Fix X +2");
// one item reads as itself, not as the composed "[backlog priority 0] ..." request string.
const TITLE_MAX = 72;
const itemText = (r) => (r && typeof r === 'object' ? (r.request ?? r.text ?? r.title ?? '') : r);
export function deriveTitle(request, requests) {
  let text = request;
  if (Array.isArray(requests) && requests.length > 1) {
    const cards = [...new Set(requests.map((r) => (/\bcard (\d+)/i.exec(String(itemText(r) || '')) || [])[1]).filter(Boolean))];
    if (cards.length) return `Backlog card${cards.length > 1 ? 's' : ''} ${cards.join(', ')}`;
    return `${deriveTitle(itemText(requests[0]))} +${requests.length - 1}`;
  }
  if (Array.isArray(requests) && requests.length === 1) text = itemText(requests[0]);
  const s = String(text || '').trim();
  if (!s) return '(no request)';
  const clause = (s.match(/^[\s\S]*?[.!?](?=\s|$)/) || [s])[0].replace(/[.!?]+$/, '').trim();
  if (clause.length <= TITLE_MAX) return clause;
  return `${clause.slice(0, TITLE_MAX - 1).trimEnd()}…`;
}

// epicBoardRows' own `origin` field (tickets.mjs) is not itself "was this filed as a defect" -
// it defaults to 'shape' for an ordinary package, 'repair' for a repair package, and 'phase' for
// a PLAN/QA/AUDIT phase-Team package, precisely so tm_board always has SOME origin to print. A
// filed defect/unmet-story STORY is the one whose origin is in tickets.mjs's own FILED_ORIGINS -
// fileDefects (taskmanager.mjs) never writes any other origin for an actually-filed package.
//
// A task's STORY rows that are develop work (epicBoardRows' `role` is 'develop' for a plan
// package and any filed defect/unmet-story STORY; PLAN/QA/AUDIT phase-Team packages carry their
// own phase as role instead) - what a person scanning the index means by "how much of the actual
// work is done", and separately, how many of those rows a QA or planning-audit round filed
// (origin in FILED_ORIGINS) that have not yet reached DONE/CANCELLED/UNREACHABLE - still open,
// still something to look at.
function storyProgress(task) {
  const rows = epicBoardRows(task).filter((r) => r.role === 'develop');
  const openDefects = rows.filter((r) => FILED_ORIGINS.has(r.origin) && !['DONE', 'CANCELLED', 'UNREACHABLE'].includes(r.state)).length
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

// A finished task's index row, kept while the mtime and size of its task.json and ledger.jsonl are
// unchanged, so a long-lived reader (the viewer's 2 s watch, the engine's state server) does not
// re-read every task ever run on each call. Finished = a terminal state decided from task.json alone
// (the rule lib/view-index.mjs applies); anything else, and a read that failed, is always read again.
// elapsed_ms is the one field that moves with the clock and is recomputed on a hit.
const FINISHED = new Set(['DONE', 'SETTLED', 'CANCELLED']);
const finishedRows = new Map();

export function listTasks(tasksDir) {
  const ids = listTaskIds(tasksDir);
  const rows = [];
  const known = finishedRows.get(tasksDir) || new Map();
  const kept = new Map();
  for (const id of ids) {
    const key = epicKey(id);
    const sig = `${statSig(taskPathOf(tasksDir, id))}|${statSig(join(tasksDir, id, 'ledger.jsonl'))}`;
    const hit = known.get(id);
    if (hit && hit.sig === sig) {
      kept.set(id, hit);
      rows.push({ ...hit.row, elapsed_ms: elapsedMs(hit.row.created_at) });
      continue;
    }
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
      if (STALLABLE.has(state) && taskStalled(tasksDir, id, task)) state = 'stalled';
      phase = epicPhase(task);
      if (!task.s_run) stories = storyProgress(task);
    } catch { /* leave 'unknown' / no progress - a torn task.json should not crash the index */ }
    const driverTotal = { cost_usd: taskFigure(join(tasksDir, id), task).spend };
    const row = {
      task_id: id,
      epic_key: key,
      slug: task.slug || null,
      title: deriveTitle(task.request, task.requests),
      state,
      phase,
      // Grouping/display only - a person-set label above the EPIC (teamconfig.mjs's own
      // `initiative` key). null (the default, and every task opened before this existed) means
      // "not part of any group" - the index renders it as a plain tag, never a
      // restructured layout, so the byte-for-byte "no initiative anywhere -> unchanged" contract
      // tm_board's own grouping keeps is not something this surface has to re-derive.
      initiative: task.initiative || null,
      size: task.size || null,
      created_at: task.created_at || null,
      elapsed_ms: elapsedMs(task.created_at),
      cost_usd: driverTotal.cost_usd,
      stories_done: stories.storiesDone,
      stories_total: stories.storiesTotal,
      open_defects: stories.openDefects,
    };
    rows.push(row);
    if (FINISHED.has(state) && (task.cancelled || !(task.s_run || task.harness_run || task.worktree_gone))) kept.set(id, { sig, row });
  }
  finishedRows.set(tasksDir, kept);
  rows.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
  return rows;
}
