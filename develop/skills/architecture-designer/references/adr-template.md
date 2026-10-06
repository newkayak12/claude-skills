# Writing an Architecture Decision Record

One file per decision, kept in the repository next to the code (for example `docs/adr/0007-use-outbox-for-events.md`). Numbers only increase; the title states the decision in a short imperative.

## Sections

- **Status** — proposed, accepted, deprecated, or superseded by ADR-n. Never delete an old record; supersede it.
- **Context** — the forces at play: requirements, constraints, deadlines, team skills. Facts only, with numbers where they exist.
- **Decision** — one or two sentences, active voice: "We will ...".
- **Alternatives** — each option actually considered and the specific reason it lost. A record with no losing option is not a decision.
- **Consequences** — what gets easier, what gets harder, and what must now be done or watched. Include the downsides honestly.

## When a record is warranted

Write one when the choice is costly to reverse, crosses team boundaries, or someone new would otherwise ask "why did we do this?". Skip it for choices that a single pull request can undo.

## Example

```markdown
# ADR-0012: Publish domain events through a transactional outbox

Status: accepted

## Context
Order service writes to PostgreSQL and publishes to Kafka. Dual writes have lost
events twice in the last quarter. Peak is ~200 orders/s; one team owns the service.

## Decision
We will insert events into an `outbox` table in the same transaction as the
order change and relay them to Kafka from a separate poller.

## Alternatives
- Dual write with retries: still loses events when the process dies between writes.
- CDC on the orders table: no extra table, but a new component to run and a
  schema coupling we do not want yet.

## Consequences
Easier: no lost events; ordering per aggregate is preserved.
Harder: consumers see duplicates and must be idempotent; the relay needs monitoring
for lag; the outbox needs a cleanup job.
```

## Review habits

- Circulate the draft before the decision is made, not after.
- Link the record from the code or module README it governs.
- Revisit when a listed consequence actually happens.
