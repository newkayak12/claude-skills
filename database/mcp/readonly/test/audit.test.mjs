import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createAudit, maskLiterals } from '../audit.mjs';
import { createServer, limitsFor, PROD_LIMITS } from '../server.mjs';
import { checkQuery } from '../vendors/mysql.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'dbro-audit-'));

async function connect({ profiles = null, audit, db }) {
  const state = { profile: profiles ? 'dev' : null, db, redact: (m) => m, error: null };
  const server = createServer({ state, profiles, lim: { maxRows: 1000, maxExecutionMs: 30000 }, audit });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const client = new Client({ name: 't', version: '0' });
  await client.connect(b);
  const call = async (name, args = {}) => (await client.callTool({ name, arguments: args })).content[0].text;
  return { client, call, state };
}

const fakeDb = {
  check: checkQuery,
  execute: async () => ({ columns: ['id'], hidden: ['recv_nm'], rows: [{ id: 1 }], rowCount: 1, truncated: false, elapsedMs: 2 }),
  listTables: async () => ({ columns: ['name'], rows: [{ name: 't' }], rowCount: 1, truncated: false, elapsedMs: 1 }),
  describeTable: async (t) => ({ table: t, columns: [{ name: 'id' }, { name: 'recv_nm' }] }),
  close: async () => {},
};

test('maskLiterals: string values become ? so the log holds no typed-in value', () => {
  assert.equal(maskLiterals("SELECT id FROM t WHERE recv_tel = '010-1234-5678' AND n = \"kim\"\n  AND id = 3"), "SELECT id FROM t WHERE recv_tel = '?' AND n = '?' AND id = 3");
  assert.equal(maskLiterals("SELECT 'it''s', 'a\\'b'"), "SELECT '?', '?'");
});

test('query log: one line per read with counts only, rejected and failed reads included, file 0600', async () => {
  const dir = tmp();
  const audit = createAudit({ dir });
  const failing = { ...fakeDb, describeTable: async () => Promise.reject(Object.assign(new Error('x'), { code: 'ER_NO_SUCH_TABLE' })) };
  const s = await connect({ audit, db: failing });
  try {
    await s.call('query', { sql: "SELECT id, recv_nm FROM t WHERE recv_hp = '01099998888'" });
    await s.call('query', { sql: 'DELETE FROM t' });
    await s.call('list_tables');
    await s.call('describe_table', { table: 'nope' });
  } finally {
    await s.client.close();
  }
  const file = join(dir, 'query.log');
  assert.equal(statSync(file).mode & 0o777, 0o600);
  const text = readFileSync(file, 'utf8');
  assert.doesNotMatch(text, /01099998888/);
  const lines = text.trim().split('\n').map((l) => JSON.parse(l));
  const strip = ({ ts, ...rest }) => (assert.match(ts, /^\d{4}-\d\d-\d\dT/), rest);
  assert.deepEqual(lines.map(strip), [
    { profile: 'direct', tool: 'query', sql: "SELECT id, recv_nm FROM t WHERE recv_hp = '?'", rows: 1, hidden: 1, elapsedMs: 2 },
    { profile: 'direct', tool: 'query', sql: 'DELETE FROM t', rejected: 'whitelist' },
    { profile: 'direct', tool: 'list_tables', rows: 1, elapsedMs: 1 },
    { profile: 'direct', tool: 'describe_table', table: 'nope', error: 'ER_NO_SUCH_TABLE' },
  ]);
});

test('query log rolls to query.log.1 past the size cap; a log failure does not fail the read', async () => {
  const dir = tmp();
  writeFileSync(join(dir, 'query.log'), 'x'.repeat(100));
  createAudit({ dir, max: 50 })({ tool: 'list_tables' });
  assert.equal(readFileSync(join(dir, 'query.log.1'), 'utf8').length, 100);
  assert.equal(readFileSync(join(dir, 'query.log'), 'utf8').split('\n').length, 2);

  const errors = [];
  const broken = createAudit({ dir: join(dir, 'query.log', 'sub'), onError: (e) => errors.push(e) });
  const s = await connect({ audit: broken, db: fakeDb });
  try {
    assert.match(await s.call('list_tables'), /"rowCount": 1/);
    await s.call('list_tables');
  } finally {
    await s.client.close();
  }
  assert.equal(errors.length, 1);
  assert.equal(existsSync(join(dir, 'query.log', 'sub')), false);
});

test('prod limits: row cap and timeout capped on prod only, reported on switch', async () => {
  const lim = { maxRows: 1000, maxExecutionMs: 30000 };
  assert.deepEqual(limitsFor('dev', lim), lim);
  assert.deepEqual(limitsFor('prod', lim), { maxRows: PROD_LIMITS.maxRows, maxExecutionMs: PROD_LIMITS.maxExecutionMs });
  assert.deepEqual(limitsFor('prod', { maxRows: 50, maxExecutionMs: 5000 }), { maxRows: 50, maxExecutionMs: 5000 });

  const seen = [];
  const profiles = {
    resolve: async (name, l) => (seen.push([name, l]), { vendor: 'mysql', host: '127.0.0.1', port: 1, user: 'u', password: '', database: 'd', ...l }),
  };
  const s = await connect({ profiles, db: fakeDb });
  try {
    const r = JSON.parse(await s.call('profile', { name: 'prod' }));
    assert.deepEqual(r, { active: 'prod', changed: true, limits: { maxRows: 200, maxExecutionMs: 10000 } });
    assert.deepEqual(seen, [['prod', { maxRows: 200, maxExecutionMs: 10000 }]]);
  } finally {
    await s.state.db?.close();
    await s.client.close();
  }
});
