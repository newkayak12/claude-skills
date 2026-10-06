# Surviving Partial Failure

Assume every remote call can be slow, fail, or succeed without telling you.

## Layering order
The order is a design choice. Resilience4j's default aspect order, outermost first, is Retry, CircuitBreaker, RateLimiter, TimeLimiter, Bulkhead. Under that order retry wraps the breaker, so each attempt counts against the breaker; the time limiter bounds each attempt, and the bulkhead caps concurrency closest to the call. Change it with the `*AspectOrder` properties if you want the breaker to see only the retried outcome.

## Timeouts
Mandatory on every outbound call. Choose from observed latency (a bit above the p99 under normal load), and keep the sum of nested timeouts under the caller's own deadline. A missing timeout turns a slow dependency into thread exhaustion.

## Retries
- Retry only idempotent operations or those with an idempotency key.
- Retry only transient failures (connect errors, 503, timeouts); never 4xx validation errors.
- Exponential backoff with jitter; bound attempts (two or three) and total time.
- Retries multiply load during an outage; limit them with a retry budget (e.g. retries at most a fraction of recent requests) and retry at one layer only, not at every hop.

## Circuit breaker
States: closed (calls pass, failures counted), open (calls rejected immediately for a wait period), half-open (a few probe calls decide to close or reopen). Trip on failure rate or slow-call rate across a minimum number of calls, not on a single error. Pair with a fallback so open means degraded, not broken.

Resilience4j with Spring Boot:
```kotlin
@CircuitBreaker(name = "inventory", fallbackMethod = "stockUnknown")
fun stock(sku: String): StockView = client.stock(sku)

private fun stockUnknown(sku: String, e: Throwable) = StockView.unknown(sku)
```
Thresholds and wait duration are set per instance in configuration. The annotations work through a Spring proxy: in Kotlin the class must be open (the `kotlin-spring` plugin does this), and the call must come from another bean, not `this`.

## Bulkhead
Isolate resources per dependency so one slow service cannot consume every thread or connection. Options: a semaphore limit on concurrent calls, a dedicated thread pool, or a separate connection pool. Reject quickly when full instead of queueing without bound.

## Degradation
Decide per feature what to show when a dependency is out: cached value, default, hidden widget, or queued request with a later confirmation. Distinguish critical path (fail the request) from enrichment (omit it). Document the choice next to each integration point.

## Load protection
- Rate limit per client at the edge.
- Shed load when queues grow: return 429 or 503 with Retry-After rather than slowing everyone.
- Apply backpressure on consumers: bounded prefetch, pause consumption when downstream is saturated.
- Poison messages go to a dead-letter queue after bounded retries, with alerting.

## Health checks
- Liveness: the process is not wedged; must not depend on downstream services, or an outage restarts everything.
- Readiness: can take traffic now (warm, connected to its own database). Include critical own dependencies, not optional ones.
- Startup probe for slow initialisation. In Spring Boot, Actuator exposes liveness and readiness health groups.

## Verify
Inject failures in test: kill a dependency, add latency, drop messages, and confirm timeouts fire, breakers open, and fallbacks respond. Untested resilience config is a guess.
