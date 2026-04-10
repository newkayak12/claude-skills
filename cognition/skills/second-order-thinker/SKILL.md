---
name: second-order-thinker
description: >-
  Use when someone is evaluating a decision, policy, or action and the analysis
  focuses only on the immediate intended outcome. Maps downstream effects across
  five mechanisms and adds the temporal dimension — when effects actually hit.
  Triggers on:

scenarios:
  - "What are the second-order effects of this decision?"
  - "We're excited about this policy — what could go wrong downstream?"
  - "Walk me through what happens after the first-order effect"
  - "이 결정의 2차 효과가 뭘까?"
  - "좋아 보이는 정책인데 의도치 않은 결과가 있을 것 같아"
  - "장기적으로 어떤 영향이 나타날지 분석해줘"

compatibility:
  recommended:
    - think-tool
  optional:
    - sequential-thinking
  remote_mcp_note: >-
    think-tool이 있으면 다섯 가지 2차 효과 메커니즘을 빠짐없이 검토하고
    가장 중요한 비가시적 효과를 정확하게 식별할 수 있습니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
---

# Second-Order Thinker

## When to Use / When Not to Use

**Use when:**
- A decision analysis stops at first-order effects
- A policy sounds good on the surface
- Timing of effects is being ignored (not just whether, but when)

**Not for:**
- Surfacing hidden premises (use assumption-extractor)
- Diagnosing cognitive bias in the analysis (use bias-auditor)

## Process

**Step 1 — Map first-order effects.** State them explicitly. Second-order effects branch off these.

**Step 2 — Check all five mechanisms.** Do not skip any.

| Mechanism | What to check |
|-----------|--------------|
| **2a. Behavioral responses** | How do rational actors respond to changed incentives? |
| **2b. Feedback loops** | Does the first-order effect change a variable that loops back? |
| **2c. Resource/attention effects** | What was NOT done because of this? |
| **2d. Signaling effects** | What does this action communicate, independent of its direct effect? |
| **2e. Competitive/strategic responses** | How do other actors respond, and then how does that change things? |

**MCP note:** If `sequential-thinking` is available, run all five mechanisms before assigning temporal labels — early salient mechanisms tend to dominate if you move to timing too soon.

**Step 3 — Add temporal dimension.** For each effect:
- Immediate (days–weeks): visible and attributable
- Medium-term (months–2 years): behavioral adaptations, first feedback cycles
- Long-term (years–decades): structural changes, compounding

Key pattern to find: **short-term gain, long-term cost** (or its inverse).

**Step 4 — Map the consequence chain.**

```
Action: [X]
  ├── 1st order: [A] (timing: immediate/medium/long)
  │     ├── 2nd order: [A1] (timing: T)
  │     └── 2nd order: [A2] (timing: T)
  └── 1st order: [B] (timing: T)
        └── 2nd order: [B1] (timing: T)
```

Stop at 3rd order unless the case specifically warrants it.

**Step 5 — Identify the critical insight.** The most important non-obvious effect.

## Output Template

```
핵심 2차 효과 / Critical Second-Order Effect:
[What it is]
When it hits: [Time horizon]
Why it matters: [What it changes about the decision]
What to watch for: [Leading indicator that this effect is materializing]
```

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Maps first-order effects before going deeper | Describe the action or decision being analyzed |
| Checks all five second-order mechanisms systematically | Confirm which mechanisms are plausible in your context |
| Assigns timing to each effect | Decide whether timing considerations change the decision |
| Identifies the single most consequential non-obvious effect | Build monitoring/mitigation for that effect into the plan |

**Common patterns to watch for:** Cobra effect, crowding out, adaptation/gaming, timing asymmetry.

## Related Skills

- `assumption-extractor` — for surfacing hidden premises before analyzing consequences
- `tradeoff-articulator` — for mapping costs once downstream effects are visible
- `mental-model-toolkit` — for alternative frames when second-order effects are surprising
