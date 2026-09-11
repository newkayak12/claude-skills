# Inside a task — the manager loop

You arrive here from an entry skill when `tm_submit` on `size` came back **without**
`delegate`: the request is L, and the task will have packages. Everything a package does
happens in its own child graph run, in its own worktree, driven with the ordinary loop in
`loop.md`. This file is only what sits around those runs.

## The loop

```
tm_next({task_id})                                -> ready[] (manager nodes) + children[] (running child runs)
for each ready manager node:                      # shape, critique, accept:Pn, integrate, gate:goal, report
    fresh agent at briefing_path -> tm_submit({task_id, node_id, payload})   # relay its JSON verbatim
for each child in children[]:
    child_state == "running"   -> drive it with loop.md at cwd=child.cwd, run_id=child.run_id
    child_state != "running"   -> tm_submit({task_id, node_id: child.node_id})   # NO payload: the manager reads the child
if state == "blocked":
    a failed dispatch or accept -> tm_retry({task_id, package_id})    # same worktree, fresh child, gaps carried
    a failed shape or critique  -> tm_retry({task_id})                # reshape; the package graph is discarded
    retried == false            -> budget gone: downstream is `unreachable`, `report` is in ready[]
tm_status({task_id})                              -> final counts; tm_status({}) lists every task
```

`tm_next` is where dispatch happens: a ready `dispatch:Pn` has already created its worktree and
opened its child by the time the call returns. You never open a child. You never pass a payload
for a dispatch node. A fold attempted while the child is still `running` is refused and costs
nothing — finish the child first.

## Children

Each child is a full graph run: `plan → setgoal → critique → …`, isolated in its worktree at
`child.cwd`. Drive it exactly as `loop.md` says, with that `cwd` in every `graph_*` call — it is
what lets the broker find the run. Children with no dependency between them may run at the same
time; they cannot collide, each has its own tree. A child's own `graph_retry` budget is the
child's; when it ends `blocked`, fold it — the manager records the failure with the child's
goal-gate gaps and `tm_retry({package_id})` opens the next attempt.

## Integrate

`integrate` is the one manager node that changes files, and only inside the integration
worktree its briefing names. The fresh agent merges each package branch there in dependency
order and runs the goal-level checks together. It does not fix package work: a failing package
is a gap for `gate:goal`.

## Progress mirror

Task rows above child rows. `P1 · dispatch → <run_id>` opens when the child does; its child's
node rows sit under it while it runs; the row closes on the fold with the accept verdict.

## Output

Use the entry skill's template. The table lists manager nodes — one `dispatch`/`accept` pair per
package, `integrate`, `gate:goal` — with each dispatch row carrying the child `run_id` and branch.
`### Report` is the manager's report node, relayed verbatim; child reports are already folded into it.
