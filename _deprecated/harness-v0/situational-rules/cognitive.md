# Situational — Cognitive Discipline

**Trigger**: decision paralysis / strong pull toward one option / just before a big bet or irreversible decision

The most common trap for a solo developer is *confirmation bias* and *sunk cost*. Without externalizing self-validation, the same traps repeat.

## C-01: Bias check before strong commit

- **Why**: When one option looks *too attractive*, you are usually *missing something*. Confirmation bias cannot be caught by self-awareness alone.
- **How**:
  - When 80%+ confident in one option, invoke `cognition:bias-auditor`
  - Ask: "If the *opposite* of this decision were correct, what evidence would I expect to see?"
  - The strong pull itself is the *alarm*

## C-02: Pre-mortem before big bet

- **Why**: Imagining failure *before the fact* costs 100× less than regret after. Gary Klein's research.
- **How**:
  - Just before the decision, assume *it failed 6 months from now*
  - Write 5 reasons it failed (freely)
  - For the 1-2 most likely reasons, prepare mitigation in advance

## C-03: Steelman the opposing view

- **Why**: Reconstructing opposition as a strawman only reinforces your own confidence. Real validation means reconstructing the *strongest possible version* of the opposing view.
- **How**:
  - Write the *strongest version* of the opposing position — stronger in tone than your own
  - Check whether its weaknesses are *genuine* weaknesses vs *weaknesses you manufactured*
  - If you still hold your position, *that is the decision*

## C-04: Devil's Advocate on irreversible decisions

- **Why**: One-way-door decisions are very costly to reverse. *Counter-pressure* must exist beforehand.
- **How**:
  - For decisions with reversibility rating *high* (stack, architecture, data model, contracts), invoke `think:devils-advocate`
  - Separate roles: decision advocate (you) vs critic (skill)
  - Include *replies to counterarguments* in the decision ADR

## C-05: Assumption surfacing — assumptions *in writing*

- **Why**: Assumptions live in the *unconscious*. Unwritten, they masquerade as facts.
- **How**:
  - Before major decisions, invoke `cognition:assumption-extractor` or write them manually
  - Format: "We are assuming [assumption] is true. If false, [this consequence]."
  - Mark each assumption's *confidence* (low/medium/high) and *verification method*

## C-06: Sunk cost — *past investment* does not affect the decision

- **Why**: Time and money already spent *cannot be recovered*. Only the future should be a variable in the decision.
- **How**:
  - At each gate, calculate only *future cost and value* (ignore the past)
  - When sunk cost creates pressure, consciously re-evaluate the *pivot option*
  - "We've come this far" is the alarm

## C-07: Strawman vs Steelman — know the difference

- **Why**: Using a strawman in debate most deceives yourself. Especially dangerous for a solo developer who is arguing both sides.
- **How**:
  - After reconstructing the opposing view, ask: *would a person who actually holds that view agree with your reconstruction?*
  - If not — it's a strawman. Rewrite.

## C-08: First-principles thinking — from *analogy* to *principle*

- **Why**: "Others do X so we do X" is *analogy*. Fast, but ignores *contextual differences*.
- **How**:
  - Decompose the decision to its *first principles* (why is this needed → why this approach → why not another)
  - Invoke `think:first-principles` or apply 5 Whys
  - An answer at the principle level is sturdier than an analogy-based decision

## C-09: *Reversibility* rating for decisions

- **Why**: The cost of reversal differs per decision. Treating all decisions with the same depth makes fast decisions heavy and heavy decisions light.
- **How**:
  - At decision start, assign a rating:
    - **Two-way door** (low reversal cost): move fast, experimentation OK
    - **One-way door** (high): ADR + pre-mortem + devil's advocate
  - Record the rating itself in the ADR metadata

## C-10: Decision paralysis — "more data" may not be the answer

- **Why**: A pattern of delaying decisions even when information is *sufficient*. Fear of the decision itself masquerades as *insufficient data*.
- **How**:
  - Ask: "If I get additional data, *which answer changes and how*?"
  - If nothing changes — *decide now*
  - Apply a time-box — state a decision deadline explicitly (`R-SC03` appetite)

## C-11: Outside view — base rate of *similar attempts*

- **Why**: Inside view ("we are different") almost always overestimates. Outside view (statistical outcomes of similar attempts) is more accurate.
- **How**:
  - How often have similar attempts *succeeded or failed*? Write it with sources.
  - State the *specific reason* we will beat that base rate.
  - Without a concrete reason, following the base rate is rational.

## Related skills

- `think:decision-maker` — option comparison and selection
- `think:devils-advocate` — counter-pressure on decisions
- `think:problem-reframer` — reexamine the problem definition itself
- `cognition:bias-auditor` — bias check
- `cognition:assumption-extractor` — surface assumptions
- `cognition:second-order-thinker` — second- and third-order consequence thinking
- `cognition:tradeoff-articulator` — clarify trade-offs
- `think:first-principles` — principle decomposition
