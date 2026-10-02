#!/usr/bin/env node
// test-store.mjs - store.mjs: the one transactional writer of task.json (2026-10-02 review).
//
// What these pin, each one a failure the old saveRun had: the lock used to fall through to an
// unlocked write after 5 s (graph.mjs acquire, `return null`), steal a live owner's lock by mtime
// alone, and every writer merged a stale snapshot onto disk with {...fresh, ...mine}. A ledger
// line was appended at call time, so a write that aborted still left its event behind.
//
//   node --test teams/scripts/test-store.mjs

process.env.TEAMS_RUNS_DIR ??= 'off';
process.env.TEAMS_VIEW = '0';
process.env.HARNESS_TEST_NO_DRIVER = '1';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = mkdtempSync(join(tmpdir(), 'tm-store-root-'));
process.env.HARNESS_TASKS_DIR = ROOT;
const STORE = join(HERE, '..', 'mcp', 'store.mjs');
const store = await import(STORE);
const graph = await import(join(HERE, '..', 'mcp', 'graph.mjs'));
const tm = await import(join(HERE, '..', 'mcp', 'taskmanager.mjs'));
const { mutateTask, mutateRun, writeAtomic, inTransaction } = store;

process.on('exit', () => { try { rmSync(ROOT, { recursive: true, force: true }); } catch { /* best-effort */ } });

