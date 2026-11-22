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

> **trophy rides along.** From this version, the first interactive session after you install or update this plugin installs [trophy](../trophy/README.md) (achievements) once, in user scope, if you don't have it. Nothing is sent until you say yes; uninstalling trophy is respected (it is never reinstalled). To opt out beforehand: `mkdir -p ~/.claude/plugins/.newkayak12-trophy-ride.done`. Needs `sh` (Windows without one is not covered).

Installing registers the `knowledge-local` MCP server against the current project directory and
makes the hook available. Nothing runs until a skill is invoked or a Markdown file inside a
knowledge workspace is edited.

### Where files land

One resolver (`scripts/knowledge-paths.mjs`) serves the indexer, the MCP server and the hook, so
all three find the same store. The store is the project root when it holds an artifact
(`_knowledge/catalog.jsonl`, `_rag/`, `_graph/`), else `knowledge-system/` (or `knowledge-base/`,
`knowledge-artifacts/`) under it. A project with no store gets `knowledge-system/` on its first write.
`root` in `_knowledge/config.json` moves a store elsewhere (read once, never chained).

| Path | Created by | When | Purpose |
|---|---|---|---|
| `~/.claude/plugins/cache/<market>/knowledge/<ver>/` | `/plugin install` | install | the plugin itself: skills, scripts, hook, Dockerfile, compose |
| `<project>/` | nothing | install | installing writes nothing into the project |
| `<project>/knowledge-system/` (`notes/`, `mocs/`, `_knowledge/`, `_ontology/`, `_graph/`, `_rag/`) | the skills, `knowledge_capture` | a build, or the first capture | the store: Markdown and JSONL, kept in Git |
| `<project>/knowledge-system/.knowledge/knowledge.sqlite` (+ `-wal`, `-shm`) | `index` / `knowledge_index` | each index | disposable search index |
| `<project>/knowledge-system/_knowledge/{checks,reports,jobs}/` | the delta hook, `knowledge_capture` | after a `.md` edit in the store, or a capture | `checks/latest.json`, `reports/delta-checks.jsonl`, `jobs/*-queue.jsonl` |
| `knowledge-system/notes/<id>.md`, `_knowledge/catalog.jsonl` row, `mocs/captures.md` | `knowledge_capture` | each capture | the captured note, its catalog row, the list of captures that link to nothing |
| `knowledge-system/_knowledge/config.json` | you | optional | per-store settings: `root`, `notes_dir`, `link`, `graph`, `llm`, `storage` |
| `knowledge-system/_graph/{nodes,edges,rejected-edges,question-reachability}.jsonl` | `knowledge-graph.mjs build` | each LLM graph build | graph, refused edges with reasons, competency-question reachability |
| `knowledge-system/.knowledge/hardware-probe.json`, `.knowledge/graph-previous/` | `knowledge-graph.mjs` | each graph build | the model tier picked and why; the graph the last build replaced |
| `knowledge-system/.knowledge/postgres.json` | you | optional | `workspace_id`, `schema` for `migrate` and `postgres-sync` |

## Core concepts

Nine ideas carry the whole plugin. Each borrows from an established theory and bends it where
measurement said to; [docs/theory.md](docs/theory.md) has the sources and the exact departures.

**1. A vault is finished when it can answer, not when it looks tidy.**
Ontology engineering has long judged a model by *competency questions* — the questions it must be
able to answer (Grüninger & Fox, 1995). Here those questions are a build gate: every question in
`_knowledge/questions.jsonl` must be answered `complete` from cited notes, or the build is not
done. A 583-note vault with perfect links still failed this test, which is why the gate exists.

**2. The unit of knowledge is a claim, not a thing.**
"One note, one idea" (Zettelkasten, evergreen notes) is the starting point. But "A and B differ in
X" belongs to neither A nor B — split by entity, it disappears. So a *relation note* (contrast,
equivalence, sequence) is a first-class note, and it carries evidence for every side.

**3. Search people's words, not just the author's.**
An operator says "결제 승인 화면"; the code says `PaymentService.authorize`. Neither is an alias of
the other, so the catalog keeps them in separate fields — `user_terms`, `source_symbols` — and
search can walk from one layer to the other.

