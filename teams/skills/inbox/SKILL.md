---
name: inbox
description: >-
  Use when the user wants to see what teams work is waiting on a human via tm_inbox — every
  waiting_human card, plus what the engine auto-decided instead of asking. Triggers: "내 할 일
  뭐 있어", "나 기다리는 카드 있어?", "what's waiting on me", "show my inbox".
scenarios:
  - "What teams work is waiting on a human right now, across every run"
  - "Show me the inbox for just this one EPIC"
  - "지금 사람 대기 중인 카드가 뭐가 있는지 보여줘"
  - "이 EPIC에서 자동으로 결정돼버린 카드도 같이 보여줘"
compatibility:
  required:
    - task-manager
related:
  - take
  - submit
  - board
  - ticket
---

# inbox — tm_inbox, rendered as two lists

`tm_inbox` is read-only and derives both lists from `task.json` itself, the same way `tm_board`
does. This skill calls it and prints the Output Template below; it makes no decisions.

## Process

1. No task named → `tm_inbox({})` — every waiting_human card and every auto-decided pin, across
   every task this session can see. A task named (`E-xxxxxxxx` or a full `task_id`) →
   `tm_inbox({task_id})` — just that one.
2. Render `cards` first — these are actually parked, waiting on a person right now — then
   `decided` underneath, clearly separated: a `decided` entry never blocks anything, it is a
   record of what the engine chose instead of asking.
3. Print only what the reply carries. `cards[].acceptance` and `briefing_path` are the full
   brief — name the path, don't paste its contents into the conversation.
4. Empty `cards` and empty `decided` is a normal answer ("nothing waiting"), not an error.

## Output Template

```
## Waiting on a human

| key                | title                    | who    | since |
|---------------------|--------------------------|--------|-------|
| E-a1b2c3d4/P2/U1    | ask: which retry policy | shkim  | 10:32 |
| E-a1b2c3d4/P3/U2    | implement: payment retry | —      | 09:58 |

E-a1b2c3d4/P2/U1
  acceptance:
    - <criterion>
    - <criterion>
  briefing: <briefing_path>

## Auto-decided (not interactive)

| key                | title                    | who | reason                              |
|---------------------|--------------------------|-----|--------------------------------------|
| E-a1b2c3d4/P4/U3    | assignee: human pin     | —   | run not interactive; dispatched to codex |
```

`who` is `—` when nobody has claimed the card yet (`take` claims it). Render one card's
`acceptance`/`briefing_path` block for each row in `cards`, not just the first. Omit either
section header entirely when its list is empty, rather than printing it empty.

## What Claude Does

Calls `tm_inbox` with the optional `task_id` and renders both lists above — nothing more. Never
opens a `briefing_path` itself; names it for the human to open.

## What You Do

Name a task (`E-xxxxxxxx`) to filter to one EPIC, or nothing for every run this session can see.
Take a card's `key` with `take`; a `decided` entry can be objected to the same way — taking it
pins it to you and reroutes it to waiting_human on its next attempt.

## Related Skills

- `take` — claim a card's key from this list for yourself
- `submit` — record your answer once you've done the work
- `board` — every EPIC, or one EPIC's STORY kanban
- `ticket` — one ticket's full detail, EPIC or STORY
