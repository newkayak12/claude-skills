---
name: database-optimizer
description: >-
  Use when database slowness stems from infrastructure concerns rather than
  query authoring: server memory and I/O configuration, connection pooling, lock
  contention, VACUUM and statistics maintenance, partitioning design, or
  cloud-managed database...
scenarios:
  - "Our database queries are slow and we're hitting performance bottlenecks"
  - "Help me optimize this SQL query that takes 30 seconds on a 10M row table"
  - "Need to scale our PostgreSQL database — it can't handle current load"
  - "DB 쿼리가 너무 느려서 서비스 응답시간이 30초야"
  - "PostgreSQL 성능 최적화 방법을 알려줘"
compatibility:
  recommended:
    - think-tool
  optional:
    - sequential-thinking
  remote_mcp_note: >-
    think-tool이 있으면 병목 원인 분석과 최적화 우선순위 결정을 더 체계적으로 수행합니다.
    sequential-thinking은 베이스라인 캡처 → 변경 → 검증 순서를 강제합니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
license: MIT
metadata:
  author: https://github.com/Jeffallan
  version: "1.1.0"
  domain: infrastructure
  triggers: database optimization, slow query, query performance, database tuning, index optimization, execution plan, EXPLAIN ANALYZE, database performance, PostgreSQL optimization, MySQL optimization
  role: specialist
  scope: optimization
  output-format: analysis-and-code
  related-skills: devops-engineer
---

# Database Optimizer

## When to Use / When Not to Use

**Use when:**
- EXPLAIN plan is in hand but the fix is server config, not query rewriting
- Investigating lock contention, VACUUM lag, or statistics staleness
- Tuning `shared_buffers`, `work_mem`, or InnoDB buffer pool
- Designing partitioning strategy or index structure

**Do not use when:**
- The fix is rewriting a slow SQL query (use `sql-pro`)
- The bottleneck is connection pool exhaustion (use `connection-pool-tuner`)

## Process

1. **Initial triage** — Confirm: database engine + version, deployment type (self-managed vs. cloud-managed), and whether direct connection is available
2. **Capture baseline** — Run `EXPLAIN (ANALYZE, BUFFERS)` before any changes
3. **Identify bottlenecks** — Find inefficient queries, missing indexes, config issues from the plan
4. **Design solutions** — Index strategy, query rewrites, schema or config improvements
5. **Implement incrementally** — One change at a time; validate each before proceeding
6. **Validate results** — Re-run `EXPLAIN ANALYZE`, compare costs, measure wall-clock improvement

> On cloud-managed databases (RDS, Cloud SQL, Aurora): `ALTER SYSTEM` and `my.cnf` edits are unavailable. Use parameter groups or the console instead.

Use `sequential-thinking` if available — it enforces the baseline-capture step and prevents skipping directly to index creation.

## Output Template

For each optimization task, provide:
1. Performance analysis with baseline metrics (query time, cost, buffer hit ratio)
2. Identified bottlenecks with EXPLAIN evidence
3. Optimization strategy with specific changes
4. Implementation SQL / config changes
5. Validation queries to measure improvement
6. Monitoring recommendations

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Reads EXPLAIN output and identifies plan patterns | Provide the actual EXPLAIN output |
| Recommends index type (B-tree, covering, partial, expression) | Run `CREATE INDEX CONCURRENTLY` in your environment |
| Generates parameter tuning recommendations | Apply via parameter group or `ALTER SYSTEM` |
| Writes validation queries to measure improvement | Confirm improvement in production-scale data |
| Flags cloud-managed platform constraints | Verify access level (console vs. direct connection) |

## Reference Guide

| Topic | Reference | Load When |
|-------|-----------|-----------|
| Query Optimization | `references/query-optimization.md` | Slow queries, execution plan analysis |
| Index Design | `references/index-design-patterns.md` | B-tree, covering, partial, expression indexes |
| PostgreSQL Memory & WAL | `references/postgresql-memory-wal.md` | shared_buffers, work_mem, WAL config |
| PostgreSQL VACUUM & Locking | `references/postgresql-vacuum-locking.md` | VACUUM, connection pooling, lock management |
| MySQL Memory & I/O | `references/mysql-memory-io.md` | InnoDB memory, I/O config |
| PostgreSQL Monitoring | `references/monitoring-postgresql.md` | pg_stat_statements, connections, locks |
| MySQL Monitoring | `references/monitoring-mysql.md` | Performance schema, InnoDB status |

## EXPLAIN Output — Key Patterns

| Pattern | Symptom | Typical Remedy |
|---------|---------|----------------|
| `Seq Scan` on large table | No filter selectivity | Add B-tree index on filter column |
| `Nested Loop` with large outer set | Exponential row growth | Consider Hash Join; index inner join key |
| `cost=... rows=1` but actual rows=50000 | Stale statistics | Run `ANALYZE <table>` |
| `Buffers: hit=10 read=90000` | Low cache hit rate | Increase `shared_buffers`; add covering index |
| `Sort Method: external merge` | Sort spilling to disk | Increase `work_mem` for the session |

```sql
-- Always use BUFFERS to see cache hit vs. disk read ratio
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT o.id, c.name
FROM   orders o
JOIN   customers c ON c.id = o.customer_id
WHERE  o.status = 'pending'
  AND  o.created_at > now() - interval '7 days';
```

## Constraints

**MUST DO:**
- Capture `EXPLAIN (ANALYZE, BUFFERS)` before any changes — this is the baseline
- Create PostgreSQL indexes with `CONCURRENTLY` to avoid table locks
- Test in non-production; roll back if write performance or replication lag worsens
- Make one change at a time — measure before making the next change

**MUST NOT DO:**
- Apply optimizations without a measured baseline
- Create redundant or unused indexes
- Make multiple changes simultaneously
- Use `ALTER SYSTEM` on Amazon RDS or other cloud-managed databases

## Related Skills

- `sql-pro` — rewriting slow queries when the server is correctly configured
- `connection-pool-tuner` — pool sizing after server config is validated
- `sre-engineer` — monitoring and alerting on database golden signals
