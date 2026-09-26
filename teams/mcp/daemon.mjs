#!/usr/bin/env node
// daemon.mjs - the server owns the loop (docs/plans/2026-09-21-teams-server-owns-the-loop.md).
//
// One task, one daemon: `node daemon.mjs --task <task_id>` drives that task's graph to
// complete/blocked with no model in the loop except where a node genuinely needs judgment. It is
// spawned by taskmanager.mjs's spawnDaemon the same way a package's own driver is spawned -
// detached, unref()'d, its stdout/stderr captured to <taskDir>/daemon/ - because it has to
// outlive the client session that opened the task, exactly like every driver already had to.
//
// What replaced what: the TaskLeader used to be a `claude -p` session that read
// references/manager.md and called tm_next/tm_submit/tm_retry back into THIS SAME MCP server
// over stdio - 91 turns and $9.66 to relay JSON it never looked at (docs/plans, §1a). This
// process is not a client of that server at all. It imports taskmanager.mjs as a library and
// calls the functions a tool handler calls - advanceDispatches, finish, foldChild - directly, in
// process. The only thing here that still costs a model call is judge(): one single-shot
// `claude -p` per judging node (size, shape, critique, accept, integrate, gate, report), fed the
// exact briefing composeTaskPrompt already builds and required to return the exact JSON contract
// CONTRACT already asks for - the same work a "fresh agent" node the old leader spawned did.
//
// Zero dependencies, matching the rest of this plugin: no queue, no message bus, just task.json
// (graph.mjs's saveRun, mkdir-locked) as the one shared truth a direct tm_submit/tm_retry from
// anywhere else can safely race against.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, watch } from 'node:fs';
import { join, dirname } from 'node:path';
import {
  loadRunAt, saveRun, readyNodes,
} from './graph.mjs';
import {
  taskPath, taskDir, record, noDriver, taskState,
  advanceDispatches, serviceRunningDispatches, prepareReadyIntegrations,
  dispatchSettled, foldChild, serviceSRun, delegateIfSmall,
  finish, composeTaskPrompt, briefingPath, autoRepair, autoRetryPackages, autoRejudge, autoResumeCapacity,
  STAGE_SKILLS, syncTickets, autoReshape, promoteManagerHumanGates, enforceBudget,
} from './taskmanager.mjs';
import { ticketSnapshot } from './tickets.mjs';
import { pluginDirArgs, isEntryPoint } from './pluginroots.mjs';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--task') out.task = argv[++i];
  }
  return out;
}

// This file is both the daemon executable and a small library (judgeArgv is tested directly).
// Importing it must therefore not exit: the --task guard and the run-the-loop tail below are
// gated on being the process entry point, the way any dual-purpose Node module is.
//
// isEntryPoint (pluginroots.mjs, already imported below for pluginDirArgs) realpath-resolves
// both sides rather than comparing raw strings - taskmanager.mjs's spawnDaemon builds this
// process's own argv from ITS `import.meta.url` (daemonPath()), so a symlinked plugin path
// (macOS's $TMPDIR -> /private/var, or an installed-marketplace layout) reaches this file's
// argv[1] exactly as symlinked; without realpath on both sides this guard decides "not main"
// and the daemon exits having driven nothing - the same failure taskmanager.mjs's own `isMain`
// guard had (3c5ad0c8), one process down.
const RUN_AS_MAIN = isEntryPoint(import.meta.url);
const TASK_ID = parseArgs(process.argv.slice(2)).task;
if (RUN_AS_MAIN && !TASK_ID) {
  process.stderr.write('daemon.mjs: --task <task_id> is required\n');
  process.exit(1);
}

function loadTask() {
  return loadRunAt(taskPath(TASK_ID));
}

// ---------- judge(): the one place this process asks a model anything ----------

