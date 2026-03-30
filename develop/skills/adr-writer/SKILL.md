---
name: adr-writer
description: >-
  Use when someone needs to document a significant architectural decision — capturing
  why a technical choice was made, what tradeoffs were accepted, and what alternatives
  were rejected. Also applies when explaining a past architectural choice to the team
  or recording that a decision supersedes a previous one.
  Triggers on: "write an ADR", "document this decision", "architecture decision record",
  "why did we choose X", "record this tradeoff", "아키텍처 결정 기록", "의사결정 문서화".
  Best for: hard-to-reverse decisions, contested choices needing documented rationale,
  decisions that will surprise future maintainers.
  Not for: trivial implementation details, decisions with only one reasonable option,
  or choices that will be revisited within weeks.
compatibility:
  recommended:
    - think-tool
    - sequential-thinking
  optional: []
  remote_mcp_note: >-
    think-tool이 있으면 트레이드오프 분석과 대안 평가를 더 깊이 수행할 수 있습니다.
    sequential-thinking은 Context → Decision → Consequences 흐름을 단계별로 강제합니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
---

# Architecture Decision Record Writer

## When to Use / When Not to Use

**Use when:**
- The decision is hard to reverse (database choice, event schema, API contract)
- Multiple reasonable alternatives existed and were debated
- An external constraint (compliance, budget, vendor lock-in) drove the choice
- The team debated the decision for more than 30 minutes

**Do not use when:**
- Trivial implementation details (which loop to use, variable naming)
- Only one reasonable option existed
- The decision will be revisited within weeks

## Process

1. **Capture context** — Identify the specific problem, constraints, and system state that forced this decision
2. **State the decision** — Write it as a direct, active-voice declaration ("We will use X")
3. **Document alternatives** — List each option considered with the concrete reason it was rejected
4. **Assess consequences** — List both positive AND negative outcomes honestly
5. **Set status and storage** — Assign status (Proposed/Accepted), number sequentially, place in `docs/adr/`

If `sequential-thinking` is available, progress through each section in order — this prevents the most common failure: thin Context sections and Consequences that list only positives.

## Output Template

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

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Drafts each ADR section based on your input | Provide the actual decision context and constraints |
| Suggests alternatives you may have missed | Confirm which alternatives were actually considered |
| Identifies missing negative consequences | Verify the consequences against your real system |
| Flags vague or passive-voice decision statements | Approve the final wording before committing |
| Recommends storage path and numbering | Store the ADR in the correct repo location |

## Context Section — The Most Important Part

Most ADRs fail here. Write context as if explaining to a smart engineer who joined today and has read the codebase but knows nothing about past discussions.

- Quantify constraints: not "We needed to scale" but "We needed 10k concurrent WebSocket connections per node"
- Describe the system state before the decision
- Include experiments or prototypes that informed the choice

## Storage Convention

```
docs/adr/
  0001-use-postgresql-over-mysql.md
  0002-adopt-event-driven-architecture.md
  0003-supersede-0001-migrate-to-aurora.md
```

Number sequentially. When a decision is reversed, create a new ADR that supersedes the old one — never delete or rewrite the original.

## Quick Checklist

- [ ] Title states the decision, not the problem
- [ ] Context is specific and quantified where possible
- [ ] Decision is stated directly in active voice
- [ ] At least two alternatives documented with rejection reasons
- [ ] Negative consequences listed honestly
- [ ] Status reflects current state (not perpetually "Proposed")
- [ ] ADR stored in the repository it affects
- [ ] Superseded ADRs reference their replacement

## Related Skills

- `microservices-architect` — for the architectural decisions being documented
- `service-boundary-validator` — when the decision involves service decomposition
- `event-storming` — when the decision emerges from a domain modeling session
