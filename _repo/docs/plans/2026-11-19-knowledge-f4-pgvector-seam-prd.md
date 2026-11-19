# PRD section F4 — Grow from sqlite to pgvector when the store gets large (card 161)

Findings: `_repo/docs/plans/2026-11-19-knowledge-f4-pgvector-seam-prd-findings.md` (cited below as "finding N"). Line numbers are for commit 7810ad53, file `knowledge/scripts/sqlite-knowledge.mjs` unless named otherwise.

## Goal

The four store functions (search, index, get, neighbors) go through one backend interface with sqlite as the only wired backend. A user can run `migrate` to copy a sqlite store into pgvector, and `status` says when the store is large enough that pgvector is advised. This prepares card 162 (the pgvector query backend, next Sprint) without changing any function name or return shape that F2's link-candidate code and the MCP tools rely on.

## Problem

The request assumes `postgres-sync.mjs` can be reused for migrate. The findings show it reads jsonl only and never sqlite (finding 11), and only `rag_chunks` has an embedding column, so sqlite's note and node embeddings, `document_relations` and `metadata` have no target table (findings 12-13). Today `searchIndex` (L1265), `getDocument` (L1771) and `graphNeighbors` (L1792) each open sqlite directly through `openIndex` (L887-900), with no interface in between (finding 1). Search is a brute-force scan: every row is selected and cosine is computed in JS (L1284-1295), so cost grows linearly with document count (finding 4). `indexStatus` (L1889-1929) reports `bytes` from the main file only, not the WAL, and has no threshold or advisory (finding 20). No threshold has been measured yet, so none is stated here.

## Scope

- A backend interface placed at the `openIndex` level, so `searchIndex`, `buildIndex`, `getDocument`, `graphNeighbors` and also `listDocuments`, `evalQuestions` and `sweepFusionWeights` reach the store through it. sqlite is the only implementation. (default - revisit with implementation lead)
- A CLI command `sqlite-knowledge.mjs migrate`, added to `main` (L2095-2113) and the `parseArgs` whitelist (L123). It is CLI only, no MCP tool and no `.codex-plugin` change. (default - revisit with PO)
- `status` additions: document count, DB size, the threshold, and an `advised` flag.
- A bench that measures the threshold and verifies migrate against a docker postgres with pgvector.
- README.md and KOR.md rows for migrate and status, added to F1's table, with the threshold value and how it was measured.

## Out of scope

- The pgvector query backend that replaces sqlite (card 162, next Sprint; backlog.md L670-673, finding 26). F4 ships no pgvector read path.
- Root resolution (F1). `findKnowledgeRoot` is at L175-183 and F4 keeps calling `findKnowledgeRoot(inputRoot)` with its current signature; if F1 moves it, F4 updates only the import (finding 29).
- `knowledge_capture` (F2, card 159) and the Docker graph build (F3, card 160).
- Any change under `harness/` or `graph/`, and any version bump.
- `.claude/conventions/*.md` are unfilled templates (finding 28), so no convention rule beyond the repo rules binds this area.

## User stories

### F4-US-1 — Card 161, seam: move search/index/get/neighbors behind a backend interface with sqlite as the only wired backend

Each function keeps its name, signature and return shape (findings 3, 5, 6): `getDocument` returns `{root, database, results[...]}`, `graphNeighbors` returns `{root, database, query, node, edges}`, and the exports at L2123-2144 are unchanged, so F2's link-candidate code and the MCP tools need no change.

**Acceptance**
- A4.1: sqlite-knowledge search/index/get/neighbors go through one backend interface; existing knowledge test suites stay green with counts reported
  - finding: baseline is 72 declared tests by grep (45 + 15 + 4 + 8); `node --test` was not run, so the build package reports real pass/skip counts before and after the seam (findings 22-23).
