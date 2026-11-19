# F2 — Save what arrives over MCP as a linked Markdown note (knowledge_capture, card 159)

Findings file: `docs/prd/F2-knowledge-capture-findings.md` (cited below as "findings").

## Goal
Add an MCP write tool, `knowledge_capture`, so content a client sends over MCP is saved as a linked Markdown note in the knowledge root. The engine does the linking in tested node code, not prose. One shared engine serves noah, genna and general projects, differing only by per-instance config.

## Problem
The knowledge MCP is read-only: `MCP_TOOLS` lists `knowledge_index`, `knowledge_search`, `knowledge_get`, `knowledge_neighbors` and `knowledge_status` (`sqlite-knowledge.mjs:1931-1996`). The request's list also names a `knowledge_root` tool, but none exists; `knowledge_root` is only a field of `indexStatus` (:763). So nothing arriving over MCP can be saved. The delta hook does not help: it fires only on `Write|Edit|MultiEdit|NotebookEdit` (`hooks.json`), never on an MCP call, so capture must call the job writer itself. The indexer reads only Markdown listed in `catalog.jsonl` (sqlite-index-builder SKILL.md:36), so an unlisted note is invisible to search. User: "mcp로 받은 정도를 md로 저장", "새로운 글 오면 linked 처리 잘해야하고".

## Scope
F2 builds:
- the `knowledge_capture` tool: one `MCP_TOOLS` entry and one `callMcpTool` branch in `knowledge/scripts/sqlite-knowledge.mjs`. `serveMcp` (:2072) is only the stdin loop and needs no change (finding: MCP server today).
- the note and catalog writer: `notes/<id>.md` and one `_knowledge/catalog.jsonl` row.
- the link and backlink engine, with merge detection.
- the per-instance config and its published schema.
- the job-writing helper extracted from `knowledge/hooks/knowledge-delta-check.mjs` :263-294 into one shared function, called by both the hook and capture.
- F2's rows (notes/, catalog.jsonl, config file) in F1's README/KOR table.
- node tests, and Codex exposure of the same tool.

## Rules (settled or decided by default)
- The tool is named `knowledge_capture` and lives in `sqlite-knowledge.mjs` `serveMcp`'s tool set (user, 2026-11-19, brainstorm).
- Link candidates come from the current `searchIndex` / `graphNeighbors` entry points (:1265, :1792), computed in tested node code. A `[[wikilink]]` is written only when the candidate concept appears in the text; co-occurrence alone never links (brainstorm).
- A linked existing note gets a backlink in its `## Related` section; a MOC is used only when the config names one (default - revisit with PO).
- "Appears in the text" = case-folded match of the title or any alias on a word boundary; for Korean, the stem matched as a prefix (default - revisit with implementation lead).
- Near-duplicate: a capture is a duplicate only when its normalized title or an alias exactly matches the top search hit's catalog title or aliases. Any other high score goes to `skipped_candidates`. The per-provider score threshold, since hash is lexical-only, is set in the instance config (default - revisit with implementation lead (knowledge)).
- No index yet (`openIndex` throws): save, dedupe on catalog title and aliases, and list search candidates as skipped with reason `no-index` (default - revisit with PO).
- Queues: the shared helper takes its queue flags from the caller. Capture always enqueues catalog, graph and embed, ignoring the hook's `_rag/`/`_graph/` gates (default - revisit with PO).
- Id: slug of the title, with a numeric suffix on collision. A caller-supplied id is refused if taken (default - revisit with implementation lead).
- `merged_into` creates nothing and changes nothing. It returns the existing note and the client decides (default - revisit with PO).
- Config file: `<knowledge root>/_knowledge/config.json`, a JSON schema exported from the engine; env vars (`KNOWLEDGE_DB_PATH`, `KNOWLEDGE_EMBED_PROVIDER`, ...) override file values (default - revisit with implementation lead; the F1 and F3 cards confirm).

## User stories

### F2-US-1 — Card 159: add MCP write tool `knowledge_capture` to knowledge/scripts/sqlite-knowledge.mjs serveMcp. It saves content received over MCP as a linked Markdown note in the knowledge root, with linking done by the engine (node, tested), not by prose.

**Acceptance**
- A2.1: knowledge_capture writes notes/<id>.md with frontmatter (id, title, aliases, sources) and appends its _knowledge/catalog.jsonl row
  - the row follows the catalog contract (`retrieval-layout.md:29-45`); the id follows the Rules above.
- A2.2: same concept (title, alias, near-duplicate by index) returns merged_into with the existing note instead of creating a new one
  - the Rules above decide the near-duplicate test and that nothing is written on a merge.
- A2.3: link candidates come from search/neighbors; a [[wikilink]] is written only when the candidate concept appears in the text; co-occurrence alone never links
  - finding: Search / neighbors entry points (findings). F4 keeps their names and return shapes.
- A2.4: each linked existing note gets a backlink (its Related section or the MOC); the new note is never an orphan
  - note shape: `note-templates.md:1-45`. If nothing is linked and the config names a MOC, the MOC gets the entry.
- A2.5: response lists linked_to, backlinked_from, merged_into, skipped_candidates with reasons
- A2.6: node tests: new note has 0 dead links, is not an orphan, no duplicate id or title; delta queues (catalog, graph, embed) receive the job
  - finding: `analyze()` and `linkExists` (hook :164-172) and `validate-knowledge.mjs:86` are reusable oracles. Test style is `node:test` with `handleMcpMessage` (`sqlite-knowledge.test.mjs:432-454`).
- A2.7: .codex-plugin registers the same tool; validate_plugins.py passes
  - finding: `knowledge-mcp.mjs` imports `serveMcp`, and both manifests point at it, so no separate registration code is needed. A2.7 is met by a `tools/list` test containing `knowledge_capture` plus one real Codex call, per `compat-codex.md`.
