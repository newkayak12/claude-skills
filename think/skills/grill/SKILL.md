---
name: grill
effort: high
description: >-
  Use when someone holds a plan and wants it interrogated with questions before building. Triggers on: "grill me",
  "나 좀 빡세게 질문해줘", "설계하기 전에 질문으로 털어줘", "내 계획 질문으로 털어줘", "interview me about this plan".
scenarios:
  - "Grill me on this notification feature before I design it"
  - "Interview me about my migration plan until nothing is left assumed"
  - "Ask me the hard questions about this schema before I start"
  - "설계하기 전에 나 좀 빡세게 질문해줘 — 알림 기능 추가하려고"
  - "내 계획 질문으로 털어줘, 빠진 결정이 없는지"
  - "이 구조로 가기 전에 나한테 물어볼 거 다 물어봐"
compatibility:
  optional:
    - think-tool
  remote_mcp_note: >-
    think-tool이 있으면 질문을 던지기 전에 결정 트리의 선행 관계를 따져볼 수 있습니다 — 아직 답이 없는 질문에
    의존하는 질문을 같은 라운드에 넣지 않게 됩니다. Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
---

## Standing Mandates

- NEVER ask the user what the repo, README, or docs answer. Read first, then ask. Measured on a probe: a bare "ask me hard questions" run opened zero files and asked 18-22 questions, several of them facts the README states. Each one cost the user an answer Claude could have looked up.
- NEVER ask a question without your recommended answer and a one-line why. A bare question hands the work back; a recommendation gives the user something to accept or overturn in one word.
- ALWAYS ask the whole open frontier in one numbered round. One question at a time makes a plan with ten open decisions take ten turns, and the later questions depend on nothing you've learned.
- NEVER put a question in a round if its answer hinges on another question still open in that round. It belongs to the next round.
- NEVER start building or designing. The product of this skill is a settled tree, not a design.
- Goal: the user leaves with every decision on the plan either answered or listed as open, and nothing silently assumed.

# Grill

Interrogates a plan the user already holds, until the decisions it hangs on are settled. Facts are Claude's job to look up; decisions are the user's to make.

**Not for** a shape that is still open and needs options generated (`brainstorming`) or sharpening one vague question (`cognition:question-upgrader`). This is not a brainstorming mode: brainstorming mandates "ALWAYS ask one question at a time and wait" and diverges on options; grill takes a plan as given and asks its whole frontier at once.

## Process

1. **Plan.** State the plan in one line. If you cannot, ask for it in one line — there must be something to interrogate.
2. **Read.** README, the code and docs the plan touches. List what they settle as `known: <fact> (<file>)`. These are never asked. A fact you can't find becomes a decision for the user, marked `not in repo`.
3. **Tree.** Name the decisions the plan hangs on and which depend on which. The **frontier** is every decision whose prerequisites are already settled (by the read or by earlier answers).
4. **Round.** Ask the whole frontier at once, numbered, in the format below. Then wait.
5. **Next round.** Fold the answers in; recompute the frontier from only what the answers opened. A new round contains no question already asked and none the answers made moot.
6. **Stop.** Done when the frontier is empty. Hard cap: 3 rounds. At the cap, list the points still open as `open`, with your recommended answer, and stop — do not ask a fourth round.
7. **Close.** Show the settled tree. Do not act on it until the user confirms.

## Output Template

```
계획 / Plan: <one line>
이미 확인됨 / Known: <n> — <fact> (<file>) · …

❓ Q1 — <title>: <question, with the options if it is a choice>
➡️ 추천 / Recommend: <answer> — <one-line why>

❓ Q2 — …
➡️ …

Round <r>/3 · open after this round: <n>
```

Closing, once the frontier is empty or the cap is hit:

```
확정 / Settled: <n> — <decision → answer> · …
열림 / Open: <n> — <point + your recommendation> | none
```

Every question carries a `➡️` line; a question without one is a defect. Labels follow the user's language.

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Reads the repo first and lists what it already answers | State the plan, or let Claude ask for it |
| Asks the whole frontier per round, each with a recommendation and why | Answer, accept, or overturn each recommendation |
| Recomputes the frontier from your answers; stops at empty or 3 rounds | Confirm the settled tree before anything is built |

## Related Skills

- `brainstorming` — the shape is still open and options are wanted; asks one question at a time by design.
- `cognition:question-upgrader` — one vague question to sharpen, not a plan to interrogate.
- `devils-advocate` — attacks the plan with objections once the decisions are settled.
