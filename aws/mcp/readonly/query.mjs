// The `query` tool: one read-only aws CLI call. Order is fixed: policy check → reject → session → run.
// A rejected call never reaches ensureSession or aws. aws is started by execFile (no shell) with the
// child env allow-list of awsexec.mjs. Nothing about the call except the profile, service, operation
// and outcome is logged, and the key, secret and session token are scrubbed from every answer.
import { ok, err, header, defineTool, READ_ONLY } from './contract.mjs';
import { check } from './policy.mjs';
import { createAudit } from './audit.mjs';
import { execAws, childEnv } from './awsexec.mjs';
import { ensureSession } from './login.mjs';

const CAP = 1_048_576; // bytes of an answer; must match awsexec's default cap
const TIMEOUT_S = 60; // must match awsexec's default timeout
const NARROW = 'narrow the call with --query, --max-items or --page-size';

let sharedAudit;

const cut = (s) => {
  const b = Buffer.from(s);
  return b.length > CAP ? b.subarray(0, CAP).toString() : s;
};

const scrubber = (creds = {}) => {
  const values = [creds.AccessKeyId, creds.SecretAccessKey, creds.SessionToken, creds.accessKeyId, creds.secretAccessKey, creds.sessionToken].filter(
    (v) => typeof v === 'string' && v.length >= 8,
  );
  return (text) => values.reduce((t, v) => t.split(v).join('***'), String(text));
};

export const queryTool = defineTool({
  name: 'query',
  description:
    'Run one read-only AWS CLI call as the active profile: service and operation as in the CLI (ec2 + describe-instances) and args as separate strings. ' +
    'Allowed: describe-*, list-*, get-*, lookup-*, search-*, sts get-caller-identity, s3 ls with an s3:// URI. Anything else, and any override flag, comes back as "rejected [rule]". ' +
    'Output is cut at 1 MiB and a call stops at 60 s. The first line of every answer names profile, account and region.',
  inputSchema: {
    type: 'object',
    properties: {
      service: { type: 'string', description: 'AWS CLI service, e.g. ec2, s3api, iam.' },
      operation: { type: 'string', description: 'AWS CLI operation, e.g. describe-instances.' },
      args: { type: 'array', items: { type: 'string' }, description: 'Remaining arguments, one string each. Global flags: only --query, --max-items, --page-size, --no-paginate.' },
    },
    required: ['service', 'operation'],
    additionalProperties: false,
  },
  annotations: READ_ONLY,
  async handler(input, ctx) {
    const { service, operation } = input ?? {};
    const args = input?.args ?? [];
    const audit = ctx.audit ?? (sharedAudit ??= createAudit());
    let profile = '-';
    const log = (outcome) => {
      try {
        audit({ profile, service, operation, outcome });
      } catch {} // a log failure never fails the query
    };
    let scrub = scrubber();
    try {
      try {
        profile = ctx.profiles.active() ?? '-';
      } catch {}

      const verdict = check({ service, operation, args });
      if (!verdict.ok) {
        log('rejected');
        return err(`rejected [${verdict.rule}]: ${verdict.message}`);
      }
      if (profile === '-') {
        log('not-logged-in');
        return err('no active profile is set. Run aws:login');
      }
      const entry = ctx.profiles.get(profile);
      const head = (region = entry?.region) => header({ profile, account: entry?.account, region });

      let session;
      try {
        session = await (ctx.ensureSession ?? ensureSession)(profile, ctx);
      } catch (e) {
        session = { error: `session lookup failed: ${e?.message ?? 'unknown error'}. Run aws:login` };
      }
      if (!session || session.error || !session.creds) {
        log('not-logged-in');
        return err(`${head()}\n${session?.error ?? `profile ${profile} is not logged in. Run aws:login`}`);
      }
      scrub = scrubber(session.creds);
      const hd = head(session.region);

      let env;
      try {
        env = childEnv(session.creds, session.region, ctx.env ?? process.env);
      } catch (e) {
        log('error');
        return err(`${hd}\n${scrub(`could not prepare the aws environment: ${e?.message ?? 'unknown error'}`)}`);
      }

      let res;
      try {
        res = await (ctx.exec ?? execAws)([service, operation, ...args, '--output', 'json'], env);
      } catch (e) {
        if (e?.code === 'ENOENT') {
          log('cli-missing');
          return err(`${hd}\naws CLI not found: install the AWS CLI v2 and put aws on PATH (macOS: brew install awscli)`);
        }
        log('error');
        return err(`${hd}\n${scrub(e?.message ?? 'aws could not run')}`);
      }

      if (res.timedOut) {
        log('timeout');
        return err(`${hd}\naws timed out after ${TIMEOUT_S} s and was stopped; ${NARROW}.`);
      }
      if (res.truncated) {
        log('truncated');
        return { ...ok(`${hd}\n${cut(scrub(res.stdout ?? ''))}\n[truncated: output exceeded 1 MiB and was cut; ${NARROW}]`), _meta: { truncated: true } };
      }
      if (res.code !== 0) {
        log('error');
        const body = String(res.stderr ?? '').trim() || String(res.stdout ?? '').trim() || `aws exited with ${res.code === null ? 'no status' : `code ${res.code}`}`;
        return err(`${hd}\n${cut(scrub(body))}`);
      }
      log('ok');
      return ok(`${hd}\n${cut(scrub(res.stdout ?? '')) || '(no output)'}`);
    } catch (e) {
      log('error');
      return err(scrub(`query failed: ${e?.message ?? 'unknown error'}`));
    }
  },
});
