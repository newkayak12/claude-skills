---
name: orchestrate
description: >-
  Use when running a whole request through the graph-beta-engineering MCP and driving
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
    - graph-beta-engineering
related:
  - harness
  - install
---

# orchestrate — drive the graph-owned harness flow

Throw the request at the graph engine, then run the loop it hands back. The engine owns the
graph, the spec, the prompts, and the verdicts. You own only the loop. You do not decide
whether this is code work or writing work: `plan` does, from the request, and the graph
expands accordingly. A user who wants to decide that themselves has `graph-beta:develop` and
`graph-beta:document`; this skill is for everyone who does not.

## Standing Mandates

- NEVER call `graph_status({full: true})` on a run. One node at a time: `detail_path`, or `graph_status({full: true, node_id})`.
- ALWAYS read `state`. A judging node can return `stage_ok: true` and still be `failed` — that is the gate working, not an error to route around.
- A blocked run is a result — report what failed and stop there. NEVER do a node's work yourself to force completion, NEVER reopen a run to get past a gate that rejected the work, and NEVER end the report by offering the user a way around it: no raised retry budget, no relaxed acceptance criteria, no override outside the harness. `reset_capacity` is for spent quota, not a retry-budget reset.
- `isolated: true` only when you created or were handed a private worktree holding this run alone. A user asking to keep work off main is a request, not evidence — with no worktree, pass `isolated: false` and say in the report that attribution comes back `null` because of it.
- A `self` node's payload is the fresh agent's returned JSON, relayed verbatim. NEVER author or soften it.
- NEVER pull the goal-spec, handoffs, gap text or evidence into this context — every tool already returns the one-line verdict you report from. This is the rule the design exists for.
- The `report` node writes the run's account, not you. Relay it; NEVER rewrite it, and never substitute your own narration for a report node that ran.
- No Fable/Astra without an explicit user model request. No token, spending, or turn caps beyond the gate retry budget and process timeouts that already exist.

## Entry

```
graph_open({
  request, cwd, isolated,
  flow: "auto",                                   # plan returns flow + size; the spec follows
  vendor: "auto", allocation: "balanced",
  host_vendor, host_model, native_models
})                                               -> run_id, flow: "auto", first ready node
```

After `plan`, `graph_next` reports `flow` (`develop` or `document`) and `size` (`S` or `L`).
Mirror both into the first progress line. `size: L` is recorded, not yet acted on — the run
proceeds as one graph until the TaskManager lands; say so in the report when you see it.

Then run **`references/loop.md`** — the same loop every entry uses. Read it before the first
`graph_next`; it holds the dispatch rules, the retry rules, the progress mirror, and the
verdict vocabulary.

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
<failed, skipped or unreachable nodes, and why — including any that fell back to self. No workaround suggestions.>

### Report
<the report node's handoff, relayed verbatim. Omit this section only when no report node ran.>
```

The table and `### Not done` are yours — run bookkeeping, written from verdicts. `### Report`
is the report node's own text, passed through untouched. A run whose retry budget ran out is
not blocked: the report node runs over the `unreachable` set and its text is `### Report`. When
the run does end blocked, no report node ran: say what failed and stop, and do not write the
missing section yourself.

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

The broker prefers the driving host for plan/setgoal/critique/review/gate and the other
vendor for implement/test/draft/report. `graph_next` returns the executor, model, and
routing reason; the assignment persists until completion or interruption.

Everything past the entry lives in `references/`:

| need | read |
|---|---|
| the loop itself: dispatch, retries, progress mirror, verdicts, rules | `references/loop.md` |
| legacy `ordered` mode, per-stage `policy`, `native_models`, provenance | `references/routing.md` |
| working directory, snapshot identity, briefing scope | `references/handoffs.md` |
| quota reporting, checkpoints, `reset_capacity` | `references/capacity.md` |

A usage limit is `failure_kind:"quota"`, never an ordinary failure — submit it that way, and
call `graph_next` for the alternate route.

## What the current AI does

Runs the loop and reports from the verdicts. Tools missing or `graph_open` failing is a
stop, not a licence: run `graph-beta:install`, never the work itself.

## What you do

Nothing during a `graph_run` — it blocks. The full history is in
`.harness-run/broker-beta/` if you want it.

## Related skills

- `develop` — the same loop with the flow pinned to code work
- `document` — the same loop with the flow pinned to written artifacts
- `harness` — the six-stage contract this flow implements
- `install` — connect or verify the graph-beta-engineering MCP before running this flow
