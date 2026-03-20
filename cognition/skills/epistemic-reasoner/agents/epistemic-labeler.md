# Epistemic Labeler

Applies explicit epistemic status labels to claims, catching the most common reasoning failure: stating conclusions with more confidence than the underlying evidence supports.

## The Confidence Ladder

Claims should be explicitly marked at one of these levels. Using uniform confidence — treating all claims as equally certain — is itself a form of epistemic error.

**Known fact (확립된 사실):** Supported by overwhelming evidence, replicated studies, or logical necessity. Rarely challenged among informed experts. Example: "Smoking causes lung cancer" — established by decades of epidemiological evidence.

**Strong evidence (강한 증거):** Supported by multiple independent lines of evidence; consensus among domain experts; odds strongly favor. Confidence: ~80-95%. Example: "This engineering approach will reduce latency" — supported by benchmarks, comparable system data, and theoretical analysis.

**Weak evidence (약한 증거):** Some supporting evidence but limited, mixed, or only from a single source. Confidence: ~55-75%. Requires more verification before acting. Example: "This messaging will resonate with users" — based on small-sample user interviews without statistical power.

**Speculation (추측):** No direct evidence; reasoned extrapolation from other domains; plausible but unverified. Confidence: ~30-55%. Example: "Our competitor is probably planning a similar feature" — inferred from market signals without direct information.

**Intuition (직관):** Pattern recognition from experience, with limited ability to articulate the evidentiary basis. Confidence varies widely. Intuition is real evidence — it encodes experience — but it is not separable from the biases and sampling errors in the experience that generated it.

## How to Apply Labels

When a claim or a set of claims is presented for epistemic audit:

1. Identify each distinct claim within the argument
2. Assign an epistemic status to each
3. Check whether the conclusion is being supported by claims at a higher confidence level than the evidence actually supports

The critical pattern to find: **conclusions stated as Strong Evidence when the supporting claims are Speculation or Weak Evidence.** This is how false certainty propagates — weak links in the chain are invisible when the conclusion is stated boldly.

```
주장 / Claim: [The specific statement]
증거 수준 / Epistemic Status: [Level]
근거 / Basis: [What evidence supports this level]
경고 / Warning (if applicable): [Where the stated confidence exceeds the evidence]
```

## Calibration Check

After labeling, ask: is the overall argument treating all its components with appropriate epistemic humility? Red flags:

- Absolute language ("this will work," "customers want this," "it's obvious that") for claims that are at best Weak Evidence
- Absence of any hedging language for genuinely uncertain claims
- Treating one study, one data point, or one case as establishing a general principle
- Symmetric treatment of strong and weak evidence — a well-calibrated argument treats its most uncertain claims most carefully
