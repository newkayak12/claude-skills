#!/usr/bin/env node
// Runs test/live.test.mjs against a throwaway MySQL in docker — never a shared or production database.
// One network, one MySQL container seeded with a small table, one node container running the tests on
// that network: no host port is opened. Everything is removed by its exact name at the end.
// Run: npm run test:docker   (MYSQL_IMAGE / NODE_IMAGE override the images)
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const id = randomBytes(4).toString('hex');
const net = `dbro-test-${id}`;
const db = `dbro-test-mysql-${id}`;
const rootPass = randomBytes(12).toString('hex');
const pass = randomBytes(12).toString('hex');
const mysqlImage = process.env.MYSQL_IMAGE || 'mysql:8.4';
const nodeImage = process.env.NODE_IMAGE || 'node:22-slim';

const docker = (args, opts = {}) => spawnSync('docker', args, { encoding: 'utf8', ...opts });
const must = (args) => {
  const r = docker(args);
  if (r.status !== 0) throw new Error(`docker ${args[0]} failed: ${(r.stderr || '').trim().split('\n').pop()}`);
  return r.stdout.trim();
};

// Seed: a table with personal-data columns, so the live PII check reads real source column names.
const init = mkdtempSync(join(tmpdir(), 'dbro-init-'));
writeFileSync(
  join(init, 'seed.sql'),
  `CREATE TABLE orders (id INT PRIMARY KEY, order_nm VARCHAR(20), recv_hp VARCHAR(20), shop_cd VARCHAR(10), reg_date DATETIME);
INSERT INTO orders VALUES (1, 'Kim', '010-0000-0001', 'A', '2026-01-01 10:00:00'), (2, 'Lee', '010-0000-0002', 'B', '2026-01-02 10:00:00');
`,
);

let status = 1;
try {
  must(['network', 'create', net]);
  must([
    'run', '-d', '--name', db, '--network', net,
    '-e', `MYSQL_ROOT_PASSWORD=${rootPass}`, '-e', 'MYSQL_DATABASE=app', '-e', 'MYSQL_USER=reader', '-e', `MYSQL_PASSWORD=${pass}`,
    '-v', `${init}:/docker-entrypoint-initdb.d:ro`,
    mysqlImage,
  ]);
  // The entrypoint runs the seed on a socket-only server, then restarts with TCP: a TCP ping means ready.
  const deadline = Date.now() + 180_000;
  for (;;) {
    const r = docker(['exec', '-e', `MYSQL_PWD=${rootPass}`, db, 'mysqladmin', 'ping', '-h127.0.0.1', '-uroot', '--silent']);
    if (r.status === 0) break;
    if (Date.now() > deadline) throw new Error('mysql did not become ready in 180s');
    spawnSync('sleep', ['2']);
  }
  // Twice: the MCP server from the sources, then the bundle the plugin ships.
  for (const server of ['server.mjs', 'dist/database-readonly.mjs']) {
    process.stderr.write(`mysql ready (${mysqlImage}); live tests in ${nodeImage} against ${server}\n`);
    const run = docker(
      [
        'run', '--rm', '--network', net, '-v', `${root}:/app:ro`, '-w', '/app',
        '-e', `MYSQL_HOST=${db}`, '-e', 'MYSQL_USER=reader', '-e', `MYSQL_PASS=${pass}`, '-e', 'MYSQL_DB=app',
        '-e', 'DBRO_SEEDED=1', '-e', `DBRO_SERVER=${server}`,
        nodeImage, 'node', '--test', 'test/live.test.mjs',
      ],
      { stdio: 'inherit' },
    );
    status = run.status ?? 1;
    if (status !== 0) break;
  }
} catch (e) {
  process.stderr.write(`${e.message}\n`);
} finally {
  docker(['rm', '-f', db]);
  docker(['network', 'rm', net]);
  rmSync(init, { recursive: true, force: true });
}
process.exit(status);
