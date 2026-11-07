// mcp/stateserver.mjs: the engine's state socket, one per tasks root.
// Each format the mod uses answers byte for byte like `node view.mjs --once` with the same args; a second
// start on a live socket exits 0; two starts racing leave one listener; a crash or a stale lock is recovered;
// proto=1 answers 200 with the headers and any other proto 409; the server ends itself after
// TEAMS_STATE_IDLE_MS of 200 answers (409s do not count); a task is rebuilt only when its task.json or
// ledger.jsonl changed, and between changes only its clock, pids and file mtimes are read; on 2001 finished
// tasks plus one running task with a driver and a judge stream, the mod's 3 s tick costs under 1% of a core.
// Fixtures are temp dirs (never ~/.harness/tasks). Every process this file starts is killed and checked dead.
//
//   node --test teams/scripts/test-stateserver.mjs
process.env.TEAMS_RUNS_DIR ??= 'off';
process.env.TZ = 'UTC';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { request } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, utimesSync, existsSync, chmodSync, appendFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTaskCache, statePaths, PROTO } from '../mcp/stateserver.mjs';
import { collectFromRaw, STALL_MS } from './lib/view-collect.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const VIEW = join(HERE, 'view.mjs');
const STATE = join(HERE, '..', 'mcp', 'stateserver.mjs');
const T0 = Date.UTC(2026, 9, 1);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const write = (p, s) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, s); utimesSync(p, T0 / 1000, T0 / 1000); };
const jl = (events) => events.map((e) => JSON.stringify(e)).join('\n') + '\n';
const node = (id, stage, state) => ({ node_id: id, stage, state, deps: [], after: [] });

const root = mkdtempSync(join(tmpdir(), 'state-sock-'));
const tasks = join(root, 'tasks');
const cwd = join(root, 'proj');
mkdirSync(tasks, { recursive: true });
mkdirSync(cwd, { recursive: true });
const pids = new Set(); // every process this file starts
const extraRoots = new Set();
const sockets = new Set();
const sock = (dir = tasks) => statePaths(dir).sock;

function addReported(id, dir = tasks, where = cwd) {
  write(join(dir, id, 'task.json'), JSON.stringify({ run_id: id, kind: 'task', cwd: where, request: `request ${id}`, created_at: T0, nodes: [node('size', 'size', 'done'), node('report', 'report', 'done')] }));
  write(join(dir, id, 'ledger.jsonl'), jl([{ ts: T0, event: 'node_finish', node_id: 'report' }, { ts: T0 + 1, event: 'daemon_done' }]));
}
addReported('E-aaaaaaaa1');
addReported('E-bbbbbbbb2');

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

after(() => {
  for (const p of pids) { try { process.kill(p, 'SIGKILL'); } catch { /* gone */ } }
  rmSync(root, { recursive: true, force: true });
  for (const r of extraRoots) rmSync(r, { recursive: true, force: true });
  for (const s of sockets) rmSync(s, { force: true });
  for (const p of pids) assert.equal(alive(p), false, `pid ${p} is dead`);
});

function serve(tasksDir = tasks, env = {}) {
  const c = spawn('node', [STATE, '--tasks-dir', tasksDir, '--foreground'], { env: { ...process.env, HARNESS_TASKS_DIR: tasksDir, ...env }, stdio: 'ignore' });
  pids.add(c.pid);
  const exited = new Promise((r) => c.once('exit', (code) => r(code)));
  return { c, exited };
}

function get(path, url) {
  return new Promise((resolve, reject) => {
    const req = request({ socketPath: path, path: url, method: 'GET' }, (res) => {
      const chunks = [];
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end();
  });
}

const query = (args, extra = 'proto=1') => {
  const q = new URLSearchParams(extra);
  for (let i = 0; i < args.length; i += 2) q.set(args[i].replace(/^--/, ''), args[i + 1]);
  return '/?' + q.toString();
};

async function ready(path) {
  for (let i = 0; i < 200; i++) {
    if (existsSync(path)) { try { if ((await get(path, query(['--format', 'events', '--since', '0', '--cwd', cwd]))).status === 200) return; } catch { /* not listening yet */ } }
    await sleep(50);
  }
  throw new Error('server did not come up');
}

const once = (args, dir = tasks) => spawnSync('node', [VIEW, '--tasks-dir', dir, '--once', ...args], { encoding: 'utf8' }).stdout;

async function kill(h) {
  h.c.kill('SIGTERM');
  await Promise.race([h.exited, sleep(3000)]);
  h.c.kill('SIGKILL');
}
const exitsWithin = (h, ms) => Promise.race([h.exited, sleep(ms).then(() => 'timeout')]);

test('every format the mod uses answers byte for byte like --once', async () => {
  const path = sock();
  const h = serve();
  try {
    await ready(path);
    const cases = [
      ['--format', 'events', '--since', '0', '--cwd', cwd],
      ['--format', 'status', '--cwd', cwd],
      ['--format', 'summary', '--cwd', cwd, '--task', 'E-aaaaaaaa1'],
      ['--format', 'teams', '--cwd', cwd, '--task', 'E-aaaaaaaa1'],
      ['--format', 'report', '--task', 'E-aaaaaaaa1', '--cwd', cwd],
      ['--format', 'decisions', '--task', 'E-aaaaaaaa1', '--cwd', cwd],
      ['--format', 'board', '--cwd', cwd],
    ];
    for (const args of cases) {
      const r = await get(path, query(args));
      assert.equal(r.status, 200, args.join(' '));
      // the teams payload stamps the render time as "at":<ms>; it is the only wall-clock field
      const same = (s) => (args[1] === 'teams' ? s.replace(/"at":\d+/g, '"at":0') : s);
      assert.equal(same(r.body), same(once(args)), args.join(' '));
    }
    assert.equal((await get(path, query([], 'proto=1&view=bad'))).status, 500);
    assert.equal((await get(path, query(cases[1]))).status, 200);
  } finally { await kill(h); }
});

test('the socket is <tasksDir>/.state.sock, with no plugin version in its name', () => {
  assert.equal(statePaths(tasks).sock, join(tasks, '.state.sock'));
  assert.equal(statePaths(tasks).lock, join(tasks, '.state.lock'));
  const version = JSON.parse(readFileSync(join(HERE, '..', '.claude-plugin', 'plugin.json'), 'utf8')).version;
  assert.ok(!statePaths(tasks).sock.includes(version));
});

test('protocol: proto=1 answers 200 with the headers; another proto, or none, is a 409 with the JSON body', async () => {
  const version = JSON.parse(readFileSync(join(HERE, '..', '.claude-plugin', 'plugin.json'), 'utf8')).version;
  const path = sock();
  const h = serve();
  try {
    await ready(path);
    const ok = await get(path, query(['--format', 'status', '--cwd', cwd]));
    assert.equal(ok.status, 200);
    assert.equal(ok.headers['x-teams-state-proto'], String(PROTO));
    assert.equal(ok.headers['x-teams-version'], version);
    assert.match(ok.headers['x-teams-state-collects'], /^\d+$/);
    const other = await get(path, query(['--format', 'status'], 'proto=999'));
    assert.equal(other.status, 409);
    assert.deepEqual(JSON.parse(other.body), { error: 'protocol', server: 1, client: 999 });
    assert.ok(other.body.endsWith('\n'));
    const none = await get(path, '/?format=status');
    assert.equal(none.status, 409);
    assert.deepEqual(JSON.parse(none.body), { error: 'protocol', server: 1, client: null });
  } finally { await kill(h); }
});

test('a second start on a live socket exits 0 and the first keeps answering', async () => {
  const path = sock();
  const first = serve();
  try {
    await ready(path);
    const second = serve();
    assert.equal(await exitsWithin(second, 5000), 0);
    assert.equal((await get(path, query(['--format', 'status', '--cwd', cwd]))).status, 200);
    assert.equal(first.c.exitCode, null);
  } finally { await kill(first); }
});

test('two starts racing on one tasks root leave exactly one listener, and two concurrent clients both get 200', async () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'state-race-')), 'tasks');
  mkdirSync(dir, { recursive: true });
  extraRoots.add(dirname(dir));
  const path = sock(dir);
  const [a, b] = await Promise.all([serve(dir), serve(dir)]);
  try {
    const first = await Promise.race([a.exited.then((c) => ({ c, who: 'a' })), b.exited.then((c) => ({ c, who: 'b' })), sleep(10000).then(() => ({ c: 'timeout' }))]);
    assert.equal(first.c, 0, 'the loser exits 0');
    const winner = first.who === 'a' ? b : a;
    await ready(path);
    assert.equal(winner.c.exitCode, null, 'the other one stays up');
    const [x, y] = await Promise.all([get(path, query(['--format', 'status'])), get(path, query(['--format', 'events', '--since', '0']))]);
    assert.equal(x.status, 200);
    assert.equal(y.status, 200);
    const live = [a, b].filter((h) => h.c.exitCode === null && h.c.signalCode === null);
    assert.equal(live.length, 1, 'one live server of the two');
  } finally { await kill(a); await kill(b); }
});

