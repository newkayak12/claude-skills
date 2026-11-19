import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProfiles } from '../profiles.mjs';
import { createKeychain } from '../keychain.mjs';
import { hiddenDialog } from '../dialog.mjs';
import { readItem, otp } from '../op.mjs';
import { login, ensureSession } from '../login.mjs';

const FAKE = {
  key: 'AKIAFAKEFAKEFAKE0000',
  secret: 'fakeSecretAccessKeyFake0000000000000000',
  token: `FQoGZXIvYXdzFAKE${'A'.repeat(1000)}`,
  sessKey: 'ASIAFAKEFAKEFAKE1111',
  sessSecret: 'fakeSessionSecretFake1111111111111111',
};
const CODE = '246810';
const CODE2 = '135791';
const MFA = 'arn:aws:iam::123456789012:mfa/fake-user';
const NOW = Date.parse('2026-11-17T00:00:00Z');
const EXP = { 129600: '2026-11-18T12:00:00+00:00', 43200: '2026-11-17T12:00:00+00:00', 3600: '2026-11-17T01:00:00+00:00' };
const SENTINEL = 'RAWSTDERRSENTINEL';

const identity = { Account: '123456789012', Arn: 'arn:aws:iam::123456789012:user/fake-user', UserId: 'AIDAFAKEFAKE' };
const done = (stdout) => ({ stdout: JSON.stringify(stdout), stderr: '', code: 0, truncated: false, timedOut: false });
const fail = (code, msg) => ({ stdout: '', stderr: `An error occurred (${code}) when calling the GetSessionToken operation: ${msg} ${SENTINEL} ${FAKE.secret}`, code: 254, truncated: false, timedOut: false });
const minted = (seconds) => done({ Credentials: { AccessKeyId: FAKE.sessKey, SecretAccessKey: FAKE.sessSecret, SessionToken: FAKE.token, Expiration: EXP[seconds] } });
const durationOf = (argv) => Number(argv[argv.indexOf('--duration-seconds') + 1]);
const TOO_LONG = "1 validation error detected: Value '129600' at 'durationSeconds' failed to satisfy constraint";
const BAD_CODE = 'MultiFactorAuthentication failed with invalid MFA one time pass code(s).';

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'awsro-login-'));
  const store = new Map();
  const calls = { osascript: [], security: [], op: [], aws: [], sleep: [] };
  const s = { dir, store, calls, answers: [], otps: [] };

  const securityRun = async (args, stdin) => {
    calls.security.push({ args, stdin });
    const acct = args.includes('-a') ? args[args.indexOf('-a') + 1] : /-a "([^"]*)"/.exec(stdin)[1];
    if (args[0] === '-i') return store.set(acct, /-w "(.*)"\n$/.exec(stdin)[1]), { code: 0, stdout: '', stderr: '' };
    if (args[0] === 'find-generic-password') return store.has(acct) ? { code: 0, stdout: `${store.get(acct)}\n`, stderr: '' } : { code: 44, stdout: '', stderr: '' };
    return store.delete(acct) ? { code: 0, stdout: '', stderr: '' } : { code: 44, stdout: '', stderr: '' };
  };
  const osaRun = (file, args, cb) => {
    calls.osascript.push({ file, args });
    const a = s.answers.shift();
    if (a === null) return cb(Object.assign(new Error('canceled'), { code: -128, stderr: 'execution error: User canceled. (-128)' }), '', '');
    if (a === undefined) return cb(Object.assign(new Error('no answer queued'), { code: 1 }), '', '');
    cb(null, `${a}\n`, '');
  };
  s.opItem = { fields: [{ label: 'username', value: FAKE.key }, { label: 'PASSWORD', value: FAKE.secret }, { label: 'one-time password', value: 'otpauth://totp/x?secret=ZZZ' }] };
  s.opHandler = (args) => {
    if (args.includes('--otp')) {
      const c = s.otps.shift();
      return c === undefined ? { error: Object.assign(new Error('x'), { code: 1 }), stderr: 'no otp' } : { stdout: `${c}\n` };
    }
    return { stdout: JSON.stringify(s.opItem) };
  };
  const opRun = (file, args, _o, cb) => {
    calls.op.push(args);
    const r = s.opHandler(args);
    if (r.error) cb(r.error, '', r.stderr ?? '');
    else cb(null, r.stdout, '');
  };
  s.awsHandler = (argv) => (argv[1] === 'get-caller-identity' ? done(identity) : minted(durationOf(argv)));

  const keychain = createKeychain({ run: securityRun });
  const profiles = createProfiles({ dir, keychain, now: () => NOW });
  s.keychain = keychain;
  s.profiles = profiles;
  s.ctx = {
    profiles,
    keychain,
    env: { AWSRO_CONFIG_DIR: dir },
    exec: async (argv, env) => {
      calls.aws.push({ argv, env });
      return s.awsHandler(argv, env);
    },
    dialog: (prompt) => hiddenDialog(prompt, { run: osaRun }),
    op: { readItem: (v, i) => readItem(v, i, { run: opRun }), otp: (v, i, o) => otp(v, i, { ...o, run: opRun }) },
    sleep: async (ms) => void calls.sleep.push(ms),
  };
  s.mint = () => calls.aws.filter((c) => c.argv[1] === 'get-session-token');
  s.writes = () => calls.security.filter((c) => c.args[0] === '-i').map((c) => ({ stdin: c.stdin, account: /-a "([^"]*)"/.exec(c.stdin)[1], value: /-w "(.*)"\n$/.exec(c.stdin)[1] }));
  s.deletes = () => calls.security.filter((c) => c.args[0] === 'delete-generic-password').map((c) => c.args[c.args.indexOf('-a') + 1]);
  s.run = (args) => login.handler({ profile: 'dev', region: 'us-east-1', ...args }, s.ctx);
  s.call = (args) => login.handler(args, s.ctx); // exactly these arguments, no defaults
  s.profilesJson = () => (existsSync(join(dir, 'profiles.json')) ? readFileSync(join(dir, 'profiles.json'), 'utf8') : null);
  return s;
}
const text = (r) => r.content[0].text;
const first = (r) => text(r).split('\n')[0];
const unb64 = (v) => JSON.parse(Buffer.from(v, 'base64').toString('utf8'));
const storedKeys = { AccessKeyId: FAKE.key, SecretAccessKey: FAKE.secret };
const storeKeys = (s, name = 'dev') => s.keychain.set(name, Buffer.from(JSON.stringify(storedKeys)).toString('base64'));