let seq = 0;
// A fresh task dir with a task.json the way createTask leaves one (store_path set).
function seedTask(extra = {}) {
  const id = `t${process.pid}-${++seq}`;
  const path = join(ROOT, id, 'task.json');
  mkdirSync(dirname(path), { recursive: true });
  const task = { run_id: id, cwd: ROOT, store_path: path, request: 'r', spec: { packages: [] }, nodes: [{ node_id: 'size', state: 'pending' }], n: 0, ...extra };
  writeFileSync(path, JSON.stringify(task, null, 2) + '\n');
  return { id, path };
}
const ledgerOf = (id) => { try { return readFileSync(join(ROOT, id, 'ledger.jsonl'), 'utf8'); } catch { return ''; } };
const withEnv = (vars, fn) => {
  const prev = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  Object.assign(process.env, vars);
  try { return fn(); } finally {
    for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
};
const holdLock = (path, owner) => {
  mkdirSync(path + '.lock');
  if (owner !== undefined) writeFileSync(join(path + '.lock', 'owner.json'), JSON.stringify(owner));
};
const age = (p, ms) => { const t = (Date.now() - ms) / 1000; utimesSync(p, t, t); };

test('(d) lock timeout throws ELOCKTIMEOUT and the file is unchanged', () => {
  const { path } = seedTask();
  const before = readFileSync(path, 'utf8');
  holdLock(path, { pid: process.pid, at: Date.now(), token: 'held-by-someone' });
  let ran = false;
  assert.throws(() => withEnv({ TEAMS_LOCK_TIMEOUT_MS: '200' }, () => mutateTask(path, (t) => { ran = true; t.n = 99; })),
    (e) => e.code === 'ELOCKTIMEOUT');
  assert.equal(ran, false, 'fn never runs without the lock');
  assert.equal(readFileSync(path, 'utf8'), before);
  assert.ok(existsSync(path + '.lock'), 'the holder keeps its lock');
  rmSync(path + '.lock', { recursive: true });
});

// Only a child run (no store_path) still reaches saveRun's lock - a task throws before it.
test('saveRun no longer falls through unlocked: a held lock throws ELOCKTIMEOUT', () => {
  const cwd = mkdtempSync(join(ROOT, 'proj-'));
  graph.saveRun({ run_id: 'c-lock', cwd, nodes: [{ node_id: 'a', state: 'pending' }] });
  const path = graph.pathOf({ run_id: 'c-lock', cwd });
  const before = readFileSync(path, 'utf8');
  holdLock(path, { pid: process.pid, at: Date.now(), token: 'x' });
  const run = JSON.parse(before);
  run.n = 7;
  assert.throws(() => withEnv({ TEAMS_LOCK_TIMEOUT_MS: '200' }, () => graph.saveRun(run)), (e) => e.code === 'ELOCKTIMEOUT');
  assert.equal(readFileSync(path, 'utf8'), before);
  rmSync(path + '.lock', { recursive: true });
});

test('a live owner lock with an old mtime is NOT stolen; the waiter throws ELOCKTIMEOUT', () => {
  const { path } = seedTask();
  holdLock(path, { pid: process.pid, at: Date.now() - 10 * 60 * 1000, token: 'slow-tx' });
  age(join(path + '.lock', 'owner.json'), 10 * 60 * 1000);
  age(path + '.lock', 10 * 60 * 1000);
  assert.throws(() => withEnv({ TEAMS_LOCK_TIMEOUT_MS: '200' }, () => mutateTask(path, (t) => { t.n = 1; })),
    (e) => e.code === 'ELOCKTIMEOUT');
  assert.equal(JSON.parse(readFileSync(join(path + '.lock', 'owner.json'), 'utf8')).token, 'slow-tx', 'the live owner keeps its lock');
  rmSync(path + '.lock', { recursive: true });
});

test('a lock whose owner pid is dead is stolen', () => {
  const { path } = seedTask();
  holdLock(path, { pid: 2147483646, at: Date.now(), token: 'dead' });
  withEnv({ TEAMS_LOCK_TIMEOUT_MS: '500' }, () => mutateTask(path, (t) => { t.n = 1; }));
  assert.equal(JSON.parse(readFileSync(path, 'utf8')).n, 1);
  assert.equal(existsSync(path + '.lock'), false, 'released after commit');
});

test('a lock dir without owner.json inside the grace is not stolen (the mkdir -> owner.json window)', () => {
  const { path } = seedTask();
  holdLock(path); // no owner.json yet: a writer that has just won mkdir
  assert.throws(() => withEnv({ TEAMS_LOCK_TIMEOUT_MS: '200' }, () => mutateTask(path, (t) => { t.n = 1; })),
    (e) => e.code === 'ELOCKTIMEOUT');
  assert.equal(JSON.parse(readFileSync(path, 'utf8')).n, 0);
  rmSync(path + '.lock', { recursive: true });
});

test('a lock dir without owner.json older than the grace is stolen by mtime', () => {
  const { path } = seedTask();
  holdLock(path);
  age(path + '.lock', 10 * 60 * 1000);
  withEnv({ TEAMS_LOCK_TIMEOUT_MS: '500' }, () => mutateTask(path, (t) => { t.n = 2; }));
  assert.equal(JSON.parse(readFileSync(path, 'utf8')).n, 2);
});

test('mutateTask: lock -> fresh read -> fn -> write-then-rename; returns fn value; lock records an owner', () => {
  const { id, path } = seedTask();
  // A stale snapshot elsewhere does not matter: fn sees the disk copy.
  const disk = JSON.parse(readFileSync(path, 'utf8'));
  disk.spec.packages = [{ id: 'P1' }];
  writeFileSync(path, JSON.stringify(disk));
  const out = mutateTask(id, (t) => {
    const owner = JSON.parse(readFileSync(join(path + '.lock', 'owner.json'), 'utf8'));
    assert.equal(owner.pid, process.pid);
    assert.equal(inTransaction(path), true);
    assert.equal(inTransaction(), true);
    t.n += 1;
    return t.spec.packages.length;
  });
  assert.equal(out, 1);
  assert.equal(inTransaction(), false);
  const saved = JSON.parse(readFileSync(path, 'utf8'));
  assert.equal(saved.n, 1);
  assert.deepEqual(saved.spec.packages, [{ id: 'P1' }]);
  assert.equal(existsSync(path + '.lock'), false);
});

test('mutateTask(taskId) resolves to the same task.json taskmanager uses', () => {
  const { id, path } = seedTask();
  assert.equal(tm.taskPath(id), path);
  mutateTask(id, (t) => { t.n = 5; });
  assert.equal(JSON.parse(readFileSync(path, 'utf8')).n, 5);
});

test('fn throwing aborts: the file is byte-identical and the lock is released', () => {
  const { path } = seedTask();
  const before = readFileSync(path, 'utf8');
  assert.throws(() => mutateTask(path, (t) => { t.n = 42; t.nodes[0].state = 'done'; throw new Error('boom'); }), /boom/);
  assert.equal(readFileSync(path, 'utf8'), before);
  assert.equal(existsSync(path + '.lock'), false);
  assert.equal(inTransaction(), false);
});

test('ledger: record() inside a transaction is buffered until the rename commits', () => {
  const { id, path } = seedTask();
  mutateTask(path, (t) => {
    tm.record(t, { event: 'store_probe', n: 1 });
    assert.equal(ledgerOf(id), '', 'not on disk before commit');
    t.n = 1;
  });
  const lines = ledgerOf(id).trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(lines.map((l) => l.event), ['store_probe']);
});

test('ledger: fn records then throws -> ledger.jsonl unchanged', () => {
  const { id, path } = seedTask();
  tm.record({ run_id: id }, { event: 'before' });
  const before = ledgerOf(id);
  assert.throws(() => mutateTask(path, (t) => {
    tm.record(t, { event: 'tm_submit', node_id: 'size' });
    t.nodes[0].state = 'done';
    throw new Error('dispatch payload');
  }), /dispatch payload/);
  assert.equal(ledgerOf(id), before);
});

test('an async fn is rejected before anything is written', async () => {
  const { id, path } = seedTask();
  const before = readFileSync(path, 'utf8');
  assert.throws(() => mutateTask(path, async (t) => { t.n = 9; }), /synchronous/);
  assert.throws(() => mutateTask(path, (t) => { t.n = 9; tm.record(t, { event: 'x' }); return Promise.resolve(1); }), /synchronous/);
  await new Promise((r) => setImmediate(r));
  assert.equal(readFileSync(path, 'utf8'), before);
  assert.equal(ledgerOf(id), '');
  assert.equal(existsSync(path + '.lock'), false);
});

test('a nested mutateTask on the same path joins the outer transaction (no relock, one write)', () => {
  const { path } = seedTask();
  const inoBefore = statSync(path).ino;
  withEnv({ TEAMS_LOCK_TIMEOUT_MS: '200' }, () => mutateTask(path, (outer) => {
    outer.n = 1;
    const v = mutateTask(path, (inner) => {
      assert.equal(inner, outer, 'the same object');
      inner.n += 1;
      return 'inner';
    });
    assert.equal(v, 'inner');
    assert.equal(statSync(path).ino, inoBefore, 'the inner call did not write');
    assert.equal(readdirSync(dirname(path)).filter((f) => f.endsWith('.lock')).length, 1);
  }));
  assert.equal(JSON.parse(readFileSync(path, 'utf8')).n, 2);
});

test('a transaction that changed nothing does not rewrite task.json (mtime and inode unchanged)', () => {
  const { path } = seedTask();
  age(path, 60 * 1000);
  const st = statSync(path);
  mutateTask(path, (t) => { void t.nodes.length; });
  const after = statSync(path);
  assert.equal(after.mtimeMs, st.mtimeMs);
  assert.equal(after.ino, st.ino);
});

test('saveRun inside a transaction: its own object is accepted with no I/O; any other object for that path throws', () => {
  const { path } = seedTask();
  const stale = JSON.parse(readFileSync(path, 'utf8'));
  const ino = statSync(path).ino;
  mutateTask(path, (t) => {
    t.n = 3;
    assert.equal(graph.saveRun(t), t);
    assert.equal(statSync(path).ino, ino, 'no write of its own - the transaction commits');
    assert.throws(() => graph.saveRun(stale), /mutateTask/);
  });
  assert.equal(JSON.parse(readFileSync(path, 'utf8')).n, 3);
});

test('saveRun of a task outside a transaction throws /outside mutateTask/ with no flag set', () => {
  const { path } = seedTask();
  const run = JSON.parse(readFileSync(path, 'utf8'));
  const before = readFileSync(path, 'utf8');
  run.n = 4;
  assert.equal(process.env.HARNESS_STORE_STRICT, undefined);
  assert.throws(() => graph.saveRun(run), /outside mutateTask/);
  // No escape: the retired env flag does not turn the merge path back on for a task.
  assert.throws(() => withEnv({ HARNESS_STORE_STRICT: '0' }, () => graph.saveRun(run)), /outside mutateTask/);
  assert.equal(store.setStrict, undefined, 'setStrict is retired');
  assert.equal(readFileSync(path, 'utf8'), before, 'nothing written');
  // The same change through mutateTask lands.
  mutateTask(path, (t) => { t.n = 4; });
  assert.equal(JSON.parse(readFileSync(path, 'utf8')).n, 4);
  // A child run (no store_path) keeps the merge path.
  const cwd = mkdtempSync(join(ROOT, 'proj-'));
  graph.saveRun({ run_id: 'c1', cwd, nodes: [{ node_id: 'a', state: 'pending' }] });
  assert.equal(graph.loadRun(cwd, 'c1').nodes[0].node_id, 'a');
});

test('writeAtomic and every commit leave no .tmp behind', () => {
  const { path } = seedTask();
  for (let i = 0; i < 20; i++) mutateTask(path, (t) => { t.n = i + 1; });
  const p2 = join(ROOT, 'w', 'x.json');
  writeAtomic(p2, { a: 1 });
  assert.deepEqual(JSON.parse(readFileSync(p2, 'utf8')), { a: 1 });
  for (const dir of [dirname(path), dirname(p2)]) {
    assert.deepEqual(readdirSync(dir).filter((f) => f.endsWith('.tmp')), []);
  }
});

test('mutateRun create:true starts from an empty object when the file is missing; missing without it throws', () => {
  const p = join(ROOT, 'fresh', 'run.json');
  assert.throws(() => mutateRun(p, () => {}), (e) => e.code === 'ENOENT');
  mutateRun(p, (r) => { r.run_id = 'fresh'; }, { create: true });
  assert.equal(JSON.parse(readFileSync(p, 'utf8')).run_id, 'fresh');
});

test('4 child processes x 50 increments -> counter 200 (no lost update)', async () => {
  const p = join(ROOT, 'counter', 'c.json');
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify({ n: 0 }));
  const src = `import { mutateRun } from ${JSON.stringify(pathToFileURL(STORE).href)};
for (let i = 0; i < 50; i++) mutateRun(${JSON.stringify(p)}, (r) => { r.n += 1; });`;
  const runs = Array.from({ length: 4 }, () => new Promise((res, rej) => {
    const c = spawn(process.execPath, ['--input-type=module', '-e', src], { stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, TEAMS_LOCK_TIMEOUT_MS: '20000' } });
    let err = '';
    c.stderr.on('data', (d) => { err += d; });
    c.on('exit', (code) => (code === 0 ? res() : rej(new Error(`child exit ${code}: ${err}`))));
  }));
  await Promise.all(runs);
  assert.equal(JSON.parse(readFileSync(p, 'utf8')).n, 200);
  assert.deepEqual(readdirSync(dirname(p)).filter((f) => f.endsWith('.tmp') || f.endsWith('.lock')), []);
});

