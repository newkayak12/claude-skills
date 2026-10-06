# MySQL Observation Queries

## Statement digests (Performance Schema)

Timers are in picoseconds.

```sql
SELECT LEFT(DIGEST_TEXT, 80) AS q, COUNT_STAR AS calls,
       ROUND(SUM_TIMER_WAIT/1e12, 2) AS total_s,
       ROUND(AVG_TIMER_WAIT/1e9, 2)  AS avg_ms,
       SUM_ROWS_EXAMINED, SUM_ROWS_SENT,
       SUM_NO_INDEX_USED
FROM performance_schema.events_statements_summary_by_digest AS d
ORDER BY total_s DESC
LIMIT 10;
```

A high `SUM_ROWS_EXAMINED` to `SUM_ROWS_SENT` ratio flags statements scanning far more than they return. The `sys` schema offers readable views: `sys.statement_analysis`, `sys.statements_with_full_table_scans`, `sys.schema_unused_indexes`.

## Current activity and locks

```sql
SELECT id, user, command, time AS secs, LEFT(info, 60) AS stmt
FROM information_schema.processlist
WHERE command <> 'Sleep'
ORDER BY secs DESC;

SELECT * FROM sys.innodb_lock_waits;
```

`SHOW ENGINE INNODB STATUS` reports the latest deadlock, history list length (long-running transactions delay purge when it keeps growing), semaphore waits and buffer pool activity.

## Counters to sample

`Threads_connected`, `Threads_running`, `Max_used_connections`, `Created_tmp_disk_tables`, `Innodb_buffer_pool_wait_free`, `Innodb_row_lock_waits`, `Innodb_row_lock_time_avg`, `Slow_queries`, `Aborted_connects`. Take two samples and diff them; most are cumulative since start.

## Buffer pool effectiveness

```sql
SHOW GLOBAL STATUS LIKE 'Innodb_buffer_pool_read%';
```

Misses are `Innodb_buffer_pool_reads`; logical reads are `Innodb_buffer_pool_read_requests`.

## Sizes

```sql
SELECT table_name, ROUND((data_length + index_length)/1024/1024) AS mb
FROM information_schema.tables
WHERE table_schema = DATABASE()
ORDER BY mb DESC
LIMIT 15;
```

## Alert candidates

| Watch | Raise an alert when |
|-------|---------------------|
| `Threads_connected` / `max_connections` | sustained above 80% |
| `Threads_running` | well above core count for minutes |
| replica `Seconds_Behind_Source` | beyond the staleness budget |
| `Innodb_row_lock_time_avg` or lock waits | rising trend |
| history list length | growing without plateau |
| `Created_tmp_disk_tables` rate | rising |

Set thresholds from a measured baseline rather than copying numbers.
