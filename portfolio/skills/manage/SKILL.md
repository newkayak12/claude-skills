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

The user's one entry for writing a portfolio, first draft to final deck. It runs the other portfolio skills as its steps;
the user never has to name them. **Not for** a one-off review of someone else's document
(`feedback`) or a deck that is not a portfolio (`deck-builder`).

Engine, run from the workspace root: `node ${CLAUDE_PLUGIN_ROOT}/skills/manage/scripts/manage.mjs <cmd>`
(`layout`, `snapshot`, `renumber`, `verify`, `compare`, `claims`; each prints one JSON object). Its tests run
on `scripts/fixtures/workspace`, a fictional workspace with the real one's shape; a mismatch a real
run finds is added there as a test case before it is fixed.

## Workspace

```
skeleton.md        the design: every wording change starts here (`version: vX.Y.Z` line at the top)
deck.mdx           build source carried over from skeleton (output: build/deck.pptx)
template/         template.pptx (where deck.mdx `template:` points), NOTES.md (its quirks, checked only),
                   다음렌더-지침.md (render fixes waiting for the next render)
deck.catalog.md    slot ids and character budgets — regenerated only (deck-builder catalog)
build/             deck.pptx, deck.pdf
snapshot/          skeleton/skeleton-vX.Y.Z/, deck/deck-vX.Y.Z/ (deck.mdx, assets/, NOTES.md), scores/,
                   README.md (`## deck` and `## skeleton` tables)
sources/           material: material/<id>/ items (`material` skill), or a ledger NN_프로젝트/A1….md read as it is
docs/확정사실.md   settled facts, things never to use, corrections — read before any work
_archive/          old plans and deck backups, moved here, never deleted
```

Root holds only skeleton and deck. Tidying moves to `_archive/`; only a file proven to be a copy
is deleted; a name clash goes into a subfolder, never a merge. Page headings in skeleton are
`## N <title>` or `## N쪽 · <title>`, one per page (an appendix page too); references are `N쪽`,
`N·M쪽`, `N~M쪽` and a table column named `쪽`. A `# ` heading bounds a block: pages sort inside it
and a block moves with its pages. History lines (`vX.Y.Z 변경…`, `vX.Y.Z(…`, quoted with `>` or not)
are never renumbered. The template is where deck.mdx's `template:` points.

## Process

0. **Open.** `layout`; read `docs/확정사실.md` and the "맞춰야 할 것" table at the end of skeleton.
   Missing workspace parts are created on request, not silently.
1. **Material.** New material → run `material` into `sources/`. Evidence order: `sources/` →
   the user's analysis notes they point to → the user. Search before asking; ask only what only
   the user can answer; everything else stays `[확인 필요: …]`.
1b. **Write.** No skeleton yet, or a new project → write it from material only: pick episodes by
   signal (`references/principles.md` § Composition), one project as why → the user's role and
   decision → result; strengths chosen from the evidence. Each page that carries a figure or a
   reason cites its items on one line under its heading, `글감: <id>, <id>` (a ledger item is
   `NN_프로젝트/A1`); a reason the item does not give is written `[확인 필요: …]`, never filled in.
   Propose the structure (blocks, order, body vs appendix) and wait before filling pages. A written
   item is marked `material log --id <id> --note "skeleton <N>쪽" --status written --later-step manage`;
   in a ledger workspace (`material ledger` lists items) `material ledger-log --item <NN_프로젝트/A1>`
   with the same flags. The ledger is never moved or rewritten.
2. **Feedback.** First `claims`: every page's figures and reason sentences against the items its
   `글감:` line cites. Each problem is an edit: `uncited`/`unknown_id` → cite the item; `unsupported`
   (`근거 없음`) and `not_in_material` → drop the figure or ask the user for its source;
   `to_confirm` → the user's words or `[확인 필요: …]`. `listed.self_confirmed` (the user's
   `본인 확인`: real work with no record) stays and is never cut as unsupported; `listed.tone` lines
   are reworded in the material's words; `unused_results` and `uncited_items` are offered to the
   user (a real result left out is a gap too), never added silently. Then `feedback` on the
   skeleton (and `pattern` for how it reads), handed `claims`' `settled` lines; results become a
   numbered skeleton edit list with how to fix each. Never re-raise what `확정사실.md` settles: a
   finding against a `settled` line (a writing basis, a structure decision) is dropped.
