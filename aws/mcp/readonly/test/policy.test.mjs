import { test } from 'node:test';
import assert from 'node:assert/strict';
import { check, OUTFILE_OPERATIONS } from '../policy.mjs';

const rule = (service, operation, args = []) => {
  const r = check({ service, operation, args });
  assert.equal(r.ok, undefined, `${service} ${operation} ${args.join(' ')} should be rejected`);
  assert.equal(typeof r.message, 'string');
  return r.rule;
};
const passes = (service, operation, args = []) => assert.deepEqual(check({ service, operation, args }), { ok: true }, `${service} ${operation} ${args.join(' ')}`);

// A6.1 allow list
test('describe-, list-, get-, lookup- and search- operations pass', () => {
  passes('ec2', 'describe-instances');
  passes('iam', 'list-users');
  passes('rds', 'describe-db-instances', ['--max-items', '5']);
  passes('iam', 'get-account-summary');
  passes('cloudtrail', 'lookup-events', ['--query', 'Events[].EventName', '--no-paginate']);
  passes('connect', 'search-users', ['--instance-id', 'i']);
});

test('sts get-caller-identity passes', () => passes('sts', 'get-caller-identity'));

test('logs filter-log-events passes as one named operation; no other filter-* does', () => {
  passes('logs', 'filter-log-events', ['--log-group-name', '/aws/lambda/foo', '--filter-pattern', 'ERROR', '--start-time', '1700000000000']);
  for (const [s, o] of [['logs', 'filter-something'], ['logs', 'filter-log-event'], ['logs', 'filter-log-events-x'], ['ec2', 'filter-x'], ['ec2', 'filter-log-events']]) {
    assert.equal(rule(s, o), 'not-allowed', `${s} ${o}`);
  }
  assert.match(check({ service: 'ec2', operation: 'run-instances' }).message, /logs filter-log-events/);
});

test('--output passes only as exact lowercase json, text or table, as two tokens or --output=<v>', () => {
  for (const v of ['json', 'text', 'table']) {
    passes('ec2', 'describe-instances', ['--output', v]);
    passes('ec2', 'describe-instances', [`--output=${v}`]);
    passes('ec2', 'describe-instances', ['--max-items', '5', '--output', v, '--query', 'Reservations[]']);
    passes('logs', 'filter-log-events', ['--log-group-name', 'g', '--output', v]);
  }
  passes('s3', 'ls', ['--output', 'text', 's3://b']);
  passes('s3', 'ls', ['s3://b', '--output=table']);
  passes('sts', 'get-caller-identity', ['--output', 'text']);
});

test('--output with any other value, no value, an empty value or a repeat is global-flag', () => {
  const bad = [
    ['--output', 'yaml'], ['--output', 'yaml-stream'], ['--output', 'JSON'], ['--output', 'Text'], ['--output', ' json'], ['--output', 'json '], ['--output', ''],
    ['--output=yaml'], ['--output=yaml-stream'], ['--output=JSON'], ['--output='], ['--output', '--query'], ['--output', 'jsonx'],
    ['--output'], ['--max-items', '5', '--output'],
    ['--output', 'json', '--output', 'json'], ['--output=json', '--output=text'], ['--output', 'json', '--output=json'], ['--output', 'json', '--output'],
    ['--OUTPUT', 'json'], ['--Output=json'],
  ];
  for (const a of bad) assert.equal(rule('ec2', 'describe-instances', a), 'global-flag', JSON.stringify(a));
  assert.equal(rule('s3', 'ls', ['--output', 'yaml', 's3://b']), 'global-flag');
  assert.equal(rule('s3', 'ls', ['--output', 'json', '--output', 'json', 's3://b']), 'global-flag');
  assert.match(check({ service: 'ec2', operation: 'describe-instances', args: ['--output', 'yaml'] }).message, /--output json\|text\|table/);
});

