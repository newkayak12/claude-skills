---
name: transaction-boundary-reviewer
description: >-
  Use when data goes inconsistent or transactions cause locks. Triggers on: "데이터 정합성 깨져", "@Transactional 범위", "트랜잭션
  락 타임아웃", "isolation level", "two writes atomic", "deadlock under load".
scenarios:
  - "Data is inconsistent after failures — review our transaction boundaries"
  - "Help me identify where distributed transactions are causing data integrity issues"
  - "Our service has partial failure scenarios where some data commits but some doesn't"
  - "장애 후 데이터가 불일치해 — 트랜잭션 경계를 검토해줘"
  - "분산 트랜잭션으로 인한 데이터 정합성 문제를 해결해줘"
compatibility:
  recommended:
    - think-tool
  optional:
    - sequential-thinking
  remote_mcp_note: >-
    think-tool이 있으면 동시성 이슈와 격리 수준 트레이드오프를 더 정확하게 분석합니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
---

## Standing Mandates

- NEVER raise the isolation level as the first fix. Name the exact anomaly (lost update, write skew, phantom) with the
  code path that produces it, then pick the lowest level or lock that prevents that one. Higher isolation costs
  deadlocks and retries under load.
- NEVER call a boundary safe without having read the code inside it. `@Transactional` on a method says nothing about
  what runs in it; external I/O and lazy loads hide in the body.
- Concurrency facts you were not shown (real access pattern, engine, isolation default) are `[확인 필요: ○○]`, never
  assumed. A finding resting on one is `provisional`.
- Goal: every transaction reviewed gets the ACID property at risk, a verdict with file:line evidence, and a closing
  tally that recounts to the finding lines.

# Transaction Boundary Reviewer

Reviews where transactions begin and end, what runs inside them, and which anomaly each boundary leaves open.

**Not for** slow SQL (`develop:sql-pro`), pool exhaustion as the root cause (`develop:connection-pool-tuner`), or
designing cross-service topology (`develop:architecture-designer`).

## Process

1. **Property at risk.** Atomicity (partial writes), Isolation (concurrent anomaly), Consistency (constraint bypass), or Durability (premature ack).
2. **Map the boundary.** What runs inside `@Transactional`? Any external I/O, N+1, lazy load, event publish?
3. **Anti-patterns.** Wide transaction, missing `rollbackFor`, lost update, self-invocation bypassing the proxy (all in `references/anti-patterns.md`).
4. **Isolation or lock.** The lowest level or lock that prevents the named anomaly.
5. **Cross-service.** Outbox for reliable event publishing, Saga for long flows; 2PC only when both systems are yours.
   Before sending, recount the tally against the finding lines; fix the header if they differ.

Code examples, ACID and isolation tables (with engine caveats), pattern table, checklist: `references/anti-patterns.md`.
Outbox and Saga implementations: `references/distributed-patterns.md`.

## Output Template

```
## Transaction review — <service/method>

Boundary: <class.method:line> · Property at risk: <A/C/I/D> — <anomaly>
Evidence: <file:line, what runs inside>
Fix: <corrected scope/lock/pattern> · Isolation: <level> — <anomaly it prevents>
Verdict: unsafe | safe | provisional — <one line>

<n> boundaries reviewed · <u> unsafe · <p> provisional
```

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Reads the transaction scope, names the anomaly, narrows the scope | Provide the service and repository code |
| Recommends isolation or locking for that anomaly | Confirm real concurrent access patterns |
| Designs the Outbox table and Saga steps | Fill in compensation logic; monitor the outbox relay; test under concurrent load |

## Related Skills

- `develop:spring-boot-engineer` — implement the corrected `@Transactional` patterns
- `develop:architecture-designer` — cross-service transaction design
- `develop:circuit-breaker-tuner` — wide transactions compound cascading failure
- `develop:connection-pool-tuner` — wide transactions can exhaust the pool
