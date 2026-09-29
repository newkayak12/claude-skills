# harness hooks — opt-in PreToolUse gate

Denies `Write|Edit|MultiEdit|NotebookEdit`, and `Bash` commands that write, on gated paths unless
the harness is engaged. **Opt-in per project**: the gate does nothing until the project creates
`.claude/harness-gate.json`:

```json
{ "patterns": ["src/.*\\.kt$"], "window_hours": 2 }
```

- `patterns` — JS regexes, case-insensitive, matched against `/` + the path relative to the
  project root (so `\.mjs$` never gates a scratch file in `/tmp`).
- `window_hours` — how long an engagement record stays live (default 2).

**Root.** The nearest ancestor of the target file holding `.claude/harness-gate.json`; else, for a
sibling git worktree, the project of its common git dir (the pattern path is then taken from the
worktree's own top level); else `CLAUDE_PROJECT_DIR`. A `cd` into a subdirectory changes nothing.

**Engaged** means a record says so — never a string in the transcript (quoting the engine path,
or this hook's own deny message, engages nothing):
1. a `Workflow` tool call of `harness/engine/pipeline.js`, or an MCP `graph_open` / `tm_open` /
   `tm_run` call, whose result was not an error, within `window_hours`;
2. an open node in the broker ledger (`.harness-run/broker/open-nodes.json`);
3. an open fallback run (`.harness-run/<slug>/`, `engine/fallback.md`): `manifest.json`, a
   non-empty `01-plan.md`, a `02-goal-spec.json` with a subgoal, a `02-critique.json` with
   `sound: true` no older than the spec, no `05-report.md`, and a change within the window;
4. a live marker in `.claude/.harness-markers/` (parallel subagents; teams writes one into each
   package worktree).

Timestamps from the future are ignored, so a forged marker does not live forever.

**Always gated**, whatever `patterns` says: `.claude/harness-gate.json`,
`.claude/settings(.local).json`, `.claude/hooks/**`, `.claude/.harness-markers/**` — turning
the gate off is itself a gated edit.

**Bash** is judged by the paths it writes, deny by default:
- **Always:** redirect targets and a `git --output` file.
- **Write verbs:** every path-like word in the command counts when any simple command holds a write verb. Simple commands are split on `;`, `&`, `|` and newlines outside quotes. Paths resolve against the cwd and every `cd` in the command.
  - The verbs: `tee`, `sed -i`, `perl -i`, `cp`, `mv`, `rm`, `install`, `truncate`, `dd`, `patch`, `ln`, `touch`, `git checkout|restore|apply|stash|reset|mv|rm`.
  - A verb is exempt only as a plain argument of a read-only command that owns the whole simple command (`grep -n cp x.mjs`). The read-only commands: `grep`, `rg` (not `--pre`), `cat`, `head`, `tail`, `less` (not `-o`/`--log-file`), `wc`, `ls`, `echo` with no redirect, and `git log|show|diff|status` without `--output`. No `$(…)` or backticks may appear.
  - Wrappers of every kind (`sudo`, `env`, `nohup`, `xargs`, `find -exec`, `eval`, `command`, `exec`, `flock`, …) are judged by their words.
- **Scripts:** the same rule applies when a script can write.
  - That means an interpreter or shell anywhere in a simple command with `-e`/`-c`, or a heredoc fed to one, whose text holds a write-capable call.
  - Write-capable calls include file write/open, copy/move/remove, `exec*`/`spawn`/`subprocess`/`system`, `shutil`, `os.*`, and dynamic lookups such as `getattr`/`globals`/`Function`.
  - A shell fed a script always counts. A script that only *mentions* a path writes nothing.
- **Data heredocs:** a heredoc fed to anything else is data, so only its redirect target is written. Its body's paths count when the body holds a write verb or call, or when the same command line runs the file it writes. A heredoc that never closes is judged as a whole command.

Design rules (from v0's failed hook experiments): PreToolUse only, fail-open on every
error/ambiguity, deny only writes to opted-in paths, deny message teaches recovery.

Known holes (this is a guard rail against skipping the process, not security):
- a session can write its own fallback run files (`.harness-run/<slug>/` is not gated — engaging
  is meant to be possible); the gate then still requires plan, goal-spec and a sound critique.
  The broker ledger `.harness-run/broker/` is gated, since a hand-written open node would engage it;
- Bash writes it cannot see: a script file run by path that writes a gated file, variables
  (`f=a.mjs; echo > $f`), `git merge`/`pull`/`rebase`, and any tool other than the ones above;
- any live marker passes every session in the window (parallel subagents need it).

Add `.claude/.harness-markers/`, `.harness-run/` and `.claude/settings.local.json` to the
project's `.gitignore` (`install` does).