test('--output abbreviations stay global-flag; --output-file forms and --outfile stay output-file', () => {
  for (const a of [['--out', 'json'], ['--outp', 'json'], ['--outpu', 'text'], ['--out=json'], ['--outp=table']]) {
    assert.equal(rule('ec2', 'describe-instances', a), 'global-flag', JSON.stringify(a));
  }
  for (const a of [['--output-file', 'x'], ['--output-file=x'], ['--output-f', 'x'], ['--outfile', 'x'], ['--output', 'json', '--output-file', 'x']]) {
    assert.equal(rule('ec2', 'describe-instances', a), 'output-file', JSON.stringify(a));
  }
});

test('a rejected --output never puts its value in the message', () => {
  const secret = 'DISTINCTIVESECRET987';
  for (const a of [['--output', secret], [`--output=${secret}`], ['--output', 'json', '--output', secret], [`--output-file=${secret}`], ['--outp', secret]]) {
    const r = check({ service: 'ec2', operation: 'describe-instances', args: a });
    assert.ok(r.rule, JSON.stringify(a));
    assert.equal(r.message.includes(secret), false, JSON.stringify(a));
  }
});

test('--output does not weaken a named deny or the file/url rules', () => {
  assert.equal(rule('secretsmanager', 'get-secret-value', ['--output', 'text']), 'secret-value');
  assert.equal(rule('ec2', 'run-instances', ['--output', 'text']), 'not-allowed');
  assert.equal(rule('ec2', 'describe-instances', ['--output', 'text', '--filters', 'file://x']), 'url-or-file-value');
  assert.equal(rule('s3', 'ls', ['--output', 'text', '/etc']), 'not-allowed');
});

test('s3 ls passes with no argument or with s3:// URIs only', () => {
  passes('s3', 'ls');
  passes('s3', 'ls', ['s3://my-bucket']);
  passes('s3', 'ls', ['s3://my-bucket/prefix/', '--recursive', '--human-readable', '--summarize']);
  passes('s3', 'ls', ['--page-size', '100', '--max-items', '10', 's3://b']);
  passes('s3', 'ls', ['--request-payer', 'requester', 's3://b']);
});

test('s3 ls with a local path is not-allowed', () => {
  for (const p of ['/etc', './x', '~/x', 'my-bucket', '-1']) assert.equal(rule('s3', 'ls', [p]), 'not-allowed');
  assert.equal(rule('s3', 'ls', ['s3://b', '/etc']), 'not-allowed');
  assert.equal(rule('s3', 'ls', ['--recurs']), 'not-allowed'); // abbreviations of s3 ls options are not accepted
});

// A6.2
test('operations outside the prefixes are not-allowed', () => {
  assert.equal(rule('ec2', 'run-instances'), 'not-allowed');
  for (const [s, o] of [['ec2', 'terminate-instances'], ['iam', 'create-user'], ['s3api', 'put-object'], ['sts', 'assume-role'], ['dynamodb', 'scan'], ['ec2', 'getaway'], ['ec2', 'describe'], ['ec2', 'help']]) {
    assert.equal(rule(s, o), 'not-allowed', `${s} ${o}`);
  }
  assert.equal(rule('sts', 'assume-role-with-web-identity'), 'not-allowed');
  assert.equal(rule('s3api', 'get'), 'not-allowed'); // the prefix is `get-`, with the dash
});

// A6.6 data-plane reads under get-* pass
test('data-plane reads under get-* pass', () => {
  passes('lambda', 'get-function-configuration', ['--function-name', 'f']);
  passes('dynamodb', 'get-item', ['--table-name', 't', '--key', '{"id":{"S":"1"}}']);
  passes('logs', 'get-log-events', ['--log-group-name', 'g', '--log-stream-name', 's']);
  passes('athena', 'get-query-results', ['--query-execution-id', 'abc']);
});

