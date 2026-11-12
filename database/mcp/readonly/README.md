# database-readonly-mcp

Read-only database MCP server (stdio). Vendor: `mysql` (more later under `vendors/`).

- Every pooled connection runs `SET SESSION TRANSACTION READ ONLY` and `SET SESSION max_execution_time`
  before its first statement (verified with `@@transaction_read_only`). No BEGIN/COMMIT/ROLLBACK: autocommit.
- `query` accepts one statement starting with SELECT, SHOW, DESCRIBE, DESC, EXPLAIN or WITH; rejects
  INTO, FOR UPDATE/SHARE, LOCK IN SHARE MODE, GET_LOCK, SLEEP, BENCHMARK, LOAD_FILE, `/*! */`, `/*+ */`,
  and DML inside WITH/EXPLAIN. Rows stream and stop at `--max-rows` with `truncated: true`.
- Tools: `query(sql)`, `list_tables()`, `describe_table(table)`.

## Profiles (default mode)

Without `--host/--user/--database`, the server runs on profiles `local`, `dev`, `stage`, `prod` and
starts on `local` (or `--profile X`). Extra tools: `profile(name?)` lists or switches, `logout(name)`.
Switching to `prod` asks the person to confirm (MCP elicitation); a client that cannot ask is refused.

```sh
node cli.mjs login dev      # prompts host/port/user/database + hidden password -> Keychain
                            # type an op:// reference at the password prompt to use 1Password instead
                            # without a terminal (run by Claude) on macOS: a hidden password dialog opens
node cli.mjs login stage --host db.stage --user reader --database app --op op://Vault/item/password
node cli.mjs logout dev     # removes the password, keeps host/user/database
node cli.mjs list
claude mcp add -s user database-readonly -- node /path/server.mjs
```

Settings: `~/.config/database-readonly-mcp/profiles.json` (0600, no passwords). Passwords: macOS
Keychain (service `database-readonly-mcp`, account = profile); elsewhere or with `DBRO_SECRETS=file`,
`secrets.json` (0600) in the same folder. With Keychain, an op:// password is read once into Keychain
and profiles.json keeps only `password_from: op://****/****/<field>`; a profile still on `op` or on
`secrets.json` moves on its next use, and its `secrets.json` value becomes `****`.

## Direct mode settings

| Option | Env | Default |
|---|---|---|
| `--vendor` | `DB_VENDOR` | `mysql` |
| `--host` | `MYSQL_HOST` | required |
| `--port` | `MYSQL_PORT` | 3306 |
| `--user` | `MYSQL_USER` | required |
| `--password` | `MYSQL_PASS` | empty |
| `--database` | `MYSQL_DB` | required |
| `--max-rows` | `MAX_ROWS` | 1000 |
| `--max-execution-ms` | `MAX_EXECUTION_MS` | 30000 |

Args win over env. Any value starting with `op://` is read with `op read` (1Password CLI), so
`op run` is optional. Prefer env or `op://` for the password: a plain `--password` shows in `ps`.

```sh
npm install
# 1Password, via op run
claude mcp add -s user mydb -e MYSQL_HOST="op://Vault/item/hostname" ... -- op run --no-masking -- node /path/server.mjs
# 1Password, resolved by the server itself
claude mcp add -s user mydb -- node /path/server.mjs --host op://Vault/item/hostname --user op://Vault/item/username ...
# plain values
claude mcp add -s user mydb -e MYSQL_PASS=... -- node /path/server.mjs --host 127.0.0.1 --user reader --database app
```

## Tests

```sh
npm test                                   # unit tests; live tests skip without MYSQL_HOST
op run --env-file .env.dev -- npm test     # + live tests against a DEV database (.env.dev is gitignored)
```

Env files (`.env*`, `*.env`) are gitignored: they hold `op://` references or real values.
