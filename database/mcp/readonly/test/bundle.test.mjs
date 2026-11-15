import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { OUT, bundleHash, sourceHash } from '../build.mjs';

test('dist bundle is built from the current sources (else: npm run build)', () => {
  assert.equal(bundleHash(), sourceHash(), 'dist/database-readonly.mjs is stale: run npm run build');
});

test('the bundle alone (no node_modules beside it) starts and lists its tools', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dbro-bundle-'));
  copyFileSync(OUT, join(dir, 'database-readonly.mjs'));
  const client = new Client({ name: 'bundle-test', version: '0' });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [join(dir, 'database-readonly.mjs')],
      cwd: dir,
      env: { ...process.env, DBRO_CONFIG_DIR: join(dir, 'cfg'), DBRO_SECRETS: 'file' },
      stderr: 'ignore',
    }),
  );
  try {
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    assert.deepEqual(names, ['describe_table', 'list_tables', 'login', 'logout', 'profile', 'query']);
  } finally {
    await client.close();
  }
});
