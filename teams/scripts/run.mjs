#!/usr/bin/env node
// run.mjs - headless "teams run" CLI: wait-model C (§4, §8 step 1, §10-1/4 of
// _repo/docs/plans/2026-09-21-teams-server-owns-the-loop.md).
//
// §4 names three ways a caller can watch a daemon-driven task: B (open and walk away), A
// (bounded long-poll from inside a live session), and C ("teams run CLI가 서버를 띄우고 완료까지
// 기다림" - starts the daemon and blocks until it settles, at ZERO cost to any session's own
// context, because there is no session in the loop). §4 also says the bench should be measured
// on C, not on a model polling tm_next - this file is that CLI.
//
// It opens a task exactly the way tm_run does and waits on it exactly the way tm_wait does -
// both reused directly from taskmanager.mjs's own exported callTool(), the same function
// tools/call dispatches through, so tm_run's open+spawn logic and tm_wait's poll loop are not
// duplicated here even once.
//
//   node teams/scripts/run.mjs "<request>" [--kind auto|develop|document] [--cwd <path>]
//     [--budget-usd <n>] [--timebox-minutes <n>] [--vendor <v>] [--allocation ordered|balanced]
//     [--size S|L] [--context <text>] [--poll-ms <n>] [--initiative <slug>] [--json]
//   node teams/scripts/run.mjs --resume <task_id> [--json]
//   (either form) [--resume-on-limit] [--max-resumes <n>]
//
// --resume-on-limit (opt-in) is what scripts/bench/drive.sh used to do around a `claude -p`
// session, moved to where the task itself can be asked: when the task settles `blocked` and
// the cause is a provider usage limit ("You've hit your 5-hour limit · resets 11:50pm
// (Asia/Seoul)"), this reads the reset time out of the notice (taskmanager.mjs's own
// capacityResetAt - the parser the daemon already uses), sleeps until it has passed plus three
// minutes' grace, resumes the task (tm_retry reset_capacity for a parked driver, else a fresh
// attempt of the package the limit killed) and keeps waiting. At most --max-resumes (default 6)
// resumes; a limit on anything that has no resume route (a manager judge that already spent its
// re-judges) is given up on and exits 1 like any other blocked task. The daemon already resumes
// a parked PACKAGE driver on its own (autoResumeCapacity) while the task is still running; what
// it cannot do is come back after the task as a whole has read `blocked` - a size-S task whose
// one run parked on capacity, or a package folded failed on a limit - since its loop ends there.
// drive.sh's other case, a session killed with no result event, has no counterpart here: there
// is no session, and tm_wait re-raises a dead daemon on its own.
//
// --initiative is tm_run's own `initiative` argument (optional grouping ABOVE the EPIC,
// display/grouping only - see tm_open's own description and teamconfig.mjs's `initiative` key).
//
// --kind (alias --flow) is tm_run's own `flow` argument (auto/develop/document) - "kind" is
// what the bench docs (teams/scripts/bench/README.md) call it; the field underneath is `flow`.
//
// Exit codes:
//   0   complete                       - the daemon's report node finished
//   1   blocked (or anything else that is not "running" and not the two above) - nothing left
//       to drive; see the printed final state and, when there is one, the report path
//   3   partial                        - the report is written, but work was left undone (a
//       package not accepted, integrate refused, QA/goal gate not passed); see partial_reasons
//   2   waiting_human                  - a card needs a person; headless cannot answer it, so
//       this does not hang forever. The pending card(s) are printed. Answer with tm_submit (or
//       tm_assign) from a session, then resume: --resume <task_id>
//   64  bad arguments
//   130 SIGINT - the task is NOT stopped. The daemon this spawned (or that was already running,
//       under --resume) is detached and unref()'d (taskmanager.mjs's spawnDaemon) - it keeps
//       driving with nobody watching. This process only stops WATCHING. Resume with
//       --resume <task_id>, or inspect with `node teams/scripts/inspect.mjs <cwd> --task <task_id>`.
//
// §10-1 of the plan: tm_run itself returns only {task_id, run_id, docs_dir, state} (never a
// verdict) - B is the default for a model caller. C, this file, is what repeats tm_wait for it.

import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { callTool as realCallTool, mustFindTask as realMustFindTask, capacityResetAt } from '../mcp/taskmanager.mjs';
import { docPaths as realDocPaths } from '../mcp/tickets.mjs';

export const EXIT = {
  COMPLETE: 0,
  NOT_COMPLETE: 1,
  WAITING_HUMAN: 2,
  PARTIAL: 3,
  ARG_ERROR: 64,
  SIGINT: 130,
};

