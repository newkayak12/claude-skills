---
name: deck-builder
description: >-
  Use when a PPTX must be built from content instead of typed slide by slide — read a
  template, write the deck as markdown, render. Triggers: PPT 만들어줘, 템플릿에 내용
  채워줘, 발표자료 생성, 슬라이드 자동 생성, md로 PPT 만들기, deck from markdown.
effort: medium
scenarios:
  - "이 템플릿 읽고 우리 분기 리뷰 내용으로 PPT 만들어줘"
  - "발표자료 초안을 md로 쓰고 템플릿에 렌더해줘"
  - "슬라이드 내용만 고쳐서 다시 뽑아줘"
  - "Read this template and build a 12-slide deck from my notes"
  - "Turn deck.mdx into a pptx using the brand template"
  - "Regenerate the deck — I changed three bullets"
compatibility:
  required:
    - python 3.9+ (stdlib only — zipfile, xml.etree, re; no python-pptx, no PyYAML)
---

## What this skill does

Treats a deck as a build, not a document:

| Artifact | Role |
|---|---|
| `template.pptx` | the toolchain — its slides are the archetype catalog. **Always required.** |
| `deck.mdx` | the source — the only file anyone edits |
| `assets/*.svg` | generated art, also source — content only, no design |
| `deck.pptx` | the build artifact — regenerated in full every time |
| `deck.pdf` + page previews | what a person actually looks at — the only place layout is |

Each output slide is a **clone of a template slide** with its content swapped, so the
template's design survives byte for byte. Nothing is laid out from scratch.

Engine: `scripts/deck.py` (invoke with an absolute path).

---

## Standing Mandates

- **Never build without a reference template.** There is no built-in deck design and no fallback. If the user has not given you a `.pptx`, stop and ask for one — do not assemble slides some other way, do not offer a generic deck, do not fabricate a template. The engine refuses too, but the ask belongs to you, before any work.
- **The source file is `deck.mdx`, never `deck.md`.** It is compiled, not read. The engine rejects any other extension.
- **Catalog before writing.** Never author `deck.mdx` from a guess about the template. Run `catalog` and write against the slot ids it prints.
- **Never hand-edit the output pptx.** It is regenerated on the next build. Corrections go into `deck.mdx`.
- **Run `check` before `build`, and show the user the warnings.** Overflow warnings are what stands between crowded text and a slide nobody can read.
- **Never hand-author a picture slot's art as a binary.** Write the SVG so the deck stays reproducible from text. A PNG someone pasted in cannot be regenerated, re-colored, or reviewed in a diff.
- **A deck is read by people, so look at it.** When a renderer is available, finish with `render`, not `build` — the layout audit and the page previews are the only place text collisions show up. If no renderer is available, say so plainly in the report instead of implying the layout was checked.
- **Never invent an archetype.** If no template slide fits the content, say so and ask whether to reshape the content or extend the template — do not approximate.
- **Report the warnings you chose to ignore.** An overflow warning you decided was fine still belongs in the final report — the user is the one who will see the slide.
- **Charts are read-only.** Say this out loud when the chosen archetype has one; the template's numbers ship unless the user edits the chart in PowerPoint.

---

## Process

### Step 0 · Get the reference template

Ask for the `.pptx` before anything else if you don't have one:

> "레퍼런스 템플릿 pptx를 주세요. deck-builder는 템플릿 슬라이드를 복제하는 방식이라, 템플릿 없이는 만들 수 있는 슬라이드가 없습니다."

Do not proceed on a description of a template, a similar-looking deck, or a promise to
supply one later.

### Step 1 · Catalog the template

```bash
python3 /abs/path/scripts/deck.py catalog \
  --template "template.pptx" --output "deck.catalog.md"
```

Prints every archetype as `@s1`…`@sN` with its slots, what the template currently shows,
and a capacity estimate. Read it before anything else.

### Step 2 · Map content onto archetypes

Ask the user for the content if you don't have it. Then, before writing any md, show a
one-line-per-slide plan:

```
1. @s1  표지            — 제목 + 부제
2. @s3  요약            — 불릿 3개 + 한 줄 결론
3. @s7  숫자            — 표 4행
```

