# PRD F1 — knowledge leftovers from 1.22.0 (card 166)

Findings: `_repo/docs/plans/2026-11-19-knowledge-leftovers-prd-findings.md` (cited below as "findings n").

## Goal

Close the five leftovers the 1.22.0 real run found in the knowledge plugin: a graph build that sends only changed notes to the LLM, one real medium-tier build to compare with the small tier, a capture that no longer links `결제 승인서` to `결제 승인`, a bind-mount uid rule that was checked with a different uid, and a README/KOR line on how a Codex session approves the `knowledge_capture` write tool.

## Problem

Card 166 (`_repo/docs/backlog.md:671-689`) lists leftovers of 1.22.0. The request assumed the update queue could simply be read. The findings show that full rebuild was a deliberate 1.22.0 default (finding 2) and that nothing reads `_knowledge/jobs/graph-update-queue.jsonl` (finding 4); `extractGraph` loops over every catalog entry with no skip input (finding 3, `knowledge-graph.mjs:228-262`). The 34 notes took 508 s on CPU, and the small tier (qwen2.5:3b) gave 44 nodes, 2 edges, 16 refused (self-loop 8, vague-type 4, missing/foreign evidence 6, unknown node 2) with g1/g2 unreachable; `medium` was never tried (finding 1). `findTerm` accepts any Hangul after a term as a particle (finding 8, `knowledge-capture.mjs:52-70`). The uid check used the same uid only, and README has neither a uid rule nor Codex approval text (finding 13). The request also assumes a `test-*.mjs` suite; the real files are all `*.test.mjs` (finding 11). The 34-note vault is not in the repo (finding 17).

## Scope

Five stories, one per sub-item (a)-(e). Source changes happen in later build packages; this card writes only this PRD and its findings file.

Rules settled for this Sprint (decided by the user in the 2026-11-19 brainstorm, or by default where marked):
- **Shared rule S1 — real runs** (F1-US-1, F1-US-2, F1-US-4): copies in `tmp/`, Docker containers with unique names and no host ports, torn down by exact name, never pruned; `tmp/` is cleared once the numbers are in the report. F1-US-3 and F1-US-5 start no container; any store F1-US-5 writes to is a `tmp/` copy.
- **Shared rule S2 — A1.5** (every story): `node --test knowledge/scripts/test-*.mjs` passes with counts reported; `validate_plugins.py` and `check-copies.mjs` pass. The suites are named `*.test.mjs`, so the command that counts is `node --test knowledge/scripts/*.test.mjs`; the criterion text is left as declared (default - revisit with requester).
- **Shared rule S3**: README.md and KOR.md change in the same commit (`.claude/rules/maintaining.md`).
- Queue semantics (default - revisit with implementation lead): entries are consumed only after `_graph` is written; a note whose extraction failed stays queued; a deleted note's nodes and edges are dropped without an LLM call; an empty queue with an existing `_graph` makes no LLM call.
- Particle list (default - revisit with implementation lead): one explicit list exported from one module and used by both capture and `sqlite-knowledge.mjs`; `서` is not in it.
- Vault (default - revisit with requester): if the original 34-note vault cannot be found, an equivalent 34-note fixture with g1/g2 `graph_check` questions is rebuilt under `tmp/`, and the report says the baseline came from a different copy.
- Medium run (default - revisit with implementation lead): `KNOWLEDGE_LLM_TIMEOUT_MS` is raised; if the run fails or times out the result is reported as partial with the reason.
- Codex path (default - revisit with implementation lead): the docs describe what a real Codex invocation proves; bypassing approvals is never the documented default.

## User stories

### F1-US-1 — Graph build reads the update queue and re-extracts only changed notes instead of every note each run

As a knowledge user, I rerun the Docker graph build and only the notes that changed go back to the LLM.

**Acceptance**
- A1.1: Graph build reads the update queue and re-extracts only changed notes: a node --test case proves an unchanged note is not re-sent to the LLM, and one timed rerun on the tmp copy is reported against the full-run 508 s
  - finding: `extractGraph` takes an injectable `chat`, so the test counts calls: full build, queue one note, rerun, `chat` called once (findings 3). The queue is `knowledge-jobs.mjs` `QUEUE_FILES.graph` (findings 4).
  - queue semantics: see Scope (default - revisit with implementation lead).
- A1.5: node --test knowledge/scripts/test-*.mjs passes with counts reported; validate_plugins.py and check-copies.mjs pass (S2: run as `*.test.mjs`, see Q4)
- S1: the timed rerun uses a `tmp/` copy and a uniquely named container with no host port, torn down by exact name, never pruned; `tmp/` cleared after the report.
- S3: README.md and KOR.md describe incremental behaviour in the same commit.

### F1-US-2 — One real graph-build run on the `medium` LLM tier on a copy of the 34-note test vault in tmp/

As a knowledge user, I see what the medium tier gives compared with the small tier.

**Acceptance**
- A1.2: One medium-tier run on the tmp copy reports nodes, edges, refusals by reason and g1/g2 reachability beside the small-tier numbers
  - baseline: qwen2.5:3b — 44 nodes, 2 edges, 16 refused (self-loop 8, vague-type 4, missing/foreign evidence 6, unknown node 2), g1/g2 unreachable (findings 1).
  - run with `KNOWLEDGE_LLM_TIER=medium`, which `knowledge-probe.mjs` maps to qwen2.5:7b; this machine (13 GB RAM, about 6 GB free, 12 cores, no GPU) would pick small, so the override is required (findings 5-7).
  - a partial result (timeout, memory) is reported as partial with its reason (Q5).
