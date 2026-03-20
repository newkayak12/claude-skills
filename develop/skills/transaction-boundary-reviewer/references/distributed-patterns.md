# Distributed Transaction Patterns — Implementation Reference

Detailed implementation guidance for the Outbox and Saga patterns.

---

## Outbox Pattern

The Outbox solves the dual-write problem: "I committed to the DB, but failed to publish to Kafka (or vice versa)."

### How It Works

```
1. Business write + event record → same DB transaction (atomic)
2. Outbox relay reads committed events → publishes to message broker
3. Relay marks events as published (or deletes them)
```

The relay delivers at-least-once. Consumers must be idempotent.

### Schema

```sql
CREATE TABLE outbox (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    aggregate_type TEXT NOT NULL,
    aggregate_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    published_at TIMESTAMPTZ
);
```

### Application Code

```java
// Inside a single @Transactional method:
@Transactional
public Order placeOrder(OrderRequest request) {
    Order order = orderRepository.save(Order.from(request));

    // Write event to outbox in the same transaction
    outboxRepository.save(OutboxEvent.of(
        "Order", order.getId().toString(),
        "OrderPlaced", objectMapper.writeValueAsString(order)
    ));

    return order;
    // Both writes commit atomically — or both roll back
}
```

### Relay Options

- **Polling relay**: A scheduled job queries `WHERE published_at IS NULL`, publishes, marks published. Simple but adds DB load.
- **Debezium (CDC)**: Streams the outbox table's WAL changes to Kafka without polling. No additional DB queries. Preferred for high-throughput.

### Idempotency Requirement

Because the relay delivers at-least-once, consumers must handle duplicate events. Use the event `id` as an idempotency key: if you have already processed event `abc-123`, skip it.

```java
if (processedEventRepository.existsById(event.getId())) {
    return; // already handled
}
// process event...
processedEventRepository.save(new ProcessedEvent(event.getId()));
```

---

## Saga Pattern

A Saga is a sequence of local transactions, each publishing an event that triggers the next step. If any step fails, compensating transactions undo the previous steps.

### Choreography Saga (Event-Driven)

Each service listens for events and reacts. No central coordinator.

```
Order Service: create order (PENDING) → publish OrderCreated
  ↓
Payment Service: charge card → publish PaymentCharged
  ↓
Inventory Service: reserve items → publish InventoryReserved
  ↓
Order Service: set order to CONFIRMED
```

On failure at any step, compensating events flow backward:
```
InventoryService failed → publish InventoryReservationFailed
  ↓
Payment Service: refund card → publish PaymentRefunded
  ↓
Order Service: set order to CANCELLED
```

**Pros:** Loose coupling; no single point of failure.
**Cons:** Hard to visualize end-to-end flow; debugging requires correlating events across services.

### Orchestration Saga (Central Coordinator)

A dedicated saga orchestrator sends commands to each service and waits for replies.

```java
// Saga orchestrator step definition (Axon Framework style)
@Saga
public class OrderSaga {

    @StartSaga
    @SagaEventHandler(associationProperty = "orderId")
    public void on(OrderCreatedEvent event) {
        commandGateway.send(new ChargePaymentCommand(event.getOrderId(), event.getAmount()));
    }

    @SagaEventHandler(associationProperty = "orderId")
    public void on(PaymentChargedEvent event) {
        commandGateway.send(new ReserveInventoryCommand(event.getOrderId(), event.getItems()));
    }

    @SagaEventHandler(associationProperty = "orderId")
    public void on(InventoryReservedEvent event) {
        commandGateway.send(new ConfirmOrderCommand(event.getOrderId()));
        SagaLifecycle.end();
    }

    @SagaEventHandler(associationProperty = "orderId")
    public void on(InventoryReservationFailedEvent event) {
        commandGateway.send(new RefundPaymentCommand(event.getOrderId()));
    }

    @SagaEventHandler(associationProperty = "orderId")
    public void on(PaymentRefundedEvent event) {
        commandGateway.send(new CancelOrderCommand(event.getOrderId()));
        SagaLifecycle.end();
    }
}
```

**Pros:** Visible flow; easier to trace and debug; orchestrator owns the state machine.
**Cons:** Orchestrator is a coupling point; needs its own persistence.

### Idempotency Is Mandatory

Events can be replayed; every handler must be safe to call multiple times with the same event.

```java
@EventHandler
public void on(PaymentChargedEvent event) {
    if (paymentAlreadyRecorded(event.getPaymentId())) {
        return; // idempotent — safe to ignore duplicates
    }
    recordPayment(event);
}
```

### Choosing Between Choreography and Orchestration

| Factor | Choreography | Orchestration |
|--------|-------------|---------------|
| Number of steps | 2–3 | 4+ |
| Need for visibility | Low | High |
| Team ownership | Single team | Multiple teams |
| Debugging priority | Less critical | Critical |

For simple two-service coordination, choreography is sufficient. For multi-step business processes that need audit trails and operational visibility, use orchestration.

---

## Pattern Comparison

| Pattern | Consistency | Complexity | Use When |
|---------|------------|------------|---------|
| **Outbox** | Eventual, at-least-once | Low | Publishing events reliably after a local commit |
| **Saga (choreography)** | Eventual, compensating | Medium | Long-running processes with compensations; 2–3 services |
| **Saga (orchestration)** | Eventual, compensating | Higher | Complex multi-step flows needing visibility; 4+ services |
| **Two-Phase Commit** | Strong | Very High | Avoid; only when strong consistency is non-negotiable and you control both systems |
