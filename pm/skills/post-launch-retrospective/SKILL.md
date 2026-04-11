---
name: post-launch-retrospective
effort: high
description: >-
  Use after a feature or product launch to formally close the cycle: validate
  the original hypothesis, analyze which metrics moved, document learnings, and
  decide what to do next. Triggers on: "출시 후 회고", "런칭 결과 분석", "피처 성과 리뷰",
  post-launch review",
license: MIT
metadata:
  author: wondelai
  version: "1.0.0"
scenarios:
  - "We shipped the feature 3 weeks ago — help me run a post-launch retro."
  - "출시 후 회고를 어떻게 체계적으로 진행하면 될까?"
  - "Our activation metric didn't move after the launch — which type of failure is this?"
  - "런칭 결과를 분석해서 다음 사이클에 반영할 러닝카드를 만들어줘."
  - "How do I tell if poor metrics are a launch problem vs. a product problem?"
  - "피처 가설이 맞았는지 틀렸는지 정리해줘."
compatibility:
  recommended:
    - think-tool
  optional:
    - mcp-reasoner
  remote_mcp_note: >-
    think-tool이 있으면 런치 실패 유형(론치 실패 vs. 가설 실패 vs. 측정 실패)을 구분하는 데 도움이 됩니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
---
## Standing Mandates

- ALWAYS have the original hypothesis and pre-launch success criteria in hand before starting.
- ALWAYS distinguish between launch failure, hypothesis failure, and measurement failure before drawing conclusions.
- NEVER attribute poor metrics to a single cause without ruling out alternatives.
- NEVER run the retro without a clear decision on what to do next — iterate, pivot, or stop.


# Post-Launch Retrospective Framework

A structured evaluation process for feature and product launches — validating the original hypothesis, analyzing metric movement, documenting learnings, and connecting results to the next cycle.

## Core Principle

**A launch without a retrospective is an experiment without a conclusion.** Most teams move directly from launch to the next item on the roadmap. This creates an organization that ships without learning — the same bets get placed repeatedly because no one recorded what the last one taught.

**The retrospective closes the Build-Measure-Learn loop.** It answers: "Was our hypothesis right? What actually moved? Why? What do we now believe? What does this mean for what we build next?"

**A critical distinction:** Launch failure (low adoption, poor rollout, messaging missed) is different from product-market fit failure (we built the right thing poorly) is different from hypothesis failure (our assumption about the problem or solution was wrong). The retro must distinguish these — they imply different responses.

## Agent Output

When a user asks to run a post-launch retro, produce:
1. **Hypothesis validation check** — what was predicted vs. what happened
2. **4-section retro document** — What We Shipped / What Moved / What We Learned / What We'd Do Differently
3. **Failure type diagnosis** if metrics missed (launch / PMF / hypothesis failure)
4. **Learning card** for the team wiki (portable, feeds next cycle)
5. **Next step recommendations** — explicit handoffs to prioritization or research

When a user asks to **evaluate their retro practice**, rate 0-10:
- **9-10:** Every launch has a retro; original hypothesis is documented and explicitly validated; learnings feed the next cycle's inputs
- **7-8:** Retros happen but are informal; hypothesis wasn't written before launch; "it did well" is the standard of success
- **5-6:** Metrics are reviewed but causality is not examined; team moves on quickly
- **3-4:** Post-launch review = checking if DAU went up; no hypothesis to validate
- **1-2:** No post-launch review; launches are celebrated or ignored, never analyzed

## Pre-Retro Checklist

Before running the retrospective, confirm you have:
- [ ] The original hypothesis written before launch (if missing, reconstruct from PRD — see `../prd-development/SKILL.md`)
- [ ] Success metrics defined pre-launch (from PRD or `../go-to-market-planning/SKILL.md`)
- [ ] Sufficient time post-launch for metrics to stabilize (minimum: 2 weeks for behavioral metrics, 4 weeks for retention)
- [ ] Baseline data (what was the metric before the launch?)
- [ ] Segmented data if possible (did it work for all users, or just a subset?)
- [ ] Any qualitative signals: support tickets, sales calls, user interviews triggered by the launch

