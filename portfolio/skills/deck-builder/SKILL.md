---
name: deck-builder
description: >-
  Use when a PPTX must be built from content instead of typed slide by slide — read a
  template, write the deck as markdown, render. Triggers: PPT 만들어줘, 템플릿에 내용
  채워줘, 발표자료 생성, md로 PPT 만들기, deck from markdown,
  PPT 키컬러 변경, 브랜드 컬러로 교체, recolor pptx.
effort: medium
scenarios:
  - "이 템플릿 읽고 우리 분기 리뷰 내용으로 PPT 만들어줘"
  - "발표자료 초안을 md로 쓰고 템플릿에 렌더해줘"
  - "슬라이드 내용만 고쳐서 다시 뽑아줘"
  - "Read this template and build a 12-slide deck from my notes"
  - "Turn deck.mdx into a pptx using the brand template"
  - "Regenerate the deck — I changed three bullets"
  - "이 PPT 오렌지 계열을 전부 우리 브랜드 파란색으로 바꿔줘"
compatibility:
  required:
    - python 3.9+ (stdlib only — zipfile, xml.etree, re; no python-pptx, no PyYAML)
  recommended:
    - LibreOffice (soffice on PATH) — `render` and SVG picture slots need it; catalog, check and build do not
  remote_mcp_note: >-
    LibreOffice가 없으면 `build`까지는 그대로 동작하고 `render`만 멈춥니다. 덱은 사람이 보는
    물건이므로 가능하면 설치해서 마지막에 페이지를 확인하세요 — macOS는
    `brew install --cask libreoffice`. 템플릿이 쓰는 폰트는 렌더하는 컴퓨터에 깔려 있어야
    합니다. 없으면 LibreOffice가 조용히 대체 폰트를 써서 줄바꿈이 전부 달라지고, `render`가
    그 사실을 먼저 알려줍니다.
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

Recolor (any pptx; for a built deck, recolor `template.pptx` and rebuild): `scripts/ppt_keycolor_changer.py`,
procedure and presets in `references/recolor.md` — discover, map by lightness, confirm, replace, verify.

## Standing Mandates

- **Never build without a reference template.** There is no built-in deck design and no fallback. If the user has not given you a `.pptx`, stop and ask for one — do not assemble slides some other way, do not offer a generic deck, do not fabricate a template. The engine refuses too, but the ask belongs to you, before any work.
- **The source file is `deck.mdx`, never `deck.md`.** It is compiled, not read. The engine rejects any other extension.
- **Catalog before writing.** Never author `deck.mdx` from a guess about the template. Run `catalog` and write against the slot ids it prints.
- **Write in the voice `catalog` measured.** Its `## Voice` section is the reference's own sentence endings, length, English-term and digit share, footnote mark. Match them; do not default to your own register.
- **Never hand-edit the output pptx.** It is regenerated on the next build. Corrections go into `deck.mdx`.
- **Run `check` before `build`, and show the user the warnings.** Overflow warnings are what stands between crowded text and a slide nobody can read.
- **Visibility decides, not tidiness.** `| transparent` is right when the image's content stays legible against the slide; `check` says when it would not, and a panel behind the image is the better answer there. Don't reach for transparency because it sounds cleaner.
- **Never crop away content without saying so.** `check` reports the percentage; repeat it to the user and offer `| fit`. A picture losing half of itself is the same defect as a table row falling off the slide.
- **Never hand-author a picture slot's art as a binary.** Write the SVG so the deck stays reproducible from text. A PNG someone pasted in cannot be regenerated, re-colored, or reviewed in a diff.
- **A deck is read by people, so look at it.** When a renderer is available and the caller has no render rule of its own, finish with `render`, not `build` — the layout audit and the page previews are the only place text collisions show up. A caller that renders only when told (`manage`, a workspace README) decides; then say the layout was not checked this time. If no renderer is available, say so plainly in the report instead of implying the layout was checked.
- **Never invent an archetype.** If no template slide fits the content, say so and ask whether to reshape the content or extend the template — do not approximate.
- **Report the warnings you chose to ignore.** An overflow warning you decided was fine still belongs in the final report — the user is the one who will see the slide.
- **Keep the template's gaps.** Each shape's critical zone comes from the gaps the template repeats. `render` measures text crossing one and keeps it (user, 2026-11-18: "글 넘침 조정해야지"): the shapes below move down, or a panel row gives back room to text growing up into it; a crossing the template's own page shows is its design and stays. A drift from a centre-anchored text sitting lower in its frame is evened by lifting that frame. What it could not keep (no room above the safe area, a `place:`d shape in the way) and any other `drift` goes in the report; fix those by shortening, never by shrinking type. `place:` moves a frame only when the user asks, or to close the gap a `!drop` left. All of a deck's layout lives in `deck.mdx` (`place:`, `[text]{#hex|sup}`, `captions:`, `panel_margin:` — `references/mdx-syntax.md`), never in a script run after the build.
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

