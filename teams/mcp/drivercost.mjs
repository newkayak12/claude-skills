// Driver cost/turn aggregation, split out of score.mjs so view.mjs (a human-readable status
// surface for a running/finished task, teams/scripts/view.mjs) can read the exact same numbers
// instead of growing a second parser that reports something different.
//
// A `claude -p --output-format stream-json` driver stream is a newline-delimited sequence of
// events; only the LAST `result` event carries the session's true totals (`total_cost_usd`,
// `num_turns`, `duration_ms`) - everything before it is a partial view. Reading any other event
// for cost undercounts.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (p) => { try { return readFileSync(p, 'utf8'); } catch { return null; } };
const ls = (p) => { try { return readdirSync(p, { withFileTypes: true }); } catch { return []; } };

// Walk a tree for every directory literally named "drivers" and collect its *.stream.jsonl
// files - not hardcoded to any one shape, so a nested child run's own drivers/ dir (found while
// walking its worktree) is picked up the same way a top-level task's is.
export function findDriverStreams(dir, acc = [], depth = 0) {
  if (depth > 14) return acc;
  for (const e of ls(dir)) {
    if (e.name === '.git' || e.name === 'node_modules') continue;
    if (!e.isDirectory()) continue;
    const p = join(dir, e.name);
    if (e.name === 'drivers') {
      for (const f of ls(p)) if (f.isFile && f.isFile() && f.name.endsWith('.stream.jsonl')) acc.push(join(p, f.name));
    }
    findDriverStreams(p, acc, depth + 1);
  }
  return acc;
}

export function lastResultEvent(streamPath) {
  const txt = read(streamPath);
  if (!txt) return null;
  let last = null;
  for (const line of txt.split('\n')) {
    if (!line.trim()) continue;
    let ev;
    try { ev = JSON.parse(line); } catch { continue; }
    if (ev.type === 'result') last = ev;
  }
  return last;
}

// A task's drivers/ directory is itself tracked in git, so every worktree spawned off it checks
// out whatever driver streams had already finished at branch time - the same driver session,
// copied verbatim into N worktrees. Identity is (task-id, driver filename), not the path;
// duplicates collapse to the single highest-cost (= most complete) reading.
export function driverKey(root, p) {
  const rel = p.startsWith(root) ? p.slice(root.length + 1) : p;
  const m = rel.match(/(?:^|[\\/])([^\\/]+)[\\/]drivers[\\/]([^\\/]+)$/);
  return m ? `${m[1]}/${m[2]}` : rel;
}

// A session's token use in input-token units (cache write 1.25x, cache read 0.1x, output 5x -
// the ratios Claude pricing holds across models), summed over its assistant messages, each
// message counted once at its last usage reading.
export function usageUnits(streamPath) {
  const txt = read(streamPath);
  if (!txt) return 0;
  const byMsg = new Map();
  for (const line of txt.split('\n')) {
    if (!line.trim()) continue;
    let ev;
    try { ev = JSON.parse(line); } catch { continue; }
    if (ev.type === 'assistant' && ev.message && ev.message.id && ev.message.usage) byMsg.set(ev.message.id, ev.message.usage);
  }
  let units = 0;
  for (const u of byMsg.values()) {
    units += (u.input_tokens || 0) + 1.25 * (u.cache_creation_input_tokens || 0) + 0.1 * (u.cache_read_input_tokens || 0) + 5 * (u.output_tokens || 0);
  }
  return units;
}

// Used only when this task has no finished session to calibrate from yet (a PLAN team's first
// session is often the only one for 40+ minutes). Measured 2026-09-26: dispatch sessions on
// claude-opus-5-5 ran 5.2-5.7e-6 per unit across two runs. Keyed by model; any other model has
// no fallback and stays uncounted until something finishes.
const FALLBACK_RATES = { 'claude-opus-5-5': 5.5e-6 };

function streamModel(streamPath) {
  const txt = read(streamPath);
  if (!txt) return null;
  for (const line of txt.split('\n', 50)) {
    try { const ev = JSON.parse(line); if (ev.type === 'system' && ev.model) return ev.model; } catch { /* keep looking */ }
  }
  return null;
}

const median = (xs) => { const a = [...xs].sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : null; };
const streamClass = (p) => (String(p).split(/[\\/]/).pop() || '').split('_')[0];

// The full account for everything under `root`: every driver stream, deduped, summed.
// A session still running has no result event, so its cost used to read 0 until it ended - and
// with execute stages running inside the package driver (vendor self), one package session is
// most of a Sprint's spend: budget_usd could not see it until it was over. Such a session is now
// ESTIMATED: its token units times the cost-per-unit of this task's own finished sessions of the
// same kind (dispatch_/judge_; measured 5.2-5.7e-6 across dispatch sessions of two runs), marked
// estimated. No finished session yet means no rate, and the running one stays uncounted.
export function collectDriverCosts(root) {
  const paths = findDriverStreams(root).sort();
  const byKey = new Map();
  const running = [];
  const rates = new Map();
  for (const p of paths) {
    const last = lastResultEvent(p);
    if (!last) { running.push(p); continue; }
    if (last.total_cost_usd > 0) {
      const u = usageUnits(p);
      if (u > 0) { const c = streamClass(p); rates.set(c, [...(rates.get(c) || []), last.total_cost_usd / u]); }
    }
    const key = driverKey(root, p);
    const cost = last.total_cost_usd || 0;
    const prev = byKey.get(key);
    if (prev && prev.cost_usd >= cost) continue;
    byKey.set(key, {
      stream: p.startsWith(root) ? p.slice(root.length + 1) : p,
      path: p,
      cost_usd: cost,
      turns: last.num_turns || 0,
      duration_ms: last.duration_ms || 0,
      is_error: !!last.is_error,
    });
  }
  const allRates = [...rates.values()].flat();
  for (const p of running) {
    const key = driverKey(root, p);
    if (byKey.has(key)) continue;
    const calibrated = median(rates.get(streamClass(p)) || []) ?? median(allRates);
    const rate = calibrated ?? FALLBACK_RATES[streamModel(p)] ?? null;
    const units = usageUnits(p);
    if (rate == null || !units) continue;
    byKey.set(key, {
      stream: p.startsWith(root) ? p.slice(root.length + 1) : p,
      path: p, cost_usd: +(units * rate).toFixed(4), turns: 0, duration_ms: 0, is_error: false, estimated: true,
      ...(calibrated == null ? { uncalibrated: true } : {}),
    });
  }
  const sessions = [...byKey.values()];
  const estimated = sessions.filter((x) => x.estimated);
  return {
    ...(estimated.length ? { estimated_usd: +estimated.reduce((a, x) => a + x.cost_usd, 0).toFixed(4), estimated_sessions: estimated.length } : {}),
    sessions: sessions.length,
    cost_usd: +sessions.reduce((a, s) => a + s.cost_usd, 0).toFixed(4),
    turns: sessions.reduce((a, s) => a + s.turns, 0),
    duration_ms: sessions.reduce((a, s) => a + s.duration_ms, 0),
    streams: sessions,
  };
}

