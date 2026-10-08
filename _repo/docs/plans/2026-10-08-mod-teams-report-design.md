# teams mod: end-of-run report card and Report tab (design)

Stage: plan + critique of the repo's Design Changes rule. No code before user approval.
Governing docs: `plan/mod/README.md` (shared rules), `plan/mod/02-teams-live.md`,
`_repo/docs/plans/2026-09-28-teams-cards-everywhere.md` (teams principles).

## Context

The teams live mod (`teams/hooks/mod.tsx`) shows a band, a status line, toasts and a pane
(Summary / Work / Log) while a run is going. When a run ends, `teams/mcp/docs.mjs` writes
`<docs_dir>/<epic key>/80-report.md` (`renderReport` for a finished task, `renderBlockedReport`
for a blocked one) and `retro.json` beside it (paths from `docPaths` in `tickets.mjs`; the
docs dir is configurable, default from `TEAM_DEFAULTS.docs_dir`). Today the person gets that
report only as the chat relay and a one-line `E-<id8> finished: <state>` toast.
Decided in brainstorming: option 3+1, a card at the end of a run plus a Report tab.

## Problem

A finished or blocked run ends as one toast line, so the person must ask the model to relay a
report that is already on disk, and cannot see in one glance what failed or what needs them.

## Design

### Architecture

- Chat relay of the report is untouched. The mod is an extra surface (plan/mod rule 1: removing
  the `modules` line loses nothing). Interactive sessions only (rule 2).
- Data stays in node, like Summary: `view.mjs --once` gets one more format (name TBD, e.g.
  `report`) built by a pure function in `teams/scripts/lib/` (sibling of `view-summary.mjs`).
  It resolves the task dir via `docPaths`, so a custom `docs_dir` works, and reads
  `80-report.md` and `retro.json`. The mod never guesses paths and never parses markdown.
- The mod calls it with `$.process.run` and stores the result in `$.state` (atom declared in
  `teams/types/index.d.ts`), same pattern as `summary`.

### Components

1. **End-of-run card.** Fires once per task when the tick sees the run end (`complete` or
   blocked; the ledger already emits `daemon_done` for the toast). A band line above the
   prompt, shown until dismissed or the pane's Report tab has been viewed: verdict word
   (finished / blocked), failed count, up to 3 "needs you" items, one `report` button.
   Verdict wording comes from `retro.json` and run state, not from parsing the report.
   A one-time toast announces it; the band carries the button because toasts cannot.