// U1 test-1: a waiter that read a dead owner earlier renamed aside the lock another waiter had just
// stolen and re-taken (live); a third waiter then mkdir'd the free path, two holders, lost update.
// Each worker re-plants a dead-owner lock after every other commit, so one run is hundreds of
// contended steals. The pre-fix steal() lost 1-3 of 1600 (and once orphaned a lock) per run.
test('dead-owner locks re-planted under 8-process contention: no lost update, no lock left', async () => {
  for (let round = 0; round < 2; round++) {
    const p = join(ROOT, `steal-race-${round}`, 'c.json');
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify({ n: 0 }));
    const src = `import { mutateRun } from ${JSON.stringify(pathToFileURL(STORE).href)};
import { mkdirSync, writeFileSync } from 'node:fs';
const p = ${JSON.stringify(p)};
for (let i = 0; i < 200; i++) {
  mutateRun(p, (r) => { r.n += 1; });
  if (i % 2 === 0) { try { mkdirSync(p + '.lock'); writeFileSync(p + '.lock/owner.json', JSON.stringify({ pid: 2147483646, at: 0, token: 'dead-' + process.pid + '-' + i })); } catch {} }
}`;
    const runs = Array.from({ length: 8 }, () => new Promise((res, rej) => {
      const c = spawn(process.execPath, ['--input-type=module', '-e', src], { stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, TEAMS_LOCK_TIMEOUT_MS: '20000' } });
      let err = '';
      c.stderr.on('data', (d) => { err += d; });
      c.on('exit', (code) => (code === 0 ? res() : rej(new Error(`child exit ${code}: ${err}`))));
    }));
    await Promise.all(runs);
    assert.equal(JSON.parse(readFileSync(p, 'utf8')).n, 1600, `round ${round}`);
    const left = readdirSync(dirname(p)).filter((f) => f !== 'c.json' && f !== 'c.json.lock');
    assert.deepEqual(left, [], 'no .tmp, .steal or .stale left');
  }
});

