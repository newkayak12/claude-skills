// The shared aws child runner. The child sees only an allow-list of variables, so nothing from the
// server's own environment (endpoint override, profile, CA bundle, a user config folder) reaches it.
// Config and credentials files point at empty files in this server's config dir.
import { execFile as nodeExecFile } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { configDir } from './profiles.mjs';

const emptyFile = (dir, name) => {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = join(dir, name);
  writeFileSync(file, '', { flag: 'a', mode: 0o600 }); // created when absent, never changed
  return file;
};

// creds: { AccessKeyId, SecretAccessKey, SessionToken? } (the STS shape; camelCase also accepted).
export function childEnv(creds, region, baseEnv = process.env) {
  const id = creds?.AccessKeyId ?? creds?.accessKeyId;
  const secret = creds?.SecretAccessKey ?? creds?.secretAccessKey;
  const token = creds?.SessionToken ?? creds?.sessionToken;
  if (!id || !secret) throw new Error('credentials need a username and a password');
  if (!region || typeof region !== 'string') throw new Error('a region is required');
  const dir = configDir(baseEnv);
  const env = {
    AWS_ACCESS_KEY_ID: id,
    AWS_SECRET_ACCESS_KEY: secret,
    ...(token ? { AWS_SESSION_TOKEN: token } : {}),
    AWS_REGION: region,
    AWS_PAGER: '',
    AWS_CONFIG_FILE: emptyFile(dir, 'empty-config'),
    AWS_SHARED_CREDENTIALS_FILE: emptyFile(dir, 'empty-credentials'),
    PATH: baseEnv.PATH ?? '/usr/bin:/bin',
  };
  return env;
}

// Runs `aws <argv>` with no shell. Resolves { stdout, stderr, code, truncated, timedOut }; rejects only
// when the CLI cannot be started ('aws CLI not installed → aws:login installs it' for ENOENT).
export function execAws(argv, env, { timeoutMs = 60_000, capBytes = 1_048_576, execFile = nodeExecFile } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let child;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };
    const timer = setTimeout(() => {
      try {
        child?.kill('SIGKILL');
      } catch {}
      finish(resolve, { stdout: '', stderr: '', code: null, truncated: false, timedOut: true });
    }, timeoutMs);
    child = execFile('aws', argv, { env, encoding: 'utf8', maxBuffer: capBytes + 1 }, (e, stdout, stderr) => {
      let code = 0;
      let truncated = false;
      if (e) {
        if (e.code === 'ENOENT') return finish(reject, Object.assign(new Error('aws CLI not installed → aws:login installs it'), { code: 'ENOENT' }));
        if (e.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
          truncated = true;
          code = null;
        } else if (typeof e.code === 'number') code = e.code;
        else if (e.killed || e.signal) code = null;
        else return finish(reject, new Error(`aws CLI could not run${e.code ? ` (${e.code})` : ''}`));
      }
      let out = String(stdout ?? '');
      const buf = Buffer.from(out);
      if (buf.length > capBytes) {
        out = buf.subarray(0, capBytes).toString();
        truncated = true;
      }
      finish(resolve, { stdout: out, stderr: String(stderr ?? ''), code, truncated, timedOut: false });
    });
  });
}
