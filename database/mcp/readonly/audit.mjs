// Local query log: one JSON line per read (query, list_tables, describe_table) in <config dir>/query.log,
// mode 0600, rolled to query.log.1 past 5 MB. String literals in the SQL are logged as '?' and no
// result value is written, so the log says what was read, never what came back.
import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { configDir } from './profiles.mjs';

export const maskLiterals = (sql) =>
  String(sql).replace(/'(?:[^'\\]|\\.|'')*'|"(?:[^"\\]|\\.|"")*"/g, "'?'").replace(/\s+/g, ' ').trim();

export function createAudit({ dir = configDir(), max = 5 * 1024 * 1024, onError = () => {} } = {}) {
  const file = join(dir, 'query.log');
  let failed = false;
  return (entry) => {
    try {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      try {
        if (statSync(file).size > max) renameSync(file, `${file}.1`);
      } catch {}
      const line = { ts: new Date().toISOString(), ...entry };
      if (line.sql !== undefined) line.sql = maskLiterals(line.sql);
      appendFileSync(file, JSON.stringify(line) + '\n', { mode: 0o600 });
    } catch (e) {
      if (!failed) onError(e); // a log failure never fails the read; reported once
      failed = true;
    }
  };
}
