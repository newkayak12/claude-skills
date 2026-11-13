# database

**English** · [한국어](KOR.md)

Read-only database access through one MCP server (`database-readonly`, MySQL today; other vendors go
under `mcp/readonly/vendors/`) and four skills that drive it.

| Skill | Does |
|---|---|
| `database:login` | Asks host/port/user/database, then the server opens a macOS password dialog; the password goes to Keychain (1Password `op://` optional). Tests the connection. |
| `database:logout` | Forgets a profile's saved password; host/user/database stay. |
| `database:profile` | Shows profiles (local, dev, stage, prod) or switches the connection; prod only when you name it, no dialog. |
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
- **Personal data stays out**: columns such as names, phones, addresses, post codes and email are
  dropped from every result by their source column, so an alias does not bring one back; the result
  lists them under `hidden`. `--pii off` (`DBRO_PII`) turns it off; `--pii regex,regex` replaces the list.

Setup: none. The plugin starts the server (`plugin:database:database-readonly`) and installs its
dependencies on the first start of each version, so an update follows by itself. A user-scope
`database-readonly` left from 0.6.0 or older should be removed (`claude mcp remove database-readonly -s user`). Details: [`mcp/readonly/README.md`](mcp/readonly/README.md).