// Test seam, exactly like HARNESS_CHILD_DRIVER for a package driver: replaces the whole judge
// command line so a test can hand back canned NDJSON instead of a real `claude -p` call. A test
// that wants the daemon to run at all (most do not - HARNESS_TEST_NO_LEADER/HARNESS_TEST_NO_DAEMON
// keeps it from spawning in the first place) sets this to a fixture script.
// A judge call is a `claude -p` this process awaits directly, so a child that never closes its
// stdio wedges the whole daemon - and a wedged daemon is invisible: it holds no session, writes
// no stream, and keeps a task 'running' forever. One orphan lived 2h37m this way, still awaiting
// a close event for a task whose directory had already been deleted. broker.mjs's runAdapter
// already had this guard (BROKER_NODE_TIMEOUT_MS, SIGTERM then SIGKILL); judge() did not.
const JUDGE_TIMEOUT_MS = Number(process.env.HARNESS_JUDGE_TIMEOUT_MS) > 0
  ? Number(process.env.HARNESS_JUDGE_TIMEOUT_MS)
  : 45 * 60 * 1000;

export function judgeArgv(task = null) {
  const override = String(process.env.HARNESS_JUDGE_DRIVER || '').trim();
  if (override) return override.split(/\s+/);
  const argv = ['claude', '-p', '--output-format', 'stream-json', '--verbose',
    '--dangerously-skip-permissions', '--setting-sources', 'project'];
  if (process.env.CLAUDE_PLUGIN_ROOT) argv.push('--plugin-dir', process.env.CLAUDE_PLUGIN_ROOT);
  // The manager's own stage skills (shape/critique/accept/integrate/gate:goal) live in other
  // plugins; without their directories the judge is told to load skills it cannot see.
  argv.push(...pluginDirArgs({
    skills: [Object.values(STAGE_SKILLS), task && task.stage_skills].filter(Boolean),
    extraDirs: (task && task.team && task.team.opts && task.team.opts.plugin_dirs) || [],
  }));
  return argv;
}

// Reads `claude -p --output-format stream-json`'s NDJSON stdout for its last `result` event's
// text - the same read driverUsageLimitText (taskmanager.mjs) does on a driver's own log, here
// applied to a judge call's own stdout instead of a file, since a judge call is a one-shot child
// process this function awaits directly rather than a detached driver polled later.
function lastResultText(stdout) {
  let last = null;
  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue;
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (e && e.type === 'result') last = e;
  }
  return last && typeof last.result === 'string' ? last.result : '';
}

// A judge's reply is asked to be "that JSON object and nothing else" (composeTaskPrompt), but a
// model reply is prose the way a person's is: a code fence around it, a sentence before it. Take
// the first `{`..last `}` span rather than trust the whole string is clean JSON - the same
// forgiveness a human relaying a fresh agent's JSON "verbatim" effectively gave it by fixing it
// up when it was not.
function extractJson(text) {
  const s = String(text || '');
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) throw new Error('no JSON object found in the reply');
  return JSON.parse(s.slice(start, end + 1));
}

// A judge call's stdout is the same stream-json a package driver writes, so it is kept beside
// theirs under <taskDir>/drivers/ as judge_<node>.stream.jsonl: collectDriverCosts then counts
// shape/critique/accept/integrate/gate:goal the same way it counts a package - budget_usd's stop
// and the report's cost line both undercounted by every manager-level call before this. The
// judge_ prefix keeps packageCostRollup's dispatch_<pkg>_ grouping untouched. A second call for
// the same node id gets its own file, since only a file's LAST result event is counted.
function keepJudgeLog(task, n, out) {
  if (!out) return;
  try {
    const dir = join(taskDir(task.run_id), 'drivers');
    mkdirSync(dir, { recursive: true });
    const base = `judge_${String(n.node_id).replace(/[^A-Za-z0-9._-]/g, '_')}`;
    let p = join(dir, `${base}.stream.jsonl`);
    for (let i = 1; existsSync(p); i++) p = join(dir, `${base}.r${i}.stream.jsonl`);
    writeFileSync(p, out);
  } catch { /* the verdict still stands without its log */ }
}

