# skill:create + skill plugin prefix drop

## Plan

**Why.** `skill:quality-assurance`'s Top Improvements and `writing-skills` both assume a generator that
turns "I need a skill for X" into files. `write:writing-skills` is a discipline (prove the gap, RED check,
hand off); it does not scaffold. The Anthropic-derived `skill-creator` was removed in 210b38f because it
taught generic patterns, not ours. Build one that learns ours.

**What.**
1. New `skill/skills/create/SKILL.md` (persona archetype, `effort: high`, Standing Mandates first). One `references/archetypes.md`
   (six archetypes, induced from 101 skills); no bundled script. Process, 8 steps: Intake -> Place -> Pick archetype -> Read exemplars
   (sibling skills in the target repo) -> Draft -> Check (repo validator) -> Hand off (`trigger-validator`,
   then `quality-assurance`) -> Register. Body limit: 110 lines.
   - Out of scope: `scripts/induct.mjs`. Exemplars are still read from sibling skills at run time;
     `archetypes.md` is a map, not a replacement.
2. Drop the `skill-` prefix: `skill-quality-assurance` -> `quality-assurance`,
   `skill-trigger-validator` -> `trigger-validator`; repoint refs (write README/KOR, writing-skills,
   `validate_plugins.py`, authoring-reference). Past `docs/plans/*` stay as history.
3. `skill-creator` refs in QA -> `skill:create`.
   - Out of scope: any change to the `write:writing-skills` description or behaviour (hard limit).

## Dry run

One dry run, outside the repo, in `$TMPDIR/create-dryrun` (technique: commit-message check skill). It covered
Process steps 1-6 only; step 7 (Hand off) and step 8 (Register) were skipped. Result: `[skill]` OK with 4
skills under origin/main's `validate_plugins.py` (check 15 included). A second dry run (workflow) is out of scope.

## Known merge conflict with origin/main

Both sides edit the docstring line in `scripts/validate_plugins.py`: the authoring-principles path on this
branch, check 15 on main. Resolve by keeping check 15 and the renamed path.
Structural gates run against origin/main's copy of the validator, not the stale copy in this worktree.
origin/main (43cfc6b) has since moved the validator to `_repo/scripts/validate_plugins.py`, so the merge is a
modify/rename conflict, not only a docstring one. Gated on that copy: `[skill]` and `[write]` OK; `[teams]` shows 15
baseline errors (missing WCD section), unrelated.

## Done criteria

Ticked only where a verification unit produced a PASS.

- [x] Out of scope: `scripts/induct.mjs`. Not built; `references/archetypes.md` is the only bundled file.
- [x] `create/SKILL.md` <= 110 lines (72), description <= 250 chars starting `Use when`, scenarios EN + KR,
      required sections in order incl. `What Claude Does / What You Do` with `| Claude | You |` table.
- [x] One dry run in `$TMPDIR` (steps 1-6 only) produces a skill that passes origin/main's validator for `[skill]`.
- [x] `grep -r "skill-quality-assurance\|skill-trigger-validator\|skill-creator"` outside `deprecated/`,
      `docs/plans/`, `docs/CURATION.md` -> 0 hits in `skill/`, `write/`, `scripts/` except the Renames note (verified).
- [x] `skill/README.md` + `skill/KOR.md` describe three skills.
- [x] write README/KOR repoints committed in the same commit.
- [x] Local branch only; no push, no version bump.

## Critique

- **Trigger overlap with writing-skills.** Both could fire on "스킬 만들어줘". Narrowing the writing-skills
  description is out of scope (범위 외); the overlap is recorded and left for a separate approved change.
- **Weight.** `create` stays in the technique size band it enforces on others (limit 110 lines).
- **Rename breaks installed users.** `skill:skill-*` invocations stop resolving after update. Acceptable
  (think 1.4.0 set the precedent); note it in README.
- **Other plugins' prefixes** (knowledge-*, portfolio-*, 14 more) are out of scope unless asked.
