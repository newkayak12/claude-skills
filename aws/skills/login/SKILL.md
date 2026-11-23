---
name: login
description: Use when logging in to a read-only AWS profile (IAM user name and password, optional MFA session) for the aws CLI. Triggers on "aws 로그인해줘", "AWS 키 저장", "dev 계정 로그인", "MFA 세션 열어줘", "log in to aws", "aws login", "/aws:login".
scenarios:
  - "Log in to AWS as profile dev in ap-northeast-2"
  - "Log in to AWS with MFA serial arn:aws:iam::123456789012:mfa/me"
  - "Log in to the prod profile, the username and password are in 1Password vault Infra, item aws-prod"
  - "aws 로그인해줘, 프로필은 dev, 리전은 ap-northeast-2"
  - "MFA 걸린 계정으로 aws 로그인하고 세션 열어줘"
  - "1Password에 있는 사용자 이름과 비밀번호로 aws 로그인해줘"
compatibility:
  required:
    - readonly-aws MCP server (this plugin's mcp/readonly; started by the plugin)
  optional: []
---

# aws:login

IAM user name and password only, no roles. macOS only. Read-only: the server refuses writes, not this text.

## Anchors

- **Forbidden reflex.** Running `aws` straight from Bash with whatever is in `~/.aws`; asking the
  person to paste a username or password in chat (a pasted one is not repeated: call `login`
  without it so the dialog or 1Password asks); rephrasing a call to get around `rejected`.
- **Boundary.** Not for writes or infra changes. Data inside a database goes to `database:query`.
- **Done.** Every answer names the profile, account and region it came from; a `rejected [rule]`
  or error line is quoted verbatim.

## Process

1. **aws CLI.** Run `aws --version` (the only `aws` command run from Bash; it reads no credentials). Missing → install AWS CLI v2:
   - `command -v brew` succeeds → `brew install awscli`.
   - Else download `https://awscli.amazonaws.com/AWSCLIV2.pkg` into a `mktemp -d` dir, then
     `sudo installer -pkg <dir>/AWSCLIV2.pkg -target /`. The password is typed in the terminal, never in chat;
     if sudo needs a TTY, suggest `! <command>`.
   - Run `aws --version` again: still missing → quote it and stop; present → continue.
2. **Server ready.** The plugin starts `readonly-aws` (tools `mcp__plugin_aws_readonly-aws__*`) from a
   bundled file. Tools missing → ask the person to run `/reload-plugins` or reconnect
   `plugin:aws:readonly-aws` in `/mcp`. Keychain missing → quote the error that names it.
3. **Fields.** Call `profile` (no name) first: its row for the profile shows the saved account (`-` = none),
   region and password source (`password none`, `password keychain`, `password 1password`). Ask for what is missing,
   **one field per message**, in this order, and skip any field the row already holds:
   1. `profile` — name matching `[a-z0-9_-]{1,32}`.
   2. `account` — 12 digits; `login` refuses a username and password of another account. `none` skips the check.
      For `none` (here and for the MFA serial) leave the argument out; never pass the word `none` to `login`.
   3. `region` — e.g. `ap-northeast-2`.
   4. `mfa_serial` — the MFA device ARN, saved in the profile file. Ask only on a first login (`password none`);
      accept `none` for no MFA session. Later logins reuse what is saved; an absent serial means no MFA.
   5. Username and password — never asked in chat: the hidden dialog opens in step 4 (or 1Password, below).
   6. MFA code — never asked in chat: the hidden dialog opens in step 4 (or `op --otp`).
   - `label?` — defaults to the account id from `sts get-caller-identity`; ask only if the person offers one.
   - `vault?`, `item?`, `otp_item?` — only for a username and password held in 1Password; take them when the person names them.
     The profile saves them; `login dev` alone reuses them.
4. **Log in.** Call `login` with the fields given (`profile` alone when everything is saved). The username and
   password come from exactly two places:
   - 1Password: `vault` and `item` → the server reads only `username` + `password` of that item
     (case-insensitive). With `mfa_serial` the one-time code comes from `op item get --otp` on `otp_item` (same
     vault) when given, else on `item`. `otp_item` without `mfa_serial` is saved and ignored.
   - Else the server opens a macOS hidden dialog for the username and the password; they go to
     Keychain (service `readonly-aws`, account `<profile>`).
   - The person offers a username or password in chat → decline in one line, name the dialog and 1Password, call `login` without them.
5. **MFA session.** With `mfa_serial`, the server calls `sts get-session-token` for 129600 s (36 h),
   falling back to 43200 then 3600 if refused, and stores the session in Keychain (account
   `<profile>:session`). Always show the returned `Expiration`.
   - Without `mfa_serial` the stored username and password are used directly: expiry `none`, no session.
   - A 1Password TOTP already used in its 30 s window is refused → the server retries once after the window; a second refusal is an error to quote.
6. **Report** profile, account, region, label, password source (dialog or 1Password), session expiry and the
   connection test (`sts get-caller-identity`: `ok` or the failure). A canceled or failed dialog → nothing was
   saved; the answer says to save a 1Password vault and item with `aws:profile` (to read the username and
   password from 1Password) or to retry and type them in the dialog.

## Output Template

```
[login: dev] saved (password: stored in Keychain) · 123456789012 · ap-northeast-2 · session until 2026-11-19T04:12:00Z · connection ok
```

Without MFA: `session none (long-term credentials)`.

## What Claude Does / What You Do

| Claude | You |
|---|---|
| Reads the `profile` row, asks each missing field alone (profile → account → region → MFA serial), calls `login`, shows account, region and Expiration, declines usernames, passwords and codes in chat | Answer one field per message; type the username, password and MFA code in the macOS dialog, or name the 1Password vault, item and otp item |

## Related Skills

- `aws:profile` — switch to the profile after logging in, or save a 1Password vault and item for it.
- `aws:logout` — drop the session or forget the username and password.
- `aws:query` — read AWS resources.
- `database:query` — rows inside a database, not AWS APIs.
