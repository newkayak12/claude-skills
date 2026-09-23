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
