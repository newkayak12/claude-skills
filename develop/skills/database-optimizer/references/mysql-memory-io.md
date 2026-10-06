# MySQL / InnoDB: Memory, I/O, Partitioning and Replication

Applies to MySQL 8.0 (notes where MariaDB or 5.7 differ are omitted). Managed services expose these through parameter groups.

## Memory

| Setting | Guidance |
|---------|----------|
| `innodb_buffer_pool_size` | largest single lever; on a dedicated host about 50-75% of RAM, leaving room for per-connection buffers and the OS. Resizable online. |
| `innodb_buffer_pool_instances` | split the pool to reduce mutex contention; only meaningful for pools of a few GB or more |
| `sort_buffer_size`, `join_buffer_size`, `read_rnd_buffer_size` | allocated per connection per use; keep modest and raise per session for a specific job |
| `tmp_table_size`, `max_heap_table_size` | in-memory temp table cap (the smaller of the two applies); beyond it the table goes to disk |
| `max_connections` | each connection costs memory; fix the application pool rather than inflating this |

The query cache was removed in 8.0; ignore advice that enables it.

Health check: `Innodb_buffer_pool_reads` (misses that hit disk) against `Innodb_buffer_pool_read_requests`; the miss fraction should be tiny once warm.

## Redo log, flushing and I/O

- `innodb_flush_log_at_trx_commit`: `1` flushes at every commit (durable); `2` writes to the OS and flushes about once a second; `0` flushes only about once a second. Pair `1` with `sync_binlog=1` where replicas or point-in-time recovery matter.
- Redo capacity: `innodb_redo_log_capacity` (8.0.30+) replaces `innodb_log_file_size` x files. Too small a redo log forces aggressive page flushing and write stalls.
- `innodb_flush_method=O_DIRECT` avoids double-buffering in the OS page cache on Linux.
- `innodb_io_capacity` and `innodb_io_capacity_max` tell background flushing how many IOPS the storage can sustain; set from the device, not the default.
- Spinning disks benefit from `innodb_flush_neighbors`; SSDs generally do not.
- `innodb_read_io_threads`, `innodb_write_io_threads`: defaults suit most hosts.

## Finding slow work

```
slow_query_log = ON
long_query_time = 0.5
log_queries_not_using_indexes = ON    # noisy; enable briefly
```

Aggregate with `pt-query-digest` if installed, or in Performance Schema (see `monitoring-mysql.md`). In the plan check `type: ALL`, `Using filesort`, `Using temporary`; table statistics refresh with `ANALYZE TABLE`. 8.0 also supports histograms (`ANALYZE TABLE t UPDATE HISTOGRAM ON col`) for skewed non-indexed columns.

## Index notes specific to InnoDB

- Rows are clustered by primary key; each secondary index entry stores the primary key, so a wide PK enlarges every index.
- Sequential PKs append; random UUIDs cause page splits.
- Invisible indexes (8.0) let you test dropping one; `sys.schema_unused_indexes` lists candidates.

## Partitioning

```sql
CREATE TABLE audit (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  occurred_at DATETIME NOT NULL,
  payload JSON,
  PRIMARY KEY (id, occurred_at)
) PARTITION BY RANGE (TO_DAYS(occurred_at)) (
  PARTITION p202610 VALUES LESS THAN (TO_DAYS('2026-11-01')),
  PARTITION p_rest VALUES LESS THAN MAXVALUE
);
```

- Every unique key, including the primary key, must contain the partition columns.
- InnoDB partitioned tables cannot have foreign keys, and cannot be referenced by them.
- Pruning requires the partition column in the `WHERE`; verify with `EXPLAIN` (`partitions` column).
- Retention: `ALTER TABLE ... DROP PARTITION` is near-instant, unlike a large `DELETE`.
- Add new partitions by `REORGANIZE PARTITION p_rest INTO (...)` before data lands in the catch-all.

## Replication

- Binary log: `binlog_format=ROW` is the default and safest; `binlog_expire_logs_seconds` bounds disk use.
- Lag check: `SHOW REPLICA STATUS` (`SHOW SLAVE STATUS` before 8.0.22), field `Seconds_Behind_Source`. Large transactions and single-threaded apply cause lag; enable multi-threaded applier (`replica_parallel_workers`) and break giant batch writes into smaller transactions.
- Do not route read-your-writes traffic to a lagging replica; Spring routing data sources should account for this.

## Table upkeep

`OPTIMIZE TABLE` rebuilds and reclaims space after mass deletes (locks briefly for the online path; large tables need a window or an online-schema-change tool). Page compression exists, but weigh CPU against I/O and measure.
