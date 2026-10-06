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

# SQL Pro

## When to Use / When Not to Use

**Use when:**
- Writing or rewriting SQL queries: joins, CTEs, window functions, recursive queries
- Designing or normalizing a schema
- Interpreting an EXPLAIN plan for a slow query
- Migrating SQL between PostgreSQL, MySQL, and SQL Server dialects

**Do not use when:**
- The bottleneck is server-level config (use `database-optimizer`)
- The issue is connection pool exhaustion (use `connection-pool-tuner`)

## Process

1. **Schema Analysis** — Review table structure, existing indexes, query patterns
2. **Design** — Sketch the query as set operations: CTEs, window functions, and the right join types
3. **Version Check** — Confirm target engine and version; flag any feature requiring a minimum version
4. **Optimize** — Study the plan, add covering indexes, and remove full scans of big tables
5. **Verify** — Re-run `EXPLAIN ANALYZE`, check that large tables are no longer scanned sequentially, and repeat until the query is under the 100 ms target
6. **Document** — Provide query explanation, index rationale, performance metrics, and minimum version requirements

## Output Template

For each SQL task, provide:
1. The final query, commented inline
2. Indexes it needs, and why
3. Execution plan analysis (key patterns found)
4. Timing or cost numbers, before and after
5. Engine-specific caveats where they apply
6. Minimum version requirements (e.g., `PostgreSQL >= 10`, `MySQL >= 8.0`)

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Writes set-based query using CTEs or window functions | Provide sample data or schema DDL |
| Recommends covering index strategy | Run `CREATE INDEX CONCURRENTLY` in your environment |
| Reads EXPLAIN output and identifies plan patterns | Provide actual EXPLAIN ANALYZE output |
| Flags dialect-specific syntax differences | Test against your actual database version |
| Writes up the timing difference between old and new query | Check it against production-sized data |

## Reference Guide

| Topic | File | Read it when |
|-------|------|--------------|
| Query shapes | `references/query-patterns.md` | Joins, CTEs, recursion, subquery rewrites, pivots, keyset paging |
| Analytic windows | `references/window-functions.md` | Ranking, running totals, LAG/LEAD, frames, gaps-and-islands |
| Tuning and plans | `references/optimization.md` | Plan reading, index choice, statistics, partitioning |
| Schema design | `references/database-design.md` | Normal forms, choosing keys, constraints, history tables, migrations |
| Porting between engines | `references/dialect-differences.md` | Translating SQL between PostgreSQL, MySQL, SQL Server and Oracle |

## Worked Examples

### CTE Pattern
```sql
WITH latest AS (
    SELECT
        customer_id,
        id AS order_pk,
        total_amount AS amount,
        ROW_NUMBER() OVER (
            PARTITION BY customer_id ORDER BY placed_at DESC, id DESC
        ) AS recency
    FROM orders WHERE status = 'completed'
)
SELECT customer_id, order_pk, amount
FROM latest
WHERE recency = 1;  -- newest completed order for each customer
```

### Window Pattern
```sql
SELECT
    store_id,
    sale_date,
    amount,
    SUM(amount) OVER (PARTITION BY store_id ORDER BY sale_date) AS cumulative,
    RANK()      OVER (PARTITION BY store_id ORDER BY amount DESC) AS amount_rank
FROM sales;
```

### Before / After Optimization
```sql
-- BEFORE: correlated subquery runs once per order row
SELECT ord.id AS order_id,
       (SELECT SUM(ln.quantity) FROM order_lines ln WHERE ln.order_id = ord.id) AS qty_total
FROM orders ord;

-- AFTER: total each order's lines a single time, then join back
WITH line_totals AS (
    SELECT order_id, SUM(quantity) AS units_sold
    FROM order_lines
    GROUP BY order_id
)
SELECT ord.id AS order_id, COALESCE(lt.units_sold, 0) AS qty_total
FROM orders ord
LEFT JOIN line_totals lt ON lt.order_id = ord.id;
```

## Constraints

**MUST DO:**
- Read the execution plan before proposing any optimization
- Prefer set-based statements to row-at-a-time loops
- Apply filtering early (before joins where possible)
- Test existence with EXISTS, not COUNT
- Handle NULLs explicitly

**MUST NOT DO:**
- Ship `SELECT *` in production queries
- Reach for cursors when a set-based form exists
- Propose a fix without asking about row counts and cardinality

## Related Skills

- `database-optimizer` — server-level tuning after the query is optimized
- `connection-pool-tuner` — pool sizing if slow queries are exhausting connections
- `spring-boot-engineer` — for JPA query methods and `@Query` annotations
