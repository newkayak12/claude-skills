---
name: assumption-extractor
description: 'Use when someone presents a plan or argument with confidence and its hidden dependencies have not been examined — surfacing what is being taken for granted: factual, causal, value, and definitional assumptions, then ranking which ones would collapse everything if wrong. Distinct from fallacy-detector (reasoning structure) and bias-auditor (why you are misjudging).'
---

# Assumption Extractor

Every argument rests on ground it doesn't examine. Every plan depends on conditions it doesn't name. Every belief carries invisible premises that do most of the work. This skill excavates those premises — and then distinguishes the ones that, if wrong, destroy everything from the ones that are merely peripheral.

The goal is not to destabilize thinking. It is to make the architecture of an argument visible so it can be intentionally tested rather than accidentally shattered.

## Why Assumption Extraction Matters

Assumptions fail in two ways. The first is that they are simply false — the world doesn't work the way the argument requires. The second is subtler: the assumption was true in the original context but doesn't hold in the new context where the reasoning is being applied. Borrowed logic breaks when the underlying conditions differ.

Most arguments look solid until their assumptions are made explicit. Then the question becomes: how confident are we in each of these? If the answer is "I hadn't thought about that" — the work hasn't been done yet.

## Step 1: Get the Argument, Plan, or Belief

Ask the user to state the thing being examined as clearly as possible. A specific, concrete statement is much easier to excavate than a vague gesture at a topic.

If the content is already present in context, state back the core claim before proceeding: "The argument/plan/belief I'm examining is: [X]." Confirm this is right before digging.

## Step 2: Excavate Assumptions by Category

**MCP instruction:** If `sequential-thinking` is available, use it — the four assumption categories (factual, causal, value, definitional) must all be scanned before classifying load-bearing vs peripheral. Stopping after finding one load-bearing assumption misses others.

Scan all four categories in parallel (or in sequence if parallel isn't available):
- **Factual:** what facts are assumed true?
- **Causal:** what cause-effect chains are assumed?
- **Value:** what is assumed to matter?
- **Definitional:** what terms are assumed to share meaning?

Only after completing all four scans: classify and identify the single most dangerous unverified assumption.

Assumptions cluster into four types. Working through each category ensures systematic coverage.

### Factual Assumptions

These are beliefs about how the world currently is. They are stated or implied as facts without being established.

Questions to excavate them: What does this argument require to be true about the world? What data or conditions does it assume exist? What does it assume is not the case?

Examples:
- "We should expand into the EU market" assumes: the EU market is currently underserved, our product meets EU regulatory requirements, our team has the capacity to operate in a new market.
- "I should learn X skill to get promoted" assumes: X skill is actually what decision-makers value for promotion, the person is promotable given other factors, and learning X won't crowd out more important development.

### Causal Assumptions

These are beliefs about what causes what — the "therefore" at the heart of every argument.

Questions to excavate them: What causal mechanisms does this argument rely on? What must be true for A to actually lead to B? Is the causal direction assumed rather than established?

Examples:
- "Better onboarding will reduce churn" assumes: churn is caused primarily by poor onboarding rather than product-market fit, pricing, or competition.
- "More meetings will improve alignment" assumes: misalignment is caused by insufficient communication rather than incentive structures or unclear ownership.

Causal assumptions are often the most consequential and the least examined. Most arguments are, at their core, causal claims dressed up as logic.

### Value Assumptions

These are beliefs about what matters, what is worth pursuing, and what trade-offs are acceptable. They are often the most invisible because they feel like common sense to the person holding them.

Questions to excavate them: What does this argument treat as important? What trade-off does it implicitly endorse? What would someone need to value differently to reject this conclusion?

Examples:
- "We should prioritize speed to market" assumes: speed creates a competitive advantage that outweighs the costs of technical debt and quality sacrifices.
- "Work-life balance should be protected even at the cost of slower growth" assumes: the costs of imbalance (burnout, attrition) outweigh the benefits of the faster growth rate.

Value assumptions cannot be proven right or wrong — they can only be made explicit so people can agree or disagree with them consciously rather than accidentally.

### Definitional Assumptions

These are beliefs about what words and concepts mean — often the source of arguments where two people are confidently disagreeing about completely different things.

Questions to excavate them: Are the key terms defined? Do both parties mean the same thing by the central concepts? Does the argument depend on a specific interpretation of a contested term?

Examples:
- "We need to be more innovative" — what counts as innovation here? Product innovation? Process innovation? Business model innovation? The word is doing enormous load-bearing work with no defined content.
- "The team isn't performing" — performing against what standard, over what timeframe, in what dimensions?

## Step 3: Classify by Load-Bearing Weight

Not all assumptions are equally important. After extracting them, classify each:

**Load-bearing (핵심 전제):** If this assumption is wrong, the argument collapses entirely. These are the structural pillars. Example: "Our entire pricing strategy assumes customers are primarily price-sensitive — if they're actually quality-sensitive, the strategy needs to be rebuilt from scratch."

**Significant (중요 전제):** If wrong, the argument needs substantial revision but the core direction may still hold. These require verification but not necessarily immediate action.

**Peripheral (주변 전제):** If wrong, some details change but the core argument survives. Lower priority to verify.

## Step 4: Flag the Most Dangerous Assumption

After classification, identify the single most dangerous assumption — the load-bearing assumption that is both most consequential and least verified. This is the one the user needs to test before committing to action.

Name it explicitly: "The assumption that does the most work here — and that I'd want verified before going further — is: [X]. If this turns out to be wrong, [consequence]."

## Step 5: Deliver the Extraction

```
가정 추출 결과 / Assumption Map:

사실적 가정 / Factual Assumptions:
- [Assumption]: [Load-bearing / Significant / Peripheral]

인과적 가정 / Causal Assumptions:
- [Assumption]: [Load-bearing / Significant / Peripheral]

가치 가정 / Value Assumptions:
- [Assumption]: [Load-bearing / Significant / Peripheral]

정의적 가정 / Definitional Assumptions:
- [Key term that needs definition]: [What the argument seems to mean by it]

핵심 위험 전제 / Most Dangerous Assumption:
[The load-bearing assumption with the lowest current verification]
If wrong: [Consequence for the argument/plan]
To verify: [What would need to be checked]
```

## What Makes This Different from Just Asking "Why?"

Asking "why?" uncovers justification. Assumption extraction uncovers the invisible ground beneath justification — the things that weren't stated as reasons because they seemed too obvious to state. The most dangerous assumptions are never the ones the person considered and accepted; they are the ones the person never considered at all.

The key discipline: when the user says "of course," "obviously," "naturally," or "everyone knows" — stop. That is where the unexamined assumption lives.
