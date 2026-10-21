#!/usr/bin/env node
// test-cancel.mjs - tm_cancel({task_id}): stop a task for good (backlog card 51).
//
// A running, blocked or partial task is stopped in this order: the cancel marker is saved on
// task.json in the transaction that clears spawning tokens and in-flight open claims; the daemon,
// every driver and every judge are killed and each pid confirmed dead before anything is appended
// (a late daemon write cannot land after `clean`); the task's child graph runs are retired; a
// report stub is written; the ledger gets daemon_done {state:'cancelled'} and then `clean`, last.
// Worktrees and branches stay for a later tm_clean. A complete, cancelled or cleaned task is a
// no-op. After it, tm_status, tm_clean, tm_retry, tm_wait, tm_next and tm_submit spawn nothing.
//
// Drivers, the daemon and the judge are stubs; the daemon stub keeps writing to the ledger until
// it is killed, which is what makes "no write after clean" mean something. HARNESS_TASKS_DIR is a
// temp dir. The tools are called through callTool, the function the JSON-RPC surface calls, and
// the tool list through a real stdio handshake.
//
//   node --test teams/scripts/test-cancel.mjs

process.env.TEAMS_RUNS_DIR ??= 'off';
process.env.TEAMS_VIEW = '0';
delete process.env.HARNESS_TEST_NO_DAEMON;
delete process.env.HARNESS_TEST_NO_LEADER;
delete process.env.HARNESS_TEST_NO_DRIVER;
delete process.env.HARNESS_CHILD_DRIVER;
delete process.env.HARNESS_DAEMON;
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = mkdtempSync(join(tmpdir(), 'cancel-root-'));
const STUB_DIR = mkdtempSync(join(tmpdir(), 'cancel-stub-'));
process.env.HARNESS_TASKS_DIR = ROOT;
process.env.STUB_DIR = STUB_DIR;
writeFileSync(join(STUB_DIR, 'driver.mjs'), [
  "import { writeFileSync } from 'node:fs';",
  "import { join } from 'node:path';",
  "writeFileSync(join(process.env.STUB_DIR, `driver-${process.pid}`), '');",
  "setTimeout(() => process.exit(0), 120000);",
].join('\n'));
// The daemon stub keeps appending to its task's ledger until it is killed.
writeFileSync(join(STUB_DIR, 'daemon.mjs'), [
  "import { writeFileSync, appendFileSync } from 'node:fs';",
  "import { join } from 'node:path';",
  "const id = process.argv[process.argv.indexOf('--task') + 1];",
  "writeFileSync(join(process.env.STUB_DIR, `daemon-${process.pid}`), id);",
  "const ledger = join(process.env.HARNESS_TASKS_DIR, id, 'ledger.jsonl');",
  "setInterval(() => { try { appendFileSync(ledger, JSON.stringify({ ts: Date.now(), event: 'late_write', pid: process.pid }) + '\\n'); } catch {} }, 20);",
  "setTimeout(() => process.exit(0), 120000);",
].join('\n'));
process.env.HARNESS_CHILD_DRIVER = `node ${join(STUB_DIR, 'driver.mjs')}`;
process.env.HARNESS_DAEMON = `node ${join(STUB_DIR, 'daemon.mjs')}`;

const tm = await import(join(HERE, '..', 'mcp', 'taskmanager.mjs'));
const graph = await import(join(HERE, '..', 'mcp', 'graph.mjs'));
const { pidAlive } = await import(join(HERE, '..', 'mcp', 'proc.mjs'));
// Alive and not a zombie: a child this process killed answers a signal probe until libuv reaps it.
const { liveProc } = await import(join(HERE, '..', 'mcp', 'livecap.mjs'));
const { docPaths } = await import(join(HERE, '..', 'mcp', 'tickets.mjs'));
// The repo's push hold, unedited: it reads the task's ledger (last of tm_open / tm_retry /
// daemon_spawned / daemon_done / clean) and denies `git push` while a task of the same repo is held.
const { decide } = await import(join(HERE, '..', '..', '.claude', 'hooks', 'repo-rules.mjs'));
const pushDecision = (cwd) => decide('bash', { tool_name: 'Bash', tool_input: { command: 'git push origin main' }, cwd }, { HARNESS_TASKS_DIR: ROOT, HOME: ROOT });
const pushDenied = (cwd) => pushDecision(cwd).hookSpecificOutput?.permissionDecision === 'deny';

