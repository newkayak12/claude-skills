# F3 findings: Docker graph build with an LLM that fits this machine (card 160)

Investigate stage `investigate:U1:1`, 2026-11-19. A finding cites the source that states it. An unknown is something no source reached states. Unknowns are listed at the end with an owner and options.

## Sources opened
- `knowledge/compose.yaml` (whole file, 41 lines)
- `knowledge/Dockerfile` (whole file)
- `knowledge/skills/graph-builder/SKILL.md` (whole file, 147 lines)
- `knowledge/scripts/validate-knowledge.mjs` :380-460
- `knowledge/scripts/sqlite-knowledge.mjs` :34-64, :129, :489-520, :800-860, :1195-1205, :2095-2144
- `knowledge/hooks/knowledge-delta-check.mjs` (grep for `_graph`)
- `knowledge/skills/base-builder/references/answerability-contract.md` :93, :171-203
- `knowledge/README.md` :93, :183, :351-355, :400-412
- `_repo/docs/backlog.md` card 160 (:653-660)
- F1 PRD `_repo/docs/plans/2026-11-19-knowledge-install-layout-prd.md` (:13, :24-25, :42-44, :87, :127, :139)
- F2 PRD `docs/prd/F2-knowledge-capture.md` (:16, :31, :62-68, :103, :111)
- Host facts: `nproc` gave 12; `free -g` gave 13 GB total, about 5 GB available and 3 GB swap. The GPU check (`ls /dev/nvidia*`) was not run because it was not permitted here. "No GPU" comes from the request and the card.

## Findings

### Current compose and image
1. **The compose file has two profiles today.**
   - The default service `knowledge-index` runs `index --root /workspace --provider hash`.
   - Profile `semantic` adds `knowledge-index-ollama` and an `ollama` service (`image: ollama/ollama:latest`). The `ollama` service has a named volume `ollama-models` and an `ollama list` healthcheck.
   - Ollama is used only for embeddings (`--provider ollama --model ${KNOWLEDGE_EMBED_MODEL:-embeddinggemma}`).
   - No service does graph extraction.
   - Source: `knowledge/compose.yaml:1-41`; backlog card 160 says the same ("compose has ollama for embeddings only").
2. **Both services mount `${KNOWLEDGE_ROOT:-..}:/workspace` today** (`compose.yaml:6,14`). F1 replaces this with one line that every project-mounting service uses: `${KNOWLEDGE_ROOT:?KNOWLEDGE_ROOT must be the project to index}:/workspace`. The `ollama` service mounts only its named volume. `build.context: .` stays. Source: F1 PRD :24-25.
   - F1 also says any profile F3 adds is checked the same way: `docker compose config --profile <F3 profile>` shows only the project path as a volume source. Source: F1 PRD :42.
3. **The image copies only two files:** `scripts/sqlite-knowledge.mjs` and `servers/knowledge-mcp.mjs`. Its entrypoint is `node --no-warnings /opt/knowledge/scripts/sqlite-knowledge.mjs`. A new extraction or probe script is not in the image until the Dockerfile COPYs it. Shared modules count too: F1's `knowledge-paths.mjs` and F2's config module. Source: `knowledge/Dockerfile`.
4. **The image is `node:24-bookworm-slim` and runs as `USER node`.** It has no GPU tooling such as `nvidia-smi`. Source: `knowledge/Dockerfile`.

### How the index reads the graph today
5. **`index` already reads graph files.** The artifact paths are `_graph/nodes.jsonl` (fallback `graph/nodes.jsonl`) and `_graph/edges.jsonl` (fallback `graph/edges.jsonl`). Both are indexed artifact kinds. Source: `sqlite-knowledge.mjs:45-54`.
6. **`buildIndex` inserts nodes into `graph_nodes` and edges into `graph_edges` inside one transaction.**
   - Edge fields it reads: `source_node_id|source_id|from|source`, `target_node_id|target_id|to|target`, `relationship_type|type|relation|label`, `evidence`, and `source_refs|sources`.
   - It throws only when source, target or type is missing.
   - It does not check evidence, `RELATED_TO` or direction. So validation must happen before `edges.jsonl` is written.
   - Source: `sqlite-knowledge.mjs:809-850`.
   - So "then builds the sqlite index" reuses `index` as it is, with no change to the loader.
