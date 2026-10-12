# House style — Korean technical book

The copyedit target at stage 6, and the formats every stage writes. Spelling and loanwords:
`../writer-verification/references/korean-spelling.md` (국립국어원 rules) — use it, don't restate it.

## toc.md chapter block

```
## N장 <title>
goal: <one line — what the reader can do after this chapter>
requires: <earlier chapter numbers, e.g. 1, 3 — or none>
entry: <what the reader can already explain or do>
exit: <one observable performance newly possible after this chapter>
misconception: <a plausible prior model or shortcut that this chapter corrects>
example-step: <the change to the running example and why it is needed>
evidence: <what the reader produces, predicts, diagnoses, or decides>
anchor: <analogy candidates to the anchor, e.g. "MySQL InnoDB 버퍼 풀 ↔ shared_buffers">
sme: <plugin:skill from skill-routing.md, or none — [확인 필요]>
```

`requires:` names only lower numbers. A chapter that needs a later one is out of order — move it.

## Chapter skeleton

1. **문제 장면** — a concrete situation the reader cannot yet handle, plus the cost of guessing.
2. **학습 목표** — 3–5 observable actions; each is taught, exercised, and tested in the chapter.
3. **기존 모델과 실패** — invite a prediction using a plausible prior model, then show what it cannot explain.
4. **작동 모델과 N.M sections** — the smallest causal model that resolves the failure, one idea per section; the first use of a term is `한글 용어(English)`, after that the
   `glossary.md` form only.
5. **따라 하는 예제** — decision → expected result → observed result → interpretation, changing one meaningful variable at a time.
6. **경계와 실패 진단** — a counterexample or failure the reader explains; close every analogy and rule of thumb.
7. **스스로 적용하기** — a different case, success evidence, and verification method; do not reveal the solution path.
8. **답안과 정리** — compact decision rule and evidence for the exercise, then retrieval prompts that reconnect the learning goals and next chapter.

## Anchor box

```
> **<anchor name>에서는** <how the reader already knows this>
> **<subject name>에서는** <the concept>
> **이 비유가 깨지는 지점:** <where the mapping stops holding>
```

Both names come from brief.md (anchor, subject) — never copied from an example. The break line is required; a box
without it fails review.

## Review file

Each stage-4 check has one writer for `review/NN-rK-<check>.md` (fact, epistemic, writer, reader; reader sub-agents
return text to it); the runner merges them into `review/NN-rK.md`. `counts:` closes every check and closure file.

- 🔴 a wrong fact or behaviour; a lab that fails or prints other than observed; a required element missing; a learning
  goal not reachable from chapters 1..N. 🟡 a reader is misled, blocked, or must guess; an unsourced claim. 🟢 polish —
  style without a reader cost is 🟢.
- One line per finding: `- 🔴 [section/code id] original → fix — evidence`. A finding offers ONE fix. Closure and
  confirmation lines start `- ✔` and carry no severity mark. The last line is `counts: 🔴 a 🟡 b 🟢 c`.
- Merge: same location + same cause = one finding at the highest severity. When merged findings carry different fixes,
  the runner picks one in the merged file and writes why, before the reviser starts. Merged counts are distinct.
- Round ≥ 2: each re-run check reads the diff since its last round, its own open findings, and — in a stopping round —
  the upstream diff (pinned sha → `final/N-1.md`). The diff scopes reading only.
- `review/NN-rK-resolution.md` quotes the new text per finding. A sentence the reviser adds or takes from a reviewer is
  labelled observed / sourced / `[확인 필요]`, as drafter text is; net growth over 15% in a round lists what was cut.
- `review/NN-closure.md` (cap only): the closure pass applies each open finding whose fix is one sourced or observed
  sentence; a known-false sentence (🔴, or 🟡 the fact check marked wrong) is fixed or cut. The pass lists its hunks in
  the last resolution file; a fresh re-checker alone writes this file, covers every closure hunk, cuts included, ends
  with `counts:`, adds no finding outside its hunks; a rejected fix is reverted and its sentence cut or replaced by
  `[확인 필요: …]`.

## Callouts

`> **노트**` extra detail · `> **주의**` a mistake readers make · `> **팁**` a shortcut. At most one per section.

## Figures, tables, code

- Numbered per chapter: `그림 N-M`, `표 N-M`, `코드 N-M` — a caption is its own paragraph starting with that label
  (the PDF styles it as a caption); above a table or code block, below a figure.
- Default figure is a markdown table or ASCII; any other figure goes through `develop:diagram` (self-contained SVG + PNG, Korean labels, its `check` must pass).
- A figure image is a file in `final/` named `fig-N-M.svg` or `.png`, referenced `![설명](fig-N-M.svg)` on its own
  line, with the `그림 N-M …` caption paragraph below. SVG text in ASCII/Latin only — an SVG loaded as an image
  cannot use the page's Nanum fonts — so Korean goes in the caption. A missing image, or one not on its own line,
  makes render exit 3.
- Every code block's caption names what it shows and the runtime/version it was written for, or `[확인 필요: 버전]`.

## Page and type (book.pdf, `scripts/render-pdf.mjs`)

- Fonts: NanumGothic 400/700 for text, NanumGothicCoding for code — bundled in `../assets/fonts/` with their SIL OFL
  1.1 notices. Ship the TTFs unmodified (no subsetting or renaming; OFL reserves the Nanum names).
- Page B5 182×257mm, body 10.5pt, line-height 1.7, left-aligned (`word-break: keep-all`), page number bottom centre.
- Each chapter starts a new page; the cover shows brief.md's first `#` heading.
- The converter reads only what this file defines: headings, paragraphs, lists (one nesting level), pipe tables,
  `>` boxes (one item per line), fenced code, inline code/bold/italic/links, images on their own line. Anything else renders as plain text.

## Register and terms

- One register per book, set in brief.md (합니다체 or 해요체) — never mixed within a book.
- `glossary.md`: `한글 | English | 첫 등장 장 | 한 줄 정의`. Stage 6a writes `glossary-delta-NN.md` per chapter; 6b merges
  them once — the lowest real first use wins.
- Numbers, versions, defaults: sourced inline (`(PostgreSQL 공식 문서, <section>)`) or `[확인 필요: …]`.
