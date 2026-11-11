// The reads behind the floor part of `view.mjs --once --format summary`: which tasks of a cwd are
// listed, and the file facts view-floor.mjs turns into items and workers (a card's current action
// from its stream, its cost, the graph run file it can open). Read-only; every read fails soft.
import { existsSync, readFileSync, readdirSync, statSync, realpathSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { readLogTail, renderStreamLine } from '../../mcp/tasklog.mjs';
import { graphRunPath } from '../../mcp/harnessrun.mjs';
import { epicTicketState } from '../../mcp/tickets.mjs';
import { findDriverStreams, collectDriverCosts, collectNodeCosts } from '../bench/lib/drivercost.mjs';
import { collectTask, driverLive, stallMsOf, minutesSince } from './view-collect.mjs';
import { summarize, cardsOf, waitingCount } from './view-summary.mjs';
import { floorOf } from './view-floor.mjs';
import { repoMatcher } from './view-repo.mjs';
import { openTasks, statSig } from './view-index.mjs';

export const DAY_MS = 24 * 60 * 60 * 1000;
// A judge has no pid: its newest stream says it is working while it was written this recently.
export const JUDGE_FRESH_MS = 2 * 60 * 1000;
const OPEN = new Set(['READY', 'IN_PROGRESS', 'IN_REVIEW']);
const DOING_MAX = 120;

const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const mtimeOf = (p) => { try { return statSync(p).mtimeMs; } catch { return null; } };
const ls = (p) => { try { return readdirSync(p, { withFileTypes: true }); } catch { return []; } };

// Same directory through different paths (/var -> /private/var, any symlink) must match; a path
// that no longer exists falls back to resolve().
export function samePath(p) {
  try { return realpathSync(p); } catch { return resolve(p); }
}

// ---------- cost, cached by file mtime ----------
const cache = new Map();
const stats = { hits: 0, misses: 0 };
export const cacheStats = () => ({ ...stats });

// `over` (the state server) replaces the file-stat signature: the caller's own key for when the value is
// rebuilt (its task.json|ledger.jsonl signature), so a stream that grows between two changes of those is
// not read in full again on every call.
function memo(key, files, compute, over) {
  const sig = over ?? files.map((f) => { try { const s = statSync(f); return `${f}:${s.mtimeMs}:${s.size}`; } catch { return `${f}:gone`; } }).join('|');
  const hit = cache.get(key);
  if (hit && hit.sig === sig) { stats.hits += 1; return hit.value; }
  stats.misses += 1;
  const value = compute();
  cache.set(key, { sig, value });
  return value;
}

const taskCosts = (taskDir, over) => memo(`d:${taskDir}`, over ? [] : findDriverStreams(taskDir).sort(), () => collectDriverCosts(taskDir), over);

function nodeSessions(runDir, over) {
  const files = [];
  if (!over) for (const nd of ls(runDir)) if (nd.isDirectory()) for (const at of ls(join(runDir, nd.name))) if (at.isDirectory()) files.push(join(runDir, nd.name, at.name, 'events.jsonl'));
  return memo(`n:${runDir}`, files, () => collectNodeCosts([runDir]), over);
}

// What a file's tail parses to, kept while its mtime and size are unchanged (the state server only: a
// stream's last lines are read again only when the stream grew).
const tails = new Map();
function byStat(kind, path, compute) {
  const key = `${kind}:${path}`;
  const sig = statSig(path);
  const hit = tails.get(key);
  if (hit && hit.sig === sig) { hit.seen = Date.now(); return hit.value; }
  const value = compute();
  tails.set(key, { sig, value, seen: Date.now() });
  return value;
}

// Drops tail memos not used for maxAgeMs (called by the state server next to its task-cache forget).
export function pruneTails(maxAgeMs) {
  const t = Date.now();
  for (const [k, e] of tails) if (t - e.seen > maxAgeMs) tails.delete(k);
}

// A driver stream's desk: the file name without restart and attempt suffixes, so every attempt and
// restart of one card's driver joins it (drivers/dispatch_P1_2.restart1.stream.jsonl -> dispatch_P1).
const group = (name) => name.replace(/(\.restart\d+)?\.stream\.jsonl$/, '').replace(/_\d+$/, '');

// { cost_usd, cost_estimated } for the desk whose driver wrote `log`, plus the node sessions of its
// child run; cost_usd null when no stream of it has a reading.
function storyCost(taskDir, log, childRunDir, over) {
  const g = log ? group(basename(log)) : null;
  const streams = g ? taskCosts(taskDir, over).streams.filter((s) => group(basename(s.path)) === g) : [];
  const nodes = childRunDir ? nodeSessions(childRunDir, over) : [];
  if (!streams.length && !nodes.length) return { cost_usd: null, cost_estimated: false };
  const usd = streams.reduce((a, s) => a + s.cost_usd, 0) + nodes.reduce((a, s) => a + s.cost_usd, 0);
  return { cost_usd: +usd.toFixed(4), cost_estimated: streams.some((s) => s.estimated) };
}

// ---------- doing: the tail of a stream, parsed here ----------
function doingOf(log) {
  if (!log) return '';
  const { lines, missing } = readLogTail(log, 8);
  if (missing || !lines.length) return '';
  const text = lines.map(renderStreamLine).filter(Boolean);
  const pick = [...text].reverse().find((l) => l.startsWith('assistant')) || text[text.length - 1] || '';
  const t = pick.replace(/^assistant\s*/, '');
  return t.length > DOING_MAX ? t.slice(0, DOING_MAX - 1) + '…' : t;
}

const runFile = (cwd, runId) => {
  if (!cwd || !runId) return null;
  const p = join(cwd, '.teams_output', 'broker', 'runs', `${runId}.json`);
  return existsSync(p) ? p : null;
};

// The facts floorOf takes, for one collected task model.
// `raw` (the task.json already parsed) and `sig` (the task's task.json|ledger.jsonl signature) come from the
// state server: with them nothing is parsed from task.json again, costs are rebuilt only when `sig`
// changes, and a stream or the ledger is read for its tail only when its own mtime or size changed.
export function floorFacts(m, tasksDir, taskId, { now = Date.now(), raw: given, sig } = {}) {
  const dir = join(tasksDir, taskId);
  const raw = given || readJson(join(dir, 'task.json')) || {};
  const limit = stallMsOf(raw);
  const doing = sig ?(log) => byStat('doing', log, () => doingOf(log)) : doingOf;
  const stories = {};
  const desk = (id, driver, childCwd, childRunId, file) => {
    const log = driver && driver.log;
    const live = !!driver && driverLive({ ...driver, log }, now, limit);
    // a worker whose own stream went silent past the threshold: whole minutes since it was last written
    const at = log ? mtimeOf(log) : null;
    const silent = !live && at != null && now - at > limit;
    stories[id] = {
      live, doing: live ? doing(log) : '', run_file: file,
      ...(silent ? { silent: true, minutes: minutesSince(now, at) } : {}),
      ...storyCost(dir, log, childCwd && childRunId ? join(childCwd, '.teams_output', 'broker', String(childRunId)) : null, sig),
    };
  };
  if (m.s_run || m.harness) {
    const h = m.harness;
    const driver = (h && h.driver) || (m.s_run && m.s_run.driver) || null;
    const withLog = driver ? { ...driver, log: driver.log || join(dir, 'drivers', 'S.stream.jsonl') } : null;
    const g = h && h.graph;
    const legacy = raw.s_run ? runFile(raw.s_run.cwd || m.cwd, raw.s_run.run_id) : null;
    // the graph route's own run file wins over the legacy s_run file
    const file = (g && existsSync(graphRunPath(g.cwd, g.run_id)) ? graphRunPath(g.cwd, g.run_id) : null) || legacy;
    desk('S', withLog, raw.s_run && (raw.s_run.cwd || m.cwd), raw.s_run && raw.s_run.run_id, file);
  } else {
    for (const { c } of cardsOf(m)) {
      const ch = c.child;
      desk(String(c.id), ch && ch.driver, ch && ch.cwd, ch && ch.run_id, ch ? runFile(ch.cwd, ch.run_id) : null);
    }
  }
  let judge = { live: false, doing: '' };
  const judgeLogs = ls(join(dir, 'drivers')).filter((e) => e.name.startsWith('judge_') && e.name.endsWith('.stream.jsonl'))
    .map((e) => join(dir, 'drivers', e.name)).map((p) => ({ p, t: mtimeOf(p) || 0 })).sort((a, b) => b.t - a.t);
  if (judgeLogs.length && now - judgeLogs[0].t <= JUDGE_FRESH_MS) judge = { live: true, doing: doing(judgeLogs[0].p) };
  const ledgerPath = join(dir, 'ledger.jsonl');
  return { stories, judge, ledger: sig ? byStat('ledger', ledgerPath, () => readLogTail(ledgerPath, 500).lines) : readLogTail(ledgerPath, 500).lines };
}

// A cheap read, for a task past 24 h, of whether a card still waits on a person: task.json's own nodes,
// then the run files its package children, S run or graph-route harness run point at.
function parkedOnPerson(raw) {
  const waits = (run) => !!run && Array.isArray(run.nodes) && run.nodes.some((n) => n && n.state === 'waiting_human');
  const nodes = Array.isArray(raw.nodes) ? raw.nodes : [];
  if (waits(raw)) return true;
  for (const n of nodes) {
    const ch = n && n.child;
    if (ch && ch.cwd && ch.run_id && waits(readJson(join(ch.cwd, '.teams_output', 'broker', 'runs', `${ch.run_id}.json`)))) return true;
  }
  const s = raw.s_run;
  if (s && s.cwd && s.run_id && waits(readJson(join(s.cwd, '.teams_output', 'broker', 'runs', `${s.run_id}.json`)))) return true;
  const g = raw.harness_run && raw.harness_run.run;
  return !!(g && g.route === 'graph' && waits(readJson(graphRunPath(g.cwd, g.run_id))));
}

// parkedOnPerson reads run files; for the same parsed task.json (a long-lived reader hands the same
// object back while the file is unchanged) the answer is kept for a minute.
const PARKED_TTL_MS = 60 * 1000;
const parked = new WeakMap();
function parkedMemo(raw, now) {
  const hit = parked.get(raw);
  if (hit && now - hit.at < PARKED_TTL_MS) return hit.value;
  const value = parkedOnPerson(raw);
  parked.set(raw, { at: now, value });
  return value;
}

// The tasks of `cwd`'s repo (its main checkout and linked worktrees, see view-repo.mjs) the pane lists: open ones (READY/IN_PROGRESS/IN_REVIEW) with a sign of life in the
// last 24 h, prefiltered from task.json alone before `collect` (collectTask) runs. A task waiting on a
// person is live, never stalled, and stays listed past 24 h (a manager card is read from task.json).
// Live first, then stalled, each newest created first. [{ m, live, age_ms }]
// `opener` (a session id) keeps only tasks whose raw task.json names it as opener, checked before `collect`,
// and ignores `cwd`: the asks of one session span every project.
export function floorTasks({ tasksDir, cwd, opener, now = Date.now(), collect = collectTask, open = openTasks }) {
  const repo = cwd && !opener ? repoMatcher(cwd) : null;
  const picked = [];
  for (const { id: name, raw } of open(tasksDir)) {
    if (!raw || typeof raw !== 'object') continue;
    if (repo && !raw.cwd) continue;
    if (opener && !(raw.opener && raw.opener.session_id === opener)) continue;
    try { if (!OPEN.has(epicTicketState(raw))) continue; } catch { continue; }
    const marks = [Number(raw.created_at) || 0, mtimeOf(join(tasksDir, name, 'ledger.jsonl')) || 0];
    for (const f of ls(join(tasksDir, name, 'drivers'))) if (f.name.endsWith('.stream.jsonl')) marks.push(mtimeOf(join(tasksDir, name, 'drivers', f.name)) || 0);
    const at = Math.max(...marks);
    if (now - at > DAY_MS && !parkedMemo(raw, now)) continue;
    // the repo compare comes last: it may spawn git
    const worktree = repo ? repo(raw.cwd) : { match: true, worktree: null };
    if (!worktree.match) continue;
    picked.push({ id: name, age_ms: Math.max(0, now - at), worktree: worktree.worktree });
  }
  const out = [];
  for (const { id, age_ms, worktree } of picked) {
    const m = collect(tasksDir, id);
    if (!m || m.error) continue;
    // decided from the collected model: a card parked on a person is live whatever its driver says
    // (the package driver exits on purpose while it waits) and is listed however old it is
    const parked = (m.state === 'running' || m.state === 'stalled' || m.state === 'waiting_human') && waitingCount(m) > 0;
    if (parked) out.push({ m, id, live: true, waiting: true, age_ms: null, worktree });
    else if (m.state === 'stalled') { if (age_ms <= DAY_MS) out.push({ m, id, live: false, age_ms, worktree }); }
    else if (m.state === 'running' || m.state === 'waiting_human') out.push({ m, id, live: true, age_ms: null, worktree });
  }
  const created = (x) => x.m.created_at || 0;
  return [...out.filter((x) => x.live).sort((a, b) => created(b) - created(a)), ...out.filter((x) => !x.live).sort((a, b) => created(b) - created(a))];
}

// One listed task as the summary prints it: summarize()'s fields plus identity, liveness, age and the floor.
export function floorEntry({ m, id, live, age_ms, waiting, worktree = null }, tasksDir, { now = Date.now(), ...reuse } = {}) {
  const summary = summarize(m, { now });
  const stage = (summary.stages.find((s) => s.state === 'running') || summary.stages.find((s) => s.state === 'failed'))?.key;
  return {
    ...summary,
    worktree,
    ...(waiting ? { state: 'waiting_human' } : {}),
    task_id: m.task_id, created_at: m.created_at || null, live, age_ms,
    // an S task's harness run: the slug it is known by and whether it moved lately (the row's liveness is item.live)
    harness: m.harness ? { slug: m.harness.slug || null, moving: !!m.harness.moving } : null,
    // each STORY's numbers (attempt, judge, cost, wall, out of retries) ride on its item as `metrics`
    ...floorOf(m, floorFacts(m, tasksDir, id, { now, ...reuse }), { now, metrics: summary.metrics, stage }),
  };
}