- R1: Shared engine: noah, genna personal graphs and general projects all use it — per-instance root, ontology and link policy are config; no instance name in engine code (user: "우리 지식 저장소를 upgrade 할거고 이걸 noah, genna에서 개인화 그래프 용도로도 사용할거야 범용도 있고")
- R2: Checks: python3 _repo/scripts/validate_plugins.py, node _repo/scripts/check-copies.mjs, node --test knowledge/scripts/*.test.mjs knowledge/hooks/*.test.mjs, counts reported
- R3: No version bump in this Sprint (batched release); README.md and KOR.md move together
- R4: Real runs use copies under tmp/, never a live vault; tmp/ cleaned after results are recorded
- R5: Edit files with Read/Edit/Write only; harness/ and graph/ untouched

### F4-US-2 — Card 161, migrate: add `migrate` that moves documents, embeddings and graph from sqlite to pgvector (reuse scripts/postgres-sync.mjs where it fits)

Rules (all default - revisit with the named owner):
- Table mapping (implementation lead): reuse the postgres-sync tables; add nullable `embedding vector` columns to `notes` and `graph_nodes`; add `document_relations` and `index_metadata` tables. sqlite `note` rows go to `notes`, `chunk` rows to `rag_chunks`, `node` rows to `graph_nodes` (findings 8, 12-13). Row arrays are built from sqlite and passed to `upsertSql(config, {catalog, rag, nodes, edges})`, which takes arrays and is exported (finding 18). Migrate reads sqlite, not jsonl, so it carries sqlite's embeddings (finding 11).
- Edge ids: migrate copies sqlite's `edge_id`, because postgres-sync hashes differently (finding 10).
- Counts compare live rows only: `deleted_at IS NULL` for the workspace (finding 14).
- Dimensions: refuse with a message naming both limits when sqlite dimensions exceed 2000 (pg limit, finding 15; sqlite allows up to 4096, finding 9).
- Target comes from `.knowledge/postgres.json` (`workspace_id`, `schema`) or env, never a hard-coded name (finding 27).
- Bench reaches postgres by piping SQL into psql inside the pgvector container via `docker exec`, since `runPsql` needs psql in PATH and is not exported (findings 16, 18).
- Known limit: values are inlined in one SQL string, so a large store makes a large stdin script (finding 17); the bench records the size at which this bites.

**Acceptance**
- A4.2: migrate copies documents, embeddings and graph rows to pgvector; row counts equal source; verified against a docker postgres with pgvector (unique container name, no host port, torn down by exact name)
  - finding: the existing postgres-sync tests check SQL text only, never a live postgres (finding 23).
  - finding: `compose.yaml` has no postgres service (finding 24), so the bench container is started by the test or bench script, never `prune`d (finding 25).
- R1: Shared engine: noah, genna personal graphs and general projects all use it — per-instance root, ontology and link policy are config; no instance name in engine code (user: "우리 지식 저장소를 upgrade 할거고 이걸 noah, genna에서 개인화 그래프 용도로도 사용할거야 범용도 있고")
- R2: Checks: python3 _repo/scripts/validate_plugins.py, node _repo/scripts/check-copies.mjs, node --test knowledge/scripts/*.test.mjs knowledge/hooks/*.test.mjs, counts reported
- R3: No version bump in this Sprint (batched release); README.md and KOR.md move together
- R4: Real runs use copies under tmp/, never a live vault; tmp/ cleaned after results are recorded
- R5: Edit files with Read/Edit/Write only; harness/ and graph/ untouched

### F4-US-3 — Card 161, status: `status` reports store size against a measured threshold and says when pgvector is advised

`indexStatus` (L1889-1929) keeps calling `findKnowledgeRoot(inputRoot)` with its current signature; if F1 moves the resolver, F4 updates only the import. It adds the document count, the DB size (including the WAL file, which today's `bytes` omits: L1924, L580, finding 20), the threshold, and whether pgvector is advised. F4 adds its migrate/status rows to F1's README/KOR table.

Threshold rule (default - revisit with implementation lead, PO accepts the number): the value is to be measured by the build package, not stated now. Method: synthetic corpora of 1k, 10k, 50k and 100k documents under `tmp/` on this CPU-only 13 GB machine; measure `searchIndex` p95 latency and RSS; the threshold is the first size whose p95 exceeds a budget the PO names. README/KOR name the dataset, hardware and criterion.

**Acceptance**
- A4.3: status reports documents and DB size and names the threshold and whether pgvector is advised; threshold value and how it was measured stated in README/KOR
  - finding: search cost is linear in document count (finding 4), which is what the measurement targets.
- R1: Shared engine: noah, genna personal graphs and general projects all use it — per-instance root, ontology and link policy are config; no instance name in engine code (user: "우리 지식 저장소를 upgrade 할거고 이걸 noah, genna에서 개인화 그래프 용도로도 사용할거야 범용도 있고")
- R2: Checks: python3 _repo/scripts/validate_plugins.py, node _repo/scripts/check-copies.mjs, node --test knowledge/scripts/*.test.mjs knowledge/hooks/*.test.mjs, counts reported
- R3: No version bump in this Sprint (batched release); README.md and KOR.md move together
- R4: Real runs use copies under tmp/, never a live vault; tmp/ cleaned after results are recorded
- R5: Edit files with Read/Edit/Write only; harness/ and graph/ untouched

## Open questions

Each unknown from investigate is carried with its owner. Where the run was not interactive, the stated default was taken as the rule above and is to be revisited with the owner.

1. How do sqlite's documents (note/chunk/node rows, each with an embedding), document_relations and metadata map onto pg tables, given postgres-sync's row builders read jsonl and only rag_chunks has an embedding column? 'Row counts equal source' is only checkable once this is fixed. [owner: implementation lead] — default taken in F4-US-2 (reuse tables, add embedding columns, add two tables).
2. Is migrate a CLI subcommand, an MCP tool, or both? [owner: PO] — default: CLI only (Scope).
3. How is the pgvector threshold measured: which dataset, hardware, metric and criterion? [owner: implementation lead (PO accepts the number)] — default method in F4-US-3; the value stays unmeasured until the build package runs it, and the PO must name the latency budget.
4. What does migrate do when the sqlite embedding dimensions exceed pg's 2000 limit (sqlite allows up to 4096)? [owner: implementation lead] — default: refuse naming both limits (F4-US-2).
5. How does migrate reach postgres in the docker bench when no host port is allowed (runPsql needs psql in PATH)? [owner: implementation lead] — default: `docker exec` into the pgvector container (F4-US-2).
6. Dependency on F1: where does findKnowledgeRoot live after F1, and which README/KOR table do the migrate and status rows join? [owner: PLAN-F1 / shape stage] — a dependency, not planned here; F4 changes only the import and adds its rows.
7. Do listDocuments, evalQuestions and sweepFusionWeights (which also read through openIndex/searchIndex) go behind the backend interface, or only the four named functions? [owner: implementation lead] — default: seam at the `openIndex` level (Scope).