const FLOW_VALUES = new Set(['auto', 'develop', 'document']);
const ALLOCATION_VALUES = new Set(['ordered', 'balanced']);
const SIZE_VALUES = new Set(['S', 'L']);
const DEFAULT_POLL_MS = 5000;
const DEFAULT_MAX_RESUMES = 6;         // drive.sh's MAX_RESUMES default
export const RESET_GRACE_MS = 3 * 60 * 1000; // drive.sh's "+3 min", the daemon's CAPACITY_GRACE_MS
const SLEEP_STEP_MS = 60 * 1000;       // wake at least once a minute (see sleepUntil)

export const USAGE = `usage:
  node teams/scripts/run.mjs "<request>" [--kind auto|develop|document] [--cwd <path>]
    [--budget-usd <n>] [--timebox-minutes <n>] [--vendor <v>] [--allocation ordered|balanced]
    [--size S|L] [--context <text>] [--poll-ms <n>] [--initiative <slug>] [--json]
    [--resume-on-limit] [--max-resumes <n>]
  node teams/scripts/run.mjs --resume <task_id> [--json] [--resume-on-limit] [--max-resumes <n>]
`;

// Pure and side-effect free on purpose - test-run.mjs exercises this directly, no task layer
// involved at all.
export function parseArgs(argv) {
  const a = { json: false, pollMs: DEFAULT_POLL_MS, resumeOnLimit: false, maxResumes: DEFAULT_MAX_RESUMES };
  const positional = [];
  const list = argv || [];
  for (let i = 0; i < list.length; i++) {
    const v = list[i];
    const next = () => list[++i];
    switch (v) {
      case '--resume': a.resume = next(); break;
      case '--kind': case '--flow': a.flow = next(); break;
      case '--cwd': a.cwd = next(); break;
      case '--context': a.context = next(); break;
      case '--vendor': a.vendor = next(); break;
      case '--allocation': a.allocation = next(); break;
      case '--size': a.size = next(); break;
      case '--budget-usd': a.budgetUsd = next(); break;
      case '--timebox-minutes': a.timeboxMinutes = next(); break;
      case '--initiative': a.initiative = next(); break;
      case '--poll-ms': a.pollMs = Number(next()); break;
      case '-h': case '--help': a.help = true; break;
      case '--json': a.json = true; break;
      case '--resume-on-limit': a.resumeOnLimit = true; break;
      case '--max-resumes': a.maxResumes = Number(next()); break;
      default:
        if (String(v).startsWith('--')) return { error: `unknown option ${v}` };
        positional.push(v);
    }
  }
  if (a.help) return a;
  if (a.resume !== undefined && positional.length) return { error: '--resume takes no request; pass one or the other' };
  if (a.resume === undefined) {
    if (!positional.length) return { error: 'a request is required (or pass --resume <task_id>)' };
    a.request = positional.join(' ');
  }
  if (a.flow !== undefined && !FLOW_VALUES.has(a.flow)) return { error: `--kind must be one of ${[...FLOW_VALUES].join('|')}` };
  if (a.allocation !== undefined && !ALLOCATION_VALUES.has(a.allocation)) return { error: `--allocation must be one of ${[...ALLOCATION_VALUES].join('|')}` };
  if (a.size !== undefined && !SIZE_VALUES.has(a.size)) return { error: '--size must be S or L' };
  if (a.budgetUsd !== undefined) {
    const n = Number(a.budgetUsd);
    if (!Number.isFinite(n)) return { error: '--budget-usd must be a number' };
    a.budgetUsd = n;
  }
  if (a.timeboxMinutes !== undefined) {
    const n = Number(a.timeboxMinutes);
    if (!Number.isFinite(n)) return { error: '--timebox-minutes must be a number' };
    a.timeboxMinutes = n;
  }
  if (!Number.isFinite(a.pollMs) || a.pollMs <= 0) return { error: '--poll-ms must be a positive number' };
  if (!Number.isInteger(a.maxResumes) || a.maxResumes < 0) return { error: '--max-resumes must be a non-negative integer' };
  return a;
}

// The only place tm_run's argument shape is decided for this CLI - one call site, so an added
// tm_run field needs one new line here, not one per caller.
function tmRunArgs(a) {
  const out = { request: a.request, cwd: a.cwd || process.cwd() };
  if (a.context !== undefined) out.context = a.context;
  if (a.flow !== undefined) out.flow = a.flow;
  if (a.vendor !== undefined) out.vendor = a.vendor;
  if (a.allocation !== undefined) out.allocation = a.allocation;
  if (a.size !== undefined) out.size = a.size;
  if (a.budgetUsd !== undefined) out.budget_usd = a.budgetUsd;
  if (a.timeboxMinutes !== undefined) out.timebox_minutes = a.timeboxMinutes;
  if (a.initiative !== undefined) out.initiative = a.initiative;
  return out;
}

