# Local SQLite Retrieval

Read this reference when a query should use the `knowledge-local` MCP server or when the user asks to build, refresh, inspect, or run the local SQLite index.

## Data Ownership

The linked Markdown vault and portable JSONL artifacts are canonical and suitable for Git:

```text
notes/**/*.md
_knowledge/catalog.jsonl
_rag/chunks.jsonl
_graph/nodes.jsonl
_graph/edges.jsonl
```

`.knowledge/knowledge.sqlite` is a derived local index. Do not treat it as the source of truth or commit it merely to synchronize knowledge. Rebuild it after pulling source changes. Ollama model volumes are also local runtime state, not repository data.

## MCP Query Path

Use the fully qualified tools from the `knowledge-local` MCP server when available:

1. Call `mcp__knowledge-local__knowledge_status`.
2. If the index is absent or `stale: true`, call `mcp__knowledge-local__knowledge_index`.
3. Call `mcp__knowledge-local__knowledge_search` for lookup and synthesis questions.
4. Call `mcp__knowledge-local__knowledge_get` when a top result needs its complete text or metadata.
5. Call `mcp__knowledge-local__knowledge_neighbors` for dependency, ownership, lineage, or impact questions.
6. Answer from returned `source_ref`, `path`, IDs, and evidence. Do not cite the SQLite file itself as the original source.

Some hosts add a plugin namespace to MCP tool names. If the exact prefix differs, select the connected `knowledge-local` tool whose final tool name is `knowledge_status`, `knowledge_index`, `knowledge_search`, `knowledge_get`, or `knowledge_neighbors`.

`knowledge_search` runs hybrid SQLite FTS5 and vector retrieval. Search results are evidence candidates, not automatically true claims. Fetch the underlying record when the snippet does not contain enough context.

## Embedding Modes

| Provider | Use when | Behavior |
|---|---|---|
| `hash` | No local model service is installed | Dependency-free lexical feature hashing; useful as a portable baseline, but not a semantic model |
| `ollama` | Local Ollama and an embedding model are available | Semantic embeddings from Ollama `/api/embed`; the same model is used for documents and queries |

Prefer `ollama` when semantic recall materially matters and the user has it available. Do not silently download a model. The default Ollama model is `embeddinggemma`; set `KNOWLEDGE_EMBED_MODEL` or pass `model` to `knowledge_index` to change it.

## CLI

The MCP server uses the same implementation as the CLI:

```bash
node --no-warnings knowledge/scripts/sqlite-knowledge.mjs index --root /path/to/vault
node --no-warnings knowledge/scripts/sqlite-knowledge.mjs search "결제 실패 재시도" --root /path/to/vault
node --no-warnings knowledge/scripts/sqlite-knowledge.mjs neighbors PaymentService --root /path/to/vault
node --no-warnings knowledge/scripts/sqlite-knowledge.mjs status --root /path/to/vault
```

For Ollama embeddings:

```bash
node --no-warnings knowledge/scripts/sqlite-knowledge.mjs index \
  --root /path/to/vault \
  --provider ollama \
  --model embeddinggemma
```

## Docker

From this repository, build or refresh the dependency-free index with:

```bash
docker compose -f knowledge/compose.yaml run --rm knowledge-index
```

For a vault elsewhere, pass its absolute path:

```bash
KNOWLEDGE_ROOT=/absolute/path/to/vault \
  docker compose -f knowledge/compose.yaml run --rm knowledge-index
```

For semantic embeddings, start Ollama, pull the configured model once, and run the semantic profile:

```bash
docker compose -f knowledge/compose.yaml --profile semantic up -d ollama
docker compose -f knowledge/compose.yaml exec ollama ollama pull embeddinggemma
docker compose -f knowledge/compose.yaml --profile semantic run --rm knowledge-index-ollama
```

The bind-mounted vault receives `.knowledge/knowledge.sqlite`. The named `ollama-models` volume keeps model data outside Git. Claude Code normally uses the plugin's host-side stdio MCP server; Docker is an optional reproducible indexing/runtime path.

## Failure Handling

- Missing index: build it once, then retry the query.
- Stale index: rebuild before making freshness-sensitive claims.
- Ollama unavailable or model missing: report the concrete error; use `hash` only if semantic quality is not a requirement.
- No useful hits: say the indexed corpus cannot support the answer and identify the missing source or term.
- Conflicting hits: preserve both citations and label the conflict.
