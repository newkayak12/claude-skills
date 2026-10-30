---
name: manage
effort: high
description: >-
  Use when writing a developer portfolio: "포트폴리오 쓰자", "포트폴리오 작업하자", "피드백 돌려줘",
  "순서 바꾸자", "스냅샷 찍고". The whole writing flow — material, write, feedback, deck —
  keeping versions, corrections and settled decisions.
scenarios:
  - "Let's keep working on my portfolio deck — run feedback on the skeleton and fix what it finds."
  - "Swap the two pages of the search block and fix every page reference."
  - "That's wrong, the retry policy was theirs, not mine — record it."
  - "포트폴리오 작업 이어서 하자. 피드백 돌리고 고쳐줘"
  - "검색 블록 두 장 순서 바꾸고 쪽 번호 다 맞춰줘"
  - "스냅샷 찍고 deck.mdx에 반영해서 check까지만 해줘"
compatibility:
  required:
    - node 18+ (stdlib only) for scripts/manage.mjs
  optional:
    - noah MCP (noah_collect) — the user's corrections are sent there too when it is connected
  remote_mcp_note: >-
    noah가 없으면 정정은 글감 파일과 docs/확정사실.md에만 남고, 그 사실을 한 번 알립니다.
---

# Portfolio Manage — the portfolio writing flow, material to a reviewed deck

The user's one entry for writing a portfolio, first draft to final deck; it runs the other portfolio
skills as its steps. **Not for** a one-off review of someone else's document (`feedback`) or a deck
that is not a portfolio (`deck-builder`).