test('a leftover socket file is replaced and the new server answers', async () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'state-leftover-')), 'tasks');
  mkdirSync(dir, { recursive: true });
  extraRoots.add(dirname(dir));
  writeFileSync(sock(dir), 'stale');
  const h = serve(dir);
  try {
    await ready(sock(dir));
    assert.equal((await get(sock(dir), query(['--format', 'status']))).status, 200);
  } finally { await kill(h); }
});

test('a bound socket whose listener is gone is replaced and answers', async () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'state-dead-')), 'tasks');
  mkdirSync(dir, { recursive: true });
  extraRoots.add(dirname(dir));
  const path = sock(dir);
  // a listener that dies without unlinking: SIGKILL a child holding the socket
  const holder = spawn('node', ['-e', `require('net').createServer().listen(${JSON.stringify(path)}, () => process.stdout.write('up'))`], { stdio: ['ignore', 'pipe', 'ignore'] });
  pids.add(holder.pid);
  await new Promise((r) => holder.stdout.once('data', r));
  holder.kill('SIGKILL');
  await new Promise((r) => holder.once('exit', r));
  assert.ok(existsSync(path), 'socket file left behind');
  const h = serve(dir);
  try {
    await ready(path);
    assert.equal((await get(path, query(['--format', 'status']))).status, 200);
  } finally { await kill(h); }
});

test('crash recovery: a SIGKILLed server leaves its socket and lock, and the next single start answers', async () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'state-crash-')), 'tasks');
  mkdirSync(dir, { recursive: true });
  extraRoots.add(dirname(dir));
  const path = sock(dir);
  const first = serve(dir);
  await ready(path);
  first.c.kill('SIGKILL');
  await first.exited;
  assert.ok(existsSync(path) && existsSync(statePaths(dir).lock), 'socket and lock left behind');
  const second = serve(dir);
  try {
    await ready(path);
    assert.equal((await get(path, query(['--format', 'status']))).status, 200);
  } finally { await kill(second); }
});

test('a stale lock race: two starters against a leftover socket and a dead pid lock end with one live listener (5 rounds)', async () => {
  for (let round = 0; round < 5; round++) {
    const dir = join(mkdtempSync(join(tmpdir(), 'state-stale-')), 'tasks');
    mkdirSync(dir, { recursive: true });
    extraRoots.add(dirname(dir));
    const dead = spawn('node', ['-e', '0'], { stdio: 'ignore' });
    pids.add(dead.pid);
    await new Promise((r) => dead.once('exit', r));
    writeFileSync(sock(dir), 'stale');
    writeFileSync(statePaths(dir).lock, JSON.stringify({ pid: dead.pid, token: 'dead', at: Date.now() - 60000 }));
    const [a, b] = [serve(dir), serve(dir)];
    try {
      await ready(sock(dir));
      await sleep(600); // let the loser finish
      const live = [a, b].filter((h) => h.c.exitCode === null && h.c.signalCode === null);
      assert.equal(live.length, 1, `round ${round}: one live listener`);
      assert.equal((await get(sock(dir), query(['--format', 'status']))).status, 200, `round ${round}: it answers`);
    } finally { await kill(a); await kill(b); }
  }
});

test('exit hygiene: a server whose lock names another live server leaves the socket in place on SIGTERM', async () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'state-foreign-')), 'tasks');
  mkdirSync(dir, { recursive: true });
  extraRoots.add(dirname(dir));
  const h = serve(dir);
  await ready(sock(dir));
  writeFileSync(statePaths(dir).lock, JSON.stringify({ pid: process.pid, token: 'someone-else', at: Date.now() }));
  h.c.kill('SIGTERM');
  assert.equal(await exitsWithin(h, 5000), 0);
  assert.ok(existsSync(sock(dir)), 'the socket of the live holder stays');
  assert.ok(existsSync(statePaths(dir).lock), 'and so does its lock');
});

const q200 = (dir) => get(sock(dir), query(['--format', 'events', '--since', '0', '--cwd', cwd]));
const ps1 = (pid, col) => spawnSync('ps', ['-o', `${col}=`, '-p', String(pid)], { encoding: 'utf8' }).stdout.trim();

test('SIGHUP does not end the server', async () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'state-hup-')), 'tasks');
  mkdirSync(dir, { recursive: true });
  extraRoots.add(dirname(dir));
  const h = serve(dir);
  await ready(sock(dir));
  h.c.kill('SIGHUP');
  await sleep(600);
  assert.equal(alive(h.c.pid), true);
  assert.equal((await q200(dir)).status, 200);
  await kill(h);
});

