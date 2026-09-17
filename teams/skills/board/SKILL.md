---
name: board
description: >-
  Use when the user wants a status board of teams runs via tm_board — every EPIC, or one
  EPIC's STORY kanban. Triggers: "보드 보여줘", "티켓 현황", "show me the board", "what EPICs
  are running". Read-only, prints a table, never raw JSON or a doc's contents.
scenarios:
  - "Show me every EPIC teams knows about and their state"
  - "What does the STORY kanban for E-a1b2c3d4 look like right now"
  - "지금 돌아가는 EPIC들 목록이랑 상태 보여줘"
  - "E-a1b2c3d4 스토리 칸반 좀 보여줘"
compatibility:
  required:
    - task-manager
related:
  - ticket
  - orchestrate
---

# board — tm_board, rendered as a table

`tm_board` is read-only and derives every state from `task.json` itself — never a second source
of truth. This skill calls it and prints the Output Template below; it makes no decisions.

## Process

1. No EPIC named → `tm_board({})` → the epic-list table.
2. An EPIC named (`E-xxxxxxxx`) → call `tm_board({task_id: "E-xxxxxxxx"})` with the key straight
   through; `tm_board` resolves it the same way `tm_ticket` does, so no lookup round trip is
   needed here (a full `task_id` from earlier in the session also still works, unchanged).
3. Render exactly the fields the reply carries; do not add columns for data it doesn't return
   (no vendor/model, no human-inbox counts, no gate status — those come from tooling this round
   didn't build).
4. If the human wants the long form, name `doc_path` rather than reading the md into context —
   render it first with `tm_docs({task_id})` if it doesn't exist on disk yet.

## Output Template

Epic list (no EPIC named):

```
| key        | title              | state       | phase |
|------------|--------------------|-------------|-------|
| E-a1b2c3d4 | 결제 취소 기능       | IN_PROGRESS | impl  |
| E-b2c3d4e5 | 알림 배치 정리       | DONE        | report|
```

One EPIC (named):

```
## E-a1b2c3d4  결제 취소 기능              state: IN_PROGRESS   phase: impl   leader: pid 4121 alive

| key  | role     | state        | tasks | last verdict |
|------|----------|--------------|-------|--------------|
| PLAN | planning | DONE         | 1/1   | accept 92    |
| P1   | develop  | DONE         | 3/3   | accept 94    |
| P2   | develop  | IN_PROGRESS  | 2/5   | —            |
| P3   | develop  | WAITING_USER | —     | —            |
| QA   | qa       | READY        | —     | —            |

doc: .teams_output/team/E-a1b2c3d4/INDEX.md
```

`role` is `develop` for an ordinary package. `planning` and `qa` are the phase-Team rows that
`.claude/team.json`'s `roles.planning`/`roles.qa` switches insert into the EPIC flow, each
appearing only when its switch is on: `planning` (key `PLAN`) is always the first row — it drafts
the PRD `shape` reads, before `shape` runs at all. `qa` (key `QA`) is always the last row — it
runs between `integrate` and `gate:goal`, reusing the repair worktree. `tasks` is `—` when no
dispatch has started a child run. A row whose story carries `reporter: repair` is a QA-raised
defect story, not original scope — call it out in prose under the table.
`leader` prints `none` when the task has none yet.

## What Claude Does

Calls `tm_board` with the right argument — the EPIC key or a full `task_id`, passed straight
through — and renders the table above — nothing more.

## What You Do

Name an EPIC key for its kanban, or nothing for the full list. Open `doc_path` yourself for the
long form; the skill won't paste it into the conversation.

## Related Skills

- `ticket` — one ticket's full detail, EPIC or STORY
- `orchestrate` — drives the run this board reports on
