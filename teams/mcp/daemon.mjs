#!/usr/bin/env node
// daemon.mjs - the server owns the loop (_repo/docs/plans/2026-09-21-teams-server-owns-the-loop.md).
//
// One task, one daemon: `node daemon.mjs --task <task_id>` drives that task's graph to
// complete/blocked with no model in the loop except where a node genuinely needs judgment. It is
// spawned by taskmanager.mjs's spawnDaemon the same way a package's own driver is spawned -
// detached, unref()'d, its stdout/stderr captured to <taskDir>/daemon/ - because it has to
// outlive the client session that opened the task, exactly like every driver already had to.
//
// What replaced what: the TaskLeader used to be a `claude -p` session that read
// references/manager.md and called tm_next/tm_submit/tm_retry back into THIS SAME MCP server
// over stdio - 91 turns and $9.66 to relay JSON it never looked at (_repo/docs/plans, §1a). This
// process is not a client of that server at all. It imports taskmanager.mjs as a library and
// calls the functions a tool handler calls - advanceDispatches, finish, foldDispatch - directly, in
// process. The only thing here that still costs a model call is judge(): one single-shot
// `claude -p` per judging node (size, areas, shape, critique, accept, integrate, plan-integrate,
// gate, report), fed the
// exact briefing composeTaskPrompt already builds and required to return the exact JSON contract
// CONTRACT already asks for - the same work a "fresh agent" node the old leader spawned did.
//
// Zero dependencies, matching the rest of this plugin: no queue, no message bus, just task.json
// as the one shared truth a direct tm_submit/tm_retry from anywhere else can safely race against -
// written only through store.mjs's mutateTask (lock -> read fresh -> change -> write-then-rename).
// This process holds no task object across a phase, and none at all across `await judge`.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, watch } from 'node:fs';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { loadRunAt } from './graph.mjs';
import { mutateTask, LockTimeoutError } from './store.mjs';
import { applySuspends } from './taskstate.mjs';
import { pidAlive } from './proc.mjs';
import {
  taskPath, taskDir, record, noDriver, taskState,
  advanceDispatches, serviceRunningDispatches, prepareReadyIntegrations,
  dispatchSettled, foldDispatch, readyToJudge, serviceSRun, delegateIfSmall,
  finish, composeTaskPrompt, briefingPath, autoRepair, autoRetryPackages, autoRejudge, autoResumeCapacity, pendingRejudgeAt,
  STAGE_SKILLS, syncTickets, autoReshape, closeFailedPlanning, promoteManagerHumanGates, enforceBudget,
  expireAsks, nextAskDeadline, writeWikiLog,
} from './taskmanager.mjs';
import { ticketSnapshot } from './tickets.mjs';
import { harvestTask } from './runlog.mjs';
import { pluginDirArgs, isEntryPoint, teamsPluginRoot } from './pluginroots.mjs';

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
  argv.push('--plugin-dir', teamsPluginRoot());
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