test('the server outlives the session that started it: its own session, a hangup of the starter group leaves it answering, SIGTERM removes sock and lock', async () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'state-detach-')), 'tasks');
  mkdirSync(dir, { recursive: true });
  extraRoots.add(dirname(dir));
  const lock = statePaths(dir).lock;
  // the starter: a shell in its own process group running the default (detaching) CLI
  const starter = spawn('sh', ['-c', `node "${STATE}" --tasks-dir "${dir}"; sleep 1000`], { detached: true, stdio: 'ignore' });
  pids.add(starter.pid);
  await ready(sock(dir));
  const spid = JSON.parse(readFileSync(lock, 'utf8')).pid;
  pids.add(spid);
  assert.notEqual(spid, starter.pid);
  assert.notEqual(ps1(spid, 'pgid'), String(starter.pid), 'the server left the starter process group');
  assert.equal(ps1(spid, 'pgid'), String(spid), 'and leads its own group (setsid)');
  process.kill(-starter.pid, 'SIGHUP');
  await sleep(300);
  try { process.kill(-starter.pid, 'SIGKILL'); } catch { /* already gone */ }
  await sleep(700);
  assert.equal(alive(starter.pid), false);
  assert.equal(alive(spid), true, 'the server survived the starter group');
  assert.equal((await q200(dir)).status, 200);
  process.kill(spid, 'SIGTERM');
  for (let i = 0; i < 60 && alive(spid); i++) await sleep(50);
  assert.equal(alive(spid), false);
  assert.equal(existsSync(sock(dir)), false);
  assert.equal(existsSync(lock), false);
});

test('idle: the server exits and removes its socket and lock', async () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'state-idle-')), 'tasks');
  mkdirSync(dir, { recursive: true });
  extraRoots.add(dirname(dir));
  const h = serve(dir, { TEAMS_STATE_IDLE_MS: '400' });
  await ready(sock(dir));
  assert.equal(await exitsWithin(h, 5000), 0);
  assert.equal(existsSync(sock(dir)), false);
  assert.equal(existsSync(statePaths(dir).lock), false);
});

test('idle: only a 200 answer resets the clock; a client polling with another proto does not keep the server alive', async () => {
  const dirA = join(mkdtempSync(join(tmpdir(), 'state-409-')), 'tasks');
  const dirB = join(mkdtempSync(join(tmpdir(), 'state-200-')), 'tasks');
  for (const d of [dirA, dirB]) { mkdirSync(d, { recursive: true }); extraRoots.add(dirname(d)); }
  const a = serve(dirA, { TEAMS_STATE_IDLE_MS: '600' });
  const b = serve(dirB, { TEAMS_STATE_IDLE_MS: '600' });
  try {
    await ready(sock(dirA));
    await ready(sock(dirB));
    const until = Date.now() + 2000;
    while (Date.now() < until) {
      await get(sock(dirA), query(['--format', 'status'], 'proto=999')).catch(() => {});
      await get(sock(dirB), query(['--format', 'status'])).catch(() => {});
      await sleep(100);
    }
    assert.notEqual(a.c.exitCode, null, 'the 409-only poll did not keep it alive');
    assert.equal(b.c.exitCode, null, 'the proto=1 poll did');
  } finally { await kill(a); await kill(b); }
});

test('a repeat request inside the 2 s window is served from the cache, then it renders again', async () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'state-ttl-')), 'tasks');
  mkdirSync(dir, { recursive: true });
  extraRoots.add(dirname(dir));
  addReported('E-aaaaaaaa1', dir);
  const h = serve(dir);
  const once2 = () => once([], dir);
  try {
    await ready(sock(dir));
    await sleep(2200);
    const url = '/?proto=1&view=pipeline';
    const a = await get(sock(dir), url);
    assert.equal(a.status, 200);
    addReported('E-cccccccc3', dir);
    const b = await get(sock(dir), url);
    assert.equal(b.body, a.body, 'cached inside the window');
    await sleep(2200);
    const c = await get(sock(dir), url);
    assert.notEqual(c.body, a.body, 'rendered again after the window');
    assert.equal(c.body, once2());
  } finally { await kill(h); }
});

test('two sessions with different --session and --since share one base per tick and each gets its own --once answer', async () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'state-sess-')), 'tasks');
  mkdirSync(dir, { recursive: true });
  extraRoots.add(dirname(dir));
  addReported('E-aaaaaaaa1', dir);
  addReported('E-bbbbbbbb2', dir);
  const h = serve(dir);
  const path = sock(dir);
  try {
    await ready(path);
    await sleep(2200); // a fresh tick, whatever ready() cached
    const sessA = ['--format', 'events', '--since', '0', '--cwd', cwd, '--session', 's1'];
    const sessB = ['--format', 'events', '--since', '1', '--cwd', cwd, '--session', 's2'];
    const sumB = ['--format', 'summary', '--cwd', cwd, '--session', 's2'];
    const teamsB = ['--format', 'teams', '--cwd', cwd, '--session', 's2', '--task', 'E-aaaaaaaa1'];
    const mask = (s) => s.replace(/"at":\d+/g, '"at":0');
    const a = await get(path, query(sessA));
    assert.equal(a.body, once(sessA, dir));
    // a task that appears mid-tick is not in the shared sweep: the other session's answer is the same base
    addReported('E-dddddddd4', dir);
    const b = await get(path, query(sessB));
    assert.equal(b.body, a.body, "the second session reads the first session's base");
    await sleep(2200);
    const b2 = await get(path, query(sessB));
    assert.equal(b2.body, once(sessB, dir), 'next tick: byte-equal to its own --once');
    assert.notEqual(b2.body, a.body);
    assert.equal((await get(path, query(sumB))).body, once(sumB, dir));
    assert.equal(mask((await get(path, query(teamsB))).body), mask(once(teamsB, dir)));
  } finally { await kill(h); }
});

// ---------- a long root: the socket moves to the tmpdir ----------

test('a tasks root whose socket path is over 103 bytes serves on the hashed tmpdir path; --sock-path prints it', async () => {
  let deep = mkdtempSync(join(tmpdir(), 'state-deep-'));
  extraRoots.add(deep);
  while (Buffer.byteLength(join(deep, '.state.sock')) <= 104) deep = join(deep, 'deeper-dir-name');
  mkdirSync(deep, { recursive: true });
  const printed = spawnSync('node', [STATE, '--sock-path', '--tasks-dir', deep], { encoding: 'utf8' }).stdout.trim();
  assert.equal(printed, statePaths(deep).sock);
  assert.ok(/teams-state-[0-9a-f]{12}\.sock$/.test(printed), printed);
  assert.ok(Buffer.byteLength(printed) <= 103);
  sockets.add(printed);
  const h = serve(deep);
  try {
    await ready(printed);
    assert.equal((await get(printed, query(['--format', 'status']))).status, 200);
    assert.equal(existsSync(join(deep, '.state.sock')), false, 'no socket in the deep root');
    assert.ok(existsSync(join(deep, '.state.lock')), 'the lock stays in the root');
  } finally { await kill(h); }
});

// ---------- one task: rebuilt only when its task.json or ledger.jsonl changed ----------

const taskJson = (id, extra = {}) => JSON.stringify({ run_id: id, kind: 'task', cwd, request: `request ${id}`, created_at: Date.now() - 12 * 60 * 1000, nodes: [node('size', 'size', 'running')], ...extra });

