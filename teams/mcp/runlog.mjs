// Every teams task leaves a record once it ends: the daemon calls harvestTask at daemon_done, and
// scripts/bench/harvest.mjs calls the same thing for a bench workspace (adding its score). The
// record outlives /tmp and the project's own .teams_output:
//
//   <root>/<label>/summary.json  - version run, state, cost by stream kind, and every failed or
//                                  refused node as a classified record (scripts/bench/triage.mjs
//                                  groups them across runs)
//   <root>/<label>/{task.json, ledger.jsonl, briefings/, docs/, runs/, nodes/, drivers/}
//   <root>/index.jsonl           - one line per harvest
//
// root: TEAMS_RUNS_DIR, else ~/.local/share/teams-runs. TEAMS_RUNS_DIR=off turns it off.
// Driver streams are summarized, not copied (tens of MB).

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, copyFileSync, appendFileSync, cpSync } from 'node:fs';
import { join, basename, resolve } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { collectTaskCosts } from '../scripts/bench/lib/drivercost.mjs';
import { teamsPluginRoot } from './pluginroots.mjs';

const PLUGIN = teamsPluginRoot();

export function runsRoot() {
  const env = process.env.TEAMS_RUNS_DIR;
  if (env === 'off') return null;
  return env || join(homedir(), '.local', 'share', 'teams-runs');
}

const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const readText = (p) => { try { return readFileSync(p, 'utf8'); } catch { return ''; } };
const dirs = (p) => { try { return readdirSync(p).filter((x) => statSync(join(p, x)).isDirectory()); } catch { return []; } };
const files = (p) => { try { return readdirSync(p).filter((x) => statSync(join(p, x)).isFile()); } catch { return []; } };

// One comparable shape for a message: paths, numbers, ids and quoted values collapsed, so the
// same defect in two runs groups together.
export function signature(text) {
  return String(text || '')
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, '<id>')
    .replace(/(?:\b[\w.@-]+)?(?:\/[\w.@*-]+)+\/?/g, '<path>')
    .replace(/"[^"]{1,80}"|'[^']{1,80}'|`[^`]{1,80}`/g, '<q>')
    .replace(/\d+(\.\d+)?/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 110);
}

// Every node that did not end well, as a record triage can count. Kinds, most specific first.
export function classify(n, where) {
  const r = n.result || {};
  const base = { ...where, node_id: n.node_id, stage: n.stage, executor: n.executor || n.vendor || null, state: n.state };
  if (r.judge_failed) return { ...base, kind: 'judge-failed', message: r.reason || '' };
  if (r.verification_error) return { ...base, kind: 'cross-check', message: r.verification_error };
  if (/adapter exit/.test(r.reason || '')) return { ...base, kind: 'adapter-exit', message: r.reason };
  if ((n.stage === 'gate' || n.stage === 'accept') && r.accept === false) {
    return { ...base, kind: 'rejection', message: (r.gaps || [])[0] || r.reason || '', match_pct: r.match_pct ?? null };
  }
  if (n.stage === 'integrate' && r.verified === false) return { ...base, kind: 'integrate-refused', message: (r.gaps || [])[0] || r.reason || '' };
  if (n.stage === 'critique' && r.sound === false) return { ...base, kind: 'critique-blocked', message: (r.blocking || [])[0] || r.reason || '' };
  return { ...base, kind: 'failed', message: r.reason || '' };
}

function trimResult(res) {
  if (!res || typeof res !== 'object') return res;
  const out = { ...res };
  for (const k of ['stdout', 'stderr']) if (typeof out[k] === 'string' && out[k].length > 2000) out[k] = `...${out[k].slice(-2000)}`;
  return out;
}

