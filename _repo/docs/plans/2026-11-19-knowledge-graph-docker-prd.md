# PRD F3 — Build the graph in Docker with an LLM that fits this machine, then load it into sqlite (card 160)

Findings: `_repo/docs/plans/2026-11-19-knowledge-graph-docker-prd-findings.md` (cited below as "findings N" / "U<n>").

## Goal
One command (a compose profile, e.g. `graph`) runs LLM extraction over the vault markdown into `_graph/nodes.jsonl` and `_graph/edges.jsonl`, then builds the sqlite index. The model size fits the machine (hardware probe, env override), only edges that pass the graph-builder rules are written, and with no LLM endpoint nothing changes.

## Problem
The request assumes a graph can be built from Docker. Today compose has two profiles and ollama is used for embeddings only; nothing calls a chat endpoint (findings 1, 8). `index` already loads `_graph/*.jsonl` into `graph_nodes`/`graph_edges` (`sqlite-knowledge.mjs:45-54,809-850`) but checks only source, target and type, not evidence, `RELATED_TO` or direction (finding 6). The graph-builder rules live in `SKILL.md:44,75-81,101-110` and are enforced only for reachability-path edges at `validate-knowledge.mjs:427-434` (findings 10-14). No code computes question reachability (finding 15). The Docker image copies only two files (finding 3). So F3 adds: a chat client, an edge validator, a node probe module with tests, a `graph` compose profile and Dockerfile COPY lines. `index` is reused unchanged.

## Scope
Settled rules (written as rules; none is an open question):
- The LLM is optional. The hash/no-LLM path stays the default and has no dependency. Without an endpoint the graph-builder skill path is unchanged.
- The endpoint is any OpenAI-compatible URL plus a model (`/v1/chat/completions`). Ollama is one option, never required.
- The hardware probe auto-picks a model tier; an env var overrides the pick.
- Config is `<knowledge root>/_knowledge/config.json`; env vars override file values. F3 extends F2's schema with ontology and edge-rule keys (and the tier table); no instance name (noah, genna) appears in engine code.
- Env var names (default - revisit with implementation lead): `KNOWLEDGE_LLM_URL`, `KNOWLEDGE_LLM_MODEL`, `KNOWLEDGE_LLM_TIER`, `KNOWLEDGE_LLM_API_KEY` (U3; follows the `KNOWLEDGE_EMBED_*` prefix).
- Tiers (default - revisit with implementation lead and PO): `small` = CPU-only under 16 GB RAM; `medium` = RAM 16 GB or more, or VRAM 8 GB or more; `large` = VRAM 16 GB or more. Model names are config defaults, not engine code (U1).
- Probe file (default - revisit with implementation lead): `.knowledge/hardware-probe.json` = `{probed_at, gpu:{present, vendor, vram_mb}, ram_mb, ram_available_mb, cores, tier, model, source: probe|env|config}` (U2).
- The probe runs on the host as a node module / `probe` subcommand before compose; the container reads the file. Tests mock `/proc`, `os` and `nvidia-smi` output (U4, default - revisit with implementation lead).
- Evidence required = non-empty `source_refs` naming a vault md path plus an `evidence` excerpt that occurs in that file (U5, default - revisit with domain expert). Directional = type is in the config ontology allow-list; with no ontology, UPPER_SNAKE excluding `RELATED_TO`, `USES`, `HAS`; symmetric relations only via the ontology (U6, default - revisit with domain expert and PO). `RELATED_TO` is rejected with no opt-out, stricter than the opt-in at `SKILL.md:44`.
- Rejected edges go to `_graph/rejected-edges.jsonl` (edge + `reasons[]`) plus a count in the command output; never into `edges.jsonl` (U7, default - revisit with implementation lead).
- The graph command computes bounded BFS reachability over accepted edges for each `graph_check` question in `_knowledge/questions.jsonl` and writes `_graph/question-reachability.jsonl`; `validate-knowledge.mjs --require-answerability` then checks it (U8, default - revisit with PO and implementation lead).
- The `graph` profile holds only the extractor/indexer service and needs `KNOWLEDGE_LLM_URL`; ollama stays under its own profile and can be combined (U9, default - revisit with PO).
- Extraction writes temp files and renames only after the whole run validates, so a failed run leaves `_graph` as it was (U10, default - revisit with implementation lead).
- The real run copies a fixture vault of a few dozen notes with at least one `graph_check` question, built under tmp/ (U12, default - revisit with PO).
- Full rebuild of the vault in this Sprint; `graph-update-queue.jsonl` is not consumed (U13, default - revisit with PO).

