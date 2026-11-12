import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, statSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { createProfiles, fileStore, keychainStore, passwordDialog } from '../profiles.mjs';
import { execFileSync, spawnSync } from 'node:child_process';
import { writeFileSync, chmodSync, existsSync } from 'node:fs';

test('passwordDialog: answer returned, cancel rejected', async () => {
  const ok = (cmd, args, cb) => (assert.equal(cmd, 'osascript'), assert.match(args[1], /with hidden answer/), cb(null, 's3cret\n'));
  assert.equal(await passwordDialog('dev', ok), 's3cret');
  const cancel = (_c, _a, cb) => cb(Object.assign(new Error('User canceled. (-128)'), { code: 1 }));
  await assert.rejects(passwordDialog('dev', cancel), /login cancelled/);
});

// CLI without a terminal (as Claude runs it): a fake osascript on PATH stands in for the dialog.
function runCli(dir, answer, args) {
  const bin = mkdtempSync(join(tmpdir(), 'dbro-bin-'));
  writeFileSync(join(bin, 'osascript'), answer === null ? '#!/bin/sh\necho "User canceled. (-128)" >&2\nexit 1\n' : `#!/bin/sh\nprintf '%s\\n' '${answer}'\n`);
  chmodSync(join(bin, 'osascript'), 0o755);
  return spawnSync(process.execPath, [fileURLToPath(new URL('../cli.mjs', import.meta.url)), ...args], {
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, DBRO_CONFIG_DIR: dir, DBRO_SECRETS: 'file' },
    input: '',
    encoding: 'utf8',
  });
}

test('cli login without a terminal asks the macOS dialog; password saved, never printed', { skip: process.platform !== 'darwin' && 'not macOS' }, () => {
  const dir = tmp();
  const args = ['login', 'dev', '--host', 'h', '--user', 'u', '--database', 'd', '--no-verify'];
  const r = runCli(dir, 'dlg-pw-123', args);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /dev: saved \(password: file\)/);
  assert.doesNotMatch(r.stdout + r.stderr, /dlg-pw-123/);
  assert.equal(JSON.parse(readFileSync(join(dir, 'secrets.json'), 'utf8')).dev, 'dlg-pw-123');

  const dir2 = tmp();
  const c = runCli(dir2, null, args);
  assert.equal(c.status, 1);
  assert.match(c.stderr, /login cancelled/);
  assert.equal(existsSync(join(dir2, 'profiles.json')), false);
});

const tmp = () => mkdtempSync(join(tmpdir(), 'dbro-test-'));
const fields = { host: 'h.example', port: '3307', user: 'reader', database: 'app' };

