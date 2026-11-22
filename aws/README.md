# aws

**English** · [한국어](KOR.md)

Read-only AWS CLI access: one MCP server (`readonly-aws`) with five tools (`profile`, `profile_save`,
`login`, `logout`, `query`) and four skills that drive them. macOS only. It uses IAM user access keys (Access Key ID +
Secret Access Key) with an optional MFA session; roles and AssumeRole are not supported.

| Skill | Does |
|---|---|
| `aws:login` | Adds keys to a profile (asking only what the profile does not hold yet): the server opens a macOS hidden dialog for the keys (Keychain), or reads them from 1Password. Tests with `sts get-caller-identity`. |
| `aws:logout` | Deletes the profile's cached session locally; `forget: true` also removes the stored keys. |
| `aws:profile` | Creates or updates a profile (name, account, region, MFA serial, 1Password reference; never keys), lists every profile with account, key source and session expiry, or switches the active one. |
| `aws:query` | Runs one read-only AWS CLI call; every answer names its profile, account and region. |

```
Log in to dev (ap-northeast-2), then list the EC2 instances.
```

## Profiles

Create one before any key is involved: `profile_save` with a name matching `[a-z0-9_-]{1,32}`, a region,
and optionally the 12-digit account, a `label`, an MFA serial and a 1Password `vault`/`item`/`otp_item`.
Several profiles coexist; `profile` with no name lists them all (active one marked), `profile <name>` switches.
A field left out stays as saved; `null` removes it.

## Login

- **Profile**: `login <name>` reuses the saved fields and asks only for what is missing, one field per
  message (name → account → region → MFA serial; keys and the MFA code come through the dialog or 1Password).
  With an account saved, keys of another account are refused. `label` defaults to the account id.
- **Hidden dialog** (default): the keys are typed into a macOS hidden dialog and stored in Keychain
  service `readonly-aws`, account `<profile>`. No tool takes a key as an argument, so keys never go through the chat.
- **1Password**: pass `vault` and `item`; the server reads only the fields `username` (access key id)
  and `password` (secret access key), case-insensitive, with `op item get`. The one-time
  code comes from `op item get --otp` on `otp_item` (another item in the same vault) when given, else on
  `item`, when an MFA serial is set. Only the reference is stored.
- **MFA (optional)**: pass `mfa_serial` (saved in the profile file). Login then calls
  `sts get-session-token` for **129600 s (36 h)**, the IAM-user maximum; if refused it falls back to
  43200, then 3600. The returned `Expiration` is always shown. The session is cached in Keychain
  account `<profile>:session` and renewed silently when it expires; a TOTP code already used in its
  30 s window is rejected, and the silent re-login returns a clear error and retries once after the window.
- **No MFA serial**: the stored long-term keys are used directly; `profile` shows expiry `none`.

## Logout

Deletes the cached session locally and reports its expiry. STS tokens cannot be revoked: a session stays
valid until its `Expiration`. `forget: true` also removes the stored keys (or the 1Password reference).
Without an MFA serial there is no session, and logout says so.

## Query

- **Limits**: output is capped at 1 MiB, each call times out at 60 s.
- **Log**: every call goes to `~/.config/aws-readonly-mcp/query.log` (mode 0600, rolled at 5 MB),
  with the command shape and no values.
- **Data-plane reads are allowed.** `get-*` calls such as `lambda get-function-configuration`
  (environment variables), `dynamodb get-item`, `logs get-log-events` and `athena get-query-results`
  can return secrets or data. The IAM `ReadOnlyAccess` policy is the real limit, so attach it
  (and only it) to the IAM user. Database rows go to `database:query`.

### Read-only rules

The server refuses, not the prompt. A refused call returns `rejected [rule]: ...`.

- **Allowed**: `describe-*`, `list-*`, `get-*`, `lookup-*`, `search-*`; `logs filter-log-events`; `sts get-caller-identity`;
  `s3 ls` with an `s3://` URI only.
- **Denied**:
  - `secretsmanager get-secret-value`
  - `ssm get-parameter`, `get-parameters`, `get-parameters-by-path`, `get-parameter-history` with `--with-decryption`
  - `kms decrypt`, `kms generate-data-key*`
  - high-level `s3` commands except `ls`; `s3 presign`
  - `s3api get-object`, `get-object-torrent`, and any operation that writes an outfile
  - `--output-file`
  - `lambda invoke`
  - `sts get-session-token`, `sts get-federation-token`
  - `eks get-token`
  - `ecr get-login-password`, `ecr get-authorization-token`
  - `ec2 get-password-data`
  - `--endpoint-url`, `--profile`, `--cli-input-*`
  - every global flag except `--query`, `--max-items`, `--page-size`, `--no-paginate` and `--output json|text|table`
  - argument values starting `file://`, `fileb://`, `http://`, `https://`

Setup: needs the `aws` CLI on the PATH; if it is missing the server answers 'aws CLI not installed → aws:login installs it', and `aws:login` installs AWS CLI v2 (brew, else the official pkg; may ask for the password); `op` only for 1Password logins.
The plugin starts `plugin:aws:readonly-aws` from one bundled file; no npm and no network on install.

0.2.2: Codex gets the same server and skills (`.codex-plugin/plugin.json`).