- R1: Shared engine: noah, genna personal graphs and general projects all use it — per-instance root, ontology and link policy are config; no instance name in engine code
  - applied; see F2-US-2.
- R2: Checks: python3 _repo/scripts/validate_plugins.py, node _repo/scripts/check-copies.mjs, node --test knowledge/scripts/*.test.mjs knowledge/hooks/*.test.mjs, counts reported
  - applied; finding: check-copies has no knowledge entry, so F2 touches no vendored copy.
- R3: No version bump in this Sprint (batched release); README.md and KOR.md move together
  - applied; the `knowledge_capture` row is added to the README tool table (`README.md:301-309`) and to KOR.md in the same commit.
- R4: Real runs use copies under tmp/, never a live vault; tmp/ cleaned after results are recorded
  - applied; the real capture run uses a copy of a vault under tmp/.
- R5: Edit files with Read/Edit/Write only; harness/ and graph/ untouched
  - applied.

### F2-US-2 — Per-instance config: link policy, ontology and similar keys, so noah, genna and general projects share one engine

**Acceptance**
- The engine reads a config at `<knowledge root>/_knowledge/config.json` with keys for link policy (including the per-provider near-duplicate threshold, the MOC name and the language/stem rule), the ontology and similar keys. Defaults apply when the file is absent, so a general project needs no file.
- The schema is exported from the engine and documented (the published F2 schema). F3 later extends it with its graph keys; F2 does not plan those keys.
- The config's `root` key only names a place. F1's resolver reads it, and F2 does not resolve the root.
- No instance name (noah, genna) appears in engine code. A test greps `knowledge/scripts`, `hooks` and `servers` for it. Finding: none exist today (Config / instance today).
- Env vars override file values.
- The config, note writer and job writer do not depend on the backend. F2 has no dependency on F4.
- R1: Shared engine: noah, genna personal graphs and general projects all use it — per-instance root, ontology and link policy are config; no instance name in engine code
- R2: Checks: python3 _repo/scripts/validate_plugins.py, node _repo/scripts/check-copies.mjs, node --test knowledge/scripts/*.test.mjs knowledge/hooks/*.test.mjs, counts reported
- R3: No version bump in this Sprint (batched release); README.md and KOR.md move together
- R4: N/A - config load and schema are unit-tested on temp fixtures; the real run is F2-US-1's.
- R5: Edit files with Read/Edit/Write only; harness/ and graph/ untouched

### F2-US-3 — Shared job-writing helper: extract hook lines :263-294 so the hook and capture call one function

**Acceptance**
- The job-writing block at `knowledge/hooks/knowledge-delta-check.mjs` :263-294 becomes one shared function. The hook and `knowledge_capture` both call it, and it takes the queue flags from its caller.
- This is F2's only edit to the hook. The hook stays fail-open (:290-297), and its existing tests in `knowledge-delta-check.test.mjs` stay green, with the count reported.
- The catalog, graph and embed queues receive the capture job (`_knowledge/jobs/catalog-delta-queue.jsonl`, `graph-update-queue.jsonl`, `embed-queue.jsonl`). The hook's own gates on `_rag/`/`_graph/` are unchanged for hook calls.
- R1: N/A - the helper holds no instance data; its paths come from the root it is given (findings: Delta hook job writer).
- R2: Checks: python3 _repo/scripts/validate_plugins.py, node _repo/scripts/check-copies.mjs, node --test knowledge/scripts/*.test.mjs knowledge/hooks/*.test.mjs, counts reported
- R3: No version bump in this Sprint (batched release); README.md and KOR.md move together
- R4: N/A - covered by tests on temp fixtures; no real run beyond F2-US-1's.
- R5: Edit files with Read/Edit/Write only; harness/ and graph/ untouched

### F2-US-4 — README/KOR rows for notes/, catalog.jsonl and the config file, in F1's table shape

**Acceptance**
- F2 adds its rows (notes/, catalog.jsonl, config file) to F1's README/KOR table, in F1's shape. README.md and KOR.md change in the same commit.
- The `knowledge_capture` tool row is added to the MCP tool table (`README.md:301-309`).
- R1: N/A - documentation only; the rows name no instance.
- R2: Checks: python3 _repo/scripts/validate_plugins.py, node _repo/scripts/check-copies.mjs, node --test knowledge/scripts/*.test.mjs knowledge/hooks/*.test.mjs, counts reported
- R3: No version bump in this Sprint (batched release); README.md and KOR.md move together
- R4: N/A - documentation only.
- R5: Edit files with Read/Edit/Write only; harness/ and graph/ untouched

## Out of scope
- Root resolution: owned by F1. F2 only reads the root it is handed.
- Compose and install layout: owned by F1.
- LLM extraction and the Docker graph build, and extending the config with graph keys: owned by F3.
- pgvector, the storage backend seam, migrate and size advice: owned by F4. F4 keeps the `searchIndex`/`graphNeighbors` names and return shapes.
- Appending new sources or content to an existing note on merge.
- A version bump (R3).
- This planning run changes no source file (docs/prd only).

## Open questions
- Where does capture write when the server starts without `--root` (the Codex manifest, no `--root`; falls back to `CLAUDE_PROJECT_DIR || cwd`, `knowledge-mcp.mjs:5-9`)? It needs F1's resolver function name. Owner: F1 card.
- Confirmation by the F1 card (reader of the `root` key) and the F3 card (extender) of the config file's name, location and format, already set under Rules by default. Owner: implementation lead, with the F1 and F3 cards.

Closed by default: the near-duplicate score, the no-index behaviour, the match rule, the queue gates, the backlink target, the id rule, the merge semantics and the config precedence are all written as Rules above, each with its owner.
