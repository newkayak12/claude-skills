# graph

Graph engineering for the harness flow, mediated by a local MCP server. The main
session orchestrates; the graph engine owns state, routing, execution, and adjudication.

Sibling to `harness`, not a replacement. **harness** owns the six-stage reasoning
contract. **graph** owns who executes a node, and whether the result survives contact
with the worktree.

## Why

The static Workflow engine had to spawn a transport subagent per node just to drive a
vendor CLI through Bash. A subagent waiting on a long-running process can only poll, and
cache-read scales with turn count. Measured on one real run, same unit of work:

| shell turns in the node | cache-read tokens |
|---|---|
| 4 | 227,323 |
| 12 | 1,281,319 |
| 17 | 1,965,390 |

Across that run the transport layer cost more than the reasoning layer. An MCP call is
one turn and blocks, so a node **cannot** poll — the failure mode is removed structurally
rather than discouraged in a prompt.

## Install

Install the marketplace plugin and use `graph:install` to verify the connection:

```text
/plugin install graph@newkayak12-claude-skills
```

For a source checkout, `graph:install` can instead merge this direct registration:

```json
{
  "mcpServers": {
    "graph-engineering": { "command": "node", "args": ["<plugin root>/mcp/broker.mjs"] }
  }
}
```

Zero runtime dependencies, Node 18+.

## Status

- **v1.5.2 — atomic capacity reset**: a `graph_retry` that is going to be rejected no
  longer clears capacity exclusions first, and an ordinary probe failure is never
  laundered into a capacity exclusion.
- **v1.5.1 — probe-time capacity**: a readiness probe rejected for usage limits is
  classified as spent capacity instead of a broken vendor, recorded on the run, and
  cleared by `graph_retry({reset_capacity:true})` with no interrupted node to name.
- **v1.5.0 — automatic allocation and capacity recovery**: balanced routing keeps
  reasoning on the driving host and prefers the other vendor's efficient model for
  Implement/Test. Claude now has a fresh-session CLI adapter. Fable/Astra are excluded
  from inherited defaults; explicit model requests remain supported. Usage-limit
  interruptions retain checkpoints and partial files, then route to another available
  vendor. No new token, spending, or turn limits are imposed.
- **v1.4.0 — host-neutral orchestration contract**: fresh role contexts, shared
  task directories and persisted handoffs, task-scoped Implement/Test inputs, and
  SetGoal/QualityGate retries are now explicit skill requirements. When both AI
  executors are usable, route by task fit and observed cost rather than requester
  identity. This release changes instructions, not the broker: automatic balancing,
  a standalone Claude adapter, and hard token budgets remain unimplemented.
- **v1.3.0 — current-session execution**: `graph:orchestrate` defaults to the active
  Codex or Claude session for every stage, using its native tools and current model.
  External vendor routing remains optional; no Codex CLI or fixed model is required.
- **v1.2.0 — Claude/Codex mixed orchestration**: `graph:orchestrate` now keeps reasoning,
  gates, and reporting on the Claude session while requiring Codex for implement/test.
  The node's selected model is forwarded into both Codex readiness probes, with
  model-scoped probe caching, so a bad global default cannot reject a run that names a
  working model explicitly.
- **v1.1.1 — Codex preferred by `graph:orchestrate`**: ordinary skill-driven runs now
  open with `vendor: "auto", candidates: ["codex"]`, so the bundled adapter is actually
  used when its readiness probe passes and falls back visibly to `self` when unavailable.
  Direct callers that omit `candidates` retain the quiet `auto` behavior introduced in
  v1.0.1.
- **v1.1.0 — per-stage routing**: `graph_open` takes `model` (a run-level default) and
  `policy`, a per-stage override map keyed by stage name plus the optional `gate:goal` —
  each entry may set `vendor`, `candidates`, `sandbox`, `model`. This expresses the harness
  contract directly: reasoning on a strong model, execution on whatever can actually write
  on this host. `graph_next` reports the chosen `model` per ready node, and an explicit
  `graph_run({model})` still wins for one call. Verified by a reduced-scale codex E2E that
  reached `report` with artifacts checked independently of the run's own verdicts.
