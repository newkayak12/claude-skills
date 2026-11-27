// The --once read path with the finished-task index (lib/view-index.mjs): output equals the goldens in
// fixtures/view-once-golden.json, which were generated with the pre-index code (git HEAD before the
// index) from the same fixtures; a task that goes from running to done is not served stale; a corrupt
// index is a full read. Fixtures are temp dirs.
// The default large-fixture test proves the index by making every finished task.json unreadable (chmod 000)
// before the second call; the speed bar (a warm status and summary call against the same call with no
// index) runs by default. The index key is the mtime and size of task.json and ledger.jsonl.
//
//   node --test teams/scripts/test-view-once-perf.mjs
//   VIEW_ONCE_VIEW=<view.mjs> VIEW_ONCE_REGEN=1 node teams/scripts/test-view-once-perf.mjs   (rewrite goldens from that view.mjs)
process.env.TEAMS_RUNS_DIR ??= 'off';
process.env.TZ = 'UTC';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, utimesSync, existsSync, readdirSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const VIEW = process.env.VIEW_ONCE_VIEW || join(HERE, 'view.mjs');
const GOLDEN = join(HERE, 'fixtures', 'view-once-golden.json');
const REGEN = process.env.VIEW_ONCE_REGEN === '1';
const DEAD_PID = 2147483646;
const T0 = Date.UTC(2026, 9, 1);           // fixed created_at / mtimes: the fixtures age the same on every run
const SEC = (ms) => ms / 1000;

const write = (p, s, at = null) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, s); if (at) utimesSync(p, SEC(at), SEC(at)); };
const jl = (events) => events.map((e) => JSON.stringify(e)).join('\n') + '\n';

function world() {
  const root = mkdtempSync(join(tmpdir(), 'view-once-'));
  const w = { root, tasks: join(root, 'tasks'), cwd: join(root, 'proj'), other: join(root, 'elsewhere'), cleanup: () => rmSync(root, { recursive: true, force: true }) };
  mkdirSync(w.tasks, { recursive: true });
  mkdirSync(w.cwd, { recursive: true });
  return w;
}

const node = (id, stage, state, extra = {}) => ({ node_id: id, stage, state, deps: [], after: [], ...extra });
const base = (id, cwd, extra = {}) => ({ run_id: id, kind: 'task', cwd, request: `request ${id}`, created_at: T0, ...extra });

// cancelled: terminal from task.json alone
const cancelled = (w, id, cwd) => write(join(w.tasks, id, 'task.json'), JSON.stringify(base(id, cwd, { cancelled: true, nodes: [node('size', 'size', 'done')] })), T0);
// a report node done with no packages declared: DONE
const reported = (w, id, cwd) => {
  write(join(w.tasks, id, 'task.json'), JSON.stringify(base(id, cwd, { nodes: [node('size', 'size', 'done'), node('report', 'report', 'done')] })), T0);
  write(join(w.tasks, id, 'ledger.jsonl'), jl([{ ts: T0, event: 'node_finish', node_id: 'report' }, { ts: T0 + 1, event: 'daemon_done' }]), T0);
};
// task.json still says in progress, the daemon is dead and the ledger ends daemon_done: stalled, not running
const stoppedDaemon = (w, id, cwd, { waiting = false } = {}) => {
  const nodes = [node('size', 'size', 'done'), node('shape', 'shape', waiting ? 'waiting_human' : 'running')];
  write(join(w.tasks, id, 'task.json'), JSON.stringify(base(id, cwd, { nodes, daemon: { pid: DEAD_PID, started_at: T0, restarts: 0 } })), T0);
  write(join(w.tasks, id, 'ledger.jsonl'), jl([{ ts: T0, event: 'node_start', node_id: 'shape' }, { ts: T0 + 1, event: 'daemon_done' }]), T0);
};
// a dir with only a ledger
const ledgerOnly = (w, id) => write(join(w.tasks, id, 'ledger.jsonl'), jl([{ ts: T0, event: 'daemon_done' }]), T0);
// driven by hand, size running: collectTask reads it as running
const runningTask = (w, id, cwd) => {
  write(join(w.tasks, id, 'task.json'), JSON.stringify(base(id, cwd, { nodes: [node('size', 'size', 'running')] })));
  write(join(w.tasks, id, 'ledger.jsonl'), jl([{ ts: Date.now(), event: 'node_start', node_id: 'size' }]));
};
const finishRunning = (w, id, cwd) => {
  const dir = join(w.tasks, id);
  const later = Date.now() + 60 * 1000;
  write(join(dir, 'task.json'), JSON.stringify(base(id, cwd, { nodes: [node('size', 'size', 'done'), node('report', 'report', 'done')] })), later);
  write(join(dir, 'ledger.jsonl'), jl([{ ts: Date.now(), event: 'node_start', node_id: 'size' }, { ts: Date.now(), event: 'daemon_done' }]), later);
};

