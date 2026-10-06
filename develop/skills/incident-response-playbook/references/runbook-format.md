# Runbook Format

One alert or symptom = one 3-line entry. Anything longer gets skipped at 3 a.m.

```
<Alert / symptom name>
Means: what this signal says is wrong (one sentence, user-visible effect).
First check: the single command, dashboard, or query to run first.
Escalate to: who or which skill/team, and the condition for paging them.
```

Example:

```
HighErrorBudgetBurn
Means: >1.4% of requests failing for 1h; users see checkout errors.
First check: last deploy time vs. error onset (deploy dashboard); if aligned, roll back.
Escalate to: DB on-call if connection-pool saturation > 90%; else IC for P1 declaration.
```

Refresh on close: when an incident used this runbook, update the entry before closing — wrong step corrected, missing check added.
