#!/usr/bin/env node
// The MCP-start sweep: a running task whose daemon is dead is raised when a full-mode server.mjs
// starts, without any tm_* call, and the restart of a daemon its session killed is free.
// Runs on copies of the real-shape fixtures teams/scripts/fixtures/daemon-tick/531fddcf and 10db37d0.
//
//   node --test teams/scripts/test-daemon-sweep.mjs

process.env.TEAMS_RUNS_DIR ??= 'off';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { freeRestarts } from '../mcp/taskstate.mjs';
import { mutateTask } from '../mcp/store.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN = join(HERE, '..');
const SERVER = join(PLUGIN, 'mcp', 'server.mjs');
const SHAPES = { '531fddcf': '531fddcf-ee43-49df-b07e-53d2d0078423', '10db37d0': '10db37d0-85d2-4a0d-9c8a-311ad20c707f' };

delete process.env.HARNESS_TEST_NO_DRIVER;
delete process.env.HARNESS_TEST_NO_DAEMON;
delete process.env.HARNESS_TEST_NO_LEADER;
delete process.env.HARNESS_NODE;

const scratch = [];
const procs = [];
const killPid = (pid) => { for (const target of [-pid, pid]) { try { process.kill(target, 'SIGKILL'); } catch { /* gone */ } } };
const read = (f) => readFileSync(f, 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mk = (prefix) => { const d = mkdtempSync(join(tmpdir(), prefix)); scratch.push(d); return d; };

const root0 = mk('sweep-bin-');
const STAY = join(root0, 'stay.mjs');
writeFileSync(STAY, 'setTimeout(() => {}, 60000);\n');
process.env.HARNESS_DAEMON = `node ${STAY}`; // the daemon a sweep raises: a process that stays alive

const drivers = await import('../mcp/taskmanager-drivers.mjs');

// Every daemon a test raised is named by its task.json; the teardown kills them all.
const tasksRoots = [];
after(() => {
  for (const root of tasksRoots) {
    try {
      for (const id of Object.values(SHAPES).concat(...scratchIds)) {
        const f = join(root, id, 'task.json');
        if (existsSync(f)) { const t = JSON.parse(read(f)); if (t.daemon && t.daemon.pid) killPid(t.daemon.pid); }
      }
    } catch { /* best-effort */ }
  }
  for (const p of procs) { try { p.kill('SIGKILL'); } catch { /* gone */ } }
  for (const d of scratch) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best-effort */ } }
});
const scratchIds = [];

// A fresh tasks root holding one copy of a fixture under a new id, placeholders filled, daemon dead.
function seed(root, shape, mutate = null) {
  const full = SHAPES[shape];
  const id = randomUUID();
  scratchIds.push(id);
  const dir = join(root, id);
  const cwd = mk('sweep-cwd-');
  cpSync(join(HERE, 'fixtures', 'daemon-tick', shape), dir, { recursive: true });
  const fill = (s) => s.replaceAll(full, id).replaceAll('__TASK_DIR__', dir).replaceAll('__CWD__', cwd)
    .replaceAll('__CHILD_RUN_ID__', '00000000-0000-4000-8000-000000000001').replaceAll('__PLUGIN_DIR__', PLUGIN)
    .replaceAll('__TASK_ID__', id).replaceAll('__DRIVER_SCRIPT__', STAY).replaceAll('__HOME__', homedir());
  for (const f of ['task.json', 'ledger.jsonl']) writeFileSync(join(dir, f), fill(read(join(dir, f))));
  const t = JSON.parse(read(join(dir, 'task.json')));
  t.daemon.pid = 4194303;
  if (mutate) mutate(t, dir);
  writeFileSync(join(dir, 'task.json'), JSON.stringify(t, null, 1));
  const out = { id, dir, file: join(dir, 'task.json'), ledger: join(dir, 'ledger.jsonl') };
  out.base = {}; // the fixture's own history already holds some events: tests count what the sweep added
  for (const l of read(out.ledger).split('\n').filter(Boolean)) { const e = JSON.parse(l).event; out.base[e] = (out.base[e] || 0) + 1; }
  return out;
}

