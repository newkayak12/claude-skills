# RCA Template (P0/P1)

Open in Phase 6. P2/P3 use the Quick RCA in SKILL.md.

```markdown
## Incident RCA: <Title>

**Date**: YYYY-MM-DD
**Duration**: X hours Y minutes
**Severity**: P0 / P1 / P2
**Services Affected**: <list>
**Author(s)**: <names>
**Status**: Draft / Final

---

### Summary
One paragraph. What happened, what was the user impact, how was it resolved.

### Timeline
| Time (UTC) | Event |
|------------|-------|
| HH:MM | Alert fired / issue first detected |
| HH:MM | On-call paged |
| HH:MM | Triage complete; P0 declared |
| HH:MM | Root cause identified |
| HH:MM | Mitigation applied |
| HH:MM | Incident resolved |

### Root Cause
Specific, technical explanation. Not "human error" — explain what made the error possible.
Write it as causal steps (A → B → C). Each step carries an `Evidence:` line — the log, metric, trace, or diff that shows it. No evidence = mark the step `hypothesis`, not fact.

### Contributing Factors
- Factor 1 (e.g., no alerting on X metric)
- Factor 2 (e.g., runbook for this scenario was missing)
- Factor 3 (e.g., deploy pipeline did not catch Y in staging)

### What Went Well
- ...

### Action Items
| Item | Owner | Due Date | Priority |
|------|-------|----------|----------|
| Add alert for X | @person | YYYY-MM-DD | High |
| Update runbook for Y scenario | @person | YYYY-MM-DD | Medium |
| Add canary deploy for Z service | @person | YYYY-MM-DD | High |
```
