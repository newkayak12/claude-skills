# Query Patterns

Examples use an `orders` / `customers` / `order_items` shop schema unless noted.

## CTEs

A CTE names an intermediate result so a query reads top to bottom. Use it to split a report into stages (filter, aggregate, rank), not as a performance device.

```sql
WITH monthly AS (
    SELECT customer_id, date_trunc('month', placed_at) AS month, SUM(total) AS spend
    FROM orders
    WHERE status = 'PAID'
    GROUP BY customer_id, date_trunc('month', placed_at)
),
best AS (
    SELECT *, RANK() OVER (PARTITION BY month ORDER BY spend DESC) AS pos
    FROM monthly
)
SELECT * FROM best WHERE pos <= 3;
```

- PostgreSQL 12+ inlines a CTE that is referenced once and has no side effects; `AS MATERIALIZED` / `AS NOT MATERIALIZED` overrides that. Before 12 every CTE was an optimization fence.
- MySQL supports CTEs from 8.0. SQL Server requires the statement before `WITH` to end with `;`.
- A CTE referenced several times may be computed several times (engine-dependent). Check the plan before assuming it is reused.

## Recursive CTEs

Shape: anchor member, `UNION ALL`, recursive member that joins back to the CTE.

```sql
WITH RECURSIVE subtree AS (
    SELECT id, parent_id, name, 0 AS depth, ARRAY[id] AS path
    FROM category WHERE id = :root
    UNION ALL
    SELECT c.id, c.parent_id, c.name, s.depth + 1, s.path || c.id
    FROM category c
    JOIN subtree s ON c.parent_id = s.id
    WHERE NOT c.id = ANY (s.path)      -- cycle guard (PostgreSQL array syntax)
)
SELECT * FROM subtree ORDER BY path;
```

- Keyword: PostgreSQL and MySQL write `WITH RECURSIVE`; SQL Server and Oracle write plain `WITH`.
- Termination: carry a depth counter or visited path. Engine ceilings differ: MySQL `cte_max_recursion_depth` (default 1000), SQL Server `OPTION (MAXRECURSION n)` (default 100).
- Typical uses: org charts, category trees, bill of materials, generating date series.

## Join Patterns

- **Existence**: `WHERE EXISTS (SELECT 1 FROM ...)` stops at the first match and never multiplies rows. Prefer it to `COUNT(*) > 0` and to `IN` with a join that can duplicate.
- **Absence**: `NOT EXISTS`, or `LEFT JOIN ... WHERE right.key IS NULL`. Avoid `NOT IN (subquery)`: a single NULL in the subquery makes the whole predicate unknown and returns no rows.
- **Top-N per group**: `LATERAL` (PostgreSQL, MySQL 8.0.14+) or `CROSS/OUTER APPLY` (SQL Server, Oracle 12c+) lets the right side reference the left row.

```sql
SELECT c.id, last3.*
FROM customers c
CROSS JOIN LATERAL (
    SELECT o.id, o.placed_at FROM orders o
    WHERE o.customer_id = c.id
    ORDER BY o.placed_at DESC LIMIT 3
) last3;
```

- Filters on the outer-joined table belong in `ON`; in `WHERE` they silently turn a LEFT JOIN into an inner join.
- Joining two one-to-many branches (orders and refunds, both per customer) multiplies rows. Aggregate each branch in a subquery first, then join.

## Subquery Rewrites

| Smell | Rewrite |
|-------|---------|
| Scalar subquery in SELECT per row | Pre-aggregate and LEFT JOIN, or use a window function |
| `IN (SELECT ...)` over large set | `EXISTS` |
| `DISTINCT` hiding a duplicating join | Switch to a semi-join (`EXISTS`) |
| Same subquery repeated | Name it once in a CTE |
| `OR` across different columns | `UNION ALL` of two index-friendly branches (make them disjoint) |

## Pivoting

Portable form is conditional aggregation:

```sql
SELECT product_id,
       SUM(CASE WHEN EXTRACT(QUARTER FROM placed_at) = 1 THEN qty ELSE 0 END) AS q1,
       SUM(CASE WHEN EXTRACT(QUARTER FROM placed_at) = 2 THEN qty ELSE 0 END) AS q2
FROM order_items JOIN orders ON orders.id = order_items.order_id
GROUP BY product_id;
```

PostgreSQL also offers `SUM(qty) FILTER (WHERE ...)`. SQL Server and Oracle have a `PIVOT` clause, but its column list is static. Unpivot with `CROSS JOIN LATERAL (VALUES ...)` in PostgreSQL or `CROSS APPLY (VALUES ...)` in SQL Server.

## Set Operations

- `UNION ALL` keeps duplicates and skips the sort/hash; use `UNION` only when deduplication is required.
- `INTERSECT` and `EXCEPT` are standard (Oracle spells the latter `MINUS`; MySQL added both in 8.0.31). Column count and compatible types must match.

## Pagination Shape

Deep `OFFSET` reads and discards every skipped row. For feeds, use keyset pagination with a unique tiebreaker:

```sql
SELECT id, placed_at FROM orders
WHERE (placed_at, id) < (:last_placed_at, :last_id)
ORDER BY placed_at DESC, id DESC
LIMIT 50;
```

Row-value comparison works in PostgreSQL and MySQL; in SQL Server expand it into `placed_at < x OR (placed_at = x AND id < y)`.
