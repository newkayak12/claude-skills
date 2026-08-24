---
name: knowledge-graph-builder
description: >-
  Use when building knowledge graphs by extracting source-grounded entities,
  relationships, properties, evidence, schema, and graph-ready data from code,
  documents, notes, tickets, or mixed corpora.
scenarios:
  - "문서랑 코드에서 지식그래프 만들어줘"
  - "이 자료를 엔티티/관계 중심으로 구조화해줘"
  - "knowledge graph schema랑 triples 뽑아줘"
  - "Build a graph-ready entity and relationship model from these docs"
compatibility:
  optional:
    - think-tool
  remote_mcp_note: >-
    think-tool이 있으면 엔티티 경계, 관계 타입, 온톨로지 후보를 더 일관되게 검토하는 데 활용할 수 있습니다.
---

# Knowledge Graph Builder

Build a source-grounded knowledge graph from documents, code, notes, tickets, chat logs, or other mixed material.

For long-lived or cross-domain graphs, use `knowledge:ontology-builder` first or create a small ontology section before extraction. The ontology should define allowed node classes, relationship semantics, properties, constraints, and controlled vocabularies.

Use a knowledge graph when relationships matter as first-class data: `Service DEPENDS_ON Database`, `Decision SUPERSEDES Decision`, `Person OWNS System`, `API RETURNS Entity`, or `Term ALIAS_OF Term`.

## Process

1. **Define graph purpose.** Identify the expected questions the graph should answer: impact analysis, onboarding, compliance traceability, research synthesis, product taxonomy, code architecture, or support knowledge. Ask only when the graph boundary or audience materially changes the schema.
2. **Inventory source material.** Read representative sources before designing the schema. Capture source paths, URLs, document titles, dates, and other provenance needed to verify extracted facts.
3. **Draft or reuse the ontology/schema.** Define node labels/classes, relationship types, key properties, uniqueness rules, evidence fields, and constraints. Keep the schema small enough to use; add labels only when they change query behavior or governance.
4. **Extract candidates.** Pull entities, aliases, attributes, relationships, temporal qualifiers, and source evidence. Prefer explicit statements over inference. Mark inferred edges with `confidence` and `inference_reason`.
5. **Normalize names.** Canonicalize duplicates, aliases, acronyms, file paths, product names, people, teams, services, database objects, and domain terms. Preserve source wording as aliases when useful.
6. **Validate relationships.** Check direction, cardinality, relation semantics, and evidence. Avoid vague edges such as `RELATED_TO` unless the user explicitly wants a loose exploration graph.
7. **Emit graph-ready artifacts.** Produce a schema plus machine-usable data such as CSV, JSONL, Cypher, RDF/Turtle, or Markdown tables, depending on the user's storage target.
8. **Check graph quality.** Look for orphan nodes, duplicate canonical entities, unsupported claims, ambiguous edge types, overbroad labels, missing provenance, and extraction drift across sources.

## Schema Shape

Start with this minimal structure and adapt it to the corpus:

```yaml
nodes:
  EntityLabel:
    unique_key: canonical_name
    properties:
      - canonical_name
      - aliases
      - description
      - source_refs
relationships:
  RELATIONSHIP_TYPE:
    from: SourceLabel
    to: TargetLabel
    properties:
      - evidence
      - confidence
      - source_refs
      - valid_from
      - valid_to
```

Good relationship names are specific and directional:

| Weak | Better |
|---|---|
| `RELATED_TO` | `DEPENDS_ON`, `IMPLEMENTS`, `MENTIONS`, `OWNS`, `SUPERSEDES` |
| `USES` for everything | `CALLS`, `QUERIES`, `IMPORTS`, `CONFIGURES`, `AUTHENTICATES_WITH` |
| `HAS` | `HAS_FIELD`, `HAS_POLICY`, `HAS_DECISION`, `HAS_STATUS` |

## Output Options

Choose the smallest useful output unless the user requested a specific graph database.

| Artifact | Purpose |
|---|---|
| `schema.md` | Human-readable labels, relationships, properties, and modeling decisions |
| `nodes.csv` / `edges.csv` | Portable graph import format |
| `nodes.jsonl` / `edges.jsonl` | Richer nested properties and evidence fields |
| `graph.cypher` | Neo4j-ready constraints and merge statements |
| `graph.ttl` | RDF/Turtle output for semantic-web tooling |
| `extraction-report.md` | Coverage, assumptions, conflicts, and open questions |

For exploratory work, Markdown tables are acceptable. For implementation work, prefer CSV/JSONL plus a concise schema.

## Evidence Rules

- Every non-obvious node or edge should include at least one `source_ref`.
- Preserve exact repository paths, document names, URLs, or ticket IDs in source references.
- Use short evidence snippets only when they clarify why an edge exists; do not copy large source passages.
- Separate direct evidence from inference. Inferred edges require `confidence` and `inference_reason`.
- When sources disagree, keep both claims with provenance instead of silently choosing one.
- Include temporal fields when facts can change, such as ownership, status, dependencies, prices, policy, or team structure.

## Quality Bar

- The graph can answer the motivating questions without returning mostly generic `RELATED_TO` edges.
- Node labels are stable domain concepts, not one-off document section names.
- Relationship direction is consistent and queryable.
- Canonical entities preserve useful aliases and source terminology.
- Unsupported claims are removed or marked as inference.
- The output can be imported, queried, or manually reviewed without re-reading the entire source corpus.

## Related Skills

- `knowledge:knowledge-base-builder` - use when the output should be an Obsidian-style linked Markdown vault.
- `knowledge:ontology-builder` - use when class hierarchy, relationship semantics, constraints, or controlled vocabularies need to be designed before graph extraction.
- `knowledge:rag-corpus-builder` - use when the goal is retrieval-ready chunks, metadata, citations, and evaluation queries.
- `knowledge:knowledge-query` - use when querying an existing graph, vault, RAG corpus, or mixed knowledge asset.
- `develop:documentation-strategy` - use when the main task is planning a documentation system rather than extracting graph data.
- `develop:architecture-designer` - use when the task is designing system architecture, not modeling extracted knowledge.
