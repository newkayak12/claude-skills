# 07 — session: retro card and orphan watcher (new plugin)

> Produced by write:plans (2026-10-08) from `_repo/docs/plans/2026-10-08-mod-session-design.md`.
> Owner for execution routing: planning:executing-plans. Steps use checkbox (`- [ ]`) syntax.
> Design-change rule still applies (CLAUDE.md "Design Changes"): this is the plan stage; the
> design and its "Decisions" section were approved by the user on 2026-10-08.

**Goal:** a person in any repo sees what a session left behind (files changed, commits, denied
calls, longest step) in a `/session` pane and as a band on the next start, sees which `claude -p`
children are still alive, and can stop one safely. `mods` feature 9 then moves here.

**Architecture:** new top-level plugin `session` with one hooks module `mod.tsx` that only wires
events and drawing; pure logic in sibling `.ts` files. `hooks/hooks.json` lists `modules`, so the
guard (plan 08) and memo (plan 09) add their own `*.tsx` module and a shared `PluginState['session']`
slice without touching this one's files. A ledger in `$.state` feeds a two-tab pane (Retro, Orphans);
`session.end` writes a summary to `$.store`; the next `session.start` shows it as a band.

**Tech stack:** hooks module API 2.1.293 (`tool.call`, `turn.step`, `turn.complete`, `classic.Stop`,
`session.start|end`, `command.run`, `ui.render` Pane/AbovePrompt, `$.state`, `$.store`,
`$.process.run`, `$.ui.ask|toast|status|open`, `$.clock`, `$.command.register`), `claude plugin
validate|test`, `tsc -p`.

---

## Decisions fixed by the brainstorming (do not reopen while executing)

- Name `session`; guard and memo ship as separate modules inside it (plans 08, 09).
- Files tab dropped (native `/diff`); the touched-file list is a section of Retro only. No `file://` Link unless 05 Task 5 (S5) proves it, then it is an optional polish, not a task here.
- Orphans: non-managed children (`claude -p`) only. Claude-managed tasks get a one-line pointer to native `/tasks`, no duplicate list and no TaskStop call.
- Retro: band on next `session.start` and `/session retro`; no retro file in v1.
- Windows out of scope: OS-process section hidden, kill off.
- Kill safety is the main risk (Task 5): see its bar; one pid per press, SIGTERM only, no "Stop all".
- Shared rules of `plan/mod/README.md`: interactive-only UI, every hook ends `.catch(($, e, next) => next(e))`, `command.run` matchers use `{ command }`.
- No file of `session/` imports or names any other plugin or skill of this repo. No `userConfig`.
- Build order: 2nd of four (after 05). Version bump and push stay ON HOLD for the user's say-so.

## Spike dependencies (plan `05-spike-2.md`) and fallbacks

- `turn.step` timing, deny visibility: 05 Task 4 (S4: classic.Stop/background_tasks + turn.step timing). Fallback: longest
  step = longest gap between `tool.call` events in a turn via `$.clock`, labelled "longest gap"; denied counts only denials seen by this module.
