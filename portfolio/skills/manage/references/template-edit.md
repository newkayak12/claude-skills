# Template edit — moving a frame the deck cannot move

deck-builder never moves a frame (`deck-builder/references/limits.md`, "Frames do not move"): a
dropped slot leaves its gap, and a run's formatting comes from the template. When the user asks for
a frame to move or a run to change, the template's slide XML is edited — only then, only within the
safe set below, with a backup and a note.

## Safe set — `template_hash` and slot ids stay the same

`template_hash` (deck.mdx front matter) is built from the slide order and each slide's `slot id=type`
list; slot ids are given in XML document order, not screen position. So these keep the hash and every
slot name in deck.mdx:

- a shape's position `<a:off x y>` and size `<a:ext>`
- splitting or merging runs inside one paragraph; run properties (bold, size, colour)
- the template's own words

Never: adding, deleting or reordering shapes in the XML; changing a shape's kind (text ↔ picture);
adding, deleting or reordering slides; moving a shape into or out of a group. Each shifts slot ids
or the hash, and the deck stops matching.

A run split leaves the hash alone but makes `deck.catalog.md`'s formatting list stale: regenerate the
catalog after.

## Steps

1. The user said to fix it. Otherwise it goes into `template/다음렌더-지침.md` and stops here.
2. Check deck-builder cannot do it (`textN_plusK`, a same-format sibling, is the one exception).
3. Back up: `cp template/template.pptx _archive/template-before-<what>-<YYYY-MM-DD>.pptx`.
4. Open the slide XML with `zipfile` (slide N is `@sN`). Find the shape by its text, then work by its
   `<p:cNvPr name>`.
5. Move: change `<a:off>` y only, in EMU (1 cm = 360000), lined up with the neighbour it should match
   and keeping the original gaps. Split a run: copy another line's run properties for each part.
6. Write the new pptx to a temp path, every other zip entry copied as is; replace the template only
   after the checks pass.
7. Check: `check --deck deck.mdx` raises no template mismatch; the backup and the new file differ only
   in the intended `<a:off>` values and run counts (compare `<p:sp>` blocks by name); the shape count
   and order are unchanged.
8. Record in `template/NOTES.md` under "템플릿 직접 수정 — <date> (본인 지시)": backup path, why the
   hash holds, what moved where (cm), how runs were split, what deck.mdx changed with it, and the
   user's words when they confirm the result. Mark the matching `다음렌더-지침.md` item solved.
9. No build. The report says the template and source changed and `build/` still shows the old state.

## Report line

`확인한 것: 백업 <path> · check <n> error(s) (해시 그대로) · 바뀐 것 <shape: y a → b cm, runs 1 → 2>`
