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

## Quick Intake

Before chunking, ask a lightweight "what is this?" intake when the retrieval job is not already clear:

- What kind of material is this? codebase docs, policies, tickets, support docs, research, mixed?
- What questions should retrieval answer well?
- Does retrieval need exact citations, freshness, permissions, or domain filtering?

If the user gives only a rough answer, proceed with the default portable layout and capture assumptions in `rag-schema.md` and `ingestion-report.md`. Do not ask for a vector database unless the user wants deployment-specific indexing.

## Default Placement

Proceed without asking for a separate output direction when the corpus boundary is clear.

Use this convention unless the user gives a target path or vector store:

| Existing context | Default output |
|---|---|
| Linked Markdown vault exists | `<vault>/_rag/` |
| No vault, but source set is clear | `knowledge-artifacts/rag/` |
| Target system is specified | Still write portable artifacts first, then add target-specific ingest notes |

Default portable layout:

```text
_rag/
  rag-schema.md
  sources.csv
  chunks.jsonl
  eval-queries.jsonl
  ingestion-report.md
```

Treat `chunks.jsonl` plus `sources.csv` as the canonical RAG corpus. Vector databases are downstream indexes, not the source of truth, unless the user explicitly says otherwise.

## Process

1. **Define retrieval jobs.** Identify the questions users will ask, the answer style expected, and whether retrieval needs exact citations, semantic recall, keyword precision, freshness, or permission filtering.
2. **Inventory sources.** Capture source paths, URLs, document titles, dates, owners, versions, and any access constraints. When a knowledge vault includes `_knowledge/catalog.jsonl`, use it to resolve stable note IDs, current paths, aliases, tags, domains, entities, and source references; do not treat catalog summaries as a substitute for note content.
3. **Choose chunk boundaries.** Chunk by semantic units first: headings, API endpoints, functions/classes, decisions, runbook steps, tickets, or policy clauses. Avoid fixed-size splitting unless the source lacks structure.
4. **Design metadata.** Include fields that retrieval or filtering will actually use: `source_ref`, `note_id`, `title`, `section`, `doc_type`, `domain`, `tags`, `aliases`, `user_terms`, `source_symbols`, `entities`, `confidence`, `owner`, `last_updated`, `version`, `permissions`, `canonical_url`, and stable IDs. Keep same-referent aliases separate from cross-layer vocabulary bridges. Inherit consistent catalog/frontmatter values when present and reuse ontology-controlled values when an ontology exists.
5. **Preserve identity and citations.** Derive stable chunk IDs from a stable note/source ID plus a durable heading or block anchor where possible. Each chunk should be traceable back to the exact source region using heading paths, line ranges, page numbers, ticket IDs, or URLs where available.
6. **Handle duplicates and conflicts.** Keep canonical chunks for repeated content, preserve aliases, and mark conflicting or stale sources rather than blending them into one unsupported statement.
7. **Create eval queries.** Reuse stable question IDs from `_knowledge/questions.jsonl` when present. Add retrieval tests for direct lookup, synonym/operator-language lookup, source-symbol lookup, comparison, multi-document synthesis, freshness-sensitive questions, and negative queries that should not retrieve irrelevant content. Keep retrieval relevance results distinct from `_knowledge/question-results.jsonl`, which grades whether retrieved evidence can establish the answer.
8. **Emit importable artifacts.** Produce the default portable layout unless the user requested a specific target. If a vector store is requested, keep the portable artifacts and add an ingestion note for that store.

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

Optional downstream index notes can be added as `ingest-pgvector.md`, `ingest-qdrant.md`, `ingest-lancedb.md`, or another target-specific file when the user names a store. Do not make the target store the only artifact.

## Quality Bar

- Every chunk has stable provenance and enough context to stand alone in retrieval.
- The corpus has a predictable location without requiring a separate user instruction.
- `chunks.jsonl` and `sources.csv` remain the portable source of truth even when an index is generated later.
- Chunk boundaries follow source meaning instead of arbitrary token windows where structure exists.
- Metadata supports real filtering or ranking use cases; unused decorative fields are omitted.
- Retrieval evals include positive, synonym, synthesis, freshness, and negative cases.
- Cross-layer evals exercise both user-facing terms and implementation symbols without treating them as aliases of the same referent.
- Retrieval success is not reported as answerability success; competency results still require complete evidence coverage.
- Stale, conflicting, or permission-limited sources are visible in the output.

## Related Skills

- `knowledge:knowledge-base-builder` - use for Obsidian-style linked Markdown notes.
- `knowledge:ontology-builder` - use when metadata values, domain terms, or entity classes need shared semantic control.
- `knowledge:knowledge-graph-builder` - use for entity/relationship schema and graph-ready data.
- `knowledge:knowledge-query` - use when querying an existing RAG corpus, vault, graph, or mixed knowledge asset.
- `develop:documentation-strategy` - use when the source corpus itself needs a maintenance strategy before indexing.
