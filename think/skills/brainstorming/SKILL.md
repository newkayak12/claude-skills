---
name: brainstorming
effort: high
description: >-
  Use when something needs to be designed or built and the shape of the solution is still
  open — before any code. Triggers on: "어떻게 만들지?", "기능 설계해줘", "아키텍처 잡아줘",
  "옵션 더 뽑아줘", "발산해줘", "design this feature", "how should we build X?".
scenarios:
  - "OAuth 로그인 기능 어떻게 설계해?"
  - "알림 시스템 새로 만들어야 하는데 어떻게 접근해?"
  - "대시보드 기능 추가하려는데 어디서부터 시작해?"
  - "We need to design a rate limiting system"
  - "How should I architect this new microservice?"
compatibility:
  optional:
    - think-tool
    - sequential-thinking
    - mcp-reasoner
  remote_mcp_note: >-
    think-tool이 있으면 발산이 끝난 뒤 놓친 trade-off를 찾는 데 쓰세요. mcp-reasoner는 수렴 단계에서
    후보가 2-3개로 좁혀졌는데 기준만으로 갈리지 않을 때 씁니다.
---

## Standing Mandates

- NEVER write code, scaffolding, or call an implementation skill before the user approves a design. A design can be three sentences; it cannot be absent.
- NEVER put implementation into the design: no function signatures, library calls, runnable pseudocode, or exact command schemas. If you are typing `ZADD key score member`, you have left design — stop.
- ALWAYS ask one question at a time and wait. Prefer multiple choice when the options are obvious.
- ALWAYS separate diverging from converging. No criticism while generating options; no new options while cutting them.
- ALWAYS produce at least three options before judging any, including one you expect to lose — the losing option shows the shape of the winning one.
- NEVER narrow to one option on instinct. Cut with written kill-criteria, down to two or three, and show the trade-off between what survives.
- ALWAYS hand off to `write:writing-plans` after approval. The output of this skill is a design and a plan, never working code.
- Goal: the user sees the option space before committing, and the decision they make is theirs, made against stated criteria.

# Brainstorming

Turns a vague "build X" into an approved design by keeping two moves apart: generate options in
volume without judgment, then cut them against explicit criteria. Most bad designs come from
skipping the first move — one option, presented well, approved by default.

**Not for** redefining the problem itself (`problem-reframer`), structuring a large idea pile
(`thought-organizer`), or stress-testing a finished design (`devils-advocate`).

---

## Process

**1. Explore context.** Read before asking: files, docs, recent commits. In an existing codebase,
note the patterns the design must follow and any adjacent problem worth fixing in the same change.
If the request bundles independent subsystems ("a platform — chat, billing, analytics, storage"),
say so first and split it; each part gets its own cycle.

**2. Clarify.** Purpose, constraints, success criteria, what "done" looks like. One question per
message. Even a simple request deserves "what exactly are we solving?" — unchecked assumptions
are where simple projects leak the most effort.

**3a. Diverge.** Generate three to five options and hold all criticism. Use one or two of these
per round:

| Tool | Move |
|---|---|
| Vanilla | The obvious first answer — write it down so it stops anchoring |
| Constraint relaxation | "If [the hardest constraint] were gone?" — then check whether the constraint is real |
| SCAMPER | Substitute · Combine · Adapt · Modify · Put to other use · Eliminate · Reverse |
| Analogy | How does another domain solve this? (queue → post office, rate limit → toll gate) |
| Opposite | Push → pull, central → distributed, sync → async |

If `think-tool` is available, call it once diverging is done to surface trade-offs you missed.

**3b. Converge.** Now criticize — against written kill-criteria, not taste:

- Violates a hard constraint (time, budget, team skill)
- Doesn't actually solve the stated problem
- Depends on a system or person we don't control
- One-way door whose risk isn't paid for
- The team can't run it (learning curve, on-call load)

Cut to two or three. If you feel strongly pulled to one, run `cognition:bias-auditor` before
presenting — that pull is where confirmation bias lives. If `mcp-reasoner` is available and the
criteria don't separate the finalists, use it to commit.

**4. Present and get approval.** Size each section to its complexity: a few sentences where it's
simple, detail where the nuance is. Cover architecture, components, data flow, error handling,
testing. Check each major section with the user. If they ask "any other options?" or every option
feels off, go back to 3a — or, if all options feel off, to `problem-reframer`.

**5. After approval** invoke `write:writing-plans`. Do not invoke any other implementation skill.

Design principles that apply throughout: units with one purpose and a defined interface;
YAGNI — nothing for hypothetical future needs; in existing code, follow existing patterns and
fix what the change touches, nothing else.

---

## Output Template

```
[맥락 / Context]        what exists, what pattern the design must follow
[문제 / Problem]        one sentence, in the user's words, confirmed
[옵션 / Options]        3–5, one paragraph each, no verdicts yet
[기준 / Kill-criteria]  the list above, filled in for this decision
[후보 / Finalists]      2–3 survivors, one trade-off table
[설계 / Design]         for the chosen option — architecture · components · data flow · errors · tests
→ approval → write:writing-plans
```

Write in the user's language.

---

## What Claude Does / What You Do

| Claude | You |
|---|---|
| Reads the project before asking anything | Answer one question at a time; say "you decide" when you don't care |
| Generates options without judging, then cuts with stated criteria | Pick a finalist or send it back to diverge |
| Keeps implementation out of the design | Approve the design before any code is written |

## Related Skills

- `problem-reframer` — when every option feels wrong, the problem statement is wrong
- `thought-organizer` — too many ideas, need structure and priority
- `cognition:bias-auditor` — strong pull toward one option
- `devils-advocate` — stress-test the chosen design before planning
- `write:writing-plans` — the mandatory next step after approval
