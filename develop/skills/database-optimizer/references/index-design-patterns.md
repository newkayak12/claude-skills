# Index Design Patterns

## Index Selection Methodology

### Identify Index Candidates

```sql
-- PostgreSQL: Find queries missing indexes
SELECT query, calls, total_exec_time, mean_exec_time
FROM pg_stat_statements
WHERE mean_exec_time > 100
ORDER BY total_exec_time DESC
LIMIT 20;

-- PostgreSQL: Find sequential scans on large tables
SELECT schemaname, tablename, seq_scan, seq_tup_read,
       idx_scan, seq_tup_read / seq_scan as avg_seq_tup_read
FROM pg_stat_user_tables
WHERE seq_scan > 0
  AND seq_tup_read / seq_scan > 10000
ORDER BY seq_tup_read DESC;

-- MySQL: Check table scans
SELECT * FROM sys.statements_with_full_table_scans
WHERE db = 'your_database'
ORDER BY exec_count DESC;
```

## B-Tree Indexes (Default)

### Single Column Indexes

```sql
-- Create index for WHERE clauses
CREATE INDEX idx_users_email ON users(email);

-- Create index for JOIN conditions
CREATE INDEX idx_orders_user_id ON orders(user_id);

-- Create index for ORDER BY
CREATE INDEX idx_products_price ON products(price);

-- Unique constraint as index
CREATE UNIQUE INDEX idx_users_username ON users(username);
```

### Multi-Column Indexes

```sql
-- Order matters: most selective column first
CREATE INDEX idx_orders_status_created
ON orders(status, created_at);

-- Good for queries:
-- WHERE status = 'pending'
-- WHERE status = 'pending' AND created_at > '2024-01-01'
-- WHERE status = 'pending' ORDER BY created_at

-- NOT good for:
-- WHERE created_at > '2024-01-01' (status not specified)

-- Include commonly queried columns
CREATE INDEX idx_users_active_email_name
ON users(active, email) INCLUDE (name);
```

### Column Order Guidelines

```sql
-- Rule 1: Equality before range
CREATE INDEX idx_events_type_timestamp
ON events(type, timestamp);  -- type = 'click' AND timestamp > ...

-- Rule 2: High selectivity first
CREATE INDEX idx_orders_user_status
ON orders(user_id, status);  -- user_id is more selective than status

-- Rule 3: Match query patterns
-- Query: WHERE country = 'US' AND city = 'NYC' AND zip = '10001'
CREATE INDEX idx_locations_country_city_zip
ON locations(country, city, zip);
```

## Covering Indexes

### PostgreSQL INCLUDE Clause

```sql
-- Include non-key columns for index-only scans
CREATE INDEX idx_users_email_covering
ON users(email) INCLUDE (name, created_at);

-- Query can be satisfied entirely from index
EXPLAIN (ANALYZE, BUFFERS)
SELECT name, created_at
FROM users
WHERE email = 'user@example.com';
-- Should show "Index Only Scan"
```

### MySQL Covering Indexes

```sql
-- MySQL: Add columns to end of index
CREATE INDEX idx_orders_user_covering
ON orders(user_id, status, created_at, total);

-- Query uses covering index
EXPLAIN
SELECT status, created_at, total
FROM orders
WHERE user_id = 123;
-- Should show "Using index" in Extra column
```

## Partial Indexes

### PostgreSQL Partial Indexes

```sql
-- Index only active users
CREATE INDEX idx_users_active_email
ON users(email)
WHERE active = true;

-- Index only recent orders
CREATE INDEX idx_orders_recent
ON orders(user_id, created_at)
WHERE created_at > NOW() - INTERVAL '30 days';

-- Index only pending/processing orders (ignore completed)
CREATE INDEX idx_orders_active
ON orders(status, user_id)
WHERE status IN ('pending', 'processing');

-- Smaller index = better performance + less storage
```

### MySQL Filtered Indexes (8.0+)

```sql
-- MySQL 8.0+ supports functional indexes for similar effect
CREATE INDEX idx_users_active
ON users((CASE WHEN active = 1 THEN email END));
```

## Expression Indexes

### PostgreSQL Function Indexes

```sql
-- Index for case-insensitive search
CREATE INDEX idx_users_email_lower
ON users(LOWER(email));

-- Query must match expression
SELECT * FROM users
WHERE LOWER(email) = LOWER('User@Example.com');

-- Index for JSONB queries
CREATE INDEX idx_users_settings_theme
ON users((settings->>'theme'));

SELECT * FROM users
WHERE settings->>'theme' = 'dark';

-- Index for date truncation
CREATE INDEX idx_orders_date
ON orders(DATE(created_at));
```

### MySQL Generated Column Indexes

```sql
-- Create generated column, then index it
ALTER TABLE users
ADD COLUMN email_lower VARCHAR(255)
GENERATED ALWAYS AS (LOWER(email)) STORED;

CREATE INDEX idx_users_email_lower
ON users(email_lower);

-- Use in queries
SELECT * FROM users
WHERE email_lower = LOWER('User@Example.com');
```

## Specialized Index Types

### PostgreSQL GIN Indexes (Full-Text, Arrays, JSONB)

```sql
-- Full-text search
CREATE INDEX idx_posts_search
ON posts USING GIN(to_tsvector('english', title || ' ' || content));

SELECT * FROM posts
WHERE to_tsvector('english', title || ' ' || content)
      @@ to_tsquery('english', 'database & optimization');

-- Array search
CREATE INDEX idx_products_tags
ON products USING GIN(tags);

SELECT * FROM products
WHERE tags @> ARRAY['electronics', 'sale'];

-- JSONB search
CREATE INDEX idx_users_metadata
ON users USING GIN(metadata);

SELECT * FROM users
WHERE metadata @> '{"plan": "premium"}';
```

### PostgreSQL GiST Indexes (Geometric, Range)

```sql
-- Range types
CREATE INDEX idx_events_time_range
ON events USING GIST(time_range);

SELECT * FROM events
WHERE time_range && '[2024-01-01, 2024-01-31]'::tstzrange;

-- PostGIS geometric queries
CREATE INDEX idx_locations_coords
ON locations USING GIST(coordinates);
```

### MySQL Full-Text Indexes

```sql
-- Full-text search
CREATE FULLTEXT INDEX idx_posts_content
ON posts(title, content);

SELECT * FROM posts
WHERE MATCH(title, content)
      AGAINST('database optimization' IN NATURAL LANGUAGE MODE);

-- Boolean mode for complex searches
SELECT * FROM posts
WHERE MATCH(title, content)
      AGAINST('+database -mysql' IN BOOLEAN MODE);
```
