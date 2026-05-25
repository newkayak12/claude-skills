---
name: adr-writer
effort: high
description: >-
  Use when capturing an architectural decision as an ADR — after a Design Review
  or from raw context. Triggers: "ADR 써줘", "이 결정 ADR로", "write an ADR",
  "document this decision". Fixed template; Decision must be declarative
  ("~를 채택한다").
scenarios:
  - "Postgres vs MySQL 결정 ADR로 남겨줘"
  - "방금 끝낸 design review 기반으로 ADR 만들어줘"
  - "이벤트 소싱 채택 결정 ADR 작성"
  - "Write an ADR for our decision to drop REST in favor of gRPC"
  - "결제 모듈 트랜잭션 경계 결정 ADR 부탁"
  - "이전 ADR-0007을 대체하는 새 ADR 써줘"
compatibility:
  recommended:
    - think-tool
    - sequential-thinking
  optional:
    - mcp-reasoner
  remote_mcp_note: >-
    sequential-thinking이 있으면 Context → Decision → Rationale → Consequences 순서를
    한 칸씩 강제합니다. think-tool은 Consequences를 Positive/Negative/Neutral로 분리할 때
    각 항목이 실제로 어느 칸에 속하는지 판정하는 데 쓰입니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
related:
  - design-review-writer
  - doc-coauthoring
  - writer-verification
  - tradeoff-articulator
  - decision-maker
  - bias-auditor
  - architecture-designer
  - domain-driven-design
  - microservices-architect
---

## Standing Mandates

- ALWAYS write the Decision in declarative active voice (`~를 채택한다`, `~로 한다`). Reject hedging like `~를 고려한다`, `~가 적합할 것 같다`.
- ALWAYS fill Negative consequences. Empty Negative is not honest — ask the user what they're paying.
- NEVER edit or delete a previously accepted ADR. Reverse with a new ADR; mark the old one `Superseded by ADR-XXXX`.
- NEVER fabricate a Design Review reference. If none exists, write `Related: (none — captured post-hoc)`.

# ADR Writer

Produce an Architecture Decision Record in the team's fixed template. Input is either an approved Design Review or raw decision context. Output is declarative, sequentially numbered, and stored at `docs/adr/`.

## When to Use / When Not to Use

| Use | Skip |
|-----|------|
| Decision is hard to reverse (DB, protocol, schema, boundary) | Trivial implementation detail |
| Multiple reasonable alternatives existed | Only one viable option |
| Team will turn over before the decision is revisited | Decision will be revisited within weeks |
| Design Review is approved and needs to be locked in | Design Review still `Draft`/`In Review` — finish it with `design-review-writer` first |

## Process

1. **Locate the source** — Design Review path, or raw 3-5 line context. If DR exists, read it and map §2/§5/§6/§7/§8 → ADR slots.
2. **Assign number + status** — scan `docs/adr/` for highest `NNNN-*.md`, take +1; set `Proposed`/`Accepted`/`Deprecated`/`Superseded`.
3. **Write `Context`** — quantified, for a smart engineer who joined today.
4. **Write `Decision`** — declarative, active voice, 1-3 sentences. If available, invoke `writer-verification` to catch hedging.
5. **Write `Rationale`** — chosen-option reasons referencing Context constraints + one line per rejected alternative.
6. **Write `Consequences`** — Positive / Negative / Neutral, all three buckets. If Negative is empty, invoke `bias-auditor`.
7. **Write `References`** — Design Review, RFCs, prior ADRs, vendor docs; or explicit `(none)`.
8. **Set metadata + save** — Date today, real Deciders, `docs/adr/NNNN-<slug>.md`.

Full per-step playbook — including the Design Review → ADR section mapping, declarative-voice examples, and Consequences bucket definitions — in `references/process-detail.md`. Read it when you reach the matching step.

## Output Template

Produce the document in this **exact** structure. Section names and order are fixed.

```markdown
# ADR-NNNN: [결정 제목]

## Metadata
- **Status**: Proposed | Accepted | Deprecated | Superseded by ADR-XXXX
- **Date**: YYYY-MM-DD
- **Deciders**:
- **Related**: [Design Review #, RFC #, 이전 ADR #]

## Context
- 이 결정이 필요한 배경과 제약 조건
- 현재 상황과 해결해야 할 문제

## Decision
- 단정형으로 확정 사항 기술
- "~를 채택한다", "~로 한다"

## Rationale
- 이 결정을 내린 핵심 근거
- 검토한 대안과 탈락 사유 요약

## Consequences
### Positive
- 이 결정으로 얻는 이점

### Negative
- 감수해야 할 비용과 한계

### Neutral
- 영향은 있으나 좋고 나쁨이 명확하지 않은 변화

## References
- Design Review, RFC, 외부 문서 링크
```

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Reads the Design Review and maps sections → ADR slots | Provide the Design Review path, or raw context |
| Rewrites the chosen design in declarative voice | Approve final wording or push back with concrete edits |
| Forces 3-bucket Consequences (Positive/Negative/Neutral) | Confirm Negative reflects real cost, not boilerplate |
| Assigns the next sequential number | Verify the number doesn't collide with an unmerged ADR |
| Updates the superseded ADR's Status in the same change | Confirm the old ADR is in the same repo |
| Auto-fills Date with today | Set Deciders to the actual decision-makers |

## Storage Convention

```
docs/adr/
  0001-use-postgresql-as-primary-store.md
  0002-adopt-kafka-for-inter-service-events.md
  0003-split-payment-domain-into-service.md
  0007-supersede-0001-migrate-to-aurora.md
```

Sequential numbering. Never delete or rewrite an accepted ADR — supersede instead.

## Quick Checklist

- [ ] Status reflects current truth, not perpetually `Proposed`
- [ ] Decision is declarative active voice — no `might`, `could`, `should consider`
- [ ] Rationale references Context constraints by name
- [ ] At least 2 alternatives listed with rejection reasons
- [ ] Consequences has non-empty Positive *and* Negative
- [ ] Neutral bucket used for "things that are now true" — not left as filler
- [ ] References to Design Review present (or explicit `(none)`)
- [ ] Filename matches `NNNN-<slug>.md` and lands in `docs/adr/`
- [ ] If superseding, the old ADR's Status was updated in the same change

## Related Skills

- `design-review-writer` — produce the upstream Design Review this ADR captures
- `doc-coauthoring` — section-by-section co-write mechanics for long Context
- `writer-verification` — final pass to catch hedging in Decision
- `tradeoff-articulator` — frame Rationale as "accept X to gain Y"
- `decision-maker`, `bias-auditor` — when the decision boundary is unclear or Negative is empty
- `architecture-designer` / `domain-driven-design` / `microservices-architect` — domain context for the decision being captured

Fallback if any related skill is not installed: see `references/process-detail.md`.
