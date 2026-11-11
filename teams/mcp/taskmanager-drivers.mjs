// taskmanager-drivers.mjs - child driver and daemon processes; split out of taskmanager.mjs (card 128 step 1), moved verbatim.
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, statSync } from 'node:fs';
import { skillPluginDirs } from './pluginroots.mjs';
import { leanLaunchArgs, resolveStageModel, stageSkillList } from './nodelaunch.mjs';
import { storyKey } from './tickets.mjs';
import { __clock, countedDriverRestarts, driverAlive, harnessState, record, restartBudget, stampAfterWake, taskDir, tasksRoot, unfinishedWork } from './taskstate.mjs';
import { spawn } from 'node:child_process';
import { loadRun, peekHumanActions, runState, saveRun } from './graph.mjs';
import { TEAM_DEFAULTS } from './teamconfig.mjs';
import { fileURLToPath } from 'node:url';
import { HARNESS_SKILLS } from './taskmanager-harness.mjs';
import { deliverStoryAnswers, storyAsksOf } from './taskmanager-asks.mjs';
import { reserveSpawn, respawnDriver, spawning } from './taskmanager-claims.mjs';
import { noDriver } from './taskmanager-worktree.mjs';
import { pendingRejudgeAt } from './taskmanager-repair.mjs';

// ---------- child driver processes ----------

// Recursion by process, not by tool call. When the session that drives the manager also drives
// every child node, one L task pushed 54 node briefings and their result JSONs through a single
// context - 507k tokens, 331 turns, and a run that died on the session's usage limit. So a ready
// dispatch spawns its own headless session in the package worktree, which runs the ordinary
// graph loop to the end; the manager waits and folds the result. Manager context per package:
// a few lines.

// The opening session's id, read live: /clear and /resume change it while this MCP process keeps
// its spawn-time env. The client writes <ppid>.json (camelCase sessionId); env is the fallback.
function currentSessionId() {
  try {
    const dir = process.env.TEAMS_SESSIONS_DIR || join(homedir(), '.claude', 'sessions');
    const id = JSON.parse(readFileSync(join(dir, `${process.ppid}.json`), 'utf8')).sessionId;
    if (typeof id === 'string' && id) return id;
  } catch { /* missing, unreadable or not JSON: use the env */ }
  return process.env.CLAUDE_CODE_SESSION_ID || null;
}

// The person's session id for a child process, read from the task record, not this process's env.
export function openerEnv(task) {
  const id = task && task.opener && task.opener.session_id;
  return id ? { TEAMS_OPENER_SESSION_ID: id, TEAMS_TASK_ID: task.run_id } : {};
}

// The model and lean part of a `claude -p` launch (card 130), shared by every spawn site whose
// argv is ours: one explicit --model, then nodelaunch.mjs's lean args. tm_open's model
// (child_opts.model) still wins over the stage's resolved model. The caller's base argv already
// carries `--setting-sources project`, so the lean args' copy is dropped rather than repeated.
// opts: { scope, skills (stage_skills override), plugin_dirs, root }.
export function launchArgs(stage, task, opts = {}) {
  const t = task || {};
  const model = (t.child_opts && t.child_opts.model)
    || resolveStageModel(stage, { models: t.team && t.team.opts && t.team.opts.models });
  const lean = leanLaunchArgs(stage, {
    scope: opts.scope,
    stage_skills: opts.skills === undefined ? t.stage_skills : opts.skills,
    plugin_dirs: opts.plugin_dirs || (t.team && t.team.opts && t.team.opts.plugin_dirs) || [],
    root: opts.root,
  });
  const i = lean.indexOf('--setting-sources');
  if (i >= 0) lean.splice(i, 2);
  return ['--model', model, ...lean];
}

const skillsIn = (x) => (Array.isArray(x) ? x : x && typeof x === 'object' ? Object.values(x).flat() : []);

