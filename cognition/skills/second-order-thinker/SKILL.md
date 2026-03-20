---
name: second-order-thinker
description: |
  Activate when the user is evaluating a decision, policy, or action — especially when the analysis focuses only on the immediate intended outcome. Trigger on: "2차 효과", "second order", "그 다음엔?", "장기적 영향", "부작용", "의도치 않은 결과", "타이밍", "언제 영향이 나타나나", "downstream effect". Also trigger when someone is excited about an intervention, when a policy sounds good on its surface, when someone asks "should we do X?" without considering systemic ripple effects, or when timing is being ignored in a decision about when to enter, exit, or act. Do not wait — if a decision analysis is stopping at first-order effects, push further.
---

# Second-Order Thinker

First-order thinking is easy: you do X, you get Y. Everyone can do this. It's also usually wrong in complex systems, because complex systems don't stop at Y.

Second-order thinking asks: and then what? What happens after Y? Who responds to Y? What does Y change in the incentive structure? What feedback loops does Y trigger? When — not just whether — do these effects materialize?

Howard Marks, the investor, put it plainly: "First-level thinking says, 'It's a good company; let's buy the stock.' Second-level thinking says, 'It's a good company, but everyone thinks it's a good company, so it's not cheap. Let's look elsewhere.'" The first-order thought is correct and useless. The second-order thought is where the edge is.

## The Two Dimensions: What and When

Second-order thinking has a spatial dimension (what are the downstream effects?) and a temporal dimension (when do they hit?). Both matter.

Most analyses get the spatial dimension partially right but ignore timing entirely. Timing matters because:
- Short-term and long-term effects are often in opposite directions
- The window for reversibility closes at a specific time, not in the abstract
- Compounding effects look negligible early and catastrophic late
- Timing of entry and exit in any decision is often more important than the decision itself

These two dimensions must be analyzed together: "Effect X happens, and it happens at time T."

## Step 1: Map the First-Order Effects

Before going deeper, establish what the user believes the direct effects are. State them explicitly:

"First-order effects of [action]: [list]"

This is necessary because second-order effects branch off from first-order effects — you need the branches before you can find the leaves.

## Step 2: Generate Second-Order Effects

**MCP instruction:** If `sequential-thinking` is available, use it — all five second-order mechanisms must be checked before temporal assignment. The most salient early mechanism tends to dominate, causing the model to miss less obvious but equally important downstream effects.

For each first-order effect, ask: who responds to this, and how? What does this change in the system? What does this enable or constrain that wasn't enabled or constrained before?

Check all five mechanisms (treat as a checklist — do not skip):

- **2a. Behavioral responses:** Rational actors respond to changed incentives. If you impose a fine, people optimize to avoid the fine, sometimes in ways that defeat the policy's purpose. Example: a tax on plastic bags → people bring reusable bags (intended) → but also buy more small plastic bins and bin liners to replace the bags they previously repurposed (unintended, partially offsetting the effect).

- **2b. Feedback loops:** The first-order effect changes a variable that, in turn, affects the original system. Example: increasing housing supply in a desirable area → some gentrification → higher desirability → more demand → prices don't fall as much as linear analysis predicted.

- **2c. Resource and attention effects:** Any action consumes resources (money, time, attention, political capital). The second-order question is what was not done as a result. Resources spent here are not available there.

- **2d. Signaling effects:** Actions communicate information. The communication often has its own effects independent of the direct action. Example: cutting prices can increase revenue (first order) but also signal quality problems to prospective customers (second order).

- **2e. Competitive and strategic responses:** In any domain with other actors, your action changes their situation and triggers their response. Their response then changes yours.

## Step 3: Add the Temporal Dimension

For each effect (first and second order), assign a time horizon:

- **Immediate (즉각적):** Days to weeks. Usually visible and attributable.
- **Medium-term (중기):** Months to 1-2 years. Behavioral adaptations begin to manifest. Feedback loops start completing their first cycle.
- **Long-term (장기):** Years to decades. Structural changes, compounding effects, and second-order behavioral adaptations become dominant.

The critical pattern to look for: **short-term gain, long-term cost** (and its inverse). Many interventions look excellent in the immediate window and destructive over a longer window. Many investments look painful immediately and excellent over time.

Also look for **timing leverage points:** is there a window in which this action has maximum effect? What happens if the timing is early vs. late?

## Step 4: Map the Consequence Chain

For decisions with significant stakes, map the chain explicitly:

```
Action: [X]
  ├── 1st order effect: [A] (timing: [immediate/medium/long])
  │     ├── 2nd order effect: [A1] (timing: [T])
  │     │     └── 3rd order effect: [A1a] (if relevant)
  │     └── 2nd order effect: [A2] (timing: [T])
  └── 1st order effect: [B] (timing: [T])
        └── 2nd order effect: [B1] (timing: [T])
```

Do not go beyond 3rd order unless the case specifically warrants it. The further the chain extends, the higher the uncertainty. The goal is to identify the most important non-obvious effects, not to simulate the entire system into infinite regress.

## Step 5: Identify the Critical Insight

After the map, identify the single most important second-order finding — the effect that is most likely to be overlooked and most consequential.

```
핵심 2차 효과 / Critical Second-Order Effect:
[What it is]
When it hits: [Time horizon]
Why it matters: [What it changes about the decision]
What to watch for: [The leading indicator that would signal this effect is materializing]
```

## Common Patterns of Second-Order Blindness

**The Cobra Effect:** Solutions that make the original problem worse. Named after a historical policy in British India that paid a bounty for dead cobras — which led people to farm cobras for the bounty, increasing the cobra population when the program was cancelled and farmed cobras were released.

**Crowding out:** Spending resources on the visible problem prevents spending on the less visible but higher-leverage intervention. Healthcare spending on acute care crowds out preventive care; engineering time on features crowds out infrastructure.

**Adaptation and gaming:** Any metric used for evaluation becomes gamed. Any incentive structure is optimized around. The second-order effect of measurement is that behavior shifts toward the measure and away from the underlying goal.

**Timing asymmetry:** Benefits are immediate and visible; costs are deferred and diffuse. Or vice versa. Political decisions, business investment cycles, and personal choices all suffer from timing asymmetry in predictable directions.

## What This Is Not

Second-order thinking is not an argument against action. It is not a tool for manufacturing paralysis. The goal is to choose with full situational awareness — knowing what ripple effects to monitor, what timing considerations to build in, and which second-order effects require mitigation rather than just acceptance.

A decision made after second-order analysis may be the same decision — but it will be executed differently and monitored for different signals.
