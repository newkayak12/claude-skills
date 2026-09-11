---
name: self-discovery-workflow
description: >-
  Use when someone wants to understand themselves more deeply — not just answer
  a single question, but explore the full landscape of who they are. Especially
  suited to life transitions, career crossroads, burnout recovery, and wanting
  to know...
type: workflow
theme: self-understanding
scenarios:
  - "I'm at a crossroads and want to understand myself before deciding"
  - "I've been burned out and want to do a full self-inventory"
  - "Help me understand who I am across all the dimensions that matter"
  - "큰 결정을 앞두고 나 자신을 먼저 제대로 알고 싶어"
  - "번아웃 이후 나를 다시 이해하고 싶어"
  - "삶의 전환점에서 자기 탐색 여정을 시작하고 싶어"
estimated_time: "Each zone 30-90 min; full journey is nonlinear and multi-session"
compatibility:
  recommended:
    - think-tool
  optional:
    - sequential-thinking
  remote_mcp_note: >-
    think-tool이 있으면 표면적 답변과 더 깊은 패턴을 구분하는 판단 품질이 높아집니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
---

# Self-Discovery Workflow

Non-linear journey across 5 zones — enter at any point, revisit freely.

## When to Use / When Not to Use

| Use | Skip |
|-----|------|
| Life transition, career crossroads | Single focused question (use individual skill) |
| Burnout recovery, feeling lost | Quick mood check or situational advice |
| Pre-decision self-understanding | Already know what you want — just need a plan |

---

## Workflow Overview

```
Self-discovery is not a pipeline. It is a landscape.
Enter wherever the pull is strongest.

    [1] FOUNDATION
    Identity + Values
    Who am I? What do I actually value?
          |
    [2] INNER LANDSCAPE            [3] RELATIONAL
    Motivation + Fear +            Attachment Style +
    Flow / Anti-Goal               Ego State
    What drives me?                How do I show up
    What blocks me?                with others?
          |                              |
    [4] SHADOW
    Shadow Persona + Strength / Growth
    What am I not seeing about myself?
                    |
            [5] INTEGRATION
              Examined Life
          The big-picture synthesis
```

**Suggested starting points by situation:**

| Situation | Start here |
|-----------|-----------|
| "I don't know who I am anymore" | Zone 1 — Foundation |
| "I keep doing things without knowing why" | Zone 2 — Inner Landscape |
| "The same relationship patterns keep repeating" | Zone 3 — Relational |
| "I get disproportionately triggered by certain people" | Zone 4 — Shadow |
| "I want to look at my whole life" | Zone 5 — Integration |
| "I don't know where to start" | Zone 1 — Foundation |

---

## Zones

### Zone 1 — Foundation
**Skills:** `identity-explorer` + `values-explorer`
**Goal:** Establish who you are and what you actually (not declaratively) value
**Input:** Recent choices, reactions, and moments of pride or outrage
**Output:** Identity map (roles, narrative, self-concept clarity); values inventory with evidence and conflict resolution
**Skip if:** You've done this work recently and have documented outputs from both skills

> "Zone 1 시작" or "나의 정체성과 가치관부터 탐색해줘"

---

### Zone 2 — Inner Landscape
**Skills:** `motivation-explorer` + `fear-inventory` + `flow-antigoal`
**Goal:** Understand what drives you, what blocks you, and what conditions let you thrive
**Input:** A goal or pursuit that matters; honest reflection on where you feel blocked or depleted
**Output:** Root motivation layers; named fears with fear-setting analysis; flow map and anti-goal set
**Skip if:** You have clear motivation and are not currently blocked — move to Zone 3 or 4

> "Zone 2 시작" or "내 동기와 두려움, 몰입 조건을 탐색해줘"

---

### Zone 3 — Relational
**Skills:** `attachment-style-mirror` + `ego-state-identifier`
**Goal:** Understand how you show up in close relationships and which inner states drive automatic reactions
**Input:** A recurring relational pattern or a reaction that felt disproportionate or automatic
**Output:** Attachment style with growth path; ego state map with Adult-state alternatives
**Skip if:** Relationships feel clear and non-repeating — focus on other zones first

> "Zone 3 시작" or "관계 패턴과 자동 반응을 탐색해줘"

---

### Zone 4 — Shadow
**Skills:** `shadow-persona` + `strength-growth-mapper`
**Goal:** Surface what you're not acknowledging — what's hidden in shadow and what's genuinely real in your strengths
**Input:** Strong reactions to others, exhausting roles, resisted feedback, and a concrete challenge ahead
**Output:** Persona map with shadow candidate and integration experiment; strength and growth map with precise growth edge
**Skip if:** Early in the journey — Zone 1 context makes shadow work land better

> "Zone 4 시작" or "그림자와 강점을 탐색해줘"

---

### Zone 5 — Integration
**Skill:** `examined-life`
**Goal:** Look at the whole shape of your life — direction, alignment, and autopilot patterns
**Input:** Outputs from other zones as context; honest reflection on major life domains
**Output:** Examined life audit; values-life gaps; regret risk; Stoic reframing; one concrete commitment
**Skip if:** First session — gather zone material first; integration synthesizes, it doesn't replace earlier work

> "Zone 5 시작" or "내 삶 전체를 통합적으로 돌아보고 싶어"

---

## State Tracking

어느 존에 있는지 알려주면 바로 합류합니다:
- "두려움부터 보고 싶어" → Zone 2 (fear-inventory)
- "관계 패턴이 반복돼" → Zone 3
- "처음부터 전체 여정 가이드해줘" → Zone 1부터 순서대로

Each zone enriches the others — Identity (Zone 1) deepens shadow work (Zone 4); Motivation and Fear (Zone 2) give the examined-life audit (Zone 5) its raw material.

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Suggests entry point based on your situation | Bring honest reflection — not the "right" answer |
| Asks one focused question per dimension | Sit with discomfort when a pattern surfaces |
| Names patterns without prescribing change | Decide what to do with each insight |
| Carries context across zones | Do the actual experiments and integration work |

## Related Skills

- Individual skills in each zone — run any standalone when the question is specific
- `think:deep-thinking-workflow` — for structured decisions after self-discovery work
- `self:flow-antigoal` — for designing work and life around what you've found
