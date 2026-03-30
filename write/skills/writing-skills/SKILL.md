---
name: writing-skills
description: >-
  Use when creating new skills, editing existing skills, or writing SKILL.md content.
  Triggers on: "스킬 만들어줘", "새 skill 작성", "SKILL.md 써줘", "skill 개선해줘",
  "create a skill", "skill documentation", "스킬 문서 작성", "workflow skill로 만들어줘".
  Best for: building new reusable skills, iterating on existing skill quality, capturing workflows as skills.
  Not for: project-specific documentation or one-off process notes.
scenarios:
  - "이 워크플로우를 skill로 만들어줘"
  - "새 skill SKILL.md 작성해줘"
  - "Create a skill for this repeatable process"
  - "기존 skill 개선해줘"
  - "I want to capture this pattern as a reusable skill"
  - "Skill 설명이 너무 약한 것 같아, 개선해줘"
compatibility:
  optional:
    - think-tool           # reasoning before finalizing description field to avoid workflow summaries
  remote_mcp_note: >-
    think-tool이 있으면 description 필드에 workflow 요약이 포함되지 않았는지 확인하는 데 활용됩니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
---

# Writing Skills

## Overview

**Writing skills IS Test-Driven Development applied to process documentation.**

**Personal skills live in agent-specific directories (`~/.claude/skills` for Claude Code, `~/.agents/skills/` for Codex)**

You write test cases (pressure scenarios with subagents), watch them fail (baseline behavior), write the skill (documentation), watch tests pass (agents comply), and refactor (close loopholes).

**Core principle:** If you didn't watch an agent fail without the skill, you don't know if the skill teaches the right thing.

**REQUIRED BACKGROUND:** You MUST understand superpowers:test-driven-development before using this skill. That skill defines the fundamental RED-GREEN-REFACTOR cycle. This skill adapts TDD to documentation.

**Official guidance:** For Anthropic's official skill authoring best practices, see anthropic-best-practices.md.

## What is a Skill?

A **skill** is a reference guide for proven techniques, patterns, or tools. Skills help future Claude instances find and apply effective approaches.

**Skills are:** Reusable techniques, patterns, tools, reference guides

**Skills are NOT:** Narratives about how you solved a problem once

## TDD Mapping for Skills

| TDD Concept | Skill Creation |
|-------------|----------------|
| **Test case** | Pressure scenario with subagent |
| **Production code** | Skill document (SKILL.md) |
| **Test fails (RED)** | Agent violates rule without skill (baseline) |
| **Test passes (GREEN)** | Agent complies with skill present |
| **Refactor** | Close loopholes while maintaining compliance |
| **Write test first** | Run baseline scenario BEFORE writing skill |
| **Watch it fail** | Document exact rationalizations agent uses |
| **Minimal code** | Write skill addressing those specific violations |
| **Watch it pass** | Verify agent now complies |
| **Refactor cycle** | Find new rationalizations → plug → re-verify |

The entire skill creation process follows RED-GREEN-REFACTOR.

## When to Create a Skill

**Create when:**
- Technique wasn't intuitively obvious to you
- You'd reference this again across projects
- Pattern applies broadly (not project-specific)
- Others would benefit

**Don't create for:**
- One-off solutions
- Standard practices well-documented elsewhere
- Project-specific conventions (put in CLAUDE.md)
- Mechanical constraints (if enforceable with regex/validation, automate it)

## Skill Types

**Technique** — Concrete method with steps (condition-based-waiting, root-cause-tracing)
**Pattern** — Way of thinking about problems (flatten-with-flags, test-invariants)
**Reference** — API docs, syntax guides, tool documentation (office docs)

## Directory Structure

```
skills/skill-name/
    SKILL.md              # Main reference (required)
    supporting-file.*     # Only if needed
```

Separate files for heavy reference (100+ lines) or reusable tools. Keep everything else inline.

For SKILL.md structure template, flowchart guidance, code example rules, file organization patterns, and anti-patterns, see `references/authoring-reference.md`.

## SKILL.md Structure

**Frontmatter (YAML):** Only `name` and `description` fields. Max 1024 characters total.
- `name`: letters, numbers, hyphens only
- `description`: starts with "Use when...", triggering conditions only, never workflow summary, under 500 chars

## Claude Search Optimization (CSO)

**Critical for discovery:** Future Claude needs to FIND your skill.

**Description = When to Use, NOT What the Skill Does.** Do NOT summarize the skill's process or workflow. Testing showed that workflow-summary descriptions cause Claude to follow the description instead of reading the skill body — creating a shortcut that makes the skill body irrelevant.

```yaml
# ❌ BAD: Summarizes workflow
description: Use when executing plans - dispatches subagent per task with code review between tasks

# ✅ GOOD: Just triggering conditions
description: Use when executing implementation plans with independent tasks in the current session
```

If think-tool is available, invoke it before finalizing the description field to verify no workflow steps are present.

**Keyword coverage:** Use error messages, symptoms, synonyms, and tool names Claude would search for.

**Naming:** Active voice, verb-first — `condition-based-waiting` not `async-test-helpers`.

**Token efficiency:** Target <500 words. Move flag docs to --help references. Use cross-references instead of repeating workflow details. One minimal example, not several verbose ones.

**Cross-referencing:** Use skill name with requirement markers — `**REQUIRED:** superpowers:test-driven-development`. Never use `@` syntax — it force-loads files immediately, consuming 200k+ context before you need them.

## The Iron Law (Same as TDD)

```
NO SKILL WITHOUT A FAILING TEST FIRST
```

This applies to NEW skills AND EDITS to existing skills.

Write skill before testing? Delete it. Start over.
Edit skill without testing? Same violation.

**No exceptions:**
- Not for "simple additions"
- Not for "just adding a section"
- Not for "documentation updates"
- Don't keep untested changes as "reference"
- Delete means delete

**REQUIRED BACKGROUND:** superpowers:test-driven-development explains why this matters. Same principles apply to documentation.

## Testing Your Skill

Testing follows RED-GREEN-REFACTOR: run pressure scenarios without the skill (RED), write the minimal skill addressing those specific failures (GREEN), close loopholes until bulletproof (REFACTOR). For pressure scenario templates, rationalization tables, and the full bulletproofing methodology, see testing-skills-with-subagents.md.

## STOP: Before Moving to Next Skill

**After writing ANY skill, you MUST STOP and complete the deployment process.**

Do NOT create multiple skills in batch without testing each. Deploying untested skills = deploying untested code.

For the full deployment checklist, see `references/checklist.md`.

## Discovery Workflow

How future Claude finds your skill:

1. **Encounters problem** ("tests are flaky")
2. **Searches skills by keyword or category**
3. **Finds SKILL** (description matches)
4. **Scans overview** (is this relevant?)
5. **Reads patterns** (quick reference table)
6. **Loads example** (only when implementing)

**Optimize for this flow** — put searchable terms early and often.

## The Bottom Line

**Creating skills IS TDD for process documentation.**

Same Iron Law: No skill without failing test first.
Same cycle: RED (baseline) → GREEN (write skill) → REFACTOR (close loopholes).

If you follow TDD for code, follow it for skills. It's the same discipline applied to documentation.
