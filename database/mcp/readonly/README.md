# database-readonly-mcp

Read-only database MCP server (stdio). Vendor: `mysql` (more later under `vendors/`).

- Every pooled connection runs `SET SESSION TRANSACTION READ ONLY` and `SET SESSION max_execution_time`
  before its first statement (verified with `@@transaction_read_only`). No BEGIN/COMMIT/ROLLBACK: autocommit.
- `query` accepts one statement starting with SELECT, SHOW, DESCRIBE, DESC, EXPLAIN or WITH; rejects
  INTO, FOR UPDATE/SHARE, LOCK IN SHARE MODE, GET_LOCK, SLEEP, BENCHMARK, LOAD_FILE, `/*! */`, `/*+ */`,
  and DML inside WITH/EXPLAIN. Rows stream and stop at `--max-rows` with `truncated: true`.
- Tools: `query(sql)`, `list_tables()`, `describe_table(table)`.
- The plugin runs `dist/database-readonly.mjs`: the server and its dependencies bundled by
  `npm run build` (esbuild), so an installed copy needs no `npm install`. Run the build after any
  change to the sources or `package-lock.json`; `test/bundle.test.mjs` fails on a stale bundle.
- On `prod` the row cap is at most 200 and the statement timeout at most 10 s (`PROD_LIMITS` in
  `server.mjs`); a switch reports the limits in force.

## Query log

Every read (`query`, `list_tables`, `describe_table`), rejected and failed ones included, adds one
JSON line to `~/.config/database-readonly-mcp/query.log` (0600; rolled to `query.log.1` past 5 MB):
time, profile, tool, the SQL with every string literal as `'?'`, row count, `truncated`, the number of
hidden columns, elapsed ms, or the rejection rule / error code. No result value is written.

## Profiles (default mode)

Without `--host/--user/--database`, the server runs on profiles `local`, `dev`, `stage`, `prod` and
starts on `local` (or `--profile X`). Extra tools: `profile(name?)` lists or switches, `logout(name)`.
Switching profiles asks nothing (every connection is read-only). `query`, `list_tables`,
`describe_table` and `profile` carry `readOnlyHint: true`; `login` and `logout` do not.

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

## Personal data

Every result drops personal-data columns and lists them under `hidden`. A column is matched by its
source name (`recv_nm AS who` is still hidden); a computed column is hidden when its own expression
names one (`CONCAT(recv_nm, '') AS x`), so `COUNT(*)` next to a personal column in WHERE stays. When
the expressions cannot be told apart (a subquery, CTE or derived table, `*`, `@variables`), any
personal column named in the statement hides every computed column. Default patterns (`PII_DEFAULT` in `config.mjs`): phone/tel/hp/fax,
email, addr/address, post/zip codes, resident numbers, birth, passport, and person names such as
`order_nm`, `recv_nm`, `sender_name`. `--pii off` (`DBRO_PII=off`) disables it; `--pii 'regex,regex'`
replaces the list.

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
npm run test:docker                        # live tests on a throwaway seeded MySQL in docker, against
                                           # server.mjs and the bundle (no host port; removed after)
op run --env-file .env.dev -- npm test     # + live tests against a DEV database (.env.dev is gitignored)
```

Env files (`.env*`, `*.env`) are gitignored: they hold `op://` references or real values.