7. **The default DB path is `.knowledge/knowledge.sqlite`, relative to the resolved root.** `KNOWLEDGE_DB_PATH` overrides it. Source: `sqlite-knowledge.mjs:34,186`.
   - The `.knowledge/` directory is where card 160 says the probe facts go.
   - Under F1's resolver the root can nest, so the directory may be `<project>/knowledge-system/.knowledge/` (F1 PRD :62).
8. **Embedding providers are only `hash | ollama`.** Anything else throws `Unsupported embedding provider`. Source: `sqlite-knowledge.mjs:129`.
   - Env vars in use today: `KNOWLEDGE_EMBED_PROVIDER` (default `hash`), `KNOWLEDGE_EMBED_MODEL`, `OLLAMA_HOST` and `KNOWLEDGE_DB_PATH`. Source: `sqlite-knowledge.mjs:62-64`.
   - The HTTP calls go to Ollama's native `/api/embed` (:514) and to `/v1/rerank` (:1201).
   - **No code calls a chat or completions endpoint today.** An OpenAI-compatible `/v1/chat/completions` client for extraction is new code.
9. **The CLI commands are** `index`, `search`, `neighbors`, `get`, `status`, `eval`, `list` and `serve`. Failures write the message to stderr and exit with code 1. A new subcommand (for example `graph` or `probe`) would be added to `main`. Source: `sqlite-knowledge.mjs:2095-2121`.

### graph-builder rules (the edge rules A3.3 refers to)
10. **Relationship validation is written at `graph-builder/SKILL.md:44` (Process step 6):** "Check direction, cardinality, relation semantics, and evidence. Avoid vague edges such as `RELATED_TO` unless the user explicitly wants a loose exploration graph."
    - The SKILL therefore allows `RELATED_TO` as an opt-in.
    - A3.3 says "no RELATED_TO" with no opt-out. The PRD must state that the extraction validator rejects `RELATED_TO` unconditionally, as a stricter rule for machine extraction. The critique asked for this.
11. **The SKILL's table of better types:** `RELATED_TO` → `DEPENDS_ON, IMPLEMENTS, MENTIONS, OWNS, SUPERSEDES`; `USES` → `CALLS, QUERIES, IMPORTS, CONFIGURES, AUTHENTICATES_WITH`; `HAS` → `HAS_FIELD, HAS_POLICY, HAS_DECISION, HAS_STATUS`. Relationship names are "specific and directional". Source: `SKILL.md:75-81`.
12. **Evidence rules:** Source: `SKILL.md:101-110` (Evidence Rules).
    - Every non-obvious node or edge has at least one `source_ref`.
    - An inferred edge needs `confidence` and `inference_reason`.
    - Co-occurrence or a shared anchor never establishes an edge (also step 4, `SKILL.md:42`).
    - A reachability edge needs a stable edge ID, a specific type and `source_refs`. An evidence excerpt alone is not provenance.
13. **Directionality and inverses:** do not add an inverse edge B→A unless the ontology declares the relation symmetric or defines an inverse. Sources: `SKILL.md:44` and the Quality Bar at `:126`.
14. **Where the rules are enforced today:** only `validate-knowledge.mjs`, and only for edges on a question-reachability path.
    - `:427-429` rejects an empty type or `RELATED_TO`, case-insensitively ("needs a specific relationship type").
    - `:430-434` requires `source_refs`.
    - `:435-439` checks that the path follows the edge direction.
    - Edges that are not on a reachability path are not checked anywhere. Source: `validate-knowledge.mjs:380-460`.

### Question reachability
15. **The question source** is `_knowledge/questions.jsonl`. A record with `graph_check: true` and `required_graph_node_ids` is a graph question.
    - Results go to `_graph/question-reachability.jsonl`, with fields `question_id, reachable, answer_node_ids, max_hops, paths[{node_ids, edge_ids}], evidence_refs, checked_at`.
    - `node knowledge/scripts/validate-knowledge.mjs --root <vault> --require-answerability` checks those records.
    - **No code computes the reachability records.** The validator only checks records someone wrote; the SKILL step 8 makes it a prose task.
    - Sources: `answerability-contract.md:93,171-203`; `SKILL.md:47`; `validate-knowledge.mjs:380-455`.

### Delta hook
16. **The delta hook treats `_graph/` as a knowledge-root marker** (`knowledge-delta-check.mjs:76`). It skips `_graph` when scanning links (:30).
    - It flags `graph_delta_needed` when a note is newer than `_graph/nodes.jsonl` or `_graph/edges.jsonl` (:198-221).
    - F2 extracts the job writer that feeds `graph-update-queue.jsonl` (F2 PRD :80-82).
    - No source says whether the F3 profile consumes that queue.

