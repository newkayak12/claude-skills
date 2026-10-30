# portfolio — one flow, eight steps

Card 54 (with 102, 103). User, 2026-10-30, the flow to follow:

> 1. 글감 수집 2. 글감 정리(뭘 쓰고 안쓰고 각 글감의 대표를 뭘로 잡을거고) 3. 초안 작성(skeleton)
> 4. 퇴고(다양한 시점에서 퇴고 진행) 5. template분석(palette, style, …) 6. deck으로 작성(세부 스타일
> 조정) 7. 렌더(pptx + pdf: 검토, 재렌더) 8. 피드백 진행

Then: "전체적으로 계획 한거 백로그로 넣고 우선순위 최상으로 두고 해주세요".

## Principles

- `portfolio:manage` stays the one entry; the other skills are its steps (card 34 principle).
- Material comes only from what the user hands over; the user's word beats the record.
- Every check a person must not skip is in node with tests (`.claude/rules/skill.md`), not prose.
- Feedback is factual; strategy is the user's. No cutting without a ground, no market generalities.
- Fixtures are fictional. No real names or employer data in the repo.

## Steps → owner → file

| # | Step | Owner | Writes |
|---|---|---|---|
| 1 | Collect | `material` | `sources/material/<id>/` (7 parts) |
| 2 | Select | manage `select` (new) | `sources/선정.md`: 글감 · 쓰임(본문/부록/제외) · 쪽 · 이유 · 대표 |
| 3 | Draft | manage (1b today) | `skeleton.md`, each claim citing its id |
| 4 | Revise | manage + `feedback`/`pattern`/`rewrite`/`mock-interview` | snapshots, `snapshot/scores/` |
| 5 | Template | `deck-builder catalog` + manage | `deck.catalog.md`, `template/분석.md` |
| 6 | Deck | manage + `deck-builder check` | `deck.mdx` |
| 7 | Render | `deck-builder render` | `build/`, `build/preview/`, `build/검토.md`, `template/다음렌더-지침.md` |
| 8 | Feedback | `feedback` on the deck | `snapshot/feedback/deck-vX.Y.Z.md`; back onto `gaps` |

## Decisions

1. **Selection has one source:** `sources/선정.md`. A use status (`본문`/`부록`/`제외`) and a
   representative line per item. `확정사실.md` keeps settled facts and corrections; an item's
   exclusion lives only in `선정.md`. Draft (3) reads only items marked `본문`/`부록`.
   material's status moves `raw → selected | excluded` (step 2), `→ written` (step 3).
2. **Claims are checked against material both ways (card 102):** `manage claims` lists claim lines
   with no id, numbers not in the item, `근거 없음` ones, and results in `본문` items no page
   carries. `본인 확인(기록 없음)` passes and is listed.
3. **Revise runs viewpoints in order:** recruiter 6초 → engineer 30초 → interviewer attack
   (`mock-interview` questions on the claims) → the user's own bar (noah, when connected). Each is a
   numbered edit list; settled items in `확정사실.md` are never re-raised.
4. **Template analysis is a step, written once:** `template/분석.md` = catalog's Palette, Type and
   Voice plus the style rules a deck must keep (spacing, alignment, figure colours). Figures made with
   `write:diagram` take their colours from it.
5. **Render review is recorded:** each render writes PNG previews under `build/preview/` and a
   `build/검토.md` row per page (쪽 · 본 것 · 문제 · → 다음렌더-지침). Re-render applies every
   지침 row first.
6. **Deck feedback closes the loop (card 54):** `feedback` on the rendered PDF (first three pages,
   figure meaning, page flow) saved per deck version; an indefensible claim goes onto its item's
   `gaps`; the next round starts at 2 or 4.
7. **Layout check covers the new files:** `layout` lists `sources/선정.md`, `template/분석.md`,
   `build/검토.md` as missing (created on request, not silently).

## Not doing

JD variant decks; per-page visual scores; a fictional starter; a three-level follow-up tree.
