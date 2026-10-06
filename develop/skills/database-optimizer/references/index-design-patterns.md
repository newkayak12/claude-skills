# Index Design

## Choosing what to index

Start from evidence: slow statements (`pg_stat_statements`, MySQL digest table), then their predicates, join keys and sort keys. An index should serve a named query. Every index taxes each insert, each update of its columns, vacuum, and the replica.

## B-tree composite order

A composite B-tree is sorted by its first column, then the second within it. So:

1. Equality columns first.
2. Then the one range or sort column.
3. Columns after a range column cannot narrow the scan.

`WHERE tenant_id = ? AND status = ? AND created_at >= ? ORDER BY created_at` is served by `(tenant_id, status, created_at)`. The same index does not help a query filtering only on `status`. Between two equality columns, put the one most queries share first so one index serves more statements.

Sort direction matters only when mixing directions (`a ASC, b DESC`); declare it in the index. MySQL supports descending index parts from 8.0.

## Covering indexes

When every column a query reads is in the index, the table is not touched (PostgreSQL index-only scan, MySQL `Using index`).

```sql
-- PostgreSQL: INCLUDE adds payload columns without making them part of the key
CREATE INDEX CONCURRENTLY idx_order_cust_created
    ON orders (customer_id, created_at DESC) INCLUDE (total_amount, status);
```

Index-only scans in PostgreSQL still check the visibility map, so a table that is rarely vacuumed gets little benefit. MySQL has no `INCLUDE`; extra columns go into the key, and InnoDB secondary indexes already carry the primary key.

## Partial and filtered indexes

PostgreSQL can index only the rows a hot query touches:

```sql
CREATE INDEX CONCURRENTLY idx_job_pending ON job (run_at) WHERE state = 'pending';
```

The query must repeat a predicate the planner can prove implies the index predicate. MySQL has no partial indexes; emulate with a generated column that is NULL for uninteresting rows, then index it.

## Expression indexes

Index the expression the query uses: `CREATE INDEX ON users (lower(email))` serves `WHERE lower(email) = ?`. In MySQL 8.0.13+ functional key parts are supported directly; before that, a generated column plus an index.

## Beyond B-tree (PostgreSQL)

| Type | Fits |
|------|------|
| GIN | `jsonb` containment (`@>`), arrays, full-text `tsvector`, trigram `LIKE '%x%'` |
| GiST | ranges and exclusion constraints, geometry, nearest-neighbour |
| BRIN | very large, naturally ordered append-only tables (time series); tiny index, coarse |
| Hash | equality only; rarely better than B-tree |

MySQL: `FULLTEXT` for natural-language search, spatial indexes for geometry.

## Maintenance

- Find unused: PostgreSQL `pg_stat_user_indexes.idx_scan = 0` (over a full business cycle, and not backing a constraint); MySQL `sys.schema_unused_indexes`. In MySQL 8, make an index invisible first to test removal cheaply.
- Find duplicates: indexes whose columns are a leading prefix of another.
- Bloat: after heavy churn, `REINDEX INDEX CONCURRENTLY` (PostgreSQL 12+). `OPTIMIZE TABLE` or an online rebuild in MySQL.
- Create without blocking writes: `CREATE INDEX CONCURRENTLY` (cannot run inside a transaction; a failed run leaves an `INVALID` index to drop). MySQL InnoDB builds most secondary indexes online with `ALGORITHM=INPLACE, LOCK=NONE`.

## Anti-patterns

- An index per column "just in case".
- Indexing low-cardinality booleans on their own.
- Wide, many-column indexes that no query fully uses.
- Random UUID primary keys on write-heavy InnoDB tables (page splits, fat secondary indexes); time-ordered IDs behave better.
- Adding an index to fix an estimate problem.

## Checklist

- Which query does it serve, and what does the plan show before and after?
- Column order follows equality, then range or sort?
- Could a partial or covering variant be smaller or faster?
- Write cost measured on the busiest table?
- Built concurrently, with a rollback (drop) ready?
