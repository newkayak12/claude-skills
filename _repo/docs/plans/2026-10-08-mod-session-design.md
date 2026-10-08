# `session` mod — retro card, orphan-work watcher, changed-files tab (design)

Status: DESIGN, awaiting approval (CLAUDE.md "Design Changes": plan, setgoal, critique, then implement). No code yet.
Governing docs: `plan/mod/README.md` (shared rules; backlog "session retro card"), `plan/mod/00-spike-findings.md`.

## Context

`mods` (feature 9) counts `claude -p` descendants at turn end and shows one status string. The backlog
holds a "session retro card". The user chose a NEW standalone plugin, installable in any repo, with no
dependency on this repo's skills: one pane, three tabs, plus an end-of-session card. Dev time is spent
on the mod API as of build 2.1.293 (types in the `plugin-authoring` skill).

## Problem

A Claude Code user cannot see, in one place, what a session left behind (changed files, commits, denials)
or which of its background processes are still alive, and cannot safely stop the strays.

## Design

### Architecture (design level)

- New top-level plugin dir `session/` (every top-level dir is a plugin): `.claude-plugin/plugin.json`,
  `hooks/hooks.json` (`modules`, one entry), one `mod.tsx` that only wires events and drawing, plain `.ts`
  siblings for pure logic (process-tree walk, tally, safety checks; sibling `.ts` imports are proven, JSON
  is not importable), `types/index.d.ts` for `$.state`, `mod.test.ts`, `README.md` + `KOR.md`.
- Follows `plan/mod/README.md` shared rules: interactive-only UI (`surfaces().length > 0`), every gating
  hook ends in `.catch(next)`, files via `$.plugin.root`, every path fails open.
- Standalone: no `userConfig` needed, no skill, no repo-name check, no git requirement for the core.

### Components

1. **Session ledger** (pure, in `$.state`): files touched, commits, denied calls, step durations. Fed by
   `tool.call` hooks (Edit/Write/NotebookEdit paths; Bash `git commit`; a `{ deny }` from any hook beneath
   or a `tool.check` decision of deny) and `turn.step` (step start/end, via `$.clock`).
2. **Pane `session`** (`$.ui.open`, opened by `/session` or the band button, so it seats at any width).
   One pane, three views switched by a Button row (tab state in an atom). There is NO Tabs element: "tabs" are
   Buttons with `hotkey` 1/2/3. (Several panes would also show as tabs, but one pane keeps focus simple.)
   - **Retro**: files changed, commits (hash + subject), denied calls (tool + reason), longest step.
   - **Orphans**: one row per live item: kind, id/pid, command (clipped), age, `[stop]`.
   - **Files**: path, `+a -d`, Link row. See Critique 2 on whether it survives.
3. **Orphan sources** (two, and they differ):
   - Claude-managed background shells/subagents/monitors: `BackgroundTaskSummary[]` exists ONLY as
     `background_tasks` on the classic `Stop`/`SubagentStop` hook input, so the list is a snapshot refreshed
     at each turn end (hook `classic.Stop`), not live. Stop = `$.tool.call({ tool: 'TaskStop', task_id })`,
     which runs the permission check and only reaches tasks this session owns. No raw `kill`.
   - OS processes: `claude -p` children (what `mods` counts today) and any other command the user adds
     to a small allow-pattern list (default: `claude -p` only). Found by `ps` descendants of the engine pid.