const scratch = [];
const bystanders = [];
after(() => {
  for (const p of bystanders) { try { p.kill('SIGKILL'); } catch { /* gone */ } }
  for (const f of readdirSync(STUB_DIR)) {
    if (/^(driver|daemon)-\d+$/.test(f)) { try { process.kill(Number(f.split('-')[1]), 'SIGKILL'); } catch { /* gone */ } }
  }
  for (const d of [ROOT, STUB_DIR, ...scratch]) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best-effort */ } }
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, what, ms = 8000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > end) assert.fail(`timed out waiting for ${what}`);
    await sleep(40);
  }
}
const git = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });
function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'cancel-repo-'));
  scratch.push(dir);
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@t');
  git(dir, 'config', 'user.name', 't');
  writeFileSync(join(dir, 'a.txt'), 'x\n');
  writeFileSync(join(dir, '.gitignore'), '.teams_output/\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'init');
  return dir;
}
const stubFiles = (prefix) => readdirSync(STUB_DIR).filter((f) => f.startsWith(`${prefix}-`)).map((f) => ({ name: f, pid: Number(f.split('-')[1]), tag: readFileSync(join(STUB_DIR, f), 'utf8') }));

let seq = 0;
const pkg = (id) => ({ id, title: `module ${id}`, flow: 'develop', brief: 'change a.txt', acceptance: ['a.txt says a'], touches: ['a.txt'], deps: [] });
const done = (id, stage, deps) => graph.node(id, stage, deps, { state: 'done', result: { stage_ok: true } });
function seedTask(cwd, ids, extraNodes = [], extra = {}) {
  const run_id = `0000${String(++seq).padStart(4, '0')}-9999-8888-7777-666666666666`;
  const path = tm.taskPath(run_id);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({
    run_id, kind: 'task', store_path: path, cwd, request: 'r', created_at: Date.now(), slug: `cancel-${seq}`,
    flow: 'develop', flow_chosen: 'develop', size: 'L', max_retries: 2, driver_restarts: 2,
    base_ref: null, team: { opts: { max_parallel_teams: 4, max_live_drivers: 8 } },
    spec: { acceptance: ['a'], packages: ids.map(pkg) },
    nodes: [done('size', 'size', []), done('shape', 'shape', ['size']), done('critique', 'critique', ['shape']),
      ...ids.flatMap((id) => [
        graph.node(`dispatch:${id}:1`, 'dispatch', ['critique'], { subgoal_id: id }),
        graph.node(`accept:${id}:1`, 'accept', [`dispatch:${id}:1`], { subgoal_id: id }),
      ]), ...extraNodes],
    ...extra,
  }, null, 2));
  return run_id;
}
const load = (id) => JSON.parse(readFileSync(tm.taskPath(id), 'utf8'));
const save = (id, fn) => { const t = load(id); fn(t); writeFileSync(tm.taskPath(id), JSON.stringify(t, null, 2)); };
const ledger = (id) => {
  const f = join(tm.taskDir(id), 'ledger.jsonl');
  return existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
};
const call = (name, args) => tm.callTool(name, args);
const spawned = () => ({ drivers: stubFiles('driver').length, daemons: stubFiles('daemon').length });

// ---------- the tool list, over the real stdio server ----------

test('the task-manager MCP lists tm_cancel with a required task_id', async () => {
  const child = spawn(process.execPath, [join(HERE, '..', 'mcp', 'taskmanager.mjs')], { stdio: ['pipe', 'pipe', 'inherit'], env: { ...process.env, HARNESS_TEST_NO_DRIVER: '1' } });
  try {
    const reply = await new Promise((resolve, reject) => {
      let buf = '';
      child.stdout.on('data', (d) => {
        buf += d;
        for (const line of buf.split('\n').filter(Boolean)) {
          try { const m = JSON.parse(line); if (m.id === 2) resolve(m); } catch { /* partial */ }
        }
      });
      child.on('error', reject);
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } })}\n`);
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' })}\n`);
    });
    const tool = reply.result.tools.find((t) => t.name === 'tm_cancel');
    assert.ok(tool, `tm_cancel is listed among ${reply.result.tools.map((t) => t.name).join(', ')}`);
    assert.deepEqual(tool.inputSchema.required, ['task_id']);
  } finally {
    child.stdin.end();
  }
});

