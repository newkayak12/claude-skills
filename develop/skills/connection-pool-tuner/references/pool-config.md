# Pool Config Reference

## Sizing formula

```
pool_size = (core_count * 2) + effective_spindle_count
```

The result is the total across every app instance (and pgBouncer) hitting this DB; divide by instance count for
`maximumPoolSize`.

- `core_count`: physical CPU cores available to the DB server, not hyperthreads
- `effective_spindle_count`: 1 for SSD, 0 if data fits in RAM

4-core SSD server: `(4 * 2) + 1 = 9`, round to 10. A server handling 1000 concurrent requests needs about 10 DB
connections, the rest queue.

## HikariCP (Spring Boot)

```properties
spring.datasource.hikari.maximum-pool-size=10
spring.datasource.hikari.minimum-idle=5
spring.datasource.hikari.connection-timeout=30000       # ms: max wait for a pool connection
spring.datasource.hikari.idle-timeout=600000            # ms: idle connections live 10 min
spring.datasource.hikari.max-lifetime=1800000           # ms: max connection lifetime 30 min
spring.datasource.hikari.keepalive-time=60000           # ms: ping to survive firewall NAT
spring.datasource.hikari.leak-detection-threshold=60000 # ms: warn if connection held > 60s
```

Set `leak-detection-threshold` above the longest legitimate connection hold time (transaction, not single query). Expose `hikaricp.connections.*` metrics; alert on
`pending > 0` sustained. Target 60-80% utilization at peak.

## pgBouncer modes

| Mode | Behavior | Use case |
|------|----------|----------|
| `transaction` | Connection returned after each transaction; pgBouncer >=1.21 supports protocol-level prepared statements here via `max_prepared_statements` | Most web applications |
| `session` | Held for the whole client session | Temp tables, advisory locks, prepared statements |
| `statement` | Returned after each statement | Avoid: breaks multi-statement transactions |

## Common mistakes

- Pool size equals thread count: threads spend most time not waiting on the database
- `minimumIdle` far below `maximumPoolSize`: connections get created under load when latency matters
- `maxLifetime` not shorter than the firewall timeout: silent TCP drops, cryptic first-query errors
- Leak detection off in production: one missing `close()` eventually exhausts the pool
- One pool for all workloads: separate OLTP (short queries) from reporting (long queries)
