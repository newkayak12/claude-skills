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


## `render`

Builds, converts through LibreOffice, writes PNG previews of every page, and audits the
rendered geometry — `overlap` (two text frames clash), `bunched` (lines inside one frame
sit closer than that frame's own norm, so text has outgrown its box), `off-slide` (the
renderer cut it). Clean means clean: the audit compares across frames and measures pitch
against each frame's median, so CJK fonts whose em box exceeds a 100% line do not trip it.

`render` first says which of the template's typefaces the renderer does not have. A
substituted font rewraps every line, so until those are installed the preview's line breaks
are the substitute's, not the deck's — the fix is to install the font, not to shorten the
words. The pptx itself always names the right faces.

Read the previews for layout, not for spacing. LibreOffice pads the join between CJK and
Latin by default, so `평균 42분` renders as `평균  42 분` in the preview while the pptx holds
the original string. Check `<a:t>` in the built file before treating spacing as a defect.

Renderer is `soffice` on PATH or `DECK_RENDER_DOCKER=<image>`. With neither, `render`
refuses rather than pretending the layout was checked — say so and fall back to `build`.

