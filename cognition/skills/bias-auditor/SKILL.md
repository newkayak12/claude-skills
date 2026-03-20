---
name: bias-auditor
description: 'Use when someone is evaluating a person, explaining why someone behaved a certain way, or making a decision with expressed high confidence. Covers three bias layers: how we judge information (confirmation bias, anchoring, sunk cost), how we explain behavior (fundamental attribution error), and how well we know what we know (Dunning-Kruger, overconfidence). Distinct from fallacy-detector (logic structure) and epistemic-reasoner (calibration to evidence).'
---

# Bias Auditor

Biases are not signs of stupidity — they are the predictable output of cognitive machinery that evolved for a different environment. The problem is that this machinery runs automatically, without announcing itself, and systematically skews judgment in specific directions. The goal of this skill is to make the invisible machinery visible.

This skill covers three layers of bias that compound each other:

1. **Judgment biases** — systematic errors in how we evaluate information and make decisions
2. **Attribution errors** — systematic errors in how we explain behavior (our own and others')
3. **Metacognitive accuracy errors** — systematic errors in how well we know what we know

## Step 1: Get the Judgment or Decision

Ask the user to describe the decision, belief, or situation as specifically as possible. The more concrete the case, the more precise the audit. Vague audits produce vague findings.

If the situation is already described in context, state back the core judgment being made before proceeding.

## Step 2: Scan for Judgment Biases

Work through systematically. Flag only patterns actually present in this specific case.

### Information Selection Biases

**Confirmation bias (확증 편향):** The tendency to seek, interpret, and remember information that confirms existing beliefs, and to discount or ignore disconfirming information. This is the most pervasive bias in complex decisions. Ask: what information would challenge this conclusion? Has the user looked for it?

**Availability heuristic (가용성 휴리스틱):** Overweighting information that comes easily to mind — typically recent, vivid, or emotionally significant events. Example: overestimating plane crash risk after seeing news coverage. The question is always: is the ease of recall actually correlated with frequency or importance?

**Anchoring (기준점 편향):** Over-relying on the first piece of information encountered. A salary negotiation anchored to an initial offer, a product anchored to its original price. The anchor shapes subsequent adjustments even when it was arbitrary.

### Evaluation Biases

**Sunk cost fallacy (매몰 비용 오류):** Continuing a course of action because of past investment (time, money, effort) rather than future expected value. The past investment is gone regardless of what you do next — the decision should be made entirely on forward-looking factors.

**Status quo bias (현상유지 편향):** Preferring the current state over change, independent of whether the current state is actually better. Loss aversion and familiarity amplify this.

**Optimism bias / Planning fallacy (낙관 편향):** Overestimating the likelihood of positive outcomes and underestimating time, costs, and obstacles in plans. This is near-universal in project planning.

**Framing effects (프레이밍 효과):** The same information presented differently produces different judgments. "90% survival rate" and "10% mortality rate" are identical — but they are processed differently. If the framing of a choice is driving the conclusion, that's a bias.

## Step 3: Scan for Attribution Errors

These are distinct from judgment biases — they specifically concern how we explain *why* people (including ourselves) behave as they do.

**Fundamental attribution error (근본적 귀인 오류):** Overattributing others' behavior to their character/personality and underattributing it to their situation or circumstances. Example: "She's always late — she's disrespectful" vs. "She's always late — her commute is brutal and her childcare situation is chaotic." We explain our own behavior situationally ("I was late because the train was delayed") but explain others' behavior dispositionally ("he's just unreliable").

**Self-serving attribution (자기 위주 편향):** Taking credit for successes (attributing them to skill/character) while attributing failures to external factors. Example: "I succeeded because I'm smart; I failed because the market timing was bad." This is partly defensive and partly motivated reasoning.

**Actor-observer asymmetry (행위자-관찰자 비대칭):** We know the full context of our own behavior but only see others' behavior from the outside. This makes us generous in interpreting our own actions and stringent in interpreting others'. We see our nuance; we see their pattern.

When attribution errors are present, name the specific misattribution: "The explanation focuses on X's personality, but what situational factors might explain the same behavior?"

## Step 4: Scan for Metacognitive Accuracy

This layer asks: how well does the user know what they know?

**Overconfidence / Dunning-Kruger pattern (과신 / 더닝-크루거):** In the classic Dunning-Kruger pattern, novices in a domain lack the metacognitive skill to recognize their incompetence — they don't know enough to know what they don't know. The result is unwarranted confidence at low skill levels, followed by a confidence dip as competence grows and the learner begins to see the full complexity of the domain, followed by calibrated confidence at high expertise. The audit question: where does the user's confidence level actually sit relative to their evident knowledge of the domain? Warning signs of overconfidence include: dismissing the need for expert input, assuming edge cases won't apply, and treating domain-specific questions as obvious.

**Underconfidence / Imposter syndrome:** The mirror pattern — persistent underestimation of one's actual competence, often in high-achievers. Relevant when the user defers excessively to others on questions within their clear expertise, or disqualifies their own judgment reflexively.

**Illusion of explanatory depth (설명 깊이의 착각):** People believe they understand how complex systems work (how a toilet flushes, how a law gets passed, how the economy works) until asked to explain it step by step. Confidence collapses upon articulation. This is relevant when a user expresses high confidence in understanding a complex mechanism they haven't actually had to explain in detail.

## Step 5: Deliver the Audit

```
편향 감사 결과 / Bias Audit Results:

판단 편향 / Judgment Biases:
[Bias name]: [Specific manifestation in this case]
Impact: [What this likely distorts in the conclusion]

귀인 오류 / Attribution Errors:
[Error type]: [Where it appears]
Alternative explanation: [What situational factors the current explanation ignores]

메타인지 정확도 / Metacognitive Accuracy:
[Confidence level appears: calibrated / overconfident / underconfident]
[Specific evidence for this assessment]

핵심 편향 / Primary Bias:
[The single most consequential bias in this case — the one most likely to be leading to a wrong conclusion]
```

## What Changes After This Audit

The audit should not just name biases — it should shift how the user is thinking about the decision. For each significant bias found, the question to leave the user with is: "Given this bias, what would you need to check or do differently before acting on this judgment?"

Naming a bias without connecting it to a concrete implication is taxonomy, not thinking. Make it practical.
