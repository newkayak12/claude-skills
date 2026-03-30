---
name: deep-thinking-workflow
description: >-
  Use when you need to think through a complex problem systematically — generating
  ideas, stress-testing them, and converging on a decision.
  Triggers on: "think workflow", "깊이 있게 생각해보자", "아이디어를 체계적으로 검토",
  "structured thinking", "체계적 사고 프로세스", "idea to decision".
  Best for: strategy decisions, architecture choices, hard tradeoffs, or any situation
  where you need to diverge before you converge.
  Not for: quick answers, factual lookups, or already-decided actions.
type: workflow
theme: thinking
scenarios:
  - "think workflow 시작해줘"
  - "깊이 있게 체계적으로 생각해보자"
  - "idea to decision full process"
  - "structured thinking 돌려줘"
estimated_time: "60-180 min (full), 20-45 min per step"
compatibility:
  recommended:
    - think-tool
    - sequential-thinking
  optional:
    - mcp-reasoner
  remote_mcp_note: >-
    think-tool + sequential-thinking 조합이 이 워크플로의 핵심입니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
---

# Deep Thinking Workflow

4-step structured thinking process: diverge → decompose → challenge → converge.

## When to Use / When Not to Use

| Use | Skip |
|-----|------|
| Complex decision with multiple viable paths | Simple factual question |
| Problem needs reframing before solving | Already know what to do |
| Ideas exist but lack rigorous validation | Time-boxed quick answer needed |

---

## Workflow Overview

```
[1] Diverge — Brainstorming
        ↓
[2] Decompose — First Principles
        ↓
[3] Challenge — Devil's Advocate
        ↓
[4] Converge — Decision Framework
```

---

## Steps

### Step 1 — Brainstorming
**Skill:** `brainstorming`
**Goal:** Generate maximum breadth of ideas — no filtering yet
**Output:** 10-20 raw ideas, grouped by theme
**Skip if:** Ideas already exist, just need evaluation

> "Step 1 시작" 또는 "아이디어 발산부터 해줘"

---

### Step 2 — First Principles Thinking
**Skill:** `first-principles`
**Goal:** Break the problem to its fundamentals, question every assumption
**Input:** Top ideas from Step 1 (or the core question directly)
**Output:** Root causes, broken-down components, assumption list
**Skip if:** Problem scope is already well-defined

> "Step 2 시작" 또는 "first principles로 분해해줘"

---

### Step 3 — Devil's Advocate
**Skill:** `devils-advocate`
**Goal:** Steel-man the strongest objections — expose where the idea breaks
**Input:** Best idea(s) from Steps 1-2
**Output:** 3 strongest counterarguments + core vulnerability + optional fix paths
**Skip if:** Decision is low-stakes or reversible

> "Step 3 시작" 또는 "devil's advocate 돌려줘"

---

### Step 4 — Decision Framework
**Skill:** `decision-maker`
**Goal:** Converge — evaluate options with criteria, make a recommendation
**Input:** Ideas, decomposition, and counterarguments from Steps 1-3
**Output:** Decision matrix, weighted recommendation, confidence level
**Skip if:** Only one viable option remains after Step 3

> "Step 4 시작" 또는 "decision framework으로 정리해줘"

---

## State Tracking

어느 단계에 있는지 알려주면 바로 합류합니다:
- "Step 2부터" → first-principles 바로 시작
- "아이디어는 있어, 반론만 봐줘" → Step 3으로 직행

## MCP Enhancement

- **think-tool**: Steps 2, 3 — 가정 분해와 반론 생성에서 사용
- **sequential-thinking**: 전체 흐름 — 각 단계 output이 다음 단계 input으로 이어지는 맥락 유지
- **mcp-reasoner**: Step 4 — 여러 옵션을 구조적으로 비교할 때

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Idea generation, framing, synthesis | Define the core question |
| Assumption breakdown, reframing | Validate assumptions against real context |
| Counterargument generation | Add domain knowledge I don't have |
| Decision matrix scoring | Make the final call |

## Related Skills

- `think:brainstorming`, `think:first-principles`, `think:devils-advocate`, `think:decision-maker`
- Before: Use `think:problem-reframer` if the question itself feels wrong
- After: Feed decision output into `pm:pm-strategy-workflow` or `develop:dev-quality-workflow`
