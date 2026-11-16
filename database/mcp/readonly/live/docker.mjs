#!/usr/bin/env node
// Runs the live tests against a throwaway database per vendor in docker — never a shared or
// production database. Per vendor: one network, one database container, then node containers on that
// network that seed it (live/seed.mjs) and run the tests twice, against server.mjs and against the
// bundle the plugin ships. No host port is opened; everything is removed by its exact name.
// Run: npm run test:docker [-- mysql mariadb postgres oracle]   (default: all four)
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const nodeImage = process.env.NODE_IMAGE || 'node:22-slim';
const secret = () => randomBytes(12).toString('hex');

const VENDORS = {
  mysql: (pass) => ({
    image: process.env.MYSQL_IMAGE || 'mysql:8.4',
    env: { MYSQL_ROOT_PASSWORD: secret(), MYSQL_DATABASE: 'app', MYSQL_USER: 'reader', MYSQL_PASSWORD: pass },
    port: 3306, user: 'reader', database: 'app',
  }),
  mariadb: (pass) => ({
    image: process.env.MARIADB_IMAGE || 'mariadb:11.4',
    env: { MARIADB_ROOT_PASSWORD: secret(), MARIADB_DATABASE: 'app', MARIADB_USER: 'reader', MARIADB_PASSWORD: pass },
    port: 3306, user: 'reader', database: 'app',
  }),
  postgres: (pass) => ({
    image: process.env.POSTGRES_IMAGE || 'postgres:17',
    env: { POSTGRES_USER: 'reader', POSTGRES_PASSWORD: pass, POSTGRES_DB: 'app' },
    port: 5432, user: 'reader', database: 'app',
  }),
  oracle: (pass) => ({
    image: process.env.ORACLE_IMAGE || 'gvenzl/oracle-free:23-slim-faststart',
    env: { ORACLE_PASSWORD: secret(), APP_USER: 'reader', APP_USER_PASSWORD: pass },
    port: 1521, user: 'reader', database: 'FREEPDB1',
  }),
};

const docker = (args, opts = {}) => spawnSync('docker', args, { encoding: 'utf8', ...opts });
const must = (args) => {
  const r = docker(args);
  if (r.status !== 0) throw new Error(`docker ${args[0]} failed: ${(r.stderr || '').trim().split('\n').pop()}`);
  return r.stdout.trim();
};
const envArgs = (env) => Object.entries(env).flatMap(([k, v]) => ['-e', `${k}=${v}`]);

function runVendor(vendor) {
  const id = randomBytes(4).toString('hex');
  const net = `dbro-test-${id}`;
  const db = `dbro-test-${vendor}-${id}`;
  const pass = secret();
  const v = VENDORS[vendor](pass);
  const conn = { DBRO_LIVE_VENDOR: vendor, DB_VENDOR: vendor, DB_HOST: db, DB_PORT: String(v.port), DB_USER: v.user, DB_PASS: pass, DB_NAME: v.database };
  // The MySQL-only live test (test/live.test.mjs) reads MYSQL_*; it runs on the mysql pass only.
  if (vendor === 'mysql') Object.assign(conn, { MYSQL_HOST: db, MYSQL_USER: v.user, MYSQL_PASS: pass, MYSQL_DB: v.database, DBRO_SEEDED: '1' });
  const node = (cmd, extra = {}) =>
    docker(['run', '--rm', '--network', net, '-v', `${root}:/app:ro`, '-w', '/app', ...envArgs({ ...conn, ...extra }), nodeImage, ...cmd], { stdio: 'inherit' }).status ?? 1;
  try {
    must(['network', 'create', net]);
    must(['run', '-d', '--name', db, '--network', net, ...envArgs(v.env), v.image]);
    process.stderr.write(`${vendor}: started ${v.image}; seeding\n`);
    if (node(['node', 'live/seed.mjs']) !== 0) return 1;
    const files = ['test/vendors.live.test.mjs', ...(vendor === 'mysql' ? ['test/live.test.mjs'] : [])];
    for (const server of ['server.mjs', 'dist/database-readonly.mjs']) {
      process.stderr.write(`${vendor}: live tests in ${nodeImage} against ${server}\n`);
      const status = node(['node', '--test', '--test-concurrency=1', ...files], { DBRO_SERVER: server });
      if (status !== 0) return status;
    }
    return 0;
  } catch (e) {
    process.stderr.write(`${vendor}: ${e.message}\n`);
    return 1;
  } finally {
    docker(['rm', '-f', db]);
    docker(['network', 'rm', net]);
  }
}

const pick = process.argv.slice(2).filter((a) => a !== '--');
const vendors = pick.length ? pick : Object.keys(VENDORS);
const unknown = vendors.filter((x) => !VENDORS[x]);
if (unknown.length) {
  process.stderr.write(`unknown vendor: ${unknown.join(', ')}; vendors: ${Object.keys(VENDORS).join(', ')}\n`);
  process.exit(2);
}
const results = vendors.map((x) => [x, runVendor(x)]);
for (const [x, s] of results) process.stderr.write(`${x}: ${s === 0 ? 'pass' : `FAIL (${s})`}\n`);
process.exit(results.every(([, s]) => s === 0) ? 0 : 1);