Get a nod on the plan. Wrong archetype choice is the expensive mistake, not wrong wording.

### Step 3 · Write `deck.mdx`

```markdown
---
template: template.pptx
template_hash: 5f84440a3521
output: deck.pptx
---

## @s1
title: 신뢰성 플랫폼 2026 리뷰
subtitle: 배포 파이프라인을 다시 세우고 얻은 것
notes: 첫 30초는 왜 이걸 했는지에만 쓸 것

## @s3
title: 분기 요약
text1:
  - 응답 p99 2.1s → 340ms
  - 배포 실패율 12% → 0.4%
    - 롤백 경로 단순화가 컸다
table1:
  | 지표 | 이전 | 이후 |
  | p99 | 2.1s | 340ms |
pic1: assets/arch.png
text5: !drop
```

Syntax, in full:

| Form | Meaning |
|---|---|
| `## @s3` | start a slide from template slide 3 (trailing text is a comment) |
| `key: value` | text slot |
| `key:` + indented `- ` lines | list slot; two extra spaces = one outline level deeper |
| `key:` + indented `\| a \| b \|` lines | table rows; first row fills the header when the template has one |
| `key:` + indented plain lines | multi-line text, one paragraph per line |
| `key: path/to.png` | picture slot; relative paths resolve from `deck.mdx` |
| `key: path/to.svg` | same, but the SVG is rasterized at build time and cached in `.deckcache/` |
| `key: !drop` | delete that shape from the slide |
| `notes:` | speaker notes for the slide — reserved, works on any archetype |
| `**bold**` `*italic*` `` `code` `` | inline emphasis inside any text or list value |
| slot omitted | keeps the template's own content |

### Step 3b · Generate the art the deck needs

A picture slot with no source is where the pipeline usually breaks — everything else is
text a model can write, and then someone has to go make a diagram by hand. Write the art
as an `.svg` instead, and it becomes source like the rest of the deck.

Two rules make it merge cleanly with the reference:

1. **Write it in the template's palette.** `catalog` prints a Palette section — theme slots
   and the colors the slides actually use. Use those hexes, not ones that merely look close.
   The reference supplies the design; the generated source supplies only the content. The
   same goes for type: use the template's families and its real pt sizes, both printed by
   `catalog`, rather than something that merely looks close.
2. **Author it at the frame's exact pt size.** The catalog gives it (`author at 441×248 pt`).
   Use those numbers as the SVG's `width`/`height`/`viewBox`, and then `font-size="16"` in
   the SVG is the same 16pt as the body text beside it — the catalog's Type section lists
   the sizes the template actually uses. Matching the frame also means nothing is cropped;
   miss the aspect ratio and `check` warns before you see a trimmed diagram.

```markdown
pic1: assets/latency.svg
```

At build the SVG is rasterized to a PNG sized for its frame and embedded. It is cached by
content hash in `.deckcache/`, so the same SVG always yields the same bytes and repeated
builds do not re-render. This is the one step that needs the renderer at **build** time —
`check` reports it as an error if an SVG is used and nothing can rasterize it.

### Step 3c · Pin the template

`catalog` prints a `template_hash` — a fingerprint of the archetypes and their slots.
Copy it into the front matter. `check` and `build` then refuse quietly-wrong output: if
someone inserts, deletes or reorders a template slide, `@s3` starts meaning a different
slide, and without the pin that shows up as a strange-looking deck rather than an error.

Editing the template's own wording does not move the hash — only structure does, because
structure is what `deck.mdx` depends on.

### Step 4 · Check

```bash
python3 /abs/path/scripts/deck.py check --deck deck.mdx
```

Errors (unknown archetype, unknown slot, missing image, wrong value shape) must be fixed.
Warnings (text longer than the frame fits, more list items than the template shows,
untouched slots still holding template copy) are judgment calls — surface them.

### Step 5 · Build

```bash
python3 /abs/path/scripts/deck.py build --deck deck.mdx [--output out.pptx] [--strict]
```

