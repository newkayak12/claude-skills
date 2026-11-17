import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, statSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { childEnv, execAws } from '../awsexec.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'awsro-exec-'));
const creds = { AccessKeyId: 'AKIAFAKEFAKEFAKE0000', SecretAccessKey: 'fakeSecretFakeSecret0000', SessionToken: 'fakeSessionTokenFake' };

test('childEnv keeps only the allow-list', () => {
  const dir = tmp();
  const base = {
    PATH: '/usr/bin:/bin', HOME: '/home/x', FOO: 'bar', AWSRO_CONFIG_DIR: dir,
    AWS_ENDPOINT_URL: 'http://evil', AWS_PROFILE: 'other', AWS_CA_BUNDLE: '/tmp/ca.pem', AWS_ACCESS_KEY_ID: 'AKIASERVERENV00000000',
  };
  const env = childEnv(creds, 'eu-west-1', base);
  assert.deepEqual(Object.keys(env).sort(), [
    'AWS_ACCESS_KEY_ID', 'AWS_CONFIG_FILE', 'AWS_PAGER', 'AWS_REGION', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN', 'AWS_SHARED_CREDENTIALS_FILE', 'PATH',
  ]);
  assert.equal(env.AWS_ACCESS_KEY_ID, creds.AccessKeyId);
  assert.equal(env.AWS_SECRET_ACCESS_KEY, creds.SecretAccessKey);
  assert.equal(env.AWS_SESSION_TOKEN, creds.SessionToken);
  assert.equal(env.AWS_REGION, 'eu-west-1');
  assert.equal(env.AWS_PAGER, '');
  assert.equal(env.PATH, '/usr/bin:/bin');
  for (const k of ['AWS_ENDPOINT_URL', 'AWS_PROFILE', 'AWS_CA_BUNDLE', 'FOO', 'HOME']) assert.equal(k in env, false, k);
});

test('childEnv omits the session token for long-term keys', () => {
  const env = childEnv({ AccessKeyId: creds.AccessKeyId, SecretAccessKey: creds.SecretAccessKey }, 'us-east-1', { PATH: '/bin', AWSRO_CONFIG_DIR: tmp() });
  assert.equal('AWS_SESSION_TOKEN' in env, false);
});

test('childEnv points the config and credentials files at empty files in the config dir', () => {
  const dir = tmp();
  const env = childEnv(creds, 'us-east-1', { PATH: '/bin', AWSRO_CONFIG_DIR: dir });
  for (const k of ['AWS_CONFIG_FILE', 'AWS_SHARED_CREDENTIALS_FILE']) {
    assert.ok(env[k].startsWith(dir), k);
    assert.ok(existsSync(env[k]), k);
    assert.equal(readFileSync(env[k], 'utf8'), '');
    assert.equal(statSync(env[k]).mode & 0o777, 0o600);
  }
  assert.notEqual(env.AWS_CONFIG_FILE, env.AWS_SHARED_CREDENTIALS_FILE);
});

test('childEnv rejects missing keys or region', () => {
  const base = { PATH: '/bin', AWSRO_CONFIG_DIR: tmp() };
  assert.throws(() => childEnv({ AccessKeyId: 'a' }, 'us-east-1', base), /credentials/);
  assert.throws(() => childEnv(creds, '', base), /region/);
});

test('execAws calls execFile("aws", argv) with the env and no shell option', async () => {
  let seen;
  const execFile = (cmd, argv, opts, cb) => {
    seen = { cmd, argv, opts };
    cb(null, 'out', '');
    return { kill() {} };
  };
  const r = await execAws(['sts', 'get-caller-identity'], { AWS_REGION: 'x' }, { execFile });
  assert.equal(seen.cmd, 'aws');
  assert.deepEqual(seen.argv, ['sts', 'get-caller-identity']);
  assert.deepEqual(seen.opts.env, { AWS_REGION: 'x' });
  assert.equal('shell' in seen.opts, false);
  assert.deepEqual(r, { stdout: 'out', stderr: '', code: 0, truncated: false, timedOut: false });
});

test('execAws kills a child that never returns at the timeout', async () => {
  let killed = null;
  const execFile = () => ({ kill: (sig) => (killed = sig || 'SIGTERM') });
  const t0 = Date.now();
  const r = await execAws(['s3', 'ls'], {}, { execFile, timeoutMs: 30 });
  assert.equal(r.timedOut, true);
  assert.ok(killed);
  assert.ok(Date.now() - t0 < 2000);
});

test('execAws cuts stdout at the cap and flags truncated', async () => {
  const execFile = (_c, _a, _o, cb) => (cb(null, 'x'.repeat(100), ''), { kill() {} });
  const r = await execAws([], {}, { execFile, capBytes: 10 });
  assert.equal(r.stdout, 'x'.repeat(10));
  assert.equal(r.truncated, true);
});

test('execAws keeps the partial stdout when execFile reports maxBuffer', async () => {
  const execFile = (_c, _a, _o, cb) => (cb(Object.assign(new Error('m'), { code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' }), 'y'.repeat(11), ''), { kill() {} });
  const r = await execAws([], {}, { execFile, capBytes: 10 });
  assert.equal(r.stdout, 'y'.repeat(10));
  assert.equal(r.truncated, true);
});

test('execAws maps ENOENT to "aws CLI not installed → aws:login installs it"', async () => {
  const execFile = (_c, _a, _o, cb) => (cb(Object.assign(new Error('spawn aws ENOENT'), { code: 'ENOENT' })), { kill() {} });
  await assert.rejects(execAws([], {}, { execFile }), (e) => e.message === 'aws CLI not installed → aws:login installs it' && e.code === 'ENOENT');
});

test('execAws returns the exit code and stderr of a failed run', async () => {
  const execFile = (_c, _a, _o, cb) => (cb(Object.assign(new Error('Command failed'), { code: 255 }), '', 'AccessDenied'), { kill() {} });
  const r = await execAws([], {}, { execFile });
  assert.equal(r.code, 255);
  assert.equal(r.stderr, 'AccessDenied');
  assert.equal(r.timedOut, false);
});
