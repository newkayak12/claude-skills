---
name: profile
description: Use when creating, updating, listing or switching the read-only AWS profiles. Triggers on "aws 프로필 만들어", "프로필 목록 보여줘", "aws 프로필 바꿔", "지금 어느 AWS 계정이야", "create an aws profile", "switch aws profile", "/aws:profile".
scenarios:
  - "Make a profile called stage for account 111122223333 in ap-northeast-2"
  - "Show my AWS profiles"
  - "Switch AWS to the prod profile"
  - "Which AWS account and region am I on?"
  - "aws 프로필 stage 만들어줘, 계정 111122223333, 리전 ap-northeast-2"
  - "aws 프로필 목록 보여줘"
  - "aws 프로필 dev로 바꿔줘"
compatibility:
  required:
    - readonly-aws MCP server (started by the plugin)
  optional: []
---

# aws:profile

## Anchors

- **Forbidden reflex.** Running `aws` straight from Bash with whatever is in `~/.aws`; asking the
  person to paste a username or password in chat; putting a username, password or token in any `profile_save` argument;
  rephrasing a call to get around `rejected`.
- **Boundary.** Writes local profile files only (name, label, account, region, MFA serial, 1Password
  reference), never a username or password, never infra. They come in at `aws:login`. Data inside a database goes to
  `database:query`.
- **Done.** Every answer names the profile, account and region it came from; a `rejected [rule]`
  or error line is quoted verbatim.

## Process

1. **Create or update** (the person names a profile and gives any of account, region, label, MFA
   serial, 1Password vault/item/otp item) → `profile_save` with `name` and only the fields given.
   - A new profile needs `name` and `region`; ask for the region if it is missing, nothing else.
   - A field left out stays as saved; `null` removes it. Never invent a value the person did not give.
   - The account is 12 digits; the MFA serial is an ARN; `vault` and `item` go together, `otp_item`
     (same vault) only with `item`. A refusal line is quoted and nothing is saved.
   - The first saved profile becomes active; an update never switches. No username or password is stored here:
     offer `aws:login <profile>` next.
2. **List** (no name given: "show my profiles", "which account am I on") → `profile` with no
   arguments: one row per profile with label, account, region, password source (`keychain`, `1password`,
   `none`) and session expiry (`none` = long-term credentials, no MFA session). `*` and `active` mark the
   active one. A 1Password reference shows as `op://****/****`.
3. **Switch** (a name to become active) → `profile` with `name`. No dialog: the call is read-only
   and the switch persists in a local state file until switched again.
   - Name not saved → the error lists the known names; offer `profile_save` to create it.
   - Session `expired` → say so and offer `aws:login <profile>` (a new MFA code opens a new session).
4. **Report** the active profile after any call, with account, region and expiry. A `rejected [rule]`
   or error line is quoted verbatim. Tools missing → set up with `aws:login`.

## Output Template

```
active: stage · 111122223333 · ap-northeast-2 · password none · session none
| profile | label | account | region | password | session |
```

## What Claude Does / What You Do

| Claude | You |
|---|---|
| Saves a profile from the fields you give (never a username or password), lists every profile with account, password source and expiry, switches to the one you named | Name the profile and give its region and account; log in with `aws:login` to add the username and password |

## Related Skills

- `aws:login` — add a username and password to a profile and open a session, first time or after expiry.
- `aws:logout` — drop a session or forget the username and password.
- `aws:query` — read AWS resources on the active profile.
- `database:query` — rows inside a database, not AWS APIs.
