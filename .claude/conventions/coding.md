# coding — how code in this project is written

This repo is a **Claude Code plugin marketplace**: plugins hold skills (SKILL.md +
markdown) plus a little Node/Python tooling (harness engine, hooks, validator). The
harness engine reads this file: SetGoal folds it into acceptance criteria, Implement
executors follow it. Keep every rule concrete and checkable.

## Naming & structure
- Plugins and skills are kebab-case directories; a skill lives at `<plugin>/skills/<name>/SKILL.md`.
- One skill per directory; supporting files (templates, scripts) sit beside the SKILL.md.
- JS engine/tooling under `harness/` uses ES modules (`.mjs`/`import`), pure Node — no deps.

## SKILL.md authoring (law — see skill/skills/writing-skills)
- `description` MUST start with `Use when` — it is the trigger.
- `scenarios` MUST include EN + KR variants (2-3 each).
- Every skill: Process → Output Template → What Claude Does / What You Do → Related Skills.
- No background explanations — the skill name is the context. Target ~70% of the current
  average skill length.

## Style
- Match the surrounding file's idiom before any general rule.
- Comments state constraints the code can't show — never narrate the change itself.
- Keep SKILL.md descriptions under 250 chars (validator warns past it; the tail is invisible
  to trigger matching anyway).

## Dependencies
- No new runtime dependencies in the harness engine/hooks — they must run on stock Node.
