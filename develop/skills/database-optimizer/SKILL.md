---
name: database-optimizer
description: >-
  Use when DB slowness is server-side, not query text. Triggers on: "락 경합", "VACUUM 밀림", "shared_buffers 튜닝", "파티셔닝
  설계", "lock contention", "stale statistics", "InnoDB buffer pool". Not for SQL rewrites or pool sizing.
scenarios:
  - "Our database queries are slow and we're hitting performance bottlenecks"
  - "Help me optimize this SQL query that takes 30 seconds on a 10M row table"
  - "Need to scale our PostgreSQL database — it can't handle current load"
  - "DB 쿼리가 너무 느려서 서비스 응답시간이 30초야"
  - "PostgreSQL 성능 최적화 방법을 알려줘"
compatibility:
  recommended:
    - think-tool
  optional:
    - sequential-thinking
  remote_mcp_note: >-
    think-tool이 있으면 병목 원인 분석과 최적화 우선순위 결정을 더 체계적으로 수행합니다.
    sequential-thinking은 베이스라인 캡처 → 변경 → 검증 순서를 강제합니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
license: MIT
metadata:
  version: "1.1.0"
  domain: infrastructure
  triggers: server-side database tuning, vacuum lag, lock waits, buffer pool sizing, partitioning, EXPLAIN ANALYZE reading
  role: specialist
  scope: optimization
  output-format: findings-with-config-and-sql
  related-skills: sql-pro, connection-pool-tuner, sre-engineer
---

# Database Optimizer

## When to Use / When Not to Use

**Use when:**
- EXPLAIN plan is in hand but the fix is server config, not query rewriting
- Investigating lock contention, VACUUM lag, or statistics staleness
- Tuning `shared_buffers`, `work_mem`, or InnoDB buffer pool
- Designing partitioning strategy or index structure

**Do not use when:**
- The fix is rewriting a slow SQL query (use `sql-pro`)
- The bottleneck is connection pool exhaustion (use `connection-pool-tuner`)

## Process

1. **Initial triage** — Confirm: database engine + version, deployment type (self-managed vs. cloud-managed), and whether direct connection is available
2. **Capture baseline** — Run `EXPLAIN (ANALYZE, BUFFERS)` before any changes
3. **Identify bottlenecks** — Read the plan for costly queries, absent indexes and misconfigured settings
4. **Design solutions** — Index strategy, query rewrites, schema or config improvements
5. **Implement incrementally** — Apply a single change, confirm its effect, then move on
6. **Validate results** — Repeat `EXPLAIN ANALYZE`, set costs side by side, and time the real workload

> On cloud-managed databases (RDS, Cloud SQL, Aurora): `ALTER SYSTEM` and `my.cnf` edits are unavailable. Use parameter groups or the console instead.

Use `sequential-thinking` if available — it enforces the baseline-capture step and prevents skipping directly to index creation.

## Output Template

For each optimization task, provide:
1. Performance analysis with baseline numbers: latency, plan cost, hit rate of the buffer cache
2. Identified bottlenecks with EXPLAIN evidence
3. Optimization strategy naming each concrete change
4. SQL and configuration changes to apply
5. Validation queries that measure the improvement
6. Monitoring to keep after the change

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Reads EXPLAIN output and identifies plan patterns | Provide the actual EXPLAIN output |
| Recommends index type (B-tree, covering, partial, expression) | Run `CREATE INDEX CONCURRENTLY` in your environment |
| Generates parameter tuning recommendations | Apply via parameter group or `ALTER SYSTEM` |
| Writes the queries that prove the gain | Confirm the gain on production-sized data |
| Flags cloud-managed platform constraints | Verify access level (console vs. direct connection) |

## Reference Guide

| Area | File | Read when |
|------|------|-----------|
| Plans and query shape | `references/query-optimization.md` | Reading EXPLAIN output, slow statements |
| Index Design | `references/index-design-patterns.md` | B-tree, covering, partial, expression indexes |
| PostgreSQL Memory & WAL | `references/postgresql-memory-wal.md` | shared_buffers, work_mem, WAL config |
| PostgreSQL VACUUM & Locking | `references/postgresql-vacuum-locking.md` | VACUUM, connection pooling, lock management; queue claims with SKIP LOCKED, advisory locks, lock order against deadlocks |
| MySQL Memory & I/O | `references/mysql-memory-io.md` | InnoDB memory, I/O config |
| PostgreSQL Monitoring | `references/monitoring-postgresql.md` | pg_stat_statements, connections, locks |
| MySQL Monitoring | `references/monitoring-mysql.md` | Performance schema, InnoDB status |

## EXPLAIN Output — Key Patterns

| Plan signal | What it suggests | Usual first move |
|-------------|------------------|------------------|
| `Seq Scan` over a big table | Filter keeps few rows but nothing indexed | B-tree index on the filtered column |
| `Nested Loop` driven by a large outer side | Inner side re-probed once per outer row | Index the inner join key, or let a hash join win |
| Estimated `rows=1`, actual 50000 | Planner statistics out of date | `ANALYZE` the table |
| `Buffers: hit=40 read=120000` | Pages mostly fetched from disk | Grow `shared_buffers`, or add a covering index |
| `Sort Method: external merge  Disk: ...` | Sort overflowed memory | Raise `work_mem` for that session or role |

```sql
-- BUFFERS separates cached reads from disk reads
EXPLAIN (ANALYZE, BUFFERS)
SELECT p.id, u.display_name
FROM payment p
JOIN app_user u ON u.id = p.user_id
WHERE p.state = 'authorized'
  AND p.created_at > now() - interval '24 hours'
```

## Constraints

**MUST DO:**
- Capture `EXPLAIN (ANALYZE, BUFFERS)` before any changes — this is the baseline
- Build PostgreSQL indexes `CONCURRENTLY` so writers are not blocked
- Rehearse outside production; revert if writes slow or replicas fall behind
- One change per round; measure before the next

**MUST NOT DO:**
- Change anything before a baseline is recorded
- Add indexes that duplicate another or serve no query
- Make multiple changes simultaneously
- Use `ALTER SYSTEM` on Amazon RDS or other cloud-managed databases

## Related Skills

- `sql-pro` — rewriting slow queries when the server is correctly configured
- `connection-pool-tuner` — pool sizing after server config is validated
- `sre-engineer` — monitoring and alerting on database golden signals