### Settled decisions (findings, not unknowns)
17. **Ollama and LLM dependency:** the LLM stays optional. It is reached through a compose profile and an OpenAI-compatible endpoint; the default has no dependency. Decided by the user in the 2026-11-19 brainstorm.
18. **Model choice:** detected automatically from the hardware, with an env var override. Decided by the user in the brainstorm.
19. **Scope:** one shared engine. Noah and genna personal graphs and general projects use the same engine through config. Decided by the user in the brainstorm.
20. **Config file:** `<knowledge root>/_knowledge/config.json`, a JSON schema exported from the engine. Env vars override file values. The `root` key is a one-step redirect with no chaining. Settled as a PLAN default; F2 PRD :31 and :65-66 state that F3 extends the schema with its graph keys.
21. **Shared paths module:** `knowledge/scripts/knowledge-paths.mjs` is imported by both the hook and the script. Settled as a PLAN default, F1.
22. **README table:** F1 reserves an F3 block (`_graph/*.jsonl`, the hardware probe file) with the columns path | created by | when | purpose. README.md and KOR.md change in the same commit. Source: F1 PRD :87. Integrate checks the full table against disk (F1 :110, :139).
23. **Out-of-scope boundaries already stated by sibling cards:**
    - F2 does not own LLM extraction or the graph keys in config (F2 :103).
    - F1 publishes the variable and the mount line, and F3 adds its profile (F1 :127).
    - The `harness/` and `graph/` plugins are stable (`.claude/rules/repo.md`). The `graph/` plugin is not the `knowledge:graph-builder` skill.
24. **Host for the real run:** 12 cores, 13 GB RAM with about 5 GB available while measured, 3 GB swap. The card says there is no GPU. Source: `nproc` and `free -g` on 2026-11-19. With about 5 GB free, any model tier that needs more than roughly 4 GB resident, the bigger 7B-class models included, is likely to swap. This is a measurement, not a tier decision.
25. **Teardown rule for the real run:** use unique container names, publish no host ports, tear down by exact name, and never `prune`. Source: `.claude/rules/maintaining.md` (Benches).
    - The existing `ollama` service has no `container_name`. Unique naming therefore depends on a compose project name (`-p`) or on explicit names.

## Unknowns (owner and options)
U1. **Tier table:** what tiers exist, which model each one names, and what RAM, VRAM and core thresholds pick it. Owner: implementation lead (knowledge), with the PO.
   - (a, recommended) Three tiers keyed on VRAM, then on free RAM: `small` for CPU-only machines with less than 16 GB (a 1-4B instruct model), `medium` for 16 GB or more of RAM, or 8 GB or more of VRAM (a 7-8B model), and `large` for 16 GB or more of VRAM. Model names are defaults in config. The PRD then commits only to the thresholds and leaves the model names to config.
   - (b) Thresholds and model names hardcoded in the engine. This is simpler, but every model change is a code change, which works against R1's "config".
U2. **Probe file name and shape under `.knowledge/`.** Owner: implementation lead.
   - (a, recommended) `.knowledge/hardware-probe.json` with `{probed_at, gpu: {present, vendor, vram_mb}, ram_mb, ram_available_mb, cores, tier, model, source: "probe"|"env"|"config"}`. It is one file, which makes it one README row.
   - (b) Separate files for the probe facts and the pick. That means two rows and two writes.
U3. **Env var names** for the endpoint, the model and the tier override. Owner: implementation lead.
   - (a, recommended) `KNOWLEDGE_LLM_URL`, `KNOWLEDGE_LLM_MODEL`, `KNOWLEDGE_LLM_TIER` and an optional `KNOWLEDGE_LLM_API_KEY`. These follow the existing `KNOWLEDGE_EMBED_*` prefix (`sqlite-knowledge.mjs:62-64`).
   - (b) `OPENAI_BASE_URL` and `OPENAI_API_KEY`. These are familiar, but they can collide with a user's global OpenAI env and turn the LLM path on silently.
U4. **Where the probe runs, and how it sees a GPU from inside a container.** Inside a container, `/proc/meminfo` shows host RAM, but cgroup limits and GPU visibility differ, and the image has no `nvidia-smi` (finding 4). Owner: implementation lead.
   - (a, recommended) The probe is a node module run on the host before compose. A wrapper or a `probe` subcommand writes the probe file, and the container reads it. The tests mock `/proc`, `os` and the `nvidia-smi` output.
   - (b) The probe runs in the container and falls back to "no GPU" when no GPU is passed through. It is honest on this CPU-only machine but under-reports on GPU hosts.
