# PRD F2 — noah and genna run on the knowledge engine (card 164): plan and tmp-copy proof only

Findings: `2026-11-19-knowledge-noah-genna-on-engine-prd-findings.md` (every finding cites its source).

## Goal

Show, on paper and on a tmp/ copy, that noah and genna can serve from the one knowledge engine
instead of their own `server/{noah,genna}-mcp.mjs`: every instance tool has a destination, recall
on a noah-vault copy is at or above today's noah-server, the TEI embedding endpoint attaches as a
generic OpenAI-compatible provider, and the cut-over order is written down for the user to approve.

## Problem

Card 164 says each instance runs its own server doing keyword + vector RRF over
`_knowledge/vectors.{json,f32}`, embedded by TEI `intfloat/multilingual-e5-base` on a 04:00 timer,
with `tools/{ingest,fold,nightly,rebuild,mocs}` beside it. The knowledge engine already has the
pieces: six MCP tools (`knowledge_index/search/get/neighbors/status/capture`), CLI `eval/list/migrate`,
`knowledge-graph.mjs`, and a per-store `_knowledge/config.json` whose header says what differs between
stores lives there, never in engine code. The request assumed the engine could take the TEI
endpoint as configuration. The finding is otherwise: only `hash` and `ollama` embedding providers
exist and `queryEmbedding` throws on any other, so an OpenAI-compatible (`/v1/embeddings`) provider
is build work. There is also no persona key in the store config. The instance repos and
`~/docker/mcps` were not readable when this was investigated, so no `noah_*`/`genna_*` tool name,
competency question, recall number or TEI URL is stated here as fact. `noah-server` is in use.

## Scope

Rules (settled, not open):

- The Sprint takes cards 166 then 164. Card 162 (pgvector) stays deferred, the p95 400 ms threshold
  is unchanged, and card 165 stays on the backlog (user, 2026-11-19).
- Card 164 goes as far as this plan, the tmp-copy recall proof and one TEI embed call. No container,
  nginx or live-vault change.
- Real runs use copies in tmp/ and Docker with unique names and no host ports, torn down by exact
  name, never pruned. tmp/ is cleared after the numbers are reported.
- Any engine change needed to read an OpenAI-compatible embedding endpoint or a per-store config
  stays generic and names neither noah nor genna. The existing test "no instance name appears in
  engine code" (`knowledge/scripts/knowledge-capture.test.mjs` L189-196) must stay green.
- The build package reads the instance repos read-only and fills the tool-map rows.
- Recall is `recall_at_k@10` over the same `_knowledge/questions.jsonl`, measured by CLI `eval` on the
  index the MCP serves plus one MCP `knowledge_search` smoke call.
- Embedder: `KNOWLEDGE_EMBED_PROVIDER=openai` with `KNOWLEDGE_EMBED_URL` / `KNOWLEDGE_EMBED_API_KEY`,
  also readable as `embed.*` in `_knowledge/config.json`; an e5 family entry (`query: ` / `passage: `)
  is added to `EMBEDDING_PROMPTS`.
- The tmp copy re-embeds through the existing TEI endpoint, read-only.
- Defaults taken because nobody is here to answer (each "default - revisit"): a recall shortfall is
  reported as a fail with both numbers (default - revisit with knowledge engine owner); the nightly
  and rebuild rows map to CLI `index` now, with PLAN-F1's incremental graph build noted as a later
  change (default - revisit with user/PO); today's noah-server recall is produced by a tmp script that
  calls noah-server's search tool once per question and scores the same required notes at k=10
  (default - revisit with instance owner); the TEI endpoint URL is read by the build package, read-only,
  from `~/docker/mcps` (default - revisit with instance owner).
- Check command: the knowledge suites are named `*.test.mjs`, so the suite run is
  `node --test knowledge/scripts/*.test.mjs` (a `test-*.mjs` glob matches nothing).

### Tool map (component level; exact tool names unread)

| Instance surface | Destination | Layer |
|---|---|---|
| `<instance>_search` style tools (keyword + vector RRF) | `knowledge_search` | engine |
| note fetch / read tools | `knowledge_get` | engine |
| related / link-walk tools | `knowledge_neighbors` | engine |
| status / health tools | `knowledge_status` | engine |
| reindex tools | `knowledge_index` | engine |
| save / capture tools | `knowledge_capture` | engine |
| `tools/ingest` | `knowledge_capture` + `knowledge_index` | engine, instance wrapper stays |
| `tools/fold` | `knowledge_capture` merged_into path | engine, fold policy in `_knowledge/config.json` |
| `tools/nightly` | scheduler stays in the instance repo; calls CLI `index` | instance repo |
| `tools/rebuild` | CLI `index` / `migrate`; graph via `knowledge-graph.mjs` | engine |
| `tools/mocs` | `link.moc` / `link.fallback_moc` in `_knowledge/config.json` | per-store config |
| tool-name prefix, voice, persona text | instance repo (no persona key in the engine) | instance repo |

Rows show the component, not a tool name; F2-US-1 requires the per-tool rows.

## User stories

No shared R-number is declared for this backlog item; every shared rule is N/A here. The backlog
item has four criteria, A2.1..A2.4, and each is carried verbatim by its own story, in order.

### F2-US-1 — Every noah_* and genna_* tool has a destination, and the engine names no instance (A2.1)

