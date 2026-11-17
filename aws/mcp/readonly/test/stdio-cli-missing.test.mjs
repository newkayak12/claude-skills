// One real run of the bundle over raw stdio with no `aws` on PATH: the stored MFA session comes from a
// `security` shim (marker log proves it, no real Keychain), and the query answers that the CLI is not installed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { OUT } from '../build.mjs';
import { header } from '../contract.mjs';

const NEW = 'aws CLI not installed → aws:login installs it';
const FAKE = { key: 'ASIAFAKEFAKEFAKE0001', secret: 'fakeSecretfakeSecretfakeSecret00', token: 'fakeTokenfakeTokenfake' };

test('bundle over stdio, no aws on PATH: query answers the CLI is not installed', { skip: process.platform !== 'darwin' && 'macOS only' }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'awsro-nocli-'));
  let child;
  try {
    const bin = join(root, 'bin');
    const cfg = join(root, 'cfg');
    const calls = join(root, 'security-calls.log');
    mkdirSync(bin);
    mkdirSync(cfg);
    const entry = { name: 'dev', region: 'us-east-1', label: 'test', account: '123456789012', mfa_serial: 'arn:aws:iam::123456789012:mfa/test', op: false };
    writeFileSync(join(cfg, 'profiles.json'), JSON.stringify({ profiles: { dev: entry } }), { mode: 0o600 });
    writeFileSync(join(cfg, 'state.json'), JSON.stringify({ active: 'dev' }), { mode: 0o600 });
    const session = Buffer.from(
      JSON.stringify({ AccessKeyId: FAKE.key, SecretAccessKey: FAKE.secret, SessionToken: FAKE.token, Expiration: '2099-01-01T00:00:00Z' }),
    ).toString('base64');
    const shim = join(bin, 'security');
    writeFileSync(shim, `#!/bin/sh\nprintf '%s\\n' "$*" >> '${calls}'\ncase "$*" in\n  *dev:session*) printf '%s\\n' '${session}' ;;\n  *) exit 44 ;;\nesac\n`);
    chmodSync(shim, 0o755);
    assert.deepEqual(readdirSync(bin), ['security'], 'no aws on PATH');

    child = spawn(process.execPath, [OUT], {
      env: { PATH: bin, HOME: root, AWSRO_CONFIG_DIR: cfg },
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

    await call(1, 'initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'stdio-test', version: '0' } });
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    const r = await call(2, 'tools/call', { name: 'query', arguments: { service: 'sts', operation: 'get-caller-identity' } });

    assert.equal(r.result.isError, true);
    const text = r.result.content[0].text;
    const [l1, l2] = text.split('\n');
    assert.equal(l1, header({ profile: 'dev', account: '123456789012', region: 'us-east-1' }));
    assert.equal(l2, NEW);
    assert.ok(existsSync(calls), 'the security shim ran');
    assert.ok(readFileSync(calls, 'utf8').includes('dev:session'));
    for (const v of Object.values(FAKE)) assert.ok(!text.includes(v), 'no credential value in the answer');

    child.stdin.end();
    await new Promise((res) => (child.exitCode !== null ? res() : child.once('exit', res)));
    for (const line of lines) assert.equal(JSON.parse(line).jsonrpc, '2.0', `stdout carries MCP frames only: ${line}`);
  } finally {
    child?.kill();
    rmSync(root, { recursive: true, force: true });
  }
});
