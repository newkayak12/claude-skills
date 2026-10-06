# Optimization

Work in this order: measure, read the plan, fix the query shape, then add or adjust an index, and only then touch configuration.

## Reading a Plan

PostgreSQL: `EXPLAIN (ANALYZE, BUFFERS) <query>`. `ANALYZE` really executes the statement, so wrap INSERT/UPDATE/DELETE in a transaction and roll back. MySQL: `EXPLAIN ANALYZE` (8.0.18+) or `EXPLAIN FORMAT=TREE`. SQL Server: actual execution plan, or `SET STATISTICS IO, TIME ON`. Oracle: `EXPLAIN PLAN` plus `DBMS_XPLAN.DISPLAY`.

What to look at, in order:
1. **Estimated vs actual rows** per node. A gap of orders of magnitude means stale or insufficient statistics, correlated columns, or a predicate the planner cannot estimate.
2. **Node where time goes**: the highest actual time or buffer count, remembering that times of child nodes are included in parents and loops multiply per-loop figures.
3. **Access method**: sequential scan on a selective predicate, index scan, index-only scan, bitmap scan (many matches), each is right in some range of selectivity.
4. **Join method**: nested loop (good with a small outer side and indexed inner side), hash join (large unsorted inputs, needs memory), merge join (pre-sorted inputs).
5. **Sorts and spills**: a sort or hash reported as using disk points at `work_mem` or a missing index that supplies order.
6. **Buffers**: many shared reads mean cold cache or too many pages touched; high `Rows Removed by Filter` means the index does not cover the predicate.

A sequential scan is not automatically wrong: on a small table, or when most rows qualify, it is the cheapest plan.

## Sargability

A predicate can use an index only if the indexed column stands alone on one side.

| Blocks the index | Index-friendly form |
|------------------|---------------------|
| `WHERE DATE(placed_at) = '2026-01-05'` | `placed_at >= '2026-01-05' AND placed_at < '2026-01-06'` |
| `WHERE lower(email) = :e` | expression index on `lower(email)`, or case-insensitive collation |
| `WHERE amount + 10 > 100` | `amount > 90` |
| `WHERE name LIKE '%son'` | trigram index (PostgreSQL `pg_trgm`) or full-text search |
| `WHERE varchar_col = 123` (implicit cast) | pass a value of the column's type |

## Index Design

- Column order in a composite index: equality predicates first, then the range or sort column. `(status, placed_at)` serves `status = ? ORDER BY placed_at`; the reverse order does not.
- B-tree prefix rule: an index on `(a, b, c)` helps queries on `a`, `a,b`, `a,b,c`, not on `b` alone.
- **Covering**: add payload columns so the query never visits the table. PostgreSQL 11+ and SQL Server: `INCLUDE (col)`. MySQL InnoDB: append columns to the key, since secondary indexes already carry the primary key.
- **Partial** (PostgreSQL, SQL Server filtered): `CREATE INDEX ON orders (customer_id) WHERE status = 'OPEN'` is small and fast for hot subsets.
- **Expression** indexes (PostgreSQL, MySQL 8.0.13+) support computed predicates.
- Other PostgreSQL types: GIN for `jsonb` containment and arrays, BRIN for huge append-ordered tables, GiST for ranges and geometry.
- Every index taxes writes and storage. Low-cardinality single-column indexes (booleans) rarely pay off, except as a partial index.
- Foreign key columns need an index when you join or delete parents; PostgreSQL does not create one automatically.

Build without blocking writes: PostgreSQL `CREATE INDEX CONCURRENTLY` (cannot run inside a transaction block; a failed build leaves an INVALID index to drop). SQL Server: `WITH (ONLINE = ON)` where the edition allows it. MySQL InnoDB builds most secondary indexes online by default.

## Maintenance

- Keep statistics fresh: PostgreSQL `ANALYZE` (autovacuum does it), MySQL `ANALYZE TABLE`, SQL Server `UPDATE STATISTICS`. Raise per-column statistics targets for skewed columns.
- PostgreSQL bloat: autovacuum must keep up with update-heavy tables; `REINDEX CONCURRENTLY` (12+) rebuilds a bloated index online.
- Find unused indexes before dropping: PostgreSQL `pg_stat_user_indexes.idx_scan`, SQL Server `sys.dm_db_index_usage_stats`, MySQL `sys.schema_unused_indexes`. Check replicas too, and confirm the stats window covers month-end jobs.

## Rewrites That Usually Win

- Correlated subquery per row to a pre-aggregated join (see SKILL.md example).
- Many `OR`s on different columns to `UNION ALL` branches.
- `SELECT *` to the needed columns, which also enables index-only scans.
- Row-by-row application loop (the N+1 shape from an ORM) to one set-based statement: `WHERE id = ANY(:ids)`, a join, or a batch `INSERT ... SELECT`.
- Large `IN` lists to a join against `VALUES` or a temp table.
- Bulk write in chunks (for example 5-10k rows per transaction) to keep locks and WAL manageable.
- Aggregate before joining when the join would multiply rows only to collapse them again.

## Partitioning

Worth it for very large tables with a natural range key (time) where old data is dropped or archived by detaching a partition, or where queries always filter by the key. PostgreSQL declarative partitioning supports RANGE, LIST and HASH; the planner prunes partitions only when the predicate on the partition key is visible. A primary key or unique index must include the partition key. Too many tiny partitions inflate planning time. Partitioning is not a substitute for a missing index.

## Materialized Views

Store an expensive aggregate and refresh on a schedule. PostgreSQL: `REFRESH MATERIALIZED VIEW CONCURRENTLY mv` avoids blocking readers but requires a unique index on the view. MySQL has no native materialized views; emulate with a summary table maintained by a job. Oracle and SQL Server offer refresh-on-commit variants (materialized view, indexed view) with restrictions on the defining query.

## Hints

PostgreSQL has none built in; fix statistics, query shape or indexes instead. MySQL offers index hints (`USE INDEX`, `FORCE INDEX`) and optimizer hints in `/*+ ... */`. SQL Server uses `OPTION (...)` and table hints; Oracle uses `/*+ ... */`. Treat a hint as a pinned workaround and record why.

## Finding the Worst Queries

- PostgreSQL: `pg_stat_statements` ordered by `total_exec_time` (column names for 13+), plus `log_min_duration_statement`.
- MySQL: slow query log, `performance_schema`, `sys` schema.
- SQL Server: Query Store, DMVs.

Always report before/after with the same data volume, and say whether the cache was warm.
