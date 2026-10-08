# 09 — session/memo: pinned user notes that survive compaction

> Produced by write:plans (2026-10-08) from `_repo/docs/plans/2026-10-08-mod-memo-design.md` (approved).
> Owner for execution routing: planning:executing-plans. Steps use checkbox (`- [ ]`) syntax.
> **Lowest-value plan of the set: cut first if scope shrinks.** Nothing else depends on it.

**Goal:** a user types `/memo add <text>` mid-session and the note reaches the model in every
conversation of that project (and after `/compact` and `/clear`), visible in a read-only pane.

**Architecture:** a module `session/hooks/memo.tsx` in the `session` plugin (skeleton from
`07-session.md`). Pure functions in `memo-logic.ts` (caps, render, age) are the testable core.
Notes live in `$.store`; a `prompt.context` hook appends one block; every write calls
`$.ui.invalidate('prompt.context')`.

**Tech stack:** hooks module API 2.1.293 (`prompt.context`, `$.ui.invalidate`, `$.command.register`,
`command.run` `{ text }`, `$.store`, `$.session.root()`, `ui.render` Pane, `$.ui.toast`), `claude plugin validate|test`, `tsc -p`.
Test helpers: reuse `session/hooks/testkit.ts` from 07 Task 1 (`memoryStore`, `sessionAt`).

---

## Decisions fixed by the design (do not reopen while executing)

- Scopes: **project + global only** (session scope dropped in v1). Project key = `$.session.root()`.
- `/memo` is the only writer; the pane is read-only; no model tool. Injected order: global, then project.
- Caps: 8 notes, 280 chars each, 1200 total. Over cap: `add` refused (text result + toast), store untouched, never truncated silently.
- Block: fixed header "User pinned notes, authoritative, set by the user", one line per note with scope tag, no markdown.
- Age hint at 14 days (pane + `/memo list`). Corrupt or unreadable store = empty, never throws into the prompt path.
- Every hook fails open (`.catch(($, e, next) => next(e))`).

## File structure

| Path | Owns |
|------|------|
| `session/hooks/memo.tsx` (new) | hooks, `/memo` command, pane |
| `session/hooks/memo-logic.ts` (new) | `addNote`, `removeNote`, `render`, `ageHint`, caps constants |
| `session/hooks/memo-*.test.ts` (new) | `claude plugin test` cases |
| `session/hooks/hooks.json` (modify) | append `"./memo.tsx"` to `modules` |
| `session/types/index.d.ts` (modify) | add `PluginState['memo']` |
| `session/README.md`, `KOR.md` (modify) | memo section |

```ts
// $.store keys (cross-session)
'memo.global'            : Note[]
`memo.project:${root}`   : Note[]
type Note = { text: string; ts: number }      // text trimmed, 1..280 chars
```

---

### Task 1: `/memo add|list|rm|clear` with caps (store only, no injection)
**Files:** create `memo-logic.ts`, `memo.tsx`, `memo-commands.test.ts`; modify `hooks.json`, `types/index.d.ts`.
**Interfaces:** `/memo add [--global] <text>`, `list`, `rm <n>`, `clear [--global]` return `{ text }` (works headless). `render(global, project): string` is the exact block (header + lines `[global] text` / `[project] text`), `''` when empty. `list` prints `render` plus count `N/8`.
**Blocked by:** 07 skeleton task (plugin.json, hooks.json `modules`, types, tsconfig).
**Pass bar:** `claude plugin test` green: add then list shows the note; 9th note, 281-char note, and a note pushing the total past 1200 each return a text naming the limit and leave the store byte-identical; `rm 1` and `clear` remove; unknown subcommand returns usage; `tsc -p session` clean; `claude plugin validate session` green.

- [ ] 1: tests (red) → 2: `memo-logic.ts` → 3: command handler + register in `session.start` → 4: append to `modules` → 5: green → 6: commit

