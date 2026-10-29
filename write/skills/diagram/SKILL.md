---
name: diagram
effort: medium
description: >-
  Use when something must be drawn as a checked figure, not Mermaid: page layout, B-tree, lock
  timeline, ER, benchmark chart, architecture, sequence. SVG + PNG. Triggers: "도식화해줘",
  "그림으로 그려줘", "책에 넣을 그림", "시퀀스 다이어그램", "draw this as a figure".
license: MIT
metadata:
  version: "1.0.0"
scenarios:
  - "draw the InnoDB 16KB page layout for chapter 9 as a figure"
  - "diagram a web request: browser, API, Redis cache, Postgres on a miss"
  - "plot the five before/after runs of this query as a figure for the book"
  - "두 세션이 같은 행을 갱신할 때 잠금 대기를 그림으로 그려줘"
  - "클러스터드 인덱스와 보조 인덱스 구조 도식화해줘, 머메이드 말고"
  - "이 결제 흐름을 시퀀스 다이어그램으로 그려서 공유할 수 있게 해줘"
compatibility:
  optional:
    - think-tool
  remote_mcp_note: >-
    think-tool이 있으면 그림으로 그릴지 표로 둘지, 어떤 유형이 그 한 가지 주장을 보여주는지 판단할 때 씁니다.
---

## Standing Mandates

- ALWAYS decide figure or table first. A figure only when the point is spatial (where bytes sit, what points to what), hierarchical, temporal across two or more actors, or a quantitative comparison; parallel attributes go in a markdown table.
- ALWAYS place everything yourself: the IR names every cell, row and column. Layout is the argument - entry at the left or top, the thing to notice where the eye lands. The checker refuses; it never moves anything.
- ALWAYS run `check`, apply every repair line it prints, then `figure`. A refused figure writes nothing and leaves the last good pair as it was.
- ALWAYS Read the PNG that `figure` wrote and judge it: overlap, legibility, does it show the one thing the caption claims. At most 3 rounds, then report what is still wrong.
- ALWAYS give every fact drawn (a size, an offset, a default, a lock behaviour) a source, or `[확인 필요]`, in the IR's `note`.
- NEVER hand over Mermaid or ASCII art as a book or document figure, or a figure whose PNG you did not view - the Postgres book shipped hand-drawn SVGs nobody checked, and the MySQL drafts 01-09 shipped with zero figures. (Mermaid inline in a design doc or PR stays fine.)
- Goal: a figure a reader understands at book width in one look, with its `.json` source next to it and nothing in it the check or your eyes found wrong.

# Diagram

Turns a typed JSON IR into a checked, self-contained SVG (NanumGothic subset embedded, no script,
no external reference) plus a 2x PNG, sized for a 146 mm book page.

**Not for** system design or ADRs (`develop:architecture-designer` decides; this skill draws);
parallel attributes (a markdown table); join pictures (a table of rows, not a Venn diagram).

## Process

1. **Figure or table** - per the first mandate. Write the one sentence the figure must show; it becomes the caption.
   **Gate:** if the point is parallel attributes (the same fields compared across items), stop here. End the run by recommending a markdown table and name its columns; write no IR and no figure, and skip the remaining steps. Use the `Table:` line of the Output Template.
2. **Pick the type** and write the reason it fits the one sentence from step 1 (`Type: <type> because <reason>`)

   | The point | type | IR reference |
   |-----------|------|--------------|
   | components, data paths, steps, states | `architecture` `dataflow` `workflow` `lifecycle` | `references/diagram-ir.md` |
   | one request over time | `sequence` | `references/diagram-ir.md` |
   | where bytes sit: page layout, row + undo record, version chain | `layout` | `references/figures.md` |
   | index pages, B-tree, clustered + secondary index, execution plan | `tree` | `references/figures.md` |
   | two or more sessions: locks, waits, deadlock | `timeline` | `references/figures.md` |
   | tables and their relations | `er` | `references/figures.md` |
   | measured numbers: repeated runs, before/after | `chart` | `references/figures.md` |

3. **Write the IR** as `fig-N-M.json`. Korean labels are fine; keep labels short and put detail and sources in `note`.
4. **Check** - `node scripts/diagram.mjs check fig-N-M.json`. It measures every label with the embedded font and refuses overflow, overlap, a line through a box or over a label, clipping, a label that would be cut, text under 7.5 pt at book width, a character the font lacks, and each type's own misleading cases (sizes that do not add up, keys out of order, a wait no lock explains, a bar axis not from 0, a value missing from its source). Apply every repair; re-check until `ok`.
5. **Draw** - `node scripts/diagram.mjs figure fig-N-M.json fig-N-M` writes `fig-N-M.svg` and `fig-N-M.png`. Exit 3 means no Chrome-family browser was found: the SVG is written, set `CHROME=<path>` for the PNG.
6. **View** - Read `fig-N-M.png`. Fix the IR and repeat 4-6, at most 3 rounds; after that, report what is still wrong instead of calling it done.
7. **Ship** `.json` + `.svg` + `.png` together; the `.json` is what the next edit starts from.

For a system someone will explore on screen (hover, light/dark), `render fig.json fig.html` writes interactive HTML for the grid and sequence types.

Known limit: the font is an embedded `@font-face`. Browsers and the book's PDF render use it; non-browser SVG renderers (librsvg, Inkscape, macOS QuickLook) may ignore it - the PNG is the copy for those.

## Output Template

```
Figure: fig-9-2 - <the one claim it shows, used as the caption>
Type: <type> because <reason>, e.g. layout because the point is where bytes sit (schematic, stamped 축척 아님)
Files: fig-9-2.json · fig-9-2.svg (NN KB) · fig-9-2.png (W x H, 2x)
Check: ok in round N of 3 - repairs applied: <list, or none>
Viewed: <what the PNG shows; anything still wrong>
Sources: <URL per fact> · [확인 필요]: <items, or none>
Markdown: ![<caption>](fig-9-2.svg)
```

Parallel attributes (step 1 gate) - the run ends with this line instead:

```
Table: recommended - columns <col, col, ...> (no figure, no IR)
```

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Decides figure or table, picks the type, writes and places the IR | Say what the figure must show and where it goes |
| Runs check and figure, reads the PNG, fixes it in up to 3 rounds | Judge whether the claim is the one you meant |
| Cites a source or marks `[확인 필요]` for every fact drawn | Settle the `[확인 필요]` items |

## Related Skills

- `develop:architecture-designer` - decides the system design and writes the ADRs; its opened, shared or printed figures are drawn here
- `write:tech-book` - the first consumer: chapter figures as `fig-N-M.svg` / `.png` embedded in the PDF
