#!/usr/bin/env node
// server.mjs: the one teams MCP server (team_*, tm_*, wiki_*), spawned over stdio so the replies
// are the bytes a client reads. Covers the tool list against the golden fixture, TEAMS_WIKI_OFF,
// --only wiki, wiki root precedence, call routing (serial tm_/wiki_ queue), progress, cancel, drain.
//
//   node --test teams/scripts/test-server.mjs

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalize } from './capture-tools.mjs';
import { ALL_TOOLS } from '../mcp/server-tools.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER = join(HERE, '..', 'mcp', 'server.mjs');
const FIXTURE = JSON.parse(readFileSync(join(HERE, 'fixtures', 'tools-before.json'), 'utf8'));
const OFF_TEXT = 'teams-wiki is off (TEAMS_WIKI_OFF=1)';

const scratch = [];
const procs = [];
const mk = (prefix) => { const d = mkdtempSync(join(tmpdir(), prefix)); scratch.push(d); return d; };
after(() => {
  for (const p of procs) { try { p.kill('SIGKILL'); } catch { /* gone */ } }
  for (const d of scratch) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best-effort */ } }
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, what, ms = 8000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > end) assert.fail(`timed out waiting for ${what}`);
    await sleep(40);
  }
}
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const git = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });
function repo() {
  const dir = mk('server-repo-');
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@t');
  git(dir, 'config', 'user.name', 't');
  writeFileSync(join(dir, 'a.txt'), 'x\n');
  writeFileSync(join(dir, '.gitignore'), '.teams_output/\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'init');
  return dir;
}

function baseEnv(extra = {}) {
  const env = { ...process.env, HARNESS_TASKS_DIR: mk('server-tasks-'), HARNESS_TEST_NO_DRIVER: '1' };
  delete env.TEAMS_WIKI_ROOT;
  delete env.TEAMS_WIKI_OFF;
  Object.assign(env, extra);
  for (const [k, v] of Object.entries(extra)) if (v === undefined) delete env[k];
  return env;
}

class Client {
  constructor(args = [], env = baseEnv()) {
    this.env = env;
    this.proc = spawn(process.execPath, [SERVER, ...args], { stdio: ['pipe', 'pipe', 'pipe'], env });
    procs.push(this.proc);
    this.stderr = '';
    this.proc.stderr.on('data', (d) => { this.stderr += d; });
    this.buf = '';
    this.lines = [];
    this.waiters = [];
    this.nextId = 1;
    this.proc.stdout.setEncoding('utf8');
    this.proc.stdout.on('data', (chunk) => {
      this.buf += chunk;
      let nl;
      while ((nl = this.buf.indexOf('\n')) >= 0) {
        this.lines.push(this.buf.slice(0, nl));
        this.buf = this.buf.slice(nl + 1);
        this.waiters = this.waiters.filter((w) => !w());
      }
    });
    this.exited = new Promise((resolve) => this.proc.on('exit', (code) => resolve(code)));
  }

  send(obj) { this.proc.stdin.write(JSON.stringify(obj) + '\n'); }

  waitFor(pick, ms = 10000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout; saw ' + JSON.stringify(this.lines))), ms);
      const look = () => {
        for (const line of this.lines) {
          const m = JSON.parse(line);
          if (pick(m)) { clearTimeout(timer); resolve(m); return true; }
        }
        return false;
      };
      if (!look()) this.waiters.push(look);
    });
  }

  request(method, params, id = this.nextId++) {
    this.send({ jsonrpc: '2.0', id, method, params });
    return this.waitFor((m) => m.id === id);
  }

  // Starts a tools/call and returns { id, reply } without waiting.
  start(name, args, meta) {
    const id = this.nextId++;
    this.send({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args, ...(meta ? { _meta: meta } : {}) } });
    return { id, reply: this.waitFor((m) => m.id === id) };
  }

  async call(name, args, meta) {
    const r = (await this.start(name, args, meta).reply).result;
    return r.isError ? r : r.structuredContent;
  }

  async init() { await this.request('initialize', { protocolVersion: '2025-06-18' }); return this; }
  async tools() { return (await this.request('tools/list', {})).result.tools; }
  cancel(requestId) { this.send({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId } }); }
  index(id) { return this.lines.findIndex((l) => JSON.parse(l).id === id); }
  close() { try { this.proc.stdin.end(); } catch { /* closed */ } setTimeout(() => this.proc.kill('SIGKILL'), 2000).unref(); }
}

async function withClient(args, env, fn) {
  const c = new Client(args, env);
  try { return await fn(await c.init()); } finally { c.close(); }
}

