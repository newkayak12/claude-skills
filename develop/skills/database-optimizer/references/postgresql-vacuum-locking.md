# PostgreSQL: Vacuum, Locks and Partitioning

## Why vacuum matters

MVCC leaves old row versions behind. Vacuum reclaims them for reuse, updates the visibility map (enables index-only scans), freezes old transaction IDs, and `ANALYZE` refreshes planner statistics. If it falls behind, tables bloat, scans slow down, and eventually wraparound protection forces an aggressive vacuum.

## Autovacuum triggers

A table is vacuumed when dead tuples exceed `autovacuum_vacuum_threshold + autovacuum_vacuum_scale_factor * reltuples` (defaults 50 and 0.2). On a 100M-row table that is 20M dead rows, far too late. Override per table:

```sql
ALTER TABLE event_log SET (
  autovacuum_vacuum_scale_factor = 0.01,
  autovacuum_analyze_scale_factor = 0.03
);
```

Throughput is throttled by `autovacuum_vacuum_cost_limit` and `autovacuum_vacuum_cost_delay`; with fast storage raise the limit (the limit is shared among running workers) and add workers (`autovacuum_max_workers`) for many large tables.

## Finding trouble

```sql
SELECT relname, n_live_tup, n_dead_tup, last_autovacuum, last_autoanalyze
FROM pg_stat_user_tables ORDER BY n_dead_tup DESC LIMIT 20;
```

Vacuum runs but dead tuples stay? Something pins the cleanup horizon:

- long transactions or sessions `idle in transaction` (see `pg_stat_activity.xact_start`, `backend_xmin`)
- abandoned replication slots (`pg_replication_slots`) or a lagging standby with `hot_standby_feedback`
- forgotten prepared transactions (`pg_prepared_xacts`)

Protective settings: `idle_in_transaction_session_timeout`, `statement_timeout`, and for slots `max_slot_wal_keep_size`.

Wraparound watch: `SELECT datname, age(datfrozenxid) FROM pg_database;` compared with `autovacuum_freeze_max_age` (default 200 million).

## Manual operations

- `VACUUM (VERBOSE, ANALYZE) t` is non-blocking for reads and writes.
- `VACUUM FULL` rewrites the table under an `ACCESS EXCLUSIVE` lock; for online compaction use an extension such as `pg_repack` where the platform allows it.
- After a bulk load, run `ANALYZE` yourself instead of waiting.
- Heap-only tuple (HOT) updates avoid index churn: lowering a table's `fillfactor` (for example 85) leaves page room for them on update-heavy tables.

## Lock behaviour worth knowing

Row locks come from `UPDATE`, `DELETE`, `SELECT ... FOR UPDATE/SHARE`. Table-level modes matter for DDL: `ALTER TABLE` often needs `ACCESS EXCLUSIVE`, which queues behind any running query and blocks everything queued after it. Even a quick DDL can stall an entire table if it waits behind a long transaction.

Safe DDL pattern:

```sql
SET lock_timeout = '3s';
ALTER TABLE orders ADD COLUMN note text;   -- fails fast instead of queueing
```

Retry in the migration tool. Add constraints as `NOT VALID` then `VALIDATE CONSTRAINT` separately; add indexes with `CONCURRENTLY`.

### Who blocks whom

```sql
SELECT a.pid, a.state, a.wait_event_type, a.query,
       pg_blocking_pids(a.pid) AS blocked_by
FROM pg_stat_activity a
WHERE cardinality(pg_blocking_pids(a.pid)) > 0;
```

Trace to the root blocker (often an idle-in-transaction session) before cancelling anything: `pg_cancel_backend` then, if needed, `pg_terminate_backend`.

### Deadlocks

Detected after `deadlock_timeout` (1 s default); one victim aborts with SQLSTATE `40P01`. Prevent by touching rows in a consistent order (sort ids before a multi-row update) and keeping transactions short. Spring code should treat `40P01` and `40001` as retryable at the transaction boundary.

### Queue claiming and advisory locks

Work-queue consumers should not block one another:

```sql
SELECT id FROM job WHERE state = 'pending'
ORDER BY id LIMIT 10
FOR UPDATE SKIP LOCKED;
```

For a lock not tied to a row (singleton scheduler, per-tenant migration) use `pg_try_advisory_xact_lock(key)`, released automatically at transaction end. Session-level advisory locks leak across pooled connections; prefer the transaction-scoped form.

## Partitioning

Use declarative partitioning when a table is large enough that maintenance (retention, vacuum) or scans on a natural key dominate: time-series, tenant-isolated data.

```sql
CREATE TABLE metric (
  id bigint GENERATED ALWAYS AS IDENTITY,
  recorded_at timestamptz NOT NULL,
  value double precision,
  PRIMARY KEY (id, recorded_at)
) PARTITION BY RANGE (recorded_at);

CREATE TABLE metric_2026_10 PARTITION OF metric
  FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
```

Rules and effects:

- Any primary key or unique constraint must include the partition key.
- Queries must filter on the key for partition pruning; check the plan shows only the expected partitions.
- Retention becomes `ALTER TABLE metric DETACH PARTITION ... CONCURRENTLY` (PostgreSQL 14+) then drop, instead of a huge `DELETE` that creates bloat.
- Create future partitions ahead of time by a scheduled job; a missing partition makes inserts fail unless a default partition exists.
- Thousands of partitions raise planning time; choose granularity accordingly.
- List partitioning suits tenant or region keys; hash spreads evenly when no natural range exists.
