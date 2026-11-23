import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { createProfiles, configDir, assertName, assertRegion, assertLabel, assertSerial, assertAccount, assertOpRef, isOpRef, maskRef, profileTool, profileSaveTool, NAME_RE, REGION_RE, SERIAL_RE, ACCOUNT_RE } from '../profiles.mjs';
import { createKeychain } from '../keychain.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'awsro-prof-'));
const FAKE = { key: 'AKIAFAKEFAKEFAKE0000', secret: 'fakeSecretAccessKeyFake0000000000000000', token: 'fakeSessionTokenFakeFakeFake' };
const session = (Expiration) => ({ AccessKeyId: FAKE.key, SecretAccessKey: FAKE.secret, SessionToken: FAKE.token, Expiration });
const MFA = 'arn:aws:iam::123456789012:mfa/fake-user';
const NOW = Date.parse('2026-11-17T00:00:00Z');
const FUTURE = '2026-11-18T12:00:00+00:00';
const PAST = '2026-11-16T12:00:00+00:00';

// `security` stub backed by a Map; records argv and stdin of every call.
function fakeSecurity() {
  const store = new Map();
  const calls = [];
  const run = async (args, stdin) => {
    calls.push({ args, stdin });
    const acct = (args.includes('-a') ? args[args.indexOf('-a') + 1] : (/-a "((?:[^"\\]|\\.)*)"/.exec(stdin ?? '') || [])[1]);
    if (args[0] === '-i') {
      store.set(acct, (/-w "((?:[^"\\]|\\.)*)"/.exec(stdin) || [])[1].replace(/\\(.)/g, '$1'));
      return { code: 0, stdout: '', stderr: '' };
    }
    if (args[0] === 'find-generic-password') return store.has(acct) ? { code: 0, stdout: store.get(acct) + '\n', stderr: '' } : { code: 44, stdout: '', stderr: '' };
    if (args[0] === 'delete-generic-password') return store.delete(acct) ? { code: 0, stdout: '', stderr: '' } : { code: 44, stdout: '', stderr: '' };
    return { code: 1, stdout: '', stderr: 'unknown' };
  };
  return { store, calls, keychain: createKeychain({ run }) };
}
function setup() {
  const dir = tmp();
  const sec = fakeSecurity();
  const profiles = createProfiles({ dir, keychain: sec.keychain, now: () => NOW });
  return { dir, sec, profiles, ctx: { profiles, keychain: sec.keychain, exec: null, env: {} } };
}
const text = (r) => r.content[0].text;

test('configDir is AWSRO_CONFIG_DIR, else under the home config folder', () => {
  assert.equal(configDir({ AWSRO_CONFIG_DIR: '/x/y' }), '/x/y');
  assert.equal(configDir({}), join(homedir(), '.config', 'aws-readonly-mcp'));
});

test('assertName accepts [a-z0-9_-]{1,32} and refuses the rest', () => {
  for (const ok of ['dev', 'a', 'prod-2_x', 'x'.repeat(32)]) assert.equal(assertName(ok), ok);
  for (const bad of ['Dev', 'my profile', 'a/b', '..', '', 'x'.repeat(33), 'a:b', null, undefined, 5]) assert.throws(() => assertName(bad), /profile name/, String(bad));
});

test('maskRef shows op://****/**** for any input', () => {
  assert.equal(maskRef('op://Employee/AWS prod/key'), 'op://****/****');
  assert.equal(maskRef(), 'op://****/****');
});

