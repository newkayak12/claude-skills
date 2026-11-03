// view.mjs --serve-once-socket: the --once answers over HTTP on a Unix socket.
// Each format the mod uses answers byte for byte like `node view.mjs --once` with the same args; a second
// start on a live socket exits 0 and leaves the first answering; a stale socket file is replaced; the server
// ends itself (socket file removed) after TEAMS_VIEW_ONCE_IDLE_MS; a repeat request inside 2 s is cached.
// The mod's 3 s tick misses that 2 s window, so on 2001 finished tasks the tick still answers under 200 ms,
// reads no finished task whose files are unchanged, and an idle server answering one status call every 3 s
// uses under 5% of one core over 60 s (the 60 s case prints its percent).
// Fixtures are temp dirs with fixed, old timestamps. Every server this file starts is killed in cleanup.
//
//   node --test teams/scripts/test-view-once-socket.mjs
process.env.TEAMS_RUNS_DIR ??= 'off';
process.env.TZ = 'UTC';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { request } from 'node:http';
import { createServer } from 'node:net';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, utimesSync, existsSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const VIEW = join(HERE, 'view.mjs');
const T0 = Date.UTC(2026, 9, 1);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const write = (p, s) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, s); utimesSync(p, T0 / 1000, T0 / 1000); };
const jl = (events) => events.map((e) => JSON.stringify(e)).join('\n') + '\n';
const node = (id, stage, state) => ({ node_id: id, stage, state, deps: [], after: [] });

const root = mkdtempSync(join(tmpdir(), 'view-sock-'));
const tasks = join(root, 'tasks');
const cwd = join(root, 'proj');
mkdirSync(tasks, { recursive: true });
mkdirSync(cwd, { recursive: true });
const children = new Set();
const sockets = new Set();
const extraRoots = new Set();

function addReported(id) {
  write(join(tasks, id, 'task.json'), JSON.stringify({ run_id: id, kind: 'task', cwd, request: `request ${id}`, created_at: T0, nodes: [node('size', 'size', 'done'), node('report', 'report', 'done')] }));
  write(join(tasks, id, 'ledger.jsonl'), jl([{ ts: T0, event: 'node_finish', node_id: 'report' }, { ts: T0 + 1, event: 'daemon_done' }]));
}
addReported('E-aaaaaaaa1');
addReported('E-bbbbbbbb2');

after(() => {
  for (const c of children) { try { c.kill('SIGKILL'); } catch { /* gone */ } }
  rmSync(root, { recursive: true, force: true });
  for (const r of extraRoots) rmSync(r, { recursive: true, force: true });
  for (const s of sockets) rmSync(s, { force: true });
});

const sockPath = () => {
  const p = join(tmpdir(), `view-sock-${process.pid}-${Math.random().toString(36).slice(2, 8)}.sock`);
  sockets.add(p);
  return p;
};

function serve(path, env = {}, tasksDir = tasks) {
  const c = spawn('node', [VIEW, '--tasks-dir', tasksDir, '--serve-once-socket', path], { env: { ...process.env, ...env }, stdio: 'ignore' });
  children.add(c);
  const exited = new Promise((r) => c.once('exit', (code) => r(code)));
  return { c, exited };
}

async function ready(path) {
  for (let i = 0; i < 100; i++) {
    if (existsSync(path)) { try { await get(path, '/?format=events&since=0&cwd=' + encodeURIComponent(cwd)); return; } catch { /* not listening yet */ } }
    await sleep(50);
  }
  throw new Error('server did not come up');
}

function get(path, url) {
  return new Promise((resolve, reject) => {
    const req = request({ socketPath: path, path: url, method: 'GET' }, (res) => {
      const chunks = [];
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end();
  });
}

const once = (args) => spawnSync('node', [VIEW, '--tasks-dir', tasks, '--once', ...args], { encoding: 'utf8' }).stdout;
const query = (args) => {
  const q = new URLSearchParams();
  for (let i = 0; i < args.length; i += 2) q.set(args[i].replace(/^--/, ''), args[i + 1]);
  return '/?' + q.toString();
};

async function kill(h) {
  h.c.kill('SIGTERM');
  await Promise.race([h.exited, sleep(3000)]);
  h.c.kill('SIGKILL');
}

test('every format the mod uses answers byte for byte like --once', async () => {
  const path = sockPath();
  const h = serve(path);
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
      assert.equal(same(r.body), same(once(args)), args.join(' '));    }
    const bad = await get(path, '/?view=bad');
    assert.equal(bad.status, 500);
    assert.equal((await get(path, query(cases[1]))).status, 200);
  } finally { await kill(h); }
});