// state -> exit code. Exported and tested on its own: a caller that only wants "what code would
// a given final state map to" should not have to run the whole wait loop to find out.
export function exitCodeForState(state) {
  if (state === 'complete') return EXIT.COMPLETE;
  if (state === 'waiting_human') return EXIT.WAITING_HUMAN;
  if (state === 'partial') return EXIT.PARTIAL;
  return EXIT.NOT_COMPLETE; // blocked, missing, or anything else that is not still running
}

// ---------- usage limits (--resume-on-limit) ----------

// Limit notices name their window - "session limit", "usage limit", "weekly limit", "5-hour
// limit" - and drive.sh once matched only two of them and read a weekly limit as a clean ending.
// Codex's own wording is "usage_limit_reached" / "hit your usage limit".
const LIMIT_RE = /hit your (?:[a-z0-9-]+ )?limit|usage[ _]limit|session limit/i;

export function isLimitNotice(text) {
  return LIMIT_RE.test(String(text || ''));
}

// The epoch ms after which a resume is worth trying: the reset the notice names (first
// occurrence after `since`, the moment the limit was hit) plus the grace. A notice with no
// parseable time falls back to since + 30 min, as drive.sh and the daemon both do. A notice
// read late (the reset already passed) yields a time in the past - resume at once, drive.sh's
// "stale limit message" case, without needing its separate "fresh" flag.
export function limitResumeAt(reason, since) {
  return capacityResetAt(reason, since) + RESET_GRACE_MS;
}

function textOf(result) {
  if (!result) return '';
  if (typeof result === 'string') return result;
  try { return JSON.stringify(result); } catch { return ''; }
}

// Every usage-limit reason a settled task carries, on the task object alone (pure - the test
// hands it a literal). Parked drivers (waiting_capacity) are limits whatever their text says;
// a failed node counts only when its result reads like a limit notice.
//   { reason, since, parked: true, package_id? }   - tm_retry({reset_capacity}) resumes it
//   { reason, since, package_id }                  - a failed dispatch: tm_retry({package_id})
//   { reason, since, node_id }                     - any other failed node: no resume route
export function findLimitNotices(task) {
  const out = [];
  if (!task) return out;
  // Only a harness run is resumed (a legacy s_run is never respawned, S2).
  const s = task.harness_run;
  if (s && s.waiting_capacity) {
    out.push({ reason: String(s.waiting_capacity.reason || ''), since: s.waiting_capacity.since, parked: true, package_id: 'S' });
  }
  for (const n of task.nodes || []) {
    if (n.stage === 'dispatch' && n.child && n.child.waiting_capacity) {
      out.push({ reason: String(n.child.waiting_capacity.reason || ''), since: n.child.waiting_capacity.since, parked: true, package_id: String(n.subgoal_id) });
      continue;
    }
    if (n.state !== 'failed' || !n.result) continue;
    const text = textOf(n.result);
    if (!isLimitNotice(text)) continue;
    const reason = String(n.result.reason || text).slice(0, 500);
    if (n.stage === 'dispatch' && n.subgoal_id != null) out.push({ reason, since: n.finished_at, package_id: String(n.subgoal_id) });
    else out.push({ reason, since: n.finished_at, node_id: n.node_id });
  }
  // A package retried after a limit leaves its failed first attempt behind: only the newest
  // notice per package matters, and a package that has since been parked is the parked one.
  const seen = new Map();
  for (const x of out) {
    const k = x.package_id != null ? `p:${x.package_id}` : `n:${x.node_id}`;
    const prev = seen.get(k);
    if (!prev || x.parked || (!prev.parked && (Number(x.since) || 0) >= (Number(prev.since) || 0))) seen.set(k, x);
  }
  return [...seen.values()];
}

// Sleeps until `until` in steps of at most a minute against the clock `now()`, not one long
// timer: macOS does not count time asleep toward a single sleep, and idol-pm4 (2026-09-23)
// resumed five hours after its reset (drive.sh's lesson). Returns false when `shouldStop` fired.
export async function sleepUntil(until, { now = Date.now, sleep = defaultSleep, shouldStop = () => false } = {}) {
  for (;;) {
    if (shouldStop()) return false;
    const left = until - now();
    if (left <= 0) return true;
    await sleep(Math.min(SLEEP_STEP_MS, left));
  }
}

function defaultSleep(ms) {
  return new Promise((r) => { setTimeout(r, ms); });
}

