import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readItem, otp } from '../op.mjs';

const KEY = 'AKIAFAKEFAKEFAKE0000';
const SECRET = 'fakeSecretFakeSecret0000fakeSecretFake';

// A stub run that records every call and answers with the given outcome.
function stub(outcome) {
  const calls = [];
  const run = (file, args, opts, cb) => {
    calls.push({ file, args, opts });
    const r = typeof outcome === 'function' ? outcome(args) : outcome;
    cb(r.err ?? null, r.stdout ?? '', r.stderr ?? '');
  };
  return { run, calls };
}

const itemJson = (fields) => JSON.stringify({ id: 'x', fields });

test('readItem matches labels case-insensitively and returns the pair', async () => {
  const { run } = stub({ stdout: itemJson([
    { label: 'Access Key ID', value: 'ignored' },
    { label: 'UserName', value: KEY },
    { label: ' PASSWORD ', value: SECRET },
  ]) });
  assert.deepEqual(await readItem('Dev', 'aws-root', { run }), { AccessKeyId: KEY, SecretAccessKey: SECRET });
});

test('readItem argv is exact and goes through execFile with no shell', async () => {
  const { run, calls } = stub({ stdout: itemJson([{ label: 'username', value: KEY }, { label: 'password', value: SECRET }]) });
  await readItem('My Vault', 'my item', { run });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].file, 'op');
  assert.deepEqual(calls[0].args, ['item', 'get', 'my item', '--vault', 'My Vault', '--format', 'json']);
  assert.equal(calls[0].opts.shell, undefined);
});

test('otp argv is exact', async () => {
  const { run, calls } = stub({ stdout: '123456\n' });
  assert.equal(await otp('My Vault', 'my item', { run }), '123456');
  assert.deepEqual(calls[0].args, ['item', 'get', 'my item', '--vault', 'My Vault', '--otp']);
  assert.equal(calls[0].file, 'op');
});

test('otp takes the first 6-digit token from surrounding text', async () => {
  const { run } = stub({ stdout: 'code: 654321 (valid 12s) next 111111\n' });
  assert.equal(await otp('v', 'i', { run }), '654321');
});

test('otp ignores longer digit runs and fails when no 6-digit token exists', async () => {
  assert.equal(await otp('v', 'i', { run: stub({ stdout: 'id 1234567 code 222333' }).run }), '222333');
  await assert.rejects(otp('v', 'i', { run: stub({ stdout: 'secret-ish 12345 and 1234567' }).run }), (e) => {
    assert.match(e.message, /6-digit/);
    assert.equal(e.message.includes('12345'), false);
    return true;
  });
});

test('ENOENT gives the not-installed message for both calls', async () => {
  const run = stub({ err: Object.assign(new Error('spawn op ENOENT'), { code: 'ENOENT' }) }).run;
  await assert.rejects(readItem('v', 'i', { run }), { message: '1Password CLI (op) is not installed' });
  await assert.rejects(otp('v', 'i', { run }), { message: '1Password CLI (op) is not installed' });
});

test('a missing field names the label, not a value', async () => {
  const { run } = stub({ stdout: itemJson([{ label: 'username', value: KEY }, { label: 'notes', value: SECRET }]) });
  await assert.rejects(readItem('v', 'i', { run }), (e) => {
    assert.match(e.message, /password/);
    assert.equal(e.message.includes(KEY), false);
    assert.equal(e.message.includes(SECRET), false);
    return true;
  });
  const empty = stub({ stdout: itemJson([{ label: 'username', value: '' }, { label: 'password', value: SECRET }]) }).run;
  await assert.rejects(readItem('v', 'i', { run: empty }), /username/);
});

test('a failed exit names the failure without stderr content', async () => {
  const err = Object.assign(new Error(`Command failed ${SECRET}`), { code: 1 });
  const generic = stub({ err, stderr: `weird ${SECRET}` }).run;
  await assert.rejects(readItem('v', 'i', { run: generic }), (e) => {
    assert.match(e.message, /failed \(exit 1\)/);
    assert.equal(e.message.includes(SECRET), false);
    return true;
  });
  const out = stub({ err, stderr: `[ERROR] You are not currently signed in ${SECRET}` }).run;
  await assert.rejects(otp('v', 'i', { run: out }), (e) => {
    assert.match(e.message, /signed out/);
    assert.equal(e.message.includes(SECRET), false);
    return true;
  });
  const missing = stub({ err, stderr: `"x" isn't an item in the "y" vault ${SECRET}` }).run;
  await assert.rejects(readItem('v', 'i', { run: missing }), (e) => {
    assert.match(e.message, /not found/);
    assert.equal(e.message.includes(SECRET), false);
    return true;
  });
});