- **v1.0.1 — stable line. No vendor by default**: `vendor: "auto"` no longer enrols every
  registered vendor as a candidate; the candidate list is empty by default, so an unnamed run
  degrades to `self` through the existing path. The `codex` vendor, its adapter, and the
  readiness probe are unchanged and still route when named (`vendor: "codex"`) or listed in
  `candidates`.
- v1.0.0 — moved the existing graph-engineering MCP out of the temporary `broker`
  plugin name and split lifecycle from execution: `graph:install` connects/verifies it,
  while `graph:orchestrate` drives the graph. Engine code and on-disk run format remain
  the existing implementation.

## Tools

| tool | purpose |
|---|---|
| `graph_open` | throw a raw request in; the broker builds the flow as a node graph on disk |
| `graph_next` | ask which nodes are ready, and how each is routed |
| `graph_run` | the routed vendor executes one node; **blocks**; returns a one-line verdict |
| `graph_submit` | record a node the orchestrator executed itself; same adjudication |
| `graph_retry` | open a fresh attempt, carrying rejection feedback — a subgoal, or the spec itself |
| `graph_status` | compact run state; `full:true` only for one node at a time |

## The orchestrator never holds the payload

The goal-spec, subgoal acceptance, upstream handoffs, prior rejection feedback,
changed-file lists and evidence all stay in the graph on disk. Tools return
`{node_id, stage, vendor, state, stage_ok}` and a short reason. Two consequences:

- **`setgoal` expands the graph inside the broker.** The spec it produces never passes
  through the caller; the per-subgoal implement/test/gate nodes and their dependencies
  are derived from it server-side.
- **The broker composes every node prompt** from graph state. `graph_run` does not
  accept a prompt — passing one is impossible on purpose.

This is what makes a long loop possible. If node results accumulated in the
orchestrator's context, a graph with retries would exhaust it and the loop would die
before the work did.

## Graph

`plan -> setgoal -> critique`, then per subgoal `implement -> test -> gate` with
subgoal dependencies mapped onto gate nodes, then `gate:goal:1 -> report`.

A rejected subgoal gets a **new attempt** rather than a re-run node: the failed attempt
stays in the graph as evidence, its still-pending nodes are retired as `skipped`, and
anything that waited on the old gate is rewired to the new one.

When **critique** rejects the spec, retrying one subgoal fixes nothing — the decomposition
itself is in question. `graph_retry` with no `subgoal_id` reopens `setgoal` and `critique`
with the critique's problems as feedback and retires the subgoal graph the rejected spec
produced; the rebuilt graph hangs off the live critique node.

A judging node can fail with `stage_ok: true`. There, `stage_ok` means "the judging
itself worked" and the verdict is `accept` / `verified` / `sound`. Reading only `stage_ok`
once let a rejected subgoal flow downstream as if it had passed, which made the gate
decorative. Both `graph_run` and
`graph_submit` refuse a node whose deps are unmet, that is already finished, or that
does not exist — the ordering is enforced, not advisory.

## Routing

`vendor: "auto"` (default) tries each candidate in order and falls back to `self`.
A bare direct call has no candidates. `graph:orchestrate` instead opens with
`vendor: "auto", allocation: "balanced", host_vendor, host_model, native_models`.
Reasoning prefers the driving AI/model; Implement/Test prefer the other vendor using
Claude `sonnet` or Codex `gpt-5.6-sol`. If only one vendor is available, it can fill both
roles with fresh contexts and selectable models. Fable/Astra are never inherited from
the driving session automatically; they require an explicit model request. Hosts must
declare their native model capabilities honestly. A Codex session uses native agents
instead of nested Codex CLI; external vendors pass readiness probes.

Balanced ranking considers stage preference, assigned/running work, completion counts,
and execution errors. It is a deterministic heuristic, not learned performance or cost
prediction. Explicit policies override it. No token/spending cap is added.
The lead passes scoped artifact paths and submits compact results; it does not perform
every role in its own conversation. Each task's Implement/Test/Gate shares the same
working directory and code snapshot. See `skills/orchestrate/SKILL.md` for the routing,
artifact, and retry contract and the broker's current enforcement limits.
A **named** vendor does not fall back — the node returns `vendor-failure` with per-vendor
probe reasons. Name the vendor when the run must prove who did the work; silent
degradation is what lets a graph lie about it.

