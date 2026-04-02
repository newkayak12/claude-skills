---
name: connection-pool-tuner
description: >-
  Use when an application shows intermittent database connection failures, API latency
  that spikes under traffic, or pool exhaustion errors — and you need to diagnose and
  tune connection pool settings (HikariCP, pgBouncer, or similar).
  Triggers on: "connection pool exhausted", "HikariCP timeout", "too many connections",
  "pool size tuning", "pgBouncer config", "DB connection timeout", "커넥션 풀 설정",
  "데이터베이스 연결 오류", "connection leak".
  Best for: HikariCP tuning, pgBouncer sizing, diagnosing pool exhaustion vs. slow queries.
  Not for: slow query rewriting (use sql-pro) or server-level DB parameter tuning (use database-optimizer).
scenarios:
  - "Our application is getting 'connection pool exhausted' errors under load"
  - "Help me tune HikariCP settings for a Spring Boot service with 500 concurrent users"
  - "Database connections are timing out — need to optimize pool configuration"
  - "커넥션 풀이 고갈되면서 DB 연결 오류가 나"
  - "HikariCP 설정을 최적화해줘"
compatibility:
  recommended:
    - think-tool
  optional:
    - sequential-thinking
  remote_mcp_note: >-
    think-tool이 있으면 증상 → 원인 → 설정 변경의 진단 체인을 더 체계적으로 따를 수 있습니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
---

# Connection Pool Tuner

## When to Use / When Not to Use

**Use when:**
- Seeing `Connection timeout` or `pool exhaustion` errors under load
- API latency spikes correlate with database traffic
- Many idle connections are visible at the database server
- Setting up a new application and need to size the pool correctly

**Do not use when:**
- The root cause is slow SQL queries (use `sql-pro`)
- The issue is server-level memory/IO config (use `database-optimizer`)

## Process

1. **Identify the symptom** — Match to the diagnosis table below
2. **Apply the sizing formula** — Calculate target pool size from DB server specs
3. **Configure primary settings** — `maximumPoolSize`, `minimumIdle`, `connectionTimeout`, `maxLifetime`
4. **Enable leak detection** — Set `leakDetectionThreshold` to 2× P99 query time
5. **Add monitoring** — Expose `hikaricp.connections.*` metrics; alert on `pending > 0` sustained
6. **Validate** — Watch pool utilization under load; target 60–80% at peak

If `sequential-thinking` is available, use it to enforce diagnosis before recommending pool size — the most common failure is jumping to `maximumPoolSize` before applying the formula.

## Output Template

For each pool tuning task, provide:
1. Recommended property values with rationale
2. The sizing formula applied to actual server specs
3. `application.properties` or `pgbouncer.ini` snippet
4. Monitoring query / metrics to track
5. Common mistake check against the current config

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Applies sizing formula to your DB server specs | Provide DB server core count and disk type |
| Recommends `maximumPoolSize`, `minimumIdle`, timeouts | Apply settings and observe under real load |
| Identifies config mistakes from your current settings | Confirm recovery time from your runbooks |
| Generates HikariCP properties or pgBouncer ini snippet | Test with production-scale traffic patterns |
| Recommends Micrometer metrics to alert on | Wire alerts to your monitoring stack |

## The Fundamental Sizing Formula

```
pool_size = (core_count * 2) + effective_spindle_count
```

- `core_count`: CPU cores available to the DB server
- `effective_spindle_count`: 1 for SSD, 0 if data fits in RAM

Example: 4-core SSD server → `(4 * 2) + 1 = 9` → round to 10.

A server handling 1000 concurrent requests does NOT need 1000 DB connections. It needs ~10, with the rest queued.

## Symptom Diagnosis

| Symptom | Likely Cause | Investigation |
|---------|-------------|---------------|
| `Connection timeout` under load | Pool too small | Check pool active vs. max; look for slow queries holding connections |
| Many idle connections at DB | Pool max too large | Check `idleTimeout` and `minimumIdle` settings |
| Slow response at traffic spikes | New connections created under load | Reduce `minimumIdle` gap or pre-warm the pool |
| `Connection leak detected` warnings | Code not returning connections | Enable leak detection; audit acquisition paths |
| DB CPU spikes with few active connections | N+1 queries holding connections | Profile queries; check for transactions spanning HTTP requests |
| Errors after DB failover | Stale connections in pool | Enable connection validation; set `keepaliveTime` |

## HikariCP Key Properties

```properties
# application.properties (Spring Boot)
spring.datasource.hikari.maximum-pool-size=10
spring.datasource.hikari.minimum-idle=5
spring.datasource.hikari.connection-timeout=30000       # ms: max wait for a pool connection
spring.datasource.hikari.idle-timeout=600000            # ms: idle connections live 10 min
spring.datasource.hikari.max-lifetime=1800000           # ms: max connection lifetime 30 min
spring.datasource.hikari.keepalive-time=60000           # ms: ping to survive firewall NAT
spring.datasource.hikari.leak-detection-threshold=60000 # ms: warn if connection held > 60s
```

## pgBouncer Modes

| Mode | Behavior | Use Case |
|------|----------|----------|
| `transaction` | Connection returned after each transaction | Most web applications |
| `session` | Connection held for entire client session | Temp tables, advisory locks, prepared statements |
| `statement` | Returned after each statement | Avoid — breaks multi-statement transactions |

## Common Mistakes

- **Pool size equals thread count** — threads spend most time not waiting on the database
- **`minimumIdle` much lower than `maximumPoolSize`** — creates connections under load when latency is critical
- **`maxLifetime` not set shorter than firewall timeout** — silent TCP drops cause cryptic errors on first query
- **Leak detection disabled in production** — one missing `close()` eventually exhausts the pool
- **One pool for all workloads** — separate OLTP (short queries) from reporting (long queries)

## Related Skills

- `database-optimizer` — server-level tuning after pool config is correct
- `sql-pro` — slow query rewriting when pool is correctly sized but queries are still slow
- `circuit-breaker-tuner` — add circuit breakers alongside pool to prevent cascading failure
