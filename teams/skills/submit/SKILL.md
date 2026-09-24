---
name: submit
description: >-
  Use when a human has finished a card's work and needs to record it via tm_submit({key,
  payload}) — the same worktree cross-check a vendor's own submission gets. Triggers: "이 카드
  제출할게", "submit my answer", "작업 다 했어 제출해줘", "완료 보고할게".
scenarios:
  - "I finished the implement work on E-a1b2c3d4/P2/U1 — submit it"
  - "Answer the decision card with these choices"
  - "이 카드 작업 다 끝냈어, 제출해줘"
  - "E-a1b2c3d4/P2/U1 결과 제출하고 검증까지 보여줘"
compatibility:
  required:
    - task-manager
related:
  - inbox
  - take
  - board
  - ticket
---

# submit — tm_submit({key}), rendered as a verdict

`tm_submit({task_id, key, payload})` records a human's own answer for a `waiting_human` card —
the flow continues exactly as if a driver had submitted it. This skill calls it with the
payload as given and prints the Output Template below; it never authors or softens that payload.

## Process

1. Do the work first, in the worktree named on the card (`inbox`/`take` gave you its
   `briefing_path` and, for a STORY, the worktree path is on `ticket`). Submitting before the
   work exists on disk is exactly what the cross-check below catches.
2. Take the key (`E-xxxxxxxx/Pn/subgoalId`, or `E-xxxxxxxx/Pn/<node_id>`/`E-xxxxxxxx/TASK/<node_id>`
   for a run/task-level card — `inbox` explains the difference) from `inbox` or `take` — a STORY
   key has no single card to submit.
3. Build `payload` by kind (`inbox` names which one a card is):
   - An authoring stage (implement/draft/cases): the same shape a driver returns — at minimum
     `stage_ok`, plus `changed_files`.
   - A decision card (`stage: "ask"`): `decisions: [{question, chose, because?}]`, one per
     question `inbox` listed — nothing else is accepted for that kind.
   - A `human_gate: true` card (gate:human — a judging stage the team configured a person into,
     e.g. `critique`/`gate`/`gate:goal`): `{accept: true|false, reason?, gaps?}`. This is the
     node's own verdict, not a report on work you did — `accept:false` fails the node exactly
     like a model's own rejection would, and `gaps[]` reaches the retry the same way a model
     gate's `gaps[]` does. `changed_files`/cross-check do not apply to this kind either.
4. Call `tm_submit({task_id, key, payload})` and render the reply's `result`.
5. **The cross-check**: for anything but a decision card, `payload.changed_files` is compared
   against what actually changed in that node's own worktree (`git status`, the same check a
   vendor's report gets) — not taken on your word. A file you claimed but did not touch there
   comes back in `contradicted_files`, `changed_files_verified: false`, and `stage_ok` flips to
   `false` regardless of what `payload.stage_ok` said, with `verification_error` naming exactly
   which claimed files weren't found changed. This is not a formality: it exists because a prior
   version trusted a human's `stage_ok` at face value with no check at all.
6. A rejection sends the next attempt back to `waiting_human` for the same human, not to a
   model — no need to `take` it again.

## Output Template

```
E-a1b2c3d4/P2/U1   stage: implement   state: done   stage_ok: true
changed_files_verified: true          change_attribution: isolated
```

On a contradiction:

```
E-a1b2c3d4/P2/U1   stage: implement   state: failed   stage_ok: false
changed_files_verified: false         change_attribution: isolated
verification_error: claimed changed_files not present in the worktree: src/payment/retry.ts
```

A decision card prints just the verdict line — `changed_files_verified` never applies to it:

```
E-a1b2c3d4/P2/ask:1   stage: ask   state: done   stage_ok: true
```

A `human_gate` card prints the same bare verdict line, plus the verdict field the stage judges
on (`accept`/`sound`/`verified`, whichever the stage has) and, on a reject, `gaps`:

```
E-a1b2c3d4/TASK/critique   stage: critique   state: failed   sound: false
gaps: ownership overlap between P1 and P2
```

## What Claude Does

Calls `tm_submit({task_id, key, payload})` with the key exactly as given and the payload exactly
as the human describes their own work — never inflates `stage_ok`, never edits `changed_files`
to make the cross-check pass. Renders the verdict above.

## What You Do

Finish the work in the briefed worktree before calling this. Name the TASK key and, for an
authoring stage, the files you actually changed — the cross-check does the rest.

## Related Skills

- `inbox` — find the TASK key and its briefing before you start
- `take` — claim a card before doing its work
- `board` — every EPIC, or one EPIC's STORY kanban
- `ticket` — one ticket's full detail, EPIC or STORY
