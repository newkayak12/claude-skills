# 06 — teams report: end-of-run card and Report tab

> Produced by write:plans (2026-10-08) from the think:brainstorming session of the same day.
> Owner for execution routing: planning:executing-plans. Steps use checkbox (`- [ ]`) syntax.
> Design-change rule still applies (CLAUDE.md "Design Changes"): this is the plan stage; the
> design (`_repo/docs/plans/2026-10-08-mod-teams-report-design.md`, with its Decisions section)
> was approved by the user on 2026-10-08. No code before this plan is accepted.

**Goal:** when a teams run ends (finished or blocked) the person sees one band card (verdict,
failed count, up to 3 "needs you" items, a `report` button) and can read `80-report.md` in a
fourth pane tab, without asking the model to relay it.

**Architecture:** data stays in node. A pure builder in `teams/scripts/lib/` resolves the task's
report paths with `docPaths` (so a custom `docs_dir` works), reads `80-report.md` and `retro.json`,
and returns one payload; `view.mjs --once --format report` prints it. The mod calls it with
`$.process.run`, keeps it in `$.state`, draws a card in the existing AbovePrompt band and a
`Markdown` body in the pane. Chat relay and every `tm_*`/`team_status` result are untouched.

**Tech stack:** hooks module API 2.1.292 (`ui.render` Pane/AbovePrompt, `$.ui.open`, `$.ui.toast`,
`$.process.run`, `atom/read/update`), `claude plugin validate|test teams`, `tsc -p teams`,
node:test for `teams/scripts/test-*.mjs`.

---

## Decisions fixed by the brainstorming (do not reopen while executing)

- Card dismisses when the Report tab is viewed or on `[×]`; no timeout.
- A blocked run shows the card without a `report` button until `80-report.md` exists.
- One toast per ended task, one `report` call on `daemon_done`, then only while the tab is open
  or the card is waiting for the file; the 3s tick never rereads the report otherwise.
- Verdict wording comes from run state and `retro.json`; the mod computes no verdict (teams
  principle 2) and adds no stage or ledger node (principle 5).
- Report text is capped at about 20000 chars on the node side, plus a line with the file path.
- Task already ended before `session.start` gets no card (same cursor rule as toasts); the tab
  still works for the pane's task.
- Interactive only (`surfaces()` non-empty); removing the `modules` line loses nothing.
- Out: harness/graph reports, `retro.json` fields beyond the card extract.

## File structure

| Path | Owns |
|------|------|
| `teams/scripts/lib/view-report.mjs` (new) | `reportPayload(task, io)`: paths via `docPaths`, caps, needs-you extract |
| `teams/scripts/test-view-report.mjs` (new) | node:test for the builder and the CLI format |
| `teams/scripts/fixtures/report/*` (new) | done, blocked, no-retro, bad-json, huge report fixtures |
| `teams/scripts/view.mjs` (modify) | `--format report [--task <id>]` |
| `teams/types/index.d.ts` (modify) | `ReportPayload`; `report`, `ended` atoms; `view` gains `'report'` |
| `teams/hooks/mod.tsx` (modify) | atoms, STRINGS keys, Report tab, card, fetch logic |
| `teams/hooks/mod.test.ts`, `strings.test.ts` (modify) | UI cases; key parity already asserted |
| `teams/README.md`, `teams/KOR.md`, `teams/CHANGELOG.md` (+ `CHANGELOG.KOR.md`) (modify) | docs |

## Data shapes (used by every task below)

```ts
// view.mjs --once --format report --task <id>  (stdout, one JSON line)
type ReportPayload = {
  task_id: string; verdict: 'finished' | 'blocked' | 'running'
  failed: number                       // from run state, not parsed from the report
  needs: { items: string[]; more: number }   // <= 3 items; retro.json, else "What would move it"
  path: string                         // absolute 80-report.md the builder looked at
  report: { text: string; truncated: boolean; mtime: number } | null   // null: missing/unreadable/not yet written
  retro: object | null                 // null: missing or bad JSON
}
// $.state teams.report: ReportPayload | null ; teams.ended: Record<taskId, 'card' | 'seen' | 'dismissed'>
```

