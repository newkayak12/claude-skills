---
name: skill-validator
description: Validate a skill built with skill-creator across five quality dimensions. Use when reviewing a finished or in-progress skill — asking things like "이 스킬 잘 만든 거야?", "SKILL.md 너무 무거운가?", "agent 구조로 바꿀 수 있을까?", "mcp 쓸 수 있어?", "skill 검토해줘", "validate this skill", "review my skill design", "스킬 피드백 줘", "이 스킬 개선해줘". Invoke proactively after skill-creator finishes building a skill.
---

# Skill Validator

Analyze a skill's design quality across five dimensions and produce an actionable improvement report that skill-creator can act on.

## Input

If the skill path wasn't provided, ask for it — you need the root directory containing SKILL.md.

Read all skill files before dispatching agents:
- `SKILL.md` (required)
- `agents/*.md` (if present)
- `references/*.md` (if present)
- `scripts/*` (if present)

If no `agents/` directory exists, note "no subagents present" in the Agent Structure section rather than skipping it. If no `references/` directory exists, skip the references check in the Weight section. This ensures the report is complete and consistent even for minimal skills that only have a SKILL.md.

## Execution — run all five checks in parallel

| # | Check | Agent | What it examines |
|---|-------|-------|-----------------|
| 1 | Usefulness | `agents/usefulness-checker.md` | Does this skill earn its place? |
| 2 | Agent Structure + Parallelism | `agents/structure-reviewer.md` | Should personas be split into subagents? Which steps are truly independent and could run concurrently? |
| 3 | MCP Fit | `agents/mcp-advisor.md` | Which MCPs would help? (load `references/mcp-catalog.md`) |
| 4 | SKILL.md Weight | `agents/weight-analyzer.md` | Can it be split and lightened for progressive loading? |

Pass the **full content of all skill files** to each agent as context.

## Output Format

Produce a self-contained report in this format:

```
## Skill Validation Report: [skill-name]

### 1. Usefulness — [PASS / WARN / FAIL]
[findings: does the skill solve a real, recurring problem? is scope appropriate?]

### 2. Agent Structure — [GOOD / IMPROVABLE / MISSING]
**Persona separation:** [which responsibilities could be delegated to named subagents]
**Parallel opportunities:** [which steps are independent and could run concurrently]

### 3. MCP Opportunities — [NONE / OPTIONAL / RECOMMENDED]
[specific MCP names, what they'd replace, why they help]

### 4. SKILL.md Weight — [LIGHT / OK / HEAVY / CRITICAL]
[line count, what's heavy, concrete split suggestions with file names]

---
## Top Improvements for [skill-name]
1. 🔴 [highest priority — must fix]
2. 🟡 [recommended improvement]
3. 🟢 [optional enhancement]
```

Priority labels: 🔴 Must fix · 🟡 Recommended · 🟢 Optional

The "Top Improvements" section is what skill-creator reads to decide what to fix next. Make it concrete and actionable — not "improve structure" but "extract the grading logic into `agents/grader.md` and call it from SKILL.md with a Task()".
