# What deck-builder cannot do

Stated here rather than discovered in a PDF. Report the ones that bite on a given deck.

| Limitation | Detail |
|---|---|
| **A template is mandatory** | There is no built-in design. Without a reference `.pptx` the engine exits with an error and produces nothing. |
| **No new layouts** | Output slides are clones of template slides. Content with no matching archetype needs the template extended in PowerPoint first. |
| **Charts are not writable** | Series values live in an embedded xlsx plus cached XML. `catalog` lists chart slots; `build` leaves them at template values. |
| **The package is raster only** | SVG is rasterized on the way in; other vector formats (`.emf`, `.wmf`, `.pdf`, `.eps`, `.ai`) are refused — export them to PNG. A deck must look the same in PowerPoint, Keynote and a PDF export. |
| **SVG assets need the renderer at build time** | PNG and JPEG assets need nothing. An `.svg` has to be rasterized, so `build` needs LibreOffice for that slot. |
| **Layout truth needs a renderer** | `check` estimates from frame width ÷ font size. Only `render` sees what actually collides, and it needs LibreOffice. |
| **Transparency is PNG only** | The knockout decodes PNG; JPEG cannot be decoded here, so convert first. Interlaced PNG is declined rather than guessed at. |
| **Color checks are approximate** | Palette conformance reads hexes out of SVG text; the pasted-box check decodes PNG borders only (not JPEG) and compares against the slide, layout or master background — not against a shape sitting behind the frame. |
| **Legibility scoring is PNG only** | Text over a picture is measured against the decoded PNG behind it. A JPEG or SVG backdrop is not scored, and a text color the template inherits rather than states is skipped rather than guessed at. |
| **Contrast is area, not glyphs** | The score is the fraction of the text box's area below the threshold, not per-letter. A busy image can pass on average and still swallow one word. |
| **Frames do not move** | Every frame keeps the position and size the template gave it. Writing less than the template holds leaves the gap where the rest would have been; `check` reports it, but only the template can fix it. |
| **A static estimate cannot resolve a one-line margin** | Wrapping is predicted from a per-script em model, not the real font's metrics, so it is worth about ±1 line. Designed frames often carry less slack than that. `check` therefore reports only an overrun past that slack, measured against the template's own line count; `render` settles the rest. |
| **Capacity is an estimate** | Widths come from frame width ÷ font size with a per-script em model (full-width for CJK, ~0.55 em for Latin), not the real font's metrics. It is calibrated against the template's own text — a slot whose own content already wraps is treated as a wrapping slot — so it is a prompt to look, not a verdict. |
| **A missing font makes the preview lie** | LibreOffice substitutes silently and a substitute rewraps every line. `render` names the typefaces it could not find; until they are installed, judge content from the pptx and only layout that survives substitution from the preview. |
| **Nesting is only as visible as the template makes it** | A nested item is written at outline level 1. If the template's own body text defines no indent for level 1, it renders flush with the rest — the level is correct, the template just doesn't show it. |
| **Formatting follows the template** | A replaced run inherits the template run's font, size and color. `**bold**`, `*italic*` and `` `code` `` flip those attributes on a copy; anything beyond that (per-word color, size) is not expressible. |
| **Notes come from `deck.mdx`, not the template** | A template slide's own notes are not carried over; write what you want in `notes:`. If the template has no notes master, a plain one is added and the build says so. |
| **The template's own vector media stays** | PowerPoint stores an SVG beside a PNG fallback, so real templates ship vector media. The raster-only invariant applies to what the build adds, not to what the template already carried. |
| **Previews are LibreOffice's typography, not PowerPoint's** | The PDF and PNG previews come from LibreOffice, which pads the CJK/Latin join by default — `평균 42분` shows as `평균  42 분`. The pptx string is unchanged; use the previews to judge layout, and the built file to judge text. |
| **Autofit is not recalculated** | PowerPoint reflows shrink-to-fit text when the file is opened, so the on-screen result can differ slightly from the capacity estimate. |

## Where each one shows up

| Limit | Caught by |
|---|---|
| Content with no matching archetype | you, at Step 2 — the engine cannot tell |
| A table taller than the slide | `check`, as an error naming the rows that would be lost |
| A frame holding far less than it was drawn for | `check`, with the percentage of the template's own volume |
| Text too wide for a one-line slot | `check`, measured in em against the template's own line |
| Text far longer than the template's own | `check`, as a warning with the percentage |
| Text running lower than the design puts it | `check`, naming what it runs into — an error when it reaches a shape, a warning into empty space |
| A typeface the renderer does not have | `render`, before the preview it would otherwise mislead you with |
| An SVG at the wrong aspect ratio | `check`, as a warning |
| An SVG with no renderer | `check`, as an error |
| A template that moved under the deck | `check` and `build`, via `template_hash` |
| A chart slot | `catalog` lists it; `build` says it left the numbers alone |
| An image `fill` would crop | `check` warns with the percentage; `build` repeats it |
| An image too low- or high-resolution for its frame | `check`, as a warning with the effective dpi |
| Generated art off the template's palette | `check`, naming each stray hex and its nearest template color |
| An image whose border clashes with the slide | `check`, as a warning (PNG only), pointing at `\| transparent` |
| Text that will not read against the picture under it | `check`, with the failing area fraction and the average color behind the words |
| A picture drawn over the text it covers | `check`, as an error naming the buried slot |
| A knockout that would leave the content invisible | `check`, before you build it |
| A knockout with nothing to remove, or nothing left | `build`, refusing with the reason |