**Acceptance**
- A2.1: A plan in _repo/docs/plans/ (dated 2026-11-19 or later) maps every noah_* and genna_* MCP tool to a knowledge tool or to a per-store config/persona layer that stays in the instance repo, and names nothing instance-specific in the engine
- F2-AC-1: Given the instance repos read read-only by the build package, When it fills the tool map in this plan, Then the map has one row per `noah_*`/`genna_*` tool in `server/{noah,genna}-mcp.mjs` and one row per `tools/{ingest,fold,nightly,rebuild,mocs}` script, and each row names either a knowledge tool or CLI command, or a per-store config/persona layer that stays in the instance repo.
- F2-AC-2: Given a tool or script that the build package cannot read, When it fills the tool map, Then that row is marked "unread" with the file it tried and the reason, and no tool name or behaviour is invented for it.
- F2-AC-3: Given the engine sources after this Sprint, When `grep -rniwE 'noah|genna'` runs over the non-test `.mjs` files under `knowledge/scripts`, `knowledge/hooks` and `knowledge/servers` and `node --test knowledge/scripts/knowledge-capture.test.mjs` runs, Then the grep finds nothing and the "no instance name appears in engine code" test passes.

### F2-US-2 — A tmp/ copy of the noah vault is answered through the knowledge MCP at or above today's recall (A2.2)

**Acceptance**
- A2.2: A copy of the noah vault in tmp/ answers its competency questions through the knowledge MCP at or above today's noah-server recall, numbers reported for both
- F2-AC-4: Given a copy of the noah vault under `tmp/` with noah's competency questions copied to its `_knowledge/questions.jsonl`, When CLI `eval` runs on the index the knowledge MCP serves and noah-server is measured on the same questions, Then the report states `recall_at_k@10` for both and the knowledge number is at or above noah-server's.
- F2-AC-5: Given that same index, When one MCP `knowledge_search` call is made against it, Then it returns at least one hit and the report records the call and its result as the smoke check.
- F2-AC-6: Given the recall run is finished, When its numbers are in the report, Then the live noah vault was never opened for write and the `tmp/` copy has been deleted.

### F2-US-3 — The TEI endpoint attaches to knowledge as an OpenAI-compatible provider (A2.3)

**Acceptance**
- A2.3: The TEI embedding endpoint (intfloat/multilingual-e5-base) attaches to knowledge as an OpenAI-compatible provider, shown by one real embed call
- F2-AC-7: Given `KNOWLEDGE_EMBED_PROVIDER=openai` with `KNOWLEDGE_EMBED_URL` and `KNOWLEDGE_EMBED_API_KEY` set, or the same values under `embed.*` in `_knowledge/config.json`, When the engine embeds one real text, Then it POSTs to the endpoint's `/v1/embeddings` route and the report records the HTTP status and the vector dimension.
- F2-AC-8: Given the model `intfloat/multilingual-e5-base`, When a query and a passage are embedded, Then `EMBEDDING_PROMPTS` has an e5 family entry that prefixes `query: ` and `passage: `, and the index metadata records that prompt id.
- F2-AC-9: Given the real embed call, When it is made, Then it reaches the existing TEI endpoint read-only, or a separately and uniquely named tmp container with no host port that is torn down by exact name and never pruned, and the provider code names no instance.
- F2-AC-10: Given a node test with a stub HTTP server, When the openai provider embeds through it, Then the test checks the request body, the parsed vector and an error on a non-2xx status, and the existing `knowledge/scripts/*.test.mjs` suites stay green with their counts reported.

### F2-US-4 — The cut-over order is genna first, awaiting the user's approval (A2.4)

**Acceptance**
- A2.4: The plan states the cut-over order (genna first) as awaiting the user's approval; no container under ~/docker/mcps is touched
- F2-AC-11: Given this plan, When a reader looks for the cut-over order, Then it states "genna first (it is empty), then noah", marked AWAITING THE USER'S APPROVAL, and nothing is cut over in this Sprint.
- F2-AC-12: Given the Sprint is closed, When `~/docker/mcps`, the nginx config, the running containers and the live noah vault are checked (for example `git -C ~/docker/mcps status` and the container names and start times from `docker ps`), Then none of them has changed.

**Cut-over order: genna first (it is empty), then noah — AWAITING THE USER'S APPROVAL.** Nothing is cut over in this Sprint.

## Out of scope

- Any change to a container, nginx or anything under `~/docker/mcps`.
- The live noah vault: it is gitignored, live on the home server, and `noah-server` is in use. It is read at most through a copy in tmp/.
- The cut-over itself, for genna and for noah; it needs the user's approval first.
- Card 162 (pgvector), the p95 400 ms threshold, and card 165 (teams PLAN judge).
- A persona key in the engine: personas stay in the instance repo.
- The incremental graph build itself (card 166, PLAN-F1); only the dependency is raised below.

## Open questions

Each below is decided by default and written as a rule under Scope; it stays listed so its owner can revisit it.

- If the knowledge copy's recall_at_k@10 comes out below noah-server's, is a fusion-weight sweep part of the proof, or is the shortfall reported as a fail? — owner: knowledge engine owner (default - revisit: reported as a fail with both numbers)
- Does noah's tools/nightly and rebuild map onto PLAN-F1's incremental graph build (graph-update-queue.jsonl), and does F2's tool map wait for F1 to land? — owner: user/PO (default - revisit: map to CLI `index` now, note F1 as a later change)
- How is today's noah-server recall produced, given that no reached source shows an eval for noah-server? — owner: instance owner (default - revisit: a tmp script calls noah-server's search tool once per question and scores the same required notes at k=10)
- What is the TEI endpoint URL, and can it be reached read-only without a host port? It is only in ~/docker/mcps, which this stage could not read. — owner: instance owner (default - revisit: the build package reads it read-only from ~/docker/mcps; a uniquely named tmp container is the fallback)
