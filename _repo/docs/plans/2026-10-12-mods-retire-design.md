# Retire the `mods` plugin (2026-10-12)

Approved by the user 2026-10-12 ("mods 겹치는게 많아서 통합하고 없애자 플러그인 레벨에서"; recommendations 1–5 accepted).

## Why

`mods` overlaps other plugins. Features 3 (running-script guard) and 4 (worktree guard) already live in
`session` (`2026-10-08-mod-guard-design.md` §"What moves out of mods") but were never deleted from `mods`,
so both plugins deny the same call. The repo-only features (5–7) run a remote regex on every Bash call for
every user, though they encode only this repo's rules.

This overrides `2026-10-08-mod-session-design.md:101` ("the unfinished-agent count and `/reap` stay in
`mods`"): that decision kept two plugins from writing the same number; with `mods` gone, `session` owns
the one status line, so the reason no longer holds.

## Where each feature goes

| # | Feature | Home |
|---|---|---|
| 1 | Skill toast | `trophy`: one `◆ <plugin:skill>` toast per Skill call of this marketplace, skipped when that call unlocks an achievement (the 🏆 toast stands for it) |
| 2 | Agent model guard | `session`, option `agent_model_guard` (default `toast`, same modes as mods) |
| 3, 4 | Running-script, worktree guards | already in `session` guard; deleted with mods |
| 5, 6, 7 | Fetch reminder, push/bump ask, README-without-KOR | this repo only: `.claude/hooks/repo-rules.mjs` command hooks in the tracked `.claude/settings.json`; the ask only when `CLAUDE_CODE_SESSION_ATTENDED=1` |
| 8 | Unfinished-agent count | `session` status line, an `agents` part (`⧗ n agent(s) · /reap`) |
| 9 | `/reap` | `session`: the `/reap` command (same confirm and stop rules) |

## Release steps

1. This release: features move; `mods` 0.3.0 is a no-op (no function-hook module; the shared `ensure-trophy.sh` ride-along stays like every plugin's); its README/KOR say
   "retired — uninstall; features moved to session, trophy". session 0.5.0, trophy 0.8.0.
2. A later release removes the `mods` entry from marketplace.json and the `mods/` folder (repo major: 2.0.0,
   tagged when the user asks).

## Known costs

- Headless sessions lose guards 3/4 (session skips headless by design, guard-design §headless).
- Existing installs keep running their cached `mods` until they update to 0.3.0 or uninstall (unmeasured).

## Done when

- `claude plugin test` and `claude plugin validate` pass for session and trophy; `mods` validates as a
  no-op; `_repo/scripts/validate_plugins.py`, `check-copies.mjs`, `test-ensure-trophy.sh` exit 0.
- `mods/hooks/` holds no module; no doc outside `mods/`, changelogs and `_repo/docs` tells users to use mods features.
- Live: in this repo `/reap` stops an agent, the status line shows the agent count, `git push` asks once;
  in another repo no fetch and no ask; under `claude -p` no ask and no model-guard prompt.
