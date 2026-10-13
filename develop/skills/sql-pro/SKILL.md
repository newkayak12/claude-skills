---
name: sql-pro
description: >-
  Use when someone needs help writing or rewriting SQL — authoring complex
  joins, CTEs, window functions, or recursive queries — or designing a schema
  from scratch, normalizing an existing one, or migrating queries between
  database dialects.
scenarios:
  - "Rewrite this slow SQL query that's doing full table scans on a 50M row table"
  - "Help me write a complex analytics query with CTEs, window functions, and aggregations"
  - "Our report query takes 5 minutes — optimize it with proper indexing strategy"
  - "풀 테이블 스캔을 하는 느린 쿼리를 최적화해줘"
  - "윈도우 함수와 CTE를 활용한 복잡한 분석 쿼리를 작성해줘"
compatibility:
  recommended: []
  optional:
    - think-tool
  remote_mcp_note: >-
    think-tool이 있으면 쿼리 실행 계획 해석과 인덱스 전략 결정을 더 체계적으로 검토합니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
license: MIT
metadata:
  version: "1.1.0"
  role: specialist
  triggers: SQL tuning, slow query, schema design, PostgreSQL, MySQL, SQL Server, Oracle, window functions, CTE, EXPLAIN plan, index design
  scope: implementation
  domain: language
  related-skills: database-optimizer, connection-pool-tuner, spring-boot-engineer
  output-format: code
---

## Standing Mandates

- NEVER propose a rewrite or index before you have the execution plan and the row counts. A fix written from the query
  text alone is a guess; the same text can be fast on 10k rows and a full scan on 50M. No plan supplied is
  `[확인 필요: EXPLAIN ANALYZE]`, and the rewrite is marked `unmeasured`.
- NEVER report a speedup you did not see as a before/after number. A claimed gain without both plans is `unverified`.
- Target engine and version unknown is `[확인 필요: engine/version]`; never assume dialect-specific syntax is available.
- Goal: the final query, its plan before and after, and a closing tally that recounts to the evidence lines.

# SQL Pro

Writes and rewrites SQL, designs schemas, and ports queries between dialects, judged by the plan, not by the look of the query.

**Not for** server-level causes: memory, VACUUM, lock waits (`develop:database-optimizer`), pool exhaustion
(`develop:connection-pool-tuner`), or transaction scope (`develop:transaction-boundary-reviewer`).

## Process

1. **Context.** Read schema, indexes, and the query; confirm engine and version. Read the repo before asking.
2. **Design.** Shape the query as set operations: CTEs, window functions, correct join types.
3. **Plan.** Read the `EXPLAIN` first, then optimize: covering indexes, early filters, no big sequential scans.
4. **Verify.** Re-run `EXPLAIN ANALYZE`; compare to the baseline. Stop when the target is met or after 3 rounds with no
   improvement, and report the best plan with the remaining bottleneck.
5. **Document.** Index rationale, engine caveats, minimum version.

Coding rules and worked examples (CTE, window, correlated-subquery rewrite): `references/worked-examples.md`.

| Topic | File | Read it when |
|-------|------|--------------|
| Query shapes | `references/query-patterns.md` | Joins, CTEs, recursion, subquery rewrites, pivots, keyset paging |
| Analytic windows | `references/window-functions.md` | Ranking, running totals, LAG/LEAD, frames, gaps-and-islands |
| Tuning and plans | `references/optimization.md` | Plan reading, index choice, statistics, partitioning |
| Schema design | `references/database-design.md` | Normal forms, keys, constraints, history tables, migrations |
| Porting engines | `references/dialect-differences.md` | PostgreSQL, MySQL, SQL Server, Oracle |

## Output Template

```
## SQL — <task>

Query: <final query, commented inline>
Indexes: <DDL → why>
Plan: before <cost/time, key node> → after <cost/time, key node>   (or unmeasured: [확인 필요: EXPLAIN ANALYZE])
Caveats: <engine-specific>   Minimum version: <e.g. PostgreSQL >= 10>

<n> queries · <m> measured before/after · <k> unmeasured
```

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Writes the set-based query, reads the plan, proposes indexes | Provide schema DDL, sample data, actual `EXPLAIN ANALYZE` |
| Flags dialect differences | Test on your DB version; run `CREATE INDEX CONCURRENTLY` yourself |
| Writes up the before/after | Check it against production-sized data |

## Related Skills

- `develop:database-optimizer` — server-level tuning after the query is optimized
- `develop:connection-pool-tuner` — pool sizing if slow queries are exhausting connections
- `develop:spring-boot-engineer` — JPA query methods and `@Query`
