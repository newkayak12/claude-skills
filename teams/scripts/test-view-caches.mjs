// The two view caches get their own tests, each written to fail when its cache is broken:
//  - liveCount (lib/view-collect.mjs): the live-process count of a tasks root is reused for 2 s;
//  - the shared server's per-tick memo (view.mjs --serve-once-socket): the session-independent parts of
//    an answer are computed once per tick, so a state change inside the tick is not seen by a second
//    ask under another cache key (another session); after the tick the socket answers like --once.
// view.mjs and its libs are found relative to this file, so a copy of teams/ under tmp/ tests the copy.
//
//   node --test teams/scripts/test-view-caches.mjs
process.env.TEAMS_RUNS_DIR ??= 'off';
process.env.TZ = 'UTC';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { request } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const VIEW = join(HERE, 'view.mjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const root = mkdtempSync(join(tmpdir(), 'view-caches-'));
const children = new Set();
after(() => {
  for (const c of children) { try { c.kill('SIGKILL'); } catch { /* gone */ } }
  rmSync(root, { recursive: true, force: true });
});

const put = (p, s) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, s); };
const task = (cwd, id, nodes, extra = {}) => JSON.stringify({ run_id: id, kind: 'task', cwd, request: `request ${id}`, created_at: Date.now(), nodes, ...extra });

test('liveCount reuses the live-process count for 2 s, then counts again', async () => {
  const { collectTask } = await import(new URL('./lib/view-collect.mjs', import.meta.url));
  const tasks = join(root, 'live-tasks');
  const id = 'E-cccccccc1';
  const sl = spawn('sleep', ['1119'], { stdio: 'ignore' });
  children.add(sl);
  const exited = new Promise((r) => sl.once('exit', r));
  put(join(tasks, id, 'task.json'), task(join(root, 'proj'), id, [
    { node_id: 'size', stage: 'size', state: 'running', deps: [], after: [], child: { driver: { pid: sl.pid, started_at: Date.now(), command: 'sleep 1119' } } },
  ]));
  put(join(tasks, id, 'ledger.jsonl'), JSON.stringify({ ts: Date.now(), event: 'node_start', node_id: 'size' }) + '\n');
  const live = () => collectTask(tasks, id).telemetry.live.live;

  assert.equal(live(), 1, 'the recorded sleep counts');
  const killedAt = Date.now();
  sl.kill('SIGKILL');
  await exited;
  await sleep(100);
  assert.ok(Date.now() - killedAt < 1900);
  assert.equal(live(), 1, 'inside the TTL the count is reused');
  await sleep(Math.max(0, killedAt + 2100 - Date.now()));
  assert.equal(live(), 0, 'after the TTL it is counted again');
});

function get(path, url) {
  return new Promise((resolve, reject) => {
    const req = request({ socketPath: path, path: url, method: 'GET' }, (res) => {
      const chunks = [];
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
    req.on('error', reject);
    req.end();
  });
}

test('memo: a state change inside the tick is not seen under another cache key, the next tick shows it', async () => {
  const tasks = join(root, 'memo-tasks');
  const cwd = join(root, 'memo-proj');
  mkdirSync(cwd, { recursive: true });
  const id = 'E-dddddddd1';
  const running = [{ node_id: 'size', stage: 'size', state: 'running', deps: [], after: [] }];
  const finished = [{ node_id: 'size', stage: 'size', state: 'done', deps: [], after: [] }, { node_id: 'report', stage: 'report', state: 'done', deps: [], after: [] }];
  const ledger = join(tasks, id, 'ledger.jsonl');
  put(join(tasks, id, 'task.json'), task(cwd, id, running));
  put(ledger, JSON.stringify({ ts: Date.now(), event: 'node_start', node_id: 'size' }) + '\n');

  const sock = join(root, `memo-${process.pid}.sock`);
  const c = spawn('node', [VIEW, '--tasks-dir', tasks, '--serve-once-socket', sock], { env: { ...process.env, TEAMS_VIEW_ONCE_IDLE_MS: '30000' }, stdio: 'ignore' });
  children.add(c);
  const q = (session) => `/?format=status&cwd=${encodeURIComponent(cwd)}&session=${session}`;
  const once = (session) => spawnSync('node', [VIEW, '--tasks-dir', tasks, '--once', '--format', 'status', '--cwd', cwd, '--session', session], { encoding: 'utf8' }).stdout;

  let up = false;
  for (let i = 0; i < 100 && !up; i++) {
    if (existsSync(sock)) { try { await get(sock, '/?format=board&cwd=' + encodeURIComponent(cwd)); up = true; } catch { /* not listening yet */ } }
    if (!up) await sleep(50);
  }
  assert.ok(up, 'server came up');
  await sleep(2100); // the readiness ask's tick is over: the next ask opens a fresh one

  const first = await get(sock, q('s1'));
  assert.match(first, /E-dddddddd 0\/1/, 'the first ask sees the running task');
  put(join(tasks, id, 'task.json'), task(cwd, id, finished));
  put(ledger, JSON.stringify({ ts: Date.now(), event: 'node_finish', node_id: 'report' }) + '\n' + JSON.stringify({ ts: Date.now() + 1, event: 'daemon_done' }) + '\n');
  const sameTick = await get(sock, q('s2'));
  assert.equal(sameTick, first,'another session inside the tick still shows the old state');

  await sleep(2100);
  const next = await get(sock, q('s2'));
  assert.notEqual(next, first, 'after the tick the change shows');
  assert.equal(next, once('s2'), 'and the socket answers like --once');
});
