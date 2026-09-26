# teams

**English** · [한국어](KOR.md)

`teams` is its own plugin: a broker-driven node-graph engine, plus a second MCP server,
`task-manager`, that splits a medium or large request into packages and runs each as its own
graph in its own worktree. It is a sibling of [`graph`](../graph/README.md) and
[`harness`](../harness/README.md) — built on the same broker/graph engine lineage as `graph`,
and plugging into `harness`'s runtime gate protocol the way any project can — but it is not a
beta of either: its own MCP servers, its own run directory, its own release line.

Same broker, same six core tools, same skill shape as `graph` — with these differences:

| | `graph` | `teams` |
|---|---|---|
| MCP servers | `graph-engineering` (`graph_*` tools) | `teams-engineering` (`team_*`) + `task-manager` (`tm_*`) |
| Run files | `.harness-run/broker/` | `.teams_output/broker/` |
| Skills | `graph:install`, `graph:orchestrate` | `teams:install`, `teams:remove`, `teams:patch`, `teams:orchestrate`, `teams:develop`, `teams:document`, `teams:plan`, `teams:qa`, `teams:board`, `teams:ticket`, `teams:inbox`, `teams:take`, `teams:submit` |
| Version line | 1.x | 0.x |

Both plugins can be enabled in the same project: distinct tool prefixes (`graph_*` vs.
`team_*`/`tm_*`) and distinct run directories mean neither can mistake the other's state for
its own.

## Why teams exists

`graph` is built for one shape of work: a request that becomes subgoals, each of which
**changes files** and is verified by **running commands** against a git worktree. That is
the right shape for code. It is the wrong shape for a design document, a research write-up,
or a request large enough that it should be split into several runs across several
worktrees — and it has no notion of a run that manages other runs. `teams` adds exactly that,
on the same engine lineage:

Three things this plugin adds, in this order, each behind the previous one's tests:

1. **Kinds.** A subgoal declares what kind of work it is, and the kind decides which node
   chain it expands into. `subgoal` (code) keeps `implement → test → gate` exactly as today.
   `document` gets `draft → review → gate`: author ≠ reviewer, rubric-based, a missing
   worktree change is not a failure. A spec may mix kinds — "implement the feature and
   update the design doc" is one run.
2. **Entry per flow.** `teams:orchestrate` stays the no-decision entry: `plan` sizes the
   request and picks the flow. `teams:develop` and `teams:document` are thin
   manual entries — trigger words, a `flow` default, a persona set — that hand off to the
   same loop. Nothing in the loop is duplicated.
3. **TaskManager.** A second MCP server in this plugin, `task-manager`, for medium and large
   requests. It sizes, splits into packages with `touches[]` and dependencies, and for each
   package opens a child graph run in its own worktree — **the broker opens it, never a
   node** — then accepts the child's verdict, integrates worktrees, and reports. It reuses
   `mcp/graph.mjs` as a library (DAG, typed edges, retries, settled failure) and reads child
   run files without ever writing them. Small requests skip it entirely.

Design and step list: [`docs/plans/2026-09-11-teams-taskmanager.md`](../docs/plans/2026-09-11-teams-taskmanager.md).

