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
| `deck.pptx` | the build artifact — regenerated in full every time |

Each output slide is a **clone of a template slide** with its content swapped, so the
template's design survives byte for byte. Nothing is laid out from scratch.

Engine: `scripts/deck.py` (invoke with an absolute path).

---

## Standing Mandates

- **Never build without a reference template.** There is no built-in deck design and no fallback. If the user has not given you a `.pptx`, stop and ask for one — do not assemble slides some other way, do not offer a generic deck, do not fabricate a template. The engine refuses too, but the ask belongs to you, before any work.
- **The source file is `deck.mdx`, never `deck.md`.** It is compiled, not read. The engine rejects any other extension.
- **Catalog before writing.** Never author `deck.mdx` from a guess about the template. Run `catalog` and write against the slot ids it prints.
- **Never hand-edit the output pptx.** It is regenerated on the next build. Corrections go into `deck.mdx`.
- **Run `check` before `build`, and show the user the warnings.** Overflow warnings are the only signal that text will spill — there is no renderer to see it.
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
output: deck.pptx
---

## @s1
title: 신뢰성 플랫폼 2026 리뷰
subtitle: 배포 파이프라인을 다시 세우고 얻은 것

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
| `key: !drop` | delete that shape from the slide |
| slot omitted | keeps the template's own content |

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

---

## Output Template

Report after a build:

```
빌드 완료 — <출력 경로>
  슬라이드 <N>개 · 템플릿 <이름> · 이미지 <M>개 삽입

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
| Runs `build`, reports the result | Opens the pptx, edits charts if needed |

---

## Limitations

| Limitation | Detail |
|---|---|
| **A template is mandatory** | There is no built-in design. Without a reference `.pptx` the engine exits with an error and produces nothing. |
| **No new layouts** | Output slides are clones of template slides. Content with no matching archetype needs the template extended in PowerPoint first. |
| **Charts are not writable** | Series values live in an embedded xlsx plus cached XML. `catalog` lists chart slots; `build` leaves them at template values. |
| **Capacity is an estimate** | Overflow warnings come from frame width ÷ font size, not real text metrics. Treat them as a prompt to look, not a verdict. |
| **Nesting is only as visible as the template makes it** | A nested item is written at outline level 1. If the template's own body text defines no indent for level 1, it renders flush with the rest — the level is correct, the template just doesn't show it. |
| **Formatting follows the template** | A replaced run inherits the template run's font, size and color. Per-word bold or color inside a slot is not expressible in `deck.mdx`. |
| **Speaker notes are dropped** | Notes slides are not carried into the build. |
| **Autofit is not recalculated** | PowerPoint reflows shrink-to-fit text when the file is opened, so the on-screen result can differ slightly from the capacity estimate. |

---

## Related Skills

- `portfolio:ppt-keycolor-changer` — recolor the template (or the built deck) to a brand palette
- `write:doc-coauthoring` — develop the content before mapping it onto slides
- `think:thought-organizer` — turn scattered notes into the slide-by-slide structure Step 2 needs