const names = (tools) => tools.map((t) => t.name);
const withPrefix = (tools, p) => tools.filter((t) => t.name.startsWith(p));

async function openTask(c, cwd) {
  const open = await c.call('tm_open', { request: 'server test', cwd, vendor: 'self', brainstorm: false, roles: { qa: false }, size: 'L' });
  assert.ok(open.task_id, `tm_open gave a task_id: ${JSON.stringify(open)}`);
  return open.task_id;
}

test('initialize answers teams/1.0.0 with the 2025-06-18 default protocol', async () => {
  const c = new Client();
  try {
    const r = await c.request('initialize', {});
    assert.deepEqual(r.result.serverInfo, { name: 'teams', version: '1.0.0' });
    assert.equal(r.result.protocolVersion, '2025-06-18');
    assert.deepEqual(r.result.capabilities, { tools: { listChanged: false } });
  } finally { c.close(); }
});

test('full mode lists the 33 tools of the golden fixture plus tm_post and tm_read, same names, descriptions and schemas', async () => {
  await withClient(['--root', mk('server-wiki-')], baseEnv(), async (c) => {
    const listed = (await c.tools()).map((t) => normalize({
      name: t.name, description: t.description, inputSchema: t.inputSchema, outputSchema: t.outputSchema === undefined ? null : t.outputSchema,
    })).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    // Same three exact swaps as test-taskmanager-tools.mjs: the fixture is pre-merge, card 127 added the EPIC `name`.
    const NAME_FRAGMENT = {
      tm_status: ['Compact task state: ', 'Compact task state: the EPIC `name` (a short natural-language name), '],
      tm_board: ['(key, state, phase)', '(key, name - a short natural-language name, state, phase)'],
      tm_ticket: ['for the EPIC, E-xxxxxxxx/Pn', 'for the EPIC (with its short natural-language `name`), E-xxxxxxxx/Pn'],
    };
    // tm_open and tm_run gained the optional `name` argument (the model-written EPIC name), pinned as its exact schema.
    const NAME_PROP = {
      tm_open: { type: 'string', description: 'Optional short name for this EPIC, a few words in the request\'s language. Pass it only when the request\'s first clause does not read as a title (a chat sentence, not a card title). Stored once in task.json and shown beside the key; derived from the request when omitted.' },
      tm_run: { type: 'string', description: 'Same meaning as tm_open({name}): a few words in the request\'s language, passed only when the request\'s first clause does not read as a title. Stored once in task.json and shown beside the key; derived from the request when omitted.' },
    };
    // Descriptions over 400 chars were shortened (card 130): for a name in tools-short.json the expected
    // description is that exact string; the fixture keeps the old text.
    const SHORT = JSON.parse(readFileSync(join(HERE, 'fixtures', 'tools-short.json'), 'utf8'));
    const golden = FIXTURE.map(({ server, ...rest0 }) => {
      const rest = NAME_PROP[rest0.name] ? { ...rest0, inputSchema: { ...rest0.inputSchema, properties: { ...rest0.inputSchema.properties, name: NAME_PROP[rest0.name] } } } : rest0;
      if (SHORT[rest.name] !== undefined) return { ...rest, description: SHORT[rest.name] };
      const frag = NAME_FRAGMENT[rest.name];
      if (!frag) return rest;
      assert.equal(rest.description.split(frag[0]).length, 2, `${rest.name}: the fixture holds the anchor once`);
      return { ...rest, description: rest.description.replace(frag[0], () => frag[1]) };
    }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    // tm_post and tm_read (card 126) postdate the fixture; test-bus.mjs holds their schemas.
    assert.equal(golden.length, 33);
    assert.deepEqual(listed.filter((t) => t.name === 'tm_post' || t.name === 'tm_read').map((t) => t.name), ['tm_post', 'tm_read']);
    assert.equal(listed.filter((t) => t.name === 'tm_hold').length, 1);
    const listedOld = listed.filter((t) => t.name !== 'tm_post' && t.name !== 'tm_read' && t.name !== 'tm_hold');
    assert.equal(listed.length, 36);
    assert.deepEqual(listedOld, golden);
  });
});

test('every tool description is at most 400 characters', () => {
  const bad = ALL_TOOLS.filter((t) => t.description.length > 400).map((t) => `${t.name} ${t.description.length}`);
  assert.deepEqual(bad, []);
});

test('driver-visible tool descriptions keep the rules the driver prompt relies on', () => {
  const KEY = {
    team_submit: [/changed_files/, /idempot/i, /no-op|stored verdict/i],
    team_retry: [/subgoal_id/, /node_id/, /budget/i, /unreachable/],
    tm_ask: [/park/i, /end your turn/i, /TeamLeader/i],
    tm_post: [/tm_ask/, /teamleader/, /refused/i],
    tm_read: [/cursor/, /more/, /refused/i],
  };
  for (const [name, res] of Object.entries(KEY)) {
    const d = ALL_TOOLS.find((t) => t.name === name).description;
    for (const re of res) assert.match(d, re, `${name} keeps ${re}`);
  }
});

test('TEAMS_WIKI_OFF=1 in full mode lists 27 tools (team_ + tm_) and a wiki_* call is an error with the exact text', async () => {
  await withClient(['--root', mk('server-wiki-')], baseEnv({ TEAMS_WIKI_OFF: '1' }), async (c) => {
    const tools = await c.tools();
    assert.equal(tools.length, 27);
    assert.equal(withPrefix(tools, 'team_').length, 6);
    assert.equal(withPrefix(tools, 'tm_').length, 21);
    assert.equal(withPrefix(tools, 'wiki_').length, 0);
    const r = await c.call('wiki_status', {});
    assert.equal(r.isError, true);
    assert.equal(r.content[0].text, OFF_TEXT);
  });
});

test('--only wiki lists exactly the 9 wiki_* tools and answers wiki calls; any other name is unknown', async () => {
  const root = mk('server-wiki-');
  await withClient(['--only', 'wiki', '--root', root], baseEnv(), async (c) => {
    const tools = await c.tools();
    assert.equal(tools.length, 9);
    assert.ok(names(tools).every((n) => n.startsWith('wiki_')));
    assert.deepEqual(names(tools).sort(), names(FIXTURE.filter((t) => t.name.startsWith('wiki_'))).sort());
    const w = await c.call('wiki_write', { space: 'notes', slug: 'one', title: 'One', body: 'hello' });
    assert.equal(w.id, 'notes/one');
    const tm = await c.call('tm_board', {});
    assert.equal(tm.isError, true);
    assert.equal(tm.content[0].text, 'unknown tool: tm_board');
  });
});

test('--only wiki with TEAMS_WIKI_OFF=1 lists nothing, a call is an error and no wiki dir is created', async () => {
  const root = mk('server-wiki-');
  await withClient(['--only', 'wiki', '--root', root], baseEnv({ TEAMS_WIKI_OFF: '1' }), async (c) => {
    assert.deepEqual(await c.tools(), []);
    const r = await c.call('wiki_write', { space: 'notes', slug: 'one', title: 'One', body: 'x' });
    assert.equal(r.isError, true);
    assert.equal(r.content[0].text, OFF_TEXT);
    assert.deepEqual(readdirSync(root), []);
  });
});

test('--only with any other value exits 2 with a usage line', () => {
  for (const args of [['--only', 'foo'], ['--only']]) {
    const r = spawnSync(process.execPath, [SERVER, ...args], { encoding: 'utf8', env: baseEnv(), input: '' });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /usage: server\.mjs/);
  }
});

