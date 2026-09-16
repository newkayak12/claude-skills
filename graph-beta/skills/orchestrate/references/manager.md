# Inside a task — the manager loop

You arrive here from an entry skill when `tm_submit` on `size` came back **without**
`delegate`: the request is L, and the task will have packages. Everything a package does
happens in its own child graph run, in its own worktree, driven with the ordinary loop in
`loop.md` — by that child's own session, not by you. This file is only what sits around those runs.

## The loop

```
tm_next({task_id})                                -> ready[] (manager nodes) + children[] (running children + drivers)
for each ready manager node:                      # shape, critique, accept:Pn, integrate, gate:goal, report
    fresh agent at briefing_path -> tm_submit({task_id, node_id, payload})   # relay its JSON verbatim
for each child in children[]:
    child_state != "running"   -> tm_submit({task_id, node_id: child.node_id})   # NO payload: the manager reads the child
    driver.alive == true       -> wait; poll tm_next again. Its own session is driving it; you do not
    driver.alive == false      -> the driver died mid-run: tm_submit folds it blocked, then tm_retry({task_id, package_id})
    no driver at all           -> child_driver "inline" was chosen: drive it yourself with loop.md,
                                  cwd=child.cwd and run_id=child.run_id in every graph_* call
if nothing is ready and a driver is alive: poll tm_next until one of them stops.
if state == "blocked":
    a failed dispatch or accept -> tm_retry({task_id, package_id})    # same worktree, fresh child, gaps carried
    conflicting_packages named  -> tm_retry({task_id, repackage: [...]})   # integrate or dispatch found a merge conflict: reshape those together
    integrate verified=false    -> tm_retry({task_id, package_id}) for the package its checks blame;
                                   the manager reopens integrate:N over the new accept by itself.
                                   package_id must be one the shape named — "integrate" is a node, not a package
    a failed shape or critique  -> tm_retry({task_id})                # reshape; the package graph is discarded
    retried == false            -> budget gone: downstream is `unreachable`, `report` is in ready[]
tm_status({task_id})                              -> final counts; tm_status({}) lists every task
```

`tm_next` is where dispatch happens: a ready `dispatch:Pn` has already created its worktree,
opened its child run, and spawned a headless session inside that worktree to drive the child to
the end. You never open a child, never drive one, and never pass a payload for a dispatch node —
the recursion belongs to the process tree, because a session that relays every child node's
briefing and result through its own context burns it out and dies at the usage limit long before
the packages are done. A fold attempted while the child is `running` and its driver alive is
refused and costs nothing.

## Children

Each child is a full graph run: `plan → setgoal → critique → …`, isolated in its worktree at
`child.cwd`, driven by its own session following `loop.md` there. Yours is to wait: poll
`tm_next` and read `driver: {pid, alive, log}` — the log is that session's stream if you need to
see what it is doing. Children with no dependency between them run at the same time; they cannot
collide, each has its own tree. A child's own `graph_retry` budget is the child's; when it ends
`blocked`, fold it — the manager records the failure with the child's goal-gate gaps and
`tm_retry({package_id})` opens the next attempt in the same worktree.

A driver that exits with the run still `running` (a crash, a usage limit) is not a verdict about
the package: `tm_submit` folds that attempt as blocked with the driver's stderr as the reason, and
`tm_retry({package_id})` gives the package a fresh session where the dead one stopped.

Only a task opened with `child_driver: "inline"` hands you the child nodes — choose it when you
must watch a package node by node, and expect the context cost.

## Branches, merges, conflicts

The manager does the git work; no node claims it. Folding an accepted child commits its
worktree on the package branch. A package with `deps` gets a worktree branched from its first
dependency's branch with the others merged in, so it builds on what they delivered. When
`integrate` becomes ready, `tm_next` merges every package branch into the integration worktree
in dependency order and records each merge commit; only then does a fresh agent get the
`integrate` briefing, to run the goal-level checks on the combined tree and read the seams.

A conflict at either point is observed, not reported: the node fails with `conflicts` (the
files) and `conflicting_packages` (the one being merged, then the merged owners by declared
`touches`). That is a shape failure, not a package's — pass `conflicting_packages` to
`tm_retry({repackage})`. Shape is told to make them one package or order them by dependency;
worktrees of ids it keeps are reused with their delivered commits.

## Progress mirror

Task rows above child rows. `P1 · dispatch → <run_id>` opens when the child does; its child's
node rows sit under it while it runs; the row closes on the fold with the accept verdict.

## Output

Use the entry skill's template. The table lists manager nodes — one `dispatch`/`accept` pair per
package, `integrate`, `gate:goal` — with each dispatch row carrying the child `run_id` and branch.
`### Report` is the manager's report node, relayed verbatim; child reports are already folded into it.
