---
name: knowledge-workflow
effort: high
description: >-
  Use when building a knowledge vault end to end or when competency questions
  are failing and the fix has to be measured — routes catalog, graph, RAG,
  index, and repair work as one loop with an explicit stop condition; not for a
  single query against an index that already works.
type: workflow
theme: knowledge
scenarios:
  - "이 저장소로 knowledge vault 처음부터 만들어줘"
  - "eval 점수가 안 오르는데 뭘 고쳐야 하는지 같이 돌려줘"
  - "검색 품질 개선 루프 돌리자"
  - "Build this vault and keep repairing until retrieval stops improving"
  - "Run the retrieval measurement loop on this knowledge base"
estimated_time: "2-6 hours (first build), 20-40 minutes per repair round"
compatibility:
  recommended:
    - mcp__knowledge-local__knowledge_index
    - mcp__knowledge-local__knowledge_search
  optional:
    - think-tool
  remote_mcp_note: >-
    knowledge-local MCP가 있으면 색인과 검색을 그쪽으로 라우팅합니다. 없으면 번들 CLI를 씁니다.
---

# Knowledge Workflow

Build the vault, then repair retrieval in measured rounds until it stops improving.

## Standing Mandates

- **The loop is the deliverable, not the edit.** Every round is: measure → diagnose → change **one** thing → measure against the saved run. A round with two changes cannot be attributed or reverted, so it does not count as a round.
- **Split before the first repair.** Record `--split holdout` once, up front. A holdout measured after repairs proves nothing, and tuning against it destroys the only unbiased number in the loop.
- **Fix the largest lever first, not the easiest edit.** The order below is measured, not intuited. Vocabulary work feels productive and has repeatedly moved nothing while the bottleneck sat in the provider or the ranker.
- **A stop condition is part of the run.** Say which one applies before the round starts. A loop with no declared exit becomes editing that looks like progress.
- **Never cite the round count as progress.** Report the holdout number, or say it did not move.

---

## Workflow Overview

```
[A] Build once
  catalog → graph → RAG → index
        ↓
[B] Split + baseline   ← record holdout, save the run
        ↓
   ┌──> [C] Diagnose  (repair_targets, kind breakdown)
   │         ↓
   │    [D] One change (lever order below)
   │         ↓
   │    [E] Re-measure vs baseline → keep or revert
   │         ↓
   └─── stop condition met? ──no──┘
                 │ yes
                 ↓
        [F] Report + hand off to knowledge-query
```

---

## Phase A — Build (once)

| Step | Skill | Skip if |
|---|---|---|
| A1 Catalog | `knowledge:knowledge-base-builder` | `_knowledge/catalog.jsonl` exists and covers the sources |
| A2 Graph | `knowledge:knowledge-graph-builder` | No relationship questions in scope |
| A3 RAG chunks | `knowledge:rag-corpus-builder` | Notes are short enough to retrieve whole |
| A4 Index | `knowledge:sqlite-index-builder` | — |

Competency questions in `_knowledge/questions.jsonl` are a **precondition for Phase B**, not an output of it. Without them there is nothing to measure and the loop cannot start.

## Phase B — Split and baseline (once)

```bash
node --no-warnings "${CLAUDE_PLUGIN_ROOT}/scripts/sqlite-knowledge.mjs" eval \
  --root <vault> --k 10 --split holdout          # record this number, then leave it alone
node --no-warnings "${CLAUDE_PLUGIN_ROOT}/scripts/sqlite-knowledge.mjs" eval \
  --root <vault> --k 10 --split dev > /tmp/round-0.json
```

Record the reranker ceiling once too: `eval --k 50` minus `eval --k 10`. Required notes missing at both depths can never be recovered by reordering.

## Phase C — Diagnose

Read, in this order: `repair_targets` (each gap and how many questions the note blocks), the per-`kind` hit breakdown, then `relation_participant_evicted_ids` on any comparison question that lost a sibling note.

| Signal | Lever | Route to |
|---|---|---|
| `embedding_quality: lexical-baseline`, paraphrased or spoken-style questions miss | Attach a semantic provider | `knowledge:sqlite-index-builder` |
| `embedding_prompt: none` under `embeddinggemma` | Rebuild with the asymmetric prompts | `knowledge:sqlite-index-builder` |
| `documents_windowed` high | Chunk the corpus finer | `knowledge:rag-corpus-builder` |
| Exact screen-label questions lose to paraphrases | Sweep the fusion split | `eval --sweep 0.3,0.4,0.5` |
| `recall@50` ≫ `recall@10` | Attach a reranker | `knowledge:knowledge-query` → `references/local-sqlite.md` |
| `gap: missing-note` | Extract the note | `knowledge:knowledge-base-builder` |
| `gap: no-lookup-vocabulary` | Add bridge fields, grounded in the repo | `knowledge:knowledge-base-builder` |
| Comparison question retrieves the contrast but none of its sides | Declare `participants` | `knowledge:knowledge-graph-builder` |

## Phase D — One change

Apply exactly one. Ground every added term in the source, never in the question set — copying a question's words into a note is test-set leakage that scores well and retrieves nothing new.

## Phase E — Re-measure

```bash
node --no-warnings "${CLAUDE_PLUGIN_ROOT}/scripts/sqlite-knowledge.mjs" eval \
  --root <vault> --k 10 --split dev --baseline /tmp/round-N.json
```

**Corpus and vocabulary edits: revert on any regression**, even when `recall_at_k` rose — competency sets are small enough that an aggregate gain routinely hides a question that stopped working. **Engine, provider, and reranker changes are judged differently**: they move every question at once, so weigh net movement and holdout together and name the regressions instead of reverting on their existence.

## Stop conditions

1. **Two consecutive rounds with no dev improvement** — the remaining gaps are not the kind this loop fixes.
2. **Every remaining `repair_target` is `missing-note` with no source material** — an authoring problem; the honest answer is that the vault does not contain the answer.
3. **The target recall is met** — score the holdout once and report both numbers.
4. **The holdout has not moved while dev keeps rising** — stop and say so. That gap is overfitting, and more rounds widen it.

---

## Output Template

```markdown
## Retrieval round N

**Change:** <the one thing>       **Lever:** <provider|ranking|corpus|vocabulary>
**Dev:** hits A → B, recall@10 X → Y, MRR P → Q
**Verdict:** improved | regressed | unchanged
**Regressions:** <question ids, or none>
**Decision:** kept | reverted — <why>

**Holdout (recorded at round 0):** <number, unchanged since>
**Stop condition:** <which one, and whether it is met>
```

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Runs eval, reads `repair_targets`, names the lever | Attaches Ollama or a reranker if you want one |
| Proposes exactly one change per round | Confirms the change is true of the system, not just of the docs |
| Reverts regressions without being asked | Sets the recall target and calls the loop done |
| Reports the holdout, or that it did not move | Supplies the competency questions |

## Related Skills

- Steps: `knowledge:knowledge-base-builder`, `knowledge:knowledge-graph-builder`, `knowledge:rag-corpus-builder`, `knowledge:sqlite-index-builder`
- After: `knowledge:knowledge-query` — answer from the index the loop stabilized
- Also: `knowledge:render-graph-view`, `knowledge:ontology-builder`
- Measured lever sizes and what is deliberately not being done: [ROADMAP.md](../../ROADMAP.md)