test('login stores settings in profiles.json and the password only in the secret store', async () => {
  const dir = tmp();
  const p = createProfiles({ dir, secrets: fileStore(dir), read: async () => assert.fail('op not used') });
  await p.login('dev', fields, { store: 'pw"1' });
  const json = readFileSync(join(dir, 'profiles.json'), 'utf8');
  assert.doesNotMatch(json, /pw"1/);
  assert.equal(statSync(join(dir, 'profiles.json')).mode & 0o777, 0o600);
  assert.equal(statSync(join(dir, 'secrets.json')).mode & 0o777, 0o600);
  const cfg = await p.resolve('dev', { maxRows: 7 });
  assert.deepEqual(cfg, { vendor: 'mysql', host: 'h.example', port: 3307, user: 'reader', password: 'pw"1', database: 'app', maxRows: 7 });
  assert.deepEqual(p.list().find((r) => r.profile === 'dev'), {
    profile: 'dev', vendor: 'mysql', host: 'h.example', port: 3307, user: 'reader', database: 'app', auth: 'file', loggedIn: true,
  });
  assert.equal(p.list().find((r) => r.profile === 'prod').loggedIn, false);
});

test('1Password is asked once: fields saved plain at login, password ref read once per process', async () => {
  const dir = tmp();
  const reads = [];
  const p = createProfiles({ dir, secrets: fileStore(dir), read: async (r) => (reads.push(r), 'from-op') });
  await p.login('stage', { ...fields, host: 'op://V/i/hostname' }, { op: 'op://V/i/password' });
  assert.equal(p.get('stage').host, 'from-op');
  const cfg = await p.resolve('stage');
  await p.resolve('stage');
  await p.resolve('stage');
  assert.equal(cfg.password, 'from-op');
  assert.equal(cfg.host, 'from-op');
  assert.deepEqual(reads.sort(), ['op://V/i/hostname', 'op://V/i/password']);
  let fails = 0;
  const q = createProfiles({ dir, secrets: fileStore(dir), read: async () => (fails++ ? 'ok' : Promise.reject(new Error('op locked'))) });
  await assert.rejects(q.resolve('stage'), /op locked/);
  assert.equal((await q.resolve('stage')).password, 'ok');
  await assert.rejects(p.login('stage', fields, { op: 'nope' }), /must start with op:\/\//);
});

const fakeKeychain = () => {
  const m = new Map();
  return { kind: 'keychain', m, get: async (a) => m.get(a) ?? null, set: async (a, p) => void m.set(a, p), del: async (a) => void m.delete(a) };
};

test('with Keychain, an op:// login is read once into Keychain; the file keeps only a masked ref', async () => {
  const dir = tmp();
  const reads = [];
  const kc = fakeKeychain();
  const p = createProfiles({ dir, secrets: kc, read: async (r) => (reads.push(r), 'from-op') });
  const entry = await p.login('prod', fields, { op: 'op://Employee/item123/password' });
  assert.equal(entry.auth, 'keychain');
  assert.equal(kc.m.get('prod'), 'from-op');
  const json = readFileSync(join(dir, 'profiles.json'), 'utf8');
  assert.doesNotMatch(json, /Employee|item123|from-op/);
  assert.equal(p.get('prod').password_from, 'op://****/****/password');
  assert.equal((await p.resolve('prod')).password, 'from-op');
  await p.resolve('prod');
  assert.deepEqual(reads, ['op://Employee/item123/password']);
});

test('with Keychain, an existing op or secrets.json login moves on first use; secrets.json is masked', async () => {
  const dir = tmp();
  const old = createProfiles({ dir, secrets: fileStore(dir), read: async () => 'from-op' });
  await old.login('stage', fields, { op: 'op://V/i/password' });
  await old.login('dev', fields, { store: 'file-pw' });
  const kc = fakeKeychain();
  const p = createProfiles({ dir, secrets: kc, read: async () => 'from-op' });
  assert.equal((await p.resolve('stage')).password, 'from-op');
  assert.equal((await p.resolve('dev')).password, 'file-pw');
  assert.deepEqual([kc.m.get('stage'), kc.m.get('dev')], ['from-op', 'file-pw']);
  assert.equal(JSON.parse(readFileSync(join(dir, 'secrets.json'), 'utf8')).dev, '****');
  assert.doesNotMatch(readFileSync(join(dir, 'profiles.json'), 'utf8'), /op:\/\/V\/i/);
  assert.deepEqual([p.get('stage').auth, p.get('dev').auth], ['keychain', 'keychain']);
  await p.logout('dev');
  assert.equal(p.get('dev').password_from, undefined);
});

test('logout removes the password, keeps host/user/database; resolve then fails', async () => {
  const dir = tmp();
  const secrets = fileStore(dir);
  const p = createProfiles({ dir, secrets });
  await p.login('dev', fields, { store: 'pw' });
  assert.equal(await p.logout('dev'), true);
  assert.equal(await secrets.get('dev'), null);
  assert.equal(p.get('dev').host, 'h.example');
  await assert.rejects(p.resolve('dev'), /not logged in/);
  await assert.rejects(p.resolve('qa'), /unknown profile/);
  await p.login('local', fields, { none: true });
  assert.equal((await p.resolve('local')).password, '');
});

test('macOS keychain round trip (password via stdin)', { skip: process.platform !== 'darwin' && 'not macOS' }, async () => {
  const k = keychainStore('database-readonly-mcp-test');
  const pw = `a b"c\\d$e'f`;
  await k.set('t1', pw);
  assert.equal(await k.get('t1'), pw);
  await k.del('t1');
  assert.equal(await k.get('t1'), null);
});

async function connect(dir, { elicit, path } = {}) {
  const client = new Client({ name: 't', version: '0' }, { capabilities: elicit ? { elicitation: {} } : {} });
  if (elicit) client.setRequestHandler(ElicitRequestSchema, elicit);
  const env = { ...process.env, DBRO_CONFIG_DIR: dir, DBRO_SECRETS: 'file', ...(path ? { PATH: path } : {}) };
  for (const k of ['MYSQL_HOST', 'MYSQL_USER', 'MYSQL_DB', 'MYSQL_PASS', 'MYSQL_PORT', 'DBRO_PROFILE']) delete env[k];
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL('../server.mjs', import.meta.url))],
    env,
    stderr: 'ignore',
  }));
  const call = async (name, args = {}) => {
    const r = await client.callTool({ name, arguments: args });
    return { isError: !!r.isError, text: r.content[0].text };
  };
  return { client, call };
}

