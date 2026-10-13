# Transaction Anti-Patterns and Isolation Notes

## ACID reference

| Property | Means | Violated by |
|----------|-------|-------------|
| Atomicity | All changes commit or all roll back | Partial writes on failure |
| Consistency | DB constraints hold before and after | Bypassed validations; wrong ordering |
| Isolation | Concurrent transactions do not interfere | Missing locks; wrong isolation level |
| Durability | Committed data survives crashes | Missing fsync; premature ack |

## Isolation levels

| Level | Prevents | Allows | Use when |
|-------|----------|--------|----------|
| READ UNCOMMITTED | Nothing | Dirty reads, non-repeatable reads, phantoms | Almost never |
| READ COMMITTED | Dirty reads | Non-repeatable reads, phantoms | Default OLTP (PostgreSQL default) |
| REPEATABLE READ | Dirty + non-repeatable reads | Phantom reads | Financial aggregations, inventory checks |
| SERIALIZABLE | All anomalies | none | Booking, reservation, double-spend prevention |

Rows are the SQL-standard minimum. PostgreSQL REPEATABLE READ is snapshot isolation and does not allow phantom reads
(PostgreSQL docs, "Transaction Isolation", "Repeatable Read Isolation Level"). MySQL InnoDB REPEATABLE READ: consistent
nonlocking reads read the transaction's snapshot (no phantoms) and locking reads/UPDATE/DELETE take next-key locks, but a
locking read or DML acts on the latest committed rows, so mixing it with snapshot reads in one transaction can surface
rows outside the snapshot (MySQL Reference Manual, "Transaction Isolation Levels", "Consistent Nonlocking Reads",
"Phantom Rows").

## 1. Overly wide transaction

```java
// Bad: HTTP call inside the transaction holds locks
@Transactional
public void processOrder(Order order) {
    orderRepository.save(order);
    paymentGateway.charge(order);  // external HTTP, locks held during this
}

// Good: database work is atomic; side effects happen after commit
@Transactional
public Order saveOrder(Order order) { return orderRepository.save(order); }

public void processOrder(Order order) {
    Order saved = saveOrder(order);     // commits here
    paymentGateway.charge(saved);       // no locks held
}
```

## 2. Missing rollback on checked exceptions

```java
// Bad: IOException does NOT trigger rollback in Spring by default
@Transactional
public void importData(File file) throws IOException { ... }

// Good
@Transactional(rollbackFor = IOException.class)
public void importData(File file) throws IOException { ... }
```

## 3. Lost update (read inside write)

```java
// Bad: two threads read balance=100, both deduct 80, both save 20
@Transactional
public void deduct(Long accountId, BigDecimal amount) {
    Account account = accountRepo.findById(accountId).orElseThrow();
    account.setBalance(account.getBalance().subtract(amount));
    accountRepo.save(account);
}

// Good: pessimistic lock (SELECT FOR UPDATE), or @Version for optimistic
@Transactional
public void deduct(Long accountId, BigDecimal amount) {
    Account account = accountRepo.findByIdWithLock(accountId).orElseThrow();
    account.setBalance(account.getBalance().subtract(amount));
    accountRepo.save(account);
}
```

## 4. Cross-service writes

| Pattern | When |
|---------|------|
| Outbox | Publishing events reliably after a local commit |
| Saga (choreography) | Long-running processes; 2-3 services |
| Saga (orchestration) | Complex multi-step flows needing visibility; 4+ services |
| Two-Phase Commit | Avoid; only when strong consistency is non-negotiable and you control both systems |

## Checklist

- No external I/O (HTTP, email, Kafka publish) inside database transactions
- N+1 queries inside transactions replaced with batch fetches
- `rollbackFor` covers checked exceptions that should roll back
- Concurrent read-modify-write paths use pessimistic or optimistic locking
- Cross-service writes use Outbox or Saga, not XA/2PC
- Isolation level matches the anomaly being prevented
- Transaction boundaries align with aggregate boundaries
