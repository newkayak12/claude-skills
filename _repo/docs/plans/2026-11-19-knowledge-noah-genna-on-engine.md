# noah and genna on the knowledge engine — tool map, measured recall, cut-over (card 164)

Governing: `2026-11-19-knowledge-noah-genna-on-engine-prd.md` (F2 of E-df46dbb4) and its
`-findings.md`. Principle (user, 2026-11-19): knowledge is the shared engine; per-instance root,
ontology and link policy are config, and nothing in the engine names an instance.

Status: plan and tmp-copy proof. **Nothing is cut over.** No container, nginx config, compose file
or live vault was changed (evidence at the end).

## What the instances are today

`~/projects/{noah,genna}`: `server/<instance>-mcp.mjs` (17 tools each, same shape, names prefixed),
`tools/` (9 scripts each, same names, content differs), `tools/systemd/` (`*-nightly.timer` 00:00 KST,
`*-embed.timer` 04:00). noah's vault: 308 notes, 305 wikilinks, 57 competency questions; genna's is
empty. Search is in-process keyword scoring fused with vector neighbours from
`_knowledge/vectors.{json,f32}`; the query itself is embedded only when the embedding server happens
to be up. The embedding server is `noah-embed` (TEI `cpu-1.8`, `intfloat/multilingual-e5-base`,
`127.0.0.1:8091`), started by the 04:00 timer and stopped after.

## Tool map

Destination kinds: **engine** (a knowledge MCP tool or CLI command), **config** (a key in the store's
`_knowledge/config.json`), **instance** (stays in the instance repo, names its instance), **gap** (the
engine lacks it; listed under Engine gaps, not built here). Each row is the same for `noah_*` and
`genna_*`.

| Tool | What it does (from the source) | Destination | Kind |
|---|---|---|---|
| `*_persona` | load the persona: imitation guide, profile, voice, values … | instance wrapper over `knowledge_get` of the persona notes | instance |
| `*_search` | keyword hits fused with vector neighbours, `domain` filter | `knowledge_search` (`domain` filter exists) | engine |
| `*_get` | one note by id, `<domain>/_moc`, `index`, `rules`; pages of `maxChars` | `knowledge_get` for notes; `index`/`rules` files and paging | engine + gap |
| `*_source` | an original under `sources/` cited by a note | — | gap |
| `*_source_list` | list `sources/<prefix>` files | — | gap |
| `*_source_put` | store one original under `sources/<root>/`, secrets redacted | instance (redaction rules and allowed roots are the instance's) | instance |
| `*_collect` | the user's own words, verbatim, into the inbox | instance (inbox is the instance's intake) | instance |
| `*_ingest` | raw session messages from the hooks, sorted at midnight | instance | instance |
| `*_ingest_queue` / `*_ingest_done` | midnight job reads and marks raw batches | instance | instance |
| `*_inbox` / `*_inbox_done` | inbox entries waiting to be folded / mark folded | instance | instance |
| `*_note_write` | create **or replace** one note with frontmatter | `knowledge_capture` for a new note; replacing an existing one | engine + gap |
| `*_rebuild` | catalog, domain MOCs, question checks, accept loop | `merge.py` stays (it builds the catalog); then CLI `index`; MOC names via `link.moc` | instance + engine + config |
| `*_embed` | embed changed sections through TEI | CLI `index` with `embed.provider: openai` (unchanged documents reuse their vectors) | engine + config |
| `*_backup` | tar the vault, keep N | instance | instance |
| `*_status` | vault path, counts by domain, inbox backlog, last backup | `knowledge_status` for the index; inbox and backup lines stay | engine + instance |

