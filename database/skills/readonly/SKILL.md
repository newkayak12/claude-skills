---
name: readonly
description: Use when reading database data read-only by profile (local/dev/stage/prod) — query, switch profile, log in or out. Triggers on "DB 조회", "dev DB에서 봐줘", "prod로 바꿔", "dev 로그인", "로그아웃", "query the dev database", "log in to dev".
scenarios:
  - "Show me the last 10 orders from the dev database"
  - "Log in to stage and describe the users table"
  - "dev DB에서 최근 주문 10건 조회해줘"
  - "dev 프로필로 로그인해줘"
  - "dev 프로필 로그아웃해줘"
compatibility:
  required:
    - database-readonly (this plugin's mcp/readonly server; Setup registers it)
  optional: []
---

# database:readonly

MCP server `database-readonly`: tools `profile`, `logout`, `query`, `list_tables`, `describe_table`.
CLI: `node ${CLAUDE_PLUGIN_ROOT}/mcp/readonly/cli.mjs` (`login`, `logout`, `list`).

## Process

1. **Setup (once per session, before the first step).**
   - `${CLAUDE_PLUGIN_ROOT}/mcp/readonly/node_modules` missing → `cd ${CLAUDE_PLUGIN_ROOT}/mcp/readonly && npm ci`.
   - `claude mcp get database-readonly`: missing, or its command path is not
     `${CLAUDE_PLUGIN_ROOT}/mcp/readonly/server.mjs` → `claude mcp remove database-readonly -s user`
     (ignore "not found"), then `claude mcp add -s user database-readonly -- node ${CLAUDE_PLUGIN_ROOT}/mcp/readonly/server.mjs`,
     and tell the person to reconnect it in `/mcp`. This keeps the path right after a plugin update.
2. **Login `<profile>`.** Show saved values with `node ${CLAUDE_PLUGIN_ROOT}/mcp/readonly/cli.mjs list`.
   Ask host, port, user, database in chat (saved values as defaults). Then run via Bash:
   `node ${CLAUDE_PLUGIN_ROOT}/mcp/readonly/cli.mjs login <profile> --host … --port … --user … --database …`
   - Default: a macOS password dialog opens for the person; the CLI stores it in Keychain and tests the
     connection. Report the CLI's result line (`saved`, `connection ok`, or `login cancelled`).
   - Option: the person gives a 1Password reference → add `--op op://…` (no dialog).
   - Not macOS: the CLI says a terminal is needed; give the person its `!` command.
   - Never ask for or accept a password in chat, never put one in a command. A pasted password is
     not repeated; run the dialog login instead.
3. **Which profile.** `profile` with no name: active profile and who is logged in. The server starts
   on `local`. A named environment ("dev에서", "stage 기준") → `profile({name})` before querying.
4. **prod only on request.** Switch to `prod` only when the person asked for prod in this
   conversation. The server asks the person to confirm; never retry around a decline.
5. **Query.** `list_tables` / `describe_table` first when the schema is unknown; then one statement
   per `query`, with `LIMIT`. `truncated: true` means the row cap cut the result — say so.
6. **Rejected.** `rejected [rule]` is the read-only guard; do not rephrase the statement around it.
7. **Logout.** `logout({name})`; it removes the saved password, keeps host/user/database.

## Output Template

```
[profile: dev] <one line: what was asked>
<result table or summary, rows N, truncated yes/no, elapsed ms>
```

Every answer built on query results names the profile it came from.

## What Claude Does / What You Do

| Claude | You |
|---|---|
| Sets up and registers the server, asks the connection fields, runs login, switches profiles, runs read-only queries, names the profile in every answer | Type the password in the macOS dialog (or give an op:// reference); confirm a prod switch |
| Stops at a rejection or a cancelled login and says why | Decide when prod is needed |

## Related Skills

- `develop:sql-pro` — writing the SQL itself.
- `develop:database-optimizer` — when a query is slow (use `EXPLAIN` through `query`).