// R3: the fake key, secret and session token appear in no child argv and no tool result (the children's
// own stdout and the Keychain stdin carry them by design). The code appears only as the --token-code
// value of a get-session-token child.
function sweep(s, results, { code } = {}) {
  const argvs = [...s.calls.osascript.map((c) => c.args), ...s.calls.security.map((c) => c.args), ...s.calls.op, ...s.calls.aws.map((c) => c.argv)];
  const argvText = JSON.stringify(argvs);
  for (const v of [FAKE.key, FAKE.secret, FAKE.token, FAKE.sessKey, FAKE.sessSecret]) {
    assert.ok(!argvText.includes(v), `argv leaks ${v.slice(0, 8)}`);
    for (const r of results) assert.ok(!text(r).includes(v), `result leaks ${v.slice(0, 8)}`);
  }
  assert.ok(!argvs.some((a) => a.some((x) => x.includes(SENTINEL))));
  for (const r of results) assert.ok(!text(r).includes(SENTINEL), 'result carries raw stderr');
  if (code) {
    const codes = [CODE, CODE2];
    for (const c of s.calls.aws) {
      const i = c.argv.indexOf('--token-code');
      const holders = c.argv.filter((x) => codes.some((k) => x.includes(k)));
      if (c.argv[1] === 'get-session-token') assert.deepEqual(holders, [c.argv[i + 1]]);
      else assert.deepEqual(holders, []);
    }
    for (const k of codes) {
      assert.ok(!JSON.stringify([s.calls.osascript, s.calls.security, s.calls.op]).includes(k));
      for (const r of results) assert.ok(!text(r).includes(k), 'result carries the code');
    }
  }
}

test('A3.2: schema requires only profile; region, account, otp_item and the rest are optional, and no key, secret or code field', () => {
  assert.equal(login.name, 'login');
  assert.deepEqual(Object.keys(login.inputSchema.properties).sort(), ['account', 'item', 'label', 'mfa_serial', 'otp_item', 'profile', 'region', 'vault']);
  assert.deepEqual(login.inputSchema.required, ['profile']);
  assert.equal(login.inputSchema.additionalProperties, false);
  for (const k of Object.keys(login.inputSchema.properties)) assert.doesNotMatch(k, /key|secret|code|token|password/i);
  assert.equal(login.annotations.readOnlyHint, false);
});

test('A3.1/A3.5/A3.6/A4.5: no stored keys -> two hidden dialogs, one Keychain item, verified, no MFA call, expiry none', async () => {
  const s = setup();
  s.answers.push(FAKE.key, FAKE.secret);
  const r = await s.run();
  assert.equal(r.isError, undefined);
  assert.equal(first(r), 'profile dev · account 123456789012 · region us-east-1');
  assert.equal(s.calls.osascript.length, 2);
  for (const c of s.calls.osascript) {
    assert.equal(c.file, 'osascript');
    assert.match(c.args[1], /with hidden answer/);
  }
  assert.match(s.calls.osascript[0].args[1], /Access Key ID/);
  assert.match(s.calls.osascript[1].args[1], /Secret Access Key/);
  const w = s.writes();
  assert.equal(w.length, 1);
  assert.match(w[0].stdin, /^add-generic-password -U -s readonly-aws -a "dev" -w "[A-Za-z0-9+/=]+"\n$/);
  assert.deepEqual(unb64(w[0].value), storedKeys);
  assert.equal(s.calls.security.filter((c) => c.args.join(' ').includes('readonly-aws') && c.args[0] === '-i').length, 0, 'value never in argv');
  // verified with the keys only in the child env
  assert.equal(s.calls.aws.length, 1);
  assert.deepEqual(s.calls.aws[0].argv, ['sts', 'get-caller-identity', '--output', 'json']);
  assert.equal(s.calls.aws[0].env.AWS_ACCESS_KEY_ID, FAKE.key);
  assert.equal(s.calls.aws[0].env.AWS_SECRET_ACCESS_KEY, FAKE.secret);
  assert.equal(s.calls.aws[0].env.AWS_SESSION_TOKEN, undefined);
  assert.equal(s.mint().length, 0);
  assert.equal(s.profiles.get('dev').label, '123456789012');
  assert.equal(s.profiles.get('dev').op, false);
  assert.equal(await s.profiles.sessionStatus('dev'), 'none');
  assert.match(text(r), /session expiry: none/);
  assert.deepEqual([...s.store.keys()], ['dev']);
  sweep(s, [r]);
});

test('A3.1: Cancel on the first or the second dialog stores nothing and calls no aws', async () => {
  for (const answers of [[null], [FAKE.key, null]]) {
    const s = setup();
    s.answers.push(...answers);
    const r = await s.run();
    assert.equal(r.isError, true);
    assert.match(text(r), /canceled; nothing stored/);
    assert.equal(s.writes().length, 0);
    assert.equal(s.store.size, 0);
    assert.equal(s.calls.aws.length, 0);
    assert.equal(s.profiles.get('dev'), null);
    sweep(s, [r]);
  }
});

test('A3.3: a secret over the Keychain limit is refused, nothing is stored or truncated, no aws call', async () => {
  const s = setup();
  const big = 'S'.repeat(9000);
  s.answers.push(FAKE.key, big);
  const r = await s.run();
  assert.equal(r.isError, true);
  assert.match(text(r), /Keychain value is over 4000 bytes/);
  assert.equal(s.writes().length, 0);
  assert.equal(s.calls.security.some((c) => c.args[0] === '-i'), false);
  assert.equal(s.store.size, 0);
  assert.equal(s.calls.aws.length, 0);
  assert.ok(!text(r).includes(big));
});

