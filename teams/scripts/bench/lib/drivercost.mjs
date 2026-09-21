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

// The full account for everything under `root`: every driver stream, deduped, summed.
export function collectDriverCosts(root) {
  const paths = findDriverStreams(root).sort();
  const byKey = new Map();
  for (const p of paths) {
    const last = lastResultEvent(p);
    if (!last) continue;
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
  const sessions = [...byKey.values()];
  return {
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