## Status
- v0.30.1 — **a claude node that cannot run a command is not ready**: code-sprint-S3 (`vendor: auto`) failed P1 three times in 13 minutes because every claude adapter node reported "This command requires approval" for `node --test` — `workspace-write` runs `--permission-mode acceptEdits`, which lets Write through and leaves Bash to the project's settings, and headless denies it. The readiness probe only asked for a Write, so it said ready. The probe now has the session run `node` to write a sha256 only execution can produce; where Bash needs approval the vendor reads not ready ("could not run a command in this profile") and `auto` moves on. Confirmed against the real CLI on this host. Earlier bench runs were `vendor: self` and never met it.
- v0.30.0 — **a Sprint's box, measured on a real run**: the first sprint bench (`bench.sh sprint code`, 2026-09-26) plus a read-only sweep of five earlier real runs. (1) **The box could not see what it was boxing** — cost counted package drivers only; manager judge calls (now `drivers/judge_<node>.stream.jsonl`) and, under `vendor: auto`, every node's own adapter session (`.teams_output/broker/<run>/<node>/…/events.jsonl`) were missing: code-sprint-S2 read $0.88 against $3.95 spent. `collectTaskCosts` feeds budget, report, `tm_status`/`tm_board` (`drivers_usd`/`nodes_usd`), the viewer and score. `vendor: self` runs were already whole; codex nodes still report no cost. (2) **A boxed backlog is pinned L** (`size_pin_source: boxed-backlog`): an S task has no packages for the box to leave undispatched. (3) **Out of budget before shape** now skips the pending graph and opens a report; no retry opens once the box is stopped; `retro.json` gains `next_backlog.unshipped_requests` (shape declares `backlog: [N]` per package) and `context_from` carries it. `context_from` that resolves to nothing says so (`context_from_unresolved`). (4) **Liveness**: a zombie pid is dead (`mcp/proc.mjs`); a driver respawned after a long park is measured from its own start, not stale progress; "resets 3pm" parses; a dispatch whose driver is dead with its restart budget spent folds instead of sitting `running` (idol P6, 16h+); the teams plugin root falls back to the module's own location when `CLAUDE_PLUGIN_ROOT` is unset. (5) **No unexplained refusal or retry**: a refusal with no reason/gaps is re-judged; `daemon_retry_opened.reason` carries the feedback. (6) Viewer shows the box (`budget $x/$y (n%)`, WARN/STOPPED) and a PLAN team before shape. Still open from the sweep: decisions that flip and never reach the PRD, critique findings that vanish, blocked planning never escalating to a person.
- v0.29.2 — **the same decision, asked twice**: idol-beta-ask1 kept running and produced three more findings, each measured rather than guessed. (1) **0.28.7's owner split reached a real model** — U4's third investigation opened `ask:U4:3` through `ask:U4:3e`, five cards by owner, from one stage. (2) **A retry re-asked what was already settled.** U4's draft failed twice; its third investigation raised six questions and two were byte-identical to ones answered on `ask:U4:1` — a node the retry superseded, so nothing downstream knew. The other four were rewordings of the same decisions, which no string filter can catch. Both halves are fixed: `openAsk` drops a question a prior attempt of the same owner already answered (exact match, on strings the engine stored itself), and `nodeBriefing` now carries `prior_decisions` into **every** stage of the new attempt under "Already decided by a person — settled, do not raise these again", with `CONTRACT.investigate` told that such a decision is a finding and must never be raised again, reworded or not. Cards carry `ask_owner` so the match holds across attempts and for manager-level stages. (3) **Five cards, one ticket key.** The owner split made a subgoal-keyed card ambiguous, and `tm_submit` resolved it by taking the last waiting card — one owner's answers applied to another owner's questions, silently. `tm_inbox` now keys an `ask` card by its own node id (the third key segment already accepts one), a pinned author card stays subgoal-keyed, and an ambiguous key is refused with the keys that would work rather than resolved by guesswork. 4 new tests.
- v0.29.1 — **a queued answer with no driver to apply it**: 0.28.4's handoff queue took the manager out of the child run's file for good — `tm_submit` queues, the broker applies. idol-beta-ask1 (2026-09-25) found what it left open. Three cards were answered, all three landed in the queue, `tm_submit` returned `done` for each, and then the child's driver was killed before draining them. Nothing ever brought one back: the queue is drained by the broker, the broker only runs inside a driver, `tm_submit`'s own revive fires only on the call that queues (and `alreadyQueued` rightly refuses a second submit for the same card), and `serviceDeadDriver` read the run as `waiting_human` and returned early — a parked run is not supposed to have a driver, which is true right up until an answer is waiting to be applied. Three accepted answers, unapplied, with no path left that would ever apply them. `serviceDeadDriver` now respawns a parked child whose handoff queue is not empty, and still leaves one with an empty queue alone, so "zero compute while waiting" is unchanged. Verified on the stalled run itself: the queue drained on the fresh driver's first poll, all four cards read `done`, and the drafts ran on the decisions. 1 new test.
- v0.29.0 — Reducer registry, checkpoint rollback and idempotent submits, questions to the human from every judging stage plus human_gates, judge independence gaps closed, Sprint cadence (budget/timebox, retro.json, requests[] backlog, sprint skill), upstream-defect fix STORYs, goal-floor band, planning-audit report fixes, cost/turns rollup and view fixes.
- v0.28.9 — critique sees shape-quality signals (foundation-package bloat, fully-serial width) as facts, not hard blocks; tm_status surfaces them too
- v0.28.8 — An accept:QA that files a defect below the match floor now finishes done and files it, instead of dropping the defect and rerunning QA on the same tree.
- v0.28.7 — **a card goes to one owner**: the first real interactive run (idol-beta-ask1, 2026-09-24) proved the `ask` path end to end — a real model filled `options[]` with the domain's actual open rules (ticket cap, refund schedule, payment hold, presale tiers, capacity assumption, SLA, anti-bot), the run parked, `tm_inbox` listed the card, `tm_submit({key, payload:{decisions}})` answered it, and the draft briefing carried every answer under "Decided by a person — these are settled, write them as rules, not as open questions". It also showed the defect: seven questions, **five different owners**, all on one card addressed to whichever came first. Nobody can answer that card. `openAsk` now groups by owner and opens one card each (`ask:U1:1`, `ask:U1:1b`, `ask:U1:1c` — the suffixing sibling goal-gate judges already use), draft depends on all of them so no document is written while one owner is still deciding, and a question with no owner gets its own card rather than somebody else's. One card is still exactly `ask:<sg>:<attempt>` when there is one owner. `bench.sh` gains `TEAM_JSON`, which writes `.claude/team.json` verbatim — `interactive` was unreachable from the bench, the same gap `TEAM_ROLES` was added to close. 2 new tests.
- v0.28.6 — QA execute finding real defects now completes the child instead of retrying against unchanged code; defects flow through the dispatch fold and briefings to accept:QA and fileDefects, and a failed QA dispatch that recorded defects is filed rather than blindly retried
- v0.28.5 — Kanban-theory ticket improvements: blocked_reason (unmet deps/capacity/restart budget/human wait), waiting elapsed, board.jsonl flow metrics (WIP/throughput/cycle/lead time), and a fix for stale nested task copies rendering as live
- v0.28.4 — driver liveness gets a progress signal (stall_minutes flags then kills a wedged-but-alive driver) and driver_restarts can become a sliding window (restart_period_minutes) instead of a flat forever counter
- v0.28.3 — board/ticket fixed WAITING_HUMAN drift and human_assignments; new inbox/take/submit skills give a human an entry point onto a waiting_human card (tm_inbox/tm_assign/tm_submit)
- v0.28.2 — **a retry after a reshape waited on nodes that would never finish**: idol-pm-4 (2026-09-23) ended `blocked` with four package retries pending and budget left. `retryPackage` copied deps from the package's first-ever dispatch, which after two reshapes was the discarded round's: `critique` and `accept:P1:1`, both skipped. The retries could never become ready, and the daemon found nothing to do. Deps now come from the dispatch of the current shape round (the one waiting on the live critique). The retry budget is counted within that round too, because counting every accept ever pushed meant each reshape had spent a retry of every package. Bench: the `idol` case is scored by its own criteria (planning docs, stories, critique passed, packages dispatched and accepted, integrated, tests pass in the integrated tree) instead of the docs checklist its name fell into. A new `awake` case (a macOS menu-bar app, SwiftPM only, that keeps the Mac awake only while Claude Code is working) is the next reference run. `drive.sh` holds `caffeinate -i -w $` for exactly its own lifetime and sleeps against the wall clock, after idol-pm-4 lost five hours to a sleeping laptop. 1 new test.
- v0.28.1 — **the card a person takes now keeps the engine's own rules, and two real-run defects are gone**. Four changes from the 0.27.3 review against the design, and from idol-pm-4 (2026-09-23), the first planning run to build packages. (1) The manager no longer writes a child run file. README says it reads child runs and never writes them, and 0.27.3 broke that: `tm_assign` and `tm_submit({key})` wrote the run directly. A person's pin, submission or `ask` answer is now queued in a handoff file under the child's broker directory (locked like the run file). The child's broker drains it on its next call through the same code as `team_submit`, and `broker.mjs` is import-safe. (2) A person's `changed_files` go through the same worktree cross-check an AI's do (design §7). A claimed file that did not change is caught. (3) Only the user's own `tm_assign` parks a card unconditionally. An `assignee` the shape or setgoal model wrote parks only with `interactive` on. Otherwise it goes to an AI and leaves `auto_decided_pin` on the node, and `tm_inbox` lists it under `decided`. "A run with no flag is a run whose questions were answered by default; the difference is in the record." (4) `view.mjs` gains a TICKET view (STORY cards in state columns with TASK children, assignee, a waiting-on-human marker) and a RESOURCE view (TaskLeader to Team to worker: pids, liveness, restarts, cost and turns). Both are reached by page tabs or `--once --view tickets|resources`. From idol-pm-4: `accept`'s 90 floor (0.24.0) turned points a judge had docked for non-blocking weaknesses into rejections. P2 and P5 accepted at 88 with no gaps and were rebuilt from scratch, so an accept below the floor now fails only when it names a gap (`gate:goal` keeps the plain floor). And eight `.harness-tasks` files were committed into P1's product branch: the package cwd arrived as `/private/var/...` and the tasks root as `/var/...`, so `harnessPathsUnder` compared two spellings of one tree. Both sides are now realpaths.
- v0.28.0 — **the decision a person makes, as a node**: 0.26.0's `investigate` stage names what no source could settle, and every one of those went into the document as an open question — the run finished without ever having asked anybody, which is deciding by default while looking like caution. An unknown now carries `options[]`: two to four candidate answers, the recommendation first, each with what follows from choosing it. Naming candidates is still research, not deciding — the person who owns the call needs candidates far more than a blank question. On a run opened `interactive: true` (a `tm_open`/`team_open` argument, or `interactive` in `.claude/team.json`), such an unknown opens an `ask` card between `investigate` and `draft`: `draft`'s data edge moves onto it, so nothing is written until the choice exists. The card needed no new machinery — it is born with the same human pin 0.27.3 introduced, so it parks in `waiting_human`, `tm_inbox` lists it (with its questions, options and the owner the investigation named), and `tm_submit({task_id, key, payload: {decisions}})` answers it. Two fixes fell out: `tm_submit({key})` computed its node from `authorStage`, which could never address a stage that is not in the kind's chain, so it now addresses the node that is actually waiting; and `taskTicketState` read WAITING_HUMAN off a named stage, so an `ask` card showed as READY while nothing could move. The answer reaches `draft` as a settled rule, not an open question. Left off (the default, because a run nobody is watching must still finish), the questions are recorded on `run.unasked` so the report can show what was decided by default. 13 new tests.
- v0.27.4 — **the findings path is assigned, not chosen**: 0.26.0 told each `investigate` stage to name its findings file "after this subgoal so the siblings do not overwrite each other" — a convention, and five siblings given it produced `U1-investigate.md`, `U3-1-investigate-notes.md`, `investigate-U4-findings.md`, `investigate-U2-findings.md` and `decisions/investigate_U5_1-findings.md`, plus an orphan when one retried under a new name. The path is now derived: take the subgoal's own output path, drop the extension, append `-findings.md`. It does not go in `files[]` — 0.26.4 made that strictly the one path a subgoal writes and the spec check rejects anything else there — so `reduce` is told the derived name is expected while a findings file under any other name is exactly the undeclared case it should catch. That closes D1's second half and part of D3 (a retry can no longer invent a second name for the same artifact). 1 new test.
- v0.27.3 — **a person can take a card**: every card on the board was work only a model could do. `tm_assign({task_id, key, to: "human", who})` pins a STORY (the package) or a TASK (one subgoal) to a person, before or after it dispatches, and `to: "auto"` hands it back. The same pin is `assignee: "human"` on a shaped package. Only the stage that writes (implement / draft / cases) is the person's; test, review and gate stay automatic, so nobody judges their own work. A pinned node parks in a new node state, `waiting_human`, rather than going to a driver: it spends no retry budget and no compute, `dispatchSettled` never reads it as dead, and tickets show `WAITING_HUMAN`. A headless driver cannot reach anyone, so the main session finds the work with `tm_inbox` (key, title, acceptance, briefing path, who, since) and hands it in with `tm_submit({task_id, key, payload})`. The flow then continues as if a driver had submitted, and a gate rejection reopens the next attempt for the same person, never a model. A driver is restarted after that submit only if none is still running the child. Not yet: questions (`ask`), `gate:human`, rollback. 29 new tests.
- v0.27.2 — **the shape contract required a package the coverage check forbade**: rule one of `CONTRACT.shape` (0.24.0) says the composition root and every cross-package contract are owned by exactly one package. The coverage check (also 0.24.0) rejected any package whose `implements[]` was empty. A package that only owns the foundation delivers no story by itself, so a shape could satisfy both only by lying. idol-pm-4 (2026-09-23) did exactly that on its first attempt, pinning US-7 on its foundation package P1. On the second attempt it told the truth, and `validateShape` rejected P1 and P7 for having no story. Such a package now lists the stories it makes possible in `enables[]`, and the contract says never to claim a story in `implements[]` to get past coverage. `enables[]` must name real stories and does not count as delivering them. 1 new test.
- v0.27.1 — **one file, two owners, and the shape passed**: `validateShape` compared `touches` entries as strings, so idol-pm-4 (2026-09-23) went to critique with P1 owning `src/identity/module.ts` and P2 owning `src/identity/**`. The same held for every context folder: P1 claimed each `src/<context>/module.ts` while the package for that context claimed the whole folder. Containment now counts: a trailing `/**` or `/*` claims the directory, a bare directory claims what is under it, and an overlap is named with both spellings and told to narrow one. Any other wildcard (`src/*.test.ts`) still only matches itself, because guessing what it covers would fail good shapes. 1 new test.
- v0.27.0 — **the fold that was missing from a run**: the manager level always had two places where parallel work converged — `accept` folds one child (`foldChild`), `integrate` merges every branch — and a run had none. Its subgoal gates fanned into the goal gate, which judges and writes nothing, so no node ever looked at the artifacts as a set. What held that seam was a convention: the setgoal contract telling subgoals that share a file to each name the heading they own. idol-plan-2 (2026-09-23) is what a convention looks like when it breaks quietly — five sibling `investigate` stages, all told to name their findings file after their subgoal, wrote `U1-investigate.md`, `U3-1-investigate-notes.md`, `investigate-U4-findings.md`, `investigate-U2-findings.md` and `decisions/investigate_U5_1-findings.md`, and a retry left `investigate_U5_2` beside its own first attempt. `reduce` is the run-level leader: pushed whenever a run has more than one subgoal, it reads what is on disk against every subgoal's declared `files[]` and reports four things — a declared path that is missing, a file nobody declared, one path two subgoals both wrote, an artifact left by a superseded attempt. It **reports and does not repair**, which is why it is a reasoning stage: the level above decides, and a repair made there would hide the defect from the gate that should see it. `foldChild` carries its findings up as `set_findings` so the manager is that level. Three things the change surfaced: the goal gate's data edge moves to `reduce` but its SIGHT must not, so the subgoal gates stay on as order-only `after` edges or the gate judges work it was never shown; the goal-gate re-judge lookup matched on `deps` only and found no stale round once `reduce` sat in between, so a retried subgoal rebuilt the tree and nothing re-judged it; and a fold that already ran must be reopened on a retry with `reopened` bumped, or `mergeOnto` — which refuses `done -> pending` to keep one broker from undoing another's — silently merges the reset away and the stale fold stands. 6 new tests.
- v0.26.4 — **the planning prompt contradicted the spec check twice, and a planning run could not start**: idol-pm-3 (2026-09-23) died at `setgoal` three times. Attempts 1 and 3 returned every subgoal as kind `document`, because `PLANNING_SETGOAL` said "one document subgoal" and "add a document subgoal" in a `plan` flow whose `mixed=false` rule admits only `planning`. Attempt 2 got the kind right and put `.claude/team.json` in `files[]`, because the same prompt told it `files[]` should name what the investigator ought to open, and the document-path rule (correctly) rejected it. The prompt now names the kind outright, says `files[]` is only the markdown path the subgoal writes, and gives reading its own field: `sources[]`, rendered as "Sources to open first" into the `investigate` briefing only. `validateSpec` and `reduce` are unchanged. 1 new test.
- v0.26.3 — **the test suite was raising a real daemon**: the kill-and-restart test gave its second manager no test seam, so that manager's first call spawned a real `daemon.mjs` which folded `dispatch:P1:1` in parallel with the test's own `tm_submit` - two `git add`s in one worktree, the loser saw `index.lock` and a passed package was marked failed (4 of 15 runs, serial or parallel alike) - and then went on to judge `accept:P1:1` with a real `claude -p` from inside `node --test`. Both managers now carry `HARNESS_TEST_NO_DRIVER`, and `commitWorktree` waits out a transient `index.lock` (8 x 150ms, bounded) instead of failing the fold: daemon.mjs's header allows a direct `tm_submit` to race its fold loop, so the git step has to survive that race too. 2 new tests; 0/15 flakes after.
- v0.26.2 — **a finished run is not a delivered one**: two surfaces still read plain success over a run that shipped nothing. `epicTicketState` decided SETTLED from whether any node was left `unreachable` — the wreckage a failure happens to leave, not the question that matters — so a run reaching `report` having accepted nothing by any other route read DONE again. It now asks directly: did any package the shape declared come back accepted? A task that declared no packages is not judged this way, having had nothing to deliver. And `runState` returned a bare `complete` for a report written over a settled failure; it now carries `settled: true` alongside it. The state string is deliberately unchanged — every caller collapses anything but `running`/`complete` to `blocked`, so a new state would have flipped behaviour at three sites — while the machine-readable surface stops claiming success. idol-pm-1 (2026-09-22) is the case both fixes are named for: three shaping attempts spent, zero packages dispatched, and a report whose prose was honest above surfaces that all said DONE. 2 new tests.
- v0.26.1 — **the scorer that ended the P1/Q1 round**: `score.mjs` read every task dir as `JSON.parse(read(...))`, and `read()` returns `null` for a missing file while `JSON.parse(null)` returns `null` rather than throwing — so the `try/catch` never fired and the next property access crashed the whole scorer. A task dir whose `task.json` is not written yet (every run, for its first moments) was enough. That is what killed the first planning/QA role bench (`drive-P1Q1.log`: `TypeError: Cannot read properties of null (reading 'nodes')` at score.mjs:211), so §8g's Q1 — the QA phase-Team's only scheduled real-vendor measurement — never produced a run, and QA still has zero real-run evidence. All five `JSON.parse(read(...))` sites guarded.
- v0.26.0 — **planning had no stage that read anything**: the `planning` chain was `draft -> revise -> gate`. Draft wrote from the request alone, revise rewrote what draft had written, gate scored it. Every other kind meets reality somewhere — `subgoal`'s `test` runs commands, `qa`'s `execute` runs the case set — and planning met it nowhere, so a domain's own rules (who a presale is for, how long a cancellation window is, what the per-person limit is) could only be invented or omitted. 0.25.0 answered that with more contract wording aimed at a stage whose input was zero; this one gives it input. The chain is now `investigate -> draft -> revise -> gate`. `investigate` is the only stage that reads anything outside its briefing — the project tree, whatever the request names or attaches, prior documents, and the domain's public sources where a search tool is actually reachable — and it returns two lists that stay separate on purpose: `findings`, each with the source that says so, and `unknowns`, the decisions no source it reached answers, each with an owner. "Assumed to exist" is an unknown wearing a finding's clothes. `draft` writes from the findings and carries every unknown into the document as an open question with its owner; it may recommend, never answer from nothing. A stage that comes back mostly unknowns has succeeded — the unknowns are what keep the drafter from inventing, and padding the list is the one failure it can hide. Method is `develop:domain-driven-design` + `cognition:assumption-extractor`; `setgoal` is told to name what each document's investigator should open in its `files[]`, not only the path it writes. Two structural bugs surfaced with it. `authorStage` was `chain[0]`, so revise would have checked its independence against the investigator instead of the drafter and let the drafter revise their own draft — a kind now names its `author` explicitly. And `taskTicketState` destructured every chain as a fixed [author, mid, gate] triple, so a four-stage chain put `revise` in the gate slot: a planning TASK reported DONE the moment revise finished and a failed gate could never read REJECTED — derived by position now, with the stages before the author counting as IN_PROGRESS and those between author and gate as IN_REVIEW. 5 new tests.
- v0.25.0 — **nobody asked for one document**: both real planning runs wrote a single PRD in sections, and the domain's own rules ended up filed rather than decided. idol-pm-2's 588-line PRD assumed the fan-club presale "exists as a business requirement" and gave it no user story; refunds and exchanges, resale and transfer, and the seat/price catalog were all excluded in Non-Goals. idol-pm-1's PRD mentioned `fan-club` and `presale` zero times. What it does carry is deep: queue, hold, payment, anti-bot — the technical difficulty the request itself named. So the planning harness was not a PRD generator; it was a spec generator for the hard part of the request. Two causes, both ours. `setgoal` was never told that deciding the document SET is its job, so it saw one generic `document` kind and split one file into sections — new `PLANNING_SETGOAL`, rendered into `plan`/`setgoal` on a `plan`-flow run only: the PRD is the floor, a separate document goes wherever a reader would look for something by name (the domain model and glossary, the policy decisions, the scale assumptions, a decision record), name the ones THIS request needs and do not produce four because the sentence lists four. And `PRD_CONTRACT`'s domain clause ended in an escape hatch — "a practice you decide not to build is named in Out of scope" — which is exactly what both runs used: Out of scope is now for capability you decided not to build, never for a rule a user story rests on, which is decided in whichever document owns it or stands as an Open question with a named owner ("an assumption with no decision behind it and no story over it is an omission wearing a heading"). `missingPrdSections` already read the whole reported set, so the seven sections may now live across documents. The planning phase-Team's brief and `plan`'s SKILL.md say the same thing, and the skill stops naming `pm:prd-development`'s template, removed back in 0.20.0. 4 new tests.
- v0.24.0 — **the gates were wrong in both directions, and the shape was never told the rule it was failing**: four real critiques across two planning runs, every one `sound=false`, every one blocking on the same class — *a shared primitive no package owns*: the composition root, a cross-package admission token, a goal criterion no integration step can check, a package acceptance only a sibling's result could satisfy. critique was not misfiring; `CONTRACT.shape` states none of those rules, so the shaping stage was sitting an exam with an unpublished syllabus. All three are now in the contract, in the terms critique refuses over. The other direction: `succeeded()` applied `goal_threshold` to `gate` alone, so `match_pct` was decorative on every `accept` — idol-pm-1's PRD passed at 88% carrying a gap that said the document named nothing specific to its domain. `accept` now gets the same floor, which forced the hole behind it into the open: `autoRetryPackages` walked only `task.spec.packages`, so a rejected `accept:PLAN`/`QA`/`AUDIT` had no route forward at all — the phase-Team packages are in that list now. `autoReshape` no longer spends a shaping attempt on a judge that never judged: it skips a `judge_failed` node while autoRejudge's budget lasts (that function waits a minute before reopening, and autoReshape runs later in the same daemon step, so the wait window was a free reshape carrying "judge process did not finish within 45m" as if it were a critique — idol-pm-1 hit that timeout twice in 247 minutes). Story coverage stopped being a union count: a package claiming every story, or claiming none, is now a shape problem, because idol-pm-2 passed the check with P1 and P6 each claiming all four. And a report written over a settled failure reads `SETTLED`, not `DONE` — idol-pm-1 ended with six of seven STORYs UNREACHABLE, zero packages dispatched, and an EPIC row saying DONE over a report whose own first line was "구현된 것은 없다". 7 new tests. Not closed: routing a critique's blocking items to the package that owns them instead of discarding the whole shape, and no PM run has yet reached a package dispatch.
- v0.23.0 — **a structural requirement stated in words was never checked**: `PRD_CONTRACT` names the seven sections a PRD must carry, as `## ` headings, in order. idol-pm-2 (2026-09-22) renamed two of them, dropped **Solution overview** entirely, and `gate:goal` accepted the document at 95%. A judge will not check that reliably and does not need to - it is a grep. `missingPrdSections()` now reads the files the planning run reported writing and rejects the fold when a required section is absent under any of the names a reader would accept for it (`Goals (measurable)` for Success criteria, `Non-Goals` for Out of scope, and so on, at any heading level). Calibrated against both real runs: idol-pm-1's PRD passes, idol-pm-2's is flagged for the one section it genuinely lacks. An unreadable or absent PRD yields no complaint here - the zero-stories check already covers the empty case. Also confirmed in this run: `prd_paths` was computed by the engine for the first time (`["docs/PRD.md"]`), closing the one fix from v0.21.0 that had only ever been verified by hand.
- v0.22.1 — **a seven-section PRD took 81 minutes because its sections were chained**: `setgoal` declared `U1 -> U3 -> U2 -> U4 -> U6` for the PRD's sections because the product's stories depend that way — but writing section U4 never required section U2 to exist. The `deps` contract now says what a dependency is: this subgoal's work cannot START until that one has finished, not the order the product is built in and not the order a reader will read it; sections of one document are almost always independent to write even when the things they describe depend on each other. Paired with the rule that makes removing those deps safe: when several independent subgoals write one file, each names the section it owns by heading and says in acceptance[] that it touches no other. `critique` already refuses fake dependencies, so it can now act on this one.
- v0.22.0 — **four holes in the PM path, found by running it**: (1) a failed `critique` stopped the task dead. `retryShape` — which carries the refusing verdict into the next attempt — was reachable only from `tm_retry`, so with the daemon owning the loop since v0.16.0 a critique that named three real defects in the shape sat blocked with the fix in hand. New `autoReshape()`, budgeted like `autoRepair`/`autoRetryPackages`. (2) A planning fold returning **no user stories** was accepted: goal-code-beta-R1 took one at 93% and the run built from the request alone. The child's own gate cannot catch this — it judges its document, not what the manager needs from it — so the fold now rejects it and says why. (3) A gap named while **accepting** reached nobody: gaps travelled only on rejection, so `accept:PLAN` calling a PRD "a generic high-demand ticketing PRD with 'idol concert' in the title" changed nothing about what got built. shape's briefing now carries the gaps and observations the PRD was accepted with. (4) `.claude/conventions/**` — the project's own rules — never reached planning or the manager. A PRD governs the whole tree, so selecting conventions by the paths a subgoal touches is the wrong filter for it (`matchesFiles` compares extensions and directory names as substrings, so whether a domain rule reached the PRD was luck); the `planning` stage now gets every convention in full, `revise` is wired at all, and `shape`/`critique`/`accept`/`integrate`/`gate` are told to judge against them. Also: `PRD_CONTRACT` gained a domain clause — name what is specific to this domain and write it in the domain's own vocabulary, and a practice you decide not to build goes in Out of scope rather than going unmentioned. 9 new tests.
- v0.21.1 — **the same object-to-string bug, one page further on**: `10-prd.md` rendered every user story as `[object Object]`. v0.21.0 fixed the coverage check and shape's briefing but missed `docs.mjs`'s own `renderPrd`, which pushed the raw objects through `bullets()`. Found by reading the page a real run produced, not by a test - so the test now exists.
- v0.21.0 — **with planning on, the develop workflow could not stand up at all, and the ticket surface was decorative**: the first planning run to produce real user stories (idol-pm-1, an idol-concert ticketing PRD at 200k reservations/sec) immediately failed `shape` with `user stories not implemented by any package: [object Object], [object Object], ...`. Four defects in one place, every one of them invisible until stories existed: `validateShape` compared stories with `String()`, but gate:goal's own contract returns them as `{id, title, acceptance}` objects, so no story ever matched an `implements[]` entry and shape could never pass — now `storyId()`/`storyLabel()`; shape's briefing listed the same `[object Object]` lines, so it could not see what to cover — now `US-n - title`; `implements` was never in shape's Required output at all, so it was judged on a field it was never asked for — now in the schema, and shape filled it correctly on the next pass (7 stories across 6 packages); and the briefing pointed at `10-prd.md`, a link page tm_docs renders at report time that never carries the PRD body — now the path the planning run actually wrote, carried out of the child as `prd_paths`. **The ticket surface**: a ticket is its state (tickets.mjs over task.json), its history (board.jsonl) and its body (docs.mjs's pages), and only the first was ever right — the other two hung off MCP tool calls that the daemon, which has owned the loop since v0.16.0, does not make. idol-pm-1 ran 81 minutes and 25 nodes with its PLAN story reading READY on the board and not one page written. `syncTickets()` now moves all three together from `finish()`, the one place both callers pass through, with board writes deduped against what the board already recorded (finish and the daemon's step observe the same move). A test that forbade `.teams_output` under the project was blocking the pages entirely; it now forbids manager *state* there, not output. New `inspect.mjs --tickets` prints each ticket's state and every transition. 6 new tests.
- v0.20.0 — **the PRD method named a plugin that could never mount**: `KINDS.planning.skills.draft` named `pm:prd-development`, but `pm` is not published in `marketplace.json`, so the reference resolved to nothing and every planning draft node ran with no PRD method at all. The measured result (`goal-code-beta-R1`, 286 lines) was a module-level design spec — package split, data shapes, import rules — with a one-paragraph "Product goal" restating the request, zero user stories, and no problem statement, personas, success metrics or out-of-scope section. The method is now inlined in the engine as `prompts.mjs`'s `PRD_CONTRACT`, written as the identity plus the sections so it survives with no plugin at all: a PRD is not a design spec, module contracts and package splits are the shaping stage's job, and the document must carry Problem / Target users / Solution overview / Success criteria / User stories (`## User stories`, US-n) / Out of scope / Open questions, with an unfillable section stated as a gap rather than dropped or padded. New `test-skillrefs.mjs` closes the whole class: every skill any engine table names must be a published plugin and must exist on disk, and `pm:` may never come back. Four existing tests were asserting the broken reference and were corrected. 6 new tests.
- v0.19.0 — **an inspector, because the engine was a black box**: everything a run produced — each node's prompt, its result JSON, the method it was told to load, what it reported loading, what it wrote — was already being written to disk, and nothing surfaced any of it. `node scripts/inspect.mjs <workspace|tasks-dir|task-dir>` prints the manager chain and every child run with, per node, `method[asked -> loaded]`, files written, verdict and gaps; `--node <id>` adds that node's full prompt and result paths; `--skills` is the audit that found the 0.18.0 bug (per skill, how often named vs how often actually loaded, and which were never loaded); `--docs` lists the phase-document tree; `--json` is the same model for a script. It reads only, works on a task that is still running, and finds a child run even when the workspace was moved from the cwd the node recorded. First use found a second defect: a planning subgoal whose `files[]` were `packages/queue/src/index.mjs` and `packages/cli/src/index.mjs`, with the draft node duly writing its PRD section into both — and a planning run has no worktree of its own, so that lands in the real tree. `validateSpec` now rejects a non-document path in a `planning`/`planning-audit` subgoal, and the draft contract says so in words. 10 new tests.
- v0.18.0 — **no node had ever loaded a single skill**: every method table in this plugin names skills as `plugin:skill` (`KINDS` in graph.mjs, `GRAPH_STAGE_SKILLS` in mounts.mjs, `STAGE_SKILLS` in taskmanager.mjs, a spec's own `sg.skills`), but a child driver and a judge are spawned with `--setting-sources project` — which hides the user's installed plugins — plus exactly one `--plugin-dir`, the teams plugin itself. Every named skill was therefore absent at runtime, and the prompt's own rule ("a skill that is not installed here is skipped without comment") turned that into silence: measured across the `trap` T2 run and the first `P1` planning run, every node of every child run reported `skills_used` null and every manager node `["none"]` — one shape node reported two skills it could not have loaded. New `mcp/pluginroots.mjs` resolves each named plugin next to the teams root, in both layouts (a development checkout's sibling directory, an installed marketplace's `<plugin>/<newest version>`), and `driverArgv`/`judgeArgv` pass every one of them; `.claude/team.json` gains `plugin_dirs` for anything outside that. Graph-stage prompts now also ask for `skills_used`, which only the manager stages had, so the absence was invisible from a child run. `daemon.mjs` is importable without exiting (its CLI entry is gated on being the process entry point) so `judgeArgv` can be tested directly. 8 new tests, 331 across all suites, 0 regressions.
- v0.17.1 — **the planning run built the code instead of writing the PRD** (first real-vendor planning run, `trap` P1, 2026-09-22): every package's child run was opened with `mixed:true`, so the PLAN run's own plan node read a request that says "implement …" and decomposed it into develop subgoals (`implement:U1 → test:U1 → gate:U1`, a `draft:U3` README) inside the planning phase. Phase-Team runs (PLAN/QA/AUDIT) are now opened `mixed:false`, pinned to their flow's kind, and the planning run's context says in words that the request is the thing to plan, not to do (`Change no source files`). Regression test added; the P1 run is restarted from scratch.
- v0.17.0 — **planning and QA are on by default**: `roles` defaults flipped to `{planning:true, qa:true}` (`teamconfig.mjs`), so a develop EPIC passes the PLAN phase-Team (PRD draft → revise → gate, user stories fed to shape's `implements[]`), the QA phase-Team (cases → execute → gate, defects filed as STORYs) and the planning-audit pass without a `.claude/team.json` opting in; `{"roles": {"qa": false}}` in team.json turns one off. Motive: an inspection of the four things this plugin was asked to be (planning harness, QA harness, their orchestration, task management) found the first two implemented and unit-tested (planning 8, qa 5, audit 4) but never once run against a real vendor, because every bench run left them at their old default. Known gap left open on purpose: a size-S task (`delegateIfSmall`) skips every pending manager node, PLAN included, and never wires QA — planning/QA run only for size L until the S path is given its own PLAN/QA wrap. Bench: `TEAM_ROLES='{"planning":true,"qa":false}'` and `'{"planning":false,"qa":true}'` runs on `trap` are the first real-vendor measurements of each role alone — results in `docs/plans/2026-09-21-teams-server-owns-the-loop.md` §8g.
- v0.16.0 — five daemon/broker fixes the `trap` case surfaced, each with a regression test: a folded blocked child now carries its own failed verdicts (reason, match, gaps) into the retry brief instead of a one-line "no retry left"; an authoring node's `stage_ok:false` with no reason and no failing check no longer fails the node (the test and gate judge the work, the self-report is kept as `self_reported_stage_ok`); a judge that could not judge (process died, timed out, replied without JSON, or hit a usage limit) is marked `judge_failed` and re-judged by the daemon after the reset it named — never read as a refusal that would open a repair or retry a package; a driver parked on a provider's "resets H:MM (Zone)" is resumed automatically a few minutes after that time (`autoResumeCapacity`/`capacityResetAt`, shared with `tm_retry({reset_capacity})`); and the post-hoc audit prompt now reports a test that cannot fail (a SIGKILL-atomicity test whose kill never lands in the write window, a one-sided boundary test) as a defect. First full `trap` run scored 14/14, all eight traps.
- v0.15.3 — autoRetryPackages: the daemon opens a failed package's next attempt itself (a dispatch that folded blocked or an accept that rejected; the last verdict's reason and gaps travel as feedback; max_retries budget unchanged; a merge-conflict failure, a repair package and a package with a later attempt are skipped) - trap-beta-T1 folded P1 failed after its child's three gate attempts and recorded daemon_done with the whole package budget untouched; regression test drives a child to blocked the way a default auto_reassign child gets there (91/91)
- v0.15.2 — bench trap_f no longer requires the job id in `status` output (the request says only "prints the job's current status"; trap-none-T0 printed `queued` identically across all four invocations and was marked failed by a scorer opinion) - rescored offline: plain T0 14/14
- v0.15.1 — bench case `trap` (`fixtures/trap-mono` + `requests/trap.txt`): a rate-limited job scheduler CLI whose ticket plants eight behaviors that read fine and only fail when executed (cap-vs-rate precedence, a half-open 10s boundary, idempotent replay, priority with a stable tie-break, atomic state write under SIGKILL, invocation invariance, UTC clock across a DST fall-back, success-with-warning exit code); `score.mjs` executes each as `trap_a..h`, `requests/trap.expected.md` is the maintainer's answer key and is never shown to either arm. The `scope_match` judge no longer counts a decision the request was silent on as unrequested scope; the audit prompt's generic edge-case list names idempotency, precedence, atomicity-under-crash and clock injection. Every earlier case was one on which both arms shipped 0 defects; this is the first built to discriminate.
- v0.15.0 — **post-hoc adversarial audit** (`scripts/bench/audit.mjs`): the primary quality number for an adversarial-verification flow is defects that survive into the deliverable, so one independent hostile auditor (blind to the arm, verifies by execution: test suite, edge inputs, invocation matrix, every explicit rule in the request) runs on both arms' trees after scoring and writes `<ws>.audit.json` (`defects_shipped`, by severity). First measurement on `seam-silent`: plain E0 0 defects (23 checks), teams E2 0 defects (26 checks) — on this task teams' gates caught its own builders' two wrong attempts but plain shipped nothing for them to catch. `lib/tree.mjs` is now the one place scorer and auditor locate a deliverable tree. drive.sh runs the audit after the final score (`GRAPH_BENCH_AUDIT=0` opts out); `GRAPH_BENCH_AUDIT_MODEL` defaults to sonnet.
- v0.14.2 — bench scorer: parser_names_match_codes also recognizes helper-call (fail(X, msg)) and property-read (EXIT_CODES.X) code names - a code: literal-only regex had every plain run and S1 at 11/12 for a scorer false negative that read as a shipped defect; rescored offline, plain seam runs are 12/12
- v0.14.1 — a rejected gate and the retry chain autoReassign opens now land in ONE saveRun (broker.mjs saved them separately, and the daemon - woken by fs.watch on the first rename - read a blocked child and folded the dispatch as failed while the driver was already on attempt 2: seam-silent-beta-E1 lost P1 there); dispatchSettled also treats a blocked child with a live driver as not settled - the driver exit is the settle signal; regression test added (90/90)
- v0.14.0 — **child runs chain-only**: measured, an ordinary single-subgoal STORY package's child ran the full harness graph — `plan → setgoal → critique → <chain> → gate:goal → report`, 8 nodes for a single-subgoal `develop` child — repeating shape/critique work the parent task's own `shape`/`critique` had already done, and judging the same subgoal twice (`gate:U1` then `gate:goal` immediately behind it, over the same one subgoal). `createRun({parent_shaped: true, goal, acceptance, ...})` now builds the child's KINDS chain directly — no `plan`/`setgoal`/`critique`/`gate:goal`/`report` node is ever created, not even skipped — with the run's own `spec` seeded from the package's `acceptance`/brief so `gate:U1` has something to judge. `openChild` (taskmanager.mjs) turns this on for every ordinary STORY a shape produced; a package opts out with `split: true` (or `size: 'L'`, the size node's own letter) when it genuinely still needs its own shape/dispatch cycle, and `max_depth` (declared since v0.10.1, enforced now) overrides that opt-out once a package is opened `depth` deep — `task.depth`/`child_opts.depth` is threaded through, though nothing yet opens a task nested enough to trip it. A phase-Team package (PLAN/QA/AUDIT) stays on the full graph regardless: it opens ahead of (or judges across) this task's own shape/critique, not behind it, so there is nothing here for it to have already settled. `runState`, `retrySubgoal`, and `foldChild` all read a `parent_shaped` run's own terminal chain gate in place of the goal gate it never gets, and the chain's last authoring node's `handoff` in place of the report it never gets; `retrySpec` (a spec-level rejection, with no `setgoal` to redo here) falls back to `retrySubgoal` on the run's one subgoal. Single-subgoal `develop` child: 8 nodes → 3 (`implement:U1:1`, `test:U1:1`, `gate:U1:1`). See `docs/plans/2026-09-21-teams-server-owns-the-loop.md` §3. Also in this release: `scripts/view.mjs` (a read-only local HTML/text viewer of a live task — pipeline, package cards with each child run's chain, event tail), the `seam-silent` bench case (the `seam` request text spelled out the answer, so both arms scored the same), spec-driven bench metadata (`spec_present`, `spec_user_stories`, `spec_traceability`, `scope_match` with `unrequested[]`/`missing[]`; `review_yield` demoted — rejections are not a quality score once a spec precedes the code), and the planning contract now requires `## User stories` with `US-1..n` so the audit has something to check.
- v0.13.3 — autoRepair: the daemon opens the repair package itself when integrate refuses on its checks (integrateToRepair -> openRepair, max_retries budget unchanged) instead of recording daemon_done on a blocked graph - seam-beta-D2 stopped one repair short of a report with three accepted packages; regression test added (85/85)
- v0.13.2 — saveRun is write-then-rename, dispatchSettled treats an unparseable child file as a write in progress (only a missing file is a fold), and a foldChild throw for a still-running child is recorded as daemon_fold_deferred instead of killing the daemon - seam-beta-D2 lost daemon restart 1 of 2 to that torn read; regression test added (84/84)
- v0.13.1 — daemon stays alive while waiting: the fallback timer in waitForProgress is ref-d (an unref-d timer plus non-persistent fs.watch let Node exit 0 mid-await - seam-beta-D1 died 1s after dispatching P1, then on both restarts, with the child fully done and nobody left to fold it); a torn read of task.json is retried instead of exiting; regression test added
- v0.13.0 — **the server owns the loop, not a relayed session**: measured, one real run cost $45.92, and $14.19 of it was two `claude -p` sessions (a manager polling `tm_next` 125 of 144 turns, a TaskLeader that was 23 bare polls and 13 verbatim relays out of 91) that wrote zero files and made zero decisions — `finish()` did all the real interpretation once a payload landed; the sessions only carried it there. `tm_open` now spawns `node mcp/daemon.mjs --task <id>` in place of the TaskLeader — same detached + `unref()`'d process, same survival past the opener's session, same driver/exit-file bookkeeping — and that plain loop drives every manager node itself: `advanceDispatches`/`serviceRunningDispatches`/`prepareReadyIntegrations` (shared with `tm_next` so a caller driving by hand can never disagree with the daemon about what is ready), `foldChild`+`finish` for a settled dispatch, one single-shot `claude -p` per judging node (`judge()`, the same briefing and Required-output contract a relayed fresh agent got). Waits on real events — a driver's own exit-file write, `fs.watch` on a child run's directory — with a 15s poll only as the documented fallback for a missed filesystem event, never a busy loop. The leader's inbox/watcher gate is gone with it: there is one writer, and a direct `tm_submit`/`tm_retry` from any process is applied immediately and safely alongside the daemon (`saveRun`'s own lock, plus a fresh disk read before every node mutation, is what stops a race from finishing a node twice). New: `tm_run` (open + spawn, no self-driving reply — `{task_id, run_id, docs_dir}`) and `tm_wait` (a bounded long-poll returning only the node transitions since a cursor, replacing `tm_next({wait_ms})`). `integrate`'s own Required-output now carries the product-owner questions (missing/duplication/volume) unconditionally, not only behind `roles.planning`'s audit pass. `references/orchestrate/manager.md` is deleted; the five entry skills read from a daemon-driven task instead of a relayed one. See `docs/plans/2026-09-21-teams-server-owns-the-loop.md`.
- v0.12.3 — **v0.12.3 — measured on real vendor runs, twice**: a headless watcher cannot sleep, so `tm_next({task_id, wait_ms})` now blocks server-side until the task stops running — the tool call is the only thing that holds such a session open, and without it main scheduled a shell sleep, ended its turn and abandoned a build that was still running. And a `review` of a draft the same host model wrote used to deadlock: `team_submit` refused it for sharing the author's identity while `team_run` refused it for being routed to self, so the run offered the same node forever. Independence is now taken on the model axis when the host declares one, and recorded as `unverifiable-same-host` when it does not. Bench `betas code-flat`: **2/9 not-delivered in 2min → 9/9 in 28min for $1.33**, and the run now closes 20/20 with no driver or leader restarts.
- v0.12.2 — **v0.12.2 — the first real-vendor run diagnosed: a false `blocked`**: a size-S task settles its own manager graph the moment `size` resolves, so the TaskLeader-gate watcher branch — which returns before `toolNext()` — judged a live task by three settled nodes and reported `blocked` while the child run was still building. The entry skills' standing mandate on a blocked run is to stop and report, so main did, two minutes in, and the bench scored a workspace whose driver was still working. `watcherState()` now reads the child run the same way `toolNextSRun` does, read-only, and the five entry skills stop promising a `task_state` reply the leader gate makes impossible (main's size submit comes back `queued: true`).
- v0.12.1 — **v0.12.1 — filed STORYs: QA defects, the planning audit, and tm_file**: a defect the QA phase-Team reports now becomes its own develop STORY and the EPIC loops back through a fresh integrate (capped by `qa_rounds`); `roles.planning` gains a second pass, the `planning-audit` phase-Team, which cross-checks the integrated result and the QA report against its own PRD after integration and files a STORY for every user story still unmet; `tm_file` lets a person file the same kind of STORY by hand, uncapped. The board and phase docs tell them apart by `reporter` (`shape`/`repair`/`qa`/`planning-audit`/`you`), and `65-audit.md` renders the audit — leaving `15-spec-gate.md` the only one of §7c's 13 documents still unwritten.