What the catalog prints (slots, per-slot budget, critical zones) and how font widths are found: `references/render-and-check.md` — read before writing any slot; write to the budget.

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

A whole `deck.mdx` as a worked example, paragraph formats (`[text]{n}`, `<br>`), `extract`, picture `fit` and `| transparent`, and `textN_plusK` cloning: `references/mdx-syntax.md` — read when writing a slide for the first time or when a slot needs more than plain text.

Full syntax — slot forms, `!drop`, `notes:`, inline emphasis, outline levels, and what
`template_hash` protects against — is in `references/mdx-syntax.md`. Read it before
writing the first slide.

A results page (성과, 결과, 배운 점) is never words alone: its headline result goes in the frame the
template gives it as a figure or stat card — the number, its unit, and what it was before or what it
is out of (`491 / 19,500건`, `p95 21.5초 → 1.7초`). A `check` hole warning on such a page is filled
this way, not left. Blind judges marked every text-only results page down against the user's own
deck with KPI cards (2026-11-22).

### Step 3b · Generate the art the deck needs

Write a picture slot's art as an `.svg`, in the template's colors and at the frame's exact
pt size — both printed by `catalog`. It becomes source like the rest of the deck and is
rasterized to PNG at build time.

Pick each figure's form from what it has to show, not from habit: a before/after → paired bars or a
two-column contrast; a sequence over time → a timeline or sequence diagram; a distribution or a
count → a chart; a choice among options → a comparison table with the chosen row marked; a
structure → boxes and arrows. List every figure's form before drawing; when more than half of a
deck's figures are box-and-arrow, redraw the ones another form says better (user, 2026-11-22:
"도식화가 천편일률적이다 (다른 방향으로 표현할 수 있었을텐데)").

A tech-stack table names technologies, not settings or features (`AWS ALB`, never `ALB 헬스체크`).

Then run `check` and read every `figure text ~Npt` warning: generated art is this skill's own
output, so that warning is not a judgment call. Redraw the figure until `check` shows it no more
— fewer words per label, wider boxes, or the figure split in two (user, 2026-11-19:
"스킬을 갈고 닦는 건데"). Shorten words, never facts: before redrawing, list what the figure says —
each step, number, name, lane, column, warning and its marks (①②③) — and after, tick each one off
in the new figure; a fact with no room moves into the slide's text or `notes:`, it is not dropped.
A new figure has no old copy to compare: in a `manage` workspace run `manage.mjs claims --file
portfolio-deck.mdx` after drawing — it reads each slide's .svg text with its cited items, and every
`not_in_material` figure is fixed to the material's number or taken out (a sandbox build drew Jira 14
for 15 and 3 tables for 11, 2026-11-22).
Keep a copy of each figure before redrawing it, and after, run `deck.py facts --deck deck.mdx
--before <copy> --after <assets/x.svg>`: it lists every word of the old figure found nowhere in the
new one or its slide's text and notes. Put each back, or move it to text or `notes:`, until it
prints none, or report why a listed word was no fact (blind bench 2026-11-20: a merged bullet lost
"콜백·재시도" though the redraw's own list called it kept).
`notes:` never reach the page. A fact a reader of the PDF needs — a step's sub-line, a metric to
watch, a state the figure shows ("송신·수신 모두 운영 중") — stays on the slide: in the figure at a
smaller weight, a caption line, or the panel's text. `notes:` take only what a presenter would say
aloud on top (blind bench 2026-11-20: page 7's step sub-lines and metric line moved to notes read
as dropped to both judges).
Then look at the rendered page: no label may touch or cross its box's edge (`check` warns on one
within 1pt of it) (blind bench 2026-11-19:
the first redraw read better on 32 of 36 judgments but every loss was a dropped step, lane or
warning, and one label clipped). `render` raising text in the raster copy only saves what was missed; its `!`
lines (`labels fit their boxes only up to`) send the figure back here.

