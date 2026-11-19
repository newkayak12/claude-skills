# Findings — F4: grow from sqlite to pgvector (backend seam, migrate, size advisory, card 161)

Stage: investigate:U1:1 (E-f9145f5b / PLAN-F4), 2026-11-19. Every finding cites the file it came
from. Line numbers are for commit 7810ad53. Unknowns are listed apart and are not findings.

## Sources opened

- `knowledge/scripts/sqlite-knowledge.mjs` (2145 lines): L1-210, L273-394, L560-719, L780-900, L1265-1324, L1765-2145
- `knowledge/scripts/postgres-sync.mjs` (629 lines, whole file)
- `knowledge/scripts/postgres-sync.test.mjs` (test names)
- test counts by grep of `test(` in `knowledge/{scripts,hooks}/*.test.mjs`
- `knowledge/README.md` L1-60 (by grep), L215-232, L296-315
- `knowledge/compose.yaml` (by grep: profiles, images)
- `_repo/docs/backlog.md` cards 161 and 162 (L662-673)
- `_repo/docs/plans/mod/2026-10-18-f4-teams-pane-prd.md` (house shape of a PRD section)
- `.claude/conventions/{boundaries,coding,verification}.md` (given in the briefing; all three are still unfilled templates)
- `.claude/rules/maintaining.md` § Benches and experiments (given in the briefing)

## Findings

### The four functions the seam covers (today)

1. **Every read opens sqlite directly.** `searchIndex` (L1265), `getDocument` (L1771) and
   `graphNeighbors` (L1792) each call `openIndex(inputRoot, options.db)` (L887-900). `openIndex`
   resolves the root with `findKnowledgeRoot` and the path with `resolveDbPath`. It opens the file
   read-only with `openSqlite` and refuses a `metadata.schema_version` other than `SCHEMA_VERSION`
   `'5'` (L38). The functions then run SQL against `db` inline. No interface sits between them and
   sqlite. `listDocuments` (L1862) and `evalQuestions`/`sweepFusionWeights` also read through
   `openIndex` or `searchIndex`. They are not named in card 161.
2. **`buildIndex` (L703) is the "index" function.** It calls `findKnowledgeRoot` (L704) and
   `collectKnowledge` (L715), which reads the jsonl and Markdown. It computes embeddings, reusing
   them through `loadEmbeddingCache` (L672-701). Then it drops and recreates the schema
   (`createSchemaTables`, L578-655) and inserts rows in one transaction (L780-850). It returns a
   counts object: documents, notes, chunks, nodes, edges, relations and embedding facts (L858-880).
3. **Return shapes the seam must keep.** These come from the code.
   - `getDocument` returns `{root, database, results[{kind,id,note_id,path,title,section,text,source_ref,domain,metadata}]}` (L1782-1786).
   - `graphNeighbors` returns `{root, database, query, node:{id,canonical_name,label,aliases}|null, edges[{id,source,target,relationship_type,evidence,source_refs}]}` (L1837-1856).
   - `searchIndex` takes the same `{root, database}` header plus results (L1265 onward). Every
     shape carries `database`, a sqlite file path, from `resolveDbPath`.
4. **Search is a brute-force scan in JS.** `searchIndex` selects every row of `documents` that
   passes the filter (L1284). It decodes each `embedding` BLOB and computes `cosine` in JS for
   every row (L1289-1295). Then it runs two FTS5 queries (`documents_fts` and `documents_trgm`,
   L1299-1300) and relation promotion over `document_relations` (L1302). So search cost grows
   linearly with the document count, in time and in memory. This is the scaling cliff a size
   threshold would measure. A threshold drawn from it is a measurement for the build package to
   take, not a number known today.