**4. Several rankings, merged by rank, not by score.**
Keyword search (BM25 over SQLite FTS5) finds exact labels; embedding search finds paraphrases.
Their scores are not comparable, so the plugin merges their *orders* with Reciprocal Rank Fusion
(Cormack et al., 2009): each list contributes `1 / (60 + rank)`. Korean needs one more step:
two-syllable nouns such as 재고 are matched as prefixes so particles (재고가, 재고를) do not hide them.

**5. A comparison needs every side in the results.**
Multi-hop QA research (HotpotQA) shows that some questions need facts from several documents at
once. When a contrast note ranks near the top, its declared participants are appended to the end
of the result window — enough to be *retrievable*, never enough to take the best slots. Only
declared membership counts; co-occurrence never does.

**6. Measure retrieval with numbers, against a set you did not tune on.**
`eval` reports MRR and recall@k (the TREC QA metrics) per question. Repairs are made against a
*dev* split and confirmed once on a *holdout* the loop never looked at — reusing a holdout while
tuning quietly turns it into training data (Dwork et al., 2015). A sweep winner has to pass a
paired sign test before it is called `decisive`.

**7. Never copy the exam into the answer key.**
Adding a question's own words to a note guarantees that question retrieves the note and proves
nothing — *leakage* in data-mining terms (Kaufman et al., 2012). Every added term must exist in
the source material: the UI, the code, or the operator's own words.

**8. "Complete" is a checklist, not a feeling.**
Models are over-confident (Guo et al., 2017): answers here declared `complete` 69–80 times out of
94 and were right 22–38 times. So an answer splits the question into parts, names the note it
*opened* for each part, and downgrades to `partial` the moment one part rests on a snippet or a
guess.

**9. Search small, read big — and tell each piece where it came from.**
Finer retrieval units retrieve better (Dense X Retrieval, 2024), but a passage cut out of a note
forgets what it is about: "revenue grew 3%" — whose, when? So chunks are cut on the structure the
source already has (embedding-based "semantic chunking" has not repaid its cost — Qu et al., 2025),
each chunk inherits its parent note's title and lookup vocabulary, and an authored `context`
sentence is prepended before both keyword and embedding indexing (Contextual Retrieval, Anthropic
2024: −49% retrieval failures). Search returns one result per note, and the answer opens the whole
note.

## Which skill do I want?

| I want to… | Skill |
|---|---|
| Build everything end to end from a corpus | `workflow` |
| Turn code/docs into a linked Markdown vault with a lookup catalog | `base-builder` |
| Agree on class names, relation meanings, and controlled vocabulary first | `ontology-builder` |
| Extract entities and relationships into graph-ready JSONL | `graph-builder` |
| See the graph as a clickable offline HTML page | `render-graph-view` |
| Prepare chunks, metadata, and eval queries for a vector store | `rag-corpus-builder` |
| Build or refresh the local SQLite index and score it | `sqlite-index-builder` |
| Ask a question and get a cited, coverage-graded answer | `query` |

## Skills

### `workflow`

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

### `workflow`

Entry point for a full build or a retrieval repair loop. Routes the skills below in order,
and turns the repair loop into measured rounds with a declared stop condition: split the
question set before the first edit, change one thing per measurement, revert regressions on
corpus edits, and stop when the holdout stops moving rather than when the edits run out.

### `base-builder`

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

The validator also reports **citation precision** beside answerability:

```text
Citations: recall 3/3; precision 3/4; off-key 1; full 1/1
```

Answerability alone counts whether required notes were cited, which rises for free whenever a
change makes answers cite more notes. Precision — how much of what an answer cited was evidence
it actually needed — is the other half, so a recall gain bought with noise is visible. Every
result is scored, `partial` ones included, so a failed answer still reports how close it came.
Precision is reported, never gated: off-key citations are usually legitimate supporting context,
and gating them would teach answers to cite less rather than better.

### `ontology-builder`

Defines the classes, relationship types, properties, constraints, and controlled vocabularies
that the vault, graph, and RAG layers share. Use it before `graph-builder` on any
long-lived or cross-domain corpus, so `Service DEPENDS_ON Database` means one thing everywhere.

