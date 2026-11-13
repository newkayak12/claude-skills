#!/usr/bin/env node
// database-readonly-mcp: read-only database MCP server over stdio.
// stdout carries the MCP protocol only; every log line goes to stderr.
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { readSettings, isDirect, limits, resolveConfig, redactor, USAGE } from './config.mjs';
import { createProfiles, PROFILES, passwordDialog } from './profiles.mjs';

const VENDORS = {
  mysql: () => import('./vendors/mysql.mjs'),
};
// Tools that only read: clients may run them without asking.
const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

const log = (...a) => process.stderr.write(`[database-readonly-mcp] ${a.join(' ')}\n`);

const DB_TOOLS = [
  {
    name: 'query',
    description:
      'Run one read-only SQL statement (SELECT, SHOW, DESCRIBE, DESC, EXPLAIN, WITH) on the active profile. ' +
      'Returns rows as JSON, elapsedMs, truncated (true when the row cap cut the result) and profile.',
    annotations: READ_ONLY,
    inputSchema: { type: 'object', properties: { sql: { type: 'string', description: 'a single SQL statement' } }, required: ['sql'] },
  },
  {
    name: 'list_tables',
    description: 'List tables and views of the active database.',
    annotations: READ_ONLY,
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'describe_table',
    description: 'Column details of one table in the active database.',
    annotations: READ_ONLY,
    inputSchema: { type: 'object', properties: { table: { type: 'string', description: 'table name' } }, required: ['table'] },
  },
];

const PROFILE_TOOLS = [
  {
    name: 'profile',
    description:
      'Without name: list profiles (local, dev, stage, prod), which are logged in, and the active one. ' +
      'With name: switch the active connection to that profile (every connection is read-only).',
    annotations: READ_ONLY,
    inputSchema: { type: 'object', properties: { name: { type: 'string', enum: PROFILES } } },
  },
  {
    name: 'login',
    description:
      'Save a profile login and test it. host/port/user/database come from the arguments (omitted ones keep the saved ' +
      'values). The password is never an argument: on macOS the server opens a hidden password dialog for the person ' +
      'and stores the answer in Keychain. Optional: op_ref (a 1Password op:// reference) instead of the dialog, or ' +
      'no_password for an account without one. Does not switch the active profile.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', enum: PROFILES },
        host: { type: 'string' },
        port: { type: 'integer' },
        user: { type: 'string' },
        database: { type: 'string' },
        op_ref: { type: 'string', description: 'op://vault/item/field — read from 1Password instead of the dialog' },
        no_password: { type: 'boolean' },
      },
      required: ['name'],
    },
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
export function createServer({ state, profiles, lim, dialog = passwordDialog }) {
  const server = new Server({ name: 'database-readonly-mcp', version: '0.2.0' }, { capabilities: { tools: {} } });
  const tools = profiles ? [...PROFILE_TOOLS, ...DB_TOOLS] : DB_TOOLS;
  const tag = (v) => (state.profile ? { profile: state.profile, ...v } : v);

  const activeDb = () => {
    if (state.db) return state.db;
    if (state.error) throw new Error(state.error);
    throw new Error(`profile "${state.profile}" is not connected`);
  };

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
        await switchTo(args.name);
        return ok({ active: state.profile, changed: true });
      }
      if (profiles && name === 'login') {
        if (!PROFILES.includes(args.name)) return fail(`unknown profile "${args.name}"`);
        const prev = profiles.get(args.name) ?? {};
        const fields = {
          vendor: prev.vendor ?? 'mysql',
          host: args.host ?? prev.host,
          port: args.port ?? prev.port,
          user: args.user ?? prev.user,
          database: args.database ?? prev.database,
        };
        const missing = ['host', 'user', 'database'].filter((k) => !fields[k]);
        if (missing.length) return fail(`login ${args.name}: missing ${missing.join(', ')} (no saved value)`);
        let auth;
        if (args.op_ref) auth = { op: args.op_ref };
        else if (args.no_password) auth = { none: true };
        else if (process.platform === 'darwin') auth = { store: await dialog(args.name) };
        else return fail(`no password dialog on this OS; the person runs in a terminal: node ${process.argv[1].replace(/server\.mjs$/, 'cli.mjs')} login ${args.name}`);
        const entry = await profiles.login(args.name, fields, auth);
        let connection = 'ok';
        let cfg;
        try {
          cfg = await profiles.resolve(args.name, { maxRows: 1, maxExecutionMs: 10000 });
          const db = await openVendor(cfg);
          try {
            await db.execute('SELECT 1');
          } finally {
            await db.close();
          }
        } catch (e) {
          const msg = e.code ? `${e.code}: ${e.message}` : e.message;
          connection = `failed: ${cfg ? redactor(cfg)(msg) : msg}`;
        }
        if (connection === 'ok' && args.name === state.profile) await switchTo(args.name);
        return ok({ profile: args.name, saved: true, password: entry.auth, connection, active: state.profile });
      }
      if (profiles && name === 'logout') {
        if (!PROFILES.includes(args.name)) return fail(`unknown profile "${args.name}"`);
        const existed = await profiles.logout(args.name);
        if (args.name === state.profile && state.db) {
          await state.db.close().catch(() => {});
          state.db = null;
          state.error = `profile "${args.name}" was logged out; log in again with the login tool`;
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

export async function main() {
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
