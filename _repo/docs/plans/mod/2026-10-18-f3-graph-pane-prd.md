# F3 - Graph pane: own band, owned runs, last step (card 42, G)

Section F3 of the mod-detail PRD. Evidence: `_repo/docs/plans/mod/2026-10-18-f3-graph-pane-prd-findings.md`
(cited below as "findings F<n>"). Design source: `_repo/docs/plans/mod/2026-10-16-mod-detail-and-parallel-runs.md`
§1 graph table, §2 ownership, §3 graph mockups, §4 card G. Rules: `.claude/rules/mod.md`, especially
"A UI change is done when" rule 0.

Domain: terminal "mods" for a multi-vendor agent graph. A graph run is a chain of nodes (Implement, Test, Gate)
per subgoal, each with attempts (a rejected try is retried up to `max_retries`), an agent, and a one-line
`last_step`. A run is either standalone (a person opened it) or owned by a teams task (an S task's EPIC key
`E-xxxxxxxx`, or an L STORY key `E-xxxxxxxx/P2`). The mod is the surface around it: a band above the prompt and
a pane. The mod renders; node decides (mod.md "Parse or decide: no").

## Goal

A person running graph standalone sees their graph runs in a graph-owned band row and a graph pane that says,
per node, what the last step was, what the run has cost and how old it is. Runs a teams task owns never appear
in the standalone band or in `[`/`]`.

## Problem

- Graph has no band. Its one pane shows the newest run file under `.harness-run/broker/runs` by mtime through a
  `$.fs` scan, live meaning under 2 h and not complete (findings F9). Two standalone runs at once cannot be told
  apart or switched.
- The pane shows no owner, `created_at`, cost or `last_step`, though the broker writes them (findings F4). Its
  dismiss Button reads `close [q]`, an internal label under mod.md rule 0 (findings F9).