export function driverArgv(task = null, o = {}) {
  // Tests (and anyone with a different CLI) replace the whole command line here; the prompt is
  // always appended as the last argument.
  const override = String(process.env.HARNESS_CHILD_DRIVER || '').trim();
  if (override) return override.split(/\s+/);
  const argv = ['claude', '-p', '--output-format', 'stream-json', '--verbose',
    '--dangerously-skip-permissions', '--setting-sources', 'project'];
  // This server is launched with CLAUDE_PLUGIN_ROOT when it runs from a --plugin-dir; the child
  // needs the same directory to see the same plugin. Without it the plugin is installed. And
  // every plugin the graph's method tables name (pluginroots.mjs): --setting-sources project
  // hides the user's installed plugins, so without these the child's nodes never see a single
  // skill they are told to load - which is how every bench run before 0.18.0 ran (skills_used
  // none). A driver runs graph nodes, never a manager judge, so STAGE_SKILLS' plugins stay out.
  const team = (task && task.team && task.team.opts) || {};
  argv.push(...launchArgs('driver', task, {
    skills: { driver: [...stageSkillList('driver', {}), ...skillsIn(task && task.child_opts && task.child_opts.skills), ...skillsIn(task && task.stage_skills), ...(o.harness ? HARNESS_SKILLS : [])] },
    plugin_dirs: skillPluginDirs({
      skills: [task && task.child_opts && task.child_opts.skills, task && task.stage_skills, o.harness ? HARNESS_SKILLS : null].filter(Boolean),
      extraDirs: team.plugin_dirs || [],
    }),
  }));
  return argv;
}

// The child's request and context are already in its run file. This says only which run to
// continue and how to drive it - the same words that resume an interrupted bench workspace.
// opts.resume marks a driver spawned in place of one that died before the run finished: the
// run and its worktree already carry whatever that attempt completed, so the new session is
// told to read team_status first rather than redo work.
function driverPrompt(task, child, opts = {}) {
  const o = task.child_opts || {};
  const routing = [
    o.host_vendor ? `host_vendor ${o.host_vendor}` : '',
    o.host_model ? `host_model ${o.host_model}` : '',
    Array.isArray(o.native_models) && o.native_models.length ? `native_models ${o.native_models.join(', ')}` : '',
  ].filter(Boolean);
  // A STORY's own driver may ask its TeamLeader (tm_ask) and is then parked; the resume carries
  // every answered question verbatim.
  const story = task.nodes.find((x) => x.stage === 'dispatch' && x.child && x.child.run_id === child.run_id);
  const answers = (opts.asks || []).map((a) => `Your question (ask_id ${a.ask_id}): ${a.question}\nAnswer from ${a.by === 'person' ? 'the person' : 'the TeamLeader'}: ${a.answer}`);
  return [
    `Use the teams:orchestrate skill, but CONTINUE the graph run that is already open instead of opening one:`,
    `run_id ${child.run_id} at cwd ${child.cwd}. Do not call team_open or tm_open.`,
    answers.length
      ? `A previous driver for this exact run parked on a question and is replaced by you; call team_status({run_id, cwd}) first, then continue from there - do not redo a node that is already done.\n${answers.join('\n')}`
      : opts.resume
        ? `A previous driver for this exact run died before it finished; call team_status({run_id, cwd}) first to see what it already completed, and resume from there - do not redo a node that is already done.`
        : '',
    story && story.subgoal_id
      ? `If a question blocks you that neither your briefing nor the plan settles, call tm_ask({task_id: "${task.run_id}", key: "${storyKey(task.run_id, story.subgoal_id)}", question}) once with the whole question, then end your turn at once: you are parked at no cost and resumed with the answer. Do not guess and do not poll.`
      : '',
    `Read references/loop.md, then drive team_next/team_run/team_submit exactly as it says until the run is`,
    `complete or blocked - a fresh agent for every ready node, its JSON relayed verbatim to team_submit,`,
    `team_retry as the loop says.`,
    routing.length ? `Pass ${routing.join(', ')}.` : '',
    `Never end a turn while your own background agent or test run is still running; wait for it to finish first.`,
    `End with the skill's output template.`,
  ].filter(Boolean).join(' ');
}

