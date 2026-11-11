# `deck.mdx` syntax

The deck source. Compiled, not read — the extension is enforced.

## Front matter

```markdown
---
template: template.pptx        # required; no built-in template exists
template_hash: 5f84440a3521    # from `catalog`; pins the deck to the template's structure
output: deck.pptx
captions: into-picture         # optional — see "Layout in the deck" below
panel_margin: 18               # optional, pt
---
```

`template_hash` is a fingerprint of the archetypes and their slots. `check` and `build`
refuse when it has moved, which is the only thing standing between "someone reordered a
template slide" and a deck where `@s3` quietly means something else. Editing the
template's own wording does not move it; only structure does, because structure is what
this file depends on.

## Slides and slots

```markdown
## @s1
title: 신뢰성 플랫폼 2026 리뷰
subtitle: 배포 파이프라인을 다시 세우고 얻은 것
notes: 첫 30초는 왜 이걸 했는지에만 쓸 것

## @s3
title: 분기 요약
text1:
  - 응답 p99 **2.1s → 340ms**
  - 배포 실패율 12% → 0.4%
    - 롤백 경로 단순화가 컸다
table1:
  | 지표 | 이전 | 이후 |
  | p99 | 2.1s | 340ms |
pic1: assets/arch.svg
text5: !drop
```

| Form | Meaning |
|---|---|
| `## @s3` | start a slide from template slide 3 (trailing text is a comment) |
| `key: value` | text slot |
| `key:` + indented `- ` lines | list slot; two extra spaces = one outline level deeper |
| `key:` + indented `\| a \| b \|` lines | table rows; the first fills the header when the template has one |
| `key:` + indented plain lines | multi-line text, one paragraph per line |
| `key: path/to.png` | picture slot; relative paths resolve from `deck.mdx` |
| `key: path/to.png \| fit` | how the image meets the frame — see below |
| `key: path/to.svg` | same, rasterized at build time and cached in `.deckcache/` |
| `key: !drop` | delete that shape from the slide |
| `textN_plusK: value` | clone: the shape (>=3 same-format siblings in one group, constant interval), else the row group holding `textN` (>=2 same-format trailing groups, last observed interval, gaps within 10%), K steps past the last; each cloned row group takes its own `<slot>_plusK` values. Refused with a reason when irregular, differing or off the slide |
| `notes:` | speaker notes; reserved, works on any archetype |
| `place:` + `- slot: x y [w=W] [h=H]` | move (and size) a template shape, in pt from the slide's top-left; reserved |
| `distribute: 70` | re-space the slide's top-level row groups evenly from y=70pt to the safe area's bottom; reserved |
| slot omitted | keeps the template's own content |

## Worked example

```markdown
---
template: template.pptx
template_hash: 5f84440a3521      # from catalog — pins the deck to the template's structure
output: deck.pptx
---

## @s3
title: 분기 요약
text1:
  - 응답 p99 **2.1s → 340ms**
  - 배포 실패율 12% → 0.4%
table1:
  | 지표 | 이전 | 이후 |
  | p99 | 2.1s | 340ms |
pic1: assets/arch.svg
notes: 숫자의 출처를 먼저 말할 것
text5: !drop
```

## Inline emphasis

`**bold**`, `*italic*` and `` `code` `` work inside any text or list value. Each becomes a
separate run cloned from the template's own, so an emphasised phrase keeps the font, size
and color it was going to have — emphasis flips attributes, it does not replace type. An
unmatched marker stays literal text.

## Formats inside a paragraph

A template paragraph often mixes formats — a 16pt blue label then a 10pt grey note, a bold
key then regular values. `catalog` numbers them per paragraph (`서식: 1 = 16pt #435EA0 굵게 ·
2 = 10pt #A6A6A6`; size, weight, colour and face count, `lang` does not).

