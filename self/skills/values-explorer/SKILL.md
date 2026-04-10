---
name: values-explorer
description: >-
  Use when someone is unclear about what actually matters to them, feeling torn
  between competing priorities, or agonizing over a choice where something
  important has to be sacrificed. Two moves: extract genuinely held values from
  behavioral...

scenarios:
  - "I keep making choices that feel wrong but I can't name why"
  - "Help me figure out what I actually value — not what I think I should value"
  - "I'm torn between two things I care deeply about"
  - "뭐가 진짜 나한테 중요한지 모르겠어"
  - "두 가지 가치관이 충돌해서 결정을 못 하겠어"
  - "내 삶에서 중요한 게 뭔지 정리하고 싶어"

compatibility:
  optional:
    - think-tool
    - mcp-reasoner
  remote_mcp_note: >-
    think-tool이 있으면 가치 충돌 해결 프레임워크 선택에 유용합니다.
    mcp-reasoner는 네 가지 충돌 해결 경로를 탐색하는 데 사용할 수 있습니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
---

# Values Explorer

## When to Use / When Not to Use

**Use when:**
- Success feels hollow — external achievement isn't producing satisfaction
- A recurring sense that choices feel wrong, without being able to name why
- Two values are pulling in opposite directions in a real decision

**Not for:**
- Information overload (use clarity-toolkit)
- Whole-life audit (use examined-life — it uses values as an input)

## Process

### Part 1 — Values Extraction

Goal: not a list of nice-sounding words, but a precise, evidenced account of what this person actually values.

**Method 1 — Behavioral evidence.** Forget self-report. Ask:
- What did you make time for in the last 3 months, even when inconvenient?
- When did spending money feel deeply *right* — not just pleasurable, but meaningful?
- When were you most proud (not successful — proud)?
- When were you most angry or morally outraged? What value was being violated?

**Method 2 — Peak experience.** A moment of feeling deeply alive, right, or at peace. What were you doing? What role were you playing? What value was being expressed?

**Method 3 — Anger as compass.** Anger at injustice → fairness. Anger at wasted time → purposefulness. Anger at betrayal → loyalty. Anger at own compromise → integrity.

**Method 4 — Deathbed perspective.** "What would you need to have done, been, or stood for for this period to feel well lived?"

**Values inventory (5–8 maximum — more means too abstract):**
```
Values Inventory
----------------
Value 1: [precise name — not "family" but "being genuinely present with people I love"]
Evidence: [specific behavior, moment, or pattern]
Current expression: thriving / adequate / starved

[repeat for each]

Most alive value: [most richly lived]
Most starved value: [most neglected — often the source of dissatisfaction]
```

### Part 2 — Values Conflict Resolution

**MCP notes:** If `think-tool` is available, use it before selecting a framework — which one fits this specific conflict? If `mcp-reasoner` is available, use it to explore all four frameworks in parallel before committing.

Values conflicts are real. Freedom vs security. Achievement vs family. Honesty vs kindness. These are not problems with a right answer — they are tensions navigated with wisdom.

**Name the conflict precisely:** What are the two values? In what specific situation are they pulling opposite directions? What would choosing each cost?

**Four navigation frameworks:**

| Framework | When to use |
|-----------|------------|
| **Hierarchy in context** | Ask: in this situation, this time in your life, which value is more essential to honor? |
| **Cost accounting** | Make costs explicit for each path — asymmetric costs usually emerge |
| **Creative third** | Is there an option that partially honors both at reduced intensity? (Not a compromise that honors neither) |
| **ACT commitment** | Choose one value, name explicitly what the other loses, and carry that loss with awareness |

**ACT commitment frame:** "I am choosing [A] in this situation. I value [B] deeply, and I am choosing not to honor it fully here, and I accept what that costs." This is deciding — not resolving.

**Values conflict output:**
```
Values Conflict Analysis
------------------------
Values in tension: [A] vs [B]
Specific situation: [concrete context]

If you honor [A]: What [B] loses / Cost level / Reversibility
If you honor [B]: What [A] loses / Cost level / Reversibility

Creative third option: [if one exists]
Cost asymmetry: [which path costs more and why]
ACT commitment frame: [what a conscious, eyes-open choice looks like]
```

## Output Template

See inline formats in each section above. Summary structure:

```
Values Inventory: [5-8 values with evidence and expression rating]
Most alive: [richly lived value]
Most starved: [neglected value — often the source of dissatisfaction]

Values Conflict Analysis (when applicable):
Values in tension / Specific situation
Costs of each path / Reversibility / Creative third option
Cost asymmetry / ACT commitment frame
```

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Extracts values from behavioral evidence, not self-report | Provide specific moments, choices, and reactions to work from |
| Names the gap between declared and lived values | Sit with the gap without shame — it's information |
| Identifies the creative third option when it exists | Decide which framework fits this conflict |
| Frames the ACT commitment when no creative third is available | Make the committed choice and carry the acknowledged loss |

## Related Skills

- `examined-life` — for using values as input to a whole-life audit
- `motivation-explorer` — when values gaps show up as hollow motivation
- `decision-maker` — when values are clear and a structured decision framework is needed
- `flow-antigoal` — for designing work and life conditions around lived values
