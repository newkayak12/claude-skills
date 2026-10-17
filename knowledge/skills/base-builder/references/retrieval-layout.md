# Retrieval Layout and RAG Handoff

Read this reference when a knowledge base needs a non-trivial folder layout, an AI lookup catalog, path restructuring, or later conversion to a RAG corpus.

## Operating Boundary

This builder is the Markdown-first stage for a corpus that remains practical to maintain as atomic notes and query by narrowing a catalog to a small candidate set. It does not create embeddings or operate a vector index.

Move to `knowledge:rag-corpus-builder` when observed retrieval needs justify it, especially when catalog lookup routinely yields too many plausible notes, users need passage-level semantic retrieval across many documents, ranking and metadata filters matter, or measured lookup quality and latency no longer meet the intended query jobs. Do not use an arbitrary note-count threshold as the only trigger.

## Folder Placement

Choose one stable primary placement axis and document it in `vault-plan.md`.

| Corpus shape | Default placement |
|---|---|
| Small or single-domain | `notes/<note>.md` |
| Stable multi-domain | `notes/<domain>/<note>.md` |
| Existing coherent vault | Preserve its topology and add the catalog alongside it |
| Type-specific collection with a genuinely different reader or lifecycle | Use a shallow dedicated folder such as `decisions/` or `runbooks/` |

- Prefer no more than two meaningful levels below the vault root unless an existing convention or access boundary requires more.
- Do not mirror the source tree unless source location is itself a primary lookup path.
- Give each note one canonical path. Choose one primary `domain`; represent other facets with `tags`, `aliases`, `entities`, and links instead of duplicate files.
- Avoid catch-all folders such as `misc/`. Record unresolved placement in `open-questions.md` until a stable rule emerges.
- Preserve the stable note `id` when a path changes. Update the catalog, wikilinks, relative links, and MOCs together.
- Do not mass-move an existing vault merely to match the defaults. When restructuring is requested, record old-to-new paths in `vault-plan.md` and verify every affected reference after moving.

## AI Lookup Catalog

Emit one JSON object per note in `_knowledge/catalog.jsonl`:

```json
{"id":"payment-authorization","path":"notes/billing/payment-authorization.md","title":"Payment Authorization","summary":"결제 승인 처리의 진입점과 실패 정책","type":"concept","domain":"billing","tags":["payment","authorization"],"aliases":["payment approval"],"user_terms":["결제 승인"],"source_symbols":["PaymentService.authorize"],"lookup_layers":["operator","code"],"entities":["PaymentService","PaymentGateway"],"source_refs":["src/billing/PaymentService.ts#authorize"],"status":"verified","confidence":"direct"}
```

- Keep the summary short enough for candidate selection; the note body remains the authoritative explanation.
- Keep `path` current and `id` stable across moves.
- Include terms people actually use. Do not generate tag or alias variations that add no retrieval value.
- Keep `aliases` for alternate names of the same referent. Store operator/UI language in `user_terms`, implementation identifiers in `source_symbols`, and the intentional bridge in `lookup_layers`.
- For relation records, include `relation_type`, stable `participants`, and `evidence_by_participant` as defined in [answerability-contract.md](answerability-contract.md).
- Resolve every catalog path to exactly one note. Reject duplicate IDs.
- Search titles, aliases, user terms, source symbols, tags, domain, entities, and summaries to select a small candidate set before opening note bodies.

## RAG Handoff

Use `knowledge:rag-corpus-builder` when the user requests embeddings, a vector index, chunk-level retrieval, or the vault has outgrown efficient targeted note lookup.

