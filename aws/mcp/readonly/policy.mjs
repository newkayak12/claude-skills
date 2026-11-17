// Read-only policy of the `query` tool. Pure: no I/O, no AWS call. check({ service, operation, args })
// returns { ok: true } or { rule, message }; a rejection never echoes an argument value.
//
// Order: tokens → named denies (they win even when the name matches describe-/list-/get-...) →
// argument rules → allow list → `not-allowed`.
//
// OUTFILE_OPERATIONS: every operation whose `aws <service> <operation> help` declares an `<outfile>`
// positional (the CLI writes the response body to that local file). Enumerated on 2026-11-17 from
// aws-cli/2.27.46 (`aws <service> <operation> help | grep '<outfile>'`) over every operation whose
// botocore output payload is a blob or streaming blob (the CLI adds `outfile` for those); every one of
// the 60 entries below printed an `<outfile>` positional, including `s3api get-object`,
// `get-object-torrent`, `select-object-content` and `lambda invoke`.
// The CLI is not asked at run time (check stays pure); re-run that scan when the CLI is upgraded. A
// new outfile operation not listed here is caught only by --output-file/--*outfile flags, not by
// the positional, so the IAM ReadOnlyAccess policy and the aws child's empty config stay the limit.

export const OUTFILE_OPERATIONS = Object.freeze([
  'apigateway get-export',
  'apigateway get-sdk',
  'apigatewayv2 export-api',
  'appconfig create-hosted-configuration-version',
  'appconfig get-configuration',
  'appconfig get-hosted-configuration-version',
  'appconfigdata get-latest-configuration',
  'appsync get-introspection-schema',
  'bedrock-runtime invoke-model',
  'cloudfront get-function',
  'codeartifact get-package-version-asset',
  'codeguruprofiler get-profile',
  'datazone get-lineage-event',
  'ebs get-snapshot-block',
  'geo-maps get-glyphs',
  'geo-maps get-sprites',
  'geo-maps get-static-map',
  'geo-maps get-style-descriptor',
  'geo-maps get-tile',
  'glacier get-job-output',
  'iot-data delete-thing-shadow',
  'iot-data get-thing-shadow',
  'iot-data update-thing-shadow',
  'iotwireless get-position-estimate',
  'iotwireless get-resource-position',
  'kinesis-video-archived-media get-clip',
  'kinesis-video-archived-media get-media-for-fragment-list',
  'kinesis-video-media get-media',
  'lakeformation get-work-unit-results',
  'lambda invoke',
  'lex-runtime post-content',
  'lex-runtime put-session',
  'lexv2-runtime put-session',
  'lexv2-runtime recognize-utterance',
  'location get-map-glyphs',
  'location get-map-sprites',
  'location get-map-style-descriptor',
  'location get-map-tile',
  'medialive describe-input-device-thumbnail',
  'mediastore-data get-object',
  'medical-imaging get-image-frame',
  'medical-imaging get-image-set-metadata',
  'neptune-graph execute-query',
  'neptunedata execute-gremlin-explain-query',
  'neptunedata execute-gremlin-profile-query',
  'neptunedata execute-open-cypher-explain-query',
  'omics get-read-set',
  'omics get-reference',
  'polly synthesize-speech',
  's3api get-object',
  's3api get-object-torrent',
  's3api select-object-content',
  'sagemaker-geospatial get-tile',
  'sagemaker-runtime invoke-endpoint',
  'schemas get-code-binding-source',
  'tnb get-sol-function-package-content',
  'tnb get-sol-function-package-descriptor',
  'tnb get-sol-network-package-content',
  'tnb get-sol-network-package-descriptor',
  'workmailmessageflow get-raw-message-content',
]);
const OUTFILE = new Set(OUTFILE_OPERATIONS);

const MESSAGES = {
  'not-allowed': 'only describe-*, list-*, get-*, lookup-*, search-*, sts get-caller-identity and s3 ls with an s3:// URI are allowed',
  'invalid-token': 'service and operation must be lowercase CLI names (letters, digits, dashes)',
  'invalid-args': 'args must be an array of strings',
  'endpoint-override': '--endpoint-url is not accepted; calls go to the AWS endpoints only',
  'profile-override': '--profile is not accepted; the active profile is used',
  'cli-input': '--cli-input-* is not accepted; pass arguments one by one',
  'global-flag': 'only the global flags --query, --max-items, --page-size and --no-paginate are accepted',
  'output-file': 'writing a response to a local file (--output-file, --*outfile) is not accepted',
  'url-or-file-value': 'argument values starting file://, fileb://, http:// or https:// are not accepted',
  'secret-value': 'secretsmanager get-secret-value reads a secret and is denied',
  'ssm-decryption': 'ssm parameter reads with --with-decryption return secrets and are denied; use --no-with-decryption',
  'kms-decrypt': 'kms decrypt returns plaintext and is denied',
  'kms-data-key': 'kms generate-data-key* returns key material and is denied',
  's3-high-level': 'high-level s3 commands other than ls can write, copy or sign and are denied; use s3api list-*/get-* or s3 ls s3://...',
  's3api-get-object': 's3api get-object and get-object-torrent download object content and are denied',
  'outfile-positional': 'this operation writes its response to a local outfile and is denied',
  'lambda-invoke': 'lambda invoke runs a function and is denied',
  'sts-session-token': 'sts get-session-token mints credentials and is denied',
  'sts-federation-token': 'sts get-federation-token mints credentials and is denied',
  'eks-token': 'eks get-token mints a cluster token and is denied',
  'ecr-login-password': 'ecr get-login-password mints a registry password and is denied',
  'ecr-authorization-token': 'ecr get-authorization-token mints a registry token and is denied',
  'ec2-password-data': 'ec2 get-password-data returns an instance password blob and is denied',
};
const reject = (rule) => ({ rule, message: MESSAGES[rule] });