test('a second start on a live socket exits 0 and the first keeps answering', async () => {
  const path = sockPath();
  const first = serve(path);
  try {
    await ready(path);
    const second = serve(path);
    assert.equal(await Promise.race([second.exited, sleep(5000).then(() => 'timeout')]), 0);
    const r = await get(path, query(['--format', 'status', '--cwd', cwd]));
    assert.equal(r.status, 200);
    assert.equal(first.c.exitCode, null);
  } finally { await kill(first); }
});

test('a leftover socket file is replaced and the new server answers', async () => {
  const path = sockPath();
  writeFileSync(path, 'stale');
  const h = serve(path);
  try {
    await ready(path);
    assert.equal((await get(path, query(['--format', 'status', '--cwd', cwd]))).status, 200);
  } finally { await kill(h); }
});

test('a bound socket whose listener is gone is replaced and answers', async () => {
  const path = sockPath();
  // a listener that dies without unlinking: SIGKILL a child holding the socket
  const holder = spawn('node', ['-e', `require('net').createServer().listen(${JSON.stringify(path)}, () => process.stdout.write('up'))`], { stdio: ['ignore', 'pipe', 'ignore'] });
  children.add(holder);
  await new Promise((r) => holder.stdout.once('data', r));
  holder.kill('SIGKILL');
  await new Promise((r) => holder.once('exit', r));
  assert.ok(existsSync(path), 'socket file left behind');
  const h = serve(path);
  try {
    await ready(path);
    assert.equal((await get(path, query(['--format', 'status', '--cwd', cwd]))).status, 200);
  } finally { await kill(h); }
});

test('idle: the server exits and removes its socket file', async () => {
  const path = sockPath();
  const h = serve(path, { TEAMS_VIEW_ONCE_IDLE_MS: '400' });
  await ready(path);
  assert.equal(await Promise.race([h.exited, sleep(5000).then(() => 'timeout')]), 0);
  assert.equal(existsSync(path), false);
});

test('a repeat request inside the 2 s TTL is served from the cache, then it renders again', async () => {
  const path = sockPath();
  const h = serve(path);
  try {
    await ready(path);
    const url = '/?view=pipeline';
    const a = await get(path, url);
    assert.equal(a.status, 200);
    addReported('E-cccccccc3');
    const b = await get(path, url);
    assert.equal(b.body, a.body, 'cached inside the TTL');
    await sleep(2200);
    const c = await get(path, url);
    assert.notEqual(c.body, a.body, 'rendered again after the TTL');
    assert.equal(c.body, once([]));
  } finally { await kill(h); }
});

test('two sessions with different --session and --since share one base per tick and each gets its own --once answer', async () => {
  const path = sockPath();
  const h = serve(path);
  const extra = join(tasks, 'E-dddddddd4');
  try {
    await ready(path);
    await sleep(2200); // a fresh tick, whatever ready() cached
    const sessA = ['--format', 'events', '--since', '0', '--cwd', cwd, '--session', 's1'];
    const sessB = ['--format', 'events', '--since', '1', '--cwd', cwd, '--session', 's2'];
    const sumB = ['--format', 'summary', '--cwd', cwd, '--session', 's2'];
    const teamsB = ['--format', 'teams', '--cwd', cwd, '--session', 's2', '--task', 'E-aaaaaaaa1'];
    const mask = (s) => s.replace(/"at":\d+/g, '"at":0');
    const a = await get(path, query(sessA));
    assert.equal(a.body, once(sessA));
    // a task that appears mid-tick is not in the shared sweep: the other session's answer is the same base
    addReported('E-dddddddd4');
    const b = await get(path, query(sessB));
    assert.equal(b.body, a.body, "the second session reads the first session's base");
    await sleep(2200);
    const b2 = await get(path, query(sessB));
    assert.equal(b2.body, once(sessB), 'next tick: byte-equal to its own --once');
    assert.notEqual(b2.body, a.body);
    assert.equal((await get(path, query(sumB))).body, once(sumB));
    assert.equal(mask((await get(path, query(teamsB))).body), mask(once(teamsB)));
  } finally { rmSync(extra, { recursive: true, force: true }); await kill(h); }
});

