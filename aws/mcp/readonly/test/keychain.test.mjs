import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createKeychain, SERVICE, keyAccount, sessionAccount, opAccount, MAX_VALUE_BYTES } from '../keychain.mjs';

// A stub `security`: records every call (argv and stdin) and answers from a map.
function stub(answer = () => ({ code: 0, stdout: '', stderr: '' })) {
  const calls = [];
  const run = async (args, stdin) => (calls.push({ args, stdin }), answer(args, stdin));
  return { calls, run };
}

test('account helpers name keys, session and op reference', () => {
  assert.equal(SERVICE, 'readonly-aws');
  assert.equal(keyAccount('dev'), 'dev');
  assert.equal(sessionAccount('dev'), 'dev:session');
  assert.equal(opAccount('dev'), 'dev:op');
});

test('set sends one add-generic-password line through stdin, value never in argv', async () => {
  const s = stub();
  await createKeychain({ run: s.run }).set('dev', 'AKIAFAKEFAKEFAKE0000');
  assert.equal(s.calls.length, 1);
  assert.deepEqual(s.calls[0].args, ['-i']);
  assert.equal(s.calls[0].stdin, 'add-generic-password -U -s readonly-aws -a "dev" -w "AKIAFAKEFAKEFAKE0000"\n');
  assert.equal(JSON.stringify(s.calls[0].args).includes('AKIAFAKEFAKEFAKE0000'), false);
});

test('set escapes quotes, backslashes, spaces and braces for the security tokenizer', async () => {
  const s = stub();
  const value = 'a "b" c\\d {e}';
  await createKeychain({ run: s.run }).set('dev:session', value);
  assert.equal(s.calls[0].stdin, 'add-generic-password -U -s readonly-aws -a "dev:session" -w "a \\"b\\" c\\\\d {e}"\n');
});

test('set refuses a value with a newline or carriage return and calls nothing', async () => {
  const s = stub();
  const kc = createKeychain({ run: s.run });
  await assert.rejects(kc.set('dev', 'a\nb'), /newline/);
  await assert.rejects(kc.set('dev', 'a\rb'), /newline/);
  assert.equal(s.calls.length, 0);
});

test('set refuses a value over 4000 bytes (multi-byte counted) and calls nothing', async () => {
  const s = stub();
  const kc = createKeychain({ run: s.run });
  assert.equal(MAX_VALUE_BYTES, 4000);
  await kc.set('dev', 'x'.repeat(4000));
  s.calls.length = 0;
  await assert.rejects(kc.set('dev', 'x'.repeat(4001)), /4000/);
  await assert.rejects(kc.set('dev', 'é'.repeat(2001)), /4000/);
  assert.equal(s.calls.length, 0);
});

test('set fails when security reports an error', async () => {
  const s = stub(() => ({ code: 0, stdout: '', stderr: 'security: SecKeychainItemCreate failed' }));
  await assert.rejects(createKeychain({ run: s.run }).set('dev', 'v'), /Keychain write failed/);
  const t = stub(() => ({ code: 1, stdout: '', stderr: '' }));
  await assert.rejects(createKeychain({ run: t.run }).set('dev', 'v'), /Keychain write failed/);
});

test('get reads with find-generic-password -w and strips the newline; a missing item is null', async () => {
  const s = stub((args) => (args.includes('dev') ? { code: 0, stdout: 'secretvalue\n', stderr: '' } : { code: 44, stdout: '', stderr: 'not found' }));
  const kc = createKeychain({ run: s.run });
  assert.equal(await kc.get('dev'), 'secretvalue');
  assert.deepEqual(s.calls[0].args, ['find-generic-password', '-s', 'readonly-aws', '-a', 'dev', '-w']);
  assert.equal(await kc.get('nope'), null);
});

test('del uses delete-generic-password and says whether an item went', async () => {
  const s = stub((args) => (args.includes('dev:session') ? { code: 0, stdout: '', stderr: '' } : { code: 44, stdout: '', stderr: '' }));
  const kc = createKeychain({ run: s.run });
  assert.equal(await kc.del('dev:session'), true);
  assert.deepEqual(s.calls[0].args, ['delete-generic-password', '-s', 'readonly-aws', '-a', 'dev:session']);
  assert.equal(await kc.del('dev:op'), false);
});

test('a missing security binary gives an error that names Keychain', async () => {
  const run = async () => { throw Object.assign(new Error('spawn security ENOENT'), { code: 'ENOENT' }); };
  const kc = createKeychain({ run });
  for (const call of [() => kc.get('dev'), () => kc.set('dev', 'v'), () => kc.del('dev')]) await assert.rejects(call(), /Keychain/);
});

test('a non-darwin platform gives an error that names Keychain and runs nothing', async () => {
  const s = stub();
  const kc = createKeychain({ run: s.run, platform: 'linux' });
  await assert.rejects(kc.get('dev'), /Keychain.*macOS/);
  await assert.rejects(kc.set('dev', 'v'), /Keychain.*macOS/);
  assert.equal(s.calls.length, 0);
});

test('macOS keychain round trip with the real security binary', { skip: process.platform !== 'darwin' && 'not macOS' }, async () => {
  const kc = createKeychain({ service: 'readonly-aws-test' });
  const value = `a b"c\\d$e'f{g}`;
  try {
    await kc.set('t1', value);
    assert.equal(await kc.get('t1'), value);
  } finally {
    await kc.del('t1');
  }
  assert.equal(await kc.get('t1'), null);
});

test('has runs find-generic-password with no -w and answers by exit code', async () => {
  const s = stub((args) => (args.includes('present') ? { code: 0, stdout: 'keychain: ...\n', stderr: '' } : { code: 44, stdout: '', stderr: 'not found' }));
  const kc = createKeychain({ run: s.run });
  assert.equal(await kc.has('present'), true);
  assert.equal(await kc.has('absent'), false);
  assert.deepEqual(s.calls[0].args, ['find-generic-password', '-s', 'readonly-aws', '-a', 'present']);
  for (const c of s.calls) assert.equal(c.args.includes('-w') || c.args.includes('-g'), false);
});

test('has rejects off macOS like the other calls', async () => {
  await assert.rejects(createKeychain({ run: stub().run, platform: 'linux' }).has('dev'), /macOS is required/);
});
