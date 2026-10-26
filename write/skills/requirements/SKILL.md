---
name: requirements
description: Use when a requirement or 기획서 must be split into items with Given/When/Then criteria and open questions. Triggers on: "기획서 쪼개줘", "split this requirement". Not for write:spec, develop:spec-driven-development.
scenarios:
  - "이 기획서 쪼개줘"
  - "요구사항 문서에서 빠진 예외 처리 찾아서 항목으로 나눠줘"
  - "Split this requirement into checkable items with acceptance criteria"
  - "Analyze this product brief and list what is still unanswered"
compatibility:
  optional:
    - think-tool  # judging which rule or exception the input leaves out
---

# Requirements

Triggers: requirement analysis, 기획서 분석, 요구사항 쪼개기.

Not for: a settled conversation to write down (`write:spec`); a spec with acceptance and tasks before code (`develop:spec-driven-development`).

## Process

1. **Take the input.** A requirement or a 기획서, as pasted text or a file path. Read all of it; do not ask what it is for.
2. **Name the actors.** Each person, role or system that acts in the input, one line each.
3. **Collect the rules.** Take every rule, including the ones stated inside screen or flow descriptions, not only those in a policy list. For each, give its place in the input (a quote or a section/line reference); a rule the input implies but never states is marked `inferred`.
4. **Find the missing 예외 처리.** Check what the input leaves out: cancel, failure, duplicate, timeout, no-stock. List each missing one as an open question.
5. **Write the open questions.** Sources: "추후 협의", "TBD", "기획 확인 필요", an unstated rule, a missing exception from step 4. Each has an assumed default and a suggested owner. Wherever a criterion rests on one, it carries the same point as `[확인 필요] <assumed default>`.
6. **Split into items.** Name them F1, F2, ... in item order. Each has a one-sentence outcome. The independence test: each item's criteria can be checked without another item's output. An item that needs another item's result names it in a `depends on` line.
7. **Write the criteria.** Per item, `F<n>-AC-n: Given ... When ... Then ...`. Number F<n>-AC-1, F<n>-AC-2, ... unique across the whole analysis and in document order, so every full id matches `/\b(?:F\d+-)?AC-\d+\b/g`.
8. **Gap and ambiguity check.** Run `write/skills/plans/SKILL.md` Process step 4 ("Gap check, in-line") and step 5 ("Ambiguity check, in-line") over the items and criteria; they are not restated here. Name both checks with the count each found (`0` when none) on the `Checks run:` line.
9. **Stop at the analysis.** The item split is the only decomposition. Write no code, no implementation plan, no tasks and no tickets.

## Output Template

In the input's language, with English section headings. Saved to the path the caller names, otherwise `docs/requirements/YYYY-MM-DD-<topic>.md`. Four parts and a closing `Checks run:` line, so a teams node can place them as one section of a findings file:

```markdown
## Actors
- <actor> — <what it does in the input>

## Rules
- <rule> — <place: "quote" or section/line | inferred>

## Open questions
- <question> — assumed default: <default>; owner: <who decides>

## Items
### F1 — <one-sentence outcome>
depends on: <F<n> | none>
- F1-AC-1: Given ... When ... Then ...
- F1-AC-2: Given ... When ... Then ... [확인 필요] <assumed default>

Checks run: gap (write:plans step 4) <n> found; ambiguity (write:plans step 5) <n> found
```

## What Claude Does / What You Do

| Claude | You |
|---|---|
| Reads the input, quotes where each rule sits, marks `inferred` ones, lists the missing exceptions | Paste the requirement or give its path |
| Splits into items, writes the criteria, runs the plans gap and ambiguity checks | Answer the open questions or accept the assumed defaults |

## Related Skills

After this analysis:

- `write:prd` — a PRD, design doc or RFC
- `write:adr` — an ADR or design review
- `write:plans` — an implementation plan, tickets, blog or feedback