test('steal lock: a dead stealer\'s .steal file is recovered; a live one blocks the steal', () => {
  const { path } = seedTask();
  holdLock(path, { pid: 2147483646, at: Date.now(), token: 'dead-main' });
  writeFileSync(path + '.lock.steal', JSON.stringify({ pid: process.pid, at: Date.now(), token: 'live-stealer' }));
  assert.throws(() => withEnv({ TEAMS_LOCK_TIMEOUT_MS: '200' }, () => mutateTask(path, (t) => { t.n = 1; })),
    (e) => e.code === 'ELOCKTIMEOUT');
  assert.equal(JSON.parse(readFileSync(join(path + '.lock', 'owner.json'), 'utf8')).token, 'dead-main', 'nothing removed without the steal lock');
  assert.equal(JSON.parse(readFileSync(path + '.lock.steal', 'utf8')).token, 'live-stealer', 'a live stealer keeps its steal lock');
  writeFileSync(path + '.lock.steal', JSON.stringify({ pid: 2147483645, at: 0, token: 'dead-stealer' }));
  withEnv({ TEAMS_LOCK_TIMEOUT_MS: '1000' }, () => mutateTask(path, (t) => { t.n = 3; }));
  assert.equal(JSON.parse(readFileSync(path, 'utf8')).n, 3);
  assert.deepEqual(readdirSync(dirname(path)).filter((f) => f.includes('.lock')), []);
});

