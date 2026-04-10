---
name: database-workflow
description: >-
  Use when investigating database performance degradation end-to-end — from
  query quality through server tuning, connection layer, and transaction safety.
  Triggers on: "database workflow", "DB 성능 전체", "database performance
  investigation", DB 전체 점검",
type: workflow
theme: engineering
scenarios:
  - "database workflow 전체 돌려줘"
  - "DB 성능 문제 처음부터 끝까지 점검해줘"
  - "database performance investigation 시작"
  - "프로덕션 DB가 너무 느려 — 전체 레이어 다 봐줘"
  - "새 기능 DB 설계, 쿼리부터 트랜잭션까지 제대로 하고 싶어"
  - "connection pool이랑 transaction까지 포함해서 DB 전체 전략 잡아줘"
estimated_time: "2-6 hours (full), 30-90 min per step"
compatibility:
  recommended:
    - think-tool
  optional:
    - sequential-thinking
  remote_mcp_note: >-
    think-tool은 실행 계획 해석과 트랜잭션 격리 수준 트레이드오프 분석에서 특히 유효합니다.
    sequential-thinking은 베이스라인 캡처 → 변경 → 검증 순서를 강제합니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
---

# Database Workflow

4-step database quality process: query authoring → slow query diagnosis → connection layer → transaction safety.

## When to Use / When Not to Use

| Use | Skip |
|-----|------|
| Production database slowness with unknown root layer | Single query rewrite request — use sql-pro |
| Designing a new database-heavy feature | Pool sizing only — use connection-pool-tuner |
| Database-layer onboarding or audit | Transaction review only — use transaction-boundary-reviewer |

---

## Workflow Overview

```
[1] SQL Quality (sql-pro)
     Write / rewrite queries, index strategy, EXPLAIN plan
        ↓
[2] Server-Level Optimization (database-optimizer)
     Slow query diagnosis, execution plan, server config tuning
        ↓
[3] Connection Layer Tuning (connection-pool-tuner)
     Pool sizing, HikariCP / pgBouncer config, leak detection
        ↓
[4] Transaction Safety (transaction-boundary-reviewer)
     Isolation levels, @Transactional scope, Outbox / Saga patterns
```

---

## Steps

### Step 1 — SQL Quality
**Skill:** `sql-pro`
**Goal:** Write or rewrite queries using CTEs, window functions, and correct join types; design indexes that cover the query access patterns; interpret EXPLAIN plans
**Input:** Slow query or new query requirements; schema DDL; target DB engine and version
**Output:** Optimized query with inline comments, covering index recommendations, EXPLAIN plan analysis, before/after performance metrics
**Skip if:** All queries are already optimized and EXPLAIN plans show no sequential scans on large tables

> "Step 1 시작" 또는 "이 쿼리 최적화해줘"

---

### Step 2 — Server-Level Optimization
**Skill:** `database-optimizer`
**Goal:** Diagnose performance issues that survive query-level fixes — server memory config, VACUUM, lock contention, statistics staleness, partitioning design
**Input:** EXPLAIN (ANALYZE, BUFFERS) output from Step 1; DB engine, version, and deployment type (self-managed vs. RDS/Cloud SQL)
**Output:** Bottleneck analysis with EXPLAIN evidence, server parameter recommendations, incremental implementation plan, validation queries
**Skip if:** DB server is correctly configured and EXPLAIN plans are already optimal (Step 1 output is clean)

> "Step 2 시작" 또는 "서버 레벨 튜닝 해줘"

---

### Step 3 — Connection Layer Tuning
**Skill:** `connection-pool-tuner`
**Goal:** Size the connection pool correctly for the DB server, diagnose pool exhaustion vs. slow-query root cause, configure leak detection and monitoring
**Input:** DB server core count and disk type; current HikariCP or pgBouncer settings; symptom description (timeout errors, idle connection count)
**Output:** Sizing formula applied to actual specs, `application.properties` or `pgbouncer.ini` snippet, Micrometer metrics to alert on, common-mistake audit of current config
**Skip if:** Pool is sized correctly (60–80% utilization at peak) with no timeout errors under load

> "Step 3 시작" 또는 "커넥션 풀 설정 최적화해줘"

---

### Step 4 — Transaction Safety
**Skill:** `transaction-boundary-reviewer`
**Goal:** Review transaction boundaries for atomicity gaps, overly wide transactions holding locks, missing rollback declarations, and cross-service consistency patterns
**Input:** Service and repository code; known data inconsistency symptoms; concurrent access patterns
**Output:** ACID risk diagnosis, anti-patterns found with code evidence, corrected code with narrowed transaction scope, isolation level recommendation, Outbox/Saga pattern if cross-service
**Skip if:** Service is read-only or all writes are single-table with no external I/O inside transactions

> "Step 4 시작" 또는 "트랜잭션 경계 검토해줘"

---

## State Tracking

어느 단계에 있는지 알려주면 바로 합류합니다:
- "커넥션 풀부터" → Step 3로 직행
- "트랜잭션 경계만 봐줘" → Step 4로 직행
- Skip 조건에 해당하면 자동으로 다음 단계로 안내

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Query rewrite, index strategy, EXPLAIN interpretation (Step 1) | Provide schema DDL and actual EXPLAIN ANALYZE output |
| Server bottleneck analysis, parameter tuning plan (Step 2) | Apply config via parameter group or ALTER SYSTEM |
| Pool sizing formula, HikariCP config snippet (Step 3) | Observe pool utilization under real load |
| Transaction anti-pattern detection, corrected code (Step 4) | Confirm concurrent access patterns; test under load |

## Related Skills

- Individual skills: `develop:sql-pro`, `develop:database-optimizer`, `develop:connection-pool-tuner`, `develop:transaction-boundary-reviewer`
- Before: `develop:architecture-designer` (if the DB schema itself needs redesign)
- Adjacent: `develop:spring-boot-engineer` (for JPA / @Transactional implementation patterns)
- After: `develop:sre-engineer` (monitoring and alerting on DB golden signals post-tuning)
