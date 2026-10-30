// `view.mjs --once` on a tasks dir holding thousands of finished tasks: the mod polls it every 3 s, so one
// call must cost the open tasks only. Wall time (best of 5, strict) and the number of `git` processes a
// call starts are asserted. Every fixture is a temp dir this file builds (mkdtemp) and removes; the
// user's own tasks dir is never read and no server is started (only --once).
//
//   node --test --test-concurrency=1 teams/scripts/test-view-perf.mjs
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, utimesSync, existsSync, chmodSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

const VIEW = join(dirname(fileURLToPath(import.meta.url)), 'view.mjs');
const H = 60 * 60 * 1000;
const D = 24 * H;
const BAR_MS = 300;
const FINISHED = 2000;
const SID = 'sess-perf-0001';

const touch = (p, agoMs) => { const t = (Date.now() - agoMs) / 1000; utimesSync(p, t, t); };
const write = (p, s, agoMs = 0) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, s); if (agoMs) touch(p, agoMs); };
const sh = (cmd, args, opts) => spawnSync(cmd, args, { encoding: 'utf8', ...opts });
const gitInit = (dir) => { mkdirSync(dir, { recursive: true }); assert.equal(sh('git', ['init', '-q', dir]).status, 0); };

// A node of a real task.json weighs ~500 B (a result with its reason, attempts, timestamps); 20 of them
// bring a task.json to the median ~11 KB the real tasks dir has, so the reads cost what they cost live.
const filler = 'x'.repeat(200);
const nodes = (n, extra = {}) => Array.from({ length: n }, (_, k) => ({
  node_id: `n${k}`, stage: k === n - 1 ? 'report' : 'implement', state: 'done', deps: k ? [`n${k - 1}`] : [],
  result: { accept: true, reason: filler, summary: filler }, started_at: 1, finished_at: 2, ...extra,
}));