function runningTask(dir, id, { driverPid, log, ledgerTs = Date.now() } = {}) {
  const nodes = [{ ...node('size', 'size', 'running'), child: { driver: { pid: driverPid, started_at: Date.now(), command: 'sleep' } } }];
  if (log) nodes[0].child.driver.log = log;
  mkdirSync(join(dir, id), { recursive: true });
  writeFileSync(join(dir, id, 'task.json'), taskJson(id, { nodes }));
  writeFileSync(join(dir, id, 'ledger.jsonl'), jl([{ ts: ledgerTs, event: 'node_start', node_id: 'size' }]));
}

function sleeper() {
  const c = spawn('sleep', ['1137'], { stdio: 'ignore' });
  pids.add(c.pid);
  const exited = new Promise((r) => c.once('exit', r));
  return { c, exited };
}

const stream = (p, text = 'working on it') => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text }] } }) + '\n'); };

test('createTaskCache: an unchanged task is built in full once; a ledger append or a task.json rewrite rebuilds only that task', () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'state-cache-')), 'tasks');
  mkdirSync(dir, { recursive: true });
  extraRoots.add(dirname(dir));
  runningTask(dir, 'E-run00001', { driverPid: process.pid });
  runningTask(dir, 'E-run00002', { driverPid: process.pid });
  let builds = 0;
  const cache = createTaskCache({ refreshMs: 0, build: (...a) => { builds += 1; return collectFromRaw(...a); } });
  for (let i = 0; i < 6; i++) { cache.get(dir, 'E-run00001'); cache.get(dir, 'E-run00002'); }
  assert.equal(cache.stats.collects, 2, 'one full collect per task');
  assert.deepEqual(cache.stats.byId, { 'E-run00001': 1, 'E-run00002': 1 });
  assert.deepEqual(cache.stats.reads, { ledger: 4, costs: 2, runs: 0, live: 0 }, 'ledger and board read once each per task, costs once');
  assert.ok(cache.stats.refreshes >= 10, 'each later get rebuilt the model from the parsed task.json, reading no ledger or cost again');
  assert.equal(builds, 2 + cache.stats.refreshes);

  appendFileSync(join(dir, 'E-run00001', 'ledger.jsonl'), jl([{ ts: Date.now(), event: 'node_finish', node_id: 'x' }]));
  cache.get(dir, 'E-run00001');
  cache.get(dir, 'E-run00002');
  assert.deepEqual(cache.stats.byId, { 'E-run00001': 2, 'E-run00002': 1 }, 'only the changed task is collected again');
  assert.equal(cache.stats.reads.costs, 3);

  writeFileSync(join(dir, 'E-run00002', 'task.json'), taskJson('E-run00002', { slug: 'renamed', nodes: [node('size', 'size', 'running')] }));
  cache.get(dir, 'E-run00002');
  assert.deepEqual(cache.stats.byId, { 'E-run00001': 2, 'E-run00002': 2 });
});

test('F3-AC-33: a driver stream that grows inside the answer window is costed again with no task.json or ledger change', () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'state-cost-')), 'tasks');
  mkdirSync(dir, { recursive: true });
  extraRoots.add(dirname(dir));
  const log = join(dir, 'E-run00033', 'drivers', 'dispatch_P1_1.stream.jsonl');
  const result = (usd) => JSON.stringify({ type: 'result', total_cost_usd: usd, num_turns: 1 }) + '\n';
  stream(log);
  runningTask(dir, 'E-run00033', { driverPid: process.pid, log });
  let t = Date.now();
  const cache = createTaskCache({ refreshMs: 2000, now: () => t });
  assert.equal(cache.get(dir, 'E-run00033').cost.usd, 0);
  assert.equal(cache.stats.reads.costs, 1);
  writeFileSync(log, result(1.5));
  t += 2000;
  assert.equal(cache.get(dir, 'E-run00033').cost.usd, 1.5, 'the second answer carries the stream\'s new cost');
  writeFileSync(log, result(1.5) + result(4.25));
  t += 2000;
  assert.equal(cache.get(dir, 'E-run00033').cost.usd, 4.25);
  assert.equal(cache.stats.collects, 1, 'task.json and ledger.jsonl were never touched');
  assert.equal(cache.stats.reads.costs, 3);
});

test('F3-AC-41: the volatile key flips at the task\'s own stall_minutes, with the verdict\'s minutes', async () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'state-own-limit-')), 'tasks');
  mkdirSync(dir, { recursive: true });
  extraRoots.add(dirname(dir));
  const log = join(dir, 'E-run00041', 'drivers', 'dispatch_P1_1.stream.jsonl');
  stream(log);
  runningTask(dir, 'E-run00041', { driverPid: process.pid, log });
  const tp = join(dir, 'E-run00041', 'task.json');
  writeFileSync(tp, JSON.stringify({ ...JSON.parse(readFileSync(tp, 'utf8')), stall_minutes: 20, created_at: Date.now() - 60 * 60 * 1000 }));
  // 19 min silent: past the default 10 minutes, inside the task's own 20; the ledger is old, so the stream is the newest sign of life
  const at = (Date.now() - 19 * 60 * 1000) / 1000;
  utimesSync(log, at, at);
  const old = (Date.now() - 60 * 60 * 1000) / 1000;
  utimesSync(join(dir, 'E-run00041', 'ledger.jsonl'), old, old);
  const cache = createTaskCache({ refreshMs: 0 });
  assert.equal(cache.get(dir, 'E-run00041').state, 'running', '19 min of 20: running');
  const collects = cache.stats.collects;
  // the stream crosses 20 min with no file change: only the key moves
  const edge = (Date.now() - 20 * 60 * 1000 + 1200) / 1000;
  utimesSync(log, edge, edge);
  assert.equal(cache.get(dir, 'E-run00041').state, 'running', 'just under 20 min');
  await sleep(1500);
  const m = cache.get(dir, 'E-run00041');
  assert.equal(m.state, 'stalled', 'past 20 min: stalled');
  assert.equal(m.stall.minutes, 20);
  assert.equal(m.stall.minutes, collectFromRaw(dir, 'E-run00041', JSON.parse(readFileSync(tp, 'utf8'))).stall.minutes, 'same minutes as a fresh collect');
  assert.equal(cache.stats.collects, collects, 'no task.json or ledger change: no full collect');
});

