---
name: circuit-breaker-tuner
description: >-
  Use when a slow or failing downstream service is causing upstream latency, thread
  exhaustion, or outages — and you need to configure or tune circuit breakers, bulkheads,
  timeouts, and fallbacks to prevent cascading failures.
  Triggers on: "circuit breaker", "cascading failure", "downstream service slow",
  "Resilience4j config", "bulkhead", "fallback", "서킷 브레이커", "장애 전파 방지",
  "connection timeout under load".
  Best for: tuning failureRateThreshold and waitDuration, adding fallbacks, configuring
  bulkheads alongside circuit breakers.
  Not for: slow queries caused by missing indexes (use database-optimizer or sql-pro).
compatibility:
  recommended:
    - think-tool
  optional:
    - sequential-thinking
  remote_mcp_note: >-
    think-tool이 있으면 failureRateThreshold와 waitDuration 트레이드오프를 더 정확하게
    평가합니다. Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
---

# Circuit Breaker Tuner

## When to Use / When Not to Use

**Use when:**
- A slow or failing downstream service is exhausting threads or connection pools
- You need to tune failure thresholds, recovery timing, or HALF_OPEN probe behavior
- An application has no resilience layer and a downstream failure takes down the whole system
- You need fallback strategies for graceful degradation

**Do not use when:**
- The problem is slow SQL queries or missing database indexes
- You need chaos experiment design (use `chaos-engineer`)

## Process

1. **Identify the dependency** — Which downstream service is failing or slow? What is its typical latency and recovery time?
2. **Choose state machine parameters** — Set `failureRateThreshold`, `waitDurationInOpenState`, `minimumNumberOfCalls`
3. **Configure the sliding window** — COUNT_BASED (by request count) vs TIME_BASED (by time window)
4. **Define a fallback** — What should callers receive when the circuit is OPEN?
5. **Add a bulkhead** — Limit concurrent calls to prevent pool exhaustion before the circuit opens
6. **Wire monitoring** — Alert on circuit state transitions (CLOSED → OPEN)

For full YAML templates, see `references/resilience4j-config.md`. For fallback code examples, see `references/fallback-patterns.md`. For metrics, see `references/metrics-alerting.md`.

## Output Template

For each circuit breaker configuration, provide:
1. Resilience4j YAML or code config with commented rationale
2. Fallback method implementation
3. Bulkhead config (concurrent call limit)
4. Monitoring alert rule for state change events
5. Test scenario verifying OPEN → HALF_OPEN → CLOSED recovery

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Recommends threshold values with rationale | Confirm recovery time from your runbooks/metrics |
| Generates Resilience4j YAML or Spring Boot config | Apply and validate in your environment |
| Implements fallback method stubs | Fill in the real degraded-mode business logic |
| Identifies common config mistakes in your current setup | Test the circuit under load |
| Explains state machine transitions | Verify alert routing reaches the right team |

## The State Machine

```
CLOSED → (failures exceed threshold) → OPEN → (wait duration) → HALF_OPEN
HALF_OPEN → (probe succeeds) → CLOSED
HALF_OPEN → (probe fails) → OPEN
```

- **CLOSED**: Normal operation. Failures are counted.
- **OPEN**: Failing fast. All calls return error/fallback immediately. Downstream gets time to recover.
- **HALF_OPEN**: Probe state. A limited number of calls test recovery. Success → CLOSED; failure → OPEN.

## Setting Each Threshold

| Parameter | Lower (30–40%) | Higher (60–70%) |
|-----------|---------------|----------------|
| `failureRateThreshold` | Strict SLAs, high traffic, payment flows | Transient errors expected, false positives costly |

**Starting point:** 50%. Tune down if circuit fails to open when it should; tune up if it opens during brief spikes.

**`waitDurationInOpenState`:** Set slightly longer than the downstream service's typical restart or recovery time. 5–15s for fast-recovering services; 60–120s for services needing operator intervention.

**`minimumNumberOfCalls`:** Start at 10. Setting to 1–2 causes a single slow call to open the circuit.

## Fallback Strategies

| Strategy | When to Use |
|----------|------------|
| Cached response | Data changes infrequently; stale is acceptable |
| Default value | Empty/neutral response is acceptable |
| Throw specific exception | Caller can handle the failure explicitly |
| Queue for retry | Eventually-consistent operations |
| Static response | Critical UX must not break |

## Common Mistakes

- **`minimumNumberOfCalls` too low** — single slow call opens the circuit
- **`waitDurationInOpenState` too short** — circuit cycles open/probe/open without recovery
- **Client errors (4xx) not in `ignoreExceptions`** — inflate failure rate with caller mistakes
- **Same timeout for all services** — payment and recommendation have different profiles
- **No fallback defined** — OPEN state throws uncaught exception instead of degrading gracefully
- **HTTP timeout < `slowCallDurationThreshold`** — calls time out before they're counted as slow

## Quick Checklist

- [ ] `minimumNumberOfCalls` ≥ 10
- [ ] `failureRateThreshold` calibrated for this specific dependency
- [ ] `slowCallDurationThreshold` consistent with HTTP client read timeout
- [ ] `waitDurationInOpenState` longer than downstream recovery time
- [ ] 4xx errors in `ignoreExceptions`
- [ ] Fallback method defined with meaningful degraded behavior
- [ ] Bulkhead configured alongside circuit breaker
- [ ] Circuit state transitions trigger monitoring alerts

## Related Skills

- `connection-pool-tuner` — pool exhaustion often co-occurs with missing circuit breakers
- `chaos-engineer` — test circuit breaker behavior with controlled failure injection
- `transaction-boundary-reviewer` — wide transactions compound cascading failure risk
