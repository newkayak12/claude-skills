import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAudit } from '../audit.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'awsro-audit-'));
const lines = (file) => readFileSync(file, 'utf8').trimEnd().split('\n').map((l) => JSON.parse(l));

test('writes one JSON line {time, profile, service, operation, outcome} to <dir>/query.log', () => {
  const dir = tmp();
  const audit = createAudit({ dir, now: () => new Date('2026-11-17T01:02:03.000Z') });
  audit({ profile: 'dev', service: 'ec2', operation: 'describe-instances', outcome: 'ok' });
  audit({ profile: 'dev', service: 'ec2', operation: 'run-instances', outcome: 'rejected' });
  const rows = lines(join(dir, 'query.log'));
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { time: '2026-11-17T01:02:03.000Z', profile: 'dev', service: 'ec2', operation: 'describe-instances', outcome: 'ok' });
  assert.deepEqual(Object.keys(rows[1]), ['time', 'profile', 'service', 'operation', 'outcome']);
  assert.equal(rows[1].outcome, 'rejected');
});

test('extra fields are dropped: no args and no result data reach the log', () => {
  const dir = tmp();
  const audit = createAudit({ dir });
  audit({ profile: 'dev', service: 'ssm', operation: 'get-parameter', outcome: 'ok', args: ['--name', '/prod/db-password'], result: 'hunter2', stdout: 'AKIAFAKE', time: 'forged' });
  const raw = readFileSync(join(dir, 'query.log'), 'utf8');
  for (const leak of ['db-password', 'hunter2', 'AKIAFAKE', 'forged', '--name']) assert.equal(raw.includes(leak), false, leak);
  assert.deepEqual(Object.keys(JSON.parse(raw)), ['time', 'profile', 'service', 'operation', 'outcome']);
  assert.match(JSON.parse(raw).time, /^\d{4}-\d\d-\d\dT/);
});

test('a field that is not a plain token is logged as - (a mistyped service cannot smuggle a value)', () => {
  const dir = tmp();
  const audit = createAudit({ dir });
  audit({ profile: 'dev', service: 'AKIAFAKEFAKE0000 secret value', operation: 'x\ny', outcome: undefined });
  const [row] = lines(join(dir, 'query.log'));
  assert.deepEqual([row.service, row.operation, row.outcome], ['-', '-', '-']);
  assert.equal(readFileSync(join(dir, 'query.log'), 'utf8').trimEnd().split('\n').length, 1);
});

test('the log file is mode 0600 and its directory 0700', () => {
  const dir = join(tmp(), 'nested');
  const audit = createAudit({ dir });
  audit({ profile: 'dev', service: 'ec2', operation: 'describe-instances', outcome: 'ok' });
  assert.equal(statSync(join(dir, 'query.log')).mode & 0o777, 0o600);
  assert.equal(statSync(dir).mode & 0o777, 0o700);
});

test('an existing log with a wider mode is tightened to 0600', () => {
  const dir = tmp();
  writeFileSync(join(dir, 'query.log'), '', { mode: 0o644 });
  createAudit({ dir })({ profile: 'dev', service: 'ec2', operation: 'describe-instances', outcome: 'ok' });
  assert.equal(statSync(join(dir, 'query.log')).mode & 0o777, 0o600);
});

test('rolls to query.log.1 once past max, new file is 0600; under max it does not roll', () => {
  const dir = tmp();
  const audit = createAudit({ dir, max: 200 });
  const entry = { profile: 'dev', service: 'ec2', operation: 'describe-instances', outcome: 'ok' };
  audit(entry);
  assert.equal(existsSync(join(dir, 'query.log.1')), false);
  for (let i = 0; i < 4; i++) audit(entry);
  assert.equal(existsSync(join(dir, 'query.log.1')), true);
  assert.ok(statSync(join(dir, 'query.log.1')).size > 200);
  assert.ok(statSync(join(dir, 'query.log')).size <= 200 + 200);
  assert.equal(statSync(join(dir, 'query.log')).mode & 0o777, 0o600);
  assert.equal(lines(join(dir, 'query.log')).length >= 1, true);
});

test('the roll threshold is 5 MB by default', () => {
  const dir = tmp();
  writeFileSync(join(dir, 'query.log'), 'x'.repeat(5 * 1024 * 1024 + 1), { mode: 0o600 });
  createAudit({ dir })({ profile: 'dev', service: 'ec2', operation: 'describe-instances', outcome: 'ok' });
  assert.equal(existsSync(join(dir, 'query.log.1')), true);
  assert.equal(lines(join(dir, 'query.log')).length, 1);
});

test('a write failure goes to onError (once) and is never thrown', () => {
  const base = tmp();
  const blocker = join(base, 'blocker');
  writeFileSync(blocker, 'a file where the dir should be');
  const errors = [];
  const audit = createAudit({ dir: join(blocker, 'sub'), onError: (e) => errors.push(e) });
  assert.doesNotThrow(() => audit({ profile: 'dev', service: 'ec2', operation: 'describe-instances', outcome: 'ok' }));
  assert.doesNotThrow(() => audit({ profile: 'dev', service: 'ec2', operation: 'describe-instances', outcome: 'ok' }));
  assert.equal(errors.length, 1);
  assert.ok(errors[0] instanceof Error);
});

test('a throwing onError and a missing entry still never throw', () => {
  const base = tmp();
  const blocker = join(base, 'blocker');
  writeFileSync(blocker, 'x');
  const audit = createAudit({ dir: join(blocker, 'sub'), onError: () => { throw new Error('boom'); } });
  assert.doesNotThrow(() => audit({ profile: 'dev', service: 'ec2', operation: 'describe-instances', outcome: 'ok' }));
  assert.doesNotThrow(() => createAudit({ dir: tmp() })(undefined));
});

test('the default dir honours $AWSRO_CONFIG_DIR, else ~/.config/aws-readonly-mcp', () => {
  const keep = { cfg: process.env.AWSRO_CONFIG_DIR, home: process.env.HOME };
  try {
    const cfg = tmp();
    process.env.AWSRO_CONFIG_DIR = cfg;
    createAudit()({ profile: 'dev', service: 'ec2', operation: 'describe-instances', outcome: 'ok' });
    assert.equal(existsSync(join(cfg, 'query.log')), true);

    const home = tmp();
    delete process.env.AWSRO_CONFIG_DIR;
    process.env.HOME = home;
    createAudit()({ profile: 'dev', service: 'ec2', operation: 'describe-instances', outcome: 'ok' });
    assert.equal(existsSync(join(home, '.config', 'aws-readonly-mcp', 'query.log')), true);
  } finally {
    if (keep.cfg === undefined) delete process.env.AWSRO_CONFIG_DIR;
    else process.env.AWSRO_CONFIG_DIR = keep.cfg;
    process.env.HOME = keep.home;
  }
});
