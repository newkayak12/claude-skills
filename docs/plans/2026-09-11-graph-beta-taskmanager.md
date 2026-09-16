# graph-beta: kinds, entry flows, TaskManager

> Design ledger for the `graph-beta` plugin. Written 2026-09-11 from a design conversation;
> every decision below has its reason next to it so a fresh session can tell which parts are
> settled and which are still open. Steps use checkbox syntax. `graph` (stable) is not touched
> by any step here except forward-porting its fixes.

**Goal:** a user installs one plugin and says "do this". The AI sizes the request, runs it
through the code flow, the document flow, or — when it is large — splits it into packages,
runs each as its own graph run in its own worktree, integrates, and reports. The user never
picks a mode; a user who wants to can.

**Where it lives:** `graph-beta/` — a fork of `graph` 1.7.0 with its own MCP server name
(`graph-beta-engineering`), its own run directory (`.harness-run/broker-beta/`), and skill
namespace `graph-beta:*`. Stable keeps running unchanged next to it.

---

## Decisions (settled)

| # | Decision | Why |
|---|---|---|
| D1 | The engine (`mcp/graph.mjs`: DAG, `deps`/`after`, retries, settled failure, ready set) is domain-neutral and stays one. What is code-specific is the **leaf node chain** and the **contracts** in `prompts.mjs`, plus `crossCheck` in the broker. | Grep shows the coupling: setgoal contract "unit of WORK that changes files", test contract "command -> observed output", gate evidence = command output, `crossCheck` = `git status`. Nothing in graph.mjs knows about files. |
| D2 | Domain difference is a **kind** on the subgoal, not a second skill or a second engine. A spec may mix kinds. | "Implement the feature and update the design doc" must be one run. Two skills would force the user to choose and would split this into two runs. |
| D3 | The user-facing entry stays one: `graph-beta:orchestrate`, no parameters. `plan` returns `size` and `flow`; expansion follows. | The requirement is "install and use without thinking". |
| D4 | Manual specialisation exists as **thin entry skills** (`graph-beta:develop`, `graph-beta:document`), not as a parameter the user must remember. They set `flow` and a persona set and hand off to the shared loop in `references/`. | Skills trigger on how the user phrases the request; that *is* the manual choice. The loop is identical either way and must not be duplicated. |
| D5 | `flow` (run default kind + persona set) and `mixed` (default `true`) are `graph_open` parameters the entry skills set. | Choosing the document entry should not forbid fixing one code example. |
| D6 | TaskManager is a **separate MCP server** in the same plugin (`mcp/taskmanager.mjs`), reusing `graph.mjs` as a library. | (a) a graph run is bound to one `cwd`; medium/large work spans worktrees and sometimes repos, so the manager's state must live outside any one `cwd`. (b) reuse, not a second DAG. (c) install stays one step — `.mcp.json` lists two servers. |
| D7 | TaskManager **reads** child run files, never writes them. The broker is the only writer of a run file. | Two processes writing one run file is the exact failure `mergeOnto` exists to paper over. Keeping a single writer removes event sourcing from the TaskManager prerequisites. |
| D8 | The child run is opened by the TaskManager server on a `dispatch` node, never by a model inside a node. The "do not re-enter the harness" rule in every node prompt stays. | It was written after a vendor re-entered the harness from inside a node. The team structure comes from the broker opening runs, not from nodes calling tools. |
| D9 | MCP servers do not call each other. The driving session relays: `tm_next` returns a `dispatch` node with `child: {cwd, run_id}`; the session drives the child with `graph_next`/`graph_run`/`graph_submit`; when the child's report is done it calls `tm_submit`. | MCP has no server-to-server channel, and the session is already the relay for everything else. Its context still holds no payload. |
| D10 | Children are always size S — recursion depth 1. | If a package still needs splitting, `shape` split badly; that is a critique finding, not a reason for depth 2. |
| D11 | Small requests skip TaskManager entirely. There is no "parent run" wrapping an S request. | A shell run adds a file, a lock and a second report and buys nothing. |
| D12 | Stable fixes are forward-ported to beta; beta work is not back-ported until it graduates. | Two lines diverging silently is how forks die. |

## Open questions

- ~~**`integrate` failure ownership.**~~ Resolved in Step 6: the shape's. `tm_retry({repackage})`
  feeds the conflicting packages, files and declared touches back to `shape`.
- ~~**Size honesty.**~~ Measured 2026-09-11 (bench round 2): the fear ran the other way. Both
  monorepo fixtures — four and three workspace packages — were sized **S** with sound, command-backed
  reasons (one root test script, one commit, no ownership boundary → one build unit). `size` reads
  build units, not package counts, exactly as the contract says. Nothing over-sized. The manager path
  therefore needed `tm_open({size: "L"})` (0.6.2) to be reached at all, and that pin is for a user
  who said the work must be split, not for the harness to decide.
