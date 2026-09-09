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
- A blocked run is a result — report what failed and stop there. NEVER do a node's work yourself to force completion, NEVER reopen a run to get past a gate that rejected the work, and NEVER end the report by offering the user a way around it: no raised retry budget, no relaxed acceptance criteria, no override outside the harness. `reset_capacity` is for spent quota, not a retry-budget reset.
- `isolated: true` only when you created or were handed a private worktree holding this run alone. A user asking to keep work off main is a request, not evidence — with no worktree, pass `isolated: false` and say in the report that attribution comes back `null` because of it.
- A `self` node's payload is the fresh agent's returned JSON, relayed verbatim. NEVER author or soften it.
- NEVER pull the goal-spec, handoffs, gap text or evidence into this context — every tool already returns the one-line verdict you report from. This is the rule the design exists for.
- The `report` node writes the run's account, not you. Relay it; NEVER rewrite it, and never substitute your own narration for a report node that ran.
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
graph_status({cwd})                               -> every run here: state, counts, what is running now and for how long
```

Six tools, one loop. `cwd` is optional after `graph_open` but carry it anyway — it is what
lets a restarted client find the run again. Lost the `run_id` entirely — a new session, a
compaction — call `graph_status({cwd})` and read it back off the run list.

## Show the graph while it runs

A run is long and mostly silent, and the user cannot see inside it. Mirror the graph into
whatever live progress surface the host has — a task list is the usual one:

- Each `graph_next` — open a task per newly ready node, subject `<node_id> · <vendor>/<model>`.
- On dispatch — that task to `in_progress`.
- On the verdict — `completed`, with the short `reason` appended when it failed.

The graph already carries the dependencies, so the surface ends up shaped like the run: nodes
waiting, one moving, the rest done. On a host with no such surface, print the same three
columns as plain lines instead:

```
✅ implement:U1:1  codex/gpt-5.6-sol   files verified
❌ gate:U1:1       self/opus           rejected, 40% — retrying U1
⏳ test:U2:1       codex/gpt-5.6-sol   running
```

Either way the vocabulary is the same and it is small: `node_id`, `vendor`/`model`, `state`,
and the short `reason`. Never open a payload to enrich a line — no gap text, no evidence, no
`detail_path` read. **A line you cannot write from the verdict is a line you do not write.**

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

Fan out every self node in `ready[]` in one message; concurrent `implement` nodes — self or
vendor — only when each has its own worktree, otherwise implement one at a time and fan out
test/gate/critique. The broker does not serialize them for you: `graph_next` offers every
dependency-satisfied node, so two implements against one worktree is your mistake to avoid.

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
<failed or skipped nodes, and why — including any that fell back to self. No workaround suggestions.>

### Report
<the report node's handoff, relayed verbatim. Omit this section only when no report node ran.>
```

The table and `### Not done` are yours — run bookkeeping, written from verdicts. `### Report`
is the report node's own text, passed through untouched. When the run ends blocked, no report
node ran: say what failed and stop, and do not write the missing section yourself.

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

The broker prefers the driving host for Plan/SetGoal/Critique/Gate and the other vendor for
Implement/Test/Report. `graph_next` returns the executor, model, and routing reason; the
assignment persists until completion or interruption.

Anything past the balanced default lives in `references/`:

| need | read |
|---|---|
| legacy `ordered` mode, per-stage `policy`, `native_models`, provenance | `references/routing.md` |
| working directory, snapshot identity, briefing scope | `references/handoffs.md` |
| quota reporting, checkpoints, `reset_capacity` | `references/capacity.md` |

A usage limit is `failure_kind:"quota"`, never an ordinary failure — submit it that way, and
call `graph_next` for the alternate route.

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
  against the worktree exactly as it checks a vendor's.
- **No reasoning MCP in this context.** `CLAUDE.md` asks for them proactively; here the
  reasoning belongs to the nodes, and a scratchpad over a payload you must relay verbatim
  is the failure this skill exists to prevent.

## What the current AI does

Runs the loop and reports from the verdicts. Tools missing or `graph_open` failing is a
stop, not a licence: run `graph:install`, never the work itself.

## What you do

Nothing during a `graph_run` — it blocks. The full history is in
`.harness-run/broker/` if you want it.

## Related skills

- `harness` — the six-stage contract this flow implements
- `install` — connect or verify the graph-engineering MCP before running this flow
