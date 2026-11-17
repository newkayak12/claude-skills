// login: store the IAM user keys (Keychain, or a 1Password reference), verify them with
// sts get-caller-identity, and with an MFA serial mint and cache a session token. ensureSession is the
// query side: a valid cached session, else the stored keys, else a silent 1Password re-login.
//
// Secrets stay out of every answer: errors are built from fixed text plus the AWS error code, never from
// raw stderr, and each message is scrubbed of the values this call handled. The only argv a secret ever
// reaches is the six-digit code of get-session-token (the CLI has no other channel for it).
// ctx may carry dialog(prompt), op {readItem, otp}, sleep(ms) and an exec override (argv, env).
import { ok, err, header, defineTool } from './contract.mjs';
import { execAws, childEnv } from './awsexec.mjs';
import { keyAccount, opAccount } from './keychain.mjs';
import { assertName, maskRef } from './profiles.mjs';
import { hiddenDialog } from './dialog.mjs';
import * as realOp from './op.mjs';

const DURATIONS = [129600, 43200, 3600]; // seconds: IAM-user maximum, then the fallbacks
const WINDOW_MS = 30_000; // one TOTP window
const REGION_RE = /^[a-z]{2}(-[a-z0-9]+)+$/;
const SERIAL_RE = /^arn:aws[a-z-]*:iam::\d{12}:(mfa|sms-mfa)\/\S+$/;
const MFA_REJECTED = /MultiFactorAuthentication failed|invalid MFA one time pass code/i;

class Fail extends Error {}

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64');
const unb64 = (raw) => {
  try {
    const o = JSON.parse(Buffer.from(String(raw), 'base64').toString('utf8'));
    return o && typeof o === 'object' ? o : null;
  } catch {
    return null;
  }
};
const safeJson = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};
const isStr = (v) => typeof v === 'string' && v.length > 0;
const parseKeys = (raw) => {
  const o = raw === null ? null : unb64(raw);
  return isStr(o?.AccessKeyId) && isStr(o?.SecretAccessKey) ? { AccessKeyId: o.AccessKeyId, SecretAccessKey: o.SecretAccessKey } : null;
};
const parseRef = (raw) => {
  const o = raw === null ? null : unb64(raw);
  return isStr(o?.vault) && isStr(o?.item) ? { vault: o.vault, item: o.item } : null;
};

const awsCode = (stderr) => String(stderr ?? '').match(/An error occurred \(([A-Za-z]+)\)/)?.[1];

function deps(ctx) {
  return {
    dialog: ctx.dialog ?? hiddenDialog,
    op: ctx.op ?? realOp,
    sleep: ctx.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
    runAws: ctx.exec ?? execAws,
    env: ctx.env ?? process.env,
    secrets: [], // values this call handled; scrubbed from any message
  };
}

const scrub = (text, secrets) => secrets.reduce((t, s) => (isStr(s) && s.length >= 4 ? t.split(s).join('***') : t), String(text));

async function aws(d, argv, creds, region) {
  const env = childEnv(creds, region, d.env);
  try {
    return await d.runAws(argv, env);
  } catch (e) {
    throw new Fail(e?.message === 'aws CLI not found' ? 'aws CLI not found: install the AWS CLI v2' : 'aws CLI could not run');
  }
}

async function whoami(d, creds, region) {
  const r = await aws(d, ['sts', 'get-caller-identity', '--output', 'json'], creds, region);
  if (r.timedOut) throw new Fail('aws sts get-caller-identity timed out');
  if (r.code !== 0) throw new Fail(`AWS rejected the keys (${awsCode(r.stderr) ?? `exit ${r.code}`})`);
  const id = safeJson(r.stdout);
  if (!/^\d{12}$/.test(String(id?.Account ?? ''))) throw new Fail('sts get-caller-identity returned no account id');
  return id;
}

// One pass down the duration ladder with one code. Resolves {session} | {refused} | {rejected, code}.
async function requestSession(d, creds, region, serial, code) {
  for (const seconds of DURATIONS) {
    const r = await aws(
      d,
      [
        'sts',
        'get-session-token',
        '--serial-number',
        serial,
        '--token-code',
        code,
        '--duration-seconds',
        String(seconds),
        '--output',
        'json',
      ],
      creds,
      region,
    );
    if (r.timedOut) throw new Fail('aws sts get-session-token timed out; no session cached');
    if (r.code === 0) {
      const c = safeJson(r.stdout)?.Credentials;
      if (![c?.AccessKeyId, c?.SecretAccessKey, c?.SessionToken, c?.Expiration].every(isStr)) {
        throw new Fail('sts get-session-token returned no credentials; no session cached');
      }
      d.secrets.push(c.AccessKeyId, c.SecretAccessKey, c.SessionToken);
      return { session: { AccessKeyId: c.AccessKeyId, SecretAccessKey: c.SecretAccessKey, SessionToken: c.SessionToken, Expiration: c.Expiration } };
    }
    const kind = awsCode(r.stderr);
    if (kind === 'ValidationError' && /duration/i.test(String(r.stderr))) continue; // too long: next rung
    return { rejected: MFA_REJECTED.test(String(r.stderr)), code: kind };
  }
  return { refused: true };
}

