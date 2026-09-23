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
- **Visibility decides, not tidiness.** `| transparent` is right when the image's content stays legible against the slide; `check` says when it would not, and a panel behind the image is the better answer there. Don't reach for transparency because it sounds cleaner.
- **Never crop away content without saying so.** `check` reports the percentage; repeat it to the user and offer `| fit`. A picture losing half of itself is the same defect as a table row falling off the slide.
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

Pictures take a fit mode — `pic1: shot.png | fit` keeps the whole image, the default
`fill` crops it to the frame — and `| transparent` knocks a PNG's background out so a
white-backed screenshot stops reading as a pasted box on a dark slide. Slots you leave out keep the template's content. Full syntax — slot forms, `!drop`,
`notes:`, inline emphasis, outline levels, and what `template_hash` protects against —
is in `references/mdx-syntax.md`. Read it before writing the first slide.

### Step 3b · Generate the art the deck needs

A picture slot with no source is where the pipeline breaks: everything else is text a
model can write, and then someone has to draw a diagram by hand. Write it as an `.svg`
instead, in the template's colors and at the frame's exact pt size — both printed by
`catalog` — and it becomes source like the rest of the deck. It is rasterized at build
time: the pptx only ever carries PNG, because SVG does not render the same everywhere and
older PowerPoint shows nothing for it.

See `references/generated-art.md` for the rules and a worked example.

### Step 4 · Check

```bash
python3 /abs/path/scripts/deck.py check --deck deck.mdx
```

Errors (unknown archetype, unknown slot, missing image, wrong value shape, a table taller
than the slide, a moved template) must be fixed. Warnings are judgment calls — surface
them: text longer than its frame, more list items than the template shows, untouched slots
still holding template copy, and for every picture how much `fill` would crop away, whether
its resolution holds up at that size, whether generated art left the template's palette,
and whether its border will read as a pasted box on that slide.

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
rendered geometry — `overlap` (two text frames clash), `bunched` (lines inside one frame
sit closer than that frame's own norm, so text has outgrown its box), `off-slide` (the
renderer cut it). Clean means clean: the audit compares across frames and measures pitch
against each frame's median, so CJK fonts whose em box exceeds a 100% line do not trip it.

Renderer is `soffice` on PATH or `DECK_RENDER_DOCKER=<image>`. With neither, `render`
refuses rather than pretending the layout was checked — say so and fall back to `build`.

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

The five that change what you can promise:

- **No new layouts.** Every output slide is a clone of a template slide. Content with no
  matching archetype needs the template extended in PowerPoint first — say so rather than
  approximating.
- **A reference template is mandatory.** There is no built-in design and no fallback.
- **Charts are not writable.** `catalog` lists chart slots; `build` leaves the template's
  numbers. Generate an SVG into a picture slot instead.
- **Layout truth needs a renderer.** `check` estimates; only `render` sees what collides.
- **Formatting follows the template.** Emphasis flips attributes on the template's own run;
  per-word color or size is not expressible.

Full table, and which step catches each one: `references/limits.md`.

## Related Skills

- `portfolio:ppt-keycolor-changer` — recolor the template (or the built deck) to a brand palette
- `write:doc-coauthoring` — develop the content before mapping it onto slides
- `think:thought-organizer` — turn scattered notes into the slide-by-slide structure Step 2 needs
