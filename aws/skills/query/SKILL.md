---
name: query
description: Use when reading AWS resources read-only through the aws CLI (describe/list/get/lookup/search). Triggers on "dev 계정 EC2 목록", "S3 버킷 보여줘", "람다 설정 조회", "CloudTrail 이벤트 찾아줘", "list EC2 instances", "describe the RDS instance", "aws query", "/aws:query".
scenarios:
  - "List the EC2 instances in the dev account"
  - "Describe the RDS instance orders-db and list the S3 buckets"
  - "Look up recent CloudTrail events for DeleteBucket"
  - "dev 계정 EC2 인스턴스 목록 보여줘"
  - "S3 버킷 목록이랑 람다 함수 설정 조회해줘"
  - "CloudWatch 로그 그룹 목록 알려줘"
compatibility:
  required:
    - readonly-aws MCP server (started by the plugin)
  optional: []
---

# aws:query

## Anchors

- **Forbidden reflex.** Running `aws` straight from Bash with whatever is in `~/.aws`; asking the
  person to paste keys in chat; rephrasing, re-quoting or re-ordering a call to get around `rejected`.
- **Boundary.** Not for writes or infra changes. Data inside a database goes to `database:query`.
- **Done.** Every answer names the profile, account and region it came from (`dev · 123456789012 · ap-northeast-2`);
  a `rejected [rule]` line is quoted verbatim, not paraphrased.

## Process

1. **Profile.** An account named ("dev 계정", "on prod") and not active → `aws:profile` first. Not
   logged in or session `expired` → offer `aws:login`. Read the active profile line (profile · account · region).
2. **Call.** `query` with `{service, operation, args[]}`: service and operation as in the CLI
   (`ec2` + `describe-instances`), one call each, args as separate strings.
   - Allowed: `describe-*`, `list-*`, `get-*`, `lookup-*`, `search-*`; `sts get-caller-identity`; `s3 ls` with an `s3://` URI only.
   - Global flags: only `--query`, `--max-items`, `--page-size`, `--no-paginate`. Narrow big answers with `--query` and `--max-items`.
   - `aws CLI not installed → aws:login installs it` → hand off to `aws:login` (its step 1 installs the CLI); run no
     `aws`, `brew` or installer from Bash. The same answer after the install → ask the person to run
     `/reload-plugins` or restart Claude Code, then stop; no retry loop.
3. **Data-plane reads.** `get-*` that return content are allowed: `lambda get-function-configuration`
   (environment variables), `dynamodb get-item`, `logs get-log-events`, `athena get-query-results`. The IAM
   ReadOnlyAccess policy on the keys is the real limit, not this skill; recommend attaching it. Rows of a
   relational database go to `database:query`.
4. **Rejected.** `rejected [rule]` is the server's read-only guard. Quote the line verbatim, say which part of
   the ask it blocks, and answer the rest. Never rephrase around it and never offer a Bash `aws` call instead.
   Refused by rule: secret reads (`secretsmanager get-secret-value`, `ssm get-parameter*` with
   `--with-decryption`), `kms decrypt`/`generate-data-key*`, `s3api get-object` and any outfile operation, high-level
   `s3` other than `ls`, `lambda invoke`, credential minting (`sts get-session-token`/`get-federation-token`,
   `eks get-token`, `ecr get-login-password`/`get-authorization-token`, `ec2 get-password-data`), every write,
   `--endpoint-url`/`--profile`/`--cli-input-*`/`--output-file`, and values starting `file://`, `fileb://`, `http://`, `https://`.
5. **Limits.** Output is cut at 1 MiB and a call stops at 60 s: say so when it happens and narrow with
   `--query`, `--max-items` or `--page-size`.
6. **Log.** Every call is logged locally without values (`~/.config/aws-readonly-mcp/query.log`,
   mode 0600); "what did we run" → read that file.

## Output Template

```
[dev · 123456789012 · ap-northeast-2] <one line: what was asked>
<result table or summary, count N, truncated yes/no>
rejected [rule]: <server line, verbatim>   (only when a call was refused)
```

## What Claude Does / What You Do

| Claude | You |
|---|---|
| Switches to the account, runs read-only calls, names profile · account · region, quotes rejections verbatim | Say which account and what to look at; for a refused secret, get it from its owner, not through this server |

## Related Skills

- `aws:profile` — switch account or region.
- `aws:login` — log in or renew an expired session.
- `database:query` — rows inside a database.
