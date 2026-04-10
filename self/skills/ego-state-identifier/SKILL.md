---
name: ego-state-identifier
description: >-
  Use when someone is confused about why they reacted the way they did —
  especially when it felt automatic, disproportionate, childlike, or like they
  heard a parental voice in their head. Triggers on: "왜 이렇게 반응했지", "자동으로 나왔어",
  "어린애처럼 굴었어", "부모님 목소리

scenarios:
  - "Why did I react so disproportionately to that feedback?"
  - "I heard my mother's voice in my head criticizing me — what's happening?"
  - "I keep playing the same role in every team I join"
  - "왜 이렇게 과민하게 반응했는지 모르겠어"
  - "내 안에 두 가지 목소리가 싸우는 것 같아"
  - "직장에서 자꾸 어린아이처럼 행동하게 돼"

compatibility:
  optional:
    - think-tool
  remote_mcp_note: >-
    think-tool이 있으면 세 가지 자아 상태(부모·성인·어린이)를 정밀하게 구분하고
    거래 패턴을 체계적으로 분석할 수 있습니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
---

# Ego State Identifier

## When to Use / When Not to Use

**Use when:**
- A reaction felt automatic, disproportionate, or strangely familiar
- Someone describes hearing an internal critical or nurturing voice
- A relational pattern keeps repeating across different people or contexts

**Not for:**
- General therapy or trauma processing — refer professionally when responses involve deep distress
- Simple relationship advice without a pattern-level question

## The Three Ego States (Transactional Analysis, Eric Berne)

| State | What it contains | Signs |
|-------|-----------------|-------|
| **Parent (P)** | Internalized voices and rules from authority figures | Moralizing, "should/must", giving unsolicited advice, feeling righteous |
| — Nurturing Parent | Caring, supportive | "You did your best", "Let me help you" |
| — Critical Parent | Rule-enforcing, judging | "You should know better", harsh self-criticism |
| **Adult (A)** | Here-and-now processor — facts, options, current reality | Asking clarifying questions, "I noticed that...", genuinely curious |
| **Child (C)** | Emotional responses and relational strategies from childhood | Feeling small, disproportionate emotion, wanting to please or rebel |
| — Free Child | Spontaneous, creative, playful | Joy, curiosity, creative flow states |
| — Adapted Child | Developed to survive original family system | People-pleasing, sulking, compliance, rebellion |

**Contamination:** Parent or Child "bleeds into" Adult thinking (prejudice, magical thinking).

**Exclusion:** One state chronically dominant, others suppressed.

## Process

**Step 1 — Identify the event.** What happened? What was the internal experience (thought, feeling, body, impulse)?

**Step 2 — Map the ego state.** Language is a strong indicator. Did it feel familiar — like something from childhood? Was it rational and present-focused, or patterned and past-loaded?

**Step 3 — Identify the transaction (if relational).** Which state was the user speaking from? Which state was the other person speaking from? Was the transaction complementary, crossed, or covert (ulterior)?

**Step 4 — Identify patterns.** Do certain people or situations reliably trigger this state?

**Step 5 — Name the growth move.** What would the Adult response look like? What would Free Child offer instead of Adapted Child?

## Output Template

```
Ego State Analysis
------------------
Dominant state: [Parent / Adult / Child — and which variant]
Key signal: [specific language, emotion, or behavior that identified it]
Positive intent of this state: [what it was trying to do — always name this]
Cost in this situation: [what it produced that wasn't serving the person]
Relational dynamic (if applicable): [who was speaking from where, what got crossed]
Pattern: [does this repeat? in what contexts?]
Adult-state alternative: [what a grounded, present-focused response would look like]
Free Child alternative (if relevant): [what authentic, undefended response might look like]
```

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Maps the reaction to a specific ego state | Share the specific situation and internal experience |
| Names the positive intent of even Critical Parent or Adapted Child | Sit with whether the pattern resonates |
| Identifies where transactions crossed or went covert | Notice which state you're in the next time it triggers |
| Offers the Adult and Free Child alternatives | Practice pausing before the automatic state takes over |

**Key insight to deliver:** Every ego state had a positive original intent. The question is not "why am I broken" but "does this strategy still make sense now?"

## Related Skills

- `attachment-style-mirror` — for relational patterns at the attachment level
- `shadow-persona` — for what is being suppressed or performed at a deeper level
- `identity-explorer` — when ego state patterns feel tied to core self-concept
