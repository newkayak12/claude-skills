# Metrics and Alerting Reference

Resilience4j exposes Micrometer metrics automatically when `resilience4j-micrometer` is on the classpath.

---

## Key Metrics

```
resilience4j.circuitbreaker.state{name="payment-service"}        # 0=CLOSED, 1=OPEN, 2=HALF_OPEN
resilience4j.circuitbreaker.failure.rate{name="payment-service"} # current failure %
resilience4j.circuitbreaker.slow.call.rate{name="payment-service"}
resilience4j.circuitbreaker.calls{name="...", kind="successful|failed|not_permitted|ignored"}
```

---

## Recommended Alerts

| Alert | Condition | Severity |
|-------|-----------|----------|
| Circuit opened | State transitions to OPEN | High — page on-call |
| Circuit not self-healing | Remains OPEN for `waitDurationInOpenState * 3` | Critical — escalate |
| Slow call rate rising | Slow call rate > 50% | Warning — leading indicator |
| Failure rate rising | Failure rate > 30% (below open threshold) | Warning — pre-emptive |

**Circuit entering OPEN state** is the primary alert. Wire it to PagerDuty or Slack immediately.

**Circuit remaining OPEN** longer than expected means the downstream service has not recovered and the HALF_OPEN probe is still failing. This requires human intervention.

**Slow call rate rising above 50%** is a leading indicator — the circuit has not opened yet but degradation is in progress. Alert at this threshold to allow proactive response before full OPEN.

---

## Grafana Dashboard Panels (suggested)

1. Circuit state over time (timeline panel: CLOSED/OPEN/HALF_OPEN)
2. Failure rate % (gauge with thresholds at 30%, 50%)
3. Slow call rate % (gauge)
4. Call volume by outcome (stacked bar: successful, failed, not_permitted, ignored)
5. p99 latency of the protected service
