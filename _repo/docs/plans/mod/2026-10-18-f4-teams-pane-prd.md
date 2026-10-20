# PRD section F4 — Teams pane: every STORY at work, a Floor, several EPICs, stalled tasks (card 41, T)

Domain: this is a supervisor surface for an agent-team task manager (teams). A request becomes an EPIC (size L: several STORY packages, each run by its own `claude -p` driver in its own worktree, with a PLAN stage, a judge and a daemon) or an S task (one harness run behind one driver). The people who read it are not watching code; they are watching workers: who is acting, who is waiting on me, who died, who passed what to whom, what it costs. The vocabulary the pane must use is the engine's own: EPIC, STORY, driver, daemon, ledger, verdict, try/max, waiting_human, stalled. Source for every "today" statement below: `prd-F4-findings.md` (items cited as finding N).

## Goal

A person running teams sees, in the teams pane and its band, six things: every STORY at work on one row, a Floor with one line per worker and a hand-off feed, every open EPIC of the cwd switchable with `[` and `]`, a task with no live driver reading stalled, `g` to open a STORY's graph run, and a band that leads with ⚑ when anything waits on a human.

## Problem

Who has it: the person who started one or more teams tasks in a repo and then leaves the terminal to do something else.

What is wrong today (findings 1-6, 11):
- The pane follows one task. `paneTask()` is the last watched id or `status.latest`; several open EPICs of one cwd exist in the data but only one reaches the pane.
- A STORY row carries a node/agent/elapsed and nothing else. There is no last verdict, no try/max, no cost, no line saying what the driver is doing. `summarize()` returns none of those fields.
- An S task with a live driver shows only stages; `model.harness` (slug, driver, moving) is built in node and not rendered.
- A task whose driver died still reads IN_PROGRESS (`epicTicketState()` looks at the task file alone). Nine-day-old tasks show IN_PROGRESS today. `runningModels` skips non-running tasks, so a stalled task is never listed at all.
- The band shows `needs you {n}` as a button but does not lead with a flag, so a question waiting on a human is easy to miss.
- No key leads from a STORY to its graph run, and no caller in teams passes `owner` to `graph_open` (finding 14), so a graph run cannot say which STORY it belongs to.

What they do instead: run `tm_status`, `tm_board` or `view.mjs --once` by hand, tail `drivers/*.stream.jsonl`, and guess from file times whether a driver is alive.

## Target users

- The person supervising one or several teams EPICs in the same repo: wants to know in one glance who is working, who waits on them, what it costs, and which task is dead.
- The person with a single S task: wants to see that it is running and at which harness stage, not an empty STORY list.
- The reviewer after the Sprint: approves the look from the demo renders (decided: the person approves after the Sprint, mod.md rule 0).

## Solution overview

The data comes from `view.mjs --once --format summary`, extended in node to cover all open and recently stalled tasks of the cwd with the new fields; the mod only renders what it returns (mod.md: logic in node, the mod draws). One call per tick stays the shape.

The pane has five tabs: Floor 1, STORYs 2, Decisions 3, Log 4, Report 5. STORYs lists every STORY at work across all listed tasks, one row each. The Floor shows the selected EPIC only: one line per worker with an icon and colour for its state and a spinner while it acts, and below it a feed of the newest five hand-offs. The header lists the other EPICs, each with a state icon. `[` and `]` move between listed tasks and stop at the first and last. Stalled tasks follow the live ones, dimmed, with their age. `g` on a STORY opens its graph run in the graph pane. The band leads with ⚑ whenever a card waits on a human.

One small change outside the mod makes `g` and the graph pane meaningful: the S-task driver prompt tells the driver to pass `owner {task_id, key}` to `graph_open`.

## Scope

In scope:
- Node: `teams/scripts/view.mjs` summary extended (all cwd tasks, items, last_verdict, per-card doing, cost_usd, try/max, driver liveness, hand-off events), a stalled rule in node, node tests.
- Mod: `teams/hooks/mod.tsx` and its own drawing file: Floor and STORYs tabs, EPIC switching, stalled listing, `g`, ⚑ band, an own 800 ms clock while a worker acts, demo fixtures, mod tests, captures.
- One change under `teams/mcp/**`: the S-task driver spawn in `teams/mcp/taskmanager.mjs` passes `owner {task_id, key}` to `graph_open` (F4-US-8).

## Success criteria