- **v0.12.0 — planning/QA as EPIC phase-Teams, not peer STORYs**: `.claude/team.json`'s
  `roles.planning`/`roles.qa` switches, recorded-but-inert since v0.10.1, now do something.
  `roles.planning` inserts a planning phase-Team before `shape` — its PRD and `user_stories[]`
  flow into `shape`'s own input, and `shape`'s contract gains `priority` and an `implements[]`
  completeness check against those user stories, so a story planning named can't silently fall
  through the crack between the two phases. `roles.qa` inserts a QA phase-Team between
  `integrate` and `gate:goal`, reusing the repair worktree rather than a fresh one since QA's
  tree IS the integration tree — it runs once per EPIC in this release and reports what it
  finds; it does not yet act on it. `max_parallel_teams` (default 2, a `team.json` key) caps
  concurrent develop STORY dispatch, priority-ordered — phase-Teams are exempt from both the
  count and the cap, since the design already limits each to one at a time. `tickets.mjs`/
  `docs.mjs` know both phase-Teams: `tm_board`'s STORY rows carry `role: 'planning'|'qa'|
  'develop'` (previously always `'develop'`), and `10-planning.md`/`10-prd.md`/`60-qa.md` render
  alongside the 8 phase documents v0.11.0 already covered — 11 of §7c's 13 now render; the
  remaining two are `65-audit.md` (v0.12.1, the planning cross-review) and `15-spec-gate.md`
  (v0.13.0). Two real bugs surfaced closing out the doc work: `team_open` never surfaced a
  malformed `.claude/team.json` key to the caller (now `team_status`'s `config_notes`), and
  `tickets.mjs`'s `docPaths` had re-typed `docs_dir`'s `.teams_output/team` literal instead of
  reading it from `TEAM_DEFAULTS` — the be83bbc shape exactly, just never triggered. Full suite:
  344/344 across all `test-*.mjs`, 0 regressions. Not yet measured: none of this has run against
  a real vendor — every line above is unit-tested only, the same bar v0.10.1 and v0.11.0 held.
  Not done yet: a QA-found defect does not yet reopen the EPIC as a develop STORY (no `tm_file`,
  no automatic dispatch→accept→integrate→qa loop), and planning does not yet run a second time
  as a cross-review pass — both are v0.12.1, already staged on top of this release.
- **v0.11.0 — ticket layer, board.jsonl, phase documents**: `tickets.mjs` derives EPIC/STORY/TASK
  ticket state and `epicPhase` from `task.json` alone, as pure functions — never a second source
  of truth. `tm_board` (every EPIC, or one EPIC's STORY kanban) and `tm_ticket` (one ticket by
  key, `E-xxxxxxxx` or `E-xxxxxxxx/Pn`) read them — every tool that takes a `task_id` resolves a
  full run id or its `E-xxxxxxxx` key the same way (§8); `tm_board` is not special-cased, it just
  happens to be the one this entry names. `board.jsonl` logs only the transitions a
  before/after diff actually finds around the four tools that can move a ticket
  (`tm_open`/`tm_next`/`tm_submit`/`tm_retry`) — a JIRA-style history, never itself read as
  ground truth. `docs.mjs` renders 8 of §7c's 13 phase documents from the same `task.json` —
  INDEX, request, shape, critique, one page per STORY, integrate, goal gate, report — wired
  through `tm_docs({rebuild})`, proven byte-identical on a second render; the other 5 (planning,
  PRD, spec-gate, qa, audit) need Team wiring that doesn't exist until v0.12+, so they are
  omitted rather than rendered empty. `teams:board`/`teams:ticket` are thin terminal-table
  wrappers over the two read tools. Two real bugs surfaced building this: EPIC ticket
  state/phase was gating on the integrate/report nodes merely *existing* — which
  `expandPackages` creates in the same call that opens the package dispatch/accept chains — so
  an EPIC jumped to IN_REVIEW the instant shape succeeded, before any package had even been
  dispatched; TASK ticket state had the same existence-vs-reached bug across
  implement/test/gate. Both now gate on the node's own `unmetDeps()`/stage actually being
  reached. Also this round: the TaskLeader's best-effort `SendMessage` progress ping is gone —
  it was never verified, retried, or acked, and a message that never arrives is
  indistinguishable from nothing having changed; `tm_board`/`tm_ticket`/`tm_events` are the
  durable, pull-based replacement. Full suite: 301/301 across all `test-*.mjs`, 0 regressions.
  Not yet measured: none of this has run against a real vendor — every line above is
  unit-tested only, the same bar v0.10.1 held. Not done yet: `planning`/`qa` still are not wired
  into the EPIC flow, and shape's role/priority, defect STORYs, and human executors remain
  v0.12.0+ — same round that will pick up the 5 omitted document kinds above.
- **v0.10.1 — planning and qa kinds, plus a worktree gate-visibility fix**: two new `KINDS`
  entries, `planning` (draft→revise→gate) and `qa` (cases→execute→gate), each with their own
  personas, per-stage skills and MCP mounts (§3, advisory `draft`/`cases` mounts), reaching
  `CONTRACT.revise/cases/execute` (before this round the two new stages silently fell back to
  `CONTRACT.implement` and would have prompted a vendor for implementation-shaped output instead
  of a document or a test) and `broker.mjs`'s reviewer-independence guard: `revise` is now refused
  the same way `review` is when routed to the identity that wrote the draft. Two new entry skills,
  `teams:plan` and `teams:qa`, pin the flow the way `develop`/`document` already do.
  Separately, `ensureWorktree` now records a `gate_uncommitted` event to the task ledger
  (`tm_events`) when a worktree inherits harness's gate config without the gate files being
  committed — a git worktree only inherits committed files, so an uncommitted
  `.claude/harness-gate.json` plus hook left a worker's writes silently ungated while the user
  believed the gate was protecting them; the event is warning-only, best-effort, and never blocks.
  Not done yet: `planning`/`qa` are not wired into the EPIC flow — planning does not automatically
  run before shape, qa does not automatically run after integrate, `team.json.roles` stays
  recorded-but-inert — reach them today only via `tm_open({flow: "plan"|"qa"})` or the two entry
  skills; that wiring needs the ticket layer, v0.11.0+. Full suite: 258/258 across all
  `test-*.mjs`, 0 regressions. Not yet measured: the two kinds have never run against a real
  vendor — the `plan-flat`/`qa-flat` bench request files exist but the bench itself was not run
  this round (it spawns real model processes), so all evidence so far is unit tests. The PRD path
  `.teams_output/team/E-<task8>/10-prd.md` is documented and round-tripped in a test, but nothing
  computes it automatically yet — a spec has to name it in `subgoal.files[]`.
- **v0.10.0 — install/remove/patch, and main never drives anything**: two threads finished
  together. First, teams gets the same operational shell as harness: `install`/`remove`/
  `patch` skills backed by deterministic scripts. `install.mjs` writes `.claude/team.json` —
  `tm_open`'s own defaults, read before its arguments, so a project can pin
  `goal_threshold`/`allocation`/etc. without every call repeating them (explicit args still win
  over team.json, team.json over hardcoded defaults). `remove.mjs` undoes it idempotently.
  `patch.mjs` bumps `x.y.Z` in both manifests and prepends one `## Status`/`## 상태` line to
  README **and** KOR.md in the same call — it refuses without both `summary` and `summary_ko`,
  because this repo moves the two languages together. Second: the driving session never drives
  a node, full stop. `tm_open` now throws if `child_driver` or `s_driver` is passed (**breaking**:
  any script pinning either gets `removed in 0.10.0: the driving session never drives...`);
  `HARNESS_TEST_NO_DRIVER` is the internal test seam that replaces them. In their place, `tm_open`
  spawns a **TaskLeader driver** — a headless session that runs the manager loop
  (tm_next/tm_submit/tm_retry) itself; main only watches `tm_status`/new `tm_events` (tails the
  ledger, `since`/`limit`, read-only from any session) and gets queued behind an inbox
  (`<taskDir>/inbox/<ts>-<seq>-<tool>.json`) if it tries to mutate a task the leader owns — the
  leader drains it on its next `tm_next`. A dead leader respawns up to `driver_restarts` like a
  package driver, then reports exhausted. Coexistence with harness needed one more piece:
  `.claude/.harness-markers/team-<task8>`, written into every worktree `tm_next` touches — the
  **same file shape harness's own gate already reads**, so harness needed zero code changes;
  `dispatch-gate.mjs` reads it back the other way, so a harness-engaged session isn't blocked by
  team's own dispatch gate either. `excludeMarkers()` keeps that path out of git (`info/exclude`)
  and fold commits unstage it, or every package branch would conflict on a timestamp. Full suite:
  241/241 across 13 files, 0 regressions. Not yet measured: a real run against a harness+team
  project, and whether the leader's SendMessage progress line actually reaches the session that
  opened the task.