function small(w) {
  cancelled(w, 'cccccccc-0001', w.cwd);
  cancelled(w, 'cccccccc-0002', w.other);
  reported(w, 'dddddddd-0001', w.cwd);
  reported(w, 'dddddddd-0002', w.other);
  stoppedDaemon(w, 'eeeeeeee-0001', w.cwd);
  stoppedDaemon(w, 'eeeeeeee-0002', w.cwd, { waiting: true });
  ledgerOnly(w, 'ffffffff-0001');
  runningTask(w, 'aaaaaaaa-0001', w.cwd);
}

function large(w, { running = true } = {}) {
  for (let i = 0; i < 800; i++) cancelled(w, `c${String(i).padStart(7, '0')}-0001`, i % 2 ? w.cwd : w.other);
  for (let i = 0; i < 600; i++) reported(w, `d${String(i).padStart(7, '0')}-0001`, i % 2 ? w.cwd : w.other);
  for (let i = 0; i < 400; i++) stoppedDaemon(w, `e${String(i).padStart(7, '0')}-0001`, w.cwd);
  for (let i = 0; i < 200; i++) ledgerOnly(w, `f${String(i).padStart(7, '0')}-0001`);
  if (running) runningTask(w, 'aaaaaaaa-0001', w.cwd);
}