// One single-shot `claude -p` call for one judging node: the same briefing a fresh agent would
// have been handed (briefing_path), the same Required-output contract, run headless and parsed
// back into the JSON finish() expects. stage_ok:false on any failure to get one - a judge that
// could not judge is not a verdict on the work, and finish()/succeeded() already treat
// stage_ok:false as a plain failed node, retryable the same way any other one is.
async function judge(task, n) {
  const prompt = composeTaskPrompt(task, n);
  try {
    const p = briefingPath(task, n);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, prompt);
  } catch { /* tm_status full is the fallback view */ }
  const argv = judgeArgv(task);
  const extra = [];
  if (task.child_opts && task.child_opts.model) extra.push('--model', task.child_opts.model);
  return new Promise((resolve) => {
    let out = '';
    let err = '';
    let proc;
    try {
      proc = spawn(argv[0], [...argv.slice(1), ...extra, prompt], { cwd: task.cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      resolve({ stage_ok: false, judge_failed: true, reason: `judge process for ${n.node_id} could not start: ${String((e && e.message) || e)}` });
      return;
    }
    // settle() guarantees exactly one resolve no matter which of close / error / timeout wins,
    // and clears the timer so a finished judge cannot leave the process alive on a pending handle.
    let settled = false;
    const settle = (v) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(v);
    };
    const timer = setTimeout(() => {
      // SIGTERM first, SIGKILL after a grace period: the same escalation runAdapter uses, for the
      // same reason - a child mid-write should get the chance to finish the line it is on.
      try { proc.kill('SIGTERM'); } catch { /* already gone */ }
      setTimeout(() => { try { proc.kill('SIGKILL'); } catch { /* already gone */ } }, 5000).unref();
      settle({
        stage_ok: false,
        judge_failed: true,
        reason: `judge process for ${n.node_id} did not finish within ${Math.round(JUDGE_TIMEOUT_MS / 60000)}m and was killed. `
          + `stderr: ${err.slice(-300)}`,
      });
    }, JUDGE_TIMEOUT_MS);
    // spawn reports ENOENT and friends asynchronously, not by throwing: without this the promise
    // never settles when the judge binary is missing, which looks exactly like a hang.
    proc.on('error', (e) => settle({
      stage_ok: false,
      judge_failed: true,
      reason: `judge process for ${n.node_id} failed to run: ${String((e && e.message) || e)}`,
    }));
    proc.stdout.on('data', (d) => { out += d; });
    proc.stderr.on('data', (d) => { err += d; });
    proc.on('close', () => {
      keepJudgeLog(task, n, out);
      const text = lastResultText(out);
      try {
        settle(extractJson(text));
      } catch (e) {
        settle({
          stage_ok: false,
          judge_failed: true,
          reason: `judge reply for ${n.node_id} was not valid JSON: ${String((e && e.message) || e)}. `
            + `stderr: ${err.slice(-300)} raw: ${text.slice(0, 500)}`,
        });
      }
    });
  });
}

// ---------- the loop ----------

// fs.watch is best-effort: a rename-based watch can silently miss an event on some filesystems
// (NFS, several CI containers), so a bare watch-only wait can wedge forever on a missed write.
// The fallback timer is the safety net, not the mechanism - 15s is short enough that a daemon
// stuck on a missed event self-heals inside the time a person would wait before checking
// tm_status by hand, and long enough that it is not a disguised poll loop.
const FALLBACK_WAIT_MS = 15000;

function watchDir(dir, onChange) {
  try {
    if (!existsSync(dir)) return null;
    return watch(dir, { persistent: false }, onChange);
  } catch {
    return null; // best-effort, like every other fs watcher in this plugin
  }
}

