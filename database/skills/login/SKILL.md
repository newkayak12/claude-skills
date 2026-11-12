---
name: login
description: Use when logging in to a read-only database profile (local/dev/stage/prod) of the database-readonly MCP. Triggers on "dev 로그인", "prod DB 로그인해줘", "DB 접속 정보 저장", "log in to dev", "database login", "/database:login".
scenarios:
  - "Log in to the dev database"
  - "Log in to stage with host db.stage.internal, user reader"
  - "dev DB 로그인해줘"
  - "prod 프로필 로그인, 비밀번호는 1Password에 있어"
compatibility:
  required:
    - database-readonly MCP server (this plugin's mcp/readonly; step 1 sets it up)
  optional: []
---

# database:login

## Process

1. **Server ready.** If the `database-readonly` tools are not available, or `claude mcp get database-readonly`
   shows a command path other than `${CLAUDE_PLUGIN_ROOT}/mcp/readonly/server.mjs`:
   - `${CLAUDE_PLUGIN_ROOT}/mcp/readonly/node_modules` missing → `cd ${CLAUDE_PLUGIN_ROOT}/mcp/readonly && npm ci`.
   - `claude mcp remove database-readonly -s user` (ignore "not found"), then
     `claude mcp add -s user database-readonly -- node ${CLAUDE_PLUGIN_ROOT}/mcp/readonly/server.mjs`.
   - Ask the person to reconnect it in `/mcp`, then continue.
2. **Which profile.** The one named (local, dev, stage, prod); none named → ask.
3. **Fields.** `profile` tool (no name) shows what is saved. Ask only for host, port, user and database
   that are missing or that the person wants changed.
4. **Log in.** Call the `login` tool with `name` and the fields.
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
[login: dev] saved (password: keychain) · connection ok
```

## What Claude Does / What You Do

| Claude | You |
|---|---|
| Sets up the server, asks the connection fields, calls `login`, reports the connection test | Type the password in the macOS dialog, or give an op:// reference |

## Related Skills

- `database:profile` — switch to the profile after logging in.
- `database:logout` — forget a saved login.
- `database:query` — read data.
