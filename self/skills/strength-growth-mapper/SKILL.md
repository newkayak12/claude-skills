---
name: strength-growth-mapper
description: >-
  Use when someone wants to understand what they are genuinely good at, is
  processing feedback, or deciding where to invest development effort. Maps the
  underlying strength pattern, the shadow it casts when overused, whether a
  weakness is a...

scenarios:
  - "What am I actually good at — not just on paper?"
  - "My manager says I need to 'be more strategic' — what does that actually mean for my growth?"
  - "Is my 'weakness' actually a strength I'm overusing?"
  - "내 진짜 강점이 뭔지 파악하고 싶어"
  - "다음 단계로 가려면 뭘 개발해야 할까?"
  - "받은 피드백이 맞는지, 어떻게 성장해야 할지 정리해줘"

compatibility:
  optional:
    - think-tool
  remote_mcp_note: >-
    think-tool이 있으면 강점의 그림자와 성장 엣지를 더 정밀하게 분석하고
    진짜 결핍과 과도한 강점을 구분할 수 있습니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
---

# Strength and Growth Mapper

## When to Use / When Not to Use

**Use when:**
- Processing performance feedback
- Deciding where to invest development effort
- Transitioning to a new role that makes different demands

**Not for:**
- Thinking style analysis (use thinking-style-profiler)
- Core identity questions without a capability dimension (use identity-explorer)

## Process

### Part 1 — Strength and Weakness Analysis

**What a real strength is:** A recurring pattern of thinking, feeling, or working that comes naturally, produces energy when used, and results in high performance when developed. Not just something you're good at — something that energizes you.

**Discovery questions:**
- Instinct: What do you gravitate toward, even uninvited?
- Energy: After which tasks do you feel more energized than before?
- Learning: Where do you pick things up unusually fast?
- Pride: What in your best work were *you* specifically contributing?
- Others' perception: What do people consistently ask for your help with?

**Strength shadow table (sample):**

| Strength | Shadow when overused |
|----------|---------------------|
| Attention to detail | Analysis paralysis, perfectionism |
| High standards | Impossible bar, brittleness to failure |
| Strategic thinking | Impatient with execution |
| Empathy | Absorbs others' emotions, avoids necessary conflict |
| Directness | Bluntness that damages relationships |
| Persistence | Sunk-cost trap |
| Collaboration | Consensus dependence, slow decisions |

**Weakness as overused strength:** Before accepting a weakness label, ask: is this a genuine deficit or a strength misapplied?
- "Too detail-oriented" → high precision in a context demanding speed
- "Can't say no" → strong relationship-orientation in a context requiring boundaries

Fix for overused strength = calibration. Fix for genuine deficit = development or compensation.

**Genuine deficits:** Only those costing meaningful outcomes and worth the development investment. Can it be compensated through partnership or process instead?

### Part 2 — Growth Edge Identification

The growth edge is the specific frontier where current capability is no longer sufficient for the *next* challenge. Precise, contextual, connected to what the person is actually trying to do.

**Steps:**
1. What is the next challenge or role they're moving toward?
2. What's specifically missing between here and there? (skill, behavioral capacity, mindset shift, relational capacity)
3. Find the edge *within* existing strengths — most productive growth happens at the intersection of a strength and a new context.

Example: High analytical strength moving into leadership. Growth edge: "Translate analytical thinking into narrative that moves non-analytical stakeholders." The strength is retained; the expression mode develops.

**Developmental sequence (sample):**

| Stage | Core growth edge |
|-------|----------------|
| Individual contributor | Technical depth, output quality |
| Senior individual | Influence without authority, knowledge transfer |
| First-time lead | Shifting from doing to enabling; hard conversations |
| Experienced lead | Strategic clarity; developing other leads |
| Executive | Culture, long-horizon thinking, personal sustainability |

## Output Template

```
Strength and Growth Map
-----------------------
Identified strengths:
  1. [strength name] — [underlying pattern]
     Shadow: [what this looks like when overused]
  2. [repeat]

Weakness analysis:
  [label] → Overused strength? [yes/no — reasoning]
           → Genuine deficit? [if yes, how material?]
           Compensate or develop? [recommendation]

Current strongest capability: [the one that defines them most]

Growth edge:
  Next challenge: [what they're moving toward]
  The specific frontier: [precise description]
  Type: [skill / behavior / mindset / relational]
  Connection to existing strengths: [how it extends what's already there]
  First concrete step: [one action to begin developing this edge]
```

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Extracts the underlying pattern behind surface-level labels | Provide concrete examples of best work and moments of energy |
| Identifies the shadow of each strength | Confirm whether the shadow resonates |
| Distinguishes overused strength from genuine deficit | Decide whether to calibrate or develop |
| Names the precise growth edge for the next challenge | Commit to the first concrete development step |

## Related Skills

- `thinking-style-profiler` — for thinking pattern analysis
- `identity-explorer` — when strengths feel tied to core self-concept
- `flow-antigoal` — for aligning strengths with conditions that produce deep engagement