| Script | What it does | Destination | Kind |
|---|---|---|---|
| `ingest.mjs` | push files written outside claude.ai through `*_source_put` | instance | instance |
| `fold.sh` | midnight: Claude folds the inbox into notes with the instance tools | instance (calls `knowledge_capture` once note writes move) | instance |
| `nightly.py` | midnight job: exports, fold, rebuild | instance scheduler; its rebuild step calls CLI `index` | instance + engine |
| `rebuild.py` | catalog, MOCs, question hashes, index, validation | `merge.py` + CLI `index` + `validate-knowledge.mjs` | instance + engine |
| `merge.py` | build `catalog.jsonl`, `questions.jsonl`, coverage, MOCs | instance (the catalog shape is already the engine's) | instance |
| `mocs.py` | domain MOCs | instance; the capture fallback MOC is `link.fallback_moc` | instance + config |
| `digest.py` | turn a batch of new sources into notes | instance | instance |
| `embed.sh` | start TEI, embed changes, stop it | CLI `index` (openai provider) between start and stop | engine |
| `mcp-call.mjs` | call one instance tool over stdio | instance | instance |
| `systemd/*` | the two timers | instance | instance |

Per-store config for an instance: `embed` (`provider: openai`, `url`, `model:
intfloat/multilingual-e5-base`), `link` (`moc`, `fallback_moc`), `notes_dir`, `ontology`. The engine
reads them; the instance repo owns the file. No persona key goes into the engine.

## Measured on a copy (2026-11-19)

Copy of the noah vault in `tmp/` (300 catalog notes, 57 questions, `required_note_ids` scored at
k=10). knowledge indexed it through a separate TEI container (same image and model, copied model
volume, no host port): 300 documents, 768 dimensions, e5 prompts, 460-character windows, 9 min 14 s
on CPU. noah-server was measured by running its own `server/noah-mcp.mjs` on the same copy over stdio
and scoring `noah_search` the same way.

| Run | recall@10 | MRR | questions fully answered |
|---|---|---|---|
| noah-server, embedding server down (its daytime state) | 0.683 (69/101) | 0.734 | 35/57 |
| noah-server, query embedded | 0.762 (77/101) | 0.865 | 39/57 |
| knowledge, query embedded through TEI | **0.792 (80/101)** | 0.827 | 41/57 |
| knowledge, embedding server down (lexical fallback) | 0.644 (65/101) | 0.707 | 31/57 |

One MCP `knowledge_search` smoke call ("알고리즘 공부할 때 소크라테스식 지도") returned
`algo-socratic-guideline-history` first, one of that question's required notes.

Read: with the embedding server up, knowledge beats noah-server on recall in either of noah's states
(0.792 vs 0.762 / 0.683); its MRR is below noah's embedded run. With the server down knowledge falls
under noah's daytime number (0.644 vs 0.683), because noah still reranks keyword hits with stored
note vectors and knowledge drops to lexical only. Before this card, knowledge with the server down
failed every search (`fetch failed`); it now answers lexically and says so in `query_embedding`.

## Decisions for the user (before any cut-over)

1. **Query-time embeddings — decided (user, 2026-11-19): one resident embedding sidecar shared by
   genna and noah** ("임베딩 사이드카는 하나만 띄워서 써야겠는걸? genna, noah를 쓸거면?"). knowledge
   needs the server up when it answers (0.792 with it, 0.644 without). One TEI serves both because
   both stores use the same model; a store's vectors only match queries embedded by the model its
   index metadata records, so the sidecar's model is fixed for both and changing it means
   re-indexing both. Each store points at it through `embed.url` in its own `_knowledge/config.json`
   (a network alias such as `http://embed:80` on the shared docker network, no host port). The two
   nightly re-index jobs are staggered so they do not compete for its CPUs. Measured resident
   (TEI `cpu-1.8`, e5-base, `--cpus 4 --memory 3g`, alone on the 12-core / 13 GB host): idle CPU
   about 1.2 %, memory 2.3 GiB idle and after load, one query embedded in p50 23 ms / p95 27 ms /
   max 54 ms over 114 requests. The memory is the cost that matters on this host: keep the 3 GB
   limit, and budget it against everything else resident.
2. **Engine gaps** (cards, not built here): `knowledge_get` paging and the store's `index`/`rules`
   files; read access to `sources/` (`*_source`, `*_source_list`); replacing an existing note through
   capture (`*_note_write`).
3. **Cut-over order: genna first (it is empty), then noah — AWAITING THE USER'S APPROVAL.** genna
   first because an empty store cannot lose data and proves the wiring (instance wrapper server,
   config file, timers calling `index`) before the live vault moves. noah second, after a fresh copy is
   re-measured against the table above.

## Evidence that nothing live changed

- `docker inspect noah-server`: StartedAt `2026-11-14T14:19:40Z` at the start and at the end.
- `~/docker/mcps` is a git repo with no commits (`## No commits yet on master`, untracked `.archive/`,
  `.env`), the same at the start and at the end; nothing under it was written.
- The noah vault was read only (`rsync` into `tmp/`); the copy and the bench containers were removed
  by exact name after the numbers were recorded.
- `grep -rniwE 'noah|genna'` over the non-test `.mjs` files in `knowledge/scripts`, `knowledge/hooks`
  and `knowledge/servers` finds nothing; `knowledge-capture.test.mjs` guards it.