test('a non-empty TEAMS_WIKI_ROOT beats --root, as wiki.mjs had it; an empty one does not', async () => {
  const flag = mk('server-flag-');
  const env1 = mk('server-env-');
  await withClient(['--only', 'wiki', '--root', flag], baseEnv({ TEAMS_WIKI_ROOT: env1 }), async (c) => {
    await c.call('wiki_write', { space: 'notes', slug: 'one', title: 'One', body: 'x' });
  });
  assert.deepEqual(readdirSync(flag), [], '--root stays empty when the env is set');
  assert.ok(readdirSync(env1).length > 0, 'the page landed under TEAMS_WIKI_ROOT');
  const flag2 = mk('server-flag-');
  await withClient(['--only', 'wiki', '--root', flag2], baseEnv({ TEAMS_WIKI_ROOT: '' }), async (c) => {
    await c.call('wiki_write', { space: 'notes', slug: 'one', title: 'One', body: 'x' });
  });
  assert.ok(readdirSync(flag2).length > 0, 'an empty TEAMS_WIKI_ROOT leaves --root in force');
});

test('unknown tool names answer unknown tool: <name>', async () => {
  await withClient([], baseEnv(), async (c) => {
    for (const n of ['nope', 'team_nope', 'tm_nope']) {
      const r = await c.call(n, {});
      assert.equal(r.isError, true, n);
    }
    assert.equal((await c.call('nope', {})).content[0].text, 'unknown tool: nope');
  });
});