- **v0.9.0 — the accuracy round**: five changes built in parallel against the "What the rewrite
  dropped" table, all on the side of more judging and more evidence, none on the side of cost.
  (1) `.claude/conventions/**` reaches plan, setgoal, implement and draft again (`mcp/conventions.mjs`);
  plan surveys dependencies, deterministic verification and conventions per unit; setgoal is
  forbidden by name to author whole-repo-state or aspirational criteria; a structurally rejected
  spec gets the "you shrank the payload" diagnosis on retry; every upstream handoff folded into a
  prompt is capped at 1500 chars (`HANDOFF_CAP`). (2) The graph engine mounts stage skills like
  the manager does — plan → `agents:agent-task-decomposer`, critique/gate/review →
  `think:devils-advocate`, test → `completion:verification-before-completion` — plus advisory MCP
  mounts (sequential-thinking, think-tool, mcp-reasoner); `team_open({skills, mounts})` overrides
  or disables. A `sound:false` critique now re-authors the spec by itself, budgeted like a subgoal
  retry; `vendor:"auto"` actually tries claude then codex before `self`. (3) The goal gate is two
  independent judges (`goal_judges`, default 2) with different identities; the run accepts only on
  unanimous accept at or above `goal_threshold`; each judge must list `attacks[]` — invocations
  from outside the tree, the way the requester will call it — or its accept is refused like an
  empty `checks[]`. A rejected round opens a cross-vendor `repair` stage over the assembled result
  (Step 9), then re-judges; two identical rejections stall onto partial-work reporting;
  `team_retry({repair:true})` forces one. (4) A dead package driver resumes on the same run_id up
  to `driver_restarts` (default 2); a usage-limit death parks the package on `waiting_capacity`
  and `tm_retry({reset_capacity:true})` resumes it; size-S requests get the same one-driver
  process handoff as an L package (`s_driver`, default `process`). (5) Bench: a `seam` fixture
  whose two halves pass alone and only meet through a shared exit-code table (12 criteria, 5 seam,
  two of which reproduce the 0.8.1 `/var` defect); a `skills` arm that mounts the plugins the
  harness names; judge fields (`seam_detected`, `gate_rejections`, `judges_with_checks`,
  `repairs`); and six scorer misreads fixed with the helpers moved to `bench/lib/claims.mjs`.
  Measured before this round, on 0.8.1 all-Claude with codex disabled: `betas code-flat` **9/9**,
  21 min, $6.54, every gate with checks, 0 false claims after rescoring — against 8/9, 44 min,
  $11.88 on 0.7.3. Tests 219 across nine files. Not yet measured: this round, the `seam` case,
  and anything with codex.
