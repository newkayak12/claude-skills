---
name: bias-auditor
description: >-
  Use when someone is evaluating a person, explaining behavior, or making a decision with
  expressed high confidence — auditing three layers: how information is judged (confirmation bias,
  anchoring, sunk cost), how behavior is explained (attribution errors), and how well someone
  knows what they know (overconfidence, Dunning-Kruger).
  Triggers on: "am I being biased", "why did they do that", "I'm sure about this", "편향 점검",
  "확증 편향", "왜 이렇게 생각하는 걸까", "내 판단이 맞나".
  Best for: high-stakes decisions, evaluating people, diagnosing why a conclusion feels certain.
  Not for: logical fallacy detection (use fallacy-detector), evidence calibration (use epistemic-reasoner).

scenarios:
  - "Am I being biased in how I see this situation?"
  - "Why do I keep jumping to this conclusion?"
  - "Audit my reasoning for blind spots"
  - "내 판단에 편향이 있는지 봐줘"
  - "왜 나는 이 사람을 이렇게 평가하게 됐을까?"
  - "내가 너무 확신하는 것 같아, 점검해줘"

compatibility:
  recommended:
    - think-tool
  optional:
    - sequential-thinking
  remote_mcp_note: >-
    think-tool이 있으면 세 가지 편향 레이어(판단·귀인·메타인지)를 순서대로 스캔하고
    핵심 편향을 정밀하게 식별할 수 있습니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.

---

# Bias Auditor

## When to Use / When Not to Use

**Use when:**
- Someone is evaluating a person and the framing feels dispositional rather than situational
- A decision is being made with high expressed confidence
- Explaining why something happened and a single clean narrative is dominating

**Not for:**
- Structural errors in reasoning (use fallacy-detector)
- Calibrating confidence to evidence (use epistemic-reasoner)

## Process

**Step 1 — Gather the judgment.** Get the specific decision, belief, or evaluation as concretely as possible.

**Step 2 — Scan Layer 1: Judgment biases.**

| Bias | Signal |
|------|--------|
| Confirmation bias | Sought confirming info, avoided disconfirming |
| Availability heuristic | Recent/vivid events overweighted |
| Anchoring | First piece of info dominating subsequent estimates |
| Sunk cost | Past investment justifying continued action |
| Optimism/planning fallacy | Timelines or outcomes overestimated |
| Framing effect | Conclusion changes with presentation format |

**Step 3 — Scan Layer 2: Attribution errors.**
- Fundamental attribution error: blaming character vs. situation
- Self-serving attribution: success = skill, failure = circumstances
- Actor-observer asymmetry: lenient on self, strict on others

**Step 4 — Scan Layer 3: Metacognitive accuracy.**
- Overconfidence / Dunning-Kruger pattern
- Underconfidence / imposter pattern
- Illusion of explanatory depth

**Step 5 — Deliver the audit.** Flag only what's actually present.

## Output Template

```
편향 감사 결과 / Bias Audit Results:

판단 편향 / Judgment Biases:
[Bias name]: [Specific manifestation in this case]
Impact: [What this likely distorts in the conclusion]

귀인 오류 / Attribution Errors:
[Error type]: [Where it appears]
Alternative explanation: [Situational factors the current explanation ignores]

메타인지 정확도 / Metacognitive Accuracy:
Confidence level: [calibrated / overconfident / underconfident]
[Specific evidence for this assessment]

핵심 편향 / Primary Bias:
[The single most consequential bias — the one most likely driving a wrong conclusion]
```

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Scans all three bias layers systematically | Describe the decision or judgment concretely |
| Names only biases that are actually present | Confirm whether the named pattern resonates |
| Connects each bias to a concrete implication | Decide what to check or do differently before acting |
| Identifies the single most consequential bias | Apply the corrective to the actual decision |

## Related Skills

- `fallacy-detector` — when the issue is argument structure, not cognitive bias
- `epistemic-reasoner` — when the issue is calibrating confidence to evidence
- `assumption-extractor` — when the issue is hidden premises rather than cognitive distortion
