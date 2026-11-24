# Generating the art a deck needs

A picture slot with no source is where the pipeline breaks. Everything else in a deck is
text a model can write, and then someone still has to go make a diagram by hand. Write
the art as an `.svg` and it becomes source like the rest of the deck — diffable,
regenerable, reviewable.

```markdown
pic1: assets/latency.svg
```

**The pptx never carries the SVG — only a PNG.** A deck has to look the same in
PowerPoint, Keynote, Google Slides and a PDF export, and SVG does not: older PowerPoint
renders nothing for it. So the vector file stays in your source tree and the package gets
raster. The build asserts this, and `.emf`, `.wmf`, `.pdf` and friends are refused outright
with a note to export them to PNG first — `.svg` is the one vector format converted on the
way in.

At build the SVG is rasterized to a PNG sized for its frame and embedded. It is cached by
content hash in `.deckcache/`, so the same SVG always yields the same bytes and repeated
builds do not re-render. This is the one step that needs the renderer at **build** time;
`check` reports an error if an SVG is used and nothing can rasterize it.

## Two rules make it merge with the reference

`check` enforces both: it names any hex in the SVG that is far from every color the
template uses, and warns when the art's aspect would make the build crop it.

**Write it in the template's colors.** `catalog` prints a Palette section — the theme
slots and the colors the slides actually use. Use those hexes, not ones that merely look
close. The reference supplies the design; the generated source supplies only the content.
A filled box — panel, bar, tag, table cell — takes one of the tints the Palette lists (lighter
60% or 80%). Emphasis — a risk, a failure, a key number — takes the slides' own most-used accent or
bold, never a loud colour the slides use once or not at all: a template that uses `#FF0000` once
does not want red bars or red labels (blind bench 2026-11-19: red and yellow fills read harsh;
user 2026-11-20: "도식내 빨간글자 존나 조화롭지 못하네"). `check` warns on loud text, lines or boxes.

**Author it at the frame's exact pt size.** `catalog` gives it per picture slot
(`author at 441×248 pt`). Use those numbers as the SVG's `width`, `height` and `viewBox`,
and then `font-size="16"` in the art is the same 16pt as the body text beside it — the
catalog's Type section lists the sizes and families the template really uses. Matching the
frame also means nothing is cropped; miss the aspect ratio and `check` warns before you
see a trimmed diagram in the PDF.

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="441" height="248" viewBox="0 0 441 248">
  <rect width="441" height="248" fill="#FBFAF7"/>
  <rect x="24" y="40" width="300" height="26" fill="#10243F"/>
  <text x="332" y="60" font-family="Verdana" font-size="16" fill="#10243F">42분</text>
  <text x="24" y="200" font-family="Verdana" font-size="13" fill="#6B7785">배포 1건 소요 시간</text>
</svg>
```

## Why not a chart slot

A chart's series values live in an embedded xlsx plus a cached copy in the chart XML, and
writing both consistently is a larger job than this engine does. `catalog` lists chart
slots and `build` leaves them at the template's numbers. Generating an SVG into a picture
slot is the way to put new numbers on a slide.

## Choosing a form

| What the figure shows | Form |
|---|---|
| before / after | paired bars, or a two-column contrast |
| a sequence over time | a timeline or a sequence diagram |
| a distribution or a count | a chart |
| a choice among options | a comparison table, the chosen row marked |
| a structure | boxes and arrows |

List every figure's form by page before drawing. When more than half of a deck's figures are
box-and-arrow, redraw the ones another form says better (user, 2026-11-22: "도식화가 천편일률적이다
(다른 방향으로 표현할 수 있었을텐데)"). Pages of the same role — each chapter's results page — never
share one layout of forms: bench17 opened all four results pages with the same single stat card and
judges read them as one template. Each results page takes its form from that chapter's own result:
a before/after, a ratio, a timeline of what was caught, a count against its total.
