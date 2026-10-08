# session (beta)

Shows what a Claude Code session left behind (files changed, commits, denied calls, longest gap between tool calls), shows it again as a band on your next start, lists stray `claude -p` children and stops one safely. Beta: version `0.1.0-beta.1`. Requires Claude Code 2.1.292+ (hooks module). It needs nothing else from this marketplace.

## Install
```
/plugin install session@newkayak12-claude-skills
```

## /session
`/session` opens one pane with two views, switched by the buttons or keys `1` / `2`:
- **Retro `[1]`**: files Claude edited or wrote this session (with `+added -deleted` from `git diff --numstat`), commits made (hash and subject), denied tool calls (tool and reason), and the longest gap between two tool calls in one turn.
- **Orphans `[2]`**: `claude -p` children still running below this session, one row each: pid, command, age, `[stop]`. A line points to `/tasks` for background shells and subagents; this plugin does not list those.

`/session retro` opens the Retro view; if nothing happened yet in this session it shows the summary the last session left.

## Retro band
When a session ends, the summary is saved (also for `claude -p` runs). The next interactive start shows one row above the prompt: `last session: 4 files, 2 commits, 1 denied, longest gap 6m12s` with `[Retro]` and `[dismiss]`. Dismissing deletes the saved summary. Nothing is written to your repository.

## Stopping a child safely
`[stop]` sends one `SIGTERM` to one process, after these checks:
1. a fresh process table is read; the pid must still be below this session's process, and not the session itself or one of its ancestors;
2. its command and start time must equal what you saw (a reused pid is refused);
3. you confirm in a prompt that shows the full command;
4. the checks run again right before the signal.

No `kill -9`, no process groups, no pattern kills, no "stop all". A refusal shows a toast and sends nothing; a process that already ended just clears its row.

## Status line
At the end of a turn, `⧗ N claude -p child(ren) running` shows while children are alive. This replaces feature 8 of `mods`, which no longer has it.

## Limits
- "Longest gap" is the largest time between two tool calls in one turn, not a measured step.
- Denied counts only denials this plugin saw as a tool call result.
- Paths are plain text (no clickable links).
- Windows: the orphan section is hidden and stopping is off; the Retro view and band work.
- Interactive sessions only for UI; headless runs record the ledger and save the summary, nothing is drawn.
- The status line and pane need a live session to confirm: `[stop]` on a real `claude -p` child (a plain `sleep` is never listed), and the pane at under 144 columns via `/session`.
