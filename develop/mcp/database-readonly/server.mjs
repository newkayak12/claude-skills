#!/usr/bin/env node
// database-readonly-mcp: read-only database MCP server over stdio.
// stdout carries the MCP protocol only; every log line goes to stderr.
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { readSettings, isDirect, limits, resolveConfig, redactor, USAGE } from './config.mjs';
import { createProfiles, PROFILES } from './profiles.mjs';

const VENDORS = {
  mysql: () => import('./vendors/mysql.mjs'),
};
// Switching INTO these profiles needs the person's confirmation through the client (MCP elicitation).
const CONFIRM_PROFILES = new Set(['prod']);

const log = (...a) => process.stderr.write(`[database-readonly-mcp] ${a.join(' ')}\n`);

const DB_TOOLS = [
  {
    name: 'query',
    description:
      'Run one read-only SQL statement (SELECT, SHOW, DESCRIBE, DESC, EXPLAIN, WITH) on the active profile. ' +
      'Returns rows as JSON, elapsedMs, truncated (true when the row cap cut the result) and profile.',
    inputSchema: { type: 'object', properties: { sql: { type: 'string', description: 'a single SQL statement' } }, required: ['sql'] },
  },
  {
    name: 'list_tables',
    description: 'List tables and views of the active database.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'describe_table',
    description: 'Column details of one table in the active database.',
    inputSchema: { type: 'object', properties: { table: { type: 'string', description: 'table name' } }, required: ['table'] },
  },
];

const PROFILE_TOOLS = [
  {
    name: 'profile',
    description:
      'Without name: list profiles (local, dev, stage, prod), which are logged in, and the active one. ' +
      'With name: switch the active connection to that profile. Switching to prod asks the person to confirm. ' +
      'Logging in is done by the person in a terminal (node cli.mjs login <profile>), never through this tool.',
    inputSchema: { type: 'object', properties: { name: { type: 'string', enum: PROFILES } } },
  },
  {
    name: 'logout',
    description: 'Forget the saved password of a profile (host/user/database stay). Closes its connection if active.',
    inputSchema: { type: 'object', properties: { name: { type: 'string', enum: PROFILES } }, required: ['name'] },
  },
];

// Buffers (BLOB/BINARY) become hex strings instead of {type,data} arrays.
const json = (v) =>
  JSON.stringify(v, (_k, x) => (x && x.type === 'Buffer' && Array.isArray(x.data) ? '0x' + Buffer.from(x.data).toString('hex') : x), 2);
const ok = (v) => ({ content: [{ type: 'text', text: json(v) }] });
const fail = (text) => ({ content: [{ type: 'text', text }], isError: true });

async function openVendor(cfg) {
  const load = VENDORS[cfg.vendor];
  if (!load) throw new Error(`unknown vendor "${cfg.vendor}"; available: ${Object.keys(VENDORS).join(', ')}`);
  const { default: create } = await load();
  return create(cfg);
}

