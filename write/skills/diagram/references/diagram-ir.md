# Diagram IR

One JSON file per picture. `scripts/diagram.mjs` validates it and renders one self-contained
HTML file (inline SVG, hover a node to light its edges, light/dark). Nothing is drawn from an IR
that fails the check, and a failed revision never overwrites the last good HTML.

```bash
node scripts/diagram.mjs check  arch.json             # "ok", or one repair per line (exit 1)
node scripts/diagram.mjs render arch.json arch.html   # checks first; writes only on pass
node scripts/diagram.mjs figure arch.json arch        # arch.svg (font embedded) + arch.png (2x) for a page
```

`check` measures the figure as `figure` will draw it (see `figures.md` for the geometry rules and
the five book types); `render` to HTML needs only the IR checks below.

The five book types (`layout`, `tree`, `timeline`, `er`, `chart`) also carry a top-level `claim`:
an array of the element ids the caption's point rests on (a timeline step is `<lane>@t<t>`, e.g.
`"A@t4"`). `figure` draws those in one accent and the rest muted; `check` refuses a missing, empty or
unknown `claim`. A timeline wait may add `holder` (the `t` of the `stmt` on lane `on` that took the
lock - an accent line runs from it to the waiter's first waiting step) and `resume` (the author's
text, drawn as written beside the waiter's next step after `until`; it needs such a step). `check`
refuses a `holder` that is not a `stmt` of the `on` lane, and a `resume` on a wait with no step after
`until`. The renderer adds no wording of its own: every word drawn is the author's. The grid types and
`sequence` take none of these. See `figures.md`.

## Pick the type

| type | Shows | Nodes are |
|------|-------|-----------|
| `architecture` | components, stores, boundaries | services, stores, queues, externals |
| `dataflow` | where data goes, what holds it (PII, lineage) | sources, transforms, sinks |
| `workflow` | steps, approvals, tool calls | steps and decisions |
| `lifecycle` | states, retries, terminal outcomes | states |
| `sequence` | one request over time | participants + ordered messages |

## Grid types (everything but `sequence`)

```json
{
  "type": "architecture",
  "title": "Checkout read path",
  "description": "Cache-aside in front of Postgres",
  "nodes": [
    { "id": "browser", "label": "Browser", "kind": "actor", "row": 0, "col": 0 },
    { "id": "api", "label": "Order API", "sublabel": "Node 22", "kind": "service", "row": 0, "col": 1 },
    { "id": "redis", "label": "Redis", "kind": "store", "row": 0, "col": 2, "note": "TTL 60s" },
    { "id": "pg", "label": "PostgreSQL", "kind": "store", "row": 1, "col": 2 }
  ],
  "edges": [
    { "from": "browser", "to": "api", "label": "GET /orders/:id" },
    { "from": "api", "to": "redis", "label": "lookup" },
    { "from": "api", "to": "pg", "label": "miss: SELECT", "style": "fail" },
    { "from": "pg", "to": "redis", "label": "fill", "style": "data" }
  ],
  "groups": [{ "id": "vpc", "label": "VPC", "nodes": ["api", "redis", "pg"] }]
}
```

- `kind`: `actor` `service` `store` `queue` `external` `step` `state` `decision` `package`.
- `style`: `sync` (default, solid) · `async` (dashed) · `data` (green) · `fail` (orange, dotted - the unhappy path).
- Legend: drawn only when the edges use two or more styles; one style, no legend. It prints the
  style keys unless `"legend": {"sync": "요청", "async": "붙음"}` renames them - name only styles
  the edges use, so a Korean figure never prints sync/async/data. Same for `sequence`.
- A `store` cylinder's text sits below its top arc; a two-line label plus a sublabel does not fit
  and is refused (shorten the label to one line or drop the sublabel).
- `row`/`col` are yours. **Layout is a judgement, not a solver's output**: put the entry point at
  the left or top, the thing the reader must notice where the eye lands, and keep one flow on one
  row. The checker only refuses what cannot be read: two nodes in one cell, a non-member inside a
  group's box, a node with no edge, a label over 48 characters (put the rest in `note`, shown on
  hover), more than 40 nodes (split it).
- `groups` draw a boundary around their members' cells, so members must be contiguous: a node
  that sits inside the box but is not listed is refused.

## Sequence

```json
{
  "type": "sequence",
  "title": "Login with refresh",
  "participants": [
    { "id": "app", "label": "App", "kind": "actor" },
    { "id": "auth", "label": "Auth API" },
    { "id": "db", "label": "Users DB", "kind": "store" }
  ],
  "messages": [
    { "from": "app", "to": "auth", "label": "POST /login" },
    { "from": "auth", "to": "db", "label": "find user" },
    { "from": "auth", "to": "app", "label": "401 bad password", "style": "fail" }
  ]
}
```

Message order is time order; the renderer numbers them.

## When to use which output

- A design doc, ADR or PR in markdown: Mermaid inline is fine, it renders where the text lives.
- Something a person will open, explore or share, or a system with enough parts that hover
  matters: this IR and its HTML. Keep the `.json` next to the `.html` - it is the source to edit.
- A book, a PDF or a printed page: `figure` - static SVG + PNG, sized for the 146 mm text width.
  At most 3 grid columns or 4 sequence participants print legibly; the check says when it is too wide.
