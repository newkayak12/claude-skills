---
name: base-builder
description: >-
  Use when turning code, docs, notes, or mixed sources into a small-to-moderate,
  query-efficient Markdown knowledge base with predictable folders, an AI lookup
  catalog, source-grounded summaries, and RAG-ready metadata.
effort: high
scenarios:
  - "코드랑 문서를 읽어서 Obsidian처럼 링크 걸린 지식 기반 만들어줘"
  - "이 레포를 분석해서 vault 형태의 노트로 정리해줘"
  - "Turn these docs and source files into a linked Markdown knowledge base"
  - "Build a project wiki with backlinks and maps of content from this codebase"
compatibility:
  optional:
    - think-tool
  remote_mcp_note: >-
    think-tool이 있으면 개념 경계, 노트 분할, MOC 구조를 더 체계적으로 잡는 데 활용할 수 있습니다.
---

# Knowledge Base Builder

## Standing Mandates

- Organize for the user's likely lookup jobs, not for decorative hierarchy or a mechanical mirror of the source tree.
- Keep Markdown notes and catalog lookup as the operating model while the corpus remains practical to maintain and query selectively; hand off to RAG when it does not.
- Keep folders shallow, place each note at one canonical path, and use controlled metadata for cross-cutting retrieval.
- Preserve stable note IDs and exact source references so path changes do not break catalog lookup or later RAG citations.
- For non-trivial vaults, emit `_knowledge/catalog.jsonl`; keep note bodies, not catalog summaries, as the authoritative corpus.
- Preserve a coherent existing topology unless restructuring is requested or it demonstrably blocks retrieval.
- Preserve evidence-based lessons from meaningful build or update work in `_knowledge/improvement-notes.md` so the next builder pass can improve retrieval without rediscovering the same friction.
- Treat answerability as a completion gate, separate from structural cleanliness. A non-trivial vault is incomplete while any declared competency question is partial or unanswerable.
- Treat the claim, not the entity, as the atomic unit. Preserve relation claims as first-class notes when a comparison, equivalence, or sequence is the knowledge users need.

## Quick Intake

Before building, ask a lightweight "what is this?" intake when the source purpose is not already obvious from the user's request or repository context. Keep it short:

- What kind of material is this? codebase, docs, notes, tickets, research, mixed?
- Who will browse the vault, and what should they be able to understand or do?
- Should the output optimize for onboarding, architecture navigation, research synthesis, operations, or long-term knowledge maintenance?
- Does an existing folder or naming convention need to be preserved?

If the user gives a partial answer, proceed with reasonable defaults and record assumptions in `vault-plan.md` or `open-questions.md`. Do not block on exhaustive taxonomy decisions before reading representative sources.

## Process

1. **Define the vault boundary.** Identify the source directories, document sets, or pasted materials to include. Ask only when the boundary is ambiguous or destructive file placement is possible; otherwise create a clear output folder such as `knowledge-base/` or use the user's requested vault path.
2. **Define likely lookup jobs and competency questions.** Capture the names, aliases, operator terms, source symbols, entities, domains, and question types an AI or human reader will use. For a non-trivial vault, create `_knowledge/questions.jsonl` from these jobs before treating extraction as complete; do not replace a difficult failed question with an easier one.
3. **Inspect existing topology and memory.** Before placing notes, inspect existing folders, naming rules, indexes, MOCs, links, and `_knowledge/improvement-notes.md` when present. Preserve a coherent existing convention unless the user requested restructuring or it demonstrably blocks retrieval.
4. **Choose a folder strategy.** Use the shallowest hierarchy that predictably narrows candidate notes. Prefer a flat `notes/` folder for small or single-domain vaults and `notes/<domain>/` for stable multi-domain corpora. Keep cross-cutting classifications in frontmatter rather than duplicating notes across folders.
5. **Create a vault plan for non-trivial corpora.** For multi-folder repos, mixed document sets, or long-lived vaults, write `vault-plan.md` before creating notes. Include audience, included/excluded sources, lookup jobs, folder placement rules, note types, naming rules, source coverage target, navigation surfaces, and the conditions for later RAG conversion.
6. **Inventory the sources.** Read representative files before designing the structure. For codebases, map modules, public entry points, configuration, runtime flows, tests, and docs. For mixed materials, group by domain, project, decision, people/process, and open questions.
7. **Choose note types.** Prefer a small set of reusable note shapes:
   - Concept notes for domain ideas and vocabulary.
   - Code notes for modules, APIs, services, commands, schemas, and data flows.
   - Decision notes for tradeoffs, ADR-like choices, constraints, and rejected alternatives.
   - Workflow notes for procedures, runbooks, onboarding paths, and repeated tasks.
   - Relation notes for durable contrasts, equivalences, and sequences across multiple participants.
   - MOC notes for navigation hubs that connect related notes.