- **Tool name collision.** Both servers expose `graph_*`. Claude Code namespaces them per server,
  but the install skill's warning about ambiguity stands. Renaming beta's tools would break the
  1781-line suite for no user benefit yet; revisit at graduation.

---

## Steps

Each step ends with the full suite green (`node --test graph-beta/scripts/*.mjs`), the validator
passing, a Status entry in `graph-beta/README.md` and `KOR.md`, a version bump, commit, push.

### Step 1 — kind table (v0.1.0)  ✅
- [x] `KINDS = { subgoal: { chain: ['implement','test','gate'] } }` in `graph.mjs`.
- [x] `expandSubgoals` builds the chain from the table; first node takes `[critiqueDep, ...deps]`
      and `after`; each later node depends on the previous; the last is the gate collected into
      `gateIds`.
- [x] `retrySubgoal` derives the chain from the spec's kind, not from literal names.
- [x] `validateSpec` rejects an unknown `kind`.
- [x] 89 regression cases pass unchanged (+1 new: unknown kind fails at setgoal). That is the
      acceptance: the seam exists, behaviour has not moved.

### Step 2 — `document` kind (v0.2.0)  ✅
- [x] `KINDS.document = { chain: ['draft','review','gate'], reasoning: ['review'] }`.
- [x] Contracts in `prompts.mjs`: `draft` (paths written + one-paragraph abstract as handoff),
      `review` (per acceptance item, quote the passage or name what is missing; `verified`),
      `gate` unchanged. Author ≠ reviewer: enforced on identity (executor + model) — a review
      routed to the draft's identity is *refused* (node stays pending, no retry spent), `self`
      is marked `unverifiable-self` because the broker cannot see native agents.
- [x] `REASONING_STAGES` = base run-level stages ∪ every kind's `reasoning[]`; `VERDICT_FIELD`
      table replaces the per-stage ifs in `nodeSucceeded`/`verdict`.
- [x] `crossCheck(…, kind)`: `document` + empty claim → `null`, attribution `document-unchanged`.
- [x] setgoal contract: "unit of work with a checkable artifact", `kind` field documented;
      critique looks for misfiled kinds and rubrics no reader could apply.
- [x] Routing: `draft` is an execution/cross-vendor stage, `review` judges `draft` in the
      same-actor penalty (`AUTHOR_OF` table).
- [x] Found on the way: `graph_retry(subgoal_id)` took feedback only from gates, so a retry
      after a failed review or test went in blind. Now the last judging node's reason/gaps/
      failing checks are carried.
- [x] Tests: mixed spec reaches report; empty-claim draft unattributed while code implement
      still verifies; review without verdict fails with `missing_verdict`; document retry
      rebuilds the chain and briefs the review's gaps; same-identity review refused, other
      model accepted. 95 pass.

### Step 3 — entry skills and `flow` (v0.3.0)  ✅
- [x] `graph_open({ flow: 'auto'|'develop'|'document', mixed: true })`. `FLOWS` table in
      `graph.mjs` (kind + personas). `plan` contract returns `size`, `flow`, `sizing[]`; under
      `auto` the broker records `flow_chosen` + `flow_source: plan|default`. A silent plan is
      not failed (the old contract never asked) — it defaults to develop, visibly.
- [x] `normalizeSpec` stamps the flow's kind on every subgoal that named none, so downstream
      never needs the run default; `validateSpec(spec, {kind, mixed, flow})` rejects other
      kinds under `mixed: false`.
- [x] Loop moved to `orchestrate/references/loop.md`; `SKILL.md` keeps mandates, entry, output
      template, routing summary (133 lines, from 215).
- [x] `skills/develop/SKILL.md`, `skills/document/SKILL.md`: triggers, pinned `flow`, `mixed`
      rationale, delegate to the loop reference. 63 / 66 lines.
- [x] `graph_next` and `graph_status` carry `flow` and `size`. `size: L` is recorded only —
      Step 5 acts on it.
- [x] Tests: `mixed:false` rejects a named code subgoal under the document flow while an
      unnamed one follows the flow; fixed flow supplies default kinds and shows in briefings;
      auto lets plan choose and records the source. 98 pass.

### Step 4 — TaskManager server, read-only over children (v0.4.0)  ✅
- [x] `mcp/taskmanager.mjs` registered as `task-manager` in `.mcp.json`. State under
      `~/.harness/tasks/<task_id>/` (`HARNESS_TASKS_DIR` overrides), never under a project `cwd`.
      `graph.mjs` gained `store_path` (a run may say where its file is), and exports
      `node`/`pushChain(chain)`/`nextIndex`/`loadRunAt` so the manager reuses the engine.
