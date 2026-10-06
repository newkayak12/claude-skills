# PostgreSQL Observation Queries

Run these before and after each change. Counters accumulate, so subtract two samples (or reset with `pg_stat_reset()` if that is acceptable).

## Enable statement statistics

```
shared_preload_libraries = 'pg_stat_statements'   # restart required
```
then `CREATE EXTENSION pg_stat_statements;` in the database.

```sql
SELECT left(query, 80) AS q, calls,
       round(total_exec_time::numeric, 0) AS total_ms,
       round((total_exec_time / calls)::numeric, 2) AS avg_ms,
       rows, shared_blks_hit, shared_blks_read
FROM pg_stat_statements
ORDER BY total_exec_time DESC
FETCH FIRST 15 ROWS ONLY;
```

Rank by total time to find what costs the system most, by mean time to find individually slow statements. Column names above are for PostgreSQL 13+ (older releases use `total_time`/`mean_time`).

## Sessions and waits

```sql
SELECT count(*) AS sessions, state, wait_event_type
FROM pg_stat_activity
WHERE backend_type = 'client backend'
GROUP BY state, wait_event_type
ORDER BY sessions DESC;
```

Many `idle in transaction` means application code holds transactions open (a Spring `@Transactional` method calling a remote service is the usual cause). Many `Lock` waits: see blockers in `postgresql-vacuum-locking.md`. Oldest transactions:

```sql
SELECT pid, now() - xact_start AS age, state, left(query, 60)
FROM pg_stat_activity WHERE xact_start IS NOT NULL ORDER BY age DESC LIMIT 10;
```

## Cache and I/O

```sql
SELECT datname,
       blks_hit::float8 / nullif(blks_hit + blks_read, 0) AS hit_ratio,
       xact_commit, xact_rollback, deadlocks, temp_files, temp_bytes
FROM pg_stat_database
WHERE datname = current_database();
```

Hit ratio near 99% is normal for OLTP; a low figure on a scan-heavy reporting database may be fine. `temp_files` growing means sorts and hashes spill (`work_mem`).

## Tables and indexes

```sql
-- sequential scans on big tables
SELECT relname, seq_scan, seq_tup_read, idx_scan, n_live_tup
FROM pg_stat_user_tables ORDER BY seq_tup_read DESC LIMIT 15;

-- indexes never used since the last stats reset
SELECT relname, indexrelname,
       pg_size_pretty(pg_relation_size(indexrelid)) AS idx_size
FROM pg_stat_user_indexes
WHERE idx_scan = 0
ORDER BY pg_relation_size(indexrelid) DESC;

-- biggest relations
SELECT relname, pg_size_pretty(pg_total_relation_size(oid))
FROM pg_class WHERE relkind = 'r' ORDER BY pg_total_relation_size(oid) DESC LIMIT 15;
```

## Replication

On the primary, `pg_stat_replication` shows `write_lag`, `flush_lag`, `replay_lag` per standby; on a standby, `now() - pg_last_xact_replay_timestamp()` approximates delay.

## Alert candidates

| Watch | Raise an alert when |
|-------|---------------------|
| connections in use vs `max_connections` | sustained above 80% |
| oldest transaction age | beyond the longest legitimate job |
| dead tuple ratio, `last_autovacuum` age | rising with no recent vacuum |
| `age(datfrozenxid)` | warn only when it is well above `autovacuum_freeze_max_age` (e.g. around 1 billion) or `datfrozenxid` stops advancing; nearing the setting itself is normal and triggers autovacuum |
| replication replay lag | beyond the application's staleness budget |
| deadlocks counter | any increase |
| checkpoints requested vs timed | requested dominating |

Thresholds are starting points: set them from your own baseline.
