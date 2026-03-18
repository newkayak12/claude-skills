# MySQL Monitoring & Analysis

## Performance Schema Queries

```sql
-- Top statements by total latency
SELECT
    DIGEST_TEXT as query,
    COUNT_STAR as exec_count,
    ROUND(AVG_TIMER_WAIT / 1000000000000, 3) as avg_sec,
    ROUND(SUM_TIMER_WAIT / 1000000000000, 3) as total_sec,
    ROUND(MAX_TIMER_WAIT / 1000000000000, 3) as max_sec,
    ROUND((SUM_TIMER_WAIT / SUM(SUM_TIMER_WAIT) OVER ()) * 100, 2) as pct_total
FROM performance_schema.events_statements_summary_by_digest
WHERE SCHEMA_NAME NOT IN ('performance_schema', 'mysql', 'sys')
ORDER BY SUM_TIMER_WAIT DESC
LIMIT 20;

-- Statements with full table scans
SELECT
    OBJECT_SCHEMA as db,
    OBJECT_NAME as tbl,
    COUNT_STAR as exec_count,
    SUM_NO_INDEX_USED as full_scans,
    SUM_NO_GOOD_INDEX_USED as bad_index
FROM performance_schema.table_io_waits_summary_by_index_usage
WHERE INDEX_NAME IS NULL
  AND OBJECT_SCHEMA NOT IN ('performance_schema', 'mysql', 'sys')
  AND COUNT_STAR > 0
ORDER BY SUM_NO_INDEX_USED DESC;

-- Table I/O statistics
SELECT
    OBJECT_SCHEMA,
    OBJECT_NAME,
    COUNT_READ,
    COUNT_WRITE,
    COUNT_FETCH,
    COUNT_INSERT,
    COUNT_UPDATE,
    COUNT_DELETE,
    ROUND(SUM_TIMER_WAIT / 1000000000000, 3) as total_latency_sec
FROM performance_schema.table_io_waits_summary_by_table
WHERE OBJECT_SCHEMA NOT IN ('performance_schema', 'mysql', 'sys')
ORDER BY SUM_TIMER_WAIT DESC
LIMIT 20;
```

## InnoDB Status Monitoring

```sql
-- InnoDB buffer pool status
SELECT
    POOL_ID,
    POOL_SIZE,
    FREE_BUFFERS,
    DATABASE_PAGES,
    OLD_DATABASE_PAGES,
    MODIFIED_DATABASE_PAGES,
    PENDING_DECOMPRESS,
    PENDING_READS,
    PENDING_FLUSH_LRU,
    PENDING_FLUSH_LIST
FROM information_schema.INNODB_BUFFER_POOL_STATS;

-- InnoDB lock waits
SELECT
    r.trx_id as waiting_trx,
    r.trx_mysql_thread_id as waiting_thread,
    r.trx_query as waiting_query,
    b.trx_id as blocking_trx,
    b.trx_mysql_thread_id as blocking_thread,
    b.trx_query as blocking_query
FROM information_schema.innodb_lock_waits w
INNER JOIN information_schema.innodb_trx b ON b.trx_id = w.blocking_trx_id
INNER JOIN information_schema.innodb_trx r ON r.trx_id = w.requesting_trx_id;

-- Long-running transactions
SELECT
    trx_id,
    trx_state,
    trx_started,
    TIMESTAMPDIFF(SECOND, trx_started, NOW()) as duration_sec,
    trx_requested_lock_id,
    trx_mysql_thread_id,
    trx_query
FROM information_schema.innodb_trx
WHERE TIMESTAMPDIFF(SECOND, trx_started, NOW()) > 60
ORDER BY trx_started;
```

## Connection and Process Monitoring

```sql
-- Current connections by state
SELECT
    command,
    state,
    COUNT(*) as connections,
    MAX(time) as max_time_sec
FROM information_schema.processlist
GROUP BY command, state
ORDER BY connections DESC;

-- Long-running queries
SELECT
    id,
    user,
    host,
    db,
    command,
    time,
    state,
    LEFT(info, 100) as query
FROM information_schema.processlist
WHERE command != 'Sleep'
  AND time > 10
ORDER BY time DESC;

-- Connection usage
SHOW STATUS LIKE 'Threads_%';
SHOW STATUS LIKE 'Max_used_connections';
SHOW VARIABLES LIKE 'max_connections';
```