// One driver's own cost/turns/duration, read straight from its log path - used for a single
// dispatch node's card rather than a whole-tree total.
export function driverCostOf(logPath) {
  const last = lastResultEvent(logPath);
  if (!last) return null;
  return {
    cost_usd: last.total_cost_usd || 0,
    turns: last.num_turns || 0,
    duration_ms: last.duration_ms || 0,
    is_error: !!last.is_error,
  };
}

// Every child graph run a task opened: each dispatch node's child and a size-S task's s_run,
// as {cwd, run_id}. The broker writes one directory per node attempt under
// <cwd>/.teams_output/broker/<run_id>/<node>/<attempt-uuid>/events.jsonl - the node's OWN
// adapter session (investigate/draft/implement/gate/...), a `claude -p` stream-json like any
// driver's. Pure function of the task object, so taskmanager.mjs and view-collect.mjs (which
// only has task.json) derive the same list.
export function taskRunDirs(task) {
  const out = new Map();
  const add = (c) => { if (c && c.cwd && c.run_id) out.set(`${c.cwd}\0${c.run_id}`, join(c.cwd, '.teams_output', 'broker', String(c.run_id))); };
  for (const n of (task && task.nodes) || []) add(n.child);
  add(task && task.s_run);
  return [...out.values()];
}

// Node adapter sessions under one child run's broker directory, keyed run/node/attempt so a
// directory seen twice (the same worktree reached by two dispatch attempts) counts once.
export function collectNodeCosts(runDirs) {
  const byKey = new Map();
  for (const runDir of runDirs || []) {
    for (const nodeDir of ls(runDir)) {
      if (!nodeDir.isDirectory()) continue;
      for (const att of ls(join(runDir, nodeDir.name))) {
        if (!att.isDirectory()) continue;
        const p = join(runDir, nodeDir.name, att.name, 'events.jsonl');
        const last = lastResultEvent(p);
        if (!last) continue;
        const key = `${runDir.split(/[\\/]/).pop()}/${nodeDir.name}/${att.name}`;
        byKey.set(key, { stream: key, path: p, cost_usd: last.total_cost_usd || 0, turns: last.num_turns || 0, duration_ms: last.duration_ms || 0, is_error: !!last.is_error });
      }
    }
  }
  return [...byKey.values()];
}

// The whole account for a task: its driver sessions (package drivers, the S driver, manager
// judge_ calls) PLUS every node adapter session its child runs spawned. Before this, only the
// first half was counted - code-sprint-S2 (2026-09-26) showed $0.88 against $3.78 actually
// spent, so budget_usd could not stop anything and every bench cost figure was low.
// Same shape as collectDriverCosts, plus drivers_usd / nodes_usd split out.
export function collectTaskCosts(taskDirPath, task) {
  const d = collectDriverCosts(taskDirPath);
  const nodes = collectNodeCosts(taskRunDirs(task));
  const nodesUsd = nodes.reduce((a, s) => a + s.cost_usd, 0);
  return {
    sessions: d.sessions + nodes.length,
    cost_usd: +(d.cost_usd + nodesUsd).toFixed(4),
    turns: d.turns + nodes.reduce((a, s) => a + s.turns, 0),
    duration_ms: d.duration_ms + nodes.reduce((a, s) => a + s.duration_ms, 0),
    drivers_usd: d.cost_usd,
    ...(d.estimated_usd ? { estimated_usd: d.estimated_usd, estimated_sessions: d.estimated_sessions } : {}),
    nodes_usd: +nodesUsd.toFixed(4),
    streams: d.streams,
    node_streams: nodes,
  };
}

// Every <...>/.teams_output/broker/<run_id> directory under a workspace, worktrees included -
// score.mjs's view of the same node sessions, when it has a workspace rather than a task object.
export function findBrokerRunDirs(dir, acc = [], depth = 0) {
  if (depth > 14) return acc;
  for (const e of ls(dir)) {
    if (!e.isDirectory() || e.name === '.git' || e.name === 'node_modules') continue;
    const p = join(dir, e.name);
    if (e.name === 'broker' && dir.endsWith('.teams_output')) {
      for (const r of ls(p)) if (r.isDirectory() && r.name !== 'runs') acc.push(join(p, r.name));
      continue;
    }
    findBrokerRunDirs(p, acc, depth + 1);
  }
  return acc;
}
