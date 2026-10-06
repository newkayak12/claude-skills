# Repositories and Factories

## Repository

Makes aggregate persistence look like a collection of aggregates, expressed in domain terms.

- One repository per aggregate root, never per table or inner entity.
- Interface lives in the domain; the implementation in infrastructure.
- Methods speak the language: `findOverdue(asOf)` rather than `findByStatusAndDueDateLessThan`.
- Returns fully built aggregates (or ids/read models for queries), not persistence entities leaking JPA concerns.

```kotlin
// domain
interface OrderRepository {
    fun nextId(): OrderId
    fun get(id: OrderId): Order
    fun save(order: Order)
    fun findOpenFor(customer: CustomerId): List<Order>
}

// infrastructure
@Repository
class JpaOrderRepository(private val jpa: OrderJpaRepository, private val map: OrderMapper) : OrderRepository {
    override fun get(id: OrderId) = map.toDomain(jpa.findById(id.value).orElseThrow())
    override fun save(order: Order) { jpa.save(map.toRecord(order)) }
    /* ... */
}
```

Two styles: collection-like (change tracked, no explicit save, as in an ORM session) and save-oriented (explicit `save`). The second is more honest with Spring Data and mappers.

Reads for screens and reports can bypass repositories with dedicated query models; the repository exists for loading aggregates to run commands.

Pitfalls: generic `Repository<T>` with ad-hoc finders, exposing `EntityManager`/query builders to the domain, lazy collections that escape the transaction, repositories containing business rules.

## Factory

Builds aggregates that are valid from the first moment, when construction is complex enough that the caller should not know the steps.

| Form | Use |
|---|---|
| Companion/static method on the aggregate | Normal case: `Order.start(customer)` |
| Method on another aggregate | The creator owns context, e.g. `catalog.listProduct(...)` |
| Standalone factory | Needs collaborators or several inputs |

```kotlin
companion object {
    fun fromQuote(id: OrderId, quote: AcceptedQuote): Order =
        Order(id, quote.customerId).apply { quote.items.forEach { addLine(it.sku, it.qty, it.price) } }
}
```

Creation vs. reconstitution: creation enforces rules and may raise events; reconstitution from storage must restore state without re-running creation rules or raising events again. Keep these as separate entry points.

## Specification

A named, composable predicate for a business rule, usable for validation, selection and construction.

```kotlin
fun interface Spec<T> { fun isSatisfiedBy(t: T): Boolean }
infix fun <T> Spec<T>.and(o: Spec<T>) = Spec<T> { isSatisfiedBy(it) && o.isSatisfiedBy(it) }

val overdue = Spec<Invoice> { it.dueDate < LocalDate.now() }
```

Use in-memory for rules; translate to queries (JPA Specification, jOOQ conditions) in infrastructure only if needed for selection, so the domain stays free of persistence types.

## Relation to ports and adapters

Repository interface = outbound port in the domain; the Spring/JPA class = adapter. Dependencies point inward, so the domain can be tested with an in-memory implementation.