// U1 test-2 residual: an empty or unparsable .steal (crash / power loss mid-write; the code itself
// writes tmp + link) used to wedge every steal forever. Judged by mtime like an owner-less main lock.
test('steal lock: an empty or unparsable .steal blocks only inside the grace, then is succeeded', () => {
  for (const junk of ['', 'garbage{']) {
    const { path } = seedTask();
    holdLock(path, { pid: 2147483646, at: Date.now(), token: 'dead-main' });
    writeFileSync(path + '.lock.steal', junk);
    assert.throws(() => withEnv({ TEAMS_LOCK_TIMEOUT_MS: '200' }, () => mutateTask(path, (t) => { t.n = 1; })),
      (e) => e.code === 'ELOCKTIMEOUT', `young ${JSON.stringify(junk)} .steal is respected`);
    age(path + '.lock.steal', 11 * 1000);
    withEnv({ TEAMS_LOCK_TIMEOUT_MS: '1000' }, () => mutateTask(path, (t) => { t.n = 2; }));
    assert.equal(JSON.parse(readFileSync(path, 'utf8')).n, 2);
    assert.deepEqual(readdirSync(dirname(path)).filter((f) => f.includes('.lock')), [], 'chain cleaned up');
  }
});

// A dead stealer is succeeded (link `<lock>.steal.<its token>`), never removed by name, so a live
// stealer can not be displaced by a waiter acting on an old "dead" read.
test('steal lock: a dead .steal is succeeded; a live successor blocks; a dead successor is succeeded too', () => {
  const { path } = seedTask();
  holdLock(path, { pid: 2147483646, at: Date.now(), token: 'dead-main' });
  writeFileSync(path + '.lock.steal', JSON.stringify({ pid: 2147483645, at: 0, token: 'dead-a' }));
  writeFileSync(path + '.lock.steal.dead-a', JSON.stringify({ pid: process.pid, at: Date.now(), token: 'live-b' }));
  assert.throws(() => withEnv({ TEAMS_LOCK_TIMEOUT_MS: '200' }, () => mutateTask(path, (t) => { t.n = 1; })),
    (e) => e.code === 'ELOCKTIMEOUT');
  assert.equal(JSON.parse(readFileSync(path + '.lock.steal.dead-a', 'utf8')).token, 'live-b', 'live successor kept');
  assert.equal(JSON.parse(readFileSync(path + '.lock.steal', 'utf8')).token, 'dead-a', 'dead base not removed by a non-holder');
  writeFileSync(path + '.lock.steal.dead-a', JSON.stringify({ pid: 2147483644, at: 0, token: 'dead-b' }));
  withEnv({ TEAMS_LOCK_TIMEOUT_MS: '1000' }, () => mutateTask(path, (t) => { t.n = 4; }));
  assert.equal(JSON.parse(readFileSync(path, 'utf8')).n, 4);
  assert.deepEqual(readdirSync(dirname(path)).filter((f) => f.includes('.lock')), []);
});