// nodeIdLabel names the log files under <taskDir>/drivers/ (a package's node_id, or "S" for a
// size-S task's single run). child is the {cwd, run_id} pointer - n.child for a package,
// task.s_run for a size-S task; both are plain objects the caller can keep mutating (driver,
// spawn_count, restarts, waiting_capacity) after this returns.
function spawnChildDriver(task, nodeIdLabel, child, opts = {}) {
  const dir = join(taskDir(task.run_id), 'drivers');
  const base = String(nodeIdLabel).replace(/[^A-Za-z0-9._-]/g, '_');
  const attempt = Number.isInteger(opts.attempt) ? opts.attempt : 0;
  const suffix = attempt > 0 ? `.restart${attempt}` : '';
  const log = join(dir, `${base}${suffix}.stream.jsonl`);
  const stderr = join(dir, `${base}${suffix}.stderr.txt`);
  const exitFile = join(dir, `${base}${suffix}.exit.json`);
  const argv = driverArgv(task, { harness: opts.harness === true });
  const command = argv.join(' ');
  let out = null;
  let err = null;
  try {
    mkdirSync(dir, { recursive: true });
    out = openSync(log, 'a');
    err = openSync(stderr, 'a');
    const env = { ...process.env };
    // A nested claude refuses to start inside a claude session, and resolving the tasks dir
    // keeps a relative HARNESS_TASKS_DIR pointing at the same place from the child's cwd.
    delete env.CLAUDECODE;
    // The own-write record is the size-S driver's alone (spawnHarnessDriver sets it via opts.env);
    // a package driver never inherits it from the parent.
    delete env.TEAMS_OWN_WRITES;
    delete env.TEAMS_OWN_RUN;
    if (process.env.HARNESS_TASKS_DIR) env.HARNESS_TASKS_DIR = tasksRoot();
    // The project wiki lives in the main project, never in a worktree a child may run in.
    env.TEAMS_WIKI_ROOT = task.cwd;
    Object.assign(env, openerEnv(task));
    // The adapter sessions of a package's run may tm_ask its TeamLeader: they name this task
    // (broker-tools askTarget); a size-S run has no STORY to ask for and inherits nothing.
    delete env.TEAMS_ASK_TASK_ID;
    if (task.nodes.some((x) => x.stage === 'dispatch' && x.child && x.child.run_id === child.run_id)) env.TEAMS_ASK_TASK_ID = task.run_id;
    // `claude -p` otherwise caps how long it waits on its own background agents at the end of a
    // turn; 0 makes the driver wait for them without a ceiling. An explicit opts.env may override.
    env.CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS = '0';
    if (opts.env) Object.assign(env, opts.env);
    const prompt = opts.prompt || driverPrompt(task, child, opts);
    const proc = spawn(argv[0], [...argv.slice(1), prompt], {
      cwd: child.cwd,
      env,
      detached: true,
      // stdin must be closed, not inherited: a nested `claude -p` waits forever on the parent's.
      stdio: ['ignore', out, err],
    });
    // Held only for this process's lifetime, and only useful while it is: a restart across an
    // MCP server restart has no exit code to record, which is fine - the stderr tail already
    // carries the evidence.
    try {
      proc.on('exit', (code, signal) => {
        try { appendFileSync(exitFile, JSON.stringify({ code, signal, at: Date.now() }) + '\n'); } catch { /* best-effort */ }
      });
    } catch { /* best-effort */ }
    proc.unref();
    return { pid: proc.pid || null, started_at: Date.now(), log, stderr, exit: exitFile, command };
  } catch (e) {
    return { pid: null, started_at: Date.now(), log, stderr, exit: exitFile, command, error: String((e && e.message) || e) };
  } finally {
    for (const fd of [out, err]) { try { if (fd !== null) closeSync(fd); } catch { /* already closed */ } }
  }
}

function killDriver(driver) {
  if (!driverAlive(driver)) return false;
  // detached:true made it a group leader, so the whole subtree goes. Best effort either way.
  try { process.kill(-driver.pid, 'SIGTERM'); return true; } catch { /* fall through */ }
  try { process.kill(driver.pid, 'SIGTERM'); return true; } catch { return false; }
}

export function driverStderrTail(driver, chars = 300) {
  if (!driver || !driver.stderr) return '';
  try {
    if (!statSync(driver.stderr).size) return '';
    return readFileSync(driver.stderr, 'utf8').slice(-chars).trim();
  } catch {
    return '';
  }
}

// The exit code/signal recorded by spawnChildDriver's own 'exit' listener, if this server
// process was still alive to hear it. null when unknown - a restart across server processes,
// or a driver still starting up.
function driverExitInfo(driver) {
  if (!driver || !driver.exit) return null;
  try {
    if (!existsSync(driver.exit)) return null;
    const lines = readFileSync(driver.exit, 'utf8').trim().split('\n').filter(Boolean);
    if (!lines.length) return null;
    return JSON.parse(lines[lines.length - 1]);
  } catch {
    return null;
  }
}

