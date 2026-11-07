#!/usr/bin/env node
// No teams path starts a viewer server (card 125 F1). Runtime: tm_open, tm_run and tm_status on a
// scratch tasks root leave no view.mjs process without --once, no <root>/.view.json, and no new
// listener on 7431. Static: no non-test file under mcp, hooks, scripts imports node:http
// createServer or listens on TCP, and every view.mjs spawn carries --once (mcp/stateserver.mjs,
// a Unix-socket listener, is the one allowance). The detector is itself tested on samples.
//
//   node --test teams/scripts/test-no-viewer-server.mjs
process.env.TEAMS_RUNS_DIR ??= 'off';
process.env.HARNESS_TEST_RUNNER_PID = String(process.pid);
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, statSync, existsSync, rmSync } from 'node:fs';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const TEAMS = join(HERE, '..');
const SERVER = join(TEAMS, 'mcp', 'server.mjs');
const VIEW = join(HERE, 'view.mjs');
const ALLOWED = new Set(['mcp/stateserver.mjs']);
const OLD_PORT = 7431;

// ---- detector ----

const SPAWN_CALL = /\b(spawn|spawnSync|execFile|execFileSync|fork|exec|execSync|run)\s*\(/;

// Violations in one source text: a TCP server, or a view.mjs spawn without --once.
export function violations(src, name = 'sample') {
  const out = [];
  const lines = src.split('\n');
  const importsServer = /\bcreateServer\b/.test(src) && /node:(http|https|net)|require\(['"](http|https|net)['"]\)/.test(src);
  lines.forEach((line, i) => {
    if (/^\s*(\/\/|\*)/.test(line)) return;
    if (importsServer && /\.listen\(\s*(\d+|port\b|[A-Za-z_.]*PORT\b|\{\s*port)/i.test(line)) out.push(`${name}:${i + 1} listens on a TCP port`);
    if (importsServer && /\bcreateServer\s*\(/.test(line) && /\.listen\(/.test(line) && !/\.listen\(\s*['"`/]|sock/i.test(line)) out.push(`${name}:${i + 1} createServer(...).listen(...) on a non-socket target`);
    if (SPAWN_CALL.test(line) && /view\.mjs|\bVIEW\b/.test(line) && !/--once/.test(line)) out.push(`${name}:${i + 1} spawns view.mjs without --once`);
  });
  return [...new Set(out)];
}

function sourceFiles(dir, acc = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) {
      if (e === 'node_modules' || e === 'bench' || e === 'fixtures') continue;
      sourceFiles(p, acc);
    } else if (/\.(mjs|js|ts|tsx)$/.test(e) && !/^test-|\.test\./.test(e)) acc.push(p);
  }
  return acc;
}

test('detector: a view.mjs spawn without --once is a violation', () => {
  assert.ok(violations("spawn('node', [join(HERE, 'view.mjs'), '--tasks-dir', d])").length >= 1);
  assert.ok(violations("await $.process.run(['node', VIEW, ...args])").length >= 1);
});

test('detector: createServer(...).listen(7431) is a violation', () => {
  const sample = "import { createServer } from 'node:http';\ncreateServer((q, r) => r.end()).listen(7431);\n";
  assert.ok(violations(sample).length >= 1);
});

test('detector: a --once spawn and a Unix-socket listener are not violations', () => {
  assert.deepEqual(violations("await $.process.run(['node', VIEW, '--once', ...args])"), []);
  assert.deepEqual(violations("import { createServer } from 'node:http';\nconst s = createServer(h);\ns.listen(paths.sock, ready);\n"), []);
});

// ---- static ----

test('static: no non-test file under mcp, hooks, scripts serves TCP or spawns view.mjs without --once', () => {
  const files = ['mcp', 'hooks', 'scripts'].flatMap((d) => sourceFiles(join(TEAMS, d)));
  assert.ok(files.length > 20, `scanned ${files.length} files`);
  const found = [];
  for (const f of files) {
    const rel = relative(TEAMS, f);
    if (ALLOWED.has(rel)) continue;
    found.push(...violations(readFileSync(f, 'utf8'), rel));
  }
  assert.deepEqual(found, []);
  assert.ok(files.some((f) => relative(TEAMS, f) === 'mcp/stateserver.mjs'), 'the named allowance exists');
});

// ---- view.mjs CLI ----

function runView(args, env = {}) {
  return spawnSync('node', [VIEW, ...args], { encoding: 'utf8', env: { ...process.env, ...env }, timeout: 30000 });
}

test('view.mjs: a bare run prints usage and exits 1, --help exits 0', () => {
  const root = mkdtempSync(join(tmpdir(), 'nvs-root-'));
  try {
    const bare = runView(['--tasks-dir', root]);
    assert.equal(bare.status, 1);
    assert.match(bare.stderr, /^usage: node view\.mjs --once/);
    const help = runView(['--help']);
    assert.equal(help.status, 0);
    assert.match(help.stdout, /--format/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('view.mjs --once ignores --port and TEAMS_VIEW*', () => {
  const root = mkdtempSync(join(tmpdir(), 'nvs-root-'));
  try {
    const plain = runView(['--once', '--tasks-dir', root]);
    assert.equal(plain.status, 0);
    const port = runView(['--once', '--tasks-dir', root, '--port', '0']);
    const env = runView(['--once', '--tasks-dir', root], { TEAMS_VIEW: '1', TEAMS_VIEW_PORT: '9', TEAMS_VIEW_IDLE_MS: '1' });
    for (const r of [port, env]) {
      assert.equal(r.status, 0);
      assert.equal(r.stdout, plain.stdout);
      assert.equal(r.stderr, '');
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// ---- runtime ----

function listening(port) {
  return new Promise((resolve) => {
    const s = connect({ port, host: '127.0.0.1' });
    s.once('connect', () => { s.destroy(); resolve(true); });
    s.once('error', () => resolve(false));
  });
}

class Client {
  constructor(env) {
    this.proc = spawn('node', [SERVER], { stdio: ['pipe', 'pipe', 'inherit'], env: { ...process.env, ...env } });
    this.buf = '';
    this.id = 0;
    this.queue = [];
    this.proc.stdout.setEncoding('utf8');
    this.proc.stdout.on('data', (chunk) => {
      this.buf += chunk;
      let nl;
      while ((nl = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, nl);
        this.buf = this.buf.slice(nl + 1);
        if (line.trim()) this.queue.shift()(JSON.parse(line));
      }
    });
  }
  send(method, params) {
    return new Promise((resolve) => {
      this.queue.push(resolve);
      this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: ++this.id, method, params }) + '\n');
    });
  }
  async init() {
    await this.send('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
    return this;
  }
  async call(name, args) {
    const r = (await this.send('tools/call', { name, arguments: args })).result || {};
    if (r.isError) return { error: r.content[0].text };
    return r.structuredContent;
  }
  close() { this.proc.stdin.end(); this.proc.kill(); }
}

// view.mjs processes of this scratch root that run without --once.
function strayViewers(root) {
  const ps = spawnSync('ps', ['-axo', 'pid,command'], { encoding: 'utf8' }).stdout.split('\n');
  return ps.filter((l) => l.includes('view.mjs') && l.includes(root) && !/ --once\b/.test(l));
}

test('runtime: tm_open, tm_run, tm_status start no viewer server', async (t) => {
  const heldBefore = await listening(OLD_PORT);
  if (heldBefore) t.diagnostic(`port ${OLD_PORT} already held by a foreign process: the listener probe is skipped`);
  const cwd = mkdtempSync(join(tmpdir(), 'nvs-repo-'));
  const git = (...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });
  git('init', '-q');
  git('config', 'user.email', 't@t');
  git('config', 'user.name', 't');
  writeFileSync(join(cwd, 'a.txt'), 'x\n');
  git('add', '.');
  git('commit', '-q', '-m', 'init');
  const root = mkdtempSync(join(tmpdir(), 'nvs-root-'));
  const env = { HARNESS_TASKS_DIR: root, HARNESS_TEST_NO_DRIVER: '1' };
  delete env.TEAMS_VIEW;
  const tm = await new Client(env).init();
  try {
    const base = { cwd, vendor: 'self', roles: { qa: false }, brainstorm: false };
    const open = await tm.call('tm_open', { ...base, request: 'r' });
    assert.ok(open.task_id, `tm_open returned a task: ${JSON.stringify(open).slice(0, 200)}`);
    const run = await tm.call('tm_run', { ...base, request: 'rr' });
    assert.ok(run.task_id, 'tm_run returned a task');
    const st = await tm.call('tm_status', { task_id: open.task_id });
    assert.ok(st.state || st.task_id, 'tm_status answered');
    await new Promise((r) => setTimeout(r, 1500));
    assert.deepEqual(strayViewers(root), [], 'no view.mjs without --once for this tasks dir');
    assert.equal(existsSync(join(root, '.view.json')), false, 'no .view.json written');
    if (!heldBefore) assert.equal(await listening(OLD_PORT), false, `${OLD_PORT} not newly listening`);
  } finally {
    tm.close();
    rmSync(cwd, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});
