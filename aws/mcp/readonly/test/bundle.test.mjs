import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { OUT, bundleHash, sourceHash } from '../build.mjs';

test('dist bundle is built from the current sources (else: npm run build)', () => {
  assert.equal(bundleHash(), sourceHash(), 'dist/aws-readonly.mjs is stale: run npm run build');
});

test('the bundle alone (no node_modules beside it) lists exactly profile, login, logout, query', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'awsro-bundle-'));
  copyFileSync(OUT, join(dir, 'aws-readonly.mjs'));
  assert.deepEqual(readdirSync(dir), ['aws-readonly.mjs']);
  const cfg = mkdtempSync(join(tmpdir(), 'awsro-cfg-'));
  const client = new Client({ name: 'bundle-test', version: '0' });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [join(dir, 'aws-readonly.mjs')],
      cwd: dir,
      env: { ...process.env, AWSRO_CONFIG_DIR: cfg },
      stderr: 'ignore',
    }),
  );
  try {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), ['login', 'logout', 'profile', 'query']);
    const by = Object.fromEntries(tools.map((t) => [t.name, t]));
    assert.equal(by.profile.annotations.readOnlyHint, true);
    assert.equal(by.query.annotations.readOnlyHint, true);
    assert.equal(by.login.annotations.readOnlyHint, false);
    assert.equal(by.logout.annotations.readOnlyHint, false);
  } finally {
    await client.close();
  }
});