5. **The CLI entry and the MCP entry both call the functions by name.**
   - `main` (L2095-2113) dispatches the commands `index|search|neighbors|get|status|eval|list|serve`.
   - `parseArgs` whitelists the same set (L123). A new `migrate` command must be added to both
     places.
   - `callMcpTool` (L1998-2013) maps the tools `knowledge_index/search/get/neighbors/status` to
     `buildIndex/searchIndex/getDocument/graphNeighbors/indexStatus`.
   - `MCP_TOOLS` (L1931-1996) holds five tools. There is no `knowledge_root` tool, although the
     request text lists one. F2 adds `knowledge_capture` (card 159).
6. **Exports** (L2123-2144) include `buildIndex`, `searchIndex`, `getDocument`, `graphNeighbors`,
   `indexStatus`, `findKnowledgeRoot`, `callMcpTool` and `handleMcpMessage`. The tests and F2's
   link-candidate code import these names, so the names and signatures must not change.

### sqlite store layout (source side of migrate)

7. **Tables** (`createSchemaTables`, L590-653):
   - `metadata(key,value)`.
   - `documents`: rowid, kind, document_id, note_id, path, title, section, text, terms, body,
     source_ref, domain, metadata_json, text_hash, `embedding BLOB NOT NULL`, UNIQUE(kind,
     document_id).
   - `documents_fts` and `documents_trgm`: external-content FTS5 over documents, so they hold no
     rows of their own to migrate.
   - `document_relations(document_rowid, relation_type, participant_note_id)`.
   - `graph_nodes(node_id, canonical_name, label, aliases_json, properties_json)`.
   - `graph_edges(edge_id, source_node_id, target_node_id, relationship_type, evidence,
     source_refs_json, properties_json)`.
8. **`documents` holds three kinds of row**, all in one table and each with an embedding:
   - `note`: one per catalog row (L292-305);
   - `chunk`: one per `_rag/chunks.jsonl` row (L331-344);
   - `node`: one per `_graph/nodes.jsonl` row (L351-371).

   A note's `text` is its metadata vocabulary plus the Markdown body (L298). A chunk's `text` is
   its context plus the passage (L326).
9. **Embedding storage.**
   - Vectors are stored as a BLOB (`vectorBuffer`/`bufferVector`, L543-551).
   - The dimension is set at build time: `DEFAULT_DIMENSIONS` 384 (L35), and `--dimensions` must
     be 32-4096 (L132).
   - The provider is `hash` (default, `local-hash-v1:<dims>`) or `ollama` (`embeddinggemma`)
     (L706-708).
   - Provider, model, prompt and schema version are kept in `metadata` (read at L677-687).
10. **Graph edge ids differ between the two code paths.** sqlite takes `record.id || record.edge_id
    || edgeIdentity(record)`. `edgeIdentity` hashes `{source,target,type,evidence}` (L657-664,
    L841). postgres-sync hashes `{sourceNodeId,targetNodeId,relationshipType,evidence,sourceRefs}`
    with `stableJson` (postgres-sync L219-227). The same jsonl edge without an id therefore gets a
    different `edge_id` in each store. A migrate that copies sqlite's `edge_id` keeps the sqlite
    ids.

### postgres-sync.mjs (target side, "reuse where it fits")

11. **It reads jsonl only, never sqlite.**
    - `catalogRows` reads `_knowledge/catalog.jsonl` (L115-144).
    - `ragRows` reads `_rag/chunks.jsonl` (L146-179). Its embedding comes from the jsonl record's
      `embedding` field, or NULL (L156).
    - `graphNodeRows` and `graphEdgeRows` read `_graph/*.jsonl` (L181-240).
    - `loadArtifacts` bundles them (L495-502).

    The card's own Why says the same: "`postgres-sync.mjs` upserts chunks.jsonl to pgvector but
    cannot carry sqlite's embeddings" (backlog.md L664).