3. **Snapshot, then edit.** `snapshot --kind skeleton --level <major|minor|patch> --note "<what>"`
   before the first edit of a round (major = structure: page count, blocks, order; minor =
   content; patch = wording). Mark edited cells `[vX]`, unconfirmed wording `[vX 안]`. Lines are
   rewritten with `rewrite` where they need strength.
4. **Decision gate.** Before carrying wording from an older version or backup, check it against
   `확정사실.md` ("쓰지 않을 것", appendix-only, kept-apart blocks); a hit is not carried. On every
   structure change re-check block separation (different work never shares a block, title or toc line).
5. **Structure changes are asked.** Page count, block split, order: propose with the reason,
   wait for the user. Wording and defaults you may settle — and list them in the report.
6. **Renumber.** An order change is one `renumber --map "<old>:<new>,…"`: it renumbers headings and
   references, moves the page sections into the new order and verifies (never by hand or in two
   passes). Report changes, warnings and problems. By hand, and listed in the report: numbers
   without `쪽` outside a `쪽` column, a block order mark `(n/N)` the warnings name, and everything
   in deck.mdx (`by_hand`: slide order, `<!-- N. -->` comments, toc page cells). Two pages sharing
   one description move apart badly: give each page its own first.
7. **Corrections.** When the user corrects a fact, in the same turn: append to the material file
   `## 정정 — 본인 확인 YYYY-MM-DD` with their words verbatim; add one line to `확정사실.md`;
   `noah_collect` the words when noah is connected. The user's word beats the record.
8. **Align table.** Keep the table at the end of skeleton: 번호 · 대상 · 맞출 것 · 상태
   (`본인 확인 대기` / `deck.mdx 반영 때` / `그림 작업 때` / `캡처 대기`); slots at their budget
   go in as `check` items.
9. **Deck.** Carry skeleton into deck.mdx against `deck.catalog.md` budgets, then `deck-builder`
   `check`. `build` and `render` only when the user says; `snapshot --kind deck --level … --note`
   only when asked (the deck counts its own versions; the note says which skeleton it carries).
   A problem seen in a render or in PowerPoint is not fixed on the spot: it goes into
   `template/다음렌더-지침.md` (쪽 · 칸 · 증상 · 확인 · 적용) and all of them are applied before the
   next render. Fixed at once only when the user says to fix it ("고쳐", "맞춰줘"); a symptom or a
   capture alone is noted. A frame the deck cannot move is fixed in the template only on the user's
   word: `references/template-edit.md`.
9b. **Did it read better.** After a round's edits, score the round's snapshot and the new skeleton
    with the same rubric in the same turn: `feedback`'s five dimension scores and `pattern`'s items,
    each run as `{ "<item>": <score> }` into `snapshot/scores/skeleton-vX.Y.Z.json`, then
    `compare --before <snapshot's> --after <new>`, with both rounds' `claims` saved beside them
    (`skeleton-vX.Y.Z.claims.json`) as `--claims-before`/`--claims-after`: a claim that lost its
    ground (`lost_ground`) makes the round worse whatever the scores. Report every item's change; an item in `dropped`
    is named with the snapshot's wording for it, offered back. `unmatched` means the rubric moved —
    re-score, never compare across it.
10. **Loop.** The next round starts at 2 with the new version. A vague answer ("바꾸고"): do the
    part every reading shares, hold the rest and say so.

Composition and writing principles that hold for any candidate: `references/principles.md`.
Mistakes this workflow exists to stop: `references/principles.md` § Never.

## Output Template

```
[결론 한 줄 — 무엇을 바꿨고 무엇이 남았나] (skeleton vA → vB)

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
| Snapshots before editing, renumbers in one pass, verifies references | Approve structure changes (page count, blocks, order) |
| Records your corrections in three places the same turn | Correct facts in your own words |
| Stops at `check`; builds and renders when told | Say when to build or render |

## Related Skills

- `material` — step 1, collects material into `sources/`
- `feedback`, `pattern`, `rewrite` — step 2 and 3, judge and strengthen the skeleton
- `deck-builder` — step 9, catalog, check, build, render
- `job-application-workflow` — the whole application; its deck step is this workflow