// A6.3 named denies, even when the prefix matches
test('secretsmanager get-secret-value is denied', () => {
  assert.equal(rule('secretsmanager', 'get-secret-value', ['--secret-id', 'x']), 'secret-value');
  assert.equal(rule('secretsmanager', 'get-secret-value'), 'secret-value');
});

test('ssm decryption: get-parameter, get-parameters, get-parameters-by-path, get-parameter-history with --with-decryption', () => {
  for (const op of ['get-parameter', 'get-parameters', 'get-parameters-by-path', 'get-parameter-history']) {
    assert.equal(rule('ssm', op, ['--name', 'x', '--with-decryption']), 'ssm-decryption', op);
  }
  assert.equal(rule('ssm', 'get-parameter-history', ['--name', 'x', '--with-decryption']), 'ssm-decryption');
});

test('ssm --with-decryption in abbreviated and --flag=value forms, and order', () => {
  for (const f of ['--with-decryption', '--with-decrypt', '--with', '--wi', '--w', '--WITH-DECRYPTION', '--with-decryption=true']) {
    assert.equal(rule('ssm', 'get-parameter', ['--name', 'x', f]), 'ssm-decryption', f);
  }
  assert.equal(rule('ssm', 'get-parameter', ['--with-decryption', '--name', 'x']), 'ssm-decryption');
  assert.equal(rule('ssm', 'get-parameter', ['--no-with-decryption', '--with-decryption']), 'ssm-decryption');
});

test('ssm --no-with-decryption is not a deny, and plain ssm reads pass', () => {
  passes('ssm', 'get-parameter', ['--name', 'x', '--no-with-decryption']);
  passes('ssm', 'get-parameters', ['--names', 'a', 'b', '--no-with-decryption']);
  passes('ssm', 'get-parameter', ['--name', 'x']);
  passes('ssm', 'get-parameters-by-path', ['--path', '/app', '--recursive']);
  passes('ssm', 'describe-parameters');
  passes('ssm', 'get-parameter', ['--name', 'x', '--no-with']);
});

test('kms decrypt is denied', () => {
  assert.equal(rule('kms', 'decrypt', ['--key-id', 'k']), 'kms-decrypt');
  assert.equal(rule('kms', 'decrypt'), 'kms-decrypt');
});

test('kms generate-data-key* is denied', () => {
  for (const op of ['generate-data-key', 'generate-data-key-without-plaintext', 'generate-data-key-pair', 'generate-data-key-pair-without-plaintext']) {
    assert.equal(rule('kms', op), 'kms-data-key', op);
  }
  passes('kms', 'list-keys');
  passes('kms', 'describe-key', ['--key-id', 'k']);
  passes('kms', 'get-key-policy', ['--key-id', 'k', '--policy-name', 'default']);
});

test('every high-level s3 command except ls is denied: cp, mb, mv, presign, rb, rm, sync, website', () => {
  for (const op of ['cp', 'mb', 'mv', 'presign', 'rb', 'rm', 'sync', 'website']) {
    assert.equal(rule('s3', op, ['s3://b']), 's3-high-level', op);
    assert.equal(rule('s3', op), 's3-high-level', op);
  }
  assert.equal(rule('s3', 'cp', ['s3://a/x', '/tmp/x']), 's3-high-level');
  assert.equal(rule('s3', 'sync', ['s3://a', './dir']), 's3-high-level');
  assert.equal(rule('s3', 'presign', ['s3://b/k']), 's3-high-level'); // presign mints a URL
  assert.equal(rule('s3', 'website', ['s3://b', '--index-document', 'i.html']), 's3-high-level');
  assert.equal(rule('s3', 'anything-else'), 's3-high-level');
});

test('s3api get-object is denied, and so is get-object-torrent; other s3api reads pass', () => {
  assert.equal(rule('s3api', 'get-object', ['--bucket', 'b', '--key', 'k']), 's3api-get-object');
  assert.equal(rule('s3api', 'get-object', ['--bucket', 'b', '--key', 'k', 'out.bin']), 's3api-get-object');
  assert.equal(rule('s3api', 'get-object-torrent', ['--bucket', 'b', '--key', 'k', 'out']), 's3api-get-object');
  passes('s3api', 'list-buckets');
  passes('s3api', 'get-bucket-policy', ['--bucket', 'b']);
  passes('s3api', 'get-object-attributes', ['--bucket', 'b', '--key', 'k', '--object-attributes', 'ETag']);
});

