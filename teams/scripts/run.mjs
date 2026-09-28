#!/usr/bin/env node
// run.mjs - headless "teams run" CLI: wait-model C (§4, §8 step 1, §10-1/4 of
// docs/plans/2026-09-21-teams-server-owns-the-loop.md).
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

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { callTool as realCallTool, mustFindTask as realMustFindTask } from '../mcp/taskmanager.mjs';
import { docPaths as realDocPaths } from '../mcp/tickets.mjs';

export const EXIT = {
  COMPLETE: 0,
  NOT_COMPLETE: 1,
  WAITING_HUMAN: 2,
  ARG_ERROR: 64,
  SIGINT: 130,
};

const FLOW_VALUES = new Set(['auto', 'develop', 'document']);
const ALLOCATION_VALUES = new Set(['ordered', 'balanced']);
const SIZE_VALUES = new Set(['S', 'L']);
const DEFAULT_POLL_MS = 5000;

export const USAGE = `usage:
  node teams/scripts/run.mjs "<request>" [--kind auto|develop|document] [--cwd <path>]
    [--budget-usd <n>] [--timebox-minutes <n>] [--vendor <v>] [--allocation ordered|balanced]
    [--size S|L] [--context <text>] [--poll-ms <n>] [--initiative <slug>] [--json]
  node teams/scripts/run.mjs --resume <task_id> [--json]
`;

// Pure and side-effect free on purpose - test-run.mjs exercises this directly, no task layer
// involved at all.
export function parseArgs(argv) {
  const a = { json: false, pollMs: DEFAULT_POLL_MS };
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
  return EXIT.NOT_COMPLETE; // blocked, missing, or anything else that is not still running
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

  let cursor = 0;
  let final = null;
  for (;;) {
    if (shouldStop()) {
      emit(a.json, { event: 'detached', task_id: taskId },
        `[teams run] detached - the daemon keeps driving ${taskId} on its own.\n` +
        `  resume:  node teams/scripts/run.mjs --resume ${taskId}\n` +
        `  inspect: node teams/scripts/inspect.mjs ${a.cwd || process.cwd()} --task ${taskId}`,
        out);
      return { exitCode: EXIT.SIGINT, taskId, final: null };
    }
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
      report, ...(final.goal_verdict ? { goal_verdict: final.goal_verdict } : {}) },
    `[teams run] ${String(final.state).toUpperCase()} ${fmtCounts(final.counts)}`.trimEnd() +
      (report ? `\n  report: ${report}` : ''),
    out);

  return { exitCode, taskId, final };
}

async function main() {
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