test('server profile mode: starts on local, lists profiles, reports not logged in', async () => {
  const { client, call } = await connect(tmp());
  try {
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    assert.deepEqual(names, ['describe_table', 'list_tables', 'login', 'logout', 'profile', 'query']);
    const list = JSON.parse((await call('profile')).text);
    assert.equal(list.active, 'local');
    assert.equal(list.connected, false);
    const q = await call('query', { sql: 'SELECT 1' });
    assert.equal(q.isError, true);
    assert.match(q.text, /not logged in; log in with the login tool \(database:login local\)/);
  } finally {
    await client.close();
  }
});

// login tool: the server opens the password dialog itself (a fake osascript on PATH here).
test('login tool: dialog password saved to the store, never in the tool result; cancel saves nothing', { skip: process.platform !== 'darwin' && 'not macOS' }, async () => {
  const fake = (answer) => {
    const bin = mkdtempSync(join(tmpdir(), 'dbro-bin-'));
    writeFileSync(join(bin, 'osascript'), answer === null ? '#!/bin/sh\nexit 1\n' : `#!/bin/sh\nprintf '%s\\n' '${answer}'\n`);
    chmodSync(join(bin, 'osascript'), 0o755);
    return `${bin}:${process.env.PATH}`;
  };
  const dir = tmp();
  let a = await connect(dir, { path: fake('tool-pw-9') });
  try {
    const r = await a.call('login', { name: 'dev', host: '127.0.0.1', port: 1, user: 'u', database: 'd' });
    assert.equal(r.isError, false, r.text);
    const body = JSON.parse(r.text);
    assert.equal(body.saved, true);
    assert.equal(body.password, 'file');
    assert.match(body.connection, /^failed: ECONNREFUSED/); // nothing listens on port 1
    assert.doesNotMatch(r.text, /tool-pw-9/);
    assert.equal(JSON.parse(readFileSync(join(dir, 'secrets.json'), 'utf8')).dev, 'tool-pw-9');
    const again = await a.call('login', { name: 'stage' });
    assert.match(again.text, /missing host, user, database/);
  } finally {
    await a.client.close();
  }
  const dir2 = tmp();
  a = await connect(dir2, { path: fake(null) });
  try {
    const r = await a.call('login', { name: 'dev', host: 'h', user: 'u', database: 'd' });
    assert.equal(r.isError, true);
    assert.match(r.text, /login cancelled/);
    assert.equal(existsSync(join(dir2, 'profiles.json')), false);
  } finally {
    await a.client.close();
  }
});

test('switching to prod needs elicitation; declined or unsupported means no switch', async () => {
  const dir = tmp();
  createProfiles({ dir, secrets: fileStore(dir) }); // empty store
  let a = await connect(dir);
  try {
    const r = await a.call('profile', { name: 'prod' });
    assert.equal(r.isError, true);
    assert.match(r.text, /cannot ask for it/);
  } finally {
    await a.client.close();
  }
  let asked = 0;
  a = await connect(dir, { elicit: async () => (asked++, { action: 'decline' }) });
  try {
    const r = await a.call('profile', { name: 'prod' });
    assert.match(r.text, /not confirmed \(decline\)/);
    assert.equal(asked, 1);
    assert.equal(JSON.parse((await a.call('profile')).text).active, 'local');
  } finally {
    await a.client.close();
  }
  a = await connect(dir, { elicit: async () => ({ action: 'accept', content: { confirm: true } }) });
  try {
    const r = await a.call('profile', { name: 'prod' });
    // confirmed, then fails only because prod has no saved login in this temp store
    assert.match(r.text, /profile "prod" is not logged in/);
    const s = await a.call('profile', { name: 'dev' }); // no confirmation for dev
    assert.match(s.text, /profile "dev" is not logged in/);
  } finally {
    await a.client.close();
  }
});