test('--output-file is denied in every form', () => {
  assert.equal(rule('ec2', 'describe-instances', ['--output-file', 'x']), 'output-file');
  assert.equal(rule('ec2', 'describe-instances', ['--output-file=x']), 'output-file');
  assert.equal(rule('ec2', 'describe-instances', ['--output-f', 'x']), 'output-file');
  assert.equal(rule('ec2', 'describe-instances', ['--outfile', 'x']), 'output-file');
  assert.equal(rule('iot', 'list-things', ['--certificate-pem-outfile', 'x']), 'output-file');
});

test('operations whose help declares an outfile positional are denied (enumerated list)', () => {
  assert.ok(OUTFILE_OPERATIONS.length >= 55);
  for (const [s, o] of [['polly', 'synthesize-speech'], ['glacier', 'get-job-output'], ['apigateway', 'get-export'], ['apigateway', 'get-sdk'], ['appconfig', 'get-configuration'], ['lambda', 'invoke'], ['iot-data', 'get-thing-shadow'], ['mediastore-data', 'get-object'], ['cloudfront', 'get-function'], ['omics', 'get-read-set'], ['sagemaker-runtime', 'invoke-endpoint']]) {
    assert.ok(OUTFILE_OPERATIONS.includes(`${s} ${o}`), `${s} ${o} listed`);
  }
  for (const entry of OUTFILE_OPERATIONS) {
    const [s, o] = entry.split(' ');
    if (s === 'lambda' || s === 's3api') continue; // named rules come first
    assert.equal(rule(s, o, ['out.bin']), 'outfile-positional', entry);
  }
  assert.equal(rule('apigateway', 'get-export', ['--rest-api-id', 'a', '--stage-name', 's', '--export-type', 'swagger', 'out.json']), 'outfile-positional');
  assert.equal(rule('s3api', 'select-object-content', ['out']), 'outfile-positional');
});

test('lambda invoke is denied', () => {
  assert.equal(rule('lambda', 'invoke', ['--function-name', 'f', 'out.json']), 'lambda-invoke');
  assert.equal(rule('lambda', 'invoke'), 'lambda-invoke');
  assert.equal(rule('lambda', 'invoke-async'), 'not-allowed');
});

// A6.4 extra rules
test('ssm get-parameter-history with --with-decryption is denied; without it passes', () => {
  assert.equal(rule('ssm', 'get-parameter-history', ['--name', 'x', '--with-decryption']), 'ssm-decryption');
  passes('ssm', 'get-parameter-history', ['--name', 'x']);
  passes('ssm', 'get-parameter-history', ['--name', 'x', '--no-with-decryption']);
});

test('sts get-session-token and get-federation-token are denied', () => {
  assert.equal(rule('sts', 'get-session-token', ['--serial-number', 'x']), 'sts-session-token');
  assert.equal(rule('sts', 'get-session-token'), 'sts-session-token');
  assert.equal(rule('sts', 'get-federation-token', ['--name', 'n']), 'sts-federation-token');
  assert.equal(rule('sts', 'get-federation-token'), 'sts-federation-token');
  passes('sts', 'get-access-key-info', ['--access-key-id', 'AKIAEXAMPLE']);
});

test('eks get-token is denied', () => {
  assert.equal(rule('eks', 'get-token', ['--cluster-name', 'c']), 'eks-token');
  passes('eks', 'describe-cluster', ['--name', 'c']);
});

