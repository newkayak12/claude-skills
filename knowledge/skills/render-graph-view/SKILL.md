---
name: render-graph-view
description: >-
  Use when rendering a knowledge graph or Graph View dataset as an interactive,
  Obsidian-inspired standalone HTML visualization. Reads the knowledge plugin's
  nodes.jsonl and edges.jsonl artifacts; does not extract or invent graph
  relationships.
scenarios:
  - "현재 graph view를 Obsidian 그래프처럼 HTML로 보여줘"
  - "_graph 데이터를 클릭 가능한 시각화로 렌더링해줘"
  - "Render these nodes and edges as a standalone graph-view HTML"
compatibility:
  required: []
  remote_mcp_note: >-
    No MCP server is required; rendering uses the bundled local Node.js script.
---

# Render Graph View

Turn an existing graph dataset into one self-contained HTML file for visual exploration. The view is Obsidian-inspired: a dark infinite canvas, force-directed nodes, muted edges, type colors, search, filters, zoom/pan, and a node detail panel.

This skill is a renderer, not a graph builder. Never infer, merge, rename, or create nodes and edges to improve the picture. If graph artifacts do not exist, route graph extraction to `knowledge:knowledge-graph-builder` first.

## Input Discovery

When the user does not provide paths, search in this order:

1. `<vault>/_graph/nodes.jsonl` and `<vault>/_graph/edges.jsonl`
2. `<vault>/knowledge-artifacts/graph/nodes.jsonl` and `edges.jsonl`
3. `<vault>/graph/nodes.jsonl` and `edges.jsonl`

Treat the directory containing `_knowledge/`, `_graph/`, or `index.md` as the likely vault root. Ask for a location only after these conventions and obvious user-provided paths are absent.

The bundled renderer accepts the graph fields already supported by the knowledge plugin:

- Node ID: `id`, `node_id`, or the canonical name
- Node title: `canonical_name`, `name`, or `title`
- Node type: `label`, `type`, or `class`
- Edge endpoints: `source_node_id` / `target_node_id`, `source_id` / `target_id`, `from` / `to`, or `source` / `target`
- Relationship: `relationship_type`, `type`, `relation`, or `label`

## Render

Run the bundled renderer from the vault root:

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/render-graph-view/scripts/render-graph-view.mjs" \
  --root "<vault-root>"
```

If `CLAUDE_PLUGIN_ROOT` is unavailable, resolve `scripts/render-graph-view.mjs` relative to this `SKILL.md`. Useful options:

```text
--nodes <path>    Explicit nodes JSONL
--edges <path>    Explicit edges JSONL
--output <path>   Output path; defaults to <graph-dir>/graph-view.html
--title <text>    Title shown in the viewer
```

The generated HTML embeds normalized graph data and all CSS/JavaScript. It must remain usable offline and must not depend on a CDN, package install, server, or local-file fetch.

## Verification

After rendering:

1. Confirm the command reports the expected node and edge counts. Any edge whose endpoint is absent is omitted and reported; do not hide that discrepancy.
2. Confirm the output exists and contains the embedded graph payload, canvas, search control, filters, and detail panel.
3. When browser access is available, open the file and check that nodes draw, zoom/pan works, search dims non-matches, filters change the visible subgraph, and clicking a node opens its source-grounded details.

Report the absolute output path, rendered counts, and any omitted invalid edges. Do not claim visual browser verification when only file-level checks were performed.

## Visual Contract

- Preserve a calm Obsidian-like feel without copying product assets or requiring Obsidian itself.
- Color nodes by their declared type and keep the same type-to-color mapping within one view.
- Scale node size by degree with a restrained range so hubs remain visible without swallowing neighbors.
- Emphasize the selected node and its direct relationships while fading unrelated graph elements.
- Show titles only at useful zoom levels or for hover, selection, and search matches to avoid label noise.
- On zoom-out, spread node positions faster than node size shrinks so the graph opens up instead of collapsing into one blob; fade edges and keep labels for hubs only.
- Put raw metadata, aliases, evidence, and source references in the detail panel rather than on the canvas.
- Respect reduced-motion preferences by starting with the layout paused.
- Escape graph content through DOM text APIs; never interpolate record content as executable HTML.

## Related Skills

- `knowledge:knowledge-graph-builder` - create or repair source-grounded node and edge artifacts before rendering.
- `knowledge:knowledge-query` - answer relationship questions from the graph rather than visually browsing it.