// ---------- a running task ----------

test('tm_cancel on a running task: every pid dead, state cancelled, stub, retired runs, clean last, then nothing spawns', async () => {
  const cwd = repo();
  const judgeProc = spawn('sleep', ['120'], { stdio: 'ignore' });
  bystanders.push(judgeProc);
  const id = seedTask(cwd, ['P1', 'P2'], [
    graph.node('gate:goal', 'gate', ['critique'], { subgoal_id: null }),
    graph.node('dispatch:P3:1', 'dispatch', ['critique'], { subgoal_id: 'P3' }),
  ]);
  tm.advanceDispatches(id);
  await until(() => stubFiles('driver').length === 2, 'two drivers');
  await call('tm_status', { task_id: id }); // re-raises the daemon, as every tool call does
  const daemon = await until(() => (load(id).daemon || {}).pid && load(id).daemon, 'a daemon');
  await until(() => stubFiles('daemon').some((d) => d.tag === id), 'the daemon stub');
  const before = load(id);
  const driverPids = before.nodes.filter((n) => n.child && n.child.driver).map((n) => n.child.driver.pid);
  assert.equal(driverPids.length, 2);
  // A judge in flight, a spawn reservation and a half-done open, as a live task can hold them.
  save(id, (t) => {
    const g = t.nodes.find((n) => n.node_id === 'gate:goal');
    g.judging = { pid: process.pid, token: 'judge-token', attempt: 1, reopened: 0, at: Date.now(), proc: { pid: judgeProc.pid, started_at: Date.now(), command: 'sleep 120' } };
    const p1 = t.nodes.find((n) => n.node_id === 'dispatch:P1:1');
    p1.child.spawning = { pid: process.pid, token: 'spawn-token', attempt: 1, reason: 'restart', restarts: [] };
    const p3 = t.nodes.find((n) => n.node_id === 'dispatch:P3:1');
    p3.state = 'running';
    p3.claim = { pid: judgeProc.pid, token: 'open-token', op: 'open', attempt: 1, at: Date.now() };
  });
  const pids = [daemon.pid, ...driverPids, judgeProc.pid];
  for (const p of pids) assert.ok(liveProc(p), `pid ${p} alive before the cancel`);
  const childRuns = before.nodes.filter((n) => n.child).map((n) => join(n.child.cwd, '.teams_output', 'broker', 'runs', `${n.child.run_id}.json`));
  assert.equal(childRuns.length, 2);
  const stubsBefore = spawned();
  // A run in a child cwd that is not one of the task's own run ids must survive the cancel.
  const foreignRun = join(dirname(childRuns[0]), 'foreign-run.json');
  writeFileSync(foreignRun, JSON.stringify({ run_id: 'foreign-run', nodes: [] }));
  assert.ok(pushDenied(cwd), 'a live task holds the repo push before the cancel');

  const out = await call('tm_cancel', { task_id: id });

  // (1) no daemon, driver or judge pid of the task is alive when it returns
  for (const p of pids) assert.ok(!liveProc(p), `pid ${p} dead after the cancel`);
  assert.equal(out.state, 'cancelled');
  assert.equal(out.noop, undefined);
  // (2) the marker, in the transaction that cleared the spawning token and the open claim
  const after = load(id);
  assert.ok(after.cancelled && after.cancelled.at, 'cancel marker on task.json');
  assert.equal(after.nodes.find((n) => n.node_id === 'dispatch:P1:1').child.spawning, undefined, 'spawning token cleared');
  const p3 = after.nodes.find((n) => n.node_id === 'dispatch:P3:1');
  assert.equal(p3.claim, undefined, 'in-flight open claim cleared');
  assert.equal(p3.state, 'pending');
  // (3) terminal state
  assert.equal(tm.taskState(after).state, 'cancelled');
  // (4) the ledger ends daemon_done {cancelled}, clean - and the daemon's late writes stop before them
  const events = ledger(id);
  assert.equal(events.at(-1).event, 'clean');
  assert.equal(events.at(-2).event, 'daemon_done');
  assert.equal(events.at(-2).state, 'cancelled');
  const lastLate = events.map((e) => e.event).lastIndexOf('late_write');
  assert.ok(lastLate >= 0, 'the daemon stub was writing');
  assert.ok(lastLate < events.length - 2, 'no daemon write after daemon_done / clean');
  await sleep(150);
  assert.equal(ledger(id).length, events.length, 'nothing is appended after clean');
  // (5) the report stub
  const stub = docPaths(after).report;
  assert.ok(existsSync(stub), `report stub at ${stub}`);
  assert.match(readFileSync(stub, 'utf8'), /cancel/i);
  // (6) child graph runs retired, scoped to the task's own runs
  for (const f of childRuns) {
    const run = JSON.parse(readFileSync(f, 'utf8'));
    assert.ok(run.retired && run.retired.by === 'teams', `${f} retired`);
  }
  assert.equal(JSON.parse(readFileSync(foreignRun, 'utf8')).retired, undefined, 'a run that is not the task\'s own is left alone');
  // the last event `clean` releases the push hold, with the hook unedited
  assert.ok(!pushDenied(cwd), 'the push hold is released by the closing clean');
  // (7) worktrees and branches stay for a later tm_clean
  const trees = git(cwd, 'worktree', 'list').stdout;
  assert.ok(trees.includes('/worktrees/P1') && trees.includes('/worktrees/P2'), trees);
  assert.ok(git(cwd, 'branch', '--list', 'teams/*').stdout.includes('/P1'));
  assert.deepEqual(spawned(), stubsBefore, 'the cancel itself spawned nothing');

  // (8) a following call on the cancelled task spawns nothing
  const quiet = async (name, args) => { await call(name, args).catch(() => {}); await sleep(100); assert.deepEqual(spawned(), stubsBefore, `${name} spawned something`); };
  await quiet('tm_status', { task_id: id });
  await quiet('tm_next', { task_id: id });
  const waited = await call('tm_wait', { task_id: id, max_ms: 1500 });
  assert.equal(waited.state, 'cancelled');
  assert.equal(waited.timed_out, false);
  assert.deepEqual(spawned(), stubsBefore);
  await assert.rejects(() => call('tm_retry', { task_id: id }), /task cancelled/);
  await assert.rejects(() => call('tm_retry', { task_id: id, package_id: 'P1' }), /task cancelled/);
  await assert.rejects(() => call('tm_submit', { task_id: id, node_id: 'dispatch:P1:1' }), /cancelled/);
  assert.deepEqual(spawned(), stubsBefore);
  const cleaned = await call('tm_clean', { task_id: id });
  assert.equal(cleaned.task_id, id);
  assert.deepEqual(spawned(), stubsBefore);
  assert.equal(ledger(id).at(-1).event, 'clean');
  assert.equal(tm.taskState(load(id)).state, 'cancelled');
  const status = await call('tm_status', { task_id: id });
  assert.equal(status.state, 'cancelled');
  assert.deepEqual(spawned(), stubsBefore);
});

