// Regression suite for teams/mcp/viewserver.mjs - the one-viewer-per-tasks-root helper that
// tm_open uses to put a human window on a task without anyone having to remember a command.
//
// The contract worth pinning is not "it spawns something": it is that the thing it spawns is
// reachable, that a second task reuses it instead of opening a second port, that a stale record
// left by a killed viewer does not hand out a dead URL, and - above all - that every failure is
// swallowed, because this runs inside tm_open and a window that will not start must never be a
// task that will not open.
//
//   node --test teams/scripts/test-viewserver.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureViewer, readViewRecord, viewRecordPath, viewUrl, viewDisabled, clearViewRecord } from '../mcp/viewserver.mjs';

const spawned = [];

function scratch() {
  const d = mkdtempSync(join(tmpdir(), 'teams-viewserver-'));
  return d;
}

// Every test that may spawn registers the pid here; nothing is left listening after the run.
async function viewer(dir, taskId) {
  const v = await ensureViewer(dir, taskId);
  if (v && v.started) spawned.push(v.pid);
  return v;
}

function killAll() {
  for (const pid of spawned.splice(0)) { try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ } }
}

process.on('exit', killAll);

// Every running viewer pointed at `tasksDir`, by pid, as the OS sees it - the only way to catch
// one this module started and then lost track of. Filtered to that one root on purpose: other
// suites in the same `node --test` run open real tasks and legitimately start viewers of their
// own, and a system-wide count once flagged one of those as this test's orphan.
async function viewerPids(tasksDir) {
  const { spawnSync } = await import('node:child_process');
  const r = spawnSync('pgrep', ['-f', `scripts/view.mjs --tasks-dir ${tasksDir} `], { encoding: 'utf8' });
  return new Set((r.stdout || '').split('\n').map((l) => Number(l.trim())).filter(Boolean));
}

async function get(url) {
  const res = await fetch(url);
  return { status: res.status, body: await res.text() };
}

