// taskmanager-harness.mjs - size S on the development harness and the engine scope verdict; split out of taskmanager.mjs (card 128 step 1), moved verbatim.
import { SCRATCH_RULE } from './layout-guard.mjs';
import { applySuspends, countedDriverRestarts, driverAlive, record, resolveHarnessRun, restartBudget, stampAfterWake, taskDir } from './taskstate.mjs';
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { epicKey } from './tickets.mjs';
import { fileURLToPath } from 'node:url';
import { graphRunPath, harnessVerdict, taskTag } from './harnessrun.mjs';
import { baseline as scopeBaseline, inScope, ownVerdict } from './scope.mjs';
import { loadRun, runState, saveRun } from './graph.mjs';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { touchMarker } from './engage.mjs';
import { driverExitInfo, driverStderrTail, driverUsageLimitText, nextSpawnAttempt, spawnChildDriver, taskState } from './taskmanager-drivers.mjs';
import { excludeMarkers, git, noDriver } from './taskmanager-worktree.mjs';
import { reserveSpawn, respawnDriver, spawning } from './taskmanager-claims.mjs';

// ---------- size S on the development harness (S1/S1a) ----------

const HARNESS_SKILLS = ['graph:orchestrate', 'harness:harness'];

// The one headless session a size-S task gets. It runs the development harness on the request -
// the graph MCP first, the Agent Team fallback when that MCP is absent (never the Workflow route:
// it leaves no goal-gate verdict on disk) - tags the run with this task's id, and writes only the
// pointer and the report. Everything the manager concludes is read from the run itself.
function harnessPrompt(task, opts = {}) {
  const h = task.harness_run;
  const o = task.child_opts || {};
  const tag = taskTag(task.run_id);
  const routing = [
    'isolated: false', 'allocation: "balanced"',
    `goal_threshold: ${Number.isFinite(Number(task.goal_threshold)) && task.goal_threshold != null ? Number(task.goal_threshold) : 90}`,
    `host_vendor: "${o.host_vendor || 'claude'}"`,
    o.host_model ? `host_model: "${o.host_model}"` : '',
    Array.isArray(o.native_models) && o.native_models.length ? `native_models: ${JSON.stringify(o.native_models)}` : '',
  ].filter(Boolean).join(', ');
  const run = opts.run || null;
  const resume = !opts.resume ? ''
    : run ? `A previous driver for this task died. Its harness run is ${run.route === 'graph' ? `the graph run ${run.run_id} at cwd ${run.cwd}` : `the fallback run at ${run.run_dir}`}: CONTINUE that run - read its status first, redo nothing already done, settle or retry a blocked node - and never open a second run.`
      : `A previous driver for this task died before its run was recorded. Look for a run tagged ${tag} (a graph run whose request starts with it, or .harness-run/*/manifest.json with "teams_task": "${task.run_id}") and continue it; open a new run only when there is none.`;
  const decisions = (task.decisions || []).map((d) => `- ${d.question}: ${d.chose}${d.because ? ` (${d.because})` : ''}`);
  return [
    `Run the development harness on the request below, in cwd ${h.cwd}, with claude and codex taking part. Do not call tm_open, tm_run or team_open, and never write this task's task.json.`,
    resume,
    `Route 1, the graph MCP: graph_open({request: "${tag} " followed by the request, cwd: "${h.cwd}", owner: {task_id: "${task.run_id}", key: "${epicKey(task.run_id)}"}, ${routing}}), then drive it to its report exactly as the graph:orchestrate skill says.`,
    `Route 2, only when the graph MCP is not available: the harness skill's Agent Team fallback (harness/engine/fallback.md), codex through codex-exec-adapter.mjs with codex_provider "auto" (a fallback to Claude is recorded as such). Its manifest.json carries "teams_task": "${task.run_id}". Do not use the Workflow route.`,
    `As soon as the run exists, write ${h.pointer} as {"route":"graph","run_id":"<id>","cwd":"${h.cwd}"} or {"route":"fallback","run_dir":"<absolute run dir>"}.`,
    `When the run has written its report, copy that report to ${h.report_path}. The task's verdict is read from the run itself, not from anything you write.`,
    h.baseline_path ? `Scope: this checkout may already hold uncommitted work (${h.baseline_count} dirty path(s) recorded in ${h.baseline_path} before the run). Your scope check counts only the paths you touched; the baseline's dirty paths, left as they were, are excluded. The engine computes your scope verdict itself when the run finishes: it takes the scope from the files your plan and setgoal results name (so name every file you will edit there) and counts only the paths your own nodes wrote. You do not compute or report a scope verdict. ${SCRATCH_RULE}` : '',
    task.base_commit ? `Gate integrity: before you report, list the files this run changed that make up the gate itself with the CLI, never from your own reading: node ${join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts')}/gateintegrity.mjs --cwd ${h.cwd} --baseline ${task.base_commit} (the same script under the plugin root's scripts/ directory may be used). Judge the printed list as the L gate does. Its exit status: 0 = no test weakening found; 1 = weakened tests found, printed one per line; 2 = usage error (git cannot resolve the baseline).` : '',
    `Never end a turn while your own background agent or test run is still running; wait for it to finish first.`,
    '',
    'Request:',
    String(task.request || ''),
    task.context ? `\nContext:\n${task.context}` : '',
    decisions.length ? `\nAlready decided (rules, not questions):\n${decisions.join('\n')}` : '',
  ].filter((x) => x !== '').join('\n');
}