const TOKEN_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const VALUE_PREFIX_RE = /^(file|fileb|https?):\/\//i;

// Each named deny, matched on `service operation` even when the operation name is get-*.
const DENY = new Map([
  ['secretsmanager get-secret-value', 'secret-value'],
  ['kms decrypt', 'kms-decrypt'],
  ['s3api get-object', 's3api-get-object'],
  ['s3api get-object-torrent', 's3api-get-object'],
  ['lambda invoke', 'lambda-invoke'],
  ['sts get-session-token', 'sts-session-token'],
  ['sts get-federation-token', 'sts-federation-token'],
  ['eks get-token', 'eks-token'],
  ['ecr get-login-password', 'ecr-login-password'],
  ['ecr get-authorization-token', 'ecr-authorization-token'],
  ['ec2 get-password-data', 'ec2-password-data'],
]);
const SSM_READS = new Set(['get-parameter', 'get-parameters', 'get-parameters-by-path', 'get-parameter-history']);

// Global flags the child must never receive, in the order an abbreviation is attributed to a rule
// (argparse accepts any unambiguous prefix, so a prefix of one of these is rejected as that flag).
const DENIED_FLAGS = [
  ['--endpoint-url', 'endpoint-override'],
  ['--profile', 'profile-override'],
  ['--cli-input-json', 'cli-input'],
  ['--cli-input-yaml', 'cli-input'],
  ...[
    '--debug', '--no-verify-ssl', '--output', '--region', '--version', '--color', '--no-sign-request', '--ca-bundle',
    '--cli-read-timeout', '--cli-connect-timeout', '--cli-binary-format', '--no-cli-pager', '--cli-auto-prompt',
    '--no-cli-auto-prompt', '--cli-error-format', '--generate-cli-skeleton', '--starting-token',
  ].map((f) => [f, 'global-flag']),
  ['--output-file', 'output-file'],
];

const flagName = (token) => token.split('=', 1)[0].toLowerCase();

function flagRule(token) {
  const name = flagName(token);
  if (name.includes('outfile')) return 'output-file';
  if (name.startsWith('--cli-input-')) return 'cli-input';
  return DENIED_FLAGS.find(([f]) => f.startsWith(name))?.[1] ?? null; // list order puts --output before --output-file
}

const withDecryption = (args) =>
  args.some((t) => {
    if (!t.startsWith('--')) return false;
    const name = flagName(t);
    return name.length > 2 && '--with-decryption'.startsWith(name);
  });

// Flags of `aws s3 ls`, exact names only (true = takes a value). Anything else is not-allowed.
const S3_LS_FLAGS = new Map([
  ['--recursive', false], ['--human-readable', false], ['--summarize', false], ['--no-paginate', false],
  ['--page-size', true], ['--max-items', true], ['--query', true],
  ['--request-payer', true], ['--bucket-name-prefix', true], ['--bucket-region', true],
]);

function s3LsArgs(args) {
  for (let i = 0; i < args.length; i++) {
    const t = args[i];
    if (t.startsWith('--')) {
      const takesValue = S3_LS_FLAGS.get(flagName(t));
      if (takesValue === undefined) return reject('not-allowed');
      if (takesValue && !t.includes('=')) i++; // the next token is this flag's value
    } else if (!t.startsWith('s3://')) return reject('not-allowed'); // a local path, or a stray token
  }
  return { ok: true };
}

export function check(input) {
  const { service, operation, args = [] } = input ?? {};
  if (typeof service !== 'string' || !TOKEN_RE.test(service) || typeof operation !== 'string' || !TOKEN_RE.test(operation)) {
    return reject('invalid-token');
  }
  if (!Array.isArray(args) || args.some((t) => typeof t !== 'string' || t.includes('\0') || t === '--')) return reject('invalid-args');

  const key = `${service} ${operation}`;
  const named = DENY.get(key);
  if (named) return reject(named);
  if (service === 'kms' && operation.startsWith('generate-data-key')) return reject('kms-data-key');
  if (service === 's3' && operation !== 'ls') return reject('s3-high-level');
  if (service === 'ssm' && SSM_READS.has(operation) && withDecryption(args)) return reject('ssm-decryption');
  if (OUTFILE.has(key)) return reject('outfile-positional');

  for (const t of args) {
    if (t.startsWith('--')) {
      const rule = flagRule(t);
      if (rule) return reject(rule);
    }
    const eq = t.startsWith('--') ? t.indexOf('=') : -1;
    if (VALUE_PREFIX_RE.test(t) || (eq >= 0 && VALUE_PREFIX_RE.test(t.slice(eq + 1)))) return reject('url-or-file-value');
  }

  if (service === 's3') return s3LsArgs(args);
  if (key === 'sts get-caller-identity') return { ok: true };
  if (/^(describe|list|get|lookup|search)-/.test(operation)) return { ok: true };
  return reject('not-allowed');
}
