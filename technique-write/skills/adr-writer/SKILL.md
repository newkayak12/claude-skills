---
name: adr-writer
description: >-
  Use when an architectural or technical decision needs to be captured as an
  Architecture Decision Record — typically right after a Design Review is
  approved, or when a debated choice (database, protocol, framework, boundary)
  needs to outlive the people who made it. Triggers on: "ADR 써줘",
  "이 결정 ADR로 남기자", "design review 기반으로 ADR 생성", "아키텍처 결정 기록",
  "write an ADR", "document this decision as an ADR", "ADR for the database choice".
  Always invoke this skill instead of free-form drafting — the team's ADR
  template is fixed and the Decision section must be declarative.
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

- ALWAYS write the Decision section in declarative active voice (`~를 채택한다`, `~로 한다`, `We will use X`). Reject hedging like `~를 고려한다`, `~가 적합할 것 같다`, `We might use X`.
- ALWAYS fill Negative consequences. An ADR with empty Negative is not honest; reject it and ask the user what they're paying for the decision.
- NEVER edit or delete a previously accepted ADR. To reverse a decision, write a new ADR with `Status: Superseded by ADR-XXXX` set on the old one and `Status: Accepted` on the new one, with the prior number in `Related:`.
- NEVER fabricate a Design Review reference. If no Design Review exists, write `Related: (none — captured post-hoc)` rather than inventing a doc.

# ADR Writer

Produce an Architecture Decision Record in the team's fixed template. Input is either an approved Design Review or raw decision context. Output is declarative, numbered, and stored at `docs/adr/`.

## When to Use / When Not to Use

| Use | Skip |
|-----|------|
| Decision is hard to reverse (DB, protocol, schema, boundary) | Trivial implementation detail |
| Multiple reasonable alternatives existed | Only one viable option |
| Team will turn over before the decision is revisited | Decision will be revisited within weeks |
| Design Review is approved and needs to be locked in | Design Review still in `Draft`/`In Review` — use `design-review-writer` to finish it first |

## Process

### Step 1 — Locate the source

Ask the user:
1. design review 문서가 있나요? (있다면 경로/링크)
2. 없다면 결정 배경을 3-5줄로 요약해 주세요.

If a Design Review exists, **read it fully** before drafting. Pull:
- §2 Background & Context → ADR `Context`
- §5 Proposed Design → ADR `Decision` (rewritten in declarative form)
- §6 Alternatives Considered → ADR `Rationale` (rejection reasons summarized)
- §7 Trade-offs → ADR `Consequences.Negative`
- §8 Impact Analysis → ADR `Consequences.Positive` and `Consequences.Neutral`

If no Design Review exists, gather equivalent context interactively. Consider invoking `decision-maker` to clarify the actual decision boundary before drafting.

### Step 2 — Assign the number and status

Scan `docs/adr/` for the highest existing `NNNN-*.md`, then take `NNNN+1`. Pad to 4 digits.

Set status:
- `Proposed` — drafted but not yet approved
- `Accepted` — approved and in effect
- `Deprecated` — no longer in effect but not replaced
- `Superseded by ADR-XXXX` — replaced by a newer ADR

If this ADR supersedes an older one, **also update the old ADR's Status** to `Superseded by ADR-NNNN` in the same change.

### Step 3 — Write `Context`

Describe the situation that forced the decision: system state, constraints, prior failures, deadlines. Write for a smart engineer who joined today and has read the codebase but knows nothing about past discussions. Quantify where possible.

### Step 4 — Write `Decision` in declarative voice

One to three sentences. Active voice. Present tense.

| Reject | Accept |
|--------|--------|
| Postgres가 좋을 것 같다 | Postgres를 주 데이터 저장소로 채택한다 |
| We are thinking about using Kafka | We will use Kafka for inter-service events |
| 모놀리스를 분리하는 방향을 검토한다 | 결제 도메인을 별도 서비스로 분리한다 |

If the user pushes back asking for softer language, hold the line and explain: an ADR is the *commitment artifact*. Softness here causes future readers to re-litigate the decision.

If you have `writer-verification`, invoke it on the Decision section to catch hedging that slipped through.

### Step 5 — Write `Rationale`

Two parts:
1. The core reasons this option was chosen (reference Context constraints by name).
2. A one-line-per-alternative summary of why each was rejected.

Use `tradeoff-articulator` framing for the core reasons: "We accept X cost in order to gain Y benefit."

### Step 6 — Write `Consequences` in three buckets

| Bucket | Meaning | Example |
|--------|---------|---------|
| **Positive** | Benefits we gain from this decision | "Latency budget for writes drops from 200ms to 50ms" |
| **Negative** | Costs/risks we accept | "Operational footprint adds a new HA cluster to maintain" |
| **Neutral** | Changes that aren't clearly good or bad | "All new services must register schemas with the central registry" |

If `Negative` is empty after a first pass, invoke `bias-auditor` to force surface the costs. Then ask the user directly: "이 결정으로 우리가 *치르는* 비용이 정말 없나요?"

Neutral is the most-skipped bucket. Use it for changes that are simply *true now* — process changes, new conventions, mandatory registrations — that don't lean positive or negative.

### Step 7 — Write `References`

Link, in order:
- Design Review document (path + title)
- RFCs or external standards consulted
- Prior ADRs (especially if superseded)
- Vendor docs / benchmark reports that informed the decision

If nothing applies, write `(none)` — do not invent.

### Step 8 — Set metadata and save

- **Date**: today (YYYY-MM-DD)
- **Deciders**: names of people who actually decided, not just attendees
- **Related**: Design Review #, RFC #, prior ADR #

Save to `docs/adr/NNNN-<short-slug>.md`. Slug should mirror the decision: `0007-adopt-postgres-as-primary-store.md`.

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
| Reads the Design Review and maps sections → ADR slots | Provide the Design Review path, or raw context if none |
| Rewrites the chosen design in declarative voice | Approve the final wording or push back with concrete edits |
| Forces 3-bucket Consequences (Positive/Negative/Neutral) | Confirm the Negative bucket reflects real cost, not boilerplate |
| Assigns the next sequential number | Verify the number doesn't collide with an unmerged ADR |
| Updates the superseded ADR's Status in the same change | Confirm the old ADR is in the same repo and accessible |
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
- `decision-maker` — when the actual decision boundary is unclear before Step 1
- `bias-auditor` — force-surface costs when Negative is empty
- `architecture-designer` / `domain-driven-design` / `microservices-architect` — domain context for the decision being captured

## If a related skill is not installed

If a referenced skill above is not available in the user's marketplace install, tell the user:

> "이 단계는 `[skill-name]` 스킬과 함께 쓰면 품질이 올라갑니다. 두 가지 선택지가 있습니다:
> 1. 마켓플레이스(`https://github.com/newkayak12/claude-skills`)에서 해당 플러그인을 설치 → 다시 진행
> 2. 설치 없이 진행 — 제가 스킬 이름에서 유추해 유사한 흐름으로 대신 수행 (품질은 다소 낮을 수 있음)
> 어느 쪽으로 진행할까요?"

Default to option 2 if the user says "그냥 진행" or doesn't respond after one ask.
