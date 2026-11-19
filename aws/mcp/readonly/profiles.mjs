// Profiles of the readonly-aws server. Non-secret settings live in profiles.json, the active profile in
// state.json (both 0600 in a 0700 dir, so a switch survives a restart). Keys, the 1Password reference
// and the cached STS session live in Keychain (keychain.mjs), never in these files.
import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { ok, err, header, defineTool, READ_ONLY } from './contract.mjs';
import { sessionAccount, opAccount, keyAccount } from './keychain.mjs';

export const NAME_RE = /^[a-z0-9_-]{1,32}$/;
export const REGION_RE = /^[a-z]{2}(-[a-z0-9]+)+$/;
export const SERIAL_RE = /^arn:aws[a-z-]*:iam::\d{12}:(mfa|sms-mfa)\/\S+$/;
export const ACCOUNT_RE = /^\d{12}$/;
export const configDir = (env = process.env) => env.AWSRO_CONFIG_DIR || join(homedir(), '.config', 'aws-readonly-mcp');

export function assertName(name) {
  if (typeof name !== 'string' || !NAME_RE.test(name)) throw new Error('profile name must match [a-z0-9_-]{1,32}');
  return name;
}
export function assertRegion(region) {
  if (typeof region !== 'string' || !REGION_RE.test(region)) throw new Error('region must look like us-east-1');
  return region;
}
export function assertSerial(serial) {
  if (typeof serial !== 'string' || !SERIAL_RE.test(serial)) throw new Error('mfa_serial must be an MFA device ARN (arn:aws:iam::<account>:mfa/<name>)');
  return serial;
}
export function assertAccount(account) {
  if (typeof account !== 'string' || !ACCOUNT_RE.test(account)) throw new Error('account must be 12 digits');
  return account;
}
// 1-64 printable characters; returns the trimmed label.
export function assertLabel(label) {
  const l = typeof label === 'string' ? label.trim() : '';
  if (!l || l.length > 64 || /[\x00-\x1f\x7f]/.test(l)) throw new Error('label must be 1-64 printable characters');
  return l;
}
const printable = (s) => typeof s === 'string' && s.trim() !== '' && s.length <= 128 && !/[\x00-\x1f\x7f]/.test(s);
// A 1Password reference: vault and item together, otp_item (same vault) only with item.
export const isOpRef = (o) =>
  Boolean(o) && typeof o === 'object' && !Array.isArray(o) && printable(o.vault) && printable(o.item) && (o.otp_item === undefined || printable(o.otp_item));
export function assertOpRef(o) {
  if (!isOpRef(o)) throw new Error('1Password reference needs vault and item together (printable, up to 128 characters); otp_item only with item');
  return { vault: o.vault, item: o.item, ...(o.otp_item !== undefined ? { otp_item: o.otp_item } : {}) };
}

// Whatever the reference was, only this is ever shown.
export const maskRef = () => 'op://****/****';

function writeJson0600(file, data) {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
  renameSync(tmp, file);
  chmodSync(file, 0o600);
}