The same `deck.mdx` always produces a byte-identical pptx.

### Step 6 · Render and look

```bash
python3 /abs/path/scripts/deck.py render --deck deck.mdx
```

Builds, converts through LibreOffice, writes PNG previews of every page, and audits the
rendered geometry:

| Finding | Means |
|---|---|
| `overlap` | two text frames physically clash on the page |
| `bunched` | lines inside one frame sit closer than that frame's own norm — text has outgrown its box |
| `off-slide` | text is outside the page box; the renderer cut it |

Clean means clean: the audit compares text across frames and measures line pitch against
each frame's median, so it does not cry wolf over CJK fonts whose em box is taller than a
100% line.

The renderer is `soffice` on PATH, or `DECK_RENDER_DOCKER=<image>` for a container. With
neither, `render` refuses rather than pretending the layout was checked — report that to
the user and fall back to `build`.

---

## Output Template

Report after a build:

```
빌드 완료 — <출력 경로>
  슬라이드 <N>개 · 템플릿 <이름> · 이미지 <M>개 삽입
  렌더 검사 — 겹침 0건 (또는: 3페이지 제목이 본문과 겹칩니다)

아키타입 사용
  @s1 ×1  표지
  @s3 ×4  본문

확인 필요
  · 3번 슬라이드 title 58자 (프레임 ~39자/줄) — 두 줄로 넘어갑니다
  · 5번 슬라이드 chart1 — 차트 수치는 템플릿 값 그대로입니다

다음 수정은 deck.mdx만 고치고 다시 build 하세요. 출력 pptx는 손대면 날아갑니다.
```

---

## What Claude Does / What You Do

| Claude | You |
|---|---|
| Asks for the reference pptx, refuses to proceed without it | Provides the template — mandatory — and the raw content |
| Runs `catalog`, reads the slot map | Reviews the archetype list |
| Proposes the archetype-per-slide plan | Approves or rearranges the plan |
| Writes and revises `deck.mdx` | Edits `deck.mdx` directly whenever you prefer |
| Runs `check`, reports every warning | Decides whether an overflow warning matters |
| Runs `render`, looks at the previews, reports collisions | Opens the pptx, edits charts if needed |

---

## Limitations

| Limitation | Detail |
|---|---|
| **A template is mandatory** | There is no built-in design. Without a reference `.pptx` the engine exits with an error and produces nothing. |
| **No new layouts** | Output slides are clones of template slides. Content with no matching archetype needs the template extended in PowerPoint first. |
| **Charts are not writable** | Series values live in an embedded xlsx plus cached XML. `catalog` lists chart slots; `build` leaves them at template values. |
| **SVG assets need the renderer at build time** | PNG and JPEG assets need nothing. An `.svg` has to be rasterized, so `build` needs LibreOffice for that slot. |
| **Layout truth needs a renderer** | `check` estimates from frame width ÷ font size. Only `render` sees what actually collides, and it needs LibreOffice. |
| **Capacity is an estimate** | Overflow warnings come from frame width ÷ font size, not real text metrics. Treat them as a prompt to look, not a verdict. |
| **Nesting is only as visible as the template makes it** | A nested item is written at outline level 1. If the template's own body text defines no indent for level 1, it renders flush with the rest — the level is correct, the template just doesn't show it. |
| **Formatting follows the template** | A replaced run inherits the template run's font, size and color. `**bold**`, `*italic*` and `` `code` `` flip those attributes on a copy; anything beyond that (per-word color, size) is not expressible. |
| **Notes come from `deck.mdx`, not the template** | A template slide's own notes are not carried over; write what you want in `notes:`. If the template has no notes master, a plain one is added and the build says so. |
| **Autofit is not recalculated** | PowerPoint reflows shrink-to-fit text when the file is opened, so the on-screen result can differ slightly from the capacity estimate. |

---

## Related Skills

- `portfolio:ppt-keycolor-changer` — recolor the template (or the built deck) to a brand palette
- `write:doc-coauthoring` — develop the content before mapping it onto slides
- `think:thought-organizer` — turn scattered notes into the slide-by-slide structure Step 2 needs
