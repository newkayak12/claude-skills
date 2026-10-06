# Monitoring and Alerting

## The four signals per service

| Signal | Question | Spring/Micrometer source |
|---|---|---|
| Latency | How long do requests take, split by success and failure? | `http_server_requests_seconds_*` |
| Traffic | How much demand? | rate of the same count series |
| Errors | What fraction fail, explicitly (5xx) or implicitly (200 with wrong body, slow past SLO)? | `status=~"5.."` label |
| Saturation | How full is the scarcest resource? | `hikaricp_connections_active / hikaricp_connections_max`, `jvm_memory_used_bytes`, executor queue size, Postgres `pg_stat_activity` counts |

Failed requests are often fast; keep their latency out of the success histogram or the p99 looks healthy during an outage.

Recording rules keep dashboards and alerts cheap:

```yaml
groups:
  - name: orders_signals
    rules:
      - record: orders:request_rate:5m
        expr: sum(rate(http_server_requests_seconds_count{app="orders"}[5m]))
      - record: orders:error_ratio:5m
        expr: |
          sum(rate(http_server_requests_seconds_count{app="orders",status=~"5.."}[5m]))
          / sum(rate(http_server_requests_seconds_count{app="orders"}[5m]))
      - record: orders:latency_p99:5m
        expr: histogram_quantile(0.99, sum by (le) (rate(http_server_requests_seconds_bucket{app="orders"}[5m])))
      - record: orders:hikari_utilisation
        expr: max(hikaricp_connections_active{app="orders"} / hikaricp_connections_max{app="orders"})
```

## What deserves a page

A page must be urgent, actionable and about user harm. Test each rule with three questions: does a human need to act in minutes, is there something they can do, is a user hurt or about to be.

- Page on burn rate (see the SLO file) and on imminent hard limits (disk full within hours, connection pool pinned at max for minutes).
- Ticket on slow burn, certificate expiry in 14 days, replica lag trending up.
- Dashboard only: CPU, GC pauses, single-pod restarts, cache hit rate.

```yaml
- alert: OrdersFastBurn
  expr: |
    (sum(rate(http_server_requests_seconds_count{app="orders",status=~"5.."}[1h]))
      / sum(rate(http_server_requests_seconds_count{app="orders"}[1h]))) > 0.0144
    and
    (sum(rate(http_server_requests_seconds_count{app="orders",status=~"5.."}[5m]))
      / sum(rate(http_server_requests_seconds_count{app="orders"}[5m]))) > 0.0144
  for: 2m
  labels: {severity: page}
  annotations:
    summary: "orders burning 2% of monthly budget per hour"
    runbook: "link to the runbook page for this alert"
```

## Runbook skeleton for an alert

1. What the alert means in user terms, and its severity.
2. Three-step triage: scope (which endpoint, region, tenant), recent change (deploy, flag, migration), dependency health.
3. Mitigations in order of speed: roll back, disable flag, scale out, shed load, fail over. Include the exact command or console path.
4. How to confirm recovery (the metric and the value to see).
5. Who to escalate to and when.
6. Follow-up: link to the ticket template for the permanent fix.

Review runbooks after each use; a step nobody followed is a step to delete or fix.

## Dashboard layout

Top row: SLI, remaining budget, burn rate. Second row: the four signals for the service. Third row: dependencies (database, cache, broker, downstream HTTP) with the same signals. Bottom: deploy and flag markers overlaid as annotations so cause and effect line up. One dashboard per service, same layout everywhere, so on-call can read an unfamiliar one.

## Fighting alert fatigue

Measure the pager: pages per shift, share with no action taken, share out of hours, time to acknowledge. Healthy rotations see at most a couple of actionable pages per 12-hour shift.

Actions, in order:
1. Delete alerts that never led to action in the last quarter.
2. Convert cause-based alerts (CPU, queue length) to symptom-based ones.
3. Add `for:` durations and the short-window condition to remove blips.
4. Group and inhibit: a node-down alert should silence the pod alerts on that node.
5. Route by ownership, not by broadcast.

## On-call norms

- Primary and secondary, with a written handoff note at rotation change.
- Compensation or time off in lieu for out-of-hours pages.
- Anyone can escalate without justification.
- Every page either produces a fix, a threshold change or a deletion.
