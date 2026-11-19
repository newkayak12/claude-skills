# Findings — F2: noah and genna on the knowledge engine (card 164)

Investigate stage for `2026-11-19-knowledge-noah-genna-on-engine-prd.md` (attempt 2). Every finding
cites the source opened. Settled decisions are findings (D1-D6), not questions. What no reachable
source says is under **Open questions**, with an owner.

Attempt 2 exists because plan-integrate:1 rejected F2-US-1: its acceptance held a truncated
"Build check: ... a tool that cannot be read is" item and other items were not criteria. Every
acceptance item below is a full `F2-AC-n: Given ..., When ..., Then ...` sentence, numbered
F2-AC-1..12 with no gaps; the PRD copies them as-is.

## Reach

- **Reached:** this worktree: `_repo/docs/backlog.md` (card 164), `knowledge/scripts/*.mjs`,
  `knowledge/compose.yaml`, `knowledge/README.md` (grep only), and the attempt-1 PRD and findings.
- **Not reached:** the instance repos under `/home/newkayak12` (noah, genna) and `~/docker/mcps/`.
  `ls /home/newkayak12/` was refused in this sandbox on both attempts. So no `noah_*`/`genna_*` tool
  name, competency question, recall number or TEI URL is stated as fact. Per D1, the build package
  reads them read-only.

## Findings

### Card 164 (source: `_repo/docs/backlog.md`, card 164)
- Each instance has its own `server/{noah,genna}-mcp.mjs` that does keyword + vector RRF.
- Vectors live in `_knowledge/vectors.{json,f32}`. TEI `intfloat/multilingual-e5-base` builds them on
  a 04:00 timer.
- Each instance has `tools/` (ingest, fold, nightly, rebuild, mocs).
- Hosting is `~/docker/mcps/` (`noah-server`, `genna-server`, `*-embed`, nginx).
- The noah vault is live on the home server and gitignored, with 300 catalog notes and
  `.knowledge/knowledge.sqlite`. genna starts empty.
- `noah-server` is in use: "plan first, no cut-over without the user". The order is genna first,
  because it is empty.

### Settled in the brainstorm (user, 2026-11-19)
- The Sprint takes card 166, then 164. Card 162 (pgvector) stays deferred, the p95 400 ms threshold
  is unchanged, and card 165 stays on the backlog.
- Card 164 covers the plan, the tmp-copy recall proof and one TEI embed call. No container, nginx or
  live-vault change.
- Real runs work on copies in tmp/. Docker containers get unique names and no host ports, are torn
  down by exact name and are never pruned. tmp/ is cleared once the numbers are in the report.

### Settled by the task (PLAN defaults recorded in the brief; write them as rules)
- D1: the build package reads the instance repos (`server/{noah,genna}-mcp.mjs`, `tools/`) read-only
  and fills one tool-map row per tool and one per script.
- D2: noah's competency questions are copied to the tmp copy's `_knowledge/questions.jsonl`. Both
  noah-server and the knowledge copy are measured with the same `recall_at_k@10`.
- D3: recall is measured by CLI `eval` on the same index the MCP serves, plus one MCP
  `knowledge_search` call as a smoke check.
- D4: the embedder is configured with `KNOWLEDGE_EMBED_PROVIDER=openai` plus `KNOWLEDGE_EMBED_URL` /
  `KNOWLEDGE_EMBED_API_KEY`, also readable as `embed.*` in `_knowledge/config.json`.
- D5: an e5 family entry (`query: ` / `passage: `) is added to `EMBEDDING_PROMPTS`.
- D6: the tmp copy re-embeds through the existing TEI endpoint, read-only.

### Knowledge engine MCP surface (source: `knowledge/scripts/sqlite-knowledge.mjs` serveMcp, `knowledge-capture.mjs`)
- There are six MCP tools: `knowledge_index`, `knowledge_search`, `knowledge_get`,
  `knowledge_neighbors`, `knowledge_status` and `knowledge_capture` (the write tool).
- The CLI has `index`, `search`, `neighbors`, `get`, `status`, `serve`, `eval`, `list` and
  `migrate`. `eval`, `list` and `migrate` are CLI-only.
- `knowledge/scripts/knowledge-graph.mjs` runs the LLM graph build through an OpenAI-compatible
  **chat** client (`KNOWLEDGE_LLM_URL` or `llm.url`). The compose `graph` profile drives it.

