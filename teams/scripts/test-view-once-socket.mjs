// view.mjs --serve-once-socket: the --once answers over HTTP on a Unix socket.
// Each format the mod uses answers byte for byte like `node view.mjs --once` with the same args; a second
// start on a live socket exits 0 and leaves the first answering; a stale socket file is replaced; the server
// ends itself (socket file removed) after TEAMS_VIEW_ONCE_IDLE_MS; a repeat request inside 2 s is cached.
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
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync, existsSync } from 'node:fs';
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

function addReported(id) {
  write(join(tasks, id, 'task.json'), JSON.stringify({ run_id: id, kind: 'task', cwd, request: `request ${id}`, created_at: T0, nodes: [node('size', 'size', 'done'), node('report', 'report', 'done')] }));
  write(join(tasks, id, 'ledger.jsonl'), jl([{ ts: T0, event: 'node_finish', node_id: 'report' }, { ts: T0 + 1, event: 'daemon_done' }]));
}
addReported('E-aaaaaaaa1');
addReported('E-bbbbbbbb2');

after(() => {
  for (const c of children) { try { c.kill('SIGKILL'); } catch { /* gone */ } }
  rmSync(root, { recursive: true, force: true });
  for (const s of sockets) rmSync(s, { force: true });
});

const sockPath = () => {
  const p = join(tmpdir(), `view-sock-${process.pid}-${Math.random().toString(36).slice(2, 8)}.sock`);
  sockets.add(p);
  return p;
};

function serve(path, env = {}) {
  const c = spawn('node', [VIEW, '--tasks-dir', tasks, '--serve-once-socket', path], { env: { ...process.env, ...env }, stdio: 'ignore' });
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
