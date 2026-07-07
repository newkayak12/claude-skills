# Situational — Operations & Observability Baseline

**Trigger**: just before release / while operating / when setting Performance budget, Observability, or agreeing on SLO

The Performance budget and Observability items split out from the DoD in `06-rules.md` live here. This is the baseline to pass *once, just before release*.

## O-01: Three Pillars — required before release

All three must be in place to trace incidents.

- **Logs**: structured (JSON) + correlation ID propagation + level classification
- **Metrics**: RED (Rate, Errors, Duration) or USE (Utilization, Saturation, Errors) model
- **Traces**: distributed tracing. OpenTelemetry recommended (vendor-neutral)

**How**:
- For each of the three, you must be able to answer "where do I look for this?"
- Having only one type means *some incidents will be permanently unsolvable*

## O-02: Performance budget — set numbers in advance

- **Why**: "Fast" is not a shared agreement. NFRs without numbers are unagreed NFRs.
- **How**:
  - P95/P99 response time targets per critical path (e.g. login P95 < 300ms, search P95 < 500ms)
  - Page load: FCP < 1.5s, LCP < 2.5s, INP < 200ms (Web Vitals)
  - Backend throughput: ___ rps (specific scenario)
  - Resource limits: memory < ___MB, CPU < ___% (single instance)

## O-03: SLO + Error Budget

- **Why**: 100% availability is *impossible* and *inefficient*. Decide in advance how much downtime is acceptable.
- **How**:
  - Example SLO: "99.9% monthly availability (≈ 43 minutes of downtime permitted)"
  - Error budget = 100% − SLO. New features can ship while this budget is unspent. Once exhausted, *focus on stability*.
  - Simplified for solo developers: *X minutes of downtime permitted per week*

## O-04: Alarms with thresholds — metrics without alarms are useless

- **Why**: A dashboard without *alarms* means incidents arrive as *user reports*.
- **How**:
  - Set thresholds for each key metric (e.g. 5xx rate > 1% / 5 min, P95 > 1s / 5 min, DB connections > 80% / 1 min)
  - **An alarm must be actionable**. "FYI alarms" cause *alarm fatigue* only → remove them.
  - On-call rotation or solo operator channel

## O-05: Runbook for top-5 failure modes

- **Why**: There is no time to search official documentation in the middle of an incident. Procedures not prepared in advance are non-existent procedures.
- **How**:
  - Top 5: DB down / external API failure / OOM / disk full / traffic spike
  - For each: *symptom → diagnostic commands → first response → escalation*
  - *Read and update* quarterly (prevent drift)

## O-06: Feature flag for risky changes

- **Why**: A change that cannot be turned off is an *irreversible* change. Large changes require a safety net.
- **How**:
  - Deploy behavior changes (other than DB migrations) behind a feature flag
  - Per flag: *default value, progressive ramp ratio, cleanup trigger*
  - Flag cleanup is also debt — register it in the debt register [`R-TD01`](../06-rules.md#r-td01-debt-register--consciously-catalog-it)

## O-07: Blameless postmortem — the system, not the person

- **Why**: Blaming people causes *the next incident to be hidden*. System defects accumulate.
- **How**:
  - Write a postmortem within 24–72h after an incident
  - Format: *timeline / impact / root cause / 5 whys / action items*
  - Assign responsibility at the *role* level (Service Owner), not at the *individual name* level.
  - Action items must have an *owner + deadline*

## O-08: Gradual rollout — 0% → 10% → 100%

- **Why**: Turning on 100% at once means 100% failure at once.
- **How**:
  - Feature flag or load balancer weighting
  - Per-stage *metric gate* (error rate / latency / business metric)
  - If the gate fails — *auto rollback*

## O-09: Capacity planning — explicitly

- **Why**: Traffic growth is *continuous* but resources scale in *jumps*. Without planning, incidents happen.
- **How**:
  - One capacity review per cycle: *current usage vs limit vs projected growth*
  - When usage reaches 60–70% of limit, *trigger an expansion plan*

## O-10: Operations tooling secrets are secrets too

- **Why**: Leaked credentials or webhook URLs from monitoring, logging, and alerting systems break *control above control*.
- **How**:
  - Store operations tool secrets in vault / KMS ([`security.md#s-01`](./security.md))
  - Alert webhook URLs must not appear in public channels
  - Monitoring dashboard access follows least privilege

## O-11: Cost monitoring — cost is a metric

- **Why**: Resource usage and *cost* are different. Ignoring cost creates *silent debt*.
- **How**:
  - Track cost daily / weekly / monthly
  - *Cost alarms* — thresholds at 80%, 100%, 120% of budget
  - For solo developers, an alert for exceeding the free tier limit is essential

## Related skills

- `develop:operations-workflow` — operations readiness entry point
- `develop:sre-engineer` — SRE mindset
- `develop:incident-response-playbook` — incident response procedures
- `develop:chaos-engineer` — pre-failure injection validation
- `develop:performance-profiling-optimization` — performance bottleneck analysis
- `develop:circuit-breaker-tuner` — external dependency failure isolation
- `develop:connection-pool-tuner` — DB connection pool
- `develop:dockerfile-optimizer` — container operation efficiency
