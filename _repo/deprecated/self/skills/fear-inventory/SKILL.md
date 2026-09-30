---
name: fear-inventory
description: >-
  Use when the user is blocked by fear, avoiding something important,
  catastrophizing, or wants to understand what's really holding them back.
  Suitable when someone has insight about what they want but stays stuck — this
  almost always has a fear...

scenarios:
  - "I know I want this but I keep finding reasons not to start"
  - "What's actually holding me back?"
  - "I'm catastrophizing — help me work through this fear properly"
  - "시작하는 게 두려워서 계속 미루고 있어"
  - "실패가 두려워서 아무것도 못 하고 있어"
  - "내가 진짜 무서워하는 게 뭔지 파악하고 싶어"

compatibility:
  optional:
    - think-tool
    - sequential-thinking
  remote_mcp_note: >-
    sequential-thinking이 있으면 fear-setting 단계를 순서대로 진행하여
    행동 계획으로 빠르게 점프하는 것을 방지할 수 있습니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
---

# Fear Inventory

## When to Use / When Not to Use

**Use when:**
- Someone knows what they want but can't pursue it
- Avoidance is persistent around something that matters
- Catastrophizing is distorting probability

**Not for:**
- Anxiety disorders or clinical phobias — recognize the limit and refer when distress is severe
- General stress without a specific fear structure

## Process

**MCP note:** If `sequential-thinking` is available, use it — the protocol collapses when users skip to "what can I do" before fully mapping the fear.

### The Fear Map: Surface → Core

Work from surface to core — don't stop at the first named fear.

| Layer | What to find |
|-------|-------------|
| Surface fear | What the person says they're afraid of |
| Underlying fear | What would be true if the surface fear came to pass |
| Core fear | The fundamental driver — usually one of a small set |

**Core fear taxonomy:**

| Core fear | Description |
|-----------|-------------|
| Inadequacy | I am not enough — not smart, capable, or worthy enough |
| Rejection/Abandonment | I will be cast out or left alone |
| Loss of control | Things will spin out and I'll be helpless |
| Meaninglessness | My effort and life won't matter |
| Death/Nonexistence | I or those I love will cease to exist |
| Entrapment | I will be stuck and unable to escape |
| Humiliation | I will be exposed and publicly shamed |

For the full taxonomy: see `../references/root-motivations-and-fears.md`

### Protective vs Limiting

Before analyzing: is this fear protecting something real?
- **Protective:** realistic probability, proportionate risk, produces prudent caution
- **Limiting:** distorted probability, disproportionate, produces paralysis around something genuinely wanted

### Fear-Setting Protocol (Tim Ferriss / Stoic-derived)

1. **Define the fear precisely.** Not "something bad will happen" — name it completely.
2. **Assess realistic probability.** Not worst case — what actually tends to happen in situations like this?
3. **Assess impact and reversibility.** How bad would it actually be? Would you recover? In what timeframe?
4. **Assess the cost of inaction.** What specifically don't you get to have, do, or become? At 1 year? 3 years? 10?
5. **Design the fear experiment.** Smallest action that tests this fear's accuracy, with low enough stakes to actually do it.

### Existential Layer

Some fears don't respond to probability assessment — they touch irreducible conditions of existence (Yalom):
- **Death fear:** literal mortality, legacy, being forgotten
- **Freedom fear:** terror of real choice and responsibility for your own life
- **Isolation fear:** the unbridgeable aloneness that no relationship fully resolves
- **Meaninglessness fear:** nothing adds up to something worth having

When these are present, name them directly. Wisdom and meaning-making are more useful here than probability analysis.

## Output Template

```
Fear Inventory
--------------
Surface fear: [what was named]
Underlying fear: [what would be true if surface fear came to pass]
Core fear: [the fundamental driver]
Protective or limiting: [assessment with reasoning]

Fear-setting:
  Realistic probability: [low / medium / high — with reasoning]
  Worst case (realistic): [concrete and specific]
  Survivability: [can you recover? how? in what timeframe?]
  Cost of inaction: [what staying stuck costs, concretely]
  Fear experiment: [smallest test of this fear's accuracy]

Existential layer (if present): [which of Yalom's four, and how it manifests]

Key insight: [single most important thing this analysis reveals]
Next action: [concrete, specific, small]
```

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Peels from surface fear to core fear | Name the fear as specifically as possible |
| Distinguishes protective from limiting fears | Confirm whether the core fear resonates |
| Runs fear-setting analysis with honest probability assessment | Face the cost-of-inaction question honestly |
| Designs the smallest experiment | Commit to the experiment — the actual exposure |

## Related Skills

- `examined-life` — when fear is part of a broader life direction question
- `identity-explorer` — when the fear is about identity threat ("if I do this, who am I?")
- `motivation-explorer` — when blocked motivation has a fear structure underneath
