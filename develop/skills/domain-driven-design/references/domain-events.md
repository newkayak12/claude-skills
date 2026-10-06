# Domain Events

A domain event records a fact the business cares about, already true: `InvoicePaid`, not `UpdateInvoice`.

## Shape

- Name: past tense, specific (`ShipmentDispatched` over `ShipmentUpdated`).
- Immutable data class with event id, occurrence time, aggregate id, plus only the data consumers need.
- Prefer facts and ids over entire object snapshots, unless consumers should not call back.

```kotlin
data class OrderPlaced(
    val eventId: UUID = UUID.randomUUID(),
    val occurredAt: Instant = Instant.now(),
    val orderId: OrderId,
    val total: Money,
)
```

## Raising

The aggregate decides that something happened, so it records the event; infrastructure publishes it after commit.

```kotlin
abstract class AggregateRoot {
    private val pending = mutableListOf<Any>()
    protected fun raise(e: Any) { pending += e }
    fun pullEvents(): List<Any> = pending.toList().also { pending.clear() }
}
```

With Spring Data, `AbstractAggregateRoot` / `@DomainEvents` offers the same idea; `@TransactionalEventListener(phase = AFTER_COMMIT)` handles in-process subscribers.

## Reliable publishing: outbox

Writing the state and sending to a broker are two systems; one can fail. Insert the event into an `outbox` table in the same transaction as the state change; a relay reads the table and publishes. Delivery becomes at-least-once.

```sql
CREATE TABLE outbox (
  id uuid PRIMARY KEY, aggregate_id text NOT NULL, type text NOT NULL,
  payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz
);
```

## Consumers

- Handlers must be idempotent: store processed event ids or make the effect naturally repeatable.
- Ordering is guaranteed only within a partition/key; key by aggregate id when order matters.
- Poison messages go to a dead-letter destination with alerting rather than blocking the stream.
- Multi-step workflows across aggregates: a saga or process manager reacts to events and issues commands, with compensating actions for failure.

## Internal vs. integration events

Internal events stay inside a context and may change freely. Integration events cross contexts and are a public contract: version them, keep them coarse, and map from the internal one at the boundary so internals can evolve.

## Style options

| Style | Idea |
|---|---|
| Notification | Event says something happened; consumers fetch details |
| State transfer | Event carries enough data that consumers keep a local copy |
| Event sourcing | Events are the stored truth; state is a fold over them |

Event sourcing adds replay, audit and temporal queries but also schema evolution (upcasting), snapshots for long streams, and harder ad-hoc querying. Adopt it where history is a requirement, not by default.
