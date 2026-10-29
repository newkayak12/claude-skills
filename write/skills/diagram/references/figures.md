# Book figures

Five types for figures that explain how something works: `layout`, `tree`, `timeline`, `er`,
`chart`. They exist only on the static path - `figure` writes `<base>.svg` (NanumGothic subset
embedded, no script, no external reference) and `<base>.png` (2x, rasterized through an `<img>`,
the way a book page loads it); `render` wraps the same SVG in an HTML page.

```bash
node scripts/diagram.mjs check  fig-9-2.json            # "ok", or one repair per line (exit 1)
node scripts/diagram.mjs figure fig-9-2.json fig-9-2    # fig-9-2.svg + fig-9-2.png; exit 3 = no browser (set CHROME=)
```

## The claim - what the figure is about

Every book figure names the elements its caption's point rests on in a top-level `claim` array.
They are drawn in one accent (the darkest fill, the heavy stroke, light text); everything else is
muted context. `check` refuses an IR with no `claim`, an empty one, or an id that names no element,
with one repair line. The ids: `layout` a strip or cell id (a strip accents all its cells), `tree`
a node id, `timeline` a step as `<lane>@t<t>` (`"A@t4"`), `er` an entity id, `chart` a series id.

## What every figure is checked for

The check lays the figure out, measures every text with the font's real advance widths, and
refuses (one repair line each, nothing written):

