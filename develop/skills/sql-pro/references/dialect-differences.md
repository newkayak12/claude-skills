# Dialect Differences

Quick lookup for porting a query. PG = PostgreSQL, MY = MySQL (8.0 unless noted), MS = SQL Server, OR = Oracle. When the target version is unknown, ask and state the minimum version in the answer.

## Syntax Cheatsheet

| Need | PG | MY | MS | OR |
|------|----|----|----|----|
| Auto key | `GENERATED ... AS IDENTITY` (10+), `serial` legacy | `AUTO_INCREMENT` | `IDENTITY(1,1)` | identity (12c+), earlier sequence + trigger |
| Concatenate | `a \|\| b`, `concat()` | `CONCAT(a, b)` (`\|\|` is logical OR unless `PIPES_AS_CONCAT`) | `a + b`, `CONCAT` (2012+) | `a \|\| b` |
| First N rows | `LIMIT n` | `LIMIT n` | `TOP (n)` or `OFFSET/FETCH` | `FETCH FIRST n ROWS ONLY` (12c+) |
| Page | `LIMIT n OFFSET m` | `LIMIT n OFFSET m` | `ORDER BY ... OFFSET m ROWS FETCH NEXT n ROWS ONLY` (2012+, ORDER BY mandatory) | `OFFSET m ROWS FETCH NEXT n ROWS ONLY` (12c+) |
| Quote identifier | `"name"` | `` `name` `` | `[name]` | `"name"` |
| Current time | `now()`, `CURRENT_TIMESTAMP` | `NOW()` | `SYSDATETIME()`, `GETDATE()` | `SYSTIMESTAMP`, `CURRENT_TIMESTAMP` |
| Add 7 days | `d + INTERVAL '7 days'` | `DATE_ADD(d, INTERVAL 7 DAY)` | `DATEADD(day, 7, d)` | `d + 7` (DATE) or `d + INTERVAL '7' DAY` |
| Truncate to month | `date_trunc('month', d)` | `DATE_FORMAT(d, '%Y-%m-01')` | `DATETRUNC` (2022+) or `DATEFROMPARTS(YEAR(d), MONTH(d), 1)` | `TRUNC(d, 'MM')` |
| Null default | `COALESCE` | `COALESCE`, `IFNULL` | `COALESCE`, `ISNULL` | `COALESCE`, `NVL` |
| Boolean | `boolean` | `BOOLEAN` is an alias of `TINYINT(1)` | `BIT` | no SQL boolean column before 23ai; use `NUMBER(1)`/`CHAR(1)` |
| Recursive CTE | `WITH RECURSIVE` | `WITH RECURSIVE` | `WITH` | `WITH` (11gR2+) |

## Things That Bite When Porting

**Empty string.** Oracle stores `''` as NULL; the others keep them distinct. Any `col = ''` or `col IS NULL` logic must be revisited.

**Case sensitivity.** PostgreSQL and Oracle compare strings case-sensitively. MySQL and SQL Server follow the collation, and the common defaults (`utf8mb4_0900_ai_ci`, `SQL_Latin1_General_CP1_CI_AS`) are case-insensitive. For case-insensitive search in PostgreSQL use `ILIKE`, `lower()` with an expression index, or a nondeterministic ICU collation (12+).

**Upsert.**
```sql
-- PostgreSQL (9.5+)
INSERT INTO stock (sku, qty) VALUES (:sku, :n)
ON CONFLICT (sku) DO UPDATE SET qty = stock.qty + EXCLUDED.qty;

-- MySQL
INSERT INTO stock (sku, qty) VALUES (:sku, :n)
ON DUPLICATE KEY UPDATE qty = qty + VALUES(qty);   -- VALUES() deprecated in 8.0.20; row alias form preferred

-- SQL Server / Oracle
MERGE INTO stock t USING (SELECT :sku AS sku, :n AS qty) s ON (t.sku = s.sku)
WHEN MATCHED THEN UPDATE SET t.qty = t.qty + s.qty
WHEN NOT MATCHED THEN INSERT (sku, qty) VALUES (s.sku, s.qty);
```
SQL Server `MERGE` is prone to race conditions under concurrency; use `WITH (HOLDLOCK)` on the target or a guarded UPDATE-then-INSERT. PostgreSQL 15+ also supports `MERGE`, but `ON CONFLICT` is the atomic choice for key collisions.

