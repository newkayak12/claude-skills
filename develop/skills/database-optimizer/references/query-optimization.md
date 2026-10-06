# Reading Plans and Reshaping Queries

Scope: what a plan tells you about the server. Pure SQL authoring belongs to `sql-pro`.

## Reading a plan

- `EXPLAIN` shows the planner's estimate; `EXPLAIN ANALYZE` executes the statement and adds actual rows, loops and timing. Wrap data-modifying statements in a transaction you roll back.
- Compare estimated rows against actual rows at every node first. A gap of one to two orders of magnitude means the planner chose from bad information (statistics), and no index will fix that.
- Actual figures are per loop. Multiply `actual time` and `rows` by `loops` for the real cost of an inner node.
- `BUFFERS` splits `shared hit` (cache) from `read` (disk or OS cache). A plan that is fast warm and slow cold is an I/O problem.
- Hash and sort nodes report spill: `Batches > 1` on a hash, `Sort Method: external merge` on a sort. Both mean `work_mem` was too small for that node.
- `Rows Removed by Filter` far larger than rows returned means the predicate is applied after the fetch; an index on the filtered column (or a partial index) would let the scan skip them.

MySQL 8 equivalents: `EXPLAIN FORMAT=TREE` for the iterator tree, `EXPLAIN ANALYZE` (8.0.18+) for actual timings. In the classic table output watch `type` (`ALL` is a full scan), `key`, `rows`, and `Extra` values `Using filesort` and `Using temporary`.

## Why an index is ignored

| Cause | Check |
|-------|-------|
| Function or cast on the column (`date(created_at) = ...`, implicit type conversion) | Rewrite the predicate as a range on the bare column, or build an expression index |
| Leading wildcard `LIKE '%x'` | Trigram (`pg_trgm`) GIN index, or full-text search |
| Low selectivity | Planner correctly prefers a scan; consider a partial index on the rare value |
| Stale statistics | `ANALYZE`, then re-plan |
| Column order mismatch in composite index | See `index-design-patterns.md` |
| Tiny table | Scan is cheaper; not a defect |

## Reshaping that the server rewards

- **Correlated subquery per row** becomes a join or a `LATERAL` join when the subquery has to return several columns or a top-N per parent.
- **Existence tests**: `EXISTS` stops at the first match, and `NOT EXISTS` is safer than `NOT IN` because a NULL in the subquery makes `NOT IN` return nothing.
- **`DISTINCT` used to hide duplicate joins**: fix the join (semi-join with `EXISTS`) instead of paying for a sort or hash over the whole result.
- **Join order** is the planner's job. If it picks badly, fix statistics (`ALTER TABLE ... ALTER COLUMN ... SET STATISTICS`, extended statistics with `CREATE STATISTICS` for correlated columns) before reaching for hints or `join_collapse_limit`.
- **CTEs**: since PostgreSQL 12 a non-recursive, side-effect-free CTE referenced once is inlined. Force the old behaviour with `AS MATERIALIZED` when the CTE is expensive and referenced several times; use `AS NOT MATERIALIZED` to push predicates inside it.
- **Aggregation before join**: collapse the many side to one row per key in a subquery, then join, instead of joining then grouping on a fan-out.

## Pagination

`OFFSET n` reads and discards n rows, so page 5,000 costs 5,000 pages. Use keyset (seek) paging with a unique, indexed sort key:

```kotlin
// Spring JdbcTemplate: next page after the last (created_at, id) seen
jdbc.query(
    """
    SELECT id, created_at, title FROM article
    WHERE (created_at, id) < (?, ?)
    ORDER BY created_at DESC, id DESC LIMIT ?
    """.trimIndent(),
    rowMapper, lastCreatedAt, lastId, pageSize
)
```

Back it with an index on `(created_at DESC, id DESC)`; row-value comparison works in both PostgreSQL and MySQL 8, though the MySQL optimizer is less reliable at using an index for it, so confirm in the plan. Keyset paging cannot jump to an arbitrary page; if the product needs that, cap the depth.

## Verifying a change

1. Same statement, same parameters, same data volume as the baseline.
2. Run several times, discard the first (cold cache), compare the median.
3. Compare plan shape and buffers, not just milliseconds.
4. Check the write side: inserts and updates on the touched table after an index is added.
