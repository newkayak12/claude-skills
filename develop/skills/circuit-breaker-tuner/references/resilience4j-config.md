# Resilience4j Configuration Reference

Full YAML templates and configuration details for circuit breaker, bulkhead, and timeout settings.

---

## Circuit Breaker: Full YAML Template

```yaml
resilience4j:
  circuitbreaker:
    instances:
      payment-service:
        # --- Failure Detection ---
        slidingWindowType: COUNT_BASED          # or TIME_BASED
        slidingWindowSize: 20                   # evaluate last 20 calls
        failureRateThreshold: 50                # open if ≥50% of calls failed
        slowCallRateThreshold: 80               # also open if ≥80% of calls are slow
        slowCallDurationThreshold: 3000ms       # "slow" = takes longer than 3s
        minimumNumberOfCalls: 10                # don't open until at least 10 calls recorded

        # --- Recovery ---
        waitDurationInOpenState: 30s            # stay OPEN for 30s before probing
        permittedNumberOfCallsInHalfOpenState: 3 # allow 3 probe calls
        automaticTransitionFromOpenToHalfOpen: true

        # --- Exceptions ---
        recordExceptions:                       # these count as failures
          - java.io.IOException
          - java.util.concurrent.TimeoutException
          - feign.FeignException$ServiceUnavailable
        ignoreExceptions:                       # these are NOT counted as failures
          - com.example.NotFoundException       # 404 is expected, not a failure
          - com.example.ValidationException     # client error, not service failure
```

---

## Sliding Window: Count vs. Time

**COUNT_BASED**: The last N calls are evaluated. Reacts faster to sudden failure spikes. Suitable for high-traffic services (many calls per second).

**TIME_BASED**: All calls in the last N seconds are evaluated. Suitable for low-traffic services where counting 10–20 calls could take minutes.

```yaml
# Low-traffic service (< 1 call/second) — use time-based
slidingWindowType: TIME_BASED
slidingWindowSize: 60    # look at the last 60 seconds
minimumNumberOfCalls: 5  # require at least 5 calls before evaluating

# High-traffic service (> 10 calls/second) — use count-based
slidingWindowType: COUNT_BASED
slidingWindowSize: 50
minimumNumberOfCalls: 20
```

---

## Timeout Configuration

The circuit breaker's `slowCallDurationThreshold` is not your HTTP timeout — they serve different purposes.

```
HTTP timeout: how long you wait before giving up on a single call
slowCallDurationThreshold: how long a call must take before it counts as "slow"
```

Set HTTP timeout and `slowCallDurationThreshold` consistently:

```yaml
# Feign / WebClient timeout
feign:
  client:
    config:
      payment-service:
        connectTimeout: 1000    # 1s to establish connection
        readTimeout: 3000       # 3s to read response

# Circuit breaker matches the read timeout as the "slow" threshold
slowCallDurationThreshold: 3000ms
```

If `readTimeout` is 3 seconds and `slowCallDurationThreshold` is 5 seconds, the call will time out before the circuit breaker can count it as slow. Make them consistent.

---

## Bulkhead Configuration

A bulkhead limits concurrent calls so that a slow service cannot exhaust your thread pool even before the circuit opens.

```yaml
resilience4j:
  bulkhead:
    instances:
      payment-service:
        maxConcurrentCalls: 20      # max 20 concurrent calls to this service
        maxWaitDuration: 100ms      # wait up to 100ms for a slot; then fail fast
```

Combine bulkhead + circuit breaker for defense in depth:
- Bulkhead limits concurrent calls (prevents thread exhaustion)
- Circuit breaker stops all calls when failure rate is high (allows recovery)

---

## slowCallDurationThreshold Sizing

Set this to the P99 of your downstream service's response time under normal conditions, multiplied by 2–3x.

```
Normal P99: 500ms → slowCallDurationThreshold: 1000–1500ms
Normal P99: 2s    → slowCallDurationThreshold: 4–6s
```

Do not set this to your own SLA timeout — that is too late. The circuit should detect slowness before your timeout fires.
