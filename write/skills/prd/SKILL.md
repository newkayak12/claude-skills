---
name: prd
description: Use when writing a PRD, design doc, RFC or proposal for readers, section by section. Triggers on: "PRD 작성", "기획서 써줘", "write a design doc", "draft an RFC".
scenarios:
  - "이 기능에 대한 PRD 작성해야 해"
  - "RFC 초안 같이 써줘"
  - "Help me write a design doc for this new service"
  - "Draft a proposal for adopting Kafka"
compatibility:
  optional:
    - think-tool  # judging which section has the most unknowns
---

# PRD

Triggers: PRD, design doc, RFC, proposal.

## Process

Follow `references/document.md` — the three stages (context gathering, section-by-section refinement, reader testing) and the section loop live only there.

1. Detect the output format, ask who the primary reader is and what single question the document must answer.
2. Run the stages in `references/document.md`.
3. Stage 3 reader testing: sub-agents available, use `agents/reader-agent.md`; otherwise `references/manual-reader-testing.md`.
4. Tone, deviation, context and artifact handling: `references/guidance-tips.md`.

## Output Template

The finished document in the format agreed in Stage 1 (artifact or markdown), with the reader-test gaps resolved.

## What Claude Does / What You Do

| Claude | You |
|---|---|
| Guides the stages, asks clarifying questions, drafts and edits each section | Dump context, choose what to keep, approve each section |
| Tests the draft with a fresh reader | Confirm the gaps are closed |

## Related Skills

- `write:requirements` — split a requirement into items with criteria and open questions
- `write:adr` — record a made decision or run a design review
- `write:plans` — implementation plans, blog, feedback
