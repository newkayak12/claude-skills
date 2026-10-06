# Non-Functional Requirements

A requirement counts only when it has a number, a scope and a way to check it. "Fast" and "secure" are wishes; "p95 under 300 ms for checkout at 500 req/s" is a requirement.

## Prompts by quality

| Quality | Ask | Example target |
|---------|-----|----------------|
| Performance | Which operations matter, at what percentile, under what load? | search p95 < 400 ms at peak |
| Scalability | Expected growth in users, data and traffic over 12-24 months? Which part saturates first? | 10x orders without redesign |
| Availability | What does downtime cost per hour? Planned maintenance allowed? | 99.9% monthly, i.e. about 43 minutes of budget |
| Reliability | What may be lost on failure? How quickly must service return? | RPO 5 min, RTO 30 min |
| Security | What data classes exist? Who may see or change them? Which regulations apply? | PII encrypted at rest; audit log of admin actions |
| Observability | How will you know it is broken before users say so? | trace id on every request, alert on error-rate SLO burn |
| Maintainability | Who changes it, how often, how safely? | deploy on demand; rollback under 10 minutes |
| Cost | What is the budget per month, and per unit of work? | under a fixed monthly cloud budget |

## Process

1. Interview for the prompts above; record unknowns as open questions, not assumptions.
2. Rank. Rarely can all be maximised; name the two or three that drive the design.
3. Tie each ranked quality to a decision it influences (cache, replica, queue, region).
4. Put the targets where tests and alerts can read them.

## Record format

```markdown
| Quality | Requirement | Measure | Source | Priority |
|---------|-------------|---------|--------|----------|
| Availability | 99.9% monthly | uptime probe, SLO dashboard | product owner | high |
```