// Reads the driver's own stdout stream (NDJSON, `claude -p --output-format stream-json`) for
// its last `result` event, and returns that text only when it names a usage limit - the same
// pattern scripts/bench/drive.sh uses to tell a spent quota from an ordinary ending. A death
// with this text set is not the package's failure and must not spend a restart.
function driverUsageLimitText(driver) {
  if (!driver || !driver.log) return '';
  try {
    if (!existsSync(driver.log)) return '';
    const lines = readFileSync(driver.log, 'utf8').split('\n');
    let last = null;
    for (const line of lines) {
      if (!line.trim()) continue;
      let e;
      try { e = JSON.parse(line); } catch { continue; }
      if (e && e.type === 'result') last = e;
    }
    const text = last && typeof last.result === 'string' ? last.result : '';
    return /hit your [a-z0-9-]+ limit/i.test(text) ? text : '';
  } catch {
    return '';
  }
}

// The next spawn's attempt number for this child, for a unique log filename - shared by a
// budget restart and a reset_capacity restart so the two schemes never collide on one.
function nextSpawnAttempt(child) {
  const n = (Number.isInteger(child.spawn_count) ? child.spawn_count : 0) + 1;
  child.spawn_count = n;
  return n;
}

export function driverRestartsSpent(task, child) {
  const d = child && child.driver;
  if (!d || driverAlive(d) || child.waiting_capacity) return false;
  return countedDriverRestarts(task, d).length >= restartBudget(task);
}

// Called on every tm_next poll (and defensively from foldChild) for a package whose driver is
// no longer alive while its child run is still `running`. Distinguishes three cases:
//   - the driver died because a usage limit was hit: park it on `waiting_capacity`, spend no
//     restart, and wait for tm_retry({reset_capacity:true}).
//   - the driver died for any other reason and the restart budget is not spent: respawn a
//     driver on the SAME run_id with a resume prompt, and record the death on driver.restarts.
//   - the budget is spent: do nothing and let the dispatch fold blocked with every tail.
// Returns true when it changed anything (so the caller knows to persist the task).
export function serviceDeadDriver(task, child, nodeId) {
  const driver = child.driver;
  if (!driver || driverAlive(driver) || spawning(child)) return false;
  // A STORY parked on its question (tm_ask) is not a dead run: its driver exited on purpose. The
  // one thing it needs is the answer, once every question it asked has one (no restart spent).
  if (storyAsksOf(task, nodeId).length) return deliverStoryAnswers(task, nodeId, child);
  const run = loadRun(child.cwd, child.run_id);
  const cs = run ? runState(run) : { state: 'missing' };
  // A run parked on a human is not a dead run, and no driver is SUPPOSED to be alive while it
  // waits - that is the whole point of waiting_human (zero compute while waiting). But an answer
  // ALREADY QUEUED for it has nobody to apply it: the handoff queue is drained by the broker, the
  // broker only runs inside a driver, and tm_submit's own revive fires only on the call that
  // queues. idol-beta-ask1 (2026-09-25) is what that looks like - three answers accepted into the
  // queue, the driver killed before it drained them, and no path left that would ever bring one
  // back. So a parked child whose queue is not empty does need a driver; a parked child whose
  // queue is empty correctly gets none.
  if (cs.state === 'waiting_human') {
    if (!peekHumanActions(child.cwd, child.run_id).length) return false;
  } else if (cs.state === 'blocked' && run.routing_blocked_capacity && !child.waiting_capacity) {
    // Blocked only on spent vendor credit (the broker's routing_blocked_capacity): the same
    // park a usage-limit death gets, not a fold - a retry would probe the same empty account.
    child.waiting_capacity = { reason: String(run.routing_blocked_capacity).slice(0, 500), since: Date.now() };
    record(task, { event: 'child_driver_capacity', task_id: task.run_id, node_id: nodeId, pid: driver.pid, reason: child.waiting_capacity.reason.slice(0, 300), at_probe: true });
    return true;
  } else if (cs.state !== 'running') {
    return false; // the run finished; an ordinary fold reads that
  }
  if (child.waiting_capacity) return false; // already parked; reset_capacity is the way out
  const tail = driverStderrTail(driver, 2000);
  const usage = driverUsageLimitText(driver);
  const entry = { pid: driver.pid, exit: driverExitInfo(driver), at: Date.now(), stderr_tail: (usage || tail).slice(-300) };
  if (usage) {
    child.waiting_capacity = { reason: usage.slice(0, 500), since: Date.now() };
    record(task, { event: 'child_driver_capacity', task_id: task.run_id, node_id: nodeId, pid: driver.pid, reason: usage.slice(0, 300) });
    return true;
  }
  const budget = restartBudget(task);
  const priorRestarts = driver.restarts || [];
  const countedRestarts = countedDriverRestarts(task, driver);
  if (countedRestarts.length >= budget) return false; // budget spent (within the window, if any): fold it, do not respawn again
  const restarts = [...priorRestarts, stampAfterWake(task, priorRestarts, entry)];
  const attempt = nextSpawnAttempt(child);
  return respawnDriver(task, nodeId, child, {
    attempt, reason: 'restart', restarts,
    spawn: (t, c) => spawnChildDriver(t, nodeId, c, { resume: true, attempt }),
    event: (t, fresh) => ({ event: 'child_driver_restarted', task_id: t.run_id, node_id: nodeId, pid: fresh.pid, restart: restarts.length, budget }),
  });
}