function fmtCounts(counts) {
  return Object.entries(counts || {}).filter(([, n]) => n).map(([k, n]) => `${k}:${n}`).join(' ');
}

function questionText(q) {
  if (q && typeof q === 'object') return q.question || JSON.stringify(q);
  return String(q);
}

function emit(json, obj, prose, out) {
  const w = out || process.stdout;
  w.write(json ? `${JSON.stringify(obj)}\n` : `${prose}\n`);
}

// One --resume-on-limit step over a task that just settled `blocked`: 'none' (not a limit -
// the blocked verdict stands), 'gave_up', 'detached' (SIGINT during the wait) or 'resumed'.
async function resumeAfterLimit({ a, taskId, deps, ct, mft, shouldStop, out, resumes, maxResumes }) {
  const now = deps.now || Date.now;
  let task = null;
  try { task = mft({ task_id: taskId }); } catch { task = null; }
  const notices = findLimitNotices(task);
  if (!notices.length) return 'none';
  const giveUp = (why) => {
    emit(a.json, { event: 'limit_gave_up', task_id: taskId, resumes, reason: why },
      `[teams run] usage limit: gave up at resume ${resumes} - ${why}`, out);
    return 'gave_up';
  };
  if (resumes >= maxResumes) return giveUp(`--max-resumes ${maxResumes} reached`);
  const resumable = notices.filter((x) => x.parked || x.package_id != null);
  if (!resumable.length) {
    return giveUp(`no resume route for ${notices.map((x) => x.node_id || x.package_id).join(', ')} (${notices[0].reason.slice(0, 120)})`);
  }
  // Wait for the latest reset among them: resuming one window early only hits the limit again.
  const at = Math.max(...resumable.map((x) => limitResumeAt(x.reason, Number(x.since) || now())));
  const wait = Math.max(0, at - now());
  emit(a.json, { event: 'limit', task_id: taskId, resume_at: new Date(at).toISOString(), wait_ms: wait, reason: resumable[0].reason.slice(0, 300) },
    wait > 0
      ? `[teams run] usage limit (${resumable[0].reason.slice(0, 120)}); sleeping until ${new Date(at).toISOString()}`
      : `[teams run] usage limit (${resumable[0].reason.slice(0, 120)}); reset already passed, resuming`,
    out);
  const woke = await sleepUntil(at, { now, sleep: deps.sleep || defaultSleep, shouldStop });
  if (!woke) return 'detached';

  // Parked drivers first: reset_capacity respawns them on the same run_id and spends no retry.
  const done = [];
  if (resumable.some((x) => x.parked)) {
    const r = await ct('tm_retry', { task_id: taskId, reset_capacity: true });
    if (r && r.retried) done.push(...(r.resumed || []));
  }
  for (const x of resumable.filter((y) => !y.parked && y.package_id !== 'S')) {
    try {
      const r = await ct('tm_retry', { task_id: taskId, package_id: x.package_id });
      if (r && r.retried) done.push(x.package_id);
    } catch { /* a package the shape no longer names, or a settled failure: not resumable */ }
  }
  if (!done.length) return giveUp('tm_retry resumed nothing');
  emit(a.json, { event: 'limit_resumed', task_id: taskId, resume: resumes + 1, resumed: done },
    `[teams run] resume ${resumes + 1} of ${taskId}: ${done.join(', ')}`, out);
  return 'resumed';
}

