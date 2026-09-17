<!-- graph-beta:begin v1 -->
## graph-beta (team)

This project runs substantial work through the graph-beta task manager.

- **Open before you write.** Paths in `.claude/graph-beta-dispatch.json` are denied to the driving
  session until a task is open: call `tm_open({request, cwd})` and let a node do the writing.
- **Defaults live in `.claude/team.json`**; a `tm_open` argument overrides a key for one task.
- **Conventions are law:** `.claude/conventions/**` feeds plan, setgoal and implement.
- **Watch, do not drive:** `tm_status({task_id})` (and, from 0.11, `/graph-beta:board`).
- Trivial edits (typos, single-line fixes, docs) do not need a task.
<!-- graph-beta:end -->
