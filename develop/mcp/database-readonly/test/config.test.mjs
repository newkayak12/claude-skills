import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveConfig, redactor } from '../config.mjs';

const env = { MYSQL_HOST: 'envhost', MYSQL_USER: 'envuser', MYSQL_PASS: 'envpass', MYSQL_DB: 'envdb' };
const noOp = () => {
  throw new Error('op should not be called');
};

test('env vars with defaults', async () => {
  const c = await resolveConfig([], env, noOp);
  assert.deepEqual(c, {
    vendor: 'mysql', host: 'envhost', port: 3306, user: 'envuser', password: 'envpass',
    database: 'envdb', maxRows: 1000, maxExecutionMs: 30000,
  });
});

test('plain CLI args override env', async () => {
  const c = await resolveConfig(
    ['--host', 'h', '--port', '3307', '--user', 'u', '--password', 'p', '--database', 'd', '--max-rows', '5', '--max-execution-ms', '100'],
    env, noOp,
  );
  assert.equal(c.host, 'h');
  assert.equal(c.port, 3307);
  assert.equal(c.user, 'u');
  assert.equal(c.password, 'p');
  assert.equal(c.database, 'd');
  assert.equal(c.maxRows, 5);
  assert.equal(c.maxExecutionMs, 100);
});

test('op:// values resolved via 1Password, from args or env', async () => {
  const seen = [];
  const read = async (ref) => {
    seen.push(ref);
    return `resolved:${ref.split('/').pop()}`;
  };
  const c = await resolveConfig(['--password=op://V/item/password'], { ...env, MYSQL_HOST: 'op://V/item/hostname' }, read);
  assert.equal(c.password, 'resolved:password');
  assert.equal(c.host, 'resolved:hostname');
  assert.deepEqual(seen.sort(), ['op://V/item/hostname', 'op://V/item/password']);
});

test('op failure names the option, not the value', async () => {
  const read = async () => {
    throw new Error('op read failed (1)');
  };
  await assert.rejects(resolveConfig([], { ...env, MYSQL_PASS: 'op://V/i/password' }, read), /--password: op read failed/);
});

test('missing and invalid values', async () => {
  await assert.rejects(resolveConfig([], {}, noOp), /missing: --host.*--user.*--database/);
  await assert.rejects(resolveConfig(['--port', 'abc'], env, noOp), /--port must be a positive integer/);
  await assert.rejects(resolveConfig(['--bogus', 'x'], env, noOp));
});

test('redactor hides password, user and host', () => {
  const r = redactor({ password: 's3cret', user: 'reader', host: 'db.internal' });
  assert.equal(r("Access denied for user 'reader'@'db.internal' (using password: s3cret)"), "Access denied for user '***'@'***' (using password: ***)");
});
