# House style — Korean technical book

The copyedit target at stage 6, and the formats every stage writes. Spelling and loanwords:
`../writer-verification/references/korean-spelling.md` (국립국어원 rules) — use it, don't restate it.

## toc.md chapter block

```
## N장 <title>
goal: <one line — what the reader can do after this chapter>
requires: <earlier chapter numbers, e.g. 1, 3 — or none>
anchor: <analogy candidates to the anchor, e.g. "MySQL InnoDB 버퍼 풀 ↔ shared_buffers">
sme: <plugin:skill from skill-routing.md, or none — [확인 필요]>
```

`requires:` names only lower numbers. A chapter that needs a later one is out of order — move it.

## Chapter skeleton

1. **장 도입** — 2–4 sentences: what this chapter covers and why the reader needs it now.
2. **학습 목표** — 3–5 items, each something the reader can do or explain. These are the reader-agent's questions.
3. **N.M sections** — one idea per section; the first use of a term is `한글 용어(English)`, after that the
   `glossary.md` form only.
4. **정리** — 3–6 bullets, each restating one 학습 목표 as a fact the reader now has.

## Anchor box

```
> **MySQL에서는** <how the reader already knows this>
> **Postgres에서는** <the concept>
> **이 비유가 깨지는 지점:** <where the mapping stops holding>
```

The break line is required; a box without it fails review.

## Callouts

`> **노트**` extra detail · `> **주의**` a mistake readers make · `> **팁**` a shortcut. At most one per section.

## Figures, tables, code

- Numbered per chapter: `그림 N-M`, `표 N-M`, `코드 N-M` — a caption is its own paragraph starting with that label
  (the PDF styles it as a caption); above a table or code block, below a figure.
- Default figure is a markdown table or ASCII; a system diagram goes through `develop:architecture-designer`.
- Every code block's caption names what it shows and the runtime/version it was written for, or `[확인 필요: 버전]`.

## Page and type (book.pdf, `scripts/render-pdf.mjs`)

- Fonts: NanumGothic 400/700 for text, NanumGothicCoding for code — bundled in `../assets/fonts/` with their SIL OFL
  1.1 notices. Ship the TTFs unmodified (no subsetting or renaming; OFL reserves the Nanum names).
- Page B5 182×257mm, body 10.5pt, line-height 1.7, left-aligned (`word-break: keep-all`), page number bottom centre.
- Each chapter starts a new page; the cover shows brief.md's first `#` heading.
- The converter reads only what this file defines: headings, paragraphs, lists (one nesting level), pipe tables,
  `>` boxes (one item per line), fenced code, inline code/bold/italic/links. Anything else renders as plain text.

## Register and terms

- One register per book, set in brief.md (합니다체 or 해요체) — never mixed within a book.
- `glossary.md`: `한글 | English | 첫 등장 장 | 한 줄 정의`. Stage 6 checks every chapter against it in one pass.
- Numbers, versions, defaults: sourced inline (`(PostgreSQL 공식 문서, <section>)`) or `[확인 필요: …]`.