- S-1. With two open EPICs and one S task in one cwd, `view.mjs --once --format summary` lists all three; the STORYs tab shows one row per STORY at work with doing, last verdict, try/max, elapsed and cost.
- S-2. A task whose drivers have not written for 10 minutes prints stalled in every `view.mjs` output and in the pane; the word IN_PROGRESS is absent for it.
- S-3. The Floor shows one line per worker of the selected EPIC and a feed of at most five recorded hand-offs.
- S-4. `[` and `]` change the selected EPIC and stop at the first and the last.
- S-5. With a card in `waiting_human`, the band's first glyph is ⚑ and the pane shows that card and its question.
- S-6. `g` on a STORY whose child run file exists calls the graph pane's open-this-run interface with the run file path and owner.key; with no run file it does nothing.
- S-7. Demo fixtures minimal, full, parallel and narrow render at 190 and 110 columns with no row spilling onto a second line, and the person approves them after the Sprint.
- S-8. `node --test teams/scripts/test-*.mjs` and `cd teams && claude plugin test .` pass, counts reported.

## User stories

Id-to-story map (each story appears once, in this one map):

| Id | Story |
|---|---|
| F4-US-1 | node summary extension |
| F4-US-2 | stalled |
| F4-US-3 | STORYs tab |
| F4-US-4 | Floor and hand-off feed |
| F4-US-5 | several EPICs, `[` `]` stopping at the ends |
| F4-US-6 | ⚑ band |
| F4-US-7 | `g` |
| F4-US-8 | owner passed to graph_open |
| F4-US-9 | demo fixtures, widths and tests |

### F4-US-1 — The summary carries everything the pane draws

As a person supervising teams, I want one node call to return every task of my cwd with the facts of its STORYs, so that the pane draws from files and never infers.

- F4-AC-1: Given a cwd with two open tasks, When `node teams/scripts/view.mjs --once --format summary` runs, Then the output lists both tasks, not only `status.latest`.
- F4-AC-2: Given a task, When its summary is read, Then it carries `items` (one per STORY at work), and each item carries `last_verdict`, `doing`, `cost_usd`, `try` and `max`, driver liveness, and an elapsed time.
- F4-AC-3: Given a card with a stream file, When its summary item is built, Then `doing` is the tail of that card's `stream.jsonl` parsed in node; with no stream file `doing` is blank, never invented.
- F4-AC-4: Given a STORY, When its cost is built, Then `cost_usd` is the sum of its matching streams plus its child node sessions (the join key is the stream file name `drivers/<node>.stream.jsonl`, the only key the sources show; a node test pins the join), a running session with no result event yet comes from the existing estimate and is marked `~`, and a missing value is blank.
- F4-AC-5: Given a package, When `try` and `max` are read, Then `try` is the running subgoal attempt in the child run and `max` is `max_retries + 1`.
- F4-AC-6: Given a task's ledger, When hand-offs are built, Then only recorded events count (verdicts, integrated, defects_filed, tm_submit_human, waiting_human), each with its time, source and target, newest 5.
- F4-AC-7: Given the node tests, When `node --test teams/scripts/test-*.mjs` runs, Then there are named tests for two tasks in one cwd, an L EPIC with three packages, an S task with a live driver, and a stalled task, and the pass count is reported.
- F4-AC-8: Given this task directory, When the summary call is timed with `time node teams/scripts/view.mjs --once --format summary`, Then it finishes under the 3 s tick; tasks are filtered by cwd and by open or stalled state before `collectTask`, and stream cost is cached by file mtime.

### F4-US-2 — A task with no live driver reads stalled

As a person who left for a while, I want a dead task to say stalled, so that I do not wait on IN_PROGRESS that will never move.

- F4-AC-9: Given a task whose driver streams have not been written for 10 minutes, When any `view.mjs` output prints its state, Then it reads stalled and every ticket word of that task (READY, IN_PROGRESS and the rest) reads stalled; the 10 minutes is one named constant in node.
- F4-AC-10: Given the liveness rule (stream mtime plus pid when present, settled), When a driver is judged, Then it is live when its `stream.jsonl` was written within the constant and, when a pid is recorded, that pid is alive (both must hold; default - revisit with F4); a task with no live driver is stalled whether or not it has a daemon.
- F4-AC-11: Given a stream written 9 minutes 59 seconds ago and one written 10 minutes 1 second ago, When the node test runs, Then the first task is not stalled and the second is, and the test fails if the constant changes without the test.
- F4-AC-12: Given stalled tasks, When the pane lists tasks, Then they follow all live EPICs, dimmed, each with its age, and only those younger than 24 hours are listed; older ones are not listed in the pane or the summary, and a row printed by `view.mjs` for an older task still reads stalled (F4-AC-13).
- F4-AC-13: Given a 9-day-old task that today prints IN_PROGRESS, When `view.mjs` prints its row, Then it prints stalled.

### F4-US-3 — The STORYs tab shows every STORY at work

As a person supervising, I want each STORY at work on one row, so that I read its state without opening it.