// The mtime of whatever this child's own driver most recently touched - the same directory
// daemon.mjs's own waitForProgress already watches for this exact child (the broker's run file
// under .teams_output/broker/runs/), plus its ledger, which is cheap to stat and moves on every
// node the child's driver finishes even on a poll where the run file itself does not change
// (queueHumanAction and a few other paths append to the ledger without touching the run's own
// mtime). board.jsonl is TASK-level, not per-child (taskmanager.mjs's own board.jsonl, not a
// broker concept), so it is not read here. null when nothing has been written yet.
function childProgressMtime(child) {
  if (!child || !child.cwd || !child.run_id) return null;
  const candidates = [
    join(child.cwd, '.teams_output', 'broker', 'runs', `${child.run_id}.json`),
    join(child.cwd, '.teams_output', 'broker', 'ledger.jsonl'),
  ];
  let latest = null;
  for (const p of candidates) {
    try {
      const t = statSync(p).mtimeMs;
      if (latest === null || t > latest) latest = t;
    } catch { /* not written yet - fine, another candidate (or driver.started_at) covers it */ }
  }
  return latest;
}

// Driver LIVENESS is not driver PROGRESS: a pid that still answers process.kill(pid,0) can be a
// wedged model, a provider hang with no error text, or a tool call that never returns - none of
// which serviceDeadDriver ever sees, because it only runs once the pid is actually gone. This is
// the Temporal-heartbeat analogue for a driver this server does not control the inside of:
// stall_minutes (teamconfig.mjs, default 20, 0 disables) is read against childProgressMtime, the
// same files daemon.mjs's waitForProgress already watches for this child.
//
// idol-pm-4 (2026-09-2x) had a legitimate 16-minute gap between tool calls mid-run - killing on
// the first sign of quiet would have cut off a driver that was still working. So the first
// threshold only RECORDS the stall once (child_driver_stalled; child.stalled_since guards the
// repeat) and does nothing else. Only past 3x stall_minutes with STILL no progress does this
// kill the driver (child_driver_killed, reason 'stalled') - and it stops there. It does not
// respawn: the very next poll finds driverAlive() false and serviceDeadDriver's own path takes
// over, exactly as it would for a crash, spending a restart the same way.
//
// Returns true when it changed anything (so the caller knows to persist the task), same
// contract as serviceDeadDriver.
export function serviceStalledDriver(task, child, nodeId) {
  const driver = child.driver;
  if (!driver || !driverAlive(driver)) return false; // dead is serviceDeadDriver's job, not this one
  const stallMinutes = Number.isInteger(task.stall_minutes) ? task.stall_minutes : TEAM_DEFAULTS.stall_minutes;
  if (!stallMinutes) return false; // 0 disables the check
  const run = loadRun(child.cwd, child.run_id);
  const cs = run ? runState(run) : { state: 'missing' };
  if (cs.state !== 'running') return false; // nothing left to make progress on
  // The LATER of last progress and this driver's own start: a driver respawned after a long
  // park (capacity, a dead predecessor) inherits the old progress mtime, and measured from that
  // alone it read 79 minutes idle the moment it came up - idol-beta-ask1's P6 had eight fresh
  // drivers killed as "stalled" within 68 ms and its whole restart budget spent.
  // And the wake from a suspend (task.resumed_at): a sleeping laptop is not a stalled driver.
  const progressAt = Math.max(childProgressMtime(child) ?? 0, driver.started_at ?? 0, task.resumed_at ?? 0) || Date.now();
  const idleMs = Date.now() - progressAt;
  const stallMs = stallMinutes * 60000;
  if (idleMs < stallMs) {
    if (!child.stalled_since) return false; // never flagged: nothing to clear
    delete child.stalled_since;
    record(task, { event: 'child_driver_progress_resumed', task_id: task.run_id, node_id: nodeId, pid: driver.pid });
    return true;
  }
  if (idleMs >= stallMs * 3) {
    killDriver(driver);
    record(task, { event: 'child_driver_killed', task_id: task.run_id, node_id: nodeId, pid: driver.pid, reason: 'stalled', idle_minutes: Math.round(idleMs / 60000) });
    return true;
  }
  if (child.stalled_since) return false; // already recorded once; wait for a resume or the kill threshold
  child.stalled_since = Date.now();
  record(task, { event: 'child_driver_stalled', task_id: task.run_id, node_id: nodeId, pid: driver.pid, idle_minutes: Math.round(idleMs / 60000) });
  return true;
}

