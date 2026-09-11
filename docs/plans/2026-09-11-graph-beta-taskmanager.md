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

- **`integrate` failure ownership.** Two children pass and the merge fails: whose failure is it?
  Proposed: `tm_retry({repackage: [P1, P2]})` feeds the merge failure to `shape` as "these two
  must be one package". No equivalent exists in graph's `retrySubgoal`. Decide when step 6 starts.
- **Size honesty.** `plan` will over-size (a manager layer exists, so it wants to use it). The
  evidence rule — module count, file count, boundary count, each checkable by a command — and a
  critique instruction to attack S→L inflation are the current answer. Measure on real runs.
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

### Step 4 — TaskManager server, read-only over children (v0.4.0)
- [ ] `mcp/taskmanager.mjs` registered as `task-manager` in `.mcp.json`. State under
      `~/.harness/tasks/<task_id>/` (configurable), never under a project `cwd`.
- [ ] Flow table for the manager: `size → shape → critique → [dispatch → accept] per package →
      integrate → gate:goal → report`, built on `graph.mjs` node/edge/settle primitives.
- [ ] `dispatch:Pn`: creates `git worktree add` for the package, opens the child run by calling
      the broker's `createRun` **as a library** (same process, same writer discipline: the child
      file is then owned by whichever `graph-beta-engineering` process the session drives), stores
      `child: {cwd, run_id}` on the node, stays `running`.
- [ ] `tm_next` returns manager nodes plus, for a running dispatch, the child pointer; `tm_submit`
      on a dispatch node reads the child file, folds `gate:goal` verdict + report handoff path into
      the node result.
- [ ] `reclaimAbandoned` equivalent must not reclaim a dispatch node while its child run is alive.
- [ ] Tests: parent with two children; kill and restart the manager; tree resumes from files.

### Step 5 — `size` gate and hand-off from `orchestrate` (v0.5.0)
- [ ] `graph-beta:orchestrate` opens with `tm_open`; if `size` is S the manager returns
      `{delegate: 'graph', ...}` and the skill continues with `graph_open` exactly as today.
- [ ] Test: an S request produces no manager state on disk.

### Step 6 — `integrate` and repackage (v0.6.0)
- [ ] Worktree merge node; cross-package checks from the packages' `acceptance`.
- [ ] `tm_retry({repackage})` — resolve the open question above first.

### Graduation
- [ ] Ten real runs across the three flows with no skill edits needed mid-run.
- [ ] Decide tool names; port to `graph` 2.0; `graph-beta` is deleted, not kept.
