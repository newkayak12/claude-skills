---
name: critical-thinking-workflow
description: >-
  Use when stress-testing a high-stakes decision, strategic plan, or argument end-to-end.
  Triggers on: "critical thinking full process", "decision stress-test", "전략 검토 전체",
  "논리 전체 점검", "high-stakes decision review", "결정 제대로 검토해줘".
  Best for: major decisions before committing, reviewing a strategic plan, preparing for a debate.
  Not for: small decisions — use individual cognition skills directly.
type: workflow
theme: critical-thinking
scenarios:
  - "Run a full critical thinking review on this decision before I commit"
  - "Stress-test this strategic plan — I want every flaw surfaced"
  - "I'm about to make a high-stakes argument — check it end-to-end"
  - "이 결정 제대로 전체 검토해줘, 놓친 게 없는지 확인하고 싶어"
  - "전략 계획 최종 점검 — 논리·편향·결과까지 다 봐줘"
  - "중요한 논쟁 준비 중인데 처음부터 끝까지 비판적으로 검토해줘"
estimated_time: "1-3 hours (full), 15-30 min per step"
compatibility:
  recommended:
    - think-tool
    - mcp-reasoner
  optional:
    - sequential-thinking
  remote_mcp_note: >-
    think-tool은 각 단계의 분석 품질을 높이고, mcp-reasoner는 경쟁 옵션이 있는
    판단 단계(Step 3, Step 6)에서 특히 유효합니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
---

# Critical Thinking Workflow

7-skill end-to-end process: reframe → surface assumptions → clean reasoning → downstream effects → calibrate confidence → make tradeoffs explicit.

## Workflow Overview

```
[1] Question Upgrader
        |
        v
[2] Assumption Extractor
        |
        v
[3a] Fallacy Detector ----+---- [3b] Bias Auditor
        (parallel)        |         (parallel)
                          v
              [4] Second-Order Thinker
                          |
                          v
              [5] Epistemic Reasoner
                          |
                          v
              [6] Tradeoff Articulator
```

---

## Steps

### Step 1 — Question Upgrader
**Skill:** `question-upgrader`
**Goal:** Verify we are solving the right problem before investing in an answer
**Input:** Problem as currently framed
**Output:** Upgraded question(s), named framing weakness, hidden assumption in the question, the question being avoided
**Skip if:** Framing has already been challenged and a better question is agreed on

> "Step 1 시작" or "질문부터 업그레이드해줘"

---

### Step 2 — Assumption Extractor
**Skill:** `assumption-extractor`
**Goal:** Surface factual, causal, value, and definitional assumptions the argument rests on
**Input:** Upgraded framing from Step 1
**Output:** Assumption map across four categories (load-bearing / significant / peripheral); most dangerous assumption named
**Skip if:** Assumptions have already been explicitly stress-tested

> "Step 2 시작" or "숨겨진 전제 찾아줘"

---

### Step 3a + 3b — Fallacy Detector + Bias Auditor (parallel)
**Skills:** `fallacy-detector` and `bias-auditor`
**Goal:** Check that the argument structure is sound (3a) and the judgment is free of cognitive distortion (3b)
**Input:** Core argument and rationale from Step 2
**Output 3a:** Named fallacies with location in argument; narrative fallacy assessment; worst structural error
**Output 3b:** Active biases across three layers; primary bias and what it distorts
**Skip 3a if:** The analysis is a plan with no explicit reasoning chains to evaluate
**Skip 3b if:** No expressed confidence or judgment calls are present

> "Step 3 시작" or "논리 오류랑 편향 같이 봐줘"

---

### Step 4 — Second-Order Thinker
**Skill:** `second-order-thinker`
**Goal:** Map downstream effects across five mechanisms with timing labels
**Input:** Step 2 assumptions + Step 3 structural and bias findings
**Output:** Consequence chain; critical second-order effect with time horizon and leading indicator
**Skip if:** Decision affects only the immediate actor with no systemic or behavioral ripple

> "Step 4 시작" or "2차 효과 분석해줘"

---

### Step 5 — Epistemic Reasoner
**Skill:** `epistemic-reasoner`
**Goal:** Separate what is actually known from what is believed; calibrate confidence to evidence
**Input:** Claims and evidence surfaced across Steps 1–4
**Output:** Calibrated confidence label per core claim (high / moderate / low / speculation); gap from stated confidence; analogy verdict if applicable
**Skip if:** All claims are already framed as exploratory with no stated certainty

> "Step 5 시작" or "확신 수준 보정해줘"

---

### Step 6 — Tradeoff Articulator
**Skill:** `tradeoff-articulator`
**Goal:** Make the cost structure of the preferred option fully visible — including hidden axes
**Input:** Full picture from Steps 1–5; option(s) under consideration
**Output:** Hidden tradeoff axes surfaced; qualitative matrix; concrete opportunity costs; unavoidable tension named
**Skip if:** No real choice exists — only one viable option remains after prior steps

> "Step 6 시작" or "트레이드오프 정리해줘"

---

## State Tracking

Tell me which step you're on and I'll pick up from there:
- "가정은 이미 정리됐어, 2차 효과부터" → Step 4로 직행
- "Step 3부터" → run fallacy-detector and bias-auditor in parallel

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Reframes the question; names what makes it weak | Provide the original question or problem framing |
| Scans all four assumption categories; classifies by load | Confirm which assumptions are actually operative |
| Identifies fallacies and biases that are actually present | Decide which findings to act on before proceeding |
| Maps second-order effects across five mechanisms with timing | Validate which downstream effects are plausible in context |
| Calibrates confidence labels to actual evidence | Adjust how you state claims in the final argument |
| Surfaces hidden tradeoff axes; names the unavoidable tension | Make the final call with full cost visibility |

## Related Skills

- Individual skills: `cognition:question-upgrader`, `cognition:assumption-extractor`, `cognition:fallacy-detector`, `cognition:bias-auditor`, `cognition:second-order-thinker`, `cognition:epistemic-reasoner`, `cognition:tradeoff-articulator`
- Before: `think:deep-thinking-workflow` (open-ended ideation before stress-testing)
- After: `think:decision-maker` (when ready to choose), `pm:pm-strategy-workflow` (when findings inform product strategy)
