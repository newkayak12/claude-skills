# Talking Between Services

## Choosing the style
Ask three questions per interaction.
1. Does the caller need the answer to continue? If no, publish a message.
2. Is the work longer than a user would wait, or does it span aggregates? Async.
3. Can the callee be down while the caller must still succeed? Then decouple with a broker or local replica.

| Need | Fit |
|---|---|
| Query with tight latency, caller blocks | HTTP/JSON or gRPC |
| Internal high-volume typed calls, streaming | gRPC |
| Public or browser-facing API | HTTP/JSON |
| Notify others that a fact happened | Domain event on a broker |
| Ask another service to do work, result later | Command message plus reply event |
| Many clients, varied field needs | GraphQL gateway in front |

## Synchronous rules
- Every call has a deadline shorter than the caller's own deadline; propagate the remaining budget.
- Cap user-facing request paths at about three hops.
- Calls are idempotent or carry an idempotency key.
- Never call out while holding a database transaction open.

Spring sketch with a declarative client:
```kotlin
@HttpExchange("/inventory")
interface InventoryClient {
    @GetExchange("/{sku}")
    fun stock(@PathVariable sku: String): StockView
}
```
Set connect and read timeouts on the underlying request factory; check the defaults, which may be long or unbounded depending on the client.

## Events
Two kinds, keep them apart:
- Notification: "OrderPlaced {id}" — small, consumer fetches details if needed.
- State transfer: carries the data consumers need, so they avoid calling back.

Guidance:
- Name events in past tense after business facts, not CRUD ("PaymentCaptured", not "PaymentUpdated").
- Version the schema; add optional fields only, or publish a new type.
- Consumers must tolerate duplicates and reordering within reason; dedupe by event id.
- Publish through a transactional outbox so the state change and the message commit together (see data.md).

## Choreography vs orchestration
- Choreography: each service reacts to events. Loose coupling, but the end-to-end flow is invisible; good for up to three or four steps.
- Orchestration: a coordinator holds the flow state and issues commands. Flow is explicit and testable; the coordinator must not absorb domain rules.
Move to orchestration when someone asks "where is the order stuck?" and nobody can answer.

## Contract hygiene
- Consumer-driven contract tests catch breaking changes before deploy.
- Additive change first, remove later; keep old and new for a published deprecation window.
- Errors: use a consistent problem body (RFC 9457 problem details) with a stable machine code.
- Pagination and filtering conventions shared across services reduce client surprise.
- gRPC: never reuse or renumber protobuf field numbers; reserve removed ones.

## Delivery semantics
Brokers give at-least-once in practice. "Exactly once" end to end is built from at-least-once delivery plus idempotent handlers. Ordering is only guaranteed within a partition or key; choose the key as the aggregate id.
