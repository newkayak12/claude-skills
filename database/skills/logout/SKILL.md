---
name: logout
description: Use when forgetting a saved read-only database login (local/dev/stage/prod) on MySQL, MariaDB, PostgreSQL or Oracle. Triggers on "dev 로그아웃", "prod DB 로그아웃해줘", "저장된 DB 비번 지워줘", "log out of dev", "database logout", "/database:logout".
scenarios:
  - "Log out of the prod database"
  - "Forget the dev database login"
  - "prod DB 로그아웃해줘"
  - "stage 프로필 로그아웃"
compatibility:
  required:
    - readonly-<vendor> MCP servers (started by the plugin)
  optional: []
---

# database:logout

## Process

1. **Which vendor and profile.** The ones named; otherwise `profile` (no name) on each `readonly-<vendor>`
   server and ask which of the logged-in profiles.
2. **Log out.** Call that vendor's `logout` tool with `name`. It removes the saved password (Keychain entry or
   op:// reference) and keeps host, port, user and database for the next login. If it was the active
   profile, its connection closes.
3. **Report** what was removed. Tools missing → the server is not set up; use `database:login`.

## Output Template

```
[logout: mysql/prod] password removed; host/user/database kept
```

## What Claude Does / What You Do

| Claude | You |
|---|---|
| Calls `logout` for the profile you named and reports it | Name the profile |

## Related Skills

- `database:login` — log in again.
- `database:profile` — see which profiles are logged in.
