---
name: knowledge-base-builder
description: >-
  Use when turning code, documents, notes, chat logs, or mixed source material
  into an Obsidian-style linked Markdown knowledge base with backlinks,
  map-of-content notes, and source-grounded summaries.
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

## Process

1. **Define the vault boundary.** Identify the source directories, document sets, or pasted materials to include. Ask only when the boundary is ambiguous or destructive file placement is possible; otherwise create a clear output folder such as `knowledge-base/` or use the user's requested vault path.
2. **Create a vault plan for non-trivial corpora.** For multi-folder repos, mixed document sets, or long-lived vaults, write `vault-plan.md` before creating notes. Include audience, included/excluded sources, note types, folder layout, naming rules, source coverage target, and navigation surfaces.
3. **Inventory the sources.** Read representative files before designing the structure. For codebases, map modules, public entry points, configuration, runtime flows, tests, and docs. For mixed materials, group by domain, project, decision, people/process, and open questions.
4. **Choose note types.** Prefer a small set of reusable note shapes:
   - Concept notes for domain ideas and vocabulary.
   - Code notes for modules, APIs, services, commands, schemas, and data flows.
   - Decision notes for tradeoffs, ADR-like choices, constraints, and rejected alternatives.
   - Workflow notes for procedures, runbooks, onboarding paths, and repeated tasks.
   - MOC notes for navigation hubs that connect related notes.
5. **Write atomic notes.** Keep each note centered on one durable idea, component, or decision. Split notes when the title needs "and", when unrelated readers would want only half, or when backlinks would point to different concepts.
6. **Add structured frontmatter.** Use lightweight YAML fields so the Markdown vault can later feed RAG or graph extraction without losing human readability.
7. **Link deliberately.** Use Obsidian-style wikilinks (`[[Note Title]]`) for durable concepts and relative Markdown links for files that should open directly from the repository. Add links where they support navigation, dependency tracing, or later synthesis; do not link every repeated word.
8. **Ground claims in sources.** Include a short `Sources` section with file paths, document names, or URLs used for each note. Mark uncertain inferences as `Open Questions` instead of presenting them as facts.
9. **Create navigation surfaces.** Add one top-level index and enough MOC notes for the user to enter by task, architecture area, domain concept, or workflow. MOCs should explain why linked notes belong together, not just list them.
10. **Check graph quality.** Before finishing, inspect for orphan notes, duplicate note titles, missing source references, dead links, and oversized notes. Merge, split, or rename notes when the graph would be hard to browse.

## Output Template

A useful knowledge-base delivery includes:

| Artifact | Purpose |
|---|---|
| `index.md` | Primary entry point with the vault map and recommended reading paths |
| `vault-plan.md` | Audience, scope, note taxonomy, naming rules, and coverage strategy for non-trivial vaults |
| `mocs/*.md` or topic MOC notes | Topic-level navigation hubs |
| Atomic Markdown notes | Source-grounded concept, code, decision, and workflow notes |
| `glossary.md` when terms are numerous | Canonical names and aliases |
| `open-questions.md` when needed | Unknowns, weak inferences, and follow-up research |

## Note Templates

Each note should generally use this base shape:

```markdown
---
type: concept
domain: billing
status: verified
confidence: direct
sources:
  - path/to/source.ext
related:
  - Related Note
aliases:
  - Short Alias
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

## Frontmatter for RAG and Graph Export

Keep frontmatter simple and stable:

```yaml
---
type: code-module
domain: billing
status: verified
confidence: direct
tags:
  - codebase
  - architecture
aliases:
  - Short Alias
sources:
  - src/billing/BillingService.ts
related:
  - Payment Authorization Flow
  - Retry Policy
---
```

Useful fields:

| Field | Purpose |
|---|---|
| `type` | Enables filtering by note shape |
| `domain` | Groups notes for navigation and retrieval |
| `status` | Marks draft, verified, deprecated, or needs-review |
| `confidence` | Separates direct evidence from inference |
| `sources` | Preserves provenance for RAG citations |
| `related` | Gives graph extraction a cleaner edge seed than raw wikilinks alone |
| `aliases` | Preserves source terminology and search variants |

## Quality Bar

- The vault can be browsed from `index.md` without knowing the source tree.
- Non-trivial vaults include `vault-plan.md` and follow its naming and note-type rules.
- Important components, concepts, decisions, and workflows have at least one inbound link.
- Important notes are reachable from `index.md` or a MOC within two clicks.
- Every non-obvious claim is traceable to a source or labeled as an inference.
- Frontmatter is consistent enough to support later `rag-corpus-builder` or `knowledge-graph-builder` work.
- Notes are useful independently but improve when followed through links.
- The result avoids documentation theater: no generic summaries, no invented architecture, no empty MOCs, and no link spam.

## What Claude Does / What You Do

| Claude | You |
|---|---|
| Reads sources and proposes a vault boundary when needed | Confirm the intended audience and output location if they matter |
| Builds linked Markdown notes with source references | Review whether note names match your team's vocabulary |
| Marks uncertain findings as open questions | Answer or discard open questions after reviewing the vault |
| Checks for dead links, orphans, and duplicate concepts | Use the vault in Obsidian or your Markdown tool and request reshaping if navigation feels wrong |

## Related Skills

- `develop:code-documenter` - use when the main goal is inline/API/code documentation rather than a linked knowledge base.
- `write:rag-corpus-builder` - use when the goal is retrieval-ready chunks, metadata, citations, and eval queries.
- `write:knowledge-graph-builder` - use when the goal is entity/relationship schema and graph-ready records.
- `develop:documentation-strategy` - use when planning a documentation system before producing notes.
- `write:doc-coauthoring` - use when collaboratively drafting a specific document for readers.