// state: { profile: name|null, db, redact }. profiles: null in direct mode.
export function createServer({ state, profiles, lim }) {
  const server = new Server({ name: 'database-readonly-mcp', version: '0.2.0' }, { capabilities: { tools: {} } });
  const tools = profiles ? [...PROFILE_TOOLS, ...DB_TOOLS] : DB_TOOLS;
  const tag = (v) => (state.profile ? { profile: state.profile, ...v } : v);

  const activeDb = () => {
    if (state.db) return state.db;
    if (state.error) throw new Error(state.error);
    throw new Error(`profile "${state.profile}" is not connected`);
  };

  async function confirmSwitch(name) {
    if (!server.getClientCapabilities()?.elicitation) {
      return `switching to ${name} needs your confirmation, and this client cannot ask for it. ` +
        `Start the server with --profile ${name} instead.`;
    }
    const r = await server.elicitInput({
      message: `Switch the read-only database connection to ${name.toUpperCase()}?`,
      requestedSchema: {
        type: 'object',
        properties: { confirm: { type: 'boolean', title: `Yes, switch to ${name}` } },
        required: ['confirm'],
      },
    });
    if (r.action !== 'accept' || r.content?.confirm !== true) return `switch to ${name} not confirmed (${r.action})`;
    return null;
  }

  async function switchTo(name) {
    const cfg = await profiles.resolve(name, lim);
    const db = await openVendor(cfg);
    const old = state.db;
    Object.assign(state, { profile: name, db, redact: redactor(cfg), error: null });
    await old?.close().catch(() => {});
  }

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args = {} } = req.params;
    try {
      if (profiles && name === 'profile') {
        if (!args.name) return ok({ active: state.profile, connected: !!state.db, profiles: profiles.list() });
        if (!PROFILES.includes(args.name)) return fail(`unknown profile "${args.name}"`);
        if (args.name === state.profile && state.db) return ok({ active: state.profile, changed: false });
        if (CONFIRM_PROFILES.has(args.name)) {
          const denied = await confirmSwitch(args.name);
          if (denied) return fail(denied);
        }
        await switchTo(args.name);
        return ok({ active: state.profile, changed: true });
      }
      if (profiles && name === 'logout') {
        if (!PROFILES.includes(args.name)) return fail(`unknown profile "${args.name}"`);
        const existed = await profiles.logout(args.name);
        if (args.name === state.profile && state.db) {
          await state.db.close().catch(() => {});
          state.db = null;
          state.error = `profile "${args.name}" was logged out; log in again in a terminal: node cli.mjs login ${args.name}`;
        }
        return ok({ profile: args.name, loggedOut: existed });
      }
      if (name === 'query') {
        const db = activeDb();
        const c = db.check(args.sql);
        if (!c.ok) return fail(`rejected [${c.rule}]: ${c.message}`);
        return ok(tag(await db.execute(c.sql)));
      }
      if (name === 'list_tables') return ok(tag(await activeDb().listTables()));
      if (name === 'describe_table') return ok(tag(await activeDb().describeTable(args.table)));
      return fail(`unknown tool: ${name}`);
    } catch (e) {
      return fail(`error: ${state.redact(e.code ? `${e.code}: ${e.message}` : e.message)}`);
    }
  });
  return server;
}

async function main() {
  if (process.argv.includes('--help')) {
    process.stderr.write(USAGE + '\n');
    return;
  }
  let raw, lim;
  try {
    raw = readSettings();
    lim = limits(raw);
  } catch (e) {
    log(`config: ${e.message}`);
    process.stderr.write(USAGE + '\n');
    process.exit(2);
  }
  const state = { profile: null, db: null, redact: (m) => m, error: null };
  let profiles = null;
  if (isDirect(raw)) {
    try {
      const cfg = await resolveConfig();
      state.db = await openVendor(cfg);
      state.redact = redactor(cfg);
    } catch (e) {
      log(`config: ${e.message}`);
      process.exit(2);
    }
  } else {
    profiles = createProfiles();
    const start = raw.profile || 'local';
    if (!PROFILES.includes(start)) {
      log(`unknown profile "${start}"; profiles: ${PROFILES.join(', ')}`);
      process.exit(2);
    }
    state.profile = start;
    try {
      const cfg = await profiles.resolve(start, lim);
      state.db = await openVendor(cfg);
      state.redact = redactor(cfg);
    } catch (e) {
      state.error = e.message; // server still starts; tools report it
    }
  }
  const server = createServer({ state, profiles, lim });
  await server.connect(new StdioServerTransport());
  log(`ready (${profiles ? `profile=${state.profile}${state.db ? '' : ' (not connected)'}` : 'direct'}, maxRows=${lim.maxRows}, maxExecutionMs=${lim.maxExecutionMs})`);
  const shutdown = () => (state.db ? state.db.close() : Promise.resolve()).finally(() => process.exit(0));
  process.stdin.on('close', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

if (process.argv[1]?.endsWith('server.mjs')) {
  main().catch((e) => {
    log(`fatal: ${e.message}`);
    process.exit(1);
  });
}
