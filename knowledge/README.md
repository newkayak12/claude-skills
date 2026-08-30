# knowledge

Knowledge skills for building, transforming, and querying source-grounded, answerability-gated knowledge assets.
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
| `render-graph-view` | Render existing nodes and edges as an offline, interactive Obsidian-inspired HTML graph view |
| `rag-corpus-builder` | Prepare retrieval-ready chunks, metadata, citations, and eval queries for RAG |
| `sqlite-index-builder` | Rebuild a local SQLite index from catalog-backed Markdown, RAG chunks, and graph JSONL, and score it against the vault's competency questions |
| `knowledge-query` | Answer questions over a linked vault, graph data, RAG corpus, or mixed knowledge assets |

## Answerability Gate

Since 1.3.0 the plugin treats clean structure and useful answers as separate quality dimensions.
Non-trivial builds preserve competency questions and their evaluated results under `_knowledge/`,
model contrasts/equivalences/sequences as first-class relation notes with evidence for every
participant, and keep operator language separate from code and database symbols.

Before declaring a build complete, run:

```bash
node knowledge/scripts/validate-knowledge.mjs --root /path/to/vault --require-answerability
```

The gate fails when a competency question is partial or unanswerable, a relation note lacks
evidence for one side, a declared UI/code vocabulary bridge is incomplete, human confirmation
lacks review provenance, or graph question reachability uses missing or unsupported edges.
It is deliberately read-only and does not mistake artifact conformance for proof that cited
source claims are true.

Canonical answerability artifacts:

| Artifact | Purpose |
|---|---|
| `_knowledge/questions.jsonl` | Stable competency questions derived from lookup jobs |
| `_knowledge/question-results.jsonl` | Complete/partial/unanswerable results with evidence and missing knowledge |
| `_knowledge/coverage.md` | Human-readable source and numeric answerability coverage |
| `_knowledge/needs-human-review.md` | Intended-behavior claims awaiting a reviewer |
| `_graph/question-reachability.jsonl` | Bounded, typed, evidence-backed paths for graph questions |

## Local SQLite + MCP

Installing the plugin registers the `knowledge-local` stdio MCP server. It exposes:

- `knowledge_index` — rebuild `.knowledge/knowledge.sqlite` from Markdown and JSONL
- `knowledge_search` — hybrid FTS5 and vector retrieval
- `knowledge_get` — fetch a complete indexed record by stable ID
- `knowledge_neighbors` — query direct graph relationships
- `knowledge_status` — inspect index freshness and configuration

The default `hash` embedding is dependency-free and local, but it is a lexical feature hash rather
than a trained model, so search ranks full-text matches ahead of its vector similarity and reports
`embedding_quality: lexical-baseline`. Ranking fuses the lexical and semantic candidate lists over
their union, backs exact-token matching with a trigram substring index so inflected Korean forms
still match, and excludes bodyless graph-node records from semantic candidates. Search results
carry `lexical_candidates`, `lexical_word_matches`, `lexical_trigram_matches`, and
`lexical_matches_returned` so a ranking miss is visible instead of looking like an empty vault.
Each FTS table is ranked per column (`title`, `terms`, `body`) and fused by rank, so a title or
curated-alias match outranks a passing body mention no matter how long the note is. A relation
note is promoted when the query matches two or more of its declared `participants`; declared
participants only, never co-occurrence or shared anchors.
For semantic embeddings, run a local Ollama instance and index with `provider: ollama`.

The indexer needs Node 24+, or Node 22.5-23 with `--experimental-sqlite` and an FTS5-enabled
SQLite build; the bundled Docker image provides a known-good runtime. See
[`knowledge-query/references/local-sqlite.md`](./skills/knowledge-query/references/local-sqlite.md)
for CLI, Docker, and data-ownership details.

Keep Markdown and JSONL in Git. The SQLite file and Ollama model volume are rebuildable local state.
Catalog `user_terms` and `source_symbols` are included in local hybrid retrieval so operator
phrasing and implementation identifiers can converge on the same candidate notes without being
misrepresented as aliases.

## Hook

Installing the plugin makes the hook available through `knowledge/hooks/hooks.json`.
It activates only when a changed Markdown file belongs to an existing knowledge workspace,
then writes reports under `_knowledge/`.

Catalog refresh queuing is beta and incremental: each observed Markdown edit emits a
single-note upsert job. It does not request a full vault reindex, and deletions or moves made
outside the observed edit tools still need explicit catalog reconciliation.

When competency results exist, the same edit also queues an answerability recheck for affected
questions. The completion validator independently rejects stale answer-note hashes even if that
queue has not yet been consumed.
