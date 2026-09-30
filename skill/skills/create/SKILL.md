---
name: create
effort: high
description: >-
  Use when a new skill should be written to read like the repo's existing skills. Triggers on: "스킬 만들어줘",
  "새 스킬 뼈대", "우리 스킬처럼 만들어줘", "이걸 스킬로", "create a skill".
scenarios:
  - "Create a skill for reviewing database migrations, like our other skills"
  - "Turn this checklist into a skill that reads like the rest of the repo"
  - "스킬 만들어줘 — PR 설명 검토용으로, 기존 스킬이랑 같은 결로"
  - "이 회고 정리 방식을 우리 스킬처럼 만들어줘"
  - "새 스킬 뼈대 잡아줘, think 플러그인에 넣을 거야"
compatibility:
  optional:
    - think-tool
  remote_mcp_note: >-
    think-tool이 있으면 이 스킬이 막아야 할 '편한 한 수'와 경계(Not for)를 초안 전에 따져볼 수 있습니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
---

## Standing Mandates

- ALWAYS read `references/identity.md` and 3–4 real skills before drafting. The identity is in the skills, not the headings; a skeleton alone produces a skill with the right sections and none of the stance.
- ALWAYS write the three anchor lines (step 3) before any prose. A skill that can't name the reflex it forbids has no reason to exist.
- NEVER add a section, mode, or option the purpose doesn't need. Every extra section is one more place to drift from the siblings.
- NEVER grade the draft yourself as the final word. Your identity audit is a checklist; the verdict comes from `trigger-validator` and `quality-assurance`.
- Goal: a reader who knows the repo can't tell the new skill from one the owner wrote. Stop after the gates pass or after two fix rounds — report what's still open.

# Create

Writes a new skill that carries the repo's house identity — re-checkable output, no invented facts, one forbidden reflex, a stated boundary, the user deciding — then hands it to the two gates.

**Not for** editing or repairing an existing skill (`write:writing-skills`).

## Process

1. **Intake.** Purpose, the situation that should trigger it, the user's own words for asking. Missing one → ask in one line. If an existing skill or a one-line CLAUDE.md rule already covers it, name it, recommend the one change you'd make instead (a trigger added, a new mode), and stop — one recommendation, not an option menu (P8, P11).
2. **Read.** `references/identity.md`, then 3–4 skills: 2 recently changed (`git log --since=<30 days> --name-only -- '*/SKILL.md'`) and 1–2 siblings in the target plugin. Where the siblings' structure differs from identity.md's Structure section, the siblings win.
3. **Anchor.** Write three lines before drafting:
   - **Reflex:** the comfortable move a no-skill run would make here, which this skill forbids (P4).
   - **Boundary:** `Not for …` and the skill it hands that to (P6).
   - **Done:** the checkable criterion that ends a run, and the bound on any loop (P9).
4. **Place.** `<plugin>/skills/<name>/SKILL.md`, bare kebab name that doesn't repeat the plugin.
5. **Draft** the smallest skill that carries the anchors (P12): frontmatter, Standing Mandates only if there are rules a no-skill run would break — each with its reason (P10) — then the body in the siblings' order. The Output Template opens with the judgment (P5) and forces a count or quote somewhere (P1).
6. **Audit** the draft against P1–P13: for each, the line that satisfies it, or `N/A — <why>`. Rewrite anything that fails before moving on. Also check:
   - **Promises:** every promise in the `Goal:` line or Output Template (a tally that recounts, a verdict per item) has a Process step that performs it (P9).
   - **Effort:** a judgment-heavy skill (per-item grading, forks on facts) gets `effort: high`.
   - **Description:** it names every core check the Process runs, not only the headline one.
7. **Check.** Run the repo's validator (here `python3 _repo/scripts/validate_plugins.py`); fix every ERROR on the new skill.
8. **Hand off.** `trigger-validator` on the description, then `quality-assurance` on the whole skill. Fix 🔴 items, re-run the gate that flagged them. Max two rounds.
9. **Register.** Only what the repo's update workflow names (here: `marketplace.json` version, plugin `README.md` + `KOR.md`). Touch nothing else (P13); mention unrelated problems you saw. Skip any step the user has put on hold.

## Output Template

```
Skill: <plugin>/skills/<name>/SKILL.md (<n> lines)
Reflex forbidden: <one line>
Boundary: Not for <x> → <plugin:skill>
Done when: <criterion>

Identity audit: <k>/13 satisfied, <m> N/A
| P | Where in the draft | 
|---|--------------------|
| P1 | <line or N/A — why> |
...

Validator: <no ERROR | list>
trigger-validator: <score>, description <kept | rewritten>
quality-assurance: 🔴 <fixed…> · 🟡 <open…>
Open: <what the gates left, or "none">
```

Do NOT paste the generated SKILL.md into chat — it is in the file.

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Reads identity.md and real skills, writes the anchors, drafts the minimum skill | Say what the skill is for and where it goes |
| Audits the draft against P1–P13 and runs the validator and both gates | Confirm or change the forbidden reflex and the boundary |
| Prepares registration, touching only what the repo requires | Decide on 🟡 items and approve the push |

## Related Skills

- `trigger-validator` — scores and rewrites the description; step 8, first half.
- `quality-assurance` — the pre-ship gate; step 8, second half.
- `write:writing-skills` — editing or repairing an existing skill; the RED-check discipline.