// Resolves the moment something this daemon is waiting on changes: a running dispatch's own
// child-run directory (its broker writes run.json there on every node it finishes - §4's "child
// run file changes"), or this task's own drivers/daemon directories (spawnChildDriver's 'exit'
// listener - registered when THIS process opened the driver via advanceDispatches - appends the
// exit file there the moment a driver process dies - §4's "child driver process exit"). Falls
// back to FALLBACK_WAIT_MS if nothing fires first.
function waitForProgress(task) {
  return new Promise((resolve) => {
    let settled = false;
    const watchers = [];
    const finishWait = () => {
      if (settled) return;
      settled = true;
      for (const w of watchers) { try { w.close(); } catch { /* already closed */ } }
      clearTimeout(timer);
      resolve();
    };
    const dd = watchDir(join(taskDir(TASK_ID), 'drivers'), finishWait);
    if (dd) watchers.push(dd);
    for (const n of task.nodes) {
      if (n.stage === 'dispatch' && n.state === 'running' && n.child && n.child.cwd) {
        const w = watchDir(join(n.child.cwd, '.teams_output', 'broker', 'runs'), finishWait);
        if (w) watchers.push(w);
      }
    }
    if (task.s_run && task.s_run.cwd) {
      const w = watchDir(join(task.s_run.cwd, '.teams_output', 'broker', 'runs'), finishWait);
      if (w) watchers.push(w);
    }
    // This timer is deliberately ref()'d and the watchers are deliberately NOT what keeps the
    // process alive: fs.watch handles here are non-persistent and Node exits with code 0 the
    // moment its event loop holds nothing ref'd - even inside a pending await. seam-beta-D1
    // (2026-09-21) died exactly that way, one second after dispatching P1: an unref()'d timer here
    // was the only handle left, so the daemon "finished" mid-wait with nothing in stderr, and so
    // did both restarts. The child ran every node to done and nobody was left to fold it.
    const timer = setTimeout(finishWait, FALLBACK_WAIT_MS);
  });
}

// board.jsonl is a before/after diff of a mutation, the same mechanism the MCP tool boundary
// uses - but since v0.16.0 the daemon owns the loop, so the tools that hook it are no longer the
// thing that moves a ticket. The board therefore froze at tm_open: idol-pm-1 (2026-09-22) ran 81
// minutes and 25 nodes and its PLAN story still read READY. One wrapper around stepOnce, not a
// dozen instrumented mutation sites, for exactly the reason appendBoardTransitions already gives.
async function stepOnce(task) {
  const before = ticketSnapshot(task);
  try {
    return await stepOnceInner(task);
  } finally {
    try { syncTickets(task, before, 'daemon'); } catch { /* evidence, not a dependency */ }
  }
}

