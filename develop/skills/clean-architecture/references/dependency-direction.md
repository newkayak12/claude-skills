# Dependency Direction in Practice

One rule drives everything here: a source file may import only from its own layer or from layers closer to the business rules. Run-time calls can still travel outward; only the compile-time arrows are restricted.

## Layers, from the middle out

| Layer | Holds | May import |
|-------|-------|-----------|
| Domain | Rules that would exist even without software support: invariants, value objects, pricing, state transitions | Language stdlib only |
| Application | One class per thing a user or system can ask the software to do; declares the ports it needs | Domain |
| Adapters | Translation code: HTTP handlers, JSON mappers, SQL gateways, message consumers | Application, Domain |
| Outer shell | Spring Boot, Postgres driver, Kafka client, the `main` wiring | Everything |

Layer count is not fixed. A small service may merge Domain and Application; what matters is that the arrow never reverses.

## Why a call can go out while the import goes in

A use case must read an order from storage, yet it may not import the storage class. The use case declares an interface; the adapter implements it; the shell hands the adapter to the use case at start-up.

```kotlin
// application layer
interface OrderStore {
    fun find(id: OrderId): Order?
    fun save(order: Order)
}

class CancelOrder(private val store: OrderStore) {
    fun execute(cmd: CancelOrderCommand): CancelOrderResult {
        val order = store.find(cmd.orderId) ?: return CancelOrderResult.NotFound
        order.cancel(cmd.reason)
        store.save(order)
        return CancelOrderResult.Cancelled(order.id)
    }
}

// adapter layer
@Repository
class JpaOrderStore(private val jpa: OrderJpaRepository) : OrderStore {
    override fun find(id: OrderId) = jpa.findById(id.value).map { it.toDomain() }.orElse(null)
    override fun save(order: Order) { jpa.save(order.toRow()) }
}
```

Run-time: use case calls adapter. Compile-time: adapter imports the use case's interface. That reversal is the whole technique.

## What may cross a boundary

Data crossing inward or outward should be shaped by the layer that receives it, not by the sender.

- Allowed: plain immutable data classes, primitives, enums owned by the inner layer.
- Not allowed: JPA entities, `ResponseEntity`, `HttpServletRequest`, Jackson annotations on domain types, row objects from a query library.

Reason: if an inner type carries an outer type's shape, any change to the outer detail (a column rename, a new serialization library) forces an edit inside the rules.

Typical mapping chain for one request:

```
HTTP body --(controller)--> Command --(use case)--> Domain object
Domain object --(use case)--> Result --(controller)--> HTTP body
Domain object <--(store adapter)--> table row
```

Mapping looks like duplication. It is the price of keeping each shape free to change; skip it only where two shapes are truly identical and owned by the same layer.

## Ways frameworks pull dependencies inward

| Symptom | Why it breaks the rule | Fix |
|---------|------------------------|-----|
| `@Entity`, `@Column` on the domain class | Domain now imports persistence | Separate row class in the adapter; map both ways |
| `@Transactional` / `@Service` inside a pure rule class | Rules need a container to run | Keep annotations on use cases or a thin wrapper, never on entities |
| Use case takes `Pageable`, returns `Page<T>` | Spring Data leaks into application | Own paging types in the application layer |
| Controller returns domain objects directly | Wire format welded to domain | Response DTO per endpoint |
| Domain validation relies on Bean Validation | Rule enforced only when a framework runs | Validate in constructors / factory functions |

Framework annotations on application-layer classes are a judgement call; on domain classes they are a violation.

## Keeping the inside clean

Checks worth running regularly:

1. Search the domain and application source sets for imports of `org.springframework`, `jakarta.persistence`, `com.fasterxml`, driver packages. The list should be empty or nearly so.
2. Run the rule tests without starting a container. If a test needs `@SpringBootTest`, the rule is entangled.
3. Look at the module graph: with Gradle, put layers in separate modules so an illegal import fails to compile.
4. Add an architecture test (ArchUnit or Konsist) asserting "classes in `..domain..` do not depend on `..adapter..`".

## Inverting one violation: four moves

1. Locate the inner class that names an outer class.
2. Write an interface in the inner layer expressing what the inner class actually needs, in domain vocabulary.
3. Make the outer class implement it.
4. Pass the outer instance in from the wiring code; delete the old import.

Worked case: `PlaceOrder` calls `StripeClient.charge(...)`. Define `PaymentGateway.charge(amount: Money, method: PaymentMethodRef): ChargeResult` in the application layer, implement `StripePaymentGateway` in an adapter package, and bind it in a `@Configuration` class. `PlaceOrder` tests now use a three-line fake.
