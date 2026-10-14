# Check and render — detail

## What `check` measures

| What it measures | Against |
|---|---|
| A table or text running off the slide | the slide edge — an error, naming the rows lost |
| A line too wide for a slot the template keeps to one line | that slot's own frame, in em, so Hangul is not counted as Latin |
| A slot holding far less than the template puts there | the template's own volume — the frame was drawn for that much and the slide opens a hole |
| Text running lower than the design puts it | the template's own line count, and what sits below |
| Crop loss, effective dpi, palette strays, pasted-box borders | the frame, the screen, and the template's palette |
| Text over a picture | the pixels actually behind it: 3:1 for large type, 4.5:1 for body |
| Text running into a neighbour's critical zone (`임계 침범`) | the gap the template repeats for that shape pair |

## Critical zone (임계 구간)

The zone comes from the template, not from a constant. `catalog` collects, on every template
slide, the gap from each shape to its nearest neighbour below (`↓`) and to the right (`→`) —
neighbours share at least half of the smaller cross extent. Gaps are grouped by role pair
(제목 / 본문 / 그림 / 표 / 차트 / 외곽선) and axis:

- a gap that recurs within ±1pt at least twice is that pair's zone (its median);
- a one-off gap borrows the nearest recurring value of the same role pair (`(빌림)`, never
  more than its own gap);
- nothing to borrow → `기준 없음`, and the pair is only checked for overlap.

Shapes that overlap or share a group are one unit — the outermost outline around them
(`외곽선(n개 도형: …)`) — since their own gaps say nothing.

`check` warns `임계 침범` when a slot's extra lines leave less than the zone before the shape
below. A `| fit` picture shrinks inside its frame and so never enters a zone.
`render` reads the rendered lines: `zone` when a frame's text runs past it (either way — a
bottom-anchored body overruns upward) into the zone, `drift` when slides of one archetype show
the same pair's gap spreading wider than the template's own cluster (at least 1pt), listing the
slides and gaps. Frames never move; the fix is shorter content or another archetype.

Known limit: pdftotext can merge lines of two side-by-side frames into one block; the
finding then lands on the right page and victim, but may name the neighbouring outline as the
source.


## `render`

Builds, converts through LibreOffice, writes PNG previews of every page, and audits the
rendered geometry — `overlap` (two text frames clash), `bunched` (lines inside one frame
sit closer than that frame's own norm, so text has outgrown its box), `off-slide` (the
renderer cut it). Clean means clean: the audit compares across frames and measures pitch
against each frame's median, so CJK fonts whose em box exceeds a 100% line do not trip it.

`render` first says which of the template's typefaces the renderer does not have. A
substituted font rewraps every line, so until those are installed the preview's line breaks
are the substitute's, not the deck's — the fix is to install the font, not to shorten the
words. The pptx itself always names the right faces. The bundled NanumSquare family is
always visible to the renderer (a private fontconfig file locally, a read-only mount in docker).

Read the previews for layout, not for spacing. LibreOffice pads the join between CJK and
Latin by default, so `평균 42분` renders as `평균  42 분` in the preview while the pptx holds
the original string. Check `<a:t>` in the built file before treating spacing as a defect.

Renderer is `soffice` on PATH or `DECK_RENDER_DOCKER=<image>`. With neither, `render`
refuses rather than pretending the layout was checked — say so and fall back to `build`.

