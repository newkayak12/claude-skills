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
  - "스냅샷 찍고 portfolio-deck.mdx에 반영해서 check까지만 해줘"
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
(`layout`, `scaffold`, `selection`, `snapshot` (`--stable`), `renumber`, `verify`, `sync`, `verify-build`, `compare`,
`claims`, `settle`, `intake`, `step`, `round`, `round-check`, `questions`, `keep-render`; one JSON object each). A real run's mismatch becomes a fixture test first.

## Workspace

```
CLAUDE.md               the guide every session loads: these names, `scaffold` first (written by scaffold if none)
portfolio-skeleton.md   the portfolio design: every wording change starts here (`version: vX.Y.Z` at the top)
portfolio-deck.mdx      its build source (output: build/deck.pptx)
resume-skeleton.md      the resume design (step 9), facts from portfolio-skeleton; resume-deck.mdx its build source
template/               template.pptx, resume template (.docx), NOTES.md (quirks), analysis.md (step 5),
                        next-render.md (step 7: render problems held for the next render)
deck.catalog.md         slot ids and character budgets — regenerated only (deck-builder catalog)
build/                  deck.pptx, deck.pdf, resume.docx, resume.pdf, pages/ (previews) — regenerated in full
snapshot/               skeleton-vX.Y.Z/, deck/deck-vX.Y.Z/, scores/, render/deck-vX.Y.Z/ (pages/, 검토.md),
                        README.md (`## deck` and `## skeleton` tables); rounds/round-NN/ = one round's record
stable/                 YYYY-MM-DD-skeleton-vX.Y.Z/ frozen baseline (skeleton, deck + resume source, style), README.md row; never edited
style/                  문체.md 표기규칙.md 레이아웃.md 이력서-서식.md — the user's fixed rules (`scaffold` templates)
consensus/ decisions/   debate transcripts kept unedited (`<date>-<topic>.md`); decisions `NN-<topic>.md`
analysis/               link to the user's raw archive outside the workspace: read-only
feedback/               YYYY-MM-DD.md — one `feedback` review per day, ending with its fix table
sources/                material: material/<id>/ items (`material` skill), or a ledger NN_프로젝트/A1….md read as it is;
                        선정.md (step 2: 글감 · 쓰임 본문|부록|제외 · 쪽 · 이유 · 대표 — the one place an exclusion lives)
docs/확정사실.md        settled facts, corrections; `## 서술 기준` and `## 구조` lines no check raises again — read before any work
docs/확인할-것.md       questions a round could not settle: `questions --add` each round, answered ones read back (`--read`)
_archive/               old plans and deck backups, moved here, never deleted
```

These names are the contract: a new file takes its name from this tree; older names are `legacy` (`layout`),
renamed by `scaffold`. Root holds only CLAUDE.md and the skeleton and deck pairs; tidying moves to `_archive/`
(`references/workspace.md`). Page headings: `## N <title>` or `## N쪽 · <title>`, one per page
(appendix too); references `N쪽`, `N·M쪽`, `N~M쪽` and a `쪽` table column. A `# ` heading bounds a
block that moves with its pages. History lines (`vX.Y.Z 변경…`, `vX.Y.Z(…`, `>`-quoted) stay as written.

## Process

Nine steps, in order; a round may start again at 2 or 4 (step 8 says where); 9 once the deck is done.
Steps 1-7 run as one harness-shaped pass, n times (n from the user, default n = 2): plan the round
→ criteria per step (`step`) → do → check (a command, else a judge that is not the actor) → gate
(`step`) → `round`. A round is the full flow once over the whole deck, not a part of it. `feedback` runs every
round after step 7 from the main context, `intake` takes its findings; the loop stops at `round`'s `continue: false`.
A step that could not run is `skipped` with its reason, a gap, never pass. Mechanics: `references/rounds.md`.