test('A3.4: stored keys -> no dialog, the stored keys are used', async () => {
  const s = setup();
  await storeKeys(s);
  const r = await s.run();
  assert.equal(r.isError, undefined);
  assert.equal(s.calls.osascript.length, 0);
  assert.equal(s.writes().length, 1); // only the seeding write
  assert.equal(s.calls.aws[0].env.AWS_ACCESS_KEY_ID, FAKE.key);
  assert.equal(s.calls.aws[0].env.AWS_SECRET_ACCESS_KEY, FAKE.secret);
  assert.equal(first(r), 'profile dev · account 123456789012 · region us-east-1');
  sweep(s, [r]);
});

test('A3.5: failed verification deletes the keys just written; the error is fixed text plus the AWS code, never raw stderr', async () => {
  const s = setup();
  s.answers.push(FAKE.key, FAKE.secret);
  s.awsHandler = () => fail('InvalidClientTokenId', 'The security token included in the request is invalid.');
  const r = await s.run();
  assert.equal(r.isError, true);
  assert.match(text(r), /AWS rejected the keys \(InvalidClientTokenId\)/);
  assert.deepEqual(s.deletes(), ['dev']);
  assert.equal(s.store.size, 0);
  assert.equal(s.profiles.get('dev'), null);
  assert.equal(first(r), 'profile dev · account - · region us-east-1');
  sweep(s, [r]);
});

test('A3.5: failed verification of already stored keys does not delete them', async () => {
  const s = setup();
  await storeKeys(s);
  s.awsHandler = () => fail('InvalidClientTokenId', 'bad');
  const r = await s.run();
  assert.equal(r.isError, true);
  assert.deepEqual(s.deletes(), []);
  assert.ok(s.store.has('dev'));
});

test('A3.5: a given label is stored instead of the account id', async () => {
  const s = setup();
  s.answers.push(FAKE.key, FAKE.secret);
  const r = await s.run({ label: 'Acme prod' });
  assert.equal(r.isError, undefined);
  assert.equal(s.profiles.get('dev').label, 'Acme prod');
  assert.match(text(r), /label Acme prod/);
});

test('aws CLI missing: error says so, the just-written keys are deleted', async () => {
  const s = setup();
  s.answers.push(FAKE.key, FAKE.secret);
  s.ctx.exec = async () => {
    throw Object.assign(new Error('aws CLI not installed → aws:login installs it'), { code: 'ENOENT' });
  };
  const r = await s.run();
  assert.equal(r.isError, true);
  assert.ok(text(r).includes('aws CLI not installed → aws:login installs it'));
  assert.deepEqual(s.deletes(), ['dev']);
  assert.equal(s.store.size, 0);
});

test('bad arguments are refused before any child runs', async () => {
  const s = setup();
  for (const bad of [{ region: 'mars' }, { profile: 'Bad Name' }, { mfa_serial: 'not-an-arn' }, { vault: 'Private' }, { item: 'AWS' }, { label: '' }, { account: '12345' }, { account: 123456789012 }, { otp_item: 'AWS otp' }, { vault: 'Private', item: 'AWS', otp_item: '-x' }]) {
    const r = await s.run(bad);
    assert.equal(r.isError, true, JSON.stringify(bad));
  }
  assert.equal(s.calls.osascript.length + s.calls.aws.length + s.calls.security.length + s.calls.op.length, 0);
});

test('A4.1/A4.2/A4.4/A3.6: MFA via hidden dialog -> get-session-token argv, session cached as one value, returned Expiration shown', async () => {
  const s = setup();
  s.answers.push(FAKE.key, FAKE.secret, CODE);
  const r = await s.run({ mfa_serial: MFA });
  assert.equal(r.isError, undefined);
  assert.equal(s.calls.osascript.length, 3);
  assert.match(s.calls.osascript[2].args[1], /with hidden answer/);
  assert.match(s.calls.osascript[2].args[1], /MFA code/);
  assert.equal(s.mint().length, 1);
  assert.deepEqual(s.mint()[0].argv, ['sts', 'get-session-token', '--serial-number', MFA, '--token-code', CODE, '--duration-seconds', '129600', '--output', 'json']);
  // long-term keys only in the child env, never a session token on the mint call
  assert.equal(s.mint()[0].env.AWS_ACCESS_KEY_ID, FAKE.key);
  assert.equal(s.mint()[0].env.AWS_SESSION_TOKEN, undefined);
  const sess = s.writes().find((x) => x.account === 'dev:session');
  assert.ok(sess);
  assert.ok(Buffer.byteLength(sess.value) < 4000, `session value is ${Buffer.byteLength(sess.value)} bytes`);
  assert.deepEqual(unb64(sess.value), { AccessKeyId: FAKE.sessKey, SecretAccessKey: FAKE.sessSecret, SessionToken: FAKE.token, Expiration: EXP[129600] });
  assert.equal(await s.profiles.sessionStatus('dev'), EXP[129600]);
  assert.match(text(r), new RegExp(`session expiry: ${EXP[129600].replace('+', '\\+')}`));
  assert.equal(s.profiles.get('dev').mfa_serial, MFA);
  assert.equal(s.calls.sleep.length, 0);
  sweep(s, [r], { code: CODE });
});

test('A5.5/A4.1: the saved mfa_serial is used when login is repeated without it', async () => {
  const s = setup();
  await storeKeys(s);
  s.profiles.recordLogin('dev', { identity, region: 'us-east-1', mfa_serial: MFA });
  s.answers.push(CODE);
  const r = await s.run();
  assert.equal(r.isError, undefined);
  assert.equal(s.mint()[0].argv[3], MFA);
  assert.equal(s.calls.osascript.length, 1);
});

test('A4.3: duration refused -> 43200 then 3600; shows the returned Expiration; code reused unchanged', async () => {
  const s = setup();
  await storeKeys(s);
  s.answers.push(CODE);
  s.awsHandler = (argv) => {
    if (argv[1] === 'get-caller-identity') return done(identity);
    return durationOf(argv) === 3600 ? minted(3600) : fail('ValidationError', TOO_LONG);
  };
  const r = await s.run({ mfa_serial: MFA });
  assert.equal(r.isError, undefined);
  assert.deepEqual(s.mint().map((c) => durationOf(c.argv)), [129600, 43200, 3600]);
  assert.equal(await s.profiles.sessionStatus('dev'), EXP[3600]);
  assert.match(text(r), /2026-11-17T01:00:00/);
  assert.equal(s.calls.osascript.length, 1, 'one code dialog for the whole ladder');
  sweep(s, [r], { code: CODE });
});

