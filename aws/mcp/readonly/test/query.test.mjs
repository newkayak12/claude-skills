import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { queryTool } from '../query.mjs';
import { createAudit } from '../audit.mjs';
import { createProfiles } from '../profiles.mjs';
import { execAws } from '../awsexec.mjs';
import { READ_ONLY } from '../contract.mjs';

const FAKE = { key: 'AKIAFAKEFAKEFAKE0000', secret: 'fakeSecretAccessKeyFake0000000000000000', token: 'fakeSessionTokenFakeFakeFake' };
const MFA = 'arn:aws:iam::123456789012:mfa/fake-user';
const NOW = Date.parse('2026-11-17T00:00:00Z');
const EXP = '2026-11-18T12:00:00Z';
const HEADER = 'profile dev · account 123456789012 · region us-east-1';
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64');
const text = (r) => r.content[0].text;

// A spawn spy: replaces node's execFile under execAws, so `calls` is every aws process that would start.
function spawnSpy(behavior = () => ({ stdout: '{"Reservations":[]}' })) {
  const calls = [];
  const execFile = (file, argv, opts, cb) => {
    calls.push({ file, argv, opts });
    const r = behavior(argv, opts);
    cb(r.error ?? null, r.stdout ?? '', r.stderr ?? '');
    return { kill() {} };
  };
  return { calls, execFile };
}

// mode: 'session' (MFA profile with a cached session token), 'keys' (no MFA, long-term keys), 'mfa-expired', 'none'
function setup({ mode = 'session', behavior, env = {}, keychainGet } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'awsro-query-'));
  const store = new Map();
  const keychain = {
    get: async (a) => {
      if (keychainGet) return keychainGet(a);
      return store.has(a) ? store.get(a) : null;
    },
    set: async (a, v) => void store.set(a, v),
    del: async (a) => store.delete(a),
  };
  const profiles = createProfiles({ dir, keychain, now: () => NOW });
  if (mode !== 'none') {
    const mfa = mode === 'session' || mode === 'mfa-expired';
    profiles.recordLogin('dev', { identity: { Account: '123456789012' }, region: 'us-east-1', label: 'Acme', ...(mfa ? { mfa_serial: MFA } : {}) });
  }
  if (mode === 'session') store.set('dev:session', b64({ AccessKeyId: FAKE.key, SecretAccessKey: FAKE.secret, SessionToken: FAKE.token, Expiration: EXP })); // what profiles.setSession writes
  if (mode === 'keys') store.set('dev', b64({ AccessKeyId: FAKE.key, SecretAccessKey: FAKE.secret }));
  const spy = spawnSpy(behavior);
  const audited = [];
  const ensureCalls = [];
  const realAudit = createAudit({ dir });
  const ctx = {
    profiles,
    keychain,
    env: { AWSRO_CONFIG_DIR: dir, PATH: '/usr/bin:/bin', ...env },
    exec: (argv, e) => execAws(argv, e, { execFile: spy.execFile }),
    audit: (entry) => (audited.push(entry), realAudit(entry)),
    ensureSession: async (p, c) => {
      ensureCalls.push(p);
      const { ensureSession } = await import('../login.mjs');
      return ensureSession(p, c);
    },
  };
  const log = () => (existsSync(join(dir, 'query.log')) ? readFileSync(join(dir, 'query.log'), 'utf8').trimEnd().split('\n').map((l) => JSON.parse(l)) : []);
  return { dir, ctx, spy, audited, ensureCalls, log, profiles, store };
}
const run = (s, service, operation, args = []) => queryTool.handler({ service, operation, args }, s.ctx);

test('the query tool: name, read-only annotations, input {service, operation, args[]}', () => {
  assert.equal(queryTool.name, 'query');
  assert.deepEqual(queryTool.annotations, READ_ONLY);
  assert.deepEqual(Object.keys(queryTool.inputSchema.properties).sort(), ['args', 'operation', 'service']);
  assert.equal(queryTool.inputSchema.properties.args.type, 'array');
  assert.deepEqual(queryTool.inputSchema.required, ['service', 'operation']);
});

