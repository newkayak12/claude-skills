---
name: examined-life
description: >-
  Use when someone wants to look at their life from a distance — not a specific decision,
  but the whole shape of it. Especially suited to life transitions, major milestones, or the
  feeling of running on autopilot.
  Triggers on: "삶을 돌아보고 싶어", "내 인생을 점검하고 싶어", "자동적으로 살고 있는 것 같아",
  "examined life", "삶의 의미", "인생 점검", "스토아 철학", "죽음 앞에서 생각해보면".
  Best for: major life transitions, mid-life reflection, feeling like you're living someone else's life.
  Not for: specific decisions (use decision-maker or tradeoff-articulator), values clarification alone (use values-explorer).

scenarios:
  - "I feel like I've been on autopilot for years"
  - "I want to step back and look at the shape of my whole life"
  - "What would I regret if I kept going the way I am?"
  - "내 인생이 진짜 내 인생인지 모르겠어"
  - "자동으로 흘러가고 있는 것 같아, 점검하고 싶어"
  - "인생의 큰 그림을 스토아적으로 돌아보고 싶어"

compatibility:
  optional:
    - think-tool
    - sequential-thinking
  remote_mcp_note: >-
    think-tool이 있으면 감사 결과에 맞는 스토아 도구를 선택하는 판단을 더 정밀하게 할 수 있습니다.
    sequential-thinking은 감사 → 도구 선택 → 적용 순서를 지키는 데 유용합니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
---

# The Examined Life

## When to Use / When Not to Use

**Use when:**
- Life transitions: career change, relationship shift, milestone birthday, loss
- Feeling of running on autopilot or living someone else's expectations
- Wanting the whole-life view, not a single-decision view

**Not for:**
- Single-decision analysis (use decision-maker or tradeoff-articulator)
- Values clarification alone (use values-explorer first)

## Process

**Order matters:** Complete the audit before selecting Stoic tools. Jumping to reframing before examining produces philosophical bypassing.

**MCP note:** If `sequential-thinking` is available, enforce: (1) audit → (2) identify findings that need reframing → (3) select tools → (4) apply.

### Part 1 — The Examined Life Audit

**Autopilot Check:** For each major domain (work, relationships, where you live, how you spend time):
- Did you choose this deliberately, or did you arrive by accumulation?
- If designing from scratch with what you know now, would you choose it again?
- Who would you be disappointing if you changed this?

**Values-Life Alignment Check:** Cross-reference stated values against how time, money, and attention are actually spent. Name the gaps without shame — they are information, not failures.

**Regret Audit** (Bronnie Ware's five most common deathbed regrets):
1. Courage to live a life true to yourself, not others' expectations
2. Not working so hard
3. Courage to express feelings
4. Staying in touch with friends
5. Letting yourself be happier

Ask: Which might you share if you carried on as you are now? What specifically would produce it?

**Aliveness Question:** When do you feel most alive — not successful, not productive, but *alive*? What are you doing? What does this reveal about what you actually want?

### Audit Output

```
Examined Life Audit
-------------------
Consciously chosen vs inherited/drifted: [rough proportion and examples]
Most significant alignment gap: [values vs. actual time/attention]
Regret risk: [which Ware regret resonates most, and the specific form it takes]
Where you feel most alive: [concrete, specific]
Where you feel most on autopilot: [concrete, specific]
The one question this audit keeps returning to: [what most needs honest examination]
```

### Part 2 — Stoic Reframing

Select 1–2 tools that fit what the audit revealed:

| Finding | Tool |
|---------|------|
| Drift and autopilot | Memento mori + dichotomy of control |
| Loss or grief | Amor fati + negative visualization |
| Anxiety about uncontrollables | Dichotomy of control |
| Taking things for granted | Negative visualization |

**Dichotomy of Control (Epictetus):** Separate what is in your control (response, effort, values, attention) from what is not (others' reactions, outcome, circumstances). Place all energy on the left column.

**Negative Visualization:** Imagine losing what you have. Two effects: deepens appreciation, and reveals which losses would feel genuinely catastrophic — pointing to what actually matters.

**Memento Mori:** In the context of a finite life, how much does this actually matter? What have you been postponing?

**Amor Fati:** Not just acceptance of what can't be changed, but active engagement: what does this obstacle require you to develop? What path does it force that you might not have taken voluntarily?

End with one practical commitment — not a life overhaul, a first step.

## Output Template

Audit output (above) + 1–2 Stoic tools applied to the most significant finding + one concrete commitment.

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Asks Socratic questions to surface what's on autopilot | Reflect honestly on each domain — don't edit for the "right" answer |
| Maps the gap between stated and lived values | Sit with the discomfort of the alignment gaps |
| Selects the Stoic tool(s) that fit the audit findings | Do the reframing work — Claude can name the tool, you have to apply it |
| Names the one question the audit keeps returning to | Make one concrete commitment |

## Related Skills

- `values-explorer` — for deep values clarification work
- `fear-inventory` — when the autopilot is driven by fear
- `flow-antigoal` — for designing a life around what creates deep engagement