U5. **What "evidence required" means for an extracted edge.** Owner: domain expert (graph-builder).
   - (a, recommended) A non-empty `source_refs` pointing at a vault md path, plus a non-empty `evidence` excerpt that occurs in that file. This catches hallucinated evidence.
   - (b) `source_refs` only, matching `validate-knowledge.mjs:430-434`. It is weaker against LLM hallucination.
U6. **What "directional types" means operationally.** Owner: domain expert, with the PO.
   - (a, recommended) The type must be in the ontology's allowed relationship list from config. When there is no ontology, the type must be UPPER_SNAKE, not `RELATED_TO`, and not one of the weak forms `USES` or `HAS` (SKILL table :75-81). Symmetric relations come only from the ontology.
   - (b) Any UPPER_SNAKE type except `RELATED_TO`. This is simplest, but it lets `USES` and `HAS` through.
U7. **Where rejected edges are reported.** Owner: implementation lead.
   - (a, recommended) `_graph/rejected-edges.jsonl` (the edge plus `reasons[]`) and a count in the command's JSON output. The rejected edges are never written to `edges.jsonl`. This adds a README row.
   - (b) stdout or the report only. Nothing persists for review.
U8. **Who computes question reachability for the real-run report.** No code computes it today (finding 15). Owner: PO, with the implementation lead.
   - (a, recommended) The graph command computes bounded BFS paths over the accepted directional edges for each `graph_check` question and writes `_graph/question-reachability.jsonl`. `validate-knowledge.mjs --require-answerability` then checks it.
   - (b) The real run reports reachability by hand, using `neighbors`. This is cheaper, but it is not repeatable.
U9. **Whether the graph profile ships its own ollama service.** "ollama is one option, never required." Owner: PO.
   - (a, recommended) The `graph` profile has only the extractor and indexer service and needs `KNOWLEDGE_LLM_URL`. The ollama service stays under its existing profile, which can be combined with the `graph` profile. Ollama is never pulled unless asked for.
   - (b) The `graph` profile includes ollama. One command then works out of the box, but ollama becomes a de facto requirement.
U10. **What happens when the LLM fails partway (timeout, bad JSON): is `_graph` left as it was?** Owner: implementation lead.
   - (a, recommended) Write to `_graph/*.tmp` and rename only after the whole run validates, so a failed run leaves `_graph` as it was. This matches A3.4's spirit.
   - (b) Write per file as the run goes. A partial graph can then be indexed.
U11. **Chunking and context size for small CPU models, and run time on this machine.** Owner: implementation lead. No source states a time budget for the real run.
U12. **Which "small vault" the real run copies.** Owner: PO.
   - (a, recommended) A fixture of a few dozen notes with a `questions.jsonl` containing at least one `graph_check` question, built under tmp/ from the repo's test fixtures.
   - (b) A copy of a private vault. R4 allows a copy, but a private vault must not leak into the report.
U13. **Whether the graph profile consumes `_knowledge/jobs/graph-update-queue.jsonl` (incremental extraction) or always runs over the whole vault.** Owner: PO.
   - (a, recommended) A full rebuild in this Sprint, with incremental extraction deferred. This keeps the scope small.
U14. **Dependency on F1:** F3 depends on the final root variable and mount line (`KNOWLEDGE_ROOT`, `${KNOWLEDGE_ROOT:?...}:/workspace`), on the resolver module name, and on the README table's F3 block. Owner: F1 package and the integrate stage.
U15. **Dependency on F2:** F3 depends on the config schema's module and export names, which F3 extends with `graph` keys such as ontology types, edge rules and the tier table. Owner: F2 package and the implementation lead.

## Handoff note for the drafter
- `index` already loads `_graph/*.jsonl` into `graph_nodes` and `graph_edges` (`sqlite-knowledge.mjs:45-54,809-850`) without checking evidence or type. F3 therefore adds validation before the write, an OpenAI-compatible chat client (none exists, finding 8), a node probe module, a `graph` compose profile on F1's mount line, and Dockerfile COPY lines.
- Cite `SKILL.md:44` and `:75-81` for where the rules are written and `validate-knowledge.mjs:427-434` for where they are enforced today (reachability edges only).
- Say that F3 rejects `RELATED_TO` with no opt-out, stricter than the SKILL's exception.
- Keep U1-U13 as open questions with their owners. Keep U14 and U15 as the F1 and F2 dependency questions.