---

### Task 1: Report payload builder (pure)
**Files:** create `teams/scripts/lib/view-report.mjs`, `teams/scripts/test-view-report.mjs`, `teams/scripts/fixtures/report/` (fixtures).
**Interfaces:** `reportPayload(task, { read = readFileSync, stat = statSync }) → ReportPayload`;
paths from `docPaths(task)` (`mcp/tickets.mjs`: `report`, `retro`); text capped at 20000 chars
with a trailing line naming `path`; needs-you from `retro.json` (unaccepted packages, defects
left, open questions — confirm field names against `renderRetro` in `mcp/docs.mjs` while writing
the fixture) or, for blocked, the `## What would move it` section of the report
(`renderBlockedReport`); every read failure becomes `null`, never a throw.
**Blocked by:** none.
**Pass bar:** `node --test teams/scripts/test-view-report.mjs` green with: done fixture (verdict,
failed count, 3 items + `more`); blocked fixture (items from the report section); no `retro.json`
→ `retro: null` and report still returned; bad JSON → `retro: null`; no report file →
`report: null`, `path` still set; 30k-char report → `truncated: true`, text ends with the path
line; custom `docs_dir`; cwd reached through a symlink resolves to the same file.

- [ ] 1: tests (red) → 2: implement → 3: green → 4: commit

### Task 2: `view.mjs --once --format report`
**Files:** modify `teams/scripts/view.mjs` (usage text, `--format` branch next to `summary`);
extend `teams/scripts/test-view-report.mjs`.
**Interfaces:** `node view.mjs --once --format report --task <id> [--cwd <dir>]` prints one
`ReportPayload` JSON line via `collectTask` + `reportPayload`; unknown or unreadable task prints
`{"task_id":…,"report":null,"retro":null,…}` with exit 0 (the mod treats it as "no report").
**Blocked by:** Task 1.
**Pass bar:** the spawned-CLI test reads a fixture tasks dir and returns the Task 1 payload;
`node --test teams/scripts/test-view.mjs teams/scripts/test-view-summary.mjs teams/scripts/test-view-events.mjs`
still green (existing formats unchanged).

- [ ] 1: tests (red) → 2: implement → 3: green → 4: commit

### Task 3: Report tab (pane shows `80-report.md`)
**Files:** modify `teams/types/index.d.ts`, `teams/hooks/mod.tsx`, `teams/hooks/mod.test.ts`.
**Interfaces:** add `ReportPayload`; atoms `report`; `view` union gains `'report'`; STRINGS keys
`tabReport`, `reportMissing`, `reportTruncated` (en + ko). Pane tabs become Summary / Work / Log /
Report. When `view === 'report'` and the pane is open, the tick calls
`node $.plugin.root/scripts/view.mjs --once --format report --task <paneTask> --cwd <cwd>` and
stores the payload; body is `<Markdown>` of `report.text`; `report: null` shows `reportMissing`
with `path`. Refetch only while the tab is open (mtime in the payload is the change check).
**Blocked by:** Task 2; 05 Task 1 (S1: pane scroll of long Markdown) — if the pane does not
scroll, lower the 20000 cap in Task 1's builder to the size S1 shows is readable, or open the
report from the card with a note naming the file path instead.
**Pass bar:** `claude plugin test teams` green with new cases looped over `['terminal','desktop']`:
pressing Report fetches once (argv contains `--format report`) and the pane draws the fixture text
verbatim; a second tick with the tab open and an unchanged mtime still draws the same text;
with the tab closed no `--format report` call is made; `report: null` draws the missing line;
`tsc -p teams` clean; `strings.test.ts` green.

- [ ] 1: tests (red) → 2: implement → 3: green → 4: commit

