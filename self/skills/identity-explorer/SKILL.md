---
name: identity-explorer
description: >-
  Use when someone is questioning who they are, feeling unlike themselves, or going through a
  period of identity confusion or crisis. Also triggers when someone resists change with
  "that's not like me" — which often signals identity-protective behavior worth surfacing.
  Triggers on: "정체성", "나는 누구인가", "identity", "나답지 않게", "내가 왜 이러지",
  "정체성 위기", "자아 탐색", "identity crisis", "나 자신", "내가 누구인지 모르겠어",
  "그건 나답지 않아".
  Best for: life transitions that challenge self-concept, identity resistance blocking growth, narrative coherence work.
  Not for: short-term mood states or situational confusion — this is for pattern-level identity questions.

scenarios:
  - "I don't know who I am anymore after this change"
  - "I keep saying 'that's not me' but maybe I'm using that as an excuse"
  - "I want to understand which parts of my identity I chose vs inherited"
  - "내가 누구인지 모르겠어, 너무 혼란스러워"
  - "그건 나답지 않은데 — 진짜 나답지 않은 건지 확인하고 싶어"
  - "정체성이 흔들리는 것 같아, 정리가 필요해"

compatibility:
  optional:
    - think-tool
  remote_mcp_note: >-
    think-tool이 있으면 정체성 방어 패턴과 진짜 핵심 정체성을 더 정밀하게 구분할 수 있습니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
---

# Identity Explorer

## When to Use / When Not to Use

**Use when:**
- A major change (role, relationship, loss) is disrupting self-concept
- Someone resists growth with persistent "that's not me" framing
- Self-concept clarity is low — feeling very different across contexts

**Not for:**
- Short-term mood states without a deeper pattern
- Simple career questions without an identity component

## Process

Two parts that belong together: map the current identity, then notice where it's being defended at a cost.

### Part 1 — Identity Audit

**Don't ask all questions at once.** One focused question per dimension, based on what's most relevant to the current situation.

**Mapping dimensions:**

| Dimension | What to map |
|-----------|------------|
| Role inventory | Professional, relational, personal/social roles — chosen/inherited/accidental? |
| Values alignment | Where do actions and stated values match? Where is there friction? |
| Narrative coherence | Is there a coherent story with a protagonist who has agency? Are there unintegrated chapters? |
| Self-concept clarity | Same person across contexts (work, family, friends, alone)? |

**Audit Output:**
```
Current Identity Map
--------------------
Roles: [list with chosen/inherited/accidental tag]
Core self-narrative: [how they tell their own story, 1-2 sentences]
Values-behavior alignment: [where aligned / where gaps]
Self-concept clarity: [high / medium / low — what drives the assessment]
Strongest identity anchor: [the most central role or value]
Most questioned element: [what they're least certain about]
```

### Part 2 — Identity Threat Detection

**Signals of identity-protective behavior:**
- "I'm not the kind of person who..." (rule stated as identity, not preference)
- Disproportionate emotional reaction to factually minor feedback
- Persistent avoidance: "That's just not me"
- Self-sabotage at the edge of growth
- "If I do X, then who am I?"

**Threat analysis:**

1. **Name the protected identity claim.** What self-concept is being defended?
2. **Assess the cost of protection.** What is being given up? What doors are closing?
3. **Test the claim's origin.** Chosen deliberately? Adopted from parent/culture? A coping mechanism that has outlived its use?
4. **Distinguish core from constructed.** Some elements are genuinely core — removing them would damage, not free. Others are constructions that have become cages.
5. **Name the underlying fear.** Identity threats always have a fear underneath (not enough without this label, loss of belonging, others' perception).

## Output Template

Audit output (above) + when threat detected:

```
Identity Threat Detection
-------------------------
Protected identity claim: [what self-concept is being defended]
Cost of protection: [what's being given up to maintain it]
Origin of this claim: [chosen / adopted from X / coping mechanism]
Core or constructed: [assessment]
Underlying fear: [what would happen if this identity element changed]
Reframe: [what if protecting this is self-limitation, not self-preservation?]
```

End with one of these closing questions:
- "If you didn't define yourself by [X], who would you be?"
- "What part of your identity do you want to keep because it's truly yours — not because it's comfortable?"
- "What would you do differently if your sense of self didn't depend on this?"

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Maps the current identity across dimensions | Reflect on which roles feel chosen vs inherited |
| Detects identity-protective patterns in language | Sit with whether the protection is still serving you |
| Names the fear beneath the identity defense | Do the harder work of questioning what's really core |
| Offers a reframe without prescribing a change | Decide what to keep and what to let evolve |

## Related Skills

- `shadow-persona` — for what is being performed vs suppressed
- `ego-state-identifier` — when identity questions surface as automatic reactions
- `values-explorer` — when identity feels misaligned with values
- `fear-inventory` — when identity threat feels like a specific fear
