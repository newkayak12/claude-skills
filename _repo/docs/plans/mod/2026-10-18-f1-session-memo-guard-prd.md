# F1 — Session Memo and Guard panes read as live state (card 43, S)

PRD section for feature area F1 of the "Mods and naming — UI first" backlog. Evidence and the unknowns it rests on: `2026-10-18-f1-session-memo-guard-prd-findings.md` (cited as "findings"). Design: `2026-10-16-mod-detail-and-parallel-runs.md` §3 (session memo mockup), §4 card S, §5 Q6. Rules: `.claude/rules/mod.md` ("A UI change is done when" 0-4, rules 1-7).

Domain: a Claude Code **mod** — an Ink pane in the terminal client, opened by a slash command or a band line, that shows the person what the session plugin holds about the live conversation. Vocabulary specific to it: *pane* and *band line*; *scope* (a memo note rides along in `project` or `global`); *armed / sent* (whether the pinned-notes block has gone out with this conversation); *stale* (a note old enough that it belongs in CLAUDE.md, not a memo); *stop* (a tool call the guard, the person, or Claude Code's own permission check refused); *rule* (the guard's rule id or the `/permissions` rule that caused it); *source* of a stop (`guard`, `declined`, `native`). The generic version of this PRD ("a list view with columns") misses what a person in this terminal expects: a pane read at a glance with nothing said twice, state told by icon and colour first, and keys in one dim footer (mod.md rule 0, from the user's "사람이 보기 좋게!", 2026-10-17).

## Goal

A person who opens the session Memo pane or Guard pane reads the live state in one glance: each memo note on one line with its scope badge, age and stale hint; each guard stop on one aligned row (time · tool · what · rule · source) with the source told by icon and colour before the word; no word said twice, no internal label where a title belongs, keys in one dim footer. Both panes still open and close by their command, Esc and q.

## Problem

- **Memo says its facts in the wrong place and twice.** Each note is drawn once as text, and its facts (number, scope, age, stale hint) are drawn again on a second list below. The age appears as `21 days old` (`ageLabel`) and again as `21d old: move to CLAUDE.md?` (`ageHint`), so a stale note reads "21 days old 21d old", on a different line from the note it describes (findings, "Memo pane today"). The person must match two lists by number.
- **Words said twice and internal labels.** The title word `memo` sits next to the pane title `Memo`; a `close [q]` Button label sits next to a footer that says `Esc, q or /memo closes`; the model-facing block header (`User pinned notes, authoritative, set by the user`) is drawn as if it were a pane title. `memo close [q]` is the example mod.md rule 0 names.
- **Guard is two lines per stop and not aligned.** Each stop is a row (time, tool, call, rule, source word) plus a dim reason line, plus a Copy button, with the source as a word coloured only red or yellow; guard and declined look the same. The brief wants one row per stop with aligned columns, and the source by icon and colour first.
- **No fixture covers "parallel".** A test-only render fixture already exists for minimal, full and narrow (`demo-frames.ts`, `pane-demo.test.ts`) at 190 and 110 columns; the fourth variant the Sprint requires is missing, and its asserts pin the old two-list layout.
- **Stale evidence in the backlog.** Card 43 says README.md and KOR.md still carry "read-only Memo pane". They do not: `grep -i 'read-only'` over both returns nothing (removed in 14683ca7). The wording fix is a check that it stays gone, plus the Memo row and caption brought to the new layout.
- Card 30 (toggle by command, Esc, q) is merged and tested; nothing here may regress it.

## Target users

- **The person driving a Claude Code session** with the session plugin installed. Goal: see in one glance which notes will go to the model with this conversation and which are stale; see what the guard just stopped and why, and copy an allow rule when it was wrong. Today they read two lists and match them by number, or read two lines per stop.
- **The person approving the Sprint.** Approves the look from the demo renders and captures after the Sprint (settled; see Success criteria). They need the renders at both widths and the images in the README.
- **The maintainer** who must keep the plugin testable headless: logic in node/ts with tests, the pane only renders (mod.md "What a mod does not do").

## Solution overview

**Memo.** The pane has a header and one flat list of notes in the existing `/memo list` order (global first, then project), so a row's number is still what `/memo rm <n>` takes. A note is one line: number · scope badge (`project` or `global`) · note text (the flexible column, ends in `…` when cut) · age once, as `<n>d` · a stale hint on notes older than 14 days. The header (the pane title `Memo` is drawn by the host and not repeated) says how many notes ride along, the size against the cap as `<n>/1200 chars` over both scopes, and when the block last went out (`sent 14:02`, or `sent —` while the block is armed to go out again). A cut list shows one short `+<n> not sent` line. One dim footer carries the keys: the three `/memo` forms and Esc, q, `/memo` as the ways to close.

**Guard.** One row per stop, newest first: time (`HH:MM`) · tool · what (the redacted call, flexible, ends in `…`) · rule · source. The source is a mark and colour first and its word second: `✘` red `guard`, `○` dim `declined`, `●` yellow `native`. A row's Copy button stays, last in the row, and the inline reveal line shows the `/permissions` rule when pressed. The reason second line is gone; the rule column carries the cause. The header says the mode and the count (`confirm mode · 3 stopped`) without repeating the pane title. One dim footer carries the keys.

**Demo fixture and captures.** The existing test fixture gains the fourth variant (`parallel`) and its asserts move to the new layout: no wrapped row, no cut glyph, long text ending in `…` at 190 and 110 columns. `memo-pane.png` and `denials-pane.png` are re-taken from fictional demo data; README.md and KOR.md introduce them in one or two lines each. The person approves the look after the Sprint.

## Scope

In: the render of the Memo and Guard panes and the pure functions that feed them (line, badge, age text, stale hint, size label, sent label, source mark and colour); the demo fixture and its tests; the README.md and KOR.md Memo and Guard text and the two images. Every file F1 touches lies under `session/` (the pure logic modules `hooks/memo-logic.ts` and `hooks/guard-logic.ts`, the panes `hooks/memo.tsx` and `hooks/guard.tsx`, the fixture `hooks/demo-frames.ts` with its tests, `README.md`, `KOR.md`, `docs/images/`). Tests that pin the old layout (`memo-age.test.ts`, `memo-logic.test.ts` near line 53, `guard-pane.test.ts`, `pane-demo.test.ts`) are rewritten to the new one, not deleted. Checks: `python3 _repo/scripts/validate_plugins.py`, `node _repo/scripts/check-copies.mjs`, `cd session && claude plugin test .`, counts reported (maintaining.md); the Sprint report states a baseline only if the run actually measured one — findings recorded none.

Constraints taken from the repo rules, as rules: no version bump (settled); render only, nothing the ring, the memo store or the guard's deny decision does changes (mod.md "What a mod does not do"; compat-claude: the deny itself stays a `tool.call` command-hook-class guard); logic in ts with tests, the tsx renders what it returns; mod rules 1-7 hold (interactive only, guards fail open, state in `$.state`, UI is Ink, `{ text }` stays the headless answer); edit with Read/Edit/Write. The three files in `.claude/conventions/` are unfilled templates except "match the surrounding file's idiom", "comments state constraints the code cannot show" and "verified = commands pass and the behaviour exercised end-to-end once"; F1 follows those.

## Out of scope

- **New memo semantics.** The inject and cap rules (`MAX_NOTES` 8, `MAX_CHARS` 280, `MAX_TOTAL` 1200, `AGE_DAYS` 14, global-then-project order), what `/compact` and `/clear` do to `armed` and `sentAt`, and any KB cap or `memo.sentAt` redesign. F1 only reads the existing atom.
- **The cross-session run count on the session band.** Design §5 Q6 (2026-10-16): "memo + guard only" for session.
- **Version bumps.** Settled: batch bump later (maintaining.md); this includes README/KOR status lines and CHANGELOG.
- **Any touch of `draw.tsx`.** Session holds no copy; `check-copies.mjs` has no session entry; the shared icon vocabulary of the harness and graph copies is those areas' concern.
- **The other areas' panes.** Harness (F2), graph (F3) and teams, Floor and stalled tasks (F4).
- **Character faces** (settled) and any new colour or mark outside the plugin's existing set.
- **Changing the Denial ring.** Its size, storage, date column, recording of a confirm answered Run or a person's own "No" in a native dialog, and an `agentId` column.
- **The mockup's other figures.** `3.1 of 8 KB`, `9 days old`, `all`, `3w`, grouping under `This project` and `Every project`, and "Enter on a row" to copy a rule — the code and README are the contract for values; only the mockup's shape is followed.
- **Changing guard decisions, headless behaviour, or the codex overlay.** Mods are Claude-only (compat-codex).
- **A new hotkey for copying a rule.** A Button hotkey takes one digit or lowercase letter and the copy Button has none today; F1 adds none.

## Success criteria

1. In the new render at 190 and 110 columns, every Memo row and every Guard row is exactly one line, and no test line exceeds the width.
2. A note's age and stale state appear once, on its own line; the string pair `days old` and `d old` never appear on the same row.
3. Guard rows' five columns start at the same offset on every row at a given width.
4. Each of the three sources is recognisable by mark alone and by colour alone, and the word is also present.
5. Neither pane shows a word twice in its title, header and footer, nor an internal label (`close [q]`, `memo close [q]`), and each has exactly one dim footer line of keys.
6. Command, Esc and q still toggle both panes (card 30's tests stay green).
7. `grep -in 'read-only' session/README.md session/KOR.md` and `grep -n '읽기 전용' session/KOR.md` match nothing about the Memo pane; `session/docs/images/memo-pane.png` and `denials-pane.png` are newer than this change and show demo data.
8. `cd session && claude plugin test .`, `validate_plugins.py` and `check-copies.mjs` pass, with counts reported, and no `plugin.json`, `marketplace.json` or `CHANGELOG` version field moved.
9. The person approves the look after the Sprint from the demo renders (settled: the Sprint delivers the fixtures and captures; the person approves).

## User stories

### F1-US-1 — Each memo note is one line with its facts
As a person with pinned notes, I read each note on one line with its scope, its age and whether it is stale, so I need not match a second list by number.

Acceptance:
- F1-AC-1: Given a memo with notes in both scopes, When the Memo pane renders, Then each note is exactly one row in the order `/memo list` prints (global first, then project) and the row's number equals the number `/memo rm <n>` takes for that note.
- F1-AC-2: Given a note, When its row renders, Then the row reads, left to right: number · scope badge (`project` or `global`, padded to one width so the text column starts at the same offset on every row) · note text · age · stale hint, and no part of those facts is drawn anywhere else in the pane.
- F1-AC-3: Given a note 21 days old, When it renders, Then its age reads once as `21d` and the row carries a stale hint (`stale?`, warning colour); the old pair `21 days old` plus `21d old: move to CLAUDE.md?` is absent from the whole frame. A note under a day old reads `today` (default - revisit with PO / user at the demo approval).
- F1-AC-4: Given notes at 13, 14 and 15 days, When they render, Then the 13-day note carries no stale hint and the 14- and 15-day notes do (`isStale` is `noteAge >= AGE_DAYS`; the README says "14 days or older"). [확인 필요] The threshold is the code's `AGE_DAYS` = 14 (default - revisit with PO / user; see Q1). The mockup's 9-day example is not used. A unit test pins 13 vs 14.
- F1-AC-5: Given a note whose text is longer than the free width, When it renders at 110 columns, Then the text column ends in `…`, the age and stale hint stay whole, and the row does not wrap.
- F1-AC-6: Given no notes, When the pane opens, Then it shows one plain (not dim) empty-state line `no notes` and the footer; the `usage:` line the pane prints today is not drawn, because it repeats the footer's commands. The headless `/memo` answer (`{ text }`) is unchanged (default - revisit with PO / user).
- F1-AC-7: Given the pane renders for a note, When the model-facing block header text (`User pinned notes, authoritative, set by the user`) is searched in the frame, Then it is absent; the text the model receives is unchanged (default - revisit with PO / user: the header is a block title for the model, not a pane title).

### F1-US-2 — The Memo header gives size against the cap and the send state
As a person, I see how full the memo is and whether it already went out with this conversation, in the header.

Acceptance:
- F1-AC-8: Given visible notes totalling 412 characters over both scopes, When the pane renders, Then the header shows the note count and `412/1200 chars` once, with the title `Memo` said once and no `memo` word elsewhere in the title row. [확인 필요] The cap is `MAX_TOTAL` = 1200 characters over both scopes; no KB figure is shown or invented (default - revisit with PO / user; see Q2).
- F1-AC-9: Given the block went out at 14:02 (existing `sentAt` atom, `armed` false), When the header renders, Then it shows the local send time `14:02`. Given `armed` is true (new session, or after `/compact` or `/clear`), Then it shows `—` in place of the time, even when an earlier `sentAt` is stored. This reads the existing atom only; no field is added and nothing resets `sentAt` (default - revisit with implementation lead, PO decides; see Q3).
- F1-AC-10: Given more notes than fit the 8-note, 280-character and 1200-character caps, When the pane renders, Then the pane shows the cut as one short line (`+<n> not sent`, warning colour, `<n>` = stored notes minus visible notes) in place of today's long sentence, which would only truncate at 110 columns, and the header size counts only the visible notes, as `sizeLabel` does today. The long sentence stays in the headless `/memo list` text (`facts().cut`, unchanged). The caps and the order notes are taken in do not change.
- F1-AC-11: Given the unit test for the header, When it runs, Then it asserts the count, the size label, `—` while armed and the send time when not armed, as pure-function results (no Ink render needed).

### F1-US-3 — Each guard stop is one aligned row
As a person whose tool call was stopped, I read time, tool, what, rule and source on one row and scan down the columns.

Acceptance:
- F1-AC-12: Given three stops of different tools, When the Guard pane renders, Then each stop is exactly one row (the second reason line is gone), newest first, with columns in this order: time · tool · what · rule · source.
- F1-AC-13: Given the rows, When rendered at 190 and at 110 columns, Then every column starts at the same offset on every row; time is local `HH:MM`; tool and rule are padded to the widest value in the ring's visible rows, up to a cap, and cut with `…` beyond it; `what` takes the remaining width and ends in `…` when cut.
- F1-AC-14: Given a stop with no guard rule id and no native rule, When it renders, Then the rule column shows `—`. [확인 필요] The rule column is the guard's own id, else the native permission rule, else `—` (what `stopRows` does today; default - revisit with PO / user; see Q4). The `/permissions` rule text from `ruleFor` is not the rule column; it stays the Copy rule reveal.
- F1-AC-15: Given a row's Copy button, When pressed, Then the inline reveal line below that row shows the `/permissions` rule and the `(add it via /permissions)` hint as today; the button sits last in the row, is labelled `copy` (the row is already the rule), and is still the same pressable key for tests (default - revisit with PO / user; the mockup's "Enter on a row" is not built).
- F1-AC-16: Given the header, When it renders, Then it reads the mode and the count once (`confirm mode · 3 stopped`) without the pane title repeated and without "this session": the ring holds the newest 200 stops across sessions (default - revisit with PO / user; see Q4). An empty ring shows `no denials` and the footer.
- F1-AC-17: Given the guard's logic module, When its unit tests run, Then the row's column strings (time, tool, what, rule, source mark, colour token, word) are asserted as pure-function results, and the pane only places them.

### F1-US-4 — The source of a stop is told by icon and colour first, word second
As a person, I see at once whether the guard stopped it, I declined it, or Claude Code's own check did.

Acceptance:
- F1-AC-18: Given stops of source `guard`, `declined` and `native`, When rendered, Then each row's source column holds a mark, then the word, in this order: `✘` red `guard`; `○` dim `declined`; `●` warning-yellow `native`. The marks come from the set the plugin already uses (`●` `✔` `✘` `○`); [확인 필요] the pairing is the recommended default (default - revisit with PO / user at the demo approval; see Q5).
- F1-AC-19: Given the three rows, When their colour is removed (a monochrome capture), Then the three marks still differ; and When their words are removed, Then the three colours (red, dim, yellow) still differ. A test asserts the mark and the colour token per source.
- F1-AC-20: Given the three sources, When the source column renders, Then it is padded to the longest source word (`declined`) so the Copy button column still aligns.
- F1-AC-21: Given the allowed values of `Denial.source`, When rendered, Then only `guard`, `declined` and `native` exist; an unknown value renders `—` with no mark and does not throw (the guard fails open; mod.md rule 3). [확인 필요] The value set is the code's (default - revisit with PO / user; see Q5). A person's own "No" in a native dialog and a confirm answered Run are not recorded today and are not shown.

### F1-US-5 — No word said twice, no internal labels, one dim footer
As a person, I read each pane's title, header and footer without a repeated word or a label meant for the code.

Acceptance:
- F1-AC-22: Given each pane's frame, When its title row, header and footer text are tokenised, Then no plain word appears twice among them (the pane title, `chars`, `stopped`, `closes`, `Esc`, `q` each once). Slash-command literals (`/memo add`, `/memo rm`, `/memo clear`) and key names are exempt, since a command is typed as written; the pane title `Memo` is drawn by the host (`$.ui.open` title) and the body does not draw it again.
- F1-AC-23: Given each pane, When rendered, Then neither contains `close [q]`, `memo close [q]` or any bracketed key label as a Button caption; the old title-row `close [q]` Button is gone.
- F1-AC-24: Given each pane, When rendered, Then the footer is one dim line of keys and nothing else carries a key hint. Memo: `/memo add <text> · /memo rm <n> · /memo clear` and the ways to close (`Esc`, `q`, `/memo`). Guard: the ways to close (`Esc`, `q`, `/session-denials`) only; the row's `copy` Button is part of its row and no key for it is claimed (the Button has no hotkey).
- F1-AC-25: Given the dismiss path, When the footer renders, Then `q` is bound by the dismiss Button rendered inside the dim footer with a short label (`q`), so the hotkey is not lost (default - revisit with implementation lead: the dismiss Button is the only `q` binding; the tests press this Button by its new key and still assert `"hotkey":"q"`).
- F1-AC-26: Given the panes at 190 and 110, When a person reads title, header, rows and footer, Then the facts for an item are on that item's own line, and the footer is the only line drawn entirely dim; a dim part inside a row (a dim age, the dim `declined` mark) is allowed (mod.md rule 0: one item per line, state by icon and colour first).

### F1-US-6 — Both panes still toggle by command, Esc and q (card 30 kept)
As a person, I close either pane the way I opened it, and keep that behaviour unchanged.

Acceptance:
- F1-AC-27: Given an open Memo pane, When the person runs a bare `/memo`, presses Esc, or presses q, Then the pane closes; when the person runs `/memo list`, Then an open pane stays open (card 30's existing assertions in `memo-pane.test.ts` stay green, adjusted only for the footer Button's key).
- F1-AC-28: Given an open Guard pane, When the person runs a bare `/session-denials`, presses Esc or q, Then it closes (existing assertions in `guard-pane.test.ts` stay green, adjusted only for the Button key).
- F1-AC-29: Given a headless `claude -p` run, When `/memo` or `/session-denials` runs, Then no pane opens and the answer is the existing `{ text }` (existing headless tests stay green; mod.md rule 2 and 7).
- F1-AC-30: Given `claude --plugin-dir ./session` in tmux, When the person opens each pane by its command and by its band line and closes it by Esc, by q and by the command again, Then each works; the capture is attached to the Sprint report (mod.md rule 0 item 1; a path not seen live is stated as partial).

### F1-US-7 — A demo fixture of four variants renders cleanly at 190 and 110
As the person approving the look, I see every pane in minimal, full, parallel and narrow data at both widths, without a wrapped row or a cut glyph.

Acceptance:
- F1-AC-31: Given the demo fixture, When its variants are listed, Then it holds `minimal`, `full`, `parallel` and `narrow` for both the Memo and the Guard pane, with fictional and generic data (no real project, task, company or person; mod.md item 3).
- F1-AC-32: Given the variants' content, When read, Then `minimal` is one project note and one stop; `full` is eight notes in both scopes with a stale one and the cut notice, and stops of all three sources; `parallel` is stops that come from several parallel agents interleaved in time (the ring's `agentId` exists and is not shown; no column is added for it) and a memo with notes in both scopes (default - revisit with PO: the session plugin holds no run, so parallel means parallel agents' stops); `narrow` is long note text, long tool call text and long rule ids that force `…` at 110.
- F1-AC-33: Given each variant at 190 and 110 columns, When `pane-demo.test.ts` renders it, Then it asserts: no line is wider than the column count; no U+FFFD or half-cut glyph; `…` appears only directly after a glyph and ends every cut `what`, `text` and `rule`; the Guard columns start at the same offset on every row; and the header count equals the row count.
- F1-AC-34: Given the fixture, When the plugin loads, Then it is test-only (not shipped in the hooks module list) and removing it changes nothing at runtime; it does not touch `draw.tsx` and `check-copies.mjs` needs no new entry.
- F1-AC-35: Given the demo renders, When the Sprint closes, Then the 190 and 110 renders of all eight frames (two panes by four variants) are in the report for the person's approval after the Sprint (settled: no character faces, one icon and colour per state).

### F1-US-8 — README and KOR describe the panes as they are, with re-taken images
As a reader of the README, I see the real panes and the wording matches them.

Acceptance:
- F1-AC-36: Given `session/README.md` and `session/KOR.md`, When searched for `read-only` and `읽기 전용` about the Memo pane, Then there is no match; the Memo row and caption describe one note per line with scope badge, age, stale hint, and the header with size against the cap.
- F1-AC-37: Given the Guard section of both files, When read, Then they describe one row per stop with time, tool, what, rule and the source marks (`✘` `○` `●`), name the per-row Button as `copy` (not `[Copy rule]`, as README.md line 75 and KOR.md line 75 say today), and say the ring holds the newest 200 stops (unchanged). The README Memo row (line 86) and the caption under `memo-pane.png` are brought to the one-line-per-note layout.
- F1-AC-38: Given `session/docs/images/`, When listed, Then `memo-pane.png` and `denials-pane.png` are re-taken with `python3 _repo/scripts/mod-shot.py <tmux-session> session/docs/images/<name>.png`, at 190 columns, from a throwaway plugin store seeded with fictional notes and ring entries (default - revisit with implementation lead: the fixture is test-only and the shot is of a live `claude --plugin-dir ./session`), and each image is shown in README.md and KOR.md with one or two lines on what feedback it gives and when.
- F1-AC-39: Given README.md and KOR.md, When diffed, Then they moved together in the same commit and neither carries a version number change.

### F1-US-9 — The change is render polish only and is verified
As the maintainer, I need the change not to alter what the plugin decides, and to be checked with counts.

Acceptance:
- F1-AC-40: Given the change, When the diff is read, Then no file outside `session/` changed, `hooks.json` `modules`, `plugin.json`, `.codex-plugin/` and `marketplace.json` are untouched, and no version moved.
- F1-AC-41: Given the memo caps, order and inject text, and the guard's deny and ask decisions, When the existing tests for them run, Then they pass unchanged.
- F1-AC-42: Given `cd session && claude plugin test .`, `python3 _repo/scripts/validate_plugins.py` and `node _repo/scripts/check-copies.mjs`, When run, Then all pass and the report states each count it saw (not "tests pass"); with `modules` removed locally the plugin still loads (compat-claude).
- F1-AC-43: Given the new pure functions (memo line, age text, stale hint, header, sent label, source mark and colour), When their unit tests run, Then each is asserted as a function result before the tsx uses it.

## Open questions

These are standing defaults the stories are built on; none blocks building. Each stays as the rule marked "(default - revisit with <owner>)" until the owner answers.

- **Q1 — Stale threshold.** Default: 14 days (`AGE_DAYS`, README, tests). Owner: PO / user. Why: the design mockup shows a 9-day note marked `stale?`; no source gives that figure. [확인 필요] F1-AC-4.
- **Q2 — Unit and value of the cap.** Default: `<n>/1200 chars` over both scopes (plus 8 notes, 280 each). Owner: PO / user. Why: the mockup shows `3.1 of 8 KB`; the code has no KB cap and none is invented. [확인 필요] F1-AC-8.
- **Q3 — Sent time after `/compact` or `/clear`.** `sentAt` exists (`memo.tsx` atom `{armed, sentAt}`), so the stale-hint story does not rest on age alone; the unknown is that `/compact` and `/clear` set `armed` true and leave the old `sentAt`. Default: show `—` while `armed` is true; keep the time otherwise; change no state. Owner: implementation lead, PO decides. Why: showing the previous conversation's time beside notes that will go out again misleads. [확인 필요] F1-AC-9.
- **Q4 — What a stop is, and which rule shows.** Default: every `session.denials` ring entry is a stop (newest 200, across sessions, `HH:MM` with no date); header says `N stopped` without "this session"; the rule column is the guard id, else the native rule, else `—`. Owner: PO / user. Why: the mockup says "this session" and "Run" confirms are recorded nowhere; the ring is the only record. [확인 필요] F1-AC-14, F1-AC-16.
- **Q5 — Source values and marks.** Default: `guard`, `declined`, `native` (code); `✘` red, `○` dim, `●` yellow, word second. Owner: PO / user, at the demo approval. Why: the mockup shows two sources and no source has a decided mark. [확인 필요] F1-AC-18, F1-AC-21.
- **Q6 — Dependency on F2-F4.** Do the harness, graph and teams panes share the source/state icon vocabulary and the dim key footer with the session panes, and does any shared drawing code need `check-copies.mjs` coverage? Default: session stays self-contained and F1 touches nothing shared. Owner: manager (merge across areas). Why: only if another area makes a shared footer or mark component for all mods would F1 have to adopt it; F1 does not plan that here.
