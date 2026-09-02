---
name: devils-advocate
effort: high
description: >-
  Use when someone wants their idea, plan, or decision attacked with the strongest objections
  before acting on it. Triggers on: "반론 던져줘", "약점 찾아줘", "이 계획 문제점이 뭐야?", "비판해줘",
  "치명적 약점", "devil's advocate", "steel-man this", "punch holes in".
scenarios:
  - "MSA로 전환하자는 계획, 반론 세 가지 던져줘"
  - "이 설계의 약점이 뭔지 공격적으로 말해줘"
  - "이 결정에 반대하는 가장 강력한 주장이 뭐야?"
  - "Play devil's advocate on our go-to-market strategy"
  - "Punch holes in this architecture proposal"
compatibility:
  optional:
    - think-tool
    - mcp-reasoner
    - sequential-thinking
  remote_mcp_note: >-
    think-tool이 있으면 반론을 쓰기 전에 숨은 가정과 2차 효과를 먼저 훑으세요 — 일반론 대신 이 제안에만
    맞는 반론이 나옵니다. mcp-reasoner는 반론이 진짜 강한지 아니면 그럴듯한지 가릴 때 씁니다.
---

## Standing Mandates

- ALWAYS attack the strongest version of the position. Restate it steel-manned in one line first; an objection to a straw version is worthless.
- ALWAYS dig out two or three unstated assumptions before writing objections. The most dangerous objection is almost always aimed at one of them.
- NEVER hedge. "Some might argue…" and "on the other hand…" are not objections. State it.
- NEVER balance. The user already knows the case for; your job is the case against, at full strength.
- NEVER pad to a count. Two real objections beat three where one is filler. Say "two" if it's two.
- NEVER invent a precedent. Cite a real failure pattern or write `no clear precedent — speculative concern`. One fake precedent discredits the whole critique.
- ALWAYS end with one core vulnerability and one reversibility call. Objections without weight are noise; the reversibility line is what gives them weight.
- Goal: the user leaves knowing the one thing most likely to sink this, and whether they must fix it before starting or can learn it after.

# Devil's Advocate

Finds the real weaknesses in a position before reality does. Not for sport — for the decision.

**Not for** reframing the problem (`problem-reframer`) or generating alternatives after the
critique lands (`brainstorming`).

---

## Process

Five steps always; two more when the decision calls for them.

**1. Position and steel-man.** If the position isn't clear, ask for it — there must be something to
attack. Then restate its strongest form in one line: the conditions under which it works best.

**2. Hidden assumptions.** List two or three premises the proposal relies on but never states.
Write them plainly, not softened by your reading of them. These feed steps 3 and 5.

**3. Objections.** Three by default, fewer if only fewer are real. Each is specific to this
proposal, states why it is a problem rather than a possibility, and carries three labels:

- **Type** — `structural` · `assumption` · `execution` · `timing`
- **Severity** — `low` · `medium` · `high` · `critical`
- **Precedent** — one line naming the real failure pattern this resembles (`Segment's 2018 MSA→monolith reversal`, `distributed monolith`), or `no clear precedent — speculative concern`

If `think-tool` or `mcp-reasoner` is available, use it between steps 2 and 3 — second-order
effects, who gets hurt most, what failed like this before.

**4. Core vulnerability.** One paragraph: the single deepest flaw — usually a hidden assumption
from step 2, weaponized. Not the most visible problem; the one the others are symptoms of.

**5. Reversibility.** One line: `reversible` or `one-way door`, and why. This calibrates the
objections' weight — a one-way door means critical objections must be resolved before entry; a
reversible decision may be better tried than debated.

**+ Multi-perspective attack** — only when the decision crosses stakeholders: architecture
migrations, org changes, go-to-market, policy, product strategy. Pick two or three personas that
fit (CFO · on-call/SRE · competitor · legal/compliance · new hire · customer), one paragraph
each. For a narrow technical choice (Redis vs Memcached, a library, a name) skip it — a CFO
attack on a cache choice is theater.

**+ Path forward** — only when the user wants to improve the plan, not just hear the critique. For
each `high` / `critical` objection, one line: what would have to be true for it to dissolve.

---

## Output Template

```
Position:   "[as proposed]"
Steel-man:  [strongest version, one line]

숨은 가정 / Hidden assumptions
1. …  2. …  3. …

반론 1 / Objection 1: [title] · [type] · severity: [x]
[2–4 sentences]
선례 / Precedent: [pattern] | no clear precedent — speculative concern

반론 2 …  (반론 3 only if real)

[페르소나 / Personas — cross-functional decisions only]
[Persona]: [one paragraph]

핵심 취약점 / Core vulnerability
[one paragraph]

가역성 / Reversibility: reversible | one-way door — [why]

[개선 경로 / Path forward — on request]
```

Labels follow the user's language. For a narrow decision, compress steps 2 and the persona block
honestly rather than perform them.

---

## What Claude Does / What You Do

| Claude | You |
|---|---|
| Steel-mans first, then attacks the strong version only | State the position clearly, or let Claude ask for it |
| Labels every objection with type, severity, and an honest precedent | Say whether you want critique only or a path forward |
| Names one core vulnerability and calls reversibility | Decide what to resolve before starting |

## Related Skills

- `problem-reframer` — when every objection is surface-level, the problem definition is what's wrong
- `brainstorming` — when the critique has collapsed the direction and alternatives are needed
- `cognition:bias-auditor` — when the user's attachment to the position is itself the risk
