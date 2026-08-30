---
name: remove
description: >-
  Use when removing harness governance from a project. Triggers on: "harness
  remove", "하네스 삭제", "하네스 제거", "uninstall harness". Preserves project
  conventions by default.
scenarios:
  - "harness remove로 이 프로젝트에서 하네스 지워줘"
  - "이 프로젝트의 하네스 훅과 게이트를 제거해줘"
  - "Uninstall the harness from this project"
compatibility:
  optional: []
related:
  - install
  - patch
---

# remove — uninstall project-local harness governance

Remove the files and registrations created by `harness:install` without disturbing unrelated
Claude settings or project instructions. The deterministic work lives in `remove.mjs`.

## Process

1. Inspect the target project for the known install artifacts:
   `.claude/hooks/goal-gate.mjs`, its `settings.json` registration,
   `.claude/harness-gate.json`, `.claude/harness/`, `.claude/.harness-markers/`, the fenced
   Harness block in `CLAUDE.md`, and the `.gitignore` marker line.
2. Treat the user's explicit remove/uninstall request as authorization to remove those exact
   artifacts. Before using `purgeConventions`, say that `.claude/conventions/` is project-owned
   and may contain edits, and get explicit confirmation.
3. Run:
   ```sh
   node "<plugin>/skills/remove/remove.mjs" '{
     "projectDir": "<abs project root>",
     "purgeConventions": false
   }'
   ```
4. Read the JSON report. A malformed `settings.json` or unmatched CLAUDE markers are preserved
   and reported for manual cleanup. Never delete them wholesale to force completion.
5. Verify that the hook registration and known paths are gone and that unrelated settings and
   CLAUDE.md content remain. Report preserved conventions explicitly.

The operation is idempotent: a second run reports `absent` rather than failing. The embedded
`.claude/harness/` namespace is install-owned and is removed as a unit; conventions are kept
unless `purgeConventions` is explicitly true.

## Related

- `install` — scaffold the project-local governance files
- `patch` — bump the harness plugin's source release version
- `remove.mjs` — deterministic removal and settings/marker cleanup
