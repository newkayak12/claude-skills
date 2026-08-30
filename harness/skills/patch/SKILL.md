---
name: patch
description: >-
  Use when preparing a patch release of the harness plugin source. Triggers on:
  "harness patch", "하네스 패치", "하네스 버전업", "bump harness patch version". Not for
  refreshing project copies.
scenarios:
  - "harness patch로 버전 올려줘"
  - "하네스 패치 릴리스 준비해줘"
  - "Bump the harness patch version and add the status note"
compatibility:
  optional: []
related:
  - install
  - remove
---

# patch — prepare a synchronized harness patch release

Increment the patch component of the harness plugin version and keep the two release manifests
plus the README Status log synchronized. This skill is for a source checkout of this marketplace,
not for refreshing files installed into an application project.

## Process

1. Inspect the harness diff and derive a concise, single-line release summary. If the intended
   release is breaking or feature-sized, stop and use the appropriate major/minor version instead;
   this skill only increments `x.y.Z`.
2. Run a dry-run first:
   ```sh
   node "<plugin>/skills/patch/patch.mjs" '{
     "repoRoot": "<abs claude-skills checkout>",
     "summary": "<concise status entry>",
     "dryRun": true
   }'
   ```
3. Confirm the reported previous and next versions, then run the same command with
   `"dryRun": false`. The script refuses to write if plugin and marketplace versions differ,
   the README Status heading is missing, or the summary is empty/multiline.
4. Run `python3 scripts/validate_plugins.py`, inspect `git diff`, and report the new version and
   status entry. Do not claim the release is published; this only prepares source metadata.

`patch.mjs` updates:

- `harness/.claude-plugin/plugin.json`
- the `harness` entry in `.claude-plugin/marketplace.json`
- the first entry under `harness/README.md` → `## Status`

## Related

- `install` — install or refresh project-owned harness copies
- `remove` — uninstall project-local harness governance
- `patch.mjs` — deterministic semver and status synchronization
