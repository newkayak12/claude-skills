# Note Templates and Linking Conventions

## Note Templates

Each note should generally use this base shape:

```markdown
---
id: payment-authorization
title: Payment Authorization
type: concept
domain: billing
status: verified
confidence: direct
tags:
  - payment
  - authorization
aliases:
  - 결제 승인
  - payment approval
entities:
  - PaymentService
  - PaymentGateway
sources:
  - path/to/source.ext
related:
  - retry-policy
---

# Note Title

One-paragraph summary of the durable idea.

## Key Points

- Specific, source-grounded point.
- Link to related notes with [[Useful Wikilinks]].

## Related

- [[Related Note]]

## Sources

- `path/to/source.ext`
```

Adapt the sections by note type:

| Note type | Required emphasis |
|---|---|
| `concept` | Definition, boundaries, aliases, related concepts |
| `code-module` | Responsibilities, key symbols, entry points, dependencies, tests |
| `workflow` | Trigger, steps, inputs/outputs, failure modes, owner |
| `decision` | Context, chosen option, rejected alternatives, consequences |
| `relation` | `contrast`, `equivalence`, or `sequence`; participants, conditions/dimensions, and evidence for every side |
| `moc` | Why the linked notes belong together and recommended reading paths |
| `glossary-entry` | Canonical term, aliases, short definition, source of terminology |

## Linking Conventions

- Use stable, human-readable note titles: `Payment Authorization Flow`, not `payment-auth-flow-notes-final`.
- Add aliases in frontmatter only when they materially improve search or preserve existing terminology.
- Prefer links between notes over duplicating the same explanation in multiple places.
- Preserve repository paths exactly in source references.
- When a note is generated from code, include the key symbols, files, commands, or tests that justify the summary.
- Keep important notes reachable from `index.md` or a MOC within two clicks.
- Avoid orphan notes unless they are intentionally listed in `open-questions.md` as isolated findings.
