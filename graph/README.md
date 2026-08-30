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
A **named** vendor does not fall back — the node returns `vendor-failure` with per-vendor
probe reasons. Name the vendor when the run must prove who did the work; silent
degradation is what lets a graph lie about it.

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

Exit 0 **and** `stage_ok === true` in the report is the only success. `codex` ships
built in (`adapters/codex-exec-adapter.mjs`). Add more per project in
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