```
Design an ontology for this WMS codebase before we extract the graph. We need
ownership, dependency, and screen-to-query traceability.
```

### `graph-builder`

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

**LLM build in Docker (optional).** With any OpenAI-compatible chat endpoint, one command reads
every catalog note, keeps only edges that pass the rules above (evidence found word for word in the
cited note, a specific `UPPER_SNAKE` type, known endpoints, no reversed duplicate unless the ontology
says symmetric), writes refused edges to `_graph/rejected-edges.jsonl` with reasons, computes
reachability, and rebuilds the index. A hardware probe picks the model size: CPU-only under 16 GB is
`small`, 16 GB RAM or 8 GB VRAM `medium`, 16 GB VRAM `large` (`KNOWLEDGE_LLM_TIER` or
`KNOWLEDGE_LLM_MODEL` override it). With no endpoint it changes nothing and exits 2; the skill path
above is unchanged.

```bash
# bundled ollama, pulls the model the probe picked
KNOWLEDGE_ROOT=$PWD KNOWLEDGE_LLM_URL=http://ollama:11434 KNOWLEDGE_LLM_PULL=1 \
  docker compose -f "${CLAUDE_PLUGIN_ROOT}/compose.yaml" --profile llm up -d --wait ollama
KNOWLEDGE_ROOT=$PWD KNOWLEDGE_LLM_URL=http://ollama:11434 KNOWLEDGE_LLM_PULL=1 \
  docker compose -f "${CLAUDE_PLUGIN_ROOT}/compose.yaml" --profile graph --profile llm run --rm knowledge-graph
# or without Docker, against any endpoint
KNOWLEDGE_LLM_URL=http://127.0.0.1:11434 node "${CLAUDE_PLUGIN_ROOT}/scripts/knowledge-graph.mjs" build --root .
```

A rerun is incremental once `_graph/` exists: it reads `_knowledge/jobs/graph-update-queue.jsonl`
(the hook and `knowledge_capture` append to it) and sends only the queued notes to the model. Their
old edges and entity claims are replaced, a queued note that no longer exists loses its nodes and
edges with no model call, and everything else stays byte for byte. Queue entries leave only after
`_graph/` is written; a note whose extraction failed stays queued. An empty queue changes nothing
(`status: up-to-date`). `--full` re-extracts every note.

Node types, allowed relation types and symmetric types come from `graph` in
`_knowledge/config.json` (`relation_types`, `symmetric`, `weak_types`, `max_hops`), so one engine
serves stores with different ontologies.

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

Builds `<store>/.knowledge/knowledge.sqlite` (by default `<project>/knowledge-system/.knowledge/knowledge.sqlite`)
from the catalog-backed Markdown, RAG chunks, and graph JSONL. The database is disposable local
state — Markdown and JSONL stay in Git.

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
guards keep the repair from grading itself: `--split dev|holdout` reserves 35% of the
questions by default (`--holdout`; on a small set the realised share drifts by several points) — the bucket is derived from the question id, so it is stable across runs and cannot
drift while vocabulary is being edited — and `--baseline before.json` compares per question, so
a run that lifts three questions and sinks one reports `verdict: regressed` instead of a higher
average. The comparison also counts how many required notes each question retrieved, so a
multi-note question losing one side is a regression even while it still fails, and a baseline
scored at a different `k`, split, or holdout ratio yields `verdict: incomparable` instead of a
verdict; provider, fusion, and reranker differences are named in `differences`. Vocabulary must be grounded in the source material; a term copied out of the question
set guarantees its own retrieval and measures nothing.

```json
{ "total": 5, "hits": 5, "recall_at_k": 1, "mrr": 1,
  "questions": [{ "question_id": "stock-table-differences", "first_rank": 1, "hit": true }] }
```

### `query`

Answers questions over any of the above — SQLite index, catalog, vault, graph, RAG — and always
begins with a coverage grade:

```markdown
Coverage: partial
Parts:
- ledger bucket axis -> notes/stock/stock-ledger.md
- change-report bucket axis -> notes/stock/stock-change.md
- outbound denominator contrast -> none

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

Three rules decide whether that grade means anything. They come from a head-to-head run of 94
competency questions on one real vault, same index for both, only the answering model different:

- **Cite only what you opened.** A search snippet says a note matched, not what it claims.
  Answers that opened no note cited the required note 14% of the time; answers that opened four
  or more, 93%. A local model answered 29 of 94 questions without opening a single note.
- **One hop before answering a question with sides.** `knowledge_neighbors` was called 4 times
  in 188 answer runs. The notes both models missed most are exactly the ones a hop reaches — a
  shared status-flow note missed on 5 of the 6 questions requiring it, a contrast note missed on
  all 3. Single-note questions scored 0.94 for both models; multi-source questions, 0.28 and
  0.69. A question naming N things to compare, bridge, or order is answered from at least N
  notes, or it is `partial` and says which side is missing.
- **`complete` is a claim about parts, not confidence.** It was declared on 69 and 80 of 94
  answers and was actually complete on 22 and 38. Split the question into parts, name the opened
  note covering each on its own `Parts` line, and downgrade the moment one maps to nothing, a
  snippet, or inference.

## Local SQLite + MCP

The `knowledge-local` MCP server exposes:

| Tool | Purpose |
|---|---|
| `knowledge_status` | Index presence, freshness, counts, embedding config |
| `knowledge_index` | Rebuild the index from Markdown and JSONL |
| `knowledge_search` | Hybrid retrieval with source references and diagnostics |
| `knowledge_get` | Full record by stable id |
| `knowledge_neighbors` | Direct graph relationships of a node |
| `knowledge_capture` | Save content as a linked Markdown note in the store |

### Capture

`knowledge_capture` turns what arrives over MCP into a note the vault can answer from. The engine
links, not the caller: a note is linked only when its title or an alias appears in the text (a
Korean term through a listed particle, `결제 승인을`, but not `결제 승인서`; never inside code or an
existing link; the same particle list strips query words in the index), and the
linked note gets a backlink in its `## Related`. Index hits the text does not name come back in
`skipped_candidates` with the reason, never as links. A title or alias the catalog already has
creates nothing and returns `merged_into`. A capture that names no note is listed in
`mocs/captures.md`, so no capture is an orphan. The reply names `linked_to`, `backlinked_from`,
`merged_into` and `skipped_candidates`; catalog, graph and embed jobs are queued, and the next
`knowledge_index` makes it searchable. `link` in `_knowledge/config.json` sets `min_term_length`,
`max_links`, `moc` and `fallback_moc`.

**Codex.** `knowledge_capture` writes, so Codex asks before it runs. A non-interactive
`codex exec` (approval policy `never`) refuses it with `MCP tool call requires approval, but
approval policy is never`. Approve that one tool instead of bypassing approvals:

```toml
# ~/.codex/config.toml — the server name as Codex lists it
[mcp_servers.knowledge-local.tools.knowledge_capture]
approval_mode = "approve"
```

or per run: `codex exec -c 'mcp_servers.knowledge-local.tools.knowledge_capture.approval_mode="approve"' …`.
Checked on codex-cli 0.170.0 with the server registered by hand (`-c mcp_servers.<name>.…`): refused
without the setting, the note written with it. The read tools need no approval.

### Embeddings from an OpenAI-compatible endpoint

`--provider openai` (or `KNOWLEDGE_EMBED_PROVIDER=openai`, or `embed.provider` in
`_knowledge/config.json`) embeds through `POST <url>/v1/embeddings` — OpenAI, text-embeddings-inference,
vLLM. `KNOWLEDGE_EMBED_URL` / `embed.url`, `KNOWLEDGE_EMBED_MODEL` / `embed.model` and
`KNOWLEDGE_EMBED_API_KEY` / `embed.api_key` set it; env outranks the file, and neither the url nor the
key is written to the index. An E5 model (`intfloat/multilingual-e5-base`) gets its `query: ` /
`passage: ` prompts and 460-character windows, since its 512 tokens are a hard limit on such servers.
Queries are embedded through the same endpoint; when it is down, search answers lexical-only and says
so in `query_embedding: {applied: false, error}` with `fusion_weights` `0 / 1`.