test('ecr get-login-password and get-authorization-token are denied', () => {
  assert.equal(rule('ecr', 'get-login-password'), 'ecr-login-password');
  assert.equal(rule('ecr', 'get-authorization-token'), 'ecr-authorization-token');
  passes('ecr', 'describe-repositories');
});

test('ec2 get-password-data is denied', () => {
  assert.equal(rule('ec2', 'get-password-data', ['--instance-id', 'i-1']), 'ec2-password-data');
});

// A6.5 override and flag rules
test('--endpoint-url is rejected in every form', () => {
  assert.equal(rule('ec2', 'describe-instances', ['--endpoint-url', 'x']), 'endpoint-override');
  assert.equal(rule('ec2', 'describe-instances', ['--endpoint-url=x']), 'endpoint-override');
  assert.equal(rule('ec2', 'describe-instances', ['--endpoint', 'x']), 'endpoint-override');
  assert.equal(rule('ec2', 'describe-instances', ['--endpoint-u=x']), 'endpoint-override');
  assert.equal(rule('ec2', 'describe-instances', ['--ENDPOINT-URL', 'x']), 'endpoint-override');
  assert.equal(rule('s3', 'ls', ['--endpoint-url', 'x']), 'endpoint-override');
});

test('--profile is rejected in every form', () => {
  assert.equal(rule('ec2', 'describe-instances', ['--profile', 'other']), 'profile-override');
  assert.equal(rule('ec2', 'describe-instances', ['--profile=other']), 'profile-override');
  assert.equal(rule('ec2', 'describe-instances', ['--prof', 'other']), 'profile-override');
  assert.equal(rule('ec2', 'describe-instances', ['--profil=other']), 'profile-override');
});

test('--cli-input-json and --cli-input-yaml are rejected, abbreviated or not', () => {
  assert.equal(rule('ec2', 'describe-instances', ['--cli-input-json', 'x']), 'cli-input');
  assert.equal(rule('ec2', 'describe-instances', ['--cli-input-yaml', 'x']), 'cli-input');
  assert.equal(rule('ec2', 'describe-instances', ['--cli-input-json=x']), 'cli-input');
  assert.equal(rule('ec2', 'describe-instances', ['--cli-input', 'x']), 'cli-input');
  assert.equal(rule('ec2', 'describe-instances', ['--cli-input-y']), 'cli-input');
  assert.equal(rule('ec2', 'describe-instances', ['--cli-input-future']), 'cli-input');
});

test('only --query, --max-items, --page-size and --no-paginate pass of the global flags', () => {
  passes('ec2', 'describe-instances', ['--query', 'Reservations[].Instances[].InstanceId']);
  passes('ec2', 'describe-instances', ['--query=Reservations[]', '--max-items=5', '--page-size=2', '--no-paginate']);
  passes('ec2', 'describe-instances', ['--max', '5', '--page', '2', '--no-pag']);
  passes('ec2', 'describe-instances', ['--filters', 'Name=instance-state-name,Values=running', '--instance-ids', 'i-1', 'i-2']);
  for (const f of ['--region', '--debug', '--no-sign-request', '--ca-bundle', '--no-verify-ssl', '--color', '--version', '--cli-read-timeout', '--cli-connect-timeout', '--cli-binary-format', '--no-cli-pager', '--cli-auto-prompt', '--no-cli-auto-prompt', '--generate-cli-skeleton', '--starting-token', '--cli-error-format']) {
    assert.equal(rule('ec2', 'describe-instances', [f]), 'global-flag', f);
    assert.equal(rule('ec2', 'describe-instances', [`${f}=x`]), 'global-flag', `${f}=x`);
  }
});

test('abbreviated global flags and mixed-case flags are rejected', () => {
  for (const f of ['--reg', '--regi=us-east-1', '--out', '--outp', '--no-sign', '--no-verify', '--ca', '--ca-b', '--debu', '--REGION', '--Region=x', '--no-cli-p', '--col']) {
    assert.equal(rule('ec2', 'describe-instances', [f]), 'global-flag', f);
  }
});