test('A4.3: 43200 accepted stops the ladder; every duration refused gives a clear error and no cache', async () => {
  const s = setup();
  await storeKeys(s);
  s.answers.push(CODE);
  s.awsHandler = (argv) => (argv[1] === 'get-caller-identity' ? done(identity) : durationOf(argv) === 43200 ? minted(43200) : fail('ValidationError', TOO_LONG));
  assert.equal((await s.run({ mfa_serial: MFA })).isError, undefined);
  assert.deepEqual(s.mint().map((c) => durationOf(c.argv)), [129600, 43200]);

  const t = setup();
  await storeKeys(t);
  t.answers.push(CODE);
  t.awsHandler = (argv) => (argv[1] === 'get-caller-identity' ? done(identity) : fail('ValidationError', TOO_LONG));
  const r = await t.run({ mfa_serial: MFA });
  assert.equal(r.isError, true);
  assert.match(text(r), /refused every session length/);
  assert.deepEqual(t.mint().map((c) => durationOf(c.argv)), [129600, 43200, 3600]);
  assert.equal(t.store.has('dev:session'), false);
});

test('A4.3: a wrong code is not retried and is not a duration refusal (exactly one call, no cache)', async () => {
  const s = setup();
  await storeKeys(s);
  s.answers.push(CODE);
  s.awsHandler = (argv) => (argv[1] === 'get-caller-identity' ? done(identity) : fail('AccessDenied', BAD_CODE));
  const r = await s.run({ mfa_serial: MFA });
  assert.equal(r.isError, true);
  assert.equal(s.mint().length, 1);
  assert.equal(s.calls.sleep.length, 0);
  assert.equal(s.calls.osascript.length, 1, 'the dialog path never asks a second code');
  assert.match(text(r), /MFA code rejected/);
  assert.equal(s.store.has('dev:session'), false);
  sweep(s, [r], { code: CODE });
});

test('A4: a malformed code answer is refused before any get-session-token call; Cancel on the code dialog caches nothing', async () => {
  for (const answer of ['12ab', null]) {
    const s = setup();
    await storeKeys(s);
    s.answers.push(answer);
    const r = await s.run({ mfa_serial: MFA });
    assert.equal(r.isError, true);
    assert.equal(s.mint().length, 0);
    assert.equal(s.store.has('dev:session'), false);
  }
});

test('A5.1/A5.2: vault+item -> no key dialog, op argv exact, the reference lives in the entry (masked in the answer), nothing in Keychain', async () => {
  const s = setup();
  const r = await s.run({ vault: 'Private', item: 'AWS prod' });
  assert.equal(r.isError, undefined);
  assert.equal(s.calls.osascript.length, 0);
  assert.deepEqual(s.calls.op, [['item', 'get', 'AWS prod', '--vault', 'Private', '--format', 'json']]);
  assert.equal(s.calls.aws[0].env.AWS_ACCESS_KEY_ID, FAKE.key);
  assert.equal(s.calls.aws[0].env.AWS_SECRET_ACCESS_KEY, FAKE.secret);
  assert.deepEqual(s.writes(), [], 'no Keychain write at all: no <profile>:op item, no keys');
  assert.equal(s.store.has('dev'), false);
  assert.equal(s.store.has('dev:op'), false);
  assert.deepEqual(s.profiles.get('dev').op, { vault: 'Private', item: 'AWS prod' });
  assert.match(text(r), /op:\/\/\*\*\*\*\/\*\*\*\*/);
  assert.ok(!text(r).includes('Private') && !text(r).includes('AWS prod'));
  assert.match(text(r), /session expiry: none/);
  sweep(s, [r]);
});

test('A5.1/A5.5: op login with MFA reads the code with op --otp and mints the session', async () => {
  const s = setup();
  s.otps.push(CODE);
  const r = await s.run({ vault: 'Private', item: 'AWS prod', mfa_serial: MFA });
  assert.equal(r.isError, undefined);
  assert.equal(s.calls.osascript.length, 0);
  assert.deepEqual(s.calls.op[1], ['item', 'get', 'AWS prod', '--vault', 'Private', '--otp']);
  assert.deepEqual(s.mint()[0].argv, ['sts', 'get-session-token', '--serial-number', MFA, '--token-code', CODE, '--duration-seconds', '129600', '--output', 'json']);
  assert.equal(s.store.has('dev'), false);
  assert.ok(s.store.has('dev:session'));
  assert.match(text(r), /2026-11-18T12:00:00/);
  sweep(s, [r], { code: CODE });
});

test('A5.3: op missing -> the 1Password CLI is not installed, nothing stored, no aws call', async () => {
  const s = setup();
  s.opHandler = () => ({ error: Object.assign(new Error('spawn op ENOENT'), { code: 'ENOENT' }) });
  const r = await s.run({ vault: 'Private', item: 'AWS prod' });
  assert.equal(r.isError, true);
  assert.match(text(r), /1Password CLI \(op\) is not installed/);
  assert.equal(s.writes().length, 0);
  assert.equal(s.calls.aws.length, 0);
  assert.equal(s.profiles.get('dev'), null);
});

test('A5.4: op fails (signed out, item missing, field missing) -> error without values, nothing cached', async () => {
  const cases = [
    [() => ({ error: Object.assign(new Error('x'), { code: 1 }), stderr: `[ERROR] You are not currently signed in. ${SENTINEL} ${FAKE.secret}` }), /signed out/],
    [() => ({ error: Object.assign(new Error('x'), { code: 1 }), stderr: `"AWS prod" isn't an item ${SENTINEL} ${FAKE.secret}` }), /not found/],
    [() => ({ stdout: JSON.stringify({ fields: [{ label: 'Access Key ID', value: FAKE.key }] }) }), /needs 'username' \+ 'password'/],
  ];
  for (const [handler, re] of cases) {
    const s = setup();
    s.opHandler = handler;
    const r = await s.run({ vault: 'Private', item: 'AWS prod', mfa_serial: MFA });
    assert.equal(r.isError, true);
    assert.match(text(r), re);
    assert.equal(s.writes().length, 0);
    assert.equal(s.store.size, 0);
    assert.equal(s.calls.aws.length, 0);
    sweep(s, [r]);
  }
});