// getCode() resolves a fresh 6-digit code. retryOnReject (the 1Password path, where a rejection means
// the code was already used in its window) waits out the window and asks once more.
async function mintSession(d, { creds, region, serial, getCode, retryOnReject }) {
  for (let attempt = 0; ; attempt++) {
    const code = await getCode();
    d.secrets.push(code);
    const r = await requestSession(d, creds, region, serial, code);
    if (r.session) return r.session;
    if (r.refused) throw new Fail(`AWS refused every session length (${DURATIONS.join(', ')} s); no session cached`);
    if (r.rejected && retryOnReject && attempt === 0) {
      await d.sleep(WINDOW_MS);
      continue;
    }
    if (r.rejected) {
      throw new Fail(
        retryOnReject
          ? 'MFA code rejected again after waiting out the 30 s window; no session cached. Check the 1Password item and the MFA serial, then log in again'
          : 'MFA code rejected (wrong, expired or already used); no session cached. Log in again with a fresh code',
      );
    }
    throw new Fail(`AWS refused the session request (${r.code ?? 'unknown error'}); no session cached`);
  }
}

const dialogCode = (d, profile) => async () => {
  const answer = await d.dialog(`MFA code (6 digits) for profile ${profile}`);
  if (answer === null) throw new Fail('MFA code dialog was canceled; no session cached');
  const code = String(answer).trim();
  if (!/^\d{6}$/.test(code)) throw new Fail('MFA code must be six digits; no session cached');
  return code;
};

const sessionCreds = (session) => ({ AccessKeyId: session.AccessKeyId, SecretAccessKey: session.SecretAccessKey, SessionToken: session.SessionToken });