- **v0.8.1 — test goes to whoever did not implement**: the 6/9 on the manager run was traced to
  one line. The integrated CLI is correct when run from inside the tree and prints nothing when
  reached by its `/var` symlink, because its "am I main" guard compares `import.meta.url` to the
  unresolved `process.argv[1]`. The peer (codex) wrote it; the peer's test node invoked it
  through the one path that hides the mismatch and reported 17/17; three host gates accepted at
  92–95 with `checks: []`. The plain-session CLI has no such guard, hence its 9/9. This is not
  "the other vendor cannot be trusted" — the same run's 17 codex nodes all verified their file
  claims and `npm test` is 85/85 — it is author and tester sharing a vendor and therefore a blind
  spot, which `CROSS_VENDOR_STAGES` guaranteed by sending both to the peer. `rankCandidates` now
  prefers, for `test`, whichever vendor did **not** implement the subgoal (`AUTHOR_OF.test =
  'implement'`), including when the implementer fell back to the host. Every other score loss
  to date was spec drift on all-Claude runs or an engine bug; the analysis is in
  `scripts/bench/README.md`. 161 tests.

- **v0.8.0 — the recursion moves into the process tree, and the scorer starts counting what the
  harness is for**: four changes built in parallel from one diagnosis. The manager had been
  relaying every child node's briefing and result through its own context — 54 nodes across five
  child runs, 507k tokens, 331 turns, ~55% of a $42 run, dead at the usage limit after six
  resumes. (1) A ready `dispatch:Pn` now spawns one headless session in the package worktree that
  drives the child run to the end; the manager polls `tm_next`, sees `driver: {pid, alive}`, and
  folds. A dead driver folds as blocked with its stderr and `tm_retry({package_id})` respawns.
  `child_driver: "inline"` keeps the old loop for comparison. (2) Judging leaves the host's tier:
  only `critique` and the goal gate inherit `host_model`; every other judging stage takes the
  vendor default (the measured 40%). A gate that says `accept: true` with an empty `checks[]` is
  refused — a judgement with no evidence is a guess — and the failure stays on the gate, not the
  work. The manager's own `gate:goal` gets the same `goal_threshold` floor (default 90) the
  children already had; it turns out `goal_threshold` was never reaching `child_opts` either. (3)
  A seam — an integrate failure no package can see from its own worktree — has a repair path:
  `tm_retry({repair: true})` opens package `R1` **in the integration worktree**, on the combined
  tree, with every package's touches in scope, and the next `integrate` bases on its branch instead
  of re-merging from HEAD. This was the documented graduation blocker. (4) `score.mjs` extracts
  every claim a run or a plain session makes — changed files, `checks` of the form `cmd -> shown`,
  `verified`/`accept` flags, test counts in handoffs and in session prose, README shell examples —
  and holds each to the tree: reruns what is safe and idempotent, compares an explicit `exit=N`
  exactly, leaves placeholders (`<good.csv>`) and prose checks `unverifiable` rather than false.
  Rows carry `false N/M`. Rescoring this round's three workspaces gives **0 false across 107, 92
  and 193 claims**; the first draft had said 16, every one a scorer misreading (`# fail 0` read as
  failure, `exit=1` ignored, per-module counts held to the tree's total). **None of the cost claims
  above are measured yet** — 160 unit tests pass and the driver path has been exercised only
  against a fake; the first real spawn will be a bench run, where $42/143 min is the number to
  beat and the new failure mode to watch is several package sessions hitting the limit at once.

- **v0.7.4 — cross-vendor attribution stops being an assertion and becomes a measurement**: no
  code changed; three runs on 0.7.3 went out in parallel to see whether everything built between
  0.6.9 and 0.7.3 shows up live. `betas code-flat` 8/9 in 44 min for $11.88, `betas docs-flat` 9/9
  in 63 min for $21.79, and the manager path `beta code-flat` 6/9 in 143 min for $42.50 — the last
  one stopped at `integrate` because the session limit ran out, not because anything in it failed.
  It measured `size` **L** on its own, shaped **4 packages**, and accepted all four: P1 and P2 at
  95, P4 at exactly the 90 floor, and **P3 rejected at `accept: false` then retried into a fresh
  child run and accepted at 94** — `tm_retry` doing in the live manager loop what `autoReassign`
  does inside a graph. The cell that mattered: across the five child runs the executor split was
  claude 32 / codex 22, and **17 nodes carry `('codex', 'isolated', changed_files_verified: true)`**
  with `contradicted_files` empty. Every one of the 49 isolated attributions on disk before this
  round had run on Claude, so positive cross-vendor attribution was an argument about the
  mechanism; it is now data. All five child runs carry `isolated: true, goal_threshold: 90,
  auto_reassign: true`, so the `child_opts` plumbing is real. One non-finding recorded so it is
  not rediscovered: every manager stage reported `skills_used: ["none"]`, which is correct — the
  bench arms load `--plugin-dir teams` alone, so the skill plugins are genuinely absent and
  the briefing's "skipped without comment" rule fired. Still unmeasured: `integrate` and the
  manager's own `gate:goal`, which no run has reached with four packages in play, and that gate is
  held to no threshold at all. Numbers in `scripts/bench/README.md`.

- **v0.7.3 — a reassigned subgoal no longer inherits a dead generation's dependencies**: the
  first live run on 0.7.2 confirmed the new work — persona on `implement` and not on `gate`,
  `develop:clean-code` / `develop:testing-workflow` + `completion:verification-before-completion`
  / `think:devils-advocate` arriving from the kind, all six execution nodes on codex and all
  seven planning and judging nodes on the host — and then blocked at 3/9 on a bug none of the
  unit tests could see. `test:U3:2` was rejected, the engine reassigned U3 by itself exactly as
  intended, and the new `implement:U3:3` was born with `deps: ["critique", "gate:U1:1",
  "gate:U2:1"]` — attempt-1 nodes a spec-level retry had already skipped as superseded. It could
  never become ready, so the run sat blocked with two subgoals and the goal gate never reached.
  `retrySubgoal` took its upstream from the *earliest* head node of the subgoal, which is the
  right node only until a spec retry re-expands the subgoals underneath it. It now takes the
  latest head that has not been superseded; every attempt in a generation copies the same base
  dependencies, so that is the same upstream, from the generation that is actually alive.

- **v0.7.2 — method comes from the kind, because asking for it did not work**: the first live
  runs on 0.7.1 came back with `skills: []` on every subgoal and no `skills` field at all on
  any package, while `persona` — asked for in the same breath — was filled every time and
  filled well ("editor-archivist reconstructing design history from code"). The difference was
  candidates: the flow hands setgoal a list of personas to choose from, and the skills contract
  handed it a shape and nothing to pick. An agent that cannot see what is installed will not
  invent a plugin name, and `[]` was the honest answer. So the list moved to `KINDS`, by stage:
  `subgoal` gives implement `develop:clean-code`, test `develop:testing-workflow` and
  `completion:verification-before-completion`, `document` gives draft `write:doc-coauthoring`
  and review `write:writer-verification`, and both give the gate `think:devils-advocate` — which
  is how the generation this replaced did it, with names written into the prompts rather than
  chosen at runtime. A spec that does name its own still wins for the authoring stage, since
  setgoal knows this particular work and the kind only knows its shape; a judging stage always
  keeps the family's, because a judge's method is not the author's to choose.

- **v0.7.1 — the same objection twice reshapes instead of retrying, and the judge stops being
  handed the author's identity**: a subgoal rejected twice on the same signature (reason plus
  sorted gaps) is no longer retried a third time — the engine escalates to `setgoal` and
  `critique`, the line that can actually change the answer, carrying what the subgoal kept
  failing on. `goal-docs` is the case: a package README truthfully said "the repo has no other
  docs", false only once the packages were combined, so no attempt inside that package could
  ever fix it and the budget went on learning that three times. The goal gate now has a match
  floor, `goal_threshold`, default 90 and settable per run (0 judges on the verdict alone) —
  a gate that accepts at 70% was reporting a partial result as a pass. Per-subgoal `skills`
  join `persona` in the spec, and packages carry their own into their child run. And the bug
  that comparison found: persona and method sat in the briefing block every stage of a chain
  shares, so a gate was told to act as the implementer who owns the module two lines above
  being told it is the judge and not the actor. Both now reach authoring stages only.

  Comparing the rewrite against the generation it replaced (`harness/engine/pipeline.js`) is
  what produced most of this, and the plan document now carries that table so the rest is not
  rediscovered one expensive bench run at a time. It is not flattering: the automatic retry
  loop, stall detection, stage-mounted skills and the goal threshold were all present before
  and were lost in the move from an in-process loop to an MCP server driven by an external
  session. Still outstanding and now written down: `.claude/conventions/**` is gone entirely
  from the engine, the manager's own `gate:goal` is held to no threshold, a `sound: false`
  critique still has no automatic path, and the goal-gate repair pass is proposed as Step 9
  rather than built.