### Recall measurement (source: `sqlite-knowledge.mjs` L1593-1708)
- `eval` reads `<root>/_knowledge/questions.jsonl`. Each row needs `id` and `question`.
- It reports `recall_at_k` = required found / required total (L1674). `k` defaults to 10, clamped to
  1-50, and `--split` defaults to `all`.
- noah-server has no `eval` of its own as far as any reached source says, so how its number is
  produced is open (Q3).

### Embedding providers (source: `sqlite-knowledge.mjs` L64-65, L481-497, L957)
- The provider comes from `KNOWLEDGE_EMBED_PROVIDER` (default `hash`). The model comes from
  `KNOWLEDGE_EMBED_MODEL` (default `embeddinggemma`).
- Only `hash` and `ollama` exist. Any other provider throws `Unsupported index embedding provider` (L957).
  An OpenAI-compatible `/v1/embeddings` provider is therefore **build work**, not a config step.
- `EMBEDDING_PROMPTS` (L481) is keyed by model family and holds only `embeddinggemma` today. Its
  prompt id is recorded in the index metadata (L497 looks it up by id).
- The store config has no embedding key today (`knowledge-config.mjs`). D4 adds `embed.*`.

### Per-store config layer (source: `knowledge/scripts/knowledge-config.mjs`)
- The per-store config is `<store>/_knowledge/config.json`. Its header says: "One engine serves every
  store … what differs between them lives here, never in engine code."
- Keys: `root`, `notes_dir`, `ontology`, `link.{min_term_length,max_links,moc,fallback_moc,search_candidates}`,
  `llm.url`, and `storage.*` (migrate). It sets `additionalProperties: true`.
- There is no persona key. A persona (voice, tool-name prefix) stays in the instance repo, which is
  what card 164 says.

### Engine names no instance (source: `knowledge/scripts/knowledge-capture.test.mjs` L189-196)
- The test "no instance name appears in engine code" asserts `doesNotMatch(/\b(noah|genna)\b/i)`
  (L193) over every non-test `.mjs` under `knowledge/scripts`, `knowledge/hooks` and
  `knowledge/servers`. That test plus a grep is the check for A2.1's "names nothing instance-specific".

### Conventions (source: `.claude/conventions/*.md` in the brief)
- All three convention files are unfilled templates. The binding limits are the brief's out-of-scope
  list and `maintaining.md` (Docker: unique names, no host ports, exact-name teardown, never prune).

## Requirements analysis

### Actors
- User/PO: approves the cut-over and its order.
- Knowledge engine owner: maintains `knowledge/`.
- Instance owner: owns the noah and genna repos and `~/docker/mcps`. This is the same person as the
  user, but a separate decision role.

### Rules
- R1: the engine names no instance (capture.test L193).
- R2: what differs between instances lives in `_knowledge/config.json` or in the instance repo.
- R3: no container, nginx, `~/docker/mcps` or live-vault change, and no cut-over.
- R4: runs use tmp/ copies only, with Docker containers uniquely named, no host ports, torn down by
  exact name and never pruned. tmp/ is cleared after the report.
- R5: the cut-over order is genna first and awaits the user's approval.

### Items (full criteria; the PRD copies these into its stories)

- **F2-US-1**, which carries A2.1 verbatim: "A plan in _repo/docs/plans/ (dated 2026-11-19 or later) maps every noah_* and genna_* MCP tool to a knowledge tool or to a per-store config/persona layer that stays in the instance repo, and names nothing instance-specific in the engine"
  - F2-AC-1: Given the instance repos read read-only by the build package, When it fills the tool map in this plan, Then the map has one row per `noah_*`/`genna_*` tool in `server/{noah,genna}-mcp.mjs` and one row per `tools/{ingest,fold,nightly,rebuild,mocs}` script, and each row names either a knowledge tool or CLI command, or a per-store config/persona layer that stays in the instance repo.
  - F2-AC-2: Given a tool or script that the build package cannot read, When it fills the tool map, Then that row is marked "unread" with the file it tried and the reason, and no tool name or behaviour is invented for it.
  - F2-AC-3: Given the engine sources after this Sprint, When `grep -rniwE 'noah|genna'` runs over the non-test `.mjs` files under `knowledge/scripts`, `knowledge/hooks` and `knowledge/servers` and `node --test knowledge/scripts/knowledge-capture.test.mjs` runs, Then the grep finds nothing and the "no instance name appears in engine code" test passes.

