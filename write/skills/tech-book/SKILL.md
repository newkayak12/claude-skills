---
name: tech-book
effort: high
description: >-
  Use when a technical book or multi-chapter guide is written in stages: approved TOC, per-chapter review loop, PDF.
  Triggers on: "기술서적 써줘", "책 집필", "개념부터 심화까지 책으로", "책 목차→검수→퇴고로 가자", "write a tech book".
scenarios:
  - "Write a Postgres book for non-majors, explained through MySQL"
  - "Draft a MongoDB guide chapter by chapter, with a review loop before anything is final"
  - "비전공자용으로 Postgres 개념부터 심화까지 책 써줘, MySQL에 빗대서"
  - "소프트웨어 공학 책 목차부터 잡아줘"
  - "한 번에 쓰지 말고 목차 → 개념 → 검수 → 퇴고로 가자"
compatibility:
  optional:
    - think-tool          # prerequisite order in the TOC, choosing which analogy fits a concept
    - sequential-thinking # clustering concepts into chapters
  remote_mcp_note: >-
    think-tool이 있으면 목차의 선행 순서와 개념마다 어떤 비유가 맞는지 고를 때 씁니다. sequential-thinking은 개념을
    장으로 묶을 때 씁니다. Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
---
## Standing Mandates

- NEVER write the book, or any chapter, in one pass from the request, and NEVER start stage 2 before the user approves
  `toc.md`. Reader level, order, and scope are decided by the TOC; a one-pass draft hardens them before anyone chose.
- NEVER state a version, default value, config name, limit, or benchmark without a source. Write
  `[확인 필요: <fact>]` instead. One wrong default discredits a reference book, and a non-major cannot catch it.
- ALWAYS close every analogy to the anchor (e.g. "MySQL에서는…") with where it breaks. A non-major carries an analogy
  past the point it holds; the break line is what stops them.
- NEVER let the agent that drafted a chapter review it. Review is a separate agent; its findings are applied, not argued.
- ALWAYS stop the review↔revise loop on 🔴🟡 = 0 or after three rounds, and say which — a fourth round is polishing.
- NEVER run `write:like-me` without ≥ 2 samples the user wrote alone. like-me is the user's voice, not "like other
  books"; the default copyedit is `references/house-style.md`.
- ALWAYS invoke each routed skill by name, visibly (`references/skill-routing.md`). The repo's skills are the experts
  here; a chapter written without its SME skill repeats what a general model guesses. A routed skill that isn't
  installed: read its `SKILL.md` from the repo and follow it, and say so.

Goal: a non-major reads chapter N knowing only chapters 1..N-1 and the anchor; every fact is sourced or marked; the
closing status recounts to the files on disk.

# Tech Book

Writes a book as files, one stage at a time, under `tmp/books/<slug>/`, and ends in `book.pdf`. Resume book-wide
stages (0–2) from the highest one on disk, and each chapter from its latest file in draft/, review/, final/. Outside
this repo, check that `tmp/` is gitignored; if not, tell the user before writing.

**Not for:** a single document, design doc, or blog post (`write:plans`); reviewing existing text
(`write:writer-verification`); a voice rewrite (`write:like-me`); a spec from a conversation (`write:spec`).

## Process

0. **brief.md.** Reader level, anchor (what the reader already knows), scope in/out, register, sources. Run one
   `think:grill` round with a recommended answer per question; an item the user doesn't answer goes into the brief
   as `[확인 필요: … / 추천: …]`. The first turn ends here, with the grill questions.
1. **toc.md.** `think:untangle-thoughts` (Outline). One block per chapter in the `references/house-style.md` format:
   goal, `requires:` (earlier chapters only, order checked with think-tool), anchor analogy candidates, `sme:` (from
   `references/skill-routing.md`). Present it with one `think:grill` round. **Stop: no stage 2 until the user
   approves toc.md.**
2. **glossary.md + concepts/NN.md.** Once per book (shared glossary); sequential-thinking clusters, think-tool picks
   analogies. Per concept: definition, prerequisite, analogy + where it breaks, one example, `[확인 필요]` items.
   `knowledge:base-builder` / `knowledge:query` only when the user supplied sources.
3. **draft/NN.md.** `agents:dispatching-parallel-agents`, one agent per chapter with its `sme:` skill mounted. No
   worktree isolation — `tmp/` is gitignored, so a worktree strands the file; each agent writes only its own
   absolute path under `tmp/books/<slug>/`.
4. **review/NN-rK.md.** Four checks, concurrent, never by the drafter, merged into one file: the SME skill fact-checks;
   `cognition:epistemic-reasoner` tests every analogy and absolute claim; `write:writer-verification` review mode
   (genre `doc`, audience from the brief); `../plans/agents/reader-agent.md` asked each learning goal as a question —
   at most 5 per chapter per round. Findings are 🔴🟡🟢 with original → fix.
5. **Revise draft/NN.md.** Close every 🔴🟡, then back to 4. From round 2, re-run only the checks that flagged
   something. Leftovers at the stop go to `## 남은 항목` at the end of the chapter.
6. **final/NN.md.** Copyedit to `references/house-style.md`, then one `write:writer-verification` pass; check terms
   against `glossary.md` across the whole book. `write:like-me` only with the user's samples;
   `develop:architecture-designer` only for system figures.
7. **book.pdf.** `node scripts/render-pdf.mjs tmp/books/<slug>` — chapters in toc.md order, typeset in the
   NanumGothic fonts bundled in `assets/fonts/` (page and type in `references/house-style.md`). No browser found →
   it exits 1 and keeps `book.html`; tell the user to set `CHROME=<path>`. Never swap in another font: the
   page is set to Nanum metrics, and only these fonts ship with their license.

Done: after stage 7, `completion:verification-before-completion` with an isolated verifier against the Goal line and
book.pdf (exists, ≥ 1 page, every toc chapter rendered).

Parallelism: one agent per book for stages 0–1; stage 2 once per book; stages 3–6 per chapter, then one book-wide
glossary pass. Independent means no two agents write the same file.

## Output Template

```
Next: <the one decision for the user — e.g. approve toc.md, answer grill items 2·4>
Book: <title> · tmp/books/<slug>/ · stage <n> of 0–7
Chapters <k>: final <a> · in loop <b> (round r/3) · stopped at cap <c>
Review open: 🔴 x · 🟡 y · 🟢 z | analogies tested <n>: hold <h> · break stated <b>
Unverified: <m> × [확인 필요] — <list>
Skills run: <plugin:skill × stage>
```

Before stage 3 the Chapters and Review lines read `—`. Do NOT paste chapters into chat — they are in the files.

## What Claude Does / What You Do

| Claude | You |
|---|---|
| Drafts the brief and the TOC, routes each stage to its skill, runs the review loop | Approve toc.md; answer the grill items |
| Marks every unsourced fact `[확인 필요]` | Confirm those facts, or point to a source |
| Reports the stage it stopped at and why | Decide the leftover 🟢; give writing samples if you want like-me |

## Related Skills

- `references/skill-routing.md` — which skill runs at which stage, with what input.
- `write:plans` — a single document or blog post.
- `write:writer-verification` — the review passes this skill runs in stages 4 and 6.
- `write:like-me` — the user's own voice, at stage 6, with samples.