test('createTaskCache: a dead driver pid and a stale stream read stalled with no full collect', async () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'state-clock-')), 'tasks');
  mkdirSync(dir, { recursive: true });
  extraRoots.add(dirname(dir));
  const sl = sleeper();
  const log = join(dir, 'E-run00003', 'drivers', 'dispatch_P1_1.stream.jsonl');
  stream(log);
  runningTask(dir, 'E-run00003', { driverPid: sl.c.pid, log });
  const cache = createTaskCache({ refreshMs: 0 });
  assert.equal(cache.get(dir, 'E-run00003').state, 'running');
  sl.c.kill('SIGKILL');
  await sl.exited;
  assert.equal(cache.get(dir, 'E-run00003').state, 'stalled', 'the pid died: stalled');
  assert.equal(cache.stats.collects, 1);
  // a live pid but a stream 11 minutes old
  const sl2 = sleeper();
  runningTask(dir, 'E-run00004', { driverPid: sl2.c.pid, log });
  const old = (Date.now() - 11 * 60 * 1000) / 1000;
  utimesSync(log, old, old);
  const c2 = createTaskCache({ refreshMs: 0 });
  assert.equal(c2.get(dir, 'E-run00004').state, 'stalled', 'the stream is old: stalled');
  const now = Date.now() / 1000;
  utimesSync(log, now, now);
  assert.equal(c2.get(dir, 'E-run00004').state, 'running', 'the stream moved: running again');
  assert.equal(c2.stats.collects, 1, 'no full collect for either flip');
  sl2.c.kill('SIGKILL');
});

test('black box: collects stay constant over windows; with every task file unreadable the answers keep their facts; a stream mtime flips stalled to running by stat only', { skip: process.getuid?.() === 0 ? 'root ignores file modes' : false }, async () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'state-box-')), 'tasks');
  mkdirSync(dir, { recursive: true });
  extraRoots.add(dirname(dir));
  const proj = join(dirname(dir), 'proj');
  mkdirSync(proj, { recursive: true });
  const sl = sleeper();
  const id = 'E-boxrun01';
  const log = join(dir, id, 'drivers', 'dispatch_P1_1.stream.jsonl');
  stream(log);
  const old = (Date.now() - 11 * 60 * 1000) / 1000;
  utimesSync(log, old, old);
  runningTask(dir, id, { driverPid: sl.c.pid, log });
  const text = JSON.parse(readFileSync(join(dir, id, 'task.json'), 'utf8'));
  text.cwd = proj;
  writeFileSync(join(dir, id, 'task.json'), JSON.stringify(text));
  const path = sock(dir);
  const h = serve(dir);
  const sum = async () => {
    const r = await get(path, query(['--format', 'summary', '--cwd', proj]));
    assert.equal(r.status, 200);
    const j = JSON.parse(r.body);
    return { collects: r.headers['x-teams-state-collects'], tasks: j.tasks.map((t) => ({ id: t.task_id, live: t.live, state: t.state })), status: j.status.line };
  };
  const files = [join(dir, id, 'task.json'), join(dir, id, 'ledger.jsonl'), log];
  try {
    await ready(path);
    await sleep(2200);
    const first = await sum();
    assert.deepEqual(first.tasks.map((t) => [t.id, t.live]), [[id, false]], 'a stream 11 minutes old reads stalled');
    for (let i = 0; i < 3; i++) { await sleep(2200); assert.equal((await sum()).collects, first.collects, `window ${i}: collects constant`); }
    // (b) every file of the task unreadable: the same facts, still 200
    const statusBefore = (await get(path, query(['--format', 'status', '--cwd', proj]))).body;
    for (const f of files) chmodSync(f, 0o000);
    await sleep(2200);
    const locked = await sum();
    assert.deepEqual(locked, { ...first, collects: locked.collects });
    assert.equal(locked.collects, first.collects, 'unreadable files do not trigger a collect');
    await sleep(2200);
    assert.equal((await get(path, query(['--format', 'status', '--cwd', proj]))).body, statusBefore, 'status bytes unchanged');
    // (c) the stream's mtime moves: running again by stat alone, collects unchanged
    const now = Date.now() / 1000;
    utimesSync(log, now, now);
    await sleep(2200);
    const moved = await sum();
    assert.equal(moved.collects, first.collects);
    assert.deepEqual(moved.tasks.map((t) => [t.id, t.live]), [[id, true]], 'the stream moved: live');
  } finally {
    for (const f of files) { try { chmodSync(f, 0o644); } catch { /* gone */ } }
    sl.c.kill('SIGKILL');
    await kill(h);
  }
});

test('black box: the collects header rises by exactly one after one ledger append to the running task', async () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'state-hdr-')), 'tasks');
  mkdirSync(dir, { recursive: true });
  extraRoots.add(dirname(dir));
  addReported('E-aaaaaaaa1', dir);
  const sl = sleeper();
  runningTask(dir, 'E-run00005', { driverPid: sl.c.pid });
  const h = serve(dir);
  const path = sock(dir);
  const collects = async () => (await get(path, query(['--format', 'summary', '--cwd', cwd]))).headers['x-teams-state-collects'];
  try {
    await ready(path);
    await sleep(2200);
    const a = await collects();
    await sleep(2200);
    assert.equal(await collects(), a);
    await sleep(2200);
    assert.equal(await collects(), a);
    appendFileSync(join(dir, 'E-run00005', 'ledger.jsonl'), jl([{ ts: Date.now(), event: 'node_finish', node_id: 'y' }]));
    await sleep(2200);
    assert.equal(Number(await collects()), Number(a) + 1);
  } finally { sl.c.kill('SIGKILL'); await kill(h); }
});

// A task whose daemon is dead and that no driver records: reads stalled while its files are young.
function stalledTask(dir, id) {
  mkdirSync(join(dir, id), { recursive: true });
  writeFileSync(join(dir, id, 'task.json'), taskJson(id, { nodes: [node('size', 'size', 'done'), node('shape', 'shape', 'running')], daemon: { pid: 2147483645, started_at: Date.now(), restarts: 0 } }));
  writeFileSync(join(dir, id, 'ledger.jsonl'), jl([{ ts: Date.now(), event: 'node_start', node_id: 'shape' }]));
}

// One running task (live sleeper, a stream nobody writes during the test), one stalled, one finished.
function threeTasks(prefix) {
  const dir = join(mkdtempSync(join(tmpdir(), prefix)), 'tasks');
  mkdirSync(dir, { recursive: true });
  extraRoots.add(dirname(dir));
  const sl = sleeper();
  const log = join(dir, 'E-run00011', 'drivers', 'dispatch_P1_1.stream.jsonl');
  stream(log);
  runningTask(dir, 'E-run00011', { driverPid: sl.c.pid, log });
  stalledTask(dir, 'E-stall001');
  addReported('E-done0001', dir);
  return { dir, sl, ids: ['E-run00011', 'E-stall001', 'E-done0001'] };
}

const ANSWER_WINDOW_MS = 2000;
const snap = (s) => JSON.parse(JSON.stringify(s));