// ---------- the no-ops and the other states ----------

test('tm_cancel twice, and on a complete task, is a no-op that reports the state', async () => {
  const cwd = repo();
  const id = seedTask(cwd, [], [
    graph.node('integrate:1', 'integrate', ['critique'], { subgoal_id: null, state: 'done', result: { stage_ok: true, verified: true } }),
    graph.node('report', 'report', ['integrate:1'], { subgoal_id: null, state: 'done', result: { stage_ok: true } }),
  ]);
  assert.equal(tm.taskState(load(id)).state, 'complete');
  const size = ledger(id).length;
  const out = await call('tm_cancel', { task_id: id });
  assert.equal(out.noop, true);
  assert.equal(out.state, 'complete');
  assert.equal(load(id).cancelled, undefined, 'no marker on a finished task');
  assert.equal(ledger(id).length, size, 'nothing appended');

  const running = seedTask(cwd, ['P1']);
  const first = await call('tm_cancel', { task_id: running });
  assert.equal(first.state, 'cancelled');
  const events = ledger(running).length;
  const again = await call('tm_cancel', { task_id: running });
  assert.equal(again.noop, true);
  assert.equal(again.state, 'cancelled');
  assert.equal(ledger(running).length, events, 'a second cancel appends nothing');
});

test('tm_cancel on a blocked task stops it the same way', async () => {
  const cwd = repo();
  const id = seedTask(cwd, ['P1']);
  save(id, (t) => {
    const d = t.nodes.find((n) => n.node_id === 'dispatch:P1:1');
    d.state = 'failed'; d.final = true; d.result = { stage_ok: false, reason: 'boom' };
    t.nodes.find((n) => n.node_id === 'accept:P1:1').state = 'unreachable';
  });
  assert.equal(tm.taskState(load(id)).state, 'blocked');
  const out = await call('tm_cancel', { task_id: id });
  assert.equal(out.state, 'cancelled');
  assert.equal(tm.taskState(load(id)).state, 'cancelled');
  assert.equal(ledger(id).at(-1).event, 'clean');
  assert.ok(existsSync(docPaths(load(id)).report));
});

