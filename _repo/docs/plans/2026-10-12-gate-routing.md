# Gate routing — one instruction when harness, graph and teams gates meet

Status: plan, awaiting approval (2026-10-12).

## Problem

A project can opt into two edit gates through install:
- `harness:install` writes `.claude/harness-gate.json` (harness `goal-gate.mjs`).
- `teams:install` writes `.claude/teams-dispatch.json` (teams `dispatch-gate.mjs`).

When both are present and Claude edits a gated file, both deny it, each with its own instruction:
- harness says "invoke the harness skill (graph MCP / Workflow / fallback)".
- teams says "invoke teams:orchestrate".

Either path unlocks both gates (`tm_open` counts for harness; harness markers count for teams), so
nothing deadlocks, but which engine runs is left to chance.

## Decision (user, 2026-10-12)

Route by kind, only when teams and harness or graph were set up by install:

| Installed in the project | Simple development only | Anything else |
|---|---|---|
| harness + teams | harness | `teams:orchestrate` |
| graph + teams | graph | `teams:orchestrate` |
| harness + graph + teams | graph (harness when the graph MCP is absent) | `teams:orchestrate` |

Simple development = a code change with its tests in one area. If the work needs a spec document,
planning, or QA — or touches several areas, or it is unsure — it goes to teams.

When the gates meet (a gated edit denied while both teams and harness/graph are installed), one
toast says so and names the route; the two gate toasts do not both fire.

With one gate only, nothing changes: each gate keeps its current message.

## Change

1. Both gates build the same deny text from what the project has installed:
   - harness installed = `.claude/harness-gate.json` exists.
   - teams installed = `.claude/teams-dispatch.json` exists.
   - graph installed = a `graph-engineering` server in the project `.mcp.json`, or
     `graph@newkayak12-claude-skills` enabled in the project or user settings.
2. Text when teams and harness or graph are both installed: "Judge the size. Small → <graph | harness
   skill>; large or unsure → `Skill({skill: "teams:orchestrate"})`." Unsure goes to teams, since
   teams sizes again and runs a small request as one run.
3. The text-building function is the same in both gates. It is one small function, copied
   byte-identical and listed in `_repo/scripts/check-copies.mjs`, so the two cannot drift.
4. Gate verdicts (allow or deny) do not change. Only the deny message changes.

## Done criteria (AC-n)

- AC-1: Given harness and teams gate configs, when a gated edit is denied, then both deny messages
  are identical: simple development → the harness skill; spec, planning, QA, several areas or
  unsure → `teams:orchestrate`.
- AC-2: Given harness, teams and graph installed, then simple development names graph (harness as
  the fallback when the graph MCP is absent) and everything else names `teams:orchestrate`.
- AC-3: Given graph and teams (no harness config), then teams' message names graph for simple
  development and itself for the rest.
- AC-7: Given the gates meet, when an edit is denied, then exactly one toast appears, naming the
  conflict and the route (not one toast per gate).
- AC-4: Given one gate config only, then its message is unchanged from today (existing tests pass).
- AC-5: No allow/deny verdict changes. The harness gate suite, teams test suite and `check-copies` pass.
- AC-6: `harness/hooks/goal-gate.mjs` stays byte-identical to `.claude/hooks/goal-gate.mjs`.

## Critique

- Principle (the gate fails open and never bricks a session): only text changes, and detection
  failure falls back to today's message.
- Principle (simplicity): no new hook, no new config. Size is judged by the model, not by the gate.
- Risk: reading user settings from a hook. It reads only `enabledPlugins` for one key and fails
  open, never printing anything else.
- Out of scope: teams' own S/L sizing and graph's engine, which are unchanged.