- a label wider than its box or its room (it would otherwise be cut with `…`)
- two texts overlapping; a text over a shape it does not belong to
- a line or arrowhead through a box that is not its end, or over any text - its own label too
  (a diagonal edge's label sits beside the line, at the nearest spot clear of it and of the nodes)
- anything outside the figure
- text that would print below 7.5 pt at the 146 mm book width (552 px): the figure is too wide -
  fewer columns, lanes or cells, or split it
- a character NanumGothic does not have (it would print as a box)

Fills that appear together differ by >= 15 L* and every line style has its own dash pattern, so
a grayscale print keeps them apart. Labels may be Korean. Put the source of a fact (a size, an
offset, a default) or `[확인 필요]` in the IR's `note`.

## layout - where bytes sit, what points where

Page layouts (InnoDB 16 KB page, PostgreSQL 8 KB page), a row next to its undo record, a
version chain. Strips stack top to bottom; each is a row of cells.

```json
{
  "type": "layout",
  "title": "PostgreSQL 힙 페이지",
  "scale": "schematic",
  "claim": ["lp1", "tup1"],
  "strips": [
    { "id": "page", "label": "8KB 페이지", "cells": [
      { "id": "hdr", "label": "PageHeader", "sublabel": "24 B", "kind": "meta" },
      { "id": "lp1", "label": "lp 1", "kind": "meta" },
      { "id": "lp2", "label": "lp 2", "kind": "meta" },
      { "id": "free", "label": "빈 공간", "kind": "free" },
      { "id": "tup2", "label": "튜플 2" },
      { "id": "tup1", "label": "튜플 1" },
      { "id": "spc", "label": "special", "kind": "meta" }
    ] }
  ],
  "pointers": [
    { "from": "lp1", "to": "tup1", "label": "오프셋·길이" },
    { "from": "lp2", "to": "tup2", "label": "오프셋·길이" }
  ],
  "marks": [
    { "strip": "page", "at": "free", "label": "pd_lower" },
    { "strip": "page", "at": "tup2", "label": "pd_upper" }
  ],
  "note": "https://www.postgresql.org/docs/current/storage-page-layout.html"
}
```

- `scale`: `bytes` draws every cell to `size` (needs `total` per strip, `unit` optional, default B);
  `schematic` sizes cells to their labels and stamps `축척 아님 (not to scale)`.
- `kind`: `data` (white) · `meta` (light) · `free` (dashed) · `focus` (mid grey).
- `marks[].at`: a byte offset (bytes scale) or the cell the mark starts.
- Refused: a `bytes` cell without `size`; sizes not summing to `total` (names the gap); a `bytes`
  cell narrower than its label (use `schematic`); marks out of offset order; a pointer to an unknown
  cell or without a label; more than 4 strips or 24 cells.

## tree - B-tree pages or a plan tree

`ordered: true` shows keys (B-tree / B+tree pages); `ordered: false` shows labels (an execution
plan). Up to two trees, stacked in `roots` order - e.g. a secondary index above the clustered
index, joined by a labelled link.

```json
{
  "type": "tree",
  "title": "B+tree 리프 탐색",
  "ordered": true,
  "roots": ["root"],
  "claim": ["m"],
  "nodes": [
    { "id": "root", "keys": [30, 60], "kind": "internal" },
    { "id": "a", "parent": "root", "keys": [10, 20], "kind": "leaf" },
    { "id": "m", "parent": "root", "ellipsis": true },
    { "id": "c", "parent": "root", "keys": [60, 70, 80], "kind": "leaf" }
  ],
  "links": [{ "from": "a", "to": "m", "both": true }, { "from": "m", "to": "c", "both": true }]
}
```

- Keys: numbers, strings or arrays (composite keys, compared element by element); one kind per
  tree. A node with n children holds n-1 separators (child i in [k(i-1), k(i))) or n minimum keys
  as InnoDB node pointers do (child i in [k(i), k(i+1))) - the count tells which.
- `links`: leaf siblings on one level, left to right (`both: true` for a doubly linked list), or a
  labelled jump between the two trees. Parent lines come from `parent`.
- `label` on an ordered node prints a header row above its keys - the way to name the two trees
  (`"label": "보조 인덱스 (status, ordered_at)"` on one root, `"군집 인덱스 (PK)"` on the other) or
  say what a leaf holds (`"보조 키 + PK"`, `"행 전체"`).
- Refused: a parentless node not in `roots`; no root or more than 2 trees; an unlabelled link
  between trees; an unknown parent; a cycle; deeper than 6 levels; more than 7 nodes on a level
  (use one `{"ellipsis": true}` node); keys not ascending, a key count that fits neither convention,
  a child key outside its range (names child, key, bound), mixed key kinds; a right-to-left leaf link.

## timeline - sessions over time, locks and waits

One lane per session (1-4), one row per step `t` (whole numbers; leave gaps where a wait shows).

```json
{
  "type": "timeline",
  "title": "교착 상태와 희생 트랜잭션",
  "claim": ["B@t6"],
  "lanes": [{ "id": "A", "label": "세션 A" }, { "id": "B", "label": "세션 B" }],
  "steps": [
    { "t": 1, "lane": "A", "label": "UPDATE … id=1", "kind": "stmt" },
    { "t": 2, "lane": "B", "label": "UPDATE … id=2", "kind": "stmt" },
    { "t": 3, "lane": "A", "label": "UPDATE … id=2", "kind": "stmt" },
    { "t": 4, "lane": "B", "label": "UPDATE … id=1", "kind": "stmt" },
    { "t": 6, "lane": "B", "label": "ERROR 1213 Deadlock", "kind": "error" },
    { "t": 7, "lane": "A", "label": "id=2 갱신 완료", "kind": "note" }
  ],
  "waits": [
    { "lane": "A", "from": 3, "until": 6, "on": "B", "holder": 2, "label": "id=2 X 잠금 대기", "resume": "UPDATE 재개" },
    { "lane": "B", "from": 4, "until": 6, "on": "A", "holder": 1, "label": "id=1 X 잠금 대기" }
  ]
}
```

- `kind`: `stmt` · `commit` · `rollback` · `error` · `wait` · `note`. A `note` has no box; the
  lane's dotted lifeline breaks around it (and around any other text on it) and is checked as a line.
- A wait starts at a `stmt` the waiting lane issued and ends where the holder (`on`) commits,
  rolls back or errors - or where the waiter errors (timeout, deadlock victim). It is drawn as a
  filled span from the `from` step down to the `until` step.
- `holder` (optional): the `t` of the `stmt` on lane `on` that took the lock. An accent line runs from
  that step to the waiter's `from` step - the cause of the wait.
- `resume` (optional): short text drawn beside the waiter's next step after `until`, as written -
  the outcome the caption claims (`"UPDATE 재개 · 0행"`). The renderer adds no wording.
- A step is addressed in `claim` as `<lane>@t<t>` (`"B@t6"`).
- Refused: two steps at one (lane, t); a step of the waiting lane inside its wait; a wait that
  ends where no lock is released; a cycle of waits with no error step naming the deadlock; a wait
  without a label (which lock, which row); a wait not starting at a `stmt`; a wait with no empty
  step between `from` and `until` to draw it in; a `holder` that is not a `stmt` of lane `on`; a
  `resume` on a wait whose lane has no step after `until`.

## er - entities and relations

```json
{
  "type": "er",
  "title": "저자와 도서",
  "level": "logical",
  "claim": ["book"],
  "entities": [
    { "id": "author", "label": "저자", "row": 0, "col": 0, "attrs": [{ "name": "저자 번호", "pk": true }, { "name": "이름" }] },
    { "id": "book", "label": "도서", "row": 0, "col": 1, "attrs": [{ "name": "ISBN", "pk": true }, { "name": "제목" }, { "name": "출판사 번호", "fk": "publisher.id" }] },
    { "id": "publisher", "label": "출판사", "row": 1, "col": 1, "attrs": [{ "name": "id", "pk": true }, { "name": "상호" }] }
  ],
  "rels": [
    { "from": "author", "to": "book", "card": "N:M", "label": "쓴다" },
    { "from": "publisher", "to": "book", "card": "1:N" }
  ]
}
```

- `level`: `logical` or `physical` (types shown when given; `nullable: true` adds NULL).
- `card`: `1:1` · `1:N` · `N:1` · `N:M` (a bare crow's foot for N/M), or `"<from end>:<to end>"` with
  each end one of `1` · `0..1` · `0..*` · `1..*`, drawn in crow's-foot notation at that end's entity:
  `1` = `||`, `0..1` = `o|`, `1..*` = `|<`, `0..*` = `o<` (e.g. `"card": "1:0..*"` = one customer,
  zero or more orders). Use these ends whenever the text states optionality; when an end is an open
  question, draw the end the text gives and flag it in `note` as `[확인 필요]`.
- `fk`: `"entity.attr"`. `unique: true` prints `UK` beside the attribute (a candidate key).
- Refused: an entity without a `pk`; an `fk` to a missing attr or to one that is neither `pk` nor
  `unique`; `N:M` (or `*` at both ends) in a `physical` model (add the junction entity); an `fk` on
  the 1 side; more than 12 attributes; two entities in one cell; an entity with no relation.

## chart - measured numbers

`mark`: `bar` (y from 0) · `line` · `dot` (every repeated run as a point; the renderer draws and
labels the median - the IR cannot supply one).

```json
{
  "type": "chart",
  "title": "동시 세션 수와 처리량",
  "mark": "line",
  "illustrative": true,
  "claim": ["ssd"],
  "x": { "label": "동시 세션", "unit": "개" },
  "y": { "label": "처리량", "unit": "TPS" },
  "series": [
    { "id": "ssd", "label": "SSD", "points": [{ "x": 1, "y": 900 }, { "x": 8, "y": 5200 }, { "x": 32, "y": 9100 }, { "x": 64, "y": 9300 }] },
    { "id": "hdd", "label": "HDD", "points": [{ "x": 1, "y": 300 }, { "x": 8, "y": 1100 }, { "x": 32, "y": 1500 }, { "x": 64, "y": 1450 }] }
  ]
}
```

- `x.categories` is required for `bar` and `dot` (every point's `x` is one of them); `line` takes
  categories or a numeric x with a `unit`.
- `source`: the raw data file (path relative to the IR); every plotted `y` must appear in it as a
  number (12.3 matches 12.30). Without one, `illustrative: true` stamps `예시 값 (illustrative)`.
- `lo`/`hi` on a point draw its range.
- Only a summary exists (median, p25, p75 - no raw runs): plot one point per category at the real
  median with `lo`/`hi` = p25/p75, say so in the series label (`점 = 중앙값, 막대 = p25~p75`), and
  point `source` at the summary table. Never plot the quantiles as separate points - the renderer
  would print their median as if it were the runs'.
- A median label goes right of its line, or left when the right side would run past the plot.

```json
{
  "type": "chart",
  "title": "인덱스 전후 응답 시간",
  "mark": "dot",
  "illustrative": true,
  "claim": ["runs"],
  "x": { "label": "조건", "categories": ["인덱스 전", "인덱스 후"] },
  "y": { "label": "응답 시간", "unit": "ms", "min": 0 },
  "series": [
    { "id": "runs", "label": "5회 반복", "points": [
      { "x": "인덱스 전", "y": 120 }, { "x": "인덱스 전", "y": 131 }, { "x": "인덱스 전", "y": 125 },
      { "x": "인덱스 후", "y": 12.3 }, { "x": "인덱스 후", "y": 11.8 }, { "x": "인덱스 후", "y": 13.1 }
    ] }
  ]
}
```

- Refused: no y `unit`; a `bar` axis not starting at 0; `lo`/`hi` not bracketing `y`; more than 6
  series; neither `source` nor `illustrative`; a `y` missing from the source; a supplied `median`.
