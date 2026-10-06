# Toil and Capacity

## What counts as toil

Work is toil when it is manual, repetitive, automatable, reactive, without lasting value, and grows with service size. Judgement calls, design work and one-off migrations are not toil even if tedious.

Aim to keep toil under half of an engineer's time; many teams target about a third. Above half, stop taking new feature work until an automation plan exists.

## Inventory and rank

Collect two weeks of data from tickets, chat requests, and a short survey. For each task record frequency, minutes per run, people involved, and error rate.

Score = (runs per month x minutes per run) / hours to automate. Automate the high scores first; tasks with a score under 1 over a year rarely repay the effort.

```kotlin
data class Toil(val name: String, val runsPerMonth: Int, val minutes: Int, val hoursToAutomate: Int) {
    val monthlyHours get() = runsPerMonth * minutes / 60.0
    val paybackMonths get() = hoursToAutomate / monthlyHours
}

val ranked = inventory.sortedBy { it.paybackMonths }
```

## Automation ladder

1. Document the steps in a runbook.
2. Turn the runbook into a script with a dry-run flag.
3. Make the script idempotent and safe to rerun.
4. Trigger it from an alert or schedule, with a human approval gate.
5. Remove the gate once its results have been right for a quarter.

Every automated action needs: a kill switch, a rate limit, an audit log line, and a test against a staging copy. Automation that restarts things must stop after N attempts and page instead; endless restart loops hide the defect.

Typical candidates: restart on failed liveness probe (Kubernetes already does it, tune probes instead of scripting), certificate renewal, stale-branch and temp-file cleanup, disk pruning, access requests, scheduled failover rehearsals.

## Track the result

Per quarter: toil percentage by team, hours reclaimed, number of tasks automated, pages from automation failures. Report them next to SLO numbers so reliability work is visible.

## Capacity planning

Goal: have the right headroom before demand arrives, without paying for idle machines.

1. Pick the demand driver (requests per second, active users, orders per day) and the resource it consumes (CPU, memory, DB connections, IOPS, storage).
2. Load test to find the per-instance ceiling at which latency SLO still holds; note the limiting resource.
3. Forecast demand: take at least 3 months of history, remove outliers, fit a trend, then layer known events (launches, campaigns, seasonality).
4. Required instances = forecast peak / (per-instance ceiling x target utilisation). Use 60-70% target utilisation so a lost zone or a deploy does not push you over.
5. Add N+1 (or one zone) for failure tolerance.
6. Review monthly and compare forecast with actuals; adjust the model, not just the numbers.

PostgreSQL-specific limits to forecast separately: connections (`max_connections` versus summed pool sizes across replicas), table and index growth, WAL volume, replication lag at peak write rate. A horizontal service tier scales out freely, but every added pod multiplies pool connections against a database that does not.

Autoscaling reacts; it does not replace planning. Set a floor from the forecast, a ceiling from the budget, and alert when the ceiling is approached.
