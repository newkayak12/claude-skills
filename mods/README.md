# mods — retired

**English** · [한국어](KOR.md)

`mods` is retired. Its features moved; uninstall it.

```bash
/plugin uninstall mods@newkayak12-claude-skills
```

Version 0.3.0 loads no module and does nothing, except the same first-session install of [trophy](../trophy/README.md) that every plugin of this marketplace carries (opt out with `mkdir -p ~/.claude/plugins/.newkayak12-trophy-ride.done`).

## Where each feature went

| # | Feature | Now in |
|---|---|---|
| 1 | Skill toast | [trophy](../trophy/README.md): one `◆ <plugin:skill>` toast per Skill call, skipped when the call unlocks an achievement |
| 2 | Agent model guard | [session](../session/README.md), option `agent_model_guard` (default `toast`) |
| 3, 4 | Running-script guard, worktree guard | [session](../session/README.md) guards |
| 5, 6, 7 | Fetch reminder, push/bump ask, README without KOR | this repo only: `.claude/hooks/repo-rules.mjs` (command hooks in `.claude/settings.json`); the ask only in an attended session |
| 8 | Unfinished-agent count | [session](../session/README.md) status line |
| 9 | `/reap` | [session](../session/README.md) |

## Status log

- 0.3.0 — Retired: no function-hook module; features moved to session, trophy and the repo's own hooks. Design: `_repo/docs/plans/2026-10-12-mods-retire-design.md`.
