# Claude Code mods for this repo — plan index

> Produced by write:plans (2026-10-06). Owner for execution routing: planning:executing-plans.
> Source: the mod survey of 2026-10-06 (teams+graph, harness+knowledge, other plugins).
> Each plugin change still goes through the repo's design-change rule (CLAUDE.md "Design
> Changes"): plan → setgoal → critique → user approval → implement → gate. These files are
> the plan stage only.

**Goal:** add the few mods that remove real friction found while running teams and the
harness, without making any plugin depend on a mod to work.

**Architecture:** a mod is a hooks module named under `modules` in a plugin's
`hooks/hooks.json` (Claude Code 2.1.292+, early-access API). It is an extra surface on top
of what each plugin already does: every command hook, MCP tool, CLI and CLAUDE.md block
stays, so a user on an older build, without plugins, or on Codex loses nothing.

**Tech stack:** TypeScript hooks module (`register(on)`), `claude plugin validate`,
`claude plugin test` (`*.test.ts`, `claude-code/testing`), `tsc -p`. Existing CLIs it calls:
`teams/scripts/view.mjs --once`, `harness/engine/fallback-check.mjs`.

---

## What is in, in order

| # | File | What | Why first |
|---|------|------|-----------|
| 0 | `00-spike.md` | Prove the four assumptions every mod below rests on | A wrong assumption would break installs for every user |
| 1 | `01-gate-heredoc-fix.md` | Fix the harness gate's false positives on Bash (not a mod) | Blocked this session repeatedly; affects every client |
| 2 | `02-teams-live.md` | teams mod: live board pane, ledger status line + toasts, band above the prompt, two NEVER-rule guards | Replaces the Monitor+grep loop the lead ran for every real run, and token-costing `tm_board` calls |
| 3 | `03-harness-gate-status.md` | harness mod: gate status line + `/harness-gate` explain pane | The gate's only signal today is a deny message |

Each file is one subsystem with its own tasks and pass bars. 1 can run in parallel with 0.
2 and 3 start only after 0 passes.

## Backlog (surveyed, not planned yet)

Value H/M, kept out of this round to stay small; revisit after 2 and 3 ship.

- **completion:** deny `git commit`/`push`/`gh pr create` when no verifier verdict is recorded
  since the last edit (`completion/skills/verification-before-completion/SKILL.md:38-65,124`).
  Needs a docs/WIP allow-list in `userConfig`.
- **skill routing:** `prompt.submit` adds context naming the skill whose `Triggers on:` phrase
  matched exactly; log hits/misses to `$.store` for `skill:trigger-validator`. Fix first, as
  plain text edits: "스킬 만들어줘" / "create a skill" are triggers of both
  `write:writing-skills` and `skill:create`.
- **develop TDD:** toast when a source file is edited with no failing test run recorded since
  the last test edit (`develop/skills/test-driven-development/SKILL.md:27-30,44-46`).
- **teams:** zero-token slash commands for board/inbox/log; `prompt.compose` section in place of
  the CLAUDE.md block teams:install writes; inbox `[take]`/`[submit]` buttons; graph run pane.
- **harness:** session-start toast when the project's gate copy differs from the plugin's;
  `fallback-check.mjs` run on a done-claim during an open fallback run.
- **portfolio/write/develop extras:** deck-builder preview pane, mock-interview ledger in
  `$.store`, like-me saved voice profile, flaky-test-analyzer `run_n` tool,
  scenario-director actor pane + director request guard, writer-verification ask before
  `gh pr create`.

## Out (decided)

- `tm_*` / `team_*` / `graph_*` return values stay machine-shaped (memory: human-readable
  status surfaces are separate surfaces).
- `tm_wait`, the daemon, ledger writes, the run archive and `viewserver` must work with no
  Claude Code session; no mod replaces them.
- Linux keep-awake belongs in `teams/scripts/run.mjs` (`systemd-inhibit`), not a mod.
- think / cognition / planning / most portfolio and develop skills: pure in-conversation
  reasoning; a mod would only restate the skill.
- Repo commit rules (marketplace + README/KOR move together): enforce in
  `.git/hooks/pre-commit` + `_repo/scripts/validate_plugins.py`, which work in every client.

## Shared rules for every mod here

1. **Never required.** Removing the `modules` line leaves the plugin fully working.
2. **Interactive only.** An installed plugin also loads in every headless `claude -p` the
   teams/graph adapters start. Every timer, pane, band and toast starts only when
   `(await $.session.surfaces()).length > 0`.
3. **Guards fail open.** Every `tool.call` guard is registered with
   `.catch(($, e, next) => next(e))` — a broken guard lets the call through (and `next(e)`
   replays rather than re-runs when the guard had already called it), matching the existing
   gates' fail-open principle.
4. **State in `$.state`, declared in `types/index.d.ts`;** module variables only for caches a
   reload may lose.
5. **Release with the plugin.** A mod change bumps that plugin's version and its
   README/KOR (or CHANGELOG/CHANGELOG.KOR for teams) like any other change.