test('A5.5: op path, a reused code is rejected -> waits 30 s, fetches a fresh code, retries once', async () => {
  const s = setup();
  s.otps.push(CODE, CODE2);
  let n = 0;
  s.awsHandler = (argv) => {
    if (argv[1] === 'get-caller-identity') return done(identity);
    return ++n === 1 ? fail('AccessDenied', BAD_CODE) : minted(129600);
  };
  const r = await s.run({ vault: 'Private', item: 'AWS prod', mfa_serial: MFA });
  assert.equal(r.isError, undefined);
  assert.deepEqual(s.calls.sleep, [30000]);
  assert.equal(s.calls.op.filter((a) => a.includes('--otp')).length, 2);
  assert.deepEqual(s.mint().map((c) => c.argv[5]), [CODE, CODE2]);
  assert.ok(s.store.has('dev:session'));
  sweep(s, [r]);
});

test('A5.5: op path, rejected again after the window -> a clear error after exactly one retry, no cache', async () => {
  const s = setup();
  s.otps.push(CODE, CODE2);
  s.awsHandler = (argv) => (argv[1] === 'get-caller-identity' ? done(identity) : fail('AccessDenied', BAD_CODE));
  const r = await s.run({ vault: 'Private', item: 'AWS prod', mfa_serial: MFA });
  assert.equal(r.isError, true);
  assert.match(text(r), /rejected again after waiting out the 30 s window/);
  assert.equal(s.mint().length, 2);
  assert.deepEqual(s.calls.sleep, [30000]);
  assert.equal(s.store.has('dev:session'), false);
  sweep(s, [r]);
});

test('A5.5: op path, a non-MFA error from get-session-token is not retried and does not wait', async () => {
  const s = setup();
  s.otps.push(CODE);
  s.awsHandler = (argv) => (argv[1] === 'get-caller-identity' ? done(identity) : fail('AccessDenied', 'User is not authorized to perform sts:GetSessionToken'));
  const r = await s.run({ vault: 'Private', item: 'AWS prod', mfa_serial: MFA });
  assert.equal(r.isError, true);
  assert.match(text(r), /AWS refused the session request \(AccessDenied\)/);
  assert.equal(s.mint().length, 1);
  assert.equal(s.calls.sleep.length, 0);
});

test('op-backed profile logged in again without vault/item reuses the stored reference', async () => {
  const s = setup();
  await s.run({ vault: 'Private', item: 'AWS prod' });
  s.calls.op.length = 0;
  const r = await s.run();
  assert.equal(r.isError, undefined);
  assert.deepEqual(s.calls.op, [['item', 'get', 'AWS prod', '--vault', 'Private', '--format', 'json']]);
  assert.equal(s.calls.osascript.length, 0);
});

// --- saved fields, account check, otp_item (card 157 item 2) ------------------------------------

const REF = { vault: 'Private', item: 'AWS prod' };
const OTP_REF = { ...REF, otp_item: 'AWS otp' };
// The reference names (vault, item, otp item) never reach an answer; only the mask does.
function sweepRef(results) {
  for (const r of results) {
    for (const v of ['Private', 'AWS prod', 'AWS otp']) assert.ok(!text(r).includes(v), `answer leaks reference name ${v}`);
  }
}
const mintArgv = (code, serial = MFA) => ['sts', 'get-session-token', '--serial-number', serial, '--token-code', code, '--duration-seconds', '129600', '--output', 'json'];

test('A3.2: login {profile} with the saved region and Keychain keys asks nothing: no dialog, no MFA', async () => {
  const s = setup();
  s.profiles.upsert('dev', { region: 'ap-northeast-2', account: '123456789012' });
  await storeKeys(s);
  const r = await s.call({ profile: 'dev' });
  assert.equal(r.isError, undefined);
  assert.equal(first(r), 'profile dev · account 123456789012 · region ap-northeast-2');
  assert.equal(s.calls.osascript.length, 0);
  assert.equal(s.calls.aws[0].env.AWS_REGION, 'ap-northeast-2');
  assert.equal(s.mint().length, 0);
  assert.equal(s.profiles.get('dev').region, 'ap-northeast-2');
  sweep(s, [r]);
});

test('A3.2: login {profile} with the saved region and keys missing asks the two key dialogs; a saved MFA serial adds one for the code', async () => {
  const s = setup();
  s.profiles.upsert('dev', { region: 'ap-northeast-2' });
  s.answers.push(FAKE.key, FAKE.secret);
  const r = await s.call({ profile: 'dev' });
  assert.equal(r.isError, undefined);
  assert.equal(s.calls.osascript.length, 2);
  assert.equal(s.mint().length, 0);

  const m = setup();
  m.profiles.upsert('dev', { region: 'ap-northeast-2', mfa_serial: MFA });
  m.answers.push(FAKE.key, FAKE.secret, CODE);
  const r2 = await m.call({ profile: 'dev' });
  assert.equal(r2.isError, undefined);
  assert.equal(m.calls.osascript.length, 3);
  assert.match(m.calls.osascript[2].args[1], /MFA code/);
  assert.deepEqual(m.mint()[0].argv, mintArgv(CODE));
  assert.equal(m.mint()[0].env.AWS_REGION, 'ap-northeast-2');
  sweep(m, [r2], { code: CODE });
});

test('A3.2: an unknown profile with no region fails on region before any child runs', async () => {
  const s = setup();
  const r = await s.call({ profile: 'dev' });
  assert.equal(r.isError, true);
  assert.match(text(r), /region/);
  assert.equal(s.calls.osascript.length + s.calls.aws.length + s.calls.security.length + s.calls.op.length, 0);
  assert.equal(s.profilesJson(), null);
  const t = setup();
  const r2 = await t.call({ profile: 'dev', vault: 'Private', item: 'AWS prod' });
  assert.equal(r2.isError, true);
  assert.match(text(r2), /region/);
  assert.equal(t.calls.op.length + t.calls.aws.length, 0);
});