12. **pg schema** (`createSchemaSql`, L262-375):
    - It creates the `vector` and `pg_trgm` extensions and a schema (default `knowledge`, L46).
    - Tables `workspaces`, `notes`, `rag_chunks`, `graph_nodes` and `graph_edges`, each keyed by
      `(workspace_id, <id>)`, with `content_hash`, `sync_batch` and `deleted_at`.
    - Only `rag_chunks` has an `embedding vector` column (L316). `notes` and `graph_nodes` have
      none.
    - There is no table for sqlite's `node`-kind documents as documents, none for
      `document_relations`, and none for `metadata`.
    - An HNSW cosine index is created only when `embedding_dimensions` is configured (L264-266).
13. **The mapping is not 1:1.** sqlite `documents` (note + chunk + node rows, each with an
    embedding) has to be split. Notes go to `notes`, chunks to `rag_chunks`, and node-kind
    documents to `graph_nodes`. Note and node embeddings have no column to land in, and
    `document_relations` and `metadata` have no table. Derived from findings 7, 8 and 12.
    "Row counts equal source" (A4.2) is only checkable once a per-table mapping is fixed, and that
    is an unknown (U1).
14. **Upsert semantics** (`upsertSql`, L377-493).
    - It is one `BEGIN…COMMIT` script of `INSERT … ON CONFLICT DO UPDATE`.
    - Every row not in the current `sync_batch` is soft-deleted (`deleted_at = now()`, L407-410
      and its siblings).
    - So a "row count in pg" must count `deleted_at IS NULL` for the workspace. A raw `count(*)`
      includes soft-deleted rows from earlier syncs.
15. **Config** (`loadConfig`, L38-66): reads `.knowledge/postgres.json`.
    - `workspace_id` is required: a non-empty string.
    - `schema` is an identifier.
    - `embedding_dimensions` is 1-2000 (L48-54), while sqlite allows up to 4096 (finding 9). An
      index built with more than 2000 dimensions cannot get the HNSW index.
    - The per-instance key is `workspace_id`. That fits R1, since an instance name is config and
      not code.
16. **Connection and execution** (L504-534).
    - `connectionEnv` takes `DATABASE_URL` or libpq `PG*` variables and keeps credentials out of
      argv (test at postgres-sync.test.mjs L107).
    - `runPsql` pipes SQL to a `psql` binary found in PATH. With no host port allowed (A4.2), psql
      must reach postgres from inside the container or from a sibling container on the same docker
      network. The bench design is the build package's to decide.
17. **Values are inlined into one SQL string.** `q`, `qJson`, `qArray` and `qVector` build
    literals (L242-260), and `qVector` writes `'[v1,…]'::vector`. A large store becomes one large
    SQL text on psql's stdin. This is a scaling limit for migrate. Nobody has measured it.
18. **Exports usable by migrate** (L616-628): `createSchemaSql`, `upsertSql`, `connectionEnv`,
    `loadConfig`, `stableJson`, plus the row builders. `upsertSql(config, {catalog, rag, nodes,
    edges})` takes row arrays, so migrate can build those arrays from sqlite rows instead of
    jsonl and reuse the schema and upsert SQL. `runPsql` is not exported (L525, not in L616-628).
19. **postgres-sync is undocumented and unwired.**
    - README mentions pgvector once, as a rag-corpus target (README L220). There is no usage
      section for `postgres-sync.mjs`.
    - No hook references it: grep "postgres" in knowledge/ matches only postgres-sync.mjs and its
      test.
    - `artifactFingerprint` watches `_knowledge/jobs/postgres-sync-queue.jsonl` (L543). No code
      found writes that file.

### status today

20. **`indexStatus`** (L1889-1929):
    - It calls `findKnowledgeRoot(inputRoot)` (L1890) and `resolveDbPath`.
    - With no DB it returns `{root, database, exists:false, stale}`.
    - Otherwise it returns `{root, database, exists, stale, metadata, counts (per kind), graph
      {nodes, edges}, filters, bytes}`. `bytes` is `statSync(database).size` (L1924).
    - It does not count the WAL file. `journal_mode = WAL` is set at L580, so `.sqlite-wal` and
      `.sqlite-shm` can add size beside the main file.
    - It reports no threshold and no advisory today.
