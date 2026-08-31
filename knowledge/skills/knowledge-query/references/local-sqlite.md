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

## Reading Retrieval Diagnostics

Every search result carries the fields needed to judge whether retrieval actually worked:

| Field | Meaning |
|---|---|
| `retrieval` | `fts`, `hybrid-fts-vector`, `vector`, or `empty` for the returned set |
| `lexical_candidates` | Documents the full-text query matched before fusion |
| `lexical_word_matches` / `lexical_trigram_matches` | Exact-token and substring match counts |
| `lexical_matches_returned` | How many returned results were lexical matches |
| `embedding_quality` | `lexical-baseline` for `hash`, `semantic` for `ollama` |
| `fusion_weights` | The semantic/lexical weighting applied for this provider |
| `group` / `distinct_notes` | `note` keeps one best result per note; `distinct_notes` counts notes in the returned set |
| `candidates_before_grouping` | Ranked candidates before per-note grouping and the limit |
| `embedding_prompt` | Prompt template the index was built with (`embeddinggemma-v1`, or `none`) |
| `reranked` / `rerank_model` / `rerank_depth` | Whether a cross-encoder reordered the shortlist, and with what |
| `rerank_error` | Set when an attached reranker failed; the returned order is the fused fallback |
| `relation_participant_evicted_ids` | Notes that left the window to make room for promoted participants |

## Grouping and Filters

Results are grouped **one per note** by default: a heavily chunked note would otherwise fill the
top slots with its own chunks and leave no room for the sibling notes a multi-note question needs.
Pass `--group none` (MCP: `group: "none"`) to see every chunk.

Scoped lookups use the metadata the indexer already stores, so no raw SQL is needed:

```bash
sqlite-knowledge search "상품" --domain goods --doc-type 정책 --section 주장 --path-prefix wms/goods
sqlite-knowledge list --domain goods --doc-type 정책          # no query, filters only
sqlite-knowledge status                                       # lists filterable metadata keys
```

`--doc-type` and `--section` match `doc_type` / `section` at the record's top level or under
`metadata`. `list` requires at least one filter and orders by path.

`lexical_candidates` far above `lexical_matches_returned`, or `retrieval: vector` on a query using
vault vocabulary, means the terms exist in the corpus but did not survive ranking. Re-query with the
exact note title, alias, or source symbol before concluding the vault cannot answer.

Ranking fuses two ordered lists over their union: a lexical list (exact tokens plus a trigram
substring index, so inflected Korean forms still match) and a semantic list. Documents with no
indexed body, such as bare graph-node records, are excluded from semantic candidates so they cannot
displace real notes; they remain reachable by title, `knowledge_get`, and `knowledge_neighbors`.
Each FTS table is ranked per column (`title`, `terms`, `body`) and those rank lists are fused too,
so a title or curated-alias match outranks a passing body mention regardless of note length.
Under `hash` the vector signal carries no weight at all: lexical evidence decides the order whenever
any term matches, and the vectors only order the fallback when nothing matches lexically (`retrieval:
vector`, every `score` zero, results sorted by `semantic_score`).

## Embedding Modes

| Provider | Use when | Behavior |
|---|---|---|
| `hash` | No local model service is installed | Dependency-free lexical feature hashing; useful as a portable baseline, but not a semantic model |
| `ollama` | Local Ollama and an embedding model are available | Semantic embeddings from Ollama `/api/embed`; the same model is used for documents and queries |

Prefer `ollama` when semantic recall materially matters and the user has it available. Do not silently download a model. The default Ollama model is `embeddinggemma`; set `KNOWLEDGE_EMBED_MODEL` or pass `model` to `knowledge_index` to change it.

Measured on a 94-question vault with the engine and corpus held fixed, the provider is the largest single retrieval lever: `hash` → `embeddinggemma` moved hits 43 → 62, recall@10 0.631 → 0.803, MRR 0.558 → 0.791. When a user reports that paraphrased or spoken-style questions miss, name the provider before proposing vocabulary work.

