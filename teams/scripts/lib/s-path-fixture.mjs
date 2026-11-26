// A fake-driver fixture for the size-S path (card 178 Task 4): a fresh git repo, the real tm
// server and daemon, and a scripted driver in place of `claude -p`. The 'bg-exit' pattern is a
// synthetic replay of the E-c15ff128 shape: the first driver leaves its run unfinished, says it
// waits on a background run and exits 0; the next spawn finishes the run. The 'hang' pattern
// keeps the first driver alive (for the session-death case) and the next spawn finishes the run.
//
//   runFixture({route, pattern, driverRestarts, sessionDeath})  one task from tm_open to daemon_done
//   readOutcome(root, taskId)                                   what its ledger and task.json recorded
//
// route (the shape of the run the driver writes): 'graph' | 'fallback-copy' | 'fallback-files'.
//
// Every tm server, daemon and driver pid is appended to $S_PATH_FX_PIDFILE (default
// tmp/card178-t4/fixture-pids.txt under the repo root), one per line, so a check outside the
// run can see a leftover. Tests that call runFixture set their own pidfile in a temp dir.

import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, appendFileSync, rmSync, realpathSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { liveProc } from '../../mcp/livecap.mjs';

export const PATTERNS = ['bg-exit', 'hang', 'crash', 'idle0', 'churn0', 'creep0'];
export const RUN_SHAPES = ['graph', 'fallback-copy', 'fallback-files'];

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER = join(HERE, '..', '..', 'mcp', 'server.mjs');
const REPO = join(HERE, '..', '..', '..');
const DONE_TIMEOUT_MS = 60 * 1000;
const MERGE_TIMEOUT_MS = 30 * 1000;
const SPAWN_TIMEOUT_MS = 30 * 1000;
const RESPAWN_GRACE_MS = 20 * 1000;
// The daemon's own test seam; at its 15 s default the poll interval would be the whole wall time.
const DAEMON_POLL_MS = 250;

const COMMON = `
import { writeFileSync, readFileSync, appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
const counterFile = process.env.FAKE_DRIVER_COUNTER;
const attempt = existsSync(counterFile) ? Number(readFileSync(counterFile, 'utf8')) + 1 : 1;
writeFileSync(counterFile, String(attempt));
const cwd = process.cwd();
appendFileSync(process.env.FAKE_DRIVER_OUT, JSON.stringify({ attempt, cwd }) + '\\n');
const tag = /\\[teams-task ([^\\]]+)\\]/.exec(process.argv[process.argv.length - 1]);
if (!tag) { console.error('no [teams-task] tag in the prompt'); process.exit(2); }
const taskId = tag[1];
const taskDir = join(process.env.HARNESS_TASKS_DIR, taskId);

const emit = (e) => console.log(JSON.stringify(e));
const result = (text) => emit({ type: 'result', subtype: 'success', result: text });
const backgroundCall = () => emit({ type: 'assistant', message: { role: 'assistant', content: [
  { type: 'tool_use', id: 'toolu_bg_' + attempt, name: 'Bash', input: { command: 'node --test', run_in_background: true } } ] } });
const waitingStream = () => {
  result('plan written');
  result('implementation started');
  backgroundCall();
  result('The test run is running in the background; waiting for it to finish.');
};

const pointer = (p) => writeFileSync(join(taskDir, 'harness-run.json'), JSON.stringify(p));
const RUN_ID = 'g-fixture01';
const runsDir = join(cwd, '.harness-run', 'broker', 'runs');
const runPath = join(runsDir, RUN_ID + '.json');
function newGraphRun() {
  const ids = ['plan', 'setgoal', 'critic', 'implement:1', 'implement:2', 'implement:3', 'implement:4', 'implement:5', 'gate:goal:1', 'report'];
  const nodes = ids.map((id, i) => ({ node_id: id, stage: id.startsWith('gate') ? 'gate' : id.split(':')[0], ...(id.startsWith('gate') ? { subgoal_id: null } : {}),
    state: id === 'plan' ? 'done' : 'pending', deps: i ? [ids[i - 1]] : [], result: id === 'plan' ? { stage_ok: true, plan: 'Edit change.txt' } : null }));
  return { run_id: RUN_ID, request: '[teams-task ' + taskId + '] small request', created_at: Date.now(), nodes };
}
const readRun = () => (existsSync(runPath) ? JSON.parse(readFileSync(runPath, 'utf8')) : newGraphRun());
const writeRun = (run) => { mkdirSync(runsDir, { recursive: true }); writeFileSync(runPath, JSON.stringify(run)); pointer({ route: 'graph', run_id: RUN_ID, cwd }); };

const fallbackDir = join(cwd, '.harness-run', 'small');
function writeFallback() {
  mkdirSync(fallbackDir, { recursive: true });
  writeFileSync(join(fallbackDir, 'manifest.json'), JSON.stringify({ request: 'small request', teams_task: taskId }));
  writeFileSync(join(fallbackDir, '01-plan.md'), 'Edit change.txt\\n');
  pointer({ route: 'fallback', run_dir: fallbackDir });
}

function commitChange() {
  writeFileSync(join(cwd, 'change.txt'), 'changed by the run\\n');
  execFileSync('git', ['add', 'change.txt'], { cwd });
  execFileSync('git', ['commit', '-qm', 'fixture: the run change'], { cwd });
}
`;