- [x] Flow table: `size → shape → critique → [dispatch → accept] per package → integrate →
      gate:goal → report`. `validateShape`: acceptance, ≥2 packages, brief, deps, overlap in
      `touches[]`, cycles. Retry paths mirror the engine's (`tm_retry({package_id})` /
      `tm_retry()` reshape), exhaustion settles via `settleFailure`.
- [x] `dispatch:Pn:k` runs inside `tm_next`: `ensureWorktree` (kept across attempts, branch
      `harness/<task8>/<Pn>`), `createRun` as a library with the package brief as request and
      the package contract + dependency reports as context, `isolated: true`, flow from the
      package or the size node. Node stays `running` with `child: {cwd, run_id, branch}`.
- [x] `tm_next` returns `children[]` with `child_state` and the exact next call; `tm_submit`
      on a dispatch takes no payload and folds the child's goal gate + report by reading its
      file. Refused while the child is `running`; a `blocked` child folds as a failure with the
      gate's gaps. Test proves the child file is byte-identical after the fold.
- [x] No reclaim of a running dispatch — a restarted server offers the same child.
- [x] Size S: server-side already — the task deletes itself and returns `delegate`. Only the
      skill hand-off remains for Step 5.
- [x] Tests (10): handshake; open under root not project; S delegates and leaves nothing;
      shape validation + reshape feedback; dispatch creates worktree + child, early fold
      refused; two dependent children to report with P1's report in P2's context; rejected
      child → retry in same worktree with gaps; budget exhaustion releases report; kill/restart
      resumes; non-git project fails the dispatch with a reason.

**Found in the engine while testing (fixed in beta, present in stable `graph` 1.7.0):** a
`gate:goal` that rejected was never re-judged. `retrySubgoal` rewired the new subgoal gate into
the failed goal gate's deps but left it `failed`; the report stayed behind it and the run wedged
with the fix in place. Beta now opens `gate:goal:N` over the live subgoal gates with the rejection
as feedback and moves the report's `after` to it; `graph_retry(subgoal_id)` also carries the goal
gate's gaps into the retried subgoal. Candidate for a stable fix release — not applied there yet
(D12 says beta does not back-port; this is a bug, so the user decides).

### Step 5 — `size` gate and hand-off from the entries (v0.5.0)  ✅
- [x] All three entries open with `tm_open` (flow `auto` for orchestrate, pinned for
      develop/document). `tm_submit(size)` → `delegate` → `graph_open({...delegate.args,
      isolated})` + `loop.md`; no delegate → `manager.md`.
- [x] `references/manager.md`: the task loop — children driven with `loop.md` at the child cwd,
      payload-less fold, `tm_retry`, integrate, progress mirror, output notes. `loop.md` says how
      it is entered from a task.
- [x] Tests: S leaves no state (Step 4); pinned flow survives sizing and `delegate.args` opens a
      graph run verbatim. 110 pass.
- Open: the request is measured twice (manager `size`, then graph `plan`). The skill tells the
  session to report a disagreement as an observation, not to re-decide. Watch it on real runs.

### Step 6 — `integrate` and repackage (v0.6.0)  ✅
- [x] Fold commits an accepted child's worktree on its package branch (`:!.harness-run`).
      Writes git, not the run file — D7 holds.
- [x] `ensureWorktree(task, name, base)`: a package with `deps` branches from its first
      dependency's delivered branch; further deps are merged in; a conflict fails the dispatch
      with `conflicting_packages` before any child opens.
- [x] `prepareIntegration` in `tm_next`: merges in `dependencyOrder`, records
      `{package, branch, commit}`; conflict → node failed with `conflicts`, `conflicting_packages`
      (merging package, then merged owners via `touches`), aborted merge. The `integrate` agent
      only runs the combined checks; its contract shrank to `{stage_ok, verified, checks}`.
- [x] `tm_retry({repackage: [ids]})`: reshape with an explicit instruction (one package, or a
      dependency), the conflicting files, each package's declared touches, and the note that
      kept ids reuse their worktrees. Unknown ids are refused.
- [x] Tests: full two-package integration with merge commits in briefing and file content in
      the integration tree; independent packages that collide → observed conflict → repackage
      prompt; conflicting dependencies fail the dependent dispatch. 112 pass.

### What the bench measured (2026-09-11 → 14)

