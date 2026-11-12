# database

**English** · [한국어](KOR.md)

Read-only database access through one MCP server (`database-readonly`, MySQL today; other vendors go
under `mcp/readonly/vendors/`) and four skills that drive it.

| Skill | Does |
|---|---|
| `database:login` | Sets up the server on first use, asks host/port/user/database, then the server opens a macOS password dialog; the password goes to Keychain (1Password `op://` optional). Tests the connection. |
| `database:logout` | Forgets a profile's saved password; host/user/database stay. |
| `database:profile` | Shows profiles (local, dev, stage, prod) or switches the connection; prod asks you to confirm. |
| `database:query` | Reads the schema and runs read-only queries; every answer names its profile. |

```
Log in to dev, then show me the last 10 orders.
```

- **Read-only, twice.** Every pooled connection runs `SET SESSION TRANSACTION READ ONLY` and
  `max_execution_time` before its first statement (no BEGIN; autocommit). `query` also accepts only
  one statement starting with SELECT, SHOW, DESCRIBE, DESC, EXPLAIN or WITH, and rejects locking reads,
  INTO, SLEEP/BENCHMARK/GET_LOCK/LOAD_FILE, `/*! */` and DML hidden in WITH or EXPLAIN.
- **The password never goes through the chat**: no tool takes it as an argument.
- **Rows** stream and stop at 1000 (`truncated: true`).

Setup (`database:login` does it): `npm ci` in `mcp/readonly/` and
`claude mcp add -s user database-readonly -- node <plugin dir>/mcp/readonly/server.mjs`, redone when an
update moves the plugin path. Details: [`mcp/readonly/README.md`](mcp/readonly/README.md).
