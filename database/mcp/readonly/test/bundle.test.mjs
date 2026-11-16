import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createProfiles, configDir, fileStore } from '../profiles.mjs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { OUT, bundleHash, sourceHash } from '../build.mjs';

test('dist bundle is built from the current sources (else: npm run build)', () => {
  assert.equal(bundleHash(), sourceHash(), 'dist/database-readonly.mjs is stale: run npm run build');
});

for (const vendor of ['mysql', 'mariadb', 'postgres', 'oracle']) {
  test(`the bundle alone (no node_modules beside it) starts as --vendor ${vendor} and loads its driver`, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dbro-bundle-'));
    cpSync(dirname(OUT), join(dir, 'dist'), { recursive: true });
    const cfg = join(dir, 'cfg');
    const env = { ...process.env, DBRO_CONFIG_DIR: cfg, DBRO_SECRETS: 'file' };
    // a saved login on a closed port: the switch loads the vendor chunk and fails only on connecting
    await createProfiles({ vendor, dir: configDir(env, vendor), secrets: fileStore(configDir(env, vendor)) }).login(
      'dev', { host: '127.0.0.1', port: 9, user: 'u', database: 'd' }, { store: 'x' },
    );
    const client = new Client({ name: 'bundle-test', version: '0' });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [join(dir, 'dist', 'database-readonly.mjs'), '--vendor', vendor],
        cwd: dir,
        env,
        stderr: 'ignore',
      }),
    );
    try {
      const { tools } = await client.listTools();
      assert.deepEqual(tools.map((t) => t.name).sort(), ['describe_table', 'list_tables', 'login', 'logout', 'profile', 'query']);
      assert.ok(tools.every((t) => t.description.startsWith(LABELS[vendor] + ':')), 'descriptions name the vendor');
      await client.callTool({ name: 'profile', arguments: { name: 'dev' } });
      const r = await client.callTool({ name: 'query', arguments: { sql: vendor === 'oracle' ? 'SELECT 1 FROM dual' : 'SELECT 1' } });
      assert.equal(r.isError, true);
      assert.doesNotMatch(r.content[0].text, /Cannot find|ERR_MODULE_NOT_FOUND|is not a function|Dynamic require/, r.content[0].text);
      assert.match(r.content[0].text, /ECONNREFUSED|connect|refused|NJS-|DPY-|ORA-/i, r.content[0].text);
    } finally {
      await client.close();
    }
  });
}

const LABELS = { mysql: 'MySQL', mariadb: 'MariaDB', postgres: 'PostgreSQL', oracle: 'Oracle' };