## User stories

### F3-US-1 — Card 160: Docker graph build. A compose profile runs LLM extraction over the vault markdown into _graph/nodes.jsonl and _graph/edges.jsonl, then builds the sqlite index (one command)
As a vault owner I run one compose command and get `_graph/*.jsonl` and an updated sqlite index.

**Acceptance**
- A3.1: compose profile (e.g. graph) runs extraction -> _graph jsonl -> sqlite index in one command
  - The profile uses F1's root variable and `/workspace` mount line (`${KNOWLEDGE_ROOT:?...}:/workspace`), not its own; `docker compose config --profile graph` shows only the project path as a volume source (finding 2).
  - The Dockerfile COPYs the new extraction, probe, validator and shared modules (finding 3). The index step is the existing `index` command, unchanged (finding 6).
  - The chat client is new code; the image has no GPU tooling (findings 4, 8).
- R1: Shared engine: noah, genna personal graphs and general projects all use it — per-instance root, ontology and link policy are config; no instance name in engine code (user: "우리 지식 저장소를 upgrade 할거고 이걸 noah, genna에서 개인화 그래프 용도로도 사용할거야 범용도 있고") — applied: ontology and edge-rule keys extend F2's `_knowledge/config.json` schema; a grep of engine code for noah/genna finds nothing (finding 20).
- R2: Checks: python3 _repo/scripts/validate_plugins.py, node _repo/scripts/check-copies.mjs, node --test knowledge/scripts/*.test.mjs knowledge/hooks/*.test.mjs, counts reported — applied.
- R3: No version bump in this Sprint (batched release); README.md and KOR.md move together — applied.
- R4: Real runs use copies under tmp/, never a live vault; tmp/ cleaned after results are recorded — applied (see F3-US-5).
- R5: Edit files with Read/Edit/Write only; harness/ and graph/ untouched — applied; `git diff --quiet HEAD -- graph/ harness/` passes.

### F3-US-2 — Card 160: a hardware probe (GPU/VRAM, RAM, cores) picks the model size
As a user I get a model tier that fits my machine without choosing one.

**Acceptance**
- A3.2: hardware probe picks a model tier, writes the pick and the probe facts to .knowledge/, env var overrides it; probe logic in node with tests
  - `KNOWLEDGE_LLM_TIER` overrides the pick and the file records `source: "env"`; env overrides config file values.
  - Node tests cover CPU-only 13 GB (expect `small`), 16 GB RAM, 8 GB and 16 GB VRAM, missing `nvidia-smi`, and the override (finding 24).
- R1: Shared engine: noah, genna personal graphs and general projects all use it — per-instance root, ontology and link policy are config; no instance name in engine code (user: "우리 지식 저장소를 upgrade 할거고 이걸 noah, genna에서 개인화 그래프 용도로도 사용할거야 범용도 있고") — applied: the tier table is a config key extending F2's schema; no instance name in the probe.
- R2: Checks: python3 _repo/scripts/validate_plugins.py, node _repo/scripts/check-copies.mjs, node --test knowledge/scripts/*.test.mjs knowledge/hooks/*.test.mjs, counts reported — applied.
- R3: No version bump in this Sprint (batched release); README.md and KOR.md move together — applied.
- R4: Real runs use copies under tmp/, never a live vault; tmp/ cleaned after results are recorded — applied: the probe writes into the tmp/ copy's `.knowledge/` in the real run.
- R5: Edit files with Read/Edit/Write only; harness/ and graph/ untouched — applied.

### F3-US-3 — Card 160: extracted edges are validated against graph-builder rules
As a graph owner only well-formed edges reach `edges.jsonl`.

**Acceptance**
- A3.3: extracted edges are validated against graph-builder rules: evidence required, no RELATED_TO, directional types; rejected edges are reported with reasons
  - The rules are cited from `SKILL.md:44, 75-81, 101-110` and today enforced only at `validate-knowledge.mjs:427-434` for reachability-path edges (findings 10-14); the new validator runs before the write, since `index` checks none of this (finding 6).
  - Each rejected edge is in `_graph/rejected-edges.jsonl` with `reasons[]`, and the command output gives the count by reason. Node tests cover missing evidence, evidence not in the file, `RELATED_TO` in any case, weak types, a reversed inverse without ontology support.
- R1: Shared engine: noah, genna personal graphs and general projects all use it — per-instance root, ontology and link policy are config; no instance name in engine code (user: "우리 지식 저장소를 upgrade 할거고 이걸 noah, genna에서 개인화 그래프 용도로도 사용할거야 범용도 있고") — applied: the allow-list and edge rules are config keys under F2's schema.
- R2: Checks: python3 _repo/scripts/validate_plugins.py, node _repo/scripts/check-copies.mjs, node --test knowledge/scripts/*.test.mjs knowledge/hooks/*.test.mjs, counts reported — applied.
- R3: No version bump in this Sprint (batched release); README.md and KOR.md move together — applied.
- R4: Real runs use copies under tmp/, never a live vault; tmp/ cleaned after results are recorded — applied: the validator is exercised on the tmp/ copy in F3-US-5.
- R5: Edit files with Read/Edit/Write only; harness/ and graph/ untouched — applied.

### F3-US-4 — Card 160: without an endpoint, hash/no-LLM stays the default and _graph is untouched
As a user with no LLM the default path is unchanged and the graph command tells me why it did nothing.

**Acceptance**
- A3.4: no endpoint configured -> the command says so and exits without changing _graph
  - Without `KNOWLEDGE_LLM_URL` (or config), the graph command prints that no endpoint is configured and exits without creating, renaming or editing anything under `_graph/`; checked by a before/after tree hash.
  - A mid-run LLM failure (timeout, bad JSON) also leaves `_graph/` as it was (temp files, rename after validation). The graph-builder skill path and the default hash `index` are unchanged.
- R1: Shared engine: noah, genna personal graphs and general projects all use it — per-instance root, ontology and link policy are config; no instance name in engine code (user: "우리 지식 저장소를 upgrade 할거고 이걸 noah, genna에서 개인화 그래프 용도로도 사용할거야 범용도 있고") — applied: the endpoint comes from env or config, never a hardcoded host.
- R2: Checks: python3 _repo/scripts/validate_plugins.py, node _repo/scripts/check-copies.mjs, node --test knowledge/scripts/*.test.mjs knowledge/hooks/*.test.mjs, counts reported — applied.
- R3: No version bump in this Sprint (batched release); README.md and KOR.md move together — applied.
- R4: Real runs use copies under tmp/, never a live vault; tmp/ cleaned after results are recorded — applied: the no-endpoint run is made on the tmp/ copy.
- R5: Edit files with Read/Edit/Write only; harness/ and graph/ untouched — applied.

### F3-US-5 — Card 160: one real run on a copy of a small vault in tmp/
As the PO I see the numbers from a real run on this machine.

**Acceptance**
- A3.5: one real run on a copy of a small vault in tmp/ (CPU-only machine: no GPU, 13 GB RAM) reports node/edge counts, rejected edges and question reachability; containers torn down by exact name, no prune
  - The vault is the fixture copy under tmp/ (few dozen notes, at least one `graph_check` question). The report lists node count, accepted edge count, rejected edges with reasons, and `_graph/question-reachability.jsonl` results (reachable / not).
  - Only a `small`-tier model is expected here (about 5 GB RAM free; finding 24). Containers have unique names, publish no host ports, and are removed by exact name; no `prune` (finding 25). tmp/ is deleted after the results are recorded in the Sprint report.
- R1: Shared engine: noah, genna personal graphs and general projects all use it — per-instance root, ontology and link policy are config; no instance name in engine code (user: "우리 지식 저장소를 upgrade 할거고 이걸 noah, genna에서 개인화 그래프 용도로도 사용할거야 범용도 있고") — applied: the fixture sets its ontology through `_knowledge/config.json`, not the engine.
- R2: Checks: python3 _repo/scripts/validate_plugins.py, node _repo/scripts/check-copies.mjs, node --test knowledge/scripts/*.test.mjs knowledge/hooks/*.test.mjs, counts reported — applied: counts are in the report.
- R3: No version bump in this Sprint (batched release); README.md and KOR.md move together — applied.
- R4: Real runs use copies under tmp/, never a live vault; tmp/ cleaned after results are recorded — applied (this story is the real run).
- R5: Edit files with Read/Edit/Write only; harness/ and graph/ untouched — applied.

### F3-US-6 — Card 160: README/KOR rows for the files F3 creates
As a reader I find where `_graph/*` and the probe file live in F1's table.

**Acceptance**
- F3 block of F1's README/KOR table (path | created by | when | purpose): `_graph/nodes.jsonl`, `_graph/edges.jsonl`, `_graph/rejected-edges.jsonl`, `_graph/question-reachability.jsonl`, `.knowledge/hardware-probe.json`. README.md and KOR.md change in the same commit (finding 22). Integrate checks the table against disk after the real run.
- R1: Shared engine: noah, genna personal graphs and general projects all use it — per-instance root, ontology and link policy are config; no instance name in engine code (user: "우리 지식 저장소를 upgrade 할거고 이걸 noah, genna에서 개인화 그래프 용도로도 사용할거야 범용도 있고") — applied: rows use generic paths, no instance name.
- R2: Checks: python3 _repo/scripts/validate_plugins.py, node _repo/scripts/check-copies.mjs, node --test knowledge/scripts/*.test.mjs knowledge/hooks/*.test.mjs, counts reported — applied.
- R3: No version bump in this Sprint (batched release); README.md and KOR.md move together — applied.
- R4: Real runs use copies under tmp/, never a live vault; tmp/ cleaned after results are recorded — applied: the rows are checked against the tmp/ run's tree.
- R5: Edit files with Read/Edit/Write only; harness/ and graph/ untouched — applied.

## Out of scope
- Any change to the `graph/` or `harness/` plugins (stable; `.claude/rules/repo.md`).
- Making an LLM required, or shipping ollama inside the `graph` profile.
- F1's work: the root variable, the mount line, the resolver module and the layout table itself.
- F2's work: `knowledge_capture`, the config file's schema and the shared job writer.
- F4's work: the backend seam, `migrate`, size advice and pgvector.
- Incremental extraction from `graph-update-queue.jsonl`; GPU passthrough into containers.
- A version bump; real runs on a live vault.

## Open questions
- Chunk and context size that suits small CPU models, and the run-time budget for the real run on this machine. [owner: implementation lead] (U11; no source states a budget.)
- Dependency on F1: the final root variable and `/workspace` mount line, the resolver module name, and the README table's F3 block. [owner: F1 package / integrate] (U14)
- Dependency on F2: the config schema module and export names that F3 extends with graph keys (ontology types, edge rules, tier table). [owner: F2 package / implementation lead] (U15)

The other unknowns (U1-U10, U12, U13) were decided by default and are written above as rules, each marked with its owner for revisiting.