async function stepOnceInner(task) {
  // Size S: no manager-level node is left to judge once `size` has resolved (delegateIfSmall
  // already skipped shape/critique) - the whole task is now the one child run at task.s_run, and
  // this daemon's only job is keeping ITS driver alive.
  if (task.s_run) {
    if (serviceSRun(task)) saveRun(task);
    return false;
  }

  let progressed = false;
  // A judge that could not judge is re-judged before anything reads its non-verdict as a
  // refusal; a driver parked on a provider's reset time is respawned once that time has passed.
  if (autoRejudge(task)) progressed = true;
  if (autoResumeCapacity(task)) progressed = true;
  // Budget/timebox (§B.1): checked before advanceDispatches so a stop that trips THIS tick
  // already refuses THIS tick's dispatch, not just the next one.
  if (enforceBudget(task)) { saveRun(task); progressed = true; }
  if (advanceDispatches(task)) { saveRun(task); progressed = true; }
  if (serviceRunningDispatches(task)) saveRun(task);
  if (prepareReadyIntegrations(task)) progressed = true;
  // gate:human (D2 Task 4): a judging node human_gates named must never reach judge() below -
  // this daemon has no tool boundary a session's tm_next could have caught it at, so this is
  // the one place that matters for an autonomous run. Interactive parks it (readyNodes no
  // longer offers it, the same way a pinned author stage already does not); non-interactive
  // auto-passes it through finish() directly, counted as progress like every other fold.
  if (promoteManagerHumanGates(task).autoPass.length) progressed = true;

  // Fold every dispatch whose child has stopped running - foldChild + finish() is exactly what
  // tm_submit does for a dispatch node with no payload; this is that same call, made directly
  // instead of relayed through a tool call.
  for (const n of task.nodes) {
    if (n.stage !== 'dispatch' || n.state !== 'running' || !n.child) continue;
    if (!dispatchSettled(task, n)) continue;
    let result;
    try {
      result = foldChild(task, n);
    } catch (e) {
      // foldChild throws when the child is in fact still running (a driver alive, a capacity
      // park). dispatchSettled and foldChild read the child file separately, so the two can
      // disagree across a write; that is "not yet", never a reason for the daemon to die.
      record(task, { event: 'daemon_fold_deferred', task_id: task.run_id, node_id: n.node_id, reason: String((e && e.message) || e).slice(0, 300) });
      continue;
    }
    finish(task, n, result);
    progressed = true;
  }

  // Judge every ready reasoning node - size, shape, critique, accept, integrate, gate, report -
  // one single-shot claude -p each, exactly the fresh agent a briefing_path was always meant for.
  for (const n of readyNodes(task)) {
    if (n.stage === 'dispatch') continue; // opened above, not judged
    const result = await judge(task, n);
    const out = finish(task, n, result);
    // finish() alone does not delegate a size-S task to its own run - toolOpen/toolSubmit did
    // that by calling delegateIfSmall right after finish() for the size node, and the daemon has
    // to make the same call itself since it is not going through either tool handler.
    if (n.stage === 'size') delegateIfSmall(task, n, out);
    progressed = true;
  }

  // An integrate that refused on its checks leaves the graph "blocked" by node state alone, but
  // the task is not done: open the repair package (budgeted by max_retries) the way a caller's
  // tm_retry({package_id: "integration"}) would, and keep driving.
  if (autoRepair(task)) progressed = true;
  // A package whose attempt failed (dispatch folded blocked, or accept rejected) gets its next
  // attempt the way tm_retry({package_id}) would give it, while max_retries allows.
  if (autoRetryPackages(task)) progressed = true;
  // A shape or critique that failed gets its next attempt the same way, carrying the verdict
  // that refused it - otherwise the loop stops at a critique it could act on.
  if (autoReshape(task)) progressed = true;

  return progressed;
}

async function main() {
  for (;;) {
    const task = loadTask();
    if (!task) {
      record({ run_id: TASK_ID, store_path: taskPath(TASK_ID) }, { event: 'daemon_task_missing', task_id: TASK_ID });
      return;
    }
    const progressed = await stepOnce(task);
    let fresh = loadTask();
    if (!fresh) {
      // loadRunAt returns null on a parse error too, and another process (tm_submit, tm_wait's
      // serviceDaemon) may be mid-write on task.json. That is a torn read, not a deleted task:
      // re-read after a beat, and only give up when the file itself is gone.
      await new Promise((r) => setTimeout(r, 250));
      fresh = loadTask();
      if (!fresh) {
        if (!existsSync(taskPath(TASK_ID))) return;
        record({ run_id: TASK_ID, store_path: taskPath(TASK_ID) }, { event: 'daemon_torn_read', task_id: TASK_ID });
        continue;
      }
    }
    if (taskState(fresh).state !== 'running') {
      record(fresh, { event: 'daemon_done', task_id: TASK_ID, state: taskState(fresh).state });
      return;
    }
    if (!progressed) await waitForProgress(fresh);
  }
}

// noDriver() doubles as the daemon's own "never spawn a real claude -p" test seam here too: a
// test that disables driver spawning does not want a real judge call either, and HARNESS_JUDGE_DRIVER
// is there for the narrower case of a test that wants the daemon to run but with a fake judge.
if (RUN_AS_MAIN) {
  if (noDriver() && !process.env.HARNESS_JUDGE_DRIVER) {
    process.stderr.write('daemon.mjs: HARNESS_TEST_NO_DRIVER is set with no HARNESS_JUDGE_DRIVER override; exiting without driving anything.\n');
    process.exit(0);
  } else {
    main().catch((e) => {
      process.stderr.write(`daemon.mjs: ${String((e && e.stack) || e)}\n`);
      process.exit(1);
    });
  }
}
