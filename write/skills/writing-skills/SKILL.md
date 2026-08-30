---
name: writing-skills
description: >-
  Use when creating a new skill, editing an existing SKILL.md, or fixing one
  that misfires. Triggers: "스킬 만들어줘", "새 skill 작성", "SKILL.md 써줘", "skill 개선해줘",
  "create a skill", "skill documentation", "스킬 문서 작성", "workflow skill로 만들어줘".
scenarios:
  - "이 워크플로우를 skill로 만들어줘"
  - "새 skill SKILL.md 작성해줘"
  - "Create a skill for this repeatable process"
  - "기존 skill 개선해줘"
  - "I want to capture this pattern as a reusable skill"
  - "Skill 설명이 너무 약한 것 같아, 개선해줘"
compatibility:
  optional:
    - think-tool           # framing the RED-phase pressure scenario before drafting
  remote_mcp_note: >-
    think-tool이 있으면 RED 단계 압박 시나리오를 설계하고 어떤 실패를 겨냥하는지 미리
    정리하는 데 활용됩니다. Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를
    추가하세요.
---

# writing-skills

This skill produces convention-compliant `SKILL.md` files. It does not grade
its own output — that job belongs to two gates it hands off to by name. Read
this file when you're about to draft, edit, or repair a skill; read the gates'
own SKILL.md files when it's time to actually run them.

## The Docs Cycle, Borrowed From TDD

`develop:test-driven-development` treats a passing test as worthless until
someone watched it fail for the predicted reason first. This skill borrows
that shape for prose instead of code:

| Code TDD | Docs equivalent here |
|---|---|
| Failing test, written before the fix | A scenario where an agent misbehaves *without* the skill present — the gap the skill must close |
| Watching it fail for the right reason | Confirming the miss is a real gap, not a fluke of that one prompt |
| Minimal code to go green | The smallest SKILL.md draft that plausibly closes the gap |
| Refactor once green | Trimming and reordering the draft without reopening the gap |

The mechanics of running that pressure scenario — how to construct one, how
many pressures to stack, how to read the transcript — are not re-taught here;
see `testing-skills-with-subagents.md` for the method and
`examples/CLAUDE_MD_TESTING.md` for worked scenario scripts. What this skill
owns is turning a confirmed gap into a draft; what happens to that draft next
is covered below.

## Dual-Mode Authoring

The same four moves run whether you're drafting alone or a `harness:harness`
run is driving.

| Move | Solo | Harness-engaged |
|---|---|---|
| Scope the gap | You name the miss from memory or a quick manual probe | SetGoal's acceptance criteria already state the gap as a subgoal |
| Draft | You write the SKILL.md directly | An Implement executor writes it against the subgoal's acceptance bar |
| Trigger check | You invoke `skill:skill-trigger-validator` yourself before calling it done | The QualityGate stage invokes it as part of scoring the subgoal |
| Ship gate | You invoke `skill:skill-quality-assurance` yourself and act on its report | QualityGate invokes it; a failing report blocks the subgoal, not just a suggestion |

Unsure which lane you're in: if a harness pipeline handed you this task, act
in harness-engaged mode and let its stage boundaries decide when a gate runs.
Otherwise default to solo and run both gates yourself before calling the work
done.

## Process

1. **Confirm the gap is real.** State the situation where the current skill
   (or the absence of one) produces the wrong outcome. No gap, no draft —
   go find one before writing anything.
2. **Place the file.** `<plugin>/skills/<kebab-name>/SKILL.md`, one skill per
   directory, per `.claude/conventions/coding.md`.
3. **Draft frontmatter.** `name` and a `description` that opens with "Use
   when" and states triggering conditions only — never a summary of what the
   skill does internally, that's the shortcut agents take instead of reading
   the body. Add `scenarios` (2–3 EN, 2–3 KR) and a `compatibility` block if
   an MCP tool genuinely changes the outcome.
4. **Draft the body** in this relative order: `Process`, `Output Template`,
   `What Claude Does / What You Do`, `Related Skills` — other sections may
   sit between them, but these four stay in that sequence and nothing titled
   Overview or Background sits ahead of `Process`.
5. **Run the RED-phase check** from the cycle above — by hand in solo mode,
   or read off the subgoal's acceptance criteria in harness mode.
6. **Hand off, don't re-score.** Call `skill:skill-trigger-validator` for
   description and trigger coverage, then `skill:skill-quality-assurance`
   for the full pre-ship pass. Fix what they flag; don't re-derive their
   checks inline in the draft.
7. **Close what the gates flagged**, re-run the gate that flagged it, repeat
   until both pass clean.
8. **Ship housekeeping.** Per `.claude/conventions/boundaries.md`: bump the
   plugin's version in `.claude-plugin/marketplace.json`, update that
   plugin's `README.md`, and re-run `scripts/validate_plugins.py`.

## Output Template

A finished unit of work from this skill is:

1. The `SKILL.md` file (plus any supporting files it actually points to).
2. A one-line statement of the gap it closes (from step 1).
3. The `skill-trigger-validator` verdict and, if it rewrote the description,
   which wording won.
4. The `skill-quality-assurance` report's Top Improvements section, with
   each 🔴 item resolved before calling the skill shipped.
5. The version-bump / README-update diff from step 8.

## Reference Files

- `anthropic-best-practices.md` — Anthropic's own authoring guidance; read
  this before inventing structure from scratch.
- `references/authoring-reference.md` — the SKILL.md structure template,
  flowchart rules, code-example rules, and file-organization patterns.
- `references/checklist.md` — a step-by-step drafting checklist matching
  the Process above, useful as a TodoWrite seed.
- `testing-skills-with-subagents.md` — how to build the RED-phase pressure
  scenario the Docs Cycle above assumes you already know how to run.
- `examples/CLAUDE_MD_TESTING.md` — worked pressure-scenario scripts to
  adapt rather than write from a blank page.
- `persuasion-principles.md` — why imperative phrasing and named loopholes
  outperform soft guidance in discipline-style skills; consult it when a
  draft keeps getting negotiated with in testing.
- `graphviz-conventions.dot` and `render-graphs.js` — style rules and a
  render script for the rare skill where a small inline flowchart earns its
  place; most skills need neither.

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Confirms the gap and drafts frontmatter + body against the Process order | Confirm the stated gap is the real one, not a proxy for it |
| Calls `skill:skill-trigger-validator` and `skill:skill-quality-assurance` rather than self-scoring | Read both reports; call the go/no-go on anything not clearly 🔴 |
| Applies fixes the gates flag and re-runs the gate that flagged them | Approve the final draft before it ships |
| Performs the version/README housekeeping the boundaries convention requires | Confirm the version bump matches what actually changed |

## Related Skills

- `skill:skill-trigger-validator` — scores and rewrites the `description`
  field for trigger coverage; the authority on step 6's first half.
- `skill:skill-quality-assurance` — the six-check pre-ship gate; the
  authority on step 6's second half and on whether a skill is worth keeping
  at all.
- `develop:test-driven-development` — source of the RED-GREEN-REFACTOR shape
  this skill re-expresses for documentation instead of code.
- `harness:harness` — the six-stage engine that drives the harness-engaged
  column above; SetGoal, Implement, and QualityGate own the stage boundaries
  this skill defers to in that mode.
