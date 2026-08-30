---
name: knowledge-query
effort: high
description: >-
  Use when answering questions over an existing linked Markdown vault, local
  SQLite index, ontology, knowledge graph, RAG corpus, or mixed knowledge
  assets while preserving citations, uncertainty, and retrieval traceability.
scenarios:
  - "이 knowledge base에서 답 찾아줘"
  - "vault랑 graph를 보고 영향 범위 알려줘"
  - "RAG chunks 기준으로 근거 달아서 답해줘"
  - "로컬 SQLite knowledge에서 찾아서 답해줘"
  - "Query this knowledge graph and cite the sources"
compatibility:
  recommended:
    - mcp__knowledge-local__knowledge_search
    - mcp__knowledge-local__knowledge_get
    - mcp__knowledge-local__knowledge_neighbors
  optional:
    - think-tool
  remote_mcp_note: >-
    knowledge-local MCP가 있으면 로컬 SQLite에서 하이브리드 검색과 그래프 조회를 수행합니다.
    think-tool은 질의 의도 분해와 불확실성 점검에 선택적으로 활용할 수 있습니다.
---

# Knowledge Query

Answer questions over existing knowledge assets: linked Markdown vaults, graph exports, RAG chunks, ontology files, source inventories, or a mixture of them.

## Standing Mandates

- **Search before reading.** Never open a note body with Read, Grep, or Glob until a retrieval step has named it as a candidate. The order is fixed: `knowledge_search` (or the CLI `search`) → `knowledge_get` on the top candidates → only then the Markdown file, and only when the returned text is insufficient.
- **The index exists to be used.** If `.knowledge/knowledge.sqlite` or the `knowledge-local` MCP is present, it is the retrieval surface. Scanning `notes/**/*.md` while an index exists is a defect in the answer, not a shortcut; it bypasses ranking, filters, relation promotion, and the diagnostics that tell you whether retrieval worked.
- **No index → catalog, not files.** Without an index, search `_knowledge/catalog.jsonl` first and open only the notes it nominates. Reading the vault directly is allowed only when neither an index nor a catalog exists, and the answer must say so.
- **Cite what retrieval returned.** Evidence lines name the `path` / `source_ref` from the search result, so the reader can see the note was found, not browsed into.
- **Thin results are diagnosed, not worked around.** When search looks empty, read `lexical_candidates` and re-query with exact vocabulary before touching a file. A grep-based detour hides a ranking bug that `eval` should catch.

## Query Routing

Choose the retrieval path from the asset shape and question type:

| Asset or question | Prefer |
|---|---|
| `.knowledge/knowledge.sqlite`, `knowledge-local` MCP | SQLite hybrid search first |
| `_knowledge/catalog.jsonl`, note IDs, aliases, tags, entities | Catalog-first candidate discovery |
| Obsidian-style Markdown notes, MOCs, backlinks | Linked-vault traversal |
| `ontology.md`, `ontology.yml`, controlled vocabularies | Ontology-aware term/class/relation lookup |
| `nodes` / `edges`, Cypher, RDF/Turtle, triples | Graph query or graph inspection |
| `chunks.jsonl`, retrieval metadata, eval queries | RAG-style chunk retrieval |
| "What is X?" with source-backed explanation | Vault or RAG |
| "What depends on X?" or "What is impacted by X?" | Graph first, then vault/RAG for evidence |
| "What should I read next?" | MOC and backlink traversal |

When assets are mixed, use graph/vault structure to find candidates and RAG chunks or source references to ground the final answer.

## Local SQLite Fast Path

When the `knowledge-local` MCP tools are connected, use them before scanning JSONL or note bodies manually:

1. Check index presence and freshness with `knowledge_status`.
2. Build or refresh with `knowledge_index` when missing or stale.
3. Retrieve candidates with `knowledge_search`; use `knowledge_get` for full evidence and `knowledge_neighbors` for relationship questions.
4. Check the retrieval diagnostics before trusting an empty-looking result. When `lexical_candidates` exceeds `lexical_matches_returned`, or the query used vault vocabulary and `retrieval` is `vector`, the terms exist in the corpus but lost the ranking; re-query with the exact title, alias, or source symbol before grading coverage.
5. For scoped questions ("every policy note in the goods domain"), use the `domain`, `docType`, `section`, and `pathPrefix` filters on `knowledge_search`, or the CLI `list` command, instead of dropping to SQL. `knowledge_status` reports which metadata keys are filterable.
6. Compose the answer yourself from the returned evidence and cite original `source_ref` or `path` values.

Read [references/local-sqlite.md](references/local-sqlite.md) for exact MCP routing, embedding modes, CLI, Docker operation, and failure handling. If the MCP server is unavailable, continue with the portable asset discovery below.

For a build, rebuild, refresh, or MD/JSONL-to-SQLite synchronization request whose primary outcome is the index itself, route to `knowledge:sqlite-index-builder`. Query-time refreshes may remain in this skill when they are only a prerequisite to answering the user's question.

## Default Asset Discovery

Do not ask where knowledge or RAG artifacts are if the repository or vault follows the default convention. Check these catalog locations before scanning note bodies:

1. `<vault>/_knowledge/catalog.jsonl`
2. `knowledge-base/_knowledge/catalog.jsonl`
3. `knowledge-system/_knowledge/catalog.jsonl`

Then check these RAG locations when chunk retrieval is needed:

1. `<vault>/_rag/chunks.jsonl`
2. `<vault>/_rag/sources.csv`
3. `knowledge-artifacts/rag/chunks.jsonl`
4. `knowledge-artifacts/rag/sources.csv`

Also check sibling default asset folders when present:

```text
<vault>/_ontology/
<vault>/_graph/
knowledge-artifacts/ontology/
knowledge-artifacts/graph/
```

Ask for location only after these default paths and obvious user-provided paths are absent.

## Quick Intake

For vague queries, ask what kind of answer the user wants before searching broadly:

- Are they asking for lookup, synthesis, impact analysis, reading path, or gap finding?
- Should the answer be short, evidence-heavy, or exploratory?

If the query is concrete, skip intake and answer from the available assets. If assets are missing, ask for location only after checking default paths.

## Process

1. **Identify available assets.** Check the local SQLite MCP index first, then locate `_knowledge/catalog.jsonl`, `index.md`, `vault-plan.md`, `mocs/`, note frontmatter, `ontology.md`, `ontology.yml`, `mapping.md`, `nodes.*`, `edges.*`, `schema.md`, `chunks.jsonl`, `sources.csv`, or `eval-queries.jsonl`.
2. **Restate the query intent.** Classify the request as lookup, synthesis, impact analysis, comparison, provenance check, reading path, or gap/open-question search.
3. **Select candidates and a query path.** When a catalog exists, search its titles, aliases, `user_terms`, `source_symbols`, tags, domains, entities, and summaries first, then open only the best-matching notes. Use links/MOCs for conceptual navigation, graph edges for relationship traversal, and RAG chunks for passage-level evidence. For comparison, equivalence, or sequence questions, prefer first-class relation notes and verify every participant's evidence instead of synthesizing from one-sided proximity.
4. **Trace evidence.** Preserve source references from note `Sources`, frontmatter `sources`, graph edge evidence, or chunk `source_ref`. Prefer direct evidence over inferred relationships.
5. **Answer with citations.** Cite the note, source path, chunk ID, node/edge record, or URL that supports each non-obvious claim.
6. **Assign coverage before composing.** Use `complete` only when direct evidence covers every material part. Use `partial` when the answer needs material inference or has missing, stale, or conflicting parts. Use `unanswerable` when the assets cannot establish the answer. Never upgrade coverage because nearby notes make a plausible story.
7. **Surface missing knowledge.** For `partial` or `unanswerable`, name the missing relation note, participant, source anchor, vocabulary bridge, or freshness evidence needed to resolve the question.
8. **Record failures only when authorized.** Ordinary queries are read-only. Return an `Improvement candidate` block for partial or unanswerable results. Append it to `_knowledge/improvement-notes.md` or update `_knowledge/question-results.jsonl` only when the user requested vault maintenance, the current build is running the competency gate, or the vault plan explicitly opts into query-failure logging.
9. **Suggest follow-up queries only when useful.** Offer targeted next questions when they would materially improve the user's investigation.

## Output Shape

For ordinary answers, always begin with the coverage grade:

```markdown
Coverage: complete | partial | unanswerable

Answer in 2-5 concise paragraphs.

Evidence:
- `knowledge-base/path/Note.md` -> source or claim used
- `chunks.jsonl#chunk-id` -> source_ref

Uncertainty:
- Any missing, stale, inferred, or conflicting evidence.

Missing knowledge:                    # required for partial/unanswerable
- Needed relation note, participant, anchor, bridge, or source.

Improvement candidate:               # return; write only when authorized
- Question, observed failure, required evidence, and next extraction action.
```

For impact analysis:

```markdown
## Direct Impact
- Affected entity or note, with edge/link/source evidence.

## Indirect Impact
- Second-order dependencies, clearly labeled as inferred when appropriate.

## Unknowns
- Missing relationships, stale sources, or sources not indexed.
```

## Quality Bar

- Answers are grounded in the knowledge asset, not general memory, unless explicitly labeled as outside context.
- SQLite retrieval cites canonical Markdown/JSONL provenance rather than the derived database file.
- A thin SQLite result set is diagnosed against `lexical_candidates` and `embedding_quality` before it is reported as missing knowledge.
- Catalog-backed queries narrow candidates before opening note bodies and preserve stable note IDs when paths change.
- Relationship-heavy questions inspect graph edges or note links before giving a narrative answer.
- Comparison, equivalence, and sequence answers verify evidence for every participant; a one-sided relation is not presented as complete.
- Citations point to stable note paths, source refs, chunk IDs, or graph records.
- Conflicts and stale-risk evidence are visible.
- Every answer declares `complete`, `partial`, or `unanswerable` coverage using the strict meanings above.
- If the knowledge asset cannot answer the question, say exactly what is missing and which source would likely resolve it; do not fill the gap with an unlabeled inference.
- Read-only queries do not mutate improvement memory or competency results without maintenance authorization or an explicit vault opt-in.
- No Markdown note is opened before a search or catalog step nominated it; when a file is read, the answer states which search result led there.

## Related Skills

- `knowledge:sqlite-index-builder` - build or refresh the derived SQLite index from canonical Markdown and JSONL.
- `knowledge:knowledge-base-builder` - use to create or reshape the linked Markdown vault before querying.
- `knowledge:ontology-builder` - use to define class/relation semantics and controlled vocabularies before querying or extraction.
- `knowledge:knowledge-graph-builder` - use to create graph-ready entities and relationships before graph queries.
- `knowledge:rag-corpus-builder` - use to prepare retrieval chunks and evals before RAG-style querying.