// One finished task dir. kind: done | cancelled | gone (worktree_gone) | srun (its run file absent: BLOCKED).
function finished(tasks, id, { kind = 'done', cwd, ageMs, opener = false, ledger }) {
  const dir = join(tasks, id);
  const task = { run_id: id, kind: 'task', cwd, request: `request ${id}`, created_at: Date.now() - ageMs - 1000, store_path: join(dir, 'task.json'), spec: {}, nodes: nodes(20) };
  if (kind === 'cancelled') task.cancelled = true;
  if (kind === 'gone') task.worktree_gone = true;
  if (kind === 'srun') { task.s_run = { cwd, run_id: `s-${id}` }; task.nodes = nodes(20).slice(0, 19); }
  if (opener) task.opener = { session_id: SID };
  write(join(dir, 'task.json'), JSON.stringify(task), ageMs);
  const lines = ledger || [{ ts: Date.now() - ageMs, event: 'daemon_done', task_id: id, state: 'done' }];
  write(join(dir, 'ledger.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n', ageMs);
}

// One open running L task: a STORY card whose driver is alive (this process), in `cwd`.
function openTask(root, tasks, cwd, id = 'aaaaaaaa-0001') {
  const dir = join(tasks, id);
  const log = join(dir, 'drivers', 'dispatch_P1_1.stream.jsonl');
  const cdir = join(root, `wt-${id}`);
  const n = (node_id, stage, deps, extra) => ({ node_id, stage, deps, state: 'pending', ...extra });
  write(log, JSON.stringify({ type: 'assistant', message: { id: 'm1', content: [{ type: 'text', text: 'working' }], usage: { input_tokens: 10, output_tokens: 1 } } }) + '\n');
  write(join(cdir, '.teams_output', 'broker', 'runs', 'c-P1.json'), JSON.stringify({
    run_id: 'c-P1', flow: 'develop', max_retries: 2, spec: { subgoals: [{ id: 'U1', title: 'unit' }] },
    nodes: [n('implement:U1:1', 'implement', [], { state: 'running', subgoal_id: 'U1' })],
  }));
  write(join(dir, 'task.json'), JSON.stringify({
    run_id: id, kind: 'task', cwd, request: `request ${id}`, created_at: Date.now() - 60000, store_path: join(dir, 'task.json'),
    spec: { packages: [{ id: 'P1', title: 'story P1', deps: [] }] },
    nodes: [
      n('size', 'size', [], { state: 'done' }), n('shape', 'shape', ['size'], { state: 'done' }), n('critique', 'critique', ['shape'], { state: 'done' }),
      n('dispatch:P1:1', 'dispatch', ['critique'], { state: 'running', subgoal_id: 'P1', child: { run_id: 'c-P1', cwd: cdir, driver: { pid: process.pid, log, restarts: [] } } }),
      n('accept:P1:1', 'accept', ['dispatch:P1:1'], { subgoal_id: 'P1' }),
    ],
  }));
  write(join(dir, 'ledger.jsonl'), JSON.stringify({ ts: Date.now() - 1000, event: 'node_start', task_id: id, node_id: 'dispatch:P1:1' }) + '\n');
  return id;
}

// A counting `git` first on PATH: one line per start in $GIT_COUNT_FILE, then the real git (absolute path).
function fakeGit(root) {
  const real = sh('sh', ['-c', 'command -v git']).stdout.trim();
  const bin = join(root, 'bin');
  mkdirSync(bin, { recursive: true });
  const counter = join(root, 'git-count.txt');
  write(join(bin, 'git'), `#!/bin/sh\necho x >> "$GIT_COUNT_FILE"\nexec "${real}" "$@"\n`);
  chmodSync(join(bin, 'git'), 0o755);
  return { bin, counter };
}

const nowMs = () => Date.now();

// One spawn of `view.mjs --once --format <format> ...`; wall ms around the spawn only.
function view(tasks, args, { env = {} } = {}) {
  const t0 = performance.now();
  const r = sh(process.execPath, [VIEW, '--once', '--tasks-dir', tasks, ...args], { env: { ...process.env, HARNESS_TASKS_DIR: tasks, TEAMS_RUNS_DIR: 'off', ...env } });
  return { ms: performance.now() - t0, status: r.status, out: r.stdout, err: r.stderr };
}

describe('view --once on a tasks dir of finished tasks', { concurrency: false }, () => {
  let root, tasks, cwd, git, openId;

  before(() => {
    root = mkdtempSync(join(tmpdir(), 'teams-view-perf-'));
    tasks = join(root, 'tasks');
    cwd = join(root, 'proj');
    const other = join(root, 'other-repo');
    mkdirSync(tasks, { recursive: true });
    gitInit(cwd);
    gitInit(other);
    git = fakeGit(root);
    const kinds = ['cancelled', 'gone', 'srun'];
    for (let i = 0; i < FINISHED; i++) {
      const slot = i % 10;
      finished(tasks, `f-${String(i).padStart(4, '0')}`, {
        kind: kinds[i % 20] || 'done',
        cwd: slot === 7 ? cwd : slot === 8 ? other : join(root, 'gone', `c${i}`),
        ageMs: i % 2 ? 2 * H : 3 * D,
        opener: slot === 3,
      });
    }
    openId = openTask(root, tasks, cwd);
  });
  after(() => rmSync(root, { recursive: true, force: true }));

  const sess = () => ['--cwd', cwd, '--session', SID];
  const FORMATS = {
    status: () => ['--format', 'status', ...sess()],
    summary: () => ['--format', 'summary', ...sess()],
    teams: () => ['--format', 'teams', ...sess()],
    events: () => ['--format', 'events', '--since', String(nowMs() - 60000), '--cwd', cwd],
  };

  for (const [name, argv] of Object.entries(FORMATS)) {
    test(`${name}: best of 5 on ${FINISHED} finished tasks is under ${BAR_MS} ms`, (t) => {
      const times = [];
      for (let i = 0; i < 5; i++) {
        const r = view(tasks, argv());
        assert.equal(r.status, 0, r.err);
        times.push(Math.round(r.ms));
      }
      t.diagnostic(`${name} ms: ${times.join(' ')}`);
      assert.ok(Math.min(...times) < 300, `${name} best of 5 = ${Math.min(...times)} ms (${times.join(' ')}), bar ${BAR_MS}`);
    });
  }

  test('a call starts at most 2 git processes, however many tasks are finished', () => {
    const env = { PATH: `${git.bin}:${process.env.PATH}`, GIT_COUNT_FILE: git.counter };
    for (const [name, argv] of Object.entries(FORMATS)) {
      rmSync(git.counter, { force: true });
      const r = view(tasks, argv(), { env });
      assert.equal(r.status, 0, r.err);
      const n = existsSync(git.counter) ? readFileSync(git.counter, 'utf8').split('\n').filter(Boolean).length : 0;
      assert.ok(n <= 2, `${name} started ${n} git processes`);
    }
  });

  test('the open task is the only one listed; no finished task has an event', () => {
    const st = JSON.parse(view(tasks, FORMATS.status()).out);
    const sm = JSON.parse(view(tasks, FORMATS.summary()).out);
    const tm = JSON.parse(view(tasks, FORMATS.teams()).out);
    assert.equal(st.latest, openId);
    assert.ok(st.line.includes(`E-${openId.slice(0, 8)}`), st.line);
    assert.equal(sm.tasks.length, 1);
    assert.deepEqual(sm.status, st);
    assert.equal(tm.status.latest, openId);
    const ev = view(tasks, FORMATS.events()).out.split('\n').filter(Boolean).map((l) => JSON.parse(l));
    assert.deepEqual(ev.filter((e) => e.task_id !== openId), []);
  });
});

describe('view --once --format events with an old cursor', { concurrency: false }, () => {
  let root, tasks, cwd, git, mine;

  before(() => {
    root = mkdtempSync(join(tmpdir(), 'teams-view-perf-'));
    tasks = join(root, 'tasks');
    cwd = join(root, 'proj');
    mkdirSync(tasks, { recursive: true });
    gitInit(cwd);
    git = fakeGit(root);
    const now = Date.now();
    // 300 finished tasks in 300 distinct cwds: failures and a daemon_done 3 days ago, only a node_start 2 h ago
    for (let i = 0; i < 300; i++) {
      const id = `old-${String(i).padStart(3, '0')}`;
      finished(tasks, id, {
        cwd: join(root, 'gone', `c${i}`), ageMs: 2 * H,
        ledger: [
          { ts: now - 3 * D, event: 'node_finish', task_id: id, node_id: 'n3', state: 'failed', attempt: 1 },
          { ts: now - 3 * D, event: 'daemon_done', task_id: id, state: 'done' },
          { ts: now - 2 * H, event: 'node_start', task_id: id, node_id: 'n4' },
        ],
      });
    }
    // 5 finished in 5 other cwds and 1 in the session's cwd, each with a daemon_done an hour ago
    for (let i = 0; i < 5; i++) finished(tasks, `new-${i}`, { cwd: join(root, 'gone', `n${i}`), ageMs: H });
    mine = 'new-mine';
    finished(tasks, mine, { cwd, ageMs: H });
  });
  after(() => rmSync(root, { recursive: true, force: true }));

  const argv = () => ['--format', 'events', '--since', String(Date.now() - 6 * H), '--cwd', cwd];

  test('git runs for a task with a deliverable event after the cursor only; output is the cwd task\'s', () => {
    const env = { PATH: `${git.bin}:${process.env.PATH}`, GIT_COUNT_FILE: git.counter };
    rmSync(git.counter, { force: true });
    const r = view(tasks, argv(), { env });
    assert.equal(r.status, 0, r.err);
    const n = existsSync(git.counter) ? readFileSync(git.counter, 'utf8').split('\n').filter(Boolean).length : 0;
    assert.ok(n <= 6, `started ${n} git processes (1 session + 5 cwds with a deliverable event)`);
    const ev = r.out.split('\n').filter(Boolean).map((l) => JSON.parse(l));
    assert.equal(ev.length, 1, r.out);
    assert.equal(ev[0].task_id, mine);
    assert.equal(ev[0].kind, 'daemon_done');
  });

  test(`best of 5 is under ${BAR_MS} ms`, (t) => {
    const times = [];
    for (let i = 0; i < 5; i++) {
      const r = view(tasks, argv());
      assert.equal(r.status, 0, r.err);
      times.push(Math.round(r.ms));
    }
    t.diagnostic(`events old cursor ms: ${times.join(' ')}`);
    assert.ok(Math.min(...times) < 300, `best of 5 = ${Math.min(...times)} ms (${times.join(' ')}), bar ${BAR_MS}`);
  });
});

describe('view --once --format events, late events', { concurrency: false }, () => {
  test('a finished task whose ledger was just written still delivers its daemon_done', () => {
    const root = mkdtempSync(join(tmpdir(), 'teams-view-perf-'));
    try {
      const tasks = join(root, 'tasks');
      const cwd = join(root, 'proj');
      mkdirSync(tasks, { recursive: true });
      gitInit(cwd);
      finished(tasks, 'late-1', { cwd, ageMs: 3 * D, ledger: [{ ts: Date.now(), event: 'daemon_done', task_id: 'late-1', state: 'done' }] });
      touch(join(tasks, 'late-1', 'ledger.jsonl'), 0);
      const r = view(tasks, ['--format', 'events', '--since', String(Date.now() - 60000), '--cwd', cwd]);
      assert.equal(r.status, 0, r.err);
      const ev = r.out.split('\n').filter(Boolean).map((l) => JSON.parse(l));
      assert.equal(ev.length, 1, r.out);
      assert.equal(ev[0].task_id, 'late-1');
      assert.equal(ev[0].kind, 'daemon_done');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// The finished-task facts cache (lib/view-floor-fs.mjs scanRaws): kept under os.tmpdir(), pointed at a scratch
// TMPDIR here so these tests never touch the real temp cache.
describe('view --once finished-task facts cache', { concurrency: false }, () => {
  let root, tmp, cwd;
  const CACHE = () => join(tmp, 'teams-view-finished');
  const cacheFiles = () => (existsSync(CACHE()) ? readdirSync(CACHE()).filter((f) => f.endsWith('.json')) : []);
  const latest = (tasks) => {
    const r = view(tasks, ['--format', 'status', '--cwd', cwd], { env: { TMPDIR: tmp } });
    assert.equal(r.status, 0, r.err);
    return JSON.parse(r.out);
  };
  const setTime = (p, ms) => utimesSync(p, ms / 1000, ms / 1000);
  // The same open task as a cancelled one and as a live one; `sameSize` pads the live body to the cancelled one's length.
  const bodies = (tasks, id, sameSize) => {
    const obj = JSON.parse(readFileSync(join(tasks, id, 'task.json'), 'utf8'));
    const done = JSON.stringify({ ...obj, cancelled: true, pad: '' });
    const live = JSON.stringify({ ...obj, pad: '' });
    return { done, live: sameSize ? JSON.stringify({ ...obj, pad: 'p'.repeat(done.length - live.length) }) : live };
  };

  before(() => {
    root = mkdtempSync(join(tmpdir(), 'teams-view-perf-'));
    tmp = join(root, 'tmp');
    cwd = join(root, 'proj');
    mkdirSync(tmp, { recursive: true });
    gitInit(cwd);
  });
  after(() => rmSync(root, { recursive: true, force: true }));

  test('a cached finished task whose task.json is rewritten as open is read again and listed', () => {
    const tasks = join(root, 'tasks-reopen');
    mkdirSync(tasks, { recursive: true });
    finished(tasks, 'aaaaaaaa-0001', { kind: 'cancelled', cwd, ageMs: H });
    assert.equal(latest(tasks).latest, null);
    assert.equal(cacheFiles().length, 1);
    assert.ok(readFileSync(join(CACHE(), cacheFiles()[0]), 'utf8').includes('aaaaaaaa-0001'), 'the finished task is cached');
    openTask(root, tasks, cwd, 'aaaaaaaa-0001');
    assert.equal(latest(tasks).latest, 'aaaaaaaa-0001');
  });

  test('a rewrite with the same size and a new mtime, and one with a new size and the old mtime, are both read again', () => {
    const tasks = join(root, 'tasks-stat');
    mkdirSync(tasks, { recursive: true });
    openTask(root, tasks, cwd, 'bbbbbbbb-0001');
    const p = join(tasks, 'bbbbbbbb-0001', 'task.json');
    const T = Date.now() - 5000;
    const same = bodies(tasks, 'bbbbbbbb-0001', true);
    const shorter = bodies(tasks, 'bbbbbbbb-0001', false).live;
    writeFileSync(p, same.done);
    setTime(p, T);
    assert.equal(latest(tasks).latest, null);
    writeFileSync(p, same.live); // same size, new mtime
    setTime(p, T + 2000);
    assert.equal(latest(tasks).latest, 'bbbbbbbb-0001');
    writeFileSync(p, same.done);
    setTime(p, T);
    assert.equal(latest(tasks).latest, null);
    writeFileSync(p, shorter); // new size, old mtime
    setTime(p, T);
    assert.equal(latest(tasks).latest, 'bbbbbbbb-0001');
  });

  test('a corrupt or missing cache file falls back to a full read with the same output', () => {
    const tasks = join(root, 'tasks-corrupt');
    mkdirSync(tasks, { recursive: true });
    for (let i = 0; i < 5; i++) finished(tasks, `f-${i}`, { kind: i % 2 ? 'gone' : 'cancelled', cwd, ageMs: 2 * H });
    openTask(root, tasks, cwd, 'cccccccc-0001');
    const want = latest(tasks);
    assert.equal(want.latest, 'cccccccc-0001');
    const file = join(CACHE(), cacheFiles().find((f) => readFileSync(join(CACHE(), f), 'utf8').includes('"f-0"')));
    // a cache that claims the open task finished must not be believed either when it is for another dir or version
    const lie = (extra) => JSON.stringify({ v: 1, dir: tasks, t: { 'cccccccc-0001': [0, 0, cwd, null, [], 0] }, ...extra });
    for (const junk of ['{not json', '', '[]', '{"v":99,"t":{}}', lie({ dir: '/elsewhere' }), lie({ v: 2 })]) {
      writeFileSync(file, junk);
      assert.deepEqual(latest(tasks), want, `cache content ${junk}`);
    }
    rmSync(file);
    assert.deepEqual(latest(tasks), want);
    assert.ok(readFileSync(file, 'utf8').includes('"f-0"'), 'the cache is written again after a full read');
  });

  test('the cache is keyed per tasks dir: a same-named task of the same size and mtime in another dir is not taken for finished', () => {
    const a = join(root, 'tasks-key-a');
    const b = join(root, 'tasks-key-b');
    mkdirSync(a, { recursive: true });
    mkdirSync(b, { recursive: true });
    openTask(root, b, cwd, 'dddddddd-0001');
    const { done, live } = bodies(b, 'dddddddd-0001', true);
    const pa = join(a, 'dddddddd-0001', 'task.json');
    const pb = join(b, 'dddddddd-0001', 'task.json');
    write(pa, done);
    writeFileSync(pb, live);
    setTime(pa, Date.now() - 5000);
    setTime(pb, Date.now() - 5000);
    assert.equal(statSync(pa).size, statSync(pb).size);
    assert.equal(statSync(pa).mtimeMs, statSync(pb).mtimeMs);
    const n = cacheFiles().length;
    assert.equal(latest(a).latest, null);
    assert.equal(cacheFiles().length, n + 1, 'dir A has its own cache file');
    assert.equal(latest(b).latest, 'dddddddd-0001');
    assert.equal(latest(a).latest, null);
  });
});
