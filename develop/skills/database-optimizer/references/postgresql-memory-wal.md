# PostgreSQL: Memory, Planner and WAL

Values below are starting points for a dedicated server; change one, measure, continue. Parameters change with `ALTER SYSTEM` or `postgresql.conf` on self-managed hosts, parameter groups on managed ones.

## Memory

| Parameter | Role | Starting point |
|-----------|------|----------------|
| `shared_buffers` | PostgreSQL's own page cache; the OS cache sits behind it | about 25% of RAM; more rarely pays off |
| `work_mem` | per sort or hash node, per query, per parallel worker | raise carefully: total = nodes x connections x workers |
| `maintenance_work_mem` | VACUUM, `CREATE INDEX`, FK validation | hundreds of MB to a few GB; autovacuum workers use `autovacuum_work_mem` if set |
| `effective_cache_size` | planner hint only, allocates nothing | roughly shared_buffers plus expected OS cache (50-75% of RAM) |

Targeting `work_mem`: find spilling nodes with `EXPLAIN (ANALYZE, BUFFERS)` or `log_temp_files = 0`. Raise it per role or per transaction (`SET LOCAL work_mem = '256MB'`) for the reporting job instead of globally.

Changing `shared_buffers` needs a restart; `work_mem` and `effective_cache_size` apply on reload.

## Planner

- `default_statistics_target` (default 100): raise per column (`ALTER TABLE t ALTER COLUMN c SET STATISTICS 500`) for skewed columns with bad estimates, then `ANALYZE`.
- `random_page_cost` defaults to 4.0, tuned for spinning disks. On SSD or cloud block storage around 1.1 to 1.5 makes index scans appear at their true cost.
- `CREATE STATISTICS` captures correlation between columns (functional dependencies, n-distinct, MCV lists) that single-column stats miss.
- Parallelism: `max_parallel_workers_per_gather`, `max_parallel_workers`, `max_worker_processes`. Parallel plans help large scans and aggregates, and hurt many small concurrent queries; check the plan for `Gather` and `Workers Launched`.

## WAL and checkpoints

Every change is logged before the data pages are written. Checkpoints flush dirty pages and bound crash recovery.

| Parameter | Effect |
|-----------|--------|
| `max_wal_size` | WAL volume allowed between checkpoints; too small forces frequent, spiky checkpoints |
| `checkpoint_timeout` | time-based trigger (default 5 min); lengthening it smooths I/O at the price of longer recovery |
| `checkpoint_completion_target` | fraction of the interval over which the flush is spread; 0.9 is the default in current releases |
| `wal_compression` | trims full-page-image volume, spending CPU |
| `synchronous_commit` | `on` waits for WAL flush; `off` risks losing the last moments of commits (never corrupts); can be set per transaction |
| `commit_delay` / `commit_siblings` | group-commit tuning, rarely worth it |

Diagnose: set `log_checkpoints = on`. Many "checkpoints requested" versus "timed" means `max_wal_size` is too small. Counters live in `pg_stat_bgwriter` (and `pg_stat_checkpointer` from PostgreSQL 17).

Spring note: a batch job that tolerates losing its last commits after a crash can run its own transactions with `SET LOCAL synchronous_commit = off`; keep it off for money movement.

## Connections

`max_connections` costs memory and snapshot-building time. Size it to what the server can run concurrently, not to the sum of application pool sizes; put a pooler in front for fan-in (pool sizing is the `connection-pool-tuner` skill).

## Logging for tuning

`log_min_duration_statement`, `log_lock_waits = on` (logs waits beyond `deadlock_timeout`), `log_temp_files`, `log_autovacuum_min_duration`.
