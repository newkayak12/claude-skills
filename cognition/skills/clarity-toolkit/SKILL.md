---
name: clarity-toolkit
description: >-
  Use when someone is overwhelmed by information, stuck in vague thinking, or
  spinning in analysis without moving forward. Three modes: cut signal from
  noise, eliminate vague language, and break overthinking loops. Triggers on:
  "overwhelmed", "too

scenarios:
  - "I have too much data and can't figure out what matters"
  - "My goal is to 'be more strategic' but I don't know what that means"
  - "I've been thinking about this for two weeks and I'm going in circles"
  - "뭐가 중요한지 모르겠어, 정보가 너무 많아"
  - "목표가 너무 모호해서 뭘 해야 할지 모르겠어"
  - "계속 생각만 하고 결정을 못하고 있어"

compatibility:
  recommended:
    - think-tool
  optional:
    - sequential-thinking
  remote_mcp_note: >-
    think-tool이 있으면 세 가지 모드(신호/노이즈·모호성·과잉사고) 중 무엇이 실제 문제인지
    정확하게 진단할 수 있습니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
---

# Clarity Toolkit

## When to Use / When Not to Use

**Use when:**
- Too much information and no clear priority
- A goal or statement can't be acted on because it's too vague
- Analysis is cycling without converging

**Not for:**
- Choosing between well-defined options (use tradeoff-articulator or decision-maker)
- Identifying cognitive biases (use bias-auditor)

## Process

**Diagnose the mode first — don't apply all three to every problem.**

| Mode | Problem | Symptom |
|------|---------|---------|
| Signal/Noise | Too much input | Conflicting data, too many priorities |
| Vagueness Eliminator | Too little precision | Abstract goals, fuzzy feedback |
| Overthinking Detector | Too much processing | Cycling analysis, seeking "one more" data point |

---

### Mode 1 — Signal/Noise Separator

Run every piece of information through:
1. **Actionability:** Does knowing this change a decision in the next 30 days?
2. **Source quality:** Primary data or someone's interpretation?
3. **Recency:** Still accurate?
4. **Relevance:** Directly bears on the goal?

**Signal Stack:**
```
MUST KNOW (changes the decision)
GOOD TO KNOW (context only)
INTERESTING BUT NOISE (log and ignore)
```

Forcing function for competing priorities: "If I could only act on one thing this week, what has the highest leverage?"

---

### Mode 2 — Vagueness Eliminator

Test: can two people read this and independently know whether they've succeeded? If not, it's vague.

Fix pattern: **add metric + current state + target state + timeframe + scope.**

- Vague: "Be more strategic."
- Fixed: Ask "What would I see you doing differently? Give me a concrete example from last week."

**Operationalization test:**
1. What would I observe if this were true?
2. What would I observe if false?
3. What would I measure?
4. Who is responsible, by when?

---

### Mode 3 — Overthinking Detector

**MCP note:** If `think-tool` is available, use it before diagnosing Mode 3. Confirm this is overthinking, not a genuinely complex problem.

Overthinking signatures:
- Same options considered longer than the decision warrants
- Each new information piece generates a new question
- Gut answer exists but case is being built against it
- Cost of being wrong is low but treated as high

**Circuit breakers:**
- **10/10/10 test:** How do you feel in 10 min / 10 months / 10 years? Same answer = stop analyzing.
- **Reversibility test:** Is this reversible? If yes — decide now, optimize later.
- **Minimum viable answer:** What's the smallest decision that enables one concrete action right now?

## Output Template

State which mode(s) apply and why. Then:

- **Mode 1:** Signal stack with explicit noise labeling
- **Mode 2:** Vague statement rewritten as operational statement (show the transformation)
- **Mode 3:** Name the overthinking pattern + one circuit breaker + concrete action

Always end with one concrete next step the user can take in the next hour.

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Diagnoses which clarity mode applies | Provide the information, goal, or decision |
| Runs the appropriate filtering/precision/circuit-breaker | Confirm whether the diagnosis fits |
| Rewrites vague goals into operational ones | Commit to the concrete next step |
| Names the overthinking pattern explicitly | Execute, rather than continue analyzing |

## Related Skills

- `tradeoff-articulator` — when options are defined but costs need mapping
- `decision-maker` — when it's a structured choice between alternatives
- `assumption-extractor` — when the vagueness is rooted in unexamined premises
