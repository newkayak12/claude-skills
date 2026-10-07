# 02 — teams mod: watch runs without polling from the model

> Produced by write:plans (2026-10-06). Starts after `00-spike-findings.md` passes.
> Governing doc: `_repo/docs/plans/2026-09-28-teams-cards-everywhere.md` (cards are the human
> surface) + memory rule "human-readable status surfaces": MCP returns stay machine-shaped,
> people get a separate surface. Design-change rule applies (teams behaviour).

**Goal:** a person driving teams in an interactive session sees each run's progress in a pane,
a status line and toasts, and the lead model no longer tails `ledger.jsonl` or calls `tm_board`
just to report progress.
**Architecture:** all logic that parses task files stays in node (`teams/scripts/`), tested
with node:test, exposed through two new `view.mjs --once` formats. The mod (`teams/hooks/mod.tsx`)
only runs those CLIs with `$.process.run`, keeps a cursor in `$.state`, and draws. Nothing
in `teams/mcp/` changes.
**Tech stack:** node:test; mod API (`ui.render` Pane/AbovePrompt, `$.ui.status`, `$.ui.toast`,
`$.clock.every`, `$.command.register`, `tool.call`); `claude plugin validate|test`.

---

## Files

| Path | Owns |
|------|------|
| `teams/scripts/lib/view-events.mjs` (new) | `notableEvents(lines, sinceTs)` → `[{ts, task_id, kind, text}]`; `statusLine(rows)` → one line |
| `teams/scripts/view.mjs` (modify) | `--format status` and `--format events --since <ts>` under `--once` |
| `teams/scripts/test-view-events.mjs` (new) | node:test for both functions and both CLI formats |
| `teams/hooks/hooks.json` (modify) | add `"modules": ["./mod.tsx"]` beside the existing command hook |
| `teams/hooks/mod.tsx` (new) | the mod |
| `teams/types/index.d.ts` (new) | `PluginState['teams']` contract |
| `teams/.claude-plugin/plugin.json` (modify) | `"types": "./types/index.d.ts"`, version |
| `teams/hooks/mod.test.ts` (new) | `claude plugin test` cases |

## Notable events (the toast list)

From the ledger names used today (`teams/mcp/taskmanager.mjs`, `daemon.mjs`):

| ledger event | condition | toast text |
|---|---|---|
| `node_finish` | `state === 'failed'` | `E-<id8> <node_id> failed` |
| `waiting_human` | any | `E-<id8> needs you: <node_id>` |
| `child_driver_capacity` | any | `E-<id8> paused: provider limit` |
| `daemon_done` | any | `E-<id8> finished: <state>` |
| `daemon_exhausted` | any | `E-<id8> stopped: daemon restarts used up` |
| `upstream_fix_rounds_exhausted` | any | `E-<id8> <package>: fix rounds used up` |

Everything else is silent (it still shows in the pane).

---

### Task 1: `notableEvents` and `statusLine`
**Files:** create `teams/scripts/lib/view-events.mjs`, `teams/scripts/test-view-events.mjs`.
**Interfaces:** produces `notableEvents(lines: string[], sinceTs: number)` and
`statusLine(rows: {id, state, done, total, current}[])`.
**Pass bar:** `node --test teams/scripts/test-view-events.mjs` green with: a failed and a done
`node_finish` → only the failed one returned; events at or before `sinceTs` dropped; a torn
last line (no closing brace) ignored; `statusLine([])` → `''`; two running tasks →
`teams: E-1a2b3c4d 7/12 P3 implement · E-5e6f7a8b 2/9 shape`.

- [ ] 1: tests (red) → 2: implement (pure, no fs) → 3: green → 4: commit

### Task 2: `view.mjs --once --format status|events`
**Files:** modify `teams/scripts/view.mjs`; extend `test-view-events.mjs`.
**Interfaces:** consumes Task 1; `--format status` prints one JSON object
`{"line": statusLine(rows), "waiting": <count of waiting_human cards>}` for running tasks under
`--tasks-dir` whose `cwd` is `--cwd` (default: all); `--format events --since <ts>` prints
one JSON object per line from the LAST 256 KiB of each running task's `ledger.jsonl` (read
from the end, so a large ledger costs the same).
**Pass bar:** a fixture tasks dir (two task dirs: one running with 3 ledger lines, one done)
→ `--format status` prints exactly the running one; `--format events --since 0` prints the
notable lines only; a 5 MB fixture ledger completes in < 300 ms.

- [ ] 1: tests (red) → 2: implement → 3: green → 4: run the full `node --test teams/scripts/test-*.mjs` → 5: commit

### Task 3: Module skeleton, interactive-only start
**Files:** create `teams/hooks/mod.tsx`, `teams/types/index.d.ts`, `teams/hooks/mod.test.ts`;
modify `teams/hooks/hooks.json`, `teams/.claude-plugin/plugin.json`.
**Interfaces:** state contract
`PluginState['teams'] = { cursor: number; watch: string[]; status: string; waiting: number; view: 'tickets'|'pipeline'|'events'; events: TeamsEvent[] }`
where `TeamsEvent = { ts: number; task_id: string; kind: string; text: string }`.
**Pass bar:** `claude plugin validate teams` lists `session.start` and the module with the
command hook intact; `mod.test.ts`: with `$.session.surfaces()` mocked to `[]` the start hook
registers no timer and opens nothing; with `['terminal']` it registers the commands.

