---
name: database-readonly
description: Use when someone wants to look at database data read-only through profiles — query, switch profile (local, dev, stage, prod), log in or log out of a profile. Triggers on "DB 조회", "dev DB에서 봐줘", "prod로 바꿔", "프로필 바꿔", "로그인", "로그아웃", "query the dev database", "switch to stage".
scenarios:
  - "Show me the last 10 orders from the dev database"
  - "Switch to stage and describe the users table"
  - "dev DB에서 최근 주문 10건 조회해줘"
  - "stage로 프로필 바꾸고 테이블 목록 보여줘"
  - "dev 프로필 로그아웃해줘"
compatibility:
  required:
    - database-readonly (this plugin's mcp/database-readonly server; see Setup)
  optional: []
---

# database-readonly

MCP server `database-readonly` (`${CLAUDE_PLUGIN_ROOT}/mcp/database-readonly`). Tools: `profile`, `logout`,
`query`, `list_tables`, `describe_table`. Login is a terminal CLI: `node ${CLAUDE_PLUGIN_ROOT}/mcp/database-readonly/cli.mjs`.

## Setup

Run once:
`cd ${CLAUDE_PLUGIN_ROOT}/mcp/database-readonly && npm install`
`claude mcp add -s user database-readonly -- node ${CLAUDE_PLUGIN_ROOT}/mcp/database-readonly/server.mjs`

## Process

1. **Which profile.** Call `profile` with no name: active profile and who is logged in. The server
   always starts on `local`. If the person named an environment ("dev에서", "stage 기준"), switch
   with `profile({name})` before querying.
2. **prod only on request.** Switch to `prod` only when the person asked for prod in this
   conversation. The server then asks the person to confirm; never retry around a decline.
3. **Not logged in.** Never ask for a password in chat and never pass one to a tool. Tell the person
   to run it themselves:
   `! node ${CLAUDE_PLUGIN_ROOT}/mcp/database-readonly/cli.mjs login <profile>`
   (hidden password prompt saved to Keychain; typing an `op://` reference uses 1Password instead).
   If a password is pasted into chat anyway, do not repeat it; ask them to log in with the CLI.
4. **Query.** `list_tables` / `describe_table` first when the schema is unknown; then one
   statement per `query`. Add `LIMIT`; `truncated: true` means the row cap cut the result — say so.
5. **Rejected.** A `rejected [rule]` result is the read-only guard; do not rephrase the statement to
   get around it. Writes are not possible through this server.
6. **Logout.** `logout({name})` when asked; it removes the saved password, keeps host/user/database.

## Output Template

```
[profile: dev] <one line: what was asked>
<result table or summary, rows N, truncated yes/no, elapsed ms>
```

Every answer built on query results names the profile it came from.

## What Claude Does / What You Do

| Claude | You |
|---|---|
| Picks/switches the profile you named, runs read-only queries, names the profile in every answer | Log in with the CLI (`! … cli.mjs login <profile>`); confirm a prod switch in the dialog |
| Stops at a rejection or a missing login and tells you the command | Decide when prod is needed |

## Related Skills

- `develop:sql-pro` — writing the SQL itself.
- `develop:database-optimizer` — when a query is slow (use `EXPLAIN` through `query`).