8. **Write atomic claims.** Keep each note centered on one durable claim, idea, component, relation, or decision. Split notes when the title needs "and" only when the conjunction joins independent claims, unrelated readers would want only half, or backlinks would point to different concepts. A single note may span multiple entities when its atomic claim is the relation between them. Relation notes require all participants and evidence for every side.
9. **Add retrieval metadata and vocabulary bridges.** Give each note a stable `id`, explicit `title`, `type`, `domain`, controlled `tags`, useful `aliases`, important `entities`, `status`, and `sources`. Keep same-referent aliases in `aliases`; use `user_terms`, `source_symbols`, and `lookup_layers` for operator/UI-to-code/database bridges. Treat `sources` as the canonical provenance field.
10. **Link and ground deliberately.** Use Obsidian-style wikilinks (`[[Note Title]]`) for durable concepts and relative Markdown links for files that should open directly from the repository. Include exact source references and mark uncertain inferences as `Open Questions` instead of presenting them as facts.
11. **Create navigation and lookup surfaces.** Add `index.md` for readers, focused MOCs where they improve traversal, and `_knowledge/catalog.jsonl` for fast AI candidate discovery. The catalog should map stable IDs and retrieval metadata to current paths without copying entire note bodies.
12. **Prepare the RAG handoff when relevant.** Keep notes as the source-grounded corpus layer. Record whether headings are suitable chunk boundaries, whether metadata and permissions can propagate to chunks, and which sources are stale, conflicting, or missing before routing to `knowledge:rag-corpus-builder`.
13. **Run the answerability gate.** Execute every declared competency question through `knowledge:query`, write `_knowledge/question-results.jsonl`, and summarize complete/partial/unanswerable counts in `_knowledge/coverage.md`. A question passes only when the required notes and direct evidence support every material part. Run the validator from [references/answerability-contract.md](references/answerability-contract.md); any partial or unanswerable result leaves the build incomplete and becomes the next extraction or correction task.
14. **Check structural and claim quality.** Inspect folder placement, catalog coverage, vocabulary lookup, orphan notes, duplicate IDs or titles, missing source references, dead links, oversized notes, and unsupported synthesis. For relation notes, compare each participant against its own cited anchor before accepting the relation claim.
15. **Capture improvement memory.** After meaningful build or update work, append only observed retrieval friction, structural decisions, failed competency questions, remaining manual steps, and evidence-backed next improvements to `_knowledge/improvement-notes.md`. Use the format in [references/retrieval-layout.md](references/retrieval-layout.md); preserve prior entries and do not turn it into a generic activity log.

## Output Template

A useful knowledge-base delivery includes:

| Artifact | Purpose |
|---|---|
| `index.md` | Primary entry point with the vault map and recommended reading paths |
| `vault-plan.md` | Audience, scope, lookup jobs, folder rules, note taxonomy, naming rules, coverage, and RAG-readiness strategy |
| `notes/` or `notes/<domain>/` | Atomic notes placed by the documented primary retrieval axis |
| `_knowledge/catalog.jsonl` | Lightweight AI lookup catalog mapping IDs, terms, entities, sources, and current note paths |
| `_knowledge/questions.jsonl` | Canonical competency questions derived from real lookup jobs |
| `_knowledge/question-results.jsonl` | Per-question coverage, answer notes, direct evidence, and missing knowledge |
| `_knowledge/coverage.md` | Source coverage plus numeric complete/partial/unanswerable question coverage |
| `_knowledge/improvement-notes.md` | Append-only operational memory for evidence-backed improvements to later builder runs |
| `_knowledge/needs-human-review.md` | Claims awaiting intended-behavior or domain-owner confirmation |
| `_rag/` when generated | Default portable RAG corpus artifacts derived from the vault |
| `_graph/` when generated | Default graph-ready records derived from the vault |
| `_ontology/` when generated | Default ontology package aligned with the vault taxonomy |
| `mocs/*.md` or topic MOC notes | Topic-level navigation hubs |
| Atomic Markdown notes | Source-grounded concept, code, decision, and workflow notes |
| `glossary.md` when terms are numerous | Canonical names and aliases |
| `open-questions.md` when needed | Unknowns, weak inferences, and follow-up research |

