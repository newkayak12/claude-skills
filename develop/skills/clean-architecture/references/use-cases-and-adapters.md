# Use Cases, Entities and the Adapter Ring

## Entities

An entity owns rules that hold regardless of which screen or API triggered them.

Traits of a healthy one:
- Behaviour lives with the data: `order.addLine(...)` enforces the line limit, callers do not check it.
- State changes go through methods that protect invariants; no public setters.
- No imports from persistence, web, or messaging libraries.
- Identity and equality are explicit (id for entities, structural for value objects).

```kotlin
class Order private constructor(val id: OrderId, private val lines: MutableList<OrderLine>, status: Status) {
    var status = status; private set

    fun addLine(sku: Sku, qty: Int, price: Money) {
        check(status == Status.DRAFT) { "lines can only change on a draft" }
        require(qty in 1..99)
        lines += OrderLine(sku, qty, price)
    }
    fun total(): Money = lines.fold(Money.ZERO) { acc, l -> acc + l.subtotal() }
    fun cancel(reason: String) { check(status != Status.SHIPPED); status = Status.CANCELLED }
}
```

Smells: an anemic class of getters/setters with all logic in a `*Service`; entity methods that call a repository; an entity that is simultaneously the JSON shape.

## Use cases

A use case is one application-level operation: load what is needed, ask entities to act, persist, report. It holds sequencing, not business formulas.

Rules of thumb:
- One class per operation (`PlaceOrder`, `CancelOrder`); a `OrderService` with fifteen methods is a layer in disguise.
- Input is a command/query object; output is a result type. Neither mentions HTTP, SQL, or UI.
- Failure is part of the result (sealed type) when callers must react to it; exceptions are for what should not happen.
- Transaction boundary sits around `execute`, usually applied by a wrapper or the framework in the shell.

```kotlin
sealed interface PlaceOrderResult {
    data class Placed(val id: OrderId) : PlaceOrderResult
    data class OutOfStock(val skus: List<Sku>) : PlaceOrderResult
}
```

### Return value or output port?

- Returning a result is simplest and fine for request/response.
- An output port (the use case calls `presenter.present(result)`) pays off when one operation yields several deliveries, streams progress, or must stay unaware of who renders it.

Start with returns; move to ports when a second consumer appears.

### Composition

When a flow needs two operations, prefer a thin orchestrating use case that depends on the two, or on shared domain objects. Do not have use cases call each other's controllers, and avoid chains deeper than one level.

### Testing

Construct the use case with in-memory fakes of its ports and assert on the result and on what the fake saw. No container, no database, millisecond runtime.

## Adapters

### Inbound (driving)

Controllers, consumers, schedulers. Job: parse the outside format, build a command, call the use case, convert the result.

```kotlin
@RestController
class OrderController(private val cancel: CancelOrder) {
    @DeleteMapping("/orders/{id}")
    fun cancel(@PathVariable id: String, @RequestBody body: CancelBody): ResponseEntity<Any> =
        when (val r = cancel.execute(CancelOrderCommand(OrderId(id), body.reason))) {
            is CancelOrderResult.Cancelled -> ResponseEntity.noContent().build()
            CancelOrderResult.NotFound -> ResponseEntity.notFound().build()
        }
}
```

No branching on business conditions belongs here; only on result variants.

### Outbound (driven)

Gateways implement ports: SQL store, HTTP client to another service, mail sender. Their mapping code is the only place that knows column names or remote field names. For PostgreSQL, expect row classes, `JdbcTemplate`/JPA/jOOQ queries, and a `toDomain()`/`toRow()` pair.

### Presenters

Where output needs formatting (locale, currency, pagination envelopes), a presenter converts the result into a view model so neither use case nor view carries that logic.

## Frameworks and databases are details

- Spring, Ktor, Hibernate, Postgres are chosen late and replaceable at a cost proportional to how far they reach. Keep that reach to the outer ring.
- A framework asks for deep commitment (inherit this, annotate that). Accept it in the shell; do not let inner classes marry it.
- Persistence: the use case sees "find by id, save". Whether that is JPA, jOOQ, or a document store is the adapter's business. Query-heavy read paths may bypass the domain and use a dedicated read port returning flat projections.
- Web: the same use case should be callable from a REST endpoint, a Kafka listener, and a test.

### Wrapping third-party libraries

Wrap when the library is volatile, needs substitution in tests, or leaks vendor vocabulary. Do not wrap stable, ubiquitous utilities (collections, logging facades, time). A wrapper is an interface in the inner ring, a class in the outer ring, a fake in tests.

## Wiring

One place assembles objects: the Spring `@Configuration` classes or a hand-written `main`. Entities and use cases never look up their collaborators; they receive them via constructor. Variation by environment (local in-memory store, production Postgres) is just a different binding set.