export function harvestTask({ taskDir, cwd, label, root, scorePrefix } = {}) {
  const taskId = taskDir ? basename(taskDir) : null;
  const ws = cwd ? resolve(cwd) : null;
  label = label || `${ws ? basename(ws) : 'task'}-${String(taskId || 'none').slice(0, 8)}`;
  root = root || runsRoot();
  if (!root) return null; // TEAMS_RUNS_DIR=off
  const out = join(root, label);
  mkdirSync(out, { recursive: true });

  const task = taskDir ? readJson(join(taskDir, 'task.json')) : null;
  const ledger = taskDir ? readText(join(taskDir, 'ledger.jsonl')) : '';
  const events = ledger.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  if (taskDir) {
    for (const f of ['task.json', 'ledger.jsonl', 'board.jsonl']) if (existsSync(join(taskDir, f))) copyFileSync(join(taskDir, f), join(out, f));
    if (existsSync(join(taskDir, 'briefings'))) cpSync(join(taskDir, 'briefings'), join(out, 'briefings'), { recursive: true });
    mkdirSync(join(out, 'drivers'), { recursive: true });
    for (const f of files(join(taskDir, 'drivers'))) if (/\.(exit\.json|stderr\.txt)$/.test(f)) copyFileSync(join(taskDir, 'drivers', f), join(out, 'drivers', f));
  }
  const docs = ws ? join(ws, '.teams_output', 'team', `E-${String(taskId || '').slice(0, 8)}`) : null;
  if (docs && existsSync(docs)) cpSync(docs, join(out, 'docs'), { recursive: true });
  if (scorePrefix) {
    for (const suffix of ['score.txt', 'start.txt']) {
      for (const p of [`${scorePrefix}.${suffix}`, `${scorePrefix}.next.${suffix}`]) if (existsSync(p)) copyFileSync(p, join(out, basename(p).replace(basename(scorePrefix), 'bench')));
    }
  }

  // Child runs: the project root's (planning) and every package worktree's.
  const failures = [];
  const runRoots = [...(ws ? [['root', ws]] : []), ...(taskDir ? dirs(join(taskDir, 'worktrees')).map((w) => [w, join(taskDir, 'worktrees', w)]) : [])];
  let childRuns = 0;
  for (const [pkg, cwd] of runRoots) {
    const broker = join(cwd, '.teams_output', 'broker');
    for (const f of files(join(broker, 'runs')).filter((x) => x.endsWith('.json'))) {
      const run = readJson(join(broker, 'runs', f));
      if (!run) continue;
      childRuns++;
      mkdirSync(join(out, 'runs', pkg), { recursive: true });
      copyFileSync(join(broker, 'runs', f), join(out, 'runs', pkg, f));
      for (const n of run.nodes || []) {
        if (n.state === 'failed' || (n.result && (n.result.accept === false || n.result.verified === false))) failures.push(classify(n, { level: 'child', package: pkg, run_id: run.run_id }));
        // Accepted, but the request asked for something the spec dropped: not a failure of the
        // node, and exactly what slack-list shipped without anyone noticing until the diff was read.
        else if (String(n.node_id).startsWith('gate:goal') && n.result && n.result.accept === true && (n.result.spec_drift || []).length) {
          failures.push({ level: 'child', package: pkg, run_id: run.run_id, node_id: n.node_id, stage: n.stage, executor: n.executor || null, state: n.state, kind: 'drift-accepted', message: n.result.spec_drift[0] });
        }
      }
      // Each node attempt's adapter result, tails only.
      for (const nodeDir of dirs(join(broker, run.run_id))) {
        for (const attempt of dirs(join(broker, run.run_id, nodeDir))) {
          const res = readJson(join(broker, run.run_id, nodeDir, attempt, 'result.json'));
          if (!res) continue;
          mkdirSync(join(out, 'nodes', pkg, run.run_id), { recursive: true });
          writeFileSync(join(out, 'nodes', pkg, run.run_id, `${nodeDir}.${attempt.slice(0, 8)}.json`), JSON.stringify(trimResult(res), null, 2));
        }
      }
    }
  }
  for (const n of (task && task.nodes) || []) {
    const r = n.result || {};
    if (n.state === 'failed' || r.accept === false || r.verified === false || r.sound === false || r.judge_failed) failures.push(classify(n, { level: 'manager' }));
  }

  let costs = null;
  try { costs = taskDir ? collectTaskCosts(taskDir, task) : null; } catch { costs = null; }
  const byKind = {};
  for (const s of (costs && costs.streams) || []) {
    const k = basename(String(s.stream || s.path || '')).replace(/\.stream\.jsonl$/, '').replace(/_\d+$/, '').replace(/^judge_(\w+?)(_P\w+|\.r\d+)?$/, 'judge_$1').replace(/^dispatch_(PLAN|AUDIT|QA)$/, 'dispatch_$1').replace(/^dispatch_P\d+\w*$/, 'dispatch_package');
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
  const score = readText(join(out, 'bench.score.txt')).split('\n').find((l) => / \| \d+\/\d+ \| /.test(l)) || null;
  // The code the run ran, not the code at harvest time: the last commit before the task opened.
  const opened = (events.find((e) => e.event === 'tm_open') || {}).ts;
  const git = opened
    ? spawnSync('git', ['log', '-1', `--before=${new Date(opened).toISOString()}`, '--format=%h'], { cwd: PLUGIN, encoding: 'utf8' })
    : spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: PLUGIN, encoding: 'utf8' });
  const commit = git.status === 0 ? git.stdout.trim() : null;
  const pluginAt = commit ? spawnSync('git', ['show', `${commit}:./.claude-plugin/plugin.json`], { cwd: PLUGIN, encoding: 'utf8' }) : null;
  const versionAt = pluginAt && pluginAt.status === 0 ? (() => { try { return JSON.parse(pluginAt.stdout).version; } catch { return null; } })() : null;
  const summary = {
    label, harvested_at: new Date().toISOString(), workspace: ws, task_id: taskId, source: scorePrefix ? 'bench' : 'run',
    teams_version: versionAt || (readJson(join(PLUGIN, '.claude-plugin', 'plugin.json')) || {}).version || null,
    repo_commit: commit,
    score,
    state: task ? (events.filter((e) => e.event === 'daemon_done').pop() || {}).state || 'unfinished' : 'no-task',
    size: task && task.size, packages: ((task && task.spec && task.spec.packages) || []).map((p) => p.id),
    // enforceBudget never kills a dispatch already running when the box trips, and a stopped
    // task still owes its goal gate and report (closeStoppedToReport) - both by design, so spend
    // does not freeze at task.budget_stopped.spend. post_stop_usd is that gap made visible: the
    // in-flight package finishing plus the mandatory closing stages, on top of what had already
    // been spent at the moment the box tripped. Not a second box - nothing here stops anything -
    // just the number an operator sizing budget_usd should hold in reserve above their real target.
    budget: task && task.team && task.team.opts ? {
      budget_usd: task.team.opts.budget_usd ?? null, timebox_minutes: task.team.opts.timebox_minutes ?? null, stopped: !!task.budget_stopped,
      ...(task.budget_stopped && costs ? { post_stop_usd: +Math.max(0, (costs.cost_usd || 0) - (task.budget_stopped.spend || 0)).toFixed(4) } : {}),
    } : null,
    cost_usd: costs ? +(costs.cost_usd || 0).toFixed(4) : null, cost_by_kind: byKind,
    child_runs: childRuns,
    retries: events.filter((e) => e.event === 'daemon_retry_opened').length,
    rejudges: events.filter((e) => e.event === 'daemon_rejudge').length,
    events: Object.fromEntries(Object.entries(events.reduce((m, e) => ((m[e.event] = (m[e.event] || 0) + 1), m), {})).filter(([k]) => /budget|capacity|rejudge|retry|audit|diagram|closed|rewired|stalled|killed|restart/.test(k))),
    failures: failures.map((f) => ({ ...f, message: String(f.message || '').slice(0, 400), signature: signature(f.message) })),
  };
  writeFileSync(join(out, 'summary.json'), JSON.stringify(summary, null, 2));
  mkdirSync(root, { recursive: true });
  appendFileSync(join(root, 'index.jsonl'), JSON.stringify({ label, harvested_at: summary.harvested_at, teams_version: summary.teams_version, score: summary.score, state: summary.state, cost_usd: summary.cost_usd, failures: summary.failures.length, dir: out }) + '\n');
  return { out, summary };
}

