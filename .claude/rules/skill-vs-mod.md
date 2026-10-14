---
paths:
  - "*/skills/**"
  - "*/hooks/**"
  - "*/mcp/**"
  - "*/scripts/**"
  - "_repo/docs/plans/**"
---

# Skill or mod — who does what

Read back from what ships today (skills under `*/skills/`, mods in `graph`, `harness`, `session`,
`teams`, `trophy` `hooks/*.tsx`). Before adding or changing either, put the work on the side whose
column it matches.

| | Skill (`SKILL.md` + scripts/MCP) | Mod (`hooks/*.tsx`) |
|---|---|---|
| Is | the procedure: what the model thinks and does, in order, and what it produces | the session around the model: what a person sees, and what the client enforces |
| Runs | in the conversation, when invoked or triggered | on client events (`session.start`, `tool.call`, `turn.complete`, timers), whether or not a skill is running |
| Owns | steps, judgment, gates the model must pass, artifacts (`deck.pdf`, `05-report.md`, task files, ledgers) | panes, band lines, status line, toasts, push; tool-call guards; context injection (`prompt.context`, memo) |
| Data | writes the files and ledgers | reads them only (`teams/scripts/view.mjs --once`, run JSON, `.harness-run/`); never the source of truth |
| Logic | parsing and decisions live in node/python with their own tests | renders what that code returns; no parsing worth testing inside the tsx |
| Without the other | works fully — headless `claude -p`, Codex, older clients | is never required: removing `modules` loses only the surface |
| Example | `teams:develop` runs the EPIC; harness stages write the run files; `think:brainstorming` runs the debate | `/teams-status` shows teams, cards, decisions; session guard confirms a dangerous command; trophy toasts an unlock |

Rules that follow:
- A behaviour a person must not skip (a gate, a deny) is enforced where every client sees it — the
  skill's engine or a plain command hook — and a mod may add a friendlier surface on top.
- When a pane needs something no file records (a reason, an actor), the fix is a field the skill's
  engine writes, not inference in the mod.
- A skill never draws UI or waits on a pane; a mod never decides an outcome a skill owns.
- One pane per plugin, opened by `/<name>-status` or its band line; closes on Esc, q and its
  command again.
- Shared mod rules (interactive only, fail-open guards, `$.state`, Ink): `_repo/docs/plans/mod/README.md`.