// The reference a pre-F2 login left in Keychain `<name>:op` (base64 JSON), or null when missing or unreadable.
async function legacyRef(keychain, name) {
  try {
    const raw = await keychain.get(opAccount(name));
    if (raw === null) return null;
    const o = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
    return isOpRef(o) ? assertOpRef(o) : null;
  } catch {
    return null;
  }
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
    // Create or update a profile by hand, no keys, no AWS call. A field left undefined keeps its saved
    // value, null removes it. Every value is checked before anything is written. region is required on
    // create (and cannot be removed); vault and item come together, otp_item (same vault) only with item.
    upsert(name, { label, account, region, mfa_serial, vault, item, otp_item } = {}) {
      assertName(name);
      const old = all()[name];
      const keep = (v, saved, check) => (v === undefined ? saved : v === null ? undefined : check(v));
      const reg = region === undefined ? old?.region : assertRegion(region);
      if (reg === undefined) throw new Error('region must look like us-east-1 (a region is required for a new profile)');
      const entry = { name, region: reg };
      const lab = keep(label, old?.label, assertLabel);
      const acct = keep(account, old?.account, assertAccount);
      const serial = keep(mfa_serial, old?.mfa_serial, assertSerial);
      const oldRef = isOpRef(old?.op) ? old.op : null;
      let op; // undefined = no reference; true = a legacy flag kept as it was
      if (vault === null || item === null) {
        if (typeof vault === 'string' || typeof item === 'string') throw new Error('vault and item come together: pass both, or null to remove the reference');
      } else if (vault !== undefined || item !== undefined) {
        const v = vault ?? oldRef?.vault;
        const i = item ?? oldRef?.item;
        if (v === undefined || i === undefined) throw new Error('vault and item come together: pass both');
        op = { vault: v, item: i, ...(oldRef?.otp_item !== undefined ? { otp_item: oldRef.otp_item } : {}) };
      } else {
        op = oldRef ?? (old?.op === true ? true : undefined);
      }
      if (otp_item !== undefined && otp_item !== null) {
        if (!op || op === true) throw new Error('otp_item needs vault and item: pass them with it');
        op = { ...op, otp_item };
      } else if (otp_item === null && op && op !== true) {
        op = { vault: op.vault, item: op.item };
      }
      if (op && op !== true) op = assertOpRef(op);
      if (lab !== undefined) entry.label = lab;
      if (acct !== undefined) entry.account = acct;
      if (serial !== undefined) entry.mfa_serial = serial;
      if (op !== undefined) entry.op = op;
      write(profilesFile, { profiles: { ...all(), [name]: entry } });
      if (!self.active()) self.setActive(name);
      return entry;
    },
    // The saved 1Password reference { vault, item, otp_item? } or null. A legacy entry (op: true, the
    // reference in Keychain `<name>:op`) is migrated once: the entry is written first, then the Keychain
    // item deleted. A missing or unreadable reference gives null and the entry stays as it was.
    async opRef(name) {
      const e = self.get(name);
      if (isOpRef(e?.op)) return assertOpRef(e.op);
      if (e?.op !== true) return null;
      const ref = await legacyRef(keychain, name);
      if (!ref) return null;
      const cur = all()[name];
      if (cur?.op === true) write(profilesFile, { profiles: { ...all(), [name]: { ...cur, op: ref } } });
      await keychain.del(opAccount(name)).catch(() => {});
      return ref;
    },
    // Where the keys live: 1password, keychain or none. An existence check only; no secret is read,
    // nothing is migrated or deleted.
    async keySource(name) {
      const e = need(name);
      if (isOpRef(e.op)) return '1password';
      if (e.op === true) return (await legacyRef(keychain, name)) ? '1password' : 'none';
      return (await keychain.has(keyAccount(name))) ? 'keychain' : 'none';
    },
    // Saved after a successful get-caller-identity. Settings not passed stay as they were; the label
    // defaults to the account id. Saved label, account, mfa_serial and op object are never erased: a
    // boolean op never replaces an object, and a saved account that is not the identity's is refused.
    recordLogin(name, { identity, label, region, mfa_serial, op } = {}) {
      assertName(name);
      if (!identity?.Account) throw new Error('login needs the identity from sts get-caller-identity');
      const old = all()[name];
      if (old?.account && old.account !== identity.Account) {
        throw new Error(`account mismatch: profile "${name}" is saved for account ${old.account}, the login is account ${identity.Account}`);
      }
      const reg = region ?? old?.region;
      if (!reg) throw new Error('a region is required for a new profile');
      const saved = isOpRef(old?.op) ? old.op : null;
      const entry = {
        name,
        region: reg,
        label: label ?? old?.label ?? identity.Account,
        account: identity.Account,
        ...((mfa_serial ?? old?.mfa_serial) ? { mfa_serial: mfa_serial ?? old.mfa_serial } : {}),
        op: op && typeof op === 'object' ? assertOpRef(op) : (saved ?? op ?? old?.op ?? false),
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
  const src = await profiles.keySource(p.name);
  const parts = [p.name, p.label ?? '-', p.account ?? '-', p.region, `keys ${src}${src === '1password' ? ` ${maskRef()}` : ''}`, `expiry ${await profiles.sessionStatus(p.name)}`];
  if (p.name === active) parts.push('active');
  return `${p.name === active ? '*' : ' '} ${parts.join(' · ')}`;
};

export const profileTool = defineTool({
  name: 'profile',
  description: 'List the saved AWS profiles (name, label, account, region, key source, session expiry, active marker), or switch the active profile by name. Never calls AWS.',
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

const SAVE_FIELDS = ['label', 'account', 'region', 'mfa_serial', 'vault', 'item', 'otp_item'];
const field = (description) => ({ type: ['string', 'null'], description });

// Writes local profile settings only: never a key, never an AWS call. The profile tool stays read-only.
export const profileSaveTool = defineTool({
  name: 'profile_save',
  description:
    'Create or update a saved AWS profile (name, label, 12-digit account, region, MFA serial, 1Password vault/item/otp_item). Writes the local profile file only; never stores keys and never calls AWS. A field left out stays as saved, null removes it. region is required for a new profile. The first saved profile becomes active.',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Profile name, [a-z0-9_-]{1,32}.' },
      label: field('Display label, 1-64 printable characters.'),
      account: field('12-digit AWS account id.'),
      region: { type: 'string', description: 'Region such as ap-northeast-2; required for a new profile.' },
      mfa_serial: field('MFA device ARN (arn:aws:iam::<account>:mfa/<name>).'),
      vault: field('1Password vault name; with item.'),
      item: field('1Password item holding the AWS access key; with vault.'),
      otp_item: field('1Password item (same vault) holding the one-time password; needs item.'),
    },
    required: ['name'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  async handler(args, ctx) {
    const { profiles } = ctx;
    try {
      const extra = Object.keys(args ?? {}).filter((k) => k !== 'name' && !SAVE_FIELDS.includes(k));
      if (extra.length) return err(`profile_save takes name, ${SAVE_FIELDS.join(', ')} only; refused: ${extra.join(', ')}. Keys are never saved here.`);
      for (const k of SAVE_FIELDS) {
        const v = args?.[k];
        if (v !== undefined && v !== null && typeof v !== 'string') return err(`${k} must be a string or null`);
      }
      const name = assertName(args?.name);
      const existed = Boolean(profiles.get(name));
      const e = profiles.upsert(name, Object.fromEntries(SAVE_FIELDS.filter((k) => args[k] !== undefined).map((k) => [k, args[k]])));
      const src = await profiles.keySource(name);
      return ok([header({ profile: name, account: e.account, region: e.region }), `${existed ? 'updated' : 'created'} profile ${name}`, `keys ${src}${src === '1password' ? ` ${maskRef()}` : ''}`, `active profile: ${profiles.active() ?? '-'}`].join('\n'));
    } catch (e) {
      return err(e.message);
    }
  },
});