- Treat note bodies and their exact `sources` as corpus input. Treat the catalog as discovery and metadata input, not as a substitute for source text.
- Prefer Markdown headings and other semantic units as chunk boundaries. Derive stable chunk IDs from the stable note ID plus a durable heading or block anchor rather than a mutable ordinal alone.
- Propagate `type`, `domain`, `tags`, `aliases`, `user_terms`, `source_symbols`, `entities`, `status`, `confidence`, access metadata, and source references into chunks only when they affect retrieval, ranking, filtering, or citation.
- Keep the vault canonical and write portable RAG artifacts under `<vault>/_rag/` unless the user specifies another target.
- Carry unresolved conflicts, stale sources, missing permissions, and coverage gaps into the RAG ingestion report instead of silently indexing them as trusted facts.

## Improvement Memory

After a meaningful knowledge-base build or update, append a dated entry to `_knowledge/improvement-notes.md`. Read existing entries before changing the vault so repeated friction can influence the next folder, metadata, or lookup decision.

```markdown
## 2026-08-27 — billing lookup pass

- Lookup jobs exercised: find payment failure ownership; trace retry decisions
- Evidence observed: alias lookup missed "결제 실패" in 2 of 3 trial queries
- Change made: added a grounded alias to `payment-failure`
- Remaining manual step: ownership still requires opening two notes
- Failed competency question: `payment-failure-owner` is partial because no ownership anchor exists
- Next improvement candidate: add the owning service to `entities`
- Reconsideration signal: catalog lookup returns more than five plausible notes for the same job
```

- Record observed evidence, the decision it caused, and a concrete next action. Separate an untested idea from a demonstrated problem.
- Keep entries concise and append-only; preserve earlier evidence even when a later pass supersedes its recommendation.
- Do not copy sensitive source content, produce a generic activity diary, or add an entry when the run produced no material learning.
- Treat this file as local operational memory. Do not add it to `_knowledge/catalog.jsonl`, graph extraction, or a future RAG corpus.

## Frontmatter for Retrieval Exports

Keep the base note frontmatter in [note-templates.md](note-templates.md) simple and stable so catalog, graph, and later RAG exports can reuse it without reclassification.

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
| `user_terms` | Preserves operator language and UI-facing lookup terms without misclassifying them as aliases |
| `source_symbols` | Preserves code, configuration, statement, and schema identifiers used to ground cross-layer lookup |
| `lookup_layers` | Declares the user-facing and implementation layers a note intentionally bridges |
| `relation_type` / `participants` | Makes contrast, equivalence, or sequence claims queryable as first-class knowledge |
| `review_status` | Tracks review workflow separately from evidence confidence |

## Quality Bar Checklist

The full list behind the Quality Bar summary in SKILL.md.

- The vault can be browsed from `index.md` without knowing the source tree.
- Non-trivial vaults include `vault-plan.md` and follow its naming and note-type rules.
- A reader can predict a note's folder from the documented placement rule, and cross-cutting topics do not create duplicate notes.
- `_knowledge/catalog.jsonl` resolves every catalog entry to one current note path and enables title, alias, tag, domain, and entity lookup.
- Operator/UI-to-code/database lookup jobs have explicit `user_terms`, `source_symbols`, and declared bridge layers; `aliases` remains same-referent vocabulary.
- Relation notes represent contrasts, equivalences, and sequences with at least two participants and evidence for every side.
- Every declared competency question has one current result. All results are `complete`, cite direct evidence, include the required note IDs, and report no missing parts.
- `_knowledge/coverage.md` reports numeric answerability coverage, and the answerability validator exits successfully before completion is claimed.
- Important components, concepts, decisions, and workflows have at least one inbound link.
- Important notes are reachable from `index.md` or a MOC within two clicks.
- Every non-obvious claim is traceable to a source or labeled as an inference.
- Frontmatter is consistent enough to support later `rag-corpus-builder` or `graph-builder` work.
- RAG-ready vaults preserve stable IDs, semantic headings, exact source references, and metadata that can propagate without reclassification.
- Improvement memory records concrete evidence and actionable next changes without becoming catalog or RAG content itself.
- Notes are useful independently but improve when followed through links.
- The result avoids documentation theater: no generic summaries, no invented architecture, no empty MOCs, and no link spam.
