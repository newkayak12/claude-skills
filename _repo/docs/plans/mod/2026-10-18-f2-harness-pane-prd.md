# PRD section — F2: harness pane says what the run is doing (card 40, H)

Domain: the harness is an agent-team build loop that runs inside a Claude Code session. A lead drives teammates through fixed stages (Plan, SetGoal, Critique, Implement, Test, Gate, Report) in a run directory under `.harness-run/<slug>/`. Critique is a loop with a cap (SetGoal is redone until the critic says `sound`, or `max_critique_rounds` is spent), findings carry a severity (blocker, major, minor, nit), and the one thing the person must not miss is a run that waits on them. The "pane" is the `/harness-status` view, the "band" is the three-row strip above the prompt, and the "status line" is the one-line count of open runs. The person watching is the owner of the worktree, glancing, not reading logs.

Findings behind this section: `10-prd-findings.md` (same folder). Cites below were read in this worktree (HEAD dafac340).

## Goal

A person watching a harness run sees, in the pane and the band, what the run is doing now, what it did last, whether it needs them, which loop it is in, and what the critic found, and the stage shown is the true one.

## Problem

Who has it: the person who started a harness run and glances at the pane or band while the lead and teammates work in the background; and anyone who runs two harness runs in one worktree.

What is wrong today, from the tree:

1. **The stage can be wrong.** Backlog card 40 reports `fallback-check.mjs --list` saying `critique` while the manifest said plan and setgoal were done. The plain case does not reproduce (plan and spec written, no critique: `critique` is correct, since it is next). A real stale read does reproduce: once the critique cap is spent with `sound:false`, the file derivation (`harness/engine/fallback-check.mjs` :213-218) stays on `critique` through implement, gate and report. A fresh `now.json` hides it until the next artifact is written. `fallback.md` §2 step 4 (`harness/engine/fallback.md` :165-169) says that on the cap with `sound:false` the run continues with the spec, so the files are stuck while the run moves on. The status line has a second copy of the same derivation (`harness/hooks/mod.tsx` `countStages` :289, `crit?.sound !== true ? 'critique'`) that never reads `now.json`, so the status line, band, pane and `--list` can disagree.
2. **The canned sentence looks like a live one.** With no live `now.json` the Now line shows a stage sentence ("SetGoal is writing the goal spec") drawn at full brightness (`harness/hooks/harness-draw.tsx` :230, :360), so a file-derived guess reads as the driver's own words.
3. **The toast and the pane can disagree on the cap.** The "Critique rejected" event hard-codes `2` (`harness/hooks/mod.tsx` :380) while the pane reads `manifest.max_critique_rounds`.
4. **`[` and `]` wrap** (`cycleRun`, `otherRunLabel` in `harness/hooks/status.ts` :212-233; pinned by `status.test.ts` :195-204). With two runs, `]` on the last run silently jumps to the first.
5. **The status line still counts graph runs** (`stageStatus` :284-287, `countStages` :289, `· graph Implement(3)`), though graph runs have left the harness band. `harness/README.md:262` and `harness/KOR.md:253` document it.
6. **No test ties a rejected critique to the stage or draws two rounds.** Node tests already pin `rounds` and the severity totals (`harness/scripts/test-fallback-check.mjs` :367, :474), but none puts a rejected current `02-critique.json` beside `02-critique.r1.json` at the cap boundary and reads the stage, and the mod tests render one rejected round (`csvRounds`, `harness/hooks/mod.test.ts` :433-441, :496), never two with the second rejected. README and KOR describe an older pane and carry no shot of the new pane or band (`.claude/rules/mod.md` rule 0, items 1-4).

## Target users

- **The run's owner, glancing.** Wants one answer in a second: is it moving, is it stuck, does it need me. Today reads the run directory or asks the lead.
- **The owner of two parallel runs in one worktree.** Wants to move between them with one key and know which one waits on them.
- **A maintainer of the harness plugin** (secondary). Wants one derivation of the run's stage in node, tested, so the mod only renders.

## Solution overview

The pane's Now view answers three lines: what the run is doing now (live text from the driver, else a dim stage sentence that says it is file-derived), the last step and its age, and what it needs from you (`⚑` only when it waits on a person). The stage rail shows the critique loop as repeats, the round reads "round n of max" with max from the manifest, cost shows a number only when the lead reported one and `—` otherwise. Findings are ranked by severity, one list per critique round, under an "All rounds · counts" heading.