function spawnHarnessDriver(task, opts = {}) {
  return spawnChildDriver(task, 'S', task.harness_run, {
    prompt: harnessPrompt(task, opts), harness: true,
    // The hook (hooks/own-writes.mjs) records this driver's writes only when it sees these two.
    env: { TEAMS_OWN_WRITES: ownWritesPath(task.cwd, task.run_id), TEAMS_OWN_RUN: task.run_id },
    ...(Number.isInteger(opts.attempt) ? { attempt: opts.attempt } : {}),
  });
}

export function openHarnessRun(task) {
  const dir = taskDir(task.run_id);
  task.harness_run = {
    cwd: task.cwd, opened_at: Date.now(), route: null, run: null,
    pointer: join(dir, 'harness-run.json'), report_path: join(dir, 'harness-report.md'),
    writes_path: ownWritesPath(task.cwd, task.run_id),
  };
  // Baseline of what is already dirty, so the run's scope check counts only what it touches.
  try {
    const base = scopeBaseline(task.cwd);
    mkdirSync(dir, { recursive: true });
    const bp = join(dir, 'scope-baseline.json');
    writeFileSync(bp, JSON.stringify(base, null, 1) + '\n');
    task.harness_run.baseline_path = bp;
    task.harness_run.baseline_count = Object.keys(base).length;
  } catch { /* not a git checkout: no baseline */ }
  excludeMarkers(task.cwd);
  touchMarker(task.cwd, task.run_id);
  record(task, { event: 'harness_open', task_id: task.run_id, cwd: task.cwd });
  if (noDriver()) return;
  task.harness_run.spawn_count = 0;
  // Spawned after the caller's transaction commits (reserveSpawn); the reply reads it after that
  // (withHarnessFields).
  reserveSpawn(task, 'S', task.harness_run, {
    attempt: 0, reason: 'spawn', restarts: [],
    spawn: (t) => spawnHarnessDriver(t),
    apply: (t, h, driver) => {
      h.driver = driver;
      record(t, {
        event: 'child_driver_spawned', task_id: t.run_id, node_id: 'S', pid: driver.pid, cwd: t.cwd,
        log: driver.log, command: driver.command, ...(driver.error ? { error: driver.error } : {}),
      });
    },
  });
}

// ---- the engine's own scope verdict (card 81 rest) ----

// Strings anywhere inside a node result value.
function resultStrings(v, out = []) {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) for (const x of v) resultStrings(x, out);
  else if (v && typeof v === 'object') for (const x of Object.values(v)) resultStrings(x, out);
  return out;
}

