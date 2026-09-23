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
| **Capacity is an estimate** | Overflow warnings come from frame width ÷ font size, not real text metrics. Treat them as a prompt to look, not a verdict. |
| **Nesting is only as visible as the template makes it** | A nested item is written at outline level 1. If the template's own body text defines no indent for level 1, it renders flush with the rest — the level is correct, the template just doesn't show it. |
| **Formatting follows the template** | A replaced run inherits the template run's font, size and color. `**bold**`, `*italic*` and `` `code` `` flip those attributes on a copy; anything beyond that (per-word color, size) is not expressible. |
| **Notes come from `deck.mdx`, not the template** | A template slide's own notes are not carried over; write what you want in `notes:`. If the template has no notes master, a plain one is added and the build says so. |
| **Autofit is not recalculated** | PowerPoint reflows shrink-to-fit text when the file is opened, so the on-screen result can differ slightly from the capacity estimate. |

## Where each one shows up

| Limit | Caught by |
|---|---|
| Content with no matching archetype | you, at Step 2 — the engine cannot tell |
| A table taller than the slide | `check`, as an error naming the rows that would be lost |
| Text too long for its frame | `check` warns from an estimate; `render` sees the real collision |
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
