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
(`layout`, `snapshot`, `renumber`, `verify`; each prints one JSON object).

## Workspace

```
skeleton.md        the design: every wording change starts here (`version: vX.Y.Z` line at the top)
deck.mdx           build source carried over from skeleton (output: build/deck.pptx)
template.pptx      archetype catalog — never edited
deck.catalog.md    slot ids and character budgets — regenerated only (deck-builder catalog)
build/             deck.pptx, deck.pdf
snapshot/          skeleton/skeleton-vX.Y.Z/, deck/deck-vX.Y.Z/, README.md (version table)
sources/           material: material/<id>/ items (`material` skill), one project per folder
docs/확정사실.md   settled facts, things never to use, corrections — read before any work
_archive/          old plans and deck backups, moved here, never deleted
```

Root holds only skeleton and deck. Tidying moves to `_archive/`; only a file proven to be a copy
is deleted; a name clash goes into a subfolder, never a merge. Page headings in skeleton are
`## N <title>`; references are `N쪽`, `N·M쪽`, `N~M쪽` and a table column named `쪽`.

## Process

0. **Open.** `layout`; read `docs/확정사실.md` and the "맞춰야 할 것" table at the end of skeleton.
   Missing workspace parts are created on request, not silently.
1. **Material.** New material → run `material` into `sources/`. Evidence order: `sources/` →
   the user's analysis notes they point to → the user. Search before asking; ask only what only
   the user can answer; everything else stays `[확인 필요: …]`.
1b. **Write.** No skeleton yet, or a new project → write it from material only: pick episodes by
   signal (`references/principles.md` § Composition), one project as why → the user's role and
   decision → result, each claim citing its material item; strengths chosen from the evidence.
   Propose the structure (blocks, order, body vs appendix) and wait before filling pages. A written
   item is marked `material log --id <id> --note "skeleton <N>쪽" --status written --later-step manage`.
2. **Feedback.** Run `feedback` on the skeleton (and `pattern` for how it reads); results become a
   numbered skeleton edit list with how to fix each. Never re-raise what `확정사실.md` settles.
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
   passes). Report changes, warnings and problems. Numbers without `쪽` outside a `쪽` column are
   fixed by hand and listed.
7. **Corrections.** When the user corrects a fact, in the same turn: append to the material file
   `## 정정 — 본인 확인 YYYY-MM-DD` with their words verbatim; add one line to `확정사실.md`;
   `noah_collect` the words when noah is connected. The user's word beats the record.
8. **Align table.** Keep the table at the end of skeleton: 번호 · 대상 · 맞출 것 · 상태
   (`본인 확인 대기` / `deck.mdx 반영 때` / `그림 작업 때` / `캡처 대기`); slots at their budget
   go in as `check` items.
9. **Deck.** Carry skeleton into deck.mdx against `deck.catalog.md` budgets, then `deck-builder`
   `check`. `build` and `render` only when the user says; `snapshot --kind deck` only when asked.
10. **Loop.** The next round starts at 2 with the new version. A vague answer ("바꾸고"): do the
    part every reading shares, hold the rest and say so.

Composition and writing principles that hold for any candidate: `references/principles.md`.
Mistakes this workflow exists to stop: `references/principles.md` § Never.

## Output Template

```
[결론 한 줄 — 무엇을 바꿨고 무엇이 남았나] (skeleton vA → vB)

**바꾼 것** (쪽별 한 줄)
**기본값으로 정한 것** (다르면 말해 달라)
**정하실 것** (본인만 답할 수 있는 것만, 번호 목록)

renumber/verify: <changes, warnings, problems | 안 함> · deck check: <warnings | 안 함> · build/render: <함 | 안 함>
```

Korean, conclusion first; no invented names, debate codes or abstract labels.

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