const newRoot = () => { const r = mk('sweep-tasks-'); tasksRoots.push(r); process.env.HARNESS_TASKS_DIR = r; return r; };
const task = (s) => JSON.parse(read(s.file));
const events = (s, name) => read(s.ledger).split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((e) => e.event === name).slice(s.base[name] || 0);
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

for (const shape of Object.keys(SHAPES)) {
  test(`${shape}: the sweep raises the dead daemon with no tm_* call, and its restart is free`, async () => {
    const root = newRoot();
    const s = seed(root, shape);
    const priorRestarts = task(s).daemon.restarts;
    const raised = await drivers.sweepDeadDaemons();
    assert.deepEqual(raised, [s.id]);
    const t = task(s);
    assert.ok(alive(t.daemon.pid), 'a daemon is alive again');
    const ev = events(s, 'daemon_restarted');
    assert.equal(ev.length, 1);
    assert.equal(ev[0].free, true);
    assert.equal(t.daemon.restarts, priorRestarts, 'a free restart keeps the daemon restart count');
    assert.equal(t.driver_restarts, 2, 'the budget itself is untouched');
    // a dead driver's restart inside the wake window rides free once, the next one counts
    const at = Date.now() + 1000;
    assert.equal(freeRestarts(t, [{ at }]).size, 1);
    assert.equal(freeRestarts(t, [{ at }, { at: at + 1000 }]).size, 1);
  });
}

test('the next death of the same daemon counts, and a task-fault death spends a restart at once', async () => {
  const root = newRoot();
  const s = seed(root, '531fddcf', (t) => { t.driver_restarts = 5; });
  await drivers.sweepDeadDaemons();
  const first = task(s);
  killPid(first.daemon.pid);
  await sleep(100);
  mutateTask(s.id, (t) => { drivers.serviceDaemon(t); }); // an ordinary tm_* re-raise
  const second = task(s);
  assert.equal(second.daemon.restarts, first.daemon.restarts + 1, 'an ordinary restart spends one');
  killPid(second.daemon.pid);
  await sleep(100);
  appendFileSync(s.ledger, JSON.stringify({ ts: Date.now() + 1, event: 'daemon_tick_exit', task_id: s.id, failures: 5 }) + '\n');
  await drivers.sweepDeadDaemons();
  const third = task(s);
  assert.equal(third.daemon.restarts, second.daemon.restarts + 1, 'a daemon that died of the task spends its restart');
  assert.equal(events(s, 'daemon_restarted').filter((e) => e.free).length, 1);
});

test('person-held, cancelled, cleaned and finished tasks are not raised; an engine-held task is', async () => {
  const root = newRoot();
  const held = seed(root, '531fddcf', (t) => { t.hold = { reason: 'on purpose', since: new Date().toISOString(), by: 'person' }; });
  const cancelled = seed(root, '531fddcf', (t) => { t.cancelled = { at: Date.now(), reason: 'test' }; });
  const cleaned = seed(root, '531fddcf');
  appendFileSync(cleaned.ledger, JSON.stringify({ ts: Date.now(), event: 'clean', task_id: cleaned.id }) + '\n');
  const done = seed(root, '531fddcf', (t) => { for (const n of t.nodes) n.state = 'done'; });
  assert.notEqual(drivers.taskState(task(done)).state, 'running', 'the finished fixture does not read running');
  const engine = seed(root, '10db37d0', (t) => { t.hold = { reason: 'capacity', since: new Date().toISOString(), by: 'engine' }; });
  const raised = await drivers.sweepDeadDaemons();
  assert.deepEqual(raised, [engine.id]);
  for (const s of [held, cancelled, cleaned, done]) assert.equal(task(s).daemon.pid, 4194303, `${s.id} keeps its dead daemon`);
  assert.equal(events(held, 'daemon_restarted').length, 0);
  assert.ok(alive(task(engine).daemon.pid));
});