- **v0.7.0 — a rejected quality gate reassigns the subgoal itself**: a gate, review or test
  that returned a negative verdict used to fail its node, block the run, and wait for the
  caller to call `team_retry`. That made the rejection advisory — a session that never called
  it simply stopped, and the gaps the gate had found went nowhere. The engine now opens the
  next attempt on the rejection, carrying exactly the feedback `team_retry` would have carried
  (the last judging node's reason, gaps and failing checks, plus a rejecting goal gate's text),
  and settles into `unreachable` when the budget is gone precisely as before. The submit verdict
  carries `reassigned` so the caller can see it happened. Routing reassigns too: an identity
  whose earlier attempt at the same stage was rejected is now penalised, because `goal-docs`
  spent its whole budget handing the same package back to the same author in the same worktree
  to reach the same conclusion. Only the verdict reassigns — a node that could not run at all
  keeps its existing path — and the goal gate is excluded, since its rejection blames the
  assembled result rather than one subgoal. `team_open({auto_reassign: false})` restores the
  old advisory behaviour; the manager passes the setting through to every child run.

- **v0.6.9 — a hook that makes the driving session dispatch instead of doing the work**: the
  plugin now ships a `PreToolUse` gate, installed with it. It does nothing until a project
  opts in with `.claude/teams-dispatch.json`; with that file present, a write to a gated
  path is denied **while no task or run is open**, and the denial names the call to make
  (`tm_open`) and the way out (delete the file, or add the path to `allow`). Once the harness
  is engaged every write passes — nodes have to write, and a gate that told a node's fresh
  agent otherwise would brick the run. This enforces the shape the bench already measured: a
  session driving the harness well shows `top-level edits 0`, and a session that starts editing
  the project has stopped orchestrating — which is both how the manager's reason for existing
  gets skipped and how the driving session's context grows (507k tokens over 331 turns, ~55%
  of a task's cost). `paths`, `min_chars` and `allow` are all optional, the harness's own state
  is never gated, and the hook fails open on every error: a hook that blocks a session over its
  own parsing is worse than no hook.

- **v0.6.8 — a node ran on the other vendor, and the split held on its own**: with Codex
  logged in, `betas code-flat` put all seven execution nodes (`draft`, `implement`, `test`) on
  `gpt-5.6-sol` and kept every `critique`, `review` and `gate` on the driving host — so author
  and reviewer were **different vendors** on four subgoals without anyone arranging it. Codex
  returned a valid stage contract 7 times out of 7, the run finished 23/23 nodes at 8/9 and
  $11.88 against $13.20 for the same arm entirely on Claude, and when Codex's capacity ran out
  mid-run the vendor was recorded in `unavailable_vendors`, the reason was kept on the node's
  `attempts`, and the remaining work fell back to Claude without stopping. `changed_files_verified`
  was `null` on all seven with no contradicted file: that is the shared-worktree path, where
  positive attribution is unsound by design. The manager opens every child run `isolated` and
  serialises mutating nodes, and the manager-path runs already on disk tally **49 nodes, all
  `('isolated', true)`** — so what remains unmeasured is only an isolated node whose executor is
  Codex, not the mechanism.

- **v0.6.7 — the manager's stages get a method, and say which one they used**: every judging
  and planning stage now names skills it should load before working — `shape` gets
  `develop:domain-driven-design` and `architecture-designer` because its contract already says
  to split by ownership rather than by phase, `critique` gets `think:devils-advocate` and
  `cognition:assumption-extractor` because its contract's word is "attack", `accept` gets
  `cognition:epistemic-reasoner` for claims against evidence, `integrate` gets
  `cognition:second-order-thinker` for what breaks only when the packages are combined, and
  `gate:goal` gets `cognition:critical-thinking-workflow`. `size` deliberately gets none: it is
  a measurement whose one failure mode is reaching for method instead of running commands. A
  skill written for a person carries two things a headless node cannot obey — its own output
  template, and a "what you do" half addressed to a human partner — so the briefing says
  outright that the stage contract outranks both, that a skill absent from the installation is
  skipped without comment, and that no node may ask a question. Every contract now returns
  `skills_used`, because a method whose use cannot be observed cannot be judged. Override per
  stage with `tm_open({skills: {...}})`, or run on the contracts alone with `skills: false`.
  **Unmeasured so far**: whether this earns its cost. The baseline to beat is `goal-code` at
  7/7 · 130 min · $44.74, and judging nodes are already ~40% of a task's spend.

- **v0.6.6 — a score can no longer contradict the harness's own verdict**: `goal-docs` ended
  with two failed `integrate` nodes, a blocked package and three `unreachable` nodes — the
  settle path, working — and the bench scorer reported **8/8** on the integration worktree that
  integrate had refused, LLM accuracy judge included. `task.json` carries no state field, so the
  scorer had been printing `-` where the verdict belongs; it now derives one from the nodes
  (`delivered` / `settled-failure` / `incomplete` / `not-delivered`) and prints it beside the
  score. Two driver defects with it: a limit message reading "hit your **weekly** limit" did not
  match a regex that knew only `session|usage`, so a job was marked done mid-task; and a second
  driver over the same workspace restarted its resume numbering at zero and overwrote the first
  driver's stream, losing that session's cost and turns from every later sum ($53.38 read back as
  $22.89). What `goal-docs` proved by failing: a seam defect cannot be repaired by retrying the
  package in isolation — `tm_retry({package_id})` returns the work to a worktree where the
  offending claim is still true. The repair path is missing, and it blocks graduation.

- **v0.6.5 — the bench driver no longer mistakes a killed session for a finished one, and the
  same-topology comparison is complete**: a session killed from outside (a low-memory kill, a
  SIGKILL) writes no `result` event, and `drive.sh` read that empty text as "ended cleanly" —
  two runs were marked done at the moment they died. A stream with no `result` event is now a
  kill and is resumed straight away; a resume that opens no session stops its job instead of
  spending the whole retry budget in a second. `resume.sh` parsed a workspace name
  `<case>-<arm>-<label>` from the left, so `goal-code-beta-g1` became case `goal` and every
  one-line-goal resume died on a missing request file; it parses from the right now. The
  `$TMPDIR`-under-`/private/var` assertion fixed in graph 1.7.1 was still failing here. With
  `betas docs` in (9/9 · 68 min · $21.79 · 31 agents) both same-topology pairs are measured:
  against stable's 9/9 · $18.10 the beta costs 20% more and spends it on a real `document`
  flow — 9 `draft`, 9 `review`, 10 `gate`, no `implement` — where stable has no document kind
  and ran the same request as implement/test. The engine's overhead is the engine's; round 1's
  34× belongs to the manager topology, not to the beta.