test('a timeout is named; non-JSON output is not echoed', async () => {
  const killed = stub({ err: Object.assign(new Error('x'), { killed: true, signal: 'SIGTERM', code: null }) }).run;
  await assert.rejects(otp('v', 'i', { run: killed }), /timed out/);
  await assert.rejects(readItem('v', 'i', { run: stub({ stdout: `not json ${SECRET}` }).run }), (e) => {
    assert.equal(e.message.includes(SECRET), false);
    return true;
  });
});

test('a vault or item starting with a dash is refused before op runs', async () => {
  const { run, calls } = stub({ stdout: '123456' });
  await assert.rejects(readItem('--account', 'i', { run }), /vault name/);
  await assert.rejects(otp('v', '-x', { run }), /item name/);
  assert.equal(calls.length, 0);
});

// --- username/password layout and otp_item (card 157 item 2) ------------------------------------

test('readItem reads username/password when the named pair is absent, labels trimmed and case-insensitive', async () => {
  const { run } = stub({ stdout: itemJson([
    { label: ' Username ', value: KEY },
    { label: 'PASSWORD', value: SECRET },
    { label: 'one-time password', value: 'otpauth://totp/x?secret=ZZZ' },
  ]) });
  assert.deepEqual(await readItem('v', 'i', { run }), { AccessKeyId: KEY, SecretAccessKey: SECRET });
});

test('readItem reads only username and password: the access key fields are never used', async () => {
  const both = stub({ stdout: itemJson([
    { label: 'access key id', value: 'AKIAOTHEROTHEROTHER0' },
    { label: 'secret access key', value: 'other-secret' },
    { label: 'username', value: KEY },
    { label: 'password', value: SECRET },
  ]) }).run;
  assert.deepEqual(await readItem('v', 'i', { run: both }), { AccessKeyId: KEY, SecretAccessKey: SECRET });
  const keysOnly = stub({ stdout: itemJson([
    { label: 'access key id', value: KEY },
    { label: 'secret access key', value: SECRET },
  ]) }).run;
  await assert.rejects(readItem('v', 'i', { run: keysOnly }), (e) => {
    assert.match(e.message, /'username' \+ 'password'/);
    assert.equal(e.message.includes('access key id'), false);
    assert.equal(e.message.includes(KEY), false);
    assert.equal(e.message.includes(SECRET), false);
    return true;
  });
});

test('otp with an otp_item runs item get <otp_item> --vault <vault> --otp and never names the key item', async () => {
  const { run, calls } = stub({ stdout: '654321\n' });
  assert.equal(await otp('My Vault', 'key item', { otp_item: 'console login', run }), '654321');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].file, 'op');
  assert.deepEqual(calls[0].args, ['item', 'get', 'console login', '--vault', 'My Vault', '--otp']);
  assert.equal(calls[0].opts.shell, undefined);
});

test('otp with no otp_item reads the key item as before', async () => {
  const { run, calls } = stub({ stdout: '123456\n' });
  assert.equal(await otp('My Vault', 'key item', { run }), '123456');
  assert.deepEqual(calls[0].args, ['item', 'get', 'key item', '--vault', 'My Vault', '--otp']);
  const none = stub({ stdout: '123456\n' });
  await otp('My Vault', 'key item', { otp_item: undefined, run: none.run });
  assert.deepEqual(none.calls[0].args, ['item', 'get', 'key item', '--vault', 'My Vault', '--otp']);
});

test('assertRef refuses a bad otp_item before op runs', async () => {
  const { run, calls } = stub({ stdout: '123456' });
  for (const bad of ['-x', '', 'a\nb', 'a\0b', 7]) {
    await assert.rejects(otp('v', 'i', { otp_item: bad, run }), /otp_item name/, JSON.stringify(bad));
  }
  assert.equal(calls.length, 0);
});