- F4-AC-14: Given tasks with STORYs at work, When tab 2 is open, Then each STORY at work of every listed task is one row carrying, on that row, its state icon, title, doing, last verdict, try/max, elapsed and cost (mod.md rule 0: one item per line, facts on the line).
- F4-AC-15: Given several rows, When drawn, Then columns are aligned across rows, state is told by icon and colour before words, no word is said twice, no internal label is used, and long text ends in `…`.
- F4-AC-16: Given an S task with a live driver, When tab 2 is open, Then the task shows as running with its harness stages, and `model.harness` (slug, driver liveness, moving) is rendered on that row.
- F4-AC-17: Given a cost with `~` or a missing value, When drawn, Then `~` is kept and a missing value is blank; a standalone harness run keeps `—` unless its lead passed a cost.
- F4-AC-18: Given a test in `teams/hooks/mod.test.ts`, When it feeds the full summary, Then the row facts and alignment above are asserted.

### F4-US-4 — The Floor shows every worker and who passed what to whom

As a person supervising, I want one line per worker and a feed of hand-offs, so that I see who is acting and what moved.

- F4-AC-19: Given the selected EPIC, When tab 1 (Floor) is open, Then there is one line per worker: PLAN, each package driver and the judge; the Floor shows the selected EPIC only.
- F4-AC-20: Given a worker line, When drawn, Then it has one icon and one colour for its state (acting, idle, waiting on you, done, stalled; default - revisit with F4), a spinner next to the icon while it acts, and no character faces or art.
- F4-AC-21: Given a worker's current action, When drawn, Then it is the tail of its `stream.jsonl` parsed in node, a stale stream reads idle, and a missing value is blank.
- F4-AC-22: Given a surface and at least one acting worker, When the pane is open, Then the mod runs its own `clock.every` of about 800 ms next to the 3 s tick; with no acting worker or no surface the clock does not run (mod.md rule 2).
- F4-AC-23: Given the Floor, When read below the worker lines, Then a feed shows the newest 5 hand-offs, one per line: time, who, passed what, to whom, aligned across rows; with no recorded events the feed is empty, never filled.
- F4-AC-24: Given the header, When other EPICs are open, Then it lists them, each with a state icon.

### F4-US-5 — Several open EPICs, switched with `[` and `]`

As a person with two EPICs open in one repo, I want to list and switch between them, so that I follow each.

- F4-AC-25: Given several listed tasks, When the pane opens, Then all are listed together, live ones first (newest created first; default - revisit with F4), stalled ones after, and the selected one is marked.
- F4-AC-26: Given the first task selected, When `[` is pressed, Then the selection stays on the first; given the last task selected, When `]` is pressed, Then it stays on the last; between them each key moves by one.
- F4-AC-27: Given the pane, When keys are bound, Then they come through an autoFocus Input plus prev and next Buttons as in the harness pane, so a click or a key both work; tabs are Floor 1, STORYs 2, Decisions 3, Log 4, Report 5.
- F4-AC-28: Given the selected task closes or goes older than 24 hours, When the next tick arrives, Then the selection moves to the nearest listed task and the pane does not close.
- F4-AC-29: Given a mod test, When it presses `[` and `]` at both ends and in the middle, Then the selection is asserted each time.

### F4-US-6 — The band leads with ⚑ when anything waits on a human

As a person away from the pane, I want the band to flag a waiting card first, so that I answer before the run idles.

- F4-AC-30: Given `status.waiting > 0` or `summary.you.count > 0`, When the band draws, Then its first glyph is ⚑ in the waiting colour, ahead of any other text, and the band shows even when no task is running.
- F4-AC-31: Given a waiting card, When the pane is open, Then it shows the card and its question text only; answering stays `/teams:inbox` and `tm_submit`, and the mod writes nothing.
- F4-AC-32: Given nothing waiting, When the band draws, Then no ⚑ appears.

### F4-US-7 — `g` opens a STORY's graph run

As a person looking at a STORY row, I want `g` to open its graph run, so that I see its steps.

- F4-AC-33: Given a STORY row whose child run file exists at `<child cwd>/.teams_output/broker/runs/<run_id>.json` (an S task: `s_run.cwd` the same way), When `g` is pressed, Then the mod calls the open-this-run interface F3 pins, passing the run file path and `owner.key` as arguments to the F3 command or state key (default - revisit with F3; the name and shape are the one question at the end of this section).
- F4-AC-34: Given the node summary, When a row is built, Then it carries the run file path and `owner.key` (the STORY key `E-xxxxxxxx/P2` for a package; the EPIC key `E-xxxxxxxx` from `epicKey(run_id)` for an S task; default - revisit with F4 and the person), so the mod joins nothing itself.
- F4-AC-35: Given a STORY with no child run file, When drawn, Then the `g` hint is dim and the key does nothing.
- F4-AC-36: Given a mod test, When it presses `g` with a run file and without one, Then it asserts the call with both arguments in the first case and no call in the second.

### F4-US-8 — Teams passes owner to graph_open for an S task

