---
name: skill-validator
description: Audits an existing skill across five quality dimensions: usefulness, agent structure, MCP fit, SKILL.md weight, and output quality (with-skill vs without-skill eval). Use when someone wants a design review of a skill they have already written or...
scenarios:
  - "Review my skill — is it well-designed?"
  - "Is this SKILL.md too heavy or should I split it?"
  - "Should this skill use agents or MCP tools?"
  - "내 스킬 설계 검토해줘"
  - "스킬이 너무 길어, 나눠야 할까?"
compatibility:
  recommended:
    - think-tool
  optional:
    - mcp-reasoner
  remote_mcp_note: >-
    think-tool은 각 품질 차원 분석 전에 깊이 있는 판단을 위해 활용됩니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
---

# Skill Validator

Analyze a skill's design quality across five dimensions and produce an actionable improvement report that skill-creator can act on.

The fifth check — output quality eval — runs the skill against its own scenarios and measures whether it produces better output than Claude would without guidance. This is the only check that tests actual runtime behavior, not just design.

## Input

If the skill path wasn't provided, ask for it — you need the root directory containing SKILL.md.

Read all skill files before dispatching agents:
- `SKILL.md` (required)
- `agents/*.md` (if present)
- `references/*.md` (if present)
- `scripts/*` (if present)

If no `agents/` directory exists, note "no subagents present" in the Agent Structure section rather than skipping it. If no `references/` directory exists, skip the references check in the Weight section. This ensures the report is complete and consistent even for minimal skills that only have a SKILL.md.

## Execution

Run checks 1–4 in parallel. Run check 5 after — it depends on understanding the skill's promises first.

| # | Check | Agent | What it examines |
|---|-------|-------|-----------------|
| 1 | Usefulness | `agents/usefulness-checker.md` | Does this skill earn its place? |
| 2 | Agent Structure + Parallelism | `agents/structure-reviewer.md` | Should personas be split into subagents? Which steps are truly independent and could run concurrently? |
| 3 | MCP Fit | `agents/mcp-advisor.md` | Which MCPs would help? (load `references/mcp-catalog.md`) |
| 4 | SKILL.md Weight | `agents/weight-analyzer.md` | Can it be split and lightened for progressive loading? |
| 5 | Output Quality | `agents/eval-agent.md` | Does the skill actually improve Claude's output vs no skill? Runs with-skill / without-skill eval on 2 scenarios. |

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

### 5. Output Quality — [PASS / MARGINAL / FAIL]
**With-skill pass rate:** X/N assertions
**Without-skill pass rate:** X/N assertions
**Delta:** +X
**Discriminating assertions:** [what the skill enforces that baseline misses]
**Skill gaps:** [what the skill promises but doesn't deliver]

---
## Top Improvements for [skill-name]
1. 🔴 [highest priority — must fix]
2. 🟡 [recommended improvement]
3. 🟢 [optional enhancement]
```

Priority labels: 🔴 Must fix · 🟡 Recommended · 🟢 Optional

The "Top Improvements" section is what skill-creator reads to decide what to fix next. Make it concrete and actionable — not "improve structure" but "extract the grading logic into `agents/grader.md` and call it from SKILL.md with a Task()".
