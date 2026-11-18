# database-readonly-mcp

Read-only database MCP server (stdio). `--vendor mysql|mariadb|postgres|oracle` (default mysql); the
plugin runs one server per vendor. Shared statement handling is in `vendors/sql.mjs`, one module per vendor.

| Vendor | Read-only by | Timeout | Accepted first keyword | Personal data matched by |
|---|---|---|---|---|
| mysql | `SET SESSION TRANSACTION READ ONLY`, checked | `max_execution_time` | SELECT, WITH, SHOW, DESCRIBE, DESC, EXPLAIN | source column (`orgName`) |
| mariadb | same, checked (`tx_read_only` on older versions) | `max_statement_time` | same as mysql | source column |
| postgres | startup `default_transaction_read_only=on`, checked | `statement_timeout` | SELECT, WITH, EXPLAIN, SHOW, TABLE, VALUES | source column (`pg_attribute`) |
| oracle | `SET TRANSACTION READ ONLY` per call, then rollback | `callTimeout` | SELECT, WITH | column name and select-list expression |

- No BEGIN/COMMIT: MySQL, MariaDB and PostgreSQL run autocommit statements in read-only transactions.
- Rejected on every vendor: more than one statement, locking reads, INTO, DML inside WITH/EXPLAIN,
  `/*+ */` hints. mysql/mariadb: `/*! */`, `/*M! */`, GET_LOCK, SLEEP, BENCHMARK, LOAD_FILE. postgres:
  pg_sleep, server file and large-object functions, dblink, advisory locks, set_config, nextval/setval,
  backend signals and admin functions, `*_to_xml` (they run SQL text; checked with string contents
  included). oracle: inline `WITH FUNCTION`, `seq.NEXTVAL`, DBMS_* (but DBMS_LOB, DBMS_RANDOM), UTL_*
  (but UTL_RAW), HTTPURITYPE.
- A function that writes through its own (autonomous) transaction is not stopped by a read-only
  transaction: give the account read-only privileges too.
- Rows stream (mysql) or are fetched through a cursor/result set, and stop at `--max-rows` with `truncated: true`.
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

Each vendor keeps its own profiles: mysql in `~/.config/database-readonly-mcp/`, the others in
`~/.config/database-readonly-mcp/<vendor>/`; `cli.mjs` takes `--vendor` the same way.
Settings: `profiles.json` there (0600, no passwords). Passwords: macOS Keychain (service
`database-readonly-mcp`, `database-readonly-mcp-<vendor>` for the others; account = profile); elsewhere or with `DBRO_SECRETS=file`,
`secrets.json` (0600) in the same folder. With Keychain, an op:// password is read once into Keychain
and profiles.json keeps only `password_from: op://****/****/<field>`; a profile still on `op` or on
`secrets.json` moves on its next use, and its `secrets.json` value becomes `****`.

## Personal data

Every result drops personal-data columns and lists them under `hidden`. A column is matched by its
source name (`recv_nm AS who` is still hidden); a computed column is hidden when its own expression
names one (`CONCAT(recv_nm, '') AS x`), so `COUNT(*)` next to a personal column in WHERE stays. When
the expressions cannot be told apart (a subquery, CTE or derived table, `*`, `@variables`), any
personal column named in the statement hides every computed column — except SHOW and DESCRIBE, whose
result is metadata (`SHOW CREATE TABLE address` is shown). A source name is matched word by word, so a
view column named `get_decrypt(a.ord_tel)` is hidden. Default patterns (`PII_DEFAULT` in `config.mjs`): phone/tel/hp/fax,
email, addr/address, post/zip codes, resident numbers, birth, passport, and person names such as
`order_nm`, `recv_nm`, `sender_name`, and decrypt (`get_decrypt`). `--pii off` (`DBRO_PII=off`) disables it; `--pii 'regex,regex'`
replaces the list.

## Direct mode settings

| Option | Env | Default |
|---|---|---|
| `--vendor` | `DB_VENDOR` | `mysql` |
| `--host` | `MYSQL_HOST` or `DB_HOST` | required |
| `--port` | `MYSQL_PORT` or `DB_PORT` | 3306, postgres 5432, oracle 1521 |
| `--user` | `MYSQL_USER` or `DB_USER` | required |
| `--password` | `MYSQL_PASS` or `DB_PASS` | empty |
| `--database` | `MYSQL_DB` or `DB_NAME` | required (oracle: service name) |
| `--max-rows` | `MAX_ROWS` | 1000 |
| `--max-execution-ms` | `MAX_EXECUTION_MS` | 30000 |

Args win over env; a `MYSQL_*` variable wins over its `DB_*` one. Any value starting with `op://` is read with `op read` (1Password CLI), so
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
npm run test:docker [-- postgres oracle]   # live tests per vendor (default all four) on a throwaway
                                           # seeded database in docker, against server.mjs and the
                                           # bundle (no host port; removed after)
op run --env-file .env.dev -- npm test     # + live tests against a DEV database (.env.dev is gitignored)
```

Env files (`.env*`, `*.env`) are gitignored: they hold `op://` references or real values.