// What the finishing attempt writes, by run shape.
const finishRun = (shape) => `
const SHAPE = ${JSON.stringify(shape)};
commitChange();
if (SHAPE === 'graph') {
  const run = readRun();
  for (const n of run.nodes) {
    n.state = 'done';
    if (n.node_id === 'gate:goal:1') n.result = { stage_ok: true, accept: true, match_pct: 95, gaps: [] };
    else if (n.node_id === 'report') n.result = { stage_ok: true, handoff: 'harness run report' };
    else n.result = n.result || { stage_ok: true };
  }
  writeRun(run);
} else if (SHAPE === 'fallback-copy') {
  writeFileSync(join(taskDir, 'harness-report.md'), '# harness report\\n');
} else {
  writeFileSync(join(fallbackDir, '04-goal-gate.json'), JSON.stringify({ match_pct: 95, pass: true, reason: 'met' }));
  writeFileSync(join(fallbackDir, '05-report.md'), '# fallback report\\n');
}
result('the run is finished');
`;

const BODIES = {
  'bg-exit': (shape) => `
const SHAPE0 = ${JSON.stringify(shape)};
if (attempt === 1) {
  if (SHAPE0 === 'graph') writeRun(newGraphRun()); else writeFallback();
  waitingStream();
} else if (attempt === 2) {
${finishRun(shape)}
}
`,
  // The first driver writes its run and stays alive (killed by the session-death case); a later
  // spawn finishes the run.
  hang: (shape) => `
const SHAPE0 = ${JSON.stringify(shape)};
if (attempt === 1) {
  if (SHAPE0 === 'graph') writeRun(newGraphRun()); else writeFallback();
  result('plan written');
  setInterval(() => {}, 1000);
} else {
${finishRun(shape)}
}
`,
  crash: () => `
console.error('fake driver attempt ' + attempt + ' crashed');
process.exitCode = 1;
`,
  idle0: () => `
result('nothing to do');
`,
  // Rewrites the run and a log and bumps an attempt counter; never marks a new stage done.
  churn0: () => `
const run = readRun();
const open = run.nodes.find((n) => n.state !== 'done');
open.attempt = (open.attempt || 0) + 1;
writeRun(run);
appendFileSync(join(cwd, '.harness-run', 'churn.log'), 'attempt ' + attempt + '\\n');
waitingStream();
`,
  // Marks exactly one more node done per attempt (the first attempt's is the plan it writes) and
  // stops before the goal gate.
  creep0: () => `
const run = readRun();
if (existsSync(runPath)) {
  const next = run.nodes.find((n) => n.state !== 'done' && n.stage !== 'gate' && n.stage !== 'report');
  if (next) { next.state = 'done'; next.result = { stage_ok: true }; }
}
writeRun(run);
result('one more stage done');
`,
};

