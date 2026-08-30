# technique-write

**English** · [한국어](KOR.md)

Two writing techniques for technical decisions, both driven by a fixed template. The Design Review
captures exploration while options are still open; the ADR captures the decision once it is made, in
declarative voice, so the rationale outlives the people who made it. Neither skill improvises
structure — section names and order are fixed, and Claude fills them in the prescribed sequence.

## Install & Uninstall

```bash
/plugin install technique-write@newkayak12-claude-skills
/plugin uninstall technique-write@newkayak12-claude-skills
```

## Which skill do I want?

| I want to… | Skill |
|---|---|
| Write a doc that lays out alternatives and trade-offs for reviewers to argue with | `design-review-writer` |
| Lock in a decision that was already made, with its rationale and its costs | `adr-writer` |

## Skills

### `design-review-writer`

Drives a section-by-section interview and assembles the result into a fixed 8-section Design Review.
It never drafts all sections in one shot, requires at least two alternatives in §6, runs
`devils-advocate` against the proposed design before writing the trade-offs, and writes §1 Summary
last. Skip it for a one-line fix, or when the decision is already made — in that case it stops and
hands over to `adr-writer`.

```
결제 모듈을 새로 만들려고 해. PG 연동이랑 정산 분리가 쟁점인데
design review 문서 같이 잡아줘.
```

Fixed section order (optional sections are only filled when you confirm they apply):

```text
Metadata → 1. Summary → 2. Background & Context → 3. Goals & Non-Goals
→ 4. Requirements (Functional / Non-Functional) → 5. Proposed Design
→ 6. Alternatives Considered → 7. Trade-offs → 8. Impact Analysis
→ Optional: Migration/Rollout · Rollback · Observability · Testing Strategy
           · Security & Compliance · Operational Concerns · Open Questions
           · Timeline & Milestones
→ Review Comments
```

Saved to `docs/design-reviews/YYYY-MM-DD-<short-slug>.md`. Once the status is Approved, it invokes
`adr-writer` and cross-links both documents.

### `adr-writer`

Turns an approved Design Review — or raw decision context — into a numbered ADR. The Decision must
be declarative (`~를 채택한다`, `~로 한다`); hedging like `~를 고려한다` is rejected. Consequences
always carry all three buckets, and an empty Negative triggers `bias-auditor` rather than being left
blank. An accepted ADR is never edited or deleted: reverse it with a new ADR and mark the old one
`Superseded by ADR-XXXX`.

```
Postgres 대신 Aurora로 가기로 결정했어. docs/design-reviews/2026-03-11-storage.md
기반으로 ADR 써줘. 기존 ADR-0001을 대체하는 거야.
```

Fixed section order:

```text
# ADR-NNNN: [결정 제목]
Metadata (Status / Date / Deciders / Related)
→ Context → Decision → Rationale
→ Consequences (Positive / Negative / Neutral) → References
```

Stored at `docs/adr/NNNN-<slug>.md` with sequential numbering:

```text
docs/adr/
  0001-use-postgresql-as-primary-store.md
  0002-adopt-kafka-for-inter-service-events.md
  0007-supersede-0001-migrate-to-aurora.md
```

## Typical flow

```
brainstorming → design-review-writer → (devils-advocate, bias-auditor) → adr-writer
```

## Dependencies inside the marketplace

Both skills call other marketplace skills as collaborators:

- `think:brainstorming`, `think:devils-advocate`, `think:problem-reframer`
- `develop:architecture-designer`, `develop:domain-driven-design`, `develop:microservices-architect`
- `cognition:bias-auditor`, `cognition:assumption-extractor`, `cognition:tradeoff-articulator`,
  `cognition:second-order-thinker`
- `write:doc-coauthoring`, `write:writer-verification`

If a referenced skill is not installed, Claude says so and offers to install it or proceed without
it — the fallback path is in each skill's `references/process-detail.md`.

## MCP

Both skills list `think-tool` and `sequential-thinking` as recommended. `sequential-thinking` forces
one section at a time through the fixed order; `think-tool` is used to sort Consequences into the
right bucket and to frame the key question before each Design Review section. Add the remote SSE
endpoints in Claude settings → MCP Servers.

---
