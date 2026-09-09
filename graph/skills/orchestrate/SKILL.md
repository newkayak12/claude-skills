---
name: orchestrate
description: >-
  Use when running a whole request through the graph-engineering MCP and driving
  its harness nodes without holding the payload yourself. Triggers on: "그래프 돌려줘",
  "노드 단위로 돌려줘", "run it through the MCP", "orchestrate this run". Not for installation.
effort: high
scenarios:
  - "Run this request through the harness flow but keep my context free for the loop"
  - "Dispatch every stage to whichever vendor can actually do it"
  - "요청 전체를 MCP에 던지고 노드 단위로 할당받아서 돌리고 싶어"
  - "결과가 메인에 쌓이지 않게 그래프를 끝까지 돌려줘"
compatibility:
  required:
    - graph-engineering
related:
  - harness
  - install
---

# orchestrate — drive the graph-owned harness flow

Throw the request at the graph engine, then run the loop it hands back. The engine owns the
graph, the spec, the prompts, and the verdicts. You own only the loop.

## Standing Mandates

- NEVER call `graph_status({full: true})` on a run. One node at a time: `detail_path`, or `graph_status({full: true, node_id})`.
- ALWAYS read `state`. A judging node can return `stage_ok: true` and still be `failed` — that is the gate working, not an error to route around.
- A blocked run is a result. NEVER do a node's work yourself to force completion, and NEVER reopen a run to get past a gate that rejected the work. `reset_capacity` is for spent quota, not a retry-budget reset.
- `isolated: true` only when the run has a private worktree to itself. A false claim makes attribution meaningless.
- A `self` node's payload is the fresh agent's returned JSON, relayed verbatim. NEVER author or soften it.
- No Fable/Astra without an explicit user model request. No token, spending, or turn caps beyond the gate retry budget and process timeouts that already exist.

## The loop

```
graph_open({
  request, cwd, isolated,
  vendor: "auto", allocation: "balanced",
  host_vendor, host_model, native_models
})                                               -> run_id + first ready node
while state == "running":
    graph_next({run_id, cwd})                     -> ready[] with routing
    for each ready node:                          # all self nodes first, in one message; then vendor nodes
        self node    -> fresh agent at the returned model, briefing_path only; relay its JSON to graph_submit({run_id, node_id, payload})
        vendor node  -> graph_run({run_id, node_id})   # blocks; the self agents keep working meanwhile
        quota interruption -> graph_next selects the remaining available vendor
    if state == "blocked":
        a failed subgoal    -> graph_retry({run_id, subgoal_id})
        a failed critique   -> graph_retry({run_id})          # redo the spec
        nothing retryable   -> report and stop
graph_status({run_id, cwd})                       -> final counts, only if the last graph_next did not already return them
```

Six tools, one loop. `cwd` is optional after `graph_open` but carry it anyway — it is what
lets a restarted client find the run again.

**On a judging node `stage_ok` only means the judging itself worked.** The verdict is
`accept` (gate), `verified` (test), or `sound` (critique); a negative one makes the node
`failed` and holds back everything downstream.

**`graph_retry` without a `subgoal_id` or `node_id` retries the spec.** When critique rejects the
goal-spec, redoing one subgoal fixes nothing: the whole decomposition is in question. That
call reopens `setgoal` and `critique` with the critique's problems as feedback and retires
the subgoal graph the rejected spec produced.

## Dispatching a self node

One fresh agent per self node — a new context, never this conversation — at the
`model` that `graph_next` returned. Its entire prompt is:

```
Working directory: <cwd>. Read <briefing_path> in full and do only what it asks.
Do not read the conversation, and nothing under .harness-run/ the briefing does not name.
Your final message must be exactly the JSON the briefing's "Return JSON" line specifies — nothing else.
```

Fan out every self node in `ready[]` in one message; concurrent `implement` nodes only when
each has its own worktree, otherwise implement one at a time and fan out test/gate/critique.

