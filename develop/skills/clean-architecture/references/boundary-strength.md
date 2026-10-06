# Boundaries: Strength, Cost, and Testing

A boundary is a line across which one side does not know the other's details. Drawing it costs code; skipping it costs flexibility. The craft is choosing strength per line.

## Full boundary

Two interfaces, one per direction, plus matching data structures on each side:

```
Caller --> [InboundPort]  UseCase  [OutboundPort] --> Implementation
```

Characteristics:
- Independent compilation units (separate Gradle modules or at least packages with enforced rules).
- Deployable separately if ever required.
- Highest ceremony: ports, data classes, mappers.

Use at lines expected to see real churn: persistence engine, external payment provider, UI technology.

## Partial boundaries

Where a full line is premature, keep the option open cheaply.

| Form | What exists | What you give up |
|------|-------------|------------------|
| Facade | Single entry class hiding the internals; no interfaces behind it | Compile-time prevention of reaching around it |
| Strategy only | Interface on one side, caller depends on it; no reverse interface | Symmetry; the implementer may still import caller types |
| Same-module separation | Packages and interfaces ready to split | Enforcement; discipline substitutes for the compiler |

Partial boundaries decay if nobody guards them. Add an architecture test so splitting later stays a move, not a rewrite. Revisit when pain appears: two teams colliding, a second implementation needed, a dependency dragging build time.

## Crossing a boundary

- Control goes outward to do work and returns; dependencies point inward.
- What crosses is a simple structure owned by the receiving layer.
- Mapping code lives on the outer side of the line (the outer layer adapts to the inner contract).

## Humble object

When behaviour is hard to test because it touches a screen, a socket, or a database, split it in two: a humble part with almost no logic that does the hard-to-test thing, and a testable part that decides what to do.

| Hard-to-test thing | Testable half | Humble half |
|--------------------|---------------|-------------|
| Rendering a page | Presenter producing a view model | Template / component binding it |
| Database access | Use case deciding what to store | Store adapter issuing the SQL |
| Sending notifications | Policy: who, when, which template | Sender calling the SMTP/push API |
| Message consumption | Handler that interprets an event | Listener that deserializes and forwards |

Test the left column heavily; the right column needs only a thin integration test, perhaps against Testcontainers Postgres.

## Services as boundaries

A network hop is not automatically an architectural boundary. Two services that must deploy in lockstep and share a schema are one component wearing two process hats. A service boundary is real only if its contract is a narrow API with independent versioning.

Whatever the deployment shape, each service still needs its own inner structure: use cases, ports, adapters. Splitting a monolith without that just distributes the tangle.

## Test boundary

Tests are the outermost component: everything depends on production code, nothing depends on tests.

- Test through the same entry points production callers use. Reaching into private state or mocking concrete collaborators ties tests to structure.
- Structure-coupled tests make refactoring expensive; the suite then punishes the exact changes architecture wants.

```kotlin
// brittle: knows how the use case is built internally
verify(exactly = 1) { internalHelper.recalculate(any()) }

// robust: speaks only through the public contract
val result = placeOrder.execute(command)
assertThat(result).isInstanceOf<PlaceOrderResult.Placed>()
assertThat(fakeStore.saved.single().total()).isEqualTo(Money(30))
```

- Provide test-only ports/fakes in the test source set; never add production hooks "for testing".

## The composition root

The wiring component is the dirtiest in the system: it knows every concrete class. That is acceptable because nothing depends on it.

- Keep it free of business decisions; it chooses implementations only.
- Multiple entry configurations are normal: production, local with in-memory store, integration test with Testcontainers.
- With Spring, `@Configuration` and profiles play this role; a DI container is a tool for the root, and inner classes should not be aware of it (no service locators, no `ApplicationContext` injections).
