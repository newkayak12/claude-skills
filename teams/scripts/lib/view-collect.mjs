// collect() builds one plain-JSON model of a task-manager task for a human to look at.
// Both renderers (the HTML page's /state.json and the --once text tree in view.mjs) draw from
// this single function - it is the only place that reads task.json, a child run file, or a
// driver stream. Read-only: nothing here ever writes a file.
//
// task.json / a child run file can be caught mid-write by another process (the daemon, a
// broker). A parse failure is tolerated, not fatal: it is reported on the model as
// `error` / a node's own `read_error`, never thrown past collect().
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadRunAt, runState } from '../../mcp/graph.mjs';
import { driverCostOf, collectDriverCosts } from '../bench/lib/drivercost.mjs';

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
// gets its own trivial liveness probe identical in effect to taskmanager's driverAlive().
function pidAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
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
  return out;
}

// A child run's own node chain (plan -> setgoal -> critique -> implement:* -> test:* -> gate:*
// -> gate:goal -> report, or the cases/execute KIND for a test-writing flow) plus, recursively,
// any nested task-manager task found under <cwd>/.harness-tasks/ - a package worktree that
// itself opened a task-manager task rather than a plain graph run.
function collectChildRun(cwd, runId, visiting) {
  const run = loadRunAt(join(cwd, '.teams_output', 'broker', 'runs', `${runId}.json`));
  if (!run) return { run_id: runId, cwd, missing: true };
  const state = runState(run);
  const nested = collectNestedTasks(cwd, visiting);
  return {
    run_id: run.run_id,
    cwd,
    flow: run.flow,
    state: state.state,
    counts: state.counts,
    goal_verdict: state.goal_verdict || null,
    nodes: run.nodes.map(nodeSummary),
    nested,
  };
}

// A package's worktree (or a report/repair worktree) can itself hold a nested task under
// <cwd>/.harness-tasks/<task-id>/ - the same daemon-driven size->shape->critique->... shape,
// one level down. Recursion is capped and cycle-guarded: the fixture the live example on disk
// shows one where a worktree's nested task dir reused the SAME task id as an ancestor.
function collectNestedTasks(cwd, visiting) {
  const dir = join(cwd, '.harness-tasks');
  if (!existsSync(dir) || visiting.depth > 6) return [];
  const ids = listTaskIds(dir);
  const out = [];
  for (const id of ids) {
    const key = `${dir}::${id}`;
    if (visiting.seen.has(key)) continue;
    visiting.seen.add(key);
    out.push(collectTask(dir, id, { depth: visiting.depth + 1, seen: visiting.seen }));
  }
  return out;
}

function packageModel(pkg, dispatchNode, acceptNode, visiting) {
  const child = dispatchNode && dispatchNode.child
    ? {
      run_id: dispatchNode.child.run_id,
      cwd: dispatchNode.child.cwd,
      branch: dispatchNode.child.branch,
      driver: driverInfo(dispatchNode.child.driver, pidAliveFromDriver),
      ...collectChildRun(dispatchNode.child.cwd, dispatchNode.child.run_id, visiting),
    }
    : null;
  return {
    id: pkg.id,
    title: pkg.title || null,
    brief: String(pkg.brief || '').slice(0, 200),
    phase: pkg.phase || null,
    deps: pkg.deps || [],
    dispatch: dispatchNode ? nodeSummary(dispatchNode) : null,
    accept: acceptNode ? nodeSummary(acceptNode) : null,
    child,
  };
}

function pidAliveFromDriver(driver) { return pidAlive(driver && driver.pid); }

// The one function both renderers call. `tasksDir` is where task.json lives directly under
// <tasksDir>/<taskId>/ - the top-level tasks root for the outermost call, or a package
// worktree's own .harness-tasks/ for a nested one.
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
  const visiting = { depth: opts.depth || 0, seen: opts.seen || new Set() };
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
  if (task.spec && Array.isArray(task.spec.packages)) {
    const all = [...task.spec.packages, ...(task.planning_pkg ? [task.planning_pkg] : [])];
    for (const pkg of all) {
      // A retried package can have several dispatch:<id>:<attempt> nodes; take the latest.
      const dispatches = task.nodes.filter((n) => n.stage === 'dispatch' && n.subgoal_id === pkg.id)
        .sort((a, b) => (a.attempt || 1) - (b.attempt || 1));
      const dispatchNode = dispatches[dispatches.length - 1] || null;
      const accepts = task.nodes.filter((n) => n.stage === 'accept' && n.subgoal_id === pkg.id)
        .sort((a, b) => (a.attempt || 1) - (b.attempt || 1));
      const acceptNode = accepts[accepts.length - 1] || null;
      packages.push(packageModel(pkg, dispatchNode, acceptNode, visiting));
    }
  }

  const managerStages = task.nodes.filter((n) => !['dispatch', 'accept'].includes(n.stage)).map(nodeSummary);

  const driverTotal = collectDriverCosts(join(tasksDir, taskId));
  const daemon = task.daemon ? {
    pid: task.daemon.pid,
    alive: pidAlive(task.daemon.pid),
    restarts: task.daemon.restarts || 0,
    exhausted: !!task.daemon.exhausted,
    log: task.daemon.log || null,
  } : null;

  const ledgerPath = join(tasksDir, taskId, 'ledger.jsonl');
  const events = readJsonl(ledgerPath, 50);

  return {
    task_id: task.run_id || taskId,
    tasks_dir: tasksDir,
    cwd: task.cwd,
    request: String(task.request || ''),
    size: task.size || null,
    flow: task.flow && task.flow !== 'auto' ? task.flow : (task.flow_chosen || 'auto'),
    kind: task.kind || 'task',
    created_at: task.created_at || null,
    elapsed_ms: elapsedMs(task.created_at),
    state,
    counts,
    daemon,
    cost: { usd: driverTotal.cost_usd, turns: driverTotal.turns, sessions: driverTotal.sessions },
    manager_stages: managerStages,
    packages,
    s_run: sRun,
    events,
    error: null,
  };
}

export function listTasks(tasksDir) {
  const ids = listTaskIds(tasksDir);
  const rows = [];
  for (const id of ids) {
    const read = readJsonRetry(taskPathOf(tasksDir, id));
    if (!read.ok) { rows.push({ task_id: id, error: read.error }); continue; }
    const task = read.value;
    let state = 'unknown';
    try {
      state = task.s_run
        ? (() => { const r = loadRunAt(join(task.s_run.cwd, '.teams_output', 'broker', 'runs', `${task.s_run.run_id}.json`)); return r ? runState(r).state : 'blocked'; })()
        : runState(task).state;
    } catch { /* leave 'unknown' */ }
    const driverTotal = collectDriverCosts(join(tasksDir, id));
    rows.push({
      task_id: id,
      request: String(task.request || '').slice(0, 160),
      state,
      size: task.size || null,
      created_at: task.created_at || null,
      cost_usd: driverTotal.cost_usd,
    });
  }
  rows.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
  return rows;
}
