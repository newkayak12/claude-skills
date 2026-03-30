---
name: motivation-explorer
description: >-
  Use when someone has lost motivation, is doing something but doesn't know why, or suspects
  their stated reason isn't the real one. Also triggers when someone knows what they want but
  can't seem to pursue it — ambivalence almost always has a motivation structure underneath.
  Triggers on: "동기 부여", "motivation", "왜 하는지 모르겠어", "하기 싫은데 해야 해",
  "진짜 이유가 뭔지", "의욕이 없어", "알면서도 못 하겠어", "왜 안 되는 건지".
  Best for: diagnosing hollow achievement, blocked goals, ambivalence mapping.
  Not for: general productivity or habit formation without an underlying motivation question.

scenarios:
  - "I achieved what I wanted but it feels hollow — why?"
  - "I know I want to do this but I can't seem to start"
  - "What's my real motivation behind this goal?"
  - "왜 하는지 모르면서 계속 하고 있어"
  - "원하는 게 있는데 왜 행동이 안 되는 건지 모르겠어"
  - "진짜 동기가 뭔지 파악하고 싶어"

compatibility:
  optional:
    - think-tool
  remote_mcp_note: >-
    think-tool이 있으면 동기 레이어를 더 정밀하게 탐구하고
    표면 동기와 핵심 동기의 차이를 명확하게 구분할 수 있습니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
---

# Motivation Explorer

## When to Use / When Not to Use

**Use when:**
- Achievement feels hollow or meaningless despite external success
- A goal is genuinely wanted but pursuit is blocked
- "I should want this" is doing a lot of work in the person's reasoning

**Not for:**
- General productivity hacks without a motivation question
- Motivation that is clearly external and the person is fine with that

## Process

### Part 1 — Intrinsic/Extrinsic Location

| Type | Signal | Sustainability |
|------|--------|---------------|
| External regulation | For reward or to avoid punishment | Depletes over time |
| Introjected | To avoid guilt/shame or protect self-esteem | Effort with chronic anxiety |
| Identified | Agree it's important, even if not always pleasant | More stable |
| Integrated | Part of who I am | Stable and energizing |
| Intrinsic | The activity itself is rewarding | Self-sustaining |

**Diagnostic questions:**
1. If no external reward or consequence — would you still do this? Why?
2. When you imagine achieving this, what's the primary feeling? (Relief/safety = likely introjected; joy in process = likely intrinsic; validation = likely external)
3. More energized or depleted when working on this, with no deadline?

**SDT Needs Assessment** (which need is nourished vs starved?):

| Need | Nourishing | Starving |
|------|-----------|---------|
| Autonomy | "I chose this" | "I have to" |
| Competence | Growth and mastery | Chronic overwhelm or boredom |
| Relatedness | Connects to people/purpose | Isolated, disconnected |

A goal that starves all three will not be sustained by willpower.

### Part 2 — Motivation Layer Peeling

Take the stated motivation and ask "why does that matter?" or "what would that give me?" 3–5 times.

**Example:**
- L1: "I want to be successful"
- L2: "Success means financial security"
- L3: "Financial insecurity is terrifying"
- L4: "As a kid, money stress meant adults were unavailable and angry"
- Root: "I want to feel safe and not be a burden"

**Common root motivations:** Worthiness, Belonging, Safety, Autonomy, Meaning/Purpose, Recognition.
Full taxonomy: see `../references/root-motivations-and-fears.md`

### Ambivalence Mapping (when stuck)

| Change talk | Sustain talk |
|-------------|-------------|
| What would be good about doing this? | What's working about staying? |
| What are you gaining? | What would you lose? |
| What is it costing you not to? | What's scary about changing? |

Both are real. The goal is to see whether the cost of staying exceeds the cost of changing — and what the sustain talk is actually protecting.

## Output Template

```
Motivation Analysis
-------------------
Stated motivation: [what they say they want / why they say they're doing it]
Intrinsic/extrinsic read: [where on spectrum, with reasoning]
SDT needs: Autonomy [nourished/starved], Competence [nourished/starved], Relatedness [nourished/starved]

Motivation layers:
  Surface: [stated reason]
  Layer 2: [what that gives]
  Layer 3: [what that protects]
  Root: [underlying driver — named plainly]

Ambivalence (if relevant):
  Change talk: [reasons to pursue]
  Sustain talk: [reasons to stay]
  Real blocker: [what sustain talk is protecting]

Insight: [single most important thing this analysis reveals]
Practical implication: [what this means for how to approach the goal]
```

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Locates motivation on the intrinsic/extrinsic spectrum | Reflect honestly on the diagnostic questions |
| Peels through layers to find the root driver | Sit with whether the root resonates — don't rush past it |
| Maps the SDT need that is being starved | Notice which need is most depleted |
| Names the ambivalence clearly, without resolving it | Decide what the sustain talk is actually protecting |

## Related Skills

- `values-explorer` — when the root driver is a values question
- `fear-inventory` — when the sustain talk is driven by fear
- `identity-explorer` — when motivation is tied to who you are or want to be
