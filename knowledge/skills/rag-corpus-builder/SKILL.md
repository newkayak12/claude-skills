---
name: rag-corpus-builder
description: >-
  Use when preparing a retrieval-augmented generation corpus from code,
  documents, notes, tickets, or mixed sources by chunking, adding metadata,
  preserving citations, and designing retrieval/evaluation checks.
scenarios:
  - "이 자료를 RAG용 corpus로 정리해줘"
  - "문서 chunking이랑 metadata schema 잡아줘"
  - "RAG 인덱싱 전에 source-grounded dataset 만들어줘"
  - "Prepare these docs for retrieval-augmented generation"
compatibility:
  optional:
    - think-tool
  remote_mcp_note: >-
    think-tool이 있으면 chunk 경계, metadata 설계, retrieval 평가 질문을 더 일관되게 검토하는 데 활용할 수 있습니다.
---

# RAG Corpus Builder

Prepare source material for retrieval-augmented generation. This skill produces retrieval-ready chunks, metadata, citations, and evaluation queries; it does not build a linked Markdown vault or a first-class entity graph.

## Boundaries

| Goal | Use |
|---|---|
| Browse knowledge as Markdown notes with backlinks | `knowledge:knowledge-base-builder` |
| Model entities and relationships as graph data | `knowledge:knowledge-graph-builder` |
| Standardize classes, relation meanings, and controlled vocabularies | `knowledge:ontology-builder` |
| Retrieve cited chunks for generation | This skill |

Prefer this skill when chunk quality, metadata, citation fidelity, and retrieval evaluation matter more than human browsing structure.

## Process

1. **Define retrieval jobs.** Identify the questions users will ask, the answer style expected, and whether retrieval needs exact citations, semantic recall, keyword precision, freshness, or permission filtering.
2. **Inventory sources.** Capture source paths, URLs, document titles, dates, owners, versions, and any access constraints. Do not lose provenance during preprocessing.
3. **Choose chunk boundaries.** Chunk by semantic units first: headings, API endpoints, functions/classes, decisions, runbook steps, tickets, or policy clauses. Avoid fixed-size splitting unless the source lacks structure.
4. **Design metadata.** Include fields that retrieval or filtering will actually use: `source_ref`, `title`, `section`, `doc_type`, `domain`, `owner`, `last_updated`, `version`, `permissions`, `canonical_url`, and stable IDs. Reuse ontology-controlled values when an ontology exists.
5. **Preserve citations.** Each chunk should be traceable back to the exact source region. Use line ranges, heading paths, page numbers, ticket IDs, or URLs where available.
6. **Handle duplicates and conflicts.** Keep canonical chunks for repeated content, preserve aliases, and mark conflicting or stale sources rather than blending them into one unsupported statement.
7. **Create eval queries.** Add representative retrieval tests: direct lookup, synonym lookup, multi-document synthesis, freshness-sensitive questions, and negative queries that should not retrieve irrelevant content.
8. **Emit importable artifacts.** Produce JSONL, CSV, Markdown tables, or an ingestion manifest depending on the user's target system.

## Chunk Record Shape

Use this as a default unless the target vector store or pipeline has a required schema:

```json
{
  "id": "stable-chunk-id",
  "text": "retrieval text",
  "source_ref": "path/or/url#section",
  "title": "Document or section title",
  "doc_type": "runbook|api|decision|code|ticket|note",
  "domain": "billing",
  "metadata": {
    "owner": "team-name",
    "last_updated": "YYYY-MM-DD",
    "version": "v1",
    "permissions": ["internal"]
  }
}
```

## Output Options

| Artifact | Purpose |
|---|---|
| `rag-schema.md` | Chunk, metadata, citation, and filtering decisions |
| `chunks.jsonl` | Importable retrieval records |
| `sources.csv` | Source inventory and freshness/provenance tracking |
| `eval-queries.jsonl` | Questions with expected relevant chunks or rejection criteria |
| `ingestion-report.md` | Coverage, skipped sources, conflicts, and open questions |

## Quality Bar

- Every chunk has stable provenance and enough context to stand alone in retrieval.
- Chunk boundaries follow source meaning instead of arbitrary token windows where structure exists.
- Metadata supports real filtering or ranking use cases; unused decorative fields are omitted.
- Retrieval evals include positive, synonym, synthesis, freshness, and negative cases.
- Stale, conflicting, or permission-limited sources are visible in the output.

## Related Skills

- `knowledge:knowledge-base-builder` - use for Obsidian-style linked Markdown notes.
- `knowledge:ontology-builder` - use when metadata values, domain terms, or entity classes need shared semantic control.
- `knowledge:knowledge-graph-builder` - use for entity/relationship schema and graph-ready data.
- `knowledge:knowledge-query` - use when querying an existing RAG corpus, vault, graph, or mixed knowledge asset.
- `develop:documentation-strategy` - use when the source corpus itself needs a maintenance strategy before indexing.
