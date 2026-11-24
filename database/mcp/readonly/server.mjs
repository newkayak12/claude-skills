#!/usr/bin/env node
// database-readonly-mcp: read-only database MCP server over stdio.
// stdout carries the MCP protocol only; every log line goes to stderr.
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { readSettings, isDirect, limits, resolveConfig, redactor, USAGE } from './config.mjs';
import { createProfiles, PROFILES, passwordDialog } from './profiles.mjs';
import { createAudit } from './audit.mjs';
import { basename, dirname, join } from 'node:path';

const VENDORS = {
  mysql: () => import('./vendors/mysql.mjs'),
  mariadb: () => import('./vendors/mariadb.mjs'),
  postgres: () => import('./vendors/postgres.mjs'),
  oracle: () => import('./vendors/oracle.mjs'),
};
const LABEL = { mysql: 'MySQL', mariadb: 'MariaDB', postgres: 'PostgreSQL', oracle: 'Oracle' };
// Tools that only read: clients may run them without asking.
const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

// prod reads less per call: the row cap and statement timeout never exceed these there.
export const PROD_LIMITS = { maxRows: 200, maxExecutionMs: 10000 };
export const limitsFor = (name, lim) =>
  name === 'prod'
    ? { ...lim, maxRows: Math.min(lim.maxRows, PROD_LIMITS.maxRows), maxExecutionMs: Math.min(lim.maxExecutionMs, PROD_LIMITS.maxExecutionMs) }
    : lim;

// cli.mjs sits beside server.mjs, and one level above the bundle in dist/.
const cliPath = () => {
  const d = dirname(process.argv[1]);
  return join(basename(d) === 'dist' ? dirname(d) : d, 'cli.mjs');
};

const log = (...a) => process.stderr.write(`[database-readonly-mcp] ${a.join(' ')}\n`);

const DB_TOOLS = [
  {
    name: 'query',
    description:
      'Run one read-only SQL statement (SELECT or WITH; also SHOW/DESCRIBE/EXPLAIN on MySQL and MariaDB, ' +
      'SHOW/EXPLAIN/TABLE/VALUES on PostgreSQL) on the active profile. ' +
      'Optimizer hints (/*+ ... */) are refused: send the query without them. ' +
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
// vendor: this server's database kind; every tool description starts with it so a client running one
// server per vendor can tell them apart.
export function createServer({ state, profiles, lim, vendor = 'mysql', dialog = passwordDialog, audit = () => {} }) {
  const server = new Server({ name: `database-readonly-${vendor}`, version: '0.3.0' }, { capabilities: { tools: {} } });
  const tools = (profiles ? [...PROFILE_TOOLS, ...DB_TOOLS] : DB_TOOLS).map((t) => ({ ...t, description: `${LABEL[vendor]}: ${t.description}` }));
  const tag = (v) => (state.profile ? { profile: state.profile, ...v } : v);

  const activeDb = () => {
    if (state.db) return state.db;
    if (state.error) throw new Error(state.error);
    throw new Error(`profile "${state.profile}" is not connected`);
  };

  async function switchTo(name) {
    const cfg = await profiles.resolve(name, limitsFor(name, lim));
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
        const { maxRows, maxExecutionMs } = limitsFor(args.name, lim);
        return ok({ active: state.profile, changed: true, limits: { maxRows, maxExecutionMs } });
      }
      if (profiles && name === 'login') {
        if (!PROFILES.includes(args.name)) return fail(`unknown profile "${args.name}"`);
        const prev = profiles.get(args.name) ?? {};
        const fields = {
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
        else return fail(`no password dialog on this OS; the person runs in a terminal: node ${cliPath()} login ${args.name} --vendor ${vendor}`);
        const entry = await profiles.login(args.name, fields, auth);
        let connection = 'ok';
        let cfg;
        try {
          cfg = await profiles.resolve(args.name, { maxRows: 1, maxExecutionMs: 10000 });
          const db = await openVendor(cfg);
          try {
            await db.ping();
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
      if (name === 'query' || name === 'list_tables' || name === 'describe_table') {
        const entry = { profile: state.profile ?? 'direct', tool: name };
        if (name === 'query') entry.sql = args.sql;
        if (name === 'describe_table') entry.table = args.table;
        try {
          const db = activeDb();
          let r;
          if (name === 'query') {
            const c = db.check(args.sql);
            if (!c.ok) {
              audit({ ...entry, rejected: c.rule });
              return fail(`rejected [${c.rule}]: ${c.message}`);
            }
            r = await db.execute(c.sql);
          } else r = name === 'list_tables' ? await db.listTables() : await db.describeTable(args.table);
          audit({
            ...entry,
            rows: r.rowCount ?? r.columns.length,
            ...(r.truncated ? { truncated: true } : {}),
            ...(r.hidden ? { hidden: r.hidden.length } : {}),
            ...(r.elapsedMs !== undefined ? { elapsedMs: r.elapsedMs } : {}),
          });
          return ok(tag(r));
        } catch (e) {
          audit({ ...entry, error: e.code ?? 'error' });
          throw e;
        }
      }
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
  const vendor = raw.vendor || 'mysql';
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
    profiles = createProfiles({ vendor });
    const start = raw.profile || 'local';
    if (!PROFILES.includes(start)) {
      log(`unknown profile "${start}"; profiles: ${PROFILES.join(', ')}`);
      process.exit(2);
    }
    state.profile = start;
    try {
      const cfg = await profiles.resolve(start, limitsFor(start, lim));
      state.db = await openVendor(cfg);
      state.redact = redactor(cfg);
    } catch (e) {
      state.error = e.message; // server still starts; tools report it
    }
  }
  const audit = createAudit({ onError: (e) => log(`query log: ${e.message}`) });
  const server = createServer({ state, profiles, lim, vendor, audit: (e) => audit({ vendor, ...e }) });
  await server.connect(new StdioServerTransport());
  log(`ready (${vendor}, ${profiles ? `profile=${state.profile}${state.db ? '' : ' (not connected)'}` : 'direct'}, maxRows=${lim.maxRows}, maxExecutionMs=${lim.maxExecutionMs})`);
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
