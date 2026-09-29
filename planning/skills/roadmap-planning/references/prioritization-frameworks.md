# Prioritization Frameworks (Phase 3)

Phase 3 needs a scoring method and, per the standing mandate, an explicit split between committed
and aspirational work. Use RICE to rank, MoSCoW to draw the commitment line.

## RICE Scoring

```
RICE Score = (Reach × Impact × Confidence) ÷ Effort
```

| Factor | Definition | Scale |
|---|---|---|
| Reach | Users affected per quarter | Absolute number (e.g., 5,000 users/quarter) |
| Impact | Movement on the target metric per user | 3 = massive, 2 = high, 1 = medium, 0.5 = low, 0.25 = minimal |
| Confidence | How confident the estimate is | 100% = high evidence, 80% = medium, 50% = low |
| Effort | Total person-months of work | Absolute number (e.g., 2 person-months) |

Use the same time horizon (one quarter) for Reach across every epic — scores are only comparable
within one backlog, not across roadmaps. Recalculate when new evidence changes Impact or
Confidence. See `examples/sample.md` — Example 4 for a worked RICE table.

## MoSCoW for the Commitment Line

Use alongside RICE when a quarter's scope must draw a hard in/out line — this is what makes
"committed vs. aspirational" (a standing mandate) concrete rather than a vibe.

| Label | Meaning | Criteria |
|---|---|---|
| Must Have | Committed — the quarter fails without it | Legal, safety, core flow, contractual |
| Should Have | Committed if capacity holds | Materially improves the outcome; can slip one quarter |
| Could Have | Aspirational | Delighter or edge case; first to drop under pressure |
| Won't Have (this time) | Explicitly out of scope | Document the reason — this is as important as the Must Haves |

Document every "Won't Have" with a one-line rationale. An undocumented cut reads as forgotten,
not deprioritized, and resurfaces as a stakeholder surprise in Phase 5.

## When Everyone Says P1

If strategic-fit review (Phase 3, Activity 3) surfaces disagreement rather than a single override
candidate, force a ranking instead of re-scoring: "If only one of these ships this quarter, which
moves the target outcome most?" Repeat pairwise until the group has a ranked list — it is easier
for people to choose between two items than to rank ten.
