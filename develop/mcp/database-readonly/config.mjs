// Connection settings. Two modes:
//   direct  — --host/--user/--database (or MYSQL_* env) given: one fixed connection.
//   profile — otherwise: named profiles (local, dev, stage, prod) saved by `cli.mjs login`.
// A value starting with op:// is read through the 1Password CLI (`op read`) — optional, only when used.
// Resolved values are never logged.
import { execFile } from 'node:child_process';
import { parseArgs } from 'node:util';

// option -> env var
const OPTIONS = {
  vendor: 'DB_VENDOR',
  host: 'MYSQL_HOST',
  port: 'MYSQL_PORT',
  user: 'MYSQL_USER',
  password: 'MYSQL_PASS',
  database: 'MYSQL_DB',
  'max-rows': 'MAX_ROWS',
  'max-execution-ms': 'MAX_EXECUTION_MS',
  profile: 'DBRO_PROFILE',
};

export const USAGE = `database-readonly-mcp [--profile local|dev|stage|prod]            (profile mode, default local)
database-readonly-mcp --host H [--port 3306] --user U [--password P] --database D   (direct mode)
  common: [--vendor mysql] [--max-rows 1000] [--max-execution-ms 30000]
Each option falls back to its env var: ${Object.entries(OPTIONS).map(([k, v]) => `--${k}=${v}`).join(', ')}.
A value starting with op:// is resolved with \`op read\` (1Password CLI, optional).
Profiles are saved with: node cli.mjs login <profile>`;

export function opRead(ref) {
  return new Promise((resolve, reject) => {
    execFile('op', ['read', '--no-newline', ref], { timeout: 60_000 }, (err, stdout) => {
      if (err) reject(new Error(err.code === 'ENOENT' ? '1Password CLI (op) not installed' : `op read failed (${err.code ?? 'error'})`));
      else resolve(stdout);
    });
  });
}

export const resolveValue = async (v, read = opRead) => (typeof v === 'string' && v.startsWith('op://') ? read(v) : v);

export function toInt(name, raw, fallback) {
  if (raw === undefined || raw === '' || raw === null) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`--${name} must be a positive integer`);
  return n;
}

// Unresolved values: args win over env.
export function readSettings(argv = process.argv.slice(2), env = process.env) {
  const { values } = parseArgs({
    args: argv,
    options: Object.fromEntries(Object.keys(OPTIONS).map((k) => [k, { type: 'string' }])),
    strict: true,
  });
  const raw = {};
  for (const [opt, envName] of Object.entries(OPTIONS)) raw[opt] = values[opt] ?? env[envName];
  return raw;
}

export const isDirect = (raw) => !!(raw.host || raw.user || raw.database);

export const limits = (raw) => ({
  maxRows: toInt('max-rows', raw['max-rows'], 1000),
  maxExecutionMs: toInt('max-execution-ms', raw['max-execution-ms'], 30000),
});

// Direct mode config.
export async function resolveConfig(argv = process.argv.slice(2), env = process.env, read = opRead) {
  const raw = readSettings(argv, env);
  const out = {};
  for (const k of ['vendor', 'host', 'port', 'user', 'password', 'database', 'max-rows', 'max-execution-ms']) {
    try {
      out[k] = await resolveValue(raw[k], read);
    } catch (e) {
      throw new Error(`--${k}: ${e.message}`);
    }
  }
  const missing = ['host', 'user', 'database'].filter((k) => !out[k]);
  if (missing.length) throw new Error(`missing: ${missing.map((k) => `--${k} (${OPTIONS[k]})`).join(', ')}`);
  return {
    vendor: out.vendor || 'mysql',
    host: out.host,
    port: toInt('port', out.port, 3306),
    user: out.user,
    password: out.password ?? '',
    database: out.database,
    ...limits(out),
  };
}

// Strip config values that must not leak into tool output or logs (driver errors can carry user@host).
export function redactor(cfg) {
  const secrets = [cfg.password, cfg.user, cfg.host].filter((s) => s && s.length >= 3);
  return (msg) => secrets.reduce((m, s) => m.split(s).join('***'), String(msg));
}
