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

## Standing Mandates

- NEVER change anything before a baseline is recorded (`EXPLAIN (ANALYZE, BUFFERS)`, latency, cache hit rate), and
  never make two changes in one round. Two changes at once make the net number unattributable. No baseline supplied is `[확인 필요: baseline]` and the tuning stops there.
- NEVER run `ALTER SYSTEM` or edit `my.cnf` on a managed database (RDS, Cloud SQL, Aurora); use the parameter group.
  Deployment type unknown is `[확인 필요: deployment]`.
- Do NOT add an index that duplicates another's leading columns or serves no measured query; each index taxes every write.
- A gain not shown by a before/after measurement is `unverified`, never "should be faster".
- Goal: each change has a baseline number, an after number, and a keep or revert; stop at the target or after 3 rounds
  with no gain, reporting what remains. The closing tally recounts to the change lines.

# Database Optimizer

Finds the server-side cause of database slowness (memory, VACUUM, locks, statistics, partitioning) and changes it one
measured step at a time.

**Not for** rewriting the query text (`develop:sql-pro`) or pool sizing (`develop:connection-pool-tuner`).

## Process

1. **Triage.** Engine and version, deployment type (self-managed or cloud-managed), direct access or not.
2. **Baseline.** `EXPLAIN (ANALYZE, BUFFERS)`, latency, buffer hit rate.
3. **Bottleneck.** Read the plan and server stats: costly nodes, absent indexes, stale statistics, lock waits, VACUUM lag.
4. **One change.** Index, parameter, or partition; PostgreSQL indexes `CONCURRENTLY`; rehearse outside production.
5. **Measure.** Re-run the baseline; keep or revert. Revert if writes slow or replicas fall behind. Then the next change. Before sending, recount the tally against the change lines; fix the header if they differ.

| Plan signal | Suggests | Usual first move |
|-------------|----------|------------------|
| `Seq Scan` over a big table | Few rows kept, nothing indexed | B-tree index on the filtered column |
| `Nested Loop`, large outer side | Inner re-probed per outer row | Index the inner join key, or let a hash join win |
| Estimated `rows=1`, actual 50000 | Statistics out of date | `ANALYZE` the table |
| `Buffers: hit=40 read=120000` | Pages mostly from disk | Grow `shared_buffers`, or add a covering index |
| `Sort Method: external merge  Disk` | Sort overflowed memory | Raise `work_mem` for that session or role |

| Area | File | Read when |
|------|------|-----------|
| Plans and query shape | `references/query-optimization.md` | Reading EXPLAIN output, slow statements |
| Index design | `references/index-design-patterns.md` | B-tree, covering, partial, expression |
| PostgreSQL memory and WAL | `references/postgresql-memory-wal.md` | shared_buffers, work_mem, WAL |
| PostgreSQL VACUUM and locking | `references/postgresql-vacuum-locking.md` | VACUUM, locks, SKIP LOCKED, advisory locks, lock order |
| MySQL memory and I/O | `references/mysql-memory-io.md` | InnoDB memory, I/O |
| Monitoring | `references/monitoring-postgresql.md`, `references/monitoring-mysql.md` | pg_stat_statements, locks; performance schema, InnoDB status |

## Output Template

```
## DB tuning — <system> (<engine> <version>, <self-managed | managed>)

Baseline: <latency, plan cost, hit rate>
Change <n>: <what> → after <numbers> → keep | revert
Monitoring to keep: <metrics>

<n> changes · <k> kept · <r> reverted · <u> unverified
```

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Reads EXPLAIN, names the bottleneck, proposes one change | Provide the actual EXPLAIN output and engine/deployment facts |
| Writes the parameter or index change and the validation queries | Apply via parameter group or `ALTER SYSTEM`; run `CREATE INDEX CONCURRENTLY` |
| Flags managed-platform constraints | Confirm the gain on production-sized data |

## Related Skills

- `develop:sql-pro` — rewrite slow queries once the server is configured
- `develop:connection-pool-tuner` — pool sizing after server config is validated
- `develop:sre-engineer` — monitoring and alerting on database golden signals