## The 4-Section Retrospective

### Section 1: What We Shipped

Anchors the retro to what was actually delivered — not what was planned. Scope changes between design and launch are common and often explain metric gaps.

```
Feature/release name: [name]
Launch date: [date]
What we planned to ship: [original scope from PRD]
What actually shipped: [actual scope]
Scope delta: [what was cut, deferred, or added and why]
Target audience: [who was this released to — all users, a segment, a cohort?]
Rollout method: [full release / phased / feature flag / A/B / beta group]
```

### Section 2: What Metrics Moved

This is the evidence section. Be precise. Compare against baseline and against the original success metric definition.

**For each metric in your success criteria:**
```
Metric: [metric name]
Baseline (pre-launch): [value]
Target (from PRD/hypothesis): [value]
Actual (post-launch): [value]
Delta: [absolute and relative change]
Statistical significance: [if A/B test — p-value and confidence interval]
Time window: [measured over what period?]
Confounds: [anything else that changed during this period that could explain the movement?]
```

**Metrics table format:**

| Metric | Baseline | Target | Actual | Result |
|--------|----------|--------|--------|--------|
| [metric 1] | [value] | [value] | [value] | Hit / Missed / Partial |
| [metric 2] | [value] | [value] | [value] | Hit / Missed / Partial |

**Important:** Also document metrics that were NOT in the success criteria but moved — these often contain the most useful learning. Negative side effects (other metrics that dropped) must be documented here.

### Section 3: What We Learned

This is the most important section. It is also the section most likely to be skipped or written as vague platitudes ("we learned we should communicate better").

**For each major learning:**
```
LEARNING: [one sentence — a specific, revisable belief about users, the product, or the process]
Evidence: [what data or observation supports this belief?]
Confidence: High / Medium / Low
Type: Hypothesis validation / User behavior discovery / Process insight / Technical finding
Implication: [What should we do differently or next because of this?]
```

**Learning types and what they imply:**

| Learning Type | Implication |
|--------------|-------------|
| Hypothesis confirmed | Increase confidence in this bet; use as evidence in prioritization |
| Hypothesis disconfirmed | Update the assumption map; don't repeat this bet without new evidence |
| User behavior unexpected | Flag for follow-up research (`../customer-research-synthesis/SKILL.md`) |
| Metric moved but wrong segment | Revisit targeting; consider segment-specific variants |
| Process failure (not product) | Document in team norms; retro is not a product learning |

### Section 4: What We'd Do Differently

**This section should be brutal.** Vague answers ("better communication") are a waste of the retro. Specific answers ("we should have done a 10% rollout before full release because we didn't catch the edge case in the invoice calculation") change how the team works next time.

**Structure for each item:**
```
What happened: [specific event or decision]
Impact: [what did this cause?]
What we'd do instead: [specific, actionable alternative]
Who owns this change: [if a process change — who is responsible for implementing it?]
```

**Common retrospective findings (prompts if the team is stuck):**
- Did the rollout strategy match the risk level of the change?
- Were success metrics defined before or after launch?
- Did the launch plan (`../go-to-market-planning/SKILL.md`) address the right audiences?
- Were there qualitative signals we ignored before launch that predicted the results?
- Did we have the right instrumentation in place on day one?

## Hypothesis Validation Checklist

The core test of the retrospective.

```
Original hypothesis:
"We believed [doing X] for [user Y] would result in [outcome Z].
We would know we were right when [metric M reached level L]."

Validation result:
[ ] Confirmed — metric hit, directional signal strong
[ ] Partially confirmed — metric moved but below target OR only for a subset of users
[ ] Disconfirmed — metric did not move or moved in the wrong direction
[ ] Inconclusive — insufficient data (small sample, too short a window, confounds)

If disconfirmed or partially confirmed:
Which assumption was wrong?
[ ] We misidentified the user need (problem assumption)
[ ] We built the wrong solution for a real need (solution assumption)
[ ] The need exists but this user segment doesn't have it at scale (segment assumption)
[ ] The solution was right but the execution was poor (launch/quality failure)
[ ] External factors masked the result (confound)
```
