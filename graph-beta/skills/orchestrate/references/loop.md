# The loop — shared by `orchestrate`, `develop`, and `document`

The entry skill has already called `graph_open` and has a `run_id`. Everything from here is
the same for every flow: the graph decides what is ready, you dispatch it, the broker judges
it. Nothing about the flow — code or document — changes a line below; only the node names
you see differ (`implement/test` vs `draft/review`).

Two ways in: the entry skill delegated an S request here with `graph_open`, or you were started
on a child run that is already open (`cwd` = the package worktree, `run_id` handed to you). Same
loop either way; for a child, every call carries that `cwd`. When a child run reaches `complete`
or `blocked` you are finished — end with the output template. A driver session owns nothing else:
the manager reads the run file and folds it. Only in an inline task do you go back to
`manager.md` and fold it yourself with `tm_submit`.

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
        a failed subgoal    -> already reassigned: the engine opened the next attempt when the
                               gate rejected (`reassigned` on the submit verdict) and graph_next is
                               running again. Call graph_retry({subgoal_id}) only for a run opened
                               with auto_reassign:false - on a normal run it spends a second attempt
        a failed critique   -> graph_retry({run_id})          # redo the spec
        retried == false    -> budget gone: the broker settled it, downstream is `unreachable`,
                               and `report` is in ready[] — run it like any node
        still blocked       -> no report node exists (setgoal never produced a spec): report and stop
        vendor-failure      -> a ready node no vendor can take (every attempt lists its reason): a routing
                               dead end, not a failed node. Report the attempts and stop. NEVER open a
                               second run for the same request — it orphans this one and redoes the spec.
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

**The goal gate is one or more judges, not one node.** `graph_open({goal_judges})` (default 2)
opens a round of sibling gates over the same assembled result — `gate:goal:1` and, past the
primary, a lettered sibling like `gate:goal:1b` — routed to different identities where the run
can manage it. Dispatch and submit every sibling in `ready[]` exactly like any other node; the
run's verdict is their consensus, not any one judge's, and it accepts only when every judge
accepted at or above `goal_threshold`. Read it off `graph_status`'s `goal_verdict` — `{accept,
match_pct: <the minimum across judges>, judges: [...], gaps, spec_drift}` — rather than one
sibling's own verdict, which is only its own opinion.

**A rejected round opens `repair:N`, not a dead end.** When consensus rejects, the engine opens
a run-level `repair` node — implement-shaped, mutating, fixing across the tree at the seams the
judges' gaps point to, briefed with the union of every judge's gaps and every subgoal's handoff.
Dispatch and submit it exactly like an `implement` node; a fresh goal-gate round follows it
automatically. Two repair rounds that close the same gaps twice stall the run on purpose — it
proceeds to `report` on partial work rather than paying for a third identical attempt. On a run
opened with `auto_reassign:false`, or to force a repair the stall held back, call
`graph_retry({repair:true})` yourself.

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

The briefing at `briefing_path` folds in more than the subgoal: `plan` and `setgoal` get a
`## Conventions` list of anything under `.claude/conventions/**` plus an instruction to use it
(list rules in `plan`; fold applicable ones into subgoal `acceptance`/`test[]` in `setgoal`);
`implement` and `draft` get the full text of whichever convention files match their target
paths. And every upstream `handoff` folded into a later prompt is capped at 1500 characters
with a `truncated at 1500 of N chars` marker — a node that grows with the run reads more than
it can weigh. Checks and changed-file lists are never capped; they are the evidence a judge
needs whole.

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