test('TEAMS_VIEW=0 starts nothing and writes no record - the opt-out is total, not just quiet', async () => {
  const dir = scratch();
  const prev = process.env.TEAMS_VIEW;
  process.env.TEAMS_VIEW = '0';
  try {
    assert.equal(viewDisabled(), true);
    assert.equal(await viewer(dir, 'E-1'), null);
    assert.equal(existsSync(viewRecordPath(dir)), false, 'an opted-out root must stay clean: a record would make a later opted-in call reuse a viewer that was never started');
  } finally {
    if (prev === undefined) delete process.env.TEAMS_VIEW; else process.env.TEAMS_VIEW = prev;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the first call starts a viewer that actually serves the page and /state.json', async () => {
  const dir = scratch();
  const v = await viewer(dir, 'E-abc');
  assert.ok(v, 'a viewer must start on a writable scratch root');
  assert.equal(v.started, true);
  assert.equal(v.url, `http://127.0.0.1:${v.port}/?task=E-abc`);

  // The point of the record is reuse across MCP server processes, so it is on disk, not in a
  // module-level variable: this tm_open and the next one are frequently not the same process.
  const rec = JSON.parse(readFileSync(viewRecordPath(dir), 'utf8'));
  assert.deepEqual(Object.keys(rec).sort(), ['pid', 'port', 'started_at']);
  assert.equal(rec.port, v.port);
  assert.equal(rec.pid, v.pid);

  // Reachability is the whole claim the URL makes. Poll rather than sleep a fixed amount: the
  // child has to boot node and import taskmanager.mjs before it listens.
  let served = null;
  for (let i = 0; i < 100 && !served; i++) {
    try { served = await get(`${v.url.split('/?')[0]}/state.json`); } catch { await new Promise((r) => setTimeout(r, 50)); }
  }
  assert.ok(served, `nothing answered on ${v.url} within 5s`);
  assert.equal(served.status, 200);
  const state = JSON.parse(served.body);
  assert.equal(state.tasks_dir, dir);
  assert.equal(state.mode, 'index', 'an empty tasks root shows the index, not a task');
  assert.deepEqual(state.tasks, [], 'no tasks have been opened under this root');

  const page = await get(v.url);
  assert.equal(page.status, 200);
  assert.match(page.body, /<html/i, 'the browser surface must be served at / too, not only /state.json');
  rmSync(dir, { recursive: true, force: true });
});

test('a second task under the same root reuses the running viewer - one port per root, not per task', async () => {
  const dir = scratch();
  const first = await viewer(dir, 'E-one');
  assert.ok(first && first.started);
  const second = await viewer(dir, 'E-two');
  assert.ok(second);
  assert.equal(second.started, false, 'reuse must be reported as reuse: the caller says "watch it here", not "started"');
  assert.equal(second.port, first.port);
  assert.equal(second.pid, first.pid);
  assert.equal(second.url, `http://127.0.0.1:${first.port}/?task=E-two`, 'the reused viewer is re-pointed at the new task by query string');
  rmSync(dir, { recursive: true, force: true });
});

test('a record whose pid is dead is ignored, and a fresh viewer replaces it', async () => {
  const dir = scratch();
  // A pid that cannot be running: the kernel never hands out 2^22, well past any pid_max.
  writeFileSync(viewRecordPath(dir), JSON.stringify({ pid: 4194304, port: 65535, started_at: 0 }));
  assert.equal(readViewRecord(dir), null, 'a dead pid must not be handed out as a live URL');
  const v = await viewer(dir, 'E-x');
  assert.ok(v && v.started, 'a stale record must not block a new viewer');
  assert.notEqual(v.port, 65535);
  assert.equal(JSON.parse(readFileSync(viewRecordPath(dir), 'utf8')).pid, v.pid, 'the stale record is replaced, not appended to');
  rmSync(dir, { recursive: true, force: true });
});

test('a corrupt or partial record is ignored rather than thrown on', async () => {
  const dir = scratch();
  for (const junk of ['', 'not json', '{}', '{"pid":123}', '{"pid":123,"port":0}', '{"pid":"x","port":10}']) {
    writeFileSync(viewRecordPath(dir), junk);
    assert.equal(readViewRecord(dir), null, `a record of ${JSON.stringify(junk)} must read as "no viewer"`);
  }
  rmSync(dir, { recursive: true, force: true });
});

test('TEAMS_VIEW_PORT pins the port', async () => {
  const dir = scratch();
  const prev = process.env.TEAMS_VIEW_PORT;
  process.env.TEAMS_VIEW_PORT = '7431';
  try {
    const v = await viewer(dir, 'E-p');
    assert.ok(v);
    assert.equal(v.port, 7431);
    assert.equal(v.url, 'http://127.0.0.1:7431/?task=E-p');
  } finally {
    if (prev === undefined) delete process.env.TEAMS_VIEW_PORT; else process.env.TEAMS_VIEW_PORT = prev;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an unwritable tasks root returns null, and leaves no orphan holding a port', async () => {
  // A path that cannot hold a file at all: a record write under a nonexistent directory throws
  // ENOENT, which is exactly the class of failure that must not reach the caller.
  const missing = join(tmpdir(), 'teams-viewserver-does-not-exist', 'nested');
  const before = await viewerPids(missing);
  const v = await ensureViewer(missing, 'E-z');
  assert.equal(v, null);
  // The spawn itself succeeds - only the record write fails - so without the kill on that path
  // a viewer nothing can name is left listening forever. Give it time to bind before counting.
  await new Promise((r) => setTimeout(r, 1500));
  const after = await viewerPids(missing);
  const leaked = [...after].filter((p) => !before.has(p));
  assert.deepEqual(leaked, [], `a viewer that could not be recorded must be killed, not orphaned on ${leaked.join(',')}`);
});

test('viewUrl with no task id points at the index', () => {
  assert.equal(viewUrl(1234, null), 'http://127.0.0.1:1234/');
  assert.equal(viewUrl(1234, 'E-9'), 'http://127.0.0.1:1234/?task=E-9');
});

test('clearViewRecord removes the record and is silent when there is none', async () => {
  const dir = scratch();
  writeFileSync(viewRecordPath(dir), JSON.stringify({ pid: process.pid, port: 1, started_at: 0 }));
  assert.equal(clearViewRecord(dir), true);
  assert.equal(existsSync(viewRecordPath(dir)), false);
  assert.equal(clearViewRecord(dir), false, 'a second clear is not an error');
  rmSync(dir, { recursive: true, force: true });
});

test.after(killAll);