21. **The MCP `knowledge_status` description** is "Report index location, source freshness,
    counts, and embedding configuration" (L1993). The README row reads "Index presence, freshness,
    counts, embedding config" (README L305).

### Tests (baseline)

22. **Test counts** come from `test(` declarations, by grep:
    - `sqlite-knowledge.test.mjs`: 45
    - `validate-knowledge.test.mjs`: 15
    - `postgres-sync.test.mjs`: 4
    - `hooks/knowledge-delta-check.test.mjs`: 8

    Total: 72 declared. This stage was not allowed to run `node --test`; approval was required.
    The build package must run the suites and report the actual pass/skip counts as the baseline
    before the seam lands.
23. The postgres-sync tests check SQL generation only (schema, upsert, soft delete, config). No
    test runs against a live postgres (test names, postgres-sync.test.mjs L30, L56, L75, L107).

### Docker and environment

24. **`knowledge/compose.yaml`** has a `semantic` profile with `ollama/ollama:latest` (L10, L30-31).
    It has no postgres or pgvector service.
25. **Docker rules for the bench** (maintaining.md § Benches): unique names, no host ports, tear
    down by exact name, never `prune`. Bench output goes in `tmp/` and is deleted once the result
    is recorded. R4 adds the same rule for vault copies.

### Boundaries and decisions