// A refusal nobody can act on is not a verdict. seam-beta-D2's integrate:1 refused with
// reason:null, gaps:null: the repair it opened had nothing to fix from, and the session had to
// tell the person "the integrate node reported no gap text". Such a reply is turned into a
// judge failure, which autoRejudge already asks again (at most JUDGE_ATTEMPTS_MAX times).
export function unexplainedRefusal(result) {
  if (!result || typeof result !== 'object' || result.judge_failed) return null;
  const refused = result.stage_ok === false || result.accept === false || result.verified === false || result.sound === false;
  if (!refused) return null;
  const said = (v) => (Array.isArray(v) ? v.some((x) => String(x == null ? '' : (typeof x === 'object' ? JSON.stringify(x) : x)).trim()) : String(v == null ? '' : v).trim() !== '');
  // Every field a contract uses to say WHY: integrate's own refusal lives in unowned/evidence
  // (code-sprint-S5's integrate:2 named P3/P4's missing work there, with reason and gaps absent) -
  // reading only reason/gaps turned a well-argued refusal into a "no reason" re-judge.
  // plan-integrate's refusal (cards-everywhere C4) names its cards and features in retry/
  // contradictions/uncovered/duplicates/new_areas, each of which finish() acts on directly.
  if (['reason', 'gaps', 'problems', 'blocking', 'unowned', 'evidence', 'conflicts', 'retry', 'contradictions', 'uncovered', 'duplicates', 'new_areas'].some((k) => said(result[k]))) return null;
  return { ...result, stage_ok: false, judge_failed: true, reason: 'the judge refused without a reason or gaps - a refusal nobody can act on; asked again' };
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
  // Judges never see the project wiki (wiki.mjs answers an empty tool list under this).
  const extra = [];
  if (task.child_opts && task.child_opts.model) extra.push('--model', task.child_opts.model);
  return new Promise((resolve) => {
    let out = '';
    let err = '';
    let proc;
    try {
      proc = spawn(argv[0], [...argv.slice(1), ...extra, prompt], { cwd: task.cwd, env: { ...process.env, TEAMS_WIKI_OFF: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
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
        const parsed = extractJson(text);
        settle(unexplainedRefusal(parsed) || parsed);
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
  // An ask deadline sooner than the fallback wakes the loop for it rather than up to 15s late.
  const askAt = nextAskDeadline(task);
  const waitMs = askAt === null ? FALLBACK_WAIT_MS : Math.max(250, Math.min(FALLBACK_WAIT_MS, askAt - Date.now() + 250));
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
    if (task.harness_run && task.harness_run.cwd) {
      // The graph plugin's run files: a harness node finishing wakes the daemon to read it.
      const w = watchDir(join(task.harness_run.cwd, '.harness-run', 'broker', 'runs'), finishWait);
      if (w) watchers.push(w);
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
    const timer = setTimeout(finishWait, waitMs);
  });
}

// board.jsonl is a before/after diff of a mutation, the same mechanism the MCP tool boundary
// uses - but since v0.16.0 the daemon owns the loop, so the tools that hook it are no longer the
// thing that moves a ticket. The board therefore froze at tm_open: idol-pm-1 (2026-09-22) ran 81
// minutes and 25 nodes and its PLAN story still read READY. One wrapper around stepOnce, not a
// dozen instrumented mutation sites, for exactly the reason appendBoardTransitions already gives.
// Takes the task id (a task object is accepted for its run_id): the step holds no snapshot - each
// phase reads task.json fresh inside its own mutateTask, and the before/after board diff reads
// committed state. Exported for test-store-interleave.mjs, where `judge` is injected.
export async function stepOnce(taskRef, opts = {}) {
  const taskId = typeof taskRef === 'string' ? taskRef : taskRef.run_id;
  const start = loadRunAt(taskPath(taskId));
  const before = start ? ticketSnapshot(start) : {};
  try {
    return await stepOnceInner(taskId, opts.judge || judge);
  } finally {
    try { const after = loadRunAt(taskPath(taskId)); if (after) syncTickets(after, before, 'daemon'); } catch { /* evidence, not a dependency */ }
  }
}

// ---------- judge compare-and-set (2026-10-02 task-store review, U5) ----------
//
// A judge call takes minutes; a tm_submit / tm_retry / autoRejudge can move the node meanwhile.
// So no task object survives the await: one transaction stamps n.judging {pid, token, attempt,
// reopened, at} (+ judge_start) right before that node's judge, and another applies the verdict
// only if the fresh node is still pending at the same attempt and reopened count and still holds
// the token. Anything else is judge_superseded (ledger + n.judge_superseded) and the verdict is
// dropped - including the size node's delegateIfSmall, which spawns the harness driver and so
// belongs to the apply, never to a dropped verdict (critique N2).

// Tokens this process is judging right now: a stamp with our pid and a token not in here is a
// previous incarnation of this pid (pid reuse after a crash), so stale.
const heldJudging = new Set();

function liveJudging(j, now = Date.now()) {
  if (!j || !j.token) return false;
  if (!(now - (Number(j.at) || 0) < JUDGE_TIMEOUT_MS)) return false;
  if (j.pid === process.pid) return heldJudging.has(j.token);
  return pidAlive(j.pid);
}

function judgeable(t, nodeId) {
  return readyToJudge(t).find((x) => x.node_id === nodeId && x.stage !== 'dispatch') || null;
}

// Stamp one node, inside a transaction. Returns {stamp, task, node} as clones for the judge to
// compose its prompt from, or null when the node is no longer judgeable or another live owner is
// judging it.
function stampJudging(taskId, nodeId) {
  return mutateTask(taskId, (t) => {
    const n = judgeable(t, nodeId);
    if (!n) return null;
    if (n.judging) {
      if (liveJudging(n.judging)) return null;
      record(t, { event: 'judge_reclaimed', task_id: t.run_id, node_id: nodeId, pid: n.judging.pid, token: n.judging.token });
    }
    const stamp = { pid: process.pid, token: randomUUID(), attempt: n.attempt || 1, reopened: n.reopened || 0, at: Date.now() };
    n.judging = stamp;
    heldJudging.add(stamp.token);
    record(t, { event: 'judge_start', task_id: t.run_id, node_id: nodeId, stage: n.stage, token: stamp.token, attempt: stamp.attempt, reopened: stamp.reopened });
    const task = structuredClone(t);
    return { stamp, task, node: task.nodes.find((x) => x.node_id === nodeId) };
  });
}

function supersededReason(f, stamp) {
  if (!f) return 'node is gone';
  if (f.state !== 'pending') return `node is ${f.state}`;
  if ((f.attempt || 1) !== stamp.attempt) return `attempt ${f.attempt || 1}, judged at ${stamp.attempt}`;
  if ((f.reopened || 0) !== stamp.reopened) return `reopened ${f.reopened || 0}, judged at ${stamp.reopened}`;
  if (!f.judging || f.judging.token !== stamp.token) return 'judging stamp replaced';
  return null;
}

function applyJudged(taskId, nodeId, stamp, result) {
  try {
    return mutateTask(taskId, (t) => {
      const f = t.nodes.find((x) => x.node_id === nodeId);
      const reason = supersededReason(f, stamp);
      if (reason) {
        if (f) {
          if (f.judging && f.judging.token === stamp.token) delete f.judging;
          f.judge_superseded = (f.judge_superseded || []).concat([{ token: stamp.token, at: Date.now(), reason }]);
        }
        record(t, { event: 'judge_superseded', task_id: t.run_id, node_id: nodeId, token: stamp.token, reason,
          state: f ? f.state : null, attempt: f ? (f.attempt || 1) : null });
        return { superseded: true };
      }
      delete f.judging;
      const out = finish(t, f, result);
      // finish() alone does not delegate a size-S task to its own run - toolSubmit calls
      // delegateIfSmall right after finish() for the size node, and the daemon makes the same
      // call here, on the fresh node, only for a verdict that was applied.
      if (f.stage === 'size') delegateIfSmall(t, f, out);
      return { superseded: false };
    });
  } finally {
    heldJudging.delete(stamp.token);
  }
}

function clearJudging(taskId, nodeId, stamp) {
  try {
    mutateTask(taskId, (t) => {
      const f = t.nodes.find((x) => x.node_id === nodeId);
      if (f && f.judging && f.judging.token === stamp.token) delete f.judging;
    });
  } finally {
    heldJudging.delete(stamp.token);
  }
}

async function stepOnceInner(taskId, judgeFn) {
  const tx = (fn) => mutateTask(taskId, fn);
  // Sleep/wake first: a suspend since the last tick is recorded before the ask timeout, the stall
  // watchdog and the timebox below read the clock (taskstate.mjs applySuspends).
  tx((t) => applySuspends(t));
  // ask_timeout: this daemon is the clock for every `ask` card under the task - a parked child
  // has no driver to notice its own deadline (taskmanager.mjs's expireAsks).
  const expired = tx((t) => expireAsks(t).length > 0);
  // Size S: no manager-level node is left to judge once `size` has resolved (delegateIfSmall
  // skipped the rest) - the whole task is the development-harness run its one driver works, and
  // this daemon's only job is keeping that driver alive (and resuming it after a capacity park).
  // A legacy task.s_run (S2) is read, never driven: nothing to do here.
  const mode = tx((t) => {
    if (t.harness_run) {
      let changed = serviceSRun(t);
      if (autoResumeCapacity(t)) changed = true;
      return { harness: true, changed };
    }
    return { s: !!t.s_run };
  });
  if (mode.harness) return expired || mode.changed;
  if (mode.s) return expired;

  let progressed = expired;
  // A judge that could not judge is re-judged before anything reads its non-verdict as a
  // refusal; a driver parked on a provider's reset time is respawned once that time has passed.
  // Budget/timebox (§B.1): checked before advanceDispatches so a stop that trips THIS tick
  // already refuses THIS tick's dispatch, not just the next one.
  if (tx((t) => {
    let p = false;
    if (autoRejudge(t)) p = true;
    if (autoResumeCapacity(t)) p = true;
    if (enforceBudget(t)) p = true;
    return p;
  })) progressed = true;
  // advanceDispatches / prepareReadyIntegrations / foldDispatch own their transactions (claim ->
  // effect outside the lock -> apply).
  if (advanceDispatches(taskId)) progressed = true;
  tx((t) => serviceRunningDispatches(t));
  if (prepareReadyIntegrations(taskId)) progressed = true;
  // gate:human (D2 Task 4): a judging node human_gates named must never reach judge() below -
  // this daemon has no tool boundary a session's tm_next could have caught it at, so this is
  // the one place that matters for an autonomous run. Interactive parks it (readyNodes no
  // longer offers it, the same way a pinned author stage already does not); non-interactive
  // auto-passes it through finish() directly, counted as progress like every other fold.
  if (tx((t) => promoteManagerHumanGates(t).autoPass.length > 0)) progressed = true;

  // Fold every dispatch whose child has stopped running - foldChild + finish() is exactly what
  // tm_submit does for a dispatch node with no payload; this is that same call, made directly
  // instead of relayed through a tool call. Read-only view; foldDispatch re-reads and claims.
  const view = loadRunAt(taskPath(taskId)) || { run_id: taskId, nodes: [] };
  const foldable = view.nodes.filter((n) => n.stage === 'dispatch' && n.state === 'running' && n.child).map((n) => n.node_id);
  for (const nodeId of foldable) {
    const t = loadRunAt(taskPath(taskId));
    const n = t && t.nodes.find((x) => x.node_id === nodeId);
    if (!n || n.state !== 'running' || !n.child || !dispatchSettled(t, n)) continue;
    let out;
    try {
      out = foldDispatch(taskId, nodeId, 'daemon');
    } catch (e) {
      record(t, { event: 'daemon_fold_deferred', task_id: taskId, node_id: nodeId, reason: String((e && e.message) || e).slice(0, 300) });
      continue;
    }
    // Deferred: the child is in fact still running (a driver alive, a capacity park) -
    // dispatchSettled and foldChild read the child file separately, so the two can disagree
    // across a write; that is "not yet", never a reason for the daemon to die. Busy/lost: a
    // tm_submit folded (or is folding) it - its fold, not ours.
    if (out && out.deferred) {
      record(t, { event: 'daemon_fold_deferred', task_id: taskId, node_id: nodeId, reason: String(out.reason || '').slice(0, 300) });
      continue;
    }
    if (!out || out.busy || out.lost || out.idempotent || out.opening) continue;
    progressed = true;
  }

  // Judge every ready reasoning node - size, shape, critique, accept, integrate, gate, report -
  // one single-shot claude -p each, exactly the fresh agent a briefing_path was always meant for.
  // readyToJudge, not readyNodes: a node another caller holds a live claim on, or an integrate
  // whose preparation (merges, npm test) has not been applied yet, is not judged (critique N1).
  // The candidates are this moment's; each is re-checked and stamped in its own transaction just
  // before its own judge, and nothing read before the await is written after it.
  const candidates = readyToJudge(loadRunAt(taskPath(taskId)) || { nodes: [] })
    .filter((n) => n.stage !== 'dispatch').map((n) => n.node_id);
  for (const nodeId of candidates) {
    const s = stampJudging(taskId, nodeId);
    if (!s) continue;
    let result;
    try {
      result = await judgeFn(s.task, s.node);
    } catch (e) {
      // A clear that fails (ELOCKTIMEOUT) must not mask the judge's own error: the stamp it
      // leaves is reclaimed as stale later; the ledger keeps both, and the judge error surfaces.
      try {
        clearJudging(taskId, nodeId, s.stamp);
      } catch (clearErr) {
        record({ run_id: taskId }, {
          event: 'judging_clear_failed', task_id: taskId, node_id: nodeId, token: s.stamp.token,
          error: String((clearErr && clearErr.message) || clearErr).slice(0, 300),
          judge_error: String((e && e.message) || e).slice(0, 300),
        });
      }
      throw e;
    }
    applyJudged(taskId, nodeId, s.stamp, result);
    progressed = true;
  }

  // An integrate that refused on its checks leaves the graph "blocked" by node state alone, but
  // the task is not done: open the repair package (budgeted by max_retries) the way a caller's
  // tm_retry({package_id: "integration"}) would, and keep driving.
  // A package whose attempt failed (dispatch folded blocked, or accept rejected) gets its next
  // attempt the way tm_retry({package_id}) would give it, while max_retries allows.
  // A shape or critique that failed gets its next attempt the same way, carrying the verdict
  // that refused it - otherwise the loop stops at a critique it could act on.
  // Planning or shaping that failed for good closes to a report, not to a silent block (M2).
  if (tx((t) => {
    let p = false;
    if (autoRepair(t)) p = true;
    if (autoRetryPackages(t)) p = true;
    if (autoReshape(t)) p = true;
    if (closeFailedPlanning(t)) p = true;
    return p;
  })) progressed = true;

  return progressed;
}

// One step of the loop below, surviving a lock it could not get: a LockTimeoutError (a sleep
// mid-wait, a slow writer) used to reach main().catch and exit, leaving the task running with no
// daemon. Now it is a retry. daemon_lock_timeout is recorded once per streak, not per tick.
// Any other error propagates as before. Returns {ok, value}; ok false means "wait, try again".
export async function loopStep(taskId, streak, fn) {
  try {
    const value = await fn();
    streak.count = 0;
    return { ok: true, value };
  } catch (e) {
    if (!(e instanceof LockTimeoutError) && !(e && e.code === 'ELOCKTIMEOUT')) throw e;
    streak.count = (streak.count || 0) + 1;
    if (streak.count === 1) {
      record({ run_id: taskId }, { event: 'daemon_lock_timeout', task_id: taskId, path: e.path || null, owner: (e.owner && e.owner.pid) || null });
    }
    return { ok: false };
  }
}

async function main() {
  const streak = { count: 0 };
  const lockRetry = () => new Promise((r) => setTimeout(r, 1000));
  for (;;) {
    const task = loadTask();
    if (!task) {
      record({ run_id: TASK_ID, store_path: taskPath(TASK_ID) }, { event: 'daemon_task_missing', task_id: TASK_ID });
      return;
    }
    const step = await loopStep(TASK_ID, streak, () => stepOnce(TASK_ID));
    if (!step.ok) { await lockRetry(); continue; }
    const progressed = step.value;
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
      // The closers run at the TOP of a step; a node that failed at the end of this one (the goal
      // gate, code-sprint-S6) left the task blocked before enforceBudget ever saw it, and the
      // stopped Sprint ended with no report. Give them one look before calling it done.
      const closed = await loopStep(TASK_ID, streak, () => mutateTask(TASK_ID, (t) => enforceBudget(t)));
      if (!closed.ok) { await lockRetry(); continue; }
      if (closed.value) continue;
      // Not running is not finished while a failed judge still has a scheduled re-judge.
      const rejudgeAt = pendingRejudgeAt(fresh);
      if (rejudgeAt !== null) {
        await new Promise((r) => setTimeout(r, Math.max(1000, Math.min(rejudgeAt - Date.now() + 500, 60 * 1000))));
        continue;
      }
      // Nor while an `ask` card waits with an ask_timeout set: the whole graph parked on a person
      // (manager-level card, or a size-S run) leaves nothing else to drive, and exiting here would
      // leave nobody to answer it at its deadline. Sleep until then (capped, re-checked) instead.
      const askAt = nextAskDeadline(fresh);
      if (askAt !== null) {
        await new Promise((r) => setTimeout(r, Math.max(250, Math.min(askAt - Date.now() + 250, 60 * 1000))));
        continue;
      }
      const doneState = taskState(fresh);
      record(fresh, { event: 'daemon_done', task_id: TASK_ID, state: doneState.state,
        ...(doneState.partial ? { partial: true, partial_reasons: doneState.partial_reasons } : {}) });
      // An L task that ends blocked never reaches the report node's own call: log what shipped here,
      // before harvestTask so the run record carries task.wiki.log. Same-set repeats are no-ops.
      try { writeWikiLog(TASK_ID); } catch { /* a record, not a dependency */ }
      // Every task leaves a record past its project's .teams_output and /tmp (mcp/runlog.mjs,
      // read across runs by scripts/bench/triage.mjs). A failure to keep it never fails the task.
      if (!noDriver() || process.env.TEAMS_RUNS_DIR) {
        try {
          const kept = harvestTask({ taskDir: dirname(taskPath(TASK_ID)), cwd: fresh.cwd });
          if (kept) record(fresh, { event: 'run_logged', task_id: TASK_ID, path: kept.out, failures: kept.summary.failures.length });
        } catch (e) {
          record(fresh, { event: 'run_log_failed', task_id: TASK_ID, error: String(e && e.message || e).slice(0, 300) });
        }
      }
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