// ---------- the daemon: server owns the loop ----------
//
// tm_open (and tm_run) no longer hand a model session a loop to run: they spawn a second
// process - `node daemon.mjs --task <id>` - that drives this task's graph directly, by calling
// the very functions this file exports (advanceDispatches, finish, foldChild, ...), the same
// recursion-by-process rule Task 11's block comment gives child drivers, extended one level up.
// The difference from the TaskLeader it replaces is that there is no model in this process at
// all except where a node genuinely needs judgment - the daemon spawns a single-shot `claude -p`
// per judging node (composeTaskPrompt's own briefing, its own Required-output contract), reads
// the last `result` event back, and calls finish() itself. A relay session cost $9.66 and 91
// turns to move JSON it never looked at; a loop is code, not a conversation.
//
// One writer, no arbitration: the old inbox (a mutating call from anyone but the leader queued
// for the leader to drain) existed only because the leader was itself a model session that had
// to poll its OWN inbox at the top of its OWN tm_next to see it. The daemon is not a client of
// this MCP server - it never calls back into it - so a direct tm_submit/tm_retry from any other
// caller and the daemon's phases are two writers of task.json, each going through store.mjs
// mutateTask (lock -> read fresh -> change -> write-then-rename), so neither writes over the
// other's stale snapshot; a saveRun of a task outside a transaction throws. Only child run files
// (the broker's) still take saveRun's locked merge.

function daemonPath() {
  return join(dirname(fileURLToPath(import.meta.url)), 'daemon.mjs');
}

// Test seam, like HARNESS_CHILD_DRIVER for a package driver: replaces the whole daemon command
// line so a test can point it at a fake script instead of a real `node daemon.mjs`, which would
// import this whole module and start driving the graph for real. `--task <id>` is always
// appended, exactly as a package driver's prompt always carries its run_id.
function daemonArgv(taskId) {
  const override = String(process.env.HARNESS_DAEMON || '').trim();
  const argv = override ? override.split(/\s+/) : ['node', daemonPath()];
  return [...argv, '--task', taskId];
}

// Test seam only, never an option, same rule as noDriver(): a caller that wants to drive a
// task's manager nodes by hand through tm_next/tm_submit/tm_retry (every test in this suite,
// bar the daemon's own) sets this and nothing spawns to race it. HARNESS_TEST_NO_LEADER is the
// name the whole existing test surface already uses for exactly this switch; kept rather than
// renamed so that surface does not have to move. HARNESS_TEST_NO_DAEMON is the same switch under
// its current name, for anything written after the daemon replaced the leader.
export function noDaemon() {
  return noDriver() || process.env.HARNESS_TEST_NO_LEADER === '1' || process.env.HARNESS_TEST_NO_DAEMON === '1';
}

// task.daemon mirrors task.leader's old shape: {pid, started_at, log, stderr, exit, command,
// spawn_count, restarts, exhausted}. Spawned detached + unref(), like every driver - it has to
// outlive the session that opened the task, because closing that session must not stop the run.
// Reserved inside the caller's transaction (task.daemon.spawning) and spawned after it commits
// (reserveSpawn). A task.daemon holding only a reservation is not a prior daemon: no restart.
// { reset: true } is tm_retry's fresh budget for an exhausted dead daemon: the respawn counts
// restarts: 0 (not prior+1) and its daemon_restarted event carries reason: 'reset'.
function spawnDaemon(task, { reset = false } = {}) {
  const prior = !!(task.daemon && task.daemon.started_at);
  const attempt = prior ? (task.daemon.spawn_count || 0) : 0;
  const priorRestarts = prior ? (task.daemon.restarts || 0) : 0;
  const restarts = reset ? 0 : prior ? priorRestarts + 1 : 0;
  if (!task.daemon) task.daemon = {};
  return reserveSpawn(task, 'daemon', task.daemon, {
    attempt, reason: reset ? 'reset' : prior ? 'restart' : 'spawn', restarts,
    spawn: (t) => spawnDaemonProcess(t, attempt),
    apply: (t, _h, d) => {
      if (d.error) {
        t.daemon = { ...d, spawn_count: attempt + 1, restarts: reset ? 0 : priorRestarts, exhausted: false };
        record(t, { event: 'daemon_spawn_failed', task_id: t.run_id, error: d.error });
        return;
      }
      t.daemon = { ...d, spawn_count: attempt + 1, restarts, exhausted: false };
      record(t, { event: prior ? 'daemon_restarted' : 'daemon_spawned', task_id: t.run_id, pid: d.pid, log: d.log, ...(reset ? { reason: 'reset' } : {}) });
    },
  });
}

