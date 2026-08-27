---
name: knowledge-base-builder
description: >-
  Use when turning code, docs, notes, or mixed sources into a small-to-moderate,
  query-efficient Markdown knowledge base with predictable folders, an AI
  lookup catalog, source-grounded summaries, and RAG-ready metadata.
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

## Quick Intake

Before building, ask a lightweight "what is this?" intake when the source purpose is not already obvious from the user's request or repository context. Keep it short:

- What kind of material is this? codebase, docs, notes, tickets, research, mixed?
- Who will browse the vault, and what should they be able to understand or do?
- Should the output optimize for onboarding, architecture navigation, research synthesis, operations, or long-term knowledge maintenance?
- Does an existing folder or naming convention need to be preserved?

If the user gives a partial answer, proceed with reasonable defaults and record assumptions in `vault-plan.md` or `open-questions.md`. Do not block on exhaustive taxonomy decisions before reading representative sources.

## Process

1. **Define the vault boundary.** Identify the source directories, document sets, or pasted materials to include. Ask only when the boundary is ambiguous or destructive file placement is possible; otherwise create a clear output folder such as `knowledge-base/` or use the user's requested vault path.
2. **Define likely lookup jobs.** Capture the names, aliases, entities, domains, and question types an AI or human reader will use to find knowledge. Optimize organization for those lookup paths instead of decorative hierarchy.
3. **Inspect existing topology and memory.** Before placing notes, inspect existing folders, naming rules, indexes, MOCs, links, and `_knowledge/improvement-notes.md` when present. Preserve a coherent existing convention unless the user requested restructuring or it demonstrably blocks retrieval.
4. **Choose a folder strategy.** Use the shallowest hierarchy that predictably narrows candidate notes. Prefer a flat `notes/` folder for small or single-domain vaults and `notes/<domain>/` for stable multi-domain corpora. Keep cross-cutting classifications in frontmatter rather than duplicating notes across folders.
5. **Create a vault plan for non-trivial corpora.** For multi-folder repos, mixed document sets, or long-lived vaults, write `vault-plan.md` before creating notes. Include audience, included/excluded sources, lookup jobs, folder placement rules, note types, naming rules, source coverage target, navigation surfaces, and the conditions for later RAG conversion.
6. **Inventory the sources.** Read representative files before designing the structure. For codebases, map modules, public entry points, configuration, runtime flows, tests, and docs. For mixed materials, group by domain, project, decision, people/process, and open questions.
7. **Choose note types.** Prefer a small set of reusable note shapes:
   - Concept notes for domain ideas and vocabulary.
   - Code notes for modules, APIs, services, commands, schemas, and data flows.
   - Decision notes for tradeoffs, ADR-like choices, constraints, and rejected alternatives.
   - Workflow notes for procedures, runbooks, onboarding paths, and repeated tasks.
   - MOC notes for navigation hubs that connect related notes.
8. **Write atomic notes.** Keep each note centered on one durable idea, component, or decision. Split notes when the title needs "and", when unrelated readers would want only half, or when backlinks would point to different concepts.
9. **Add retrieval metadata.** Give each note a stable `id`, explicit `title`, `type`, `domain`, controlled `tags`, useful `aliases`, important `entities`, `status`, and `sources`. Treat `sources` as the canonical provenance field.
10. **Link and ground deliberately.** Use Obsidian-style wikilinks (`[[Note Title]]`) for durable concepts and relative Markdown links for files that should open directly from the repository. Include exact source references and mark uncertain inferences as `Open Questions` instead of presenting them as facts.
11. **Create navigation and lookup surfaces.** Add `index.md` for readers, focused MOCs where they improve traversal, and `_knowledge/catalog.jsonl` for fast AI candidate discovery. The catalog should map stable IDs and retrieval metadata to current paths without copying entire note bodies.
12. **Prepare the RAG handoff when relevant.** Keep notes as the source-grounded corpus layer. Record whether headings are suitable chunk boundaries, whether metadata and permissions can propagate to chunks, and which sources are stale, conflicting, or missing before routing to `knowledge:rag-corpus-builder`.
13. **Check retrieval quality.** Inspect folder placement, catalog coverage, alias/tag lookup, orphan notes, duplicate IDs or titles, missing source references, dead links, and oversized notes. Run a few representative lookup questions and reshape the vault when candidate discovery is noisy.
14. **Capture improvement memory.** After meaningful build or update work, append only observed retrieval friction, structural decisions, remaining manual steps, and evidence-backed next improvements to `_knowledge/improvement-notes.md`. Use the format in [references/retrieval-layout.md](references/retrieval-layout.md); preserve prior entries and do not turn it into a generic activity log.

## Output Template

A useful knowledge-base delivery includes:

| Artifact | Purpose |
|---|---|
| `index.md` | Primary entry point with the vault map and recommended reading paths |
| `vault-plan.md` | Audience, scope, lookup jobs, folder rules, note taxonomy, naming rules, coverage, and RAG-readiness strategy |
| `notes/` or `notes/<domain>/` | Atomic notes placed by the documented primary retrieval axis |
| `_knowledge/catalog.jsonl` | Lightweight AI lookup catalog mapping IDs, terms, entities, sources, and current note paths |
| `_knowledge/coverage.md` | Included/skipped source areas, weak retrieval paths, stale knowledge, and open gaps |
| `_knowledge/improvement-notes.md` | Append-only operational memory for evidence-backed improvements to later builder runs |
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

Each note should generally use this base shape:

