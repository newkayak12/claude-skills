# Entities, Value Objects, Aggregates

## Entity

Defined by continuity of identity, not by current attribute values.

- Test: if every attribute changed, would the business still call it the same thing? Then it is an entity.
- Identity options: database-generated (simple, unknown until saved), application-generated UUID/ULID (known at creation, good for events), natural key (only if truly stable).
- Equality is by identity; keep `equals`/`hashCode` on the id only.
- Behavior lives on the entity; avoid public setters that bypass rules.

## Value object

Defined entirely by its attributes; no identity; immutable.

- Test: can two instances with equal fields be swapped without anyone caring?
- Changes produce a new instance.
- Validate in the constructor so an invalid value cannot exist.

```kotlin
@JvmInline value class Email(val value: String) {
    init { require("@" in value) { "invalid email" } }
}

data class Money(val amount: BigDecimal, val currency: Currency) {
    operator fun plus(o: Money): Money {
        require(currency == o.currency)
        return Money(amount + o.amount, currency)
    }
}
```

Good candidates: money, quantity with unit, date range, address, identifiers. They replace primitive obsession and carry their own rules.

Same concept can be either: an address is a value for shipping, an entity for a postal service.

## Aggregate

A cluster of objects treated as one unit for change, with a single root through which all access passes. Its job is to protect invariants within one transaction.

Design rules:

1. Start from the invariant. Only objects that must be consistent together belong together.
2. Prefer small aggregates, often a root plus a few value objects.
3. Hold references to other aggregates by id.
4. One transaction changes one aggregate; propagate the rest through events and accept eventual consistency.
5. Only the root is held persistently from outside; outside code may hold a transient reference to an inner entity for one operation, but never keeps it.

```kotlin
class Order(val id: OrderId, val customerId: CustomerId) {
    private val lines = mutableListOf<OrderLine>()
    var status = OrderStatus.DRAFT; private set

    fun addLine(sku: Sku, qty: Int, price: Money) {
        check(status == OrderStatus.DRAFT) { "order is locked" }
        require(qty > 0)
        lines += OrderLine(sku, qty, price)
    }
    fun place(): OrderPlaced {
        check(lines.isNotEmpty()) { "empty order" }
        status = OrderStatus.PLACED
        return OrderPlaced(id, total())
    }
    fun total() = lines.map { it.subtotal }.reduce(Money::plus)
}
```

## Sizing check

- Do concurrent users collide on the same aggregate? It is probably too big; split by invariant.
- Is a rule spanning two aggregates really immediate? Ask whether the business tolerates seconds of delay.
- Loading the root pulls thousands of rows? Reconsider membership.

## Mistakes

- Entities as getter/setter bags with rules in services (anemic model).
- Object graph navigation across aggregates (`order.customer.address`).
- Updating several aggregates in one transaction "just this once".
- Exposing mutable internal collections.
