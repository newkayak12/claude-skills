# Index Maintenance & Anti-Patterns

## Index Maintenance

### PostgreSQL Maintenance

```sql
-- Update statistics for query planner
ANALYZE users;

-- Rebuild bloated index
REINDEX INDEX CONCURRENTLY idx_users_email;

-- Check index bloat
SELECT
    schemaname, tablename, indexname,
    pg_size_pretty(pg_relation_size(indexrelid)) as index_size,
    idx_scan as scans,
    idx_tup_read as tuples_read,
    idx_tup_fetch as tuples_fetched
FROM pg_stat_user_indexes
ORDER BY pg_relation_size(indexrelid) DESC;

-- Find unused indexes
SELECT
    schemaname, tablename, indexname,
    idx_scan,
    pg_size_pretty(pg_relation_size(indexrelid)) as index_size
FROM pg_stat_user_indexes
WHERE idx_scan = 0
  AND indexrelname NOT LIKE 'pg_toast%'
ORDER BY pg_relation_size(indexrelid) DESC;
```

### MySQL Maintenance

```sql
-- Update statistics
ANALYZE TABLE users;

-- Rebuild index
ALTER TABLE users DROP INDEX idx_users_email, ADD INDEX idx_users_email(email);

-- Check index usage
SELECT
    object_schema,
    object_name,
    index_name,
    count_star,
    count_read,
    count_fetch
FROM performance_schema.table_io_waits_summary_by_index_usage
WHERE object_schema = 'your_database'
ORDER BY count_star DESC;

-- Find unused indexes
SELECT
    object_schema,
    object_name,
    index_name
FROM performance_schema.table_io_waits_summary_by_index_usage
WHERE index_name IS NOT NULL
  AND count_star = 0
  AND object_schema = 'your_database';
```

## Index Anti-Patterns

| Anti-Pattern | Issue | Solution |
|-------------|-------|----------|
| Index every column | Write overhead, storage waste | Index based on query patterns |
| Redundant indexes | `(a)` + `(a,b)` | Keep only `(a,b)` |
| Wrong column order | `(created_at, user_id)` for `WHERE user_id = ?` | Put filtered columns first |
| Over-covering | Including rarely-used columns | Include only frequently accessed columns |
| Ignoring WHERE clause | Full index for 5% of data | Use partial indexes |
| Expression mismatch | Index `email`, query `LOWER(email)` | Create expression index |

## Index Design Checklist

1. **Analyze queries**: Use pg_stat_statements or slow query log
2. **Check execution plans**: Look for Seq Scan on large tables
3. **Design indexes**: Equality → Range → Include
4. **Create concurrently**: Avoid locking (PostgreSQL)
5. **Validate improvement**: Compare before/after EXPLAIN
6. **Monitor usage**: Remove unused indexes after 30 days
7. **Maintain regularly**: VACUUM, ANALYZE, REINDEX as needed
