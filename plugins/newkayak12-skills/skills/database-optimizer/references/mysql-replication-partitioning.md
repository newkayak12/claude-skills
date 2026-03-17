# MySQL Replication, Partitioning & Table Maintenance

## Partitioning

### Range Partitioning

```sql
-- Create partitioned table
CREATE TABLE events (
    id BIGINT NOT NULL AUTO_INCREMENT,
    event_type VARCHAR(50),
    created_at DATETIME NOT NULL,
    data JSON,
    PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (YEAR(created_at)) (
    PARTITION p2023 VALUES LESS THAN (2024),
    PARTITION p2024 VALUES LESS THAN (2025),
    PARTITION p2025 VALUES LESS THAN (2026),
    PARTITION pmax VALUES LESS THAN MAXVALUE
);

-- Query with partition pruning
EXPLAIN PARTITIONS
SELECT * FROM events
WHERE created_at >= '2024-01-01' AND created_at < '2024-02-01';
-- Should show "partitions: p2024"

-- Add new partition
ALTER TABLE events
ADD PARTITION (PARTITION p2026 VALUES LESS THAN (2027));

-- Drop old partition (fast delete)
ALTER TABLE events DROP PARTITION p2023;
```

### List Partitioning

```sql
-- Partition by discrete values
CREATE TABLE orders (
    id BIGINT NOT NULL AUTO_INCREMENT,
    user_id BIGINT,
    status VARCHAR(20),
    PRIMARY KEY (id, status)
) PARTITION BY LIST COLUMNS(status) (
    PARTITION p_pending VALUES IN ('pending', 'processing'),
    PARTITION p_completed VALUES IN ('completed', 'shipped'),
    PARTITION p_cancelled VALUES IN ('cancelled', 'refunded')
);
```

## Replication Optimization

### Binary Log Settings

```sql
-- Binary log format
SET GLOBAL binlog_format = 'ROW';  -- ROW, STATEMENT, or MIXED

-- Binary log cache size
SET GLOBAL binlog_cache_size = 1048576;  -- 1MB per transaction

-- Sync binary log (durability vs performance)
SET GLOBAL sync_binlog = 1;  -- Safest, sync after each commit
-- sync_binlog = 0  -- Fastest, let OS handle flushing

-- Expire binary logs after N days
SET GLOBAL binlog_expire_logs_seconds = 604800;  -- 7 days
```

### Replication Lag Monitoring

```sql
-- On replica: Check replication lag
SHOW SLAVE STATUS\G

-- Parse seconds behind master
SELECT
    IF(Slave_IO_Running = 'Yes' AND Slave_SQL_Running = 'Yes',
       Seconds_Behind_Master,
       NULL) as replication_lag_seconds
FROM (SHOW SLAVE STATUS) s;

-- Parallel replication (MySQL 8.0+)
SET GLOBAL slave_parallel_workers = 4;
SET GLOBAL slave_parallel_type = 'LOGICAL_CLOCK';
```

## Table Optimization

### Table Maintenance

```sql
-- Optimize table (rebuilds, reclaims space)
OPTIMIZE TABLE users;

-- Check table for errors
CHECK TABLE users;

-- Repair table if corrupted
REPAIR TABLE users;

-- Analyze table statistics
ANALYZE TABLE users;

-- Check fragmentation
SELECT
    table_schema,
    table_name,
    ROUND(data_length / 1024 / 1024, 2) as data_mb,
    ROUND(data_free / 1024 / 1024, 2) as free_mb,
    ROUND(data_free / data_length * 100, 2) as fragmentation_pct
FROM information_schema.tables
WHERE table_schema NOT IN ('mysql', 'information_schema', 'performance_schema', 'sys')
  AND data_free > 0
ORDER BY fragmentation_pct DESC;
```

### Table Compression

```sql
-- InnoDB compression (requires ROW_FORMAT=COMPRESSED)
CREATE TABLE compressed_logs (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    message TEXT,
    created_at DATETIME
) ROW_FORMAT=COMPRESSED KEY_BLOCK_SIZE=8;

-- Check compression ratio
SELECT
    table_schema,
    table_name,
    ROUND(data_length / 1024 / 1024, 2) as data_mb,
    ROUND(index_length / 1024 / 1024, 2) as index_mb,
    create_options
FROM information_schema.tables
WHERE row_format = 'Compressed';
```

## Configuration File Example

```ini
# my.cnf - Production optimized for 16GB RAM server

[mysqld]
# InnoDB Settings
innodb_buffer_pool_size = 12G
innodb_buffer_pool_instances = 8
innodb_log_file_size = 1G
innodb_log_buffer_size = 16M
innodb_flush_log_at_trx_commit = 1
innodb_flush_method = O_DIRECT
innodb_flush_neighbors = 0

# I/O Settings
innodb_read_io_threads = 8
innodb_write_io_threads = 8
innodb_io_capacity = 10000
innodb_io_capacity_max = 20000

# Connection Settings
max_connections = 200
thread_cache_size = 100

# Query Cache (MySQL 5.7)
# query_cache_type = 1
# query_cache_size = 64M

# Temporary Tables
tmp_table_size = 64M
max_heap_table_size = 64M

# Slow Query Log
slow_query_log = ON
long_query_time = 1
log_queries_not_using_indexes = ON

# Binary Log
binlog_format = ROW
sync_binlog = 1
binlog_expire_logs_seconds = 604800

# Performance Schema
performance_schema = ON

# Character Set
character_set_server = utf8mb4
collation_server = utf8mb4_unicode_ci
```
