# Findings — F1 knowledge leftovers from 1.22.0 (card 166)

Investigate stage for `_repo/docs/plans/2026-11-19-knowledge-leftovers-prd.md` (light mode).
A finding cites the source it comes from. An unknown has no source and carries an owner and a default.

## Findings

1. **Card 166 is five leftovers** found by the E-f9145f5b worktree run on 2026-11-19 — `_repo/docs/backlog.md:671-689`.
   - The graph build re-extracts every note on every run, and `_knowledge/jobs/graph-update-queue.jsonl` is never consumed. 34 notes took 508 s on CPU.
   - qwen2.5:3b (the small tier) produced 44 nodes and 2 edges, with 16 refused: self-loop 8, vague-type 4, missing/foreign evidence 6, unknown node 2. Both test questions were unreachable, and `medium` was never tried.
   - The capture rule links `결제 승인서` to `결제 승인`, a false positive.
   - The bind-mount write under `USER node` was checked only with the same uid.
   - A non-interactive `codex exec` refuses `knowledge_capture` under approval policy `never`. The real call passed only with approvals bypassed.
2. **Full rebuild was a deliberate 1.22.0 default.** F3 decided "Full rebuild of the vault in this Sprint; `graph-update-queue.jsonl` is not consumed (U13)" — `2026-11-19-knowledge-graph-docker-prd.md:27`.
3. **extractGraph iterates every catalog entry.** `extractGraph(root, { chat, config, log, limit })` reads `_knowledge/catalog.jsonl` and loops over every entry with a path, calling `chat([...])` once per note. It has no skip or queue input. `chat` is injectable, so a test can count calls. Sources: `knowledge/scripts/knowledge-graph.mjs:228-262`, and `buildGraph` at `:374-395` with `options.chat`.
4. **Queue file and job shape.** `QUEUE_FILES.graph = 'graph-update-queue.jsonl'` lives under `<store>/_knowledge/jobs/`. `writeDeltaJobs(root, base, flags)` appends `{file, reason, queued_at, ...}`. The PostToolUse hook and `knowledge_capture` both write through this function. No code reads or truncates the queue. Source: `knowledge/scripts/knowledge-jobs.mjs:1-40`.
5. **Tier → model.** `DEFAULT_TIER_MODELS = {small: 'qwen2.5:3b', medium: 'qwen2.5:7b', large: 'qwen2.5:14b'}`. `pickTier` picks small for CPU-only machines under 16 GB RAM, medium at ≥16 GB RAM or ≥8 GB VRAM, and large at ≥16 GB VRAM. Source: `knowledge/scripts/knowledge-probe.mjs:10-47`.
6. **compose passes the overrides.** `KNOWLEDGE_LLM_TIER`, `KNOWLEDGE_LLM_MODEL`, `KNOWLEDGE_LLM_TIMEOUT_MS` (default 300000) and `KNOWLEDGE_LLM_PULL` go to the `graph` profile, and `KNOWLEDGE_LLM_URL` is required (`:?`). So `KNOWLEDGE_LLM_TIER=medium` forces qwen2.5:7b on this machine. A per-note timeout lands in `failed[]` with reason `timeout`. Sources: `knowledge/compose.yaml:29-47`, `knowledge-graph.mjs:183-186,259,341-346`.
7. **This machine:** 13 GB RAM total, about 6 GB available at read time, 12 cores, no GPU. pickTier would choose `small`, so the medium run must set the env override. Source: `free -g`, `nproc` (this session).
8. **The capture matching rule.** `findTerm` accepts a match when the term ends in Hangul and the next character is any Hangul (`okAfter = ... || (hangulEnd && HANGUL.test(after))`). The comment there reads "A Hangul term may be followed by more Hangul (a particle ...)". This is the rule that lets `결제 승인서` match `결제 승인`. Source: `knowledge/scripts/knowledge-capture.mjs:16,52-70`.
9. **The existing capture test.** `findTerm('결제 승인을 거절했다', '결제 승인') === 0` is the particle case that must stay green. It also checks a code span, `Prepayment` and a wikilink as negatives. Source: `knowledge/scripts/knowledge-capture.test.mjs:92-97`.
10. **The existing particle list.** `KOREAN_PARTICLES = ['에서는','에서','으로','에게','까지','부터','와','과','을','를','이','가','은','는','의','에','로','도','만']` is used for token stripping, and only when at least 2 chars remain. `서` is not in it. The list is not exported. Source: `knowledge/scripts/sqlite-knowledge.mjs:896-905`.
11. **Test files.** `knowledge/scripts/` holds 7 test files, all named `*.test.mjs`: capture, graph, migrate, paths, postgres-sync, sqlite-knowledge, validate-knowledge. `test-*.mjs` matches none of them, so A1.5's glob `knowledge/scripts/test-*.mjs` runs nothing as written. Source: Glob/ls; the critique stage confirmed the same.
12. **Docker user.** The image is `FROM node:24-bookworm-slim` with `USER node` (uid 1000 in node images; the uid is not verified in this repo). Source: `knowledge/Dockerfile:1,7`.
13. **README has no uid rule and no Codex approval text.** The only Codex mention is the v1.21.3 status line. Source: grep `uid|approv|Codex` on `knowledge/README.md` → line 503 only.
14. **Codex manifest.** `knowledge/.codex-plugin/plugin.json` registers the MCP servers (README:503). compat-codex requires a real Codex invocation to prove the path, not parsing alone. Source: `.claude/rules/compat-codex.md`.
15. **Conventions are unfilled templates.** `.claude/conventions/verification.md` gives only the pass bar: the commands pass and the changed behaviour is exercised once. `maintaining.md` says to report counts. boundaries.md and coding.md hold placeholders only. Sources: the conventions in the briefing, and `.claude/rules/maintaining.md`.
16. **Settled decisions** (user brainstorm, 2026-11-19), to be written as rules:
    - This Sprint takes card 166, then 164. Card 162 (pgvector) stays deferred, the p95 400 ms threshold is unchanged, and card 165 stays on the backlog.
    - Card 164 is owned by PLAN-F2.
    - Real runs use copies in tmp/ and Docker containers with unique names and no host ports, torn down by exact name and never pruned. tmp/ is cleared after the numbers are in the report.