As each agent finishes, pass its final message to `graph_submit` unchanged. If it is not
parseable JSON, submit `{stage_ok: false, reason: "executor returned no verdict"}` — do
not do the work in this context. If the host cannot launch at the returned model, say so
in the report instead of substituting a tier silently.

## Output template

```
## <request>

run: <run_id>   state: <complete|blocked>   nodes: <done>/<total>

| node | vendor | stage_ok | note |
|---|---|---|---|
| implement:U1:1 | codex | true | isolated |
| test:U1:1 | codex | true | verified |
| gate:U1:1 | self | true | 95% |

### Not done
<failed or skipped nodes, and why — including any that fell back to self>
```

## Do not pull the payload into your context

This is the rule the design exists for. The goal-spec, subgoal acceptance, upstream
handoffs, prior rejection feedback, changed-file lists and evidence all live in the
graph. Every tool returns a one-line verdict instead: `node_id`, `stage`, `vendor`,
`state`, `stage_ok`, and a short `reason` when it failed.

You do not write node prompts. `graph_run` composes them from graph state; passing one
is not possible on purpose.

## Routing

This skill opens with `allocation: "balanced"`. Pass `host_vendor` (`claude` or `codex`),
the actual driving `host_model`, and `native_models` (the models fresh native agents can
select). Omit host identity only when native agents are unavailable. Never claim model
selection support that the host does not expose.

The broker prefers the driving host for Plan/SetGoal/Critique/Gate/Report and the other
vendor for Implement/Test. Execution defaults are Claude `sonnet` and Codex `gpt-5.6-sol`;
reasoning on the host inherits `host_model`, and explicit stage policies override the
automatic choice. `graph_next` returns the executor, model, and routing reason; the
assignment persists until completion or interruption.

Anything past the balanced default lives in `references/`:

| need | read |
|---|---|
| legacy `ordered` mode, per-stage `policy`, `native_models`, provenance | `references/routing.md` |
| working directory, snapshot identity, briefing scope | `references/handoffs.md` |
| quota reporting, checkpoints, `reset_capacity` | `references/capacity.md` |

## Handoffs

One absolute project path and run-artifact directory, resolved at run start; Implement,
Test, and Gate for a task inspect the same code snapshot. Never weaken criteria to pass —
a defective goal goes back to SetGoal and Critique. Detail: `references/handoffs.md`.

## Capacity

An executor that hits its usage limit is reported as `failure_kind:"quota"`, never as an
ordinary failure. The broker keeps the checkpoint and partial files, excludes that vendor,
and hands the node back pending — call `graph_next` for the alternate route. All vendors
exhausted → report blocked; `graph_retry({run_id, cwd, reset_capacity:true})` once capacity
returns. Detail: `references/capacity.md`.

## Verdicts

| field | meaning |
|---|---|
| `stage_ok` | adjudicated. Never report a value above what the broker returned. |
| `verified` | test nodes: the checks ran and passed |
| `accept`, `match_pct`, `gap_count` | gate nodes |
| `changed_files_verified` | `true`/`false` under `isolated`; `null` in a shared worktree unless contradicted |
| `contradicted_files` | claimed files the worktree does not show — these fail the node |

`null` verification means "could not attribute": neither a pass nor a failure. Say so
rather than rounding it up.

## Rules

- **Follow `graph_next`.** Both `graph_run` and `graph_submit` refuse a node whose
  dependencies are unmet, are already finished, or do not exist yet. Do not try to
  outrun the graph.
- **Self nodes are still adjudicated.** The broker cross-checks a fresh agent's claims
  against the worktree exactly as it checks a vendor's. Relaying a payload is not a way
  past that, and neither is doing the node yourself.

## What the current AI does

Opens the run, follows `graph_next`, dispatches each node, retries rejected subgoals
within budget, and reports from the verdicts.

## What you do

Nothing during a `graph_run` — it blocks. The full history is in
`.harness-run/broker/` if you want it.

## Related skills

- `harness` — the six-stage contract this flow implements
- `install` — connect or verify the graph-engineering MCP before running this flow