// A7.1, A7.8
test('an allowed call runs execFile aws [service, operation, ...args, --output, json] with no shell; first line is the header', async () => {
  const s = setup({ behavior: () => ({ stdout: '{"Reservations":[]}\n' }) });
  const r = await run(s, 'ec2', 'describe-instances', ['--max-items', '5']);
  assert.equal(r.isError, undefined);
  assert.equal(text(r).split('\n')[0], HEADER);
  assert.match(text(r), /\{"Reservations":\[\]\}/);
  assert.equal(s.spy.calls.length, 1);
  const [c] = s.spy.calls;
  assert.equal(c.file, 'aws');
  assert.deepEqual(c.argv, ['ec2', 'describe-instances', '--max-items', '5', '--output', 'json']);
  assert.equal('shell' in c.opts, false);
  assert.equal(c.opts.shell, undefined);
  assert.deepEqual(s.ensureCalls, ['dev']);
  assert.deepEqual(s.log().map((l) => l.outcome), ['ok']);
});

test("the person's --output is passed through: argv holds exactly one --output, with their value", async () => {
  const forms = [
    [['--output', 'text'], ['ec2', 'describe-instances', '--output', 'text']],
    [['--output=table'], ['ec2', 'describe-instances', '--output=table']],
    [['--max-items', '5', '--output', 'json'], ['ec2', 'describe-instances', '--max-items', '5', '--output', 'json']],
  ];
  for (const [args, expected] of forms) {
    const s = setup();
    const r = await run(s, 'ec2', 'describe-instances', args);
    assert.equal(r.isError, undefined, args.join(' '));
    const { argv } = s.spy.calls[0];
    assert.deepEqual(argv, expected);
    assert.equal(argv.filter((t) => t === '--output' || t.startsWith('--output=')).length, 1, args.join(' '));
  }
});

test('logs filter-log-events runs; with no --output the argv ends --output json', async () => {
  const s = setup();
  const args = ['--log-group-name', '/aws/lambda/foo', '--filter-pattern', 'ERROR'];
  const r = await run(s, 'logs', 'filter-log-events', args);
  assert.equal(r.isError, undefined);
  assert.deepEqual(s.spy.calls[0].argv, ['logs', 'filter-log-events', ...args, '--output', 'json']);
});

test('text and table output are scrubbed of the session secrets like json', async () => {
  const fixtures = {
    text: `EVENTS\t${FAKE.secret}\t1700000000000\nSEARCHEDLOGSTREAMS\tstream\tcreds ${FAKE.key} ${FAKE.token}\n`,
    table: `-------------------------\n|  FilterLogEvents       |\n+--------+---------------+\n|  ${FAKE.key}  |  ${FAKE.secret}  |\n|  token | ${FAKE.token} |\n+--------+---------------+\n`,
  };
  for (const [fmt, stdout] of Object.entries(fixtures)) {
    const s = setup({ behavior: () => ({ stdout }) });
    const r = await run(s, 'logs', 'filter-log-events', ['--log-group-name', 'g', '--output', fmt]);
    assert.equal(r.isError, undefined, fmt);
    for (const v of [FAKE.key, FAKE.secret, FAKE.token]) assert.equal(text(r).includes(v), false, `${fmt} ${v}`);
    assert.match(text(r), /\*\*\*/, fmt);
    assert.equal(s.spy.calls[0].argv.at(-1), fmt);
  }
});