Round 2 (partial, 2026-09-14): the unpinned beta — one graph run, `size` measured S — cost the
same as stable on the same request (8/9 · 50 min · $13.20 vs 9/9 · 48 min · $13.27): the
beta's engine additions (kinds, flows, mixed runs) add nothing measurable to a single run. A
one-line goal (`goal-code`) cost the plain session 5.5× what the fully specified request did
($11.92 vs $2.17) — the planning happened inside the session — and the manager's shape split
that same one-line goal into the four packages a person had written for the specified case,
with disjoint ownership and a single dependent. That is the first evidence for the manager's
planning layer; the rest of round 2 is in the bench README.

`scripts/bench/` — two size-L-shaped requests (`code`: four workspace packages + CLI + tests +
README; `docs`: three package references + architecture + three ADRs + CONTRIBUTING + README),
three arms, scored on the tree left behind plus session cost. Full table in
`graph-beta/scripts/bench/README.md`.

| arm | code | docs |
|---|---|---|
| none (plain `claude -p`) | 9/9 · 8 min · $2.17 | 9/9 · 14 min · $3.97 · 0 false claims / 82 |
| beta, size pinned L (manager, 4 packages) | 9/9 · 173 min · $72.97 · 2 sessions | 9/9 tree · 104 min · $48.63 · task blocked at integrate (fixed in 0.6.3) |
| stable 1.7.0 (one graph run) | 9/9 · 48 min · $13.27 | 9/9 · 61 min · $18.10 · 2 sessions |
| beta, size measured (S → one run) | interrupted by usage limits at 45 min / $12–13 | same |

Five manager defects the unit suite could not see, all fixed and covered (0.6.1, 0.6.2, 0.6.3):
the host's own model refused when `native_models` omitted its variant; a tier default (`sonnet`)
compared as a string against declared ids so every execution node was `vendor-failure` with
zero failed nodes; the fold's `':!.harness-run'` pathspec exits 1 when the project ignores that
directory; `tm_retry` accepted a package id the shape never named and opened a phantom package;
an `integrate` that failed its checks (P2's README example did not run) stayed failed after the
package was retried and accepted, with the goal gate pending behind it forever — the manager's
copy of the rejected-`gate:goal` wedge. Each was found only because a real session drove a real tree. Also found: a headless
session that hits its usage limit dies mid-run — three rounds did — and the on-disk task, child
runs and worktrees resume exactly (`resume.sh`, `drive.sh`).

The manager delivered the same 9/9 as the baseline at ~34× the cost and ~21× the time, with
things the baseline does not produce: per-package gates at 92–95%, a critique that caught a
contradictory spec and forced a retry, a gate that executed the README example and diffed it,
commits on package branches and an integration branch. The request was S by the harness's own
measurement; the manager's value on a request that is genuinely L — several repositories, a tree
no one session can hold — is still unmeasured, because no such request has been run.

### Step 7 — cost (proposed, not started)

Where the $73 went, from the stream's per-message usage (proportions; the absolute sum
double-counts streamed events):

| who | model | share | note |
|---|---|---|---|
| the driving session (manager) | opus 1M | ~55% | 331 turns, context grew to **507k tokens**, 67.6M cache-read tokens |
| fresh judging agents (plan/setgoal/critique/gate/review/accept/integrate/report) | opus | ~40% | 38 agents, context ≤ 71k each |
| fresh execution agents (implement/test) | sonnet | ~3% | 15 agents |

So the judges are not the problem and stay on the strong model — a gate on the cheap tier would
make the harness the baseline with extra steps. The problem is the manager's own context: the
design says the payload never enters it, and the manager wrote nothing (0 top-level edits), but
every self node's JSON — handoff, evidence, gaps — passes through it twice, once as the agent's
return and once as the `graph_submit` argument, and 67 dispatches later the session is half a
million tokens that every turn re-reads. Candidates, in order of expected yield:
- **payload by path, not by value**: a fresh agent writes its JSON next to its briefing and returns
  the path; `graph_submit`/`tm_submit` take `payload_path`. The manager's context holds verdicts
  only, as the design intended. Expected to remove most of the manager's share.
- the manager session on the lower tier: it relays and loops, it judges nothing; the judges are
  the agents. For the bench this is one flag (`--model sonnet` on the driving session).
- shorter briefings: the spec once, the upstream handoff once, no repeated goal text
- `report` optional on child runs (the manager reads the gate; the parent report covers the whole)
- a per-task cost line in `tm_status`, so a run says what it has spent so far

### Step 8 — ports to stable `graph`  ✅ (1.7.1)

Bugs, not features, so D12 does not apply: the rejected `gate:goal` never re-judged (1.7.0 has
it), the host-model variant refusal, the tier-vs-id comparison. Each is a small fix with a test
already written in beta.

