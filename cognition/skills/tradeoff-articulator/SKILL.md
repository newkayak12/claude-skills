---
name: tradeoff-articulator
description: >-
  Use when someone is weighing options or making a decision where something is being given up.
  Makes the cost structure of each option explicit — including hidden axes — without picking a winner.
  Triggers on: "tradeoff", "트레이드오프", "장단점", "pros and cons", "무엇을 포기해야",
  "이 선택의 비용", "득실", "균형점". Also triggers when someone frames a decision as "obviously better."
  Best for: architectural decisions, career choices, product tradeoffs where costs are invisible.
  Not for: choosing between options (use decision-maker) — this skill clarifies what you're choosing between.

scenarios:
  - "Map out the tradeoffs between these two approaches"
  - "What am I actually giving up if I choose this?"
  - "This option looks obviously better — what am I missing?"
  - "이 두 선택지의 트레이드오프를 정리해줘"
  - "이걸 선택하면 뭘 포기하는 건지 명확하게 해줘"
  - "한 가지가 분명히 더 좋아 보이는데, 숨겨진 비용이 있을 것 같아"

compatibility:
  recommended:
    - think-tool
  optional:
    - sequential-thinking
  remote_mcp_note: >-
    think-tool이 있으면 사용자가 명시하지 않은 숨겨진 트레이드오프 축을 찾아내고
    'free win' 프레이밍을 검증할 수 있습니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
---

# Tradeoff Articulator

## When to Use / When Not to Use

**Use when:**
- A decision involves giving up something real, even if it's not obvious yet
- Someone frames an option as "obviously better" (that framing hides tradeoffs)
- The costs of each option need to be visible before deciding

**Not for:**
- Making the actual choice (use decision-maker)
- Consequence chains after a decision (use second-order-thinker)

## Process

**Step 1 — Find the true axes.**

**MCP note:** If `think-tool` is available, use it before accepting the user's framing of the axes. What axes are assumed? Are there hidden ones?

Most people name only the obvious axis. Probe for:
- **Reversibility:** can you undo this? What does undoing cost?
- **Optionality:** does this keep future paths open?
- **Cognitive load:** which is easier to maintain or explain?
- **Risk profile:** variance, not just expected value
- **Who pays:** cost shifted to users, teammates, future-you, downstream systems

**Step 2 — Build the tradeoff matrix.** Qualitative description first — no false-precision scores.

```
Option        | Speed | Cost | Reversibility | Cognitive Load | Risk
Option A      |  +++  |  --  |     high      |      low       | low variance
Option B      |   +   |  +   |     low       |      high      | high upside
```

**Step 3 — Name opportunity costs.** For the leading option: "Choosing X means giving up Y." Make it concrete, not vague ("giving up some flexibility" → "giving up the ability to switch databases without a full rewrite, ~3–6 weeks in year 2").

**Step 4 — Surface multi-criteria conflicts.** Find axis pairs that pull in opposite directions. Name the conflict — do not resolve it.

**Step 5 — Check for hidden costs:**
- Short-term vs long-term: does cheaper now create debt?
- Local vs systemic: does locally optimal create coordination costs elsewhere?
- Explicit vs implicit: is any cost being absorbed silently?

## Output Template

1. **Axes identified** — including hidden ones surfaced
2. **Tradeoff matrix** — qualitative, not scored
3. **Opportunity costs** — explicit "choosing X gives up Y" statements
4. **The real conflict** — the axis pair where tension is unavoidable
5. **Hidden costs** — what's invisible in the original framing
6. Optional: "To decide, you need to answer: [the key question]"

**Do NOT add a recommendation unless explicitly asked.**

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Finds hidden axes beyond what was named | Provide the options and stated tradeoffs |
| Names opportunity costs in concrete terms | Confirm whether the hidden axes are real in your context |
| Identifies where cost is being shifted rather than eliminated | Decide which axis matters most for your situation |
| Surfaces the unavoidable tension between conflicting axes | Make the choice with full cost visibility |

## Related Skills

- `decision-maker` — for structured frameworks when you're ready to choose
- `second-order-thinker` — for downstream consequences of each option
- `assumption-extractor` — for surfacing premises that predetermine which tradeoffs appear
