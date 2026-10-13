---
name: database-workflow
description: >-
  Use when investigating database performance degradation end-to-end — from
  query quality through server tuning, connection layer, and transaction safety.
  Triggers on: "database workflow", "DB 성능 전체", "database performance
  investigation", "DB 전체 점검".
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

## Standing Mandates

- NEVER run a step on a missing input. No EXPLAIN output from Step 1, no pool settings for Step 3 is
  `[확인 필요: ○○]`; the run stops there or the user says to skip. (Scar: tuning the server before the query plan was
  in hand sent two rounds at a config that was never the cause.)
- NEVER restate a step skill's method here; invoke it by name, relay its verdict, and never grade its output yourself.
- NEVER skip a step on a hunch. A skip needs the step's Skip-if evidence, quoted.
- Goal: each step run or skipped with its evidence, one step per turn unless the user asks to continue, and the closing
  tally recounts to the step lines.

# Database Workflow

4-step database performance process: query, server, connection layer, transaction safety.

**Not for** a single-layer request (call that skill: `develop:sql-pro` for one query, `develop:connection-pool-tuner`
for pool sizing only, `develop:transaction-boundary-reviewer` for transaction review only).

## Steps

| # | Skill | Input | Output | Skip if |
|---|-------|-------|--------|---------|
| 1 | `develop:sql-pro` | Slow query or requirements, schema DDL, engine and version | Query, index recommendations, plan analysis, before/after numbers | All queries optimized, no sequential scans on large tables |
| 2 | `develop:database-optimizer` | `EXPLAIN (ANALYZE, BUFFERS)` from Step 1, engine, deployment type | Bottleneck analysis with evidence, parameter changes, validation queries | Server correctly configured and plans already optimal |
| 3 | `develop:connection-pool-tuner` | DB cores and disk, current pool settings, symptom | Sizing applied, config snippet, metrics to alert on, mistake audit | Pool at 60-80% utilization at peak, no timeouts |
| 4 | `develop:transaction-boundary-reviewer` | Service and repository code, inconsistency symptoms, access patterns | ACID risk, anti-patterns with code evidence, corrected scope, isolation, Outbox/Saga if cross-service | Read-only service, or single-table writes with no external I/O in transactions |

Start prompts: "Step N 시작" or name the skill. Say where you are and the run joins there ("커넥션 풀부터" -> Step 3;
"트랜잭션 경계만" -> Step 4).

## Output Template

```
## Database workflow — <system> (<engine> <version>)

| Step | Skill | Status (done / skipped: <Skip-if evidence> / blocked: [확인 필요: ○○]) | Finding |
|------|-------|-----|---------|

Next: <step N, or "complete">
<d> done · <s> skipped · <b> blocked
```

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Runs each step skill and carries its output to the next | Provide schema DDL, actual EXPLAIN output, pool settings, the code |
| Flags a missing input before the step runs | Apply config and observe under real load |

## Related Skills

- Before: `develop:architecture-designer` — when the schema itself needs redesign
- Adjacent: `develop:spring-boot-engineer` — JPA and `@Transactional` implementation
- After: `develop:sre-engineer` — monitoring and alerting on DB golden signals
