---
name: adr-writer
description: |
  Architecture Decision Record (ADR) writing assistant — helps articulate WHY an architecture decision was made, not just what was decided. Use when the user mentions "ADR", "아키텍처 결정", "architecture decision", "결정 기록", "왜 이렇게 설계했는지", or is trying to document a technical choice, explain a design rationale to their team, or record a tradeoff. Trigger this skill even if the user simply asks "how do I explain this design?" or "나중에 팀이 이걸 왜 이렇게 했는지 이해해야 해" without explicitly asking for an ADR.
---

# Architecture Decision Record Writer

An Architecture Decision Record (ADR) is a short document capturing a significant architectural decision — the context that forced it, the decision itself, and the consequences that follow. ADRs are the institutional memory of a codebase. Without them, every new team member re-litigates old debates, and every incident review loses context.

## Why ADRs Matter

Decisions made today are forgotten in six months. The developer who makes a decision carries the context in their head; everyone else sees only the outcome. When that developer leaves — or when the context changes — the team is left with a constraint they cannot explain and therefore cannot safely change.

ADRs answer the question future maintainers will inevitably ask: "Why on earth did they do it this way?" A good ADR makes the reasoning transparent so the team can decide: is the original constraint still valid? If yes, respect the decision. If no, supersede it with a new ADR.

## Standard ADR Format

```markdown
# ADR-[NNN]: [Short Title — imperative, ≤ 60 characters]

## Status
[Proposed | Accepted | Deprecated | Superseded by ADR-NNN]

## Date
[YYYY-MM-DD]

## Context
[What situation, constraint, or problem forced this decision?
Include: system state, team constraints, business requirements,
technical limitations, and any failed alternatives already tried.
Be specific — vague context produces vague decisions.]

## Decision
[What was decided? State it clearly and directly.
"We will use X" not "It was decided that X might be used".
One to three sentences maximum.]

## Rationale
[Why this option over the alternatives?
Reference the specific constraints from Context.
Explain the tradeoffs accepted — not just the benefits gained.]

## Alternatives Considered
[List each alternative with a brief reason it was rejected.
Format: **Option name** — reason rejected.]

## Consequences
### Positive
- [Benefit gained]

### Negative
- [Cost accepted or risk introduced]

### Neutral / Follow-up
- [Things that change or need monitoring as a result]
```

## Filling Each Section

If `sequential-thinking` is available, use it to progress through each ADR section in order — this directly prevents the most common failure: thin Context sections and Consequences that list only positives.

### Context — The Most Important Section

Context is where most ADRs fail. The decision itself is often obvious once the context is clear. Write context as if explaining to a smart engineer who joined the team today and has read the codebase but knows nothing about past discussions.

Include:
- What specific problem or requirement triggered this decision
- What constraints existed (performance budget, team skill set, existing infrastructure, compliance requirements)
- What the system looked like before the decision
- Any experiments or prototypes that informed the choice

Avoid:
- Generic statements ("We needed to scale") — quantify ("We needed to handle 10k concurrent WebSocket connections per node")
- Blaming prior decisions — describe the situation neutrally

### Decision — Be Direct

State the decision as a definitive choice, not a proposal. Use active voice and present tense.

```
# Bad
It was determined that a message queue might be beneficial for
decoupling the notification system.

# Good
We will use RabbitMQ to decouple the notification service from
the order processing pipeline.
```

### Consequences — Be Honest About Costs

Every architectural decision accepts tradeoffs. Listing only positive consequences is marketing, not documentation. Future maintainers need to know what pain was accepted so they do not accidentally "fix" the mitigation without understanding why it exists.

## Numbering and Storage

Store ADRs in the repository they affect:
```
docs/adr/
  0001-use-postgresql-over-mysql.md
  0002-adopt-event-driven-architecture.md
  0003-supersede-0001-migrate-to-aurora.md
```

Number sequentially. When a decision is reversed, create a new ADR that supersedes the old one — never delete or rewrite the original. The history of reversals is as valuable as the decisions themselves.

## Example ADR

```markdown
# ADR-0012: Use Outbox Pattern for Cross-Service Event Publishing

## Status
Accepted

## Date
2025-11-03

## Context
The order service must publish `OrderPlaced` events to the inventory
and notification services. Initially we published directly to Kafka
inside the same application transaction. This caused dual-write
failures: the database commit succeeded but the Kafka publish failed
(or vice versa) approximately 0.3% of the time under load, producing
orders with no inventory reservation and customers with no confirmation
email. We cannot afford message loss for financial transactions.

## Decision
We will implement the Transactional Outbox pattern: domain events are
written to an `outbox` table inside the same database transaction as
the business data, and a separate relay process polls the outbox and
publishes to Kafka with at-least-once delivery semantics.

## Rationale
The outbox guarantees atomicity between the business write and the
event record because both use the same database transaction. The relay
process handles publish failures with retries. Consumers must be
idempotent (which they already are per ADR-0008). This eliminates the
dual-write problem without introducing a distributed transaction coordinator.

## Alternatives Considered
**Kafka Transactions (exactly-once semantics)** — Rejected: requires
all consumers to participate in Kafka transactions, imposes significant
throughput penalty, and couples us tightly to Kafka internals.

**Two-Phase Commit** — Rejected: no support in our PostgreSQL + Kafka
stack without an external coordinator (XA); adds operational complexity
we cannot staff.

**Accept occasional loss with reconciliation jobs** — Rejected: unacceptable
for financial events; reconciliation jobs delay detection and are hard to audit.

## Consequences
### Positive
- Zero dual-write failures for events within a single bounded context
- Retry logic is decoupled from the business transaction
- Events are durable even if Kafka is temporarily unavailable

### Negative
- Additional `outbox` table and relay service to operate and monitor
- At-least-once delivery requires all consumers to be idempotent
- Polling introduces up to 500ms latency for event delivery (acceptable for our SLA)

### Neutral / Follow-up
- Relay service must be monitored for lag; add alert if outbox backlog > 1000 rows
- Review polling interval (currently 500ms) after 30 days of production data
```

## When to Write an ADR

Write an ADR when:
- The decision is hard to reverse (database choice, event schema, API contract)
- Multiple reasonable alternatives existed
- The decision will surprise or puzzle future maintainers
- The team debated it for more than 30 minutes
- An external constraint (compliance, budget, vendor lock-in) drove the choice

Do not write an ADR for:
- Trivial implementation details (which loop to use, variable naming)
- Decisions with only one reasonable option
- Decisions that will be revisited within weeks

## Quick Checklist

- [ ] Title states the decision, not the problem
- [ ] Context is specific and quantified where possible
- [ ] Decision is stated directly in active voice
- [ ] At least two alternatives are documented with rejection reasons
- [ ] Negative consequences are listed honestly
- [ ] Status reflects current state (not perpetually "Proposed")
- [ ] ADR is stored in the repository it affects
- [ ] Superseded ADRs reference their replacement