`vendor`, `model`, `candidates` and `sandbox` set the run-level default; `policy` overrides
them **per stage**, keyed by stage name (`plan`, `setgoal`, `critique`, `implement`, `test`,
`gate`, `report`) plus the optional `gate:goal`. A stage entry wins over the run-level
setting, a stage without one inherits it, and `graph_next` reports the chosen `model` per
ready node. This is how "reasoning on a strong model, execution wherever it can actually
write" is expressed without a second run. The selected model also reaches the readiness
probe, so the probe and the real node cannot accidentally test different Codex models.

Reasoning nodes (plan, setgoal, critique, gate, report) are routed to a read-only
sandbox: they are judged by their content, so there is no file claim to cross-check.

## Adjudication

The broker may **lower** `stage_ok`, never raise it. Claimed `changed_files` are
cross-checked against `git status`:

- `isolated: true` (caller asserts a private worktree) -> `changed_files_verified` is
  `true`/`false`.
- shared worktree -> `null` unless a claim is *contradicted*. "Could not attribute" is
  neither a pass nor a failure.
- no git -> `change_attribution: "no-git"`, verification `null`.

A claimed file the worktree does not show fails the node regardless of what the executor
reported — vendor or orchestrator alike.

## Vendors

A vendor is anything meeting the adapter CLI contract:

```
<cmd> --detect  --cwd DIR --sandbox MODE --output FILE
<cmd> --stage implement|test --cwd DIR --prompt-file F --events-output F
      --output F --sandbox MODE [--isolated] [--add-dir DIR] [--model M]
```

Execution stages require exit 0 **and** `stage_ok === true` in the report. `codex` and
`claude` ship built in (`adapters/codex-exec-adapter.mjs` and
`adapters/claude-exec-adapter.mjs`). Claude uses print mode without resume or session
persistence. It disables MCP inheritance to avoid re-entering the graph, retains project
permissions, and never bypasses permission checks. Its read-only profile exposes only
Read/Glob/Grep; workspace-write adds editing and Bash tools under existing permissions.
This tool profile is not an OS filesystem sandbox. Permission-denied work fails visibly.
CLI flags follow the [Claude CLI reference](https://code.claude.com/docs/en/cli-reference).
Add more per project in
`.claude/broker-vendors.json`, or point `BROKER_VENDORS` at a registry file:

```json
{
  "myvendor": {
    "command": "node",
    "args": ["/abs/path/to/adapter.mjs"],
    "sandboxes": ["workspace-write"],
    "default_sandbox": "workspace-write",
    "requires_binary": "myvendor-cli"
  }
}
```

Readiness is a **real write probe**, not a version check: some sandboxes start, accept
the run, write nothing, and exit 0. The probe creates a throwaway file and looks at the
filesystem itself.

## Capacity recovery

Balanced runs distinguish usage-limit errors from task failures, at execution time and at
readiness probe time alike - the probe searches the whole adapter report, since adapters bury
that message at different depths. A vendor rejected for spent capacity is recorded on the run
as such rather than as a broken vendor. A quota interruption
preserves a checkpoint, raw report/log paths, and the working tree, excludes the exhausted
vendor for that run, and makes the node ready for another available executor. The next
session inspects the checkpoint and current files before continuing under the same goal.
This resumes work from artifacts; vendor conversations are not interchangeable.

For native agents, submit `stage_ok:false, failure_kind:"quota"` and available evidence.
Call `graph_next` for fallback. When all candidates are exhausted the run reports blocked;
after capacity returns, use `graph_retry({run_id,cwd,reset_capacity:true})`, adding `node_id`
when a specific interrupted node should reopen.
Each external invocation has its own output directory. Persisted state survives an MCP
restart; supply the original `cwd` with `run_id` when reconnecting. No automatic worktree
rollback occurs, and partial work is never treated as verified completion.

## Ledger

Under each node's `cwd`:

- `.harness-run/broker/ledger.jsonl` — append-only history
- `.harness-run/broker/open-nodes.json` — snapshot a PreToolUse hook can read

The harness gate treats an open node within its window as engagement. The ledger is
evidence, not a dependency: a write failure never fails a node, and a missing, stale, or
corrupt ledger is simply not engagement.

## Skills

- `install` — connect or verify the existing graph engine without copying it
- `orchestrate` — run the whole harness flow from the main session
