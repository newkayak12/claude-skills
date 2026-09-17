---
name: remove
description: >-
  Use when removing graph-beta from a project: team.json, the dispatch gate, the CLAUDE.md
  block and gitignore lines. Keeps conventions, run and task history unless asked by name.
  Refuses to purge a task whose driver is alive.
scenarios:
  - "graph-beta 이 프로젝트에서 제거해줘"
  - "team.json이랑 dispatch 게이트 지워줘"
  - "Remove graph-beta from this project"
  - "Uninstall graph-beta's team.json and dispatch gate"
compatibility:
  optional: []
related:
  - install
  - patch
  - harness:remove
---

# remove — uninstall project-local graph-beta governance

Remove the files and registrations created by `install`, without disturbing unrelated Claude
settings, project instructions, or harness's own files. The deterministic work lives in
`remove.mjs`.

## Process

1. List what will be removed unconditionally: `.claude/team.json`,
   `.claude/graph-beta-dispatch.json`, the fenced `<!-- graph-beta:begin -->` block in
   `CLAUDE.md`, and the graph-beta lines in `.gitignore`. `.claude/.harness-markers/` is removed
   too, unless `.claude/harness-gate.json` is present, in which case harness also owns that
   directory and it is kept.
2. Conventions, `.harness-run/` (run history), and this project's tasks under
   `~/.harness/tasks/` are kept by default. Ask for explicit confirmation, one at a time,
   before passing `purgeConventions`, `purgeRuns`, or `purgeTasks` as `true` — conventions may
   hold project edits, and run/task history may still be wanted for review.
3. Run:
   ```sh
   node "<plugin>/skills/remove/remove.mjs" '{
     "projectDir": "<abs project root>",
     "purgeConventions": false,
     "purgeRuns": false,
     "purgeTasks": false
   }'
   ```
4. Read the JSON report and pass it through as-is: `marker-error` means `CLAUDE.md` had
   unmatched `graph-beta:begin`/`end` markers and was left untouched; `kept-harness` means the
   marker directory was left for harness; `refused-alive` (only under `tasks`, with
   `purgeTasks: true`) means a task rooted at this project still has a live driver process and
   was skipped — tell the user which task id and that its driver must stop first.
5. Verify the listed paths are gone and that unrelated settings, `CLAUDE.md` content, and
   harness's own files remain untouched.

The operation is idempotent: a second run reports `absent` for everything already removed.

## Related

- `install` — scaffold the files this skill removes
- `patch` — prepare a graph-beta plugin source release
- `harness:remove` — the harness's own uninstaller (shares the marker directory)
