# Skill Authoring Principles

> Evaluation criteria for skill-validator and authoring guidance for writing-skills.
> Source: Claude Code official docs + eval measurement findings (2026-04-10).

---

## Summary

| Principle | Rule |
|-----------|------|
| Delta-First | Measure before cutting. Remove only content with no uplift. |
| Standing Mandates | Discriminating behaviors at the top of SKILL.md, in imperative form. |
| Compaction-Aware | Only the first 5,000 tokens survive compaction. Critical content goes first. |
| Description ≤ 250 chars | Official docs truncation point. Front-load trigger keywords. |
| effort field | Add `effort: high` for skills requiring repeated complex judgment. |
| references/ separation | Background, theory, examples → references/. SKILL.md ≤ 500 lines. |

---

## 1. Delta-First Principle

**Line count is a proxy metric. Uplift (delta) is the real signal.**

- delta = with-skill pass rate − without-skill pass rate
- delta ≥ 0.25 (normalized 0–1) → PASS
- delta < 0.10 → skill provides no measurable value → redesign required

**Measure before cutting:**
1. Pick 2 scenarios from the skill's `scenarios:` field
2. Run with-skill and without-skill responses
3. Identify discriminating assertions (what the skill enforces that baseline misses)
4. Keep only those. Move the rest to `references/` or delete.

**Content classification:**

| Type | Action |
|------|--------|
| Discriminating content | Keep in SKILL.md — Claude won't do this without guidance |
| Background content | Move to references/ — Claude already knows this |
| Redundant coverage | Delete — baseline already handles this |

---

## 2. Standing Mandates Structure

**The pattern shared by high-delta skills:** discriminating behaviors at the top of SKILL.md, written as imperative standing instructions.

### Template

```markdown
---
name: skill-name
description: Use when... [≤250 chars, trigger keywords front-loaded]
effort: high        # add for judgment-heavy skills
---

## Standing Mandates

ALWAYS [discriminating behavior 1] before anything else.
NEVER [anti-pattern Claude exhibits without this skill].
Goal: [measurable output format] every invocation.
Rate every output 0–10 and state what 10/10 requires.  # where scoring fits naturally

## Process
[How to fulfill the mandates — steps]

## Output Template
[Rigid, distinctive format Claude would not produce without guidance]
```

### What qualifies as a Standing Mandate

Include if:
- Claude never does this without the skill ✓
- Applies to every invocation ✓
- Binary-verifiable ("Was Accusation Audit run first?" Y/N) ✓

Does not qualify (move to references/):
- "Why this works" explanations
- Framework background and history
- Application example tables Claude can derive on its own

### High-delta examples

**negotiation (delta +8.0):**
```
ALWAYS run an Accusation Audit before the first offer.
NEVER accept "You're right" as agreement — only "That's right" counts.
Goal: Rate every negotiation 0–10 and state what 10/10 requires.
```

**contagious (delta +8.5):**
```
ALWAYS apply the STEPPS framework by name and score each principle.
NEVER give generic viral advice — diagnose with the Quick Diagnostic table.
Goal: Rate shareability 0–10 and identify specific STEPPS gaps.
```

---

## 3. Compaction Awareness

> Claude Code official docs: "Re-attached skills keep the first 5,000 tokens of each skill."

**Only the first 5,000 tokens of SKILL.md survive a long session.**

Ordering:
1. Standing Mandates → top (must survive compaction)
2. Output Template → immediately after mandates
3. Process steps → after template
4. Background / examples → references/ (loss acceptable)

**"Standing Instructions" principle** (from official docs):
> "Write guidance that should apply throughout a task as standing instructions rather than one-time steps."

Mandates written as process steps are forgotten once Claude passes that step.
Mandates written as standing instructions persist across the entire session.

---

## 4. Description Guidelines

> Claude Code official docs: "descriptions longer than 250 characters are truncated in the skill listing"

### Rules

- **Length:** ≤ 250 characters (truncation causes trigger failures)
- **Format:** Start with `Use when`, `Use before`, or `Use after`
- **Content:** Trigger conditions only — no workflow summaries
- **Keywords:** Natural user phrases (EN + KR mix recommended for bilingual repos)

### Examples

```yaml
# ❌ BAD — over 250 chars, summarizes workflow
description: >-
  Use when someone needs to negotiate. Applies Voss's FBI framework including
  tactical empathy, mirroring, labeling, calibrated questions, accusation audit,
  that's right technique, ackerman bargaining, and black swans with scoring.

# ✅ GOOD — trigger keywords front-loaded, concise
description: >-
  Use when negotiating salary, contracts, or persuading a skeptical stakeholder.
  Triggers on: "연봉 협상", "salary negotiation", "설득해야 해", "ask for a raise".
```

---

## 5. effort Field

> Claude Code official docs: `effort` field sets reasoning depth per skill.
> Options: `low`, `medium`, `high`, `max` (Opus 4.6 only)

**When to add:**
- Skills with repeated complex judgment calls → `effort: high`
- Multi-dimensional scoring, strategic analysis, structured assessment
- Simple format transforms or lookup skills → omit

```yaml
---
name: technical-feasibility-assessment
effort: high    # 5-dimension independent judgment required
---
```

---

## 6. references/ Separation

**SKILL.md ≤ 500 lines** (official docs recommendation).
Warn at 250 lines. Mandatory split at 500 lines.

### What to move to references/

| Move to references/ | Keep in SKILL.md |
|--------------------|-----------------|
| Framework background and theory | Standing Mandates |
| "Why it works" explanations | Output Template |
| Detailed application example tables | Process (key steps only) |
| Author biography, further reading | Anti-patterns (essential only) |
| Extended edge-case handling | Quick Diagnostic |

### How to reference

```markdown
## Technique Details
Full breakdowns with psychological principles: [references/techniques.md](references/techniques.md)
```

Claude reads references/ only when needed. Inline content loads on every invocation.

---

## Evaluation Checklist

skill-validator uses these principles as evaluation criteria:

| # | Item | Criterion |
|---|------|-----------|
| 1 | Standing Mandates present | Skills >200 lines have a `## Standing Mandates` or `## Mandates` section |
| 2 | Description length | ≤ 250 characters |
| 3 | Compaction-aware ordering | Critical content within the first half of SKILL.md |
| 4 | effort field | Present for judgment-heavy skills (>200 lines) |
| 5 | references/ separation | Background content moved to references/, not inline |
| 6 | Output delta | with-skill vs without-skill eval delta ≥ 0.25 |
