// @lintcfg/parser — parses the `key=value` config format into a validated record.
// Returns { ok: true, value: { name, port, timeout } } or
//         { ok: false, code: 'PARSE_ERROR'|'MISSING_FIELD'|'BAD_TYPE'|'UNKNOWN_FIELD', message, field? }
// `code` is always one of the *names* in @lintcfg/codes' EXIT_CODES table — this package
// speaks in names, not numbers, so it never needs to know what process exit code a name maps
// to; that mapping lives in exactly one place (packages/cli, via packages/codes).
const ALLOWED = ['name', 'port', 'timeout'];

function toInt(s) {
  if (!/^-?\d+$/.test(s)) return null;
  return Number(s);
}

export function parseConfig(text) {
  const fields = {};
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) return { ok: false, code: 'PARSE_ERROR', message: `line has no '=': "${line}"` };
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (!ALLOWED.includes(key)) return { ok: false, code: 'UNKNOWN_FIELD', message: `unknown field "${key}"`, field: key };
    fields[key] = value;
  }
  for (const key of ALLOWED) {
    if (!(key in fields)) return { ok: false, code: 'MISSING_FIELD', message: `missing required field "${key}"`, field: key };
  }
  if (fields.name === '') return { ok: false, code: 'MISSING_FIELD', message: 'field "name" must be non-empty', field: 'name' };
  const port = toInt(fields.port);
  if (port === null || port < 1 || port > 65535) {
    return { ok: false, code: 'BAD_TYPE', message: `field "port" must be an integer 1-65535, got "${fields.port}"`, field: 'port' };
  }
  const timeout = toInt(fields.timeout);
  if (timeout === null || timeout < 0) {
    return { ok: false, code: 'BAD_TYPE', message: `field "timeout" must be an integer >= 0, got "${fields.timeout}"`, field: 'timeout' };
  }
  return { ok: true, value: { name: fields.name, port, timeout } };
}