### How ranking works

Retrieval is **rank-fused, lexical-first**:

1. Each FTS5 table is queried per column — `title`, `terms` (curated aliases, user terms,
   source symbols), `body` — and the three rank lists are fused, so a title or alias match beats a
   passing body mention regardless of note length.
2. An exact-token index (`unicode61`) and a trigram index handle Korean inflection
   ("재시도" finds "재시도한"). Two-syllable nouns — 재고, 출고, 결제 — are too short for trigrams,
   so Hangul query words match as prefixes ("재고" finds "재고가") and a trailing particle is
   stripped into a second prefix beside the word ("재고를" finds "재고").
3. Relation notes are promoted when the query matches two or more of their declared
   `participants` — declared participants only, never co-occurrence. The promotion bonus scales
   with the lexical weight, so under a semantic-heavy split it still cannot put a relation note
   that matched none of the query's words above notes that did. The reverse also holds:
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
   is true only when the winner's per-question moves pass a paired sign test (`p_value` < 0.05).
   The winner is still chosen on the questions it is tested on, so confirm it on the holdout.
7. Embedding models trained for asymmetric retrieval encode a question and a stored passage
   differently, and Ollama's `/api/embed` does not add the instruction for you. `embeddinggemma`
   documents are embedded as `title: … | text: …` and queries as
   `task: search result | query: …`. The prompt id is recorded in the index metadata and
   reported as `embedding_prompt`, so a query is only prefixed the way its documents were —
   an index built before this stays unprefixed until it is rebuilt. An unknown model gets no
   prompt rather than a guessed one.
8. A document longer than the model's context window would be indexed by its opening alone,
   with the rest invisible to semantic search while full-text still matches it. Documents past
   the budget are embedded in **overlapping windows**, each wrapped in the document prompt, and
   mean-pooled into one vector, so a long
   note stays one result and nothing downstream changes. The budget is measured in characters
   (`embeddinggemma`: 1800) because the tokenizer is not available locally; `--embed-chars`
   overrides it and the build reports `embedding_context_chars` and `documents_windowed`. A model
   with no known window is left unbounded.
9. An optional cross-encoder **reranker** reorders a shortlist before the result window is
   built, so relation promotion still decides retrievability on the order a reader sees. It is
   attached the way Ollama is — `--reranker-url` / `--reranker-model`, nothing installed, nothing
   required — speaks the Cohere/Jina `/v1/rerank` shape that llama.cpp and text-embeddings-
   inference both serve, and falls back to fused order with `rerank_error` set when the endpoint
   fails. Its ceiling is measurable in advance: reordering alone cannot beat
   `recall@50 − recall@10`. The one exception is relation promotion — a reranker that lifts a
   relation note into the top eight also appends its sides from any depth — so treat the number
   as the ceiling for the notes that are not participants of a relation.

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
KNOWLEDGE_ROOT=$PWD docker compose -f "${CLAUDE_PLUGIN_ROOT}/compose.yaml" run --rm knowledge-index
```

`KNOWLEDGE_ROOT` is required: compose refuses to start without it, because a relative default
would resolve against the compose file and mount the plugin cache instead of your project.

The image runs as `node` (uid 1000) and writes `.knowledge/` and `_graph/` into the mounted project,
so on Linux the project must be writable by uid 1000. Owned by another uid, the write fails
(`EACCES … mkdir '/workspace/.knowledge'`, or `attempt to write a readonly database`); run as the
owner instead:

```bash
KNOWLEDGE_ROOT=$PWD docker compose -f "${CLAUDE_PLUGIN_ROOT}/compose.yaml" run --rm --user "$(id -u):$(id -g)" knowledge-index
```

Checked with a project owned by uid 1001: refused as `node`, indexed with `--user 1001:1001`.

### Backends and pgvector

`index`, `search`, `get`, `neighbors` and `status` go through the backend a store names
(`storage.backend` in `_knowledge/config.json`, or `KNOWLEDGE_BACKEND`); sqlite is the only one
wired in this version. Search is a full scan, so its time grows with the store. `status` reports
`size` — documents, bytes including the WAL, the threshold, and `pgvector_advised`:

| Documents | 1k | 5k | 10k | 20k | 50k |
|---|---|---|---|---|---|
| search p95 | 25 ms | 97 ms | 187 ms | 384 ms | 1108 ms |
| database | 6 MB | 31 MB | 64 MB | 126 MB | 310 MB |

Measured 2026-11-19 on synthetic notes, hash provider (384 dimensions), 12-core CPU, 13 GB RAM, 30
queries per size. The budget is p95 under 400 ms, so pgvector is advised from **20,000 documents** or
**256 MB** (the byte limit catches larger embeddings); `storage.pgvector_threshold` changes either.

`migrate` copies a built sqlite store into PostgreSQL + pgvector, embeddings included, into tables
that mirror sqlite's (`kn_documents`, `kn_document_relations`, `kn_graph_nodes`, `kn_graph_edges`,
`kn_metadata`), replacing the workspace's rows in one transaction, and fails unless the row counts on
both sides match. Over 2000 dimensions the rows are copied but get no HNSW index.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/sqlite-knowledge.mjs" migrate --root . --workspace my-store \
  --psql "docker exec -i <pg-container> psql -U postgres"   # or PG* env and plain psql; --sql-out file.sql to only write the script
```