export const login = defineTool({
  name: 'login',
  description:
    'Log in a named AWS profile with an IAM user access key pair, kept in macOS Keychain (typed once into a hidden dialog) or read from a 1Password item (vault + item). Verifies the keys with sts get-caller-identity. With mfa_serial it asks for the MFA code and caches a session token (up to 36 h); without, the keys are used directly. No key or code is ever a tool argument.',
  inputSchema: {
    type: 'object',
    properties: {
      profile: { type: 'string', description: 'Profile name, [a-z0-9_-]{1,32}.' },
      region: { type: 'string', description: 'AWS region the profile queries, for example us-east-1.' },
      label: { type: 'string', description: 'Optional display label; defaults to the account id.' },
      mfa_serial: { type: 'string', description: 'Optional MFA device ARN; saved with the profile.' },
      vault: { type: 'string', description: 'Optional 1Password vault holding the key item (with item).' },
      item: { type: 'string', description: 'Optional 1Password item with fields "access key id" and "secret access key" (and a one-time password).' },
    },
    required: ['profile', 'region'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  async handler(args, ctx) {
    const d = deps(ctx);
    const { profiles, keychain } = ctx;
    let account;
    const head = () => header({ profile: args?.profile, account, region: args?.region });
    try {
      const profile = assertName(args?.profile);
      const region = args?.region;
      if (typeof region !== 'string' || !REGION_RE.test(region)) throw new Fail('region must look like us-east-1');
      const label = args?.label === undefined ? undefined : String(args.label).trim();
      if (label !== undefined && (!label || label.length > 64 || /[\x00-\x1f]/.test(label))) throw new Fail('label must be 1-64 printable characters');
      if (args?.mfa_serial !== undefined && !SERIAL_RE.test(String(args.mfa_serial))) throw new Fail('mfa_serial must be an MFA device ARN (arn:aws:iam::<account>:mfa/<name>)');
      const hasVault = args?.vault !== undefined;
      const hasItem = args?.item !== undefined;
      if (hasVault !== hasItem) throw new Fail('vault and item go together');

      const old = profiles.get(profile);
      const serial = args?.mfa_serial ?? old?.mfa_serial;

      // Where the keys come from: an explicit 1Password reference, the stored one of an op-backed
      // profile, the stored keys, else two hidden dialogs.
      const ref = hasVault ? { vault: args.vault, item: args.item } : old?.op ? parseRef(await keychain.get(opAccount(profile))) : null;
      let keys;
      let written = false;
      if (ref) {
        keys = await d.op.readItem(ref.vault, ref.item);
      } else {
        keys = parseKeys(await keychain.get(keyAccount(profile)));
        if (!keys) {
          const id = await d.dialog(`AWS Access Key ID for profile ${profile}`);
          if (id === null) throw new Fail('login canceled; nothing stored');
          const secret = await d.dialog(`AWS Secret Access Key for profile ${profile}`);
          if (secret === null) throw new Fail('login canceled; nothing stored');
          keys = { AccessKeyId: String(id).trim(), SecretAccessKey: String(secret).trim() };
          if (!keys.AccessKeyId || !keys.SecretAccessKey) throw new Fail('an empty answer was given; nothing stored');
          d.secrets.push(keys.AccessKeyId, keys.SecretAccessKey);
          await keychain.set(keyAccount(profile), b64(keys));
          written = true;
        }
      }
      d.secrets.push(keys.AccessKeyId, keys.SecretAccessKey);

      let identity;
      try {
        identity = await whoami(d, keys, region);
      } catch (e) {
        if (written) await keychain.del(keyAccount(profile)).catch(() => {});
        throw e;
      }
      account = identity.Account;
      if (ref) await keychain.set(opAccount(profile), b64(ref));
      const entry = profiles.recordLogin(profile, { identity, label, region, mfa_serial: args?.mfa_serial, op: Boolean(ref) });

      let expiry = 'none';
      if (serial) {
        const session = await mintSession(d, {
          creds: keys,
          region,
          serial,
          getCode: ref ? () => d.op.otp(ref.vault, ref.item) : dialogCode(d, profile),
          retryOnReject: Boolean(ref),
        });
        await profiles.setSession(profile, session);
        expiry = session.Expiration;
      }
      return ok([head(), `logged in: profile ${profile}, label ${entry.label}`, `keys: ${ref ? maskRef() : 'stored in Keychain'}`, `session expiry: ${expiry}`].join('\n'));
    } catch (e) {
      return err(`${head()}\n${scrub(e?.message ?? 'login failed', d.secrets)}`);
    }
  },
});

const inflight = new Map();

// For the query tool: { creds: {AccessKeyId, SecretAccessKey, SessionToken?}, region } or { error }
// whose text names aws:login. Concurrent calls for one profile share one silent re-login, because a
// second one-time code in the same window would be rejected.
export function ensureSession(profile, ctx) {
  const running = inflight.get(profile);
  if (running) return running;
  const p = ensure(profile, ctx).finally(() => inflight.delete(profile));
  inflight.set(profile, p);
  return p;
}

async function ensure(profile, ctx) {
  const d = deps(ctx);
  const { profiles, keychain } = ctx;
  const notLoggedIn = (why) => ({ error: `profile ${profile} is not logged in: ${why}. Run aws:login` });
  try {
    assertName(profile);
    const e = profiles.get(profile);
    if (!e) return notLoggedIn('unknown profile');
    const status = await profiles.sessionStatus(profile);
    if (status !== 'none' && status !== 'expired') {
      const s = await profiles.getSession(profile);
      if ([s?.AccessKeyId, s?.SecretAccessKey, s?.SessionToken].every(isStr)) return { creds: sessionCreds(s), region: e.region };
    }
    const ref = e.op ? parseRef(await keychain.get(opAccount(profile))) : null;
    if (ref) {
      const keys = await d.op.readItem(ref.vault, ref.item);
      d.secrets.push(keys.AccessKeyId, keys.SecretAccessKey);
      if (!e.mfa_serial) return { creds: keys, region: e.region };
      const session = await mintSession(d, {
        creds: keys,
        region: e.region,
        serial: e.mfa_serial,
        getCode: () => d.op.otp(ref.vault, ref.item),
        retryOnReject: true,
      });
      await profiles.setSession(profile, session);
      return { creds: sessionCreds(session), region: e.region };
    }
    if (!e.mfa_serial) {
      const keys = parseKeys(await keychain.get(keyAccount(profile)));
      return keys ? { creds: keys, region: e.region } : notLoggedIn('no stored keys');
    }
    return notLoggedIn(status === 'expired' ? 'the session has expired or was never created' : 'no session');
  } catch (x) {
    return notLoggedIn(scrub(x?.message ?? 'session lookup failed', d.secrets));
  }
}
