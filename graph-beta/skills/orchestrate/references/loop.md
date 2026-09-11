# The loop — shared by `orchestrate`, `develop`, and `document`

The entry skill has already called `graph_open` and has a `run_id`. Everything from here is
the same for every flow: the graph decides what is ready, you dispatch it, the broker judges
it. Nothing about the flow — code or document — changes a line below; only the node names
you see differ (`implement/test` vs `draft/review`).

## The loop

```
# graph_open already happened in the entry skill -> run_id + first ready node
while state == "running":
    graph_next({run_id, cwd})                     -> ready[] with routing
    for each ready node:                          # all self nodes first, in one message; then vendor nodes
        self node    -> fresh agent at the returned model, briefing_path only; relay its JSON to graph_submit({run_id, node_id, payload})
        vendor node  -> graph_run({run_id, node_id})   # blocks; the self agents keep working meanwhile
        quota interruption -> graph_next selects the remaining available vendor
    if state == "blocked":
        a failed subgoal    -> graph_retry({run_id, subgoal_id})
        a failed critique   -> graph_retry({run_id})          # redo the spec
        retried == false    -> budget gone: the broker settled it, downstream is `unreachable`,
                               and `report` is in ready[] — run it like any node
        still blocked       -> no report node exists (setgoal never produced a spec): report and stop
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
`accept` (gate), `verified` (test and review), or `sound` (critique); a negative one makes the node
`failed` and holds back everything downstream. `failed` is not final: it is a retry waiting to
happen. When `graph_retry` declines because the budget is gone, the failure is settled — every
node that needed it becomes `unreachable`, and `report` (order-only on the goal gate) is ready.

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

Fan out every self node in `ready[]` in one message; concurrent `implement`/`draft` nodes —
self or vendor — only when each has its own worktree, otherwise one at a time and fan out
test/review/gate/critique. The broker does not serialize them for you: `graph_next` offers
every dependency-satisfied node, so two writers against one worktree is your mistake to avoid.

A `review` node reads a document its `draft` wrote, and must not be the same agent. For self
nodes that is already the rule (a fresh agent per node); for vendor nodes the broker refuses
a review routed to the identity — vendor + model — that drafted, and leaves the node pending.
Route `review` to another vendor or model in `policy` and call `graph_run` again.

As each agent finishes, pass its final message to `graph_submit` unchanged. If it is not
parseable JSON, submit `{stage_ok: false, reason: "executor returned no verdict"}` — do
not do the work in this context. If the host cannot launch at the returned model, say so
in the report instead of substituting a tier silently.

## Verdicts

| field | meaning |
|---|---|
| `stage_ok` | adjudicated. Never report a value above what the broker returned. |
| `verified` | test nodes: the checks ran and passed. review nodes: every acceptance item has a passage |
| `reviewer_independence` | review nodes: `distinct-identity` when the broker saw author ≠ reviewer; `unverifiable-self` when it could not |
| `accept`, `match_pct`, `gap_count` | gate nodes |
| `changed_files_verified` | `true`/`false` under `isolated`; `null` in a shared worktree unless contradicted; `null` for a document draft that claimed no files |
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
