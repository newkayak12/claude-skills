// The --once read path with the finished-task index (lib/view-index.mjs): output equals the goldens in
// fixtures/view-once-golden.json, which were generated with the pre-index code (git HEAD before the
// index) from the same fixtures; a second call over 2000 finished tasks is fast; a task that goes from
// running to done is not served stale; a corrupt index is a full read. Fixtures are temp dirs.
//
//   node --test teams/scripts/test-view-once-perf.mjs
//   VIEW_ONCE_VIEW=<view.mjs> VIEW_ONCE_REGEN=1 node teams/scripts/test-view-once-perf.mjs   (rewrite goldens from that view.mjs)
process.env.TEAMS_RUNS_DIR ??= 'off';
process.env.TZ = 'UTC';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, utimesSync, existsSync } from 'node:fs';
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

function large(w) {
  for (let i = 0; i < 800; i++) cancelled(w, `c${String(i).padStart(7, '0')}-0001`, i % 2 ? w.cwd : w.other);
  for (let i = 0; i < 600; i++) reported(w, `d${String(i).padStart(7, '0')}-0001`, i % 2 ? w.cwd : w.other);
  for (let i = 0; i < 400; i++) stoppedDaemon(w, `e${String(i).padStart(7, '0')}-0001`, w.cwd);
  for (let i = 0; i < 200; i++) ledgerOnly(w, `f${String(i).padStart(7, '0')}-0001`);
  runningTask(w, 'aaaaaaaa-0001', w.cwd);
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

if (REGEN) {
  const out = { large: {}, small: {} };
  const L = world(); large(L); out.large.status = scrub(view(L, CALLS.status(L))); L.cleanup();
  const S = world(); small(S);
  for (const k of Object.keys(CALLS)) out.small[k] = scrub(view(S, CALLS[k](S)));
  S.cleanup();
  mkdirSync(dirname(GOLDEN), { recursive: true });
  writeFileSync(GOLDEN, JSON.stringify(out, null, 2) + '\n');
  console.log(`goldens written from ${VIEW}`);
  process.exit(0);
}

test('large fixture: status equals the golden, and the second call is fast', () => {
  const w = world();
  try {
    large(w);
    const args = CALLS.status(w);
    const first = scrub(view(w, args));
    assert.equal(first, golden().large.status, 'first call (no index yet)');
    // Bound 0.3 s, generous: ~9.6 s without the index on 2000+ tasks, ~0.1 s with it (mostly node start-up).
    // The full suite runs files in parallel and one call can land on a busy machine (306-399 ms seen), so the
    // call is timed up to 10 times (all served from the index, 200 ms apart) and the best must be under the bound.
    let ms = Infinity;
    for (let i = 0; i < 10 && ms >= 300; i++) {
      if (i) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
      const t = performance.now();
      const out = scrub(view(w, args));
      ms = Math.min(ms, performance.now() - t);
      assert.equal(out, golden().large.status, `call ${i + 2} (index written)`);
    }
    assert.ok(ms < 300, `best indexed call took ${ms.toFixed(0)} ms, bound 300 ms`);
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
