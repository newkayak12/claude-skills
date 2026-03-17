# Post-Mortem Template

Use this template after both planned game day exercises and unplanned production incidents. The fields are identical so findings can be compared across both contexts.

## Post-Mortem Report

```markdown
# Post-Mortem: [Incident / Game Day Title]

**Date of incident/exercise:** YYYY-MM-DD
**Duration of impact:** HH:MM
**Severity:** P0 / P1 / P2 / Game Day
**Environment:** Production / Staging / Other
**Author(s):**
**Reviewed by:**
**Status:** Draft / Final

---

## Executive Summary

One paragraph: what happened, what was the user/business impact, and what has been done since.

---

## Incident Timeline

| Time (UTC) | Event | Who noticed / acted |
|-----------|-------|---------------------|
| HH:MM | Failure injected or first symptom observed | |
| HH:MM | First alert fired | |
| HH:MM | Incident declared / war room opened | |
| HH:MM | Root cause identified | |
| HH:MM | Mitigation applied | |
| HH:MM | Service restored to steady state | |
| HH:MM | Incident closed | |

---

## Impact

- **Users affected:** (count or percentage)
- **Error rate peak:** %
- **Latency degradation:** (p50 / p99 before vs. during)
- **Data loss:** Yes / No — describe if yes
- **SLO breach:** Yes / No — which SLO, by how much

---

## Root Cause Analysis

### Primary cause

Describe the direct technical cause.

### Contributing factors

List conditions that made the incident worse or recovery slower.

### Five-Whys Analysis

1. Why did the system fail? →
2. Why did [answer 1] happen? →
3. Why did [answer 2] happen? →
4. Why did [answer 3] happen? →
5. Why did [answer 4] happen? → (root cause)

---

## What Went Well

1.
2.
3.

---

## What Didn't Go Well

1.
2.
3.

---

## Surprises

Things that were unexpected or not covered by existing runbooks:

1.
2.

---

## Action Items

| Action | Owner | Due Date | Priority | Tracking link |
|--------|-------|----------|----------|---------------|
| | | | P0/P1/P2 | |

Priority guide: P0 = fix before next deploy, P1 = fix this sprint, P2 = scheduled backlog.

---

## Improvement Tracking

Review this section at the next post-mortem to verify action items were completed.

| Action | Status | Notes |
|--------|--------|-------|
| | Open / In Progress / Done | |

---

## Appendix

- Metrics dashboard export: [link]
- Logs / traces: [link]
- Screen recordings (game days): [link]
- Raw observation notes: [link]
```

## When to Use This Template

- **After every game day exercise** — scheduled immediately at the close of the debrief session
- **After every P0/P1 production incident** — draft within 24 hours, final version within 5 business days
- **After near-misses** — optional but recommended; near-misses often reveal the same structural gaps as actual incidents at lower cost

## Key Differences: Planned vs. Unplanned Events

| Field | Game Day | Production Incident |
|-------|----------|---------------------|
| Timeline precision | Minutes | Seconds (pull from logs/traces) |
| Impact section | Staging metrics only | Real user / revenue data |
| Five-Whys depth | 2–3 levels sufficient | All 5 levels required |
| Action item urgency | P1–P2 typical | P0 items must ship before next deploy |
