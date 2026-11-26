// Driver cost/turn aggregation, split out of score.mjs so view.mjs (a human-readable status
// surface for a running/finished task, teams/scripts/view.mjs) can read the exact same numbers
// instead of growing a second parser that reports something different.
//
// A `claude -p --output-format stream-json` driver stream is a newline-delimited sequence of
// events; only the LAST `result` event carries the session's true totals (`total_cost_usd`,
// `num_turns`, `duration_ms`) - everything before it is a partial view. Reading any other event
// for cost undercounts.
import { closeSync, fstatSync, openSync, readdirSync, readFileSync, readSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';

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

// $/MTok per model family: in, out, cache read, cache write 5m, cache write 1h.
// Source: fitted 2026-11-23 from modelUsage of 615 finished streams, max error 0.
export const PRICES = {
  opus: { in: 4, out: 20, cr: 0.2, cw5: 5, cw1h: 8 },
  sonnet: { in: 2, out: 10, cr: 0.1, cw5: 2.5, cw1h: 4 },
};

// A dated or suffixed id (claude-sonnet-5-5-20261001, claude-opus-5-5[1m]) is priced by its family;
// an unknown claude model takes the Opus prices; anything else has no price.
export function priceOf(model) {
  const m = String(model || '').toLowerCase();
  if (m.includes('sonnet')) return PRICES.sonnet;
  if (m.includes('opus') || m.includes('claude')) return PRICES.opus;
  return null;
}

// usd(msg) = (in*p_in + out*p_out + cache_read*p_cr + cw_5m*p_cw5 + cw_1h*p_cw1h) / 1e6
const usdOf = (u, p) => {
  const cw1h = (u.cache_creation && u.cache_creation.ephemeral_1h_input_tokens) || 0;
  const cw5 = (u.cache_creation && u.cache_creation.ephemeral_5m_input_tokens) ?? Math.max(0, (u.cache_creation_input_tokens || 0) - cw1h);
  return ((u.input_tokens || 0) * p.in + (u.output_tokens || 0) * p.out + (u.cache_read_input_tokens || 0) * p.cr + cw5 * p.cw5 + cw1h * p.cw1h) / 1e6;
};

// One read of a stream: each assistant message.id once, at its last usage reading, with the line
// where it first appeared (a message that started after the last result is in the tail), and the
// result events with their lines. Subagent messages (parent_tool_use_id set) are counted.
function readStream(streamPath) {
  const txt = read(streamPath);
  if (!txt) return null;
  const msgs = new Map();
  const results = [];
  let sysModel = null;
  let n = 0;
  for (const line of txt.split('\n')) {
    if (!line.trim()) continue;
    let ev;
    try { ev = JSON.parse(line); } catch { continue; }
    n += 1;
    if (ev.type === 'system' && ev.model && !sysModel) sysModel = ev.model;
    if (ev.type === 'result') results.push({ ev, at: n });
    if (ev.type === 'assistant' && ev.message && ev.message.id && ev.message.usage) {
      const prev = msgs.get(ev.message.id);
      msgs.set(ev.message.id, { usage: ev.message.usage, model: ev.message.model || sysModel || 'unknown', first: prev ? prev.first : n });
    }
  }
  return { msgs: [...msgs.values()], results, last: results.length ? results[results.length - 1] : null };
}

// Σ usd over messages, per model. `lenient` prices a model with no table price at the Opus prices
// (calibration reads finished streams that way); strict leaves such a model uncounted.
function usdByModel(msgs, lenient) {
  const out = new Map();
  for (const m of msgs) {
    const p = priceOf(m.model) || (lenient ? PRICES.opus : null);
    if (p) out.set(m.model, (out.get(m.model) || 0) + usdOf(m.usage, p));
  }
  return out;
}
const sum = (map) => { let t = 0; for (const v of map.values()) t += v; return t; };

const median = (xs) => { const a = [...xs].sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : null; };
const streamClass = (p) => (String(p).split(/[\\/]/).pop() || '').replace(/\.stream\.jsonl$/, '').split(/[_.]/)[0];

// Medians of exact total_cost_usd / Σ usd(msg) over finished sessions, measured 2026-11-23 on
// finished streams under ~/.harness/tasks: S 1.32 (n=34), dispatch 1.12 (n=404), judge 1.12 (n=144).
// The stream's usage.output_tokens is a partial reading (thinking tokens are not in it), so a
// stream priced at the table prices reads low by about this factor.
const DEFAULT_UPLIFT = { S: 1.32, dispatch: 1.12, judge: 1.12, other: 1.2 };

// The full account for everything under `root`: every driver stream, deduped, summed.
// A finished session (no assistant message after its last result event) reads exactly the
// result's total_cost_usd. Any other session is ESTIMATED, so budget_usd sees it while it runs:
//   no result yet:  sum over messages of usd(msg) * uplift(class)
//   after a result: R.total_cost_usd + sum over the messages after R of usd(msg) * k_model,
//                   k_model = R.modelUsage[model].costUSD / sum of usd(msg) up to R (else uplift(class))
// uplift(class) = median of this task's finished sessions of the same class, else of all classes,
// else DEFAULT_UPLIFT. On the recorded S stream (teams/scripts/fixtures/s-stream-two-models.jsonl)
// the estimate is within 5% of the next exact total; that bar is shown on that stream only (the
// default S uplift is a median that includes it).
export function collectDriverCosts(root) {
  const paths = findDriverStreams(root).sort();
  const byKey = new Map();
  const running = [];
  const uplifts = new Map();
  for (const p of paths) {
    const s = readStream(p);
    const last = s && s.last;
    if (!last || s.msgs.some((m) => m.first > last.at)) { running.push({ p, s }); continue; }
    const usd = sum(usdByModel(s.msgs, true));
    if (last.ev.total_cost_usd > 0 && usd > 0) { const c = streamClass(p); uplifts.set(c, [...(uplifts.get(c) || []), last.ev.total_cost_usd / usd]); }
    const key = driverKey(root, p);
    const cost = last.ev.total_cost_usd || 0;
    const prev = byKey.get(key);
    if (prev && prev.cost_usd >= cost) continue;
    byKey.set(key, {
      stream: p.startsWith(root) ? p.slice(root.length + 1) : p,
      path: p,
      cost_usd: cost,
      turns: last.ev.num_turns || 0,
      duration_ms: last.ev.duration_ms || 0,
      is_error: !!last.ev.is_error,
    });
  }
  const allUplifts = [...uplifts.values()].flat();
  for (const { p, s } of running) {
    const key = driverKey(root, p);
    if (!s || byKey.has(key)) continue;
    const cls = streamClass(p);
    const measured = median(uplifts.get(cls) || []) ?? median(allUplifts);
    const uplift = measured ?? DEFAULT_UPLIFT[cls] ?? DEFAULT_UPLIFT.other;
    const lenient = measured != null;
    let base = 0;
    const r = s.last && s.last.ev;
    if (r) {
      base = r.total_cost_usd || 0;
      const upTo = usdByModel(s.msgs.filter((m) => m.first < s.last.at), lenient);
      const tail = s.msgs.filter((m) => m.first > s.last.at);
      const tailBy = usdByModel(tail, lenient);
      let usd = 0;
      for (const [model, v] of tailBy) {
        const exact = r.modelUsage && r.modelUsage[model] && r.modelUsage[model].costUSD;
        const k = exact > 0 && upTo.get(model) > 0 ? exact / upTo.get(model) : uplift;
        usd += v * k;
      }
      base += usd;
    } else {
      base = sum(usdByModel(s.msgs, lenient)) * uplift;
    }
    if (!(base > 0)) continue;
    byKey.set(key, {
      stream: p.startsWith(root) ? p.slice(root.length + 1) : p,
      path: p, cost_usd: +base.toFixed(4), turns: r ? r.num_turns || 0 : 0, duration_ms: r ? r.duration_ms || 0 : 0, is_error: false, estimated: true,
      ...(measured == null ? { uncalibrated: true } : {}),
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

// Spend per kind of session from a collectTaskCosts result (runlog's summary.cost_by_kind, the
// ledger's cost_recorded.by_stage).
export function costByStage(costs) {
  const byKind = {};
  for (const s of (costs && costs.streams) || []) {
    // A respawned driver (<name>.restart1) or a re-judge (<name>.r1) is the same kind of spend
    // as its first session - portfolio-consolidate-8518d5dd bucketed them apart, one per run name.
    // Cards carry their area (dispatch_PLAN-F2, judge_accept_QA-F1, judge_plan-integrate): one
    // bucket per phase and per judging stage, not one per card (m6).
    const k = basename(String(s.stream || s.path || '')).replace(/\.stream\.jsonl$/, '').replace(/\.(restart|r)\d+$/, '').replace(/_\d+$/, '').replace(/^judge_(\w+?)(_P\w+|\.r\d+)?$/, 'judge_$1').replace(/^judge_([a-z][a-z-]*)_[A-Z][\w-]*$/, 'judge_$1').replace(/^dispatch_(PLAN|AUDIT|QA)(-F\d+)?$/, 'dispatch_$1').replace(/^dispatch_P\d+\w*$/, 'dispatch_package');
    byKind[k] = +((byKind[k] || 0) + (s.cost_usd || 0)).toFixed(4);
  }
  // collectTaskCosts splits its total into driver streams (above, the manager's own
  // dispatch_/judge_ sessions) and node_streams (each child graph run's own draft/review/gate/
  // plan/setgoal/critique adapter session, broker/<run_id>/<node>/<attempt>/events.jsonl). Both
  // halves feed cost_usd (drivers_usd + nodes_usd), so leaving node_streams out here means
  // byKind silently undercounts cost_usd by exactly nodes_usd - the archive summary then reads
  // as if a run cost far less than task.budget_stopped/enforceBudget (which reads cost_usd
  // in full via taskSpend) ever saw. Bucketed by stage (attempt/subgoal suffix stripped) and
  // prefixed node_ so a node session's cost is never mistaken for its manager-level counterpart
  // (e.g. node_review vs a package's own dispatch_package).
  for (const s of (costs && costs.node_streams) || []) {
    const nodeDir = String(s.stream || s.path || '').split(/[\\/]/)[1] || '';
    const stage = nodeDir.replace(/_U\d+(_\d+)?$/, '').replace(/_\d+$/, '') || 'node';
    const k = `node_${stage}`;
    byKind[k] = +((byKind[k] || 0) + (s.cost_usd || 0)).toFixed(4);
  }
  return byKind;
}

// The latest durable `cost_recorded` event of a ledger (an array of parsed events), or null.
export function latestCostEvent(events) {
  let last = null;
  for (const e of events || []) if (e && e.event === 'cost_recorded' && Number.isFinite(e.spend)) last = e;
  return last;
}

// THE spend figure - taskSpend, budgetStatus.spend, the pane and the ledger events all read it.
// The live total (collectTaskCosts), except when the latest durable event is exact and larger
// (the sessions it priced are gone with their worktrees): then that event's spend. An
// estimated durable event never raises it. Pure: `live` is a collectTaskCosts result.
export function spendFigure(live, durable) {
  const liveUsd = live.cost_usd;
  if (durable && !durable.estimated && durable.spend > liveUsd) return { spend: durable.spend, estimated: false, from: 'durable' };
  return { spend: liveUsd, estimated: !!(live.estimated_sessions > 0), from: 'live' };
}

// The ledger's latest cost_recorded, read incrementally: a budgeted task asks every daemon tick.
// Per path, `offset` is the end of the last complete line read, so only bytes appended since are
// read and a torn trailing line waits for its newline. A shrunk or replaced (dev/ino) file, or one
// rewritten at the same size (mtime), is read again from the start. The ledger is append-only: a
// rewrite in place to a LARGER size is not detected.
const ledgerCache = new Map();

function readFrom(path, offset) {
  const fd = openSync(path, 'r');
  try {
    const buf = Buffer.alloc(Math.max(0, fstatSync(fd).size - offset));
    let got = 0;
    for (let n = 1; n > 0 && got < buf.length; got += n) n = readSync(fd, buf, got, buf.length - got, offset + got);
    return buf.subarray(0, got);
  } finally { closeSync(fd); }
}

function latestLedgerCost(path) {
  try {
    const st = statSync(path);
    let c = ledgerCache.get(path);
    if (!c || c.dev !== st.dev || c.ino !== st.ino || st.size < c.size || (st.size === c.size && st.mtimeMs !== c.mtimeMs)) c = { offset: 0, size: 0, latest: null };
    else if (st.size === c.size) return c.latest;
    const buf = readFrom(path, c.offset);
    const end = buf.lastIndexOf(10) + 1;
    const events = [c.latest];
    for (const line of buf.toString('utf8', 0, end).split('\n')) {
      if (!line.includes('cost_recorded')) continue;
      try { events.push(JSON.parse(line)); } catch { /* skip a torn line */ }
    }
    const latest = latestCostEvent(events);
    ledgerCache.set(path, { dev: st.dev, ino: st.ino, size: st.size, mtimeMs: st.mtimeMs, offset: c.offset + end, latest });
    return latest;
  } catch {
    ledgerCache.delete(path);
    return null;
  }
}

// The same, read from a task directory: live costs plus the ledger's latest cost_recorded.
export function taskFigure(taskDirPath, task) {
  const live = collectTaskCosts(taskDirPath, task);
  return { ...spendFigure(live, latestLedgerCost(join(taskDirPath, 'ledger.jsonl'))), live };
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
