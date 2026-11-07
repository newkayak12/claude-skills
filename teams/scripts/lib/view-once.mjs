// The answers of `view.mjs --once` (the teams-status mod's data: status, events, summary, teams, board,
// decisions, report, and the text trees). `onceOutput` is the one function both `view.mjs --once` and the
// state server (teams/mcp/stateserver.mjs) answer with, so a served answer equals the CLI's by construction.
//
// `shared` ({ store, ctx }, the state server only) carries the tick memo (`ctx.memo`) and, optionally,
// `ctx.collect(dir, id)` (a per-task cache replacing collectTask) and `ctx.floorOpts(dir, id)` (what
// floorEntry may reuse instead of re-reading). `--once` passes no `shared` and reads everything directly.
import { readFileSync, existsSync, openSync, readSync, fstatSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { collectTask, listTasks, readJsonRetry } from './view-collect.mjs';
import { renderText, renderIndexText, renderTicketsText, renderResourcesText } from './view-render-text.mjs';
import { notableEvents, notableFromEvents, statusLine, HOLD_MS } from './view-events.mjs';
import { summarize, waitingCount } from './view-summary.mjs';
import { floorTasks, floorEntry } from './view-floor-fs.mjs';
import { repoMatcher } from './view-repo.mjs';
import { openTasks, statSig, statOf, listDirs } from './view-index.mjs';
import { reportPayload } from './view-report.mjs';
import { teamsView, decisionsView } from './view-status.mjs';
import { dashboardModel, dashboardSvg, dashboardAlt, dashboardText } from './view-dashboard.mjs';
import { asksFor } from './view-asks.mjs';
import { receivedRows } from './ask-log.mjs';

// --view picks which of the three renderers --once prints for a single task.
// Default 'pipeline': the surface
// this file has always shown, unchanged for anyone not passing the flag.
export const VIEWS = { pipeline: renderText, tickets: renderTicketsText, resources: renderResourcesText };

// ---------- --once --format status|events|summary|teams|decisions (the teams-status mod's data) ----------

const TAIL_BYTES = 256 * 1024;

// Last 256 KiB of a ledger as lines, read from the end so a huge ledger costs the same. When the
// read starts mid-file its first line is a fragment and is dropped.
function tailLines(path) {
  let fd;
  try {
    fd = openSync(path, 'r');
    const size = fstatSync(fd).size;
    const start = Math.max(0, size - TAIL_BYTES);
    const buf = Buffer.alloc(size - start);
    readSync(fd, buf, 0, buf.length, start);
    const lines = buf.toString('utf8').split('\n');
    if (start > 0) lines.shift();
    return lines.filter((l) => l.trim());
  } catch {
    return [];
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

// Running tasks, decided by collectTask(): state 'running' (a dead daemon reads 'stalled'). A
// task.json-less dir is never listed, and an unreadable one carries `error`, so unknown = not running.
// With a cwd, the tasks of its repo (main checkout and linked worktrees; lib/view-repo.mjs).
// [{ m, worktree }], worktree null for a task in the cwd's own checkout.
function runningModels(tasksDir, cwd, collect = collectTask, open = openTasks) {
  const repo = repoMatcher(cwd);
  const out = [];
  for (const { id, raw, absent } of open(tasksDir, { running: true })) {
    if (!raw && (absent || !existsSync(join(tasksDir, id, 'task.json')))) continue;
    if (raw && cwd && !raw.cwd) continue;
    const m = collect(tasksDir, id);
    if (m.error || m.state !== 'running') continue;
    const at = cwd ? repo(m.cwd) : { match: true, worktree: null };
    if (at.match) out.push({ m, worktree: at.worktree });
  }
  return out;
}

// The single `task` object names its worktree only when it is another checkout (the `tasks` rows
// always carry the field, null for the cwd's own).
const marked = (worktree) => (worktree ? { worktree } : {});

// The ⚑ count reads every live open task (a card parked in a child run counts though no task runs),
// the same rule summaryOutput applies, so --format status and summary.status always agree.
//
// `ctx` (the shared server only) is the tick's memo: the session-independent parts below are computed
// once per tick and cwd and shared by every session's ask; the session's `asks` is applied last.
const memo = (ctx, key, fn) => (ctx ? ctx.memo(JSON.stringify(key), fn) : fn());

// One collectTask per task per tick: the listing, the running set and every session's asks read the same model.
// With `ctx.collect` (the server's per-task cache) that replaces collectTask.
const collectOf = (ctx) => (dir, id) => memo(ctx, ['collect', dir, id], () => (ctx && ctx.collect ? ctx.collect(dir, id) : collectTask(dir, id)));

const openOf = (ctx) => (dir, o = {}) => memo(ctx, ['open', dir, !!o.running], () => openTasks(dir, ctx && ctx.settledMs ? { ...o, settledMs: ctx.settledMs } : o));

// The shared server (ctx.settledMs) hands floorTasks every open task, each of which it checks against the disk
// (newest stream, ledger, repo). A task created over a day ago that the floor did not list stays unlisted until
// the next full pass, once per settledMs: between passes it is not offered. Anything younger, or listed, is
// offered on every tick, so a new task or a stalled one coming back to life shows within the answer window.
const unlisted = new Map();

//
// `liveOnly` (the status line, which counts the waiting cards of live tasks only): a task whose model reads
// stalled with no card waiting is never live, so the shared server does not offer it to floorTasks at all.
function listedOf(tasksDir, cwd, ctx, liveOnly = false) {
  return memo(ctx, ['listed', tasksDir, cwd, liveOnly], () => {
    const settledMs = ctx && ctx.settledMs;
    const key = `${tasksDir}\0${cwd}\0${liveOnly}`;
    const prior = settledMs ? unlisted.get(key) : null;
    const full = !prior || Date.now() - prior.at >= settledMs;
    const offered = new Map();
    const collect = collectOf(ctx);
    const open = (dir, o) => {
      let all = openOf(ctx)(dir, o);
      if (!settledMs) return all;
      if (!full) all = all.filter((x) => !prior.ids.has(x.id));
      if (liveOnly) all = all.filter((x) => { const m = x.raw && collect(dir, x.id); return !(m && !m.error && m.state === 'stalled' && waitingCount(m) === 0); });
      if (full) for (const x of all) offered.set(x.id, x.raw);
      return all;
    };
    const listed = floorTasks({ tasksDir, cwd, now: Date.now(), collect, open });
    if (settledMs && full) {
      const shown = new Set(listed.map((x) => x.id));
      const ids = new Set();
      for (const [id, raw] of offered) if (!shown.has(id) && raw && typeof raw === 'object' && Date.now() - (Number(raw.created_at) || Date.now()) > DAY_MS) ids.add(id);
      unlisted.set(key, { at: Date.now(), ids });
    }
    return listed;
  });
}

function statusBase(tasksDir, cwd, ctx) {
  return memo(ctx, ['status', tasksDir, cwd], () => {
    const listed = listedOf(tasksDir, cwd, ctx, true);
    const status = JSON.parse(statusFrom(runningModels(tasksDir, cwd, collectOf(ctx), openOf(ctx))));
    status.waiting = listed.filter((x) => x.live).reduce((s, x) => s + waitingCount(x.m), 0);
    return status;
  });
}

function statusOutput(tasksDir, cwd, session, ctx) {
  const status = { ...statusBase(tasksDir, cwd, ctx) };
  status.asks = asksOf(tasksDir, session, ctx);
  return JSON.stringify(status) + '\n';
}

// The questions waiting on one session, over every open task whatever its cwd (floorTasks filters on the
// raw task.json opener before collecting); [] without a session. `via` is 'send' once a received row exists.
function asksOf(tasksDir, session, ctx) {
  if (!session) return [];
  return memo(ctx, ['asks', tasksDir, session], () => {
    const entries = floorTasks({ tasksDir, opener: session, now: Date.now(), collect: collectOf(ctx), open: openOf(ctx) });
    return asksFor(entries, session, receivedRows(tasksDir, entries.map((x) => x.id)));
  });
}

function statusFrom(entries) {
  const models = entries.map((x) => x.m);
  const rows = entries.map(({ m, worktree }) => {
    const c = m.counts || {};
    const total = Object.values(c).reduce((s, n) => s + (Number(n) || 0), 0);
    const cur = (m.manager_stages || []).find((n) => n.state === 'running')
      || (m.packages || []).find((p) => p.state === 'running');
    return { id: 'E-' + String(m.task_id).replace(/^E-/, '').slice(0, 8), state: m.state, done: c.done || 0, total, current: cur ? (cur.node_id || cur.id || '') : '', worktree };
  });
  // waiting = nodes in state waiting_human, counted from task.json (no ledger records that event).
  const waiting = models.reduce((s, m) => s + ((m.counts && m.counts.waiting_human) || 0), 0);
  const newest = models.reduce((a, m) => (!a || (m.created_at || 0) > (a.created_at || 0) ? m : a), null);
  return JSON.stringify({ line: statusLine(rows), waiting, latest: newest ? newest.task_id : null }) + '\n';
}

// { status, tasks, task }: status is exactly --format status; tasks is every open task of the cwd
// (floorTasks: live newest created first, then stalled under 24 h with age_ms), each the human summary
// plus items, workers and handoffs; task is the human summary of --task, else of status.latest, else
// null (nothing running, or the task file is unreadable).
function summaryParts(tasksDir, cwd, taskId, ctx) {
  return memo(ctx, ['summary', tasksDir, cwd, taskId], () => {
    const now = Date.now();
    const listed = listedOf(tasksDir, cwd, ctx);
    const status = JSON.parse(statusFrom(listed.filter((x) => x.live && x.m.state === 'running')));
    // the ⚑ count reads the collected model, so a card parked in a child run (its driver gone on purpose) counts
    status.waiting = listed.filter((x) => x.live).reduce((s, x) => s + waitingCount(x.m), 0);
    const id = taskId || status.latest;
    const hit = id ? listed.find((x) => x.m.task_id === id) : null;
    const m = hit ? hit.m : (id ? collectOf(ctx)(tasksDir, id) : null);
    const tasks = listed.map((x) => floorEntry(x, tasksDir, { now, ...(ctx && ctx.floorOpts ? ctx.floorOpts(tasksDir, x.id) : {}) }));
    return { status, tasks, task: m && !m.error ? { ...summarize(m), ...marked(hit && hit.worktree) } : null };
  });
}

// summaryParts with the session's asks applied last, as the parsed object --format summary prints.
function summaryBase(tasksDir, cwd, taskId, session, ctx) {
  const p = summaryParts(tasksDir, cwd, taskId, ctx);
  return { status: { ...p.status, asks: asksOf(tasksDir, session, ctx) }, tasks: p.tasks, task: p.task };
}

function summaryOutput(tasksDir, cwd, taskId, session, ctx) {
  return JSON.stringify(summaryBase(tasksDir, cwd, taskId, session, ctx)) + '\n';
}

// summaryOutput (status, tasks) plus the per-team rows and Now lines of --task (the /teams-status pane while it is open).
function teamsParts(tasksDir, cwd, taskId, ctx) {
  return memo(ctx, ['teams', tasksDir, cwd, taskId], () => {
    const base = summaryParts(tasksDir, cwd, taskId, ctx);
    const id = taskId || base.status.latest;
    const m = id ? collectOf(ctx)(tasksDir, id) : null;
    const ok = m && !m.error;
    const listedTask = base.tasks.find((t) => t.task_id === id);
    const task = ok ? { ...summarize(m), ...marked(listedTask && listedTask.worktree) } : null;
    const model = dashboardModel(task);
    const dash = model ? { model, svg: dashboardSvg(model), alt: dashboardAlt(model) } : null;
    return { task, teams: ok ? teamsView(m) : null, dash };
  });
}

function teamsOutput(tasksDir, cwd, taskId, session, ctx) {
  const base = summaryBase(tasksDir, cwd, taskId, session, ctx);
  const p = teamsParts(tasksDir, cwd, taskId, ctx);
  return JSON.stringify({ status: base.status, tasks: base.tasks, task: p.task, teams: p.teams, dash: p.dash }) + '\n';
}

const DAY_MS = 24 * 60 * 60 * 1000;

// The board as plain lines (/teams-status's answer where no pane is drawn); with no task, the status line.
// The board never shows asks, so it is the same text for every session and is memoized whole.
function boardOutput(tasksDir, cwd, taskId, session, ctx) {
  return memo(ctx, ['board', tasksDir, cwd, taskId], () => boardText(tasksDir, cwd, taskId, ctx));
}

function boardText(tasksDir, cwd, taskId, ctx) {
  const base = summaryParts(tasksDir, cwd, taskId, ctx);
  // nothing running: the newest EPIC of this cwd opened in the last day, whatever its end
  let task = base.task || (base.tasks[0] || null);
  if (!task && cwd) {
    const recent = listTasks(tasksDir).filter((r) => Date.now() - (r.created_at || 0) < DAY_MS);
    const repo = repoMatcher(cwd);
    let worktree = null;
    const hit = recent.find((r) => {
      try {
        const at = repo(JSON.parse(readFileSync(join(tasksDir, r.task_id, 'task.json'), 'utf8')).cwd);
        worktree = at.worktree;
        return at.match;
      } catch { return false; }
    });
    const m = hit ? collectOf(ctx)(tasksDir, hit.task_id) : null;
    task = m && !m.error ? { ...summarize(m), ...marked(worktree) } : null;
  }
  return dashboardText(dashboardModel(task)) || `${base.status.line || 'teams: no task running'}\n`;
}

// The decision timeline of --task (one card's with --card), from task.json and the ledger tail.
function decisionsOutput(tasksDir, taskId, card) {
  let raw = null;
  try { raw = taskId ? JSON.parse(readFileSync(join(tasksDir, taskId, 'task.json'), 'utf8')) : null; } catch { raw = null; }
  const ledger = raw ? tailLines(join(tasksDir, taskId, 'ledger.jsonl')).map((l) => { try { return JSON.parse(l); } catch { return null; } }) : [];
  return JSON.stringify(decisionsView(raw, ledger, { card: card || null })) + '\n';
}

// What notableEvents reads from task.json: max_retries and each node's result.reason. An unreadable
// task.json leaves them out and the events fall back to the defaults.
function taskFacts(tasksDir, taskId) {
  let raw;
  try { raw = JSON.parse(readFileSync(join(tasksDir, taskId, 'task.json'), 'utf8')); } catch { return {}; }
  const reasons = {};
  for (const n of Array.isArray(raw.nodes) ? raw.nodes : []) {
    if (n && n.node_id && n.result && typeof n.result.reason === 'string') reasons[n.node_id] = n.result.reason;
  }
  return { reasons, ...(Number.isInteger(raw.max_retries) ? { maxRetries: raw.max_retries } : {}) };
}

// What the events sweep reads from one task.json: the head (created_at, cwd; null when unreadable) and,
// on demand, the task facts. Kept per tasks dir while the file's mtime and size are unchanged, so a task
// that has not been written since the last call is not re-read (the long-lived state server
// asks about every task on every tick). An unreadable file is not kept. A task gone from the dir is dropped.
const headCache = new Map();
const HOUR_MS = 60 * 60 * 1000;
const ledgerSweeps = new Map();

function headOf(tasksDir, id) {
  let dirCache = headCache.get(tasksDir);
  if (!dirCache) headCache.set(tasksDir, dirCache = new Map());
  const path = join(tasksDir, id, 'task.json');
  const sig = statSig(path);
  const hit = dirCache.get(id);
  if (hit && hit.sig === sig) return hit;
  const read = readJsonRetry(path);
  const head = !read.ok || !read.value || typeof read.value !== 'object' ? null : { created_at: read.value.created_at || 0, cwd: read.value.cwd };
  const entry = { sig, head, factsMemo: undefined, facts() { return this.factsMemo ??= taskFacts(tasksDir, id); } };
  if (head !== null) dirCache.set(id, entry); else dirCache.delete(id);
  return entry;
}

// Ledgers whose file changed after `since` (mtime, ms; stat'd first, task.json is read only for those), whatever the task's state: daemon_done and
// daemon_exhausted are written after a task stops running, so a running-only filter would never
// deliver them. A task.json-less dir is not listed and an unreadable one carries `error`; both skipped.
//
// A failed node_finish is told with its reason and next step, and held up to HOLD_MS for the event
// that says what happens next, so an event with ts > since can sit in a ledger last written up to
// HOLD_MS before `since`: the mtime skip is widened by that. Its reason is the latest verdict in the
// 256 KiB tail; a verdict older than the tail is not seen and the reason is task.json's
// result.reason for the node, else `no reason recorded`.
//
// With `shared` ({ store, ctx }, the shared server) the ledgers come from the incremental store and the
// session-independent sweeps (ledger mtimes, task.json, the cwd match, task facts) are memoized for the
// tick; `since` and the failure hold are applied here per caller, from now.
// Whether a task's cwd belongs to the session's repo (a realpath per task, and git for another checkout). The
// shared server keeps the answer for a task cwd for ctx.settledMs instead of asking again on every tick.
const cwdMatched = new Map();
function cwdMatches(ctx, key, taskCwd, repo) {
  if (!ctx || !ctx.settledMs) return !!taskCwd && repo(taskCwd).match;
  const now = Date.now();
  const hit = cwdMatched.get(key);
  if (hit && hit.taskCwd === taskCwd && now - hit.at < ctx.settledMs) return hit.match;
  const match = !!taskCwd && repo(taskCwd).match;
  cwdMatched.set(key, { taskCwd, match, at: now });
  return match;
}

// A ledger's events from the shared store, which opens the file on every read: while the ledger's own mtime
// and size (one stat per tick, shared with the sweep above) stand, the events last read are the answer.
const storedLedgers = new Map();
function storedEvents(store, path) {
  const sig = statSig(path);
  const hit = storedLedgers.get(path);
  if (hit && hit.store === store && hit.sig === sig && sig !== null) return hit.events;
  const events = store.read(path);
  storedLedgers.set(path, { store, sig, events });
  return events;
}

function eventsOutput(tasksDir, cwd, since, shared) {
  const ctx = shared && shared.ctx;
  const repo = repoMatcher(cwd);
  const out = [];
  const swept = memo(ctx, ['ledgers', tasksDir], () => {
    const ids = listDirs(tasksDir);
    if (!ids) return null;
    const rows = [];
    const known = new Map(); // id -> its row, or null when it has no ledger
    const now = Date.now();
    // The shared server stats a ledger last written over an hour ago, or none, only once per `ctx.settledMs`.
    const prior = ctx && ctx.settledMs ? ledgerSweeps.get(tasksDir) : null;
    const recheck = !prior || now - prior.at >= ctx.settledMs;
    for (const id of ids) {
      const was = prior && prior.rows.get(id);
      if (!recheck && was !== undefined && (was === null || now - was.mtimeMs > HOUR_MS)) { known.set(id, was); if (was) rows.push(was); continue; }
      const s = statOf(join(tasksDir, id, 'ledger.jsonl')); // no ledger: skipped, and no thrown ENOENT per task
      const row = s ? { id, mtimeMs: s.mtime } : null;
      known.set(id, row);
      if (row) rows.push(row);
    }
    if (ctx && ctx.settledMs) ledgerSweeps.set(tasksDir, { at: recheck ? now : prior.at, rows: known });
    if (recheck) {
      const kept = headCache.get(tasksDir);
      const present = new Set(ids);
      if (kept) for (const id of kept.keys()) if (!present.has(id)) kept.delete(id);
      const prefix = join(tasksDir, '/');
      for (const [k, v] of cwdMatched) if (now - v.at > 10 * 60 * 1000) cwdMatched.delete(k);
      for (const p of storedLedgers.keys()) if (p.startsWith(prefix) && !present.has(p.slice(prefix.length).split('/')[0])) storedLedgers.delete(p);
    }
    return rows;
  });
  if (!swept) return '';
  const live = [];
  for (const { id, mtimeMs } of swept) {
    if (mtimeMs <= Math.max(0, since - HOLD_MS)) continue;
    const head = memo(ctx, ['created', tasksDir, id], () => headOf(tasksDir, id).head);
    if (head === null) continue;
    live.push({ id, created_at: head.created_at, cwd: head.cwd });
  }
  live.sort((a, b) => b.created_at - a.created_at);
  for (const { id, cwd: taskCwd } of live) {
    if (cwd) {
      const inCwd = memo(ctx, ['incwd', tasksDir, cwd, id], () => cwdMatches(ctx, `${tasksDir}\0${cwd}\0${id}`, taskCwd, repo));
      if (!inCwd) continue;
    }
    const facts = memo(ctx, ['facts', tasksDir, id], () => headOf(tasksDir, id).facts());
    const path = join(tasksDir, id, 'ledger.jsonl');
    if (shared) out.push(...notableFromEvents(storedEvents(shared.store, path), since, { now: Date.now(), ...facts }));
    else out.push(...notableEvents(tailLines(path), since, { now: Date.now(), ...facts }));
  }
  out.sort((a, b) => a.ts - b.ts);
  return out.map((e) => JSON.stringify(e) + '\n').join('');
}

// One ReportPayload line for --task (the teams-status Report tab and end-of-run card). A task that is
// unknown or unreadable still gets a payload, with report and retro null.
function reportOutput(tasksDir, taskId, ctx) {
  const m = taskId ? collectOf(ctx)(tasksDir, taskId) : null;
  let raw = null;
  if (m && !m.error) {
    try { raw = JSON.parse(readFileSync(join(tasksDir, taskId, 'task.json'), 'utf8')); } catch { raw = null; }
  }
  const verdict = raw ? (m.state === 'complete' ? 'finished' : m.state === 'running' ? 'running' : 'blocked') : undefined;
  return JSON.stringify(reportPayload(raw || { run_id: taskId || '' }, { verdict })) + '\n';
}

// What `--once` prints for these args; the state server answers with the same function.
export function onceOutput(args, tasksDir, render, shared) {
  const ctx = shared && shared.ctx;
  if (args.format === 'status') return statusOutput(tasksDir, args.cwd, args.session, ctx);
  if (args.format === 'summary') return summaryOutput(tasksDir, args.cwd, args.task, args.session, ctx);
  if (args.format === 'board') return boardOutput(tasksDir, args.cwd, args.task, args.session, ctx);
  if (args.format === 'teams') return teamsOutput(tasksDir, args.cwd, args.task, args.session, ctx);
  if (args.format === 'decisions') return decisionsOutput(tasksDir, args.task, args.card);
  if (args.format === 'report') return reportOutput(tasksDir, args.task, ctx);
  if (args.format === 'events') return eventsOutput(tasksDir, args.cwd, args.since || 0, shared);
  if (args.task) return render(collectTask(tasksDir, args.task));
  const rows = listTasks(tasksDir);
  if (rows.length === 1) return render(collectTask(tasksDir, rows[0].task_id));
  // tickets/resources need one specific task to draw a board/tree for - an index of several
  // tasks falls back to the same plain task list every --view does, rather than a board with
  // nothing on it.
  return renderIndexText(rows, tasksDir);
}