test('an explicit region wins over the saved one and is saved', async () => {
  const s = setup();
  s.profiles.upsert('dev', { region: 'eu-west-1' });
  await storeKeys(s);
  const r = await s.call({ profile: 'dev', region: 'us-east-1' });
  assert.equal(r.isError, undefined);
  assert.equal(s.calls.aws[0].env.AWS_REGION, 'us-east-1');
  assert.equal(s.profiles.get('dev').region, 'us-east-1');
});

test('A3.3: a saved account that is not the identity account is refused with both ids; nothing is minted, saved or kept', async () => {
  const s = setup();
  s.profiles.upsert('dev', { region: 'us-east-1', account: '999999999999', mfa_serial: MFA });
  const before = s.profilesJson();
  s.answers.push(FAKE.key, FAKE.secret);
  const r = await s.call({ profile: 'dev' });
  assert.equal(r.isError, true);
  assert.ok(text(r).includes('999999999999') && text(r).includes('123456789012'), 'names both ids');
  assert.equal(s.mint().length, 0, 'no get-session-token call');
  assert.equal(s.calls.osascript.length, 2, 'no MFA code was asked');
  assert.equal(s.profilesJson(), before, 'profiles.json byte-identical');
  assert.equal(s.store.has('dev:session'), false);
  assert.equal(s.store.has('dev'), false, 'the keys this call wrote are deleted');
  assert.deepEqual(s.deletes(), ['dev']);
  sweep(s, [r]);
});

test('A3.3: an account mismatch keeps keys that were already stored', async () => {
  const s = setup();
  s.profiles.upsert('dev', { region: 'us-east-1', account: '999999999999' });
  await storeKeys(s);
  const r = await s.call({ profile: 'dev' });
  assert.equal(r.isError, true);
  assert.deepEqual(s.deletes(), []);
  assert.ok(s.store.has('dev'));
  assert.equal(s.mint().length, 0);
});

test('A3.3: an explicit account that is not the identity account is refused for a new profile too', async () => {
  const s = setup();
  s.answers.push(FAKE.key, FAKE.secret);
  const r = await s.run({ account: '999999999999', mfa_serial: MFA });
  assert.equal(r.isError, true);
  assert.ok(text(r).includes('999999999999') && text(r).includes('123456789012'));
  assert.equal(s.mint().length, 0);
  assert.equal(s.profilesJson(), null);
  assert.equal(s.profiles.get('dev'), null);
  assert.deepEqual(s.deletes(), ['dev']);
});

test('A3.3: an account mismatch on the 1Password path writes nothing to Keychain or the profile file', async () => {
  const s = setup();
  s.profiles.upsert('dev', { region: 'us-east-1', account: '999999999999', vault: 'Private', item: 'AWS prod', otp_item: 'AWS otp', mfa_serial: MFA });
  const before = s.profilesJson();
  const r = await s.call({ profile: 'dev' });
  assert.equal(r.isError, true);
  assert.ok(text(r).includes('999999999999') && text(r).includes('123456789012'));
  assert.equal(s.mint().length, 0);
  assert.equal(s.calls.op.filter((a) => a.includes('--otp')).length, 0, 'no code was read');
  assert.deepEqual(s.writes(), []);
  assert.equal(s.profilesJson(), before);
  sweep(s, [r]);
  sweepRef([r]);
});

test('AC-1: a verified explicit account replaces a stale saved one and is saved; a matching saved account passes', async () => {
  const s = setup();
  s.profiles.upsert('dev', { region: 'us-east-1', account: '999999999999' });
  await storeKeys(s);
  const r = await s.call({ profile: 'dev', account: '123456789012' });
  assert.equal(r.isError, undefined);
  assert.equal(s.profiles.get('dev').account, '123456789012');

  const n = setup();
  n.answers.push(FAKE.key, FAKE.secret);
  const r2 = await n.run({ account: '123456789012' });
  assert.equal(r2.isError, undefined);
  assert.equal(n.profiles.get('dev').account, '123456789012');
  assert.equal(n.profiles.active(), 'dev');
});

test('AC-1: login {profile} reuses the saved reference, otp_item and MFA serial: op reads key item and otp item, session minted', async () => {
  const s = setup();
  s.profiles.upsert('dev', { region: 'ap-northeast-2', account: '123456789012', mfa_serial: MFA, ...OTP_REF });
  s.otps.push(CODE);
  const r = await s.call({ profile: 'dev' });
  assert.equal(r.isError, undefined);
  assert.equal(s.calls.osascript.length, 0);
  assert.deepEqual(s.calls.op, [
    ['item', 'get', 'AWS prod', '--vault', 'Private', '--format', 'json'],
    ['item', 'get', 'AWS otp', '--vault', 'Private', '--otp'],
  ]);
  assert.deepEqual(s.mint()[0].argv, mintArgv(CODE));
  assert.deepEqual(s.profiles.get('dev').op, OTP_REF, 'otp_item kept in the entry');
  assert.deepEqual(s.writes().map((w) => w.account), ['dev:session']);
  assert.match(text(r), /op:\/\/\*\*\*\*\/\*\*\*\*/);
  sweep(s, [r], { code: CODE });
  sweepRef([r]);
});

test('AC-1: an explicit otp_item is used and saved with the reference', async () => {
  const s = setup();
  s.otps.push(CODE);
  const r = await s.run({ ...REF, otp_item: 'AWS otp', mfa_serial: MFA });
  assert.equal(r.isError, undefined);
  assert.deepEqual(s.calls.op[1], ['item', 'get', 'AWS otp', '--vault', 'Private', '--otp']);
  assert.deepEqual(s.profiles.get('dev').op, OTP_REF);
  assert.deepEqual(s.writes().map((w) => w.account), ['dev:session']);

  // on a saved profile, otp_item alone replaces the saved one
  s.otps.push(CODE2);
  s.calls.op.length = 0;
  const r2 = await s.call({ profile: 'dev', otp_item: 'other otp' });
  assert.equal(r2.isError, undefined);
  assert.deepEqual(s.calls.op[1], ['item', 'get', 'other otp', '--vault', 'Private', '--otp']);
  assert.deepEqual(s.profiles.get('dev').op, { ...REF, otp_item: 'other otp' });
  sweepRef([r, r2]);
});