`embeddinggemma` is trained for asymmetric retrieval, so the indexer prefixes documents with `title: … | text: …` and queries with `task: search result | query: …`, and records the template id in the index. An index reporting `embedding_prompt: none` under that model predates the prompts; rebuild it. Documents longer than the model's context (1800 characters for `embeddinggemma`) are embedded in overlapping windows and mean-pooled rather than truncated — `documents_windowed` counts them at build time.

## Reranker (optional, user-attached)

A cross-encoder reads the query and one candidate together and can settle what bi-encoder similarity cannot. It is attached the same way Ollama is: **nothing is installed, nothing is required, and an absent endpoint is not an error.**

```bash
node --no-warnings knowledge/scripts/sqlite-knowledge.mjs search "출고 취소 처리" \
  --root /path/to/vault \
  --reranker-url http://127.0.0.1:8080 \
  --reranker-model bge-reranker-v2-m3
```

- The wire format is the Cohere/Jina `/v1/rerank` shape that llama.cpp's server and text-embeddings-inference both speak. A llama.cpp reranker needs `--embedding --pooling rank`.
- `--rerank-depth` (default 50) bounds the shortlist; the tail keeps its fused order.
- Reranking runs **before** the result window is built, so relation-participant promotion still decides retrievability on the order a reader sees.
- A failing endpoint falls back to fused order and sets `rerank_error`. Search keeps working, but a run scored with a reranker is not comparable to one without — `eval` records the reranker in its output for that reason.

**Before attaching one, measure its ceiling.** A reranker can only reorder what retrieval already returned, so its maximum possible gain is `recall@50 − recall@10`. Run `eval --k 10` and `eval --k 50` on the same index: if the required notes missing at k=10 are also missing at k=50, a reranker cannot recover them and the gap is a retrieval or catalog problem, not a ranking one.

## CLI

The MCP server uses the same implementation as the CLI:

```bash
node --no-warnings knowledge/scripts/sqlite-knowledge.mjs index --root /path/to/vault
node --no-warnings knowledge/scripts/sqlite-knowledge.mjs search "결제 실패 재시도" --root /path/to/vault
node --no-warnings knowledge/scripts/sqlite-knowledge.mjs neighbors PaymentService --root /path/to/vault
node --no-warnings knowledge/scripts/sqlite-knowledge.mjs status --root /path/to/vault
node --no-warnings knowledge/scripts/sqlite-knowledge.mjs eval --root /path/to/vault --k 10
node --no-warnings knowledge/scripts/sqlite-knowledge.mjs list --root /path/to/vault --domain wms --doc-type 정책
```

`eval` scores the index against the vault's own `_knowledge/questions.jsonl`: for each competency
question it reports the rank at which each `required_note_ids` entry was retrieved, plus aggregate
`recall_at_k` and `mrr`. Use it to prove a retrieval change helped instead of assuming it did.

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

## Runtime Requirements

The indexer uses `node:sqlite` with FTS5 and the trigram tokenizer. Use Node 24+, where `node:sqlite`
is available without a flag. Node 22.5-23 needs `--experimental-sqlite`, and some 22.x builds ship a
bundled SQLite without FTS5, which fails at index time with `no such module: fts5`. The Docker path
above provides a known-good runtime.

## Failure Handling

- `ERR_UNKNOWN_BUILTIN_MODULE: No such built-in module: node:sqlite`: the runtime predates unflagged
  `node:sqlite`. Add `--experimental-sqlite` on Node 22.5-23, upgrade to Node 24+, or use Docker.
- `no such module: fts5`: this Node build's bundled SQLite lacks FTS5. Upgrade Node or use Docker.
- Schema mismatch on query (`uses schema ... requires ...`): the database predates the current index
  layout. Rebuild with `knowledge_index`.
- Missing index: build it once, then retry the query.
- Stale index: rebuild before making freshness-sensitive claims.
- Ollama unavailable or model missing: report the concrete error; use `hash` only if semantic quality is not a requirement.
- No useful hits: say the indexed corpus cannot support the answer and identify the missing source or term.
- Conflicting hits: preserve both citations and label the conflict.