test('a tm_* call with a progressToken gets notifications/progress carrying the token before its reply', async () => {
  await withClient([], baseEnv(), async (c) => {
    const call = c.start('tm_board', {}, { progressToken: 'tok-1' });
    await call.reply;
    const progress = c.lines.map((l) => JSON.parse(l)).filter((m) => m.method === 'notifications/progress');
    assert.ok(progress.length >= 1);
    assert.equal(progress[0].params.progressToken, 'tok-1');
    assert.ok(c.index(call.id) > c.lines.findIndex((l) => JSON.parse(l).method === 'notifications/progress'), 'progress first, reply after');
  });
});

test('cancelling an in-flight tm_wait: the reply still arrives, not an error, ping answers after, task.json unchanged', async () => {
  const cwd = repo();
  await withClient([], baseEnv(), async (c) => {
    const task_id = await openTask(c, cwd);
    const taskFile = join(c.env.HARNESS_TASKS_DIR, task_id, 'task.json');
    const { cursor } = await c.call('tm_wait', { task_id, max_ms: 50 });
    const before = readFileSync(taskFile);
    const w = c.start('tm_wait', { task_id, cursor, max_ms: 400 });
    c.cancel(w.id);
    const reply = (await w.reply).result;
    assert.equal(reply.isError, false);
    assert.equal(reply.structuredContent.timed_out, true);
    assert.deepEqual(await c.request('ping'), { jsonrpc: '2.0', id: c.nextId - 1, result: {} });
    assert.ok(readFileSync(taskFile).equals(before), 'the cancel left task.json as it was');
  });
});

test('while tm_wait polls, team_status and wiki_list on the same server answer within 1 s', async () => {
  const cwd = repo();
  await withClient([], baseEnv(), async (c) => {
    const task_id = await openTask(c, cwd);
    const ctlStatus = (await c.start('team_status', {}).reply).result;
    const ctlList = (await c.start('wiki_list', {}).reply).result;
    const { cursor } = await c.call('tm_wait', { task_id, max_ms: 50 });
    const w = c.start('tm_wait', { task_id, cursor, max_ms: 5000 });
    let waitReplied = false;
    w.reply.then(() => { waitReplied = true; });
    await sleep(300);
    for (const [name, ctl] of [['team_status', ctlStatus], ['wiki_list', ctlList]]) {
      const t0 = Date.now();
      const r = (await c.start(name, {}).reply).result;
      assert.ok(Date.now() - t0 < 1000, `${name} took ${Date.now() - t0} ms behind tm_wait`);
      assert.equal(r.isError, ctl.isError, `${name} isError as the control's`);
    }
    assert.equal(waitReplied, false, 'tm_wait was still polling');
    const reply = (await w.reply).result;
    assert.equal(reply.isError, false);
    assert.equal(reply.structuredContent.timed_out, true);
  });
});

test('cancelling tm_wait ends it within one poll interval', async () => {
  const cwd = repo();
  await withClient([], baseEnv(), async (c) => {
    const task_id = await openTask(c, cwd);
    const { cursor } = await c.call('tm_wait', { task_id, max_ms: 50 });
    const w = c.start('tm_wait', { task_id, cursor, max_ms: 10000 });
    await sleep(300);
    const t0 = Date.now();
    c.cancel(w.id);
    const reply = (await w.reply).result;
    assert.ok(Date.now() - t0 < 2500, `tm_wait ended ${Date.now() - t0} ms after the cancel`);
    assert.equal(reply.isError, false);
    const s = reply.structuredContent;
    for (const k of ['state', 'counts', 'cursor', 'timed_out']) assert.ok(k in s, `${k} present`);
  });
});

test('tm_* replies come back in request order when pipelined', async () => {
  const cwd = repo();
  await withClient([], baseEnv(), async (c) => {
    const task_id = await openTask(c, cwd);
    // tm_wait left the serial queue (it runs with ctx, so it can be cancelled), so the head is a serial tm_*.
    const first = c.start('tm_events', { task_id });
    const second = c.start('tm_board', {});
    const third = c.start('wiki_status', {});
    await Promise.all([first.reply, second.reply, third.reply]);
    assert.ok(c.index(first.id) < c.index(second.id) && c.index(second.id) < c.index(third.id), JSON.stringify(c.lines.map((l) => JSON.parse(l).id)));
  });
});