Rules, rationale and a worked example: `references/generated-art.md`.

### Step 4 · Check

```bash
python3 /abs/path/scripts/deck.py check --deck deck.mdx
```

Errors must be fixed. Warnings are judgment calls — surface every one, including the ones
you decide to ignore. Two point at the author's own wording and are never rewritten here: a bullet
joining several clauses, and one sentence repeated on three or more pages (passive ones named). List
them for the author with a suggested split or a single placement, change them only on their word,
and carry the rest into `manage`'s next feedback round.

What it measures (table, and how font widths are resolved): `references/render-and-check.md`.

A picture drawn *after* the words it covers is an error — they end up behind the image.

How much slack `check` allows, and when to trust `추정`: `references/render-and-check.md` — read when a warning sits within a line of the limit.

### Step 5 · Build

```bash
python3 /abs/path/scripts/deck.py build --deck deck.mdx [--output out.pptx] [--strict]
```

The same `deck.mdx` always produces a byte-identical pptx. The build ends with the shared final check
(`office_render.py`): every AI trace is taken out — an alt-text disclaimer, an AI tool or library in the
properties, each slide or notes sentence saying AI wrote it — and printed (`ai trace removed`): fix those words
in `deck.mdx` too. A `TODO` / `[확인 필요` stays, as a warning. Before calling a deck submittable run `python3 ${CLAUDE_PLUGIN_ROOT}/scripts/office_render.py
final-check [--dir build] [--allow "Claude Code,Codex"] [--author NAME]`: a verdict per file, non-zero on a finding.

### Step 6 · Render and look

```bash
python3 /abs/path/scripts/deck.py render --deck deck.mdx
```

What `render` does: `references/render-and-check.md` — read before running it. `--deck` may be
relative. Its layout list is measured on the render, not estimated: `long` is a bullet the PDF
sets on 3+ lines (the author's wording — list it, change it only on their word), `edge` a picture or
shape the preview draws past the safe area where the template's own page leaves it empty (move it
in or narrow its `place:`). An `overlap`, `edge` or `clip` line the render lists as this deck's (not
under 템플릿 자체) means the deck is not done: fix it and render again until none is left — a blind
bench lost on one overlapped profile page that render had listed and the build passed by (2026-11-22). After every render, not only on a warning, run `render-review` on the PDF and previews. With no renderer, ask the person once, then run `python3 ${CLAUDE_PLUGIN_ROOT}/scripts/office_render.py install-renderer --yes` (a pinned LibreOffice into `~/.cache`, no root).

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

Six limits change what you can promise: no new layouts, a mandatory template, charts that are
not writable, frames that never move, layout truth that needs a renderer, and legibility
scored on PNG only. Read the wording and consequence of each before promising any of them.

Full table, and which step catches each one: `references/limits.md`.

## Related Skills

- `write:prd` (document purpose) — develop the content before mapping it onto slides
- `think:untangle-thoughts` — turn scattered notes into the slide-by-slide structure Step 2 needs
