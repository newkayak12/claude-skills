# Coroutines and Flow

Reading order: scope ownership, then dispatcher choice, then failure and cancellation, then Flow, then tests.

## Scope ownership

Every coroutine has a parent; the parent waits for children and cancels them when it is cancelled. Design the owner first.

| Owner | Lifetime ends when |
|-------|--------------------|
| `viewModelScope` / `lifecycleScope` (Android) | the ViewModel is cleared / lifecycle destroyed |
| Spring or Ktor request handler | the request completes or the client disconnects |
| A class-level `CoroutineScope(SupervisorJob() + dispatcher)` | the owner calls `scope.cancel()` from `close()` |

```kotlin
class PriceFeed(dispatcher: CoroutineDispatcher = Dispatchers.Default) : AutoCloseable {
    private val scope = CoroutineScope(SupervisorJob() + dispatcher)
    fun start(source: Quotes) = scope.launch { source.stream().collect(::publish) }
    override fun close() = scope.cancel()
}
```

- Prefer `coroutineScope { }` inside a suspend function over a stored scope; it returns only after all children finish and rethrows the first failure.
- `supervisorScope { }` lets siblings survive one child's failure; use it for independent work such as fan-out notifications.
- Inject the dispatcher so tests can replace it.

## Parallel decomposition

```kotlin
suspend fun loadDashboard(id: Long): Dashboard = coroutineScope {
    val profile = async { profiles.find(id) }
    val orders = async { orders.recent(id) }
    Dashboard(profile.await(), orders.await())
}
```

If `orders` throws, `profile` is cancelled and the exception propagates from `coroutineScope`. For a bounded number of concurrent calls over a collection, use a `Semaphore(permits)` and `withPermit`, or `flatMapMerge(concurrency)` on a Flow.

## Dispatchers

- `Dispatchers.Default`: CPU-bound work, pool sized to core count.
- `Dispatchers.IO`: blocking calls (JDBC, file, legacy HTTP clients). It shares threads with Default and can grow beyond the core count.
- `Dispatchers.Main`: UI thread on Android and desktop only.
- `limitedParallelism(n)` on a dispatcher caps concurrency for one resource, e.g. `Dispatchers.IO.limitedParallelism(8)` for a pool-like limit.
- Wrap blocking code with `withContext(Dispatchers.IO) { ... }` at the edge, so callers of a suspend function never need to know which thread it uses (main-safety).

## Failure semantics

- A failing child cancels its parent and siblings, unless a `SupervisorJob` sits in between.
- `launch` reports uncaught exceptions to the scope's `CoroutineExceptionHandler`; `async` holds the exception until `await()`.
- `try/catch` around `launch { }` does not catch what happens inside; put the `try` inside the lambda.
- A `CoroutineExceptionHandler` only works on root coroutines and is a last-resort logger, not control flow.
- Catching `Exception` swallows `CancellationException`. Rethrow it:

```kotlin
try { api.call() }
catch (e: CancellationException) { throw e }
catch (e: IOException) { fallback() }
```

Or use `runCatching` only when you rethrow cancellation afterwards; otherwise prefer explicit catches.

## Cancellation

Cancellation is cooperative. A coroutine stops at the next suspension point that checks it; tight CPU loops need `ensureActive()` or `yield()`.

```kotlin
suspend fun checksum(chunks: List<ByteArray>): Long {
    var acc = 0L
    for (c in chunks) { currentCoroutineContext().ensureActive(); acc += crc(c) }
    return acc
}
```

- Cleanup that must suspend after cancellation goes in `withContext(NonCancellable) { ... }` inside `finally`.
- `withTimeout(d)` throws `TimeoutCancellationException`; `withTimeoutOrNull(d)` returns null instead.
- Wrap callback APIs with `suspendCancellableCoroutine` and register `invokeOnCancellation` to release the underlying call.

## Flow

A cold `Flow` runs its builder for each collector. Hot types are `SharedFlow` and `StateFlow`.

| Need | Use |
|------|-----|
| Sequence computed on demand | `flow { emit(x) }` |
| Wrap callbacks | `callbackFlow { ...; awaitClose { unregister() } }` |
| Current value plus updates, replay of last value, conflated | `StateFlow` (always has a value, compares with `equals`) |
| Events to many listeners, configurable replay | `SharedFlow` |
| Cold upstream shared among collectors | `shareIn` / `stateIn` with `SharingStarted.WhileSubscribed(5_000)` |

Context rule: collect in the caller's context; change the upstream context with `flowOn`, never with `withContext` around `emit`.

Operators worth knowing:
- `map`, `filter`, `transform`, `onEach`, `take`.
- `flatMapLatest` cancels the previous inner flow on new input (search-as-you-type); `flatMapConcat` keeps order; `flatMapMerge` runs concurrently.
- `debounce`, `distinctUntilChanged`, `conflate`, `buffer` control pressure between producer and consumer.
- `combine` re-emits when any source emits; `zip` pairs one-to-one.
- `catch { }` handles upstream errors only; `retryWhen { cause, attempt -> ... }` for backoff; terminal `collect` errors are not caught by it.

```kotlin
val results: StateFlow<List<Item>> = queries
    .debounce(300)
    .distinctUntilChanged()
    .flatMapLatest { q -> repo.search(q).catch { emit(emptyList()) } }
    .stateIn(scope, SharingStarted.WhileSubscribed(5_000), emptyList())
```

## Testing

Use `kotlinx-coroutines-test`.

```kotlin
@Test fun `emits loading then data`() = runTest {
    val vm = SearchViewModel(FakeRepo(), StandardTestDispatcher(testScheduler))
    vm.state.test {                         // Turbine
        assertEquals(Loading, awaitItem())
        vm.search("kotlin")
        advanceUntilIdle()
        assertIs<Success>(awaitItem())
        cancelAndIgnoreRemainingEvents()
    }
}
```

- `runTest` skips delays by advancing virtual time; `advanceTimeBy(ms)` and `runCurrent()` give finer control.
- On Android, set `Dispatchers.setMain(testDispatcher)` in setup and `resetMain()` in teardown.
- Collection of a `StateFlow` in a background `launch` needs `backgroundScope.launch` so `runTest` can finish.
