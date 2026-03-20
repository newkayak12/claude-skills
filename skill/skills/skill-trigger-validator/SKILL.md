---
name: skill-trigger-validator
description: Validates and improves skill trigger quality — use when a skill isn't firing on natural language or Korean input, when auditing description coverage, or when improving how reliably a skill gets invoked. Invoke for "스킬이 안 걸려", "trigger 개선해줘", "이 스킬 잘 안 트리거돼", "description 고쳐줘", "왜 이 스킬이 안 뜨지", "trigger coverage 감사", or any request to validate or strengthen a skill's description field.
---

# Skill Trigger Validator

Analyzes skill `description` fields for trigger coverage gaps and rewrites them to fire reliably on natural language — including Korean.

The description field is the only signal Claude uses to decide whether to invoke a skill. If it lists only formal English keywords, conversational or Korean requests will miss. This skill audits that coverage and produces a drop-in replacement description.

## Input

Accept one of:
- **Single skill** — path (e.g., `develop/skills/clean-code`) or name (`clean-code`)
- **Plugin** — all skills in a plugin (e.g., `think`, `develop`)
- **All** — full audit across the repo

If no target is given, ask for one before proceeding.

## Workflow

### 1. Read Target Skills

For each target skill, read the `description` field from the SKILL.md frontmatter. Also skim the body to understand what the skill actually does — the description should match the skill's real intent, not just its name.

### 2. Generate Test Queries

For each skill, generate **10 test queries** that a real user might type:

| # | Type | Example register |
|---|------|-----------------|
| 1–2 | Formal English | exact keywords from the description |
| 3–4 | Natural English | colloquial, indirect phrasing |
| 5–7 | Natural Korean | conversational 한국어, not word-for-word translations |
| 8–9 | Borderline | adjacent topic that should NOT trigger this skill |
| 10 | Implicit | user has a clear need but never says the skill name |

Good Korean queries feel like something a developer would actually type in chat — "이거 어떻게 설계해야 해?", "Redis 써야 할까?", "코드 너무 복잡한데 어떻게 해?". Bad Korean queries are literal translations of English keywords.

### 3. Score Trigger Coverage

For each query, ask: **would the current description cause Claude to invoke this skill?**

Assess each query on two axes:
- **Should trigger** (queries 1–7, 10): does the description give enough signal? Score 1 if yes, 0 if no.
- **Should not trigger** (queries 8–9): does the description stay silent? Score 1 if correctly silent, 0 if it would falsely trigger.

**Trigger score** = `(correct answers / 10) × 10`

### 4. Identify Gaps

Common failure patterns to call out explicitly:

| Pattern | Signal |
|---------|--------|
| **Korean blind spot** | English-only description; Korean queries score 0 |
| **Keyword-only** | Lists exact terms but no intent/situation framing |
| **Jargon wall** | Trigger requires domain vocabulary the user wouldn't use naturally |
| **Too narrow** | Only fires when user says the skill's name explicitly |
| **Too broad** | Would fire on loosely related requests, creating noise |

### 5. Write Improved Description

Rewrite the description as a drop-in replacement. Follow these principles:

1. **Lead with what the skill does** — one clear sentence
2. **Frame around intent/situation**, not just keywords — describe *when someone needs this*, not just *what words they say*
3. **Include Korean natural language phrases** — real colloquial expressions in-line, not a separate section
4. **Include English colloquial variants** alongside formal terms
5. **Stay under ~80 words** — descriptions are always in context; verbosity degrades the whole system

**Structure:**
```
[What skill does]. Use when [situation/intent] — [English phrases], or Korean: [한국어 구어체]. Also triggers on [implicit/borderline cases worth catching].
```

**Before / After example:**

Before:
```
Write readable, maintainable code. Use when the user mentions "code review", "naming conventions", "function too long", "code smells", or "readable code".
```

After:
```
Improves code quality through naming, function design, and smell detection. Use when reviewing or cleaning up any code — "code review", "refactor", "this is hard to read", or Korean: "코드 리뷰해줘", "이 코드 좀 봐줘", "가독성", "리팩토링", "코드 정리". Also triggers when someone asks why code feels messy or hard to change.
```

## Output Format

### Single Skill

```
## [skill-name] — Trigger Analysis

**Score:** X/10
**Current description:** [verbatim]

### Query Results
| Query | Lang | Trigger? | Verdict |
|-------|------|----------|---------|
| "이 코드 좀 봐줘" | KO | ❌ miss | No Korean terms |
| "can you review my code" | EN | ✅ hit | "code review" matches |
| "what's a good linter" | EN | ❌ false neg | intent matches but no signal |
...

### Gaps
- [specific gap with explanation]

### Improved Description
[ready-to-paste rewrite — no surrounding quotes or markdown fences]
```

### Batch (plugin or all skills)

Start with a summary table:

```
| Skill | Score | Primary Gap |
|-------|-------|-------------|
| clean-code | 4/10 | No Korean triggers |
| decision-maker | 7/10 | Colloquial English weak |
...
```

Then produce individual reports for all skills scoring below 7. For skills scoring 7+, note them as "acceptable — no action needed" unless the user asks for more detail.

## Applying Changes

After producing improved descriptions, ask the user: **"Want me to apply these to the SKILL.md files directly?"**

If yes, update only the `description` field in each file's frontmatter — do not touch the body. Then follow INSTRUCT.md: bump the patch version in `marketplace.json`, update the plugin README, commit, and push.

If the user wants to review first, show all rewrites side-by-side before applying.
