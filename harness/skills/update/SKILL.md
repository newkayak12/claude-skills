---
name: update
description: >-
  Use when the harness plugin was updated and this project's installed copies should catch
  up. Triggers on: "하네스 업데이트", "하네스 최신으로", "harness update", "refresh harness copies".
scenarios:
  - "하네스 플러그인 올렸는데 이 프로젝트 복사본도 최신으로 맞춰줘"
  - "하네스 업데이트해줘"
  - "Update the harness copies in this project after the plugin bump"
  - "Refresh the installed harness hook and engine"
compatibility:
  optional: []
related:
  - install
  - remove
---

# update — refresh installed harness copies after a plugin bump

Thin wrapper: all file work is `install.mjs` with `"refresh": true`. No new script.

## Process

1. **Detect the install mode from disk.** `.claude/harness/` present → embedded; absent →
   plugin mode (only `.claude/hooks/goal-gate.mjs` drifts).
2. **Plugin mode:** run
   ```
   node "<plugin>/skills/install/install.mjs" '{ "projectDir": "<abs project root>", "refresh": true }'
   ```
3. **Embedded mode:** rebuild the embed config from what is embedded. Each directory under
   `.claude/harness/skills/*` is a skill name; resolve its source dir in the installed plugin
   cache the same way `install` does, then run
   ```
   node "<plugin>/skills/install/install.mjs" '{
     "projectDir": "<abs project root>", "refresh": true,
     "embed": { "runtime": true, "skills": [ { "name": "<name>", "src": "<abs source dir>" } ] } }'
   ```
   If a source cannot be resolved, **stop and name it** — never guess a path.
4. **Report** from the JSON: each plugin-owned file `refreshed` or `unchanged`. `git diff` the
   plugin-owned copies for the user to review and commit. User-owned files
   (`harness-gate.json`, `conventions/**`, the CLAUDE.md block, `settings.json`) are never
   touched.

## Output Template

```
Mode: plugin | embedded
Refreshed: <files>
Unchanged: <files>
Unresolved sources: <none | names>
Next: review git diff, commit
```

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Detects the mode, rebuilds the embed config, runs `install.mjs` with `"refresh": true`, reports | Bumps the plugin first; reviews and commits the diff |
| Stops and names any embed source it cannot resolve | Supplies the missing source path |

## Related
- `install` — first-time scaffolding (`install.mjs`)
- `remove` — uninstalling project-local harness governance