test('cancel after spawn: the tm_run request cancelled leaves the task and its daemon alive and task.json byte-identical', async () => {
  const stubs = mk('server-stub-');
  writeFileSync(join(stubs, 'driver.mjs'), "setTimeout(() => process.exit(0), 120000);\n");
  writeFileSync(join(stubs, 'daemon.mjs'), "setTimeout(() => process.exit(0), 120000);\n");
  const env = baseEnv({
    HARNESS_TEST_NO_DRIVER: undefined,
    HARNESS_CHILD_DRIVER: `node ${join(stubs, 'driver.mjs')}`,
    HARNESS_DAEMON: `node ${join(stubs, 'daemon.mjs')}`,
  });
  const cwd = repo();
  const c = new Client([], env);
  let task_id;
  let daemonPid;
  try {
    await c.init();
    const run = c.start('tm_run', { request: 'server test', cwd, vendor: 'self', brainstorm: false, roles: { qa: false }, size: 'L' });
    c.cancel(run.id);
    const reply = (await run.reply).result;
    assert.equal(reply.isError, false, JSON.stringify(reply.content));
    task_id = reply.structuredContent.task_id;
    const taskFile = join(env.HARNESS_TASKS_DIR, task_id, 'task.json');
    daemonPid = await until(() => JSON.parse(readFileSync(taskFile, 'utf8')).daemon?.pid, 'the daemon pid on task.json');
    assert.ok(alive(daemonPid), 'the daemon is alive after the run');
    const before = readFileSync(taskFile);
    c.cancel(run.id); // the request already finished: a cancel for it must change nothing
    await c.request('ping');
    assert.ok(alive(daemonPid), 'the daemon survives the cancel');
    assert.ok(readFileSync(taskFile).equals(before), 'task.json is byte-identical across the cancel');
  } finally {
    if (task_id) await c.call('tm_cancel', { task_id });
    c.close();
    if (daemonPid) { try { process.kill(daemonPid, 'SIGKILL'); } catch { /* already stopped by tm_cancel */ } }
  }
});

test('stdin closed at once: every reply is written before the exit (drain), exit 0', () => {
  const cwd = repo();
  const input = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'tm_board', arguments: {} } },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'tm_open', arguments: { request: 'drain', cwd, vendor: 'self', brainstorm: false, roles: { qa: false }, size: 'L' } } },
    { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'wiki_status', arguments: {} } },
  ].map((m) => JSON.stringify(m)).join('\n') + '\n';
  const r = spawnSync(process.execPath, [SERVER, '--root', mk('server-wiki-')], { encoding: 'utf8', env: baseEnv(), input });
  assert.equal(r.status, 0, r.stderr);
  const replies = r.stdout.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.deepEqual(replies.map((m) => m.id).sort(), [1, 2, 3, 4]);
  assert.equal(replies.find((m) => m.id === 3).result.isError, false);
});

const DRIVER_SET = ['team_next', 'team_run', 'team_submit', 'team_retry', 'team_status', 'tm_ask', 'tm_post', 'tm_read'];

test('--stage driver lists exactly the 8 driver tools and the 9 wiki_* tools', async () => {
  await withClient(['--stage', 'driver', '--root', mk('server-wiki-')], baseEnv(), async (c) => {
    const tools = await c.tools();
    const got = names(tools);
    assert.equal(got.length, 17);
    assert.deepEqual(got.filter((n) => !n.startsWith('wiki_')).sort(), [...DRIVER_SET].sort());
    assert.equal(withPrefix(tools, 'wiki_').length, 9);
  });
});

test('--stage node lists 12 tools (tm_ask, tm_post, tm_read + 9 wiki_*), 3 with TEAMS_WIKI_OFF=1', async () => {
  await withClient(['--stage', 'node', '--root', mk('server-wiki-')], baseEnv(), async (c) => {
    const tools = await c.tools();
    assert.equal(tools.length, 12);
    assert.deepEqual(tools.filter((t) => !t.name.startsWith('wiki_')).map((t) => t.name).sort(), ['tm_ask', 'tm_post', 'tm_read']);
  });
  await withClient(['--stage', 'node', '--root', mk('server-wiki-')], baseEnv({ TEAMS_WIKI_OFF: '1' }), async (c) => {
    assert.deepEqual(names(await c.tools()).sort(), ['tm_ask', 'tm_post', 'tm_read']);
  });
});

test('no --stage and --stage bogus both list all 36 tools', async () => {
  for (const args of [[], ['--stage', 'bogus']]) {
    await withClient([...args, '--root', mk('server-wiki-')], baseEnv(), async (c) => {
      assert.equal((await c.tools()).length, 36, args.join(' '));
    });
  }
});

test('a --stage node server still answers a call to an unlisted tool (stage node, unlisted tm_status and team_status)', async () => {
  await withClient(['--stage', 'node', '--root', mk('server-wiki-')], baseEnv(), async (c) => {
    for (const n of ['tm_status', 'team_status']) {
      const r = await c.call(n, {});
      const text = r.isError ? r.content[0].text : '';
      assert.ok(!/unknown tool/.test(text), `${n}: ${text}`);
    }
  });
});
