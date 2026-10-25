---
name: adr
description: Use when recording a made decision as an ADR, or exploring a decision in a design review before it is made. Triggers on: "ADR 남겨줘", "설계 리뷰 해줘", "write an ADR", "run a design review".
scenarios:
  - "PostgreSQL로 정한 결정 ADR 남겨줘"
  - "이 설계 리뷰 문서로 정리해줘"
  - "Write an ADR for adopting Kafka"
  - "Run a design review before we pick a queue"
compatibility:
  optional:
    - think-tool  # weighing options and consequences
---

# ADR

Triggers: ADR, architecture decision record, design review, 설계 리뷰, 결정 기록.

## Process

Pick the format by the signal:

| Signal | Format |
|---|---|
| Decision made | `references/formats/adr.md` (playbook: `references/formats/adr-process.md`) |
| Options open | `references/formats/design-review.md` (playbook: `references/formats/design-review-process.md`) |

A review that ends Approved converts to an ADR; cross-link both in `Related:`.

## Output Template

An ADR saved to `docs/adr/NNNN-<slug>.md`, or a design review saved to `docs/design-reviews/YYYY-MM-DD-<slug>.md`, each in the fixed template of its format file.

## What Claude Does / What You Do

| Claude | You |
|---|---|
| Picks the format, fills the template, numbers and saves the file | State the decision or the question, name the real deciders |
| Flags hedging and an empty Negative consequence | Confirm the rationale and status |

## Related Skills

- `write:prd` — PRD, design doc, RFC, proposal
- `write:plans` — implementation plans, blog, feedback
