# graph-beta

**English** · [한국어](KOR.md)

The beta line of [`graph`](../graph/README.md). `graph` stays the stable engine and keeps
getting fixes; everything below is being built here first and graduates to `graph` only
when it is proven on real runs.

Same broker, same six tools, same skills — with these differences:

| | `graph` (stable) | `graph-beta` |
|---|---|---|
| MCP servers | `graph-engineering` | `graph-beta-engineering` + `task-manager` |
| Run files | `.harness-run/broker/` | `.harness-run/broker-beta/` |
| Skills | `graph:install`, `graph:orchestrate` | `graph-beta:install`, `graph-beta:orchestrate`, `graph-beta:develop`, `graph-beta:document` |
| Version line | 1.x | 0.x until it graduates |

**Do not enable both in the same project.** Both servers expose `graph_*` tools; a driving
session with two of each cannot tell which run it is in.

## Why a beta line

The stable engine is built for one shape of work: a request that becomes subgoals, each of
which **changes files** and is verified by **running commands** against a git worktree. That is
the right shape for code. It is the wrong shape for a design document, a research write-up,
or a request large enough that it should be split into several runs across several
worktrees — and it has no notion of a run that manages other runs.

Three things are being added, in this order, each behind the previous one's tests:

1. **Kinds.** A subgoal declares what kind of work it is, and the kind decides which node
   chain it expands into. `subgoal` (code) keeps `implement → test → gate` exactly as today.
   `document` gets `draft → review → gate`: author ≠ reviewer, rubric-based, a missing
   worktree change is not a failure. A spec may mix kinds — "implement the feature and
   update the design doc" is one run.
2. **Entry per flow.** `graph-beta:orchestrate` stays the no-decision entry: `plan` sizes the
   request and picks the flow. `graph-beta:develop` and `graph-beta:document` are thin
   manual entries — trigger words, a `flow` default, a persona set — that hand off to the
   same loop. Nothing in the loop is duplicated.
3. **TaskManager.** A second MCP server in this plugin, `task-manager`, for medium and large
   requests. It sizes, splits into packages with `touches[]` and dependencies, and for each
   package opens a child graph run in its own worktree — **the broker opens it, never a
   node** — then accepts the child's verdict, integrates worktrees, and reports. It reuses
   `mcp/graph.mjs` as a library (DAG, typed edges, retries, settled failure) and reads child
   run files without ever writing them. Small requests skip it entirely.

Design and step list: [`docs/plans/2026-09-11-graph-beta-taskmanager.md`](../docs/plans/2026-09-11-graph-beta-taskmanager.md).

## Status

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
  caller to call `graph_retry`. That made the rejection advisory — a session that never called
  it simply stopped, and the gaps the gate had found went nowhere. The engine now opens the
  next attempt on the rejection, carrying exactly the feedback `graph_retry` would have carried
  (the last judging node's reason, gaps and failing checks, plus a rejecting goal gate's text),
  and settles into `unreachable` when the budget is gone precisely as before. The submit verdict
  carries `reassigned` so the caller can see it happened. Routing reassigns too: an identity
  whose earlier attempt at the same stage was rejected is now penalised, because `goal-docs`
  spent its whole budget handing the same package back to the same author in the same worktree
  to reach the same conclusion. Only the verdict reassigns — a node that could not run at all
  keeps its existing path — and the goal gate is excluded, since its rejection blames the
  assembled result rather than one subgoal. `graph_open({auto_reassign: false})` restores the
  old advisory behaviour; the manager passes the setting through to every child run.

