---
name: kotlin-specialist
description: >-
  Use when someone is writing Kotlin code and needs idiomatic guidance —
  coroutine and Flow patterns, Kotlin Multiplatform (KMP) structure, Android
  with Jetpack Compose, Ktor server setup, or type-safe DSL authoring. Triggers
  on: "Kotlin coroutines".
scenarios:
  - "Help me write idiomatic Kotlin code using coroutines for async processing"
  - "Convert this Java class to Kotlin and apply Kotlin best practices"
  - "Design a Kotlin DSL for our configuration system"
  - "코틀린으로 코루틴 기반 비동기 처리를 구현해줘"
  - "자바 코드를 코틀린으로 전환하고 관용구를 적용해줘"
compatibility:
  recommended: []
  optional:
    - think-tool
  remote_mcp_note: >-
    think-tool이 있으면 코루틴 스코프 설계와 취소 전파 전략을 더 체계적으로 검토합니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
license: MIT
metadata:
  version: "1.1.0"
  triggers: Kotlin, coroutines, suspend function, Flow, KMP, Kotlin Multiplatform, Compose, Ktor, Android Kotlin
  related-skills: test-master, spring-boot-engineer
  domain: language
  role: specialist
  scope: implementation
  output-format: code
---

# Kotlin Specialist

Kotlin implementation specialist: coroutines, Flow, Multiplatform (KMP), Compose, Ktor, and DSL design on Kotlin 1.9+.

## When to Use / When Not to Use

**Use when:**
- Writing idiomatic Kotlin that uses coroutines, Flow, or sealed state types
- Building Kotlin Multiplatform (KMP) shared modules
- Implementing Android UI with Jetpack Compose
- Setting up a Ktor server or writing a type-safe DSL

**Do not use when:**
- Building a Spring Boot Java backend (use `spring-boot-engineer`)
- Working with Android XML layouts — this skill focuses on Compose

## Process

1. **Analyze architecture** — Establish the target platforms, where concurrency lives, and how much code is shared
2. **Design models** — Define the sealed hierarchies, data classes, and type relationships
3. **Implement** — Code in idiomatic Kotlin, using coroutines, Flow, and extension functions. Confirm that cancellation propagates (scopes are cancelled by their owner on teardown) and that nullability is handled in the types.
4. **Lint** — Run `detekt` and `ktlint`; fix all violations before proceeding
5. **Optimize** — Reach for value classes, sequences, and inlining where measurement supports them
6. **Test** — Cover behavior with `runTest`, and assert Flow emissions with Turbine; run multiplatform tests on each target

## Output Template

For each implementation task, provide:
1. Data models: sealed hierarchies and data classes
2. Implementation file with coroutine/Flow patterns
3. Test file using `runTest` + Turbine
4. A short note on which Kotlin idioms were applied and why

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Generates idiomatic coroutine and Flow scaffolding | Provide business logic and domain requirements |
| Designs sealed class state hierarchies | Confirm the state model matches actual UI states |
| Implements KMP expect/actual structure | Verify platform-specific implementations on each target |
| Writes `runTest` + Turbine test patterns | Run tests on all platform targets |
| Flags `!!` usage and GlobalScope anti-patterns | Address domain-specific null contract decisions |

## Reference Guide

| Topic | File | Read it when |
|-------|------|--------------|
| Language idioms | `references/dsl-idioms.md` | Writing builders with @DslMarker, scope functions, delegation, value classes, inline |
| Concurrency | `references/coroutines-flow.md` | Scope ownership, dispatchers, cancellation, hot/cold flows, runTest |
| Server-side | `references/ktor-server.md` | Modules, routes, status pages, JWT, Exposed, WebSockets, testApplication |
| Sharing code across platforms | `references/multiplatform-kmp.md` | Source sets, Gradle targets, expect/actual vs interfaces, iOS, publishing |
| Android UI | `references/android-compose.md` | State hoisting, ViewModel, effects, lazy lists, navigation, theming |

## Key Patterns

### Sealed Class State Modeling

```kotlin
sealed interface LoadState<out T> {
    data object Loading : LoadState<Nothing>   // no payload
    data class Ready<T>(val value: T) : LoadState<T>
    data class Failed(val reason: String, val error: Throwable? = null) : LoadState<Nothing>
}
```

### Coroutines & Flow (Structured Concurrency)

```kotlin
// The owner decides the lifetime; no GlobalScope anywhere
class AccountRepository(private val api: AccountApi) {

    fun observe(id: String): Flow<LoadState<Account>> = flow {
        emit(LoadState.Loading)
        emit(LoadState.Ready(api.fetch(id)))
    }.catch { e ->
        if (e is IOException) emit(LoadState.Failed("Network error", e)) else throw e
    }.flowOn(Dispatchers.IO)
}
```

### Null Safety

```kotlin
// Safe call chain with a default
val label = account?.owner?.name ?: "Unknown"

// `!!` is reserved for violated contracts; prefer a message-carrying check
val endpoint = requireNotNull(System.getenv("SERVICE_URL")) { "SERVICE_URL is not set" }
```

## Constraints

**Required:**
- Rely on nullable types and `?`, `?.`, `?:`; allow `!!` only where a comment states the contract
- Model states as `sealed` types
- Express async work as `suspend` functions
- Expose streams of values as `Flow`
- Verify coroutine cancellation on teardown
- Pass `detekt` and `ktlint` cleanly before every commit

**Forbidden:**
- Calling `runBlocking` outside of `main` and tests
- Writing `!!` with no stated contract
- Referencing platform APIs from common KMP source sets
- Launching from `GlobalScope` (use an owned scope)
- Keeping a coroutine scope alive past its owner

## Related Skills

- `spring-boot-engineer` — for Kotlin used within a Spring Boot service
- `test-master` — comprehensive test coverage for Kotlin/KMP modules
- `android-developer` — for deeper Android-specific concerns beyond Compose basics