- [ ] 1: test (red) → 2: `session.start`: `if ((await $.session.surfaces()).length === 0) return next(e)`; else register `/teams-live` and start the timer of Task 4 → 3: green → 4: commit

### Task 4: Status line + toasts from one 3-second tick
**Files:** modify `teams/hooks/mod.tsx`, `teams/hooks/mod.test.ts`.
**Interfaces:** consumes Task 2's CLI through
`$.process.run(['node', VIEW, '--once', '--format', 'events', '--since', String(cursor)])`
and `... '--format', 'status', '--cwd', <session cwd>` (`VIEW` = `${$.plugin.root}/scripts/view.mjs`, per 00-spike-findings §4).
**Pass bar:** mod test with `$.process.run` mocked: tick 1 returns two events → two
`$.ui.toast` calls, `cursor` = the later ts; tick 2 returns the same events → no toast;
status output `{"line":"","waiting":0}` → `$.ui.status(undefined)`, `waiting` 0; a run that exits non-zero → no toast, no throw,
status unchanged.

- [ ] 1: tests (red) → 2: `$.clock.every(3000, tick)`; tick keeps one run in flight at a time;
  appends to `events` (last 200) → 3: green → 4: commit

### Task 5: `/teams-live` pane
**Files:** modify `teams/hooks/mod.tsx`, `teams/hooks/mod.test.ts`.
**Interfaces:** `command.run` `{ command: 'teams-live' }` opens pane `teams-live`;
`ui.render` `{ component: 'Pane', requestId: 'teams-live' }` draws the text of
`view.mjs --once --task <id> --view tickets|pipeline` in a `Code`-free `Text` column plus
Buttons `[tickets] [pipeline] [events]`; the view kind is `$.state` `teams.view`.
**Pass bar:** mod UI test on `terminal` and `desktop`: opening with one watched task draws its
tickets text; pressing `[events]` draws the last `events`; no watched task draws
`No teams run in this session.`; the pane never opens unasked when
`e.viewport.isFullscreen` is false.

- [ ] 1: tests (red) → 2: implement; refresh the drawn text on the tick of Task 4 via
  `$.state` → 3: green → 4: commit

### Task 6: Watch the runs this session opens
**Files:** modify `teams/hooks/mod.tsx`, `teams/hooks/mod.test.ts`.
**Interfaces:** `tool.call` hook (react only, never gating) on tools whose name ends with
`__tm_open` or `__tm_run`: `const r = await next(e)`; parse `task_id` from the result; add to
`watch`; return `r` unchanged.
**Pass bar:** mod test: a `tm_run` result carrying `task_id: "abc"` adds `abc` to `watch` and
the result object is returned identical (deep-equal); a result with no `task_id` changes
nothing; the hook throwing still returns the tool result (`.catch(($, e, next) => next(e))`).

- [ ] 1: tests (red) → 2: implement → 3: green → 4: commit

### Task 7: Band above the prompt
**Files:** modify `teams/hooks/mod.tsx`, `teams/hooks/mod.test.ts`.
**Interfaces:** `ui.render` `{ component: 'AbovePrompt' }`: when `status !== ''`, one row:
the status text + Buttons `[board]` (opens the pane) and `[inbox <n>]` when `$.state` `teams.waiting` > 0
(set by Task 4's tick); else `next(e)`.
**Pass bar:** mod UI test: empty status → `next(e)` (nothing drawn); status set → the row
with both buttons; `[board]` press opens pane `teams-live`.

- [ ] 1: tests (red) → 2: implement → 3: green → 4: commit

### Task 8: Guard the NEVER rule on `team_status({full:true})`
**Files:** modify `teams/hooks/mod.tsx`, `teams/hooks/mod.test.ts`.
**Interfaces:** `tool.call` guard on names ending `__team_status`: `e.input.full === true &&
!e.input.node_id` → `{ deny: 'team_status full:true dumps every node; pass node_id or read detail_path (teams:orchestrate NEVER rule)' }`;
registered `.catch(($, e, next) => next(e))`. Runs in headless sessions too (no surface check).
**Pass bar:** mod test: `{full:true}` denied with that text; `{full:true, node_id:'x'}` and
`{}` pass through; a throwing guard lets the call through.

- [ ] 1: tests (red) → 2: implement → 3: green → 4: commit

### Task 9: Lead guidance + release
**Files:** modify `teams/skills/orchestrate/SKILL.md` (one line: in an interactive session
with the teams mod loaded, do not poll; the status line and toasts report progress),
`teams/CHANGELOG.md`, `teams/CHANGELOG.KOR.md`, `teams/.claude-plugin/plugin.json`,
`.claude-plugin/marketplace.json`.
**Pass bar:** `claude plugin validate teams` clean; `claude plugin test teams` green;
`node --test teams/scripts/test-*.mjs` green; validator PASSED; one real interactive session
on this repo with a small teams run shows the status line, at least one toast, and the pane —
screenshot or transcript excerpt saved in `.harness-run/<slug>/`.

- [ ] 1: edits → 2: all checks → 3: real interactive run → 4: commit + push
