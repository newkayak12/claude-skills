---
name: knowledge-workflow
description: >-
  Use when turning a body of source material into a queryable knowledge system
  through iterative graph-like exploration: intake, source frontier, linked
  Markdown vault, ontology, graph records, RAG corpus, and query surfaces.
type: workflow
scenarios:
  - "자료들을 그래프 탐색하듯 읽고 지식화해줘"
  - "이 레포/문서 묶음을 knowledge system으로 쭉 빌드해줘"
  - "자료 바탕으로 knowledge base, ontology, graph, RAG까지 정리해줘"
  - "knowledge-workflow 설치하면 자동으로 지식 변경을 체크하게 해줘"
  - "Build a queryable knowledge system from this corpus"
compatibility:
  optional:
    - think-tool
  remote_mcp_note: >-
    think-tool이 있으면 source frontier, 개념 경계, ontology 후보, 관계 탐색 순서를 점검하는 데 활용할 수 있습니다.
---

# Knowledge Workflow

Build a source-grounded knowledge system by exploring the material like a graph: start from seed sources, discover neighboring concepts and dependencies, write linked notes, stabilize ontology terms, extract graph/RAG artifacts, and leave queryable entry points.

Use this workflow when the user wants "knowledge화" end to end rather than a single artifact.

## Quick Intake

Ask a short intake before starting unless the request already answers it:

- What is this material? codebase, docs, notes, tickets, research, mixed?
- What should the knowledge system help with? onboarding, architecture navigation, impact analysis, research synthesis, operations, support, compliance?
- Who is the main reader or querier?

If the user answers roughly, proceed with defaults and record assumptions in `knowledge-system-plan.md`.

## Default Layout

Use this layout unless the user gives a path:

```text
knowledge-system/
  knowledge-system-plan.md
  index.md
  vault-plan.md
  mocs/
  notes/
  glossary.md
  open-questions.md
  _ontology/
    ontology.md
    ontology.yml
    mapping.md
    competency-questions.md
    open-ontology-questions.md
  _graph/
    schema.md
    nodes.jsonl
    edges.jsonl
    extraction-report.md
  _rag/
    rag-schema.md
    sources.csv
    chunks.jsonl
    eval-queries.jsonl
    ingestion-report.md
  _knowledge/
    catalog.jsonl
    coverage.md
    improvement-notes.md
    checks/latest.json
    jobs/catalog-delta-queue.jsonl
    jobs/embed-queue.jsonl
    jobs/graph-update-queue.jsonl
    jobs/ontology-review-queue.jsonl
    reports/delta-checks.jsonl
  .knowledge/
    knowledge.sqlite          # local derived index; do not commit
```

If an existing vault is present, build inside it and use `_ontology/`, `_graph/`, and `_rag/` as sibling artifact folders.

## Exploration Model

Treat source work as a bounded graph traversal:

1. **Seeds:** Start from user-specified sources, root docs, READMEs, indexes, entry points, manifests, architecture docs, or high-signal tickets.
2. **Frontier:** Track discovered but not yet processed sources, concepts, entities, decisions, workflows, and relationship candidates.
3. **Expansion rule:** Follow links, imports, references, repeated terms, ownership markers, config dependencies, API boundaries, and explicit "see also" pointers.
4. **Stop rule:** Stop expanding when new sources only repeat known concepts, fall outside scope, or no longer improve the motivating questions.
5. **Evidence rule:** Every durable note, ontology term, graph edge, and RAG chunk keeps provenance.

Do not crawl endlessly. Prefer a useful, inspectable knowledge system over exhaustive ingestion with weak structure.

## Workflow