- **v0.6.9 — a hook that makes the driving session dispatch instead of doing the work**: the
  plugin now ships a `PreToolUse` gate, installed with it. It does nothing until a project
  opts in with `.claude/graph-beta-dispatch.json`; with that file present, a write to a gated
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
  `betas` arm (graph-beta with `size` left to measure: one run, the same topology as stable —
  8/9 · $13.20 against stable's 9/9 · $13.27 on `code`) and `goal-code`/`goal-docs` cases that
  hand the harness a one-line goal and leave the split, the contracts and the document set to
  it; the scorer judges the outcome against the goal and the manager's decomposition on its
  own terms. First observation: shape split the one-line goal into the same four packages a
  person had written for the specified case. Not measured yet, in any round: cross-vendor
  dispatch — codex is not logged in on the bench machine, so every node ran on Claude; recorded
  as the next round, not assumed.
- **v0.6.3 — the first manager runs to complete, and what they broke on the way**: two size-L
  tasks ran to `report` end to end (`scripts/bench/README.md`, Results). Getting there found
  three more manager defects, each fixed with a test: the fold's `git add -A -- . ':!.harness-run'`
  exits 1 when the project's `.gitignore` lists `.harness-run/` — the usual case, and every test
  repo now has it — so two accepted children could not be committed; the add now stages
  everything and unstages `.harness-run`. `tm_retry({package_id})` accepted an id the shape never
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
  a second `graph_open` — an orphan run and a redone spec, twice. `resolveNativeModel` now
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
  picker does not list, and `graph_open` blocked at `plan` with `native host cannot select
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
- **v0.5.0 — size gate in every entry**: `graph-beta:orchestrate`, `develop` and `document` all
  open with `tm_open`; one fresh agent runs `size`. `delegate` present → the task is already gone
  and the skill continues with `graph_open(delegate.args)` and the one-run loop; absent → the
  new `orchestrate/references/manager.md` loop: `tm_next` children driven with the ordinary
  `graph_*` loop at the child's worktree, folded with a payload-less `tm_submit`, `tm_retry` per
  package or reshape. A pinned entry flow survives sizing (the entry wins over what `size` says),
  and `delegate.args` is accepted by `graph_open` verbatim — tested end to end across the two
  servers. 110 pass.
- **v0.4.0 — TaskManager server, read-only over children**: `mcp/taskmanager.mjs`, registered as
  `task-manager` next to the broker. `tm_open` builds `size → shape → critique` under
  `~/.harness/tasks/<task_id>/` (never under a project). A `size` of S deletes the task and
  returns `delegate: {tool: "graph_open", args}` — an S request leaves no manager state. L goes
  on to `shape` (packages with `brief`, `acceptance`, `touches[]`, `deps[]`; validated for
  overlap, dangling deps, cycles, and the one-package case), then `[dispatch → accept]` per
  package, `integrate`, `gate:goal`, `report`. A ready `dispatch` is executed by the server in
  `tm_next`: `git worktree add` from the project's HEAD, then `createRun` from `graph.mjs` as a
  library opens an isolated child graph run there with the package brief as request and the
  package contract (plus its dependencies' reports) as context. The session drives the child
  with the ordinary `graph_*` tools; `tm_submit` on the dispatch folds the child's goal-gate
  verdict and report by reading its file — byte-for-byte untouched, tested. A retry reopens the
  same worktree with a fresh child carrying the gaps; exhaustion settles downstream and releases
  the report. Restarting the server resumes from files without reclaiming a running dispatch.
  Found on the way, in the graph engine itself: a rejected `gate:goal` was never re-judged after
  the subgoal retry, so the run wedged with the fix in place — now a fresh `gate:goal:N` opens
  over the live subgoal gates and the report moves behind it. 10 manager cases + 1 engine case;
  109 pass across the three suites.
- **v0.3.0 — flows and entry skills**: `graph_open({flow, mixed})`. `flow: "auto"` (the
  `graph-beta:orchestrate` default) leaves the choice to `plan`, whose contract now returns
  `flow` (develop | document), `size` (S | L) and the commands it measured with; a plan that
  says nothing falls to develop and the run records `flow_source: "default"` rather than
  passing it off as a decision. `graph-beta:develop` and `graph-beta:document` are thin manual
  entries — trigger words, the pinned `flow`, a persona set — that hand off to the one loop,
  now in `orchestrate/references/loop.md`. The flow supplies the kind a subgoal did not name;
  `mixed: false` makes the other kinds a spec defect at setgoal. `graph_next`/`graph_status`
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

Install `graph-beta@newkayak12-claude-skills` and run `graph-beta:install` to verify the six
`graph_*` tools are present. For a source checkout, register `mcp/broker.mjs` under the name
`graph-beta-engineering` in the project's `.mcp.json`; `graph-beta:install` shows the entry.

## Everything else

Tools, routing, adjudication, vendors, capacity recovery and the ledger are unchanged from
stable — read [`graph/README.md`](../graph/README.md). Stable fixes are forward-ported here;
beta work is not back-ported until it graduates.