test('recordLogin saves the profile with account from the identity and the label defaulting to it', () => {
  const { profiles, dir } = setup();
  const e = profiles.recordLogin('dev', { identity: { Account: '123456789012', Arn: 'arn:aws:iam::123456789012:user/u' }, region: 'us-east-1' });
  assert.deepEqual(e, { name: 'dev', region: 'us-east-1', label: '123456789012', account: '123456789012', op: false });
  const l = profiles.recordLogin('prod', { identity: { Account: '999999999999' }, label: 'Acme prod', region: 'eu-west-1', mfa_serial: MFA, op: true });
  assert.deepEqual(l, { name: 'prod', region: 'eu-west-1', label: 'Acme prod', account: '999999999999', mfa_serial: MFA, op: true });
  assert.equal(statSync(join(dir, 'profiles.json')).mode & 0o777, 0o600);
  assert.equal(statSync(dir).mode & 0o777, 0o700);
  assert.deepEqual(profiles.get('prod'), l);
  assert.equal(profiles.get('nope'), null);
});

test('a later login keeps the label and settings of the same account', () => {
  const { profiles } = setup();
  profiles.recordLogin('prod', { identity: { Account: '999999999999' }, label: 'Acme prod', region: 'eu-west-1', mfa_serial: MFA, op: true });
  const e = profiles.recordLogin('prod', { identity: { Account: '999999999999' } });
  assert.equal(e.label, 'Acme prod');
  assert.equal(e.region, 'eu-west-1');
  assert.equal(e.mfa_serial, MFA);
  assert.equal(e.op, true);
});

test('recordLogin refuses a bad name, a missing identity or a missing region', () => {
  const { profiles } = setup();
  assert.throws(() => profiles.recordLogin('Bad Name', { identity: { Account: '1' }, region: 'us-east-1' }), /profile name/);
  assert.throws(() => profiles.recordLogin('dev', { region: 'us-east-1' }), /identity/);
  assert.throws(() => profiles.recordLogin('dev', { identity: { Account: '1' } }), /region/);
});

