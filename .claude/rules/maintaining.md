# Maintaining — checks, versions, agents, clean-up

## Checks before a commit

Always:

```sh
python3 _repo/scripts/validate_plugins.py   # every plugin installable (CI runs this)
node _repo/scripts/check-copies.mjs         # vendored copies + ROUTE/NODE blocks of the gate hooks identical (CI runs this)
```

Then the plugin you touched:

| Touched | Run |
|---|---|
| a mod (`<plugin>/hooks/*.tsx`) | `cd <plugin> && claude plugin test .` |
| teams / graph / harness / knowledge scripts | `node --test <plugin>/scripts/test-*.mjs` |
| teams bench scripts | `node --test teams/scripts/bench/test-*.mjs` |
| harness goal gate | `node harness/scripts/test-goal-gate.mjs` (own runner, prints `all passed`), then copy it byte-identical to `.claude/hooks/goal-gate.mjs` |
| `write:diagram` | `node write/skills/diagram/scripts/test-diagram.mjs` (teams vendors its `diagram.mjs`) |
| `write:tech-book` | `node --test write/skills/tech-book/scripts/test-*.mjs` |
| `portfolio:deck-builder` | in its `scripts/`: `python3 test_deck.py`, `DECK_RENDER_DOCKER=deck-render python3 test_render.py` |
| a SKILL.md only | the validator above; a behaviour change also needs one real run |
| `.claude/hooks/repo-rules.mjs` | `node _repo/scripts/test-repo-rules.mjs` |
| harness engine scripts | also `node --check` on `harness/engine/{codex-exec-adapter,codex-runner,fallback-check}.mjs` |

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
- README.md (English) and KOR.md (Korean mirror) move together in the same commit.
- Bump tools (maintainer, not user skills): `node _repo/scripts/patch-harness.mjs` and
  `node teams/skills/patch/patch.mjs '<json>'` (dry-run first) bump a patch version and its status
  logs in one step. Minor/major by hand. Refreshing a project's installed harness copies is `harness:update`.
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

- An agent that edits repo files runs in its own worktree (`isolation: "worktree"`) by default; the
  main checkout belongs to the orchestrating session. Only one agent commits in a working tree at a
  time — parallel committers share the git index and mix commits. Read-only agents may run in parallel.
- Every commit is authored `newkayak12 <newkayak12@gmail.com>`. Never commit as another name or
  email; engine and tool commits (harness, teams) use the same author. The `Co-Authored-By: Claude …`
  trailer is allowed.
- Every subagent call names its model (`sonnet` for build work, `opus` for plan/judge).
- Everyone edits files with Read/Edit/Write, not shell scripts (sed, python, heredocs), and never
  scripts around the goal gate. If the gate blocks the orchestrating session, it opens a harness run;
  a subagent or harness/teams node never opens one — it stops and reports to its caller.
- Stage explicit paths, never `git add -A` at the root while another task has changes.

## Benches and experiments

- A bench measures a skill, not its output: run it only up to the stage the change affects, compare
  blind, and fix the skill. Output content is not maintained.
- Blind means: arms anonymized before judging, judge on a different model tier than the authors,
  each judgment tied to the run's done criteria; a partly met criterion is stated as such.
- Bench output lives in `tmp/` and is deleted when the result is recorded (`05-report.md`, and a
  memory if it matters later).
- Docker in a bench: unique names, no host ports, tear down by exact name. Never `prune` anything.

## Leaving it clean

1. `git status` is clean and `main` equals `skills/main`.
2. Every harness run you opened has `05-report.md` — an open run keeps the goal gate engaged, and
   `.claude/hooks/repo-rules.mjs` refuses `git push` and the bump tools while any run is open or its
   report has a `| missing |` row. A missing criterion ships only with a `waived: <user's words>`
   line. Codex and a plain terminal get the same push hold from git: `git config core.hooksPath
   _repo/hooks` once per clone. `--no-verify` and bump scripts run outside Claude Code are not covered.
3. No containers, volumes, or background processes you started are left running.
4. `tmp/` holds nothing you are done with.
5. Nothing new at the top level that is not a plugin.
