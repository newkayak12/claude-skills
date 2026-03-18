# PostgreSQL Memory & WAL Tuning

## Memory Configuration

### Shared Buffers

```sql
-- Recommended: 25% of system RAM (up to 40% for dedicated DB server)
-- For 16GB RAM server:
ALTER SYSTEM SET shared_buffers = '4GB';

-- Check current setting
SHOW shared_buffers;

-- Monitor buffer hit ratio (target: >99%)
SELECT
    sum(heap_blks_read) as heap_read,
    sum(heap_blks_hit) as heap_hit,
    round(sum(heap_blks_hit) / nullif(sum(heap_blks_hit) + sum(heap_blks_read), 0) * 100, 2) as cache_hit_ratio
FROM pg_statio_user_tables;
```

### Work Memory

```sql
-- Per-operation memory for sorting/hashing
-- Recommended: (Total RAM * 0.25) / max_connections
-- For 16GB RAM, 100 connections: ~40MB
ALTER SYSTEM SET work_mem = '40MB';

-- Monitor sorts
SELECT
    query,
    calls,
    total_exec_time,
    mean_exec_time,
    min_exec_time,
    max_exec_time
FROM pg_stat_statements
WHERE query LIKE '%ORDER BY%' OR query LIKE '%GROUP BY%'
ORDER BY total_exec_time DESC
LIMIT 10;

-- Set per-session for large operations
SET work_mem = '256MB';
SELECT ... ORDER BY ... LIMIT 1000;
RESET work_mem;
```

### Maintenance Work Memory

```sql
-- For VACUUM, CREATE INDEX, ALTER TABLE
-- Recommended: 1-2GB for production systems
ALTER SYSTEM SET maintenance_work_mem = '2GB';

-- Autovacuum workers use proportional amount
ALTER SYSTEM SET autovacuum_work_mem = '512MB';
```

### Effective Cache Size

```sql
-- Planner hint for available OS cache
-- Recommended: 50-75% of total RAM
-- For 16GB RAM:
ALTER SYSTEM SET effective_cache_size = '12GB';
```

## Query Planner Settings

### Statistics Target

```sql
-- Default is 100, increase for better estimates on complex queries
ALTER SYSTEM SET default_statistics_target = 200;

-- Per-column statistics for specific columns
ALTER TABLE users ALTER COLUMN email SET STATISTICS 500;

-- Force statistics update
ANALYZE users;

-- Check statistics quality
SELECT
    schemaname, tablename, attname,
    n_distinct, correlation
FROM pg_stats
WHERE tablename = 'users';
```

### Parallel Query Configuration

```sql
-- Enable parallel queries
ALTER SYSTEM SET max_parallel_workers_per_gather = 4;
ALTER SYSTEM SET max_parallel_workers = 8;
ALTER SYSTEM SET parallel_setup_cost = 100;
ALTER SYSTEM SET parallel_tuple_cost = 0.01;

-- Minimum rows to consider parallel execution
ALTER SYSTEM SET min_parallel_table_scan_size = '8MB';
ALTER SYSTEM SET min_parallel_index_scan_size = '512kB';

-- Check if query uses parallel execution
EXPLAIN (ANALYZE, BUFFERS)
SELECT COUNT(*) FROM large_table WHERE condition = 'value';
-- Look for "Parallel Seq Scan" or "Gather" nodes
```

### Join and Scan Methods

```sql
-- Enable all join methods (usually all enabled by default)
ALTER SYSTEM SET enable_hashjoin = on;
ALTER SYSTEM SET enable_mergejoin = on;
ALTER SYSTEM SET enable_nestloop = on;

-- Cost parameters (adjust based on hardware)
ALTER SYSTEM SET random_page_cost = 1.1;  -- For SSD (default 4.0 is for HDD)
ALTER SYSTEM SET seq_page_cost = 1.0;

-- Disable methods for testing (don't do in production)
SET enable_seqscan = off;  -- Force index usage for testing
```

## Write Performance & WAL Configuration

### WAL Settings

```sql
-- WAL write strategy
ALTER SYSTEM SET wal_buffers = '16MB';
ALTER SYSTEM SET wal_writer_delay = '200ms';

-- Checkpoint configuration
ALTER SYSTEM SET checkpoint_completion_target = 0.9;
ALTER SYSTEM SET max_wal_size = '2GB';
ALTER SYSTEM SET min_wal_size = '1GB';

-- Monitor checkpoints
SELECT
    checkpoints_timed,
    checkpoints_req,
    checkpoint_write_time,
    checkpoint_sync_time,
    buffers_checkpoint,
    buffers_clean,
    buffers_backend
FROM pg_stat_bgwriter;

-- Too many requested checkpoints = increase max_wal_size
```

### Commit Delays

```sql
-- Group commits (trade latency for throughput)
ALTER SYSTEM SET commit_delay = 10000;  -- 10ms
ALTER SYSTEM SET commit_siblings = 5;

-- Asynchronous commit (trade durability for speed)
-- Use cautiously - risk losing recent commits on crash
ALTER SYSTEM SET synchronous_commit = 'off';

-- Or per-transaction
BEGIN;
SET LOCAL synchronous_commit = 'off';
INSERT INTO logs (...) VALUES (...);
COMMIT;
```

## Configuration File Example

```ini
# postgresql.conf - Production optimized for 16GB RAM server

# Memory
shared_buffers = 4GB
effective_cache_size = 12GB
work_mem = 40MB
maintenance_work_mem = 2GB

# WAL
wal_buffers = 16MB
checkpoint_completion_target = 0.9
max_wal_size = 2GB

# Query Planner
default_statistics_target = 200
random_page_cost = 1.1  # SSD
effective_io_concurrency = 200  # SSD

# Parallel Queries
max_parallel_workers_per_gather = 4
max_parallel_workers = 8

# Connections
max_connections = 200

# Logging
log_min_duration_statement = 1000  # Log queries > 1s
log_line_prefix = '%t [%p]: [%l-1] user=%u,db=%d,app=%a,client=%h '
log_checkpoints = on
log_lock_waits = on
```
