---
name: circuit-breaker-tuner
description: |
  Resilience patterns tuner — analyzes failure patterns and recommends Resilience4j circuit breaker, bulkhead, timeout, and fallback settings with explanation of tradeoffs. Use when the user mentions "circuit breaker", "서킷 브레이커", "Resilience4j", "폴백", "fallback", "장애 전파 방지", "timeout 설정", or is asking about handling downstream service failures, preventing cascading failures, or configuring retry/fallback behavior. Trigger this skill even if the user just says "외부 API가 느려지면 우리 서비스도 같이 죽어" or "how do I stop one slow service from killing everything?" without naming circuit breakers.
---

# Circuit Breaker Tuner

A circuit breaker prevents a slow or failing downstream service from exhausting your resources. Without one, threads pile up waiting for a service that never responds, your connection pool fills, and your entire service becomes unresponsive — even for operations that do not touch the failing service. The circuit breaker detects degradation early and fails fast, preserving resources for operations that can succeed.

This skill covers the full resilience stack: circuit breakers, bulkheads, timeouts, fallbacks, and alerting. For full YAML templates and bulkhead/timeout config, read `references/resilience4j-config.md`. For fallback code examples, read `references/fallback-patterns.md`. For metrics and alerting, read `references/metrics-alerting.md`.

## The State Machine

```
CLOSED → (failures exceed threshold) → OPEN → (wait duration) → HALF_OPEN
HALF_OPEN → (probe succeeds) → CLOSED
HALF_OPEN → (probe fails) → OPEN
```

**CLOSED**: Normal operation. Calls pass through. Failures are counted.

**OPEN**: Failing fast. All calls immediately return an error (or fallback). No calls reach the downstream service. This gives the downstream service time to recover.

**HALF_OPEN**: Probe state. A limited number of calls are allowed through to test if the service has recovered. If they succeed, the circuit closes. If they fail, the circuit reopens.

**Why this matters:** The OPEN state is where circuit breakers save systems. Without it, your thread pool fills with threads blocked on a 30-second timeout. With it, those threads fail in milliseconds and free themselves for work that can succeed.

## Setting Each Threshold

### failureRateThreshold

The percentage of calls that must fail before the circuit opens.

**Set it lower (30–40%)** when: the downstream service has strict SLAs; partial failures are still harmful (e.g., payment processing); traffic volume is high.

**Set it higher (60–70%)** when: some failure rate is expected (retry-able transient errors); false positives (unnecessary OPEN state) are more costly than waiting.

**Starting point:** 50% for most services. Tune downward if the circuit fails to open when it should; tune upward if it opens during brief transient spikes.

### waitDurationInOpenState

How long the circuit stays OPEN before probing.

**Set shorter (5–15s):** downstream service recovers quickly (e.g., restart takes 5 seconds); SLA requires fast recovery.

**Set longer (60–120s):** recovery involves a human operator; downstream service has slow startup; premature probing causes HALF_OPEN → OPEN cycling.

**Rule of thumb:** Set slightly longer than the downstream service's typical restart or recovery time.

### minimumNumberOfCalls

How many calls must be recorded before the failure rate is evaluated. Start at 10. Setting this to 1–2 causes a single slow call to open the circuit.

### Sliding Window Type

See `references/resilience4j-config.md` for COUNT_BASED vs. TIME_BASED guidance and templates.

## Fallback Strategies

A fallback is what happens when the circuit is OPEN. Design fallbacks deliberately — they represent your service's degraded-but-functional behavior.

| Strategy | When to Use |
|----------|------------|
| Cached response | Data changes infrequently; stale is acceptable |
| Default value | Empty/neutral response is acceptable |
| Throw specific exception | Caller can handle the failure explicitly |
| Queue for retry | Eventually-consistent operations |
| Static response | Critical UX must not break |

For code examples and implementation notes, read `references/fallback-patterns.md`.

## Bulkhead

A bulkhead limits concurrent calls so that a slow service cannot exhaust your thread pool even before the circuit opens. Combine with circuit breaker for defense in depth. See `references/resilience4j-config.md` for YAML.

## Common Configuration Mistakes

**`minimumNumberOfCalls` too low.** A single slow call opens the circuit. Start at 10.

**`waitDurationInOpenState` too short.** Circuit cycles open/probe/open rapidly and never lets the downstream service recover. Set it longer than actual recovery time.

**Not ignoring client errors.** A 404 or 400 is the client's fault, not a service failure. Add them to `ignoreExceptions` or they inflate your failure rate.

**Same timeout for all services.** Configure each `CircuitBreaker` instance separately — payment and recommendation services have very different latency profiles.

**No fallback defined.** A circuit breaker without a fallback throws an exception when OPEN. That is better than a timeout, but a meaningful fallback provides a degraded-but-useful response.

**HTTP timeout and slowCallDurationThreshold inconsistent.** If `readTimeout` is 3s and `slowCallDurationThreshold` is 5s, calls time out before the circuit counts them as slow. See `references/resilience4j-config.md`.

## Quick Configuration Checklist

- [ ] `slidingWindowSize` appropriate for traffic volume (count vs. time based)
- [ ] `minimumNumberOfCalls` high enough to avoid false positives (≥ 10)
- [ ] `failureRateThreshold` calibrated to acceptable failure rate for this specific dependency
- [ ] `slowCallDurationThreshold` aligned with HTTP client read timeout
- [ ] `waitDurationInOpenState` longer than downstream service's typical recovery time
- [ ] Client errors (4xx) in `ignoreExceptions` — only server/network failures count
- [ ] Fallback method defined with meaningful degraded behavior
- [ ] Bulkhead configured alongside circuit breaker to limit concurrency
- [ ] Circuit state changes trigger monitoring alerts