test('createTaskCache: two polls past the window with no file change collect, rebuild and read nothing again; one ledger append collects that task only', async () => {
  const { dir, sl, ids } = threeTasks('state-two-');
  try {
    const cache = createTaskCache();
    const [run, stall] = ids.map((id) => cache.get(dir, id));
    assert.equal(run.state, 'running');
    assert.equal(stall.state, 'stalled');
    const a = snap(cache.stats);
    await sleep(ANSWER_WINDOW_MS + 300);
    for (const id of ids) cache.get(dir, id);
    const b = snap(cache.stats);
    assert.equal(b.collects, a.collects);
    assert.deepEqual(b.byId, a.byId);
    assert.equal(b.rebuilds, a.rebuilds, 'no task was built again: no pid, stream or run file moved');
    assert.deepEqual(b.reads, a.reads);
    appendFileSync(join(dir, 'E-run00011', 'ledger.jsonl'), jl([{ ts: Date.now(), event: 'node_finish', node_id: 'x' }]));
    for (const id of ids) cache.get(dir, id);
    assert.equal(cache.stats.collects, a.collects + 1);
    assert.deepEqual(cache.stats.byId, { ...a.byId, 'E-run00011': a.byId['E-run00011'] + 1 });
  } finally { sl.c.kill('SIGKILL'); await sl.exited; }
});

test('createTaskCache: clock fields move without a rebuild for a running and a stalled task', async () => {
  const { dir, sl, ids } = threeTasks('state-clk-');
  try {
    const built = {};
    const cache = createTaskCache({ build: (d, id, ...a) => { built[id] = (built[id] || 0) + 1; return collectFromRaw(d, id, ...a); } });
    const first = Object.fromEntries(ids.map((id) => [id, cache.get(dir, id).elapsed_ms]));
    const was = snap(built);
    const t0 = Date.now();
    await sleep(ANSWER_WINDOW_MS + 300);
    const wall = Date.now() - t0;
    for (const id of ids) {
      const moved = cache.get(dir, id).elapsed_ms - first[id];
      assert.ok(Math.abs(moved - wall) <= ANSWER_WINDOW_MS + 250, `${id}: elapsed_ms moved ${moved} ms over ${wall} ms of wall time`);
    }
    assert.deepEqual(built, was, 'no task was built again');
    assert.equal(cache.stats.rebuilds, 0);
  } finally { sl.c.kill('SIGKILL'); await sl.exited; }
});

test('createTaskCache: a quiet stream crosses STALL_MS and reads stalled with no file change', async () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'state-cross-')), 'tasks');
  mkdirSync(dir, { recursive: true });
  extraRoots.add(dirname(dir));
  const sl = sleeper();
  const id = 'E-cross001';
  const log = join(dir, id, 'drivers', 'dispatch_P1_1.stream.jsonl');
  stream(log);
  const at = (Date.now() - STALL_MS + 2500) / 1000;
  utimesSync(log, at, at);
  runningTask(dir, id, { driverPid: sl.c.pid, log });
  try {
    const cache = createTaskCache();
    assert.equal(cache.get(dir, id).state, 'running');
    const collects = cache.stats.collects;
    await sleep(3500);
    const m = cache.get(dir, id);
    const fresh = collectFromRaw(dir, id, JSON.parse(readFileSync(join(dir, id, 'task.json'), 'utf8')));
    assert.equal(fresh.state, 'stalled');
    assert.equal(m.state, fresh.state, 'the cached model flipped with the clock');
    assert.equal(m.ticket.state, fresh.ticket.state);
    assert.equal(cache.stats.collects, collects, 'no full collect for the flip');
  } finally { sl.c.kill('SIGKILL'); await sl.exited; }
});

test('status and events over a running, a stalled and a finished task answer byte for byte like --once, tick after tick', async () => {
  const { dir, sl } = threeTasks('state-live-');
  const path = sock(dir);
  const h = serve(dir);
  try {
    await ready(path);
    const events = ['--format', 'events', '--since', '0', '--cwd', cwd];
    const status = ['--format', 'status', '--cwd', cwd, '--session', 's1'];
    for (let i = 0; i < 2; i++) {
      await sleep(ANSWER_WINDOW_MS + 300);
      for (const args of [events, status]) assert.equal((await get(path, query(args))).body, once(args, dir), `${args[1]}, tick ${i}`);
    }
    assert.match(once(status, dir), /"line":"[^"]*E-run00011/, 'the running task is in the status line');
  } finally { sl.c.kill('SIGKILL'); await kill(h); }
});

test('openTasks: a dir with only a ledger is kept by its own mtime, and a task.json created in it is found on the next call', async () => {
  const { openTasks } = await import('./lib/view-index.mjs');
  const dir = newRoot('state-bare-');
  const id = 'E-bare0001';
  mkdirSync(join(dir, id), { recursive: true });
  writeFileSync(join(dir, id, 'ledger.jsonl'), jl([{ ts: T0, event: 'node_start', node_id: 'size' }]));
  const old = Date.now() / 1000 - 3600;
  utimesSync(join(dir, id), old, old);
  assert.deepEqual(openTasks(dir, { running: true }), [{ id, raw: null, absent: true }]);
  assert.deepEqual(openTasks(dir, { running: true }), [{ id, raw: null, absent: true }], 'kept by the dir mtime');
  writeFileSync(join(dir, id, 'task.json'), taskJson(id));
  const [found] = openTasks(dir, { running: true });
  assert.equal(found.id, id);
  assert.equal(found.raw.run_id, id);
  assert.equal(found.absent, undefined);
});

// ---------- the log under the tasks root ----------

const logOf = (dir) => readFileSync(join(dir, '.state.log'), 'utf8');
const newRoot = (prefix) => {
  const dir = join(mkdtempSync(join(tmpdir(), prefix)), 'tasks');
  mkdirSync(dir, { recursive: true });
  extraRoots.add(dirname(dir));
  return dir;
};

test('log: a detached start leaves start and listening lines, and SIGTERM adds its own', async () => {
  const dir = newRoot('state-log-');
  const starter = spawn('node', [STATE, '--tasks-dir', dir], { stdio: 'ignore', env: { ...process.env, HARNESS_TASKS_DIR: dir } });
  pids.add(starter.pid);
  await ready(sock(dir));
  const spid = JSON.parse(readFileSync(statePaths(dir).lock, 'utf8')).pid;
  pids.add(spid);
  assert.equal((await q200(dir)).status, 200);
  process.kill(spid, 'SIGTERM');
  for (let i = 0; i < 60 && alive(spid); i++) await sleep(50);
  assert.equal(alive(spid), false);
  const lines = logOf(dir).trim().split('\n');
  const iso = '\\d{4}-\\d\\d-\\d\\dT[\\d:.]+Z';
  assert.match(lines[0], new RegExp(`^${iso} ${spid} start$`));
  assert.match(lines[1], new RegExp(`^${iso} ${spid} listening ${sock(dir).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`));
  assert.match(lines.at(-1), new RegExp(`^${iso} ${spid} SIGTERM$`));
});

test('log: a foreground server that goes idle writes idle-exit', async () => {
  const dir = newRoot('state-logidle-');
  const h = serve(dir, { TEAMS_STATE_IDLE_MS: '400' });
  await ready(sock(dir));
  assert.equal(await exitsWithin(h, 5000), 0);
  assert.match(logOf(dir), / \d+ idle-exit\n$/);
});

