import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProfiles } from '../profiles.mjs';
import { createKeychain } from '../keychain.mjs';
import { logoutTool } from '../logout.mjs';

const FAKE = { key: 'AKIAFAKEFAKEFAKE0000', secret: 'fakeSecretAccessKeyFake0000000000000000', token: 'fakeSessionTokenFakeFakeFake', op: 'op://Employee/AWS prod/key' };
const MFA = 'arn:aws:iam::123456789012:mfa/fake-user';
const EXP = '2026-11-18T12:00:00+00:00';
const session = { AccessKeyId: FAKE.key, SecretAccessKey: FAKE.secret, SessionToken: FAKE.token, Expiration: EXP };

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'awsro-logout-'));
  const store = new Map();
  const calls = [];
  const run = async (args, stdin) => {
    calls.push({ args, stdin });
    const acct = args.includes('-a') ? args[args.indexOf('-a') + 1] : /-a "([^"]*)"/.exec(stdin)[1];
    if (args[0] === '-i') return store.set(acct, /-w "(.*)"\n$/.exec(stdin)[1]), { code: 0, stdout: '', stderr: '' };
    if (args[0] === 'find-generic-password') return store.has(acct) ? { code: 0, stdout: store.get(acct) + '\n', stderr: '' } : { code: 44, stdout: '', stderr: '' };
    return store.delete(acct) ? { code: 0, stdout: '', stderr: '' } : { code: 44, stdout: '', stderr: '' };
  };
  const keychain = createKeychain({ run });
  const profiles = createProfiles({ dir, keychain, now: () => Date.parse('2026-11-17T00:00:00Z') });
  const ctx = { profiles, keychain, exec: null, env: {} };
  const deletes = () => calls.filter((c) => c.args[0] === 'delete-generic-password').map((c) => c.args[c.args.indexOf('-a') + 1]);
  return { dir, store, calls, profiles, keychain, ctx, deletes };
}
const text = (r) => r.content[0].text;
const first = (r) => text(r).split('\n')[0];

async function mfaProfile(s, name = 'dev') {
  s.profiles.recordLogin(name, { identity: { Account: '123456789012' }, label: 'Acme', region: 'us-east-1', mfa_serial: MFA });
  await s.keychain.set(name, FAKE.key);
  await s.profiles.setSession(name, session);
}

test('logout is a write tool: named logout and not readOnlyHint', () => {
  assert.equal(logoutTool.name, 'logout');
  assert.notEqual(logoutTool.annotations?.readOnlyHint, true);
  assert.deepEqual(Object.keys(logoutTool.inputSchema.properties).sort(), ['forget', 'profile']);
});

test('with a cached session: deletes <profile>:session, reports expiry, says STS tokens cannot be revoked', async () => {
  const s = setup();
  await mfaProfile(s);
  const r = await logoutTool.handler({ profile: 'dev' }, s.ctx);
  assert.equal(r.isError, undefined);
  assert.equal(first(r), 'profile dev · account 123456789012 · region us-east-1');
  assert.match(text(r), new RegExp(EXP.replace(/[+]/g, '\\+')));
  assert.match(text(r), /cannot be revoked/);
  assert.match(text(r), /valid until/);
  assert.deepEqual(s.deletes(), ['dev:session']);
  assert.equal(await s.profiles.getSession('dev'), null);
  assert.equal(await s.keychain.get('dev'), FAKE.key); // keys stay without forget
});

test('with no session and no forget: says there is no session and deletes nothing', async () => {
  const s = setup();
  s.profiles.recordLogin('dev', { identity: { Account: '123456789012' }, region: 'us-east-1' });
  const r = await logoutTool.handler({ profile: 'dev' }, s.ctx);
  assert.equal(first(r), 'profile dev · account 123456789012 · region us-east-1');
  assert.match(text(r), /no session/);
  assert.match(text(r), /without an MFA serial never has one/);
  assert.equal(s.deletes().length, 0);
  assert.equal(s.calls.some((c) => c.args[0] === 'delete-generic-password'), false);
});

test('an MFA profile with no cached session also says there is no session', async () => {
  const s = setup();
  s.profiles.recordLogin('dev', { identity: { Account: '1' }, region: 'us-east-1', mfa_serial: MFA });
  const r = await logoutTool.handler({ profile: 'dev' }, s.ctx);
  assert.match(text(r), /no session/);
  assert.doesNotMatch(text(r), /never has one/);
  assert.equal(s.deletes().length, 0);
});

test('forget:true also deletes the keys and keeps the profile entry', async () => {
  const s = setup();
  await mfaProfile(s);
  const before = readFileSync(join(s.dir, 'profiles.json'), 'utf8');
  const r = await logoutTool.handler({ profile: 'dev', forget: true }, s.ctx);
  assert.deepEqual(s.deletes(), ['dev:session', 'dev']);
  assert.equal(await s.keychain.get('dev'), null);
  assert.match(text(r), /keys? deleted/);
  assert.equal(readFileSync(join(s.dir, 'profiles.json'), 'utf8'), before);
  assert.deepEqual(s.profiles.get('dev'), { name: 'dev', region: 'us-east-1', label: 'Acme', account: '123456789012', mfa_serial: MFA, op: false });
});