17. **The 34-note vault is not in the repo.** No fixture directory was found. The F3 PRD says the real run "copies a fixture vault of a few dozen notes with at least one `graph_check` question, built under tmp/" (`graph-docker-prd.md:26`), and that tmp/ was cleared after that run. Its location is an unknown.

## Requirements analysis

### Actors
- **Knowledge user**: runs the compose graph build and calls `knowledge_capture`.
- **Codex session user**: calls `knowledge_capture` from Codex.
- **Implementation lead**: makes the queue and particle decisions.
- **Requester/PO**: decides the vault location and the test glob.

### Rules
- R1 (A1.5, shared): every story passes `node --test knowledge/scripts/test-*.mjs` with counts reported, plus `validate_plugins.py` and `check-copies.mjs`. The glob is carried as open question Q4.
- R2 (settled, shared by the real runs in F1-US-1, US-2 and US-4): copies in tmp/, Docker containers with unique names and no host ports, torn down by exact name and never pruned. tmp/ is cleared after the report. This is N/A for US-3 and US-5. US-5 is a Codex call, not a Docker run, but any store it writes to goes in tmp/.
- R3: README.md and KOR.md move together in one commit (`maintaining.md`).

### Items
- F1 (a) incremental build → F1-AC-1: A1.1 verbatim. The test injects `chat`, runs a full build, then queues one note and reruns. `chat` is called only for the queued note; the unchanged note is not re-sent.
- F1 (b) medium run → F1-AC-2: A1.2 verbatim. Run with `KNOWLEDGE_LLM_TIER=medium` (qwen2.5:7b), with the baseline of 44 nodes, 2 edges and 16 refused (8/4/6/2), g1/g2 unreachable.
- F1 (c) particle list → F1-AC-3: A1.3 verbatim. `findTerm('결제 승인서 ...', '결제 승인') === -1` is red before and green after, and the test at `:92` stays green.
- F1 (d) uid rule → F1-AC-4: the uid half of A1.4. A real write check runs with a host uid different from the image's node uid.
- F1 (e) Codex approval → F1-AC-5: the Codex half of A1.4. README and KOR describe the approval path, proven by a real Codex invocation.

### Open questions
These are the same entries as the unknowns returned below (Q1-Q6).

## Unknowns (with owner and default)
- Q1 Where is the 34-note test vault now? Owner: requester. Default: rebuild a fixture of 34 notes with g1/g2 `graph_check` questions under tmp/, and state in the report that the baseline came from a different copy.
- Q2 What happens to the queue on success, on failure, and when a note is deleted? Owner: implementation lead. Default:
  - Entries are consumed (truncated or offset-marked) only after `_graph` is written.
  - A failed note stays queued.
  - A deleted note's nodes and edges are dropped without an LLM call.
  - An empty queue with an existing `_graph` makes no LLM call.
- Q3 Should the particle list be shared or local to capture? Owner: implementation lead. Default: export `KOREAN_PARTICLES` from one module and use it in both places, with `서` absent so `승인서` fails. The alternative is a list local to capture.
- Q4 The test glob `test-*.mjs` matches no file. Owner: requester. Default: run `node --test knowledge/scripts/*.test.mjs` and note the discrepancy. The criterion stays as written.
- Q5 Is qwen2.5:7b feasible on 13 GB with about 6 GB free and no GPU, and with what timeout? Owner: implementation lead. Default: run it with a raised `KNOWLEDGE_LLM_TIMEOUT_MS`. If it fails or times out, report it as partial with the reason.
- Q6 Which Codex approval mechanism should the docs describe: interactive approval, an `--ask-for-approval`/sandbox flag, or a per-tool approval in config? Owner: implementation lead (verified by a real Codex run). Default: document what the real invocation proves, and never recommend bypassing approvals as the default.
