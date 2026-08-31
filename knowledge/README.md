# knowledge

**English** · [한국어](KOR.md)

Skills for turning a codebase, a document set, or mixed notes into a knowledge system that can
actually answer questions — not just one that looks tidy. Every builder in this plugin is gated on
**answerability**: a vault is not finished until its own competency questions are answered from
cited evidence, and retrieval quality is measured with numbers, not assumed.

The plugin also ships a local MCP server (`knowledge-local`) that indexes the vault into a
disposable SQLite database for hybrid full-text search and graph traversal, and a post-edit hook
that notices Markdown changes inside a knowledge workspace and queues follow-up work.

## Install & Uninstall

```bash
/plugin install knowledge@newkayak12-claude-skills
/plugin uninstall knowledge@newkayak12-claude-skills
```

Installing registers the `knowledge-local` MCP server against the current project directory and
makes the hook available. Nothing runs until a skill is invoked or a Markdown file inside a
knowledge workspace is edited.

## Which skill do I want?

| I want to… | Skill |
|---|---|
| Build everything end to end from a corpus | `knowledge-workflow` |
| Turn code/docs into a linked Markdown vault with a lookup catalog | `knowledge-base-builder` |
| Agree on class names, relation meanings, and controlled vocabulary first | `ontology-builder` |
| Extract entities and relationships into graph-ready JSONL | `knowledge-graph-builder` |
| See the graph as a clickable offline HTML page | `render-graph-view` |
| Prepare chunks, metadata, and eval queries for a vector store | `rag-corpus-builder` |
| Build or refresh the local SQLite index and score it | `sqlite-index-builder` |
| Ask a question and get a cited, coverage-graded answer | `knowledge-query` |

## Skills

### `knowledge-workflow`

The entry point. Explores the source material like a graph — seed sources, neighbouring
concepts, dependencies — and drives the other skills in order: intake → vault → ontology →
graph → RAG → query surfaces. Use it when the request is "knowledge-ify this" rather than one
specific artifact.

```
Build a queryable knowledge system from this repo. The readers are new backend engineers;
optimise for onboarding and impact analysis.
```

Default output layout under `knowledge-system/`:

```text
knowledge-system/
  index.md  vault-plan.md  glossary.md  open-questions.md
  notes/  mocs/
  _knowledge/   catalog.jsonl  questions.jsonl  question-results.jsonl  coverage.md
  _ontology/    ontology.md  ontology.yml  mapping.md
  _graph/       schema.md  nodes.jsonl  edges.jsonl  question-reachability.jsonl
  _rag/         chunks.jsonl  sources.csv  eval-queries.jsonl
```

### `knowledge-workflow`

Entry point for a full build or a retrieval repair loop. Routes the skills below in order,
and turns the repair loop into measured rounds with a declared stop condition: split the
question set before the first edit, change one thing per measurement, revert regressions on
corpus edits, and stop when the holdout stops moving rather than when the edits run out.

### `knowledge-base-builder`

Builds the linked Markdown vault. Each note is one durable **claim** — a concept, a code module,
a decision, a workflow, or a *relation* between things. The atomic unit is the claim, not the
entity, so "A and B differ in X" is a first-class note with evidence for every side, not
something split across A and B and lost.

```
Turn src/ and docs/ into an Obsidian-style vault. Operators will search by screen name;
engineers by mapper id. Both must land on the same notes.
```

What it produces beyond notes:

- `_knowledge/catalog.jsonl` — one record per note: id, path, title, `aliases`, `user_terms`
  (operator/UI language), `source_symbols` (code/statement/schema identifiers), `entities`.
- `_knowledge/questions.jsonl` — competency questions derived from real lookup jobs, each naming
  the note ids required to answer it.
- `_knowledge/question-results.jsonl` + `coverage.md` — every question graded `complete`,
  `partial`, or `unanswerable`. Any non-complete result leaves the build **incomplete**.

Completion gate:

```bash
node knowledge/scripts/validate-knowledge.mjs --root knowledge-system --require-answerability
```

### `ontology-builder`

Defines the classes, relationship types, properties, constraints, and controlled vocabularies
that the vault, graph, and RAG layers share. Use it before `knowledge-graph-builder` on any
long-lived or cross-domain corpus, so `Service DEPENDS_ON Database` means one thing everywhere.

```
Design an ontology for this WMS codebase before we extract the graph. We need
ownership, dependency, and screen-to-query traceability.
```

### `knowledge-graph-builder`

Extracts source-grounded nodes and edges. Relationship names are specific and directional
(`CALLS`, `QUERIES`, `SUPERSEDES` — not `RELATED_TO`), every non-obvious edge carries a
`source_ref`, and inferred edges are marked as such. Shared anchors and co-occurrence may
*nominate* a relation but never establish one.

```
Build graph-ready nodes.jsonl and edges.jsonl from the vault. Mark comparison questions
with graph_check and prove each one is reachable within two hops.
```

Relationship-heavy competency questions get a `_graph/question-reachability.jsonl` record: an
unreachable question is a graph defect, ranked with orphans.

### `render-graph-view`

Renders `_graph/nodes.jsonl` + `edges.jsonl` into a single self-contained HTML file — canvas,
search, type filters, detail panel — that works offline with no CDN or server.

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/render-graph-view/scripts/render-graph-view.mjs" \
  --root knowledge-system --title "WMS knowledge graph"
```

Zooming out spreads nodes apart instead of collapsing them into a blob (semantic zoom): node
positions shrink more slowly than node dots, edges fade, and labels thin out to hubs only.

Edges whose endpoints do not exist are omitted **and reported**, never hidden.

### `rag-corpus-builder`

Turns the vault into retrieval-ready chunks with propagated metadata and citations, plus an
`eval-queries.jsonl` set. Semantic headings are the preferred chunk boundaries; `chunks.jsonl`
and `sources.csv` are the canonical corpus and any vector database is a downstream index.

```
Prepare _rag/ from the vault for pgvector. Keep note ids stable so citations survive re-indexing.
```

### `sqlite-index-builder`

Builds `.knowledge/knowledge.sqlite` from the catalog-backed Markdown, RAG chunks, and graph
JSONL. The database is disposable local state — Markdown and JSONL stay in Git.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/sqlite-knowledge.mjs" index --root knowledge-system
node "${CLAUDE_PLUGIN_ROOT}/scripts/sqlite-knowledge.mjs" status --root knowledge-system
node "${CLAUDE_PLUGIN_ROOT}/scripts/sqlite-knowledge.mjs" eval --root knowledge-system --k 10
```

`eval` scores retrieval against the vault's own `_knowledge/questions.jsonl` and reports `mrr`
and `recall_at_k` per question. Run it after every index rebuild; a required note missing from
the top *k* is a retrieval defect, not a clean build.

Missed questions get a repair loop rather than a shrug. `repair_targets` ranks the unretrieved
notes by how many questions they block and classifies each gap as `missing-note` (an extraction
job), `no-lookup-vocabulary` (no aliases, user terms, or source symbols), or `ranking`. Two
guards keep the repair from grading itself: `--split dev|holdout` reserves a third of the
questions — the bucket is derived from the question id, so it is stable across runs and cannot
drift while vocabulary is being edited — and `--baseline before.json` compares per question, so
a run that lifts three questions and sinks one reports `verdict: regressed` instead of a higher
average. Vocabulary must be grounded in the source material; a term copied out of the question
set guarantees its own retrieval and measures nothing.

```json
{ "total": 5, "hits": 5, "recall_at_k": 1, "mrr": 1,
  "questions": [{ "question_id": "stock-table-differences", "first_rank": 1, "hit": true }] }
```

### `knowledge-query`

Answers questions over any of the above — SQLite index, catalog, vault, graph, RAG — and always
begins with a coverage grade:

