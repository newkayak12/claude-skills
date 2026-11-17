import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { createProfiles, configDir, assertName, maskRef, profileTool } from '../profiles.mjs';
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
  assert.equal(profiles.recordLogin('prod', { identity: { Account: '111111111111' } }).label, '111111111111');
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

test('profile with no name lists each profile: name, label, region, expiry, active marker, masked ref', async () => {
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
  assert.match(dev, /^ {2}dev · Acme dev · us-east-1 · expiry none$/);
  assert.match(prod, /^\* prod · Acme prod · eu-west-1 · expiry 2026-11-18T12:00:00\+00:00 · op:\/\/\*{4}\/\*{4} · active$/);
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