// The whole run: open (or resume), wait, print, decide the exit code. Split out of main() so
// test-run.mjs can drive it with a fake `deps.callTool` and never touch the real task layer (no
// task.json, no daemon, no `claude` process). `shouldStop` is polled between tm_wait calls only
// - the calls themselves are as synchronous and blocking in the daemon as tm_wait always is
// (§4-A), so SIGINT latency is bounded by `--poll-ms`, not instant; documented in USAGE.
export async function runHeadless(a, deps = {}, shouldStop = () => false, out = process.stdout) {
  const ct = deps.callTool || realCallTool;
  const mft = deps.mustFindTask || realMustFindTask;
  const dp = deps.docPaths || realDocPaths;

  let taskId = a.resume;
  if (!taskId) {
    const opened = await ct('tm_run', tmRunArgs(a));
    taskId = opened.task_id;
    emit(a.json, { event: 'open', task_id: taskId, docs_dir: opened.docs_dir },
      `[teams run] opened ${taskId} - docs at ${opened.docs_dir}`, out);
  } else {
    emit(a.json, { event: 'resume', task_id: taskId }, `[teams run] resuming ${taskId}`, out);
  }

  const detach = (waitingOnLimit = false) => {
    emit(a.json, { event: 'detached', task_id: taskId, ...(waitingOnLimit ? { waiting_on_limit: true } : {}) },
      (waitingOnLimit
        ? `[teams run] detached while waiting out a usage limit - ${taskId} stays blocked until resumed.\n`
        : `[teams run] detached - the daemon keeps driving ${taskId} on its own.\n`) +
      `  resume:  node teams/scripts/run.mjs --resume ${taskId}${a.resumeOnLimit ? ' --resume-on-limit' : ''}\n` +
      `  inspect: node teams/scripts/inspect.mjs ${a.cwd || process.cwd()} --task ${taskId}`,
      out);
    return { exitCode: EXIT.SIGINT, taskId, final: null };
  };

  let cursor = 0;
  let final = null;
  let resumes = 0;
  const maxResumes = Number.isInteger(a.maxResumes) ? a.maxResumes : DEFAULT_MAX_RESUMES;
  for (;;) {
    for (;;) {
      if (shouldStop()) return detach();
      const reply = await ct('tm_wait', { task_id: taskId, cursor, max_ms: a.pollMs });
      cursor = reply.cursor;
      const transitions = reply.transitions || [];
      for (const t of transitions) {
        emit(a.json, { event: 'transition', task_id: taskId, ...t },
          `[teams run] ${t.node_id} (${t.stage}) -> ${t.state}${t.stage_ok === false ? ' FAILED' : ''}`, out);
      }
      if (!transitions.length) {
        emit(a.json, { event: 'heartbeat', task_id: taskId, state: reply.state, counts: reply.counts },
          `[teams run] ${reply.state} ${fmtCounts(reply.counts)}`.trimEnd(), out);
      }
      if (reply.state !== 'running') { final = reply; break; }
    }
    if (!a.resumeOnLimit || final.state !== 'blocked') break;
    const step = await resumeAfterLimit({ a, taskId, deps, ct, mft, shouldStop, out, resumes, maxResumes });
    if (step === 'detached') return detach(true);
    if (step !== 'resumed') break;
    resumes += 1;
  }

  const exitCode = exitCodeForState(final.state);
  let report = null;
  try { report = dp(mft({ task_id: taskId })).report; } catch { report = null; }

  if (final.state === 'waiting_human') {
    let cards = [];
    try { cards = (await ct('tm_inbox', { task_id: taskId })).cards || []; } catch { cards = []; }
    for (const card of cards) {
      const questions = Array.isArray(card.questions) && card.questions.length
        ? `\n  ${card.questions.map((q) => `? ${questionText(q)}`).join('\n  ')}` : '';
      emit(a.json, { event: 'waiting_human', task_id: taskId, card },
        `[teams run] waiting on a human - ${card.key} (${card.stage}): ${card.title}${questions}`, out);
    }
  }

  emit(a.json,
    { event: 'final', task_id: taskId, state: final.state, counts: final.counts, exit_code: exitCode,
      report, ...(final.goal_verdict ? { goal_verdict: final.goal_verdict } : {}),
      ...(resumes ? { limit_resumes: resumes } : {}) },
    `[teams run] ${String(final.state).toUpperCase()} ${fmtCounts(final.counts)}`.trimEnd() +
      (report ? `\n  report: ${report}` : ''),
    out);

  return { exitCode, taskId, final, resumes };
}

// The laptop must not sleep under a headless run (idol-pm-4 lost five hours to one); bench
// drive.sh does the same. -w ends caffeinate when this process exits.
export function keepAwakeArgv(platform = process.platform, pid = process.pid) {
  return platform === 'darwin' ? ['caffeinate', ['-i', '-w', String(pid)]] : null;
}

async function main() {
  const awake = keepAwakeArgv();
  if (awake) spawn(awake[0], awake[1], { stdio: 'ignore' }).on('error', () => {}).unref();
  const a = parseArgs(process.argv.slice(2));
  if (a.error) {
    process.stderr.write(`teams run: ${a.error}\n${USAGE}`);
    process.exit(EXIT.ARG_ERROR);
  }
  if (a.help) {
    process.stdout.write(USAGE);
    process.exit(0);
  }
  let interrupted = false;
  process.on('SIGINT', () => { interrupted = true; });
  let result;
  try {
    result = await runHeadless(a, {}, () => interrupted);
  } catch (e) {
    process.stderr.write(`teams run: ${String((e && e.message) || e)}\n`);
    process.exit(EXIT.NOT_COMPLETE);
  }
  process.exit(result.exitCode);
}

// Both a CLI and a library (parseArgs/exitCodeForState/runHeadless are tested directly, the way
// inspect.mjs's renderReport is) - importing this file must print nothing and exit nothing.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