test('two concurrent sweeps in two processes raise exactly one daemon per task', async () => {
  const root = newRoot();
  const s = seed(root, '531fddcf');
  const run = () => new Promise((resolve) => {
    const p = spawn(process.execPath, ['-e', `import(${JSON.stringify(join(PLUGIN, 'mcp', 'taskmanager-drivers.mjs'))}).then((m) => m.sweepDeadDaemons()).then(() => process.exit(0))`],
      { env: { ...process.env, HARNESS_TASKS_DIR: root }, stdio: 'ignore' });
    procs.push(p);
    p.on('exit', resolve);
  });
  await Promise.all([run(), run()]);
  assert.equal(events(s, 'daemon_restarted').length, 1);
});

// A minimal stdio client: sends initialize and resolves the ms until its reply.
function start(args, env) {
  const proc = spawn(process.execPath, [SERVER, ...args], { stdio: ['pipe', 'pipe', 'ignore'], env });
  procs.push(proc);
  const t0 = Date.now();
  let buf = '';
  const reply = new Promise((resolve) => {
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (c) => { buf += c; if (buf.includes('"id":1')) resolve(Date.now() - t0); });
  });
  proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }) + '\n');
  return { proc, reply };
}

const serverEnv = (root, extra = {}) => {
  const env = { ...process.env, HARNESS_TASKS_DIR: root, ...extra };
  delete env.TEAMS_WIKI_ROOT; delete env.TEAMS_WIKI_OFF; delete env.HARNESS_NODE;
  for (const [k, v] of Object.entries(extra)) if (v === undefined) delete env[k];
  return env;
};

test('a full-mode server start answers initialize within 3000 ms over 20 dead-daemon tasks, then sweeps', async () => {
  const root = newRoot();
  const all = [];
  for (let i = 0; i < 20; i++) all.push(seed(root, i % 2 ? '10db37d0' : '531fddcf'));
  const c = start([], serverEnv(root, { HARNESS_TEST_NO_DRIVER: '1' }));
  const ms = await c.reply;
  assert.ok(ms < 3000, `initialize took ${ms} ms`);
  const until = Date.now() + 30000;
  while (Date.now() < until && !all.every((s) => events(s, 'daemon_restarted').length === 1)) await sleep(200);
  assert.ok(all.every((s) => events(s, 'daemon_restarted').length === 1), 'the sweep raised every task after the handshake');
});

for (const [label, args, env] of [
  ['--stage node', ['--stage', 'node'], {}],
  ['--stage driver', ['--stage', 'driver'], {}],
  ['--only wiki', ['--only', 'wiki'], {}],
  ['a node-launched process (HARNESS_NODE)', [], { HARNESS_NODE: '1' }],
]) {
  test(`a server start with ${label} does not sweep`, async () => {
    const root = newRoot();
    const s = seed(root, '531fddcf');
    const e = serverEnv(root, { HARNESS_TEST_NO_DRIVER: '1', ...env });
    if (env.HARNESS_NODE) e.HARNESS_NODE = env.HARNESS_NODE;
    const c = start(args, e);
    await c.reply;
    await sleep(1500);
    assert.equal(events(s, 'daemon_restarted').length, 0);
    assert.equal(task(s).daemon.pid, 4194303);
    c.proc.kill('SIGKILL');
  });
}

test('the sweep never throws: a missing tasks root and a corrupt task.json are skipped', async () => {
  const root = newRoot();
  mkdirSync(join(root, 'junk'));
  writeFileSync(join(root, 'junk', 'task.json'), '{not json');
  assert.deepEqual(await drivers.sweepDeadDaemons(), []);
  process.env.HARNESS_TASKS_DIR = join(root, 'nope');
  assert.deepEqual(await drivers.sweepDeadDaemons(), []);
});