```markdown
---
id: payment-authorization
title: Payment Authorization
type: concept
domain: billing
status: verified
confidence: direct
tags:
  - payment
  - authorization
aliases:
  - 결제 승인
  - payment approval
entities:
  - PaymentService
  - PaymentGateway
sources:
  - path/to/source.ext
related:
  - retry-policy
---

# Note Title

One-paragraph summary of the durable idea.

## Key Points

- Specific, source-grounded point.
- Link to related notes with [[Useful Wikilinks]].

## Related

- [[Related Note]]

## Sources

- `path/to/source.ext`
```

Adapt the sections by note type:

| Note type | Required emphasis |
|---|---|
| `concept` | Definition, boundaries, aliases, related concepts |
| `code-module` | Responsibilities, key symbols, entry points, dependencies, tests |
| `workflow` | Trigger, steps, inputs/outputs, failure modes, owner |
| `decision` | Context, chosen option, rejected alternatives, consequences |
| `moc` | Why the linked notes belong together and recommended reading paths |
| `glossary-entry` | Canonical term, aliases, short definition, source of terminology |

## Linking Conventions

- Use stable, human-readable note titles: `Payment Authorization Flow`, not `payment-auth-flow-notes-final`.
- Add aliases in frontmatter only when they materially improve search or preserve existing terminology.
- Prefer links between notes over duplicating the same explanation in multiple places.
- Preserve repository paths exactly in source references.
- When a note is generated from code, include the key symbols, files, commands, or tests that justify the summary.
- Keep important notes reachable from `index.md` or a MOC within two clicks.
- Avoid orphan notes unless they are intentionally listed in `open-questions.md` as isolated findings.

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

Keep the base note frontmatter above simple and stable so catalog, graph, and later RAG exports can reuse it without reclassification.

Useful fields:

| Field | Purpose |
|---|---|
| `id` | Keeps identity stable when a note moves or its title changes |
| `title` | Provides an explicit lookup label independent of the filename |
| `type` | Enables filtering by note shape |
| `domain` | Provides the primary placement and retrieval axis |
| `status` | Marks draft, verified, deprecated, or needs-review |
| `confidence` | Separates direct evidence from inference |
| `tags` | Adds controlled cross-cutting retrieval terms without duplicating notes |
| `sources` | Preserves provenance for RAG citations |
| `related` | Gives graph extraction a cleaner edge seed than raw wikilinks alone |
| `aliases` | Preserves source terminology and search variants |
| `entities` | Supports entity lookup and later graph/RAG metadata propagation |

## AI Lookup Catalog

For non-trivial vaults, emit one record per note in `_knowledge/catalog.jsonl` using the contract in [references/retrieval-layout.md](references/retrieval-layout.md). Keep summaries short enough for candidate selection, paths current, IDs stable, and terms grounded in language users actually search. `knowledge:knowledge-query` should search the catalog first and open only a small candidate set.

## RAG Handoff

Use `knowledge:rag-corpus-builder` when the user requests embeddings, a vector index, chunk-level retrieval, or the vault has outgrown efficient targeted note lookup.

Follow the handoff contract in [references/retrieval-layout.md](references/retrieval-layout.md): note bodies remain corpus input, catalog/frontmatter provide identity and metadata, semantic headings become preferred chunk boundaries, and unresolved quality or access issues remain visible in the ingestion report.

## Quality Bar

- The vault can be browsed from `index.md` without knowing the source tree.
- Non-trivial vaults include `vault-plan.md` and follow its naming and note-type rules.
- A reader can predict a note's folder from the documented placement rule, and cross-cutting topics do not create duplicate notes.
- `_knowledge/catalog.jsonl` resolves every catalog entry to one current note path and enables title, alias, tag, domain, and entity lookup.
- Important components, concepts, decisions, and workflows have at least one inbound link.
- Important notes are reachable from `index.md` or a MOC within two clicks.
- Every non-obvious claim is traceable to a source or labeled as an inference.
- Frontmatter is consistent enough to support later `rag-corpus-builder` or `knowledge-graph-builder` work.
- RAG-ready vaults preserve stable IDs, semantic headings, exact source references, and metadata that can propagate without reclassification.
- Improvement memory records concrete evidence and actionable next changes without becoming catalog or RAG content itself.
- Notes are useful independently but improve when followed through links.
- The result avoids documentation theater: no generic summaries, no invented architecture, no empty MOCs, and no link spam.

## What Claude Does / What You Do

| Claude | You |
|---|---|
| Reads sources and proposes a vault boundary when needed | Confirm the intended audience and output location if they matter |
| Builds linked Markdown notes, predictable folders, and a lightweight catalog | Review whether paths, names, tags, and aliases match your team's vocabulary |
| Marks uncertain findings as open questions | Answer or discard open questions after reviewing the vault |
| Checks for dead links, orphans, and duplicate concepts | Use the vault in Obsidian or your Markdown tool and request reshaping if navigation feels wrong |

## Related Skills

- `develop:code-documenter` - use when the main goal is inline/API/code documentation rather than a linked knowledge base.
- `knowledge:rag-corpus-builder` - use when the goal is retrieval-ready chunks, metadata, citations, and eval queries.
- `knowledge:ontology-builder` - use when note types, domains, aliases, or relation meanings need shared semantic control across vault, graph, and RAG outputs.
- `knowledge:knowledge-graph-builder` - use when the goal is entity/relationship schema and graph-ready records.
- `knowledge:knowledge-query` - use when querying an existing vault, graph, RAG corpus, or mixed knowledge asset.
- `develop:documentation-strategy` - use when planning a documentation system before producing notes.
- `write:doc-coauthoring` - use when collaboratively drafting a specific document for readers.