// The size-L state a dead daemon past its restart budget leaves: nothing respawns it, so the
// caller is told the way out (tm_retry's bare route, retryTask). Null while the daemon is fine.
function daemonExhaustedNext(task) {
  if (!(task.daemon && task.daemon.exhausted) || driverAlive(task.daemon) || managerState(task).state !== 'running') return null;
  return 'the task daemon died past its restart budget (driver_restarts); tm_retry({task_id}) gives it a fresh daemon on the same run';
}

function spawnDaemonProcess(task, attempt) {
  const dir = join(taskDir(task.run_id), 'daemon');
  const suffix = attempt > 0 ? `.restart${attempt}` : '';
  const log = join(dir, `daemon${suffix}.log.jsonl`);
  const stderr = join(dir, `daemon${suffix}.stderr.txt`);
  const exitFile = join(dir, `daemon${suffix}.exit.json`);
  const argv = daemonArgv(task.run_id);
  const command = argv.join(' ');
  let out = null;
  let err = null;
  try {
    mkdirSync(dir, { recursive: true });
    out = openSync(log, 'a');
    err = openSync(stderr, 'a');
    const env = { ...process.env };
    delete env.CLAUDECODE; // a nested claude -p (the daemon's own judge calls) refuses to start with it set
    if (process.env.HARNESS_TASKS_DIR) env.HARNESS_TASKS_DIR = tasksRoot();
    env.TEAMS_WIKI_ROOT = task.cwd;
    Object.assign(env, openerEnv(task)); // the drivers this daemon spawns inherit it
    const proc = spawn(argv[0], [...argv.slice(1)], { cwd: task.cwd, env, detached: true, stdio: ['ignore', out, err] });
    try {
      proc.on('exit', (code, signal) => {
        try { appendFileSync(exitFile, JSON.stringify({ code, signal, at: Date.now() }) + '\n'); } catch { /* best-effort */ }
      });
    } catch { /* best-effort */ }
    proc.unref();
    const keepAwake = startKeepAwake(proc.pid);
    return { pid: proc.pid || null, started_at: Date.now(), log, stderr, exit: exitFile, command, ...(keepAwake ? { keep_awake: keepAwake } : {}) };
  } catch (e) {
    return { pid: null, started_at: Date.now(), log, stderr, exit: exitFile, command, error: String((e && e.message) || e) };
  } finally {
    for (const fd of [out, err]) { try { if (fd !== null) closeSync(fd); } catch { /* already closed */ } }
  }
}

// macOS: keep the machine from idle-sleeping while the daemon lives - `caffeinate -w` exits with
// the pid it watches. Idle sleep only: a lid close or a forced sleep still suspends (the suspend
// detection in taskstate.mjs covers that). Returns {pid, bin} or null (not darwin, no binary).
export function startKeepAwake(pid, { platform = __clock.platform(), bin = '/usr/bin/caffeinate' } = {}) {
  if (platform !== 'darwin' || !pid || !existsSync(bin)) return null;
  try {
    const p = spawn(bin, ['-i', '-w', String(pid)], { detached: true, stdio: 'ignore' });
    p.on('error', () => { /* best-effort */ });
    p.unref();
    return { pid: p.pid || null, bin };
  } catch {
    return null;
  }
}

