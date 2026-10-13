# Worked Examples

### CTE: newest completed order per customer
```sql
WITH latest AS (
    SELECT
        customer_id,
        id AS order_pk,
        total_amount AS amount,
        ROW_NUMBER() OVER (
            PARTITION BY customer_id ORDER BY placed_at DESC, id DESC
        ) AS recency
    FROM orders WHERE status = 'completed'
)
SELECT customer_id, order_pk, amount
FROM latest
WHERE recency = 1;
```

### Window: running total and rank
```sql
SELECT
    store_id,
    sale_date,
    amount,
    SUM(amount) OVER (PARTITION BY store_id ORDER BY sale_date) AS cumulative,
    RANK()      OVER (PARTITION BY store_id ORDER BY amount DESC) AS amount_rank
FROM sales;
```

### Before / after: correlated subquery to join
```sql
-- BEFORE: correlated subquery runs once per order row
SELECT ord.id AS order_id,
       (SELECT SUM(ln.quantity) FROM order_lines ln WHERE ln.order_id = ord.id) AS qty_total
FROM orders ord;

-- AFTER: total each order's lines a single time, then join back
WITH line_totals AS (
    SELECT order_id, SUM(quantity) AS units_sold
    FROM order_lines
    GROUP BY order_id
)
SELECT ord.id AS order_id, COALESCE(lt.units_sold, 0) AS qty_total
FROM orders ord
LEFT JOIN line_totals lt ON lt.order_id = ord.id;
```

## Coding rules (apply to every query)

- Set-based statements over row-at-a-time loops; cursors only when no set-based form exists.
- Filter early, before joins where possible.
- Existence with `EXISTS`, not `COUNT`.
- NULLs handled explicitly (`COALESCE`, `IS NOT DISTINCT FROM`, anti-join traps with `NOT IN`).
- No `SELECT *` in production queries.
