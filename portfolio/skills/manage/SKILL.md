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
(`layout`, `scaffold`, `selection`, `snapshot`, `renumber`, `verify`, `compare`, `claims`, `settle`,
`intake`, `step`, `round`, `keep-render`; one JSON object each). A real run's mismatch becomes a fixture test first.

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
                        README.md (`## deck` and `## skeleton` tables)
feedback/               YYYY-MM-DD.md — one `feedback` review per day, ending with its fix table
sources/                material: material/<id>/ items (`material` skill), or a ledger NN_프로젝트/A1….md read as it is;
                        선정.md (step 2: 글감 · 쓰임 본문|부록|제외 · 쪽 · 이유 · 대표 — the one place an exclusion lives)
docs/확정사실.md        settled facts, corrections; `## 서술 기준` and `## 구조` lines no check raises again — read before any work
_archive/               old plans and deck backups, moved here, never deleted
```

These names are the contract: a new file takes its name from this tree. Older names (`skeleton.md`,
`deck.mdx`, `resume.md`, `README.md`, `template/분석.md`, `template/다음렌더-지침.md`) are still read,
listed by `layout` as `legacy` and renamed by `scaffold`; then fix references in the workspace's notes.

Root holds only CLAUDE.md and the skeleton and deck pairs. Tidying moves to `_archive/`; only a proven copy is deleted; a
name clash goes into a subfolder. Page headings: `## N <title>` or `## N쪽 · <title>`, one per page
(appendix too); references `N쪽`, `N·M쪽`, `N~M쪽` and a `쪽` table column. A `# ` heading bounds a
block that moves with its pages. History lines (`vX.Y.Z 변경…`, `vX.Y.Z(…`, `>`-quoted) stay as written.

## Process

Nine steps, in order; a round may start again at 2 or 4 (step 8 says where); 9 once the deck is done.
Steps 1-7 run as one harness-shaped pass, n times (n from the user, default n = 2): plan the round
→ criteria per step (`step`) → do → check (a command, else a judge that is not the actor) → gate
(`step`) → `round`. `feedback` runs every round after step 7 from the main context, `intake` takes its
findings; the loop stops at `round`'s `continue: false`. A step that could not run is `skipped` with its reason, a gap, never pass; build/render without
the user's word is skipped `not requested`; a user-wait is answered by the user, else noah, else the proposal (`answered_by`), never a stop.
Mechanics: `references/rounds.md`.

0. **Open, every session, unasked.** `scaffold` (renames old names, creates only what is missing,
   never overwrites; its `renamed`/`created` in one report line), then `layout`, `docs/확정사실.md` and
   the "맞춰야 할 것" table. A stray root file (`*.conflict-*`, a scratch script) is named and moved
   to `_archive/` once the user agrees.
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
   Each page that carries a figure or a reason cites its items on one line under its heading, `글감: <id>, <id>` (a ledger item is
   `NN_프로젝트/A1`); a reason the item does not give is written `[확인 필요: …]`, never filled in.
   Propose the structure (blocks, order, body vs appendix) and wait before filling pages. A written
   item is marked `material log --id <id> --note "skeleton <N>쪽" --status written --later-step manage`;
   in a ledger workspace (`material ledger` lists items) `material ledger-log --item <NN_프로젝트/A1>`
   with the same flags. The ledger is never moved or rewritten.
4. **Revise, from several viewpoints.** `claims` first (each problem is an edit; `본인 확인` stays),
   then recruiter/engineer (`feedback`, `pattern`) → interviewer (`mock-interview`) → the user's own
   bar (noah), each viewpoint's findings through `settle`. `snapshot` before the round's first edit;
   carried wording passes the decision gate (`확정사실.md`, `선정.md`); structure changes are asked;
   an order change is one `renumber`; the align table stays at the end of portfolio-skeleton.
   Rules and the order of each: `references/revise.md`.
5. **Template.** Once per template (again when it changes): `deck-builder catalog`, then
   `scaffold` copies its Palette, Type and Voice into `template/analysis.md`; add the style rules the
   pages must keep (spacing, alignment, emphasis — only what the template shows), the safe area
   (the margins nothing crosses) and the figure colours. A figure drawn with `write:diagram` takes
   its colours from `## 그림 색`.
6. **Deck.** Carry portfolio-skeleton into portfolio-deck.mdx against `deck.catalog.md` budgets and
   `template/analysis.md`, then `deck-builder` `check` (an untouched chart slot is warned: its numbers are the template's
   sample) and `claims --file portfolio-deck.mdx` (each slide cites in its comment: `## @s3 2쪽 · 글감: <id>`). Fine style changes go through the template's run formats, never by hand in the pptx.
   `snapshot --kind deck --level … --note` only when asked (the note names its skeleton).
7. **Render, review, re-render.** `build` and `render` only when the user says. After a render run
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
   only) → `resume-deck.mdx` → `claims --file resume-deck.mdx` → `resume-builder` (catalog, build into
   the user's template, final checks, render when told, fit by `over_lines`) → `render-review` (step 7).
   The user's material never goes to git: the engine refuses a workspace git would carry.

Always, portfolio and resume alike (user, 2026-11-10: "safe area가 있는거 시인성, 가독성이 좋은거
like-me로 ai티를 줄이는거 이건 포폴, 이력서 공통임"):
- **Safe area, readable.** Nothing crosses the template's margins or touches another box; type and
  spacing stay the template's, one idea per line, no lone last word. Cut text, never shrink type.
- **In the user's voice.** Every sentence written into a skeleton or deck source goes through
  `write:like-me` (samples: what the user wrote alone in `sources/`) to strip machine tells; then `claims`.
- **Corrections.** When the user corrects a fact, in the same turn: append to the material file
  `## 정정 — 본인 확인 YYYY-MM-DD` with their words verbatim; add one line to `확정사실.md`;
  `noah_collect` the words when noah is connected. The user's word beats the record.
- **Did it read better.** After a round's edits, score the snapshot and the new skeleton with the
  same rubric, then `compare` (`lost_ground` = worse): `references/rounds.md` § Did it read better.
- **A vague answer** ("바꾸고"): do the part every reading shares, hold the rest and say so.

Principles for any candidate, and the mistakes this flow stops: `references/principles.md`.

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
라운드: <n>회 중 <k>회 · 종료 <stop_reason> · 게이트 gap <n> (건너뛴 단계: 이유) · 패널 <4인 | 단일> · 심사 <subagent | in-context>
```

Korean, conclusion first, plain headings, no bold runs, no invented names or labels; a number says
what it counts. Not built → the built files are older. A remark read one way → say the reading, ask.
Held is said as held.

## What Claude Does / What You Do

| Claude | You |
|---|---|
| Runs material, feedback, pattern, rewrite and deck-builder as steps of one loop | Hand over material; answer only what only you know |
| Proposes the selection table (본문/부록/제외 · 대표) and waits | Approve what goes in and what each item leads with |
| Snapshots before editing, renumbers in one pass, verifies references | Approve structure changes (page count, blocks, order) |
| Records corrections in three places the same turn; stops at `check`, builds and renders when told | Correct facts in your own words; say when to build or render |

## Related Skills

- `material` — step 1, collects material into `sources/material/`; its status follows steps 2-3
- `feedback`, `pattern`, `rewrite`, `mock-interview` — steps 4 and 8; `write:like-me` — the voice
- `deck-builder` — steps 5-7; `resume-builder` — step 9 (docx build, PDF, fit); `render-review` — step 7
  and the resume's render; `write:diagram` — figures
- `job-application-workflow` — the whole application; its deck step is this workflow
