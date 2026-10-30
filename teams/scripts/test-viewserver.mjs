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

// A test task must not land in the real run archive (mcp/runlog.mjs); spawned daemons inherit this.
process.env.TEAMS_RUNS_DIR ??= 'off';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync, realpathSync } from 'node:fs';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureViewer, readViewRecord, viewRecordPath, viewUrl, viewDisabled, clearViewRecord, choosePort, DEFAULT_VIEW_PORT } from '../mcp/viewserver.mjs';

const VIEW_SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'view.mjs');
const spawned = [];

// A port nothing listens on right now (bind 0, read it, close). Tests use these instead of the
// fixed default so they never depend on - or disturb - a real viewer holding 7431.
function closedPort() {
  return new Promise((resolve) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}

// A port something (this process) is listening on, and the handle to release it. Sockets are
// resumed so a client that gives up (viewerAt's probe) is seen closing and release() can finish.
function heldPort() {
  return new Promise((resolve) => {
    const s = createServer((c) => c.resume());
    s.listen(0, '127.0.0.1', () => resolve({ port: s.address().port, release: () => new Promise((r) => s.close(r)) }));
  });
}

// A tasks root holding one fixture task per [id, created_at] pair.
function tasksWith(pairs) {
  const dir = scratch();
  for (const [id, created] of pairs) {
    mkdirSync(join(dir, id), { recursive: true });
    writeFileSync(join(dir, id, 'task.json'), JSON.stringify({
      run_id: id, cwd: dir, request: `request ${id}`, created_at: created, store_path: join(dir, id, 'task.json'), nodes: [],
    }));
  }
  return dir;
}

async function waitAnswer(port) {
  for (let i = 0; i < 100; i++) {
    try { await get(`http://127.0.0.1:${port}/state.json`); return true; } catch { await new Promise((r) => setTimeout(r, 50)); }
  }
  return false;
}

function scratch() {
  const d = mkdtempSync(join(tmpdir(), 'teams-viewserver-'));
  return d;
}

// Every test that may spawn registers the pid here; nothing is left listening after the run.
// Never the default port: unless the test pinned TEAMS_VIEW_PORT itself (or passes `opts`, which
// carries its own preferred port) the call is pinned to a fresh closed one, so ensureViewer cannot
// adopt - or register into - a real viewer on 7431.
async function viewer(dir, taskId, opts) {
  const prev = process.env.TEAMS_VIEW_PORT;
  if (!opts && prev === undefined) process.env.TEAMS_VIEW_PORT = String(await closedPort());
  try {
    const v = await ensureViewer(dir, taskId, opts);
    if (v && v.started) spawned.push(v.pid);
    return v;
  } finally {
    if (prev === undefined) delete process.env.TEAMS_VIEW_PORT; else process.env.TEAMS_VIEW_PORT = prev;
  }
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
  assert.equal(v.url, `http://127.0.0.1:${v.port}/E-abc`);

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
    try { served = await get(`http://127.0.0.1:${v.port}/state.json`); } catch { await new Promise((r) => setTimeout(r, 50)); }
  }
  assert.ok(served, `nothing answered on ${v.url} within 5s`);
  assert.equal(served.status, 200);
  const state = JSON.parse(served.body);
  assert.equal(state.tasks_dir, realpathSync(dir), 'roots are kept samePath\'d');
  assert.equal(state.mode, 'index', 'an empty tasks root shows the index, not a task');
  assert.deepEqual(state.tasks, [], 'no tasks have been opened under this root');

  const page = await get(v.url);
  assert.equal(page.status, 200);
  assert.match(page.body, /<html/i, 'the browser surface must be served at / too, not only /state.json');
  rmSync(dir, { recursive: true, force: true });
});

