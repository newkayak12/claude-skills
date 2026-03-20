---
name: connection-pool-tuner
description: 'Diagnoses and tunes database connection pools — resolves pool exhaustion, connection timeout errors, idle connection waste, and slow API responses under DB load. Use when an application shows intermittent DB connection failures, API latency that spikes under traffic, or someone is unsure how to size or configure a connection pool for their database setup.'
---

# Connection Pool Tuner

A connection pool sits between your application and the database, maintaining a set of pre-established connections that threads can borrow and return. Without a pool, every request opens and closes a TCP connection and authenticates — typically adding 20–100ms per query. With a misconfigured pool, you get timeouts, resource starvation, or idle connections consuming database memory for no benefit.

## The Fundamental Formula

The most cited formula for pool sizing comes from the PostgreSQL wiki (confirmed by extensive benchmarking):

```
pool_size = (core_count * 2) + effective_spindle_count
```

- `core_count`: number of CPU cores available to the database server
- `effective_spindle_count`: number of physical disk spindles (1 for SSD, 0 if data fits in RAM)

For a 4-core server with SSDs: `(4 * 2) + 1 = 9`. Round to 10.

**Why this works:** Database operations are I/O-bound. While one connection waits for disk, another can use the CPU. But beyond a certain pool size, connections compete for CPU and locks rather than enabling parallelism — throughput drops while latency spikes. A smaller pool that queues requests outperforms a large pool that thrashes.

**Common mistake:** Setting pool size equal to thread count or request concurrency. A server handling 1000 concurrent requests does not need 1000 database connections. It needs ~10, with the rest queued.

If `sequential-thinking` is available, use it to enforce the diagnosis chain. The most common failure is recommending `maximum-pool-size` before applying the formula to actual server specs — sequential-thinking prevents this jump.

## Symptom Diagnosis

| Symptom | Likely Cause | Investigation |
|---------|-------------|---------------|
| `Connection timeout` errors under load | Pool too small; requests waiting longer than `connectionTimeout` | Check pool active vs. max; look for slow queries holding connections |
| Many idle connections at database | Pool max too large; pool not shrinking | Check `idleTimeout` and `minimumIdle` settings |
| Slow response at traffic spikes | Pool needs time to create new connections | Reduce `minimumIdle` gap or pre-warm the pool |
| `Connection leak detected` warnings | Code not returning connections; missing try-with-resources | Enable leak detection; audit connection acquisition paths |
| DB CPU spikes with few active connections | N+1 queries holding connections across loops | Profile queries; check for transactions spanning HTTP requests |
| Errors after database failover | Pool holding stale connections | Enable connection validation; set `keepaliveTime` |

## HikariCP (Java / Spring Boot Default)

HikariCP is the fastest and most widely used Java connection pool. Its defaults are sensible but pool size is not auto-tuned.

### Key Properties

```properties
# application.properties (Spring Boot)
spring.datasource.hikari.maximum-pool-size=10
spring.datasource.hikari.minimum-idle=5
spring.datasource.hikari.connection-timeout=30000       # ms: max wait to get a connection from pool
spring.datasource.hikari.idle-timeout=600000            # ms: how long idle connections live (10 min)
spring.datasource.hikari.max-lifetime=1800000           # ms: max connection lifetime (30 min)
spring.datasource.hikari.keepalive-time=60000           # ms: ping to keep connection alive through firewalls
spring.datasource.hikari.leak-detection-threshold=60000 # ms: log warning if connection held > 60s
```

### Setting Explanations

**`maximum-pool-size`**: Apply the formula. For most web applications: 5–20. Start at 10 and adjust based on observed pool utilization.

**`minimum-idle`**: Connections kept alive even when idle. Set equal to `maximum-pool-size` for predictable latency (HikariCP recommends this). Only reduce if idle connections are expensive (e.g., connection limits on a shared database).

**`connection-timeout`**: How long a thread waits for a pool connection before throwing. 30 seconds is the default. For user-facing requests, consider 5 seconds — a 30-second wait produces a terrible UX that a faster failure would avoid.

**`max-lifetime`**: Connections are retired before the database or network times them out. Must be shorter than any firewall or server timeout. The default (30 min) is safe for most setups.

