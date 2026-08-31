---
name: sqlite-index-builder
description: >-
  Use when building, rebuilding, refreshing, or syncing a local SQLite knowledge
  index from canonical Markdown plus catalog, RAG, and graph JSONL; not for
  querying an existing index or creating source artifacts.
scenarios:
  - "MD와 JSONL graph를 SQLite로 sync해줘"
  - "이 knowledge vault의 SQLite index를 rebuild해줘"
  - "catalog, RAG chunks, nodes, edges를 knowledge.sqlite로 변환해줘"
  - "Build a local SQLite index from this Markdown vault and graph JSONL"
compatibility:
  recommended:
    - mcp__knowledge-local__knowledge_index
    - mcp__knowledge-local__knowledge_status
  optional:
    - mcp__knowledge-local__knowledge_search
    - mcp__knowledge-local__knowledge_neighbors
---

# SQLite Index Builder

Build or refresh `.knowledge/knowledge.sqlite` from portable knowledge artifacts. Markdown and JSONL remain canonical; SQLite is derived local state for FTS5, embeddings, and graph traversal.

## Input Contract

Discover the knowledge root from the user-provided path, the current directory, or the conventional `knowledge-system/`, `knowledge-base/`, and `knowledge-artifacts/` directories. The indexer consumes these files when present:

```text
_knowledge/catalog.jsonl
_rag/chunks.jsonl              # or rag/chunks.jsonl
_graph/nodes.jsonl             # or graph/nodes.jsonl
_graph/edges.jsonl             # or graph/edges.jsonl
```

Markdown is indexed through each catalog record's `path`; the indexer does not crawl arbitrary `*.md` files. If Markdown exists without `_knowledge/catalog.jsonl`, use `knowledge:knowledge-base-builder` to create the catalog before indexing. If graph or RAG JSONL must be produced or repaired, use `knowledge:knowledge-graph-builder` or `knowledge:rag-corpus-builder` first.

## Build

1. Inspect the discovered inputs and state which artifact types are present or missing.
2. Choose the embedding provider:
   - `hash` is the dependency-free default. It provides deterministic lexical feature vectors, not semantic-model embeddings, and search ranks full-text matches ahead of its vector similarity. Report this when the user expects semantic recall; the build result carries `embedding_quality: lexical-baseline` and a matching notice.
   - `ollama` provides semantic embeddings when a local Ollama endpoint and model already exist. Do not silently install Ollama or pull a model.
3. When the `knowledge-local` MCP server is available, call `knowledge_status` and compare its reported root with the desired knowledge root. If they resolve to the same path, call `knowledge_index` with the selected provider and model; the MCP tool does not accept a per-call root. If the server is unavailable or points at a different root, run the bundled CLI with an explicit `--root` relative to the plugin root:

```bash
node --no-warnings "${CLAUDE_PLUGIN_ROOT}/scripts/sqlite-knowledge.mjs" index \
  --root /path/to/vault \
  --provider hash
```

For an existing local Ollama model:

```bash
node --no-warnings "${CLAUDE_PLUGIN_ROOT}/scripts/sqlite-knowledge.mjs" index \
  --root /path/to/vault \
  --provider ollama \
  --model embeddinggemma
```

If `CLAUDE_PLUGIN_ROOT` is unavailable, resolve `../../scripts/sqlite-knowledge.mjs` from this `SKILL.md`.

The indexer requires Node 24+, or Node 22.5-23 with `--experimental-sqlite` and an FTS5-enabled SQLite build. On `No such built-in module: node:sqlite` or `no such module: fts5`, switch to the Docker path in the local SQLite reference instead of reporting the vault as unindexable.

The `index` operation rebuilds the SQLite schema and contents from the current source artifacts; it is not a live or incremental file sync.

## Verify

After indexing:

