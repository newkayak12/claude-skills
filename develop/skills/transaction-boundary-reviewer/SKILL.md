---
name: transaction-boundary-reviewer
description: >-
  Use when data appears inconsistent after failures, when two writes need to succeed
  or fail together, or when transactions are causing lock contention or timeout errors
  under load. Reviews isolation levels, atomicity gaps, overly wide transactions,
  missing rollback declarations, and cross-service consistency patterns.
  Triggers on: "transaction boundary", "data inconsistency after failure", "lock contention",
  "@Transactional too wide", "Outbox pattern", "Saga rollback", "트랜잭션 경계",
  "락 경합", "데이터 정합성 문제", "분산 트랜잭션 설계".
  Best for: Spring @Transactional review, isolation level selection, Outbox/Saga pattern guidance.
  Not for: general query performance (use sql-pro) or connection pool sizing (use connection-pool-tuner).
compatibility:
  recommended:
    - think-tool
  optional:
    - sequential-thinking
  remote_mcp_note: >-
    think-tool이 있으면 동시성 이슈와 격리 수준 트레이드오프를 더 정확하게 분석합니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
---

# Transaction Boundary Reviewer

## When to Use / When Not to Use

**Use when:**
- Data appears inconsistent after partial failures
- Transactions are causing lock contention or timeout errors under load
- Two writes (possibly across services) need atomicity
- Reviewing `@Transactional` boundaries in Spring Boot code

**Do not use when:**
- The issue is slow SQL queries (use `sql-pro`)
- Connection pool exhaustion is the root cause (use `connection-pool-tuner`)

## Process

1. **Identify which ACID property is at risk** — Atomicity (partial writes), Isolation (concurrent anomaly), Consistency (constraint bypass), or Durability (premature ack)
2. **Map the transaction boundary** — What code runs inside `@Transactional`? Does it include external I/O?
3. **Check for common anti-patterns** — Wide transactions, N+1 inside transactions, missing rollbackFor, lost updates
4. **Select isolation level** — Choose the lowest level that prevents the specific anomaly
5. **Apply the right distributed pattern** — Outbox (event publishing), Saga (long-running flows), or pessimistic/optimistic locking

For full Outbox and Saga implementations, see `references/distributed-patterns.md`.

## Output Template

For each review, provide:
1. ACID property at risk (with diagnosis)
2. Anti-patterns found (with code evidence)
3. Corrected code or pattern
4. Isolation level recommendation with rationale
5. For cross-service: Outbox or Saga pattern recommendation

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Identifies anti-patterns in the `@Transactional` scope | Provide the service method and repository code |
| Recommends isolation level for the specific anomaly | Confirm concurrent access patterns under real load |
| Generates corrected code with narrowed transaction scope | Test the fix under concurrent load |
| Designs Outbox table and relay pattern | Implement and monitor the outbox relay process |
| Templates Saga step with execute() and compensate() | Fill in the real compensation business logic |

## ACID Properties Reference

| Property | Means | Violated By |
|----------|-------|-------------|
| Atomicity | All changes commit or all roll back | Partial writes on failure |
| Consistency | DB constraints hold before and after | Bypassing validations; wrong ordering |
| Isolation | Concurrent transactions do not interfere | Missing locks; wrong isolation level |
| Durability | Committed data survives crashes | Missing fsync; premature ack |

## Isolation Levels

| Level | Prevents | Allows | Use When |
|-------|----------|--------|---------|
| READ UNCOMMITTED | Nothing | Dirty reads, non-repeatable reads, phantoms | Almost never |
| READ COMMITTED | Dirty reads | Non-repeatable reads, phantoms | Default OLTP (PostgreSQL default) |
| REPEATABLE READ | Dirty + non-repeatable reads | Phantom reads | Financial aggregations, inventory checks |
| SERIALIZABLE | All anomalies | — | Booking, reservation, double-spend prevention |

## Common Anti-Patterns

### 1. Overly Wide Transactions

```java
// Bad — HTTP call inside transaction holds locks
@Transactional
public void processOrder(Order order) {
    orderRepository.save(order);
    paymentGateway.charge(order);  // external HTTP — locks held during this!
}

// Good — database work is atomic; side effects happen after commit
@Transactional
public Order saveOrder(Order order) { return orderRepository.save(order); }

public void processOrder(Order order) {
    Order saved = saveOrder(order);     // transaction commits here
    paymentGateway.charge(saved);       // no locks held
}
```

### 2. Missing Rollback on Checked Exceptions

```java
// Bad — IOException does NOT trigger rollback in Spring by default
@Transactional
public void importData(File file) throws IOException { ... }

// Good — explicit rollback declaration
@Transactional(rollbackFor = IOException.class)
public void importData(File file) throws IOException { ... }
```

### 3. Lost Update (Read Inside Write)

```java
// Bad — two threads read balance=100, both deduct 80, both save 20
@Transactional
public void deduct(Long accountId, BigDecimal amount) {
    Account account = accountRepo.findById(accountId).orElseThrow();
    account.setBalance(account.getBalance().subtract(amount));
    accountRepo.save(account);
}

// Good — pessimistic lock (SELECT FOR UPDATE)
@Transactional
public void deduct(Long accountId, BigDecimal amount) {
    Account account = accountRepo.findByIdWithLock(accountId).orElseThrow();
    account.setBalance(account.getBalance().subtract(amount));
    accountRepo.save(account);
}
```

### 4. Distributed Transaction Anti-Patterns

| Pattern | When to Use |
|---------|------------|
| Outbox | Publishing events reliably after a local commit |
| Saga (choreography) | Long-running processes; 2–3 services |
| Saga (orchestration) | Complex multi-step flows needing visibility; 4+ services |
| Two-Phase Commit | Avoid; only when strong consistency is non-negotiable and you control both systems |

## Review Checklist

- [ ] No external I/O (HTTP, email, Kafka publish) inside database transactions
- [ ] N+1 queries in transactions replaced with batch fetches
- [ ] `@Transactional` `rollbackFor` covers checked exceptions that should rollback
- [ ] Concurrent read-modify-write paths use pessimistic or optimistic locking
- [ ] Cross-service writes use Outbox or Saga, not XA/2PC
- [ ] Isolation level matches the anomaly being prevented
- [ ] Transaction boundaries align with domain aggregate boundaries

## Related Skills

- `spring-boot-engineer` — for implementing the corrected `@Transactional` patterns
- `microservices-architect` — when the issue is cross-service transaction design
- `circuit-breaker-tuner` — wide transactions compound cascading failure risk
- `connection-pool-tuner` — wide transactions can exhaust the connection pool