// The temp root differs per run: replace it so a golden is the same text everywhere.
function view(w, args) {
  const r = spawnSync('node', [VIEW, '--tasks-dir', w.tasks, '--once', ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.split(w.root).join('<ROOT>');
}

// Wall-clock fields differ between runs; blank them so the golden is stable.
const scrub = (s) => s.replace(/"(age_ms|day|at)":\d+/g, '"$1":0');

const CALLS = {
  status: (w) => ['--format', 'status', '--cwd', w.cwd],
  events: (w) => ['--format', 'events', '--since', '0', '--cwd', w.cwd],
  summary: (w) => ['--format', 'summary', '--cwd', w.cwd],
  board: (w) => ['--format', 'board', '--cwd', w.cwd],
  teams: (w) => ['--format', 'teams', '--cwd', w.cwd],
};

const golden = () => JSON.parse(readFileSync(GOLDEN, 'utf8'));
// The formats the mod's 3 s tick reads, all held at 2000 finished tasks.
const LARGE_FORMATS = ['status', 'summary', 'events'];

if (REGEN) {
  const out = { large: {}, small: {} };
  const L = world(); large(L);
  for (const k of LARGE_FORMATS) out.large[k] = scrub(view(L, CALLS[k](L)));
  L.cleanup();
  const S = world(); small(S);
  for (const k of Object.keys(CALLS)) out.small[k] = scrub(view(S, CALLS[k](S)));
  S.cleanup();
  mkdirSync(dirname(GOLDEN), { recursive: true });
  writeFileSync(GOLDEN, JSON.stringify(out, null, 2) + '\n');
  console.log(`goldens written from ${VIEW}`);
  process.exit(0);
}

test('large fixture: status equals the golden, and the second call reads no finished task.json', { skip: process.getuid?.() === 0 ? 'root ignores file modes, so chmod 000 cannot make task.json unreadable' : false }, () => {
  const w = world();
  const locked = [];
  try {
    large(w);
    const args = CALLS.status(w);
    const first = scrub(view(w, args));
    assert.equal(first, golden().large.status, 'first call (no index yet)');
    for (const id of readdirSync(w.tasks)) {
      const p = join(w.tasks, id, 'task.json');
      if (id === 'aaaaaaaa-0001' || !existsSync(p)) continue;
      chmodSync(p, 0o000);
      locked.push(p);
    }
    assert.equal(locked.length, 1800, 'every finished task.json is made unreadable');
    const second = scrub(view(w, args));
    assert.equal(second, golden().large.status, 'second call (finished tasks unreadable: served from the index)');
  } finally {
    for (const p of locked) chmodSync(p, 0o644);
    w.cleanup();
  }
});

test('large fixture (2001 tasks): status, summary and events equal the golden byte for byte, first and second call', () => {
  const w = world();
  try {
    large(w);
    for (const pass of ['first', 'second']) {
      for (const k of LARGE_FORMATS) {
        const out = scrub(view(w, CALLS[k](w)));
        assert.ok(out.length > 80, `${k} is not an empty answer`);
        assert.equal(out, golden().large[k], `${k}, ${pass} call`);
      }
    }
  } finally { w.cleanup(); }
});

// The bar on a warm call (the index written) is relative: the same call with the index file removed first
// (the full read), timed in this process on this fixture. An absolute figure fails on a busy machine; the
// 200 ms target is only printed. The two arms alternate in pairs, so a load change reaches both. The
// statistic is the median of the PAIRS per-pair ratios (warm / no-index of the same pair): one lucky or
// unlucky sample moves a median by one rank, where a best-of minimum of the slow arm alone can collapse
// the ratio (best-of-9 gave 0.974 against medians of 0.50 at load 137). Every pair is run: stopping at the
// first passing ratio would give a broken index more chances to get lucky.
// K: must stay above that median ratio with the index working and below it with the index bypassed
// (loadIndex() returning {}: both arms then do the full read). Working, over 49 runs of status and summary
// idle (load 7) and under 16 busy-loop workers (load 113 to 135) on 8 cores: 0.415 to 0.734. Bypassed,
// 40 runs the same way: 0.885 to 1.136 (mostly 0.95 and above). K = 0.85 sits between 0.734 and 0.885.
// The bound is held on 2000 finished tasks. A summary that lists a running task also counts the live driver
// processes, which scans every task.json of the root (mcp/livecap.mjs liveProcesses): that run is timed and
// printed with the golden's running task in, not bounded.
const K = 0.85;
const PAIRS = 15;
const WARM_TARGET_MS = 200;
const TIMED = 5;
const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function timed(w, args) {
  pause(200);
  const at = performance.now();
  const out = scrub(view(w, args));
  return { out, ms: performance.now() - at };
}

const spread = (ms) => {
  const sorted = [...ms].sort((a, b) => a - b);
  return `best ${sorted[0].toFixed(0)} ms, median ${sorted[sorted.length >> 1].toFixed(0)} ms, worst ${sorted.at(-1).toFixed(0)} ms over ${sorted.length}`;
};

test(`2000 finished tasks: a warm --once status and summary call keeps the relative bound (median of ${PAIRS} pair ratios <= ${K})`, (t) => {
  const w = world();
  try {
    large(w, { running: false });
    const index = join(w.tasks, '.view-index.json');
    for (const k of ['status', 'summary']) {
      const args = CALLS[k](w);
      const full = [];
      const warm = [];
      for (let i = 0; i < PAIRS; i++) {
        rmSync(index, { force: true });
        full.push(timed(w, args).ms);
        assert.ok(existsSync(index), `${k}: the no-index call writes the index the warm call reads`);
        warm.push(timed(w, args).ms);
      }
      const ratios = warm.map((ms, i) => ms / full[i]).sort((a, b) => a - b);
      const ratio = ratios[ratios.length >> 1];
      t.diagnostic(`--once ${k}, 2000 finished, warm: ${spread(warm)} (target ${WARM_TARGET_MS} ms, not asserted)`);
      t.diagnostic(`--once ${k}, 2000 finished, no index: ${spread(full)}; median warm/no-index per pair ${ratio.toFixed(3)}`);
      assert.ok(ratio <= K, `${k}: relative bound: median warm/no-index ratio ${ratio.toFixed(3)} > ${K} (pair ratios ${ratios.map((r) => r.toFixed(2)).join(' ')})`);
    }
  } finally { w.cleanup(); }
});

test('2001 tasks with one running: the warm --once status and summary stay byte-equal to the golden, timed for the record', (t) => {
  const w = world();
  try {
    large(w);
    for (const k of ['status', 'summary']) {
      const args = CALLS[k](w);
      assert.equal(scrub(view(w, args)), golden().large[k], `${k}: first call (no index yet)`);
      const ms = [];
      for (let i = 0; i < TIMED; i++) {
        const call = timed(w, args);
        ms.push(call.ms);
        assert.equal(call.out, golden().large[k], `${k}: call ${i + 2} (index written)`);
      }
      t.diagnostic(`--once ${k}, 2000 finished + 1 running, warm: ${spread(ms)}`);
    }
  } finally { w.cleanup(); }
});

test('index key is mtime and size: a task.json rewritten with the same mtime but another size is read again', () => {
  const w = world();
  try {
    small(w);
    assert.doesNotMatch(JSON.parse(view(w, CALLS.status(w))).line, /E-cccccccc/);
    view(w, CALLS.status(w)); // the index holds the cancelled task
    // the cancelled task comes back to life, the file keeps its mtime: only its size says it changed
    write(join(w.tasks, 'cccccccc-0001', 'task.json'), JSON.stringify(base('cccccccc-0001', w.cwd, { nodes: [node('size', 'size', 'running')], padding: 'x'.repeat(64) })), T0);
    write(join(w.tasks, 'cccccccc-0001', 'ledger.jsonl'), jl([{ ts: Date.now(), event: 'node_start', node_id: 'size' }]));
    assert.match(JSON.parse(view(w, CALLS.status(w))).line, /E-cccccccc/, 'listed as running');
  } finally { w.cleanup(); }
});

test('listTasks keeps a finished task\'s row while its task.json and ledger.jsonl are unchanged, and reads it again when either changes', async () => {
  const { listTasks } = await import('./lib/view-collect.mjs');
  const w = world();
  try {
    small(w);
    const strip = (rows) => rows.map(({ elapsed_ms, ...r }) => r);
    const first = listTasks(w.tasks);
    const done = join(w.tasks, 'dddddddd-0001', 'task.json');
    chmodSync(done, 0o000); // unreadable: only a cache can still answer for it
    try {
      if (process.getuid?.() !== 0) assert.deepEqual(strip(listTasks(w.tasks)), strip(first), 'unchanged files: served without a read');
    } finally { chmodSync(done, 0o644); }
    // a different size (same mtime) says the task changed
    write(done, JSON.stringify(base('dddddddd-0001', w.cwd, { nodes: [node('size', 'size', 'running')], title: 'changed' })), T0);
    const row = listTasks(w.tasks).find((r) => r.task_id === 'dddddddd-0001');
    assert.notEqual(row.state, 'DONE', 'task.json changed: read again');
    // the ledger alone changing also reads the task again: its task.json is unreadable, so a read shows as an error row
    const other = join(w.tasks, 'dddddddd-0002', 'task.json');
    write(join(w.tasks, 'dddddddd-0002', 'ledger.jsonl'), jl([{ ts: T0, event: 'node_finish', node_id: 'report' }, { ts: T0 + 1, event: 'daemon_done' }, { ts: T0 + 2, event: 'clean' }]), T0);
    chmodSync(other, 0o000);
    try {
      if (process.getuid?.() !== 0) assert.ok(listTasks(w.tasks).find((r) => r.task_id === 'dddddddd-0002').error, 'ledger.jsonl changed: read again');
    } finally { chmodSync(other, 0o644); }
  } finally { w.cleanup(); }
});

test('small fixture: events, summary, board and teams equal their goldens, first and second call', () => {
  const w = world();
  try {
    small(w);
    for (const pass of ['first', 'second']) {
      for (const k of ['events', 'summary', 'board', 'teams']) {
        assert.equal(scrub(view(w, CALLS[k](w))), golden().small[k], `${k}, ${pass} call`);
      }
    }
    assert.equal(scrub(view(w, CALLS.status(w))), golden().small.status, 'status');
  } finally { w.cleanup(); }
});

test('running to done: the first call says running, the second does not serve it stale', () => {
  const w = world();
  try {
    small(w);
    const before = JSON.parse(view(w, CALLS.status(w)));
    assert.match(before.line, /E-aaaaaaaa/, 'listed as running');
    view(w, CALLS.status(w)); // the index is written with the finished tasks
    finishRunning(w, 'aaaaaaaa-0001', w.cwd);
    const after = JSON.parse(view(w, CALLS.status(w)));
    assert.doesNotMatch(after.line, /E-aaaaaaaa/, 'done: no longer running');
    assert.equal(after.latest, null);
    const third = JSON.parse(view(w, CALLS.status(w)));
    assert.deepEqual(third, after, 'stable once done');
  } finally { w.cleanup(); }
});

test('corrupt index: the output is still correct and the index is replaced', () => {
  const w = world();
  try {
    small(w);
    view(w, CALLS.status(w));
    const idx = join(w.tasks, '.view-index.json');
    assert.ok(existsSync(idx), 'the index file is written next to the tasks');
    for (const garbage of ['{{{ not json', '[]', '{"tasks":7}', '']) {
      writeFileSync(idx, garbage);
      assert.equal(scrub(view(w, CALLS.summary(w))), golden().small.summary, `garbage ${JSON.stringify(garbage)}`);
      assert.equal(scrub(view(w, CALLS.status(w))), golden().small.status);
    }
    assert.doesNotThrow(() => JSON.parse(readFileSync(idx, 'utf8')), 'rewritten as valid JSON');
  } finally { w.cleanup(); }
});
