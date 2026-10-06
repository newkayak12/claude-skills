# Kotlin Multiplatform

## Module layout

```
shared/
  src/commonMain/kotlin      platform-neutral code, only common APIs
  src/commonTest/kotlin
  src/androidMain/kotlin     JVM/Android specifics
  src/iosMain/kotlin         shared by iosArm64, iosSimulatorArm64, iosX64 via the default hierarchy
androidApp/                  consumes :shared
iosApp/                      Xcode project consuming the framework
```

Keep business rules, models, and repositories in `commonMain`; keep UI and platform services at the edges.

## Gradle setup

```kotlin
plugins {
    kotlin("multiplatform")
    kotlin("plugin.serialization")
    id("com.android.library")
}
// Newer AGP versions offer com.android.kotlin.multiplatform.library for KMP modules; prefer it when available.

kotlin {
    androidTarget()
    iosArm64(); iosSimulatorArm64()
    jvm("desktop")

    sourceSets {
        commonMain.dependencies {
            implementation(libs.kotlinx.coroutines.core)
            implementation(libs.kotlinx.serialization.json)
            implementation(libs.ktor.client.core)
        }
        commonTest.dependencies { implementation(kotlin("test")) }
        androidMain.dependencies { implementation(libs.ktor.client.okhttp) }
        iosMain.dependencies { implementation(libs.ktor.client.darwin) }
    }
}
```

Declare versions in `libs.versions.toml`. With the default hierarchy template, `iosMain` is created automatically for the iOS targets, so no manual `dependsOn` wiring is needed. Add `applyDefaultHierarchyTemplate()` explicitly only when customizing.

## Choosing a seam: interface or expect/actual

| Situation | Prefer |
|-----------|--------|
| A service with a few methods (storage, clock, logger) | an interface in common, implementations per platform, wired by constructor injection |
| A platform type or function with the same shape everywhere (`currentTimeMillis`, UUID generation) | `expect` / `actual` |
| Per-platform Ktor engine | dependency per source set; the engine is discovered at runtime |

```kotlin
// commonMain
expect fun platformName(): String

// androidMain
actual fun platformName(): String = "Android ${android.os.Build.VERSION.SDK_INT}"

// iosMain
actual fun platformName(): String = UIDevice.currentDevice.systemName()
```

Interfaces are easier to fake in tests and avoid the `expect`/`actual` class feature, which is still marked Beta in recent releases and warns on use. Keep expect declarations small.

## Common code rules

- No `java.*` imports in `commonMain`; use `kotlinx-datetime`, `okio`, or an interface for time, I/O, and formatting.
- Use `kotlinx.serialization` for JSON; reflection-based libraries do not work on Native.
- Use `Flow` and suspend in the shared API; on iOS, consume them through SKIE or a thin callback wrapper, because plain Swift does not see Kotlin generics and suspend functions ergonomically.
- Immutable data classes cross the Swift boundary best; avoid exposing sealed hierarchies with generics when Swift callers need exhaustive switching.

## Shared HTTP client

```kotlin
class ApiClient(
    // no engine given: Ktor discovers the one on each platform's classpath
    private val http: HttpClient = HttpClient {
        install(ContentNegotiation) { json(Json { ignoreUnknownKeys = true }) }
        install(HttpTimeout) { requestTimeoutMillis = 10_000 }
    },
) {
    suspend fun fetchProfile(id: String): Profile {
        val response = http.get("https://api.example.com/users/$id")
        return response.body()
    }
}
```

Add one engine dependency per source set (OkHttp on Android, Darwin on iOS). In tests, pass `HttpClient(MockEngine { ... })` to keep the test in `commonTest`.

## iOS integration

- The shared module is exported as a framework; configure with `binaries.framework { baseName = "Shared"; isStatic = true }` on each iOS target.
- Native memory uses a tracing garbage collector in current releases; no freezing rules apply to new code.
- Calling Objective-C and Swift-visible APIs from `iosMain` uses `platform.*` imports (`platform.UIKit.UIDevice`); Swift-only libraries need a bridging protocol implemented on the Swift side.
- Suspend functions appear in Swift as `async` functions on recent toolchains; cancellation from Swift needs explicit handling, and a `Flow` needs an adapter.

## Testing

- Write most tests in `commonTest` with `kotlin.test` and `kotlinx-coroutines-test`; they run for every target.
- Run `./gradlew allTests` for all targets, or `desktopTest`, `testDebugUnitTest`, `iosSimulatorArm64Test` individually. iOS tests need macOS.
- Put tests that touch platform APIs in that platform's test source set.

## Publishing a library

Apply `maven-publish`; the Kotlin plugin creates a publication per target plus a root `kotlinMultiplatform` publication that Gradle metadata uses to pick the right artifact. Set `group`, `version`, and POM metadata, sign artifacts, and publish with `./gradlew publishAllPublicationsToXRepository`. Build iOS publications on macOS.
