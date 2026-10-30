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
| session scripts (`session/scripts/`) | `node --test session/scripts/test-*.mjs` |
| harness plugin hooks | `node harness/scripts/test-goal-gate.mjs` (own runner, prints `all passed`) |
| `write:diagram` | `node write/skills/diagram/scripts/test-diagram.mjs` (teams vendors its `diagram.mjs`) |
| `write:tech-book` | `node --test write/skills/tech-book/scripts/test-*.mjs` |
| `portfolio:deck-builder` | in its `scripts/`: `python3 test_deck.py`, `DECK_RENDER_DOCKER=deck-render python3 test_render.py` |
| `portfolio:manage` | `node --test portfolio/skills/manage/scripts/test-manage.mjs`, `python3 portfolio/skills/manage/scripts/test_resume.py` |
| a SKILL.md only | the validator above; a behaviour change also needs one real run |
| `.claude/hooks/repo-rules.mjs` | `node _repo/scripts/test-repo-rules.mjs` |
| a SKILL.md's shape | `node _repo/scripts/check-skeleton.mjs` (report only, always exit 0; frozen teams skills listed apart); its test `node --test _repo/scripts/test-check-skeleton.mjs` |
| harness engine scripts | also `node --check` on `harness/engine/{codex-exec-adapter,codex-runner,fallback-check}.mjs` |

The teams dispatch gate: paths in `.claude/teams-dispatch.json` are denied to the driving session
until a task is open (`tm_open`).

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
- Remote is `origin`: `git pull --rebase origin main`, then `git push origin main`.
- Installed copies stay current by themselves once `git config core.hooksPath _repo/hooks` is set:
  Claude Code pulls the GitHub marketplace on start (`autoUpdate: true` — so a bump reaches it on
  push); Codex runs the local repo through a versioned cache, refreshed by `post-commit`/`post-merge`
  (`node _repo/scripts/sync-codex.mjs`) for every enabled plugin whose version moved. A plugin
  change Codex should see therefore needs a version bump; run the script by hand to check
  (`codex: plugins current`).
- Marketplace version and tag (`v<x.y.z>`) move only when the user asks for a release:
  - The repo version is `metadata.version` in `.claude-plugin/marketplace.json`; each release is the
    annotated tag `v<metadata.version>`, message `marketplace <version>`. A plugin bump alone does not move it.
  - Level, from the largest change since the last tag: patch = any plugin bump or doc change; minor = a
    new plugin added; major = a plugin removed or renamed, or a marketplace layout change that breaks installs.
  - Steps: `git fetch` → bump `metadata.version` → commit `marketplace <version>: <what moved>` →
    `git push origin main` → `git tag -a v<version> -m "marketplace <version>"` on that commit →
    `git push origin v<version>`. Tag only commits that are on origin/main.
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
  scripts around the dispatch gate. If the gate blocks the orchestrating session, it opens a teams
  task; a subagent or teams node never opens one — it stops and reports to its caller.
- Stage explicit paths, never `git add -A` at the root while another task has changes.
- What runs at once is capped: at most 2 teams EPICs and 1 background Agent per session (each EPIC
  is a daemon plus up to 3 `claude -p` drivers in their own worktrees; 6 EPICs and 3 agents
  overloaded the machine on 2026-10-17). Before opening another, count live drivers
  (`ps aux | grep 'claude -p' | grep -v grep | wc -l`) and wait if at the cap.
- Reap in the same step you take the result: an agent's commit is cherry-picked, then its worktree
  and branch are removed; a finished EPIC is merged, then `tm_clean`ed. A session ends with no
  driver, daemon or judge it started in `ps`, and `git worktree list` showing only main.
- Work lost to a deleted worktree or branch is still in git: `git fsck --unreachable` → pin it to a
  `rescue/<task>` branch before anything else.

## Benches and experiments

- A bench measures a skill, not its output: run it only up to the stage the change affects, compare
  blind, and fix the skill. Output content is not maintained.
- Blind means: arms anonymized before judging, judge on a different model tier than the authors,
  each judgment tied to the run's done criteria; a partly met criterion is stated as such.
- Bench output lives in `tmp/` and is deleted when the result is recorded (the Sprint report, and a
  memory if it matters later).
- Docker in a bench: unique names, no host ports, tear down by exact name. Never `prune` anything.

## Leaving it clean

1. `git status` is clean and `main` equals `origin/main`.
2. Every teams task you opened has finished, its report written. `.claude/hooks/repo-rules.mjs`
   refuses `git push` and the bump tools while a teams task for this repo holds them: any task
   whose cwd shares the push's git dir (`git rev-parse --git-common-dir`), so the main checkout
   and every linked worktree count, each way. A task is released when its ledger has
   `daemon_done` and `<docs_dir>/E-<run_id[0:8]>/80-report.md` exists, whatever the outcome, or
   when its last relevant ledger event is `clean` (`tm_clean` always records one). A report
   without `daemon_done` (a crashed daemon) stays held, and so does a failed task with no
   report, until `tm_clean`. So the batch bump comes after the Sprint's task closes (the
   person's approval comes before `tm_open`; see `repo.md`). Codex and a plain terminal get the
   same push hold from git: `git config core.hooksPath _repo/hooks` once per clone. `--no-verify` and bump scripts run outside Claude Code are not covered.
3. No containers, volumes, or background processes you started are left running.
4. `tmp/` holds nothing you are done with.
5. Nothing new at the top level that is not a plugin.
