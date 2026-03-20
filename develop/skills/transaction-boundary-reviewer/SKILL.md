---
name: transaction-boundary-reviewer
description: |
  Transaction boundary design review specialist — evaluates ACID properties, isolation levels, distributed transaction patterns (saga, outbox), and common anti-patterns like overly wide transactions or missing rollback. Use when the user mentions "트랜잭션 경계", "transaction boundary", "@Transactional", "분산 트랜잭션", "saga", "트랜잭션 설계", or is asking about data consistency, rollback behavior, or how to coordinate writes across services. Trigger this skill even if the user just says "데이터 일관성이 깨지는 것 같아" or "how do I keep these two writes atomic?" without using the word transaction.
---

# Transaction Boundary Reviewer

Transaction boundaries define what changes succeed or fail together. A boundary too wide wastes lock time and couples unrelated concerns. A boundary too narrow leaves data in inconsistent intermediate states. Getting boundaries right is the difference between a system that degrades gracefully and one that silently corrupts data.

## ACID Properties — What You Are Actually Protecting

Before reviewing boundaries, confirm which property is at risk:

| Property | Means | Violated By |
|----------|-------|-------------|
| **Atomicity** | All changes commit or all roll back | Partial writes on failure |
| **Consistency** | DB constraints hold before and after | Bypassing validations; wrong ordering |
| **Isolation** | Concurrent transactions do not interfere | Missing locks; wrong isolation level |
| **Durability** | Committed data survives crashes | Missing fsync; premature ack |

Most transaction boundary bugs are atomicity or isolation problems. Ask: "If this operation fails halfway through, what does the database look like?"

## Isolation Levels

Higher isolation means fewer anomalies but more lock contention. Choose the lowest level that prevents the anomaly you care about.

| Level | Prevents | Allows | Use When |
|-------|----------|--------|---------|
| `READ UNCOMMITTED` | Nothing | Dirty reads, non-repeatable reads, phantoms | Almost never |
| `READ COMMITTED` | Dirty reads | Non-repeatable reads, phantoms | Default for most OLTP (PostgreSQL default) |
| `REPEATABLE READ` | Dirty + non-repeatable reads | Phantom reads | Financial aggregations, inventory checks |
| `SERIALIZABLE` | All anomalies | — | Correctness-critical: booking, reservation, double-spend prevention |

PostgreSQL's `REPEATABLE READ` actually prevents phantoms too (via MVCC snapshot). MySQL InnoDB's `REPEATABLE READ` uses gap locks.

## Common Anti-Patterns

### 1. Overly Wide Transactions

**Symptom:** `@Transactional` on a service method that calls external HTTP APIs, sends emails, or performs expensive computations.

**Why it is dangerous:** The transaction holds database locks for the entire duration of the external call. Under load, this causes lock waits, deadlocks, and pool exhaustion.

```java
// Bad — HTTP call inside transaction holds locks
@Transactional
public void processOrder(Order order) {
    orderRepository.save(order);
    paymentGateway.charge(order);  // external HTTP call — locks held during this!
    emailService.sendConfirmation(order);
}

// Good — database work is atomic; side effects happen after commit
@Transactional
public Order saveOrder(Order order) {
    return orderRepository.save(order);
}

public void processOrder(Order order) {
    Order saved = saveOrder(order);           // transaction commits here
    paymentGateway.charge(saved);             // no locks held
    emailService.sendConfirmation(saved);
}
```

**Rule:** External I/O (HTTP, email, message publish) must not happen inside a database transaction unless using the Outbox pattern.

### 2. N+1 Queries Inside a Transaction

Each query extends the lock hold time. 1000 items = 1000 queries inside one transaction.

```java
// Bad — 1 + N queries inside transaction
@Transactional
public void recalculateAll(List<Long> accountIds) {
    for (Long id : accountIds) {
        Account account = accountRepo.findById(id).orElseThrow(); // N queries
        account.recalculate();
        accountRepo.save(account);
    }
}

// Good — batch fetch, then update
@Transactional
public void recalculateAll(List<Long> accountIds) {
    List<Account> accounts = accountRepo.findAllById(accountIds); // 1 query
    accounts.forEach(Account::recalculate);
    accountRepo.saveAll(accounts);
}
```

### 3. Missing Rollback on Checked Exceptions

`@Transactional` does not roll back for checked exceptions by default in Spring — only for `RuntimeException` and `Error`.

```java
// Bad — IOException does NOT trigger rollback
@Transactional
public void importData(File file) throws IOException {
    Record record = parseFile(file);     // may throw IOException
    recordRepo.save(record);             // committed even if parseFile partially ran
}

// Good — explicit rollback declaration
@Transactional(rollbackFor = IOException.class)
public void importData(File file) throws IOException { ... }
```

### 4. Distributed Transaction Anti-Patterns

Trying to use a single database transaction across two microservices or two databases requires XA/2PC — operationally complex, slow, and coupling. Instead:

| Pattern | When to Use |
|---------|------------|
| **Outbox** | Publishing events reliably after a local commit |
| **Saga (choreography)** | Long-running processes; 2–3 services |
| **Saga (orchestration)** | Complex multi-step flows needing visibility; 4+ services |
| **Two-Phase Commit** | Avoid; only when strong consistency is non-negotiable and you control both systems |

For full Outbox and Saga implementations, read `references/distributed-patterns.md`.

### 5. Read Inside Write Transaction (Lost Update)

```java
// Bad — race condition: two threads read balance=100, both deduct 80, both save 20
@Transactional
public void deduct(Long accountId, BigDecimal amount) {
    Account account = accountRepo.findById(accountId).orElseThrow();
    if (account.getBalance().compareTo(amount) < 0) throw new InsufficientFunds();
    account.setBalance(account.getBalance().subtract(amount));
    accountRepo.save(account);
}

// Good — pessimistic lock prevents concurrent deduction
@Transactional
public void deduct(Long accountId, BigDecimal amount) {
    Account account = accountRepo.findByIdWithLock(accountId).orElseThrow(); // SELECT FOR UPDATE
    if (account.getBalance().compareTo(amount) < 0) throw new InsufficientFunds();
    account.setBalance(account.getBalance().subtract(amount));
    accountRepo.save(account);
}
```

## Review Checklist

- [ ] No external I/O (HTTP, email, Kafka publish) inside database transactions
- [ ] N+1 queries in transactions replaced with batch fetches
- [ ] `@Transactional` `rollbackFor` covers checked exceptions that should rollback
- [ ] Concurrent read-modify-write paths use pessimistic or optimistic locking
- [ ] Cross-service writes use Outbox or Saga, not XA/2PC
- [ ] Isolation level matches the anomaly being prevented (not defaulted blindly)
- [ ] Transaction boundaries align with domain aggregate boundaries
- [ ] Long-running transactions are broken into smaller units with compensation