test('bare -- is invalid-args', () => assert.equal(rule('ec2', 'describe-instances', ['--']), 'invalid-args'));

test('values starting file://, fileb://, http:// or https:// are rejected, also inside --flag=value', () => {
  for (const v of ['file:///etc/passwd', 'fileb://x', 'http://x', 'https://x', 'FILE://x', 'Https://x']) {
    assert.equal(rule('ec2', 'describe-instances', ['--filters', v]), 'url-or-file-value', v);
    assert.equal(rule('ec2', 'describe-instances', [`--filters=${v}`]), 'url-or-file-value', `--filters=${v}`);
    assert.equal(rule('ec2', 'describe-instances', [v]), 'url-or-file-value', v);
  }
  assert.equal(rule('iam', 'get-user', ['--query', 'file://q.jmespath']), 'url-or-file-value');
  passes('ec2', 'describe-instances', ['--filters', 'Name=tag:url,Values=https-thing']);
  passes('ec2', 'describe-instances', ['--filters', 'Name=tag:u,Values=file']);
});

// token validation
test('service and operation must be validated tokens', () => {
  for (const bad of ['', 'EC2', 'ec2 ', 'ec2;ls', '-ec2', '../x', 'a'.repeat(65), 'ec2\n', 'ec_2', 'é']) {
    assert.equal(rule(bad, 'describe-instances'), 'invalid-token', JSON.stringify(bad));
    assert.equal(rule('ec2', bad), 'invalid-token', JSON.stringify(bad));
  }
  for (const bad of [undefined, null, 5, {}, ['ec2']]) {
    assert.equal(rule(bad, 'describe-instances'), 'invalid-token');
    assert.equal(rule('ec2', bad), 'invalid-token');
  }
});

test('args must be a string array', () => {
  for (const bad of ['--query x', 5, {}, [1], [null], ['a', ['b']], [undefined]]) {
    const r = check({ service: 'ec2', operation: 'describe-instances', args: bad });
    assert.equal(r.rule, 'invalid-args', JSON.stringify(bad));
  }
  assert.equal(check({ service: 'ec2', operation: 'describe-instances', args: ['a\0b'] }).rule, 'invalid-args');
  assert.deepEqual(check({ service: 'ec2', operation: 'describe-instances' }), { ok: true }); // args omitted = []
  assert.equal(check(undefined).rule, 'invalid-token');
});

test('rejection messages never echo argument values', () => {
  const secret = 'SUPERSECRETVALUE123';
  const cases = [
    ['ec2', 'describe-instances', [`--endpoint-url=http://${secret}`]],
    ['ec2', 'describe-instances', ['--endpoint', secret]],
    ['ec2', 'describe-instances', ['--filters', `file://${secret}`]],
    ['ssm', 'get-parameter', ['--name', secret, '--with-decryption']],
    ['s3', 'ls', [secret]],
    ['ec2', 'describe-instances', ['--output', secret]],
  ];
  for (const [s, o, a] of cases) {
    const r = check({ service: s, operation: o, args: a });
    assert.ok(r.rule, `${s} ${o}`);
    assert.equal(r.message.includes(secret), false, `${s} ${o}`);
  }
});

test('a name that matches the allow list is still denied: deny runs before allow', () => {
  for (const [s, o] of [['secretsmanager', 'get-secret-value'], ['kms', 'generate-data-key'], ['eks', 'get-token'], ['ec2', 'get-password-data'], ['sts', 'get-session-token'], ['ecr', 'get-authorization-token'], ['s3api', 'get-object']]) {
    assert.ok(/^(get|generate)-/.test(o));
    assert.notEqual(check({ service: s, operation: o, args: [] }).ok, true, `${s} ${o}`);
  }
});

test('check is pure: it does not touch the args array', () => {
  const args = Object.freeze(['--query', 'x']);
  assert.deepEqual(check({ service: 'ec2', operation: 'describe-instances', args }), { ok: true });
});
