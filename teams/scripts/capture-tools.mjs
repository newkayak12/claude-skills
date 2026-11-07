// teams/scripts/capture-tools.mjs - records the tools the teams MCP server (mcp/server.mjs) exposes
// as a golden-shaped list (fixtures/tools-before.json holds the pre-merge capture, whose entries
// carry a `server` key this list has not). Spawned over stdio (initialize, then tools/list);
// nothing in teams/mcp is touched. Usage: node teams/scripts/capture-tools.mjs [--out <file>]
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isEntryPoint } from '../mcp/pluginroots.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const MCP = resolve(HERE, '..', 'mcp');
export const DEFAULT_OUT = join(HERE, 'fixtures', 'tools-before.json');
const TIMEOUT_MS = 30000;
const EXPECTED_PREFIXES = { team_: 6, tm_: 18, wiki_: 9 };

// Recursively sorts object keys; arrays keep their order; primitives and null pass through.
export function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (value !== null && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value).sort()) out[k] = normalize(value[k]);
    return out;
  }
  return value;
}

// Spawns one server, sends initialize then tools/list, returns the tools array. The child is
// killed on every path; a silent child is cut off after TIMEOUT_MS.
function listTools(label, args, env) {
  return new Promise((resolveTools, reject) => {
    const proc = spawn('node', args, { stdio: ['pipe', 'pipe', 'inherit'], env });
    let buf = '';
    let done = false;
    const pending = new Map();
    const finish = (err, tools) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      proc.kill('SIGKILL');
      if (err) reject(err); else resolveTools(tools);
    };
    const timer = setTimeout(() => finish(new Error(`${label}: no reply within ${TIMEOUT_MS} ms`)), TIMEOUT_MS);
    proc.on('error', (e) => finish(new Error(`${label}: ${e.message}`)));
    proc.on('exit', (code) => finish(new Error(`${label}: exited (${code}) before answering`)));
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (chunk) => {
      buf += chunk;
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (!line.trim()) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { finish(new Error(`${label}: non-JSON line on stdout`)); return; }
        const cb = pending.get(msg.id);
        if (cb) { pending.delete(msg.id); cb(msg); }
      }
    });
    let id = 0;
    const send = (method, params) => new Promise((res) => {
      pending.set(++id, res);
      proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
    (async () => {
      const init = await send('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'capture-tools', version: '1' } });
      if (init.error) throw new Error(`${label}: initialize failed: ${JSON.stringify(init.error)}`);
      const list = await send('tools/list', {});
      if (list.error || !list.result || !Array.isArray(list.result.tools)) throw new Error(`${label}: tools/list failed: ${JSON.stringify(list.error || list.result)}`);
      return list.result.tools;
    })().then((tools) => finish(null, tools), (e) => finish(e));
  });
}

// Returns the normalised, name-sorted entry array of the one server. Throws on any failure
// or when the 6/18/9 split is not met; every tmpdir it made is removed either way.
export async function captureTools() {
  const dirs = [];
  const mk = (prefix) => { const d = mkdtempSync(join(tmpdir(), prefix)); dirs.push(d); return d; };
  try {
    const env = { ...process.env, HARNESS_TASKS_DIR: mk('capture-tasks-'), HARNESS_TEST_NO_DRIVER: '1' };
    delete env.TEAMS_WIKI_ROOT;
    delete env.TEAMS_WIKI_OFF;
    const entries = [];
    for (const t of await listTools('teams', [join(MCP, 'server.mjs'), '--root', mk('capture-wiki-')], env)) {
      entries.push(normalize({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
        outputSchema: t.outputSchema === undefined ? null : t.outputSchema,
      }));
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    const want = Object.entries(EXPECTED_PREFIXES);
    const total = want.reduce((n, [, c]) => n + c, 0);
    const got = want.map(([p]) => entries.filter((e) => e.name.startsWith(p)).length);
    if (entries.length !== total || want.some(([, c], i) => got[i] !== c)) {
      throw new Error(`expected ${total} tools (${want.map(([p, c]) => `${c} ${p}*`).join(', ')}), got ${entries.length} (${want.map(([p], i) => `${got[i]} ${p}*`).join(', ')})`);
    }
    return entries;
  } finally {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  }
}

async function main() {
  const argv = process.argv.slice(2);
  let out = DEFAULT_OUT;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out' && argv[i + 1]) out = resolve(argv[++i]);
    else { console.error(`usage: capture-tools.mjs [--out <file>]`); process.exit(2); }
  }
  try {
    const entries = await captureTools();
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(entries, null, 2) + '\n');
    console.log(`${entries.length} tools -> ${out}`);
  } catch (e) {
    console.error(`capture-tools: ${e.message}`);
    process.exit(1);
  }
}

if (isEntryPoint(import.meta.url)) main();