test('a pid that is not the recorded process is not killed', async () => {
  const cwd = repo();
  const bystander = spawn('sleep', ['120'], { stdio: 'ignore' });
  bystanders.push(bystander);
  const id = seedTask(cwd, ['P1']);
  save(id, (t) => {
    // Recorded as a claude driver started an hour ago: the live sleep is a reused pid.
    t.nodes.find((n) => n.node_id === 'dispatch:P1:1').child = { cwd, run_id: 'none', driver: { pid: bystander.pid, started_at: Date.now() - 3600 * 1000, command: 'claude -p' } };
    t.nodes.find((n) => n.node_id === 'dispatch:P1:1').state = 'running';
  });
  const out = await call('tm_cancel', { task_id: id });
  assert.equal(out.state, 'cancelled');
  assert.ok(pidAlive(bystander.pid), 'an unrelated process that reused the pid is left alone');
});

// ---------- the viewers read a cancelled task as terminal ----------

test('the viewers read a cancelled task as terminal, not as work still in flight', async () => {
  const { collectTask } = await import(join(HERE, 'lib', 'view-collect.mjs'));
  const { summarize } = await import(join(HERE, 'lib', 'view-summary.mjs'));
  const { reportPayload } = await import(join(HERE, 'lib', 'view-report.mjs'));
  const { epicTicketState, epicPhase } = await import(join(HERE, '..', 'mcp', 'tickets.mjs'));
  const cwd = repo();
  const id = seedTask(cwd, ['P1']);
  // The cancel leaves the node states as they were: a dispatch that was running stays "running".
  save(id, (t) => { t.nodes.find((n) => n.node_id === 'dispatch:P1:1').state = 'running'; });
  await call('tm_cancel', { task_id: id });
  const task = load(id);
  assert.equal(epicTicketState(task), 'CANCELLED');
  assert.equal(epicPhase(task), null);
  const model = collectTask(ROOT, id);
  assert.equal(model.state, 'cancelled', 'collectTask: not stalled, not running');
  const sum = summarize(model);
  assert.equal(sum.state, 'cancelled');
  assert.equal(sum.now.kind, 'idle', 'no "build" step is being worked on a cancelled task');
  assert.ok(!sum.stages.some((s) => s.state === 'running'), 'no stage reads running');
  assert.ok(!sum.work.some((w) => w.state === 'running'), 'no card reads running');
  // the report tab: the task's collected state wins, a cancelled task reads blocked-not-running
  const rp = reportPayload(task, { verdict: model.state === 'complete' ? 'finished' : model.state === 'running' ? 'running' : 'blocked' });
  assert.equal(rp.verdict, 'blocked');
  assert.ok(rp.report && /cancel/i.test(rp.report.text || rp.report.head || JSON.stringify(rp.report)), 'the stub is the report');
  const board = await call('tm_board', { task_id: id });
  assert.equal(board.state, 'CANCELLED');
});