### What the rewrite dropped

Every row below could have been read off `harness/engine/pipeline.js` in an afternoon. Four of
them were instead re-discovered one at a time from bench runs at $13 to $73 each: the retry
loop, the stall check, the per-subgoal skills and the goal threshold all came back because a
run behaved wrongly, not because anyone diffed the rewrite against the thing it replaced. The
old generation is one 573-line script in which most of the design lives inside prompt strings;
the new one is an MCP server plus a graph, and a feature that was a sentence in a template had
nothing in the port to catch it. This table is the diff nobody ran. Both sides were read for
it at beta 0.7.0 — "present" means the code was found, not that the feature was remembered.

| `harness/engine/pipeline.js` | `graph-beta` | status |
|---|---|---|
| Retry loop per subgoal: `while (attempt <= RETRIES)` reruns implement → test → gate and breaks on `verdict.pass`. Budget `spec.max_retries ?? args.max_retries ?? 2`, so three attempts. | `autoReassign` opens the next attempt chain when a verdict node fails; `retrySubgoal` caps at `max_retries + 1`, the same three. | **Restored** in 0.7.0. Two differences on purpose: only a verdict reassigns, so a node that could not run at all (`stage_ok: false` — transport, vendor, unparseable reply) leaves its chain pending for the caller, where the old loop simply went round again; and `spec.max_retries` no longer overrides the run, which owns the budget from `graph_open`. |
| Stall check: `rejectionSig` = sorted gaps + reason. Two consecutive identical signatures abort the subgoal, mark it `stalled`, and let the run proceed to the goal gate on partial work. | The same signature, plus `blocking`. On a match `autoReassign` calls `retrySpec`, so setgoal and critique re-author with what the subgoal kept failing on. | **Present, changed on purpose.** The original stopped; beta reshapes. goal-docs is the evidence: a package README truthfully said the repo had no other docs, false only in the combined tree, so no attempt inside that package could ever fix it. Aborting there would have been correct and useless. |
| Persona per subgoal: `subgoals[].persona`, rendered as `Act as: …` in the implement prompt and passed into the Codex bridge. | The same field in the setgoal contract, a persona set per flow in `FLOWS[*].personas` offered to setgoal, and `Act as:` in the briefing. | **Present on both.** One difference nobody chose: the original attached the persona to implement alone, while beta emits it inside the shared `## Subgoal` block, which every node of the chain gets — the gate is told to act as the implementer it is judging, two lines above being told it is the judge and not the actor. |
| Skills per subgoal: `subgoals[].skills`, "1-3 repository skill names the executor must invoke", mounted in the implement prompt with a Skill-tool-then-Read fallback. | Being added now: `skills` in the setgoal contract and a `Method —` block in `composePrompt`; the TaskManager carries a package's `skills` into its child run's context. | **Restored.** The 1-3 bound is gone, and the Method block sits in the same shared subgoal section as the persona, so test, review and gate are told to load the implementer's method too. Beta adds something the original never said and should keep: the node contract outranks a skill's own output template, and a dialogic skill has nobody here to answer it. |
| Stage-mounted skills: `mountSkill` pins method to the stage — plan → `agents:agent-task-decomposer`, spec critic → `think:devils-advocate`, every subgoal gate and the goal gate → `think:devils-advocate`, test → `completion:verification-before-completion`. | `STAGE_SKILLS` in `taskmanager.mjs` covers the manager's stages only (shape, critique, accept, integrate, `gate:goal`), overridable per stage by `tm_open({skills})` and switchable off entirely. | **Half restored** (0.6.7). The manager got the mechanism; the graph engine that every size-S request runs mounts nothing on plan, setgoal, critique, test or gate. |
| Stage-mounted MCP tools: `mountMcp` offers plan → sequential-thinking, setgoal → think-tool, the goal gate → mcp-reasoner, each skipped in silence if absent. | Nothing. No node prompt under `graph-beta/` mentions an MCP tool or ToolSearch. | **Dropped**, and until now unlisted. The smallest loss in the table — the mounts were advisory — but it is the row above's omission repeated, and it was never decided either. |
| `GOAL_MATCH_THRESHOLD = 90`: the goal gate's `match_pct` is compared against it, and the comparison is what drives the repair loop. | Being added now as `goal_threshold`, default 90, set at `graph_open`, enforced in `nodeSucceeded` for `gate:goal` only; `0` accepts on the verdict alone. | **Restored** and made a property of the run rather than a constant. The TaskManager's own `gate:goal` is not held to it: `succeeded()` in `taskmanager.mjs` reads `accept` and nothing else, so a manager task can accept the integrated result at any `match_pct`. That is the decorative gate the threshold exists to prevent, one layer up. |
| Goal-gate repair: below threshold, a repair agent (`sonnetGoalRepairInstructions` / `codexGoalRepairInstructions`) is given the gaps and every subgoal handoff, fixes across the tree, and the whole is re-gated — up to `RETRIES` times, with the same stall check. | Nothing. `autoReassign` declines the goal gate on purpose; `retrySubgoal` opens a fresh `gate:goal:N` and `subgoalFeedback` carries the goal gate's gaps into whichever subgoal the caller retries. Nothing works on the assembled result as a whole. | **Absent.** Step 9 below. |
| Degenerate-spec guard: `isDegenerateSpec` (no subgoals, no goal-level acceptance, goal text under 8 characters, a subgoal title under 4 or with no acceptance) plus one corrective re-author whose prompt names the failure mode — structured-output validation rejects a large correct draft, usually over the missing top-level `acceptance`, and the model shrinks the payload to isolate the error instead of fixing the field. | `validateSpec` checks the same emptiness cases and more: missing and duplicate ids, missing titles, unknown kinds, a kind `mixed: false` forbids, self-dependency, dangling `deps`/`after`, cycles. A failing spec fails the setgoal node with `spec_problems`, and `retrySpec` carries them into the next attempt — which is critiqued again, where the original never re-critiqued its re-author. | **Equivalent and then some, with two specific losses.** The placeholder heuristics have no counterpart, so a spec that is well-formed and vacuous passes. And the retry feedback is the problem list alone, not the diagnosis of why a spec collapses. The diagnosis was worth more than the check: it named a failure mode the model can otherwise only rediscover. |
| Unwinnable-gate patterns, stated twice: setgoal is forbidden to write criteria that hinge on whole-repo state (git diff/status, aggregate repo-wide counts) because concurrent work makes them non-deterministic, and forbidden to write aspirational or arbitrary-threshold targets as hard bars; the critic is then told to flag both by name. | The critique contract names both. The setgoal contract does not — it asks only that every criterion be checkable by a command, a file inspection, or a reader finding a passage. | **Half present**: detection kept, prevention dropped. Not authoring the criterion is cheaper than critiquing it out, and the critique that has to catch it is the same node we now ask to reject only blocking defects. |
| `.claude/conventions/**` in three prompts: plan reads the relevant ones and lists the rules that must constrain the work, setgoal folds them into subgoal acceptance and `test[]`, implement reads the ones relevant to its files. | Nothing. The string "convention" does not occur anywhere under `graph-beta/`, including the install skill. | **Dropped**, and until now unlisted. The largest silent loss here: it was the only path by which a project's own rules reached the work, and losing it fails nothing — the run just produces work that ignores them, and every gate passes because no criterion ever mentioned them. |
| Plan's survey asks for five things: decomposition, real ordering dependencies, which repository skills and persona fit each unit, how each unit can be deterministically verified, and the conventions that constrain it. | The plan contract asks for the decomposition, `size`, `flow`, and the commands that decided size. | **Changed, partly on purpose.** Moving skill and persona choice to setgoal is right — setgoal is the stage that knows what each unit is. Losing the conventions question is the row above. Losing "how would this be verified" is not obviously fine: setgoal now invents `test[]` with no upstream reconnaissance behind it. |
| Dependency waves: subgoals whose deps are done run in parallel; a wave with nothing ready logs "unsatisfiable deps" and runs the remainder anyway. | `deps`/`after` edges and a ready set. `validateSpec` rejects dangling deps and cycles before any node exists, so the degraded path has nothing to degrade from. Under `isolated`, mutating nodes are offered one at a time so positive file attribution stays sound. | **Superseded.** The original's fallback was a guess made at runtime; beta makes the condition unreachable at authoring time. |
| Handoff budget: `handoffOf` extracts the `HANDOFF:` section and slices it to 1500 characters before any downstream prompt sees it. | `handoff` is a contract field with no cap, and `nodeBriefing` puts every upstream handoff, check and changed-file list into the next prompt. | **Dropped.** This is about briefing size, not about the driving session's context that Step 7 measures — but it is the same shape of problem one level down, and a node prompt that grows with the run is how a late gate ends up reading more than it can weigh. The cap was doing work nobody credited it with. |
| Codex delegation: `codex_provider: auto\|required\|off`, and a Sonnet "delegation controller" inside each implement/test node that locates the adapter, writes a prompt file, runs it, and must mark `DEGRADED:` or return `PROVIDER_FAILURE:` when it cannot. | Vendors, adapters and probes belong to the broker. `route()` picks per stage; a named vendor that is not ready returns `vendor-failure` rather than degrading silently; every node prompt forbids re-entering the harness. | **Superseded**, and the reason is written into `prompts.mjs`: a vendor with harness skills installed re-entered the harness from inside a node, running `--detect` and then `--stage implement` within the node that was already the implement stage. |
| Nothing checks the executor's file claims; the test agent's narrative is the evidence. | `crossCheck` compares claimed `changed_files` against `git status` and may lower `stage_ok`, never raise it. Attribution is `isolated`, `shared-worktree`, `no-git` or `document-unchanged`, and `null` means "could not attribute", which is neither a pass nor a failure. | **Addition.** No counterpart in the original. |
| The goal gate sees the goal, the goal-level acceptance, and one line per subgoal. It does not see the request. | It sees all of that, the request again, and every finished node including the failures; its contract asks for `spec_drift` — what the request asked for that the spec never turned into a criterion. | **Addition.** The original could not tell a spec that narrowed the request from a request that was met. |
| The spec critic runs once over the first draft. If `sound: false`, one revision follows and is never re-critiqued. `sound` is unbounded: any defect sets it. | A critique node per spec attempt, so each re-authored spec is attacked again. `sound: false` is reserved for `blocking` defects; everything else is advisory `problems` carried forward. | **Addition, with a gap.** `autoReassign` returns early for a node with no `subgoal_id`, so a `sound: false` critique waits for the caller to call `graph_retry` — exactly the advisory rejection 0.7.0 fixed for subgoal gates, still open one stage up. |