- A1.5: node --test knowledge/scripts/test-*.mjs passes with counts reported; validate_plugins.py and check-copies.mjs pass (S2: run as `*.test.mjs`, see Q4)
- S1: `tmp/` copy, unique container name, no host port, torn down by exact name, never pruned; `tmp/` cleared after the report.
- S3: README.md and KOR.md carry the medium-tier result only if a behaviour or default changes, in the same commit.

### F1-US-3 — knowledge_capture's Hangul matching uses an explicit particle list so `결제 승인서` no longer links to `결제 승인`

As a knowledge user, capture does not link a longer word to a shorter term.

**Acceptance**
- A1.3: A test with `결제 승인서` is red before the particle-list change and green after; existing capture tests stay green
  - finding: the any-Hangul rule is `knowledge-capture.mjs:52-80`; the test to keep green is `knowledge-capture.test.mjs:92` (`결제 승인을` links); the existing list is `KOREAN_PARTICLES` at `sqlite-knowledge.mjs:896` and does not contain `서` (findings 8-10).
  - the new case: `findTerm('결제 승인서 ...', '결제 승인') === -1`, shown failing on the unchanged code first.
- A1.5: node --test knowledge/scripts/test-*.mjs passes with counts reported; validate_plugins.py and check-copies.mjs pass (S2: run as `*.test.mjs`, see Q4)
- S1: N/A — no container or real run; finding 8 shows the change is a node unit test.
- S3: N/A — no README change needed unless the particle rule is documented; if it is, README.md and KOR.md move together.

### F1-US-4 — Check a bind-mount write under USER node with a different host uid and state the uid rule

As a knowledge user on Linux, I know which host uid can write `.knowledge/` in a bind-mounted project.

**Acceptance**
- A1.4 (uid half): README.md and KOR.md state the bind-mount uid rule after a real different-uid check, and how Codex approves the write tool
  - this story owns the uid half; the Codex half is F1-US-5. README.md and KOR.md state the rule in the same commit, and only after a real write check under the Dockerfile's `USER node` (finding 12) against a `tmp/` project owned by another uid.
- A1.5: node --test knowledge/scripts/test-*.mjs passes with counts reported; validate_plugins.py and check-copies.mjs pass (S2: run as `*.test.mjs`, see Q4)
- S1: the check runs in a uniquely named container with no host port, torn down by exact name, never pruned; the project is a `tmp/` copy.
- S3: README.md and KOR.md in the same commit.

### F1-US-5 — README/KOR say how a Codex session approves the knowledge_capture write tool

As a Codex user, I know how to approve `knowledge_capture`, since a non-interactive `codex exec` refuses it under approval policy `never`.

**Acceptance**
- A1.4 (Codex half): "how Codex approves the write tool" — README.md and KOR.md say it in the same commit, verified by a real Codex invocation per `.claude/rules/compat-codex.md` (finding 14), not by parsing alone. Which path is documented follows the Codex path rule in Scope.
- A1.5: node --test knowledge/scripts/test-*.mjs passes with counts reported; validate_plugins.py and check-copies.mjs pass (S2: run as `*.test.mjs`, see Q4)
- S1: N/A — a Codex call, not a Docker run (findings R2); any store it writes is a `tmp/` copy.
- S3: README.md and KOR.md in the same commit.

## Out of scope

- The pgvector query backend (card 162): deferred, not this Sprint.
- The p95 400 ms threshold: unchanged.
- The teams PLAN judge (card 165): stays on the backlog.
- Card 164 (noah and genna on the knowledge engine): owned by PLAN-F2.
- Source changes in this card: the PRD and findings are its only files; boundaries/coding conventions hold placeholders only (findings 15).
- Changing the declared A1.5 criterion text.

## Open questions

Each has an owner and a default; the default is used unless the owner answers.

- Q1 Where is the 34-note test vault that produced the 508 s and the 3b baseline? Owner: requester. Default (revisit): rebuild an equivalent 34-note fixture under `tmp/` with g1/g2 questions; report that the baseline came from a different copy.
- Q2 Queue semantics: when is a graph-update-queue entry consumed, what happens to a note whose extraction failed, and what happens to a deleted note? Owner: implementation lead. Default (revisit): as in Scope.
- Q3 Should the particle list be shared with sqlite-knowledge.mjs `KOREAN_PARTICLES` or local to capture? Owner: implementation lead. Default (revisit): one exported list used by both.
- Q4 A1.5's glob `knowledge/scripts/test-*.mjs` matches no file; the real suite is `*.test.mjs`. Owner: requester. Default (revisit): run `node --test knowledge/scripts/*.test.mjs` and note the discrepancy.
- Q5 Is qwen2.5:7b feasible on 13 GB RAM (about 6 GB free), CPU-only, and with what per-note timeout? Owner: implementation lead. Default (revisit): raise `KNOWLEDGE_LLM_TIMEOUT_MS`; report partial with the reason on failure.
- Q6 Which Codex approval path should README/KOR document for knowledge_capture? Owner: implementation lead (proved by a real Codex run). Default (revisit): document what the real invocation proves; never default to bypassing approvals.
