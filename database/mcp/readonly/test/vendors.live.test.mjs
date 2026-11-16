// Live tests for any vendor, against the throwaway seeded database live/docker.mjs starts.
// Skipped unless DBRO_LIVE_VENDOR is set. Never point this at a shared or production database.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { resolveConfig } from '../config.mjs';
import { createProfiles, configDir, fileStore } from '../profiles.mjs';

const vendor = process.env.DBRO_LIVE_VENDOR;
const opts = { skip: !vendor && 'DBRO_LIVE_VENDOR not set (npm run test:docker)' };
const SERVER = fileURLToPath(new URL(`../${process.env.DBRO_SERVER || 'server.mjs'}`, import.meta.url));
const DUAL = vendor === 'oracle' ? ' FROM dual' : '';
// The error each vendor raises for a write inside a read-only transaction.
const READ_ONLY_ERROR = { mysql: (e) => e.errno === 1792, mariadb: (e) => e.errno === 1792, postgres: (e) => e.code === '25006', oracle: (e) => e.errorNum === 1456 };
const lower = (a) => (a ?? []).map((s) => s.toLowerCase());

let cfg, create, client;

before(async () => {
  if (!vendor) return;
  cfg = await resolveConfig(['--vendor', vendor]);
  ({ default: create } = await import(`../vendors/${vendor}.mjs`));
  client = new Client({ name: 'vendors-live', version: '0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [SERVER, '--vendor', vendor], env: { ...process.env }, stderr: 'ignore' }));
});
after(async () => client?.close());

const call = async (name, args = {}, c = client) => {
  const r = await c.callTool({ name, arguments: args });
  const text = r.content[0].text;
  return { isError: !!r.isError, text, data: r.isError ? null : JSON.parse(text) };
};

test('MCP: tools, a plain read, list_tables and describe_table', opts, async (t) => {
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((x) => x.name).sort(), ['describe_table', 'list_tables', 'query']);
  const one = await call('query', { sql: `SELECT 1 AS one${DUAL}` });
  assert.equal(one.isError, false, one.text);
  assert.equal(Number(Object.values(one.data.rows[0])[0]), 1);
  const lt = await call('list_tables');
  assert.equal(lt.isError, false, lt.text);
  assert.ok(lt.data.rows.some((r) => r.name.toLowerCase() === 'orders'), lt.text);
  const desc = await call('describe_table', { table: 'orders' });
  assert.equal(desc.isError, false, desc.text);
  assert.deepEqual(lower(desc.data.columns.map((c) => c.name)), ['id', 'order_nm', 'recv_hp', 'shop_cd', 'reg_date']);
  t.diagnostic(`${vendor}: SELECT 1 ok; list_tables ${lt.data.rowCount}; describe orders -> ${desc.data.columns.map((c) => `${c.name} ${c.type}`).join(', ')}`);
});

test('MCP: personal data hidden — alias, *, and a count beside a personal WHERE', opts, async (t) => {
  const r = await call('query', { sql: 'SELECT id, order_nm AS who, recv_hp, shop_cd FROM orders ORDER BY id' });
  assert.equal(r.isError, false, r.text);
  assert.deepEqual(lower(r.data.columns), ['id', 'shop_cd']);
  assert.deepEqual(lower(r.data.hidden), ['who', 'recv_hp']);
  assert.equal(r.data.rowCount, 2);
  const all = await call('query', { sql: 'SELECT * FROM orders' });
  assert.deepEqual(lower(all.data.hidden), ['order_nm', 'recv_hp']);
  const n = await call('query', { sql: 'SELECT COUNT(*) AS n FROM orders WHERE recv_hp IS NOT NULL' });
  assert.equal(n.data.hidden, undefined, n.text);
  assert.equal(Number(Object.values(n.data.rows[0])[0]), 2);
  t.diagnostic(`${vendor}: alias hidden=${r.data.hidden}; * hidden=${all.data.hidden}; count shown=${JSON.stringify(n.data.rows[0])}`);
});

test('MCP: writes rejected by the statement check', opts, async (t) => {
  for (const sql of ['DELETE FROM orders', 'UPDATE orders SET shop_cd = 1', 'DROP TABLE orders', `SELECT 1${DUAL}; DELETE FROM orders`]) {
    const r = await call('query', { sql });
    assert.equal(r.isError, true, sql);
    t.diagnostic(`${sql} -> ${r.text}`);
  }
});

test('check bypassed: the database refuses writes in the read-only transaction (no rows touched)', opts, async (t) => {
  const db = create({ ...cfg });
  try {
    for (const sql of ['DELETE FROM orders WHERE 1=0', 'UPDATE orders SET shop_cd = shop_cd WHERE 1=0', 'INSERT INTO orders (id) SELECT id FROM orders WHERE 1=0']) {
      await assert.rejects(db.execute(sql), (e) => {
        t.diagnostic(`${sql} -> ${e.code ?? ''} ${e.errno ?? e.errorNum ?? ''} ${String(e.message).split('\n')[0]}`);
        return READ_ONLY_ERROR[vendor](e);
      });
    }
    const after = await db.execute('SELECT COUNT(*) AS n FROM orders');
    assert.equal(Number(Object.values(after.rows[0])[0]), 2);
  } finally {
    await db.close();
  }
});

test('row cap: truncated true, and the next read on the pool works', opts, async () => {
  const db = create({ ...cfg, maxRows: 1 });
  try {
    const r = await db.execute('SELECT id FROM orders ORDER BY id');
    assert.equal(r.truncated, true);
    assert.equal(r.rowCount, 1);
    const next = await db.execute(`SELECT 2 AS two${DUAL}`);
    assert.equal(Number(Object.values(next.rows[0])[0]), 2);
  } finally {
    await db.close();
  }
});

test('statement timeout stops a long statement (not MySQL: its SLEEP returns 1 when cut)', { skip: opts.skip || (vendor === 'mysql' && 'mysql sleep is not an error') }, async (t) => {
  const db = create({ ...cfg, maxExecutionMs: 500 });
  const sleep = {
    mariadb: 'SELECT SLEEP(3)',
    postgres: 'SELECT pg_sleep(3)',
    oracle: 'SELECT COUNT(*) FROM all_objects a, all_objects b, all_objects c', // runs for minutes
  }[vendor];
  // The error each vendor raises when its statement timeout cuts a statement.
  const timedOut = {
    mariadb: (e) => e.errno === 1969,
    postgres: (e) => e.code === '57014',
    oracle: (e) => /NJS-123|DPY-4024|call timeout/i.test(e.message),
  }[vendor];
  try {
    const started = Date.now();
    await assert.rejects(db.execute(sleep), (e) => {
      t.diagnostic(`${sleep} with 500 ms limit -> ${e.code ?? e.errorNum ?? ''} ${String(e.message).split('\n')[0]} after ${Date.now() - started} ms`);
      return timedOut(e);
    });
    assert.ok(Date.now() - started < 2500);
    assert.ok(Date.now() - started >= 400, 'stopped by the timeout, not by an early error');
    const next = await db.execute(`SELECT 3 AS three${DUAL}`);
    assert.equal(Number(Object.values(next.rows[0])[0]), 3);
  } finally {
    await db.close();
  }
});

test('profile mode: saved dev login on this vendor, switch, query tagged with the profile', opts, async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'dbro-vlive-'));
  const env = { ...process.env, DBRO_CONFIG_DIR: dir, DBRO_SECRETS: 'file' };
  for (const k of ['DB_HOST', 'DB_USER', 'DB_NAME', 'DB_PASS', 'DB_PORT', 'DB_VENDOR', 'MYSQL_HOST', 'MYSQL_USER', 'MYSQL_DB', 'MYSQL_PASS', 'MYSQL_PORT']) delete env[k];
  const pdir = configDir(env, vendor);
  await createProfiles({ vendor, dir: pdir, secrets: fileStore(pdir) }).login(
    'dev', { host: cfg.host, port: cfg.port, user: cfg.user, database: cfg.database }, { store: cfg.password },
  );
  const pc = new Client({ name: 'vendors-live-profile', version: '0' });
  await pc.connect(new StdioClientTransport({ command: process.execPath, args: [SERVER, '--vendor', vendor], env, stderr: 'ignore' }));
  try {
    const sw = await call('profile', { name: 'dev' }, pc);
    assert.equal(sw.isError, false, sw.text);
    const r = await call('query', { sql: 'SELECT id FROM orders ORDER BY id' }, pc);
    assert.equal(r.data.profile, 'dev');
    assert.equal(r.data.rowCount, 2);
    const prod = await call('login', { name: 'stage', host: cfg.host, port: cfg.port, user: cfg.user, database: cfg.database, no_password: true }, pc);
    t.diagnostic(`profile dev -> ${sw.text.replace(/\s+/g, ' ')}; query profile=${r.data.profile} rows=${r.data.rowCount}; login without password -> ${prod.text.replace(/\s+/g, ' ').slice(0, 160)}`);
  } finally {
    await pc.close();
  }
});