export function driverSource(pattern, shape = 'graph') {
  if (!BODIES[pattern]) throw new Error(`unknown pattern ${pattern}`);
  if (!RUN_SHAPES.includes(shape)) throw new Error(`unknown route ${shape}`);
  return COMMON + BODIES[pattern](shape);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readJson(p) {
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}

export function readLedger(root, taskId) {
  let text;
  try { text = readFileSync(join(root, taskId, 'ledger.jsonl'), 'utf8'); } catch { return []; }
  return text.split('\n').filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
}

export const readTaskJson = (root, taskId) => readJson(join(root, taskId, 'task.json'));

// Every driver and daemon pid the ledger or task.json names.
function recordedPids(root, taskId) {
  const task = readTaskJson(root, taskId) || {};
  const spawnEvents = ['child_driver_spawned', 'child_driver_restarted', 'daemon_spawned', 'daemon_restarted'];
  const pids = [
    ...readLedger(root, taskId).filter((e) => spawnEvents.includes(e.event)).map((e) => e.pid),
    task.harness_run?.driver?.pid, task.daemon?.pid,
  ];
  return [...new Set(pids.filter((p) => Number.isInteger(p) && p > 0))];
}

function recordPids(pids) {
  const file = process.env.S_PATH_FX_PIDFILE || join(REPO, 'tmp', 'card178-t4', 'fixture-pids.txt');
  mkdirSync(dirname(file), { recursive: true });
  if (pids.length) appendFileSync(file, pids.join('\n') + '\n');
}

// extraPids: pids the caller started itself (the tm servers), counted with the recorded ones.
export function readOutcome(root, taskId, extraPids = []) {
  const ledger = readLedger(root, taskId);
  const task = readTaskJson(root, taskId) || {};
  const h = task.harness_run || {};
  const of = (event) => ledger.filter((e) => e.event === event);
  const open = of('harness_open')[0];
  const done = of('daemon_done')[0];
  const merge = of('harness_merge').pop();
  return {
    outcome: done ? done.state : 'timeout',
    restarts_counted: (h.driver?.restarts || []).length,
    respawns: of('child_driver_restarted').length,
    free_exits: of('harness_driver_exit_free').length,
    route: h.route || null,
    gate_events: of('harness_gate').length,
    wall_ms: open && done ? done.ts - open.ts : null,
    // harness_merge and harness_run.worktree: neither exists before the worktree change.
    merge: merge ? (merge.ok ? 'ok' : 'parked') : 'none',
    merge_ms: open && merge ? merge.ts - open.ts : null,
    worktree: h.worktree || h.main_cwd ? 'yes' : 'none',
    leftover_pids: [...new Set([...recordedPids(root, taskId), ...extraPids])].filter(liveProc).length,
  };
}

// The tm server over stdio: just enough JSON-RPC for tm_open and tm_status.
async function startServer(env) {
  const proc = spawn('node', [SERVER], { stdio: ['pipe', 'pipe', 'inherit'], env });
  const waiting = new Map();
  let buf = '';
  let id = 0;
  proc.stdout.setEncoding('utf8');
  proc.stdout.on('data', (chunk) => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (!line.trim()) continue;
      const msg = JSON.parse(line);
      waiting.get(msg.id)?.(msg);
      waiting.delete(msg.id);
    }
  });
  const send = (method, params) => new Promise((resolve, reject) => {
    const n = ++id;
    const timer = setTimeout(() => reject(new Error(`tm server: no reply to ${method}`)), 30 * 1000);
    waiting.set(n, (m) => { clearTimeout(timer); resolve(m); });
    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: n, method, params }) + '\n');
  });
  await send('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 's-path-fixture', version: '1' } });
  return {
    pid: proc.pid,
    async call(name, args) {
      const res = (await send('tools/call', { name, arguments: args })).result || {};
      if (res.isError) throw new Error(`${name}: ${res.content[0].text}`);
      return res.structuredContent;
    },
    close() { proc.stdin.end(); proc.kill(); },
  };
}

function initRepo(dir) {
  mkdirSync(dir);
  const git = (...a) => execFileSync('git', a, { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@t');
  git('config', 'user.name', 't');
  git('config', 'core.hooksPath', '/dev/null');
  writeFileSync(join(dir, 'a.txt'), 'x\n');
  writeFileSync(join(dir, '.gitignore'), '.teams_output/\n');
  git('add', '-A');
  git('commit', '-qm', 'init');
}

// What a person looking at the branch checked out in cwd would see: its head and its dirty files.
function mainSample(cwd) {
  const git = (...a) => {
    try { return execFileSync('git', ['--no-optional-locks', ...a], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); } catch { return 'error'; }
  };
  return { head: git('rev-parse', 'HEAD'), status: git('status', '--porcelain') };
}

// The caller's own teams/harness variables (this may run inside a teams driver) must not leak in.
function fixtureEnv(extra) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(TEAMS|HARNESS)_/.test(k)));
  return { ...env, ...extra };
}

