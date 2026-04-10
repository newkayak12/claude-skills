---
name: fallacy-detector
description: >-
  Use when someone presents a chain of reasoning or a story explaining why
  something happened, and the logic may have a structural flaw or the narrative
  may be too tidy. Covers logical fallacies (false dichotomy, post hoc, straw
  man) and narrative...

scenarios:
  - "Check my reasoning for logical holes"
  - "This explanation feels too neat — is it a narrative fallacy?"
  - "They said 'if we do X then Y will happen' — is that valid?"
  - "이 논리에 오류가 있는지 봐줘"
  - "이 설명이 너무 깔끔한 것 같아, 확인해줘"
  - "이 주장의 구조가 맞는지 분석해줘"

compatibility:
  recommended:
    - think-tool
  optional:
    - sequential-thinking
  remote_mcp_note: >-
    think-tool이 있으면 논리적 오류와 서사 오류를 체계적으로 스캔하고
    핵심 문제를 정밀하게 짚어낼 수 있습니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
---

# Fallacy Detector

## When to Use / When Not to Use

**Use when:**
- An argument has a conclusion that needs testing before you act on it
- Someone is explaining why something happened and the story sounds too clean
- A debate or persuasion attempt needs structural analysis

**Not for:**
- Diagnosing *why* someone reasons poorly (use bias-auditor)
- Calibrating confidence levels (use epistemic-reasoner)

## Process

**Step 1 — State the argument or story.** Confirm the core claim being analyzed.

**Step 2 — Scan for logical fallacies.** Flag only what's actually present.

| Category | Fallacies |
|----------|-----------|
| Structural | False dichotomy, slippery slope, circular reasoning, straw man |
| Authority/Social | Ad hominem, appeal to authority, bandwagon |
| Causation | Post hoc ergo propter hoc, cum hoc, hasty generalization |

**Step 3 — Scan for narrative fallacy.** Separate scan — check for:
- Hindsight coherence: outcome sounds inevitable in retrospect
- Single-cause attribution: complex event explained by one clean cause
- Character-driven causation: traits driving outcome, ignoring systemic/situational forces
- Omission of counterfactual: similar cases with different outcomes ignored
- Emotional arc: events map too cleanly onto a satisfying story shape

**Step 4 — Deliver the analysis.** If no fallacies are present, say so.

## Output Template

```
논리적 오류 / Logical Fallacies Detected:

[Fallacy name]: [Where it appears in the argument, specifically]
Why this matters: [What it invalidates or weakens in the conclusion]

서사 오류 / Narrative Fallacy Assessment:
[Present or absent. If present: which element of the story appears constructed rather than accurate]

핵심 문제 / Core Issue:
[The single most damaging error — the one that most undermines the argument's validity]
```

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Scans systematically across fallacy categories | Provide the argument or explanatory story |
| Names only fallacies that are actually present | Confirm whether the identified pattern applies |
| Explains *why* each fallacy undermines the conclusion | Decide whether to revise, discard, or defend the argument |
| Runs a separate narrative fallacy scan on explanatory stories | Update your reasoning based on the structural findings |

**Key constraint:** Naming a fallacy without explaining which step is unjustified and why is taxonomy, not analysis.

## Related Skills

- `bias-auditor` — for cognitive biases rather than argument structure
- `epistemic-reasoner` — for calibrating confidence to evidence
- `assumption-extractor` — for surfacing hidden premises beneath arguments
