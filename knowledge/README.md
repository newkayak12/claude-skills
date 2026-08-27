# knowledge

Knowledge skills for building, transforming, and querying source-grounded knowledge assets.
The plugin also includes a lightweight post-edit hook that detects changed Markdown inside
knowledge workspaces and queues catalog, RAG, graph, or ontology follow-up work without blocking edits.
Its local MCP server builds a disposable SQLite index and exposes hybrid retrieval and graph queries
so Claude can answer from the indexed evidence.

## Install & Uninstall

```bash
# Install
/plugin install knowledge@newkayak12-claude-skills

# Uninstall
/plugin uninstall knowledge@newkayak12-claude-skills
```

## Skills

| Skill | Description |
|-------|-------------|
| `knowledge-workflow` | Build a queryable knowledge system through graph-like source exploration |
| `knowledge-base-builder` | Maintain a small-to-moderate Markdown knowledge base with predictable folders, AI lookup catalog, and a clean RAG handoff |
| `ontology-builder` | Design classes, relationship semantics, constraints, controlled vocabularies, and mappings |
| `knowledge-graph-builder` | Extract source-grounded entities, relationships, schema, and graph-ready data |
| `rag-corpus-builder` | Prepare retrieval-ready chunks, metadata, citations, and eval queries for RAG |
| `knowledge-query` | Answer questions over a linked vault, graph data, RAG corpus, or mixed knowledge assets |

## Local SQLite + MCP

Installing the plugin registers the `knowledge-local` stdio MCP server. It exposes:

- `knowledge_index` — rebuild `.knowledge/knowledge.sqlite` from Markdown and JSONL
- `knowledge_search` — hybrid FTS5 and vector retrieval
- `knowledge_get` — fetch a complete indexed record by stable ID
- `knowledge_neighbors` — query direct graph relationships
- `knowledge_status` — inspect index freshness and configuration

The default `hash` embedding is dependency-free and local. For semantic embeddings, run a local
Ollama instance and index with `provider: ollama`. See
[`knowledge-query/references/local-sqlite.md`](./skills/knowledge-query/references/local-sqlite.md)
for CLI, Docker, and data-ownership details.

Keep Markdown and JSONL in Git. The SQLite file and Ollama model volume are rebuildable local state.

## Hook

Installing the plugin makes the hook available through `knowledge/hooks/hooks.json`.
It activates only when a changed Markdown file belongs to an existing knowledge workspace,
then writes reports under `_knowledge/`.

Catalog refresh queuing is beta and incremental: each observed Markdown edit emits a
single-note upsert job. It does not request a full vault reindex, and deletions or moves made
outside the observed edit tools still need explicit catalog reconciliation.