test('AC-2: otp_item without an mfa_serial asks for no code, raises no error and stays in the entry', async () => {
  const s = setup();
  const r = await s.run({ ...REF, otp_item: 'AWS otp' });
  assert.equal(r.isError, undefined);
  assert.equal(s.calls.op.filter((a) => a.includes('--otp')).length, 0);
  assert.equal(s.mint().length, 0);
  assert.deepEqual(s.profiles.get('dev').op, OTP_REF);
  assert.match(text(r), /session expiry: none/);
  sweepRef([r]);
});

test('a legacy op:true entry with its Keychain pointer is read through opRef, migrated into the entry, and the pointer is deleted', async () => {
  const s = setup();
  s.profiles.recordLogin('dev', { identity, region: 'us-east-1', op: true });
  await s.keychain.set('dev:op', Buffer.from(JSON.stringify(REF)).toString('base64'));
  s.calls.security.length = 0;
  const r = await s.call({ profile: 'dev' });
  assert.equal(r.isError, undefined);
  assert.deepEqual(s.calls.op, [['item', 'get', 'AWS prod', '--vault', 'Private', '--format', 'json']]);
  assert.deepEqual(s.profiles.get('dev').op, REF);
  assert.equal(s.store.has('dev:op'), false);
  assert.deepEqual(s.writes(), [], 'login never writes <profile>:op');
  assert.equal(s.calls.osascript.length, 0);
});

test('login reads the reference through profiles.opRef, once', async () => {
  const s = setup();
  s.profiles.upsert('dev', { region: 'us-east-1', ...REF });
  let n = 0;
  const real = s.profiles.opRef;
  s.profiles.opRef = async (name) => (n++, real(name));
  const r = await s.call({ profile: 'dev' });
  assert.equal(r.isError, undefined);
  assert.equal(n, 1);
  assert.equal(s.calls.op.length, 1);
});

test('R3: the new fields (account, otp_item, reference) never show a name or a value in any answer, success or error', async () => {
  const s = setup();
  s.otps.push(CODE);
  const ok1 = await s.run({ ...REF, otp_item: 'AWS otp', mfa_serial: MFA, account: '123456789012' });
  const bad = await s.run({ ...REF, otp_item: 'AWS otp', account: '999999999999' });
  s.opHandler = () => ({ error: Object.assign(new Error('x'), { code: 1 }), stderr: `"AWS otp" isn't an item in "Private" ${SENTINEL} ${FAKE.secret}` });
  const gone = await s.run({ ...REF, otp_item: 'AWS otp' });
  assert.equal(ok1.isError, undefined);
  assert.equal(bad.isError, true);
  assert.equal(gone.isError, true);
  sweepRef([ok1, bad, gone]);
  sweep(s, [ok1, bad, gone], { code: CODE });
});

// --- ensureSession -------------------------------------------------------------------------------

const seed =async (s, { op = false, mfa = true, session = EXP[129600], keys = !op } = {}) => {
  s.profiles.recordLogin('dev', { identity, label: 'Acme', region: 'eu-west-1', mfa_serial: mfa ? MFA : undefined, op: op ? { ...REF, ...(typeof op === 'object' ? op : {}) } : false });
  if (keys) await storeKeys(s);
  if (session) await s.profiles.setSession('dev', { AccessKeyId: FAKE.sessKey, SecretAccessKey: FAKE.sessSecret, SessionToken: FAKE.token, Expiration: session });
};
const quiet = (s) => assert.equal(s.calls.osascript.length + s.calls.op.length + s.calls.aws.length, 0);

test('ensureSession 1: a valid cached session is used (STS shape plus region), no child runs', async () => {
  const s = setup();
  await seed(s);
  const r = await ensureSession('dev', s.ctx);
  assert.deepEqual(r, { creds: { AccessKeyId: FAKE.sessKey, SecretAccessKey: FAKE.sessSecret, SessionToken: FAKE.token }, region: 'eu-west-1' });
  assert.equal(Object.hasOwn(r, 'error'), false);
  quiet(s);
});

test('ensureSession 2: no mfa_serial -> the stored long-term keys, no SessionToken, no child runs', async () => {
  const s = setup();
  await seed(s, { mfa: false, session: null });
  const r = await ensureSession('dev', s.ctx);
  assert.deepEqual(r, { creds: storedKeys, region: 'eu-west-1' });
  quiet(s);
});

test('ensureSession 3: op-backed with an expired session -> silent re-login through op (keys + otp), new session cached', async () => {
  const s = setup();
  await seed(s, { op: true, session: '2026-11-16T00:00:00+00:00' });
  s.otps.push(CODE);
  const r = await ensureSession('dev', s.ctx);
  assert.deepEqual(r, { creds: { AccessKeyId: FAKE.sessKey, SecretAccessKey: FAKE.sessSecret, SessionToken: FAKE.token }, region: 'eu-west-1' });
  assert.deepEqual(s.calls.op[0], ['item', 'get', 'AWS prod', '--vault', 'Private', '--format', 'json']);
  assert.deepEqual(s.calls.op[1], ['item', 'get', 'AWS prod', '--vault', 'Private', '--otp']);
  assert.equal(s.mint().length, 1);
  assert.equal(s.mint()[0].env.AWS_ACCESS_KEY_ID, FAKE.key);
  assert.equal(s.mint()[0].env.AWS_REGION, 'eu-west-1');
  assert.equal(s.calls.osascript.length, 0);
  assert.equal(await s.profiles.sessionStatus('dev'), EXP[129600]);
  assert.equal(s.writes().filter((w) => w.account === 'dev').length, 0, 'keys never written for the op path');
});