- The readout `runs --list` exists (findings F1; backlog card 42's "no readout yet" is stale) but its row is
  too thin to draw from: no full run_id, request, nodes[], max_retries, last-change time, open/stalled flag, or
  routing_blocked (findings F3). The mod therefore scans files itself, which puts logic in the tsx.
- Owner is stored but never set by a caller, and the `graph_open` owner text names only the STORY key, not an
  S task's EPIC key (findings F6, F17, F18).
- A teams-owned run has no way to be opened by path, including one under `<pkg cwd>/.teams_output/broker/runs`
  (findings F19).

## Target users

- A person running graph standalone, one to three runs at once, who wants to see which run waits on them,
  which node is working, what its last step said and what it has cost. Today they read the pane for the newest
  file and guess.
- A person who opens a graph run from a teams STORY and needs to know it belongs to that task ("under E-…/P2").
- The building package and reviewers, who need node-tested readout fields and demo renders to approve the look
  (the person approves the look after the Sprint, from the demo renders: session decision).

## Solution overview

The node readout `runs --list --json` is extended so one row alone draws both band and pane. It also decides
open versus stalled. The mod calls it through `$.process.run`, on a 5 s tick, keeping the last good list on
failure. An 800 ms spinner runs only while a shown run acts and a surface exists. One more readout call,
`runs --show <run-file> --json`, returns one run in the same row shape for a run opened by path.

The band adds one graph-owned row for the leading standalone run, and `+N` for the rest. The row never
includes a run whose owner is set. The pane draws §3 graph: header (id, state, age, cost, "run k of n"), a Now
line with try, agent and elapsed, the last step with its age, a waits line, one line per subgoal node
(impl, test, gate, try, agent, time), the rejection carried into a retry, and gates done of total. `[` and `]`
move between standalone runs through a focused Ink Input plus prev/next Buttons. The first run on `[` and the
last on `]` stay as they are: no wrap.

When opened with `/graph-status open <run-file> <owner-key>`, the pane shows the run and the tag
"under E-…/P2" from the owner key in the command. Drawing goes in a graph-local `graph-draw.tsx`; the shared
`draw.tsx` stays untouched.

### Scope

In:
- Readout extension, open/stalled rule and `runs --show` in `graph/mcp/broker.mjs`, with node tests.
- The owner end-to-end broker test with an S-task EPIC key, and the `graph_open` owner schema text.
- Graph band row, owned-run skip, pane §3 graph, `[`/`]` with no wrap, the owner tag, the `/graph-status open`
  parser and receiving side, demo fixtures, `graph/types/index.d.ts` additions, graph README/KOR text.

Dependencies on other areas (stated, not built here):
- The graph band relies on F2-US-8: the harness status line stops counting graph runs there (the
  `graph Implement(3)` text), so a graph run is not shown twice. F3 has no story or criterion for that edit and
  edits nothing in `harness/`.
- The `owner` the pane prints is passed by teams when it opens an S task's graph run; that prompt change is
  F4-US-8. F4 changes nothing under `graph/`.
- `[`/`]` end behaviour is the same as F2-US-7 and F4-AC-26: stay at the ends.
- Teams' `g` key and its use of the `/graph-status open` interface are F4's.

Decided rules (settled in the decision record; each holds for every story below):
- Open: run not finished and last change under 12 h; stalled: last change 2 to 12 h, shown as stalled. The rule
  lives in node and uses harness thresholds (no report, under 12 h, stalled 2 to 12 h). Mapping "no report" to
  "not finished" for a graph run is (default - revisit with F3 PO).
- 5 s list tick; 800 ms spinner only while a shown run acts and a surface exists.
- `cost_usd` shows `—` until a writer exists. Missing values render as `—`, never invented.
- `routing_blocked` counts as waits (⚑). Opening order: waits on you, then rejected since last looked, then most
  recent.
- Demo fixture is test-only plus captures; live shots use fictional seeded run files.
- No version bump this Sprint (batched later).

## Success criteria

1. `node broker.mjs runs --list --json` returns the extended row, and node tests cover every new field (counts
   reported per `.claude/conventions/verification.md`).
2. With one owned and one standalone run, the band shows only the standalone one and `[`/`]` list only it.
3. The pane draws nodes with `last_step`, cost (`—` when null) and age for fixtures minimal, full, parallel,
   narrow at 190 and at 110 columns, with no wrap and long text ending in `…`.
4. `[` on the first run and `]` on the last leave the selection unchanged.
5. `/graph-status open <run-file> <owner-key>` shows the "under <owner-key>" tag, and the tag is absent
   otherwise.
6. `python3 _repo/scripts/validate_plugins.py`, `node _repo/scripts/check-copies.mjs`,
   `cd graph && claude plugin test .` and `node --test graph/scripts/test-broker.mjs` pass, counts reported.
7. One live tmux session shows band, pane and key focus at 190 and 110 columns.

Conventions applied: `.claude/conventions/verification.md` (counts reported, plus one end-to-end exercise;
its command slots are unfilled templates, so the per-plugin checks in `maintaining.md` fill them);
`.claude/conventions/boundaries.md` (an unfilled template; ownership comes from the integrate notes: graph/ is
F3's, teams/ is F4's, the harness status line is F2's); `.claude/conventions/coding.md` (match the surrounding
file's idiom; logic in node, the mod only renders).

## User stories

### F3-US-1 Readout row carries everything the band and pane draw

As a person with a graph run, I want the node readout to give the mod a complete row, so the mod renders and
does not parse.

- F3-AC-1: Given a run with two subgoals, When `node graph/mcp/broker.mjs runs --list --json` runs, Then the row
  has full `run_id`, `request`, `owner`, `created_at`, `cost_usd`, `max_retries`, a last-change time, subgoal
  titles, `routing_blocked` and `unavailable_vendors`, and `nodes[]` with stage, state, attempt, agent,
  started and finished times, reason, feedback and `last_step`.
- F3-AC-2: Given a run last changed 1 h, 3 h and 13 h ago, When listed, Then they are open, stalled and
  not-open, as flags in the row computed in node (thresholds 2 h and 12 h as constants, one test per boundary).
- F3-AC-3: Given a run with an unfinished node, When listed, Then `last_step` of that row is the newest finished
  node's, as today (findings F7), and a run with no finished node has `last_step` null, not an invented text.
- F3-AC-4: Given the text form (no `--json`), When listed, Then it still prints one line per run and the existing
  tests for the old fields pass unchanged.
- F3-AC-5: Given each new field above, Then `node --test graph/scripts/test-broker.mjs` has a named test for it,
  with the passing count reported.

### F3-US-2 Read one run by file path

As a person opening a graph run from teams, I want the pane to read a run file outside the session folder.

- F3-AC-6: Given a run file path (including one under `<pkg cwd>/.teams_output/broker/runs`), When
  `runs --show <run-file> --json` runs, Then it returns one row in the same shape as `--list` (harness `--show`
  precedent, findings F13).
- F3-AC-7: Given a teams-engine file with no `owner`, `cost_usd` or `last_step` (findings F19), When shown, Then
  those fields are null and the row is otherwise complete.
- F3-AC-8: Given a missing or unreadable path, When shown, Then it exits non-zero with one line on stderr and
  writes nothing (the readout never writes, reclaims or locks).

### F3-US-3 Owner passes end to end, and `graph_open` names the EPIC key

As a teams author, I want `owner` to reach the readout for both a STORY and an S task, and the schema to say
which key an S task uses.

- F3-AC-9: Given `graph_open` with owner `{task_id, key: "E-abcd1234"}` (an EPIC key, no `/Pn`), When
  `runs --list --json` runs, Then the row's `owner` equals it. The test is new and is named in
  `test-broker.mjs` next to the L-key test (findings F5).
- F3-AC-10: Given the existing L-key test (`E-abcd1234/P2`), When the suite runs, Then it still passes.
- F3-AC-11: Given the `graph_open` tool schema, When read, Then the `owner` description names the EPIC key
  `E-xxxxxxxx` for an S task and the STORY key `E-xxxxxxxx/Pn` for an L package, and says to omit it for a
  standalone run. A test reads the schema text.

### F3-US-4 Graph-owned band row that skips owned runs

As a person with standalone runs, I want a band row for them that never shows a teams task's run.

- F3-AC-12: Given one standalone open run, When a surface exists, Then the band shows one graph row (name,
  ⚑ when waiting, node and last step, age, cost), per mod.md rule 0: facts on that line, icon and colour first,
  no internal labels.
- F3-AC-13: Given one run with an owner and one without, When the band draws, Then the owned run has no row and
  adds nothing to `+N`.
- F3-AC-14: Given several standalone open runs, When the band draws, Then the leading run has its row and `+N`
  counts the rest, in the opening order (waits on you, rejected since last looked, most recent).
- F3-AC-15: Given no surface (headless `claude -p`), When the mod loads, Then no timer, spinner or band starts.
- F3-AC-16: Given a failed `$.process.run`, When the tick fires, Then the last good list stays and nothing
  throws (guards fail open).
- F3-AC-17: Given a stalled run, When the band draws, Then it reads stalled with its age, dimmed, not as working.
- F3-AC-18: Given the harness band, Then it is unchanged by F3. The graph band relies on F2-US-8 for the
  harness status line (dependency only).

### F3-US-5 Pane draws §3 graph: nodes with last step, cost and age

As a person watching a run, I want one pane that says what it is doing and what it has cost.

- F3-AC-19: Given a run, When the pane opens, Then the header holds id, state, age from `created_at`, cost and
  "run k of n"; a Now line holds the working node, subgoal, try n of max, agent and elapsed; and the last step
  shows with its age.
- F3-AC-20: Given a run with three subgoals, When drawn, Then each subgoal is one line: impl, test and gate
  state icons, try, agent and time, columns aligned across rows (mod.md rule 0).
- F3-AC-21: Given a rejected try, When drawn, Then one `↳ try n rejected: …` line carries the reason and
  feedback into the retry, ending in `…` when long.
- F3-AC-22: Given `cost_usd` null, When drawn, Then the cost reads `—` in the header and band.
- F3-AC-23: Given `routing_blocked`, When drawn, Then a ⚑ line says the run waits on the person (and names
  `unavailable_vendors` when present).
- F3-AC-24: Given the pane, Then the dismiss Button sits inside one dim footer with its label `q`, keys appear
  only in that footer, and no word appears twice or as an internal label.
- F3-AC-25: Given the spinner, When no shown run acts, Then no 800 ms timer runs.

### F3-US-6 `[` and `]` move between two standalone runs, no wrap

As a person with two standalone runs, I want to switch between them from the keyboard or by pointer.

- F3-AC-26: Given runs A and B with A selected, When `]` is pressed, Then B is selected, and When `[` is pressed
  again, Then A is selected.
- F3-AC-27: Given the first run selected, When `[` is pressed, Then the selection is unchanged (no wrap). Named
  test: first-run end.
- F3-AC-28: Given the last run selected, When `]` is pressed, Then the selection is unchanged (no wrap). Named
  test: last-run end.
- F3-AC-29: Given exactly one run, When `[` or `]` is pressed, Then the selection is unchanged. Named test:
  one-run case.
- F3-AC-30: Given the pane, Then the keys reach it through a focused Ink Input plus prev/next Buttons as the
  pointer path (mirrors harness), and the header names only keys that work.
- F3-AC-31: Given a new run appears while one is selected, When the list ticks, Then the selection stays on
  the same run. First open follows the order: waits on you, rejected since last looked, most recent.
- F3-AC-32: Given an owned run in the list, Then `[`/`]` never reach it.

### F3-US-7 Owner tag and `/graph-status open <run-file> <owner-key>`

As a person who opened a graph run from teams, I want to see which task it is under.

- F3-AC-33: Given `/graph-status open /x/.teams_output/broker/runs/r1.json E-3f9a21c0/P2`, When run, Then a
  pure node-side parser (following harness `parseDemoArg`, findings F20) returns the file and owner key, the
  command registers an `argumentHint`, and the pane opens that run through `runs --show`.
- F3-AC-34: Given a run opened this way, When drawn, Then the tab row carries "under E-3f9a21c0/P2" from the
  owner key in the argument, and the tag is absent for a run opened any other way.
- F3-AC-35: Given the opened run has no cost or last step (a teams-engine file), Then both read `—`.
- F3-AC-36: Given a missing file, a missing owner key or extra arguments, When parsed, Then the parser returns
  a one-line usage message and the pane does not open.
- F3-AC-37: Given a run opened by path, Then it does not appear in the band and does not join `[`/`]`.
- F3-AC-38: Given the interface, Then it is the only way F3 builds to open a given run. Whether F4 fires it is
  open question 1.

### F3-US-8 Demo fixtures at 190 and 110 columns

As the person who approves the look, I want demo renders of every state.

- F3-AC-39: Given a test-only `renderDemo(scenario, width)` in graph, When run for minimal, full, parallel and
  narrow at 190 and 110, Then each prints band and pane lines (findings F21).
- F3-AC-40: Given every fixture and width, Then no line exceeds the width, no row breaks onto a second line (no wrap), no label is
  pushed under another, no glyph is cut, and long text ends in `…` (asserted in a test).
- F3-AC-41: Given the parallel fixture, Then it shows two standalone runs plus one owned run that is absent.
- F3-AC-42: Given the new drawing code, Then it lives in `graph/hooks/graph-draw.tsx`, `draw.tsx` and
  `draw.test.ts` are unchanged and `node _repo/scripts/check-copies.mjs` prints its `ok:` line.
- F3-AC-43: Given `graph/types/index.d.ts`, Then `GraphRun` and `GraphNode` gain owner, created_at, cost_usd
  and last_step, and `claude plugin test .` stays green with its count reported.

### F3-US-9 Seen live, and introduced in the README

As the person who approves the look, I want to see it work in a real session.

- F3-AC-44: Given `claude --plugin-dir ./graph` in tmux with fictional seeded run files, When the pane is
  opened by `/graph-status` and by its band row, Then it closes on Esc, `q` and the command again.
- F3-AC-45: Given widths 190 and 110, Then `[`/`]` are tried with no click first; the result (works or
  needs a click) is written in the Sprint report. A failure is stated as partial, not hidden.
- F3-AC-46: Given the shot tool `_repo/scripts/mod-shot.py`, Then one image per changed surface (band, pane,
  tag) is taken from fictional data, never a real project.
- F3-AC-47: Given `graph/README.md` and `graph/KOR.md`, Then both show each image with one or two lines on
  what it tells the person and when, and the "newest run under the session folder" wording is replaced.
  Status-log lines wait for the batch bump.

## Out of scope

- Teams-side STORY to graph navigation (`g`) and teams/mcp changes: F4. F3 pins the interface; F4 builds the key.
- The harness status-line graph count and its tests: F2-US-8. F3 depends on it and edits no harness file.
- The teams/mcp owner prompt line: F4-US-8. F3 edits only the graph-side schema text.
- Version bumps (batched later) and status-log lines.
- A `cost_usd` writer: the field stays null and the pane shows `—`.
- A `last_step` progress writer for running nodes (findings F7): the newest finished node's text is shown.
- The browser page, and any change to `draw.tsx`.
- Cycling past either end with `[`/`]` (no wrap); the harness pane's own end behaviour (F2).

## Open questions

1. F4 adoption of `/graph-status open <run-file> <owner-key>`. Owner: F4 lead / plan-integrate. F4-AC-33 and F4's
   own question leave it as "command or state key", and no mod in the repo fires another plugin's command
   (findings §5.1). Recommendation: F4 adopts this command and fires it through a mod API that runs a command
   (default - revisit with F4 lead).
2. Live `[`/`]` focus with no click. Owner: the building package, seen by the person in tmux. Unit tests cannot
   show it, and harness accepted it as partial. Recommendation: verify once at 190 and 110; keep prev/next
   Buttons as the pointer path (default - revisit with the person).