- **v0.6.4 — the shape contract tells the truth about branches, and the bench measures the
  layer the manager is for**: a critique node in the first one-line-goal run caught the shape
  contract still saying every package "branches from the current HEAD" — dependents have
  branched from their dependency's delivered branch since 0.6.0, and the stale sentence made
  the critique argue against a dependency that was in fact the point. Fixed. The bench gains a
  `betas` arm (teams with `size` left to measure: one run, the same topology as stable —
  8/9 · $13.20 against stable's 9/9 · $13.27 on `code`) and `goal-code`/`goal-docs` cases that
  hand the harness a one-line goal and leave the split, the contracts and the document set to
  it; the scorer judges the outcome against the goal and the manager's decomposition on its
  own terms. First observation: shape split the one-line goal into the same four packages a
  person had written for the specified case. Not measured yet, in any round: cross-vendor
  dispatch — codex is not logged in on the bench machine, so every node ran on Claude; recorded
  as the next round, not assumed.
- **v0.6.3 — the first manager runs to complete, and what they broke on the way**: two size-L
  tasks ran to `report` end to end (`scripts/bench/README.md`, Results). Getting there found
  three more manager defects, each fixed with a test: the fold's `git add -A -- . ':!.teams_output'`
  exits 1 when the project's `.gitignore` lists `.teams_output/` — the usual case, and every test
  repo now has it — so two accepted children could not be committed; the add now stages
  everything and unstages `.teams_output`. `tm_retry({package_id})` accepted an id the shape never
  named and opened a phantom package; it now refuses with the list. And an `integrate` that failed
  its checks stayed failed after the package it blamed was retried and accepted — the goal gate
  waited behind it forever, the same wedge the graph engine had with a rejected `gate:goal` —
  so a package retry now reopens a fresh `integrate:N` over the same accepts and moves the goal
  gate behind it. Also in this release: `resume.sh` and `drive.sh` continue an interrupted
  workspace in a new session and sleep through usage-limit resets; the scorer sums every session
  that drove a workspace, takes wall time from the runner's stamps, and separates the driving
  session's tool calls from its fresh agents'. Measured: the manager matched the plain session's
  9/9 on both cases at 34× / 12× the cost; where the money went and what to do about it is in the
  plan doc (Step 7). The manager stays experimental until a request that measures L on its own
  runs through it.
- **v0.6.2 — tiers resolve against what the host declared, and size can be pinned**: the
  second e2e round got past `plan` and then blocked every `implement`/`draft` node with zero
  failed nodes: the execution default names a tier (`sonnet`), the session declared ids
  (`claude-sonnet-5`), and the check compared strings. The driving session's only way out was
  a second `team_open` — an orphan run and a redone spec, twice. `resolveNativeModel` now
  matches a tier against the declared list (`sonnet` ~ `claude-sonnet-5`), and a tier the host
  never declared runs on the host model with the substitution written into the routing
  reason — visible, never silent, never a dead run over naming. `loop.md` names the
  `vendor-failure` dead end and forbids the second open. The same round also measured both
  monorepo fixtures S, with sound reasons (one test script, one commit, no ownership
  boundary): `size` reads build units, not package counts, and the manager path was never
  reached. `tm_open({size: "L"|"S"})` pins it the way `flow` is pinned — for a user who said in
  their own words that the work must be split — and records the size node as `pinned`. The
  bench's beta arm now carries those words; the runs without them are the delegate-path
  datapoint.
- **v0.6.1 — the host's own model is selectable, and a bench**: the first e2e round's
  driving session reported itself as `claude-opus-5[1m]`, a context variant the fresh-agent
  picker does not list, and `team_open` blocked at `plan` with `native host cannot select
  model` — a vendor failure for a model the host was running at that moment. The check now
  passes `host_model` unconditionally: a fresh native agent with no override inherits it.
  The same round sized both flat requests S — an empty single-package repository shows `size`
  no build units — so `scripts/bench/` now carries two monorepo fixtures that size L (`code`:
  four workspace packages; `docs`: three packages to document), the flat ones for the delegate
  path, a runner that drives one arm (`beta`, `stable` graph 1.x, `none`) through a headless
  session, and a scorer (static + executed criteria, one LLM-judged accuracy check for docs,
  session cost and skill-compliance counts from the top-level transcript). Fixture note: the
  first round's `npm test` = `node --test test/` fails on Node 22 (a directory argument); the
  fixtures now use `node --test`. Results land in `scripts/bench/README.md` as rounds complete.
- **v0.6.0 — integrate and repackage**: the git work is the manager's, so a conflict is a fact
  it saw and not a claim a node made. Folding an accepted child commits its worktree on the
  package branch (the run's own state directory excluded). A package with `deps` is branched
  from its first dependency's branch with the rest merged in — it builds on delivered work
  instead of re-discovering it at merge time; two dependencies that conflict fail the dependent
  dispatch before any child opens. When `integrate` becomes ready, `tm_next` merges every
  package branch into the integration worktree in dependency order and records the merge
  commits; the `integrate` agent only runs the goal-level checks on the combined tree. A merge
  conflict fails the node with `conflicts` and `conflicting_packages` (the merged one, then the
  owners by declared `touches`), and `tm_retry({repackage: [...]})` — the open question, now
  answered — reshapes with those packages told to become one or to depend on each other; kept
  ids reuse their worktrees. Identical edits merge silently by git's rules, which the tests had
  to learn. 13 manager cases; 112 pass across the three suites.
- **v0.5.0 — size gate in every entry**: `teams:orchestrate`, `develop` and `document` all
  open with `tm_open`; one fresh agent runs `size`. `delegate` present → the task is already gone
  and the skill continues with `team_open(delegate.args)` and the one-run loop; absent → the
  new `orchestrate/references/manager.md` loop: `tm_next` children driven with the ordinary
  `team_*` loop at the child's worktree, folded with a payload-less `tm_submit`, `tm_retry` per
  package or reshape. A pinned entry flow survives sizing (the entry wins over what `size` says),
  and `delegate.args` is accepted by `team_open` verbatim — tested end to end across the two
  servers. 110 pass.
- **v0.4.0 — TaskManager server, read-only over children**: `mcp/taskmanager.mjs`, registered as
  `task-manager` next to the broker. `tm_open` builds `size → shape → critique` under
  `~/.harness/tasks/<task_id>/` (never under a project). A `size` of S deletes the task and
  returns `delegate: {tool: "team_open", args}` — an S request leaves no manager state. L goes
  on to `shape` (packages with `brief`, `acceptance`, `touches[]`, `deps[]`; validated for
  overlap, dangling deps, cycles, and the one-package case), then `[dispatch → accept]` per
  package, `integrate`, `gate:goal`, `report`. A ready `dispatch` is executed by the server in
  `tm_next`: `git worktree add` from the project's HEAD, then `createRun` from `graph.mjs` as a
  library opens an isolated child graph run there with the package brief as request and the
  package contract (plus its dependencies' reports) as context. The session drives the child
  with the ordinary `team_*` tools; `tm_submit` on the dispatch folds the child's goal-gate
  verdict and report by reading its file — byte-for-byte untouched, tested. A retry reopens the
  same worktree with a fresh child carrying the gaps; exhaustion settles downstream and releases
  the report. Restarting the server resumes from files without reclaiming a running dispatch.
  Found on the way, in the graph engine itself: a rejected `gate:goal` was never re-judged after
  the subgoal retry, so the run wedged with the fix in place — now a fresh `gate:goal:N` opens
  over the live subgoal gates and the report moves behind it. 10 manager cases + 1 engine case;
  109 pass across the three suites.
- **v0.3.0 — flows and entry skills**: `team_open({flow, mixed})`. `flow: "auto"` (the
  `teams:orchestrate` default) leaves the choice to `plan`, whose contract now returns
  `flow` (develop | document), `size` (S | L) and the commands it measured with; a plan that
  says nothing falls to develop and the run records `flow_source: "default"` rather than
  passing it off as a decision. `teams:develop` and `teams:document` are thin manual
  entries — trigger words, the pinned `flow`, a persona set — that hand off to the one loop,
  now in `orchestrate/references/loop.md`. The flow supplies the kind a subgoal did not name;
  `mixed: false` makes the other kinds a spec defect at setgoal. `team_next`/`team_status`
  report `flow` and `size`. Three new cases; 98 pass. `size: L` is recorded, not yet acted on.
- **v0.2.0 — `document` kind**: a subgoal may declare `kind: "document"` and expands to
  `draft → review → gate` instead of implement/test/gate; kinds mix in one spec. `draft`
  writes the artifact and is cross-checked like implement, except that an empty file claim
  is `changed_files_verified: null` (`document-unchanged`), never a contradiction — a note
  delivered in the handoff is judged by its reviewer, not by git. `review` is a reasoning
  node: read-only sandbox, one entry per acceptance item quoting the passage or naming what
  is missing, verdict `verified`. Author ≠ reviewer is enforced where the broker can see
  identity: a review routed to the vendor+model that drafted is refused and left pending
  (`reviewer_independence: distinct-identity | unverifiable-self` on the verdict). Balanced
  allocation gets this for free — draft goes to the peer, review stays on the host. A retry
  after a failed review or test now carries that node's checks as feedback, not only a
  gate's gaps. Five new cases; 95 pass.

- **v0.1.0 — fork + kind table**: copied from graph 1.7.0 (typed edges, settled failure).
  `expandSubgoals` and `retrySubgoal` now build a subgoal's node chain from a `KINDS` table
  instead of hard-coded implement/test/gate; `subgoal.kind` is validated against it. One kind
  so far — `subgoal` — and the 89-case regression suite passes unchanged, which is the point
  of this step: the seam exists and behaviour has not moved. One new case: an unknown `kind`
  fails at setgoal like any other spec defect.

## Install

Installing `teams@newkayak12-claude-skills` is the one non-optional step: it registers the
`teams-engineering` and `task-manager` MCP servers. Reload Claude Code if a `tm_*`/`team_*` tool
is not visible afterward. For a source checkout instead of the marketplace plugin, register
`mcp/broker.mjs` under the name `teams-engineering` and `mcp/taskmanager.mjs` under
`task-manager` in the project's `.mcp.json`; `skills/install/SKILL.md`'s "Install modes" section
shows both entries.

Running `teams:install` after that is optional, not a prerequisite for running a task — every
run skill (`orchestrate`/`develop`/`document`/`plan`/`qa`) drives a team through the two MCP
servers alone, falling back to `TEAM_DEFAULTS` (below) with no `.claude/team.json` at all. Run
`teams:install` when the project is ready to commit to its own defaults, a dispatch gate, and
`.claude/conventions/` instead of the plugin's built-in ones — see
[`skills/install/SKILL.md`](skills/install/SKILL.md) for what it adds and
[`skills/orchestrate/SKILL.md`](skills/orchestrate/SKILL.md)'s "Running without install" note for
the bare path.

## Configuration

`.claude/team.json` supplies project defaults for both `tm_open` and `team_open` — the broker's
own direct entry point reads it too, the same way TaskManager does. Precedence is built-in
default < `team.json` < an explicit argument of the same name on whichever tool opened the run
(`teamconfig.mjs`'s `resolveTeamOptions`); an unrecognized key or a value that fails its
validator is ignored rather than applied, and recorded as a note — `tm_status`'s `team.notes` on
the `tm_open` path, `team_status`'s `config_notes` on the `team_open` path (present only when
there is at least one note; it is the run's own persisted copy of `resolveTeamOptions`' notes,
not a live re-check). The schema is `TEAM_DEFAULTS`/`CHECK` in
[`mcp/teamconfig.mjs`](mcp/teamconfig.mjs) — 19 keys, seventeen of which actually change behavior
today, plus a reader-status column: whether each key reaches `tm_open`, `team_open`, or both.
`team_open`'s `inputSchema` only accepts a subset of `TEAM_DEFAULTS`' names in the first place —
a key it does not accept as an argument at all cannot be reached from `team.json` on that path
either, no matter what `resolveTeamOptions` resolves.

| Key | Default | Reaches behavior? | Reader | What it does |
|---|---|---|---|---|
| `vendor` | `"auto"` | yes | `tm_open` + `team_open` | Vendor selection: every child run's (`child_opts.vendor`) on `tm_open`, the run's own (`run.vendor`) on `team_open`. |
| `allocation` | `"ordered"` | yes | `tm_open` + `team_open` | `"ordered"` vs `"balanced"` routing: every child run's (`child_opts.allocation`) on `tm_open`, the run's own (`run.allocation`) on `team_open`; see `graph`'s Status for what `"balanced"` changes. |
| `goal_threshold` | `90` | yes | `tm_open` + `team_open` | The goal-gate floor. On `tm_open`: the manager's own floor, and — as of commit `f765c03` — the floor every child run's own goal gate opens with (`child_opts.goal_threshold`); before that commit a project's pinned value was silently dropped for every package, every child ran the hardcoded 90 regardless of `team.json`. On `team_open`: the run's own goal gate floor (`run.goal_threshold`) — the same class of bug, fixed the same way, one round later. |
| `max_retries` | `2` | yes | `tm_open` + `team_open` | The retry budget. On `tm_open`: the manager's own subgoal/package budget, and — as of `f765c03` — the budget every child run opens with (`child_opts.max_retries`), same pre-`f765c03` caveat as `goal_threshold`. On `team_open`: the run's own retry budget (`run.max_retries`) — `TEAM_DEFAULTS.max_retries` (2) already matched `createRun`'s own bare default, so a project with no `team.json` saw no behavior change from wiring this in. |
| `driver_restarts` | `2` | yes | `tm_open` only | How many times a dead package or size-S driver respawns on the same run_id before the dispatch folds `blocked`. Not a `team_open` argument — `team_open` opens a single graph run with no driver-restart concept of its own — so a `team.json` pin cannot reach it on that path. |
| `stall_minutes` | `20` | yes | `tm_open` only | A driver can be alive (its pid answers `process.kill(pid,0)`) and still be making no progress — a wedged model, a provider hang with no error, a tool call that never returns. `serviceStalledDriver` (`taskmanager.mjs`) reads this against the mtime of the same files `daemon.mjs`'s own `waitForProgress` already watches for that child (its broker run file, plus its ledger). Idle this long flags the dispatch once (`stalled_since`, recorded as `child_driver_stalled`, cleared — `child_driver_progress_resumed` — the moment progress resumes); idle 3x this long kills the driver (`child_driver_killed`, `reason: 'stalled'`) and leaves the respawn to the ordinary dead-driver path (`serviceDeadDriver`), which spends a restart exactly as it would for a crash. The first threshold never kills on its own — idol-pm-4 had a legitimate 16-minute gap between tool calls mid-run. `0` disables the whole check. Not a `team_open` argument — `team_open` has no driver-restart concept either, same as `driver_restarts`. |
| `restart_period_minutes` | `0` | yes | `tm_open` only | `driver_restarts` is a flat, forever counter by default (`0` here — today's behavior: every death this run has ever had counts against the budget). `>0` makes it an OTP-style sliding window in minutes: `serviceDeadDriver` only counts restarts whose own timestamp (`driver.restarts[].at`, already recorded on every death) falls inside the last `restart_period_minutes`, so a package that dies once an hour for a week never exhausts a budget sized for "how many deaths in a row". Not a `team_open` argument, for the same reason `driver_restarts` is not. |
| `docs_dir` | `.teams_output/team` | yes | `tm_open` only | Where `tm_docs`/`tickets.mjs` render the phase-document tree (`INDEX.md` and friends). Not a `team_open` argument or concept — `team_open` writes no phase-document tree. |
| `plugin_dirs` | `[]` | yes | `tm_open` only | Extra `--plugin-dir` paths every child driver and judge session is given (`driverArgv`/`judgeArgv`), on top of the ones `pluginroots.mjs` resolves for the skills the method tables name (v0.18.0). Not a `team_open` argument — `team_open` runs entirely inside the caller's own session, with no child driver or judge process of its own to hand a plugin dir to. |
| `max_parallel_teams` | `2` | yes | `tm_open` only | Caps how many develop STORY dispatches `tm_next` opens at once (`taskmanager.mjs`'s `toolNext`, ~line 2256/2268); phase-Team packages (PLAN/QA/audit) are exempt. `2` is a provisional default, not a measurement — see `PROVISIONAL_MAX_PARALLEL_TEAMS` in `teamconfig.mjs`. Not a `team_open` argument. |
| `roles` | `{planning:true, qa:true, audit:true}` | yes | `tm_open` only | `planning`/`qa` ON by default since 0.17.0. `planning` opens the PLAN phase-Team (draft → revise → gate) before `shape`; `qa` opens the QA phase-Team (cases → execute → gate) between `integrate` and `gate:goal`. `audit` (new) is its own switch on the planning-audit phase-Team, which used to ride entirely on `roles.planning` — still ON by default and still requires `roles.planning` too (the audit is planning's own second pass, so it can never run without it), but a project can now keep the PRD without the post-integration cross-check via `{"roles": {"audit": false}}`. Only a size-L task runs any of the three — a size-S task delegates to one graph run and skips them all (known gap, see v0.17.0). Not a `team_open` argument. |
| `interactive` | `false` | yes | `tm_open` + `team_open` | Whether this run stops and waits for a person, or decides by default and records what it would have asked. Gates three things: any judging/deciding stage's own `questions[]` (0.29.0, generalized past investigate's `unknowns[]` — `graph.mjs`'s `openAsk`), a MODEL-written `assignee` pin (a shape package's own field, reaching `tm_open`'s child runs via `subgoal_assignee`, or a setgoal subgoal's own field on either path — as of the 0.27.3 review), and `human_gates` (below). `true` parks the pinned node in `waiting_human`; `false` (the default) auto-decides it instead — the node dispatches to an AI (or, for `human_gates`, auto-passes) as if nothing had been written, and the would-be pin is recorded on the node (`auto_decided_pin`) and surfaced in `tm_inbox`'s `decided` section. A person's own `tm_assign` pin is a different source (marked `{by: 'user'}`, `graph.mjs`'s `applyHumanPin`) and always parks regardless of this key - the user is present by definition. |
| `human_gates` | `[]` | yes | `tm_open` + `team_open` | Which judging stages a person must accept/reject instead of a model — a list of stage names (`"critique"`, `"gate"`, `"gate:goal"`, or, at the manager layer, `"accept"`/`"integrate"`; a non-judging stage like `"shape"` is accepted but has no effect — only a stage with a verdict field is ever gated, `graph.mjs`'s `humanGateVerdictField`). Threaded the same way `interactive` is: `tm_open`'s `task.human_gates` and `child_opts.human_gates` reach every package's own child run, `team_open`'s reaches `createRun` directly. A node whose stage is named here never reaches a driver (`graph.mjs`'s `promoteHumanGates`, called at the same point `promoteWaitingHuman` is): `interactive` parks it in `waiting_human` for `tm_inbox`/`tm_submit({key, payload:{accept, reason?, gaps?}})`, exactly like a pinned author stage or an `ask` card — the human's own accept/reject becomes the node's result, so a rejection's `gaps[]` feeds the same retry a model gate's rejection would. `false` (the default) auto-passes the node instead (`autoPassHumanGateResult`) and records it on the node (`auto_decided_pin`), surfaced in `tm_inbox`'s `decided` section — a run nobody is watching must still finish, and a gate with nobody to answer it defaults to pass, not to block forever. |
| `retry_policy` | `"continue"` | yes | `tm_open` + `team_open` | What a retried attempt does with the worktree the failed one left. `"continue"` (default, today's only behavior before this key existed) builds the next attempt on top of it — `ensureWorktree`/`retrySubgoal` already kept the same tree across attempts; this key only makes that a declared policy. `"rollback"` resets the worktree first, then re-runs with the failed gate's gaps as feedback exactly as `"continue"` does: at the node level (`team_open`, and every child run `tm_open` opens via `child_opts.retry_policy`), `retrySubgoal` resets a subgoal's own `implement`/`draft`/`cases`/`audit` to the checkpoint `broker.mjs` recorded before that subgoal's FIRST attempt touched it — only when the run has exactly one subgoal (a shared worktree with a sibling subgoal still working in it cannot be reset for one of them without discarding the other's progress too; `team_retry`'s reply names why it fell back to `"continue"` when that guard trips, as `rollback: {skipped: true, reason}`). At the package level (`tm_open` only, `retryPackage`), a rejected package retry resets to its last ACCEPTED commit (`commitWorktree` only ever commits on `accept:true`), or the worktree's own base commit if none of its attempts ever passed. `docs/plans/2026-09-23-teams-reducer-human-rollback.md` §5 measured two real runs before defaulting to `"continue"`: both showed a retried `implement` CONVERGING on its own gate's feedback across attempts (52%→60%→78%, 74%→78%) rather than repeating the same mistake, so there is no evidence yet that discarding an attempt's work helps more than it loses. |
| `budget_usd` | `null` | yes | `tm_open` only | Unlimited by default. Spend is summed each daemon tick from every session this task spawned (`collectTaskCosts`): package/S drivers and manager judge calls (`drivers/*.stream.jsonl`, restarts included) plus each child run's node adapter sessions (`.teams_output/broker/<run>/<node>/<attempt>/events.jsonl`), each read at its last `result` event's `total_cost_usd` — so a session still running counts only once it ends, and codex nodes report no cost. A backlog of 2+ `requests` with a box is pinned size L. Stopped before shape, the pending graph is skipped and a report still runs. At 80% spent, `enforceBudget` (`taskmanager.mjs`) records one warning (`tm_status`'s `budget.warn`); at 100%, no new package is dispatched — a package already running still finishes — and once nothing is left running, a fresh `integrate` opens over just the accepted packages (`reintegrateBehind`, the same mechanism a filed defect or a repair already uses), naming the rest in the report's "Next backlog" instead of dropping them silently. Whichever of `budget_usd`/`timebox_minutes` is closer to its own limit decides the stop; either alone is a real one. Not a `team_open` argument — `team_open` opens a single graph run with no package/driver concept of its own for this to bound. |
| `timebox_minutes` | `null` | yes | `tm_open` only | The same stop condition `budget_usd` is, on a clock instead of a dollar figure — minutes since `tm_open`. See `budget_usd`'s own row for exactly what 80%/100% do. Not a `team_open` argument, for the same reason `budget_usd` is not. |
| `max_depth` | `2` | no | `tm_open` only | recorded-but-inert — declared and validated, but nothing enforces it yet. This becomes the depth cap on a child run re-decomposing itself; see `docs/plans/2026-09-21-teams-server-owns-the-loop.md` §3. Not a `team_open` argument. |
| `qa_rounds` | `2` | no | `tm_open` only | recorded-but-inert — not read anywhere. Not a `team_open` argument. |
| `upstream_fix_rounds` | `2` | yes | `tm_open` only | Caps a downstream package's own fix-forward loop (§upstream_defects, `taskmanager.mjs`'s `fileUpstreamDefects`): a package's implement/test/gate, or the manager's own `accept` judging it, can report a defect OUTSIDE its own `touches[]`, in a package it `deps` on — `awake-beta-ref2` (2026-09-25): P3 was accepted identifying Claude Code by a kernel `comm` string that did not hold on P4's own host, and P4 had no route but to fail an attempt no retry could fix. Reused `fileDefects`/`reintegrateBehind` (the same machinery a QA-found defect already takes) files a fix STORY owned by the UPSTREAM package's own scope (`touches`/`deps` from that package, `reporter: "upstream"`), then reopens the DOWNSTREAM package's own next attempt with its `accept:<upstream>:N` dep rewritten onto the fix's accept — so it waits for the fix and re-runs against it instead of retrying blind against the same broken upstream. Counted per upstream package (every fix STORY already filed against it, regardless of which downstream package found the next one) the same way `qa_rounds` counts `dispatch:QA` nodes; past the cap, recorded onto `task.unresolved_defects` (`reporter: "upstream"`) instead of filed, and the downstream package falls back to its ordinary retry/settle path. Not a `team_open` argument — `team_open` opens a single graph run with no package/`deps`/upstream concept of its own. |

`goal_judges` (independent judges on the goal gate) and `auto_reassign` (auto-retry on a
rejected verdict) are real per-run options — see `tm_open`'s/`team_open`'s own argument
descriptions — but are not part of this schema: as of this writing they can only be set as an
explicit call argument each time, never pinned in `.claude/team.json`. `team_open` keeps its
own `goal_judges` default of 2 regardless of what a project's `team.json` contains — a
`goal_judges` key in that file is simply an unrecognized key, ignored like any other.

## Sprint: backlog, budget/timebox, retro

The `sprint` skill wraps `tm_open` plus the pieces below into one Scrum-shaped run - `requests`
for the backlog, `budget_usd`/`timebox_minutes` for the box, the existing `tm_board`/viewer for
the daily look, the report for the review, and `retro.json` plus `context_from` for the retro.
None of it is new mechanism outside `tm_open` itself; this section is what each piece does.

- **`requests: [...]`** — `tm_open` takes `request` (one string) XOR `requests` (an array of
  strings, priority = array order, item 0 highest); passing both, or neither, is refused.
  `requests` becomes the task's single composed `request` text (`"[backlog priority N] ..."` per
  item) that size/shape/PLAN already read, plus the raw array on `task.requests` for shape's own
  briefing and the retro. `shape` is told to set each package's existing `priority` field
  consistent with backlog order — a package serving only a low-priority item should get dispatched
  last, so it is the one left un-dispatched if the budget/timebox runs out first
  (`advanceDispatches` already dispatches ascending `priority` first). Single `request` is
  unchanged: this whole path only runs when `requests` was actually given.
- **`budget_usd` / `timebox_minutes`** — see the Configuration table above. `tm_status`'s
  `budget` field (present only when either is set) carries `{pct, over, warn, spend,
  elapsed_minutes}` live.
- **the retro bridge** — once `report` is done, `docs.mjs`'s `renderRetro` writes `retro.json`
  beside `80-report.md` (same `docs_dir`): `retrospective` (what failed and why, retries, defects
  left) and `next_backlog` (unaccepted packages, unresolved defects, open questions nobody
  answered - read, best-effort, off every dispatched package's own child run's `unasked[]`).
  `80-report.md` carries the same two sections in prose. `tm_open({context_from: "<prior
  task_id or E-xxxxxxxx>"})` reads that prior task's `retro.json` and folds it into the new
  task's `context` (`priorRetroContext`, `taskmanager.mjs`) - best-effort: a prior task with no
  report yet, or a ref that does not resolve, leaves `context` untouched rather than failing
  `tm_open`. The new task's own `requests` still has to be written in the caller's own words;
  `context_from` hands over what happened, not a ready-made backlog.

## Watching a task

`tm_status`/`tm_board`/`tm_events` return machine-shaped JSON for a driving session — not
something a person wants to stare at. `scripts/view.mjs` is the separate human surface: a
zero-dependency, read-only CLI that renders a task-manager task (running or finished) as a page
or a text tree, built from the same `task.json` and child run files these tools already read.

```
node teams/scripts/view.mjs [--tasks-dir <dir>] [--task <id>] [--port <n>] [--once] [--view pipeline|tickets|resources]
```

With no `--once`, it starts a local HTTP server on `127.0.0.1` and prints the URL: open it for a
live page that polls every ~3s, with three views (a tab strip switches between them instantly,
no extra request — all three read the same poll):

- **pipeline** (default) — the request, size/flow/state, cost and turns so far, the manager
  pipeline (size → shape → critique → one card per dispatched package → integrate → gate:goal →
  report) with each package expandable into its child run's own node chain (and any task nested
  inside a package's worktree, recursively), plus the last ~50 ledger events.
- **tickets** — a JIRA-like board for the task: the EPIC header (key, title, ticket state, phase
  — the same vocabulary `tm_board`/`tm_ticket` use), then one STORY card per package grouped into
  state columns (only the non-empty ones show), each card with its key, role, reporter/filed-by,
  `implements[]`/`enables[]`, deps, attempt count, its TASK children (`E-xxxxxxxx/Pn/Un`) with
  their own states, and a clear marker on any card a human is holding or pinned to.
- **resources** — the team hierarchy as it is actually resourced right now: TaskLeader (the
  task's daemon — pid, alive/dead, started) → one Team per STORY (worktree, branch, TeamLeader =
  the child run's driver — pid, alive/dead, restarts, cost/turns, any `waiting_capacity`) →
  workers per TASK node (stage, executor/model, state, duration, who is holding it if a human
  is), with nested tasks inside a package's worktree appearing as their own sub-tree.

`--tasks-dir` defaults to `tasksRoot()` (`HARNESS_TASKS_DIR`, else `~/.harness/tasks`); with
`--task` omitted and more than one task on disk, it serves an index instead. `--once` skips the
server and prints one view as a plain-text tree/board, for a terminal or a CI log — `--view`
picks which (`pipeline` by default); `tickets`/`resources` fall back to the same task index when
no single task can be resolved.

## Everything else

Tools, routing, adjudication, vendors, capacity recovery and the ledger are the same broker
mechanics as `graph` — read [`graph/README.md`](../graph/README.md) for the shared internals.
Fixes to that shared engine are ported between the two plugins; `teams`'s own kinds, entry
skills and TaskManager stay here.