### Task 2: Injection via `prompt.context` (blocked by spike S2)
**Files:** modify `memo.tsx`; create `memo-inject.test.ts`.
**Interfaces:** `on('prompt.context')` appends one block `memo` after core blocks when `render(...)` is non-empty, else returns the input unchanged; each write in Task 1 calls `$.ui.invalidate('prompt.context')`. A thrown store read returns input unchanged and toasts once (interactive only).
**Blocked by:** Task 1; **`05-spike-2.md` Task 2 (S2: `prompt.context` re-fires after auto-compaction and `/clear`, and `invalidate` takes effect on the next prompt).**
**Pass bar:** tests: empty store gives result equal to input; one project note gives the block after the core blocks with header and scope tag; re-firing the hook after a simulated compact gives an identical block; `rm`/`clear` invalidate and the block disappears; corrupt store value returns input with no throw. Live: with `claude --plugin-dir session`, `/memo add use staging DB`, then ask "which DB do I use?", answer says staging; same after `/compact`.
**If S2 = NO** (no re-fire after compaction): fall back to `prompt.submit` `context` injected once per conversation, re-injected when `session.start` fires with a `compact` or `clear` source (or on every Nth turn if no marker exists); note that Task 2's cost claim ("once, cached") no longer holds and the cap stays the only bound. If neither works, ship Task 1 + 4 only (a visible pinboard) and record the plan as not meeting its goal.

- [ ] 1: tests (red) → 2: hook + invalidate calls → 3: green → 4: live check above → 5: commit

### Task 3: Scopes (global vs project)
**Files:** modify `memo-logic.ts`, `memo.tsx`; create `memo-scope.test.ts`.
**Interfaces:** project notes keyed by `$.session.root()`; global shared; injection order global then project; caps apply per combined set (8 notes, 1200 chars total across both); a hand-edited store over cap is truncated at a note boundary on render and `list` flags it.
**Blocked by:** Task 2.
**Pass bar:** tests: project A note absent when root is B, global present in both; `--global` writes the global key; combined cap refuses a project add when global already holds 8; over-cap store renders only whole notes and `list` says "truncated".

- [ ] 1: tests (red) → 2: implement → 3: green → 4: commit

### Task 4: Read-only pane
**Files:** modify `memo.tsx`; create `memo-pane.test.ts`; extend `session/types/index.d.ts`.
**Interfaces:** `/memo` with no args opens `$.ui.open` Pane "Memo": the byte-identical `render` text, per-note token estimate (chars/4), total vs cap, scope tags, usage line when empty. No inputs, no buttons (decision: read-only).
**Blocked by:** Task 3.
**Pass bar:** golden test: pane text equals the string the `prompt.context` hook injects for the same store; headless run opens no pane and `/memo list` still answers; empty store shows the usage line.

- [ ] 1: golden test (red) → 2: Pane → 3: green → 4: commit

### Task 5: Age hint
**Files:** modify `memo-logic.ts`, `memo.tsx`; create `memo-age.test.ts`.
**Interfaces:** `ageHint(note, now)` returns `''` under 14 days, else `"14d old: move to CLAUDE.md?"`; shown in pane and `list` only, **never** in the injected block (the block stays byte-identical to what the pane's note lines show).
**Blocked by:** Task 4.
**Pass bar:** tests with `sessionAt` clock: 13d no hint, 14d hint; hint absent from the `prompt.context` result at any age.

- [ ] 1: tests (red) → 2: implement → 3: green → 4: commit

### Task 6: Docs (bump and push ON HOLD)
**Files:** modify `session/README.md`, `session/KOR.md` (memo section: commands, caps, scopes, "not CLAUDE.md, not auto-memory", read-only pane).
**Blocked by:** Task 5.
**Pass bar:** both files carry the same section (English and Korean mirror); no version bump, no `marketplace.json` change, no push (standing hold; the user lifts it per shipped stage).

- [ ] 1: write both → 2: diff structure of the two sections → 3: leave uncommitted or commit locally only if asked

## Gap check (design vs tasks)

| Design item | Where |
|-------------|-------|
| commands add/rm/list/clear, caps, refusal | Task 1 |
| prompt.context, compaction survival, corrupt store | Task 2 |
| scope isolation, order, over-cap store | Task 3 |
| pane equals injected block, headless | Task 4 |
| 14-day hint | Task 5 |
| session scope, `/memo scope` | dropped by decision |
| status entry `memo N/8 ~T tok` | **gap**: status-line API unverified; add a small task after 07 settles how `session` shows status, else drop |
| fixed-header wording bench prompt | **gap**: needs a bench run, not covered here |
| project key git root vs `session.root()` | decided: `session.root()`; worktree behaviour untested |