- v1.23.2 — Codex: the knowledge delta check runs on Codex `apply_patch` edits (`hooks/codex.json`, targets read from the patch); the Claude-only trophy startup hook no longer runs in Codex (it exited 127).
- v1.23.1 — hook commands quote the plugin root, so a path with a space (Orca: `~/Library/Application Support/...`) no longer fails with `Cannot find module` and leaves the gate off.
- v1.23.0 — the LLM graph build is incremental (only notes in the update queue go back to the model; `--full` for all); embeddings from any OpenAI-compatible endpoint (TEI, vLLM, OpenAI) with E5 prompts and windows; search stays lexical and says so when the query cannot be embedded; capture's Korean particles are one explicit list (`결제 승인서` no longer links to `결제 승인`); compose's index runs without `KNOWLEDGE_LLM_URL`; the uid rule for bind mounts and Codex approval of `knowledge_capture` are documented.
- v1.21.4 — skills gain their Process and Output Template sections (no behaviour change); references point at write:prd / write:adr after the write:plans split.
- v1.21.3 — Codex: MCP servers register under Codex (`.codex-plugin/plugin.json`, `${PLUGIN_ROOT}`); Claude reads them from plugin.json.

## Roadmap

[ROADMAP.md](ROADMAP.md) — what is measured, what is queued, and what is deliberately not being
done, ordered by measured lever size rather than by what is easiest to edit.

[docs/theory.md](docs/theory.md) — the papers and principles behind the rules (RRF, BM25, competency
questions, reusable holdout, leakage, cross-encoder reranking), and where this plugin departs from them.
Its §9 compares the engine against [Hindsight](https://github.com/vectorize-io/hindsight): the retrieval
layer matches point for point (and is stricter in three places), the write layer does not. Two gaps came
out of it — no time axis on a note, and no notion of a belief strengthening rather than being overwritten —
and both are parked, because the measured bottleneck is the generation layer's citation discipline, not
recall. The one live lever is §9.4: `questions.jsonl` is already "the question defined once", so a stored,
background-rewritten answer per competency question is a shorter path than the chatbot Phase 4 described.

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

- relation notes with per-side evidence (`base-builder`)
- competency questions as a hard completion gate (`validate-knowledge.mjs`)
- `user_terms` / `source_symbols` bridges so screen names reach mapper ids (`catalog.jsonl`)
- `eval` so retrieval changes are proven with `mrr`, not felt (`sqlite-index-builder`)

---

## Renames

- `knowledge:base-builder` — renamed from `knowledge:knowledge-base-builder`; the old name no longer resolves.
- `knowledge:graph-builder` — renamed from `knowledge:knowledge-graph-builder`; the old name no longer resolves.
- `knowledge:query` — renamed from `knowledge:knowledge-query`; the old name no longer resolves.
- `knowledge:workflow` — renamed from `knowledge:knowledge-workflow`; the old name no longer resolves.