As a person reading the graph pane, I want an S task's graph run to say which task it belongs to, so that I read it as part of my task.

- F4-AC-37: Given the S-task driver prompt built in `teams/mcp/taskmanager.mjs`, When it is read, Then its `graph_open({...})` text includes `owner: {task_id: "<run_id>", key: "<E-xxxxxxxx>"}`, where key is `epicKey(run_id)`.
- F4-AC-38: Given `teams/scripts/test-taskmanager.mjs` test S1, When `node --test teams/scripts/test-taskmanager.mjs` runs, Then an added assertion matches the owner text and the S1 prompt match still passes; counts are reported.
- F4-AC-39: Given the diff, When read, Then the only line changes under `teams/mcp/**` are in that prompt string; `graph_open` already accepts and stores `owner`, so F4 changes nothing under `graph/`.
- F4-AC-40: Given a graph run opened with that owner, When the graph pane draws it, Then it prints `owner.key` as the "under E-…/P2" tag (the graph pane renders it, F3; F4 supplies the value).

### F4-US-9 — Demo fixtures, widths and tests

As the person who approves the look, I want demo renders at both widths, so that I judge it without a live task.

- F4-AC-41: Given the test-only fixture in `teams/hooks/mod.test.ts`, When it runs, Then it renders minimal (one S task), full (an L EPIC with three packages, a waiting card, hand-offs, a stalled task), parallel (two EPICs open) and narrow (long titles) at 190 and 110 columns.
- F4-AC-42: Given each render, When its lines are measured, Then no row spills onto a second line, no tab row, label or glyph is cut, and long text ends in `…`.
- F4-AC-43: Given the Floor, the band and the footer, When read against mod.md rule 0, Then each row has its facts on the line, columns align, state is icon and colour first, keys sit in one dim footer, and no internal label appears.
- F4-AC-44: Given a live tmux session with `claude --plugin-dir ./teams` over fictional task directories, When captured with `python3 _repo/scripts/mod-shot.py` at 190 and 110 columns, Then one image per changed surface (Floor, STORYs, band) is saved under `teams/docs/images/`, the pane opens by its command and its band line and closes by Esc, q and the command again, and README.md and KOR.md introduce each image in one or two lines.
- F4-AC-45: Given the touched plugin, When `cd teams && claude plugin test .`, `node --test teams/scripts/test-*.mjs`, `python3 _repo/scripts/validate_plugins.py` and `node _repo/scripts/check-copies.mjs` run, Then each passes and its count is reported.
- F4-AC-46: Given the Sprint, When it ends, Then no version is bumped and the person approves the look from the demo renders after the Sprint.

## Out of scope

- Exactly one change under `teams/mcp/**`: the S-task driver spawn in `teams/mcp/taskmanager.mjs` passing `owner {task_id, key}` to `graph_open` (F4-US-8, with a node test). Nothing else under `teams/mcp/**` changes, and nothing under `graph/`.
- Changing how drivers or daemons run: liveness is read from files and pids, never altered.
- Character faces or character art for workers: one icon and colour per state (user, 2026-10-17).
- `view-page.html` (the browser page): pane and summary only.
- Answering an ask from the pane (`[answer]`): the pane shows ⚑ and the question; the write stays in `/teams:inbox` and `tm_submit`.
- A runtime demo command: the fixture is test-only, as the session precedent.
- A session whose cwd is a linked worktree seeing its repo's EPICs: unchanged, a documented limit.
- Version bumps: releases are batched (maintaining.md).

## Dependencies

- F3 owns the graph band and the receiving side of `g` (open-this-run). F4 supplies the run file path and `owner.key` and builds nothing in the graph pane.
- F3's owned-run skip and its "under E-…/P2" tag take their value from F4-US-8 (owner passed to `graph_open`); F4-US-8 lands in the same Sprint.
- The harness status line stops counting graph runs (`countStages`, `stageStatus`) in the same Sprint, as a dependency on F2 and F3: F3 owns the graph band, F2 touches the harness status line. It is not an F4 story and not an F4 question; `g` and the band do not wait on it.
- `[` and `]` stop at the ends in F4 and F3; F2 changes the harness pane's `cycleRun` (today it cycles round, `status.ts:212-216`) to stop, so the three panes behave the same (default - revisit with F2).
- The `~` cost estimate for a running session is shared with F2 (existing `usageUnits` rates); F4 reads it, it does not define a second estimate.

## Open questions

1. Name and shape of the interface F3 pins for opening a given run from teams (owner: F3). Options: (a) a graph pane command taking the run file path and owner.key as arguments; (b) a shared `$.state` key holding both; (c) a separate command per field. Recommendation: (a), the run file path and owner.key passed as arguments to the F3 command or state key (default - revisit with F3). F4-US-7 calls whatever F3 names; a rename changes one call site and one test.
