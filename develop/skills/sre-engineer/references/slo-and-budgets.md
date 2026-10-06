# SLOs and Error Budgets

## Choosing an SLI

An SLI is a ratio: good events divided by valid events, measured where users feel it (load balancer or ingress, not the pod's own view).

| User-visible need | SLI | Good event |
|---|---|---|
| Request succeeds | availability | non-5xx response (4xx are the caller's fault, exclude them from valid events) |
| Request is fast | latency | response under a threshold, e.g. 300 ms |
| Data is current | freshness | row/replica updated within N seconds |
| Result is right | correctness | output passes a probe or reconciliation check |
| Batch finishes | throughput / completion | job ended inside its window |

Prefer a threshold-count latency SLI ("97% under 300 ms") over a mean or a single percentile gauge: it aggregates correctly across instances and windows.

With Spring Boot Actuator plus Micrometer, turn on the histogram buckets so the ratio can be computed:

```yaml
management:
  metrics:
    distribution:
      percentiles-histogram:
        http.server.requests: true
      slo:
        http.server.requests: 100ms,300ms,1s
```

```promql
# availability SLI over 30d
sum(rate(http_server_requests_seconds_count{status!~"5.."}[30d]))
  / sum(rate(http_server_requests_seconds_count[30d]))

# latency SLI: share of requests faster than 300ms (assumes a 300ms SLO and a le="0.3" bucket;
# counts error responses too, so filter status if errors are tracked in a separate SLI)
sum(rate(http_server_requests_seconds_bucket{le="0.3"}[30d]))
  / sum(rate(http_server_requests_seconds_count[30d]))
```

## Setting the target

1. Look at what the service actually achieved over the last quarter.
2. Ask what users would notice. A target tighter than the weakest dependency is fiction.
3. Pick a round number a little looser than reality, then tighten later.
4. Write the target with its window: "99.9% of requests succeed, rolling 30 days".

Rough tiers: internal batch 99%, internal APIs 99.5%, customer-facing APIs 99.9%, payment or auth paths 99.95%. Each extra nine costs far more than the last; ask who pays for it.

Downtime arithmetic for a 30-day window: allowed bad time = (1 - target) x 43,200 min. 99% = 432 min, 99.9% = 43.2 min, 99.99% = 4.32 min.

Chained dependencies multiply: three serial services at 99.9% give about 99.7% end to end.

## The budget

Budget = 1 - SLO. It is a spendable quantity: deploys, experiments and incidents all draw on it.

Request-based worked case: SLO 99.9%, 10M requests per window gives 10,000 allowed failures. If 5,000 failures land in week one, 50% of the budget is gone after 25% of the window.

Remaining budget as PromQL (30d, 99.9%):

```promql
1 - (
  (1 - availability_sli_30d) / 0.001
)
```

## Burn rate

Burn rate = observed error ratio / allowed error ratio. 1.0 exhausts the budget exactly at window end; 10 exhausts it in a tenth of the window.

Alert on burn rate with two windows (long confirms it is real, short confirms it is still happening):

| Severity | Long window | Short window | Burn rate | Budget consumed |
|---|---|---|---|---|
| Page | 1 h | 5 min | 14.4 | 2% |
| Page | 6 h | 30 min | 6 | 5% |
| Ticket | 3 d | 6 h | 1 | 10% |

Threshold in error-ratio terms = burn rate x (1 - SLO). For 99.9%: 14.4 x 0.001 = 0.0144.

## Policy

Write the policy before the budget runs out, get product and engineering to sign it, and keep it to a page.

```yaml
service: orders-api
slo: "99.9% non-5xx, rolling 30d"
owner: orders-team
thresholds:
  - remaining: "> 50%"
    action: normal delivery pace
  - remaining: "10-50%"
    action: reliability work gets first pick; risky launches need review
  - remaining: "< 10%"
    action: feature releases paused; only fixes and rollbacks ship
  - remaining: "0%"
    action: freeze until budget is positive or the exec sponsor grants a written exception
exclusions: [announced maintenance, client-caused 4xx, load tests]
review: quarterly, or after any incident that burned more than 20%
```

Decision shortcuts: a single incident that eats most of the budget gets a postmortem and a fix list; slow steady burn points to a chronic defect or an SLO that does not match reality; a budget that is never touched suggests the SLO is too loose or releases are too timid.

## SLO review checklist

- Every target has a named user journey and a measurement point.
- Targets are numbers with windows, agreed with the owner of the user relationship.
- Dashboards show remaining budget and current burn, not just the SLI.
- Alerts exist for fast and slow burn; none fire on raw CPU or single-pod errors.
- The policy lists who may grant an exception.