```markdown
Coverage: partial

The ledger and change reports both decompose stock by bucket, but on different axes …

Evidence:
- notes/stock/stock-ledger.md -> src/mapper.xml#getStockGoodsListVer2
- notes/stock/stock-change.md -> src/mapper.xml#getStockChangeGridVer2

Missing knowledge:
- A relation note contrasting the two outbound denominators (rel_stats='CN' vs none).
```

`complete` means every material part is backed by direct evidence. `partial` and `unanswerable`
name exactly what is missing so the gap becomes the next extraction task instead of a silent,
plausible-sounding wrong answer.

## Local SQLite + MCP

The `knowledge-local` MCP server exposes:

| Tool | Purpose |
|---|---|
| `knowledge_status` | Index presence, freshness, counts, embedding config |
| `knowledge_index` | Rebuild the index from Markdown and JSONL |
| `knowledge_search` | Hybrid retrieval with source references and diagnostics |
| `knowledge_get` | Full record by stable id |
| `knowledge_neighbors` | Direct graph relationships of a node |

### How ranking works

Retrieval is **rank-fused, lexical-first**:

1. Each FTS5 table is queried per column — `title`, `terms` (curated aliases, user terms,
   source symbols), `body` — and the three rank lists are fused, so a title or alias match beats a
   passing body mention regardless of note length.
2. An exact-token index (`unicode61`) and a trigram index handle Korean inflection
   ("재시도" finds "재시도한").
3. Relation notes are promoted when the query matches two or more of their declared
   `participants` — declared participants only, never co-occurrence. The reverse also holds:
   when a relation note ranks near the top and its declared participants would not be returned,
   those participants are added to the **end** of the result window. A comparison question is
   usually phrased in the language of the contrast, so without this the contrast note is the
   only thing retrieved and the per-side evidence the answer needs is missing. Three things make
   this hold up instead of trading one kind of question for another:
   - The nomination is read off the **fused** order. A contrast note often arrives at the top
     through its own participants rather than its keywords, so reading its lexical rank would
     disqualify exactly the notes that earned their place.
   - Promotion buys **retrievability, not rank**. The sides take the last slots, never the best
     ones, so the first correct answer to every other query keeps its position. Scoring them
     near the top was measured on a real vault: comparison answers rose, MRR fell, and five
     previously-answered questions broke.
   - The window boundary is **solved, not read once**. Appended sides move the cutoff, so a
     sibling at rank 9 of 10 stops being retrievable the moment two of its siblings are
     appended; it joins them rather than being evicted by them. Promotion is capped at half the
     window.

   A side that would have been returned on its own evidence is left where it is.
   `relation_promotion` names the direction on each result, and
   `relation_participant_promotions` counts the sides that could not come back on their own, and
   `relation_participant_evicted_ids` names the notes that left the window to make room — so
   "a sibling note dropped out" is a measurement rather than a guess.
4. Results are grouped one-per-note by default (`group: none` to see every chunk), so a heavily
   chunked note cannot crowd sibling notes out of the top *k*. `domain`, `docType`, `section`, and
   `pathPrefix` filters — and a query-less `list` command — cover scoped lookups without SQL.
5. The default `hash` embedding is a dependency-free lexical feature hash, **not** a semantic
   model. It carries no ranking weight when any lexical match exists and only orders the fallback
   when nothing matches. Results report `embedding_quality: lexical-baseline` so this is never
   mistaken for semantic search.
6. With a real embedding provider the fusion split is `semantic 0.7 / lexical 0.3`, and that
   split is a **starting point, not a measured constant**. Semantic weight wins the paraphrased
   and operator-phrased questions lexical search cannot reach; it loses the ones that quote an
   exact screen label back at the index, where meaning similarity dilutes an exact term match.
   `--lexical-weight` overrides it on `search` and `eval`, and `eval` records the split it ran
   under in `fusion_weights`, so a sweep can be read back afterwards against a saved baseline.
   `eval --sweep 0.3,0.4,0.5` scores every weight in one pass — the query vectors do not depend
   on the weights, so the extra points cost SQL, not embeddings — and reports each weight's
   per-question improvements and regressions against the first one, plus a `decisive` flag that
   is false when the winner cannot be separated from the reference.