1. Run `knowledge_status`, or the CLI `status --root /path/to/vault`.
2. Require the database to exist and report `stale: false`.
3. Compare the returned note, chunk, node, and edge counts with the discovered inputs. Explain legitimately absent artifact types instead of treating every zero as success.
4. When notes exist, run one bounded search smoke test using a term that appears verbatim in a known note title or alias, and confirm that note is returned with `lexical_match: true`. A smoke test whose results are all `lexical_match: false` indicates a ranking or tokenization problem, not a passing build. When graph nodes and edges exist, run one neighbor lookup for a known node.
5. When `_knowledge/questions.jsonl` exists, run `eval --root /path/to/vault --k 10` and report `mrr`, `recall_at_k`, and `mean_distinct_notes`. A `mean_distinct_notes` well below k means chunks of one note are crowding the top slots; results are grouped per note by default, so this should only happen with `--group none`. Any competency question whose required notes are missing from the top k is a retrieval defect: name the question rather than reporting the build as clean, and follow the retrieval repair loop below instead of accepting the score.
6. Report the database path, source root, indexed counts, embedding provider/model/dimensions, fingerprint, and freshness.

## Retrieval Repair Loop

Run this when eval reports missed questions. It is a measurement loop, not an editing loop: the
danger is not a failed question, it is a fix that scores well because it was tuned against the
same questions used to judge it.

1. **Split before touching anything.** `eval --split holdout` scores the reserved third of the
   question set; `--split dev` scores the rest. Buckets are derived from each question id, so
   they are stable across runs and cannot drift while vocabulary is being edited. Repair against
   `dev` only, and record the holdout number first — a holdout measured after the repair proves
   nothing.
2. **Read `repair_targets` before proposing an edit.** Each entry names an unretrieved required
   note, how many questions it blocks, and its `gap`: `missing-note` means the note is absent
   from the catalog and this is an extraction job for `knowledge:knowledge-base-builder`;
   `no-lookup-vocabulary` means the note carries no aliases, user terms, or source symbols;
   `ranking` means the vocabulary exists and something else is outranking it. Start with the
   note blocking the most questions, not the note that is easiest to edit.
   When a comparison question retrieves its relation note but none of the sides, check the
   relation record's `participants` before touching vocabulary: search pulls declared
   participants in on its own, so an undeclared side is a catalog defect, not a lookup one.
3. **Ground each added term in the repo, not in the question set.** See the vocabulary-bridge
   repair rules in [answerability-contract.md](../knowledge-base-builder/references/answerability-contract.md).
4. **Re-index and re-score after each change, against the saved run.** One edit per measurement;
   a batch of edits cannot be attributed or reverted.

```bash
node --no-warnings "${CLAUDE_PLUGIN_ROOT}/scripts/sqlite-knowledge.mjs" eval \
  --root /path/to/vault --split dev --k 10 > /tmp/before.json
# edit vocabulary, then index again
node --no-warnings "${CLAUDE_PLUGIN_ROOT}/scripts/sqlite-knowledge.mjs" eval \
  --root /path/to/vault --split dev --k 10 --baseline /tmp/before.json
```

The `baseline` block reports `improvements`, `regressions`, and a `verdict`. **Revert on any
regression**, even when `recall_at_k` rose. Competency sets are small enough that one question
moves recall by several points, so an aggregate gain routinely hides a question that stopped
working; `regressions` names it. Only after `dev` is stable, score `--split holdout` once and
report both numbers. A holdout that did not move means the repair generalized to nothing —
report that plainly instead of citing the dev gain.

Do not cite the SQLite file as source evidence and do not commit it merely to share knowledge. Commit or synchronize the canonical Markdown and JSONL instead. Do not modify source artifacts during an index-only request.

Read [the local SQLite reference](../knowledge-query/references/local-sqlite.md) when Docker operation, MCP routing, Ollama configuration, or failure recovery is needed.

## Related Skills

- `knowledge:knowledge-base-builder` - create the Markdown catalog that controls note inclusion.
- `knowledge:knowledge-graph-builder` - create or repair graph node and edge JSONL.
- `knowledge:rag-corpus-builder` - create or repair retrieval chunk JSONL.
- `knowledge:knowledge-query` - query and cite evidence from an existing index after the build.
