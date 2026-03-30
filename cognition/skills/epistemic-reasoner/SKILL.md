---
name: epistemic-reasoner
description: >-
  Use when someone states something with more certainty than the evidence supports, or when
  an analogy is doing the main argumentative work. Two instruments: calibrate what confidence
  level the evidence actually warrants, and stress-test whether the comparison holds where it matters.
  Triggers on: "how sure should I be", "is this analogy valid", "am I overstating this",
  "근거가 충분한가", "이 비유가 맞나", "확신의 정도", "이 비교가 적절한가".
  Best for: claims stated with absolute language, analogical arguments, forecasting confidence.
  Not for: diagnosing why someone is overconfident (use bias-auditor).

scenarios:
  - "How confident should I actually be about this claim?"
  - "Is the analogy 'X is like Y' actually valid here?"
  - "Am I overstating what this evidence supports?"
  - "이 주장을 얼마나 확신해도 될까?"
  - "이 비유가 이 맥락에서 정말 맞는 건가?"
  - "내가 근거보다 더 확신하고 있는 건 아닐까?"

compatibility:
  recommended:
    - think-tool
  optional:
    - sequential-thinking
  remote_mcp_note: >-
    think-tool이 있으면 증거 수준과 비유의 유효 범위를 정밀하게 평가하여
    적절한 확신 수준을 도출할 수 있습니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
---

# Epistemic Reasoner

## When to Use / When Not to Use

**Use when:**
- Absolute language is being used ("definitely", "obviously", "there's no question")
- An analogy is carrying the argumentative weight ("this is just like X")
- A forecast or prediction needs calibration to available evidence

**Not for:**
- Diagnosing cognitive biases (use bias-auditor)
- Extracting hidden premises (use assumption-extractor)

## Agent Selection

**Epistemic calibration** — when the issue is confidence level relative to evidence.

**Analogy testing** — when an argument rests on a comparison that may not hold.

**Both** — when evidence-based claims also rely on analogies. Run calibration first, then analogy test.

## Process

### Instrument 1 — Epistemic Calibration

Label each claim with the confidence level the evidence actually warrants:

| Label | Meaning |
|-------|---------|
| High confidence | Strong direct evidence, replicated, few alternative explanations |
| Moderate confidence | Evidence supports but alternatives exist; some key uncertainties remain |
| Low confidence | Weak or indirect evidence; significant uncertainty |
| Speculation | Plausible but no strong evidential basis |

**Steps:**
1. Identify the core claim being made
2. Ask: what evidence supports this? What would disconfirm it?
3. Has disconfirming evidence been sought?
4. Assign the calibrated label and explain the gap (if any) between stated and warranted confidence

### Instrument 2 — Analogy Testing

An analogy has a **source domain** (what's being compared to) and a **target domain** (what's being argued about).

**Test each structural mapping:**
- Which features carry over? (supporting the analogy)
- Which features break down? (limiting the analogy)
- Does the conclusion depend on the part that breaks down?

If the conclusion rests on the broken part — the analogy fails where it matters most.

## Output Template

```
인식론적 분석 / Epistemic Analysis:

주장 / Claim: [The statement being examined]

증거 평가 / Evidence Assessment:
Supporting evidence: [what exists]
Disconfirming evidence: [what was considered / not considered]
Calibrated confidence level: [high / moderate / low / speculation]
Gap from stated confidence: [overconfident by how much, and why]

비유 분석 / Analogy Analysis (if applicable):
Source domain: [X]
Target domain: [Y]
Mappings that hold: [features that transfer]
Mappings that break: [features that don't transfer]
Conclusion dependency: [does the argument rest on the broken part?]
Verdict: [analogy supports / partially supports / fails to support the conclusion]
```

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Identifies the confidence level that evidence actually warrants | Provide the claim or analogy to examine |
| Maps which features of an analogy hold and which break | Confirm whether the evidence summary is accurate |
| Flags when conclusions depend on the broken part of an analogy | Decide how to adjust stated confidence or argument |
| Names the specific gap between stated and warranted certainty | Communicate conclusions with appropriately calibrated language |

## Related Skills

- `bias-auditor` — for diagnosing *why* someone is overconfident
- `assumption-extractor` — for surfacing the hidden premises beneath confident claims
- `fallacy-detector` — for structural errors in reasoning beyond analogy