test('log: SIGINT is logged like SIGTERM', async () => {
  const dir = newRoot('state-logint-');
  const h = serve(dir);
  await ready(sock(dir));
  h.c.kill('SIGINT');
  assert.equal(await exitsWithin(h, 5000), 0);
  assert.match(logOf(dir), / \d+ SIGINT\n$/);
});

test('log: a socket path that cannot be listened on writes an error line and exits 1', async () => {
  const dir = newRoot('state-logerr-');
  mkdirSync(sock(dir), { recursive: true });
  const h = serve(dir);
  assert.equal(await exitsWithin(h, 5000), 1);
  const lines = logOf(dir).trim().split('\n');
  assert.match(lines[0], / \d+ start$/);
  assert.match(lines.at(-1), / \d+ error \S+$/);
});

test('log: a log at 1 MiB is rotated to .state.log.1 and stays under 1 MiB plus one line', async () => {
  const dir = newRoot('state-logcap-');
  const MiB = 1024 * 1024;
  writeFileSync(join(dir, '.state.log'), `${'x'.repeat(99)}\n`.repeat(Math.ceil(MiB / 100)));
  const h = serve(dir);
  await ready(sock(dir));
  await kill(h);
  assert.ok(existsSync(join(dir, '.state.log.1')), 'the full log was kept as .state.log.1');
  assert.ok(statSync(join(dir, '.state.log.1')).size >= MiB);
  assert.ok(statSync(join(dir, '.state.log')).size <= MiB + 200);
  assert.match(logOf(dir), / \d+ start\n/);
});

test('log: format=summary and format=status list neither .state.log nor .state.log.1 as a task', async () => {
  const dir = newRoot('state-lognot-');
  addReported('E-aaaaaaaa1', dir);
  writeFileSync(join(dir, '.state.log.1'), 'old\n');
  const h = serve(dir);
  const path = sock(dir);
  try {
    await ready(path);
    assert.ok(existsSync(join(dir, '.state.log')));
    for (const fmt of ['summary', 'status']) {
      const r = await get(path, query(['--format', fmt, '--cwd', cwd]));
      assert.equal(r.status, 200);
      assert.ok(!r.body.includes('.state'), `${fmt}: no .state file named in the answer`);
    }
    const j = JSON.parse((await get(path, query(['--format', 'summary', '--cwd', cwd]))).body);
    assert.ok(j.tasks.every((t) => String(t.task_id).startsWith('E-')));
  } finally { await kill(h); }
});

// ---------- the mod's 3 s tick over many finished tasks ----------

// A tasks root of 2000 tasks: 800 cancelled, 600 reported, 400 whose daemon died, 200 with only a ledger,
// and by default one running with a live driver stream and a judge stream. Same mix as the --once perf
// fixture (test-view-once-perf.mjs).
function bigRoot(running = true) {
  const dir = mkdtempSync(join(tmpdir(), 'state-big-'));
  extraRoots.add(dir);
  const big = { tasks: join(dir, 'tasks'), cwd: join(dir, 'proj') };
  mkdirSync(big.tasks, { recursive: true });
  mkdirSync(big.cwd, { recursive: true });
  const put = (id, task, ledger, old = true) => {
    for (const [name, body] of [['task.json', task], ['ledger.jsonl', ledger]]) {
      if (body === null) continue;
      const p = join(big.tasks, id, name);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, body);
      if (old) utimesSync(p, T0 / 1000, T0 / 1000);
    }
  };
  const task = (id, extra) => JSON.stringify({ run_id: id, kind: 'task', cwd: big.cwd, request: `request ${id}`, created_at: T0, ...extra });
  const reported = [node('size', 'size', 'done'), node('report', 'report', 'done')];
  const ended = jl([{ ts: T0, event: 'node_finish', node_id: 'report' }, { ts: T0 + 1, event: 'daemon_done' }]);
  for (let i = 0; i < 800; i++) { const id = `c${i}-0001`; put(id, task(id, { cancelled: true, nodes: [node('size', 'size', 'done')] }), null); }
  for (let i = 0; i < 600; i++) { const id = `d${i}-0001`; put(id, task(id, { nodes: reported }), ended); }
  for (let i = 0; i < 400; i++) { const id = `e${i}-0001`; put(id, task(id, { nodes: [node('size', 'size', 'done'), node('shape', 'shape', 'running')], daemon: { pid: 2147483646, started_at: T0, restarts: 0 } }), jl([{ ts: T0, event: 'node_start', node_id: 'shape' }, { ts: T0 + 1, event: 'daemon_done' }])); }
  for (let i = 0; i < 200; i++) put(`f${i}-0001`, null, jl([{ ts: T0, event: 'daemon_done' }]));
  if (running) {
    const id = 'aaaaaaaa-0001';
    const sl = sleeper();
    big.sleeper = sl;
    const log = join(big.tasks, id, 'drivers', 'dispatch_P1_1.stream.jsonl');
    stream(log);
    stream(join(big.tasks, id, 'drivers', 'judge_accept_P1_1.stream.jsonl'), 'judging');
    const nodes = [{ ...node('size', 'size', 'running'), child: { driver: { pid: sl.c.pid, started_at: Date.now(), command: 'sleep', log } } }];
    put(id, task(id, { created_at: Date.now() - 60000, nodes }), jl([{ ts: Date.now(), event: 'node_start', node_id: 'size' }]), false);
  }
  return big;
}

// CPU seconds (user + system) a process has used so far: /proc where there is one, else ps.
function cpuSeconds(pid) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const f = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    return (Number(f[11]) + Number(f[12])) / 100;
  } catch { /* no /proc: ask ps */ }
  return spawnSync('ps', ['-o', 'time=', '-p', String(pid)], { encoding: 'utf8' }).stdout.trim().split(':').reduce((a, p) => a * 60 + parseFloat(p), 0);
}
const rssKb = (pid) => Number(spawnSync('ps', ['-o', 'rss=', '-p', String(pid)], { encoding: 'utf8' }).stdout.trim()) || 0;

const spread = (ms) => { const s = [...ms].sort((a, b) => a - b); return `best ${s[0].toFixed(0)} ms, median ${s[s.length >> 1].toFixed(0)} ms, worst ${s.at(-1).toFixed(0)} ms over ${s.length} calls`; };

async function timed(path, args) {
  const at = performance.now();
  const r = await get(path, query(args));
  assert.equal(r.status, 200, args.join(' '));
  return { ms: performance.now() - at, body: r.body };
}

test('a tick after the 2 s window serves finished tasks from the file-keyed cache: nothing of theirs is read again', { skip: process.getuid?.() === 0 ? 'root ignores file modes' : false }, async () => {
  const big = bigRoot(false);
  const path = sock(big.tasks);
  const h = serve(big.tasks);
  const locked = [];
  try {
    await ready(path);
    await sleep(2200); // a fresh tick, whatever ready() cached
    const calls = [['--format', 'status', '--cwd', big.cwd], ['--format', 'summary', '--cwd', big.cwd], ['--format', 'events', '--since', '0', '--cwd', big.cwd]];
    const before = [];
    for (const args of calls) before.push((await get(path, query(args))).body);
    for (const id of ['c0-0001', 'c1-0001', 'd0-0001', 'd1-0001', 'e0-0001', 'e1-0001']) {
      const p = join(big.tasks, id, 'task.json');
      chmodSync(p, 0o000);
      locked.push(p);
    }
    await sleep(2200); // past the answer window: every call renders again
    const mask = (s) => s.replace(/"(age_ms|day|at)":\d+/g, '"$1":0');
    for (const [i, args] of calls.entries()) {
      assert.equal(mask((await get(path, query(args))).body), mask(before[i]), `${args[1]}: same answer with the finished task.json unreadable`);
    }
  } finally { for (const p of locked) chmodSync(p, 0o644); await kill(h); }
});