// The dead-stealer recovery window under load: dead .steal files (planted the way a killed stealer
// leaves one: tmp + link) and dead main locks re-planted by every worker. A second live steal-lock
// holder would let two stealers pass the main-lock token re-check -> two main-lock holders.
test('dead .steal + dead main lock re-planted under 8-process contention: no lost update, nothing left', async () => {
  for (let round = 0; round < 2; round++) {
    const p = join(ROOT, `steal-dead-${round}`, 'c.json');
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify({ n: 0 }));
    const src = `import { mutateRun } from ${JSON.stringify(pathToFileURL(STORE).href)};
import { mkdirSync, writeFileSync, linkSync, unlinkSync } from 'node:fs';
const p = ${JSON.stringify(p)};
const plantSteal = (i) => { const t = p + '.plant.' + process.pid; writeFileSync(t, JSON.stringify({ pid: 2147483645, at: 0, token: 'ds-' + process.pid + '-' + i }));
  try { linkSync(t, p + '.lock.steal'); } catch {} unlinkSync(t); };
plantSteal(-1);
for (let i = 0; i < 150; i++) {
  mutateRun(p, (r) => { r.n += 1; });
  if (i % 3 === 0) plantSteal(i);
  if (i % 2 === 0) { try { mkdirSync(p + '.lock'); writeFileSync(p + '.lock/owner.json', JSON.stringify({ pid: 2147483646, at: 0, token: 'dead-' + process.pid + '-' + i })); } catch {} }
}`;
    const runs = Array.from({ length: 8 }, () => new Promise((res, rej) => {
      const c = spawn(process.execPath, ['--input-type=module', '-e', src], { stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, TEAMS_LOCK_TIMEOUT_MS: '20000' } });
      let err = '';
      c.stderr.on('data', (d) => { err += d; });
      c.on('exit', (code) => (code === 0 ? res() : rej(new Error(`child exit ${code}: ${err}`))));
    }));
    await Promise.all(runs);
    assert.equal(JSON.parse(readFileSync(p, 'utf8')).n, 1200, `round ${round}`);
    // The last re-plant may leave a dead main lock and/or a dead .steal behind; a writer facing a
    // dead main lock succeeds both. Nothing else (no tmp, no orphan chain link) may remain after.
    try { holdLock(p, { pid: 2147483646, at: 0, token: 'dead-final' }); } catch { /* one is left */ }
    mutateRun(p, (r) => { r.n += 1; });
    assert.equal(JSON.parse(readFileSync(p, 'utf8')).n, 1201);
    const left = readdirSync(dirname(p)).filter((f) => f !== 'c.json');
    assert.deepEqual(left, [], 'no .tmp, .steal chain or lock left');
  }
});

test('ledger: a record inside a nested transaction on another file is dropped when the outer aborts', () => {
  const outer = seedTask();
  const inner = seedTask();
  assert.throws(() => mutateTask(outer.path, (t) => {
    t.n = 5;
    mutateTask(inner.path, (u) => { tm.record(t, { event: 'nested_probe' }); u.n = 6; });
    assert.equal(ledgerOf(outer.id), '', 'inner commit does not flush: the line waits for the outermost');
    throw new Error('outer abort');
  }), /outer abort/);
  assert.equal(ledgerOf(outer.id), '', 'no phantom event after the outer abort');
  assert.equal(JSON.parse(readFileSync(outer.path, 'utf8')).n, 0, 'outer file unchanged');
  assert.equal(JSON.parse(readFileSync(inner.path, 'utf8')).n, 6, 'inner file is its own commit (documented)');
  mutateTask(outer.path, (t) => {
    mutateTask(inner.path, (u) => { tm.record(t, { event: 'nested_ok' }); u.n = 7; });
    try { mutateTask(outer.path, () => { tm.record(t, { event: 'joined_threw' }); throw new Error('caught'); }); } catch { /* outer continues */ }
    t.n = 8;
  });
  assert.deepEqual(ledgerOf(outer.id).trim().split('\n').map((l) => JSON.parse(l).event), ['nested_ok']);
});