- `file://` Link: 05 Task 5 (S5: file:// Link). Fallback (the plan's default): paths are plain Text.
- `classic.Stop` is not used (Claude-managed rows dropped); `$.ui.ask` under bypass: a declined or unanswerable ask means no signal.

## Layout

`session/`: `.claude-plugin/plugin.json`, `hooks/hooks.json` (`modules` list; 08/09 append theirs), `hooks/mod.tsx`
(wiring + drawing only), `hooks/{ledger,procs,kill}.ts` (pure), `hooks/testkit.ts`, `hooks/*.test.ts`,
`types/index.d.ts`, `tsconfig.json` (copy of trophy's), `README.md`, `KOR.md`. State: `$.state.session` =
`{ ledger: { files; commits; denied; steps }; orphans; tab: 'retro'|'orphans'; engine?; band }`; `$.store['session.last']`
= `{ day; files; commits; denied; longestMs; fileList }`.

---

### Task 1: Plugin skeleton with room for 08 and 09
**Files:** create `session/.claude-plugin/plugin.json`, `session/hooks/hooks.json`,
`session/hooks/mod.tsx`, `session/hooks/testkit.ts`, `session/types/index.d.ts`, `session/tsconfig.json`,
`session/hooks/skeleton.test.ts`.
**Interfaces:** `register` only does `session.start`: interactive? set `state.session` defaults
(`ledger` empty, `tab: 'retro'`, `band: false`), register `/session`. The `PluginState['session']`
type is declared once here; later plans extend it by adding optional keys, never by editing these.
**Blocked by:** none.
**Pass bar:** `claude plugin validate session` clean; `tsc -p session` clean; test: `surfaces()` empty
→ no command registered; interactive → `/session` registered and defaults set; second start keeps them.

- [ ] 1: tests (red) → 2: implement → 3: green + validate + tsc → 4: commit

### Task 2: Session ledger
**Files:** create `session/hooks/ledger.ts`, `session/hooks/ledger.test.ts`; modify `mod.tsx`.
**Interfaces:** `addFile(ledger, path)` (dedupe), `addCommit(ledger, bashCmd, out)` (only `git commit`
with exit 0, hash + subject from the output), `addDeny`, `stepSpan(steps) → longestMs`. Hooks:
`tool.call` Edit/Write/NotebookEdit → path; Bash → commit; `await next(e)` result `deny` → denied;
`turn.step` → step start/end via `$.clock` (fallback per 05 Task 4). Hooks always return `next` result
unchanged. Runs headless too (no UI).
**Blocked by:** Task 1; 05 Task 4 (S4) for step timing (fallback in the table above).
**Pass bar:** tests (design Testing 1): same path twice → once; `git commit -m x` counted, `git status`
not; a deny from beneath counted with tool+reason; two overlapping steps give the right longest; a
throwing `$.state` write → the tool call result still returned.

- [ ] 1: tests (red) → 2: implement → 3: green → 4: commit

### Task 3: Retro pane (`/session`, view 1) with diff stats
**Files:** modify `mod.tsx`; create `session/hooks/pane.test.ts`.
**Interfaces:** `command.run { command: 'session' }` opens pane `session` via `$.ui.open`; a
`ui.render` on `{ component: 'Pane', requestId: 'session' }` draws Retro: files (with `+a -d` from one
`git diff --numstat -- <paths>` per pane open and per turn end, in `$.process.run`, never in the draw),
commits, denied, longest step. Tab row of Buttons `Retro [1]` / `Orphans [2]` (hotkeys 1/2, `tab` in
state; the Orphans view is stubbed "none" until Task 4). No git → stats omitted, no throw.
**Blocked by:** Task 2.
**Pass bar:** UI test (both `terminal` and `desktop` surfaces): ledger fixture → rows show 2 files,
1 commit, 1 denied, longest `6m12s`; pressing tab 2 flips `tab`; cwd without git → no `+/-` text and no
throw; render runs no process (spy on `$.process.run` = 0 calls during `ui.render`).

- [ ] 1: tests (red) → 2: implement → 3: green → 4: commit

### Task 4: Orphan list (view 2)
**Files:** create `session/hooks/procs.ts`, `session/hooks/procs.test.ts`; modify `mod.tsx`,
`pane.test.ts`.
**Interfaces:** `parsePs(text) → Row[]` (`ps -A -o pid=,ppid=,lstart=,command=`), `descendants(rows, engine)`,
`matchOrphans(rows, engine)` with the `claude -p` regex lifted from `mods`; a wrapper shell and its child count once.
Engine pid via `sh -c 'echo $PPID'`, cached. Poll on `turn.complete` and pane open only. Windows → section hidden,
no `ps`. View: one row per orphan (pid, clipped cmd, age, `[stop]` wired in Task 5) + a line "background shells and
subagents: see /tasks".
**Blocked by:** Task 3.
**Pass bar:** tests (design Testing 2) on fixed `ps` text: descendants only; wrapper+child = 1 row; a
`claude -p` sibling outside the engine tree absent; garbage line skipped; Windows → no process call and
no section; pane shows the `/tasks` pointer.

- [ ] 1: tests (red) → 2: implement → 3: green → 4: commit

### Task 5: Safe stop (kill safety)
**Files:** create `session/hooks/kill.ts`, `session/hooks/kill.test.ts`; modify `mod.tsx`.
**Interfaces:** `checkKill(seen: Orphan, fresh: Row[], engine, ancestors) → { ok: true; pid } | { ok: false; reason }`.
`[stop]`: fresh `ps` → re-walk the tree from `engine` (never the cached rows) → `checkKill` (pid still below engine;
same pid AND cmd AND start as the row the person saw; not engine, not an ancestor, not `$.process.run`'s own child)
→ `$.ui.ask` with the full command → a second fresh `ps` + `checkKill` → `$.process.run(['kill','-TERM',pid])`. One
pid per press; no `-9`, process group or `pkill`. Refusal → `$.ui.toast(reason)`, no signal; gone pid → row cleared.
**Blocked by:** Task 4.
**Pass bar:** tests (design Testing 3) asserting `$.process.run` calls: stale cmd → no `kill`; stale start time (pid
reuse) → no `kill`; engine pid and an ancestor → refused; pid gone → row cleared, no throw; ask declined → no `kill`;
pid changed between ask and signal → no `kill`; happy path → exactly one `['kill','-TERM','<pid>']`. Manual (in the
commit message): `[stop]` ends a real `claude -p` child; a plain `sleep 300` is never listed.

- [ ] 1: tests (red) → 2: implement → 3: green → 4: commit

### Task 6: Retro persistence, next-start band, `/session retro`
**Files:** modify `mod.tsx`, `ledger.ts`; create `session/hooks/retro.test.ts`.
**Interfaces:** `summarize(ledger, today) → session.last`. `session.end` (headless too) stores it if the ledger has
anything. Next interactive `session.start` reads it → `band = true`; `ui.render { component: 'AbovePrompt' }` draws "last
session: 4 files, 2 commits, 1 denied, longest step 6m12s" + `[Retro]` and `[dismiss]` (clears the key); `next(e)`
untouched when `band` is false. `/session retro` opens Retro from the stored summary when the live ledger is empty.
**Blocked by:** Task 3.
**Pass bar:** tests (design Testing 4): headless (`surfaces()` empty) run → zero `$.ui.*` calls and
`session.end` still stores; a stored summary + interactive start → band row with the right numbers,
`[dismiss]` → band gone and key deleted, a second start → no band; empty ledger → nothing stored; a
broken store → no throw.

- [ ] 1: tests (red) → 2: implement → 3: green → 4: commit

### Task 7: Status-line parity, then remove `mods` feature 9 (contract step)
**Files:** 7a: modify `session/hooks/mod.tsx`, `session/hooks/pane.test.ts`. 7b (separate later commit): `mods/hooks/mod.tsx`
(delete `CLAUDE_P`, `countClaudeP`, the `turn.complete` hook), `mods/hooks/mod.test.ts` (their tests), `mods/README.md`,
`mods/KOR.md` (row 9 → "moved to `session`"; `mods` users without `session` lose the status).
**Interfaces:** 7a (expand): at turn end `$.ui.status(n > 0 ? '<n> claude -p child(ren) running' : undefined)` from the
Task 4 poll, same text as `mods`. 7b (contract) only after `session` ships, never in one release with 7a (double status
write). The `mods` bump to `0.1.0-beta.3` is ON HOLD.
**Blocked by:** Tasks 4 and 6 for 7a; 7b by 7a being released (user's say-so).
**Pass bar:** 7a: 2 `claude -p` rows → status `2 claude -p child(ren) running`, 0 → `undefined`, headless → no status
call. 7b: `claude plugin test mods` and `validate mods` green, `grep -rn "countClaudeP\|CLAUDE_P" mods/` empty, READMEs and KORs agree.

- [ ] 1: 7a tests (red) → 2: implement → 3: green → 4: commit → 5: STOP until session is released → 6: 7b edit + grep + tests → 7: commit (no push)

### Task 8: Docs and listing (final)
**Files:** create `session/README.md`, `session/KOR.md` (what it shows, the `/session` pane, retro band,
orphan stop and its safety rules, Windows hidden, headless leaves a summary, the `/tasks` and `/diff`
pointers); modify `.claude-plugin/marketplace.json` (add `session` 0.1.0, category `productivity`, same
entry shape as `trophy`), root `README.md` (one listing row).
**Blocked by:** Tasks 1–6 (7a for the parity note).
**Pass bar:** `claude plugin validate session` and `claude plugin test session` green; `tsc -p session`
clean; `python3 _repo/scripts/validate_plugins.py` PASSED; `grep -rniE "trophy|teams|harness|mods"
session/hooks session/.claude-plugin` finds nothing (standalone); README and KOR carry the same sections.
Version bump and push stay ON HOLD for the user's say-so.

- [ ] 1: docs → 2: all checks → 3: manual run from the design (Testing 6) → 4: commit (no push)

## Gap check

Design to task: ledger 2, pane and diff stats 3, orphans and Windows hiding 4, kill safety 5, band/store/headless 6, mods move 7, docs 8, room for 08/09 1.

**Unresolved:** `$.ui.ask` under bypass (confirm 05 covers it); `turn.step` and denied-by-dialog visibility need 05 Task 4.
