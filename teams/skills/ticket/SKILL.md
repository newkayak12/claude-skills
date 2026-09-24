---
name: ticket
description: >-
  Use when the user wants one ticket's detail via tm_ticket — an EPIC (E-xxxxxxxx) or a STORY
  (E-xxxxxxxx/Pn). Triggers: "이 티켓 상세", "P2 상태가 뭐야", "show me ticket E-xxx/P2", "last
  verdict on this story". Read-only, prints a card, never the raw JSON.
scenarios:
  - "Show me the detail for E-a1b2c3d4/P2 — worktree, task progress, last verdict"
  - "What's the EPIC itself doing, not just its stories"
  - "E-a1b2c3d4/P2 티켓 상세 보여줘"
  - "이 스토리 마지막 verdict가 뭐였어"
compatibility:
  required:
    - task-manager
related:
  - board
  - orchestrate
  - inbox
  - take
---

# ticket — tm_ticket, rendered as a card

`tm_ticket` is read-only and derives every state from `task.json` itself, the same way `tm_board`
does. This skill calls it with the key the user gave and prints the Output Template below; it
makes no decisions.

## Process

1. Take the key as given: `E-xxxxxxxx` for the EPIC, `E-xxxxxxxx/Pn` for one STORY.
   `tm_ticket({key})` resolves the 8-char EPIC prefix to its task itself — no separate lookup,
   unlike `board`.
2. Call `tm_ticket({key})`.
3. Render by `kind` (`EPIC` or `STORY`) per the Output Template below. Print only what the reply
   carries — it has no transition history or `attacks[]` yet; don't invent them.
4. If the human wants the long form, name `doc_path` rather than reading the md into context —
   render it first with `tm_docs({task_id})` if it doesn't exist on disk yet.

## Output Template

EPIC (`kind: "EPIC"`):

```
E-a1b2c3d4  결제 취소 기능              state: IN_PROGRESS   phase: impl   daemon: pid 4121 alive
doc: .teams_output/team/E-a1b2c3d4/INDEX.md
```

STORY (`kind: "STORY"`):

```
E-a1b2c3d4/P2  결제 취소 API              state: IN_REVIEW
tasks: 2/5
worktree: /proj/.worktrees/P2 @ team/E-a1b2c3d4/P2
last verdict: accept 94                 (or: rejected — <reason>; gaps: <gap, gap>; or —)
reporter: shape                          (qa/planning-audit/you = filed defect; repair = integration seam)
human: U1 -> shkim                       (omit this line when human_assignments is empty)
doc: .teams_output/team/E-a1b2c3d4/40-stories/P2.md
```

`daemon` prints `none` when the EPIC has none yet. `worktree` prints `—` before any dispatch has
run. `tasks` is `—` when no dispatch has started a child run to measure. `reporter` is `shape` for
original scope, `repair` for an integration seam, or `qa`/`planning-audit`/`you` for a filed
defect (QA, audit, or `tm_file`) — see `board`'s own explanation for how a PLAN/QA/AUDIT
phase-Team package's ticket reads instead. `human_assignments` (`[{subgoal_id, who}]`) names
which of this STORY's subgoals a human currently owns — `[]` before the package has a child run
to pin against. Render one `subgoal_id -> who` pair per entry (join multiple with `, `); a
`WAITING_HUMAN` state with no entry here just hasn't been claimed yet — point at `take`.

A STORY's reply also carries `links` (`tickets.mjs`'s `storyLinks`): `blocked_by`/`blocks` name a
sibling STORY key plus that sibling's own current state, `implements` names the PRD user-story
ids this STORY was shaped to satisfy, and `filed_by` repeats `reporter` — the same relations
`board`'s own STORY rows carry under the same name.

## What Claude Does

Calls `tm_ticket({key})` with the key as given and renders the card above — nothing more.

## What You Do

Give a ticket key, EPIC or STORY. Open `doc_path` yourself for the long form; the skill won't
paste it into the conversation.

## Related Skills

- `board` — every EPIC, or one EPIC's STORY kanban
- `orchestrate` — drives the run this ticket reports on
- `inbox` — `human_assignments`'s owner's actual card, and everything else waiting on a person
- `take` — claim an unassigned subgoal for yourself
