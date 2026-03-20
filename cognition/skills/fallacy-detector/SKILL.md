---
name: fallacy-detector
description: |
  Activate when the user presents an argument, makes a claim, or tells a story about why something happened — and especially when it sounds a little too neat. Trigger on: "논리적 오류", "fallacy", "이 주장 맞아?", "논리 검토", "오류 찾기", "논증 분석", "서사 오류", "우연을 필연으로", "reasoning error". Also trigger when the user is presenting a chain of reasoning, attributing cause to an event, or constructing a narrative about past events. Do not wait for an explicit request — if an argument contains a detectable fallacy or a suspiciously coherent story, engage.
---

# Fallacy Detector

Arguments fail in predictable patterns. Narratives deceive in a different but equally predictable pattern. This skill catches both.

The two categories are distinct but often intertwined. Logical fallacies are structural errors in reasoning — mistakes in how conclusions are derived from premises. Narrative fallacies are errors of construction — we impose story structure on events that are causally disconnected, creating the illusion of inevitability where there was only randomness. Nassim Taleb introduced this concept in *The Black Swan*: the human mind is a "meaning machine" that cannot tolerate randomness, so it retroactively converts noise into signal, chaos into plot.

Both categories produce confident-sounding, wrong conclusions.

## Step 1: Get the Argument or Story

If the user hasn't provided a specific argument, ask: "What's the reasoning or story you want me to examine?"

If the argument is already present in context, state it back briefly to confirm you're analyzing the right thing. Misidentifying the claim wastes both parties' time.

## Step 2: Scan for Logical Fallacies

Work through the major fallacy categories systematically. Not every category will apply — flag only what's actually present. Naming absent fallacies is noise.

### Structural Fallacies

**False Dichotomy (흑백논리):** The argument presents two options as exhaustive when others exist. Example: "You're either with us or against us." Reality usually has a third, fourth, fifth option.

**Slippery Slope (미끄러운 경사면):** Claims a small step inevitably leads to an extreme outcome without establishing why each link in the chain is necessary. Example: "If we allow remote work on Fridays, no one will ever come to the office again."

**Circular Reasoning (순환논리):** The conclusion is smuggled into the premise. Example: "This policy is good because good policies succeed, and this policy will succeed." The claim supports itself.

**Straw Man (허수아비 논법):** The argument attacks a distorted or weakened version of the opposing view, not the actual position. Example: Opponent says "reduce military spending" — response argues against "eliminating national defense."

### Authority and Social Fallacies

**Ad Hominem (인신공격):** The argument attacks the person making the claim rather than the claim itself. Even if the person is unreliable, their argument must be assessed on its merits. Note: distinguishing legitimate credibility challenges from ad hominem requires care.

**Appeal to Authority (권위에 호소):** Cites authority as proof in a domain where the authority is not expert, or where authority consensus doesn't actually exist. Expert opinion is evidence — it is not proof by itself.

**Bandwagon (다수에 호소):** "Everyone believes this, so it must be true." Popularity is not validity.

### Causation Fallacies

**Post Hoc Ergo Propter Hoc (선후인과 오류):** Event B followed event A, therefore A caused B. Correlation is not causation. This is the most common informal fallacy and the engine of most superstition.

**Cum Hoc (공변 오류):** Two things correlate, therefore one causes the other — without establishing direction or ruling out a common cause.

**Hasty Generalization (성급한 일반화):** A conclusion about a population drawn from an insufficient sample. "I met three rude people from that city — they're all rude there."

## Step 3: Scan for Narrative Fallacy

This is a separate and deeper scan. Ask: is the user imposing a story structure on events that may have been random or multi-caused?

Signs of narrative fallacy:

- **Hindsight coherence:** The story makes the outcome sound inevitable. ("Of course the startup failed — the founders were too inexperienced.") But was this predictable beforehand, or only after the fact?
- **Single-cause attribution:** A complex outcome is explained by one clean cause. Real events almost always have multiple contributing factors of varying weight.
- **Character-driven causation:** The story centers on a person's traits rather than systemic or situational forces. ("He succeeded because he was relentless.") This ignores the structural conditions, luck, timing, and survivor bias.
- **Omission of the counterfactual:** The story doesn't account for similar cases with different outcomes. If the same traits/actions often produce different results, the story is incomplete.
- **Emotional arc:** The narrative has a satisfying shape — fall and redemption, hubris and downfall, underdog triumph. When events map too cleanly onto a classic story arc, scrutinize the selection of which facts were included.

When narrative fallacy is present, name it directly: "This explanation sounds complete, but it may be retroactively imposing a causal story on what could have been a combination of random events and systemic factors."

## Step 4: Deliver the Analysis

Format the output clearly:

```
논리적 오류 / Logical Fallacies Detected:

[Fallacy name]: [Where it appears in the argument, specifically]
Why this matters: [What it invalidates or weakens in the conclusion]

서사 오류 / Narrative Fallacy Assessment:
[Present or absent. If present: which element of the story appears constructed rather than accurate.]

핵심 문제 / Core Issue:
[The single most damaging error — the one that most undermines the argument or story's validity]
```

If no fallacies are present, say so. Do not manufacture problems that aren't there. A clean argument is worth acknowledging.

## What This Skill Does Not Do

It does not determine whether the conclusion is correct — only whether the reasoning is valid. A fallacious argument can accidentally produce a true conclusion. A valid argument can proceed from false premises. The skill targets the structure of reasoning, not the truth of the conclusion.

It does not "balance" criticism with praise. If an argument has three serious structural flaws, name all three. Padding with positives dilutes the signal.

## Common Mistakes in Applying This Skill

**Labeling legitimate argument patterns as fallacies.** Not every appeal to authority is fallacious — established scientific consensus is real evidence. Not every emotional appeal is fallacious — emotion can be relevant evidence in ethical arguments. Precision matters.

**Stopping at the fallacy name.** Saying "that's a slippery slope" means nothing unless you explain which step in the slope is unjustified and why. The name is a category, not an analysis.

**Missing the narrative fallacy entirely.** It is subtler than logical fallacies and more pervasive. If someone is explaining why something happened — a business failure, a relationship breakdown, a historical event — the narrative fallacy should almost always be part of the scan.
