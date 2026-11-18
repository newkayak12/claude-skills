# database

**English** · [한국어](KOR.md)

Read-only database access for MySQL, MariaDB, PostgreSQL and Oracle: one MCP server per vendor
(`readonly-mysql`, `readonly-mariadb`, `readonly-postgres`, `readonly-oracle`, each with its own
profiles) and four skills that pick the right one.

| Skill | Does |
|---|---|
| `database:login` | Asks host/port/user/database, then the server opens a macOS password dialog; the password goes to Keychain (1Password `op://` optional). Tests the connection. |
| `database:logout` | Forgets a profile's saved password; host/user/database stay. |
| `database:profile` | Shows profiles (local, dev, stage, prod) or switches the connection; prod only when you name it, no dialog. |
| `database:query` | Reads the schema and runs read-only queries; every answer names its profile. |

```
Log in to dev, then show me the last 10 orders.
```

- **Read-only, twice.** The database refuses writes: MySQL/MariaDB sessions run `SET SESSION
  TRANSACTION READ ONLY`, PostgreSQL connections start with `default_transaction_read_only=on`, and
  every Oracle call runs inside `SET TRANSACTION READ ONLY` and rolls back; each with a statement
  timeout. `query` also accepts only one read statement and rejects locking reads, INTO, sleeps,
  file and network access, functions that run SQL text (`query_to_xml`, `DBMS_XMLGEN`), executable
  comments and DML hidden in WITH or EXPLAIN.
- **The password never goes through the chat**: no tool takes it as an argument.
- **Rows** stream and stop at 1000 (`truncated: true`); on prod at 200, with a 10 s statement limit.
- **Personal data stays out**: columns such as names, phones, addresses, post codes and email are
  dropped from every result by their source column, so an alias does not bring one back; the result
  lists them under `hidden`. A computed column is hidden only when its own expression reads one.
  A view column named by its expression (`get_decrypt(a.ord_tel)`) is matched word by word, and any
  `decrypt` column is hidden. SHOW and DESCRIBE are metadata: a table named `address` is shown.
  Oracle reports no source column, so there a column is matched by its name and its select-list expression.
  `--pii off` (`DBRO_PII`) turns it off; `--pii regex,regex` replaces the list.
- **Query log**: every read goes to `~/.config/database-readonly-mcp/query.log` with string values
  as `'?'` and no result values.

Setup: none. The plugin starts the four servers (`plugin:database:readonly-<vendor>`) from one bundled
file with the drivers inside (Oracle in Thin mode: no Instant Client), so an install or update needs
no npm and no network. MySQL logins saved before 0.9.0 stay with `readonly-mysql`. A user-scope
`database-readonly` left from 0.6.0 or older should be removed (`claude mcp remove database-readonly -s user`). Details: [`mcp/readonly/README.md`](mcp/readonly/README.md).