### Step 9 — the goal-gate repair pass (proposed, not started)

The row above is the only one in the table with nothing on the beta side at all. The gap it
leaves is specific: a run whose subgoals all passed and whose assembled result does not meet
the goal has no move. The goal gate rejects, `autoReassign` declines it by design, and the run
sits until a caller picks a subgoal to reopen — which is a guess, because the failure is
usually not in any one subgoal. It is in the seam: two halves that each satisfied their own
acceptance and do not meet. The repo owner's instruction was that the repair work "globally",
against the assembled result, and that is the same reading.

**Shape: a run-level `repair` stage, not a kind.** Kinds describe subgoals, and this node has
no subgoal — it belongs next to plan, setgoal, critique, `gate:goal` and report. It writes
files, so it stays out of `BASE_REASONING`: routed to a writable sandbox, offered one at a time
under `isolated`, and cross-checked against the worktree, which the original's repair agent
never was. Its contract is implement-shaped (`stage_ok`, `handoff`, `changed_files`, `checks`,
`evidence`), so the adapter's existing implement schema covers it with no new plumbing.

**Wiring.** On a `gate:goal:N` that failed on `accept: false` or on `match_pct` below
`goal_threshold` — and only that; a goal gate whose `stage_ok` is false could not judge at all
and is a routing failure, the same distinction `autoReassign` already draws — the engine opens

    repair:N        deps [gate:goal:N]
    gate:goal:N+1   deps [repair:N, ...gate:goal:N's own deps]

and moves the live report's `after` to `gate:goal:N+1`. All of that except the first line is
rewiring `retrySubgoal` already performs when a rejected goal gate has to be re-judged; the new
part is the node in between.

**Briefing.** `nodeBriefing` already assembles `whole_run` for anything whose id starts with
`gate:goal`; repair wants the same branch extended to its stage, plus the rejecting gate's
`reason` and `gaps` as `prior_feedback`. The original passed the gaps and one handoff line per
subgoal. Beta holds the checks each node ran, the commands the adapter observed and the
changed-file lists, and that is the difference between "the CLI is missing a flag" and "the CLI
is missing a flag, here is the file, here is what its test runs".

**What the contract must say.** That this node is the only one in the run not bound to a
subgoal's acceptance, and may touch files several subgoals own — which is the point, because a
seam is a path nobody declared. And that it may not restate the acceptance criteria to fit what
exists, which is the failure a node holding the gaps is most tempted by. The gate that follows
sees the criteria unchanged, so the temptation stays checkable rather than merely forbidden.

**Budget.** One repair per goal-gate rejection, `max_retries` repairs per run (default 2),
counted off `nextIndex(run, 'repair')` like every other attempt, on its own counter — subgoal
budgets are per subgoal, the spec budget is per run, this is a third. The original spent the
same number. Beyond it the goal gate settles: `settleFailure` marks it final, and the report,
which waits on `after` rather than `deps`, writes the partial account. Keep the stall check
too — a repair that leaves the same `rejectionSig` twice is being asked for something it cannot
produce, and the second one is a paid rediscovery of the first.

**Auto or advisory.** Auto, under the same `auto_reassign` flag, for the reason 0.7.0 gave: a
rejection the caller has to act on is a rejection nobody acts on, and most runs are size S with
no manager loop above them to act. It should be as visible as reassignment is — a `repaired:
{attempt}` field next to `reassigned` in the verdict.

**How this differs from the stall escalation.** They answer different questions and sit at
different levels. Escalation fires on one subgoal rejected twice for the same reason and
concludes the *spec* is wrong: setgoal re-authors, critique re-attacks, the subgoal graph is
discarded and rebuilt. Repair fires on the assembled result and concludes the spec was right
and the delivery fell short: the tree changes, the spec does not. One rewrites the question,
the other finishes the answer. In code, escalation is a branch inside `autoReassign` on a node
with a `subgoal_id`; repair is a branch on the node `autoReassign` explicitly refuses to touch.

**Where the two can fight.**
- **Rewiring collision.** A caller can call `graph_retry(subgoal_id)` while a repair is open.
  `retrySubgoal` then opens its own fresh `gate:goal`, and the repair ends up either orphaned
  behind a gate nobody waits on or judged by a gate that never depended on it. `retrySubgoal`
  has to learn about repair nodes before this ships; it is the same rewiring bug the rejected
  `gate:goal` had, and it will not show up in a unit test that only retries subgoals.
- **Escalation discarding a live repair.** `retrySpec` sets `run.spec = null` and retires the
  subgoal graph. A pending repair must be retired with it; a *running* one cannot be, and its
  work is already in the tree. The honest rule is the one already true of every retried
  subgoal: the node is superseded, its commits stay where the next attempt will find them, and
  the graph keeps it as evidence of what was tried.
- **Signature leakage.** A repair that closes a goal-level gap by editing a file some subgoal
  owns can make that subgoal's next gate reject for a *new* reason, which resets its
  `rejectionSig` and buys a retry the run had not budgeted. Not a bug so much as a leak. The
  cheap defense is to record on the subgoal which repair touched it, so a later gate reading
  `whole_run` can see that the work it is judging was not written by the attempt it is judging.

**What else could go wrong.**
- **Nothing verifies the repair.** The original appended the repair's handoff to `results` and
  re-gated, so the gate judged a claim. `crossCheck` catches a fabricated file list, but no
  subgoal's `test[]` runs again. The gate contract already says absent evidence is a gap, so
  the first answer is briefing discipline, not a new rule. The fuller answer is a `test`-shaped
  node between repair and the gate, which doubles the cost of every repair — build it when a
  bench run shows a repair accepted on its own account, and not before.
- **Scope.** A node told to fix globally can rewrite work that passed. Claimed files are
  cross-checked for existence, not for permission. The graph knows which subgoal declared which
  `files[]`, so a repair touching a path no subgoal named is worth surfacing in the verdict
  rather than forbidding — that path is usually the seam it was opened for.
- **Cost.** Two repairs plus two extra goal gates is roughly one more subgoal's worth of budget
  on a run that has already spent everything, and it lands on a run that was about to end.
  Step 7 has to land first or this makes the manager's number worse.
- **Out of scope: the manager.** The TaskManager has the same hole — its `gate:goal` rejection
  also falls to the caller, and `integrate` is explicitly forbidden to fix anything. But its
  tree is a merge of package branches, so a repair there has to decide what it commits and
  where that merges back, which is a design of its own and not this one. Its nearer problem is
  the missing threshold in the table above.

### Graduation (revised)

The old bar — ten real runs across three flows — assumed a run costs what a run used to cost.
At $70 a manager run it is not a bar anyone will clear, and it measured the wrong thing: the
manager's worth is decided by requests that are actually L, not by count.
- [ ] Step 7 lands and the bench shows a manager run under 3× the baseline on `code`.
- [ ] Cross-vendor round: codex logged in on the bench machine, `goal-*` cases under `vendor: auto`,
      scorer extended with nodes-per-vendor, cross-vendor `changed_files_verified`, and author/reviewer
      identity split by vendor. Not measured in rounds 1–2: codex was unreachable, every node ran on
      Claude. This is the harness's first stated purpose and it has no data yet.
- [ ] One request that `size` measures **L on its own** — not pinned — runs to `report`. Until
      one exists, the manager stays experimental and the entry skills say so.
- [x] Step 8 ported (graph 1.7.1, 2026-09-14): host-model variant, tier resolution, rejected `gate:goal` re-judge + retry feedback; stable at 97 tests.
- [ ] Decide tool names; port the `document` kind and `flow` to `graph` 2.0; `graph-beta` is deleted,
      not kept. The manager graduates only if the second box is ticked.