// The TICKET/RESOURCE views (view-collect.mjs's own model additions, view-render-text.mjs's
// renderTicketsText/renderResourcesText, view-page.html's viewTabs/ticketsBody/resourcesBody)
// ride the exact same view.mjs process ensureViewer spawns here - this pins that the page this
// module hands a caller's URL to is the updated page (the tab strip, not a stale copy), and that
// the extra `view=` query param a tab click adds to the URL does not upset the server route.
test('the viewer ensureViewer starts serves the TICKET/RESOURCE tab strip, and tolerates a ?view= query param on the page route', async () => {
  const dir = scratch();
  const v = await viewer(dir, 'E-views');
  assert.ok(v && v.started);

  assert.ok(await waitAnswer(v.port), `nothing answered on ${v.url} within 5s`);

  const page = await get(v.url);
  assert.equal(page.status, 200);
  assert.match(page.body, /view-tabs/, 'the served page must carry the pipeline/tickets/resources switcher');
  assert.match(page.body, /ticketsBody|resourcesBody/, 'the served page must carry the new views\' own renderers, not a stale cached copy');

  const withView = await get(`${v.url}?view=tickets`);
  assert.equal(withView.status, 200, 'an unrecognized-by-the-server query param must not break the page route - the view switch is client-side only');
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
  assert.equal(second.url, `http://127.0.0.1:${first.port}/E-two`, 'the reused viewer is re-pointed at the new task by its E-key path');
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
  const pin = await closedPort();
  process.env.TEAMS_VIEW_PORT = String(pin);
  try {
    const v = await viewer(dir, 'E-p');
    assert.ok(v);
    assert.equal(v.port, pin, 'the pin wins over the default port');
    assert.equal(v.url, `http://127.0.0.1:${pin}/E-p`);
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
  const v = await viewer(missing, 'E-z');
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
});

test('viewUrl puts the first 8 chars of the id in the path as E-<key>: no double prefix, short ids kept whole', () => {
  const uuid = '124098e5-aaaa-bbbb-cccc-0123456789ab';
  assert.equal(viewUrl(1234, uuid), 'http://127.0.0.1:1234/E-124098e5');
  assert.equal(viewUrl(1234, 'E-124098e5'), 'http://127.0.0.1:1234/E-124098e5', 'an id already starting with E- is not prefixed twice');
  assert.equal(viewUrl(1234, `E-${uuid}`), 'http://127.0.0.1:1234/E-124098e5', 'a long E- id is cut to 8 after the prefix');
  assert.equal(viewUrl(1234, 'E-9'), 'http://127.0.0.1:1234/E-9', 'shorter than 8: the whole id after any E- prefix');
  assert.equal(viewUrl(1234, 'abc'), 'http://127.0.0.1:1234/E-abc');
});

test('the default port is the fixed 7431', () => {
  assert.equal(DEFAULT_VIEW_PORT, 7431);
});

test('choosePort: the preferred port when free, a recorded-able free port when taken, the pin over both', async () => {
  const prev = process.env.TEAMS_VIEW_PORT;
  delete process.env.TEAMS_VIEW_PORT;
  const held = await heldPort();
  try {
    const free = await closedPort();
    assert.equal(await choosePort(free), free, 'a free preferred port is taken as is');
    const fallback = await choosePort(held.port);
    assert.ok(Number.isInteger(fallback) && fallback > 0, 'a taken preferred port falls back to a real port');
    assert.notEqual(fallback, held.port, 'the fallback must not be the port something else holds');
    process.env.TEAMS_VIEW_PORT = String(free);
    assert.equal(await choosePort(held.port), free, 'TEAMS_VIEW_PORT overrides the preferred port');
  } finally {
    await held.release();
    if (prev === undefined) delete process.env.TEAMS_VIEW_PORT; else process.env.TEAMS_VIEW_PORT = prev;
  }
});

test('a record whose pid is alive but is not a viewer, and whose port is closed, is not reused: a new viewer starts and the record is rewritten', async () => {
  const dir = scratch();
  const dead = await closedPort();
  // process.pid is alive and is not a viewer - the exact shape of an OS-recycled pid.
  writeFileSync(viewRecordPath(dir), JSON.stringify({ pid: process.pid, port: dead, started_at: 0 }));
  assert.equal(readViewRecord(dir).pid, process.pid, 'readViewRecord stays pid-only: it still returns the record');
  const v = await viewer(dir, 'E-foreign');
  assert.ok(v, 'a record that does not answer must not block a new viewer');
  assert.equal(v.started, true, 'the foreign-pid record is not reuse');
  assert.notEqual(v.pid, process.pid);
  const rec = JSON.parse(readFileSync(viewRecordPath(dir), 'utf8'));
  assert.equal(rec.pid, v.pid, 'the record is rewritten with the new pid');
  assert.equal(rec.port, v.port, 'and the new port');
  assert.ok(await waitAnswer(v.port), 'the new viewer answers');
  rmSync(dir, { recursive: true, force: true });
});

test('a record whose port answers is reused', async () => {
  const dir = scratch();
  const first = await viewer(dir, 'E-answer1');
  assert.ok(first && first.started);
  assert.ok(await waitAnswer(first.port));
  const again = await viewer(dir, 'E-answer2');
  assert.equal(again.started, false);
  assert.equal(again.pid, first.pid);
  rmSync(dir, { recursive: true, force: true });
});

test('the viewer serves /E-<key> and the old /?task=<uuid> link: page, /state.json, /package-map; an unknown key serves the index', async () => {
  const uuid = '124098e5-1111-2222-3333-444455556666';
  const dir = tasksWith([[uuid, 100], ['ffffffff-0000', 50]]);
  // Two tasks, so there is no single-task shortcut: any task in the answer was selected by key.
  const v = await viewer(dir, uuid);
  assert.ok(v && v.started);
  assert.equal(v.url, `http://127.0.0.1:${v.port}/E-124098e5`);
  assert.ok(await waitAnswer(v.port));
  const base = `http://127.0.0.1:${v.port}`;

  for (const path of ['/E-124098e5', `/?task=${uuid}`, '/E-ffffffff-0', '/E-zzzzzzzz']) {
    const page = await get(`${base}${path}`);
    assert.equal(page.status, 200, path);
    assert.match(page.body, /<html/i, path);
  }
  const byKey = JSON.parse((await get(`${base}/state.json?task=E-124098e5`)).body);
  assert.equal(byKey.mode, 'task');
  assert.equal(byKey.model.task_id, uuid, 'an E-key prefix selects the task');
  const byUuid = JSON.parse((await get(`${base}/state.json?task=${uuid}`)).body);
  assert.equal(byUuid.mode, 'task');
  assert.equal(byUuid.model.task_id, uuid, 'the old uuid link still resolves');
  const unknown = JSON.parse((await get(`${base}/state.json?task=E-ffffffff-9`)).body);
  assert.equal(unknown.mode, 'index', 'an unknown key serves the index, not an error model');
  assert.equal(unknown.tasks.length, 2);
  const bogus = JSON.parse((await get(`${base}/state.json?task=nope`)).body);
  assert.equal(bogus.mode, 'index', 'so does any task param that does not resolve');
  assert.equal((await get(`${base}/package-map?task=E-124098e5`)).status, 404, 'no package map in the fixture, and a key is accepted');
  assert.equal((await get(`${base}/package-map?task=E-nope`)).status, 404);
  rmSync(dir, { recursive: true, force: true });
});

test('an ambiguous E-key prefix serves the newest task by listTasks order', async () => {
  const older = 'abcd1234-a';
  const newer = 'abcd1234-b';
  // created_at decides, not the name: the older task sorts first by name, so "first match wins" fails.
  const dir = tasksWith([[older, 100], [newer, 200], ['other000-x', 300]]);
  const v = await viewer(dir, 'E-abcd1234');
  assert.ok(v && v.started);
  assert.ok(await waitAnswer(v.port));
  const base = `http://127.0.0.1:${v.port}`;
  const st = JSON.parse((await get(`${base}/state.json?task=E-abcd1234`)).body);
  assert.equal(st.model.task_id, newer);
  rmSync(dir, { recursive: true, force: true });
});

// a root B joins the viewer already serving root A; the helper's `preferred` is the scratch port.
test('a second root is registered into the running viewer: started false, same pid and port, both roots in the index (unpinned and pinned)', async () => {
  for (const pinned of [false, true]) {
    const a = tasksWith([['aaaa1111-x', 100]]);
    const b = tasksWith([['bbbb2222-y', 200]]);
    const port = await closedPort();
    const prev = process.env.TEAMS_VIEW_PORT;
    if (pinned) process.env.TEAMS_VIEW_PORT = String(port); else delete process.env.TEAMS_VIEW_PORT;
    try {
      const first = await viewer(a, 'E-aaaa1111', { preferred: port });
      assert.ok(first && first.started && first.port === port);
      const second = await viewer(b, 'E-bbbb2222', { preferred: port });
      assert.equal(second.started, false);
      assert.equal(second.pid, first.pid);
      assert.equal(second.port, port);
      assert.equal(second.url, `http://127.0.0.1:${port}/E-bbbb2222`);
      const rec = JSON.parse(readFileSync(viewRecordPath(b), 'utf8'));
      assert.equal(rec.pid, first.pid);
      assert.equal(rec.port, port);
      const idx = JSON.parse((await get(`http://127.0.0.1:${port}/state.json`)).body);
      assert.deepEqual(idx.tasks.map((t) => t.task_id).sort(), ['aaaa1111-x', 'bbbb2222-y']);
    } finally {
      if (prev === undefined) delete process.env.TEAMS_VIEW_PORT; else process.env.TEAMS_VIEW_PORT = prev;
      killAll();
      rmSync(a, { recursive: true, force: true });
      rmSync(b, { recursive: true, force: true });
    }
  }
});

test('two roots racing for the same free port end on one viewer: one pid, one port, equal records', async () => {
  const a = tasksWith([['aaaa1111-x', 100]]);
  const b = tasksWith([['bbbb2222-y', 200]]);
  const port = await closedPort();
  try {
    const [x, y] = await Promise.all([viewer(a, 'E-aaaa1111', { preferred: port }), viewer(b, 'E-bbbb2222', { preferred: port })]);
    assert.ok(x && y);
    assert.equal(x.pid, y.pid, 'the loser of the bind race adopts the winner');
    assert.equal(x.port, port);
    assert.equal(y.port, port);
    const ra = JSON.parse(readFileSync(viewRecordPath(a), 'utf8'));
    const rb = JSON.parse(readFileSync(viewRecordPath(b), 'utf8'));
    assert.equal(ra.pid, rb.pid);
    assert.equal(ra.port, rb.port);
    const idx = JSON.parse((await get(`http://127.0.0.1:${port}/state.json`)).body);
    assert.deepEqual(idx.tasks.map((t) => t.task_id).sort(), ['aaaa1111-x', 'bbbb2222-y'], 'both roots served on that port');
  } finally {
    killAll();
    rmSync(a, { recursive: true, force: true });
    rmSync(b, { recursive: true, force: true });
  }
});

test('a non-teams holder of the preferred port moves an unpinned viewer to a free port', async () => {
  const dir = tasksWith([['aaaa1111-x', 100]]);
  const held = await heldPort();
  try {
    const v = await viewer(dir, 'E-aaaa1111', { preferred: held.port });
    assert.ok(v && v.started);
    assert.notEqual(v.port, held.port);
    assert.ok(await waitAnswer(v.port));
  } finally {
    killAll();
    await held.release();
    rmSync(dir, { recursive: true, force: true });
  }
});

// view.mjs on its own, no --port, no TEAMS_VIEW_PORT: it asks for 7431 and takes a free port when
// 7431 is held. The test binds 7431 itself only when it is free; when something else holds it the
// test is skipped - it never registers into, or signals, a viewer it did not start.
test('view.mjs without --port prefers 7431 and falls back to a free port when it is taken', async (t) => {
  const holder = createServer();
  const gotDefault = await new Promise((r) => { holder.once('error', () => r(false)); holder.listen(DEFAULT_VIEW_PORT, '127.0.0.1', () => r(true)); });
  if (!gotDefault) { t.skip('7431 is held by something else; not touching it'); return; }
  const dir = tasksWith([]);
  const env = { ...process.env }; delete env.TEAMS_VIEW_PORT;
  const child = spawn(process.execPath, [VIEW_SCRIPT, '--tasks-dir', dir], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  try {
    const line = await new Promise((resolve, reject) => {
      let buf = '';
      child.stdout.on('data', (d) => { buf += d; const m = buf.match(/listening on http:\/\/127\.0\.0\.1:(\d+)/); if (m) resolve(Number(m[1])); });
      child.on('exit', () => reject(new Error(`view.mjs exited early: ${buf}`)));
      setTimeout(() => reject(new Error('view.mjs printed no URL in 8s')), 8000);
    });
    assert.notEqual(line, DEFAULT_VIEW_PORT, gotDefault ? 'the default was held, so the viewer must have moved' : 'something else holds the default, so the viewer must have moved');
    assert.ok(await waitAnswer(line));
  } finally {
    child.kill('SIGKILL');
    if (gotDefault) await new Promise((r) => holder.close(r));
    rmSync(dir, { recursive: true, force: true });
  }
});

// view.mjs --tasks-dir <dir> --port 0, resolved with its base URL once it prints it.
function startView(dir) {
  const child = spawn(process.execPath, [VIEW_SCRIPT, '--tasks-dir', dir, '--port', '0'], { stdio: ['ignore', 'pipe', 'ignore'] });
  spawned.push(child.pid);
  return new Promise((resolve, reject) => {
    let buf = '';
    child.on('exit', () => reject(new Error(`view.mjs exited early: ${buf}`)));
    child.stdout.on('data', (d) => { buf += d; const m = buf.match(/listening on http:\/\/127\.0\.0\.1:(\d+)/); if (m) resolve(`http://127.0.0.1:${m[1]}`); });
  });
}

const post = (url, body, type = 'application/json') => fetch(url, { method: 'POST', headers: type ? { 'content-type': type } : {}, body }).then(async (r) => ({ status: r.status, body: await r.json() }));

test('one view server, many roots: / state is the index even for one task; a task is E-key, slug or ?task=; /teams-view.json names the server', async () => {
  const dir = tasksWith([['aaaa1111-x', 100]]);
  const doc = JSON.parse(readFileSync(join(dir, 'aaaa1111-x', 'task.json'), 'utf8'));
  writeFileSync(join(dir, 'aaaa1111-x', 'task.json'), JSON.stringify({ ...doc, slug: 'fix-bob-pane' }));
  const base = await startView(dir);
  const state = async (q = '') => JSON.parse((await get(`${base}/state.json${q}`)).body);
  const idx = await state();
  assert.equal(idx.mode, 'index', 'a lone task still gives the index');
  assert.equal(idx.tasks.length, 1);
  assert.equal(idx.tasks[0].tasks_dir, idx.tasks_dir);
  assert.deepEqual(idx.tasks_dirs, [idx.tasks_dir]);
  assert.equal((await state('?task=E-aaaa1111')).model.task_id, 'aaaa1111-x');
  assert.equal((await state('?task=fix-bob-pane')).model.task_id, 'aaaa1111-x', 'a slug selects the task');
  assert.equal((await state('?task=no-such-slug')).mode, 'index');
  assert.equal((await get(`${base}/fix-bob-pane`)).status, 200);
  const id = JSON.parse((await get(`${base}/teams-view.json`)).body);
  assert.equal(id.teams_view, 1);
  assert.equal(id.pid, spawned[spawned.length - 1]);
  assert.deepEqual(id.roots, [idx.tasks_dir]);
  rmSync(dir, { recursive: true, force: true });
});

test('POST /register: relative, missing, non-JSON and oversize bodies are 400 and change nothing; a valid root is 200 and its tasks join the index', async () => {
  const a = tasksWith([['aaaa1111-x', 100]]);
  const b = tasksWith([['bbbb2222-y', 200]]);
  const base = await startView(a);
  const roots = async () => JSON.parse((await get(`${base}/teams-view.json`)).body).roots;
  const before = await roots();
  assert.equal((await post(`${base}/register`, JSON.stringify({ tasks_dir: 'relative/dir' }))).status, 400);
  assert.equal((await post(`${base}/register`, JSON.stringify({}))).status, 400);
  assert.equal((await post(`${base}/register`, JSON.stringify({ tasks_dir: join(a, 'nope') }))).status, 400);
  assert.equal((await post(`${base}/register`, JSON.stringify({ tasks_dir: b }), 'text/plain')).status, 400);
  assert.equal((await post(`${base}/register`, JSON.stringify({ tasks_dir: b }), null)).status, 400);
  assert.equal((await post(`${base}/register`, '{not json')).status, 400);
  assert.equal((await post(`${base}/register`, JSON.stringify({ tasks_dir: b, pad: 'x'.repeat(5000) }))).status, 400, 'over 4 KB');
  assert.deepEqual(await roots(), before, 'every 400 left the roots as they were');
  const ok = await post(`${base}/register`, JSON.stringify({ tasks_dir: b }));
  assert.equal(ok.status, 200);
  assert.equal(ok.body.ok, true);
  assert.equal(ok.body.roots.length, 2);
  assert.equal((await post(`${base}/register`, JSON.stringify({ tasks_dir: b }))).body.roots.length, 2, 'registering twice does not duplicate');
  const idx = JSON.parse((await get(`${base}/state.json`)).body);
  assert.deepEqual(idx.tasks.map((t) => t.task_id), ['bbbb2222-y', 'aaaa1111-x'], 'both roots, newest first');
  assert.equal(JSON.parse((await get(`${base}/state.json?task=E-bbbb2222`)).body).model.task_id, 'bbbb2222-y', 'a task of the registered root resolves');
  rmSync(a, { recursive: true, force: true });
  rmSync(b, { recursive: true, force: true });
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
