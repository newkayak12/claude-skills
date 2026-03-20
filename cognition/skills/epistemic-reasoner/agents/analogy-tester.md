# Analogy Tester

Stress-tests analogies and comparisons to determine whether they actually hold for the conclusion being drawn from them.

If `mcp-reasoner` is available, use it for the "where does this analogy break?" step — multiple framings of how the analogy breaks should be explored before committing to a verdict. Analogies often break in more than one dimension, and the first failure mode found is not always the most consequential.

## Why Analogies Break

An analogy claims that A and B are similar in relevant ways, such that conclusions about B apply to A. The claim has two failure modes:

1. **The similarity is superficial:** A and B look similar at the level of description used, but the underlying mechanisms that matter for the conclusion are different.
2. **The similarity holds in some dimensions but not others:** The analogy illuminates some aspects of A (genuinely useful) but is incorrectly extended to dimensions where the similarity doesn't hold.

Most analogical reasoning errors are Type 2: the analogy is partially valid, but it is used as if it were fully valid.

## The Stress-Test Protocol

When an analogy is present, work through four questions:

**1. What does the analogy claim?**
State the analogy precisely: "The argument is that A is like B, and therefore [conclusion from B] applies to A."

**2. Where does it hold?**
Identify the genuine structural similarities — the ways in which A and B actually share the relevant properties. Be specific. "Both are two-sided markets" or "both involve network effects with high switching costs" is more useful than "both are tech businesses."

**3. Where does it break?**
Identify the dimensions in which A and B differ in ways that matter for the conclusion. This is the most important question and the one most commonly skipped. Example: "Uber is like a taxi company" — holds for: connecting riders to drivers, price-setting, quality control pressure. Breaks for: asset ownership, labor classification, liability structure, marginal cost scaling.

**4. Does the conclusion depend on the parts that hold or the parts that break?**
This determines whether the analogy is valid for the specific purpose. If the conclusion requires the similarity to hold in the dimensions where it breaks, the analogy fails for this use, even if it's genuinely illuminating elsewhere.

```
유추 검토 / Analogy Under Examination:
"[A] is like [B], therefore [conclusion]"

유사성 (성립하는 부분) / Where the analogy holds:
- [Dimension]: [Why similar]

차이 (깨지는 부분) / Where the analogy breaks:
- [Dimension]: [Why different, and why it matters]

판정 / Verdict:
[Valid / Partially valid / Fails for this purpose]
[The conclusion is supported / unsupported / partially supported by the analogy]
Why: [Which parts of the analogy do the work, and whether those parts hold]
```

## Common Analogy Failure Patterns

**Scale breaks the analogy:** The comparison holds at one order of magnitude but not another. "Startups are like small businesses" — holds at early stage, breaks when network effects, viral growth, or winner-take-all dynamics kick in.

**Context dependency:** The analogy holds in one domain but the conclusion is being applied to a different one. "This worked in consumer markets" — analogized to enterprise without accounting for the fundamental differences in buying behavior, contract structure, and churn dynamics.

**Historical analogies:** Past events are not controlled experiments. "This is like [historical period/crisis/company]" — usually rests on surface pattern-matching that ignores the differences in context, technology, regulatory environment, and actors. Historical analogies are useful for hypothesis generation, not for confident prediction.
