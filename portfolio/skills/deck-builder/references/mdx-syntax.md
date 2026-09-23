# `deck.mdx` syntax

The deck source. Compiled, not read — the extension is enforced.

## Front matter

```markdown
---
template: template.pptx        # required; no built-in template exists
template_hash: 5f84440a3521    # from `catalog`; pins the deck to the template's structure
output: deck.pptx
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
| `key: path/to.svg` | same, rasterized at build time and cached in `.deckcache/` |
| `key: !drop` | delete that shape from the slide |
| `notes:` | speaker notes; reserved, works on any archetype |
| slot omitted | keeps the template's own content |

## Inline emphasis

`**bold**`, `*italic*` and `` `code` `` work inside any text or list value. Each becomes a
separate run cloned from the template's own, so an emphasised phrase keeps the font, size
and color it was going to have — emphasis flips attributes, it does not replace type. An
unmatched marker stays literal text.

## Outline levels

Indenting a list item two extra spaces writes it at outline level 1. It only *looks*
nested if the template defines an indent for that level; the level is set correctly
either way.