**The round's record** (`round` writes `snapshot/rounds/round-NN/`; detail `references/workspace.md`): that round's
skeleton, feedback (revision mode: previous vs this version) and scores, pattern two-version scores, `compare`,
`noah.md`, `overrides.md`, `report.md`. noah (the user's proxy) gives its verdict every round, written apart from the panel.
Every edit in `report.md` carries its source (feedback priority | panel | noah), the evidence file and the reason; a
finding not used says why; "사용자가 정할 구조" lists what only the user decides. Run `round-check --round N` before
reporting: an edit without a reason is a problem. Each question the round could not settle goes to
`questions --add --text … --page N`; at the start `questions --read` returns the answered ones: use them, do not ask again.
A baseline is frozen with `snapshot --stable --note …` (rounds compare against it, it is never edited).

**Which gates block.** Structure only: the order of pages and what goes in or out (step 2's table, step 3's
blocks, a step 4 order or page-count change). It is asked, answered by the user, else noah, else the
proposal (`answered_by`), and is the only wait; the round never stops on it. Everything else goes ahead on
the proposal and is reported under "기본값으로 정한 것": wording, fixes from feedback, the deck source,
the snapshot. A round always builds (the user's standing word: "결과물도 검증하고, 더 빌드해보자"):
`sync`, `deck-builder build`, `verify-build`; render only when the user says.

0. **Open, every session, unasked.** `scaffold` (renames old names, creates only what is missing, never overwrites, appends
   the guide once to a CLAUDE.md that lacks it, creates `style/` templates and `docs/확인할-것.md`; `renamed`/`created`/`appended`/
   `stale_refs` (files naming an old name) in one line), then `layout` (warnings: a broken `analysis/` link, an engine path not on
   disk; `scripts`: each post-build script and the `deck.mdx`/resume line doing its job — propose it; `deck.py shapes` maps shape
   names to slots for `place:`), `docs/확정사실.md`, `questions --read`, the "맞춰야 할 것" table. A stray root file is moved to `_archive/` once the user agrees.
1. **Collect.** New material → run `material` from the workspace root (items land in
   `sources/material/`). Evidence order: `sources/` → the user's analysis notes they point to →
   the user. Search before asking; ask only what only the user can answer; everything else stays
   `[확인 필요: …]`.
2. **Select.** Before any page is written, one row per **grade-A** item in `sources/선정.md`: 글감 · 쓰임
   (`본문` | `부록` | `제외`) · 쪽 · 이유 · 대표 (the one problem, decision or result the item leads
   with, in the material's words). B and C items are not rows: they support the page their A item
   leads, cited there (the user's own table: 27 A items → 14 본문, 8 부록; `selection` flags a B/C row).
   **Whose eyes first:** when noah tools are attached (`noah_persona`, `noah_search`), read the user's
   values and career stances before scoring (persona-values-and-drives, the `career` domain: what
   they want to be hired for, what they refuse to claim) and cite the note in 이유; without noah, the
   `확정사실.md` quotes stand in. Each A item's `> 장면:` line (material step 1b, verified there) is
   what it leads with: the 대표 is that scene, and the 이유 says first what it shows about how the
   person judges — the user's own table reads "본인 안이 리뷰에서 바뀐 경위", "본인 설계 결함 공개",
   "역전 조건 공개". An A item still in `noScene` goes back to material 1b before it is selected.
   A held-back number (`안 씀`) never moves an item out of the body by itself: when the scene stands
   in words, the item stays where its scene puts it (the user kept 05/A5 in the body with its
   numbers out). An item whose scene is still an open question is selected on its latest 정정, not excluded.
   `selection` flags a project whose 본문 items state no measured result: that project goes to 부록.
   **Chapters first, then leads** — `references/principles.md` § Chapters: one result per chapter;
   an item that is a step toward it is 본문 without a result of its own; a scene that ends where it
   starts goes to 부록; a wording ban bans the sentence, not the item.
   A weak scene goes to 부록, never 제외 (`selection` flags it). When a chapter has more passing items
   than its pages can lead, the surplus goes to 부록 — never 제외 by the writer — and which ones lead
   is one question to the user (`questions --add`), since only they know which of their work to show
   (three runs split 01/A5, A6, A7 among 본문, 부록 and 제외; the user's reason for A7 — "사내 활동은
   안쓰는게 낫고" — is in no workspace file).
   Picked by signal (`references/principles.md` § Composition),
   each item scored on four questions in its 이유: does it help this person (a number that reads
   badly — 149 routine on-call requests — is written `안 씀: 149건` in the 이유 and shown nowhere, not as
context or in a figure either; `claims` flags it on any page citing the item), what strength does it show, what
   is measured, what earns qualitative credit (a decision, a trade-off, a lesson). An item that only
   looks impressive and answers none is `제외` (user, 2026-11-22: "AI가 하는 전형적인 '좋아보이는거
   가져오기'"); 부록 items pass the same bar. The body is for chapters with a measured result; a
   project with no result yet (in QA, not measured) and design documents, scope analyses or systems
   built without use go to 부록, where the document itself is the evidence — never dropped for
   lacking a result. Keep the 부록 at least as many pages as the workspace's last deck (the user,
   2026-11-23, on a build that put 27 items in the body and cut the 부록 from 8 attachments to 4:
   "첨부 양이 줄었네"). Propose the table (structure: asked). Mark each item `material log --id <id> --note
   "선정: <쓰임>" --status selected|excluded --later-step manage`. An exclusion lives only here, not
   in `확정사실.md`. `selection` reads the table back; a 쓰임 outside the three is a problem. Its `fact_only` figures (a 확정사실 figure no item holds) that are results are carried into their item first — `material update` from the analysis note or skeleton line that gives the base, or the 확정사실 line — before drafting (three runs asked what 98.1% was; its base sat in the user's skeleton notes, 2026-11-25). Where 확정사실 lines differ, the later date wins, never asked.
3. **Draft.** No skeleton yet, or a new project → write it from the `본문`/`부록` items only: one
   project as why → the user's role and decision → result; strengths chosen from the evidence.
   **One chapter at a time, each reviewed before the next:** write a chapter (its cover, pages and
   results page), run `claims` on it, then hand only that chapter, its cited items, `확정사실.md` and
   the workspace's rubric (`판정기준.md` when it exists, else the rules below) to a separate reviewer
   subagent that did not write it; it returns rule-numbered findings, the writer revises, and the
   chapter is done when the reviewer has none left or after three rounds, whichever is first. The
   first round walks every rubric rule against every page at once; later rounds check the edits only.
   Third-round findings are not edited but listed under `## 남은 검수` at the chapter's end; `docs/확인할-것.md` holds only facts the user alone knows (a ratio's base, what "2건" names); a grade, title or placement the material settles is decided and written, never asked; page count, items and conflicts:
   `references/principles.md` § Chapters. Assemble after the last chapter, then review the
   whole once for what spans chapters: contents vs titles, one cover archetype, appendix size,
   figure forms by page role (user, 2026-11-24: "작은 단위로 작성-퇴고 나중에 모아서 진행").
   Every page heading names its template archetype, `## N쪽 · @sK · 제목` (without it `sync` and `verify-build` matched nothing, bench29a). Each page that carries a figure or a reason cites its items on one line under its heading, `글감: <id>, <id>` (a ledger item is
   `NN_프로젝트/A1`, never a README or index; a fact only `확정사실.md` holds needs no cite); a reason the item does not give is written `[확인 필요: …]`, never filled in. The marker stays in the skeleton only: the deck source carries the sentence without the unconfirmed part, or drops the footnote or cell (`final-check` refused two on bench29a's slides).
   The draft ends with `claims`: each problem fixed (a `제외` item's lines go) or left `[확인 필요]`. A `no_figure`
   page cites results but shows none: put the result the reader needs on it (claims offers them, results first) —
   a page of reasons with no number lost every such pair in a blind bench (2026-11-21). Take the
   offered result, not a count of parts; a figure 확정사실 rules out is replaced by another measured
   one, never by a vaguer sentence; an offered figure that is no result for this reader goes on the item's 선정.md row as `안 씀: <figure>`, never swapped for a test or scale count (a run put "9건" to pass and the reviewer flagged it as scale, 2026-11-25). Every project cover uses the same cover archetype (a one-person project leaves team and contribution out, user: "개인이 뭐해요"; all three full runs hit the clash), so each carries
   period, team, role and contribution, and its subtitle names the concrete problem (`502 응답`, not
   `일부 요청이 실패`) — a bench lost the side project's cover for dropping them (2026-11-22). A cover
   cites its chapter's items too, and its tech-stack table names only technologies those items name
   (bench17 listed AWS ECS and Datadog on an uncited cover). Structure (blocks, order, body vs appendix) is asked; wording is not. A written
   item is marked `material log --id <id> --note "skeleton <N>쪽" --status written --later-step manage`;
   in a ledger workspace (`material ledger` lists items) `material ledger-log --item <NN_프로젝트/A1>`
   with the same flags. The ledger is never moved or rewritten.
4. **Revise, from several viewpoints.** `claims` first (each problem is an edit; `본인 확인` stays),
   then recruiter/engineer (`feedback`, `pattern`) → interviewer (`mock-interview` question-list
   mode) → the user's own bar (noah), each viewpoint's findings through `settle`. `snapshot` before
   the round's first edit (`--kind skeleton|deck|resume`); carried wording passes the decision gate (`확정사실.md`, `선정.md`);
   an order change is one `renumber`; the align table stays at the end of portfolio-skeleton.
   Rules and the order of each: `references/revise.md`.
5. **Template.** Once per template (again when it changes): `deck-builder catalog`, then
   `scaffold` copies its Palette, Type and Voice into `template/analysis.md`; add the style rules the
   pages must keep (spacing, alignment, emphasis — only what the template shows), the safe area
   (the margins nothing crosses) and the figure colours. A figure drawn with `write:diagram` takes
   its colours from `## 그림 색`.
6. **Deck.** Carry portfolio-skeleton into portfolio-deck.mdx: `sync` lists each skeleton slot missing or
   different in the deck source and each slot it dropped (`deck_only`: `!drop` or delete it), `sync --write` carries them (never a slide; with no deck source yet it starts one from `deck.catalog.md`'s front matter and the skeleton's `@sN` headings); against `deck.catalog.md` budgets and
   `template/analysis.md`, then `deck-builder` `check` (an untouched chart slot is warned: its numbers are the template's
   sample) and `claims --file portfolio-deck.mdx` (each slide cites in its comment: `## @s3 2쪽 · 글감: <id>`). Fine style changes go through the template's run formats, never by hand in the pptx.
   `snapshot --kind deck --level … --note` only when asked (the note names its skeleton).
7. **Build, render, review.** Every round builds, then `verify-build` (each skeleton slot's text is in
   build/deck.pptx, footnote marks and picture files exist). `render` only when the user says; a render that
   lists this deck's `overlap`, `edge` or `clip` is not a finished round — layout is fixed and rendered again. After a render run
   `render-review` (deck and resume alike): `keep-render`, then every page against safe area,
   readability, AI traces and the skeleton, one `검토.md` row per page. A problem seen there or in
   PowerPoint goes into `template/next-render.md` (쪽 · 칸 · 증상 · 확인 · 적용), all applied before
   the next render; fixed at once only when the user says ("고쳐", "맞춰줘"). A frame the deck cannot
   move is fixed in the template only on the user's word (`references/template-edit.md`).
8. **Feedback on the deck.** `feedback` on the rendered PDF with the material and 확정사실 in reach,
   saved to `feedback/YYYY-MM-DD.md` with its fix table. Each finding goes back to material: a claim
   the deck cannot defend → its item's `gaps.md`; a result the user restores → `result.md` labelled
   `본인 확인`. The next round starts at 2 (selection changed) or 4 (wording).
9. **Resume.** `resume-skeleton.md` (the template's section order, facts from portfolio-skeleton
   only; items picked per `references/principles.md` § Resume) → `resume-deck.mdx` → `claims --file resume-deck.mdx` → `resume-builder` (catalog, build into
   the user's template, final checks, render when told, fit by `over_lines`) → `render-review` (step 7).
   The user's material never goes to git: the engine refuses a workspace git would carry.

Always, portfolio and resume alike (user, 2026-11-10: "safe area가 있는거 시인성, 가독성이 좋은거
like-me로 ai티를 줄이는거 이건 포폴, 이력서 공통임"):
- **Safe area, readable.** Nothing crosses the margins (`layout`'s `safe_area`, from `style/레이아웃.md`, is what
  `deck-builder` uses) or touches another box; type and spacing stay the template's, one idea per line, no lone last word. Cut text, never shrink type.
- **In the user's voice.** Read `style/문체.md` and `style/표기규칙.md` before any rewrite; every sentence written into a
  skeleton or deck source goes through `write:like-me` (samples: `style/문체.md`'s own paragraphs and what the user wrote
  alone in `sources/`, never AI-edited text) to strip machine tells; then `claims`. A resume follows `style/이력서-서식.md`.
- **No traces.** Deliverables carry no AI or tool trace; the builders' final check catches it.
- **Corrections.** When the user corrects a fact, in the same turn: append to the material file
  `## 정정 — 본인 확인 YYYY-MM-DD` with their words verbatim; add one line to `확정사실.md`;
  `noah_collect` the words when noah is connected. The user's word beats the record.
- **Did it read better.** After a round's edits, score the snapshot and the new skeleton with the same rubric, then
  `compare` (`lost_ground` = worse): `references/rounds.md`. **A vague answer** ("바꾸고"): do the shared part, hold the rest, say so.

## Output Template

```
[결론 한 줄 — 무엇을 바꿨고 무엇이 남았나] (단계 N · skeleton vA → vB)

바꾼 것
- N쪽 칸: "현재 문구" → "바뀐 문구" (한 줄씩, 자리만 적지 않는다)

기본값으로 정한 것 (다르면 말씀해 주세요)
- …

정하실 것
1. 본인만 답할 수 있는 것만

이번 라운드 <나아짐 | 나빠짐 | 섞임 | 그대로> — 항목: 이전 → 지금 (떨어진 항목은 이전 문구와 함께)
확인한 것 (템플릿이나 원재료를 고쳤을 때: 백업 위치, check 결과)

claims: 문제 <n> (근거 없음 n · 글감에 없음 n · 확인 필요 n · 인용 없음 n) · 본인 확인 <n> · 덱에 없는 성과 <n>
renumber/verify: <changes, warnings, problems | 안 함> · sync: <빠진 n · 다른 n> · deck check: <warnings | 안 함> · build: <함> · verify-build: <빠진 문구 n · 각주 n · 그림 파일 n> · render: <함 | 안 함>
라운드: <n>회 중 <k>회 · 종료 <stop_reason> · 게이트 gap <n> (건너뛴 단계: 이유) · 패널 <4인 | 단일> · 심사 <subagent | in-context>
기록: round-NN/ · round-check 문제 <n> · noah 판정 <값> · 열린 질문 <n> · 기준본 <stable 폴더 | 없음>
```

Korean, conclusion first, plain headings, no bold runs, no invented names or labels; a number says what it counts.
Not built → the built files are older. A remark read one way → say the reading, ask. Held is said as held.

## What Claude Does / What You Do

| Claude | You |
|---|---|
| Runs material, feedback, pattern, rewrite and deck-builder as steps of one loop | Hand over material; answer only what only you know |
| Proposes the selection table (본문/부록/제외 · 대표); structure is the only wait | Approve what goes in and what each item leads with |
| Snapshots before editing, renumbers in one pass, verifies references | Approve structure changes (page count, blocks, order) |
| Runs a whole round: sync, build, verify-build; wording goes ahead and is reported | Correct facts in your own words; say when to render |

## Related Skills

- `material` — step 1, collects material into `sources/material/`; its status follows steps 2-3
- `feedback`, `pattern`, `rewrite`, `mock-interview` — steps 4 and 8; `write:like-me` — the voice
- `deck-builder` — steps 5-7; `resume-builder` — step 9 (docx build, PDF, fit); `render-review` — step 7
  and the resume's render; `write:diagram` — figures; `job-application-workflow` — the whole application
- `references/principles.md` — principles for any candidate and the mistakes this flow stops
