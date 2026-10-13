# Key Patterns

Short examples for the three patterns the skill checks most. Longer treatments sit in the other reference files.

## Sealed class state modeling

```kotlin
sealed interface LoadState<out T> {
    data object Loading : LoadState<Nothing>   // data object needs Kotlin 1.9+
    data class Ready<T>(val value: T) : LoadState<T>
    data class Failed(val reason: String, val error: Throwable? = null) : LoadState<Nothing>
}
```

## Coroutines and Flow (structured concurrency)

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

`catch` sees only upstream exceptions, and `flowOn` changes the dispatcher of everything above it.

## Catching around suspend calls

```kotlin
try {
    api.fetch(id)
} catch (e: CancellationException) {
    throw e                 // a cancelled coroutine must stop; swallowing it keeps it running
} catch (e: IOException) {
    fallback()
}
```

A bare `catch (e: Exception)` also catches `CancellationException`.

## Null safety

```kotlin
val label = account?.owner?.name ?: "Unknown"

// `!!` is reserved for a violated contract; prefer a message-carrying check
val endpoint = requireNotNull(System.getenv("SERVICE_URL")) { "SERVICE_URL is not set" }
```
