---
name: back-to-basics
effort: high
description: >-
  Use when an approach feels fundamentally wrong or an inherited constraint may not be real — rebuild
  from what is actually known. Triggers: "왜 이렇게 해야 해?", "기본부터 다시 생각해", "first principles",
  "가정을 의심해봐", "처음부터 설계하면".
scenarios:
  - "왜 배포가 2주나 걸려야 해? 진짜 필수적인 단계가 뭐야?"
  - "레거시 제약 없이 처음부터 설계하면 어떻게 될까?"
  - "이 방식이 당연하다는 가정을 다 걷어내고 다시 생각해보자"
  - "Why does onboarding have to take 3 weeks? Rebuild it from first principles"
  - "We keep optimizing the wrong thing — what do we actually know for certain?"
compatibility:
  recommended:
    - think-tool
  optional:
    - mcp-reasoner
  remote_mcp_note: >-
    think-tool이 있으면 가정을 빠짐없이 열거하고 각각이 확인 가능한지 가르는 데 좋습니다.
    mcp-reasoner는 다시 세운 대안끼리 비교할 때 씁니다.
related:
  - devils-advocate
  - redefine-problem
  - brainstorming
---

## Standing Mandates

- ALWAYS list every assumption before touching any of them. An unlisted assumption survives by default.
- ALWAYS ask of each assumption: can this be checked (measurement, physics, logic, contract text), or is it only inherited? "That's how it's done" is a finding, not a floor.
- NEVER call something a floor because it is common, expensive to change, or said by an expert. A floor is what survives "why?" with something checkable.
- NEVER rebuild by analogy ("like how X did it"). If an analogy creeps in, name it and go back to the floor.
- NEVER invent numbers or facts for the floor. Mark anything unverified as `unverified` and say how to check it.
- ALWAYS end with the conditions under which the rebuild is wrong. A rebuild without failure conditions is a conclusion in disguise.
- Goal: the user leaves knowing which constraints were real, which were habit, and what the rebuild costs if it is wrong.

# Back to Basics

Breaks an approach down to what can be checked, then rebuilds from there. Questions the approach and its constraints, not the goal.

**Not for** doubting whether the problem statement is right (`redefine-problem`), full counterargument work (`devils-advocate`), or routine decisions with known good answers.

---

## Process

**1. Break down to a checkable floor.** State the approach in one line. List every assumption and constraint it rests on, then push each through "why?" until it ends in something checkable, or is marked inherited. Sort into three piles: `checked` (with the evidence), `inherited` (habit, precedent, org history), `unverified` (plausible, needs a check). Stop at the floor of this argument; do not slide into "nothing is certain".

**2. Rebuild from the floor.** Ignore the existing solution. Using only the `checked` pile, plus `unverified` items you flag, design the approach that would follow. Name what each choice gives up (opportunity cost) and how it differs from the incumbent. If the rebuild equals the incumbent, say so; that is a valid result and means the constraints were real.

**3. State when the rebuild is wrong.** List the assumptions the rebuild introduced that were not in the floor, the specific conditions that would falsify it, and what evidence would make you abandon it. For a real attack on the rebuild, hand it to `devils-advocate` by name rather than doing it here.

Boundary with `redefine-problem`: this skill accepts the goal and doubts the how. If the breakdown shows the goal itself is mis-stated, stop and hand off to `redefine-problem`.

---

## Output Template

```
Approach:   "[as it stands today]"

바닥 / Floor
checked:     [assumption] — [evidence]
inherited:   [assumption] — [where it came from]
unverified:  [assumption] — [how to check]

재구성 / Rebuild
[approach built from the checked pile only]
Gives up: [what this forecloses]  |  Differs from today: [delta, or "same"]

틀리는 조건 / Wrong if
- [condition that falsifies the rebuild]
- New assumptions introduced: [list]
- Would abandon if: [evidence]

Next: [cheapest check for the top unverified item] | hand off to devils-advocate
```

Labels follow the user's language.

---

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Lists assumptions and sorts them into checked, inherited, unverified | Say which constraints you believe are truly fixed |
| Rebuilds from the checked pile and flags analogy creep | Supply facts Claude cannot see: costs, contracts, limits |
| States the conditions that would make the rebuild wrong | Run the cheapest check on the top unverified item |

## Related Skills

- `devils-advocate` — full counterargument work on the rebuild
- `redefine-problem` — when the breakdown shows the problem statement, not the approach, is wrong
- `brainstorming` — when the floor is clear and you need many candidate designs, not one rebuild