## Folder Strategy

Folders reduce the search space; metadata handles overlapping classifications. Before creating a non-trivial folder layout, catalog, or RAG handoff, read [references/retrieval-layout.md](references/retrieval-layout.md). It defines placement choices, move invariants, catalog records, and metadata propagation.

## Note Templates

Before writing the first note, read [references/note-templates.md](references/note-templates.md#note-templates) for the base note shape and the per-type emphasis table.

## Linking Conventions

Before linking notes or writing source references, read [references/note-templates.md](references/note-templates.md#linking-conventions).

## Provenance Levels

Use `confidence` in frontmatter to make source strength explicit:

| Value | Meaning |
|---|---|
| `direct` | Explicitly stated in a source |
| `inferred` | Reasonable conclusion from multiple sources |
| `uncertain` | Plausible but needs confirmation |
| `stale-risk` | Source may be outdated or change-prone |

For `inferred`, `uncertain`, or `stale-risk`, add a short explanation in `Open Questions` or the note body. Do not present uncertain synthesis as fact.

## Frontmatter for Retrieval Exports

Before writing note frontmatter or any catalog, graph, or RAG export field, read [references/retrieval-layout.md](references/retrieval-layout.md#frontmatter-for-retrieval-exports) for the field table.

## AI Lookup Catalog

Before emitting `_knowledge/catalog.jsonl`, read [references/retrieval-layout.md](references/retrieval-layout.md#ai-lookup-catalog) and [references/answerability-contract.md](references/answerability-contract.md) for the record contract.

## RAG Handoff

Before routing to `knowledge:rag-corpus-builder`, read [references/retrieval-layout.md](references/retrieval-layout.md#rag-handoff) for the handoff contract.

## Quality Bar

Completion gates; the full 16-item list is in [references/retrieval-layout.md](references/retrieval-layout.md#quality-bar-checklist).

- Navigation and placement: `index.md` browsable without the source tree, `vault-plan.md` rules followed, folder predictable from the placement rule with no duplicate notes, important notes reachable within two clicks and linked inbound.
- Catalog and vocabulary: every catalog entry resolves to one current note path; `user_terms`, `source_symbols`, bridge layers explicit; `aliases` same-referent only.
- Relation notes: at least two participants and evidence for every side.
- Answerability: every competency question has one current `complete` result with direct evidence and required note IDs; `_knowledge/coverage.md` numeric; the validator exits successfully.
- Evidence: every non-obvious claim traceable to a source or labeled as inference.
- Export readiness: frontmatter consistent for `rag-corpus-builder` or `graph-builder`; stable IDs, semantic headings, exact source references; improvement memory concrete, not catalog or RAG content.
- Notes useful independently and better when linked; no documentation theater (generic summaries, invented architecture, empty MOCs, link spam).

## What Claude Does / What You Do

| Claude | You |
|---|---|
| Reads sources and proposes a vault boundary when needed | Confirm the intended audience and output location if they matter |
| Builds linked Markdown notes, predictable folders, and a lightweight catalog | Review whether paths, names, tags, and aliases match your team's vocabulary |
| Marks uncertain findings as open questions | Answer or discard open questions after reviewing the vault |
| Checks for dead links, orphans, and duplicate concepts | Use the vault in Obsidian or your Markdown tool and request reshaping if navigation feels wrong |

## Related Skills

- `develop:documentation-strategy` - use when the main goal is inline/API/code documentation rather than a linked knowledge base.
- `knowledge:rag-corpus-builder` - use when the goal is retrieval-ready chunks, metadata, citations, and eval queries.
- `knowledge:ontology-builder` - use when note types, domains, aliases, or relation meanings need shared semantic control across vault, graph, and RAG outputs.
- `knowledge:graph-builder` - use when the goal is entity/relationship schema and graph-ready records.
- `knowledge:query` - use when querying an existing vault, graph, RAG corpus, or mixed knowledge asset.
- `develop:documentation-strategy` - use when planning a documentation system before producing notes.
- `write:prd` (document purpose) - use when collaboratively drafting a specific document for readers.