async function killAll(base, pids) {
  for (let i = 0; i < 50; i++) {
    for (const pid of pids().filter(liveProc)) { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } }
    spawnSync('pkill', ['-KILL', '-f', base]);
    await sleep(100);
    if (!pids().some(liveProc) && spawnSync('pgrep', ['-f', base]).status === 1) return;
  }
}

// onPoll(ctx) runs at every ledger poll, inspect(ctx) once before cleanup;
// ctx = {base, cwd, root, taskId}. Returns readOutcome's fields plus
//   main_samples, main_samples_identical, first_diff   head and `git status --porcelain` of cwd at
//                                                     every poll, against the sample before tm_open
//   gate_events_unpolled / gate_events_polled          harness_gate events before any tm call after
//                                                     daemon_done, and after three tm_status calls
//   session_death                                      with sessionDeath: {respawned, driver_restarts_spent, ...}
// sessionDeath: once the first driver is up, SIGKILL daemon and driver, start a fresh tm server
// (full mode, its start-up sweep) and make no tm_* call on the task.
export async function runFixture({ route = 'graph', pattern = 'bg-exit', driverRestarts = 1, sessionDeath = false, env = {}, onPoll, inspect } = {}) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 's-path-fx-')));
  const cwd = join(base, 'repo');
  const root = join(base, 'tasks');
  const drv = join(base, 'drv');
  let tm = null;
  let taskId = null;
  const serverPids = [];
  const extra = {};
  try {
    initRepo(cwd);
    mkdirSync(root);
    mkdirSync(drv);
    const script = join(drv, 'fake-driver.mjs');
    writeFileSync(script, driverSource(pattern, route));
    const serverEnv = fixtureEnv({
      HARNESS_TASKS_DIR: root,
      HARNESS_CHILD_DRIVER: `node ${script}`,
      FAKE_DRIVER_COUNTER: join(drv, 'counter.txt'),
      FAKE_DRIVER_OUT: join(drv, 'ran.jsonl'),
      CLAUDECODE: '1',
      TEAMS_RUNS_DIR: 'off',
      HARNESS_TEST_RUNNER_PID: String(process.pid),
      HARNESS_DAEMON_POLL_MS: String(DAEMON_POLL_MS),
      ...env,
    });
    const startTm = async () => {
      const s = await startServer(serverEnv);
      serverPids.push(s.pid);
      recordPids([s.pid]);
      return s;
    };
    tm = await startTm();
    const baseline = mainSample(cwd);
    const samples = { count: 1, firstDiff: null, pending: [], mergeHead: null };
    const sample = (label) => {
      const s = mainSample(cwd);
      samples.count++;
      // The engine's merge commit (first parent = the head at open) is the one change main may show.
      const mergeOf = (head) => { try { return execFileSync('git', ['rev-parse', `${head}^1`, `${head}^2`], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).split('\n')[0] === baseline.head; } catch { return false; } };
      if (s.head !== baseline.head && mergeOf(s.head)) { samples.merged_at = samples.merged_at || samples.count; samples.mergeHead = samples.mergeHead || s.head; return; }
      if (s.head !== baseline.head) {
        if (!samples.firstDiff) samples.firstDiff = { sample: samples.count, at: label, head: s.head, status: s.status };
      } else if (s.status !== baseline.status) {
        // git's own merge writes the work tree and index before it moves HEAD: this sample may be that
        // window. Judged once the merge is known (see below): only paths the merge brings in are excused.
        samples.pending.push({ sample: samples.count, at: label, head: s.head, status: s.status });
      }
    };
    const opened = await tm.call('tm_open', {
      request: 'small request', cwd, vendor: 'self', size: 'S', driver_restarts: driverRestarts,
      roles: { qa: false }, brainstorm: false,
    });
    taskId = opened.task_id;
    const ctx = { base, cwd, root, taskId };
    const seen = (event) => readLedger(root, taskId).some((e) => e.event === event);
    const poll = async (label) => { sample(label); if (onPoll) await onPoll(ctx); };

    if (sessionDeath) {
      const driverUp = () => {
        const t = readTaskJson(root, taskId) || {};
        // ran.jsonl is the driver's own first write: a driver killed before it has run nothing.
        return t.daemon?.pid && t.harness_run?.driver?.pid && readOutcomeSpawned(root, taskId) && existsSync(join(drv, 'ran.jsonl'));
      };
      for (const end = Date.now() + SPAWN_TIMEOUT_MS; Date.now() < end && !driverUp(); await sleep(50)) await poll('wait-spawn');
      const t0 = readTaskJson(root, taskId) || {};
      const killed = [t0.daemon?.pid, t0.harness_run?.driver?.pid].filter(Number.isInteger);
      recordPids(killed);
      for (const pid of killed) { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } }
      tm.close();
      for (let i = 0; i < 50 && killed.some(liveProc); i++) await sleep(50);
      const ranCount = () => (readFileSync(join(drv, 'ran.jsonl'), 'utf8').trim().split('\n').filter(Boolean).length);
      const before = ranCount();
      tm = await startTm();
      const t1 = Date.now();
      for (const end = t1 + RESPAWN_GRACE_MS; Date.now() < end && ranCount() <= before; await sleep(100)) await poll('wait-respawn');
      const respawned = ranCount() > before;
      extra.session_death = {
        killed_pids: killed.length,
        respawned,
        respawn_ms: respawned ? Date.now() - t1 : null,
        daemon_restarted_events: readLedger(root, taskId).filter((e) => e.event === 'daemon_restarted').map((e) => ({ reason: e.reason || null, free: !!e.free })),
      };
    }

    for (const end = Date.now() + DONE_TIMEOUT_MS; Date.now() < end && !seen('daemon_done'); await sleep(100)) {
      if (sessionDeath && !extra.session_death.respawned) break;
      await poll('wait-done');
    }
    // The daemon writes its cost lines after daemon_done: let it leave on its own before any kill.
    const done = readLedger(root, taskId).find((e) => e.event === 'daemon_done');
    const daemonPid = readTaskJson(root, taskId)?.daemon?.pid;
    for (let i = 0; i < 50 && daemonPid && done && liveProc(daemonPid); i++) await sleep(100);
    extra.gate_events_unpolled = readLedger(root, taskId).filter((e) => e.event === 'harness_gate').length;
    // A merge deferred past daemon_done happens only on a later tm_status. Only a complete run
    // with its own tree can ever merge; any other has nothing to wait for.
    if (done?.state === 'complete' && readTaskJson(root, taskId)?.harness_run?.main_cwd) {
      for (const end = Date.now() + MERGE_TIMEOUT_MS; Date.now() < end && !readTaskJson(root, taskId)?.harness_run?.merge; await sleep(500)) {
        await poll('wait-merge');
        await tm.call('tm_status', { task_id: taskId });
      }
    }
    if (done && !sessionDeath) {
      for (let i = 0; i < 3; i++) await tm.call('tm_status', { task_id: taskId });
      await poll('after-status');
    }
    extra.gate_events_polled = readLedger(root, taskId).filter((e) => e.event === 'harness_gate').length;
    sample('end');
    extra.main_samples = samples.count;
    // A pending sample (HEAD still the baseline, status differing) is excused only when a later sample is
    // the merge and every path it shows as changed is one the merge brings in; any other is a main write.
    if (samples.mergeHead) {
      let brought = null;
      try { brought = new Set(execFileSync('git', ['diff', '--name-only', baseline.head, samples.mergeHead], { cwd, encoding: 'utf8' }).split('\n').filter(Boolean)); } catch { /* none excused */ }
      const baseLines = new Set(baseline.status.split('\n'));
      const excused = (p) => brought && p.status.split('\n').filter((l) => l && !baseLines.has(l)).every((l) => brought.has(l.slice(3).split(' -> ').pop().replace(/^"|"$/g, '')));
      samples.pending = samples.pending.filter((p) => !excused(p));
    }
    if (!samples.firstDiff && samples.pending.length) samples.firstDiff = samples.pending[0];
    extra.main_samples_identical = !samples.firstDiff;
    extra.main_merged_at = samples.merged_at || null;
    extra.first_diff = samples.firstDiff;
    if (inspect) await inspect(ctx);
  } finally {
    if (tm) tm.close();
    if (taskId) recordPids(recordedPids(root, taskId));
    await killAll(base, () => (taskId ? recordedPids(root, taskId) : []));
    if (!taskId) rmSync(base, { recursive: true, force: true });
  }
  try {
    const outcome = readOutcome(root, taskId, serverPids);
    if (extra.session_death) extra.session_death.driver_restarts_spent = outcome.restarts_counted;
    return { ...outcome, ...extra };
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

function readOutcomeSpawned(root, taskId) {
  return readLedger(root, taskId).some((e) => e.event === 'child_driver_spawned');
}