- **F2-US-2**, which carries A2.2 verbatim: "A copy of the noah vault in tmp/ answers its competency questions through the knowledge MCP at or above today's noah-server recall, numbers reported for both"
  - F2-AC-4: Given a copy of the noah vault under `tmp/` with noah's competency questions copied to its `_knowledge/questions.jsonl`, When CLI `eval` runs on the index the knowledge MCP serves and noah-server is measured on the same questions, Then the report states `recall_at_k@10` for both and the knowledge number is at or above noah-server's.
  - F2-AC-5: Given that same index, When one MCP `knowledge_search` call is made against it, Then it returns at least one hit and the report records the call and its result as the smoke check.
  - F2-AC-6: Given the recall run is finished, When its numbers are in the report, Then the live noah vault was never opened for write and the `tmp/` copy has been deleted.

- **F2-US-3**, which carries A2.3 verbatim: "The TEI embedding endpoint (intfloat/multilingual-e5-base) attaches to knowledge as an OpenAI-compatible provider, shown by one real embed call"
  - F2-AC-7: Given `KNOWLEDGE_EMBED_PROVIDER=openai` with `KNOWLEDGE_EMBED_URL` and `KNOWLEDGE_EMBED_API_KEY` set, or the same values under `embed.*` in `_knowledge/config.json`, When the engine embeds one real text, Then it POSTs to the endpoint's `/v1/embeddings` route and the report records the HTTP status and the vector dimension.
  - F2-AC-8: Given the model `intfloat/multilingual-e5-base`, When a query and a passage are embedded, Then `EMBEDDING_PROMPTS` has an e5 family entry that prefixes `query: ` and `passage: `, and the index metadata records that prompt id.
  - F2-AC-9: Given the real embed call, When it is made, Then it reaches the existing TEI endpoint read-only, or a separately and uniquely named tmp container with no host port that is torn down by exact name and never pruned, and the provider code names no instance.
  - F2-AC-10: Given a node test with a stub HTTP server, When the openai provider embeds through it, Then the test checks the request body, the parsed vector and an error on a non-2xx status, and the existing `knowledge/scripts/*.test.mjs` suites stay green with their counts reported.

- **F2-US-4**, which carries A2.4 verbatim: "The plan states the cut-over order (genna first) as awaiting the user's approval; no container under ~/docker/mcps is touched"
  - F2-AC-11: Given this plan, When a reader looks for the cut-over order, Then it states "genna first (it is empty), then noah", marked AWAITING THE USER'S APPROVAL, and nothing is cut over in this Sprint.
  - F2-AC-12: Given the Sprint is closed, When `~/docker/mcps`, the nginx config, the running containers and the live noah vault are checked (for example `git -C ~/docker/mcps status` and the container names and start times from `docker ps`), Then none of them has changed.

### Open questions (genuinely open; D1-D6 are settled and are not repeated here)
- Q1 [knowledge engine owner]: if the knowledge copy's `recall_at_k@10` comes out below
  noah-server's, is a fusion-weight sweep (`sweepFusionWeights`) part of the proof, or is the
  shortfall reported as a fail? Options: (a) report it as a fail with both numbers, so A2.2 is
  partial and the cut-over waits; (b) allow one sweep on a dev split and report the holdout number,
  so the proof costs more but may pass.
- Q2 [user/PO, dependency on PLAN-F1 / card 166]: does noah's `tools/nightly`/`rebuild` map onto
  F1's incremental graph build (`graph-update-queue.jsonl`), and does F2's tool map wait for F1 to
  land? Options: (a) map it to F1's build and cite F1, so the row depends on F1 shipping; (b) map it
  to CLI `index` now and note F1 as a later change.
- Q3 [instance owner]: how is "today's noah-server recall" produced, given that noah-server has no
  `eval` in any reached source? Options: (a) a tmp script calls noah-server's search tool per
  question and scores the same required notes at k=10, so the comparison is like for like; (b) use a
  number noah already records, if one exists, which is comparable only if its definition matches.
- Q4 [instance owner]: the TEI endpoint URL is only in `~/docker/mcps`, which this stage could not
  read. The build package reads it read-only. If it cannot be reached without a host port, the
  separately named tmp container is the fallback.