Engine, run from the workspace root: `node ${CLAUDE_PLUGIN_ROOT}/skills/manage/scripts/manage.mjs <cmd>`
(`layout`, `scaffold`, `selection`, `snapshot`, `renumber`, `verify`, `compare`, `claims`,
`keep-render`; one JSON object each). Tests run on `scripts/fixtures/workspace` (fictional, the real
one's shape); a mismatch a real run finds is added there as a test first.

## Workspace

```
skeleton.md        the design: every wording change starts here (`version: vX.Y.Z` line at the top)
deck.mdx           build source carried over from skeleton (output: build/deck.pptx)
template/         template.pptx (deck.mdx `template:`), NOTES.md (quirks), 분석.md (step 5), 다음렌더-지침.md
deck.catalog.md    slot ids and character budgets — regenerated only (deck-builder catalog)
build/             deck.pptx, deck.pdf, pages/ (previews) — regenerated in full by every build
snapshot/          skeleton-vX.Y.Z/, deck/deck-vX.Y.Z/, scores/, render/deck-vX.Y.Z/ (pages/, 검토.md),
                   feedback/deck-vX.Y.Z.md, README.md (`## deck` and `## skeleton` tables)
sources/           material: material/<id>/ items (`material` skill), or a ledger NN_프로젝트/A1….md read as it is;
                   선정.md (step 2: 글감 · 쓰임 본문|부록|제외 · 쪽 · 이유 · 대표 — the one place an exclusion lives)
docs/확정사실.md   settled facts, corrections; `## 서술 기준` and `## 구조` lines no check raises again — read before any work
_archive/          old plans and deck backups, moved here, never deleted
```

Root holds only skeleton and deck. Tidying moves to `_archive/`; only a proven copy is deleted; a
name clash goes into a subfolder. Page headings: `## N <title>` or `## N쪽 · <title>`, one per page
(appendix too); references `N쪽`, `N·M쪽`, `N~M쪽` and a `쪽` table column. A `# ` heading bounds a
block that moves with its pages. History lines (`vX.Y.Z 변경…`, `vX.Y.Z(…`, `>`-quoted) stay as written.

## Process

Eight steps, in order; a round may start again at 2 or 4 (step 8 says where).

0. **Open.** `layout`; read `docs/확정사실.md` and the "맞춰야 할 것" table at the end of skeleton.
   Missing workspace parts are created on request, not silently: `scaffold` makes the flow's new
   parts (`sources/선정.md`, `template/분석.md`, `snapshot/render/`, `snapshot/feedback/`) and never
   overwrites one.
1. **Collect.** New material → run `material` from the workspace root (items land in
   `sources/material/`). Evidence order: `sources/` → the user's analysis notes they point to →
   the user. Search before asking; ask only what only the user can answer; everything else stays
   `[확인 필요: …]`.
2. **Select.** Before any page is written, one row per item in `sources/선정.md`: 글감 · 쓰임
   (`본문` | `부록` | `제외`) · 쪽 · 이유 · 대표 (the one problem, decision or result the item leads
   with, in the material's words). Picked by signal (`references/principles.md` § Composition);
   propose the table and wait for the user. Mark each item `material log --id <id> --note
   "선정: <쓰임>" --status selected|excluded --later-step manage`. An exclusion lives only here, not
   in `확정사실.md`. `selection` reads the table back; a 쓰임 outside the three is a problem.
3. **Draft.** No skeleton yet, or a new project → write it from the `본문`/`부록` items only: one
   project as why → the user's role and decision → result; strengths chosen from the evidence.
   Each page that carries a figure or a
   reason cites its items on one line under its heading, `글감: <id>, <id>` (a ledger item is
   `NN_프로젝트/A1`); a reason the item does not give is written `[확인 필요: …]`, never filled in.
   Propose the structure (blocks, order, body vs appendix) and wait before filling pages. A written
   item is marked `material log --id <id> --note "skeleton <N>쪽" --status written --later-step manage`;
   in a ledger workspace (`material ledger` lists items) `material ledger-log --item <NN_프로젝트/A1>`
   with the same flags. The ledger is never moved or rewritten.
4. **Revise, from several viewpoints.** First `claims`: every page's figures and reason sentences
   against the items its `글감:` line cites (and `선정.md`: a page citing a `제외` item is `excluded`).
   Each problem is an edit: `uncited`/`unknown_id` → cite the item; `unsupported`
   (`근거 없음`) and `not_in_material` → drop the figure or ask the user for its source;
   `to_confirm` → the user's words or `[확인 필요: …]`. `listed.self_confirmed` (the user's
   `본인 확인`: real work with no record) stays and is never cut as unsupported; `listed.tone` lines
   are reworded in the material's words; `unused_results` and `uncited_items` are offered to the
   user (a real result left out is a gap too), never added silently. Then the viewpoints, in
   order, each its own numbered edit list with how to fix each: recruiter 6초 and engineer 30초
   (`feedback`, and `pattern` for how it reads) → interviewer attack (`mock-interview`'s questions
   on the page claims; a claim the user cannot defend goes to its item's `gaps.md`) → the user's
   own bar (noah, when connected: their stated standards, quoted). Every viewpoint is handed
   `claims`' `settled` lines: a finding against one (a writing basis, a structure decision) is
   dropped. No viewpoint proposes cutting or merging pages without a ground, or cites market
   generalities ("면접 단골 질문") as evidence. The first-page summary line need not carry a
   number: measured numbers sit in the evidence lines, small-scale numbers are dropped.
   - **Snapshot, then edit.** `snapshot --kind skeleton --level <major|minor|patch> --note "<what>"`
     before the first edit of a round (major = structure: page count, blocks, order; minor =
     content; patch = wording). Mark edited cells `[vX]`, unconfirmed wording `[vX 안]`. Lines are
     rewritten with `rewrite` where they need strength.
   - **Decision gate.** Before carrying wording from an older version or backup, check it against
     `확정사실.md` (appendix-only, kept-apart blocks) and `선정.md` (`제외`); a hit is not carried. On every
     structure change re-check block separation (different work never shares a block, title or toc line).
   - **Structure changes are asked.** Page count, block split, order: propose with the reason,
     wait for the user. Wording and defaults you may settle — and list them in the report.
   - **Renumber.** An order change is one `renumber --map "<old>:<new>,…"`: it renumbers headings and
     references, moves the page sections into the new order and verifies; it writes only when the
     result verifies, leaves fenced code alone and refuses a target page the map leaves in place
     (never by hand or in two passes). Report changes, warnings and problems. By hand, and listed
     in the report: numbers without `쪽` outside a `쪽` column, a block order mark `(n/N)` the
     warnings name, and everything in deck.mdx (`by_hand`: slide order, `<!-- N. -->` comments, toc
     page cells). Two pages sharing one description move apart badly: give each page its own first.
   - **Align table.** Keep the table at the end of skeleton: 번호 · 대상 · 맞출 것 · 상태
     (`본인 확인 대기` / `deck.mdx 반영 때` / `그림 작업 때` / `캡처 대기`); slots at their budget
     go in as `check` items.
5. **Template.** Once per template (again when it changes): `deck-builder catalog`, then
   `scaffold` copies its Palette, Type and Voice into `template/분석.md`; add the style rules the
   pages must keep (spacing, alignment, emphasis — only what the template shows) and the figure
   colours. A figure drawn with `write:diagram` takes its colours from `## 그림 색`.
6. **Deck.** Carry skeleton into deck.mdx against `deck.catalog.md` budgets and `template/분석.md`,
   then `deck-builder` `check` (an untouched chart slot is warned: its numbers are the template's
   sample). Fine style changes go through the template's run formats, never by hand in the pptx.
   `snapshot --kind deck --level … --note` only when asked (the deck counts its own versions; the
   note says which skeleton it carries).
7. **Render, review, re-render.** `build` and `render` only when the user says. After a render,
   `keep-render --version <deck version>` keeps the previews under `snapshot/render/deck-vX.Y.Z/`
   with a `검토.md` row per page (쪽 · 본 것 · 문제 · 다음렌더-지침): look at every page and fill it.
   A problem seen in a render or in PowerPoint is not fixed on the spot: it goes into
   `template/다음렌더-지침.md` (쪽 · 칸 · 증상 · 확인 · 적용) and all of them are applied before the
   next render. Fixed at once only when the user says to fix it ("고쳐", "맞춰줘"); a symptom or a
   capture alone is noted. A frame the deck cannot move is fixed in the template only on the user's
   word: `references/template-edit.md`.
8. **Feedback on the deck.** `feedback` on the rendered PDF (first three pages, what each figure
   means, page flow), saved to `snapshot/feedback/deck-vX.Y.Z.md`. Each finding goes back to
   material: a claim the deck cannot defend → its item's `gaps.md`; a real result the user restores
   → the item's `result.md` labelled `본인 확인`. The next round starts at 2 (selection changed) or 4
   (wording). Kept small: no follow-up question trees.

Always:
- **Corrections.** When the user corrects a fact, in the same turn: append to the material file
  `## 정정 — 본인 확인 YYYY-MM-DD` with their words verbatim; add one line to `확정사실.md`;
  `noah_collect` the words when noah is connected. The user's word beats the record.
- **Did it read better.** After a round's edits, score the round's snapshot and the new skeleton
  with the same rubric in the same turn: `feedback`'s five dimension scores and `pattern`'s items,
  each run as `{ "<item>": <score> }` into `snapshot/scores/skeleton-vX.Y.Z.json`, then
  `compare --before <snapshot's> --after <new>`, with both rounds' `claims` saved beside them
  (`skeleton-vX.Y.Z.claims.json`) as `--claims-before`/`--claims-after`: a claim that lost its
  ground (`lost_ground`) makes the round worse whatever the scores. Report every item's change;
  an item in `dropped` is named with the snapshot's wording for it, offered back. `unmatched`
  means the rubric moved — re-score, never compare across it.
- **A vague answer** ("바꾸고"): do the part every reading shares, hold the rest and say so.

Composition and writing principles that hold for any candidate: `references/principles.md`.
Mistakes this workflow exists to stop: `references/principles.md` § Never.

## Output Template

```
[결론 한 줄 — 무엇을 바꿨고 무엇이 남았나] (단계 N · skeleton vA → vB)

바꾼 것
- N쪽 칸: 무엇을 어떻게 (한 줄씩)

기본값으로 정한 것 (다르면 말씀해 주세요)
- …

정하실 것
1. 본인만 답할 수 있는 것만

이번 라운드 <나아짐 | 나빠짐 | 섞임 | 그대로> — 항목: 이전 → 지금 (떨어진 항목은 이전 문구와 함께)
확인한 것 (템플릿이나 원재료를 고쳤을 때: 백업 위치, check 결과)

claims: 문제 <n> (근거 없음 n · 글감에 없음 n · 확인 필요 n · 인용 없음 n) · 본인 확인 <n> · 덱에 없는 성과 <n>
renumber/verify: <changes, warnings, problems | 안 함> · deck check: <warnings | 안 함> · build/render: <함 | 안 함>
```

Korean, conclusion first; headings plain, no bold run through the report. No invented names,
debate codes or abstract labels; a number says what it counts. Build or render not done → say the
built files are the older state. A short remark read one way → say the reading and ask if another
was meant. Held is said as held.

## What Claude Does / What You Do

| Claude | You |
|---|---|
| Runs material, feedback, pattern, rewrite and deck-builder as steps of one loop | Hand over material; answer only what only you know |
| Proposes the selection table (본문/부록/제외 · 대표) and waits | Approve what goes in and what each item leads with |
| Snapshots before editing, renumbers in one pass, verifies references | Approve structure changes (page count, blocks, order) |
| Records your corrections in three places the same turn | Correct facts in your own words |
| Stops at `check`; builds and renders when told | Say when to build or render |

## Related Skills

- `material` — step 1, collects material into `sources/material/`; its status follows steps 2-3
- `feedback`, `pattern`, `rewrite`, `mock-interview` — steps 4 and 8, judge and strengthen
- `deck-builder` — steps 5-7, catalog, check, build, render
- `write:diagram` — figures, coloured from `template/분석.md`
- `job-application-workflow` — the whole application; its deck step is this workflow
