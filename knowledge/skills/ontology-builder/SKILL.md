---
name: ontology-builder
description: >-
  Use when designing or refining an ontology for a knowledge system: domain
  concepts, classes, relationship semantics, constraints, controlled
  vocabularies, reasoning rules, and mappings to graph/RAG/vault artifacts.
scenarios:
  - "이 도메인 ontology 설계해줘"
  - "knowledge graph 만들기 전에 class랑 relation taxonomy 잡아줘"
  - "RAG랑 graph가 공유할 controlled vocabulary 만들어줘"
  - "Design an ontology for this knowledge base"
compatibility:
  optional:
    - think-tool
  remote_mcp_note: >-
    think-tool이 있으면 개념 경계, 상하위 관계, relation semantics, 추론 규칙의 충돌을 점검하는 데 활용할 수 있습니다.
---

# Ontology Builder

Design the semantic layer that keeps a knowledge base, graph, and RAG corpus consistent over time.

Use this skill when the problem is not just extracting notes, chunks, or edges, but deciding what kinds of things exist in the domain, how they relate, and what constraints make the model coherent.

## Layer Boundary

| Layer | Main question | Related skill |
|---|---|---|
| Linked Markdown vault | What should humans read and navigate? | `knowledge:knowledge-base-builder` |
| RAG corpus | What should retrieval index and cite? | `knowledge:rag-corpus-builder` |
| Knowledge graph | What entities and edges exist? | `knowledge:knowledge-graph-builder` |
| Ontology | What classes, relations, constraints, and meanings are valid? | This skill |
| Query | How do we answer from the available assets? | `knowledge:knowledge-query` |

Ontology should guide graph extraction and metadata design, but it should not become an abstract taxonomy detached from the user's actual sources and questions.

## Quick Intake

Before designing the ontology, ask a lightweight "what is this?" intake unless the domain and use case are already explicit:

- What domain does this ontology model?
- What decisions or queries should it make more reliable?
- Is the ontology for a local project, a team-wide knowledge system, or a reusable domain model?

If the user gives only a rough answer, start with competency questions and a provisional ontology. Keep unresolved term boundaries in `open-ontology-questions.md` instead of blocking.

## Process

1. **Define competency questions.** Write the concrete questions the ontology must support, such as comparison, impact analysis, lineage, ownership, compliance evidence, concept disambiguation, or support answer grounding. When a vault already has `_knowledge/questions.jsonl`, reuse its stable question IDs instead of creating a disconnected second question set.
2. **Collect domain terms.** Extract candidate concepts, aliases, entity types, relationship verbs, properties, statuses, and source vocabularies from representative material.
3. **Separate classes from instances.** `Service`, `Decision`, and `Policy` are classes; `Billing API`, `ADR-004`, and `Refund Policy v2` are instances.
4. **Design class hierarchy.** Keep inheritance shallow. Add subclasses only when they change constraints, relationships, metadata, retrieval filtering, or query behavior.
5. **Define relationship semantics.** Name relationships directionally and specify allowed source/target classes, cardinality, inverse relation when useful, whether the relation is symmetric, temporal behavior, and examples. Include first-class contrast, equivalence, or sequence semantics when competency questions depend on them.
6. **Define properties and controlled vocabularies.** Specify required/optional fields, allowed values, aliases, normalization rules, and provenance fields.
7. **Add constraints and reasoning rules.** Capture rules such as "every ProductionService must have an owner", "`SUPERSEDES` implies temporal ordering", or "`DEPENDS_ON` is transitive only for impact analysis, not ownership."
8. **Map to assets.** Explain how ontology classes map to Markdown frontmatter, graph node labels, relationship types, RAG metadata fields, and query filters.
9. **Validate against sources.** Test the ontology on real examples and revise vague classes, overloaded relationships, duplicate terms, and unsupported abstractions.

## Output Shape

Produce the smallest useful ontology package:

| Artifact | Purpose |
|---|---|
| `ontology.md` | Human-readable classes, relationships, properties, constraints, examples |
| `ontology.yml` | Machine-readable class/relation/property definitions when useful |
| `mapping.md` | Mapping to vault frontmatter, graph labels/edges, and RAG metadata |
| `competency-questions.md` | Human-readable ontology view of the canonical `_knowledge/questions.jsonl` requirements, preserving question IDs |
| `open-ontology-questions.md` | Ambiguous terms, disputed meanings, and unresolved modeling choices |

## Definition Template

Use this compact shape for each important class or relation:

```markdown
## Class: Service

Definition: Deployable software component that provides runtime behavior.

Examples:
- Billing API
- Notification Worker

Properties:
- `canonical_name` required
- `owner` required for production services
- `lifecycle_status` in `planned|active|deprecated|retired`

Relationships:
- `DEPENDS_ON` -> `Service|Database|ExternalSystem`
- `OWNED_BY` -> `Team`

Evidence:
- Source paths, docs, tickets, or examples that justify the definition.
```

```markdown
## Relationship: DEPENDS_ON

Meaning: Source entity requires target entity for normal operation.

Direction: dependent -> dependency

Allowed:
- `Service DEPENDS_ON Service`
- `Service DEPENDS_ON Database`
- `Workflow DEPENDS_ON Service`

Constraints:
- Include `dependency_type` when known.
- Include `confidence` and `source_refs`.
- Transitive for impact analysis; not transitive for ownership or responsibility.
- Directional; a reverse edge is not required unless a materialized inverse is declared.
```

## Quality Bar

- Competency questions are explicit, preserve canonical question IDs, and have been exercised against real examples rather than judged only from schema shape.
- Classes are domain-stable and not just document headings.
- Relationships have clear direction, allowed domains/ranges, and examples.
- Controlled vocabularies prevent synonym drift without erasing useful aliases.
- Constraints improve extraction/query quality rather than adding decorative formality.
- Every abstraction is grounded in source examples or marked as provisional.

## Related Skills

- `knowledge:knowledge-graph-builder` - use after ontology design to extract graph-ready records.
- `knowledge:knowledge-base-builder` - use to align Markdown frontmatter and note taxonomy with ontology terms.
- `knowledge:rag-corpus-builder` - use to align chunk metadata and filters with ontology terms.
- `knowledge:knowledge-query` - use to answer questions using ontology-aware routing and evidence.
