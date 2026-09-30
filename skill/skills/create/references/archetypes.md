# Skill Archetypes

Induced from 101 non-deprecated skills on 2026-09-30. Exemplars are the source of truth — read them;
these skeletons are a map, not a replacement.

## Shared frontmatter (all archetypes)

```yaml
---
name: <bare-kebab-name>
description: >-
  Use when <situation>. Triggers on: "<한국어 구어체>", "<한국어>", "<English phrase>".
scenarios:
  - "<realistic EN prompt>"      # 2–3 EN
  - "<자연스러운 한국어 요청>"      # 2–3 KR
compatibility:
  recommended:
    - think-tool
  optional:
    - sequential-thinking
  remote_mcp_note: >-
    think-tool이 있으면 <이 스킬에서 무엇이 나아지는지 한 문장>.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
---
```

Description: 97/101 start `Use when`; median 236 chars, limit 250. Plugin- or server-bound skills use
`compatibility: required: [<tool>]` instead.

## 1. Technique — single analysis or method (~90–130 lines)

Exemplars: `cognition/skills/tradeoff-articulator`, `cognition/skills/fallacy-detector`

```
# <Title>
<1–2 line purpose>
## When to Use / When Not to Use
## Process            (numbered steps, bold step names)
## Output Template    (fenced block of the deliverable; ends with a "Do NOT ..." line)
## What Claude Does / What You Do
## Related Skills
```

## 2. Persona / discipline — enforces a stance every turn (~95–180 lines)

Exemplars: `think/skills/devils-advocate`, `think/skills/mentor`
Frontmatter adds `effort: high`.

```
## Standing Mandates  (ALWAYS / NEVER bullets, last line "Goal: ...") — before or right after H1
# <Title>
## Process
## Output Template
## What Claude Does / What You Do
## Related Skills
```

## 3. Workflow / router — sequences other skills (~110–200 lines)

Exemplars: `develop/skills/database-workflow`, `cognition/skills/critical-thinking-workflow`
Frontmatter adds `type: workflow`, `estimated_time`.

```
# <Title> Workflow
## When to Use / When Not to Use
## Workflow Overview  (table: Step | Skill (plugin:skill) | Input | Output | Skip if)
## Steps              (### Step N — <name>, each naming the sub-skill)
## State Tracking     (what to carry between steps)
## What Claude Does / What You Do
## Related Skills     (labelled: Individual skills / Before / After)
```

## 4. Ops / scaffold — install, patch, remove (~50–160 lines)

Exemplars: `harness/skills/install`, `teams/skills/patch`
Deterministic work goes in a bundled idempotent, non-destructive script (`scripts/*.mjs`); the skill does
judgment and dialogue and reads the script's JSON report.

```
# <Title>
## Process
## Related Skills
```

## 5. Builder — produces an artifact (~160–250 lines)

Exemplars: `knowledge/skills/knowledge-base-builder`, `portfolio/skills/portfolio-rewrite`
Frontmatter adds `effort: high`. Heavy parts go to `references/`.

```
## Standing Mandates
# <Title>
## Process            (starts with a short Quick Intake)
## Output Template    (the artifact's full shape)
## Quality Bar
## What Claude Does / What You Do
## Related Skills
```

## 6. Domain specialist — deep topic knowledge (~130–250 lines)

Exemplars: `develop/skills/chaos-engineer`, `develop/skills/kotlin-specialist`

```
# <Title>
## When to Use / When Not to Use
## Process
## Reference Guide    (table: Topic | references/<file>.md | Load when)
## Constraints
## Output Template
## What Claude Does / What You Do
## Related Skills
```

## Conventions

- Related Skills: bullets; same plugin = bare name in backticks, other plugin = `plugin:skill`, each with
  "— <when>".
- What Claude Does / What You Do: one H2, `| Claude | You |` table, 3–4 rows.
- Korean appears in triggers, scenarios, `remote_mcp_note`, and user-facing prompts — body stays English.

## Do not copy

- Descriptions not starting `Use when`, over 250 chars, or summarizing the process.
- Split `What Claude Does` / `What You Do` headings; `Related` instead of `Related Skills`.
- Missing H1, or scenarios in one language only.
- Skill names that repeat the plugin (`knowledge-*`, `portfolio-*` are legacy, not the pattern).
- A `related:` frontmatter list duplicating Related Skills.