2. **Report tab.** A fourth tab beside Summary / Work / Log. The `view` atom gains `report`.
   The button opens the pane (`$.ui.open`, a person's press, so it seats at any width) with
   the tab preselected for that task. Body is a `Markdown` element drawing the report text.
   Header line keeps the existing title and state.
3. **Needs-you extract.** From `retro.json`: unaccepted packages, unresolved defects, open
   questions. For a blocked report (no `retro.json` guarantee), from the "What would move it"
   section of the report; the node function owns this, the mod renders a string list.

### Data flow

tick -> `view.mjs --once --format events` (existing) sees `daemon_done` -> mod marks the task
"ended, card unseen" in `$.state` -> one `--format report` call (once, then on tab open or
when the file's mtime, returned with the payload, changes) -> band card + tab render from the
cached payload. The 3s tick never rereads the report while the tab is closed.

### Error handling

- **Report not written yet** (run ended, report stage still writing / blocked report pending):
  card shows verdict from run state only, no button; tab shows "Report is not written yet";
  next tick retries. No spinner loop beyond the existing tick.
- **Missing or unreadable file, bad JSON in `retro.json`:** payload carries `report: null`
  and/or `retro: null`; card falls back to run-state counts, tab says "No report file for
  this run" (plus the path the node side looked at). Never throws; failure leaves the last
  state, as the tick already does.
- **Run with no report** (size-S, wiki-only, crashed before report, old runs): same as
  missing; no card button. `renderSReport` output is just a report and needs no special case.
- **Huge report:** node side caps text (about 20k chars, far under the 100000 the `Markdown`
  element accepts) and appends a truncation line giving the file path; the full file stays on
  disk. Card extracts are capped at 3 items plus "+n more".
- **Untrusted text:** the report holds model-written text; `Markdown` is the engine's renderer
  (non-http(s)/file links draw as text). Reuse `scrub`-style path stripping only where the
  Summary does; the report itself is shown as written, since it is the plugin's own document.
- **Strings:** all new labels join the one `STRINGS` table (`tabReport`, card verdicts,
  `reportMissing`, `reportTruncated`, `reportButton`), `en` and `ko` keys kept identical by the
  existing type. Report body is shown in whatever language the report was written.
- **Multiple tasks / session restart:** card state is keyed by task id; a task already ended
  before `session.start` gets no card (same cursor rule as toasts), but the tab still works for
  the pane's current task.

### Testing (`claude plugin test`)

- Card: feed events fixture with `daemon_done` complete + fixture report -> band renders
  verdict, failed count, button; blocked fixture -> blocked wording and move-forward items.
- Tab: press `report` -> pane open called, `view` = report, Markdown text equals fixture.
- Edge: missing file, bad JSON, huge file (truncated + path line), not-yet-written (no button),
  ended-before-session (no card), headless (`surfaces()` empty -> no card).
- KO: same fixtures with `language: ko` assert Korean labels; key parity is a type check.
- Guard: run with the `modules` line removed in a plain test of the chat relay is out of scope
  (relay code is unchanged; diff touches no `tm_*` result).
- Node side (plain `test-*.mjs` in `teams/scripts/`): the report-format builder against the
  fixtures above, including custom `docs_dir` and symlinked cwd.

## Done-criteria

1. A completed run shows one card with verdict, failed count, <=3 needs-you items, `report`.
2. A blocked run shows the card with blocked wording and a button when `80-report.md` exists.
3. Pressing `report` opens the pane on the Report tab showing `80-report.md`.
4. Missing, partial, malformed, huge, not-yet-written and no-report cases each render per
   Error handling and never raise; verified by tests.
5. Every new string exists in en and ko; `tsc -p` and `claude plugin validate` pass.
6. No `tm_*`/`team_*` return value, ledger, or chat-relay path changed; removing the `modules`
   line leaves teams behaving as today.
7. teams patch/minor bump with README + KOR updated together (Update Workflow); push on hold
   per the user's standing rule unless told to ship.

## Critique

- Teams principle 2 (author never judges its own work): the card reports the verdict the gate
  and report stages already wrote; it computes no verdict of its own. Keep it that way.
- Principle 5 (work on cards): the card is a surface over data, not a new ledger node; no stage
  or gate added or removed.
- Plan/mod rule 1 (never required): holds; rule 2 (interactive only): holds by the
  `surfaces()` guard; rule 4 (state declared in types): new atoms go in `types/index.d.ts`;
  rule 6 (`$.plugin.root`): node call uses it.
- Risk: duplicate signal (toast + band + status line). Mitigation: one toast, the band card
  replaces the running band once the run ends, status line stays only for "needs you".
- Simpler alternative rejected: mod reads the file itself via `$.fs.read`. Cheaper, but
  duplicates `docPaths` and `docs_dir` logic in a sandbox that cannot import it.
- Later: harness and graph. They need a stable per-run report file (path rule, a verdict
  field, a needs-you list) and a one-line event when the run ends; then the same
  report-format builder and tab pattern apply. Out of scope here.

## Open questions

1. Does the pane scroll a long `Markdown` body, or is the 20k cap the only protection? Needs a
   spike (the types show `$.ui.scroll` for named regions; pane behaviour is not documented).
2. Card dismissal: auto-clear on tab view only, or also a time-out?
3. Show the card for a blocked run even without a button when no report exists yet?
4. Should the Report tab also appear while a run is in progress (showing "not yet")?
5. Include `retro.json` fields in the tab beyond the card extract, or leave them to the report?

## Decisions (2026-10-08, approved in brainstorming)

- The card dismisses when the Report tab is viewed (or on `[×]`); no timeout.
- A blocked run shows the card without a `report` button until a report exists.
- Pane scroll of a long body is checked in the shared Task 0 spike; the ~20k cap stays until then.
- Build order: 1st of four (teams report → session → guard → memo).
