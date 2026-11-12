// Profiles: local, dev, stage, prod. Non-secret settings live in profiles.json; the password lives in
// a secret store (macOS Keychain, else a 0600 file), or the profile holds an op:// reference instead
// (1Password, optional). Logged in = the profile has a password source.
import { execFile, spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { resolveValue, toInt, opRead } from './config.mjs';

export const PROFILES = ['local', 'dev', 'stage', 'prod'];
export const SERVICE = 'database-readonly-mcp';

export const configDir = (env = process.env) =>
  env.DBRO_CONFIG_DIR || join(env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'database-readonly-mcp');

export function assertProfile(name) {
  if (!PROFILES.includes(name)) throw new Error(`unknown profile "${name}"; profiles: ${PROFILES.join(', ')}`);
}

function writeJson0600(file, data) {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
  renameSync(tmp, file);
  chmodSync(file, 0o600);
}

// macOS Keychain through `security`. The password goes through stdin (`security -i`), never argv.
export function keychainStore(service = SERVICE) {
  const run = (args) =>
    new Promise((res, rej) =>
      execFile('security', args, (err, stdout) => (err ? rej(Object.assign(new Error('keychain'), { code: err.code })) : res(stdout))),
    );
  const quote = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  return {
    kind: 'keychain',
    async get(account) {
      try {
        return (await run(['find-generic-password', '-s', service, '-a', account, '-w'])).replace(/\n$/, '');
      } catch {
        return null;
      }
    },
    set(account, password) {
      if (/[\r\n]/.test(password)) return Promise.reject(new Error('password must not contain a newline'));
      return new Promise((res, rej) => {
        const p = spawn('security', ['-i'], { stdio: ['pipe', 'ignore', 'pipe'] });
        let errText = '';
        p.stderr.on('data', (d) => (errText += d));
        p.on('error', rej);
        p.on('close', (code) => (code === 0 && !errText.trim() ? res() : rej(new Error('keychain write failed'))));
        p.stdin.end(`add-generic-password -U -s ${quote(service)} -a ${quote(account)} -w ${quote(password)}\n`);
      });
    },
    async del(account) {
      try {
        await run(['delete-generic-password', '-s', service, '-a', account]);
      } catch {
        /* not there */
      }
    },
  };
}

// macOS hidden-answer dialog. The password comes back on osascript's stdout and is never printed.
// Cancel makes osascript exit non-zero (-128): nothing is returned.
export function passwordDialog(profile, run = execFile) {
  const script = `display dialog "${profile} password" default answer "" with hidden answer with title "database-readonly"`;
  return new Promise((res, rej) =>
    run('osascript', ['-e', script, '-e', 'text returned of result'], (err, stdout) =>
      err ? rej(new Error('login cancelled')) : res(String(stdout).replace(/\n$/, '')),
    ),
  );
}

// Fallback outside macOS: secrets.json with mode 0600 next to profiles.json.
export function fileStore(dir) {
  const file = join(dir, 'secrets.json');
  const load = () => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {});
  return {
    kind: 'file',
    async get(account) {
      return load()[account] ?? null;
    },
    async set(account, password) {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      writeJson0600(file, { ...load(), [account]: password });
    },
    async del(account) {
      const s = load();
      delete s[account];
      if (existsSync(file)) writeJson0600(file, s);
    },
  };
}

// DBRO_SECRETS=file forces the file store (tests, or a Mac without a usable login keychain).
export const defaultSecrets = (dir, env = process.env) =>
  process.platform === 'darwin' && env.DBRO_SECRETS !== 'file' ? keychainStore() : fileStore(dir);

export function createProfiles({ dir = configDir(), secrets = defaultSecrets(dir), read = opRead } = {}) {
  const file = join(dir, 'profiles.json');
  const load = () => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { profiles: {} });
  const save = (data) => {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeJson0600(file, data);
  };

  return {
    file,
    secretsKind: secrets.kind,
    get(name) {
      assertProfile(name);
      return load().profiles[name] ?? null;
    },
    // Rows for display: no secrets, only where the password comes from.
    list() {
      const p = load().profiles;
      return PROFILES.map((name) => {
        const e = p[name];
        return e
          ? { profile: name, vendor: e.vendor, host: e.host, port: e.port, user: e.user, database: e.database, auth: e.auth ?? null, loggedIn: !!e.auth }
          : { profile: name, loggedIn: false };
      });
    },
    // fields: vendor, host, port, user, database; auth: { store: password } | { op: ref } | { none: true }
    async login(name, fields, auth) {
      assertProfile(name);
      for (const k of ['host', 'user', 'database']) if (!fields[k]) throw new Error(`${k} is required`);
      const entry = {
        vendor: fields.vendor || 'mysql',
        host: fields.host,
        port: toInt('port', fields.port, 3306),
        user: fields.user,
        database: fields.database,
      };
      if (auth.op) {
        if (!auth.op.startsWith('op://')) throw new Error('1Password reference must start with op://');
        entry.auth = 'op';
        entry.password_ref = auth.op;
        await secrets.del(name);
      } else if (auth.none) {
        entry.auth = 'none';
        await secrets.del(name);
      } else {
        if (typeof auth.store !== 'string') throw new Error('password required');
        await secrets.set(name, auth.store);
        entry.auth = secrets.kind;
      }
      const data = load();
      data.profiles[name] = entry;
      save(data);
      return entry;
    },
    // Forget the password source; host/user/database stay for the next login.
    async logout(name) {
      assertProfile(name);
      await secrets.del(name);
      const data = load();
      const e = data.profiles[name];
      if (e) {
        delete e.auth;
        delete e.password_ref;
        save(data);
      }
      return !!e;
    },
    // Full connection config for a profile (password resolved). Throws if not logged in.
    async resolve(name, extra = {}) {
      assertProfile(name);
      const e = load().profiles[name];
      if (!e || !e.auth) throw new Error(`profile "${name}" is not logged in; run in a terminal: node cli.mjs login ${name}`);
      let password = '';
      if (e.auth === 'op') password = await read(e.password_ref);
      else if (e.auth !== 'none') {
        password = await secrets.get(name);
        if (password === null) throw new Error(`profile "${name}": password missing from ${secrets.kind}; log in again`);
      }
      return {
        vendor: e.vendor || 'mysql',
        host: await resolveValue(e.host, read),
        port: toInt('port', await resolveValue(e.port, read), 3306),
        user: await resolveValue(e.user, read),
        password,
        database: await resolveValue(e.database, read),
        ...extra,
      };
    },
  };
}
