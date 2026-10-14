# Maintaining this repo

One page for anyone (Claude, Codex, or a person) changing this repo. `CLAUDE.md` holds the rules for
*how* a change is made (guidelines, design-change harness, update workflow); this page holds *where
things live, how to check them, and how to leave the repo clean*. When the two disagree, fix one.

## Layout — keep it flat

| Path | Holds | Never holds |
|---|---|---|
| `<plugin>/` (top level) | one plugin: `.claude-plugin/plugin.json`, `skills/`, `hooks/` (mod), `README.md` + `KOR.md` | notes, plans, reports |
| `_repo/docs/plans/` | design docs, dated `YYYY-MM-DD-<topic>.md`; mod plans in `mod/`; shipped plans in `done/` (a plan cited by code comments stays put) | code |
| `_repo/hooks/` | git hooks (`pre-commit` validator, `pre-push` run hold) via `core.hooksPath` | — |
| `_repo/scripts/` | repo-wide checks (`validate_plugins.py`, `check-copies.mjs`, bump tools) | plugin code |
| `_repo/deprecated/` | README only: restore table (item, last commit, `git checkout` command) for retired items | files of retired items |
| `.claude/` | this repo's own hooks (goal gate, repo rules) | plugin code |
| `tmp/` (gitignored) | scratch output of a bench or experiment | anything to keep |
| `.harness-run/` (gitignored; `develop-realign` files were committed before the ignore) | one folder per harness run | — |

A new top-level directory is a new plugin, or it does not exist. A note worth keeping goes in
`_repo/docs/`; one that isn't is not written to the repo.

## Skill or mod — who does what

Read back from what ships today (skills under `*/skills/`, mods in `graph`, `harness`, `session`,
`teams`, `trophy` `hooks/*.tsx`). Put new work on the side whose column it matches.

| | Skill (`SKILL.md` + scripts/MCP) | Mod (`hooks/*.tsx`) |
|---|---|---|
| Is | the procedure: what the model thinks and does, in order, and what it produces | the session around the model: what a person sees, and what the client enforces |
| Runs | in the conversation, when invoked or triggered | on client events (`session.start`, `tool.call`, `turn.complete`, timers), whether or not a skill is running |
| Owns | steps, judgment, gates the model must pass, artifacts (`deck.pdf`, `05-report.md`, task files, ledgers) | panes, band lines, status line, toasts, push; tool-call guards; context injection (`prompt.context`, memo) |
| Data | writes the files and ledgers | reads them only (`teams/scripts/view.mjs --once`, run JSON, `.harness-run/`); never the source of truth |
| Logic | parsing and decisions live in node/python with their own tests | renders what that code returns; no parsing worth testing inside the tsx |
| Without the other | works fully — headless `claude -p`, Codex, older clients | is never required: removing `modules` loses only the surface |
| Example | `teams:develop` runs the EPIC; `harness` stages write the run files; `think:brainstorming` runs the debate | `/teams-status` shows teams, cards, decisions; `session` guard confirms a dangerous command; trophy toasts an unlock |

Rules that follow:
- A behaviour a person must not skip (a gate, a deny) is enforced where every client sees it — the
  skill's engine or a plain command hook — and a mod may add a friendlier surface on top.
- When a pane needs something no file records (a reason, an actor), the fix is a field the skill's
  engine writes, not inference in the mod.
- A skill never draws UI or waits on a pane; a mod never decides an outcome a skill owns.
- One pane per plugin, opened by `/<plugin>-status` (or the skill's name) or its band line; closes on
  Esc, q and its command again.

## Checks before a commit

Always:

```sh
python3 _repo/scripts/validate_plugins.py   # every plugin installable (CI runs this)
node _repo/scripts/check-copies.mjs         # vendored copies + ROUTE/NODE blocks of the gate hooks identical (CI runs this)
```

Then the plugin you touched:

| Touched | Run |
|---|---|
| a mod (`<plugin>/hooks/*.tsx`: session, trophy, harness, graph, teams) | `cd <plugin> && claude plugin test .` |
| teams / graph / harness / knowledge scripts | `node --test <plugin>/scripts/test-*.mjs` |
| teams bench scripts | `node --test teams/scripts/bench/test-*.mjs` |
| harness goal gate | `node harness/scripts/test-goal-gate.mjs` (own runner, prints `all passed`), then copy it byte-identical to `.claude/hooks/goal-gate.mjs` |
| `write:diagram` | `node write/skills/diagram/scripts/test-diagram.mjs` (teams vendors its `diagram.mjs`) |
| `write:tech-book` | `node --test write/skills/tech-book/scripts/test-*.mjs` |
| `portfolio:deck-builder` | in its `scripts/`: `python3 test_deck.py`, `DECK_RENDER_DOCKER=deck-render python3 test_render.py` |
| a SKILL.md only | the validator above; a behaviour change also needs one real run (see Benches) |
| `.claude/hooks/repo-rules.mjs` | `node _repo/scripts/test-repo-rules.mjs` |

The goal gate (`.claude/harness-gate.json`) covers `.js/.mjs/.cjs`, `.ts/.tsx`, `.py`, `SKILL.md`,
`hooks.json` and `.claude-plugin/{plugin,marketplace}.json`; docs (README, KOR, CHANGELOG, plans) are not gated.

Report the counts you saw; "tests pass" without a number is not a check.

## Versions and release

- Releases are batched: fixes land on main without a bump. Versions move once per batch (end of a
  work session, or when the user asks): one bump per plugin per batch, one README/KOR status line
  per plugin per batch. A hotfix the user needs installed now is the exception.
- A batch bump touches `<plugin>/.claude-plugin/plugin.json` **and** its entry in
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
- Everyone — the main session and every agent — edits files with Read/Edit/Write, not shell
  scripts (sed, python, heredocs), and never scripts around the goal gate. If the gate blocks the
  orchestrating session, it opens a harness run; a subagent or harness/teams node never opens one —
  it stops and reports to its caller.
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
2. Every harness run you opened has `05-report.md` — an open run keeps the goal gate engaged, and
   `.claude/hooks/repo-rules.mjs` refuses `git push` and the bump tools while any run is open or its
   report has a `| missing |` row. A missing criterion ships only with a `waived: <user's words>`
   line in that report. Codex and a plain terminal get the same push hold from git: run
   `git config core.hooksPath _repo/hooks` once per clone (it also runs the validator on commit).
   `--no-verify` and bump scripts run outside Claude Code are not covered.
3. No containers, volumes, or background processes you started are left running.
4. `tmp/` holds nothing you are done with.
5. Nothing new at the top level that is not a plugin.
