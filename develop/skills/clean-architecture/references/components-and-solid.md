# Components and Class-Level Design Principles

## Component cohesion: what to group

- **Release equivalence**: what you version and publish together should make sense as a unit. A module with a release note you can summarise in one sentence is coherent.
- **Common closure**: put together what changes together. A pricing rule change should touch one module, not five. This is SRP at module scale.
- **Common reuse**: do not force consumers to depend on things they do not use. If a module's users each need only part of it, split it.

These pull against each other. Early in a project favour common closure (easier to develop); as consumers appear, shift towards reuse-driven splits.

## Component coupling: how to connect

- **Acyclic dependencies**: the module graph must be a DAG. A cycle makes the members one inseparable unit. Break one by inverting a single edge with an interface owned by the component that uses it, or by extracting the shared piece into a new component both depend on. Gradle rejects project cycles outright, which is a useful ally.
- **Stable dependencies**: depend towards modules that change less. A module with many dependants is hard to change and thus "stable"; a volatile module should not be depended on by a stable one.
- **Stable abstractions**: stable modules should be mostly abstract (interfaces, sealed types), so their stability does not freeze behaviour. Domain and application layers sit there; adapters are concrete and volatile.

Instability metric per module: `I = outgoing / (incoming + outgoing)`; abstractness `A = abstract types / all types`. Healthy modules sit near `A + I = 1`. Far below the line is rigid and concrete; far above is abstract with nobody using it.

Practical workflow: list modules, mark who depends on whom, find cycles, check that arrows go from unstable to stable, and move interfaces to the side that should own them.

Anti-patterns: a `common`/`utils` module everyone imports and everyone edits; a shared `model` module holding both domain and wire types; feature modules that import each other's internals.

## SOLID, with Kotlin examples

### Single responsibility
A class should have one stakeholder whose needs cause it to change. If finance and operations both request changes to the same class, split it.
Indicators: the name needs "And", tests need many unrelated fixtures, merges conflict on the same file across teams.

### Open for extension, closed for modification
New variants should arrive as new classes, not edited `when` blocks.

```kotlin
interface ShippingPolicy { fun cost(order: Order): Money }
class FlatRate(private val fee: Money) : ShippingPolicy { override fun cost(order: Order) = fee }
class FreeOver(private val threshold: Money) : ShippingPolicy {
    override fun cost(order: Order) = if (order.total() >= threshold) Money.ZERO else Money(4_000)
}
```

A `when (method)` repeated in several places is the signal to introduce the interface. One occurrence is usually fine.

### Substitutability
Any subtype must honour the contract callers rely on: no stronger preconditions, no weaker postconditions, no surprise exceptions. Classic trap: a `Square` that overrides `width` to also set `height` breaks callers assuming independent sides. Check by asking "would a caller using only the base type be surprised?" Interfaces whose implementations throw `NotImplementedError` fail this test.

### Interface segregation
Many narrow interfaces over one broad one.

```kotlin
interface OrderReader { fun find(id: OrderId): Order? }
interface OrderWriter { fun save(order: Order) }
// a reporting use case needs only OrderReader
```

Narrow ports shrink fakes and make each use case's real needs visible.

### Dependency inversion
High-level policy owns the abstraction; low-level detail implements it. The interface lives in the policy's package, not alongside the implementation. Violation signs: `import com.stripe...` in a rule class, `new`-ing a concrete collaborator inside a use case, a domain test requiring a network. Volatile concrete classes are the ones to hide; stable ones (`String`, `List`) need no inversion.