### Task 4: End-of-run card and button
**Files:** modify `teams/hooks/mod.tsx`, `teams/types/index.d.ts` (`ended` atom), `teams/hooks/mod.test.ts`.
**Interfaces:** in the tick, an event with `kind === 'daemon_done'` for task T (and `ts` after
the session cursor) sets `ended[T] = 'card'`, fires one `report` fetch for T, and keeps the
existing one-line toast. AbovePrompt: while any `ended[T] === 'card'` and the run is not
running, replace the running band with one line: verdict word (finished / blocked), `failed n`,
up to 3 needs items (`+n more`), `[report]` (only when `report.report !== null`) and `[×]`.
`[report]` → `$.ui.open` (seats at any width), `view = 'report'`, `ended[T] = 'seen'`; `[×]` →
`'dismissed'`. Opening the Report tab by any path also sets `'seen'`. New STRINGS keys:
`cardFinished`, `cardBlocked`, `cardFailed`, `cardMore`, `reportButton`, `dismiss` (en + ko).
**Blocked by:** Task 3.
**Pass bar:** UI cases (both surfaces): `daemon_done` complete + done fixture → band shows verdict,
failed count, 3 items, `report` button and exactly one extra fetch; blocked fixture → blocked
wording and its items; `[report]` press → `ui.open` called, tab is Report, card gone; `[×]` → card
gone, no open; the status line text is unchanged (`needs you: n waiting` only when n>0).
`claude plugin test teams` green.

- [ ] 1: tests (red) → 2: implement → 3: green → 4: commit

### Task 5: Edge states and the no-regression guard
**Files:** modify `teams/hooks/mod.tsx`, `teams/hooks/mod.test.ts`.
**Interfaces:** not-yet-written (`report: null`, run ended): card shows verdict and counts, no
button, and the next ticks refetch until the file appears (then the button appears); card for a
task already ended at `session.start` is never created; no surfaces → no fetch, no card. A throw
or non-zero exit from the report call leaves the previous payload (as the tick already does).
**Blocked by:** Task 4.
**Pass bar:** cases: blocked + not-yet-written → card without a button, then after the fixture
file appears the button shows; missing file and bad `retro.json` → card falls back to run-state
counts, tab shows `reportMissing` with the path; 30k fixture → tab text ends with the path line;
ended-before-session → no card; `surfaces()` empty → 0 `process.run` calls (existing headless
case still green); a `process.run` failure leaves the card as it was; KO: the same done fixture
with `language: ko` draws the Korean card labels. Diff check: `git diff --stat -- teams/mcp
teams/hooks/dispatch-gate.mjs` is empty (no `tm_*`, ledger or relay change). `claude plugin
validate teams`, `claude plugin test teams`, `tsc -p teams` all clean.

- [ ] 1: tests (red) → 2: implement → 3: green → 4: commit

### Task 6: Docs
**Files:** modify `teams/README.md` and `teams/KOR.md` (Mod section: add the card, the Report tab
and the "interactive only, nothing lost without it" line; English default and Korean mirror move
together), `teams/CHANGELOG.md` and `teams/CHANGELOG.KOR.md` (one entry, same wording rules as
v0.45.x lines).
**Blocked by:** Task 5.
**Pass bar:** `python3 _repo/scripts/validate_plugins.py` PASSED; both Mod sections name the same
features (diff of headings and bullet counts equal); `claude plugin test teams` green; a real
interactive session with `--plugin-dir teams` on a finished and a blocked demo run shows the card
and the tab (excerpt saved under `.harness-run/teams-report/`).
**On hold, not part of this plan's done:** the teams version bump in
`.claude-plugin/marketplace.json` and `git push origin main` wait for the user's say-so
(standing rule: hold push and version bump). Commit the docs only.

- [ ] 1: docs → 2: all checks → 3: real session → 4: commit (no bump, no push)

## Unresolved

- `retro.json` field names for "unaccepted packages / defects / open questions" are taken from
  the design; Task 1 fixes them against `renderRetro`. If a field is absent for finished runs,
  the card shows fewer items rather than inventing them.
- 05 Task 1 (S1) may change the cap or force a "path only" fallback; Task 3 owns that call.
- Plan file `05-spike-2.md` does not exist yet; "05 Task 1" is cited by the name given.