test('forget:true with no session still deletes the keys', async () => {
  const s = setup();
  s.profiles.recordLogin('dev', { identity: { Account: '1' }, region: 'us-east-1' });
  await s.keychain.set('dev', FAKE.key);
  const r = await logoutTool.handler({ profile: 'dev', forget: true }, s.ctx);
  assert.match(text(r), /no session/);
  assert.deepEqual(s.deletes(), ['dev']);
});

test('1Password-backed profile without forget: next query logs in again silently', async () => {
  const s = setup();
  s.profiles.recordLogin('prod', { identity: { Account: '999999999999' }, region: 'eu-west-1', mfa_serial: MFA, op: true });
  await s.keychain.set('prod:op', FAKE.op);
  await s.profiles.setSession('prod', session);
  const r = await logoutTool.handler({ profile: 'prod' }, s.ctx);
  assert.match(text(r), /next query will log in again silently/);
  assert.deepEqual(s.deletes(), ['prod:session']);
  assert.equal(await s.keychain.get('prod:op'), FAKE.op);
  // the same line when there was no session to delete
  const again = await logoutTool.handler({ profile: 'prod' }, s.ctx);
  assert.match(text(again), /no session/);
  assert.match(text(again), /next query will log in again silently/);
});

test('1Password-backed profile with forget deletes the op reference and does not promise a silent login', async () => {
  const s = setup();
  s.profiles.recordLogin('prod', { identity: { Account: '999999999999' }, region: 'eu-west-1', mfa_serial: MFA, op: true });
  await s.keychain.set('prod:op', FAKE.op);
  const r = await logoutTool.handler({ profile: 'prod', forget: true }, s.ctx);
  assert.deepEqual(s.deletes(), ['prod:op']);
  assert.match(text(r), /1Password reference deleted/);
  assert.doesNotMatch(text(r), /silently/);
  assert.equal(s.profiles.get('prod').op, true);
});

test('without a profile argument logout acts on the active profile', async () => {
  const s = setup();
  await mfaProfile(s, 'dev');
  await mfaProfile(s, 'prod');
  s.profiles.setActive('prod');
  const r = await logoutTool.handler({}, s.ctx);
  assert.match(first(r), /^profile prod /);
  assert.deepEqual(s.deletes(), ['prod:session']);
  assert.notEqual(await s.profiles.getSession('dev'), null);
});

test('no active profile, an unknown profile and a bad name are errors that delete nothing', async () => {
  const s = setup();
  const none = await logoutTool.handler({}, s.ctx);
  assert.equal(none.isError, true);
  s.profiles.recordLogin('dev', { identity: { Account: '1' }, region: 'us-east-1' });
  const unknown = await logoutTool.handler({ profile: 'stage' }, s.ctx);
  assert.equal(unknown.isError, true);
  assert.match(text(unknown), /unknown profile "stage"; known: dev/);
  const bad = await logoutTool.handler({ profile: 'A B' }, s.ctx);
  assert.equal(bad.isError, true);
  assert.equal(s.calls.some((c) => c.args[0] === 'delete-generic-password'), false);
});

test('a Keychain failure is returned as an error naming Keychain', async () => {
  const s = setup();
  s.profiles.recordLogin('dev', { identity: { Account: '1' }, region: 'us-east-1' });
  const broken = { get: async () => { throw new Error('Keychain is unavailable'); }, del: async () => { throw new Error('Keychain is unavailable'); } };
  const r = await logoutTool.handler({ profile: 'dev', forget: true }, { ...s.ctx, keychain: broken, profiles: { ...s.profiles, getSession: broken.get } });
  assert.equal(r.isError, true);
  assert.match(text(r), /Keychain/);
});

test('R3: no key, secret, token or op reference in any logout result or any security argv', async () => {
  const s = setup();
  await mfaProfile(s);
  s.profiles.recordLogin('prod', { identity: { Account: '999999999999' }, region: 'eu-west-1', mfa_serial: MFA, op: true });
  await s.keychain.set('prod:op', FAKE.op);
  await s.profiles.setSession('prod', session);
  const out = [];
  out.push(text(await logoutTool.handler({ profile: 'dev' }, s.ctx)));
  out.push(text(await logoutTool.handler({ profile: 'dev', forget: true }, s.ctx)));
  out.push(text(await logoutTool.handler({ profile: 'prod' }, s.ctx)));
  out.push(text(await logoutTool.handler({ profile: 'prod', forget: true }, s.ctx)));
  out.push(text(await logoutTool.handler({ profile: 'nope' }, s.ctx)));
  const argv = JSON.stringify(s.calls.map((c) => c.args));
  for (const v of Object.values(FAKE)) {
    assert.equal(out.join('\n').includes(v), false, `result has ${v}`);
    assert.equal(argv.includes(v), false, `argv has ${v}`);
  }
  assert.equal(out.join('\n').includes('Employee'), false);
});
