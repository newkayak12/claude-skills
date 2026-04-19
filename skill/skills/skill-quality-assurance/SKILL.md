---
name: skill-quality-assurance
description: >-
  Use when reviewing or quality-checking a skill before shipping. Runs 6
  checks: usefulness, authoring, structure, MCP, weight, output quality.
  Triggers on: 스킬 검토, skill review, validate skill, 배포 전 검토.
scenarios:
  - "Review my skill — is it well-designed and ready to ship?"
  - "Is this SKILL.md too heavy? Should I split it?"
  - "Does my skill follow authoring best practices?"
  - "내 스킬 배포 전에 품질 검토해줘"
  - "스킬이 실제로 더 나은 출력을 만드는지 확인해줘"
compatibility:
  recommended:
    - think-tool
  optional:
    - mcp-reasoner
  remote_mcp_note: >-
    think-tool은 각 품질 차원 분석 전에 깊이 있는 판단을 위해 활용됩니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
---

# Skill Quality Assurance

Run 6 quality checks on a skill and produce an actionable improvement report.

This is the quality gate before publishing — and also useful mid-creation to catch design issues early. The "Top Improvements" section at the end maps directly to what skill-creator should fix next, making this the natural handoff between authoring and shipping.

## Input

If the skill path wasn't provided, ask for it — you need the root directory containing `SKILL.md`.

Read all skill files before dispatching agents:
- `SKILL.md` (required)
- `agents/*.md` (if present)
- `references/*.md` (if present)
- `scripts/*` (if present)

If a directory doesn't exist, note its absence rather than skipping the check.

## Execution

Run checks 1–5 in parallel. Run check 6 after — it depends on understanding the skill's promises first.

| # | Check | Agent | What it examines |
|---|-------|-------|-----------------|
| 1 | Usefulness | `agents/usefulness-checker.md` | Does this skill earn its place? |
| 2 | Authoring Principles | `agents/authoring-checker.md` | description ≤250 chars? Standing Mandates? Compaction-aware? effort field? |
| 3 | Agent Structure | `agents/structure-reviewer.md` | Should responsibilities split into subagents? Which steps can parallelize? |
| 4 | MCP Fit | `agents/mcp-advisor.md` | Which MCPs would genuinely help? (load `references/mcp-catalog.md`) |
| 5 | SKILL.md Weight | `agents/weight-analyzer.md` | Too heavy? What belongs in references/ or scripts/? |
| 6 | Output Quality | `agents/eval-agent.md` | Does the skill measurably improve output vs no-skill baseline? |

Pass the **full content of all skill files** to each agent as context.

## Output Format

Produce a self-contained report in this format:

```
## Skill QA Report: [skill-name]

### 1. Usefulness — [PASS / WARN / FAIL]
[findings]

### 2. Authoring Principles — [PASS / WARN / FAIL]
[findings]

### 3. Agent Structure — [GOOD / IMPROVABLE / MISSING]
**Persona separation:** [findings]
**Parallel opportunities:** [findings]

### 4. MCP Opportunities — [NONE / OPTIONAL / RECOMMENDED]
[findings]

### 5. SKILL.md Weight — [LIGHT / OK / HEAVY / CRITICAL]
[findings]

### 6. Output Quality — [PASS / MARGINAL / FAIL]
**With-skill pass rate:** X/N assertions
**Without-skill pass rate:** X/N assertions
**Delta:** +X
**Discriminating assertions:** [what the skill enforces that baseline misses]
**Skill gaps:** [what the skill promises but doesn't deliver]

---
## Top Improvements for [skill-name]
1. 🔴 [must fix — concrete and actionable]
2. 🟡 [recommended improvement]
3. 🟢 [optional enhancement]
```

Priority labels: 🔴 Must fix · 🟡 Recommended · 🟢 Optional

The "Top Improvements" section is what skill-creator reads to decide what to fix next. Make it concrete and actionable — not "improve structure" but "extract the grading logic into `agents/grader.md` and call it from SKILL.md with a Task()".
