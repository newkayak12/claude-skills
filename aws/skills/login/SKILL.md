---
name: login
description: Use when logging in to a read-only AWS profile (IAM user keys, optional MFA session) for the aws CLI. Triggers on "aws 로그인해줘", "AWS 키 저장", "dev 계정 로그인", "MFA 세션 열어줘", "log in to aws", "aws login", "/aws:login".
scenarios:
  - "Log in to AWS as profile dev in ap-northeast-2"
  - "Log in to AWS with MFA serial arn:aws:iam::123456789012:mfa/me"
  - "Log in to the prod profile, keys are in 1Password vault Infra, item aws-prod"
  - "aws 로그인해줘, 프로필은 dev, 리전은 ap-northeast-2"
  - "MFA 걸린 계정으로 aws 로그인하고 세션 열어줘"
  - "1Password에 있는 키로 aws 로그인해줘"
compatibility:
  required:
    - readonly-aws MCP server (this plugin's mcp/readonly; started by the plugin)
  optional: []
---

# aws:login

IAM user keys only, no roles. macOS only. Read-only: the server refuses writes, not this text.

## Anchors

- **Forbidden reflex.** Running `aws` straight from Bash with whatever is in `~/.aws`; asking the
  person to paste an access key or secret in chat (a pasted key is not repeated: call `login`
  without it so the dialog or 1Password asks); rephrasing a call to get around `rejected`.
- **Boundary.** Not for writes or infra changes. Data inside a database goes to `database:query`.
- **Done.** Every answer names the profile, account and region it came from; a `rejected [rule]`
  or error line is quoted verbatim.

## Process

1. **Server ready.** The plugin starts `readonly-aws` (tools `mcp__plugin_aws_readonly-aws__*`) from a
   bundled file. Tools missing → ask the person to run `/reload-plugins` or reconnect
   `plugin:aws:readonly-aws` in `/mcp`. `aws` CLI or Keychain missing → quote the error that names it.
2. **Fields.** `profile` (no name) shows what is saved. Ask only for what is missing:
   - `profile` — name matching `[a-z0-9_-]{1,32}`.
   - `region` — e.g. `ap-northeast-2`.
   - `label?` — defaults to the account id from `sts get-caller-identity`.
   - `mfa_serial?` — the MFA device ARN; saved in the profile file. None → no MFA session.
   - `vault?` and `item?` — only for keys held in 1Password.
3. **Log in.** Call `login` with those fields. Keys come from exactly two places:
   - Default: the server opens a macOS hidden dialog for Access Key ID and Secret Access Key; they go to
     Keychain (service `readonly-aws`, account `<profile>`).
   - 1Password: `vault` and `item` given → the server reads fields `access key id` and `secret access key`
     (case-insensitive) with `op`; with `mfa_serial` it also reads the code via `op item get --otp`.
   - The person offers keys in chat → decline in one line, name the dialog and 1Password, call `login` without them.
4. **MFA session.** With `mfa_serial`, the server calls `sts get-session-token` for 129600 s (36 h),
   falling back to 43200 then 3600 if refused, and stores the session in Keychain (account
   `<profile>:session`). Always show the returned `Expiration`.
   - Without `mfa_serial` the long-term keys are used directly: expiry `none`, no session.
   - A 1Password TOTP already used in its 30 s window is refused → the server retries once after the window; a second refusal is an error to quote.
5. **Report** profile, account, region, label, key source (dialog or 1Password), session expiry and the
   connection test (`sts get-caller-identity`: `ok` or the failure). `login cancelled` → nothing was saved.

## Output Template

```
[login: dev] saved (keys: keychain) · 123456789012 · ap-northeast-2 · session until 2026-11-19T04:12:00Z · connection ok
```

Without MFA: `session none (long-term keys)`.

## What Claude Does / What You Do

| Claude | You |
|---|---|
| Asks profile, region and optional MFA serial or vault/item, calls `login`, shows account, region and Expiration, declines keys in chat | Type the keys in the macOS dialog, or name the 1Password vault and item; give the MFA serial |

## Related Skills

- `aws:profile` — switch to the profile after logging in.
- `aws:logout` — drop the session or forget the keys.
- `aws:query` — read AWS resources.
- `database:query` — rows inside a database, not AWS APIs.
