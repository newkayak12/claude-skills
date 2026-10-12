# Templates

## spec.md

```markdown
# <feature> — spec
## Problem
<who is blocked, by what, today>
## User stories
### US-1 — <story>
## Acceptance criteria
- AC-1 (US-1): Given <state>, When <action>, Then <observable result>
## Out of scope
- <thing not built>
## Open
- [확인 필요: <fact>] — who can answer
```

## design.md

```markdown
# <feature> — design
## Interfaces
- `<signature or endpoint>` — serves AC-1
## Data model
- <entity/field> — serves AC-2
## Decisions
- <choice> over <alternative> because <reason> — AC-1
```

## tasks.md

```markdown
# <feature> — tasks
| Task | AC | Failing test first | Depends on |
|---|---|---|---|
| T1 | AC-1 | `rejects expired token` | — |
```
