# database

**English** · [한국어](KOR.md)

Database tools. Today: one read-only MySQL MCP server and the skill that drives it. Other vendors
go under `mcp/readonly/vendors/` later.

## `readonly`

Look at data read-only through profiles `local`, `dev`, `stage`, `prod`.

```
Log in to dev, then show me the last 10 orders.
```

- **Read-only, twice.** Every pooled connection runs `SET SESSION TRANSACTION READ ONLY` and
  `max_execution_time` before its first statement (no BEGIN; autocommit). `query` also accepts only
  one statement starting with SELECT, SHOW, DESCRIBE, DESC, EXPLAIN or WITH, and rejects locking reads,
  INTO, SLEEP/BENCHMARK/GET_LOCK/LOAD_FILE, `/*! */` and DML hidden in WITH or EXPLAIN.
- **Profiles.** `profile` switches the whole connection (host, user, password); answers name the profile.
  Switching to `prod` asks you to confirm.
- **Login through the skill.** Claude asks host, port, user and database, then a macOS password dialog
  opens; the password goes straight to Keychain and never through the chat. 1Password is an option:
  give an `op://` reference instead.
- **Rows** stream and stop at 1000 (`truncated: true`).

Setup is done by the skill on first use: `npm ci` in `mcp/readonly/` and
`claude mcp add -s user database-readonly -- node <plugin dir>/mcp/readonly/server.mjs` (re-registered
after an update moves the plugin path). Details: [`mcp/readonly/README.md`](mcp/readonly/README.md).
