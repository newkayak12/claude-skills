---
name: query
description: Use when reading data read-only from a MySQL, MariaDB, PostgreSQL or Oracle database (local/dev/stage/prod). Triggers on "DB 조회", "dev DB에서 봐줘", "테이블 목록", "이 테이블 컬럼", "query the dev database", "show tables", "/database:query".
scenarios:
  - "Show me the last 10 orders from the dev database"
  - "Describe the users table on stage"
  - "dev DB에서 최근 주문 10건 조회해줘"
  - "테이블 목록 보여줘"
  - "postgres stage에서 오늘 가입자 수 세줘"
compatibility:
  required:
    - readonly-<vendor> MCP servers (started by the plugin)
  optional: []
---

# database:query

## Process

1. **Server.** One `readonly-<vendor>` server per vendor (mysql, mariadb, postgres, oracle). The vendor
   named picks it; none named → the server where the named profile is logged in (`profile` with no
   name on each); still more than one → ask. Write SQL in that vendor's dialect.
2. **Profile.** An environment named ("dev에서", "on stage") and not active → `database:profile` first
   (prod only when asked). Not logged in → offer `database:login`.
3. **Schema.** Unknown tables or columns → `list_tables`, then `describe_table` (postgres: `schema.table` allowed).
4. **Query.** One statement per `query`, with a row limit (`LIMIT`; Oracle `FETCH FIRST n ROWS ONLY`).
   Allowed: SELECT, WITH; plus SHOW/DESCRIBE/EXPLAIN on MySQL/MariaDB, SHOW/EXPLAIN/TABLE/VALUES on
   PostgreSQL; Oracle SELECT/WITH only. Never write `/*+ ... */` optimizer hints: the server refuses them.
   `truncated: true` means the row cap cut the result — say so. On prod the cap is 200 rows and 10 s:
   aggregate there instead of paging through rows.
5. **Rejected.** `rejected [rule]` is the read-only guard; do not rephrase around it. A refused `/*+ ... */` hint → resend once without the hint, not again with it. Writes are not
   possible through this server.
6. **Personal data.** Leave name, phone, address, post code and email columns out of the SELECT list.
   The server drops them anyway and lists them under `hidden` — say which were hidden; do not try to
   get them back through an expression or alias. A count hidden too (a subquery or CTE beside a
   personal column) → rewrite it as one plain SELECT.
7. **Log.** Every read is logged locally without values (`~/.config/database-readonly-mcp/query.log`,
   one line per read with its vendor); "what did we run on prod" → read that file.

## Output Template

```
[postgres/dev] <one line: what was asked>
<result table or summary, rows N, truncated yes/no, elapsed ms>
```

Every answer built on query results names the vendor and profile it came from.

## What Claude Does / What You Do

| Claude | You |
|---|---|
| Reads the schema, writes and runs read-only queries, names the profile | Say which environment and what to look at |

## Related Skills

- `database:profile` — switch environment.
- `develop:sql-pro` — writing complex SQL.
- `develop:database-optimizer` — when a query is slow (`EXPLAIN` through `query`).