26. **Card 162 is the boundary.** It says: "MCP search/get/neighbors run on pgvector with the same
    results shape … the threshold from 161 picks the backend" (backlog.md L670-673). So 161 must
    produce a threshold that 162 can consume. The pgvector query backend is next Sprint (settled
    decision: "pgvector 수준 -> 이번 Sprint는 backend seam + migrate + size advisory(161) …
    다음 Sprint(162)", user in session brainstorm 2026-11-19).
27. **Shared engine** (settled, user in brainstorm): noah, genna and general projects all use one
    engine, configured per instance. In this code, the per-instance values are already arguments
    or env: `--root`, `--db`/`KNOWLEDGE_DB_PATH` (L185-187), and postgres `workspace_id`/`schema`
    (finding 15). Migrate must take its target from config or env, never from a hard-coded name.
28. **Conventions files are unfilled templates.** `boundaries.md`, `coding.md` and
    `verification.md` contain only `<!-- fill -->` placeholders, apart from "match the
    surrounding file's idiom" and "comments state constraints". The binding rules for this area
    therefore come from the repo rules: harness/ and graph/ stable (repo.md), and the checks
    table (maintaining.md).
29. **F1 boundary.** `findKnowledgeRoot` lives at L175-183 in this file. F1 owns root resolution
    and may move it into a shared module. F4 keeps calling `findKnowledgeRoot(inputRoot)` and
    updates only an import if it moves (stated in the request).

## Requirements analysis

### Actors
- **Instance owner**: runs the engine for one vault (noah, genna or a general project). Reads
  `status`, decides to migrate.
- **MCP client**: an agent calling knowledge_search/get/neighbors/status. Needs unchanged shapes.
- **F2 link-candidate code**: calls `searchIndex` and `graphNeighbors` by name.
- **Build package engineer and tester**: implement the seam, migrate and threshold; run the docker
  bench.

### Rules (from sources)
- R-a: The function names and return shapes of `searchIndex`, `getDocument`, `graphNeighbors`,
  `buildIndex` and `indexStatus` stay unchanged (findings 3, 5, 6; request).
- R-b: sqlite is the only wired backend this Sprint (settled decision; finding 26).
- R-c: Migrate reads sqlite and writes pg. It does not read jsonl, which is what makes it carry
  sqlite's embeddings (finding 11; backlog L664).
- R-d: A pg row count compares only live rows (`deleted_at IS NULL`, the workspace) (finding 14).
- R-e: The docker bench uses a unique name, no host port, exact-name teardown and no prune
  (finding 25).
- R-f: No instance name in engine code; target comes from config or env (finding 27, R1).

### Open questions
U1-U7 below. Each is also returned in unknowns[].

### Items
- **Item 1: seam (A4.1)**
  - F4-AC-1: the four functions route through one backend object; sqlite is the only
    implementation.
  - F4-AC-2: the suites listed in finding 22 pass with counts reported, before and after.
- **Item 2: migrate (A4.2)**
  - F4-AC-3: migrate copies live sqlite rows to pg.
  - F4-AC-4: for each table in the U1 mapping, the pg live count equals the sqlite count.
  - F4-AC-5: the docker pgvector bench is run under R-e.
- **Item 3: status (A4.3)**
  - F4-AC-6: status adds a document count, a DB size, the threshold and an `advised` boolean.
  - F4-AC-7: README/KOR state the threshold value and how it was measured, as one row in F1's
    table.

## Unknowns (no source answers these)

- **U1: Table mapping, sqlite → pg.**
  - The question: how do note, chunk and node documents and their embeddings,
    `document_relations` and `metadata` land in pg?
  - Why it is open: postgres-sync's row builders read jsonl, and only `rag_chunks` has an
    embedding column (findings 11-13).
  - Owner: implementation lead.
  - Options:
    1. (recommended) Reuse the postgres-sync tables. Add nullable `embedding vector` columns to
       `notes` and `graph_nodes`, and add `document_relations` and `index_metadata` tables. The
       mapping is then 1:1 per table, so the counts are checkable.
    2. Add a new `documents` table mirroring sqlite's. Counts become trivial, but the table is
       not reused by postgres-sync.
    3. Migrate chunks only. This breaks "documents, embeddings and graph".
- **U2: Entry point.** Is migrate a CLI subcommand, an MCP tool, or both? Owner: PO.
  - (recommended) CLI only: `sqlite-knowledge.mjs migrate`. It is a one-off admin act, and it
    needs no `.codex-plugin` change.
  - Both: adds an MCP write tool beside F2's and needs a Codex registration.
- **U3: Threshold method and dataset.** Owner: implementation lead, with the PO accepting the
  number.
  - The question: what is measured, on which corpus, on which hardware, and with which criterion?
  - (recommended) Synthetic corpora at document counts of 1k, 10k, 50k and 100k, built under
    tmp/, on this machine (CPU-only, 13 GB RAM). Measure `searchIndex` p95 latency and RSS. The
    threshold is the first size whose p95 exceeds a budget the PO names (e.g. 1 s).
  - Alternatively, use the DB bytes at which the full scan crosses that budget.
  - The README must name the dataset, the hardware and the criterion.
- **U4: Dimension mismatch.** What does migrate do with sqlite dimensions above 2000 (pg
  `embedding_dimensions` ≤ 2000, finding 15)? Owner: implementation lead.
  - (recommended) Refuse with a message naming both limits.
  - Copy without an HNSW index: the vector is stored but not indexed.
- **U5: psql reachability with no host port.** Owner: implementation lead.
  - (recommended) Run migrate's psql inside the pgvector container through `docker exec`, with
    the SQL on stdin, so there is no new dependency.
  - Alternatively, use a sibling node container on a named network.
  - Or add the `pg` npm client, which is a new runtime dependency.
- **U6: F1's resolver module and README/KOR table.** This is a dependency on F1, not F4's work.
  - Owner: PLAN-F1 / shape stage.
  - The question: where will `findKnowledgeRoot` live, and which table do the migrate and status
    rows join?
- **U7: Seam boundary.** Do `listDocuments`, `evalQuestions` and `sweepFusionWeights` (which also
  use `openIndex`) go behind the interface too? Owner: implementation lead.
  - (recommended) Yes, at the `openIndex` level, since one seam is cheaper than two paths.
  - No, only the four named functions.