| Form | Meaning |
|---|---|
| `[text]{n}` | write `text` in that paragraph's format n; unmarked text is format 1 |
| `[text]{#FFFFFF}` · `[text]{bg1 75%}` | recolour the run: a hex colour, or a theme slot (`bg1` `bg2` `tx1` `tx2` `accent1`–`accent6`) with an optional luminance |
| `[1)]{sup}` · `[2]{sub}` | raise or lower the run (a footnote mark after a word) |
| `[text]{2 #FFFFFF sup}` | any of the above together, space-separated |
| `<br>` | line break inside the paragraph (the template's `<a:br/>`) |
| `\[`, `\]`, `\*`, `` \` `` | the literal character, not markup |
| `\ ` | a space the parser would trim (a value's leading/trailing spaces); a value ending in `\` ends in a space |

`**`/`*`/`` ` `` apply on top of the chosen format. A format the paragraph does not have is a
`check` error that lists the ones it has. Paragraph i (and table row i) is cloned from the
template's paragraph (row) i when it exists at the same level, so each keeps its own indent,
spacing and cell formats; extra items repeat the level's first paragraph (the last row).

`deck.py extract --template t.pptx --output deck.mdx` writes the template's own content in
this syntax; built unchanged, it reproduces every paragraph's runs, breaks and indents.

## Layout in the deck

What a workspace used to patch after every build lives here, so a build is the deck.

```markdown
## @s3
text4: !drop
place:
  - text5: 26.4 270             # x y, pt from the slide's top-left
  - text6: 279.3 156 h=54       # and a new height
  - text22: 156.8 408.8 w=253.9 # or a new width
```

`place:` moves a shape with its own frame; one whose position comes from the layout is named
in the build, not moved. It runs after every value and the two options below, so it wins.
`check` measures a placed slot at its placed frame (position and size), not the template's.

`distribute: 70` (a slide line beside `place:`) re-spaces the slide's top-level row groups
(`p:grpSp`) evenly: order and size kept, only y changes, the first row's top at 70pt and the
last row's bottom at the safe area's bottom, the gaps equal. For a contents slide whose cloned
last row (`text7_plus1`) fell below the safe area. The bottom is the slide height less the
bottom margin of `style/레이아웃.md` (in the deck's folder or its parent), else less 28pt. Rows
taller than that room are reported and none are moved. It runs after `place:` and `!drop`.

A picture slot holding an SVG is warned in `check` when its smallest text, at the size the
frame shows it, is under 8pt (`figure text ~5.4pt at this size`): enlarge the picture, cut the
figure's text, or redraw it larger. Sizes come from `font-size` (attribute, `style=`, or a parent
`<g>`); scale is the frame over the viewBox (`fit`: the smaller ratio). Warning only.

| Front matter | What it does |
|---|---|
| `captions: into-picture` | a `[ … ]` caption above or below a picture is deleted and the picture grows into its room, aspect kept, inside its rounded panel, its neighbours and the slide — for diagrams that carry their own title |
| `panel_margin: 18` | every picture whose centre sits in a rounded panel is fitted into the panel less 18pt left, right and bottom, under the panel's own text, centred across and set on the bottom |

Both act on a slide's top-level shapes; a group's children are left as they are.

## Outline levels

Indenting a list item two extra spaces writes it at outline level 1. It only *looks*
nested if the template defines an indent for that level; the level is set correctly
either way.

## How an image meets its frame

| Mode | What it does | When |
|---|---|---|
| `fill` (default) | scales to cover the frame and crops the overflow, centred | photos, backgrounds — anything whose edges carry no meaning |
| `fit` | shrinks the frame to the image's own shape, centred in the box the template drew | diagrams, screenshots, charts, logos — where cropping destroys the point |
| `stretch` | fills the frame exactly, distorting | almost never; say it out loud when you use it |

`| transparent` rides alongside any mode: `| fit transparent`. It knocks a PNG's
background out by flooding inward **from the edges**, so white inside a diagram survives
and only the background that touches the outside is removed. The result is cached by
content, so the same file always yields the same bytes. It is refused — with a reason,
not silently — when there is no uniform border to remove, when removing it would leave
almost nothing, or when the file is not a decodable PNG.

Visibility is the point, not transparency: if what survives the knockout averages close
to the slide's own background, `check` says so and tells you a panel behind the image
beats transparency there.

`fill` takes an anchor: `| fill top`, `bottom`, `left`, `right`. A screenshot whose
content sits at the top survives `| fill top` where a centred crop would behead it.

A crop discards content, so `check` warns whenever `fill` would throw away 10% or more,
with the number, and the build repeats it. The engine does not lose content quietly —
the same rule that makes an over-long table an error.

## What `check` says about a picture

| Warning | Why |
|---|---|
| crops N% of the image away | `fill` on a mismatched aspect; use `fit` or an anchor |
| Npx across an Mpt frame (D dpi) | below ~110 dpi it looks soft on a projector |
| D dpi, N KB | above ~400 dpi nothing more reaches the screen; it is file size only |
| paints with colors the template does not use | generated art drifting off the reference's palette |
| has a #X border on a #Y slide | the image will read as a pasted box; add `\| transparent` or match the background |
| what is left averages #X against a #Y slide | `\| transparent` would work but leave the content nearly invisible |
