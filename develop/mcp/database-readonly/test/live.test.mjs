// Live tests against a DEV database. Skipped unless MYSQL_HOST is set. Never point this at production.
// Run: op run --env-file .env.dev -- node --test test/live.test.mjs   (.env.dev is gitignored)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { resolveConfig, redactor } from '../config.mjs';
import createMysql from '../vendors/mysql.mjs';

const live = !!process.env.MYSQL_HOST;
const opts = { skip: !live && 'MYSQL_HOST not set' };
let cfg, redact, db, client, table, column;

before(async () => {
  if (!live) return;
  cfg = await resolveConfig([]);
  redact = redactor(cfg);
  db = createMysql(cfg);
  client = new Client({ name: 'live-test', version: '0' });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [fileURLToPath(new URL('../server.mjs', import.meta.url))],
      env: { ...process.env },
      stderr: 'ignore',
    }),
  );
});

after(async () => {
  await client?.close();
  await db?.close();
});

const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  const text = r.content[0].text;
  return { isError: !!r.isError, text, data: r.isError ? null : JSON.parse(text) };
};

test('MCP: SELECT 1, SHOW TABLES, plain SELECT succeed', opts, async (t) => {
  const tools = (await client.listTools()).tools.map((x) => x.name).sort();
  assert.deepEqual(tools, ['describe_table', 'list_tables', 'query']);
  const one = await call('query', { sql: 'SELECT 1 AS one' });
  assert.equal(one.isError, false, one.text);
  assert.deepEqual(one.data.rows, [{ one: 1 }]);
  assert.equal(one.data.truncated, false);
  t.diagnostic(`SELECT 1 -> rows=${JSON.stringify(one.data.rows)} elapsedMs=${one.data.elapsedMs} truncated=${one.data.truncated}`);
  const show = await call('query', { sql: 'SHOW TABLES' });
  assert.equal(show.isError, false, show.text);
  t.diagnostic(`SHOW TABLES -> ${show.data.rowCount} rows`);
  const lt = await call('list_tables');
  assert.equal(lt.isError, false, lt.text);
  table = lt.data.rows.find((r) => r.type === 'BASE TABLE')?.name;
  assert.ok(table, 'dev DB has at least one base table');
  const plain = await call('query', { sql: `SELECT * FROM \`${table}\` LIMIT 3` });
  assert.equal(plain.isError, false, plain.text);
  t.diagnostic(`list_tables -> ${lt.data.rowCount} tables; SELECT * FROM <table> LIMIT 3 -> ${plain.data.rowCount} rows`);
  const desc = await call('describe_table', { table });
  assert.equal(desc.isError, false, desc.text);
  column = desc.data.columns[0].name;
  t.diagnostic(`describe_table -> ${desc.data.columns.length} columns`);
  const bad = await call('describe_table', { table: 'x; DROP TABLE y' });
  assert.equal(bad.isError, true);
  t.diagnostic(`describe_table('x; DROP TABLE y') -> ${bad.text}`);
});

test('MCP: writes and SET rejected by the whitelist; multi-statement rejected', opts, async (t) => {
  for (const sql of [
    'INSERT INTO t VALUES (1)',
    'UPDATE t SET a = 1',
    'DELETE FROM t',
    'DROP TABLE t',
    'SET SESSION TRANSACTION READ WRITE',
    'SELECT 1; DELETE FROM t',
  ]) {
    const r = await call('query', { sql });
    assert.equal(r.isError, true, sql);
    t.diagnostic(`${sql} -> ${r.text}`);
  }
});

test('check bypassed: MySQL blocks writes with read-only transaction error (no rows touched)', opts, async (t) => {
  assert.ok(table && column);
  // WHERE 1=0: even if read-only failed, nothing would change.
  for (const sql of [
    `DELETE FROM \`${table}\` WHERE 1=0`,
    `UPDATE \`${table}\` SET \`${column}\` = \`${column}\` WHERE 1=0`,
  ]) {
    await assert.rejects(db.execute(sql), (e) => {
      t.diagnostic(`${sql.replace(table, '<table>').replaceAll(column, '<col>')} -> ${e.code} (${e.errno}): ${redact(e.message)}`);
      return e.errno === 1792;
    });
  }
  // DDL on a table that does not exist: record what MySQL does (informational).
  try {
    await db.execute('DROP TABLE IF EXISTS `__mcp_ro_probe_does_not_exist`');
    t.diagnostic('DROP TABLE IF EXISTS <nonexistent> -> no error (DDL is not covered by the read-only session)');
  } catch (e) {
    t.diagnostic(`DROP TABLE IF EXISTS <nonexistent> -> ${e.code} (${e.errno})`);
  }
});

test('MAX_ROWS cap: truncated true', opts, async (t) => {
  const r = await db.execute('SELECT * FROM information_schema.COLUMNS', { maxRows: 5 });
  assert.equal(r.truncated, true);
  assert.equal(r.rows.length, 5);
  const s = await db.execute('SELECT 1');
  assert.equal(s.truncated, false);
  t.diagnostic(`maxRows=5 over information_schema.COLUMNS -> rows=${r.rows.length} truncated=${r.truncated}`);
  const next = await db.execute('SELECT 2 AS two');
  assert.deepEqual(next.rows, [{ two: 2 }]);
});

