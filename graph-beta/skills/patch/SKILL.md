---
name: patch
description: >-
  Use when preparing a patch release of the graph-beta plugin source: bumps x.y.Z in
  plugin.json and marketplace.json and prepends the same entry to README Status and KOR.md
  상태. Not for project installs.
scenarios:
  - "graph-beta 패치 버전 올려줘"
  - "0.10.x 릴리스 준비"
  - "Bump the graph-beta patch version"
  - "Prepare a graph-beta patch release"
compatibility:
  optional: []
related:
  - install
  - remove
  - harness:patch
---

# patch — prepare a synchronized graph-beta patch release

Increment the patch component of the graph-beta plugin version and keep `plugin.json`, the
marketplace entry, README's `## Status`, and KOR.md's `## 상태` synchronized. This skill is for
a source checkout of this marketplace, not for refreshing files installed into a project (use
`install` with `"refresh": true` for that).

## Process

1. Inspect the graph-beta diff and derive one concise release-summary line in English and one
   in Korean. If the intended release is breaking or feature-sized, stop and use the
   appropriate major/minor version instead; this skill only increments `x.y.Z`.
2. Run a dry-run first:
   ```sh
   node "<plugin>/skills/patch/patch.mjs" '{
     "plugin": "graph-beta",
     "repoRoot": "<abs claude-skills checkout>",
     "summary": "<concise EN status entry>",
     "summary_ko": "<concise KR status entry>",
     "dryRun": true
   }'
   ```
3. Confirm the reported previous and next versions, then run the same command with
   `"dryRun": false`. The script refuses to write if `graph-beta/.claude-plugin/plugin.json`'s
   name doesn't match `"plugin"`, plugin and marketplace versions differ, either `## Status`
   (README) or `## 상태` (KOR.md) heading is missing, or either summary is empty, multiline, or
   already present in its file.
4. Run `python3 scripts/validate_plugins.py`, inspect `git diff`, and report the new version and
   both status entries. Do not claim the release is published; this only prepares source
   metadata.

`patch.mjs` updates:

- `graph-beta/.claude-plugin/plugin.json`
- the `graph-beta` entry in `.claude-plugin/marketplace.json`
- the first entry under `graph-beta/README.md` → `## Status`
- the first entry under `graph-beta/KOR.md` → `## 상태`

## Related

- `install` — install or refresh project-owned graph-beta copies
- `remove` — uninstall project-local graph-beta governance
- `harness:patch` — the harness plugin's equivalent release skill