4. **Retro card**: `AbovePrompt` band on the next `session.start` ("last session: 4 files, 2 commits, 1
   denied, longest step 6m12s"; Button opens the Retro view; dismiss clears it). Plus `/session retro`.
5. **Persistence**: `session.end` writes the ledger summary to `$.store` (cross-session); nothing else.

### Data flow

tool/turn events -> ledger (`$.state`) -> `read` while drawing (pane, band) ; turn end -> `classic.Stop`
refreshes task list + one `ps` pass -> orphan atom ; press `[stop]` -> safety checks -> TaskStop or
`kill` -> re-poll -> redraw ; `session.end` -> `$.store`; next `session.start` -> band reads `$.store`.
Diff stats: one `git diff --numstat -- <paths>` per pane open and per turn end, not per edit.

### Orphan-kill safety (the main risk)

- Only pids that are descendants of the engine pid at press time (tree re-walked from a fresh `ps`, never
  from the cached row). The engine pid, its ancestors, and `$.process.run`'s own children are excluded.
- Identity re-check immediately before the signal: same pid AND same command string AND same start time
  as the row the person saw; any difference aborts with a toast (pid reuse).
- SIGTERM only; no `-9`, no process-group or `pkill -f` pattern kills; one pid per press.
- `$.ui.ask` confirmation showing the full command; "Stop all" is not offered.
- Claude-managed tasks go through `TaskStop` only, so Claude Code's own permission layer applies.
- Platform: `ps` columns differ on Windows; there the OS-process section is hidden (list and kill off).

### Error handling

- Headless (`surfaces() == 0`): no pane, band, toast or timers; the ledger still runs and `session.end`
  still writes `$.store`, so a `-p` run leaves a retro for the next interactive start.
- No git / not a repo: commits and `+/-` stats are omitted, file list falls back to touched paths
  (stat via `$.fs.stat`; a missing file is shown as "deleted"). No error toast.
- Process already gone (kill exit 1, `ESRCH`) or task already ended: treated as success, row removed.
- Permission refused (`TaskStop` denied, `kill` EPERM): toast the reason, keep the row.
- `session.end` has one short shared wall-clock bound: write only the precomputed summary, no `git`/`ps`.
- `/clear` ends a session with no new `session.start`: summary saved on `session.end`, ledger reset in place.
- `ps`/`git` slow or failing: each call has `timeoutMs`; failure leaves the previous value and never throws.
- Hot reload resets module variables: all durable data lives in `$.state` / `$.store`, none in closures.

### Testing (`claude plugin test session`, plus `claude plugin validate`)

1. Ledger: Edit/Write events add paths once; a `git commit` Bash call is counted; a deny from a hook
   beneath is counted; two overlapping steps give the right longest.
2. Process walk: fixed `ps` text -> descendants only; a wrapper shell and its child count once; a sibling
   `claude -p` outside the engine tree is not listed.
3. Kill safety: stale row (command or start time changed) -> no signal; engine pid / ancestor -> refused;
   already-gone pid -> row cleared, no error; confirmation declined -> no signal.
4. Headless: `surfaces()` empty -> no `$.ui.*` call, `session.end` still stores.
5. No-git cwd: stats absent, no throw. Both `command.run` matchers use `{ command }` (spike finding).
6. Manual, interactive: pane opens at < 144 cols via `/session`; band shows after restart; `[stop]` on a
   real `sleep 300` started with `run_in_background` and on a real `claude -p` child.

## What moves out of `mods` (feature 9) and migration

Moves: the `turn.complete` hook, `countClaudeP`, `CLAUDE_P`, and their tests in `mods/hooks/mod.test.ts`;
the "claude -p child(ren) running" status. Everything else in `mods` stays.

1. `session` ships first with the same count as a status line entry (feature parity before removal).
2. Then `mods` is cut by a version bump (`0.1.0-beta.3`) that deletes feature 9; both READMEs and KORs note
   "moved to `session`". Users of `mods` who do not install `session` lose the status: say so in the notes.
3. Both installed at once would double-write the status line; the order above avoids it.
4. New marketplace entry for `session` in `.claude-plugin/marketplace.json`; README + KOR together.
   Version/push follow the held-push rule: bump and push only on the user's say-so.

## Done-criteria

- [ ] `claude plugin validate session` passes with no warnings about ungated hooks or matcher keys.
- [ ] `claude plugin test session` passes all cases in Testing 1-5.
- [ ] Manual: `/session` opens one pane with Retro, Orphans, Files views switched by buttons or keys 1/2/3.
- [ ] Manual: `[stop]` ends a real background shell via TaskStop and a real `claude -p` child via SIGTERM;
      a pid whose command changed is NOT signalled (test 3).
- [ ] A `-p` run leaves a `$.store` summary; the next interactive start shows the band once.
- [ ] No file of `session/` imports or names any other plugin or skill of this repo.
- [ ] `mods` no longer contains feature 9; its tests pass without it; READMEs and KORs match.
- [ ] No function in `session` takes longer than a tick on the main hook path (`ps`/`git` only in timers,
      turn end and pane open).

## Critique

1. **YAGNI.** Three views plus a band is the ceiling. Cut candidates, in order: the OS-process allow-list
   (hardcode `claude -p`), the Files view (Critique 2), the persisted band (keep `/session retro` only).
2. **Native overlap.** Claude Code ships `/diff` (uncommitted changes and per-turn diffs, with a diff-base
   cycle) and `/tasks` (background shells/agents, with stop). Files view: native `/diff` already shows richer
   diffs; ours differs only by scope ("touched by Claude this session", not repo-dirty) and by feeding the
   retro. A Link `href` is drawn by the surface; the API cannot open an editor, so "click opens the file"
   is a `file://` link whose behaviour the terminal decides (unproven). Recommendation: DROP the Files
   view and keep its list as a section of Retro, unless the user wants the scope difference. Orphans: `/tasks`
   covers Claude-managed tasks, so our value there is `claude -p` children and non-managed processes; the
   Claude-managed rows are a convenience only, and stale between turns (Stop snapshot).
3. **Risk.** Killing the wrong process: mitigated above, residual risk is pid reuse inside the confirm
   window (identity re-check narrows it to milliseconds). `$.process.run` runs unsandboxed on the host.
4. **API gaps (plain).** No live task list API (Stop snapshot only); no Tabs element; no "open in editor";
   no UI at `session.end` (the terminal is gone), hence the next-start band; no per-step timing event
   proven in spikes (`turn.step` assumed, needs a spike); denied-by-the-user dialog choices are visible only
   through `tool.check`/`tool.call` results, unproven for the interactive dialog.
5. **Assumed, not proven:** engine pid via `sh -c 'echo $PPID'` (already used by `mods`); `classic.Stop`
   reachable from a module under the team-policy plugin that skipped `skill.prompt` in the trophy spike.

## Open questions

1. Name: `session` is generic and shadows the `$.session` noun in docs; alternatives `wrapup`, `afterparty`?
2. Drop the Files view (Critique 2) or keep it as a tab?
3. Retro card when the person exits: next-start band only (as designed), or also write a one-line file in
   the repo/home for people who never reopen? (default: no file)
4. Is Windows out of scope for the OS-process section?
5. OK to spend a small Task 0 spike first (`classic.Stop` from a module, `turn.step` timing, `file://` Link)?

## Decisions (2026-10-08, approved in brainstorming)

- Plugin name stays `session`; the guard and memo bundles ship as separate modules inside it.
- Files tab dropped (native `/diff` covers it); the touched-file list lives in the Retro tab only.
- Orphan watcher focuses on non-managed children (`claude -p` etc.); Claude-managed tasks get a pointer to native `/tasks`, no duplicate list.
- Retro shows as a band on the next `session.start` and via `/session retro`; no retro file in v1.
- Windows is out of scope for v1; the OS-process section is hidden there.
- Task 0 spike first (shared with guard/memo/teams report): `classic.Stop` from a module, `turn.step` timing, `file://` Link, pane scroll, `prompt.context` after auto-compaction, `$.ui.ask` under bypass.
- Build order: 2nd of four.