// A summary that lists a running task also counts the live driver processes, which scans every task.json of
// the root (mcp/livecap.mjs liveProcesses): the count is taken once per task change, not per tick.
test('a status and a summary tick on 2000 finished tasks answer under 200 ms (best of the calls, each past the 2 s window)', async (t) => {
  const big = bigRoot(false);
  const path = sock(big.tasks);
  const h = serve(big.tasks);
  try {
    await ready(path);
    const calls = { status: ['--format', 'status', '--cwd', big.cwd], summary: ['--format', 'summary', '--cwd', big.cwd] };
    const ms = { status: [], summary: [] };
    for (let i = 0; i < 5; i++) {
      for (const k of Object.keys(calls)) {
        await sleep(2200); // each call is a tick miss, the way the mod's 3 s poll is
        ms[k].push((await timed(path, calls[k])).ms);
      }
    }
    for (const k of Object.keys(calls)) {
      t.diagnostic(`state server ${k}: ${spread(ms[k])}`);
      assert.ok(Math.min(...ms[k]) < 200, `${k}: best tick took ${Math.min(...ms[k]).toFixed(0)} ms, bound 200 ms`);
    }
  } finally { await kill(h); }
});

test('60 s idle: events and summary every 3 s on 2001 tasks (one running, with a driver and a judge stream) use under 1% of one core', { skip: process.env.TEAMS_STATE_PERF ? false : 'set TEAMS_STATE_PERF=1 (60 s CPU bar; load-sensitive)' }, async (t) => {
  const big = bigRoot();
  const path = sock(big.tasks);
  const h = serve(big.tasks);
  try {
    await ready(path);
    const started = Date.now();
    const events = ['--format', 'events', '--since', String(started), '--cwd', big.cwd];
    const summary = ['--format', 'summary', '--cwd', big.cwd, '--session', 's1'];
    await timed(path, events);
    await timed(path, summary);
    await sleep(500); // start-up and the first render are not part of the idle cost
    const rss0 = rssKb(h.c.pid);
    const cpu0 = cpuSeconds(h.c.pid);
    const t0 = Date.now();
    const ms = [];
    let rssMax = rss0;
    while (Date.now() - t0 < 60 * 1000) {
      const at = Date.now();
      ms.push((await timed(path, events)).ms, (await timed(path, summary)).ms);
      rssMax = Math.max(rssMax, rssKb(h.c.pid));
      await sleep(Math.max(0, 3000 - (Date.now() - at)));
    }
    const wall = (Date.now() - t0) / 1000;
    const pct = (100 * (cpuSeconds(h.c.pid) - cpu0)) / wall;
    t.diagnostic(`state server tick: ${pct.toFixed(2)}% of one core over ${wall.toFixed(1)} s (${ms.length} calls; ${spread(ms)}); rss ${rss0} -> ${rssKb(h.c.pid)} kB, max ${rssMax} kB`);
    assert.ok(pct < 1, `${pct.toFixed(2)}% of one core, bound 1%`);
  } finally { big.sleeper?.c.kill('SIGKILL'); await kill(h); }
});

// A loose bound on CPU time (not a percentage: it barely moves with machine load): at least 4x the highest of
// three measurements after the fix on this fixture (0.13, 0.10 and 0.07 under a full-suite run, ps resolves 0.01 s).
const CPU_GUARD_S = 0.6;
test(`CPU guard (default on): events and status every 3 s on 2001 tasks stay under ${CPU_GUARD_S} CPU s over 15 s`, async (t) => {
  const big = bigRoot();
  const path = sock(big.tasks);
  const h = serve(big.tasks);
  try {
    await ready(path);
    const events = ['--format', 'events', '--since', String(Date.now()), '--cwd', big.cwd];
    const status = ['--format', 'status', '--cwd', big.cwd, '--session', 's1'];
    await timed(path, events);
    await timed(path, status);
    await sleep(500); // start-up and the first render are not part of the idle cost
    const cpu0 = cpuSeconds(h.c.pid);
    const t0 = Date.now();
    while (Date.now() - t0 < 15 * 1000) {
      const at = Date.now();
      await timed(path, events);
      await timed(path, status);
      await sleep(Math.max(0, 3000 - (Date.now() - at)));
    }
    const used = cpuSeconds(h.c.pid) - cpu0;
    t.diagnostic(`state server: ${used.toFixed(2)} CPU s over ${((Date.now() - t0) / 1000).toFixed(1)} s, bound ${CPU_GUARD_S} s`);
    assert.ok(used < CPU_GUARD_S, `${used.toFixed(2)} CPU s, bound ${CPU_GUARD_S} s`);
  } finally { big.sleeper?.c.kill('SIGKILL'); await kill(h); }
});

test('pruneTails drops tail memos not used lately and keeps fresh ones; floorFacts without sig never memoises', async () => {
  const { floorFacts, pruneTails } = await import('./lib/view-floor-fs.mjs');
  const root = mkdtempSync(join(tmpdir(), 'state-tails-'));
  const dir = join(root, 'T-1');
  mkdirSync(dir, { recursive: true });
  const ledger = join(dir, 'ledger.jsonl');
  const m = { cards: [], nodes: [] };
  const lines = () => floorFacts(m, root, 'T-1', { raw: {}, sig: 's' }).ledger;
  const stamp = new Date('2020-01-01');
  writeFileSync(ledger, '{"a":1}\n'); utimesSync(ledger, stamp, stamp);
  assert.deepEqual(lines(), ['{"a":1}']);
  writeFileSync(ledger, '{"b":2}\n'); utimesSync(ledger, stamp, stamp); // same mtime and size: the memo holds
  assert.deepEqual(lines(), ['{"a":1}']);
  pruneTails(60 * 1000); // fresh: kept
  assert.deepEqual(lines(), ['{"a":1}']);
  assert.deepEqual(floorFacts(m, root, 'T-1', { raw: {} }).ledger, ['{"b":2}']); // no sig: always read
  pruneTails(-1); // everything is older than -1 ms
  assert.deepEqual(lines(), ['{"b":2}']);
  rmSync(root, { recursive: true, force: true });
});

test('no server of this file is left behind', () => {
  // the `after` hook kills and checks every pid; here only the files that may remain under the scratch root
  assert.deepEqual(readdirSync(tasks).filter((n) => n.endsWith('.tmp')), []);
});