test('session: autocommit, read-only, max_execution_time; no BEGIN in processlist', opts, async (t) => {
  const v = await db.execute(
    'SELECT @@autocommit AS autocommit, @@session.transaction_read_only AS ro, @@session.max_execution_time AS met',
  );
  t.diagnostic(`session vars -> ${JSON.stringify(v.rows[0])}`);
  assert.equal(Number(v.rows[0].autocommit), 1);
  assert.equal(Number(v.rows[0].ro), 1);
  assert.equal(Number(v.rows[0].met), cfg.maxExecutionMs);

  const sleeper = await db._getConn();
  const watcher = await db._getConn();
  const id = sleeper.threadId;
  const running = new Promise((res, rej) => sleeper.query('SELECT SLEEP(2)', (e) => (e ? rej(e) : res())));
  await new Promise((r) => setTimeout(r, 500));
  const pl = await new Promise((res, rej) =>
    watcher.query('SELECT COMMAND, STATE, INFO FROM information_schema.PROCESSLIST WHERE ID = ?', [id], (e, rows) => (e ? rej(e) : res(rows))),
  );
  const trx = await new Promise((res) =>
    watcher.query('SELECT trx_state, trx_is_read_only FROM information_schema.INNODB_TRX WHERE trx_mysql_thread_id = ?', [id], (e, rows) =>
      res(e ? `n/a (${e.code})` : rows),
    ),
  );
  await running;
  sleeper.release();
  watcher.release();
  t.diagnostic(`processlist(running conn) -> ${JSON.stringify(pl)}`);
  t.diagnostic(`innodb_trx(running conn) -> ${JSON.stringify(trx)}`);
  assert.equal(pl.length, 1);
  assert.match(pl[0].INFO, /^SELECT SLEEP\(2\)$/);
});

test('profile mode: saved dev login, switch local -> dev, query tagged with profile', opts, async (t) => {
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { createProfiles, fileStore } = await import('../profiles.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'dbro-live-'));
  await createProfiles({ dir, secrets: fileStore(dir) }).login(
    'dev', { host: cfg.host, port: cfg.port, user: cfg.user, database: cfg.database }, { store: cfg.password },
  );
  const env = { ...process.env, DBRO_CONFIG_DIR: dir, DBRO_SECRETS: 'file' };
  for (const k of ['MYSQL_HOST', 'MYSQL_USER', 'MYSQL_DB', 'MYSQL_PASS', 'MYSQL_PORT']) delete env[k];
  const pc = new Client({ name: 'live-profile', version: '0' });
  await pc.connect(new StdioClientTransport({
    command: process.execPath, args: [fileURLToPath(new URL('../server.mjs', import.meta.url))], env, stderr: 'ignore',
  }));
  try {
    const sw = await pc.callTool({ name: 'profile', arguments: { name: 'dev' } });
    assert.equal(sw.isError, undefined, sw.content[0].text);
    const r = await pc.callTool({ name: 'query', arguments: { sql: 'SELECT @@session.transaction_read_only AS ro' } });
    const data = JSON.parse(r.content[0].text);
    assert.equal(data.profile, 'dev');
    assert.deepEqual(data.rows, [{ ro: 1 }]);
    t.diagnostic(`profile switch -> ${sw.content[0].text.replace(/\s+/g, ' ')}; query -> profile=${data.profile} rows=${JSON.stringify(data.rows)}`);
    const lo = await pc.callTool({ name: 'logout', arguments: { name: 'dev' } });
    const after = await pc.callTool({ name: 'query', arguments: { sql: 'SELECT 1' } });
    assert.equal(after.isError, true);
    t.diagnostic(`logout -> ${lo.content[0].text.replace(/\s+/g, ' ')}; next query -> ${after.content[0].text}`);
  } finally {
    await pc.close();
  }
});

test('SHOW GRANTS summary (privileges only, no user/host)', opts, async (t) => {
  const r = await db.execute('SHOW GRANTS');
  const WRITE = /\b(ALL PRIVILEGES|INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|INDEX|REFERENCES|TRIGGER|EVENT|CREATE ROUTINE|ALTER ROUTINE|EXECUTE|FILE|SUPER|LOCK TABLES|CREATE TEMPORARY TABLES)\b/;
  const lines = r.rows.map((row) => Object.values(row)[0]);
  const summary = lines.map((g) => {
    const m = g.match(/^GRANT (.+?) ON (\S+) TO /);
    if (!m) return { kind: 'role/proxy grant' };
    const scope = m[2] === '*.*' ? 'global' : /\.\*$/.test(m[2]) ? 'database' : 'table';
    return { scope, privileges: m[1], write: WRITE.test(m[1]) };
  });
  for (const s of summary) t.diagnostic(`grant -> ${JSON.stringify(s)}`);
  t.diagnostic(`account has write-capable privileges: ${summary.some((s) => s.write)}`);
});
