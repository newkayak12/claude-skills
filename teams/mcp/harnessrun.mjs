// A size-S task runs on the development harness (_repo/docs/plans/2026-09-28-teams-long-loop.md S1/S1a).
// Its driver session writes one thing: a pointer to the harness run it opened
// (<taskDir>/harness-run.json). A pointer is a claim, not a fact - it is taken only when the run
// it names carries this task's tag ([teams-task <id>] on the graph request, teams_task in the
// fallback manifest) and was created after the harness run opened; with none, the tagged run is
// found on disk. The verdict is never the driver's word either: it is read here from the run
// itself - the graph run file's goal gate and report, or the fallback run's own
// 04-goal-gate.json and 05-report.md. Pure readers over JSON; teams never imports graph/mcp.
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, isAbsolute } from 'node:path';

const SKEW_MS = 60 * 1000;

export const taskTag = (taskId) => `[teams-task ${taskId}]`;

function readJson(p) {
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}

// The graph plugin's own run file (graph/mcp/graph.mjs runsDir).
export function graphRunPath(cwd, runId) {
  return join(cwd, '.harness-run', 'broker', 'runs', `${runId}.json`);
}

// The pointer the driver wrote, shape-checked; null while it has not written one.
// {route: 'graph', run_id, cwd} | {route: 'fallback', run_dir}
export function readPointer(pointerPath, baseCwd) {
  const p = readJson(pointerPath);
  if (p && p.route === 'graph' && typeof p.run_id === 'string' && p.run_id.trim() && !/[\\/]/.test(p.run_id)) {
    const cwd = typeof p.cwd === 'string' && p.cwd.trim() ? p.cwd.trim() : baseCwd;
    return { route: 'graph', run_id: p.run_id.trim(), cwd: isAbsolute(cwd) ? cwd : resolve(baseCwd || '.', cwd) };
  }
  if (p && p.route === 'fallback' && typeof p.run_dir === 'string' && p.run_dir.trim()) {
    const d = p.run_dir.trim();
    return { route: 'fallback', run_dir: isAbsolute(d) ? d : resolve(baseCwd || '.', d) };
  }
  return null;
}

// Whether the run a pointer names is this task's: tagged with its id, created after openedAt.
export function ownsRun(pointer, taskId, openedAt) {
  if (!pointer) return false;
  const after = (t) => Number.isFinite(t) && t >= (Number(openedAt) || 0) - SKEW_MS;
  if (pointer.route === 'graph') {
    const run = readJson(graphRunPath(pointer.cwd, pointer.run_id));
    return !!(run && String(run.request || '').includes(taskTag(taskId)) && after(Number(run.created_at)));
  }
  const manifest = join(pointer.run_dir, 'manifest.json');
  const m = readJson(manifest);
  if (!m || m.teams_task !== taskId) return false;
  try { return after(statSync(manifest).mtimeMs); } catch { return false; }
}

// The newest run under cwd tagged with this task and created after openedAt, on either route.
export function findTaggedRun(cwd, taskId, openedAt) {
  const found = [];
  const runs = join(cwd, '.harness-run', 'broker', 'runs');
  let names = [];
  try { names = readdirSync(runs).filter((f) => f.endsWith('.json')); } catch { /* no graph runs */ }
  for (const f of names) {
    const p = { route: 'graph', run_id: f.slice(0, -5), cwd };
    if (ownsRun(p, taskId, openedAt)) found.push({ p, at: Number((readJson(join(runs, f)) || {}).created_at) || 0 });
  }
  let slugs = [];
  try { slugs = readdirSync(join(cwd, '.harness-run')).filter((s) => s !== 'broker'); } catch { /* none */ }
  for (const s of slugs) {
    const p = { route: 'fallback', run_dir: join(cwd, '.harness-run', s) };
    if (!ownsRun(p, taskId, openedAt)) continue;
    let at = 0;
    try { at = statSync(join(p.run_dir, 'manifest.json')).mtimeMs; } catch { /* raced */ }
    found.push({ p, at });
  }
  found.sort((a, b) => b.at - a.at);
  return found.length ? found[0].p : null;
}

// What the harness run itself says: {readable, finished, accept, match_pct, gaps, report_text}.
// finished = its report stage wrote a report; accept = its latest goal gate passed.
export function harnessVerdict(pointer) {
  if (!pointer) return null;
  if (pointer.route === 'graph') {
    const run = readJson(graphRunPath(pointer.cwd, pointer.run_id));
    if (!run) return { readable: false, finished: false, accept: false };
    const nodes = Array.isArray(run.nodes) ? run.nodes : [];
    const report = nodes.filter((n) => n && n.stage === 'report' && n.state === 'done').pop();
    const goals = nodes.filter((n) => n && String(n.node_id).startsWith('gate:goal') && n.state !== 'skipped' && n.result);
    const last = goals[goals.length - 1];
    const r = (last && last.result) || {};
    return {
      readable: true,
      finished: !!report,
      accept: !!(last && last.state === 'done' && r.accept === true),
      match_pct: r.match_pct != null ? r.match_pct : null,
      gaps: Array.isArray(r.gaps) ? r.gaps.map(String) : [],
      report_text: report && report.result ? String(report.result.handoff || report.result.summary || '') : '',
    };
  }
  const dir = pointer.run_dir;
  if (!existsSync(dir)) return { readable: false, finished: false, accept: false };
  const gate = readJson(join(dir, '04-goal-gate.json'));
  const reportPath = join(dir, '05-report.md');
  const finished = existsSync(reportPath);
  let text = '';
  if (finished) { try { text = readFileSync(reportPath, 'utf8'); } catch { /* raced */ } }
  return {
    readable: true,
    finished,
    accept: !!(gate && gate.pass === true),
    match_pct: gate && gate.match_pct != null ? gate.match_pct : null,
    gaps: gate && gate.reason ? [String(gate.reason)] : [],
    report_text: text,
  };
}
