# Window Functions

A window function computes over a set of rows related to the current row **without collapsing them**. General form: `fn(...) OVER (PARTITION BY ... ORDER BY ... frame)`.

Evaluation order matters: windows run after `WHERE`, `GROUP BY` and `HAVING`, so they cannot appear in `WHERE`. To filter on a window result, compute it in a CTE or subquery and filter outside.

## Ranking

| Function | Ties | Gaps after ties |
|----------|------|-----------------|
| `ROW_NUMBER()` | arbitrary but unique numbering | n/a |
| `RANK()` | same rank | yes (1,1,3) |
| `DENSE_RANK()` | same rank | no (1,1,2) |
| `NTILE(n)` | splits into n buckets | n/a |
| `PERCENT_RANK()`, `CUME_DIST()` | relative position 0..1 | n/a |

With a non-unique `ORDER BY`, `ROW_NUMBER` can assign numbers differently between runs. Append a unique tiebreaker like `ORDER BY created_at DESC, id ASC` when results are stored or paginated.

Deduplicate keeping the newest row per key:

```sql
SELECT * FROM (
    SELECT e.*, ROW_NUMBER() OVER (PARTITION BY email ORDER BY updated_at DESC, id DESC) AS rn
    FROM subscriber e
) x WHERE rn = 1;
```

## Navigation

- `LAG(col, n, default)` / `LEAD(col, n, default)` read a row n positions before/after within the partition; the first/last rows yield the default (NULL if omitted).
- `FIRST_VALUE`, `LAST_VALUE`, `NTH_VALUE` read by frame position.

```sql
SELECT day, revenue,
       revenue - LAG(revenue) OVER (ORDER BY day) AS delta,
       ROUND(100.0 * (revenue - LAG(revenue) OVER (ORDER BY day))
             / NULLIF(LAG(revenue) OVER (ORDER BY day), 0), 1) AS pct
FROM daily_revenue;
```

## Frames

Aggregates and `FIRST/LAST/NTH_VALUE` honour a frame: `{ROWS | RANGE | GROUPS} BETWEEN start AND end`.

- `ROWS` counts physical rows. `RANGE` includes all peers (rows with equal ORDER BY value) and allows value offsets such as `INTERVAL '7 days' PRECEDING` where supported. `GROUPS` counts peer groups (PostgreSQL 11+).
- **Default frame** with `ORDER BY` is `RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW`; without `ORDER BY` it is the whole partition.
- Pitfall: `LAST_VALUE(x) OVER (ORDER BY d)` yields the current row's value (or that of its peers), never the partition's final one. State the frame explicitly: `ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING`.
- Running totals: use `ROWS UNBOUNDED PRECEDING`. It is deterministic with duplicate dates and cheaper than the `RANGE` default in several engines.

```sql
SELECT day,
       SUM(revenue) OVER (ORDER BY day ROWS UNBOUNDED PRECEDING) AS running,
       AVG(revenue) OVER (ORDER BY day ROWS 6 PRECEDING)         AS ma7
FROM daily_revenue;
```

Share one definition through a named `WINDOW` clause. Supported in PostgreSQL, MySQL 8.0+, SQLite 3.28+ and SQL Server 2022 (compatibility level 160); on other engines, repeat the `OVER (...)` spec:

```sql
SELECT day, SUM(revenue) OVER w, AVG(revenue) OVER w
FROM daily_revenue
WINDOW w AS (ORDER BY day ROWS BETWEEN 2 PRECEDING AND CURRENT ROW);
```

## Recipes

**Share of total**: `amount / SUM(amount) OVER (PARTITION BY region)`.

**Gaps and islands** (consecutive runs): subtract a row number from the value; rows in one run share the difference.

```sql
SELECT user_id, MIN(day) AS from_day, MAX(day) AS to_day, COUNT(*) AS streak
FROM (
    SELECT user_id, day,
           day - (ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY day))::int AS grp
    FROM login_day
) t
GROUP BY user_id, grp;
```
(PostgreSQL: `date - integer` yields a date. Elsewhere use `DATEADD` / `DATE_SUB`.)

**Sessionization**: flag a new session when `day - LAG(day) > threshold`, then `SUM(flag) OVER (ORDER BY day)` yields session ids.

**Conditional running count**: `SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) OVER (PARTITION BY job ORDER BY run_at, id ROWS UNBOUNDED PRECEDING)`.

## Cost Notes

- Each distinct `PARTITION BY / ORDER BY` pair usually needs its own sort. Share one ordering across several functions when you can.
- An index matching `(partition cols, order cols)` can let the engine skip the sort.
- Filter rows before the window step when semantics allow; windows run over everything that reaches them.
- For "latest row per group" on a large table, compare against `DISTINCT ON` (PostgreSQL) or a lateral/apply top-1 lookup; with a suitable index these can beat a full-table window.
