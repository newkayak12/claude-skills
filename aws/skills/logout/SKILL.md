---
name: logout
description: Use when ending or forgetting a saved read-only AWS profile session or username and password. Triggers on "aws 로그아웃해줘", "dev 세션 끊어줘", "저장된 AWS 키 지워줘", "log out of aws", "forget the aws keys", "aws logout", "/aws:logout".
scenarios:
  - "Log out of the dev AWS profile"
  - "Forget the saved AWS username and password for prod"
  - "aws 로그아웃해줘"
  - "prod 프로필 사용자 이름과 비밀번호까지 지워줘"
compatibility:
  required:
    - readonly-aws MCP server (started by the plugin)
  optional: []
---

# aws:logout

## Anchors

- **Forbidden reflex.** Running `aws` straight from Bash with whatever is in `~/.aws`; asking the
  person to paste a username or password in chat; rephrasing a call to get around `rejected`.
- **Boundary.** Not for writes or infra changes. Data inside a database goes to `database:query`.
- **Done.** Every answer names the profile, account and region it came from; a `rejected [rule]`
  or error line is quoted verbatim.

## Process

1. **Which profile.** The one named; otherwise `profile` (no name) and ask which of the saved profiles.
2. **Log out.** Call `logout` with `{profile?, forget?}`.
   - Default: deletes the cached MFA session (Keychain account `<profile>:session`) locally and reports its expiry.
     The stored username and password stay, so the next `aws:login` or query can open a session again.
   - `forget: true` (only when the person says forget, delete the username and password, or remove everything): also removes the
     stored username and password (Keychain account `<profile>`) or the 1Password reference. The profile name, region and label stay in the profile file.
   - A profile without `mfa_serial` has no session → say "no session" and offer `forget: true`.
3. **Say what stays valid.** STS tokens cannot be revoked: a deleted session token still works until its
   expiry, wherever a copy exists. To cut it off sooner, the account owner deactivates the credentials in IAM.
4. **Report** what was removed, with profile, account and region. Tools missing → use `aws:login` to set up.

## Output Template

```
[logout: dev] 123456789012 · ap-northeast-2 · session deleted locally (token valid until 2026-11-19T04:12:00Z; STS cannot revoke)
```

With `forget: true`, quote the server's line: `stored username and password deleted; the profile entry stays.` Without MFA: `no session`.

## What Claude Does / What You Do

| Claude | You |
|---|---|
| Calls `logout` for the profile you named, reports the expiry and what was removed | Name the profile; say forget when the username and password should go too |

## Related Skills

- `aws:login` — log in again.
- `aws:profile` — see which profiles are logged in and when sessions end.
- `database:query` — rows inside a database, not AWS APIs.
