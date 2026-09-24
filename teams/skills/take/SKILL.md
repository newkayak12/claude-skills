---
name: take
description: >-
  Use when the user wants to claim a teams STORY or TASK card for themselves via
  tm_assign(to: "human") — pins the subgoal's author stage to a human. Triggers: "이 카드 내가
  할게", "take E-xxx/P2", "assign this to me", "나한테 배정해줘".
scenarios:
  - "Take E-a1b2c3d4/P2 — I want to do that STORY myself"
  - "Assign E-a1b2c3d4/P2/U1 to me instead of letting it auto-decide"
  - "이 스토리 내가 가져갈게, 나한테 배정해줘"
  - "E-a1b2c3d4/P3/U2 카드 나한테 pin 해줘"
compatibility:
  required:
    - task-manager
related:
  - inbox
  - submit
  - board
  - ticket
---

# take — tm_assign, rendered as a claim

`tm_assign` pins a card's AUTHOR stage (implement/draft/cases — never a judging stage like
test/review/gate) to a human. This skill calls it with `to: "human"` and prints the Output
Template below; it makes no decisions about what work exists.

## Process

1. Take the key as given — a STORY (`E-xxxxxxxx/Pn`, every subgoal in that package's child run)
   or a TASK (`E-xxxxxxxx/Pn/subgoalId`, just that one). A STORY may be taken before it even
   dispatches — the pin rides on the package and reaches its child run when one opens; a TASK
   key needs the child run to already exist.
2. Call `tm_assign({task_id, key, to: "human", who})`. `who` is optional — pass it only if the
   user named themselves; omit it rather than guessing.
3. Render `assigned` from the reply. Called by a person, the pin always parks the node in
   waiting_human regardless of the run's `interactive` setting — the user is present by
   definition.
4. If a listed subgoal is already `waiting_human` (check `inbox` for its `briefing_path`), name
   that path so the human can open it — don't invent one for a STORY pin that hasn't dispatched
   yet; there is nothing to open.
5. To hand a card back, call this again with `to: "auto"` — a card already parked goes back to
   pending and dispatches normally on the next tick.
6. An `ask` card (a decision, `inbox`'s `questions[]`) or a `human_gate` card (an accept/reject,
   `inbox`'s `human_gate: true`) is never taken with this skill — neither is an author stage
   `tm_assign` can pin. An `ask` card is already addressed to the owner its questions named (or
   to nobody, if none was given); a `human_gate` card is addressed to whoever is watching. Both
   go straight to `submit` once you see them in `inbox`.

## Output Template

```
key: E-a1b2c3d4/P2       kind: STORY       to: human       who: shkim

| subgoal_id | node_id        | state         | assignment |
|------------|-----------------|---------------|------------|
| U1         | implement:U1:1 | waiting_human | author     |
| U2         | implement:U2:1 | pending       | author     |

briefing: <briefing_path, from `inbox`, if a listed subgoal is already parked>
```

Releasing (`to: "auto"`) prints the same table with `to: auto` and no briefing line.

## What Claude Does

Calls `tm_assign({task_id, key, to: "human", who})` — or `to: "auto"` to release — and renders
`assigned` above. Never fabricates a `briefing_path`; only names one it actually read from
`inbox` for a subgoal this reply shows as `waiting_human`.

## What You Do

Name a STORY or TASK key — your own, or one you saw in `inbox`. Do the work in the briefed
worktree, then hand it to `submit`. Release a card you no longer want with the same skill.

## Related Skills

- `inbox` — every card waiting on a human, and what was auto-decided instead
- `submit` — record your answer once you've done the work
- `board` — every EPIC, or one EPIC's STORY kanban
- `ticket` — one ticket's full detail, EPIC or STORY
