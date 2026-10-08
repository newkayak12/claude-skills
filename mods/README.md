# mods (beta)

Claude Code mods (function hooks) for the claude-skills workflow: skill toasts, and safety guards.

## Install & Uninstall

```bash
/plugin install mods@newkayak12-claude-skills
/plugin uninstall mods@newkayak12-claude-skills
```

## Requirements

Claude Code 2.1.292 or newer. Older builds print one stderr line and skip the mod; nothing else breaks. If the mod does not load, set `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` in the environment before starting Claude Code.

## Features

| # | Feature | What it does | Scope |
|---|---|---|---|
| 1 | Skill toast | Toast and status line when a skill from this marketplace is invoked | interactive |
| 2 | Agent model guard | Acts when an `Agent` call names no model (the parent's model is used); `fork` always passes. See the option below | all sessions |
| 3 | Running-script guard | Denies Edit/Write on a `.sh`/`.bash` file while a process is running it | all sessions |
| 4 | Worktree guard | Denies `git worktree remove --force` when the worktree has uncommitted changes; fails open if the path is gone | all sessions |
| 5 | Fetch reminder | Fetches at session start (interactive sessions only) and toasts if `origin/main` is ahead | claude-skills repo only |
| 6 | Push / bump ask | Asks before `git push` and the `patch-harness` / `teams/skills/patch/patch.mjs` version bump scripts; the command is denied unless Run is chosen (dismissing the prompt also denies); headless sessions pass without asking | claude-skills repo only |
| 7 | README without KOR | Toast on `git commit` when a staged `README.md` has no staged `KOR.md` | claude-skills repo only |
| 8 | `claude -p` count | At turn end, status line `n claude -p child(ren) running` for headless children of this session; cleared at 0 | interactive |

"claude-skills repo only" means the session repo's remote matches `/claude-skills(\.git)?$/`; in any other repo these three do nothing. Interactive-only features do nothing in headless (`claude -p`) sessions.

The `claude -p` count is per session: only processes started below this session's engine process are counted. Processes that escape it (nohup, setsid, daemons reparented to pid 1) are not counted.

## Options

`agent_model_guard` (set in `/config`, default `toast`):

- `toast`: warn, the call proceeds.
- `deny`: block the call. To enable: run `/config`, find `mods.agent_model_guard`, set it to `deny`. The mod never writes this setting itself.
- `off`: do nothing.

## Status and known limits

- Beta (`0.1.0-beta.4`): run band and its scanner removed (harness draws it); notices carry an icon (◆ ⚠ ↓ ⧗).
- The skill toast needs the marketplace file to be readable from the plugin location; if not, no toast is shown.
- The Agent guard also flags subagent types whose definition already pins a model, because it only sees the call's own `model` argument.
- The worktree guard ignores a leading `cd <dir> &&` in the same command; only `-C <dir>` or the session directory is used to resolve the path.
- The `claude -p` count is a snapshot taken at turn end, not live.
