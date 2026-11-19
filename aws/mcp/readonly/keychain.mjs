// macOS Keychain through `security`. Writes go through `security -i` stdin, never argv, so a value
// never shows in `ps`. Items: service readonly-aws; account <profile> (keys), <profile>:session
// (session, base64 of the JSON), <profile>:op (1Password reference).
import { spawn } from 'node:child_process';

export const SERVICE = 'readonly-aws';
export const MAX_VALUE_BYTES = 4000; // `security -i` reads one line of about 4 KB
export const keyAccount = (profile) => profile;
export const sessionAccount = (profile) => `${profile}:session`;
export const opAccount = (profile) => `${profile}:op`;

const quote = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

// Default runner: spawn `security`, feed stdin, resolve { code, stdout, stderr }. A missing binary rejects.
export function runSecurity(args, stdin) {
  return new Promise((resolve, reject) => {
    const p = spawn('security', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (d) => (stdout += d));
    p.stderr.on('data', (d) => (stderr += d));
    p.on('error', reject);
    p.on('close', (code) => resolve({ code, stdout, stderr }));
    p.stdin.on('error', () => {});
    p.stdin.end(stdin ?? '');
  });
}

// run(args, stdin) -> Promise<{ code, stdout, stderr }>; injectable for tests.
export function createKeychain({ run, platform, service = SERVICE } = {}) {
  const runner = run ?? runSecurity;
  const os = platform ?? (run ? 'darwin' : process.platform);
  const call = async (args, stdin) => {
    if (os !== 'darwin') throw new Error('Keychain is not available: macOS is required (this server stores credentials in Keychain)');
    try {
      return await runner(args, stdin);
    } catch (e) {
      if (e && e.code === 'ENOENT') throw new Error('macOS Keychain is not available: the `security` command was not found');
      throw new Error(`Keychain call failed${e && e.code ? ` (${e.code})` : ''}`);
    }
  };
  return {
    async get(account) {
      const r = await call(['find-generic-password', '-s', service, '-a', account, '-w']);
      return r.code === 0 ? String(r.stdout).replace(/\n$/, '') : null;
    },
    // Existence only: without -w the secret is never printed, and the output is dropped.
    async has(account) {
      const r = await call(['find-generic-password', '-s', service, '-a', account]);
      return r.code === 0;
    },
    async set(account, value) {
      value = String(value);
      if (/[\r\n]/.test(value)) throw new Error('Keychain value must not contain a newline');
      if (Buffer.byteLength(value) > MAX_VALUE_BYTES) throw new Error(`Keychain value is over ${MAX_VALUE_BYTES} bytes`);
      const r = await call(['-i'], `add-generic-password -U -s ${service} -a ${quote(account)} -w ${quote(value)}\n`);
      if (r.code !== 0 || String(r.stderr).trim()) throw new Error('Keychain write failed');
    },
    async del(account) {
      const r = await call(['delete-generic-password', '-s', service, '-a', account]);
      return r.code === 0;
    },
  };
}