**JSON.**
- PG: `json` (text preserved) and `jsonb` (binary, indexable). Operators `->`, `->>`, `@>`, `?`; GIN index for containment.
- MY: native `JSON` type; `->` and `->>` are shorthand for `JSON_EXTRACT` / unquoted; index via generated column or functional index.
- MS: JSON lives in `nvarchar`; read with `JSON_VALUE`, `JSON_QUERY`, `OPENJSON` (2016+).
- OR: `JSON_VALUE`, `JSON_TABLE` (12c+).

**Window frames.** All four support `ROWS`. `RANGE` with value offsets is not available everywhere (SQL Server accepts only `UNBOUNDED`/`CURRENT ROW` bounds); `GROUPS` is PostgreSQL 11+. Window functions need MySQL 8.0 and SQL Server 2012+ for frames and `LAG/LEAD`.

**Set operators.** Oracle `MINUS` equals `EXCEPT` elsewhere. MySQL has `INTERSECT`/`EXCEPT` from 8.0.31 only.

**Locking reads.** `SELECT ... FOR UPDATE [SKIP LOCKED | NOWAIT]`: PG, MY 8.0+, OR. SQL Server uses table hints (`WITH (UPDLOCK, READPAST)`).

**Transactional DDL.** PostgreSQL and SQL Server roll DDL back; MySQL and Oracle implicitly commit around DDL. This changes how you write migrations.

**Isolation defaults.** PG and Oracle default to READ COMMITTED (Oracle's is snapshot-style per statement), MySQL InnoDB to REPEATABLE READ, SQL Server to READ COMMITTED (locking unless RCSI is enabled).

## Type Mapping

| Concept | PG | MY | MS | OR |
|---------|----|----|----|----|
| 64-bit int | `bigint` | `BIGINT` | `bigint` | `NUMBER(19)` |
| Exact decimal | `numeric(p,s)` | `DECIMAL(p,s)` | `decimal(p,s)` | `NUMBER(p,s)` |
| Variable text | `text`, `varchar(n)` | `VARCHAR(n)`, `TEXT` | `nvarchar(n/max)` | `VARCHAR2(n)`, `CLOB` |
| Instant | `timestamptz` | `DATETIME` (store UTC) or `TIMESTAMP` | `datetimeoffset` / `datetime2` | `TIMESTAMP WITH TIME ZONE` |
| UUID | `uuid` | `BINARY(16)` / `CHAR(36)` | `uniqueidentifier` | `RAW(16)` |
| Binary | `bytea` | `BLOB` | `varbinary(max)` | `BLOB` |

## Engine-Specific Performance Notes

- **PG**: partial and expression indexes, `DISTINCT ON`, `jsonb` GIN, tune `work_mem` and autovacuum, watch `idle in transaction` sessions.
- **MY**: InnoDB primary key is the clustered index and is appended to every secondary index, so keep it narrow; avoid functions on indexed columns (functional indexes since 8.0.13); prefer `utf8mb4`.
- **MS**: parameter sniffing can pin a bad plan; clustered vs nonclustered choice matters; `INCLUDE` columns for covering; Query Store for regressions.
- **OR**: bind variables to avoid hard parsing; check statistics gathering and plan stability.

## Migration Checklist

1. List the vendor-specific constructs in the query (functions, `TOP`, `ISNULL`, hints, identifier quoting).
2. Map types, especially timestamps with time zones, booleans and text lengths.
3. Re-check NULL, empty-string, ordering (default NULL position differs) and collation behaviour.
4. Re-run the plan on the target engine; indexes and statistics do not transfer.
