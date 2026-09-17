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
plus the bilingual README.md / KOR.md Status logs synchronized. This skill is for a source
checkout of this marketplace, not for refreshing files installed into an application project.

## Process

1. Inspect the harness diff and derive a concise, single-line release summary **in both English
   and Korean**. If the intended release is breaking or feature-sized, stop and use the
   appropriate major/minor version instead; this skill only increments `x.y.Z`.
2. Run a dry-run first:
   ```sh
   node "<plugin>/skills/patch/patch.mjs" '{
     "repoRoot": "<abs claude-skills checkout>",
     "summary": "<concise status entry>",
     "summary_ko": "<간결한 한국어 status 한 줄>",
     "dryRun": true
   }'
   ```
3. Confirm the reported previous and next versions, then run the same command with
   `"dryRun": false`. The script refuses to write if plugin and marketplace versions differ,
   the README `## Status` or KOR.md `## 상태` heading is missing, or either `summary` /
   `summary_ko` is empty, multiline, or omitted — a release note that lands in only one language
   is exactly the silent divergence this script exists to prevent.
4. Run `python3 scripts/validate_plugins.py`, inspect `git diff`, and report the new version and
   both status entries. Do not claim the release is published; this only prepares source metadata.

`patch.mjs` updates:

- `harness/.claude-plugin/plugin.json`
- the `harness` entry in `.claude-plugin/marketplace.json`
- the first entry under `harness/README.md` → `## Status`
- the first entry under `harness/KOR.md` → `## 상태`

Note: `harness/KOR.md`'s `## 상태` section only started tracking entries once this bilingual
requirement was added — it does not carry the ~30 pre-existing English-only Status entries, and
that history is not being backfilled. See the note at the top of that section.

## Related

- `install` — install or refresh project-owned harness copies
- `remove` — uninstall project-local harness governance
- `patch.mjs` — deterministic semver and status synchronization