// The scope list of a graph run: the file paths its done plan and setgoal node results name
// (result.plan text; result.spec goal/acceptance/subgoals). A token is a path when it has a '/'
// or a file extension; trailing punctuation is dropped.
export function scopePathsFromRun(runFile) {
  const found = new Set();
  const nodes = runFile && Array.isArray(runFile.nodes) ? runFile.nodes : [];
  for (const n of nodes) {
    if (!n || n.state !== 'done' || !n.result || (n.stage !== 'plan' && n.stage !== 'setgoal')) continue;
    const parts = n.stage === 'plan' ? resultStrings(n.result.plan) : resultStrings(n.result.spec);
    for (const text of parts) {
      for (const m of text.matchAll(/(?:[\w@.-]+\/)+[\w@.*?-]*|[\w-]+\.[A-Za-z][\w]{0,7}\b/g)) {
        const p = m[0].replace(/^\.\//, '').replace(/[.,;:]+$/, '');
        if (p && !/^\.+$/.test(p) && !p.startsWith('//')) found.add(p);
      }
    }
  }
  return [...found].sort();
}

// <cwd>/.harness-run/writes/<graph run_id>.jsonl, one {ts, run_id, node_id, path} per write made
// by that run's own nodes (cwd-relative). null when no record exists: an older run, or an adapter
// that does not write one - the verdict then falls back to the git-only check.
export function ownWritesPath(cwd, runId) { return join(cwd, '.harness-run', 'writes', `${runId}.jsonl`); }
export function readOwnWrites(cwd, runId) {
  let text;
  try { text = readFileSync(ownWritesPath(cwd, runId), 'utf8'); } catch { return null; }
  const out = new Set();
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const p = JSON.parse(line).path;
      if (typeof p !== 'string' || !p) continue;
      out.add(isAbsolute(p) ? relative(cwd, p) : p.replace(/^\.\//, ''));
    } catch { /* a torn line is skipped */ }
  }
  return [...out];
}

// A fallback run has no run file: its plan and setgoal are RUN/01-plan.md and RUN/02-goal-spec.json.
// The same shape scopePathsFromRun reads from a graph run.
function fallbackScopeRun(runDir) {
  const text = (f) => { try { return readFileSync(join(runDir, f), 'utf8'); } catch { return ''; } };
  return { nodes: [
    { stage: 'plan', state: 'done', result: { plan: text('01-plan.md') } },
    { stage: 'setgoal', state: 'done', result: { spec: text('02-goal-spec.json') } },
  ] };
}

// The verdict the engine computes on the finish read of a size-S run: no model step. null when it
// cannot be computed (a route it does not read, no baseline file). Empty scope is ok:null / no_scope.
// own = the union of the task-id record (the size-S driver's, written by hooks/own-writes.mjs) and,
// on the graph route, the graph run-id record; null only when both are missing. With task.base_commit
// the paths the run committed (base..HEAD) count as touched too, still only those in the own record.
export function computeScopeVerdict(h, run, task) {
  if (!run || (run.route !== 'graph' && run.route !== 'fallback') || !h.baseline_path) return null;
  let base; let runFile;
  try {
    base = JSON.parse(readFileSync(h.baseline_path, 'utf8'));
    runFile = run.route === 'graph' ? JSON.parse(readFileSync(graphRunPath(run.cwd, run.run_id), 'utf8')) : fallbackScopeRun(run.run_dir);
  } catch { return null; }
  const scope = scopePathsFromRun(runFile);
  if (!scope.length) return { ok: null, reason: 'no_scope', outOfScope: [], scope, own_record: false };
  const records = [];
  if (task && task.run_id) records.push(readOwnWrites(h.cwd, task.run_id));
  if (run.route === 'graph') records.push(readOwnWrites(h.cwd, run.run_id));
  const found = records.filter((r) => r !== null);
  const own = found.length ? [...new Set(found.flat())] : null;
  try {
    const r = ownVerdict({ cwd: h.cwd, baseline: base, scope, own });
    let outOfScope = r.outOfScope;
    if (own && task && task.base_commit) {
      const c = git(h.cwd, ['diff', '--name-only', `${task.base_commit}..HEAD`]);
      if (c.ok) {
        const committed = c.out.split('\n').filter((p) => p && own.includes(p) && !inScope(p, scope));
        outOfScope = [...new Set([...outOfScope, ...committed])].sort();
      }
    }
    const ok = outOfScope.length === 0;
    return { ok, reason: ok ? 'pass' : 'out_of_scope', outOfScope, scope, own_record: own !== null };
  } catch (e) {
    return { ok: null, reason: `verdict_error: ${String((e && e.message) || e).slice(0, 120)}`, outOfScope: [], scope, own_record: own !== null };
  }
}

// A size-S graph run that stopped for good on a failed report: the graph reads blocked (nothing
// ready, nothing running) and its latest report node failed. A fresh driver cannot move it - it
// opens no second run and the report is only re-pended by an explicit retry - so respawning one
// on the same run loops. Returns { node, reason, fingerprint } or null; the fingerprint is the
// node states, so any retry of the run changes it. runFile: the graph run file's JSON.
export function terminalBlocked(runFile) {
  if (!runFile || !Array.isArray(runFile.nodes) || runState(runFile).state !== 'blocked') return null;
  const failed = runFile.nodes.filter((n) => n && n.stage === 'report' && n.state === 'failed').pop();
  if (!failed) return null;
  const r = failed.result || {};
  const reason = String(r.reason || r.verification_error || (Array.isArray(r.gaps) && r.gaps[0]) || 'no reason recorded').slice(0, 300);
  const states = runFile.nodes.map((n) => `${n.node_id}:${n.state}:${n.final ? 1 : 0}:${n.report_attempts || 0}:${n.reopened || 0}`).join('|');
  return { node: failed.node_id, reason, fingerprint: createHash('sha1').update(states).digest('hex').slice(0, 16) };
}

function terminalBlockedRun(run) {
  if (!run || run.route !== 'graph') return null;
  try { return terminalBlocked(JSON.parse(readFileSync(graphRunPath(run.cwd, run.run_id), 'utf8'))); } catch { return null; }
}

// Keeps the harness driver alive: a usage-limit death parks on waiting_capacity (no restart
// spent), any other death is respawned with a resume prompt naming the recorded run, up to the
// restart budget - unless the run is terminal-blocked on a failed report and unchanged, which
// blocks the task once (h.stuck) instead. Returns true when it changed the task.
export function serviceHarnessRun(task) {
  const h = task.harness_run;
  if (!h) return false;
  applySuspends(task);
  const snap = () => JSON.stringify([h.run || null, h.refused_pointer || null, !!h.finished_at, !!h.exhausted, h.accepted, !!h.scope, h.stuck ? h.stuck.fingerprint : null]);
  const before = snap();
  const run = resolveHarnessRun(task);
  const v = run ? harnessVerdict(run, task.goal_threshold) : null;
  if (v && v.finished && !h.finished_at) { h.finished_at = Date.now(); h.accepted = !!v.accept; }
  if (h.finished_at && h.accepted === undefined && v && v.finished) h.accepted = !!v.accept;
  // The finish read: the engine computes the scope verdict once, from the run's plan/setgoal
  // scope, its baseline and its own-write record.
  if (v && v.finished && !h.scope) {
    const s = computeScopeVerdict(h, run, task);
    if (s) {
      h.scope = { ok: s.ok, reason: s.reason, outOfScope: s.outOfScope, scope: s.scope, own_record: s.own_record, at: Date.now() };
      record(task, { event: 'scope_verdict', task_id: task.run_id, ok: s.ok, reason: s.reason, out_of_scope: s.outOfScope, scope: s.scope, own_record: s.own_record, route: run.route, gates: s.own_record === true && s.ok === false });
    }
  }
  const changed = () => snap() !== before;
  const d = h.driver;
  if (h.stuck && d && driverAlive(d)) delete h.stuck; // a driver was started again (tm_retry): the block is over
  // The first driver deferred at max_live_drivers (openHarnessRun): no driver exists to restart,
  // so the wait ends here, by spawning that first driver once a slot is free.
  if (!d && h.waiting_cap && !(v && v.finished) && !task.budget_stopped && !spawning(h) && !noDriver()) {
    return respawnDriver(task, 'S', h, {
      attempt: 0, reason: 'spawn', restarts: [],
      spawn: (t) => spawnHarnessDriver(t),
      event: (t, fresh) => ({ event: 'child_driver_spawned', task_id: t.run_id, node_id: 'S', pid: fresh.pid, cwd: t.cwd, log: fresh.log, command: fresh.command, ...(fresh.error ? { error: fresh.error } : {}) }),
    }) || changed();
  }
  if ((v && v.finished) || !d || driverAlive(d) || h.waiting_capacity || task.budget_stopped || spawning(h)) return changed();
  const usage = driverUsageLimitText(d);
  if (usage) {
    h.waiting_capacity = { reason: usage.slice(0, 500), since: Date.now() };
    record(task, { event: 'child_driver_capacity', task_id: task.run_id, node_id: 'S', pid: d.pid, reason: usage.slice(0, 300) });
    return true;
  }
  const tb = terminalBlockedRun(run);
  if (h.stuck) {
    if (tb && tb.fingerprint === h.stuck.fingerprint) return changed(); // unchanged: blocked already, said once
    delete h.stuck; // the run changed: the normal restart path
  } else if (tb) {
    h.stuck = { node: tb.node, reason: tb.reason, fingerprint: tb.fingerprint, at: Date.now() };
    record(task, { event: 'harness_run_stuck', task_id: task.run_id, node_id: tb.node, reason: tb.reason, fingerprint: tb.fingerprint, pid: d.pid });
    return true;
  }
  if (countedDriverRestarts(task, d).length >= restartBudget(task)) {
    if (!h.exhausted) {
      h.exhausted = true;
      record(task, { event: 'harness_driver_exhausted', task_id: task.run_id, pid: d.pid, stderr_tail: driverStderrTail(d) });
    }
    return changed();
  }
  const restarts = [...(d.restarts || []), stampAfterWake(task, d.restarts || [], { pid: d.pid, exit: driverExitInfo(d), at: Date.now(), stderr_tail: driverStderrTail(d, 300) })];
  const attempt = nextSpawnAttempt(h);
  const budget = restartBudget(task);
  return respawnDriver(task, 'S', h, {
    attempt, reason: 'restart', restarts,
    spawn: (t) => spawnHarnessDriver(t, { resume: true, run, attempt }),
    event: (t, fresh) => ({ event: 'child_driver_restarted', task_id: t.run_id, node_id: 'S', pid: fresh.pid, restart: restarts.length, budget }),
  });
}

function harnessInfo(task) {
  const h = task.harness_run;
  return {
    route: h.route || null, run: h.run || null, report_path: h.report_path, pointer: h.pointer,
    ...(h.driver ? { driver: { ...h.driver, alive: driverAlive(h.driver) } } : {}),
    ...(h.waiting_capacity ? { waiting_capacity: h.waiting_capacity } : {}),
    ...(h.refused_pointer ? { refused_pointer: h.refused_pointer } : {}),
  };
}

function toolNextHarness(task) {
  const h = task.harness_run;
  if (serviceHarnessRun(task)) saveRun(task);
  const ts = taskState(task);
  const d = h.driver || null;
  const out = {
    task_id: task.run_id,
    state: ts.state,
    ...(ts.partial ? { partial: true, partial_reasons: ts.partial_reasons } : {}),
    ...(ts.reason ? { reason: ts.reason } : {}),
    counts: {},
    ...(task.size ? { size: task.size } : {}),
    flow: task.flow !== 'auto' ? task.flow : (task.flow_chosen || 'auto'),
    cwd: h.cwd,
    harness: harnessInfo(task),
    ready: [],
    children: [],
  };
  if (d) out.driver = { pid: d.pid, alive: driverAlive(d), log: d.log, ...((d.restarts || []).length ? { restarts: d.restarts.length } : {}) };
  if (h.waiting_capacity) out.waiting_capacity = h.waiting_capacity;
  if (ts.state === 'complete' || ts.state === 'partial') {
    let report = '';
    try { report = readFileSync(h.report_path, 'utf8'); } catch { /* the driver did not copy it */ }
    const v = h.run ? harnessVerdict(h.run, task.goal_threshold) : null;
    out.report = report || (v && v.report_text) || '';
    out.next = 'this task is finished: relay the harness report to the requester, exactly as the entry skill\'s output template asks';
  } else if (ts.state === 'blocked') {
    out.next = `${ts.reason}; tm_retry({task_id}) gives it a fresh driver on the same run`;
  } else if (h.waiting_capacity) {
    out.next = `waiting on provider capacity (${h.waiting_capacity.reason.slice(0, 160)}); tell the user the reset time and stop. tm_retry({task_id, reset_capacity:true}) resumes it`;
  } else if (d && driverAlive(d)) {
    out.next = `its driver process (pid ${d.pid}) is running the development harness: wait; poll tm_next; do not drive it yourself`;
  } else {
    out.next = 'no harness driver is running yet: poll tm_next';
  }
  return out;
}

// tm_next for a size-S task driven by s_driver 'process': there is no manager node graph to
// read readiness from, only the one run task.s_run points at. Shaped so the caller can fill
// the entry skill's output template - node/vendor/stage_ok/note, then the report - without
// ever opening a node payload itself.
function toolNextSRun(task) {
  const s = task.s_run;
  const run = loadRun(s.cwd, s.run_id);
  const cs = run ? runState(run) : { state: 'missing', counts: {} };
  const driver = s.driver || null;
  const ts = taskState(task);
  const out = {
    task_id: task.run_id,
    state: ts.state,
    ...(ts.partial ? { partial: true, partial_reasons: ts.partial_reasons } : {}),
    counts: cs.counts || {},
    ...(task.size ? { size: task.size } : {}),
    flow: task.flow !== 'auto' ? task.flow : (task.flow_chosen || 'auto'),
    run_id: s.run_id,
    cwd: s.cwd,
    ready: [],
    children: [],
  };
  if (driver) out.driver = { pid: driver.pid, alive: driverAlive(driver), log: driver.log, ...((driver.restarts || []).length ? { restarts: driver.restarts.length } : {}) };
  if (s.waiting_capacity) out.waiting_capacity = s.waiting_capacity;
  if (s.stalled_since) out.stalled_since = s.stalled_since;
  if (cs.state !== 'running') {
    out.nodes = run ? run.nodes.filter((x) => x.result).map((x) => ({
      node_id: x.node_id,
      stage: x.stage,
      vendor: (x.result && (x.result.vendor || x.result.executor)) || 'self',
      stage_ok: !!(x.result && x.result.stage_ok === true),
      note: String((x.result && (x.result.reason || x.result.evidence)) || '').slice(0, 140),
    })) : [];
    const report = run ? run.nodes.filter((x) => x.stage === 'report' && x.state === 'done' && x.result).pop() : null;
    out.report = report ? String(report.result.handoff || '') : '';
    out.next = 'this task is finished: relay the node table and the report to the requester, exactly as the entry skill\'s output template asks';
  } else if (s.waiting_capacity) {
    out.next = `waiting on provider capacity (${s.waiting_capacity.reason.slice(0, 160)}); tell the user the reset time and stop. tm_retry({task_id, reset_capacity:true}) resumes it`;
  } else if (driver && driverAlive(driver)) {
    out.next = `its driver process (pid ${driver.pid}) is running this run: wait; poll tm_next; do not drive it yourself`;
  } else if (driver) {
    const budget = Number.isInteger(task.driver_restarts) ? task.driver_restarts : 2;
    out.next = `its driver is gone and legacy size-S runs are not restarted (restart budget was ${budget}); team_status({run_id, cwd}) shows where it stopped - open a new task for what is left`;
  } else {
    out.next = `drive it yourself with team_next/team_run/team_submit at cwd ${s.cwd}, run_id ${s.run_id}`;
  }
  return out;
}

export { HARNESS_SKILLS, harnessInfo, spawnHarnessDriver, toolNextHarness, toolNextSRun };
