---
name: orchestrate
description: >-
  Use when running a whole request through the graph-engineering MCP and driving
  its harness nodes without holding the payload yourself. Not for installation.
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

## The loop

```
graph_open({request, cwd, vendor, isolated})     -> run_id + first ready node
while state == "running":
    graph_next({run_id})                          -> ready[] with routing
    for each ready node:
        vendor node  -> graph_run({run_id, node_id})
        self node    -> read briefing_path, do the work, graph_submit({run_id, node_id, payload})
    if state == "blocked":
        a failed subgoal    -> graph_retry({run_id, subgoal_id})
        a failed critique   -> graph_retry({run_id})          # redo the spec
        nothing retryable   -> report and stop
graph_status({run_id})                            -> final counts
```

That is the whole protocol. Six tools, one loop.

**A node can fail with `stage_ok: true`.** On judging nodes that field means "the judging
itself worked"; the verdict is `accept` (gate), `verified` (test), or `sound` (critique).
A node whose verdict is negative is `failed` and holds back everything downstream — that
is the gate doing its job, not an error to route around. Read `state`, not `stage_ok`.

**`graph_retry` without a `subgoal_id` retries the spec.** When critique rejects the
goal-spec, redoing one subgoal fixes nothing: the whole decomposition is in question. That
call reopens `setgoal` and `critique` with the critique's problems as feedback and retires
the subgoal graph the rejected spec produced.

## Do not pull the payload into your context

This is the rule the design exists for. The goal-spec, subgoal acceptance, upstream
handoffs, prior rejection feedback, changed-file lists and evidence all live in the
graph. Every tool returns a one-line verdict instead: `node_id`, `stage`, `vendor`,
`state`, `stage_ok`, and a short `reason` when it failed.

If you accumulate payloads, the loop dies before the work does — a graph with retries
outgrows your context and you can no longer decide the next step. When you genuinely
need a detail, read `detail_path` for that one node, or call
`graph_status({full: true, node_id})` for that one node. Never `full: true` for a run.

You do not write node prompts. `graph_run` composes them from graph state; passing one
is not possible on purpose.

## Routing

`graph_open` takes `vendor`:

| value | behavior |
|---|---|
| `"auto"` (default) | **stays on `self`** — the candidate list is empty unless you pass `candidates` |
| `"auto"` + `candidates: [...]` | try those vendors in order, fall back to `self` |
| a vendor name | require it — a node returns `vendor-failure` rather than degrading |
| `"self"` | you execute every node |

**Registering a vendor does not enrol it in `auto`.** An installed, ready Codex still goes
unused until you name it (`vendor: "codex"`) or list it in `candidates`. The default is
deliberately quiet: a run should not start delegating to whatever happens to be installed.

Name the vendor when the run must prove who did the work. Silent degradation is what
lets a graph claim an external vendor implemented something it never touched.

### Per-stage routing

`vendor` and `model` above apply to the whole run. `policy` overrides them per stage —
this is how the harness contract (reasoning on a strong model, execution on whatever can
actually write here) gets expressed:

```js
graph_open({
  request, cwd,
  vendor: "self", model: "opus",          // the run-level default
  policy: {
    implement: { vendor: "codex", model: "gpt-5.6-sol" },
    test:      { vendor: "codex" },
    report:    { model: "sonnet" },
    "gate:goal": { model: "opus" }         // may differ from the per-subgoal gates
  }
})
```

Keys are stage names — `plan`, `setgoal`, `critique`, `implement`, `test`, `gate`,
`report` — plus the optional `gate:goal`. Each entry may set `vendor`, `candidates`,
`sandbox`, `model`. A stage entry wins over the run-level setting; a stage with no entry
inherits it. `graph_next` reports the chosen `model` per ready node.

You cannot switch your own model for a `self` node. When `graph_next` names a model you
are not running as, say so in the report rather than executing the node silently on the
wrong tier.

Readiness is a real write probe, not a version check: a sandbox can start, accept the
run, write nothing, and still exit 0.

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
- **`isolated: true` only when true** — a private worktree with only this run in it.
  Assert it falsely and positive attribution becomes meaningless.
- **A blocked run is a result.** When `state` is `blocked` and retries are exhausted,
  report what failed and stop. Do not start doing the nodes yourself to force a finish,
  and do not re-open the run to dodge a gate that rejected the work.
- **Self nodes are still adjudicated.** Read the briefing, do the work, submit honestly;
  the broker cross-checks your claims the same way it checks a vendor's.

## Output template

```
## <request>

run: <run_id>   state: <complete|blocked>   nodes: <done>/<total>

| node | vendor | stage_ok | note |
|---|---|---|---|
| implement:U1:1 | codex | true | isolated |
| test:U1:1 | codex | true | verified |
| gate:U1:1 | codex | true | 95% |

### Not done
<failed or skipped nodes, and why — including any that fell back to self>
```

## What Claude does

Opens the run, follows `graph_next`, dispatches each node, retries rejected subgoals
within budget, and reports from the verdicts.

## What you do

Nothing during a `graph_run` — it blocks. The full history is in
`.harness-run/broker/` if you want it.

## Related skills

- `harness` — the six-stage contract this flow implements
- `install` — connect or verify the graph-engineering MCP before running this flow
