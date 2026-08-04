# boundaries — what must not be touched casually

Plan/SetGoal treat these as hard constraints; violations fail the QualityGate.

## Do not modify without explicit user approval
- `.claude-plugin/marketplace.json` version fields — the version source of truth; bump
  deliberately per INSTRUCT.md, never as an incidental edit.
- `harness/engine/pipeline.js` behavior on the Workflow path — changes here alter every
  harness run; the gate protects it for this reason.

## Off-limits entirely
- `INSTRUCT.md` — gitignored maintainer notes; edits there never warrant a version bump.
- Superseded design corpora live only in git history (e.g. the `harness-v0` tag); do not
  resurrect them into the working tree as part of unrelated work.

## Requires a dependent update when changed
- Any skill's `description`/`scenarios` → re-run `scripts/validate_plugins.py`.
- A plugin's skill set or behavior → bump version in `marketplace.json` AND update that
  plugin's `README.md` (and `plugin.json` if versioned there).