1. **Plan the system.** Create `knowledge-system-plan.md` with purpose, audience, source boundary, output layout, traversal seeds, stop rules, and assumptions.
2. **Map the source frontier.** Build a small inventory of seed sources and discovered neighbors. Mark each item as `queued`, `processed`, `skipped`, or `out-of-scope`.
3. **Build the linked vault.** Use `knowledge:knowledge-base-builder` behavior for predictable folder placement, human-readable notes, MOCs, source-grounded frontmatter, and the AI lookup catalog.
4. **Stabilize ontology where needed.** Use `knowledge:ontology-builder` behavior when repeated concepts, aliases, relation meanings, or constraints start to matter.
5. **Extract graph records.** Use `knowledge:knowledge-graph-builder` behavior for entities, edges, evidence, schema, and graph-ready JSONL/CSV.
6. **Prepare RAG corpus.** Use `knowledge:rag-corpus-builder` behavior to derive retrieval chunks, metadata, citations, and eval queries from the vault and its catalog without replacing the source-grounded notes.
7. **Create query surfaces.** Use `knowledge:knowledge-query` behavior to leave recommended queries, reading paths, known gaps, and evidence-backed answer patterns. When the local `knowledge-local` MCP server is available, build its derived SQLite index and verify at least one retrieval query.
8. **Run a quality pass.** Check dead links, orphan notes, duplicate concepts, weak ontology terms, unsupported graph edges, RAG chunks without provenance, and unanswered competency questions.

## Hook-First Automation

When the `knowledge` plugin is installed, its lightweight `PostToolUse` hook can watch ordinary Markdown edits and keep the knowledge system fresh without requiring a separate user direction.

The hook is intentionally a checker, not a builder:

- It activates only inside an existing knowledge workspace, detected by `knowledge-system-plan.md`, `_rag/`, `_graph/`, `_ontology/`, `_knowledge/`, or a `knowledge-system/` directory.
- It inspects changed Markdown files after `Write`, `Edit`, `MultiEdit`, or `NotebookEdit`.
- It records the latest check at `_knowledge/checks/latest.json` and appends history to `_knowledge/reports/delta-checks.jsonl`.
- **Beta:** When `_knowledge/catalog.jsonl` exists, the hook queues one `upsert-note` record per changed note in `_knowledge/jobs/catalog-delta-queue.jsonl`. Consumers should update only that note's catalog record and may coalesce repeated entries for the same path; they should not interpret the queue as a request for a full vault reindex.
- The beta delta queue covers Markdown writes and edits observed by the hook. Deletions or moves performed outside those tools still require explicit catalog reconciliation.
- It also queues follow-up work in `_knowledge/jobs/embed-queue.jsonl`, `_knowledge/jobs/graph-update-queue.jsonl`, and `_knowledge/jobs/ontology-review-queue.jsonl` when existing RAG, graph, or ontology artifacts look stale.
- It fails open and never blocks edits. Missing config, unreadable files, bad JSON, unsupported tools, or non-knowledge projects should produce no interruption.

Use the queued jobs as portable handoff files. Embedding providers, vector databases, graph stores, or full rebuild scripts may consume them later, but the canonical knowledge artifacts remain the linked vault plus `_rag/`, `_graph/`, `_ontology/`, and `_knowledge/`.

The bundled `knowledge-local` MCP server is one such consumer. It rebuilds `.knowledge/knowledge.sqlite` from the portable artifacts and exposes hybrid search, record lookup, graph-neighbor queries, and freshness status. Keep the database out of Git; synchronize the canonical Markdown and JSONL instead.

## Prioritization

When time or scope is limited, build in this order:

1. `knowledge-system-plan.md`
2. `index.md`, high-value MOCs, and atomic notes
3. `glossary.md` and `open-questions.md`
4. `_ontology/ontology.md` for repeated terms and relation semantics
5. `_graph/nodes.jsonl` and `_graph/edges.jsonl` for important relationships
6. `_rag/chunks.jsonl`, `_rag/sources.csv`, and `_rag/eval-queries.jsonl`

## Quality Bar

- The output can be entered from `index.md` and queried through `_graph/` or `_rag/` artifacts.
- The traversal frontier explains what was explored, skipped, or left open.
- Notes, ontology terms, graph records, and RAG chunks share stable names and provenance.
- `_knowledge/catalog.jsonl` resolves stable note IDs to current paths and supports fast lookup before graph or RAG traversal.
- The system improves as a graph: following links or edges reveals useful neighboring knowledge.
- Uncertainty is explicit; missing sources and weak inferences are not hidden.

## Related Skills

- `knowledge:knowledge-base-builder` - linked Markdown vault layer.
- `knowledge:ontology-builder` - semantic class/relation/constraint layer.
- `knowledge:knowledge-graph-builder` - graph-ready entity and edge layer.
- `knowledge:rag-corpus-builder` - retrieval corpus layer.
- `knowledge:knowledge-query` - query and answer layer.
