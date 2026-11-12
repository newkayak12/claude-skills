---
name: query
description: Use when reading data from a database read-only through the database-readonly MCP (local/dev/stage/prod). Triggers on "DB 조회", "dev DB에서 봐줘", "테이블 목록", "이 테이블 컬럼", "query the dev database", "show tables", "/database:query".
scenarios:
  - "Show me the last 10 orders from the dev database"
  - "Describe the users table on stage"
  - "dev DB에서 최근 주문 10건 조회해줘"
  - "테이블 목록 보여줘"
compatibility:
  required:
    - database-readonly MCP server (set up by database:login)
  optional: []
---

# database:query

## Process

1. **Profile.** An environment named ("dev에서", "on stage") and not active → `database:profile` first
   (prod only when asked; the server confirms). Not logged in → offer `database:login`.
2. **Schema.** Unknown tables or columns → `list_tables`, then `describe_table`.
3. **Query.** One statement per `query` (SELECT, SHOW, DESCRIBE, DESC, EXPLAIN, WITH), with `LIMIT`.
   `truncated: true` means the row cap cut the result — say so.
4. **Rejected.** `rejected [rule]` is the read-only guard; do not rephrase around it. Writes are not
   possible through this server.

## Output Template

```
[profile: dev] <one line: what was asked>
<result table or summary, rows N, truncated yes/no, elapsed ms>
```

Every answer built on query results names the profile it came from.

## What Claude Does / What You Do

| Claude | You |
|---|---|
| Reads the schema, writes and runs read-only queries, names the profile | Say which environment and what to look at |

## Related Skills

- `database:profile` — switch environment.
- `develop:sql-pro` — writing complex SQL.
- `develop:database-optimizer` — when a query is slow (`EXPLAIN` through `query`).
