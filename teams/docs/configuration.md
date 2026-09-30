# teams — configuration and operations reference

**English** · [한국어](configuration.KOR.md) · back to [README](../README.md)

The full per-key reference for `.claude/team.json`, plus the detailed Sprint, watching and headless notes. These sections were moved here verbatim from the old README; the README keeps a one-line summary of each.

> **Note (2026-09-28):** the `qa_rounds` row below is older than the code: `qa_rounds` caps how many QA / planning-audit rounds may file fix STORYs before further defects go to `unresolved_defects`. `budget_grace_usd` / `budget_grace_minutes` exist in `TEAM_DEFAULTS` but have no row; see `tm_open`'s argument descriptions.

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
[`skills/install/SKILL.md`](../skills/install/SKILL.md) for what it adds and
[`skills/orchestrate/SKILL.md`](../skills/orchestrate/SKILL.md)'s "Running without install" note for
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
[`mcp/teamconfig.mjs`](../mcp/teamconfig.mjs) — 21 keys, nineteen of which actually change behavior
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
| `driver_restarts` | `2` | yes | `tm_open` only | How many times a dead package driver respawns on the same run_id before the dispatch folds `blocked`, or a dead size-S harness driver respawns on the same harness run before the task reads `blocked`. Not a `team_open` argument — `team_open` opens a single graph run with no driver-restart concept of its own — so a `team.json` pin cannot reach it on that path. |
| `stall_minutes` | `20` | yes | `tm_open` only | A driver can be alive (its pid answers `process.kill(pid,0)`) and still be making no progress — a wedged model, a provider hang with no error, a tool call that never returns. `serviceStalledDriver` (`taskmanager.mjs`) reads this against the mtime of the same files `daemon.mjs`'s own `waitForProgress` already watches for that child (its broker run file, plus its ledger). Idle this long flags the dispatch once (`stalled_since`, recorded as `child_driver_stalled`, cleared — `child_driver_progress_resumed` — the moment progress resumes); idle 3x this long kills the driver (`child_driver_killed`, `reason: 'stalled'`) and leaves the respawn to the ordinary dead-driver path (`serviceDeadDriver`), which spends a restart exactly as it would for a crash. The first threshold never kills on its own — idol-pm-4 had a legitimate 16-minute gap between tool calls mid-run. `0` disables the whole check. Not a `team_open` argument — `team_open` has no driver-restart concept either, same as `driver_restarts`. |
| `restart_period_minutes` | `0` | yes | `tm_open` only | `driver_restarts` is a flat, forever counter by default (`0` here — today's behavior: every death this run has ever had counts against the budget). `>0` makes it an OTP-style sliding window in minutes: `serviceDeadDriver` only counts restarts whose own timestamp (`driver.restarts[].at`, already recorded on every death) falls inside the last `restart_period_minutes`, so a package that dies once an hour for a week never exhausts a budget sized for "how many deaths in a row". Not a `team_open` argument, for the same reason `driver_restarts` is not. |
| `docs_dir` | `.teams_output/team` | yes | `tm_open` only | Where `tm_docs`/`tickets.mjs` render the phase-document tree (`INDEX.md` and friends). Not a `team_open` argument or concept — `team_open` writes no phase-document tree. |
| `plugin_dirs` | `[]` | yes | `tm_open` only | Extra `--plugin-dir` paths every child driver and judge session is given (`driverArgv`/`judgeArgv`), on top of the ones `pluginroots.mjs` resolves for the skills the method tables name (v0.18.0). Not a `team_open` argument — `team_open` runs entirely inside the caller's own session, with no child driver or judge process of its own to hand a plugin dir to. |
| `max_parallel_teams` | `"auto"` | yes | `tm_open` only | Caps how many develop STORY dispatches `advanceDispatches` (`taskmanager.mjs`, shared by `tm_next` and the daemon's own loop) opens at once; phase-Team packages (PLAN/QA/audit) are exempt from both the count and the cap. `"auto"` (the default since the fixed `2` guess was replaced by a measurement-driven controller) hands the number to an AIMD controller — `ensureAutoParallel`/`updateAutoParallel` in `taskmanager.mjs`, state on `task.auto_parallel`: starts at `2`; `+1` (capped at the ceiling — see `max_parallel_ceiling`) after `AIMD_WINDOW` (2) consecutive develop-STORY dispatch folds settle with no capacity signal; halved (floor `1`) the moment one does — a dispatch's own driver log/stderr naming a rate-limit/429/529/overloaded/quota error (`PUSHBACK_RE`, read the same way `driverUsageLimitText` already reads a driver's stream), or two different packages' driver restarts landing within 5 minutes of each other (`crashesClustered`) even though neither alone spent its own `driver_restarts` budget. Every change is recorded to the task's ledger (`auto_parallel_increased`/`auto_parallel_decreased`) and the current cap + reason is surfaced in `tm_status`'s `auto_parallel` field. A fixed integer still pins the cap exactly as before this controller existed — `updateAutoParallel` is then a no-op. Not a `team_open` argument. |
| `max_parallel_ceiling` | `null` | yes | `tm_open` only | Only consulted by the `max_parallel_teams: "auto"` controller above, and only when set: pins its ceiling instead of deriving one from the host (`min(os.availableParallelism()/2, 6)`, floor `2`, `taskmanager.mjs`'s `autoParallelCeiling`). Not a `team_open` argument. |
| `roles` | `{planning:"auto", qa:true, audit:true}` | yes | `tm_open` only | Planning always runs, on cards (_repo/docs/plans/2026-09-28-teams-cards-everywhere.md): the plan stage (`areas`) splits the request by feature, one planning card per area (`PLAN-F1`, ...) writes that area's PRD section, and `plan-integrate` merges them into `10-prd.md` and judges it before `shape`. `planning` picks the chain each card runs: `true` the full chain (investigate → draft → revise → gate), `"light"` the light one (investigate → template-fill → gate), `"auto"` (default) light when the backlog already declares its acceptance (`hasDeclaredAcceptance`) and full otherwise. `false` is refused: the value below it stands and a note says so (C5). A size-S task gets no planning card: it goes to the development harness, which plans with its own stages (_repo/docs/plans/2026-09-28-teams-long-loop.md S1). `qa` opens one QA card per feature area (`QA-F1`, ...; cases → execute → gate each) between `integrate` and `gate:goal`, their defects filed together once the round has settled. `audit` is the switch on the planning-audit phase-Team (planning's second pass, reading the merged PRD) - ON by default; `{"roles": {"audit": false}}` keeps the PRD without the post-integration cross-check. QA and the audit run on a size-L task only. Not a `team_open` argument. |
| `interactive` | `false` | yes | `tm_open` + `team_open` | Whether this run stops and waits for a person, or decides by default and records what it would have asked. Gates three things: any judging/deciding stage's own `questions[]` (0.29.0, generalized past investigate's `unknowns[]` — `graph.mjs`'s `openAsk`), a MODEL-written `assignee` pin (a shape package's own field, reaching `tm_open`'s child runs via `subgoal_assignee`, or a setgoal subgoal's own field on either path — as of the 0.27.3 review), and `human_gates` (below). `true` parks the pinned node in `waiting_human`; `false` (the default) auto-decides it instead — the node dispatches to an AI (or, for `human_gates`, auto-passes) as if nothing had been written, and the would-be pin is recorded on the node (`auto_decided_pin`) and surfaced in `tm_inbox`'s `decided` section. A person's own `tm_assign` pin is a different source (marked `{by: 'user'}`, `graph.mjs`'s `applyHumanPin`) and always parks regardless of this key - the user is present by definition. |
| `brainstorm` | `true` | yes | `tm_open` only | With no `decisions[]` on `tm_open`, open a `brainstorm` node after `size` (ahead of PLAN/shape) whose result becomes `task.decisions` (source `self-brainstorm`). `false` skips it; a `decisions[]` argument skips it regardless. (`human_scope`, never implemented, is accepted as a deprecated no-op with a note.) |
| `human_gates` | `[]` | yes | `tm_open` + `team_open` | Which judging stages a person must accept/reject instead of a model — a list of stage names (`"critique"`, `"gate"`, `"gate:goal"`, or, at the manager layer, `"accept"`/`"integrate"`/`"areas-critique"`/`"plan-integrate"` - a person refusing `plan-integrate` may add `resplit: true` to have the feature split redone; a non-judging stage like `"shape"` is accepted but has no effect — only a stage with a verdict field is ever gated, `graph.mjs`'s `humanGateVerdictField`). Threaded the same way `interactive` is: `tm_open`'s `task.human_gates` and `child_opts.human_gates` reach every package's own child run, `team_open`'s reaches `createRun` directly. A node whose stage is named here never reaches a driver (`graph.mjs`'s `promoteHumanGates`, called at the same point `promoteWaitingHuman` is): `interactive` parks it in `waiting_human` for `tm_inbox`/`tm_submit({key, payload:{accept, reason?, gaps?}})`, exactly like a pinned author stage or an `ask` card — the human's own accept/reject becomes the node's result, so a rejection's `gaps[]` feeds the same retry a model gate's rejection would. `false` (the default) auto-passes the node instead (`autoPassHumanGateResult`) and records it on the node (`auto_decided_pin`), surfaced in `tm_inbox`'s `decided` section — a run nobody is watching must still finish, and a gate with nobody to answer it defaults to pass, not to block forever. |
| `ask_timeout` | `null` | yes | `tm_open` only | Milliseconds an interactive `ask` card may wait on a person. On expiry the engine answers it with each question's `default` (else its first, recommended option — the same pick a non-interactive run makes), recorded `by: "timeout"` on the result and each decision, and listed in `tm_inbox`'s `decided`. `null` waits forever. The manager is the clock (a parked child has no driver): the task daemon checks each tick and sleeps until the earliest deadline rather than exiting, and any `tm_*` call naming the task checks too. Only `ask` cards expire — a pinned author stage or `human_gates` card has no default. |
| `retry_policy` | `"continue"` | yes | `tm_open` + `team_open` | What a retried attempt does with the worktree the failed one left. `"continue"` (default, today's only behavior before this key existed) builds the next attempt on top of it — `ensureWorktree`/`retrySubgoal` already kept the same tree across attempts; this key only makes that a declared policy. `"rollback"` resets the worktree first, then re-runs with the failed gate's gaps as feedback exactly as `"continue"` does: at the node level (`team_open`, and every child run `tm_open` opens via `child_opts.retry_policy`), `retrySubgoal` resets a subgoal's own `implement`/`draft`/`cases`/`audit` to the checkpoint `broker.mjs` recorded before that subgoal's FIRST attempt touched it — only when the run has exactly one subgoal (a shared worktree with a sibling subgoal still working in it cannot be reset for one of them without discarding the other's progress too; `team_retry`'s reply names why it fell back to `"continue"` when that guard trips, as `rollback: {skipped: true, reason}`). At the package level (`tm_open` only, `retryPackage`), a rejected package retry resets to its last ACCEPTED commit (`commitWorktree` only ever commits on `accept:true`), or the worktree's own base commit if none of its attempts ever passed. `_repo/docs/plans/2026-09-23-teams-reducer-human-rollback.md` §5 measured two real runs before defaulting to `"continue"`: both showed a retried `implement` CONVERGING on its own gate's feedback across attempts (52%→60%→78%, 74%→78%) rather than repeating the same mistake, so there is no evidence yet that discarding an attempt's work helps more than it loses. |
| `budget_usd` | `null` | yes | `tm_open` only | Unlimited by default. Spend is summed each daemon tick from every session this task spawned (`collectTaskCosts`): package/S drivers and manager judge calls (`drivers/*.stream.jsonl`, restarts included) plus each child run's node adapter sessions (`.teams_output/broker/<run>/<node>/<attempt>/events.jsonl`), each read at its last `result` event's `total_cost_usd` — so a session still running counts only once it ends, and codex nodes report no cost. A backlog of 2+ `requests` with a box is pinned size L. Stopped before shape, the pending graph is skipped and a report still runs. At 80% spent, `enforceBudget` (`taskmanager.mjs`) records one warning (`tm_status`'s `budget.warn`); at 100%, no new package is dispatched — a package already running still finishes — and once nothing is left running, a fresh `integrate` opens over just the accepted packages (`reintegrateBehind`, the same mechanism a filed defect or a repair already uses), naming the rest in the report's "Next backlog" instead of dropping them silently. Whichever of `budget_usd`/`timebox_minutes` is closer to its own limit decides the stop; either alone is a real one. Not a `team_open` argument — `team_open` opens a single graph run with no package/driver concept of its own for this to bound. |
| `timebox_minutes` | `null` | yes | `tm_open` only | The same stop condition `budget_usd` is, on a clock instead of a dollar figure — minutes since `tm_open`. See `budget_usd`'s own row for exactly what 80%/100% do. Not a `team_open` argument, for the same reason `budget_usd` is not. |
| `max_depth` | — | — | — | Retired 2026-09-28: there is no nested task (sub-EPIC). Work too big for one EPIC carries into the next Sprint (`carryover_candidates`). A team.json that still sets it gets a deprecation note. |
| `qa_rounds` | `2` | no | `tm_open` only | recorded-but-inert — not read anywhere. Not a `team_open` argument. |
| `upstream_fix_rounds` | `2` | yes | `tm_open` only | Caps a downstream package's own fix-forward loop (§upstream_defects, `taskmanager.mjs`'s `fileUpstreamDefects`): a package's implement/test/gate, or the manager's own `accept` judging it, can report a defect OUTSIDE its own `touches[]`, in a package it `deps` on — `awake-beta-ref2` (2026-09-25): P3 was accepted identifying Claude Code by a kernel `comm` string that did not hold on P4's own host, and P4 had no route but to fail an attempt no retry could fix. Reused `fileDefects`/`reintegrateBehind` (the same machinery a QA-found defect already takes) files a fix STORY owned by the UPSTREAM package's own scope (`touches`/`deps` from that package, `reporter` the downstream package's own id, `origin: "upstream"`, `link: {type:"blocks", target:<upstream package id>}`), then reopens the DOWNSTREAM package's own next attempt with its `accept:<upstream>:N` dep rewritten onto the fix's accept — so it waits for the fix and re-runs against it instead of retrying blind against the same broken upstream. Counted per upstream package (every fix STORY already filed against it, regardless of which downstream package found the next one) the same way `qa_rounds` counts `dispatch:QA` nodes; past the cap, recorded onto `task.unresolved_defects` instead of filed, and the downstream package falls back to its ordinary retry/settle path. Not a `team_open` argument — `team_open` opens a single graph run with no package/`deps`/upstream concept of its own. |
| `initiative` | `null` | yes (display/grouping only) | `tm_open` only | An optional label ABOVE the EPIC (`Initiative (optional) > Epic > Story > Sub-task`) — several EPICs toward one outcome, slug-normalized (`teamconfig.mjs`'s `normalizeInitiative`: lowercased, non-alphanumeric runs collapsed to one `-`) into an `I-<slug>` key. `tm_board` (no `task_id`) groups every EPIC by it once any task on the same tasks root has one — a `groups: [{initiative, key, epics}]` array, an initiative-less `null` group included so no EPIC silently drops off; with none set anywhere, the exact flat `{epics}` list this always returned, byte for byte. `tm_ticket("I-<slug>")` lists that group's own EPICs with state and cost. Grouping/display only — never read by scheduling or execution, and never nests one task inside another. Not a `team_open` argument — `team_open` opens a single graph run with no EPIC/grouping concept of its own. |

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
- **acceptance** — an item may be `{request, acceptance: [...]}`, and `shared_acceptance: [...]`
  covers every item (or the single `request`); both are written into the request text as
  `Acceptance:` blocks. Declared acceptance - these fields, or a numbered backlog with an
  `Acceptance for every item:` heading and bullets - makes the default `roles.planning: "auto"`
  run the light PLAN chain (see `roles` above).
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
  their own states, and a clear marker on any card a human is holding or pinned to. The full
  ticket hierarchy is `Initiative (optional) > Epic > Story > Sub-task` — `I-<slug>` above
  `E-xxxxxxxx` (`tm_open({initiative})`, display/grouping only: `tm_board`'s all-EPICs listing
  and `tm_ticket("I-<slug>")` group by it, see Configuration's own `initiative` row), then
  `E-xxxxxxxx/Pn` for a STORY and `E-xxxxxxxx/Pn/subgoalId` for its TASK children. A STORY's own
  `reporter` names the issuing TEAM (`planning`/`qa`/`audit`/`user`/a develop package id for an
  upstream fix); `origin` names the STAGE that produced it (`shape`/`repair`/`phase`/`qa`/
  `planning-audit`/`upstream`/`tm_file`), and `link` (upstream fixes only) names what it targets.
  This per-task tickets view itself renders unchanged by initiative grouping - that is an
  across-tasks concept, shown on the all-EPICs index instead (a per-row `initiative` tag, both in
  `--once`'s text index and the page's own EPIC cards).
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

To follow one ticket from a session instead, `tm_log({key, tail?, since?})` (and the thin
`teams:log` skill, `/teams:log E-xxxxxxxx/P2`) tails the log that key already points at, as
readable lines: a STORY key reads its latest dispatch's driver stream (`child.driver.log`, one
line per stream event — assistant text, `-> Tool what`, `<- result`, the final `result` with
turns/cost), an EPIC key reads the task ledger (`HH:MM:SS event k=v`). Only the last `tail`
lines (default 50, max 500) are read, from the file's end — never the whole stream; pass the
reply's `cursor` back as `since` to get only what was appended after it.

## Headless

`scripts/run.mjs` is wait-model C (`_repo/docs/plans/2026-09-21-teams-server-owns-the-loop.md` §4): it
opens a task exactly the way `tm_run` does and blocks until it settles exactly the way `tm_wait`
does — reusing both, not reimplementing either — but with no session in the loop and no context
cost while it waits. This is the fair way to measure teams headlessly, and the bench's
`scripts/bench/drive.sh` now drives the teams arms (`beta`/`betas`/`skills`) through it instead
of watching a `claude -p` session end (`DRIVE_VIA=session` restores that). It is also the right
entry point for CI or a shell script that just wants a task run to completion.

```
node teams/scripts/run.mjs "<request>" [--kind auto|develop|document] [--cwd <path>]
  [--budget-usd <n>] [--timebox-minutes <n>] [--vendor <v>] [--allocation ordered|balanced]
  [--size S|L] [--context <text>] [--poll-ms <n>] [--json] [--resume-on-limit] [--max-resumes <n>]
node teams/scripts/run.mjs --resume <task_id> [--json] [--resume-on-limit] [--max-resumes <n>]
```

`--resume-on-limit` (opt-in) is drive.sh's usage-limit wait, moved to where the task can be
asked. When the task settles `blocked` on a usage limit (a size-S harness driver parked on capacity, a
package that failed on a limit), it reads the reset out of the notice ("resets 11:50pm
(Asia/Seoul)"; none parsed → 30 min) with the daemon's own `capacityResetAt`, sleeps in
one-minute steps until then plus 3 minutes, resumes with `tm_retry({reset_capacity})` (parked
drivers) or `tm_retry({package_id})` (failed packages), and keeps waiting — at most
`--max-resumes` times (default 6). A limit with no resume route (a manager judge that spent its
re-judges), or a retry that resumes nothing, gives up and exits `1`. `--json` adds `limit`,
`limit_resumed` and `limit_gave_up` events.

Prints one line per node transition, or a heartbeat when `tm_wait` timed out with nothing new,
then a final line with the report path. Exit codes: `0` complete; `2` `waiting_human` (headless
cannot answer a card, so it does not hang forever — the pending question is printed; answer it
with `tm_submit` from a session, then `--resume`); `1` anything else that stopped without
finishing (`blocked`, etc.); `64` bad arguments. SIGINT does not stop the run — the daemon
(spawned by this call, or already running under `--resume`) is a detached, `unref()`'d process
regardless, so the CLI only stops watching: it prints the task id and how to `--resume`/inspect
it, then exits `130`. `--json` emits one JSON object per line instead of prose, ending in an
`event: "final"` line carrying `exit_code` and `report`.
