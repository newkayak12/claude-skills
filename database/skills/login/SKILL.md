---
name: login
description: Use when logging in to a read-only database profile (local/dev/stage/prod) on MySQL, MariaDB, PostgreSQL or Oracle. Triggers on "dev 로그인", "prod DB 로그인해줘", "DB 접속 정보 저장", "log in to dev", "database login", "/database:login".
scenarios:
  - "Log in to the dev database"
  - "Log in to stage with host db.stage.internal, user reader"
  - "dev DB 로그인해줘"
  - "prod 프로필 로그인, 비밀번호는 1Password에 있어"
  - "postgres dev DB 로그인"
compatibility:
  required:
    - readonly-<vendor> MCP servers (this plugin's mcp/readonly; started by the plugin)
  optional: []
---

# database:login

## Process

1. **Server ready.** The plugin starts one server per vendor, `readonly-mysql`, `readonly-mariadb`,
   `readonly-postgres` and `readonly-oracle` (tools `mcp__plugin_database_readonly-<vendor>__*`), from a
   bundled file, so an install or update needs no setup. Each keeps its own profiles.
   - A leftover user-scope registration from 0.6.0 or older: `claude mcp get database-readonly` finds
     one → `claude mcp remove database-readonly -s user`.
   - Tools missing → ask the person to run `/reload-plugins` or reconnect `plugin:database:readonly-<vendor>` in `/mcp`.
   - Read-only tools run without a prompt: for each vendor add `mcp__plugin_database_readonly-<vendor>__query`,
     `…__list_tables`, `…__describe_table` and `…__profile` to `permissions.allow` in `~/.claude/settings.json`
     if missing (`login`/`logout` keep asking).
2. **Which vendor and profile.** The vendor named (MySQL, MariaDB, PostgreSQL, Oracle) picks the server;
   none named → ask. The profile named (local, dev, stage, prod); none named → ask. Oracle: `database`
   is the service name (e.g. `FREEPDB1`); default ports 3306, 3306, 5432, 1521.
3. **Fields.** `profile` tool (no name) shows what is saved. Ask only for host, port, user and database
   that are missing or that the person wants changed.
4. **Log in.** Call that vendor's `login` tool with `name` and the fields.
   - Default: the server opens a macOS password dialog; the person types the password there; it goes to Keychain.
   - Option: the person gives a 1Password reference → pass `op_ref` (no dialog). On macOS the server
     reads it once into Keychain and keeps only a masked ref (`op://****/****/password`), so later
     connections do not ask 1Password again. An older op or secrets.json login moves the same way on first use.
   - Never ask for, accept, or pass a password in chat or in a tool argument. A pasted password is not
     repeated; call `login` without it so the dialog asks.
5. **Report** the result: saved, where the password lives, and `connection` (`ok` or the failure).
   `login cancelled` → nothing was saved. Not macOS → give the person the CLI command from the error.

## Output Template

```
[login: postgres/dev] saved (password: keychain) · connection ok
```

## What Claude Does / What You Do

| Claude | You |
|---|---|
| Picks the vendor's server, asks the connection fields, calls `login`, reports the connection test | Name the vendor; type the password in the macOS dialog, or give an op:// reference |

## Related Skills

- `database:profile` — switch to the profile after logging in.
- `database:logout` — forget a saved login.
- `database:query` — read data.
