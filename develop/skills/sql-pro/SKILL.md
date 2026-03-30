---
name: sql-pro
description: >-
  Use when someone needs help writing or rewriting SQL — authoring complex joins, CTEs,
  window functions, or recursive queries — or designing a schema from scratch, normalizing
  an existing one, or migrating queries between database dialects. Also applies when a
  user shares a slow query and wants it rewritten or an EXPLAIN plan interpreted.
  Triggers on: "write this SQL query", "optimize this query", "window function",
  "CTE", "rewrite SQL", "EXPLAIN plan", "SQL schema design", "dialect migration",
  "SQL 쿼리 작성", "쿼리 최적화", "윈도우 함수", "실행 계획 분석".
  Best for: query authoring, window functions, CTEs, EXPLAIN plan interpretation, schema normalization.
  Not for: server-level DB config (use database-optimizer) or connection pool sizing (use connection-pool-tuner).
compatibility:
  recommended: []
  optional:
    - think-tool
  remote_mcp_note: >-
    think-tool이 있으면 쿼리 실행 계획 해석과 인덱스 전략 결정을 더 체계적으로 검토합니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
license: MIT
metadata:
  author: https://github.com/Jeffallan
  version: "1.1.0"
  domain: language
  triggers: SQL optimization, query performance, database design, PostgreSQL, MySQL, SQL Server, window functions, CTEs, query tuning, EXPLAIN plan, database indexing
  role: specialist
  scope: implementation
  output-format: code
  related-skills: devops-engineer
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
2. **Design** — Draft set-based operations using CTEs, window functions, appropriate joins
3. **Version Check** — Confirm target engine and version; flag any feature requiring a minimum version
4. **Optimize** — Analyze execution plans; implement covering indexes; eliminate table scans
5. **Verify** — Run `EXPLAIN ANALYZE` and confirm no sequential scans on large tables; iterate until sub-100ms target is met
6. **Document** — Provide query explanation, index rationale, performance metrics, and minimum version requirements

## Output Template

For each SQL task, provide:
1. Optimized query with inline comments
2. Required indexes with rationale
3. Execution plan analysis (key patterns found)
4. Performance metrics (before/after)
5. Platform-specific notes if applicable
6. Minimum version requirements (e.g., `PostgreSQL >= 10`, `MySQL >= 8.0`)

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Writes set-based query using CTEs or window functions | Provide sample data or schema DDL |
| Recommends covering index strategy | Run `CREATE INDEX CONCURRENTLY` in your environment |
| Reads EXPLAIN output and identifies plan patterns | Provide actual EXPLAIN ANALYZE output |
| Flags dialect-specific syntax differences | Test against your actual database version |
| Documents the before/after performance comparison | Validate with production-scale data volumes |

## Reference Guide

| Topic | Reference | Load When |
|-------|-----------|-----------|
| Query Patterns | `references/query-patterns.md` | JOINs, CTEs, subqueries, recursive queries |
| Window Functions | `references/window-functions.md` | ROW_NUMBER, RANK, LAG/LEAD, analytics |
| Optimization | `references/optimization.md` | EXPLAIN plans, indexes, statistics |
| Database Design | `references/database-design.md` | Normalization, keys, constraints |
| Dialect Differences | `references/dialect-differences.md` | PostgreSQL vs MySQL vs SQL Server |

## Quick-Reference Examples

### CTE Pattern
```sql
WITH ranked_orders AS (
    SELECT
        customer_id,
        order_id,
        total_amount,
        ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY order_date DESC) AS rn
    FROM orders
    WHERE status = 'completed'
)
SELECT customer_id, order_id, total_amount
FROM ranked_orders
WHERE rn = 1;  -- latest completed order per customer
```

### Window Function Pattern
```sql
SELECT
    department_id,
    employee_id,
    salary,
    SUM(salary) OVER (PARTITION BY department_id ORDER BY hire_date) AS running_payroll,
    RANK()      OVER (PARTITION BY department_id ORDER BY salary DESC) AS salary_rank
FROM employees;
```

### Before / After Optimization
```sql
-- BEFORE: correlated subquery, one execution per row (slow)
SELECT order_id,
       (SELECT SUM(quantity) FROM order_items oi WHERE oi.order_id = o.id) AS item_count
FROM orders o;

-- AFTER: single aggregation join (fast)
SELECT o.order_id, COALESCE(agg.item_count, 0) AS item_count
FROM orders o
LEFT JOIN (
    SELECT order_id, SUM(quantity) AS item_count
    FROM order_items
    GROUP BY order_id
) agg ON agg.order_id = o.id;
```

## Constraints

**MUST DO:**
- Analyze execution plans before recommending optimizations
- Use set-based operations over row-by-row processing
- Apply filtering early (before joins where possible)
- Use EXISTS over COUNT for existence checks
- Handle NULLs explicitly

**MUST NOT DO:**
- Use `SELECT *` in production queries
- Use cursors when set-based operations work
- Implement solutions without considering data volume and cardinality

## Related Skills

- `database-optimizer` — server-level tuning after the query is optimized
- `connection-pool-tuner` — pool sizing if slow queries are exhausting connections
- `spring-boot-engineer` — for JPA query methods and `@Query` annotations