## System Status Variables

```sql
-- Key buffer efficiency (MyISAM)
SHOW STATUS LIKE 'Key_%';

-- InnoDB metrics
SHOW STATUS LIKE 'Innodb_buffer_pool_%';
SHOW STATUS LIKE 'Innodb_rows_%';
SHOW STATUS LIKE 'Innodb_data_%';

-- Table locks
SHOW STATUS LIKE 'Table_locks_%';

-- Temporary tables
SHOW STATUS LIKE 'Created_tmp_%';

-- Thread cache
SHOW STATUS LIKE 'Threads_%';
SHOW STATUS LIKE 'Connections';

-- Query cache (MySQL 5.7)
SHOW STATUS LIKE 'Qcache_%';
```

## Alert Thresholds

```sql
-- InnoDB buffer pool efficiency
SELECT
    ROUND((1 - (
        (SELECT VARIABLE_VALUE FROM performance_schema.global_status WHERE VARIABLE_NAME = 'Innodb_buffer_pool_reads') /
        (SELECT VARIABLE_VALUE FROM performance_schema.global_status WHERE VARIABLE_NAME = 'Innodb_buffer_pool_read_requests')
    )) * 100, 2) as buffer_pool_hit_ratio,
    CASE
        WHEN (1 - (
            (SELECT VARIABLE_VALUE FROM performance_schema.global_status WHERE VARIABLE_NAME = 'Innodb_buffer_pool_reads') /
            (SELECT VARIABLE_VALUE FROM performance_schema.global_status WHERE VARIABLE_NAME = 'Innodb_buffer_pool_read_requests')
        )) * 100 < 90 THEN 'CRITICAL'
        WHEN (1 - (
            (SELECT VARIABLE_VALUE FROM performance_schema.global_status WHERE VARIABLE_NAME = 'Innodb_buffer_pool_reads') /
            (SELECT VARIABLE_VALUE FROM performance_schema.global_status WHERE VARIABLE_NAME = 'Innodb_buffer_pool_read_requests')
        )) * 100 < 95 THEN 'WARNING'
        ELSE 'OK'
    END as status;

-- Replication lag (on replica)
SELECT
    Seconds_Behind_Master as lag_seconds,
    CASE
        WHEN Slave_IO_Running = 'No' OR Slave_SQL_Running = 'No' THEN 'CRITICAL - Replication stopped'
        WHEN Seconds_Behind_Master > 300 THEN 'CRITICAL'
        WHEN Seconds_Behind_Master > 60 THEN 'WARNING'
        ELSE 'OK'
    END as status
FROM (SHOW SLAVE STATUS) s;
```

## Overall Health Check

```sql
-- MySQL: Overall health
SELECT 'connections' as metric,
       (SELECT COUNT(*) FROM information_schema.processlist) as current,
       @@max_connections as max
UNION ALL
SELECT 'buffer_pool_hit_ratio',
       ROUND((1 - (
           (SELECT VARIABLE_VALUE FROM performance_schema.global_status WHERE VARIABLE_NAME = 'Innodb_buffer_pool_reads') /
           (SELECT VARIABLE_VALUE FROM performance_schema.global_status WHERE VARIABLE_NAME = 'Innodb_buffer_pool_read_requests')
       )) * 100, 2),
       95
UNION ALL
SELECT 'slow_queries',
       (SELECT VARIABLE_VALUE FROM performance_schema.global_status WHERE VARIABLE_NAME = 'Slow_queries'),
       NULL;

-- Database size
SELECT
    table_schema as database,
    ROUND(SUM(data_length + index_length) / 1024 / 1024, 2) as size_mb
FROM information_schema.tables
WHERE table_schema NOT IN ('information_schema', 'performance_schema', 'mysql', 'sys')
GROUP BY table_schema
ORDER BY size_mb DESC;
```

## Monitoring Best Practices

1. **Establish baselines** - Record normal performance metrics
2. **Track trends** - Monitor daily/weekly patterns
3. **Set thresholds** - Define warning and critical levels
4. **Automate alerts** - Use monitoring tools (Prometheus, Grafana, Datadog)
5. **Regular reviews** - Weekly performance analysis meetings
6. **Document changes** - Track configuration and schema modifications
7. **Capacity planning** - Monitor growth and forecast needs
8. **Test queries** - Validate optimizations in staging first
