---
name: profile
description: Use when showing or switching the active read-only AWS profile. Triggers on "aws 프로필 바꿔", "dev 계정으로 붙어", "지금 어느 AWS 계정이야", "세션 언제 만료돼", "switch aws profile", "which aws account am I on", "/aws:profile".
scenarios:
  - "Switch AWS to the prod profile"
  - "Which AWS account and region am I on?"
  - "When does my AWS session expire?"
  - "aws 프로필 dev로 바꿔줘"
  - "지금 어느 AWS 계정이야?"
  - "세션 언제 만료돼?"
compatibility:
  required:
    - readonly-aws MCP server (started by the plugin)
  optional: []
---

# aws:profile

## Anchors

- **Forbidden reflex.** Running `aws` straight from Bash with whatever is in `~/.aws`; asking the
  person to paste keys in chat; rephrasing a call to get around `rejected`.
- **Boundary.** Not for writes or infra changes. Data inside a database goes to `database:query`.
- **Done.** Every answer names the profile, account and region it came from; a `rejected [rule]`
  or error line is quoted verbatim.

## Process

1. **No name** → `profile` (no arguments): the active profile and a table of saved profiles with
   account, region, label, key source and session expiry (`none` = long-term keys, no MFA session).
2. **A name** → `profile` with `profile`. No dialog: every call is read-only. The switch persists in a
   local state file, so it survives a server restart and a new session until switched again.
   - Name not saved → say so and offer `aws:login <profile>`.
   - Session `expired` → say so and offer `aws:login <profile>` (a new MFA code opens a new session).
3. **Report** the active profile after the call, always with account, region and expiry. A `rejected [rule]`
   or error line is quoted verbatim. Tools missing → set up with `aws:login`.

## Output Template

```
active: dev · 123456789012 · ap-northeast-2 · session until 2026-11-19T04:12:00Z
| profile | account | region | label | keys | session |
```

## What Claude Does / What You Do

| Claude | You |
|---|---|
| Shows profiles with account, region and expiry, switches to the one you named | Name the profile |

## Related Skills

- `aws:login` — log in to a profile first, or again after expiry.
- `aws:logout` — drop a session or forget keys.
- `aws:query` — read AWS resources on the active profile.
- `database:query` — rows inside a database, not AWS APIs.
