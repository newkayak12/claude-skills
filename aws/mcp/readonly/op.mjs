// 1Password CLI reads for a 1Password-backed profile: the key pair of an item and its one-time code.
// op prints the secret on its own stdout by design; it is parsed here and returned to the caller, never
// logged. Every error is built from fixed text plus the exit code or the field label, never from op's
// stdout or stderr, so no value or item content can leak through a message.
import { execFile } from 'node:child_process';

const LABELS = { AccessKeyId: 'access key id', SecretAccessKey: 'secret access key' };
const TIMEOUT_MS = 60000;
const NOT_INSTALLED = '1Password CLI (op) is not installed';

// Argv positions come from the caller; a leading dash would be read by op as an option.
function assertRef(vault, item) {
  for (const [k, v] of [['vault', vault], ['item', item]]) {
    if (typeof v !== 'string' || !v || v.startsWith('-') || /[\r\n\0]/.test(v)) throw new Error(`1Password ${k} name is not valid`);
  }
}

// run: execFile-shaped (file, args, options, cb); injectable for tests. Resolves stdout.
function runOp(args, run) {
  return new Promise((resolve, reject) => {
    run('op', args, { timeout: TIMEOUT_MS, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      if (!err) return resolve(String(stdout ?? ''));
      if (err.code === 'ENOENT') return reject(new Error(NOT_INSTALLED));
      const text = String(stderr ?? '');
      if (err.killed || err.signal) return reject(new Error('1Password CLI (op) timed out'));
      if (/not currently signed in|not signed in|sign in|authenticat|unlock/i.test(text)) return reject(new Error('1Password CLI (op) is signed out: sign in or unlock 1Password and retry'));
      if (/isn't an item|not found|isn't a vault|could not be found|no item/i.test(text)) return reject(new Error('1Password item or vault was not found'));
      reject(new Error(`1Password CLI (op) failed (exit ${typeof err.code === 'number' ? err.code : 'unknown'})`));
    });
  });
}

// Resolves {AccessKeyId, SecretAccessKey}; fields are matched by label, case-insensitively.
export async function readItem(vault, item, { run = execFile } = {}) {
  assertRef(vault, item);
  const out = await runOp(['item', 'get', item, '--vault', vault, '--format', 'json'], run);
  let fields;
  try {
    fields = JSON.parse(out).fields;
  } catch {
    throw new Error('1Password item could not be read: op did not return JSON');
  }
  if (!Array.isArray(fields)) throw new Error('1Password item has no fields');
  const creds = {};
  for (const [key, label] of Object.entries(LABELS)) {
    const f = fields.find((x) => typeof x?.label === 'string' && x.label.trim().toLowerCase() === label);
    if (!f || typeof f.value !== 'string' || !f.value) throw new Error(`1Password item has no '${label}' field`);
    creds[key] = f.value;
  }
  return creds;
}

// Resolves the first 6-digit token on op's stdout.
export async function otp(vault, item, { run = execFile } = {}) {
  assertRef(vault, item);
  const out = await runOp(['item', 'get', item, '--vault', vault, '--otp'], run);
  const m = out.match(/(?<!\d)\d{6}(?!\d)/);
  if (!m) throw new Error('1Password did not return a 6-digit one-time code');
  return m[0];
}
