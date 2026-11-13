---
name: profile
description: Use when showing or switching the read-only database profile (local/dev/stage/prod) of the database-readonly MCP. Triggers on "프로필 바꿔", "dev로 붙어", "prod로 바꿔", "지금 어느 DB야", "switch to stage", "which database profile", "/database:profile".
scenarios:
  - "Switch the database to dev"
  - "Which database profile am I on?"
  - "prod로 바꿔줘"
  - "지금 어느 DB 프로필에 붙어 있어?"
compatibility:
  required:
    - database-readonly MCP server (set up by database:login)
  optional: []
---

# database:profile

## Process

1. **No name** → `profile` tool with no name: active profile, connected or not, and each profile's
   login state. Show it as a table.
2. **A name** → `profile` tool with `name`.
   - `prod` only when the person asked for prod in this conversation (no dialog: every connection is read-only).
   - Not logged in → say so and offer `database:login <profile>`.
3. **Report** the active profile after the call. Tools missing → set up with `database:login`.

## Output Template

```
active: dev (connected)
| profile | logged in | user@host/db |
```

## What Claude Does / What You Do

| Claude | You |
|---|---|
| Shows profiles, switches to the one you named | Name the environment (prod only when you say so) |

## Related Skills

- `database:login` — log in to a profile first.
- `database:query` — read data on the active profile.
