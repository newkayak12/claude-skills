// Local query log: one JSON line per `query` call in <config dir>/query.log, mode 0600, rolled to
// query.log.1 past 5 MB. A line is {time, profile, service, operation, outcome} and nothing else: no
// argument value and no result data can reach it, because only these fields are copied and each must
// be a plain token (anything else is written as `-`, so a mistyped service cannot carry a value).
import { appendFileSync, chmodSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { configDir } from './profiles.mjs';

const TOKEN = /^[A-Za-z0-9_.:-]{1,64}$/;
const token = (v) => (typeof v === 'string' && TOKEN.test(v) ? v : '-');

export function createAudit({ dir = configDir(), max = 5 * 1024 * 1024, onError = () => {}, now = () => new Date() } = {}) {
  const file = join(dir, 'query.log');
  let failed = false;
  return (entry) => {
    try {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      try {
        if (statSync(file).size > max) renameSync(file, `${file}.1`);
      } catch {}
      const e = entry ?? {};
      const line = {
        time: now().toISOString(),
        profile: token(e.profile),
        service: token(e.service),
        operation: token(e.operation),
        outcome: token(e.outcome),
      };
      appendFileSync(file, JSON.stringify(line) + '\n', { mode: 0o600 });
      chmodSync(file, 0o600);
    } catch (e) {
      if (failed) return; // a log failure never fails the query; reported once
      failed = true;
      try {
        onError(e);
      } catch {}
    }
  };
}
