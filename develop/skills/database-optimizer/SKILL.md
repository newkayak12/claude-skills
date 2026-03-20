---
name: database-optimizer
description: 'Use when database slowness stems from infrastructure concerns rather than query authoring: server memory and I/O configuration, connection pooling, lock contention, VACUUM and statistics maintenance, partitioning design, or cloud-managed database parameter tuning. Also applies when an EXPLAIN plan is in hand but the next step is tuning the server or schema structure rather than rewriting the SQL.'
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

Senior database optimizer with expertise in performance tuning, query optimization, and scalability across multiple database systems.

## When to Use This Skill

- Analyzing slow queries and execution plans
- Designing optimal index strategies
- Tuning database configuration parameters
- Optimizing schema design and partitioning
- Reducing lock contention and deadlocks
- Improving cache hit rates and memory usage

## Initial Triage

Before loading any reference or generating SQL, confirm:

1. **Database engine and version** — PostgreSQL vs. MySQL; minimum version matters for `CONCURRENTLY`, `INCLUDE`, `EXPLAIN ANALYZE`, and parallel workers
2. **Deployment type** — self-managed server, Docker/VM, or cloud-managed (RDS, Cloud SQL, Aurora, PlanetScale, Neon, etc.)
   - On cloud-managed: `ALTER SYSTEM` and `my.cnf` edits are unavailable; use parameter groups / console settings instead
3. **Access mode** — direct connection available, or user will paste EXPLAIN output manually

> Generating `CONCURRENTLY` DDL for MySQL, recommending `ALTER SYSTEM` on Amazon RDS, or asking for `pg_stat_statements` data from a MySQL 5.7 user are the most common incorrect-advice failure modes — triage prevents them.

## Core Workflow

> Use `mcp__claude_ai_sequential-thinking__sequentialthinking` for this workflow when available — it creates enforced checkpoints and prevents skipping the baseline-capture step. Each step becomes a committed phase with a visible summary before the next begins.

1. **Analyze Performance** — Capture baseline metrics and run `EXPLAIN ANALYZE` before any changes
2. **Identify Bottlenecks** — Find inefficient queries, missing indexes, config issues
3. **Design Solutions** — Create index strategies, query rewrites, schema improvements
4. **Implement Changes** — Apply optimizations incrementally with monitoring; validate each change before proceeding to the next
5. **Validate Results** — Re-run `EXPLAIN ANALYZE`, compare costs, measure wall-clock improvement, document changes

> ⚠️ Always test changes in non-production first. Revert immediately if write performance degrades or replication lag increases.

## Reference Guide

Load detailed guidance based on context:

| Topic | Reference | Load When |
|-------|-----------|-----------|
| Query Optimization | `references/query-optimization.md` | Analyzing slow queries, execution plans |
| Index Design | `references/index-design-patterns.md` | B-tree, covering, partial, expression, specialized index types |
| Index Maintenance | `references/index-maintenance-types.md` | Maintenance, anti-patterns, design checklist |
| PostgreSQL Memory & WAL | `references/postgresql-memory-wal.md` | Memory config, query planner, WAL, write performance |
| PostgreSQL VACUUM & Locking | `references/postgresql-vacuum-locking.md` | VACUUM, connection pooling, lock management, partitioning |
| MySQL Memory & I/O | `references/mysql-memory-io.md` | InnoDB memory, I/O config, query optimization, indexes |
| MySQL Replication | `references/mysql-replication-partitioning.md` | Replication, partitioning, table maintenance, config file |
| PostgreSQL Monitoring | `references/monitoring-postgresql.md` | pg_stat_statements, connections, locks, alerts |
| MySQL Monitoring | `references/monitoring-mysql.md` | Performance schema, InnoDB status, alerts |

## Common Operations & Examples

### Identify Top Slow Queries (PostgreSQL)
```sql
-- Requires pg_stat_statements extension
SELECT query,
       calls,
       round(total_exec_time::numeric, 2)  AS total_ms,
       round(mean_exec_time::numeric, 2)   AS mean_ms,
       round(stddev_exec_time::numeric, 2) AS stddev_ms,
       rows
FROM   pg_stat_statements
ORDER  BY mean_exec_time DESC
LIMIT  20;
```

### Capture an Execution Plan
```sql
-- Use BUFFERS to expose cache hit vs. disk read ratio
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT o.id, c.name
FROM   orders o
JOIN   customers c ON c.id = o.customer_id
WHERE  o.status = 'pending'
  AND  o.created_at > now() - interval '7 days';
```

### Reading EXPLAIN Output — Key Patterns to Find

| Pattern | Symptom | Typical Remedy |
|---------|---------|----------------|
| `Seq Scan` on large table | High row estimate, no filter selectivity | Add B-tree index on filter column |
| `Nested Loop` with large outer set | Exponential row growth in inner loop | Consider Hash Join; index inner join key |
| `cost=... rows=1` but actual rows=50000 | Stale statistics | Run `ANALYZE <table>;` |
| `Buffers: hit=10 read=90000` | Low buffer cache hit rate | Increase `shared_buffers`; add covering index |
| `Sort Method: external merge` | Sort spilling to disk | Increase `work_mem` for the session |

### Create a Covering Index
```sql
-- Covers the filter AND the projected columns, eliminating a heap fetch
CREATE INDEX CONCURRENTLY idx_orders_status_created_covering
    ON orders (status, created_at)
    INCLUDE (customer_id, total_amount);
```

### Validate Improvement
```sql
-- Before optimization: save plan & timing
EXPLAIN (ANALYZE, BUFFERS) <query>;   -- note "Execution Time: X ms"

-- After optimization: compare
EXPLAIN (ANALYZE, BUFFERS) <query>;   -- target meaningful reduction in cost & time

-- Confirm index is actually used
SELECT indexname, idx_scan, idx_tup_read, idx_tup_fetch
FROM   pg_stat_user_indexes
WHERE  relname = 'orders';
```

### MySQL: Find Slow Queries
```sql
-- Inspect slow query log candidates
SELECT * FROM performance_schema.events_statements_summary_by_digest
ORDER  BY SUM_TIMER_WAIT DESC
LIMIT  20;

-- Execution plan
EXPLAIN FORMAT=JSON
SELECT * FROM orders WHERE status = 'pending' AND created_at > NOW() - INTERVAL 7 DAY;
```

## Constraints

### MUST DO
- Capture `EXPLAIN (ANALYZE, BUFFERS)` output **before** optimizing — this is the baseline
- Measure performance before and after every change
- Create indexes with `CONCURRENTLY` (PostgreSQL) to avoid table locks
- Test in non-production; roll back if write performance or replication lag worsens
- Document all optimization decisions with before/after metrics
- Run `ANALYZE` after bulk data changes to refresh statistics

### MUST NOT DO
- Apply optimizations without a measured baseline
- Create redundant or unused indexes
- Make multiple changes simultaneously (impossible to attribute impact)
- Ignore write amplification caused by new indexes
- Neglect `VACUUM` / statistics maintenance

## Output Templates

When optimizing database performance, provide:
1. Performance analysis with baseline metrics (query time, cost, buffer hit ratio)
2. Identified bottlenecks and root causes (with EXPLAIN evidence)
3. Optimization strategy with specific changes
4. Implementation SQL / config changes
5. Validation queries to measure improvement
6. Monitoring recommendations
