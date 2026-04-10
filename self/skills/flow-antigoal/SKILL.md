---
name: flow-antigoal
description: >-
  Use when someone wants to design their life or work more intentionally — by
  finding what creates deep engagement (flow) or getting clearer on what to
  eliminate (anti-goals). Triggers on: "몰입", "flow", "하기 싫은 것", "anti-goal",
  "원하지 않는 것", "몰입 조건", 삶

scenarios:
  - "Design my ideal work conditions"
  - "I know what I hate — help me use that to figure out what I want"
  - "What conditions put me in flow? I want more of them"
  - "어떤 환경에서 몰입이 잘 되는지 파악하고 싶어"
  - "내가 싫어하는 것들을 정리해서 인생 방향을 잡고 싶어"
  - "이상적인 하루와 최악의 하루를 비교해서 설계해줘"

compatibility:
  optional:
    - think-tool
  remote_mcp_note: >-
    think-tool이 있으면 flow 조건과 anti-goal을 통합하여
    가장 의미 있는 설계 변화를 정확하게 식별할 수 있습니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
---

# Flow and Anti-Goal

## When to Use / When Not to Use

**Use when:**
- Designing a career move or next chapter
- Feeling chronically under-engaged or over-drained
- Positive goals are too abstract — need inversion to find clarity

**Not for:**
- Specific skill development (use strength-growth-mapper)
- Values conflicts in a specific decision (use values-explorer)

## Process

Two complementary design tools. Use one or both.

---

### Part 1 — Flow State Mapping

**Flow signature:** Complete absorption, time distortion, loss of self-consciousness, challenge matched to skill, intrinsic reward. Highly personal — map the individual's conditions, not generic ones.

**Map five dimensions:**

| Dimension | Key question |
|-----------|-------------|
| Activity type | What kinds of tasks pull you in? (analytical, creative, social, physical, precision, performance) |
| Challenge-skill balance | What difficulty level is "stretch without overwhelm"? |
| Environmental conditions | Alone/others? Noise/silence? Time of day? Space? |
| Entry conditions | What makes getting started easier? What disrupts entry? |
| Duration and recovery | How long before quality drops? What recovery is needed between sessions? |

**Anchor question:** "What are you doing when you look up and two hours have passed?"

**Flow Inventory Output:**
```
Personal Flow Map
-----------------
Flow-producing activity types: [specific with examples]
Optimal challenge zone: [description]
Environmental requirements: [space, noise, time of day]
Ideal entry conditions: [what makes it easiest to get in]
Common disruptors: [what reliably kills flow]
Estimated peak window: [time of day/week]
Current flow frequency: [how often per week does this actually happen?]
Biggest obstacle to more flow: [structural / environmental / internal]
One design change: [single change with highest impact on flow frequency]
```

---

### Part 2 — Anti-Goal Setting

Positive goals are often too abstract. Anti-goals are concrete and visceral — we often know what we *don't* want with great certainty even when the positive picture is unclear.

**The Worst Day / Worst Life Exercise:**
"Describe your worst professional day. What are you doing? Who are you with? What kind of work? Where? What does it feel like at end of day? Extrapolate to 5 or 10 years."

Extract anti-goals from this. They will be specific and emotionally charged.

**Map anti-goals across categories:**
- Work style: types of work, role types, management dynamics
- Environment: physical space, culture, team dynamics
- Identity: what you refuse to become or be seen as
- Lifestyle: pace, schedule, location, obligations
- Relationships: people or dynamics you refuse
- Values violations: compromises you will not make

**Prioritize:**
- Hard limits: genuinely damaging regardless of upsides
- Strong preferences: degrade quality of life significantly
- Mild preferences: undesirable but tolerable if other factors strong

**Anti-goals as decision filter:** Before evaluating an opportunity on merits, check: does it violate any hard-limit anti-goals? If yes — no further analysis needed.

---

### Integration

Flow conditions = what to move toward. Anti-goal conditions = what to move away from. The overlap is the design target.

```
Life Design Analysis
--------------------
Current flow frequency: [how often actually in flow?]
Top flow conditions to preserve/increase: [3 most important]
Top anti-goals to avoid: [3 hard limits, specific]

For [specific decision or path]:
  Flow analysis: does this increase or decrease flow conditions?
  Anti-goal check: does this violate any hard limits?
  Net read: [moves toward or away from target zone?]

One design experiment: [smallest change that tests whether this path works]
```

## Output Template

**Flow Map:**
```
Personal Flow Map
-----------------
Flow-producing activity types / Optimal challenge zone / Environmental requirements
Ideal entry conditions / Common disruptors / Peak window / Natural duration
Current flow frequency / Biggest obstacle / One design change
```

**Anti-Goal Set:**
```
Hard limits: [3 deal-breakers, specific]
Strong preferences: [significant but not absolute]
Mild preferences: [tolerable if other factors strong]
```

**Life Design (combined):**
```
Current flow frequency / Top 3 flow conditions to preserve / Top 3 anti-goals to avoid
For [decision]: flow analysis + anti-goal check + net read + one design experiment
```

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Maps your flow conditions from specific examples | Provide concrete situations where you felt most/least engaged |
| Extracts anti-goals from the worst-day description | Be honest and vivid about what drained you |
| Identifies hard limits vs preferences | Confirm which anti-goals are true deal-breakers |
| Names the single design change with highest leverage | Actually run the design experiment |

## Related Skills

- `values-explorer` — for values clarification that underpins life design
- `strength-growth-mapper` — for capability development within the designed direction
- `examined-life` — for the broader life-audit context