test('the default socket name carries the teams version and an explicit path is still honoured', async () => {
  const version = JSON.parse(readFileSync(join(HERE, '..', '.claude-plugin', 'plugin.json'), 'utf8')).version;
  const home = mkdtempSync(join(tmpdir(), 'view-sock-name-'));
  const dir = join(home, 'tasks');
  mkdirSync(dir, { recursive: true });
  const want = join(home, `view-once-${version}.sock`);
  sockets.add(want);
  const c = spawn('node', [VIEW, '--tasks-dir', dir, '--serve-once-socket'], { env: { ...process.env, HARNESS_TASKS_DIR: dir }, stdio: 'ignore' });
  children.add(c);
  try {
    for (let i = 0; i < 100 && !existsSync(want); i++) await sleep(50);
    assert.ok(existsSync(want), `socket ${want}`);
    assert.equal((await get(want, query(['--format', 'status', '--cwd', cwd]))).status, 200);
  } finally { c.kill('SIGKILL'); rmSync(home, { recursive: true, force: true }); }
});

// ---------- the mod's 3 s tick over many finished tasks ----------

// A tasks root of 2000 tasks: 800 cancelled, 600 reported, 400 whose daemon died, 200 with only a ledger,
// and by default one running. Same mix as the --once perf fixture (test-view-once-perf.mjs).
function bigRoot(running = true) {
  const dir = mkdtempSync(join(tmpdir(), 'view-sock-big-'));
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
  if (running) put('aaaaaaaa-0001', task('aaaaaaaa-0001', { nodes: [node('size', 'size', 'running')] }), jl([{ ts: Date.now(), event: 'node_start', node_id: 'size' }]), false);
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

const spread = (ms) => { const s = [...ms].sort((a, b) => a - b); return `best ${s[0].toFixed(0)} ms, median ${s[s.length >> 1].toFixed(0)} ms, worst ${s.at(-1).toFixed(0)} ms over ${s.length} calls`; };

async function timed(path, args) {
  const at = performance.now();
  const r = await get(path, query(args));
  assert.equal(r.status, 200, args.join(' '));
  return { ms: performance.now() - at, body: r.body };
}

test('a tick after the 2 s window serves finished tasks from the file-keyed cache: nothing of theirs is read again', { skip: process.getuid?.() === 0 ? 'root ignores file modes' : false }, async () => {
  const big = bigRoot();
  const path = sockPath();
  const h = serve(path, {}, big.tasks);
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
// the root (mcp/livecap.mjs liveProcesses): not part of this bound (test-view-once-perf.mjs prints it).
test('a status and a summary tick on 2000 finished tasks answer under 200 ms (best of the calls, each past the 2 s window)', async (t) => {
  const big = bigRoot(false);
  const path = sockPath();
  const h = serve(path, {}, big.tasks);
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
      t.diagnostic(`--serve-once-socket ${k}: ${spread(ms[k])}`);
      assert.ok(Math.min(...ms[k]) < 200, `${k}: best tick took ${Math.min(...ms[k]).toFixed(0)} ms, bound 200 ms`);
    }
  } finally { await kill(h); }
});

test('60 s idle: a server answering one status call every 3 s on 2001 finished tasks uses under 5% of one core', async (t) => {
  const big = bigRoot();
  const path = sockPath();
  const h = serve(path, {}, big.tasks);
  try {
    await ready(path);
    const args = ['--format', 'status', '--cwd', big.cwd];
    await timed(path, args);
    await sleep(500); // start-up and the first render are not part of the idle cost
    const cpu0 = cpuSeconds(h.c.pid);
    const t0 = Date.now();
    const ms = [];
    while (Date.now() - t0 < 60 * 1000) {
      const at = Date.now();
      ms.push((await timed(path, args)).ms);
      await sleep(Math.max(0, 3000 - (Date.now() - at)));
    }
    const wall = (Date.now() - t0) / 1000;
    const pct = (100 * (cpuSeconds(h.c.pid) - cpu0)) / wall;
    t.diagnostic(`--serve-once-socket idle status every 3 s: ${pct.toFixed(2)}% of one core over ${wall.toFixed(1)} s (${ms.length} calls; ${spread(ms)})`);
    assert.ok(pct < 5, `${pct.toFixed(2)}% of one core, bound 5%`);
  } finally { await kill(h); }
});
