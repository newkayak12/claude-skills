---
name: log
description: >-
  Use when following what one teams ticket is doing right now (tm_log). Triggers: "P2 지금 뭐 하고 있어",
  "로그 보여줘", "tail the log for E-xxx/P2", "what is this story doing".
scenarios:
  - "Show me the last 30 lines of what E-a1b2c3d4/P2's driver is doing"
  - "Tail the EPIC's event log and show me only what's new since last time"
  - "E-a1b2c3d4/P2 로그 마지막 50줄 보여줘"
  - "이 EPIC 이벤트 로그 새로 생긴 것만 이어서 보여줘"
compatibility:
  required:
    - task-manager
related:
  - ticket
  - board
  - inbox
---

# log — tm_log, rendered as a tail

`tm_log` is read-only and reads a log the key already points at: a STORY key follows its latest
dispatch's driver stream, an EPIC key follows the task ledger. It reads the file from its end and
returns only the last `tail` lines, already rendered one event per line. This skill calls it and
prints the Output Template below; it makes no decisions.

## Process

1. Take the key as given: `E-xxxxxxxx/Pn` for a STORY's driver, `E-xxxxxxxx` for the EPIC
   ledger (`E-xxxxxxxx/S` for a size-S task's single run). A TASK key (`.../Pn/U1`) is refused —
   use its STORY; that driver's stream covers every stage of the child run.
2. Call `tm_log({key, tail})` — `tail` defaults to 50 (max 500). Pass a number only if the user
   named one.
3. Print the Output Template. `lines` are already readable; print them as-is, in order.
4. To follow ("what's new since"), call again with `since: <cursor>` from the previous reply —
   only lines appended after it come back.
5. If `note` is set (no dispatch has started yet), print it instead of an empty block.

## Output Template

```
E-a1b2c3d4/P2  driver  dispatch:P2:1  alive      (EPIC: E-a1b2c3d4  ledger)
log: ~/.harness/tasks/<task_id>/drivers/dispatch_P2_1.stream.jsonl
--- last 3 of more (truncated) ---
assistant -> Bash npm test
<- ERROR 1 failing
result success turns=7 cost=$0.5000: done
cursor: 184213   (pass as since: to continue)
```

`alive` is the driver's (or, for an EPIC, the daemon's) pid liveness — `dead`/`—` otherwise.
Print `(truncated)` only when `truncated` is true (older lines exist). Driver lines read
`init model=...`, `assistant says: <text>`, `assistant -> <Tool> <what>`, `<- [ERROR] <result>`,
`result <subtype> turns=N cost=$X: <text>`, `rate_limit <status>`. Ledger lines read
`HH:MM:SS <event> k=v ...` (UTC).

## What Claude Does

Calls `tm_log({key, tail?, since?})` and prints the tail above — nothing more. Never reads the
log file directly and never asks for `raw: true` unless the user wants the exact JSON.

## What You Do

Give a ticket key, STORY or EPIC, and optionally how many lines. Say "more" or "what's new" to
continue from the last cursor.

## Related Skills

- `ticket` — the same key's state, worktree and last verdict
- `board` — every STORY of the EPIC at a glance
- `inbox` — work waiting on you rather than on a driver
