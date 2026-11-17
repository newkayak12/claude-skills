// R4: one real run of the bundle over raw stdio. An empty config dir (no profile, no session) and an
// `aws` shim on PATH that writes a marker file: a rejected or not-logged-in query must never reach it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { createInterface } from 'node:readline';
import { OUT } from '../build.mjs';

test('bundle over stdio: tools/list, not-logged-in query, rejected query; aws never runs', async () => {
  const root = mkdtempSync(join(tmpdir(), 'awsro-stdio-'));
  const bin = join(root, 'bin');
  const cfg = join(root, 'cfg');
  const marker = join(root, 'aws-was-run');
  const shim = join(bin, 'aws');
  mkdirSync(bin);
  mkdirSync(cfg);
  writeFileSync(shim, `#!/bin/sh\necho ran > '${marker}'\necho '{}'\n`);
  chmodSync(shim, 0o755);

  const child = spawn(process.execPath, [OUT], {
    env: { ...process.env, AWSRO_CONFIG_DIR: cfg, PATH: `${bin}${delimiter}${process.env.PATH}` },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const lines = [];
  const waiting = new Map();
  createInterface({ input: child.stdout }).on('line', (line) => {
    lines.push(line);
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    waiting.get(msg.id)?.(msg);
  });
  child.stderr.resume();
  const send = (msg) => child.stdin.write(JSON.stringify(msg) + '\n');
  const call = (id, method, params) =>
    new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`no answer to ${method}`)), 15_000);
      waiting.set(id, (m) => {
        clearTimeout(t);
        resolve(m);
      });
      send({ jsonrpc: '2.0', id, method, params });
    });

  try {
    const init = await call(1, 'initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'stdio-test', version: '0' } });
    assert.equal(init.result.serverInfo.name, 'readonly-aws');
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });

    const list = await call(2, 'tools/list', {});
    assert.deepEqual(list.result.tools.map((t) => t.name).sort(), ['login', 'logout', 'profile', 'query']);

    const noSession = await call(3, 'tools/call', { name: 'query', arguments: { service: 'sts', operation: 'get-caller-identity' } });
    assert.equal(noSession.result.isError, true);
    assert.match(noSession.result.content[0].text, /aws:login/);

    const denied = await call(4, 'tools/call', { name: 'query', arguments: { service: 'secretsmanager', operation: 'get-secret-value', args: ['--secret-id', 'x'] } });
    assert.equal(denied.result.isError, true);
    assert.match(denied.result.content[0].text, /rejected \[/);

    assert.equal(existsSync(marker), false, 'the aws shim must not have run');
  } finally {
    child.stdin.end();
    await new Promise((r) => (child.exitCode !== null ? r() : child.once('exit', r)));
  }
  assert.ok(lines.length >= 4);
  for (const line of lines) {
    const msg = JSON.parse(line); // throws on anything that is not JSON
    assert.equal(msg.jsonrpc, '2.0', `stdout carries MCP frames only: ${line}`);
  }
});
