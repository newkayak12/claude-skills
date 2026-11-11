---
name: render-review
effort: medium
description: >-
  Use when a rendered portfolio deck or resume PDF must be reviewed page by page against fixed checks:
  "렌더 검토해줘", "페이지별로 확인", "안전 영역 넘는 데 있어?", "AI 티 남았는지", "review the render".
scenarios:
  - "I rendered the deck — go through every page and list what is wrong before I change anything."
  - "Does any line on the resume PDF cross the margin or end with a single word?"
  - "Check the finished deck and resume for AI traces and write the problems down for the next render."
  - "렌더 끝났어. 쪽마다 안전 영역, 가독성, AI 흔적 보고 검토.md 채워줘"
  - "이력서 PDF 한 장씩 보고 문제를 다음 렌더 지침에 넣어줘"
  - "덱이 skeleton이랑 어긋난 데 없는지 렌더에서 확인해줘"
compatibility:
  required:
    - python 3.9+ and node 18+ (stdlib only)
  recommended:
    - pdftotext and pdftoppm (poppler), or DECK_RENDER_DOCKER=<image> — margins and previews need them
  remote_mcp_note: >-
    poppler가 없으면 안전 영역 목록은 건너뛰고, 미리보기 이미지를 눈으로 보고 검토합니다. 건너뛴 검사는 검토.md에 적습니다.
---

# Render Review — every page, the same four checks

`manage` step 7 after a render: look at every page against fixed checks, write what is wrong, hold it
for the next render. Portfolio deck and resume alike. **Not for** content judgement (`feedback`) or fixing
(the problems go to `template/next-render.md`; fixed at once only when the user says "고쳐").

## Process

1. **Keep the render.** Deck: `node ${CLAUDE_PLUGIN_ROOT}/skills/manage/scripts/manage.mjs keep-render --version vX.Y.Z`
   (previews from `build/pages/` to `snapshot/render/deck-vX.Y.Z/`, `검토.md` with a row per page).
   Resume: `pdftoppm -r 80 -png build/resume.pdf snapshot/render/resume-<YYYY-MM-DD>/pages/p`, then
   the same `검토.md` table (`| 쪽 | 본 것 | 문제 | next-render |`) beside it.
2. **List what a tool can.** `python3 ${CLAUDE_PLUGIN_ROOT}/scripts/office_render.py margins build/<file>.pdf`
   (each side from `style/레이아웃.md`'s `- top/bottom/left/right: <pt>`; else `--margin <pt>` from
   `template/analysis.md`'s safe area; 28 when neither names one) lists each text line whose
   box leaves the margin, by page and side. `python3 ${CLAUDE_PLUGIN_ROOT}/scripts/office_render.py ai-traces build/<file>.<pptx|docx> --report-only` lists AI traces.
3. **Look at each page** (the preview image, then the page text) against the checks below. One row
   per page in `검토.md`: 본 것 (what is on it, one line), 문제 (check · where · symptom), next-render.
4. **Write the problems** into `template/next-render.md` (쪽 · 칸 · 증상 · 확인 · 적용), one row each,
   all applied before the next render. A frame the deck cannot move is a template edit, only on the
   user's word (`manage` `references/template-edit.md`).

## Checks

| Check | Fails when |
|---|---|
| Safe area | a line or box crosses the template's margins, touches another box, or the photo touches text |
| Readability | type below the template's body size; a lone last word on a line; text on a fill with contrast under 4.5:1; more than one idea per line |
| AI traces | `ai-traces` reports anything: a disclaimer in alt text, an AI tool in the properties, an AI phrase in visible text. Visible text is the user's to change, never silently deleted |
| Skeleton match | a page's headline, figures or order differ from `portfolio-skeleton.md` / `resume-skeleton.md`; a `[확인 필요]` line reached the page |

A check that could not run (no poppler, no renderer) is written in `검토.md` as skipped with its
reason, never as passed.

## Output Template

```
렌더 검토 <deck-vX.Y.Z | resume YYYY-MM-DD> — <n>쪽
안전 영역: <쪽 N 오른쪽 "…" | 없음 | 건너뜀: 이유>
가독성: <쪽 N 글자 크기·외톨이 단어·대비 | 없음>
AI 흔적: <보고 n건 (항목) | 없음>
skeleton 일치: <쪽 N 어긋남 | 없음>
next-render에 적은 것: <n>건 · 정하실 것: <없음 | …>
```

## What Claude Does / What You Do

| Claude | You |
|---|---|
| Keeps the previews, runs the margin and AI-trace lists, looks at every page | Say when the render is done; look at the pages you doubt |
| Fills `검토.md` and `template/next-render.md`, one row per problem | Decide what changes; say "고쳐" when it should be fixed now |
| Names a skipped check and why | Install poppler or the renderer if you want that check |

## Related Skills

- `manage` — step 7 calls this skill; `keep-render` and `template/next-render.md` are its workspace
- `deck-builder`, `resume-builder` — produce the files reviewed here; both end their build with the AI-trace check
- `feedback` — judges the content of the rendered PDF (step 8), after this review