test('session cache: the session JSON goes to Keychain base64-encoded and reads back', async () => {
  const { profiles, sec } = setup();
  const s = session(FUTURE);
  await profiles.setSession('dev', s);
  const line = sec.calls.find((c) => c.args[0] === '-i').stdin;
  assert.match(line, /-a "dev:session"/);
  const value = /-w "(.*)"\n$/.exec(line)[1];
  assert.doesNotMatch(value, /[{}"\\ ]/);
  assert.deepEqual(JSON.parse(Buffer.from(value, 'base64').toString('utf8')), s);
  assert.deepEqual(await profiles.getSession('dev'), s);
  assert.equal(await profiles.getSession('prod'), null);
});

test('getSession returns null for a value that is not a session', async () => {
  const { profiles, sec } = setup();
  await sec.keychain.set('dev:session', 'not-base64-json!');
  assert.equal(await profiles.getSession('dev'), null);
});

test('sessionStatus: Expiration while valid, expired after, none without an MFA serial', async () => {
  const { profiles } = setup();
  profiles.recordLogin('nomfa', { identity: { Account: '1' }, region: 'us-east-1' });
  profiles.recordLogin('mfa', { identity: { Account: '2' }, region: 'us-east-1', mfa_serial: MFA });
  assert.equal(await profiles.sessionStatus('nomfa'), 'none');
  assert.equal(await profiles.sessionStatus('mfa'), 'expired'); // MFA profile, nothing cached
  await profiles.setSession('mfa', session(FUTURE));
  assert.equal(await profiles.sessionStatus('mfa'), FUTURE);
  await profiles.setSession('mfa', session(PAST));
  assert.equal(await profiles.sessionStatus('mfa'), 'expired');
  await assert.rejects(profiles.sessionStatus('ghost'), /unknown profile/);
});

test('profile with no name lists each profile: name, label, account, region, keys, expiry, active marker', async () => {
  const { profiles, ctx } = setup();
  profiles.recordLogin('dev', { identity: { Account: '123456789012' }, label: 'Acme dev', region: 'us-east-1' });
  profiles.recordLogin('prod', { identity: { Account: '999999999999' }, label: 'Acme prod', region: 'eu-west-1', mfa_serial: MFA, op: true });
  profiles.setActive('prod');
  await profiles.setSession('prod', session(FUTURE));
  const r = await profileTool.handler({}, ctx);
  assert.equal(r.isError, undefined);
  const lines = text(r).split('\n');
  assert.equal(lines[0], 'profile prod · account 999999999999 · region eu-west-1');
  assert.equal(lines.length, 3);
  const dev = lines.slice(1).find((l) => l.includes('dev ·'));
  const prod = lines.slice(1).find((l) => l.includes('prod ·'));
  assert.match(dev, /^ {2}dev · Acme dev · 123456789012 · us-east-1 · password none · expiry none$/);
  assert.match(prod, /^\* prod · Acme prod · 999999999999 · eu-west-1 · password none · expiry 2026-11-18T12:00:00\+00:00 · active$/);
});

test('profile with no profiles saved says so', async () => {
  const { ctx } = setup();
  const r = await profileTool.handler({}, ctx);
  assert.equal(text(r).split('\n')[0], 'profile - · account - · region -');
  assert.match(text(r), /no profiles/);
});

test('profile with a known name switches, persists, and names profile, account and region', async () => {
  const { profiles, ctx, dir, sec } = setup();
  profiles.recordLogin('dev', { identity: { Account: '123456789012' }, region: 'us-east-1' });
  profiles.recordLogin('prod', { identity: { Account: '999999999999' }, region: 'eu-west-1' });
  profiles.setActive('dev');
  const r = await profileTool.handler({ name: 'prod' }, ctx);
  assert.equal(r.isError, undefined);
  assert.equal(text(r).split('\n')[0], 'profile prod · account 999999999999 · region eu-west-1');
  assert.equal(profiles.active(), 'prod');
  assert.equal(statSync(join(dir, 'state.json')).mode & 0o777, 0o600);
  // restart: a new instance on the same dir reads the same active profile
  const again = createProfiles({ dir, keychain: sec.keychain });
  assert.equal(again.active(), 'prod');
  assert.deepEqual(again.list().map((p) => p.name), ['dev', 'prod']);
});

test('profile with an unknown name is an error that lists the known names and changes nothing', async () => {
  const { profiles, ctx } = setup();
  profiles.recordLogin('dev', { identity: { Account: '1' }, region: 'us-east-1' });
  profiles.recordLogin('prod', { identity: { Account: '2' }, region: 'us-east-1' });
  profiles.setActive('dev');
  const r = await profileTool.handler({ name: 'stage' }, ctx);
  assert.equal(r.isError, true);
  assert.match(text(r), /unknown profile "stage"; known: dev, prod/);
  assert.equal(profiles.active(), 'dev');
});

test('profile with a name outside [a-z0-9_-]{1,32} is refused', async () => {
  const { ctx } = setup();
  const r = await profileTool.handler({ name: '../etc' }, ctx);
  assert.equal(r.isError, true);
  assert.match(text(r), /profile name/);
});

test('setActive writes state.json and refuses an unknown profile', () => {
  const { profiles, dir } = setup();
  profiles.recordLogin('dev', { identity: { Account: '1' }, region: 'us-east-1' });
  profiles.setActive('dev');
  assert.equal(JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8')).active, 'dev');
  assert.throws(() => profiles.setActive('ghost'), /unknown profile/);
});

test('the first login makes its profile active when none is', () => {
  const { profiles } = setup();
  assert.equal(profiles.active(), null);
  profiles.recordLogin('dev', { identity: { Account: '1' }, region: 'us-east-1' });
  assert.equal(profiles.active(), 'dev');
  profiles.recordLogin('prod', { identity: { Account: '2' }, region: 'us-east-1' });
  assert.equal(profiles.active(), 'dev');
});

test('profile tool is read-only compatible and never calls security or the aws CLI (R3)', async () => {
  const { profiles, ctx, sec } = setup();
  assert.equal(profileTool.name, 'profile');
  assert.equal(profileTool.annotations.readOnlyHint, true);
  profiles.recordLogin('prod', { identity: { Account: '999999999999' }, label: 'Acme prod', region: 'eu-west-1', mfa_serial: MFA, op: true });
  await profiles.setSession('prod', session(FUTURE));
  sec.calls.length = 0;
  const out = [text(await profileTool.handler({}, ctx)), text(await profileTool.handler({ name: 'prod' }, ctx)), text(await profileTool.handler({ name: 'zzz' }, ctx))].join('\n');
  for (const v of Object.values(FAKE)) assert.equal(out.includes(v), false, v);
  assert.equal(out.includes('op://Employee'), false);
  // listing reads only the session item; nothing is written or deleted
  assert.ok(sec.calls.every((c) => c.args[0] === 'find-generic-password'));
  assert.equal(JSON.stringify(sec.calls.map((c) => c.args)).includes(FAKE.secret), false);
});

// ---- F2: validators, upsert, opRef, keySource, merge-safe recordLogin, profile_save ----
const REF = { vault: 'Personal', item: 'AWS stage', otp_item: 'AWS console' };
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64');
const raw = (dir) => readFileSync(join(dir, 'profiles.json'), 'utf8');
const ID = (Account) => ({ identity: { Account } });

test('validators: regexes, wording of login, label trimmed, op ref shape', () => {
  assert.ok(NAME_RE.test('a') && REGION_RE.test('ap-northeast-2') && SERIAL_RE.test(MFA) && ACCOUNT_RE.test('123456789012'));
  assert.equal(assertRegion('us-east-1'), 'us-east-1');
  assert.throws(() => assertRegion('Seoul'), /region must look like us-east-1/);
  assert.throws(() => assertRegion(undefined), /region must look like us-east-1/);
  assert.equal(assertSerial(MFA), MFA);
  assert.throws(() => assertSerial('nope'), /mfa_serial must be an MFA device ARN/);
  assert.equal(assertAccount('123456789012'), '123456789012');
  for (const bad of ['12345', '1234567890123', 'abcdefghijkl', 123456789012, '']) assert.throws(() => assertAccount(bad), /account must be 12 digits/, String(bad));
  assert.equal(assertLabel('  Acme  '), 'Acme');
  for (const bad of ['', '   ', 'x'.repeat(65), 'a\nb', 'a\x00b', 5]) assert.throws(() => assertLabel(bad), /label must be 1-64 printable characters/, String(bad));
  assert.deepEqual(assertOpRef({ vault: 'V', item: 'I' }), { vault: 'V', item: 'I' });
  assert.deepEqual(assertOpRef(REF), REF);
  for (const bad of [{ vault: 'V' }, { item: 'I' }, { vault: 'V', item: 'I', otp_item: '' }, { vault: '', item: 'I' }, { otp_item: 'O' }, null, 'op://V/I', true])
    assert.throws(() => assertOpRef(bad), /1Password/, JSON.stringify(bad));
  assert.equal(isOpRef(REF), true);
  assert.equal(isOpRef({ vault: 'V' }), false);
  assert.equal(isOpRef(true), false);
});

test('upsert creates a profile with no key field; name and region are required', () => {
  const { profiles, dir } = setup();
  const e = profiles.upsert('stage', { label: 'Acme stage', account: '111122223333', region: 'ap-northeast-2', mfa_serial: MFA });
  assert.deepEqual(e, { name: 'stage', region: 'ap-northeast-2', label: 'Acme stage', account: '111122223333', mfa_serial: MFA });
  assert.deepEqual(profiles.get('stage'), e);
  assert.equal(statSync(join(dir, 'profiles.json')).mode & 0o777, 0o600);
  assert.doesNotMatch(raw(dir), /key|secret|token|session/i);
  assert.throws(() => profiles.upsert('nor', { account: '111122223333' }), /region must look like/);
  assert.throws(() => profiles.upsert('nor', { region: null }), /region must look like/);
  assert.throws(() => profiles.upsert('Bad Name', { region: 'us-east-1' }), /profile name/);
  assert.equal(profiles.get('nor'), null);
});

test('upsert: undefined keeps a saved field, null removes it, a value replaces it', () => {
  const { profiles } = setup();
  profiles.upsert('p', { label: 'L', account: '111122223333', region: 'us-east-1', mfa_serial: MFA, vault: 'V', item: 'I', otp_item: 'O' });
  assert.deepEqual(profiles.upsert('p', { region: 'eu-west-1' }), { name: 'p', region: 'eu-west-1', label: 'L', account: '111122223333', mfa_serial: MFA, op: { vault: 'V', item: 'I', otp_item: 'O' } });
  assert.deepEqual(profiles.upsert('p', { mfa_serial: null, label: null }), { name: 'p', region: 'eu-west-1', account: '111122223333', op: { vault: 'V', item: 'I', otp_item: 'O' } });
  assert.deepEqual(profiles.upsert('p', { otp_item: null }).op, { vault: 'V', item: 'I' });
  assert.deepEqual(profiles.upsert('p', { item: 'I2' }).op, { vault: 'V', item: 'I2' });
  assert.equal(profiles.upsert('p', { account: null }).account, undefined);
  assert.equal('op' in profiles.upsert('p', { vault: null }), false);
  profiles.upsert('q', { region: 'us-east-1', vault: 'V', item: 'I' });
  assert.equal('op' in profiles.upsert('q', { item: null }), false);
});

test('upsert: vault and item come together, otp_item only with item', () => {
  const { profiles, dir } = setup();
  assert.throws(() => profiles.upsert('p', { region: 'us-east-1', vault: 'V' }), /vault and item/);
  assert.throws(() => profiles.upsert('p', { region: 'us-east-1', item: 'I' }), /vault and item/);
  assert.throws(() => profiles.upsert('p', { region: 'us-east-1', otp_item: 'O' }), /otp_item/);
  assert.throws(() => profiles.upsert('p', { region: 'us-east-1', vault: 'V', item: null }), /vault and item/);
  assert.equal(profiles.names().length, 0);
  profiles.upsert('p', { region: 'us-east-1', vault: 'V', item: 'I' });
  const before = raw(dir);
  assert.throws(() => profiles.upsert('p', { vault: null, item: 'X' }), /vault and item/);
  assert.equal(raw(dir), before);
});

test('upsert refuses a bad value and leaves profiles.json byte-identical', () => {
  const { profiles, dir } = setup();
  profiles.upsert('a', { label: 'A', account: '111122223333', region: 'us-east-1' });
  const before = raw(dir);
  for (const bad of [{ account: '12' }, { region: 'Seoul' }, { mfa_serial: 'x' }, { label: 'x'.repeat(65) }, { label: '' }, { vault: 'V', item: 'I', otp_item: 'a\nb' }, { account: 5 }]) {
    assert.throws(() => profiles.upsert('a', bad), Error, JSON.stringify(bad));
    assert.throws(() => profiles.upsert('b', { region: 'us-east-1', ...bad }), Error, JSON.stringify(bad));
    assert.equal(raw(dir), before, JSON.stringify(bad));
  }
});

test('saving b leaves a byte-identical; entry keys stay within name/label/account/region/mfa_serial/op', () => {
  const { profiles, dir } = setup();
  profiles.upsert('a', { label: 'A', account: '111122223333', region: 'us-east-1', mfa_serial: MFA, vault: 'V', item: 'I' });
  const aBefore = JSON.stringify(JSON.parse(raw(dir)).profiles.a);
  profiles.upsert('b', { region: 'eu-west-1', label: 'B' });
  const file = JSON.parse(raw(dir));
  assert.equal(JSON.stringify(file.profiles.a), aBefore);
  const allowed = new Set(['name', 'label', 'account', 'region', 'mfa_serial', 'op']);
  for (const e of Object.values(file.profiles)) for (const k of Object.keys(e)) assert.ok(allowed.has(k), k);
  assert.deepEqual(Object.keys(file), ['profiles']);
});

test('the first saved profile becomes active; an update or a second profile does not switch', () => {
  const { profiles } = setup();
  assert.equal(profiles.active(), null);
  profiles.upsert('a', { region: 'us-east-1' });
  assert.equal(profiles.active(), 'a');
  profiles.upsert('b', { region: 'us-east-1' });
  assert.equal(profiles.active(), 'a');
  profiles.setActive('b');
  profiles.upsert('a', { label: 'A2' });
  assert.equal(profiles.active(), 'b');
});

test('recordLogin keeps a saved label, account, mfa_serial and op object', () => {
  const { profiles } = setup();
  profiles.upsert('p', { label: 'Acme', account: '111122223333', region: 'us-east-1', mfa_serial: MFA, vault: 'V', item: 'I', otp_item: 'O' });
  const e = profiles.recordLogin('p', { ...ID('111122223333') });
  assert.deepEqual(e, { name: 'p', region: 'us-east-1', label: 'Acme', account: '111122223333', mfa_serial: MFA, op: { vault: 'V', item: 'I', otp_item: 'O' } });
  // a boolean op, true or false, never replaces a saved object
  assert.deepEqual(profiles.recordLogin('p', { ...ID('111122223333'), op: true }).op, { vault: 'V', item: 'I', otp_item: 'O' });
  assert.deepEqual(profiles.recordLogin('p', { ...ID('111122223333'), op: false }).op, { vault: 'V', item: 'I', otp_item: 'O' });
  // an object replaces it; with no saved object a boolean is stored as before
  assert.deepEqual(profiles.recordLogin('p', { ...ID('111122223333'), op: { vault: 'V2', item: 'I2' } }).op, { vault: 'V2', item: 'I2' });
  const { profiles: p2 } = setup();
  assert.equal(p2.recordLogin('n', { ...ID('1'), region: 'us-east-1' }).op, false);
  assert.equal(p2.recordLogin('n', { ...ID('1'), op: true }).op, true);
});

test('recordLogin refuses a saved account that differs from the identity and leaves the entry unchanged', () => {
  const { profiles, dir } = setup();
  profiles.upsert('p', { label: 'Acme', account: '111122223333', region: 'us-east-1' });
  const before = raw(dir);
  assert.throws(() => profiles.recordLogin('p', { identity: { Account: '999999999999' }, label: 'Other' }), /account mismatch.*111122223333.*999999999999/);
  assert.equal(raw(dir), before);
  // a profile saved without an account takes the identity's
  profiles.upsert('q', { region: 'us-east-1', label: 'Q' });
  assert.equal(profiles.recordLogin('q', ID('999999999999')).account, '999999999999');
});

test('opRef returns a saved object, null when none, and never touches Keychain for them', async () => {
  const { profiles, sec } = setup();
  profiles.upsert('o', { region: 'us-east-1', vault: 'V', item: 'I', otp_item: 'O' });
  profiles.upsert('n', { region: 'us-east-1' });
  assert.deepEqual(await profiles.opRef('o'), { vault: 'V', item: 'I', otp_item: 'O' });
  assert.equal(await profiles.opRef('n'), null);
  assert.equal(await profiles.opRef('ghost'), null);
  assert.equal(sec.calls.length, 0);
});

test('opRef migrates a legacy op:true entry once: entry written, then the Keychain item deleted', async () => {
  const { profiles, sec, dir } = setup();
  profiles.recordLogin('old', { ...ID('111122223333'), region: 'us-east-1', op: true });
  await sec.keychain.set('old:op', b64({ vault: 'V', item: 'I' }));
  sec.calls.length = 0;
  assert.equal(profiles.get('old').op, true);
  assert.deepEqual(await profiles.opRef('old'), { vault: 'V', item: 'I' });
  assert.deepEqual(JSON.parse(raw(dir)).profiles.old.op, { vault: 'V', item: 'I' });
  assert.equal(sec.store.has('old:op'), false);
  assert.deepEqual(sec.calls.map((c) => c.args[0]), ['find-generic-password', 'delete-generic-password']);
  sec.calls.length = 0;
  assert.deepEqual(await profiles.opRef('old'), { vault: 'V', item: 'I' });
  assert.equal(sec.calls.length, 0);
});

test('opRef writes the entry before it deletes the Keychain item', async () => {
  const dir = tmp();
  const sec = fakeSecurity();
  let atDelete = null;
  const keychain = { ...sec.keychain, del: async (a) => ((atDelete = JSON.parse(raw(dir)).profiles.old.op), sec.keychain.del(a)) };
  const profiles = createProfiles({ dir, keychain });
  profiles.recordLogin('old', { ...ID('1'), region: 'us-east-1', op: true });
  await sec.keychain.set('old:op', b64({ vault: 'V', item: 'I' }));
  await profiles.opRef('old');
  assert.deepEqual(atDelete, { vault: 'V', item: 'I' });
});

test('opRef: a missing or unreadable legacy ref gives null and keeps the entry untouched', async () => {
  const { profiles, sec, dir } = setup();
  profiles.recordLogin('old', { ...ID('1'), region: 'us-east-1', op: true });
  const before = raw(dir);
  assert.equal(await profiles.opRef('old'), null);
  await sec.keychain.set('old:op', 'not-base64-json!');
  assert.equal(await profiles.opRef('old'), null);
  await sec.keychain.set('old:op', b64({ vault: 'V' }));
  assert.equal(await profiles.opRef('old'), null);
  assert.equal(raw(dir), before);
  assert.equal(sec.store.has('old:op'), true);
});

test('keySource: 1password (object or readable legacy), keychain, none; reads no secret and changes nothing', async () => {
  const { profiles, sec, dir } = setup();
  profiles.upsert('obj', { region: 'us-east-1', vault: 'V', item: 'I' });
  profiles.upsert('kc', { region: 'us-east-1' });
  profiles.upsert('none', { region: 'us-east-1' });
  profiles.recordLogin('leg', { ...ID('1'), region: 'us-east-1', op: true });
  profiles.recordLogin('bad', { ...ID('2'), region: 'us-east-1', op: true });
  await sec.keychain.set('kc', 'AKIA|SECRET');
  await sec.keychain.set('leg:op', b64({ vault: 'V', item: 'I' }));
  const before = raw(dir);
  sec.calls.length = 0;
  assert.equal(await profiles.keySource('obj'), '1password');
  assert.equal(await profiles.keySource('kc'), 'keychain');
  assert.equal(await profiles.keySource('none'), 'none');
  assert.equal(await profiles.keySource('leg'), '1password');
  assert.equal(await profiles.keySource('bad'), 'none');
  assert.ok(sec.calls.every((c) => c.args[0] === 'find-generic-password'));
  assert.ok(sec.calls.filter((c) => c.args.includes('kc') || c.args.includes('none')).every((c) => !c.args.includes('-w')));
  assert.equal(raw(dir), before);
  assert.equal(sec.store.has('leg:op'), true);
  await assert.rejects(profiles.keySource('ghost'), /unknown profile/);
});

test('list rows: account, keys source and masked ref, expiry, active marker; no vault or item name', async () => {
  const { profiles, ctx, sec } = setup();
  profiles.upsert('a', { label: 'Acme', account: '111122223333', region: 'us-east-1' });
  profiles.upsert('b', { region: 'eu-west-1', vault: 'SecretVault', item: 'SecretItem', otp_item: 'SecretOtp' });
  profiles.upsert('c', { region: 'ap-northeast-2', account: '444455556666', mfa_serial: MFA });
  await sec.keychain.set('c', 'AKIA|SECRET');
  profiles.setActive('b');
  await profiles.setSession('c', session(FUTURE));
  const out = text(await profileTool.handler({}, ctx));
  const rows = out.split('\n').slice(1);
  assert.deepEqual(rows, [
    '  a · Acme · 111122223333 · us-east-1 · password none · expiry none',
    '* b · - · - · eu-west-1 · password 1password op://****/**** · expiry none · active',
    `  c · - · 444455556666 · ap-northeast-2 · password keychain · expiry ${FUTURE}`,
  ]);
  for (const s of ['SecretVault', 'SecretItem', 'SecretOtp', 'AKIA', 'SECRET']) assert.equal(out.includes(s), false, s);
});

test('profile switch by name still works and the unknown name lists the known names', async () => {
  const { profiles, ctx } = setup();
  profiles.upsert('a', { region: 'us-east-1', account: '111122223333' });
  profiles.upsert('b', { region: 'eu-west-1', account: '444455556666' });
  const r = await profileTool.handler({ name: 'b' }, ctx);
  assert.equal(text(r), 'profile b · account 444455556666 · region eu-west-1\nactive profile: b');
  assert.equal(profiles.active(), 'b');
  const bad = await profileTool.handler({ name: 'zzz' }, ctx);
  assert.equal(bad.isError, true);
  assert.match(text(bad), /unknown profile "zzz"; known: a, b/);
});

test('profile_save: schema has no key-like property, is not read-only, no extra properties', () => {
  assert.equal(profileSaveTool.name, 'profile_save');
  assert.equal(profileSaveTool.annotations.readOnlyHint, false);
  assert.equal(profileSaveTool.annotations.destructiveHint, false);
  assert.equal(profileSaveTool.inputSchema.additionalProperties, false);
  assert.deepEqual(Object.keys(profileSaveTool.inputSchema.properties).sort(), ['account', 'item', 'label', 'mfa_serial', 'name', 'otp_item', 'region', 'vault']);
  for (const k of Object.keys(profileSaveTool.inputSchema.properties)) assert.doesNotMatch(k, /key|secret|token|password|code/i, k);
  assert.deepEqual(profileSaveTool.inputSchema.required, ['name']);
  assert.equal(profileTool.annotations.readOnlyHint, true);
});

test('profile_save creates, updates, keeps and removes; its answer masks the ref and never calls AWS', async () => {
  const { profiles, ctx, sec, dir } = setup();
  ctx.exec = () => assert.fail('profile_save must not call AWS');
  const r = await profileSaveTool.handler({ name: 'stage', account: '111122223333', region: 'ap-northeast-2', vault: 'HiddenVault', item: 'HiddenItem' }, ctx);
  assert.equal(r.isError, undefined);
  assert.equal(text(r), ['profile stage · account 111122223333 · region ap-northeast-2', 'created profile stage', 'password 1password op://****/****', 'active profile: stage'].join('\n'));
  assert.equal(text(r).includes('Hidden'), false);
  assert.deepEqual(profiles.get('stage').op, { vault: 'HiddenVault', item: 'HiddenItem' });
  const u = await profileSaveTool.handler({ name: 'stage', label: 'Stage', item: null }, ctx);
  assert.match(text(u), /^profile stage · account 111122223333 · region ap-northeast-2\nupdated profile stage\npassword none\n/);
  assert.equal(profiles.get('stage').label, 'Stage');
  assert.doesNotMatch(raw(dir), /key|secret|token/i);
  assert.ok(sec.calls.every((c) => c.args[0] === 'find-generic-password'));
});

test('profile_save refuses a key-like or unknown argument, a bad value and a non-string, changing nothing', async () => {
  const { ctx, dir, profiles } = setup();
  profiles.upsert('a', { region: 'us-east-1' });
  const before = raw(dir);
  for (const args of [{ name: 'a', access_key_id: 'AKIAFAKEFAKEFAKE0000' }, { name: 'a', password: 'x' }, { name: 'a', region: 'Seoul' }, { name: 'a', account: 5 }, { name: 'a', label: {} }, { region: 'us-east-1' }, { name: 'new' }]) {
    const r = await profileSaveTool.handler(args, ctx);
    assert.equal(r.isError, true, JSON.stringify(args));
    assert.equal(text(r).includes('AKIAFAKE'), false);
  }
  assert.equal(raw(dir), before);
});