test('text and table output over 1 MiB are cut, whether or not the child hit its own cap', async () => {
  for (const fmt of ['text', 'table']) {
    const big = (fmt === 'table' ? '|  row  |\n' : 'row\tx\n').repeat(Math.ceil((2 * 1024 * 1024) / 10));
    const s = setup({ behavior: () => ({ stdout: big }) });
    const r = await run(s, 'ec2', 'describe-instances', ['--output', fmt]);
    assert.equal(r.isError, undefined, fmt);
    assert.ok(Buffer.byteLength(text(r)) <= 1024 * 1024 + 512, `${fmt} cut`);
    assert.ok(Buffer.byteLength(text(r)) > 1024 * 1024 - 512, `${fmt} not over-cut`);
    const t = setup({ behavior: () => ({ error: Object.assign(new Error('maxBuffer'), { code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' }), stdout: big }) });
    const rt = await run(t, 'ec2', 'describe-instances', ['--output', fmt]);
    assert.equal(rt._meta?.truncated, true, fmt);
    assert.ok(Buffer.byteLength(text(rt)) <= 1024 * 1024 + 1024, `${fmt} truncated cut`);
  }
});

test('the query tool text says --output json|text|table may be given and json is the default', () => {
  assert.match(queryTool.description, /--output json\|text\|table/);
  assert.match(queryTool.description, /filter-log-events/);
  assert.match(queryTool.inputSchema.properties.args.description, /--output json\|text\|table/);
  assert.match(queryTool.inputSchema.properties.args.description, /default/i);
});

test('the shell is never involved: a hostile arg stays one argv element', async () => {
  const s = setup();
  await run(s, 'ec2', 'describe-instances', ['--query', 'a; touch /tmp/pwned && $(id) `id`']);
  assert.equal(s.spy.calls[0].argv[3], 'a; touch /tmp/pwned && $(id) `id`');
  assert.equal(s.spy.calls[0].opts.shell, undefined);
});

// A7.2
test('the child env is an allow-list; server-side endpoint, profile and CA bundle do not reach it', async () => {
  const s = setup({
    env: { AWS_ENDPOINT_URL: 'http://evil', AWS_PROFILE: 'other', AWS_CA_BUNDLE: '/tmp/ca.pem', AWS_ACCESS_KEY_ID: 'AKIASERVERENV00000000', HOME: '/home/x', FOO: 'bar' },
  });
  await run(s, 'ec2', 'describe-instances');
  const env = s.spy.calls[0].opts.env;
  assert.deepEqual(Object.keys(env).sort(), ['AWS_ACCESS_KEY_ID', 'AWS_CONFIG_FILE', 'AWS_PAGER', 'AWS_REGION', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN', 'AWS_SHARED_CREDENTIALS_FILE', 'PATH']);
  assert.equal(env.AWS_ACCESS_KEY_ID, FAKE.key);
  assert.equal(env.AWS_SECRET_ACCESS_KEY, FAKE.secret);
  assert.equal(env.AWS_SESSION_TOKEN, FAKE.token);
  assert.equal(env.AWS_REGION, 'us-east-1');
  assert.equal(env.AWS_PAGER, '');
  for (const k of ['AWS_ENDPOINT_URL', 'AWS_PROFILE', 'AWS_CA_BUNDLE', 'HOME', 'FOO']) assert.equal(k in env, false, k);
  for (const k of ['AWS_CONFIG_FILE', 'AWS_SHARED_CREDENTIALS_FILE']) {
    assert.ok(env[k].startsWith(s.dir), k);
    assert.equal(readFileSync(env[k], 'utf8'), '');
    assert.equal(statSync(env[k]).mode & 0o777, 0o600);
  }
});

test('long-term keys without an MFA serial are used directly, with no session token', async () => {
  const s = setup({ mode: 'keys' });
  const r = await run(s, 'ec2', 'describe-instances');
  assert.equal(r.isError, undefined);
  assert.equal(s.spy.calls[0].opts.env.AWS_ACCESS_KEY_ID, FAKE.key);
  assert.equal('AWS_SESSION_TOKEN' in s.spy.calls[0].opts.env, false);
});

test('the home directory is never written (no .aws)', async () => {
  const home = mkdtempSync(join(tmpdir(), 'awsro-home-'));
  const keep = process.env.HOME;
  process.env.HOME = home;
  try {
    const s = setup();
    await run(s, 'ec2', 'describe-instances');
    assert.equal(existsSync(join(home, '.aws')), false);
    assert.equal(Object.values(s.spy.calls[0].opts.env).some((v) => String(v).includes('/.aws')), false);
  } finally {
    process.env.HOME = keep;
  }
});

// A6.1, A6.6: allowed calls reach aws
test('allowed shapes reach aws: prefixes, sts get-caller-identity, s3 ls, data-plane reads', async () => {
  const calls = [
    ['iam', 'list-users', []],
    ['sts', 'get-caller-identity', []],
    ['s3', 'ls', []],
    ['s3', 'ls', ['s3://bucket/prefix/']],
    ['cloudtrail', 'lookup-events', ['--query', 'Events[]', '--max-items', '3']],
    ['lambda', 'get-function-configuration', ['--function-name', 'f']],
    ['dynamodb', 'get-item', ['--table-name', 't', '--key', '{"id":{"S":"1"}}']],
    ['logs', 'get-log-events', ['--log-group-name', 'g', '--log-stream-name', 's']],
    ['athena', 'get-query-results', ['--query-execution-id', 'q']],
    ['ssm', 'get-parameter', ['--name', 'x', '--no-with-decryption']],
  ];
  for (const [service, operation, args] of calls) {
    const s = setup();
    const r = await run(s, service, operation, args);
    assert.equal(r.isError, undefined, `${service} ${operation}`);
    assert.equal(s.spy.calls.length, 1, `${service} ${operation}`);
    assert.deepEqual(s.spy.calls[0].argv, [service, operation, ...args, '--output', 'json']);
  }
});

// A6.2, A6.3, A6.4, A6.7: every denial returns rejected [rule], aws is never spawned, the session is never looked up
const REJECTS = [
  ['A6.2 ec2 run-instances', 'ec2', 'run-instances', [], 'not-allowed'],
  ['A6.2 iam create-user', 'iam', 'create-user', ['--user-name', 'x'], 'not-allowed'],
  ['A6.2 invalid token', 'ec2; ls', 'describe-instances', [], 'invalid-token'],
  ['A6.2 invalid args', 'ec2', 'describe-instances', 'not an array', 'invalid-args'],
  ['A6.2 s3 ls with a local path', 's3', 'ls', ['/etc'], 'not-allowed'],
  ['A6.3 secretsmanager get-secret-value', 'secretsmanager', 'get-secret-value', ['--secret-id', 'x'], 'secret-value'],
  ['A6.3 ssm get-parameter --with-decryption', 'ssm', 'get-parameter', ['--name', 'x', '--with-decryption'], 'ssm-decryption'],
  ['A6.3 ssm get-parameters --with-decryption', 'ssm', 'get-parameters', ['--names', 'x', '--with-decryption'], 'ssm-decryption'],
  ['A6.3 ssm get-parameters-by-path --with-decryption', 'ssm', 'get-parameters-by-path', ['--path', '/', '--with-decryption'], 'ssm-decryption'],
  ['A6.3 kms decrypt', 'kms', 'decrypt', ['--ciphertext-blob', 'x'], 'kms-decrypt'],
  ['A6.3 kms generate-data-key', 'kms', 'generate-data-key', ['--key-id', 'k'], 'kms-data-key'],
  ['A6.3 kms generate-data-key-pair', 'kms', 'generate-data-key-pair', ['--key-id', 'k'], 'kms-data-key'],
  ['A6.3 s3 cp', 's3', 'cp', ['s3://a/x', '.'], 's3-high-level'],
  ['A6.3 s3 mb', 's3', 'mb', ['s3://new'], 's3-high-level'],
  ['A6.3 s3 mv', 's3', 'mv', ['s3://a/x', 's3://a/y'], 's3-high-level'],
  ['A6.3 s3 presign', 's3', 'presign', ['s3://a/x'], 's3-high-level'],
  ['A6.3 s3 rb', 's3', 'rb', ['s3://a'], 's3-high-level'],
  ['A6.3 s3 rm', 's3', 'rm', ['s3://a/x'], 's3-high-level'],
  ['A6.3 s3 sync', 's3', 'sync', ['s3://a', '.'], 's3-high-level'],
  ['A6.3 s3 website', 's3', 'website', ['s3://a', '--index-document', 'i.html'], 's3-high-level'],
  ['A6.3 s3api get-object', 's3api', 'get-object', ['--bucket', 'b', '--key', 'k', 'out.bin'], 's3api-get-object'],
  ['A6.3 outfile positional (polly synthesize-speech)', 'polly', 'synthesize-speech', ['--text', 'hi', 'out.mp3'], 'outfile-positional'],
  ['A6.3 outfile positional (apigateway get-export)', 'apigateway', 'get-export', ['--rest-api-id', 'a', 'out.json'], 'outfile-positional'],
  ['A6.3 --output-file', 'ec2', 'describe-instances', ['--output-file', 'x'], 'output-file'],
  ['A6.3 lambda invoke', 'lambda', 'invoke', ['--function-name', 'f', 'out.json'], 'lambda-invoke'],
  ['A6.3 --endpoint-url', 'ec2', 'describe-instances', ['--endpoint-url', 'http://169.254.169.254'], 'endpoint-override'],
  ['A6.3 --profile', 'ec2', 'describe-instances', ['--profile', 'other'], 'profile-override'],
  ['A6.3 --cli-input-json', 'ec2', 'describe-instances', ['--cli-input-json', 'file://x.json'], 'cli-input'],
  ['A6.3 --cli-input-yaml', 'ec2', 'describe-instances', ['--cli-input-yaml', 'x'], 'cli-input'],
  ['A6.4 ssm get-parameter-history --with-decryption', 'ssm', 'get-parameter-history', ['--name', 'x', '--with-decryption'], 'ssm-decryption'],
  ['A6.4 sts get-session-token', 'sts', 'get-session-token', [], 'sts-session-token'],
  ['A6.4 sts get-federation-token', 'sts', 'get-federation-token', ['--name', 'n'], 'sts-federation-token'],
  ['A6.4 eks get-token', 'eks', 'get-token', ['--cluster-name', 'c'], 'eks-token'],
  ['A6.4 ecr get-login-password', 'ecr', 'get-login-password', [], 'ecr-login-password'],
  ['A6.4 ecr get-authorization-token', 'ecr', 'get-authorization-token', [], 'ecr-authorization-token'],
  ['A6.4 ec2 get-password-data', 'ec2', 'get-password-data', ['--instance-id', 'i-1'], 'ec2-password-data'],
  ['A6.4 s3api get-object-torrent', 's3api', 'get-object-torrent', ['--bucket', 'b', '--key', 'k', 'out'], 's3api-get-object'],
  ['A6.4 other outfile operation (glacier get-job-output)', 'glacier', 'get-job-output', ['--account-id', '-', 'out'], 'outfile-positional'],
  ['A6.5 --region', 'ec2', 'describe-instances', ['--region', 'us-west-2'], 'global-flag'],
  ['A6.5 --output yaml', 'ec2', 'describe-instances', ['--output', 'yaml'], 'global-flag'],
  ['A6.5 repeated --output', 'ec2', 'describe-instances', ['--output', 'text', '--output', 'table'], 'global-flag'],
  ['A6.5 --debug', 'ec2', 'describe-instances', ['--debug'], 'global-flag'],
  ['A6.5 --no-sign-request', 'ec2', 'describe-instances', ['--no-sign-request'], 'global-flag'],
  ['A6.5 --ca-bundle', 'ec2', 'describe-instances', ['--ca-bundle', '/tmp/ca'], 'global-flag'],
  ['A6.5 --no-verify-ssl', 'ec2', 'describe-instances', ['--no-verify-ssl'], 'global-flag'],
  ['A6.5 file:// value', 'ec2', 'describe-instances', ['--filters', 'file:///etc/passwd'], 'url-or-file-value'],
  ['A6.5 https:// value', 'ec2', 'describe-instances', ['--query=https://x'], 'url-or-file-value'],
];
for (const [name, service, operation, args, rule] of REJECTS) {
  test(`rejects ${name} as [${rule}]: isError, never spawns aws, never reads the session`, async () => {
    const s = setup();
    const r = await run(s, service, operation, args);
    assert.equal(r.isError, true);
    assert.match(text(r), new RegExp(`^rejected \\[${rule}\\]: \\S`));
    assert.equal(text(r).split('\n').length, 1, 'one line, no argument value');
    assert.equal(s.spy.calls.length, 0, 'spawn spy was never called');
    assert.equal(s.ensureCalls.length, 0, 'ensureSession was never called');
    assert.deepEqual(s.log().map((l) => l.outcome), ['rejected']);
  });
}

test('a rejection does not echo argument values and is logged without them', async () => {
  const s = setup();
  const r = await run(s, 'ssm', 'get-parameter', ['--name', '/prod/SENTINELVALUE', '--with-decryption']);
  assert.equal(text(r).includes('SENTINELVALUE'), false);
  assert.equal(readFileSync(join(s.dir, 'query.log'), 'utf8').includes('SENTINELVALUE'), false);
});

test('rejected is logged with profile, service and operation; no session or active profile is needed', async () => {
  const s = setup({ mode: 'none' });
  const r = await run(s, 'ec2', 'run-instances');
  assert.match(text(r), /^rejected \[not-allowed\]: /);
  const [row] = s.log();
  assert.deepEqual([row.profile, row.service, row.operation, row.outcome], ['-', 'ec2', 'run-instances', 'rejected']);
  const s2 = setup();
  await run(s2, 'ec2', 'run-instances');
  assert.equal(s2.log()[0].profile, 'dev');
});

// A7.5, A7.6, A7.7, AC-2 order
test('order is check, reject, session, run: the session error stops before aws and is returned isError and logged', async () => {
  const s = setup({ mode: 'mfa-expired' });
  const r = await run(s, 'ec2', 'describe-instances');
  assert.equal(r.isError, true);
  assert.match(text(r), /aws:login/);
  assert.equal(text(r).split('\n')[0], HEADER);
  assert.equal(s.spy.calls.length, 0);
  assert.deepEqual(s.ensureCalls, ['dev']);
  assert.deepEqual(s.log().map((l) => l.outcome), ['not-logged-in']);
});

test('an injected ensureSession error is returned as isError and logged; aws never runs', async () => {
  const s = setup();
  s.ctx.ensureSession = async () => ({ error: 'profile dev is not logged in: no session. Run aws:login' });
  const r = await run(s, 'ec2', 'describe-instances');
  assert.equal(r.isError, true);
  assert.match(text(r), /Run aws:login/);
  assert.equal(s.spy.calls.length, 0);
  assert.deepEqual(s.log().map((l) => l.outcome), ['not-logged-in']);
});

test('with an op-backed or stored-key profile ensureSession supplies the creds that childEnv receives', async () => {
  const s = setup();
  const seen = [];
  s.ctx.ensureSession = async (p, c) => (seen.push([p, c === s.ctx]), { creds: { AccessKeyId: 'AKIAINJECTED0000000', SecretAccessKey: 'injectedSecretValue0000', SessionToken: 'injectedToken00000' }, region: 'eu-west-1' });
  const r = await run(s, 'ec2', 'describe-instances');
  assert.deepEqual(seen, [['dev', true]]);
  assert.equal(s.spy.calls[0].opts.env.AWS_ACCESS_KEY_ID, 'AKIAINJECTED0000000');
  assert.equal(s.spy.calls[0].opts.env.AWS_REGION, 'eu-west-1');
  assert.equal(text(r).split('\n')[0], 'profile dev · account 123456789012 · region eu-west-1');
});

test('no active profile is a not-logged-in error naming aws:login, and aws never runs', async () => {
  const s = setup({ mode: 'none' });
  delete s.ctx.ensureSession;
  const r = await run(s, 'ec2', 'describe-instances');
  assert.equal(r.isError, true);
  assert.match(text(r), /aws:login/);
  assert.equal(s.spy.calls.length, 0);
  assert.deepEqual(s.log().map((l) => l.outcome), ['not-logged-in']);
});

test('a Keychain failure names the Keychain and never spawns aws', async () => {
  const s = setup({ mode: 'keys', keychainGet: async () => { throw new Error('macOS Keychain is not available: the `security` command was not found'); } });
  delete s.ctx.ensureSession;
  const r = await run(s, 'ec2', 'describe-instances');
  assert.equal(r.isError, true);
  assert.match(text(r), /Keychain/);
  assert.equal(s.spy.calls.length, 0);
});

test('a missing aws CLI is returned naming the aws CLI', async () => {
  const s = setup({ behavior: () => ({ error: Object.assign(new Error('spawn aws ENOENT'), { code: 'ENOENT' }) }) });
  const r = await run(s, 'ec2', 'describe-instances');
  assert.equal(r.isError, true);
  assert.equal(text(r).split('\n')[1], 'aws CLI not installed → aws:login installs it');
  assert.equal(text(r).split('\n')[0], HEADER);
  assert.deepEqual(s.log().map((l) => l.outcome), ['cli-missing']);
});

// A7.3, A7.8
test('an aws error is returned verbatim with the header, isError, and logged as error', async () => {
  const stderr = '\nAn error occurred (UnauthorizedOperation) when calling the DescribeInstances operation: You are not authorized\n';
  const s = setup({ behavior: () => ({ error: Object.assign(new Error('Command failed'), { code: 254 }), stderr }) });
  const r = await run(s, 'ec2', 'describe-instances');
  assert.equal(r.isError, true);
  assert.equal(text(r).split('\n')[0], HEADER);
  assert.ok(text(r).includes(stderr.trim()));
  assert.equal(text(r).includes('AWS_SECRET_ACCESS_KEY'), false);
  assert.deepEqual(s.log().map((l) => l.outcome), ['error']);
});

test('an aws error over the cap is trimmed to 1 MiB', async () => {
  const s = setup({ behavior: () => ({ error: Object.assign(new Error('x'), { code: 1 }), stderr: 'E'.repeat(3 * 1024 * 1024) }) });
  const r = await run(s, 'ec2', 'describe-instances');
  assert.equal(r.isError, true);
  assert.ok(Buffer.byteLength(text(r)) <= 1024 * 1024 + 512);
  assert.ok(Buffer.byteLength(text(r)) > 1024 * 1024 - 512);
});

test('output over the cap is cut: truncated:true, the answer says so, and it is logged', async () => {
  const s = setup({ behavior: () => ({ error: Object.assign(new Error('maxBuffer'), { code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' }), stdout: 'x'.repeat(1024 * 1024 + 10) }) });
  const r = await run(s, 'ec2', 'describe-instances');
  assert.equal(r.isError, undefined);
  assert.equal(r._meta?.truncated, true);
  assert.match(text(r), /truncated/i);
  assert.match(text(r), /1 MiB/);
  assert.equal(text(r).split('\n')[0], HEADER);
  assert.ok(Buffer.byteLength(text(r)) <= 1024 * 1024 + 1024);
  assert.deepEqual(s.log().map((l) => l.outcome), ['truncated']);
});

test('a hung child killed at the timeout is stated in the answer and logged as timeout', async () => {
  const s = setup();
  s.ctx.exec = async () => ({ stdout: '', stderr: '', code: null, truncated: false, timedOut: true });
  const r = await run(s, 'ec2', 'describe-instances');
  assert.equal(r.isError, true);
  assert.match(text(r), /timed out after 60 s/);
  assert.equal(text(r).split('\n')[0], HEADER);
  assert.deepEqual(s.log().map((l) => l.outcome), ['timeout']);
});

test('empty output is said so', async () => {
  const s = setup({ behavior: () => ({ stdout: '' }) });
  const r = await run(s, 'ec2', 'describe-instances');
  assert.equal(r.isError, undefined);
  assert.match(text(r), /\(no output\)/);
});

// A7.4
test('each query writes one log line with time, profile, service, operation, outcome and no argument values', async () => {
  const s = setup();
  await run(s, 'ec2', 'describe-instances', ['--filters', 'Name=tag:Owner,Values=SENTINEL-ARG-VALUE']);
  await run(s, 'ec2', 'run-instances', ['--image-id', 'ami-SENTINEL-ARG-VALUE']);
  const raw = readFileSync(join(s.dir, 'query.log'), 'utf8');
  assert.equal(raw.includes('SENTINEL-ARG-VALUE'), false);
  const rows = s.log();
  assert.equal(rows.length, 2);
  for (const row of rows) assert.deepEqual(Object.keys(row), ['time', 'profile', 'service', 'operation', 'outcome']);
  assert.deepEqual(rows.map((r) => r.outcome), ['ok', 'rejected']);
  assert.equal(statSync(join(s.dir, 'query.log')).mode & 0o777, 0o600);
});

test('a log failure never fails the query (broken audit, throwing audit)', async () => {
  const s = setup();
  s.ctx.audit = createAudit({ dir: join(s.dir, 'profiles.json', 'nope'), onError: () => {} }); // a file where the dir should be
  const r = await run(s, 'ec2', 'describe-instances');
  assert.equal(r.isError, undefined);
  s.ctx.audit = () => { throw new Error('disk full'); };
  const ok = await run(s, 'ec2', 'describe-instances');
  assert.equal(ok.isError, undefined);
  const rej = await run(s, 'ec2', 'run-instances');
  assert.match(text(rej), /^rejected \[not-allowed\]/);
});

// R3
test('the fake key, secret and session token appear in no result, argv, stdout or query.log', async () => {
  const written = [];
  const orig = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk, ...rest) => (written.push(String(chunk)), orig(chunk, ...rest));
  const results = [];
  const s = setup({
    behavior: (argv) => {
      if (argv[1] === 'describe-instances') return { stdout: `{"echo":"${FAKE.secret}","t":"${FAKE.token}","k":"${FAKE.key}"}` };
      if (argv[1] === 'describe-regions') return { error: Object.assign(new Error('x'), { code: 255 }), stderr: `bad creds ${FAKE.key} ${FAKE.secret} ${FAKE.token}` };
      return { stdout: '{}' };
    },
  });
  try {
    results.push(await run(s, 'ec2', 'describe-instances'));
    results.push(await run(s, 'ec2', 'describe-regions'));
    results.push(await run(s, 'ec2', 'describe-vpcs', ['--max-items', '1']));
    results.push(await run(s, 'ec2', 'run-instances', ['--image-id', 'x']));
  } finally {
    process.stdout.write = orig;
  }
  const argvs = JSON.stringify(s.spy.calls.map((c) => [c.file, c.argv]));
  const resultText = results.map((r) => JSON.stringify(r)).join('\n');
  const logText = readFileSync(join(s.dir, 'query.log'), 'utf8');
  for (const [name, value] of Object.entries(FAKE)) {
    for (const [where, haystack] of [['result', resultText], ['argv', argvs], ['stdout', written.join('')], ['query.log', logText]]) {
      assert.equal(haystack.includes(value), false, `${name} leaked into ${where}`);
    }
  }
  assert.equal(s.spy.calls.length, 3);
});

test('no shell option, no .aws and no eval/exec call in the query path sources', () => {
  for (const f of ['../query.mjs', '../policy.mjs', '../audit.mjs']) {
    const src = readFileSync(new URL(f, import.meta.url), 'utf8');
    assert.equal(/shell\s*:\s*true|child_process\.exec\b|\bexec\(|\.aws\b/.test(src), false, f);
  }
});
