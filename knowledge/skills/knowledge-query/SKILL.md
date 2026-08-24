---
name: knowledge-query
description: >-
  Use when answering questions over an existing linked Markdown vault,
  ontology, knowledge graph, RAG corpus, source inventory, or mixed knowledge
  assets while preserving citations, uncertainty, and retrieval/query
  traceability.
scenarios:
  - "이 knowledge base에서 답 찾아줘"
  - "vault랑 graph를 보고 영향 범위 알려줘"
  - "RAG chunks 기준으로 근거 달아서 답해줘"
  - "Query this knowledge graph and cite the sources"
compatibility:
  optional:
    - think-tool
  remote_mcp_note: >-
    think-tool이 있으면 질의 의도 분해, graph/RAG/linked vault 경로 선택, 불확실성 점검에 활용할 수 있습니다.
---

# Knowledge Query

Answer questions over existing knowledge assets: linked Markdown vaults, graph exports, RAG chunks, ontology files, source inventories, or a mixture of them.

## Query Routing

Choose the retrieval path from the asset shape and question type:

| Asset or question | Prefer |
|---|---|
| Obsidian-style Markdown notes, MOCs, backlinks | Linked-vault traversal |
| `ontology.md`, `ontology.yml`, controlled vocabularies | Ontology-aware term/class/relation lookup |
| `nodes` / `edges`, Cypher, RDF/Turtle, triples | Graph query or graph inspection |
| `chunks.jsonl`, retrieval metadata, eval queries | RAG-style chunk retrieval |
| "What is X?" with source-backed explanation | Vault or RAG |
| "What depends on X?" or "What is impacted by X?" | Graph first, then vault/RAG for evidence |
| "What should I read next?" | MOC and backlink traversal |

When assets are mixed, use graph/vault structure to find candidates and RAG chunks or source references to ground the final answer.

## Process

1. **Identify available assets.** Locate `index.md`, `vault-plan.md`, `mocs/`, note frontmatter, `ontology.md`, `ontology.yml`, `mapping.md`, `nodes.*`, `edges.*`, `schema.md`, `chunks.jsonl`, `sources.csv`, or `eval-queries.jsonl`.
2. **Restate the query intent.** Classify the request as lookup, synthesis, impact analysis, comparison, provenance check, reading path, or gap/open-question search.
3. **Select a query path.** Use links/MOCs for conceptual navigation, graph edges for relationship traversal, and RAG chunks for passage-level evidence.
4. **Trace evidence.** Preserve source references from note `Sources`, frontmatter `sources`, graph edge evidence, or chunk `source_ref`. Prefer direct evidence over inferred relationships.
5. **Answer with citations.** Cite the note, source path, chunk ID, node/edge record, or URL that supports each non-obvious claim.
6. **Surface uncertainty.** Mark missing evidence, stale-risk sources, conflicting claims, and assumptions instead of smoothing them over.
7. **Suggest follow-up queries only when useful.** Offer targeted next questions when they would materially improve the user's investigation.

## Output Shape

For ordinary answers:

```markdown
Answer in 2-5 concise paragraphs.

Evidence:
- `knowledge-base/path/Note.md` -> source or claim used
- `chunks.jsonl#chunk-id` -> source_ref

Uncertainty:
- Any missing, stale, inferred, or conflicting evidence.
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
- Relationship-heavy questions inspect graph edges or note links before giving a narrative answer.
- Citations point to stable note paths, source refs, chunk IDs, or graph records.
- Conflicts and stale-risk evidence are visible.
- If the knowledge asset cannot answer the question, say what is missing and which source would likely resolve it.

## Related Skills

- `knowledge:knowledge-base-builder` - use to create or reshape the linked Markdown vault before querying.
- `knowledge:ontology-builder` - use to define class/relation semantics and controlled vocabularies before querying or extraction.
- `knowledge:knowledge-graph-builder` - use to create graph-ready entities and relationships before graph queries.
- `knowledge:rag-corpus-builder` - use to prepare retrieval chunks and evals before RAG-style querying.
