# Codex Instructions

This repository is primarily a Claude Code skill/plugin repository, but it is also safe to
work on with Codex.

Before modifying this repo, read `_repo/coding-guidelines.md` and every file in `.claude/rules/`
— the same rules Claude Code loads:

| File | Covers |
|---|---|
| `.claude/rules/repo.md` | how a change is made: the four guidelines, plan → setgoal → critique → approval, layout |
| `.claude/rules/maintaining.md` | checks, versions and release, agents, benches, leaving it clean |
| `.claude/rules/skill.md` | what a skill is and how one is written |
| `.claude/rules/mod.md` | what a mod is and its rules (Claude-only surface) |
| `.claude/rules/compat-claude.md` | older Claude Code builds |
| `.claude/rules/compat-codex.md` | Codex: cross-client behaviour, harness paths, running inside a Codex session |

## Repository Shape

- Skills live under `<plugin>/skills/<skill-name>/SKILL.md`.
- Plugin manifests live at `<plugin>/.claude-plugin/plugin.json` (and `<plugin>/.codex-plugin/` where present).
- The marketplace manifest lives at `.claude-plugin/marketplace.json`.
- Non-plugin material lives under `_repo/`.
