# F2 findings — knowledge_capture (card 159)

Investigator: investigate:U1:1, re-verified by investigate:U1:2, 2026-11-19 (citations re-checked:
MCP_TOOLS :1931, callMcpTool :1998, handleMcpMessage :2019, serveMcp :2072, searchIndex :1265,
graphNeighbors :1792, findKnowledgeRoot :175; hook job block :263-294; knowledge-mcp.mjs imports
serveMcp; no noah/genna in scripts/hooks/servers).

**Drafter, attempt 2:** the gate rejected attempt 1 only because the PRD had no `## Scope` heading.
The PRD must carry exactly these headings: `## Goal`, `## Scope`, `## Out of scope`,
`## User stories`, `## Open questions`. `## Scope` lists what F2 builds: the knowledge_capture tool
(MCP_TOOLS entry + callMcpTool branch), note + catalog writer, link/backlink engine, per-instance
config + published schema, shared job helper extracted from the hook, README/KOR rows in F1's table.

Original line: Every line under "Findings" cites a file I opened in
this worktree. "Unknowns" are decisions no source answers. Do not turn an unknown into a rule.

## Findings (source-cited)

### MCP server today
- **Tool list** is one array `MCP_TOOLS` at `knowledge/scripts/sqlite-knowledge.mjs:1931-1996`:
  `knowledge_index`, `knowledge_search`, `knowledge_get`, `knowledge_neighbors`, `knowledge_status`.
  There is **no `knowledge_root` tool** (the card's "root" in its list is not a tool; `indexStatus`
  returns a `knowledge_root` field at :763). The README table at `knowledge/README.md:301-309` lists
  the same five tools — the PRD must add a `knowledge_capture` row there (README + KOR, R3).
- **Dispatch** is `callMcpTool(root, dbPath, name, args)` at :1999-2013, an if-chain ending in
  `throw new Error('Unknown tool: …')`. `handleMcpMessage` (:2019-2069) returns `MCP_TOOLS` for
  `tools/list` and wraps results as `{content:[{type:'text',text:JSON}], structuredContent}`; errors
  as `isError: true`. `serveMcp` (:2072-2093) is only the stdin line loop. So a new tool = one entry
  in `MCP_TOOLS` + one branch in `callMcpTool`; serveMcp itself needs no change.
