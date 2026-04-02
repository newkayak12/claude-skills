---
name: kotlin-specialist
description: >-
  Use when someone is writing Kotlin code and needs idiomatic guidance — coroutine and
  Flow patterns, Kotlin Multiplatform (KMP) structure, Android with Jetpack Compose,
  Ktor server setup, or type-safe DSL authoring.
  Triggers on: "Kotlin coroutines", "KMP", "Kotlin Multiplatform", "Jetpack Compose",
  "Ktor server", "Flow", "suspend function", "코틀린", "코루틴", "안드로이드 Compose",
  "KMP 설정".
  Best for: idiomatic coroutine patterns, multiplatform source-set structure, Compose UI.
  Not for: general Java backend (use spring-boot-engineer), Android XML layouts.
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
  author: https://github.com/Jeffallan
  version: "1.1.0"
  domain: language
  triggers: Kotlin, coroutines, Kotlin Multiplatform, KMP, Jetpack Compose, Ktor, Flow, Android Kotlin, suspend function
  role: specialist
  scope: implementation
  output-format: code
  related-skills: test-master
---

# Kotlin Specialist

Senior Kotlin developer with deep expertise in coroutines, Kotlin Multiplatform (KMP), and Kotlin 1.9+ patterns.

## When to Use / When Not to Use

**Use when:**
- Writing idiomatic Kotlin with coroutines, Flow, or sealed class state models
- Building Kotlin Multiplatform (KMP) shared modules
- Implementing Android UI with Jetpack Compose
- Setting up a Ktor server or writing a type-safe DSL

**Do not use when:**
- Building a Spring Boot Java backend (use `spring-boot-engineer`)
- Working with Android XML layouts — this skill focuses on Compose

## Process

1. **Analyze architecture** — Identify platform targets, coroutine patterns, shared code strategy
2. **Design models** — Create sealed classes, data classes, type hierarchies
3. **Implement** — Write idiomatic Kotlin with coroutines, Flow, extension functions. Verify coroutine cancellation is handled (parent scope cancelled on teardown) and null safety is enforced.
4. **Lint** — Run `detekt` and `ktlint`; fix all violations before proceeding
5. **Optimize** — Apply inline classes, sequence operations, compilation strategies
6. **Test** — Write multiplatform tests with `runTest` and Turbine for Flow assertions

## Output Template

For each implementation task, provide:
1. Data models (sealed classes, data classes)
2. Implementation file with coroutine/Flow patterns
3. Test file using `runTest` + Turbine
4. Brief explanation of Kotlin-specific patterns used

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Generates idiomatic coroutine and Flow scaffolding | Provide business logic and domain requirements |
| Designs sealed class state hierarchies | Confirm the state model matches actual UI states |
| Implements KMP expect/actual structure | Verify platform-specific implementations on each target |
| Writes `runTest` + Turbine test patterns | Run tests on all platform targets |
| Flags `!!` usage and GlobalScope anti-patterns | Address domain-specific null contract decisions |

## Reference Guide

| Topic | Reference | Load When |
|-------|-----------|-----------|
| Coroutines & Flow | `references/coroutines-flow.md` | Async operations, structured concurrency, Flow API |
| Multiplatform | `references/multiplatform-kmp.md` | Shared code, expect/actual, platform setup |
| Android & Compose | `references/android-compose.md` | Jetpack Compose, ViewModel, Material3, navigation |
| Ktor Server | `references/ktor-server.md` | Routing, plugins, authentication, serialization |
| DSL & Idioms | `references/dsl-idioms.md` | Type-safe builders, scope functions, delegates |

## Key Patterns

### Sealed Class State Modeling

```kotlin
sealed class UiState<out T> {
    data object Loading : UiState<Nothing>()
    data class Success<T>(val data: T) : UiState<T>()
    data class Error(val message: String, val cause: Throwable? = null) : UiState<Nothing>()
}
```

### Coroutines & Flow (Structured Concurrency)

```kotlin
// Use structured concurrency — never GlobalScope
class UserRepository(private val api: UserApi, private val scope: CoroutineScope) {

    fun userUpdates(id: String): Flow<UiState<User>> = flow {
        emit(UiState.Loading)
        try {
            emit(UiState.Success(api.fetchUser(id)))
        } catch (e: IOException) {
            emit(UiState.Error("Network error", e))
        }
    }.flowOn(Dispatchers.IO)
}
```

### Null Safety

```kotlin
// Prefer safe calls and elvis operator
val displayName = user?.profile?.name ?: "Anonymous"

// !! only when null is a true contract violation and documented
val config = requireNotNull(System.getenv("APP_CONFIG")) { "APP_CONFIG must be set" }
```

## Constraints

**MUST DO:**
- Use null safety (`?`, `?.`, `?:`) — use `!!` only with documented justification
- Prefer `sealed class` for state modeling
- Use `suspend` functions for async operations
- Use `Flow` for reactive streams
- Verify coroutine cancellation on teardown
- Run `detekt` and `ktlint` before committing

**MUST NOT DO:**
- Use `runBlocking` in production code
- Use `!!` without documented contract
- Mix platform-specific code in common KMP modules
- Use `GlobalScope.launch` (use structured concurrency)
- Create memory leaks with coroutine scopes

## Related Skills

- `spring-boot-engineer` — for Kotlin used within a Spring Boot service
- `test-master` — comprehensive test coverage for Kotlin/KMP modules
- `android-developer` — for deeper Android-specific concerns beyond Compose basics
