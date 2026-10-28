# Repo rules — how a change is made

This repo holds reusable skills organized into plugins. Non-plugin material (design docs, repo
scripts, retired items) lives under `_repo/`; every other top-level directory is a plugin.

Every change is checked against `_repo/coding-guidelines.md` (Karpathy's four):

| Guideline | Rule in this repo |
|---|---|
| **Think Before Coding** | A behaviour change starts with the user's approval before `tm_open`, then plan → setgoal → critique (below). Unclear or several readings → ask before editing. |
| **Simplicity First** | No new skill when an existing one can be split or extended; no new top-level directory unless it is a plugin; no option nobody asked for. |
| **Surgical Changes** | Edit files with Read/Edit/Write only (main session and agents alike); Bash is for git, checks and tests. Stage explicit paths. Fixes land unbumped; no unrelated tidy-ups in the same change. |
| **Goal-Driven Execution** | Done = the checks in `maintaining.md` with counts reported, plus one real run for a behaviour change. Every Sprint ends with its report, partial criteria stated as partial. |

## Design changes

A behaviour change is a card on `_repo/docs/backlog.md`, taken into a Sprint, closed by the Sprint's report.
A Sprint opens with `tm_open` and `size: "L"` (an unpinned small backlog sizes S and runs as one
harness pass with no STORY cards; see `backlog.md`).
The person's approval of the cards and decisions comes before `tm_open`. No code before approval.

Before changing behaviour of a plugin (not typo/doc fixes):
1. **plan** — what changes and why, citing the governing design doc (`_repo/docs/plans/`).
2. **setgoal** — checkable done-criteria.
3. **critique** — check it against the doc's principles inside the Sprint.
4. **implement → gate** — show the result against the done-criteria.

Where approval sits: the person approves the cards and decisions in the session, before `tm_open`
(the brainstorm). Plan → setgoal → critique then run inside the Sprint as stages, and the Sprint
report is where the person checks the result.

Never remove a stage, a gate, or a principle for cost or simplicity without the user's approval.
teams principles: `_repo/docs/plans/2026-09-28-teams-cards-everywhere.md`.

## Layout — keep it flat

| Path | Holds | Never holds |
|---|---|---|
| `<plugin>/` (top level) | one plugin: `.claude-plugin/plugin.json`, `skills/`, `hooks/` (mod), `README.md` + `KOR.md` | notes, plans, reports |
| `_repo/docs/plans/` | design docs, dated `YYYY-MM-DD-<topic>.md`; mod plans in `mod/`; shipped plans in `done/` (a plan cited by code comments stays put) | code |
| `_repo/hooks/` | git hooks (`pre-commit` validator, `pre-push` task hold) via `core.hooksPath` | — |
| `_repo/scripts/` | repo-wide checks (`validate_plugins.py`, `check-copies.mjs`, bump tools) | plugin code |
| `_repo/deprecated/` | README only: restore table for retired items | files of retired items |
| `.claude/` | this repo's own hook (repo rules), teams config (`team.json`, `teams-dispatch.json`) and these rules | plugin code |
| `tmp/` (gitignored) | scratch output of a bench or experiment | anything to keep |
| `.harness-run/` (gitignored) | written by a teams size-S pass | — |

A new top-level directory is a new plugin, or it does not exist. A note worth keeping goes in
`_repo/docs/`; one that isn't is not written to the repo.

## Rule files

| File | Covers |
|---|---|
| `repo.md` | this page |
| `maintaining.md` | checks, versions and release, agents, benches, leaving it clean |
| `skill.md` | what a skill is and how one is written |
| `mod.md` | what a mod is and its rules |
| `compat-claude.md` | older Claude Code builds |
| `compat-codex.md` | Codex |
| `backlog.md` | where work waits; the Sprint loop |
| `enforcement.md` | who checks each rule: hook, script, git hook, engine, or prose only |
