# DSLs and Everyday Idioms

## Building a type-safe DSL

A DSL is a function that takes a lambda with receiver, creates an object, applies the lambda to it, and returns the result.

```kotlin
@DslMarker annotation class RouteDsl

@RouteDsl
class Endpoint { var path = ""; var timeoutMs = 3_000 }

@RouteDsl
class GatewayBuilder {
    private val endpoints = mutableListOf<Endpoint>()
    fun endpoint(block: Endpoint.() -> Unit) { endpoints += Endpoint().apply(block) }
    fun build(): List<Endpoint> = endpoints.toList()
}

fun gateway(block: GatewayBuilder.() -> Unit): List<Endpoint> = GatewayBuilder().apply(block).build()

val routes = gateway {
    endpoint { path = "/orders"; timeoutMs = 500 }
    endpoint { path = "/users" }
}
```

Design notes:
- `@DslMarker` stops an inner lambda from calling methods of an outer receiver implicitly, so nested blocks stay unambiguous.
- Keep the builder mutable and the result immutable; expose only `build()`.
- Add `invoke` or `operator fun String.unaryPlus()` only when the call site reads clearly better.
- Mark small builder entry points `inline` when the lambda is hot and does not escape.

## Extension functions

- Resolved statically by the declared type, not the runtime type, and can never access private members.
- A member always wins over an extension with the same signature.
- Use them to add domain vocabulary at the edge (`fun Instant.isExpired(now: Instant)`), and to keep a class free of unrelated helpers. Place them in the file next to the type or in a `-Ext` file of the module that owns the concept.
- Extension properties have no backing field; they must compute from existing state.

## Scope functions

| Function | Receiver as | Returns | Typical use |
|----------|-------------|---------|-------------|
| `let` | `it` | lambda result | transform a nullable: `x?.let { parse(it) }` |
| `run` | `this` | lambda result | compute a value using several members |
| `with(obj)` | `this` | lambda result | group calls on an existing object |
| `apply` | `this` | the receiver | configure an object after construction |
| `also` | `it` | the receiver | side effect such as logging, in a chain |

Avoid nesting more than one level; if you need `it` and `this` from different scopes, name the lambda parameter or use a plain local variable.

## Delegation

```kotlin
class Settings(private val store: Map<String, String>) {
    val host: String by store              // map-backed property
    val region: String by lazy { detectRegion() }   // thread-safe by default
    var retries: Int by Delegates.observable(3) { _, old, new -> log("retries $old -> $new") }
}
```

- `by lazy` defaults to synchronized initialization; pass `LazyThreadSafetyMode.NONE` for single-threaded owners.
- Write a custom delegate by implementing `ReadOnlyProperty` or `ReadWriteProperty`.
- Interface delegation (`class Cached(repo: Repo) : Repo by repo`) forwards everything and lets you override only what differs.

## Operators and infix

- Operator functions map to fixed symbols (`plus`, `get`, `contains`, `compareTo`, `invoke`, `rangeTo`). Overload them only when the meaning is the conventional one: `Money + Money`, `matrix[i, j]`.
- `infix` is for binary, readable relations: `infix fun Int.percentOf(total: Int) = this * 100 / total`. Avoid it for anything with side effects.

## Sealed hierarchies and `when`

`when` over a sealed type or enum as an expression must be exhaustive, so adding a subtype breaks the build in every place that needs updating. Do not add an `else` branch to such a `when`; it silences that check.

```kotlin
fun render(r: Result<Order>) = when (r) {
    is Result.Ok -> "order ${r.value.id}"
    is Result.Rejected -> "rejected: ${r.reason}"
    Result.Pending -> "pending"
}
```

Prefer `sealed interface` when subtypes need to implement other supertypes; `data object` for singleton cases.

## Value types

`@JvmInline value class UserId(val raw: Long)` gives a distinct type with usually no wrapper allocation. It is boxed when used as a nullable, a generic argument, or through an interface. Use it for identifiers and units to stop argument mix-ups.

## Inline and reified

- `inline` copies the function and its lambda arguments into the call site, avoiding lambda allocation; it also permits non-local `return` from the lambda.
- `noinline` and `crossinline` opt individual lambda parameters out of those behaviors.
- `reified T` (inline functions only) keeps the type argument at runtime: `inline fun <reified T> Json.parse(s: String): T = decodeFromString(s)`.
- Do not inline large functions; code size grows at every call site.

## Collections and sequences

Eager collection operators build an intermediate list per step. For long chains over large inputs, or when you stop early (`first`, `take`), start with `asSequence()`. For small collections the eager form is simpler and often faster.

## Null handling and contracts

- Model absence in the type; return `T?` or a sealed result rather than a sentinel value.
- `requireNotNull`, `checkNotNull`, `require`, `check` throw with a message and smart-cast afterwards.
- `lateinit` is for values injected before first use; use `::prop.isInitialized` only when unavoidable.
