---
name: kotlin-specialist
description: >-
  Use when writing idiomatic Kotlin — coroutines and Flow, KMP, Compose, Ktor, DSLs. Triggers on: "Kotlin coroutines",
  "코루틴", "코틀린으로 전환", "Flow 취소 처리". Not for Spring Java backends or Android XML layouts.
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

## Standing Mandates

- NEVER call code idiomatic, null-safe or cancellation-safe by reading it. A cancellation bug shows only when a scope
  is cancelled mid-flight, so run `detekt`, `ktlint` and a `runTest` that cancels the scope, and quote the results. A
  tool you could not run is written `not run: <tool>`.
- NEVER launch from `GlobalScope` or keep a scope alive past its owner: the coroutine outlives the screen or request
  that started it and its failures reach nobody.
- NEVER swallow `CancellationException` (a bare `catch (e: Exception)` around a suspend call does): the cancelled
  coroutine keeps running. Rethrow it.
- NEVER write `!!` without a comment stating the contract, and NEVER call `runBlocking` outside `main` and tests: the
  first turns a type-checked null into a runtime crash, the second blocks a thread the dispatcher needs.
- Missing facts (target platforms, Kotlin and coroutines versions, shared-code boundary) are read from the build files
  first; what stays unknown is written `[확인 필요: ○○]`, never assumed.
- Goal: the change passes `detekt` and `ktlint`, every scope it opens has a cancellation test, and the closing tally
  recounts to a grep of the touched files.

# Kotlin Specialist

**Not for** a Spring Boot Java backend (`develop:spring-boot-engineer`), Android XML layouts (this skill covers
Compose), a full coverage plan (`develop:test-master`), or a failing build with an unknown cause
(`develop:bug-diagnoser`).

## Process

1. **Analyze** — read the build files; establish target platforms, where concurrency lives, how much code is shared.
2. **Model** — sealed hierarchies, data classes, nullability in the types (`references/key-patterns.md`).
3. **Implement** — coroutines, Flow, extension functions; each scope has a named owner that cancels it on teardown.
4. **Lint** — run `detekt` and `ktlint` (agent contract: `agents/lint-qa.md`); fix every violation.
5. **Optimize** — value classes, sequences, inlining, only where a measurement supports them.
6. **Test** — `runTest` plus Turbine for Flow emissions, one test that cancels each scope; run every KMP target.
7. **Recount** — grep the touched files for `GlobalScope`, `runBlocking`, `!!`, and scope builders
   (`CoroutineScope(`, `launch`, `async`); match each scope to a cancelling `runTest`; fix the tally if it differs.

## Output Template

```
## <task>

1. Models: sealed hierarchies, data classes
2. Implementation: coroutine / Flow code
3. Tests: runTest + Turbine, including cancellation
4. Idioms applied: one line each, with why

Open: [확인 필요: ○○] ...

Verified: detekt <n> violations · ktlint <n> · tests <pass>/<total> · scopes <s>, cancellation-tested <c>
Left: GlobalScope <n> · runBlocking <n> · `!!` without contract <n>
```

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Writes coroutine and Flow scaffolding with owned scopes | Provide domain logic and requirements |
| Designs sealed state hierarchies | Confirm they match the real UI states |
| Lays out KMP expect/actual structure | Run tests on each platform target |
| Flags `!!`, `GlobalScope`, swallowed cancellation | Decide domain null contracts |

## Reference Guide

| Topic | File | Read it when |
|-------|------|--------------|
| Core patterns | `references/key-patterns.md` | Sealed state, Flow in a repository, catching around suspend, null safety |
| Language idioms | `references/dsl-idioms.md` | @DslMarker builders, scope functions, delegation, value classes, inline |
| Concurrency | `references/coroutines-flow.md` | Scope ownership, dispatchers, cancellation, hot/cold flows, runTest |
| Server-side | `references/ktor-server.md` | Modules, routes, status pages, JWT, Exposed, WebSockets, testApplication |
| Shared code | `references/multiplatform-kmp.md` | Source sets, Gradle targets, expect/actual vs interfaces, iOS, publishing |
| Android UI | `references/android-compose.md` | State hoisting, ViewModel, effects, lazy lists, navigation, theming |

## Related Skills

- `develop:spring-boot-engineer` — Kotlin used inside a Spring Boot service
- `develop:test-master` — coverage plan for Kotlin/KMP modules
- `develop:bug-diagnoser` — a coroutine bug whose cause is not yet proven
