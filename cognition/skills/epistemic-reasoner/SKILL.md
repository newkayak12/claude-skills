---
name: epistemic-reasoner
description: 'Use when someone states something with more certainty than the evidence supports, or when an analogy is doing the main argumentative work. Two instruments: labeling what confidence level the evidence actually warrants (calibration), and stress-testing whether the comparison holds where it matters. Distinct from bias-auditor, which asks why you''re overconfident — this asks how confident you''re entitled to be.'
---

# Epistemic Reasoner

Two distinct but related errors undermine good reasoning: being more certain than the evidence warrants, and relying on analogies that don't actually hold. This skill addresses both.

## Agent Selection

**If the user is asking about confidence or certainty in claims** — how sure they should be, whether their evidence supports their conclusion, or whether absolute language is warranted — use `epistemic-labeler`.

**If the user is evaluating an analogy or comparison** — whether "X is like Y" actually holds, where the comparison illuminates and where it breaks, or whether a conclusion depends on the broken part — use `analogy-tester`.

**If both apply** — the claims driving a conclusion need calibration AND an analogy is doing argumentative work — run both. Start with `epistemic-labeler` to audit the evidence base, then run `analogy-tester` on any analogies found within it.

## Why Both Matter

The most effective epistemic audit combines both layers: first label the confidence level of the claims driving the conclusion, then stress-test any analogies being used to support those claims. The combination reveals both the confidence level of the reasoning and whether the structural supports of that reasoning actually hold.

A claim can be well-evidenced but resting on a broken analogy. An analogy can be sound but being used to support a conclusion stated with far more certainty than the analogy warrants. Both matter.

## Background

Philip Tetlock's research on forecasting accuracy — documented in *Superforecasting* — shows that the most accurate forecasters are distinguished not by special information, but by rigorous calibration: they know how sure they are, and their confidence levels are systematically accurate. Overconfidence is not a personal failing; it is a default cognitive setting. Calibration is the deliberate correction.

Analogies are powerful because they transfer knowledge across domains. They are dangerous for exactly the same reason: they transfer wrong knowledge if the mapping is imperfect. The error is almost always partial validity used as if it were full validity.