test('ensureSession 3: op-backed with no session at all, reused code -> waits 30 s, retries once; twice -> not-logged-in', async () => {
  const s = setup();
  await seed(s, { op: true, session: null });
  s.otps.push(CODE, CODE2);
  let n = 0;
  s.awsHandler = () => (++n === 1 ? fail('AccessDenied', BAD_CODE) : minted(129600));
  const r = await ensureSession('dev', s.ctx);
  assert.equal(r.creds.SessionToken, FAKE.token);
  assert.deepEqual(s.calls.sleep, [30000]);

  const t = setup();
  await seed(t, { op: true, session: null });
  t.otps.push(CODE, CODE2);
  t.awsHandler = () => fail('AccessDenied', BAD_CODE);
  const e = await ensureSession('dev', t.ctx);
  assert.match(e.error, /aws:login/);
  assert.match(e.error, /rejected again/);
  assert.equal(t.mint().length, 2);
  sweep(t, [{ content: [{ text: e.error }] }], { code: CODE });
});

test('ensureSession 3: op-backed profile without MFA reads the keys through op', async () => {
  const s = setup();
  await seed(s, { op: true, mfa: false, session: null });
  const r = await ensureSession('dev', s.ctx);
  assert.deepEqual(r, { creds: storedKeys, region: 'eu-west-1' });
  assert.equal(s.mint().length, 0);
});

test('ensureSession 3: op failures become a not-logged-in error naming aws:login, no values', async () => {
  const s = setup();
  await seed(s, { op: true, session: null });
  s.opHandler = () => ({ error: Object.assign(new Error('x'), { code: 1 }), stderr: `not currently signed in ${SENTINEL}` });
  const r = await ensureSession('dev', s.ctx);
  assert.match(r.error, /aws:login/);
  assert.match(r.error, /signed out/);
  assert.ok(!r.error.includes(SENTINEL));
});

test('ensureSession 3: reads the reference through profiles.opRef and passes otp_item to op.otp; no account check (no get-caller-identity)', async () => {
  const s = setup();
  await seed(s, { op: { otp_item: 'AWS otp' }, session: null });
  let n = 0;
  const real = s.profiles.opRef;
  s.profiles.opRef = async (name) => (n++, real(name));
  s.otps.push(CODE);
  // the keys now belong to another account than the saved one: ensure does not look
  s.awsHandler = (argv) => (argv[1] === 'get-caller-identity' ? done({ ...identity, Account: '999999999999' }) : minted(129600));
  const r = await ensureSession('dev', s.ctx);
  assert.equal(r.creds.SessionToken, FAKE.token);
  assert.equal(n, 1);
  assert.deepEqual(s.calls.op, [
    ['item', 'get', 'AWS prod', '--vault', 'Private', '--format', 'json'],
    ['item', 'get', 'AWS otp', '--vault', 'Private', '--otp'],
  ]);
  assert.deepEqual(s.calls.aws.map((c) => c.argv[1]), ['get-session-token']);
  assert.equal(s.profiles.get('dev').account, '123456789012');
  assert.equal(s.writes().filter((w) => w.account === 'dev:op').length, 0);
});

test('ensureSession 3: a legacy op:true entry is read through opRef and migrated; no <profile>:op write', async () => {
  const s = setup();
  s.profiles.recordLogin('dev', { identity, label: 'Acme', region: 'eu-west-1', mfa_serial: MFA, op: true });
  await s.keychain.set('dev:op', Buffer.from(JSON.stringify(REF)).toString('base64'));
  s.calls.security.length = 0;
  s.otps.push(CODE);
  const r = await ensureSession('dev', s.ctx);
  assert.equal(r.creds.SessionToken, FAKE.token);
  assert.deepEqual(s.calls.op[1], ['item', 'get', 'AWS prod', '--vault', 'Private', '--otp']);
  assert.deepEqual(s.profiles.get('dev').op, REF);
  assert.equal(s.store.has('dev:op'), false);
  assert.equal(s.writes().filter((w) => w.account === 'dev:op').length, 0);
});

test('ensureSession 4: not logged in -> an error naming aws:login (unknown profile, no keys, no session, expired session)', async () => {
  const unknown = setup();
  assert.match((await ensureSession('nope', unknown.ctx)).error, /aws:login/);

  const noKeys = setup();
  await seed(noKeys, { mfa: false, session: null, keys: false });
  assert.match((await ensureSession('dev', noKeys.ctx)).error, /aws:login/);

  const noSession = setup();
  await seed(noSession, { session: null });
  assert.match((await ensureSession('dev', noSession.ctx)).error, /aws:login/);

  const expired = setup();
  await seed(expired, { session: '2026-11-16T00:00:00+00:00' });
  const r = await ensureSession('dev', expired.ctx);
  assert.match(r.error, /aws:login/);
  assert.equal(Object.hasOwn(r, 'creds'), false);
  quiet(expired);
});

test('ensureSession: concurrent silent re-logins for one profile share one op code', async () => {
  const s = setup();
  await seed(s, { op: true, session: null });
  s.otps.push(CODE, CODE2);
  const [a, b] = await Promise.all([ensureSession('dev', s.ctx), ensureSession('dev', s.ctx)]);
  assert.deepEqual(a, b);
  assert.equal(s.mint().length, 1);
  assert.equal(s.calls.op.filter((x) => x.includes('--otp')).length, 1);
});

test('R3: a full dialog + MFA login, an op + MFA login and a silent re-login leak no key, secret, token or code', async () => {
  const s = setup();
  s.answers.push(FAKE.key, FAKE.secret, CODE);
  const results = [await s.run({ mfa_serial: MFA })];
  sweep(s, results, { code: CODE });

  const o = setup();
  o.otps.push(CODE, CODE2, CODE, CODE2);
  let n = 0;
  o.awsHandler = (argv) => (argv[1] === 'get-caller-identity' ? done(identity) : ++n === 1 ? fail('AccessDenied', BAD_CODE) : minted(129600));
  const r1 = await o.run({ vault: 'Private', item: 'AWS prod', mfa_serial: MFA });
  await o.profiles.setSession('dev', { AccessKeyId: 'x', SecretAccessKey: 'y', SessionToken: 'z', Expiration: '2026-11-16T00:00:00+00:00' });
  const r2 = await ensureSession('dev', o.ctx);
  const r3 = await o.run({ vault: 'Private', item: 'AWS prod' });
  // ensureSession hands creds to the query side by design; only login answers are user-visible.
  assert.equal(r2.creds.SessionToken, FAKE.token);
  assert.equal(r1.isError, undefined);
  assert.equal(r3.isError, undefined);
  sweep(o, [r1, r3], { code: true });
});