- **Codex registration reuses the tool list.** `knowledge/servers/knowledge-mcp.mjs` (19 lines)
  imports `serveMcp` from `../scripts/sqlite-knowledge.mjs` and is the stdio entry for both
  manifests: `knowledge/.claude-plugin/plugin.json` (`${CLAUDE_PLUGIN_ROOT}/servers/knowledge-mcp.mjs
  --root ${CLAUDE_PROJECT_DIR}`) and `knowledge/.codex-plugin/plugin.json` (`${PLUGIN_ROOT}/servers/
  knowledge-mcp.mjs`, **no `--root`**, so root falls back to `CLAUDE_PROJECT_DIR || cwd`,
  knowledge-mcp.mjs:5-9). Consequence for A2.7: no separate Codex registration code is needed; the
  tool appears on Codex because the manifest points at the same server. A2.7 is met by a test that
  `tools/list` contains `knowledge_capture` + a real Codex invocation (compat-codex.md: "parsing
  alone is not enough"). Neither manifest lists tools individually.
- **Root handling:** `callMcpTool` receives the raw `--root`; read tools resolve it through
  `openIndex` → `findKnowledgeRoot` (:887-888, :175-183: the root itself if it has artifacts, else
  nested `knowledge-system`/`knowledge-base`/`knowledge-artifacts`). The hook has its **own,
  different** `findKnowledgeRoot(cwd, filePath)` (`knowledge/hooks/knowledge-delta-check.mjs:69-84`,
  marker score walk-up). Where capture writes is a root-resolution question → F1.

### Search / neighbors entry points (what F4 keeps)
- `searchIndex(inputRoot, query, options)` :1265, async; requires an index (`openIndex` throws
  `SQLite knowledge index not found … Run knowledge_index first.` :890-891). Returns
  `{query, root, database, retrieval, …diagnostics, results:[…]}` (:1395ff); test at
  `sqlite-knowledge.test.mjs:452` reads `results[0].id`. `group:'note'` default keeps one hit per note.
- `graphNeighbors(inputRoot, query, options)` :1792, sync; matches node by id / canonical_name, then
  LIKE on canonical_name / aliases_json; returns `{root, database, query, node:{id, canonical_name,
  label, aliases}|null, edges:[{id, source, target, relationship_type, evidence, source_refs}]}`
  (:1843-1856). Needs a built index with graph tables.
- `getDocument(inputRoot, id, options)` :1771. All three are exported (:2123-2144).
- The indexer **only indexes Markdown listed in `_knowledge/catalog.jsonl` by `path`**
  (`knowledge/skills/sqlite-index-builder/SKILL.md:36`). A captured note is therefore invisible to
  search until its catalog row exists and the index is rebuilt (embed queue).

### Delta hook job writer (the helper F2 extracts)
- `main()` in `knowledge/hooks/knowledge-delta-check.mjs:240-298`; the job-writing block is
  :263-294: builds `jobBase {file, reason:'post-tool knowledge delta', queued_at}` and appends to
  `_knowledge/jobs/` `catalog-delta-queue.jsonl` (with `note_id, operation:'upsert-note',
  scope:'single-note', beta:true`), `answerability-check-queue.jsonl`, `embed-queue.jsonl`,
  `graph-update-queue.jsonl`, `ontology-review-queue.jsonl`, each gated by a flag from `analyze()`
  (:188-238). It also writes `_knowledge/checks/latest.json` and `_knowledge/reports/
  delta-checks.jsonl`. `appendJsonl` is at :182-185.
- Gates that matter for capture: `catalog_delta_needed` only when `_knowledge/catalog.jsonl`
  already exists (:216); `rag_delta_needed` (embed) only when `_rag/` exists (:219);
  `graph_delta_needed` only when `_graph/` exists and (file newer than nodes/edges or has links)
  (:220-221). A2.6 says catalog, graph and embed queues "receive the job" — on a vault with no
  `_rag/` or `_graph/` the current gates would write none (see Unknown 4).
- The hook is registered PostToolUse on `Write|Edit|MultiEdit|NotebookEdit`
  (`knowledge/hooks/hooks.json`). An MCP tool call is not one of those, so the hook never fires for
  a capture → capture must call the shared helper itself (the request's reason for the extraction).
- `analyze()` already checks frontmatter (`title`, `sources`) and broken wikilinks via
  `linkExists` (:164-172: matches path, `notes/<x>`, `mocs/<x>` or bare basename). This is a ready
  dead-link oracle for the A2.6 test.
- Hook test file `knowledge/hooks/knowledge-delta-check.test.mjs` exists; the hook comment at
  :290-297 says it is **fail-open** (catch-all in entrypoint). The extraction must keep that.

### Note, catalog and link conventions (skills — prose sources)
- Note template `knowledge/skills/base-builder/references/note-templates.md:1-45`: frontmatter
  `id, title, type, domain, status, confidence, tags, aliases, entities, sources, related`; body
  `# Title`, summary, `## Key Points`, **`## Related`** with `- [[Note]]` lines, `## Sources`.
- Linking conventions (same file :61-68): "Keep important notes reachable from `index.md` or a MOC
  within two clicks"; "Avoid orphan notes unless … listed in `open-questions.md`".
- Catalog record contract `knowledge/skills/base-builder/references/retrieval-layout.md:29-45`:
  one JSON object per note: `id, path, title, summary, type, domain, tags, aliases, user_terms,
  source_symbols, lookup_layers, entities, source_refs, status, confidence`; "Resolve every catalog
  path to exactly one note. Reject duplicate IDs."; `id` stable across moves.
- Frontmatter field table :76-100 (`related` "gives graph extraction a cleaner edge seed").
- base-builder SKILL.md:66 lists the quality checks A2.6 mirrors: orphan notes, duplicate IDs or
  titles, dead links.
- Default layout `knowledge/README.md:113-122`: `knowledge-system/{index.md, notes/, mocs/,
  _knowledge/catalog.jsonl, _ontology/, _graph/, _rag/}`. `notes/` and `mocs/` already exist in the
  layout; F2 adds rows for them in F1's table, plus the config file.
- `validate-knowledge.mjs:86` already rejects duplicate catalog ids — reusable in tests.

### Config / instance today
- No per-instance config file exists. Engine settings are env vars only: `KNOWLEDGE_DB_PATH`
  (:186), `KNOWLEDGE_EMBED_PROVIDER`, `KNOWLEDGE_EMBED_MODEL`, `OLLAMA_HOST` (:62-64, :2002-2004).
  `grep noah|genna` over knowledge/ code: none found by my reads (engine is already instance-free).
- Ontology today lives as vault artifacts `_ontology/{ontology.md, ontology.yml, mapping.md}`
  (README:120), produced by the `ontology-builder` skill — not engine config.

### Tests / checks
- Test style: `node:test` + `node:assert/strict`, a `fixture(async (root) => …)` temp dir and a
  `seed(root)` vault; MCP tested via `handleMcpMessage` directly
  (`knowledge/scripts/sqlite-knowledge.test.mjs:432-454`).
- `_repo/scripts/check-copies.mjs` has no knowledge entry (grep "knowledge": no match), so R2's
  check-copies runs but F2 touches no vendored copy.

### Settled (by the person, brainstorm 2026-11-19) — write as rules
- Save path = a write tool `knowledge_capture` in the knowledge MCP.
- Linking: the engine computes candidates with search/neighbors; a link only when the concept
  appears in the text; add the backlink; report in result fields.
- Generic engine: noah, genna and general projects use one engine via config.
- Request (also settled): F3 extends F2's config schema; F4 keeps search/neighbors names and return
  shapes; F2 does not resolve the root; helper extraction is F2's only hook edit.

### Layout risk (from critique)
- `docs/` is not a plugin; `teams/mcp/layout-guard.mjs:17-28` flags new non-plugin top-level dirs,
  scoped (its :1-7 comment) to QA/audit/repair commits. Required path is `docs/prd/…`; this run's
  worktree is private and the manager merges into 10-prd.md, so I kept the required path.

## Requirements analysis

### Actors
- MCP client (Claude, Codex, noah, genna, a general project) — calls `knowledge_capture`.
- Engine (`sqlite-knowledge.mjs`) — dedups, computes links, writes note/catalog/backlinks/jobs.
- Delta hook — shares the job writer.
- Instance owner — writes the per-instance config.

### Rules (with source)
- One tool entry + one dispatch branch; Codex sees it via the shared server (sqlite-knowledge.mjs
  :1931, :1999; knowledge-mcp.mjs; .codex-plugin/plugin.json).
- Note shape = note-templates.md template; catalog row = retrieval-layout.md contract; ids unique.
- Link only on in-text appearance (settled); backlink into `## Related` or a MOC (request).
- Jobs go to `_knowledge/jobs/{catalog-delta,graph-update,embed}-queue.jsonl` through the helper
  extracted from hook :263-294.

### Items
- F2 item 1 (card 159):
  - F2-AC-1 note file + frontmatter + catalog row (A2.1)
  - F2-AC-2 merge on title / alias / near-duplicate (A2.2)
  - F2-AC-3 candidates from search/neighbors, in-text only (A2.3)
  - F2-AC-4 backlink, never orphan (A2.4)
  - F2-AC-5 response fields (A2.5)
  - F2-AC-6 tests: 0 dead links, not orphan, no dup id/title, 3 queues (A2.6)
  - F2-AC-7 Codex sees the tool; validator passes (A2.7)
  - F2-AC-8 per-instance config, schema published, no instance names (R1)
  - F2-AC-9 shared job helper, only hook edit (request)
  - F2-AC-10 README/KOR rows in F1's shape (R3)

### Open questions
See Unknowns below (each also returned in unknowns[]).

## Unknowns (no source answers these)
1. Near-duplicate rule: which score and threshold from `searchIndex` makes "the same concept"? The
   hash provider is lexical-only (`retrieval: lexical-baseline`), so scores differ by provider. Owner: implementation lead (knowledge).
2. No index yet (fresh vault / `openIndex` throws): does capture fail, or save with only exact
   title/alias checks against `catalog.jsonl` and report search-based candidates as skipped? Owner: PO.
3. What "appears in the text" means: exact title/alias match, case-folded, Korean inflection
   (trigram)? Owner: implementation lead.
4. Queue gates: the hook writes embed/graph jobs only when `_rag/`/`_graph/` exist. Should capture
   always enqueue catalog+graph+embed (A2.6 wording), or keep the hook's gates? Owner: PO.
5. Backlink target when there is no `## Related` section: append one, or write to a MOC — and
   which MOC? Owner: PO.
6. Note id: slug of the title, or caller-supplied? Collision with an existing id but different
   title? Owner: implementation lead.
7. Merge semantics: does `merged_into` append the new content/sources to the existing note, or
   create nothing and change nothing? (Request: "creates nothing".) Owner: PO.
8. Config file name/location/format (e.g. `<root>/_knowledge/config.json`) and env-var precedence.
   Owner: implementation lead; F1 (root key consumer) and F3 (extender) confirm.
9. Write root when the server is started without `--root` (Codex manifest) — resolved by F1's
   resolver; F2 needs F1's resolver function name. Owner: F1 card.
