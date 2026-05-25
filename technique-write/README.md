# technique-write

Two strict-template writing techniques for technical decisions.

| Skill | Use when | Output |
|-------|----------|--------|
| `design-review-writer` | Starting a new feature/system and need a shared design doc to discuss alternatives, trade-offs, and impact | Design Review markdown (Author/Reviewers/Status … through Review Comments) |
| `adr-writer` | Locking in a decision after the Design Review (or from raw context) so the rationale survives team turnover | ADR markdown in declarative voice (`~를 채택한다`) |

## Typical flow

```
brainstorming → design-review-writer → (devils-advocate, bias-auditor) → adr-writer
```

The Design Review captures exploration. The ADR captures the final decision in active voice. Both follow fixed section orders — Claude does not improvise structure.

## Dependencies inside the marketplace

Both skills reference other marketplace skills as collaborators. All exist already:

- `think:brainstorming`, `think:devils-advocate`, `think:problem-reframer`, `think:decision-maker`
- `develop:architecture-designer`, `develop:domain-driven-design`, `develop:microservices-architect`
- `cognition:bias-auditor`, `cognition:assumption-extractor`, `cognition:tradeoff-articulator`, `cognition:second-order-thinker`
- `write:doc-coauthoring`, `write:writer-verification`

If a referenced skill is not installed, Claude will tell the user and offer to either install it from the marketplace or proceed without it.