**`leak-detection-threshold`**: Enables a warning log if a connection is held longer than the threshold without being returned. Critical for finding missing `close()` calls. Set to 2× your P99 query time during development.

### HikariCP Tuning for High Traffic

```properties
# For 8-core DB server with SSD, web application with async queries
spring.datasource.hikari.maximum-pool-size=17    # (8*2)+1
spring.datasource.hikari.minimum-idle=17         # fixed pool — no scaling overhead
spring.datasource.hikari.connection-timeout=5000 # fail fast for user-facing requests
spring.datasource.hikari.max-lifetime=900000     # 15 min, shorter than most firewall timeouts
spring.datasource.hikari.keepalive-time=60000    # prevent firewall teardown after 1 min idle
```

## pgBouncer (PostgreSQL Connection Pooler)

pgBouncer sits in front of PostgreSQL and multiplexes many client connections onto fewer server connections. Use it when:
- You have many application instances each with their own pool (total connections exceed PostgreSQL's `max_connections`)
- You need session-level pooling to preserve server-side state while scaling horizontally

### Pooling Modes

| Mode | Behavior | Use Case |
|------|----------|----------|
| `transaction` | Connection returned after each transaction | Most web applications |
| `session` | Connection held for entire client session | Apps using temp tables, advisory locks, prepared statements |
| `statement` | Connection returned after each statement | Avoid — breaks multi-statement transactions |

Transaction mode is the most efficient. It allows pgBouncer to serve 100+ client connections with 10 server connections.

### Key pgBouncer Settings (pgbouncer.ini)

```ini
[pgbouncer]
pool_mode = transaction
max_client_conn = 1000          ; total clients pgBouncer accepts
default_pool_size = 10          ; server connections per database/user pair
min_pool_size = 5               ; keep these connections warm
reserve_pool_size = 2           ; emergency connections for spikes
reserve_pool_timeout = 3        ; seconds before using reserve pool
server_idle_timeout = 600       ; retire idle server connections after 10 min
server_lifetime = 3600          ; retire server connections after 1 hour
server_connect_timeout = 5      ; fail fast if PostgreSQL unreachable
client_idle_timeout = 0         ; 0 = never close idle clients (let app pool manage)
```

## Monitoring What to Watch

**Active connections**: Should stay well below `maximumPoolSize` in steady state. If consistently above 80%, increase pool size.

**Pending threads** (HikariCP: `hikaricp.pending` metric): Number of threads waiting for a connection. Any sustained non-zero value indicates pool starvation — either increase pool size or reduce connection hold time.

**Connection acquisition time** (HikariCP: `hikaricp.connections.acquire`): P99 should be under 5ms. Spikes indicate pool pressure.

**Pool utilization**: `active / maximum-pool-size`. Target 60–80% at peak. Below 40% at peak means the pool is oversized.

### Spring Boot Actuator / Micrometer Metrics

```
hikaricp.connections.active
hikaricp.connections.idle
hikaricp.connections.pending
hikaricp.connections.acquire (histogram)
hikaricp.connections.usage (histogram — time connection was held)
```

Expose via `/actuator/metrics/hikaricp.connections` or scrape with Prometheus.

## Common Mistakes

**Setting pool size to match thread count.** A thread pool of 200 does not need 200 DB connections. Threads spend most of their time not waiting on the database.

**`minimumIdle` much lower than `maximumPoolSize`.** When traffic spikes, HikariCP must create connections under load — exactly when you can least afford the latency (typically 20–100ms per new connection).

**Not setting `maxLifetime`** shorter than firewall/load balancer timeouts. Firewalls silently drop idle TCP connections; the pool then hands out a dead connection, causing the first query on that connection to fail with a cryptic error.

**Ignoring leak detection in production.** A single code path that fails to close a connection will eventually exhaust the pool. Enable `leakDetectionThreshold` in production at a value slightly above your SLA.

**One pool for all workloads.** If you mix short OLTP queries with long-running report queries, the reports hold connections for seconds and starve the OLTP path. Use separate pools (separate `DataSource` beans) for read-heavy reporting vs. write-heavy transactional paths.