Which stage a run is in has one rule, computed in node (`fallback-check.mjs`) and read by everything else: a fresh `now.json` wins, otherwise the run files decide, and the file derivation moves on when the critique cap is spent. `--list` prints every open run of the worktree. The pane switches between two open runs with `[` and `]`, stopping at the ends. The band shows harness runs only. The status line counts from the same rows, with the graph part removed.

Every surface is shown by the four demo fixtures (minimal, full, parallel, narrow) at 190 and 110 columns, and the person approves the look from those renders after the Sprint.

## Scope

In scope, for the harness plugin only:

- The stage rule and its fix in `harness/engine/fallback-check.mjs`, with fixtures and node tests (F2-US-1).
- Now / last step / You lines, the dim canned sentence, cost (F2-US-2).
- Rail loop, "round n of max", toast cap (F2-US-3).
- Findings by severity, all critique rounds, the rejected-critique fixture test (F2-US-4).
- `[`/`]` run switching (F2-US-5), band (F2-US-6), `--list` readout (F2-US-7).
- Status line from node rows, graph part removed, README/KOR bullet (F2-US-8).
- Demo fixtures, live run, shots, README/KOR pane text, checks with counts (F2-US-9).

Boundaries with the other cards (rules, not questions):

- The graph row leaves the harness band here; the graph band and everything about graph runs belong to F3. F2 does not decide the `/graph-status open <run-file> <owner-key>` interface (F3 pinned it; F4 must adopt it).
- F2-US-8 is the single owner of the harness status-line removal of `· graph Implement(3)`: the `countStages`/`stageStatus` change, the three `mod.test.ts` cases (F2-AC-33), and the bullets at `harness/README.md:262` and `harness/KOR.md:253`. F3's copy of that edit (F3-US-7, F3-AC-29, F3-AC-31) is not an F2 story and F3 drops it; F2 states no dependency on F3.
- F2 does not own the `teams/mcp` owner change (F4-US-8) or the `graph_open` schema text (F3-US-8 and F3-AC-33 are F3's). F2 edits nothing under `teams/` or `graph/`.
- `[` and `]` stop at the ends of the run list (F2-US-5). F3 is asked to align its graph pane to this; F2 does not depend on F3's answer.

## Success criteria

- SC-1: the stale-stage fixture (run c of F2-US-1) reads `report` through `--list`, not `critique`, and a node test pins it.
- SC-2: for each of the four demo fixtures at 190 and at 110 columns, no rendered line is wider than the width and long text ends in `…`.
- SC-3: with two open runs, `]` on the last run and `[` on the first change nothing; `--list` prints both runs with their true stage.
- SC-4: the status line count equals the number of `--list` rows per stage and carries no `graph` text.
- SC-5: the checks named in F2-US-9 pass with their counts reported, and one live tmux session at 190 and 110 columns opens and closes the pane and switches runs.

## User stories

### F2-US-1: The stage shown is the true stage

As the run's owner I want the stage in `--list`, the band, the pane and the status line to be the stage the run is really in, so that I do not look at a finished run that says `critique`.

Rule (default - revisit with PO / card 40 owner): the recency rule is kept. `now.json` decides the stage while it is an object whose `at` parses and is not older than the newest artifact of the run (`now.json` and `now.json.tmp-*` excluded), with `now.stage` `test` read as `implement`; otherwise the run files decide and `now.json` is dropped whole. Reason: the lead calls `--now` before each teammate, so an artifact newer than `now.json` means the run moved on; this is `liveNow`/`reconcileStage` (`fallback-check.mjs` :166-174) and is pinned by `harness/scripts/test-fallback-check.mjs` :402-428. `manifest.stages` is not a source (written empty by `fallback.md`, read by nobody). The file derivation is fixed at the cap: when the newest critique is `sound:false` and the number of critique rounds is at least `max_critique_rounds` (manifest, default 2), the run is past critique, as `fallback.md` §2 step 4 says, and the derivation continues to implement, gate, report.

Acceptance:
- F2-AC-1: Given a scratch git repo with the six-run fixture (a: plan and spec, no critique, no `now.json`; b: rejected `02-critique.json` and a fresh `now.json` stage `setgoal` round 2; c: `02-critique.r1.json` and `02-critique.json` both `sound:false`, manifest cap 2, subgoal U1 passed, `04-goal-gate.json` written, no `now.json`; d: the files of c and a fresh `now.json` stage `gate`; e: stale `now.json` `plan` with the spec written after it; f: spec and a sound critique, no result), When `node harness/engine/fallback-check.mjs --list --json --cwd <fixture>` runs, Then the rows read a `critique`, b `setgoal` round 2, c `report`, d `gate`, e `critique`, f `implement`.
- F2-AC-2: Given run c with the gate file removed, When `--list` runs, Then it reads `gate`; with U1 not yet judged it reads `implement`; with only one rejected round and cap 2 it reads `critique`; with cap 3 in the manifest and two rejected rounds it reads `critique`.
- F2-AC-3: Given a manifest with no `max_critique_rounds` or a non-integer one, When the cap is applied, Then it is 2, as the row's `max_critique_rounds` already reports.
- F2-AC-4: Given the fixture of F2-AC-1, When `node --test harness/scripts/test-*.mjs` runs, Then a new case in `harness/scripts/test-fallback-check.mjs` fails on the current derivation for run c and passes after the fix, and the existing cases at :402-428 still pass unchanged.
- F2-AC-5: Given the reported symptom, When the fixture result is written up, Then the Sprint report states that the plain case (run a) is correct and that run c is the reproduced stale read, with the `--list` output quoted.

### F2-US-2: Now, last step and You, and cost

As the run's owner I want three lines that say what the run is doing, what it did last and whether it needs me, so that I can tell moving from stuck from waiting at a glance.

Acceptance:
- F2-AC-6: Given a live `now.json` with `doing`, `last_step` and `next`, When the pane's Now view is drawn, Then it shows a Now line with the `doing` text, a Last step line with `last_step` and its age, and a You line, each on one line.
- F2-AC-7: Given `now.waiting` is `{who:'you', what}`, When the You line is drawn, Then it shows `⚑` and the `what` text in the accent colour; Given `who:'vendor'` or no waiting, Then it reads `nothing needed` (with the vendor text or `next: …` when present) and no `⚑`.
- F2-AC-8: Given no live `now.json`, When the Now line is drawn, Then it shows the canned stage sentence in dim (pane and band, replacing the full-brightness draw at `harness-draw.tsx` :230 and :360), Last step reads `—`, and nothing is invented as driver text. The drawer can tell canned from live because the text helper reports which it returned.
- F2-AC-9: Given a standalone run, When cost is drawn in pane or band, Then it reads `—` unless a live `now.json` carries a numeric `cost_usd`, in which case it reads `$n.nn`. The lead is not made to pass a cost by this story.
- F2-AC-10: Given the `now.json` fields this story draws (`doing`, `last_step`, `next`, `waiting`, `cost_usd`), When `node --test harness/scripts/test-*.mjs` runs, Then the existing cases that read them from a fixture (fresh `now.json` on the row and `waiting`, a stale one giving `now: null`, cost as `—` or a number: `test-fallback-check.mjs` :246-290, :452-453, :486) still pass unchanged; this card adds no `now.json` field, so no new case is owed for them.

### F2-US-3: The loop on the rail and "round n of max"

As the run's owner I want to see that the run is in a critique loop and which round it is, so that I know whether a rejection is the first or the last chance.

Acceptance:
- F2-AC-11: Given rounds `[rejected, rejected]` and the run in `setgoal`, When the rail is drawn, Then it shows Plan, SetGoal, Critique (failed), SetGoal again, Critique (failed), SetGoal again (current), then the subgoals, goal gate and report as pending; a sound final round shows Critique done and no further SetGoal.
- F2-AC-12: Given a row with `round` 2 and `max_critique_rounds` 3, When the Now line and band are drawn, Then the pane reads `round 2 of 3` and the compact band reads `2/3`; with no round nothing is drawn.
- F2-AC-13: Given a manifest with `max_critique_rounds: 3` and a rejected critique, When the "Critique rejected" push or toast text is built, Then it names 3 and not the hard-coded 2 (`mod.tsx` :380), so toast and pane agree; a manifest without the field names 2.

### F2-US-4: Findings by severity, all critique rounds, and the rejected-critique test

As the run's owner I want the critic's findings ranked by severity and every round kept, so that I see what was rejected and what is still open without opening files.

Rule: the Findings view is a ranked list per round with `All rounds · <counts>` on top (as built), not one heading per severity.

Acceptance:
- F2-AC-14: Given a run with `02-critique.r1.json` (4 major, 1 nit) and a rejected `02-critique.json` (1 blocker, 2 minor), When the Findings tab is drawn, Then the heading reads `All rounds · 1 blocker, 4 major, 2 minor, 1 nit`, round 1 and round 2 each list their problems most severe first and numbered as the round lists them, and a round shows its verdict (rejected or sound). A new case in `harness/hooks/status.test.ts` or `mod.test.ts` draws this two-round fixture (today's cases draw one rejected round).
- F2-AC-15: Given the same run, When the Now view is drawn, Then it shows the latest round's heading (`Critique round 2 · rejected · 1 blocker, 2 minor`) and its top findings, and a long list ends in a count of what is cut (`+n: 2 major`).
- F2-AC-16 (the rejected-critique fixture test): Given that fixture with manifest cap 3, the spec written and no `now.json`, When `node harness/engine/fallback-check.mjs --list --json --cwd <fixture>` runs, Then a new node test in `harness/scripts/test-fallback-check.mjs` finds `stage: 'critique'`, `rounds` with two entries (round 1 from `r1`, round 2 from `02-critique.json`, both `sound:false`), each problem's severity, and `severity` totals `{blocker:1, major:4, minor:2, nit:1}`; with the cap set to 2 the same files read `implement` (the rule of F2-US-1). The severity-reading rules themselves (field kept, unknown value major, text prefix for old strings) are already pinned at :308-345 and stay unchanged.
- F2-AC-17: Given the engine fields this card touches, When the node tests run, Then each is read by a node test from a fixture: the stage derivation by F2-AC-1 and F2-AC-2 (new), `rounds[]` and `severity` by F2-AC-16 (new) and :367, :474 (existing), `manifest.max_critique_rounds` and `manifest.started_at` by :293-305 (existing, unchanged), `now.json` fields by F2-AC-10. No other engine field is added.

### F2-US-5: `[` and `]` switch between open runs

As the owner of two runs I want `[` and `]` to move the pane between them, so that I can look at each without leaving the pane.

Rule: the keys reach the pane through the existing autoFocus Input, and the prev/next Buttons stay as the pointer path. The run list is the node open-run list in its opening order. The keys stop at the ends of the list and do not wrap (F2 asks F3 to align its graph pane; no dependency on F3).

Acceptance:
- F2-AC-18: Given two open runs and the pane on the first, When `]` is pressed, Then the pane shows the second and the header reads `run 2 of 2`; When `]` is pressed again, Then nothing changes.
- F2-AC-19: Given the pane on the first of two runs, When `[` is pressed, Then nothing changes; on the second run `[` shows the first.
- F2-AC-20: Given the pane on a run, When the tab row shows the other run, Then it names the neighbouring run in the direction a key would move, and on the last run it names the previous run (default - revisit with card 40 owner); with fewer than two runs it names none and `[`/`]` do nothing.
- F2-AC-21: Given the keys are routed, When `1`-`4` and `q` are pressed, Then they still pick a tab and close the pane, and the prev/next Buttons step the run by pointer and do nothing at the ends.
- F2-AC-22: Given `cycleRun` and `otherRunLabel` change from wrapping to stopping, When `cd harness && claude plugin test .` runs, Then the cases at `status.test.ts` :195-204 are rewritten to the stop rule and pass.
- F2-AC-23: Given a live tmux session with two runs, When the pane is opened by its command and no click is made, Then `[` and `]` move the runs; the result is recorded in the Sprint report. A failure is reported as a failure (see Open questions).

### F2-US-6: The band shows harness runs only

As the run's owner I want the band to carry harness runs only, so that it is not a mixed list of two systems.

Acceptance:
- F2-AC-24: Given open harness runs and graph runs under `.harness-run/broker/runs/`, When the band is drawn, Then it has no row for a graph run and no line contains the word `graph`; the existing case at `mod.test.ts` :707-715 keeps passing, with its `toContain('graph Implement(1)')` line moved to the F2-US-8 status-line change.
- F2-AC-25: Given the band leads with the newest open run, When the pane is open on another run, Then the band shows the leading run and the picked run as today, and a run that waits on you shows `⚑` with the question on its row.
- F2-AC-26: Given the band at 190 and at 110 columns, When segments do not fit, Then they drop by priority and long text ends in `…`; no line wraps.

### F2-US-7: `--list` prints both runs

As the owner of two runs, and as the mod and codex that read the same readout, I want `fallback-check.mjs --list` to print every open run of the worktree.

Acceptance:
- F2-AC-27: Given two open runs of one worktree, When `node harness/engine/fallback-check.mjs --list --cwd <fixture>` runs, Then it prints one tab-separated line per run (slug, stage, round, waiting, cost, and `stalled` when it is), newest first, and `--json` prints both rows with the shape in the file header.
- F2-AC-28: Given a run with a report, a run older than 12 h, a run with no manifest and `.harness-run/broker`, When `--list` runs, Then none of them is a row; a run of 2-12 h is a row marked stalled; with no open run it prints `no open runs`.
- F2-AC-29: Given the node rule decides what is open everywhere, When the mod picks the open runs, Then it reads `--list --json` through `$.process.run` and uses its own scan only for the picked slug's files.
- F2-AC-30: Given the existing case 'stale-stage fixture: --list prints both runs' (`test-fallback-check.mjs` :402-428), When it runs after F2-US-1, Then it still passes and the new fixtures sit beside it.

### F2-US-8: The status line counts from the node rows, without graph

As the run's owner I want the status line to count the same runs, in the same stages, as `--list`, and to count harness runs only, so that the line, the band and the pane never disagree.

Rule (default - revisit with implementation lead / card 40 owner): the status line takes its counts from the node `--list --json` rows (one derivation, `now.json` aware); its own scan of the run files (`countStages` :289-344) and its graph scan of `.harness-run/broker/runs/*.json` (:309-318) are removed. F2-US-8 is the single owner of this change.

Acceptance:
- F2-AC-31: Given open runs at plan 6 and implement 11 (rows, a stalled row among them counted under its stage as the 12 h scan counted it), and graph runs under `.harness-run/broker/runs`, When the status line is built, Then it reads `Plan(6) / Implement(11)` with no `· graph …` part, and with nothing open it is empty.
- F2-AC-32: Given run c of F2-US-1, When the status line is built, Then it counts it under Report, as `--list` does, not Critique.
- F2-AC-33: Given `stageStatus` and `countStages` change (`StageCounts` loses its `graph` half; the comments at `mod.tsx` :270 and :283 that name graph runs are updated with it), When `cd harness && claude plugin test .` runs, Then the three `mod.test.ts` cases that pin the graph count are rewritten and pass: :163-168 (expects `… · graph Implement(1)`) now feeds the node rows and expects the rows-based line, :179-184 (`graph runs alone`) becomes a case where graph files under `.harness-run/broker/runs` give no status, and :713 (`toContain('graph Implement(1)')`) is replaced by the new line. These cases build the line from a mocked file world today, so they mock the `--list --json` call instead. The two cases at :1243 and :1350 only pin that `runEvents` skips `broker/` and stay unchanged and passing.
- F2-AC-34: Given the status-line bullet at `harness/README.md:262` (read: "… fallback runs first, then graph runs — `Plan(6) / Implement(11) · graph Implement(3)` …") and its mirror `harness/KOR.md:253`, When this story is done, Then both bullets drop the graph clause and the example reads `Plan(6) / Implement(11)`, in the same commit, English and Korean together. The line numbers are the harness plugin's files; the root `README.md` (54 lines) has no such line and there is no root `KOR.md`. The history lines `harness/README.md:313` and `harness/KOR.md:304` keep `graph Implement(3)` because they record v1.25.0.
- F2-AC-35: Given the status line now reads rows, When the mod runs without the node list (the command fails), Then the line is empty and the pane keeps its last good list; the gate's decisions stay in `/harness-status`.

### F2-US-9: Demo fixtures, live proof and the checks

As the person who approves the look, I want the four demo fixtures rendered at both widths and the checks run with counts, so that I can judge the result from the renders and trust the numbers.

Acceptance:
- F2-AC-36: Given the harness status command's `demo [minimal|full|parallel|narrow|off]` argument, When each scenario is rendered at 190 and at 110 columns, Then no line is wider than the width, no label sits under another, no glyph is cut and long text ends in `…`; the harness draw test at `WIDTHS = [190, 110]` covers all four scenarios (parallel shows two runs and the key to the other; narrow is the compact case; full adds Findings).
- F2-AC-37: Given the new Now/last step/You, rail, round, findings and cost drawing, When the demo is rendered, Then state is told by icon and colour first and words second, one item per line with its facts on that line, keys in one dim footer, no word said twice, no internal label (`.claude/rules/mod.md` rule 0). The person approves the renders after the Sprint; the Sprint delivers the fixtures and captures.
- F2-AC-38: Given the checks in `.claude/rules/maintaining.md` for the harness plugin, When the Sprint closes, Then these run and the report gives each count (not "tests pass"): `node --test harness/scripts/test-*.mjs`; `node harness/scripts/test-goal-gate.mjs` (prints `all passed`); `cd harness && claude plugin test .`; `python3 _repo/scripts/validate_plugins.py`; `node _repo/scripts/check-copies.mjs`; `node --check` on `harness/engine/codex-exec-adapter.mjs`, `harness/engine/codex-runner.mjs` and `harness/engine/fallback-check.mjs`. Baseline before this card: 59 node tests, 141 mod tests in 4 files, 15 plugins installable.
- F2-AC-39: Given a UI change, When the card closes, Then one live tmux session (`claude --plugin-dir ./harness`) opens the pane by its command and its band line, switches two runs, and closes it by Esc, `q` and the command again, captured at 190 and at 110 columns; `python3 _repo/scripts/mod-shot.py` writes one image per changed surface (pane tab, band) under `harness/docs/images/`, with fictional demo data.
- F2-AC-40: Given the pane is introduced in `harness/README.md` and `harness/KOR.md`, When they are updated, Then each shows the new images with one or two lines on the feedback they give, and the two files move together; no version bump and no status-line entry is added (batched later).
- F2-AC-41: Given `harness/hooks/draw.tsx` is byte-identical with `graph/hooks/draw.tsx`, When this card is done, Then `draw.tsx` is untouched and `node _repo/scripts/check-copies.mjs` still passes; new drawing stays in `harness-draw.tsx`.

## Out of scope

- **`harness/engine/pipeline.js` (Workflow path) writing `now.json`, a manifest or critique severity.** Decided by default (default - revisit with PO / harness maintainer): the harness pane covers fallback (Agent Team) runs only. Investigation found it is not needed: `pipeline.js` writes only `.harness-run/workflow-codex/...` and never `manifest.json`, so a Workflow run is never a `--list` row. `compat-codex.md` also keeps that path isolated.
- **Cost for teams-driven S runs.** Nothing under `teams/` writes `now.json` or cost into a harness run, and F4 owns teams. A teams-driven run is a `--list` row with cost `—` and the default cap of 2.
- **Any graph-pane behaviour:** the graph band, owned runs, `graph_open` schema text, the `/graph-status open <run-file> <owner-key>` interface (F3, adopted by F4), and the `teams/mcp` owner change (F4-US-8).
- **Version bumps** and README/KOR status lines: batched later (`maintaining.md`).
- **Character faces** and any new icon vocabulary: one icon and colour per state, spinner while acting, from the existing nine state glyphs.
- **A browser page** or `view-page.html` for harness runs: pane and band only.
- **Editing `harness/hooks/draw.tsx`, `graph/hooks/draw.tsx` or `harness/engine/pipeline.js`:** protected by the byte-identical copy check and the Codex isolation rule.
- **`.claude/conventions/*`:** `boundaries.md`, `coding.md` and `verification.md` are still unfilled templates in this repo, so they add no rule or command; the repo rules (`.claude/rules/*`) and the commands in F2-AC-38 stand in for them. Filling them is not part of this card.
- **Backlog text at `_repo/docs/backlog.md` :48-50** (card 40 still says the mod is not built): corrected when the Sprint closes its cards, not by this story.

## Open questions

1. **F3 alignment to stop at the ends.** F3's text (F3-AC-21 and its Scope) lets `[` and `]` wrap, and cites F4-AC-20 as agreeing, which it does not. Owner: F3 card owner with PO. Recommendation: F3 adopts the stop rule so the three panes behave alike; F2 ships its stop rule either way.
2. **If the autoFocus Input does not hold `[`/`]` with no click first in a live session (F2-AC-23).** The key focus is unit-tested only. Owner: card 40 owner. Recommendation: keep the prev/next Buttons as the pointer path, report the live result as partial, and put a card on the backlog rather than rebuilding the keys through a Client region in this Sprint.
