# knowledge

Knowledge skills for building, transforming, and querying source-grounded knowledge assets.
The plugin also includes a lightweight post-edit hook that detects changed Markdown inside
knowledge workspaces and queues RAG, graph, or ontology follow-up work without blocking edits.

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
| `knowledge-base-builder` | Build an Obsidian-style linked Markdown knowledge base from code, docs, or notes |
| `ontology-builder` | Design classes, relationship semantics, constraints, controlled vocabularies, and mappings |
| `knowledge-graph-builder` | Extract source-grounded entities, relationships, schema, and graph-ready data |
| `rag-corpus-builder` | Prepare retrieval-ready chunks, metadata, citations, and eval queries for RAG |
| `knowledge-query` | Answer questions over a linked vault, graph data, RAG corpus, or mixed knowledge assets |

## Hook

Installing the plugin makes the hook available through `knowledge/hooks/hooks.json`.
It activates only when a changed Markdown file belongs to an existing knowledge workspace,
then writes reports under `_knowledge/`.
