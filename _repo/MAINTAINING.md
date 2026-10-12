# Maintaining this repo

One page for anyone (Claude, Codex, or a person) changing this repo. `CLAUDE.md` holds the rules for
*how* a change is made (guidelines, design-change harness, update workflow); this page holds *where
things live, how to check them, and how to leave the repo clean*. When the two disagree, fix one.

## Layout — keep it flat

| Path | Holds | Never holds |
|---|---|---|
| `<plugin>/` (top level) | one plugin: `.claude-plugin/plugin.json`, `skills/`, `hooks/` (mod), `README.md` + `KOR.md` | notes, plans, reports |
| `_repo/docs/plans/` | design docs, dated `YYYY-MM-DD-<topic>.md`; mod plans in `mod/` | code |
| `_repo/scripts/` | repo-wide checks (`validate_plugins.py`, `check-copies.mjs`, bump tools) | plugin code |
| `_repo/deprecated/` | retired plugins, kept for history | anything installable |
| `.claude/` | this repo's own hooks (goal gate, repo rules) | plugin code |
| `tmp/` (gitignored) | scratch output of a bench or experiment | anything to keep |
| `.harness-run/` (gitignored) | one folder per harness run | — |

A new top-level directory is a new plugin, or it does not exist. A note worth keeping goes in
`_repo/docs/`; one that isn't is not written to the repo.

## Checks before a commit

Always:

```sh
python3 _repo/scripts/validate_plugins.py   # every plugin installable (CI runs this)
node _repo/scripts/check-copies.mjs         # vendored copies identical (CI runs this)
```

Then the plugin you touched:

| Touched | Run |
|---|---|
| a mod (`<plugin>/hooks/*.tsx`: session, trophy, harness, graph, teams) | `cd <plugin> && claude plugin test .` |
| teams / graph / harness / knowledge scripts | `node --test <plugin>/scripts/test-*.mjs` |
| harness goal gate | `node --test harness/scripts/test-goal-gate.mjs`, then copy it byte-identical to `.claude/hooks/goal-gate.mjs` |
| `write:diagram` | `node write/skills/diagram/scripts/test-diagram.mjs` (teams vendors its `diagram.mjs`) |
| a SKILL.md only | the validator above; a behaviour change also needs one real run (see Benches) |

Report the counts you saw; "tests pass" without a number is not a check.

## Versions and release

- Plugin change → bump `<plugin>/.claude-plugin/plugin.json` **and** its entry in
  `.claude-plugin/marketplace.json` (and `<plugin>/.codex-plugin/` if it has one). Patch for a fix,
  minor for new behaviour or a skill added/removed, major for a breaking rename.
- README.md and KOR.md move together in the same commit.
- Remote is `skills`: `git pull --rebase skills main`, then `git push skills main`.
- Marketplace version and tag (`v<x.y.z>`) move only when the user asks for a release:
  - The repo version is `metadata.version` in `.claude-plugin/marketplace.json`; each release is the
    annotated tag `v<metadata.version>`, message `marketplace <version>`. A plugin bump alone does not move it.
  - Level, from the largest change since the last tag: patch = any plugin bump or doc change; minor = a
    new plugin added; major = a plugin removed or renamed, or a marketplace layout change that breaks installs.
  - Steps: `git fetch` → bump `metadata.version` → commit `marketplace <version>: <what moved>` →
    `git push skills main` → `git tag -a v<version> -m "marketplace <version>"` on that commit →
    `git push skills v<version>`. Tag only commits that are on skills/main.
  - Never move, delete, or re-point a pushed tag unless the user asks.

## Agents working in the repo

- An agent that edits repo files runs in its own worktree (`isolation: "worktree"`) by default, not
  only when it runs in parallel; the main checkout belongs to the orchestrating session. Only one
  agent commits in a working tree at a time — parallel committers share the git index and mix
  commits. Read-only agents may run in parallel anywhere.
- Every commit is authored `newkayak12 <newkayak12@gmail.com>`, the repo's configured git author.
  Never commit as another name or email (`harness <harness@local>`, `Claude`, …); engine and tool
  commits (harness, teams) use the same author. The `Co-Authored-By: Claude …` trailer is allowed.
- Every subagent call names its model (`sonnet` for build work, `opus` for plan/judge).
- Agents edit files with Read/Edit/Write, not shell scripts, and never script around the goal gate —
  if the gate blocks, open a harness run.
- Stage explicit paths, never `git add -A` at the root while another task has changes.

## Benches and experiments

- A bench measures a skill, not its output: run it only up to the stage the change affects, compare
  blind, and fix the skill. Output content (a bench book's chapters, figures) is not maintained.
- Blind means: arms are anonymized before judging, and the judge runs on a different model tier than
  the authors. Each judgment is tied to the run's done criteria; a criterion only partly met is stated
  as such, not rounded to pass or fail.
- Bench output lives in `tmp/` and is deleted when the result is recorded (the harness run's
  `05-report.md` and, if it matters later, a memory).
- Docker in a bench: unique names, no host ports, tear down by exact name. Never `prune` anything.

## Leaving it clean

At the end of a piece of work:

1. `git status` is clean and `main` equals `skills/main`.
2. Every harness run you opened has `05-report.md` — an open run keeps the goal gate engaged.
3. No containers, volumes, or background processes you started are left running.
4. `tmp/` holds nothing you are done with.
5. Nothing new at the top level that is not a plugin.