7. Embedding models trained for asymmetric retrieval encode a question and a stored passage
   differently, and Ollama's `/api/embed` does not add the instruction for you. `embeddinggemma`
   documents are embedded as `title: … | text: …` and queries as
   `task: search result | query: …`. The prompt id is recorded in the index metadata and
   reported as `embedding_prompt`, so a query is only prefixed the way its documents were —
   an index built before this stays unprefixed until it is rebuilt. An unknown model gets no
   prompt rather than a guessed one.
8. A document longer than the model's context window would be indexed by its opening alone,
   with the rest invisible to semantic search while full-text still matches it. Documents past
   the budget are embedded in **overlapping windows** and mean-pooled into one vector, so a long
   note stays one result and nothing downstream changes. The budget is measured in characters
   (`embeddinggemma`: 1800) because the tokenizer is not available locally; `--embed-chars`
   overrides it and the build reports `embedding_context_chars` and `documents_windowed`. A model
   with no known window is left unbounded.
9. An optional cross-encoder **reranker** reorders a shortlist before the result window is
   built, so relation promotion still decides retrievability on the order a reader sees. It is
   attached the way Ollama is — `--reranker-url` / `--reranker-model`, nothing installed, nothing
   required — speaks the Cohere/Jina `/v1/rerank` shape that llama.cpp and text-embeddings-
   inference both serve, and falls back to fused order with `rerank_error` set when the endpoint
   fails. Its ceiling is measurable in advance: a reranker cannot beat `recall@50 − recall@10`.

Every search result carries diagnostics — `lexical_candidates`, `lexical_word_matches`,
`lexical_trigram_matches`, `lexical_matches_returned`, `relation_promotions`, `relation_participant_promotions`, `distinct_notes` — so a ranking miss
is visible instead of looking like an empty vault.

### Rebuilds

`index` always rebuilds the whole index, and reuses the embedding of any document whose embedded
text — prompt prefix included — is byte-identical to the one already stored. The expensive half is
therefore incremental while the correctness half is not: editing three notes embeds three
documents, and a deleted or renamed note still cannot leave a stale row behind. The build reports
`embeddings_reused` and `embeddings_computed`; the cache is rejected whenever the provider, model,
prompt template, or schema version differs, and `--no-reuse-embeddings` forces a cold rebuild.

### Runtime

Node 24+ (unflagged `node:sqlite` with FTS5). Node 22.5–23 needs `--experimental-sqlite`, and
some 22.x builds lack FTS5. The bundled Docker image is a known-good path:

```bash
docker compose -f knowledge/compose.yaml run --rm knowledge-index
```

## Roadmap

[ROADMAP.md](ROADMAP.md) — what is measured, what is queued, and what is deliberately not being
done, ordered by measured lever size rather than by what is easiest to edit.

## Hook

`hooks/knowledge-delta-check.mjs` runs after `Write`/`Edit` and activates only when the changed
Markdown belongs to an existing knowledge workspace. It queues a single-note catalog upsert and,
when competency results exist, an answerability recheck for the affected questions. It never
blocks the edit and never triggers a full reindex.

## Worked example

A 583-note vault built from a warehouse-management codebase passed every structural check —
metadata, provenance, 99 % resolved links — and still could not answer "what is the difference
between the stock ledger, status, and change reports?". The answer lived *between* three notes,
not in any of them. That failure shaped this plugin:

- relation notes with per-side evidence (`knowledge-base-builder`)
- competency questions as a hard completion gate (`validate-knowledge.mjs`)
- `user_terms` / `source_symbols` bridges so screen names reach mapper ids (`catalog.jsonl`)
- `eval` so retrieval changes are proven with `mrr`, not felt (`sqlite-index-builder`)

---
