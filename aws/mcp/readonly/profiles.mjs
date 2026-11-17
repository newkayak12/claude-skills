// Profiles of the readonly-aws server. Non-secret settings live in profiles.json, the active profile in
// state.json (both 0600 in a 0700 dir, so a switch survives a restart). Keys, the 1Password reference
// and the cached STS session live in Keychain (keychain.mjs), never in these files.
import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { ok, err, header, defineTool, READ_ONLY } from './contract.mjs';
import { sessionAccount } from './keychain.mjs';

export const NAME_RE = /^[a-z0-9_-]{1,32}$/;
export const configDir = (env = process.env) => env.AWSRO_CONFIG_DIR || join(homedir(), '.config', 'aws-readonly-mcp');

export function assertName(name) {
  if (typeof name !== 'string' || !NAME_RE.test(name)) throw new Error('profile name must match [a-z0-9_-]{1,32}');
  return name;
}

// Whatever the reference was, only this is ever shown.
export const maskRef = () => 'op://****/****';

function writeJson0600(file, data) {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
  renameSync(tmp, file);
  chmodSync(file, 0o600);
}

export function createProfiles({ dir = configDir(), keychain, now = () => Date.now() } = {}) {
  const profilesFile = join(dir, 'profiles.json');
  const stateFile = join(dir, 'state.json');
  const read = (file, empty) => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : empty);
  const write = (file, data) => {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeJson0600(file, data);
  };
  const all = () => read(profilesFile, { profiles: {} }).profiles;
  const need = (name) => {
    assertName(name);
    const e = all()[name];
    if (!e) throw new Error(`unknown profile "${name}"; known: ${Object.keys(all()).sort().join(', ') || '(none)'}`);
    return e;
  };

  const self = {
    dir,
    names: () => Object.keys(all()).sort(),
    list: () => self.names().map((n) => all()[n]),
    get(name) {
      assertName(name);
      return all()[name] ?? null;
    },
    // The active profile, or null when none is set or it was removed.
    active() {
      const name = read(stateFile, {}).active;
      return typeof name === 'string' && all()[name] ? name : null;
    },
    setActive(name) {
      need(name);
      write(stateFile, { active: name });
    },
    // Saved after a successful get-caller-identity. Settings not passed stay as they were; the label
    // defaults to the account id (a label kept from an earlier login of the same account stays).
    recordLogin(name, { identity, label, region, mfa_serial, op } = {}) {
      assertName(name);
      if (!identity?.Account) throw new Error('login needs the identity from sts get-caller-identity');
      const old = all()[name];
      const reg = region ?? old?.region;
      if (!reg) throw new Error('a region is required for a new profile');
      const entry = {
        name,
        region: reg,
        label: label ?? (old && old.account === identity.Account ? old.label : identity.Account),
        account: identity.Account,
        ...((mfa_serial ?? old?.mfa_serial) ? { mfa_serial: mfa_serial ?? old.mfa_serial } : {}),
        op: op ?? old?.op ?? false,
      };
      write(profilesFile, { profiles: { ...all(), [name]: entry } });
      if (!self.active()) self.setActive(name);
      return entry;
    },
    // The session JSON { AccessKeyId, SecretAccessKey, SessionToken, Expiration } goes to Keychain as
    // base64, so no quote or brace reaches the `security -i` line.
    async setSession(name, session) {
      assertName(name);
      await keychain.set(sessionAccount(name), Buffer.from(JSON.stringify(session)).toString('base64'));
    },
    async getSession(name) {
      assertName(name);
      const raw = await keychain.get(sessionAccount(name));
      if (raw === null) return null;
      try {
        const s = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
        return s && typeof s === 'object' ? s : null;
      } catch {
        return null;
      }
    },
    // The cached Expiration, `none` (no MFA serial: long-term keys, no session), or `expired`.
    async sessionStatus(name) {
      const e = need(name);
      if (!e.mfa_serial) return 'none';
      const s = await self.getSession(name);
      const t = s?.Expiration ? Date.parse(s.Expiration) : NaN;
      return Number.isFinite(t) && t > now() ? s.Expiration : 'expired';
    },
  };
  return self;
}

// Error text for a well-formed name that is not saved; lists the known names.
export const unknownProfile = (profiles, name) => `unknown profile "${name}"; known: ${profiles.names().join(', ') || '(none)'}`;

const rowOf = async (profiles, p, active) => {
  const parts = [p.name, p.label, p.region, `expiry ${await profiles.sessionStatus(p.name)}`];
  if (p.op) parts.push(maskRef());
  if (p.name === active) parts.push('active');
  return `${p.name === active ? '*' : ' '} ${parts.join(' · ')}`;
};

export const profileTool = defineTool({
  name: 'profile',
  description: 'List the saved AWS profiles (name, account label, region, session expiry, active marker), or switch the active profile by name. Never calls AWS.',
  inputSchema: {
    type: 'object',
    properties: { name: { type: 'string', description: 'Profile to make active; omit to list.' } },
    additionalProperties: false,
  },
  annotations: READ_ONLY,
  async handler(args, ctx) {
    const { profiles } = ctx;
    try {
      const name = args?.name;
      if (name !== undefined) {
        if (!profiles.get(name)) return err(unknownProfile(profiles, name));
        profiles.setActive(name);
        const e = profiles.get(name);
        return ok(`${header({ profile: name, account: e.account, region: e.region })}\nactive profile: ${name}`);
      }
      const active = profiles.active();
      const cur = active ? profiles.get(active) : null;
      const head = header({ profile: active, account: cur?.account, region: cur?.region });
      const list = profiles.list();
      if (!list.length) return ok(`${head}\nno profiles saved; log in first`);
      const rows = [];
      for (const p of list) rows.push(await rowOf(profiles, p, active));
      return ok([head, ...rows].join('\n'));
    } catch (e) {
      return err(e.message);
    }
  },
});
