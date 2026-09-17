<!-- teams:begin v1 -->
## teams (team)

This project runs substantial work through the teams task manager.

- **Open before you write.** Paths in `.claude/teams-dispatch.json` are denied to the driving
  session until a task is open: call `tm_open({request, cwd})` and let a node do the writing.
- **Defaults live in `.claude/team.json`**; a `tm_open` argument overrides a key for one task.
- **Conventions are law:** `.claude/conventions/**` feeds plan, setgoal and implement.
- **Watch, do not drive:** `tm_status({task_id})` (and, from 0.11, `/teams:board`).
- Trivial edits (typos, single-line fixes, docs) do not need a task.
<!-- teams:end -->
