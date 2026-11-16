---
name: profile
description: Use when showing or switching the read-only database profile (local/dev/stage/prod) on MySQL, MariaDB, PostgreSQL or Oracle. Triggers on "프로필 바꿔", "dev로 붙어", "prod로 바꿔", "지금 어느 DB야", "switch to stage", "which database profile", "/database:profile".
scenarios:
  - "Switch the database to dev"
  - "Which database profile am I on?"
  - "prod로 바꿔줘"
  - "지금 어느 DB 프로필에 붙어 있어?"
compatibility:
  required:
    - readonly-<vendor> MCP servers (started by the plugin)
  optional: []
---

# database:profile

## Process

1. **No name** → `profile` (no name) on each `readonly-<vendor>` server (mysql, mariadb, postgres,
   oracle): active profile, connected or not, and each profile's login state. One table, a vendor
   column, only vendors with a saved profile.
2. **A name** → `profile` with `name` on the vendor named; none named → the vendor where that profile
   is logged in; logged in on more than one → ask which.
   - `prod` only when the person asked for prod in this conversation (no dialog: every connection is
     read-only). The switch reports `limits`: prod caps at 200 rows and 10 s.
   - Not logged in → say so and offer `database:login <profile>`.
3. **Report** the active profile after the call. Tools missing → set up with `database:login`.

## Output Template

```
active: mysql/dev (connected)
| vendor | profile | logged in | user@host/db |
```

## What Claude Does / What You Do

| Claude | You |
|---|---|
| Shows profiles, switches to the one you named | Name the environment (prod only when you say so) |

## Related Skills

- `database:login` — log in to a profile first.
- `database:query` — read data on the active profile.
