---
name: connection-pool-tuner
description: >-
  Use when DB connections time out or the pool is exhausted under load. Triggers on: "커넥션 풀 고갈", "HikariCP 사이즈 어떻게
  잡아?", "트래픽 몰리면 타임아웃", "pool exhaustion", "pgBouncer tuning", "Connection timeout".
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

## Standing Mandates

- NEVER raise `maximumPoolSize` to fix timeouts before the symptom is diagnosed. A bigger pool in front of slow queries
  or leaked connections moves the queue into the database and slows everything. Name the cause from the symptom table first.
- NEVER size from thread count or guess. The size comes from the DB server's cores and disk type; absent is
  `[확인 필요: DB cores/disk]`, and no number is given.
- A recovery claim needs pool metrics under load (active, pending, wait time); without them it is `unverified`.
- Goal: symptom, diagnosed cause, the numbers (formula applied), and the config change, with a closing tally that
  recounts to the config lines.

# Connection Pool Tuner

Diagnoses why connections time out or run out, then sets pool size and timeouts from the database's capacity.

**Not for** slow SQL (`develop:sql-pro`), server memory or I/O config (`develop:database-optimizer`), or transactions
held too long (`develop:transaction-boundary-reviewer`), though it is a frequent cause: say so and hand it off.

## Process

1. **Symptom to cause.** Match the table below; check active vs. max and what holds connections.
2. **Size.** Apply the formula in `references/pool-config.md` to the DB server's cores and disk. The result is the total
   across every app instance (and pgBouncer) hitting this DB; divide by instance count for `maximumPoolSize`.
   `core_count` = physical cores, not hyperthreads.
3. **Configure.** `maximumPoolSize`, `minimumIdle`, `connectionTimeout`, `maxLifetime` (shorter than the firewall timeout), `keepaliveTime`.
4. **Leak detection and metrics.** `leakDetectionThreshold` above the longest legitimate connection hold time (transaction, not single query); alert on `pending > 0` sustained.
5. **Validate.** Utilization 60-80% at peak, no timeouts. Stop after 3 rounds without improvement and report the remaining cause.
   Before sending, recount the tally against the config lines; fix the header if they differ.

| Symptom | Likely cause | Investigation |
|---------|-------------|---------------|
| `Connection timeout` under load | Pool too small, or slow queries holding connections | Active vs. max; slow queries |
| Many idle connections at DB | Pool max too large | `idleTimeout`, `minimumIdle` |
| Slow at traffic spikes | New connections created under load | Raise `minimumIdle` toward max, pre-warm |
| `Connection leak detected` | Code not returning connections | Enable leak detection; audit acquisition paths |
| DB CPU high, few active connections | N+1 or transactions spanning HTTP calls | Profile queries and transaction scope |
| Errors after DB failover | Stale connections in pool | Connection validation, `keepaliveTime` |

Properties, pgBouncer modes, common mistakes: `references/pool-config.md`.

## Output Template

```
## Pool tuning — <service>

Symptom: <quote or metric> → Cause: <from table> — <evidence>
Sizing: (<cores> * 2) + <spindles> = <n> → <value>   (or [확인 필요: DB cores/disk])
Config: <properties or pgbouncer.ini snippet>
Metrics to alert on: <names, thresholds>

<n> settings changed · <k> measured under load · <u> unverified
```

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Applies the formula, flags config mistakes, writes the snippet | Provide DB core count, disk type, current settings, the symptom |
| Names the metrics to alert on | Apply settings and observe under real load; wire alerts |

## Related Skills

- `develop:database-optimizer` — server-level tuning after pool config is correct
- `develop:sql-pro` — slow queries when the pool is correctly sized
- `develop:transaction-boundary-reviewer` — long transactions holding connections
- `develop:circuit-breaker-tuner` — circuit breakers alongside the pool to stop cascading failure
