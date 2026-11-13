# Resume — the detail behind resume-builder

The resume is the portfolio's second output, built the same way: designed in `resume-skeleton.md`
(`manage` step 9), built from `resume-deck.mdx` by this skill, straight into the user's own template.

## Design (`resume-skeleton.md`)

- Sections in the order of the user's template (`template/template.docx` or `resume.docx`); projects in
  the portfolio's order.
- Facts and sentences come from `portfolio-skeleton.md` only. A fact the portfolio lacks is fixed
  there first, then carried over.
- A developer term gets a plain gloss in the same line, as in the portfolio.
- Page budget (`pages:`) is the user's; what to cut to meet it is the user's decision.

## Build (`resume-deck.mdx` → `build/resume.docx`)

- Never a re-styled copy of the template made by hand, never a post-build script: the engine copies
  the template's look.
- `resume.py catalog` lists the template's styles and its `looks` (each distinct size, weight, colour
  and list once, with its text).
- Front matter maps each role the resume uses:
  - `styles:` role → a paragraph style, when the template has real styles;
  - `samples:` role → the opening text of the template paragraph whose look it takes, when the
    template tells lines apart by run format only (all `Normal`). Font, size, colour, spacing and list
    numbering are copied from that paragraph.
- Markdown shapes give five roles (`#` name, `##` section, `###` entry, `-` bullet, plain body).
  Any other line names its role: `{contact} …`, `{company} …`, `{meta} 기술: …`.
- The template's photo (an anchored drawing) is kept on the first paragraph.
- The finish a post-build script used to add, from the front matter and the template alone:
  - a `라벨: 값` line whose sample paragraph has a label run and a value run in two formats takes both;
  - a URL or mail address is a link (ATS and readers click it);
  - `keep: section, entry, company` — those roles stay on the page of the line after them
    (default `section, entry`); the first line under a section has no space before it;
  - `spacing:` role → `<before> <after>` in pt, when the template's own spacing reads too tight;
  - `look:` role → `size <pt> color <RRGGBB> label <RRGGBB>` (any of them), when the sample's run
    reads too small or too faint (contrast), or its `라벨: 값` line needs a label colour of its own;
  - `title:`, `author:` → the document properties; `photo_alt:` → the photo's alt text;
  - `break: 경력, 사이드 프로젝트` — those `##` sections start a new page;
  - `photo: assets/profile.jpg` — the template photo's picture replaced (PNG or JPEG), its frame
    kept, cropped from the centre to the frame's shape, never stretched.
- A role used but mapped nowhere, a style the template lacks, or a sample text no paragraph starts
  with is refused before anything is written.

## Final AI-trace check (every build)

`build` ends with `office_render.ai_traces` over every XML part of the .docx and takes every AI trace
out: an AI disclaimer in a picture's alt text (`descr`/`title` on `docPr`; the rest of the alt text
kept), an AI tool or library named in `docProps` (the tool cut from a title, a library author
emptied), and each visible sentence that says AI wrote it or may be wrong ("As an AI", "AI가 생성",
"ChatGPT로 작성", `Generated with`, `Co-Authored-By`) — the sentence only, a ` / ` counts as a sentence
end; a Word paragraph left empty goes, a slide paragraph stays blank. `ai_traces.removed_text` lists
each removal word for word. Work annotations are never removed. The same function runs in
`deck-builder build`; `python3 portfolio/scripts/office_render.py ai-traces <file> [--report-only]` runs it alone.

## Render and fit

- `render` only when the user says. Past the page budget it warns, and where `pdftotext` or PyMuPDF
  exists it reports `over_lines`: the text lines past the last allowed page.
- `word_check`: a template saved by Word carries `w:lastRenderedPageBreak` marks where Word last broke
  its pages. `render` converts the template with the same renderer and checks that each of those pages
  opens with the same text (a header repeated on every page is skipped). A mismatch is a warning: two
  LibreOffice builds have laid out one docx a page apart (2026-11-13: 25.8 broke a Word template's page 3
  early, 26.8.3 matched Word on all three), so that renderer's page count is not Word's.
- Over budget → propose cuts with their line counts (a section, a block to one bullet) and wait.
  Never shrink type, line spacing or margins below the template's.
- Look at every page: nothing crosses the safe area, the photo touches no text, no line ends with a
  lone word. A problem goes into `template/next-render.md` like a deck problem.

## Never

| Mistake | Instead |
|---|---|
| Ignoring the template (no photo, other fonts, other section order) | The template's order, look and photo |
| Adding styles to a copy of the template by hand | `samples:` on the user's own template |
| Fitting the page by smaller type | Cut text by `over_lines`, with the user |
| Using an older resume as ground | Build from the current portfolio-skeleton; an older resume is stale |