// The state a caller OUTSIDE the s_run's own graph should be told. A size-S task's manager
// graph - three nodes - settles the moment `size` resolves (shape/critique skipped by
// delegateIfSmall), which is not the task being done: the work is in the one child run
// task.s_run points at. Judging a live S task by its own settled manager graph is exactly the
// bug that once made a watcher call a live run "blocked" while the child was still building (see
// toolNextSRun, and the historical note on the test above this one) - so anything that needs to
// know "is there still work here", not just "what does the manager's own node list say", reads
// THIS instead of runState(task) directly. serviceDaemon and tm_wait both need it; daemon.mjs
// imports it for the same reason rather than re-deriving its own copy.
// The manager graph's own state, except that a judge failure the daemon will re-judge is not a
// block: code-beta-X4's shape judge replied with broken JSON, the daemon scheduled the re-judge,
// and tm_wait told the driving session "blocked" - which wrote its final report and exited two
// minutes in, while the task went on without anyone watching.
export function managerState(task) {
  const st = runState(task);
  if (st.state === 'complete') {
    const partial = unfinishedWork(task);
    return partial ? { ...st, state: 'partial', ...partial } : st;
  }
  if (st.state !== 'blocked') return st;
  const at = pendingRejudgeAt(task);
  return at === null ? st : { ...st, state: 'running', rejudge_at: at };
}

export function taskState(task) {
  // tm_cancel's marker and the daemon's worktree-gone stop outrank anything the graph says: the
  // first is terminal, the second reads blocked with the reason until a person decides.
  if (task.cancelled) return { state: 'cancelled', counts: {}, reason: 'cancelled by tm_cancel' };
  if (task.worktree_gone) {
    const counts = task.harness_run || task.s_run ? {} : (runState(task).counts || {});
    return { state: 'blocked', counts, reason: task.worktree_gone.reason };
  }
  if (task.harness_run) return harnessState(task);
  if (!task.s_run) {
    const st = managerState(task);
    // serviceDaemon never respawns an exhausted daemon, so nothing will move this task again:
    // reading it running kept tm_wait (and teams run) polling forever.
    if (st.state === 'running' && task.daemon && task.daemon.exhausted && !driverAlive(task.daemon)) {
      return { ...st, state: 'blocked', reason: 'the task daemon died past its restart budget (driver_restarts)' };
    }
    return st;
  }
  // S2 (_repo/docs/plans/2026-09-28-teams-long-loop.md): a legacy size-S task is read through this
  // frozen path - its run file only, its QA cards (s_qa) ignored, never respawned. A run that
  // never finished and has no live driver will never finish: it reads blocked, not running
  // forever (tm_wait would otherwise never return).
  const run = loadRun(task.s_run.cwd, task.s_run.run_id);
  const cs = run ? runState(run) : { state: 'missing', counts: {} };
  const st = { ...sState(cs), counts: cs.counts || {} };
  if (st.state === 'running' && !(task.s_run.driver && driverAlive(task.s_run.driver))) {
    return { ...st, state: 'blocked', reason: 'legacy size-S runs are not restarted' };
  }
  return st;
}

// A size-S run's graph state as a task state: a report over a spent retry budget (runState's
// `settled`) is `partial`, the same rule unfinishedWork applies to a size-L task.
function sState(cs) {
  if (cs.state === 'running') return { state: 'running' };
  if (cs.state !== 'complete') return { state: 'blocked' };
  return cs.settled
    ? { state: 'partial', partial: true, partial_reasons: [`${cs.counts.unreachable} node(s) unreachable after a spent retry budget`] }
    : { state: 'complete' };
}

// Called at the top of (and again after) every tm_* entry that has a task_id. No gate, no
// watcher branch, no inbox: any caller may read or mutate the task at any time, the same as it
// always could when there was no daemon at all. This only re-raises a dead daemon while work
// remains - taskState() is the only thing that decides whether there is anything left to drive.
export function serviceDaemon(task) {
  if (noDaemon()) return false;
  const st = taskState(task).state;
  if (st === 'complete' || st === 'partial' || st === 'blocked' || st === 'cancelled') return false;
  if (task.daemon && driverAlive(task.daemon)) return false;
  if (spawning(task.daemon)) return false; // a spawn already under way: one daemon per task
  if (task.daemon && task.daemon.exhausted) return false;
  const budget = Number.isInteger(task.driver_restarts) ? task.driver_restarts : 2;
  if (task.daemon && (task.daemon.restarts || 0) >= budget) {
    task.daemon.exhausted = true;
    record(task, { event: 'daemon_exhausted', task_id: task.run_id, restarts: task.daemon.restarts, stderr: driverStderrTail(task.daemon) });
    saveRun(task);
    return true;
  }
  if (!spawnDaemon(task)) return false;
  saveRun(task);
  return true;
}

export { currentSessionId, daemonExhaustedNext, driverExitInfo, driverUsageLimitText, killDriver, nextSpawnAttempt, spawnChildDriver, spawnDaemon };
