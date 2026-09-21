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
| Skills | `graph:install`, `graph:orchestrate` | `teams:install`, `teams:remove`, `teams:patch`, `teams:orchestrate`, `teams:develop`, `teams:document`, `teams:plan`, `teams:qa`, `teams:board`, `teams:ticket` |
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

Install `teams@newkayak12-claude-skills` and run `teams:install` to verify the six
`team_*` tools are present. For a source checkout, register `mcp/broker.mjs` under the name
`teams-engineering` in the project's `.mcp.json`; `teams:install` shows the entry.

## Configuration

`.claude/team.json` supplies project defaults for both `tm_open` and `team_open` — the broker's
own direct entry point reads it too, the same way TaskManager does. Precedence is built-in
default < `team.json` < an explicit argument of the same name on whichever tool opened the run
(`teamconfig.mjs`'s `resolveTeamOptions`); an unrecognized key or a value that fails its
validator is ignored rather than applied, and recorded as a note — `tm_status`'s `team.notes` on
the `tm_open` path, `team_status`'s `config_notes` on the `team_open` path (present only when
there is at least one note; it is the run's own persisted copy of `resolveTeamOptions`' notes,
not a live re-check). The schema is `TEAM_DEFAULTS`/`CHECK` in
[`mcp/teamconfig.mjs`](mcp/teamconfig.mjs) — 10 keys, seven of which actually change behavior
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
| `docs_dir` | `.teams_output/team` | yes | `tm_open` only | Where `tm_docs`/`tickets.mjs` render the phase-document tree (`INDEX.md` and friends). Not a `team_open` argument or concept — `team_open` writes no phase-document tree. |
| `max_parallel_teams` | `2` | yes | `tm_open` only | Caps how many develop STORY dispatches `tm_next` opens at once (`taskmanager.mjs`'s `toolNext`, ~line 2256/2268); phase-Team packages (PLAN/QA/audit) are exempt. `2` is a provisional default, not a measurement — see `PROVISIONAL_MAX_PARALLEL_TEAMS` in `teamconfig.mjs`. Not a `team_open` argument. |
| `roles` | `{planning:false, qa:false}` | no | `tm_open` only | recorded-but-inert — echoed in the rendered request doc's "Team snapshot" line; nothing branches on it yet. Not a `team_open` argument. |
| `max_depth` | `2` | no | `tm_open` only | recorded-but-inert — declared and validated, but nothing enforces it yet. This becomes the depth cap on a child run re-decomposing itself; see `docs/plans/2026-09-21-teams-server-owns-the-loop.md` §3. Not a `team_open` argument. |
| `qa_rounds` | `2` | no | `tm_open` only | recorded-but-inert — not read anywhere. Not a `team_open` argument. |

`goal_judges` (independent judges on the goal gate) and `auto_reassign` (auto-retry on a
rejected verdict) are real per-run options — see `tm_open`'s/`team_open`'s own argument
descriptions — but are not part of this schema: as of this writing they can only be set as an
explicit call argument each time, never pinned in `.claude/team.json`. `team_open` keeps its
own `goal_judges` default of 2 regardless of what a project's `team.json` contains — a
`goal_judges` key in that file is simply an unrecognized key, ignored like any other.

## Watching a task

`tm_status`/`tm_board`/`tm_events` return machine-shaped JSON for a driving session — not
something a person wants to stare at. `scripts/view.mjs` is the separate human surface: a
zero-dependency, read-only CLI that renders a task-manager task (running or finished) as a page
or a text tree, built from the same `task.json` and child run files these tools already read.

```
node teams/scripts/view.mjs [--tasks-dir <dir>] [--task <id>] [--port <n>] [--once]
```

With no `--once`, it starts a local HTTP server on `127.0.0.1` and prints the URL: open it for a
live view that polls every ~3s — the request, size/flow/state, cost and turns so far, the
manager pipeline (size → shape → critique → one card per dispatched package → integrate →
gate:goal → report) with each package expandable into its child run's own node chain (and any
task nested inside a package's worktree, recursively), plus the last ~50 ledger events.
`--tasks-dir` defaults to `tasksRoot()` (`HARNESS_TASKS_DIR`, else `~/.harness/tasks`); with
`--task` omitted and more than one task on disk, it serves an index instead. `--once` skips the
server and prints the same model as a plain-text tree, for a terminal or a CI log.

## Everything else

Tools, routing, adjudication, vendors, capacity recovery and the ledger are the same broker
mechanics as `graph` — read [`graph/README.md`](../graph/README.md) for the shared internals.
Fixes to that shared engine are ported between the two plugins; `teams`'s own kinds, entry
skills and TaskManager stay here.
