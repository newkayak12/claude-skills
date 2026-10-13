---
name: circuit-breaker-tuner
description: >-
  Use when a slow or failing downstream exhausts upstream threads and breakers, bulkheads or fallbacks need tuning.
  Triggers on: "서킷 브레이커 설정", "서킷이 자주 열려", "cascading failure", "circuit breaker tuning". Not for SQL or chaos.
scenarios:
  - "Our circuit breaker is tripping too often and causing unnecessary service disruptions"
  - "Help me tune the circuit breaker thresholds for our payment service"
  - "A slow downstream keeps exhausting our threads — add bulkheads and fallbacks"
  - "서킷 브레이커가 너무 자주 열려서 서비스 장애가 발생해"
  - "서킷 브레이커 임계값 설정을 도와줘"
  - "다운스트림이 느려지면 우리 서비스 전체가 죽어, 어떻게 막아?"
compatibility:
  recommended:
    - think-tool
  optional:
    - sequential-thinking
  remote_mcp_note: >-
    think-tool이 있으면 failureRateThreshold와 waitDuration 트레이드오프를 더 정확하게
    평가합니다. Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
---

## Standing Mandates

- NEVER set a threshold from defaults or round numbers alone. Take the dependency's measured latency and recovery time;
  if they are missing, write `[확인 필요: ○○]` and give the starting value labelled as a starting value. A breaker
  tuned to a guessed recovery time flaps open/probe/open or stays open too long.
- NEVER ship a breaker without a fallback decision and a bulkhead. An OPEN circuit with no fallback throws to the
  caller, and without a bulkhead the pool is already exhausted before the circuit opens.
- NEVER apply a tuned value without the user confirming it against their metrics; Claude cannot see production
  traffic.
- NEVER treat a timeout as a breaker setting only: check the HTTP client timeout against `slowCallDurationThreshold`,
  otherwise a slow dependency shows up only as timeouts (failures) and `slowCallRateThreshold` never trips.
- Goal: each dependency has a config with a stated reason per value, a fallback, a bulkhead, a state-change alert and
  an OPEN to HALF_OPEN to CLOSED test; the closing tally recounts to the dependency table.

# Circuit Breaker Tuner

**Not for** slow SQL or missing indexes (`develop:sql-pro`, `develop:database-optimizer`), pool sizing alone
(`develop:connection-pool-tuner`), or designing failure experiments (`develop:chaos-engineer`).

## Process

1. **Identify the dependency** — which downstream is failing or slow; typical latency and recovery time. Read client
   code, config and dashboards first; mark what is absent `[확인 필요: ○○]`.
2. **Choose state machine parameters** — `failureRateThreshold`, `waitDurationInOpenState`, `minimumNumberOfCalls`
   (see Setting Each Threshold). Put 4xx in `ignoreExceptions`: they are caller mistakes, not dependency failures.
3. **Configure the sliding window** — COUNT_BASED (by request count) or TIME_BASED (by time window).
4. **Define a fallback** — what callers receive when the circuit is OPEN; strategies table in
   `references/fallback-patterns.md`.
5. **Add a bulkhead** — limit concurrent calls so the pool is not exhausted before the circuit opens.
6. **Wire monitoring** — alert on state transitions (CLOSED to OPEN); verify alert routing reaches the right team.
7. **Recount** — count dependencies, those with all five parts (config, fallback, bulkhead, alert, recovery test) and
   open `[확인 필요]` items; fix the tally if the table differs.

Templates: `references/resilience4j-config.md` (also the state machine and common mistakes); fallback code:
`references/fallback-patterns.md`; metrics: `references/metrics-alerting.md`.

## Setting Each Threshold

| Parameter | Lower (30–40%) | Higher (60–70%) |
|-----------|---------------|----------------|
| `failureRateThreshold` | Strict SLAs, high traffic, payment flows | Transient errors expected, false positives costly |

**Starting point:** 50%. Tune down if circuit fails to open when it should; tune up if it opens during brief spikes.

**`waitDurationInOpenState`:** Set slightly longer than the downstream service's typical restart or recovery time. 5–15s for fast-recovering services; 60–120s for services needing operator intervention.

**`minimumNumberOfCalls`:** library default 100; 10 for low-traffic dependencies. Setting to 1–2 causes a single slow call to open the circuit.

## Output Template

```
## Circuit breaker — <service> (<library, version>)

| Dependency | Latency / recovery (source) | failureRate | waitOpen | minCalls | Window | Fallback | Bulkhead | Alert | Recovery test |
|------------|-----------------------------|-------------|----------|----------|--------|----------|----------|-------|---------------|

Config: Resilience4j YAML or code, each value with a one-line rationale
Gaps: [확인 필요: ○○] ...

<n> dependencies · <c> complete · <g> gaps
```

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Recommends threshold values with rationale | Confirm recovery time from your runbooks/metrics |
| Generates Resilience4j YAML or Spring Boot config | Apply and validate in your environment |
| Implements fallback method stubs | Fill in the real degraded-mode business logic |
| Identifies common config mistakes in your current setup | Test the circuit under load |

## Related Skills

- `develop:connection-pool-tuner` — pool exhaustion often co-occurs with missing circuit breakers
- `develop:chaos-engineer` — test circuit breaker behavior with controlled failure injection
- `develop:transaction-boundary-reviewer` — wide transactions compound cascading failure risk
- `develop:sre-engineer` — alerting and error budget for the breaker's state changes
